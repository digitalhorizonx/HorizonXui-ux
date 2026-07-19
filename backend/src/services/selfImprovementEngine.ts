import { prisma } from '../db';
import { callClaudeJson, AiBudgetExceededError } from './aiClient';
import { validateDecisionPackage, catalogTier, InvalidActionError } from './actionCatalog';
import { getManagerProfile } from './managerProfileService';
import { exportProposalNote, exportDailyNote } from './exportService';

/**
 * Self-improvement engine (requested 2026-07-19, out-of-spec addition):
 * the system suggests changes to ITSELF — not business actions. Every
 * suggestion is stored as an ordinary Tier-3 strategic_decision_package
 * proposal, so it goes through the exact same Approval Inbox and Obsidian
 * export as everything else. Nothing here writes or deploys code — per
 * Abdulla's explicit choice, these are write-ups for a human (him, in a
 * Claude Code session) to review and decide whether to build.
 */

const MAX_SUGGESTIONS = 2;
const STALE_PENDING_DAYS = 3;

const SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      maxItems: MAX_SUGGESTIONS,
      items: {
        type: 'object',
        properties: {
          titleAr: { type: 'string' },
          bodyAr: { type: 'string' },
          evidenceRefs: { type: 'array', items: { type: 'string' } },
          decisionPackage: {
            type: 'object',
            properties: {
              questionAr: { type: 'string' },
              optionsAr: { type: 'array', items: { type: 'string' } },
              risksAr: { type: 'array', items: { type: 'string' } },
              recommendationAr: { type: 'string' },
            },
            required: ['questionAr', 'optionsAr', 'risksAr', 'recommendationAr'],
            additionalProperties: false,
          },
        },
        required: ['titleAr', 'bodyAr', 'evidenceRefs', 'decisionPackage'],
        additionalProperties: false,
      },
    },
  },
  required: ['suggestions'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You advise on improving the HorizonX Agentic OS itself — the operations system this evidence comes from — not on business actions for clients.
You will be given: rejection rates per action type, recent failures (sync/execution/validation), stale pending proposals, and Abdulla's known decision patterns.
Suggest at most ${MAX_SUGGESTIONS} concrete improvements to the system (e.g. a new action type, a workflow change, a recurring pain point worth fixing) — only where the evidence actually shows a pattern, never speculative.
Every suggestion becomes a strategic decision package for Abdulla to review — you are NOT proposing to build or deploy anything yourself, only to recommend it for his review.
Return fewer than ${MAX_SUGGESTIONS} (or zero) if the evidence doesn't support that many. All text is Arabic.`;

type RawSuggestion = {
  titleAr: string;
  bodyAr: string;
  evidenceRefs: string[];
  decisionPackage: unknown;
};

async function logTier1(summaryAr: string, refs: Record<string, unknown>): Promise<void> {
  await prisma.decisionLog.create({ data: { tier: 1, actor: 'system', summaryAr, refs: JSON.stringify(refs) } });
}

async function gatherEvidence() {
  const since = new Date();
  since.setDate(since.getDate() - 30);

  const decided = await prisma.approval.findMany({
    where: { decidedAt: { gte: since } },
    include: { proposal: true },
  });
  const byActionType = new Map<string, { total: number; rejected: number }>();
  for (const a of decided) {
    const actionType = (JSON.parse(a.proposal.proposedActionJson) as { actionType: string }).actionType;
    const entry = byActionType.get(actionType) ?? { total: 0, rejected: 0 };
    entry.total++;
    if (a.decision === 'rejected') entry.rejected++;
    byActionType.set(actionType, entry);
  }
  const rejectionRates = Array.from(byActionType.entries()).map(([actionType, { total, rejected }]) => ({
    actionType,
    total,
    rejected,
    rejectionRate: total > 0 ? Math.round((rejected / total) * 100) / 100 : 0,
  }));

  const failureLogs = await prisma.decisionLog.findMany({
    where: {
      timestamp: { gte: since },
      OR: [
        { refs: { contains: '"sync_error"' } },
        { refs: { contains: '"proposal_execution_failed"' } },
        { refs: { contains: '"proposal_validation_rejected"' } },
        { refs: { contains: '"ai_budget_exceeded"' } },
      ],
    },
    orderBy: { timestamp: 'desc' },
    take: 20,
  });

  const staleCutoff = new Date();
  staleCutoff.setDate(staleCutoff.getDate() - STALE_PENDING_DAYS);
  const stalePendingCount = await prisma.proposal.count({
    where: { status: 'pending', createdAt: { lt: staleCutoff } },
  });

  const managerProfile = await getManagerProfile();

  return {
    rejectionRatesByActionType: rejectionRates,
    recentFailures: failureLogs.map((l) => ({ at: l.timestamp, summaryAr: l.summaryAr })),
    stalePendingProposals: stalePendingCount,
    managerPatterns: managerProfile.patternsMd,
  };
}

/** Runs the self-reflection analysis, validates, stores as Tier-3 proposals. */
export async function runSelfImprovementEngine(): Promise<{ ok: boolean; stored: number; rejected: number }> {
  const evidence = await gatherEvidence();

  let result: { suggestions: RawSuggestion[] };
  try {
    result = await callClaudeJson<{ suggestions: RawSuggestion[] }>({
      purpose: 'self_improvement_engine',
      system: SYSTEM_PROMPT,
      userContent: JSON.stringify(evidence),
      schema: SCHEMA,
      maxTokens: 3072,
    });
  } catch (err) {
    if (err instanceof AiBudgetExceededError) {
      await logTier1('توقف تحليل تحسين النظام: تم تجاوز ميزانية الذكاء الاصطناعي الشهرية', {
        type: 'ai_budget_exceeded',
        scope: 'self_improvement_engine',
      });
      return { ok: false, stored: 0, rejected: 0 };
    }
    await logTier1('فشل تحليل تحسين النظام في الاتصال بالذكاء الاصطناعي', {
      type: 'self_improvement_engine_error',
      message: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, stored: 0, rejected: 0 };
  }

  let stored = 0;
  const rejections: string[] = [];
  for (const raw of result.suggestions.slice(0, MAX_SUGGESTIONS)) {
    try {
      if (!Array.isArray(raw.evidenceRefs) || raw.evidenceRefs.length === 0) {
        throw new InvalidActionError('suggestion has no evidenceRefs');
      }
      const decisionPackage = validateDecisionPackage(raw.decisionPackage);

      const created = await prisma.proposal.create({
        data: {
          tier: catalogTier('strategic_decision_package'),
          status: 'pending',
          titleAr: raw.titleAr,
          bodyAr: raw.bodyAr,
          evidenceJson: JSON.stringify({ evidenceRefs: raw.evidenceRefs, source: 'self_improvement' }),
          proposedActionJson: JSON.stringify({
            actionType: 'strategic_decision_package',
            payload: {},
            decisionPackage,
          }),
          organizationId: null,
        },
      });
      await exportProposalNote(created.id);
      stored++;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      rejections.push(reason);
    }
  }

  if (rejections.length > 0) {
    await logTier1(`رُفض ${rejections.length} من اقتراحات تحسين النظام غير الصالحة`, {
      type: 'self_improvement_validation_rejected',
      rejections,
    });
  }
  await logTier1(
    stored > 0
      ? `اقترح النظام ${stored} تحسين${stored === 1 ? 'اً' : 'ات'} على نفسه للمراجعة`
      : 'لم يقترح تحليل تحسين النظام أي تغييرات هذه المرة',
    { type: 'self_improvement_generated', stored, rejected: rejections.length }
  );
  await exportDailyNote();
  return { ok: true, stored, rejected: rejections.length };
}
