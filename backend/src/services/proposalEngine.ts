import { prisma } from '../db';
import { callClaudeJson, AiBudgetExceededError } from './aiClient';
import { validateProposedAction, catalogTier, InvalidActionError, type ActionType } from './actionCatalog';
import { exportProposalNote, exportDailyNote } from './exportService';

/**
 * Proposal engine (Phase 3 — "the brain"). Runs after the morning sync:
 * sends the snapshot + deltas + profile summaries to Claude, gets back
 * candidate proposals, and validates every one against the allowed action
 * catalog before storing. Malformed proposals are rejected and logged —
 * never stored, never executed (spec §6/§3).
 */

const MAX_PROPOSALS_PER_DAY = 5;
const ALL_ACTION_TYPES: ActionType[] = [
  'notify_abdulla_telegram',
  'create_reminder',
  'flag_client_churn_risk',
  'draft_client_message',
  'propose_content_direction_change',
  'strategic_decision_package',
];

type DecisionPackage = {
  questionAr: string;
  optionsAr: string[];
  risksAr: string[];
  recommendationAr: string;
};

type RawProposal = {
  actionType: string;
  titleAr: string;
  bodyAr: string;
  evidenceRefs: string[];
  payload: Record<string, string | undefined>;
  decisionPackage?: DecisionPackage;
};

const PROPOSAL_SCHEMA = {
  type: 'object',
  properties: {
    proposals: {
      type: 'array',
      maxItems: MAX_PROPOSALS_PER_DAY,
      description: 'Ranked descending by business impact — most important first',
      items: {
        type: 'object',
        properties: {
          actionType: { type: 'string', enum: ALL_ACTION_TYPES },
          titleAr: { type: 'string', description: 'Short Arabic title' },
          bodyAr: { type: 'string', description: 'Arabic explanation, grounded in evidenceRefs' },
          evidenceRefs: {
            type: 'array',
            items: { type: 'string' },
            description: 'What in the supplied evidence justifies this — never propose without evidence',
          },
          payload: {
            type: 'object',
            properties: {
              messageAr: { type: 'string' },
              titleAr: { type: 'string' },
              dueDate: { type: 'string', description: 'ISO date, only for create_reminder' },
              organizationId: { type: 'string' },
              reasonAr: { type: 'string' },
              draftAr: { type: 'string' },
              changeAr: { type: 'string' },
            },
            additionalProperties: false,
          },
          decisionPackage: {
            type: 'object',
            description: 'Required only when actionType is strategic_decision_package',
            properties: {
              questionAr: { type: 'string' },
              optionsAr: { type: 'array', items: { type: 'string' } },
              risksAr: { type: 'array', items: { type: 'string' } },
              recommendationAr: { type: 'string' },
            },
            additionalProperties: false,
          },
        },
        required: ['actionType', 'titleAr', 'bodyAr', 'evidenceRefs', 'payload'],
        additionalProperties: false,
      },
    },
  },
  required: ['proposals'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You are the proposal engine for a content-marketing agency's operations system.
Analyze the supplied evidence (daily metrics, deltas since yesterday, client profile summaries) and propose at most ${MAX_PROPOSALS_PER_DAY} actions for Abdulla to approve.
Rules:
- Propose NOTHING without evidence. Every proposal's evidenceRefs must point to something concrete in the supplied data.
- Every proposedAction MUST use one of the six allowed actionType values with exactly the payload fields that action needs — never invent new fields or action types.
- Use strategic_decision_package only for genuinely strategic, high-stakes questions — it must include a decisionPackage with questionAr, at least 2 optionsAr, risksAr, and a recommendationAr.
- Rank the array by business impact, most important first.
- Return fewer than ${MAX_PROPOSALS_PER_DAY} proposals (or zero) if the evidence does not justify more.
- All text is Arabic.`;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

async function logTier1(summaryAr: string, refs: Record<string, unknown>): Promise<void> {
  await prisma.decisionLog.create({ data: { tier: 1, actor: 'system', summaryAr, refs: JSON.stringify(refs) } });
}

async function gatherEvidence() {
  const today = await prisma.metricsSnapshot.findFirst({ orderBy: { date: 'desc' } });
  let yesterday = null;
  if (today) {
    const dayStart = new Date(today.date);
    dayStart.setHours(0, 0, 0, 0);
    yesterday = await prisma.metricsSnapshot.findFirst({ where: { date: { lt: dayStart } }, orderBy: { date: 'desc' } });
  }
  const clients = await prisma.clientCache.findMany();
  const profiles = await prisma.clientProfile.findMany();
  const byOrg = new Map(profiles.map((p) => [p.organizationId, p]));
  const profileSummaries = clients.map((c) => {
    const p = byOrg.get(c.organizationId);
    return {
      organizationId: c.organizationId,
      name: c.name,
      churnRisk: p?.churnRisk ?? 'low',
      churnRiskReasonAr: p?.churnRiskReasonAr ?? '',
      preferencesExcerpt: (p?.preferencesMd ?? '').slice(0, 300),
      revisionPatternsExcerpt: (p?.revisionPatternsMd ?? '').slice(0, 300),
    };
  });
  return {
    todaySnapshotId: today?.id ?? null,
    todayParsed: today?.parsedNumbers ? JSON.parse(today.parsedNumbers) : null,
    yesterdayParsed: yesterday?.parsedNumbers ? JSON.parse(yesterday.parsedNumbers) : null,
    profileSummaries,
  };
}

function validateDecisionPackage(dp: unknown): DecisionPackage {
  if (!isRecord(dp)) throw new InvalidActionError('strategic_decision_package requires a decisionPackage object');
  const { questionAr, optionsAr, risksAr, recommendationAr } = dp;
  if (typeof questionAr !== 'string' || questionAr.length === 0) {
    throw new InvalidActionError('decisionPackage.questionAr is required');
  }
  if (!Array.isArray(optionsAr) || optionsAr.length < 2 || !optionsAr.every((o) => typeof o === 'string')) {
    throw new InvalidActionError('decisionPackage.optionsAr must have at least 2 string options');
  }
  if (!Array.isArray(risksAr) || !risksAr.every((r) => typeof r === 'string')) {
    throw new InvalidActionError('decisionPackage.risksAr must be a string array');
  }
  if (typeof recommendationAr !== 'string' || recommendationAr.length === 0) {
    throw new InvalidActionError('decisionPackage.recommendationAr is required');
  }
  return { questionAr, optionsAr, risksAr, recommendationAr };
}

/** Runs the analysis, validates every candidate, stores only what passes. */
export async function runProposalEngine(): Promise<{ ok: boolean; stored: number; rejected: number }> {
  const evidence = await gatherEvidence();
  if (!evidence.todaySnapshotId) {
    await logTier1('تعذّر تشغيل محرك المقترحات: لا توجد بيانات مزامنة بعد', { type: 'proposal_engine_skipped' });
    return { ok: false, stored: 0, rejected: 0 };
  }

  let result: { proposals: RawProposal[] };
  try {
    result = await callClaudeJson<{ proposals: RawProposal[] }>({
      purpose: 'proposal_engine',
      system: SYSTEM_PROMPT,
      userContent: JSON.stringify(evidence),
      schema: PROPOSAL_SCHEMA,
      maxTokens: 4096,
    });
  } catch (err) {
    if (err instanceof AiBudgetExceededError) {
      await logTier1('توقف محرك المقترحات: تم تجاوز ميزانية الذكاء الاصطناعي الشهرية', {
        type: 'ai_budget_exceeded',
        scope: 'proposal_engine',
      });
      return { ok: false, stored: 0, rejected: 0 };
    }
    await logTier1('فشل محرك المقترحات في الاتصال بالذكاء الاصطناعي', {
      type: 'proposal_engine_error',
      message: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, stored: 0, rejected: 0 };
  }

  let stored = 0;
  const rejections: string[] = [];
  for (const raw of result.proposals.slice(0, MAX_PROPOSALS_PER_DAY)) {
    try {
      if (!Array.isArray(raw.evidenceRefs) || raw.evidenceRefs.length === 0) {
        throw new InvalidActionError('proposal has no evidenceRefs');
      }
      const action = validateProposedAction({ actionType: raw.actionType, payload: raw.payload });
      let decisionPackage: DecisionPackage | undefined;
      if (action.actionType === 'strategic_decision_package') {
        decisionPackage = validateDecisionPackage(raw.decisionPackage);
      }
      const tier = catalogTier(action.actionType); // enforced in code, not trusted from the AI (Hard rule 3)

      const created = await prisma.proposal.create({
        data: {
          tier,
          status: 'pending',
          titleAr: raw.titleAr,
          bodyAr: raw.bodyAr,
          evidenceJson: JSON.stringify({ evidenceRefs: raw.evidenceRefs, snapshotId: evidence.todaySnapshotId }),
          proposedActionJson: JSON.stringify({ actionType: action.actionType, payload: action.payload, decisionPackage }),
          organizationId: action.payload.organizationId ?? null,
        },
      });
      await exportProposalNote(created.id); // Obsidian brain: note exists the moment the proposal does
      stored++;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      rejections.push(`${raw.actionType ?? '?'}: ${reason}`);
    }
  }

  if (rejections.length > 0) {
    await logTier1(`رُفض ${rejections.length} من المقترحات غير المطابقة لكتالوج الإجراءات المسموح بها`, {
      type: 'proposal_validation_rejected',
      rejections,
    });
  }
  await logTier1(`تم إنشاء ${stored} مقترح${stored === 1 ? '' : 'ات'} جديد${stored === 1 ? '' : 'ة'} للمراجعة`, {
    type: 'proposals_generated',
    stored,
    rejected: rejections.length,
  });
  await exportDailyNote(); // refresh today's Obsidian note with the new proposal links
  return { ok: true, stored, rejected: rejections.length };
}
