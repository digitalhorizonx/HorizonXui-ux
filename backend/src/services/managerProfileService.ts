import { prisma } from '../db';
import { callClaudeJson, AiBudgetExceededError } from './aiClient';
import { exportManagerProfile } from './exportService';

/**
 * Decision-maker profile — "learns Abdulla's way of managing the business"
 * (requested 2026-07-19, out-of-spec addition). Same shape as ClientProfile:
 * a living Arabic description, updated from evidence only, with Abdulla's
 * own edits always winning over an AI update (optimistic concurrency).
 * Fed into the proposal engine's evidence so future proposals account for
 * his known decision patterns.
 */

const SCHEMA = {
  type: 'object',
  properties: {
    changed: { type: 'boolean', description: 'false if there is no new decision evidence since last time' },
    patternsMd: { type: 'string', description: 'Arabic Markdown description of decision-making patterns' },
  },
  required: ['changed', 'patternsMd'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You maintain a description of how Abdulla (the CEO) makes decisions in this operations system.
You will be given his recent approve/reject decisions on proposals, each with the proposal's tier, action type, title, and any note he left.
Update the Arabic Markdown description of his decision-making patterns based ONLY on this evidence — patterns like which action types or topics he tends to approve or reject, and why (from his notes), and whether that varies by tier.
If there is no new evidence, or the existing description already covers it, return changed=false and echo the current text unchanged.
Never speculate beyond what the evidence shows. All text is Arabic.`;

async function getOrCreateManagerProfile() {
  const existing = await prisma.managerProfile.findFirst();
  if (existing) return existing;
  return prisma.managerProfile.create({ data: {} });
}

export async function getManagerProfile() {
  return getOrCreateManagerProfile();
}

/** AI update from recent decision history. Abdulla's manual edits always win. */
export async function updateManagerProfileWithAi(): Promise<{ ok: boolean; changed: boolean; summary: string }> {
  const profile = await getOrCreateManagerProfile();
  const recentApprovals = await prisma.approval.findMany({
    orderBy: { decidedAt: 'desc' },
    take: 30,
    include: { proposal: true },
  });
  if (recentApprovals.length === 0) {
    return { ok: true, changed: false, summary: 'no decision history yet' };
  }

  const evidence = recentApprovals.map((a) => ({
    tier: a.proposal.tier,
    actionType: (JSON.parse(a.proposal.proposedActionJson) as { actionType: string }).actionType,
    titleAr: a.proposal.titleAr,
    decision: a.decision,
    noteAr: a.noteAr,
    decidedAt: a.decidedAt,
  }));

  let result: { changed: boolean; patternsMd: string };
  try {
    result = await callClaudeJson<{ changed: boolean; patternsMd: string }>({
      purpose: 'manager_profile_update',
      system: SYSTEM_PROMPT,
      userContent: JSON.stringify({ currentPatternsMd: profile.patternsMd, recentDecisions: evidence }),
      schema: SCHEMA,
      maxTokens: 2048,
    });
  } catch (err) {
    if (err instanceof AiBudgetExceededError) {
      await prisma.decisionLog.create({
        data: {
          tier: 1,
          actor: 'system',
          summaryAr: 'توقف تحديث نمط إدارة عبدالله: تم تجاوز ميزانية الذكاء الاصطناعي الشهرية',
          refs: JSON.stringify({ type: 'ai_budget_exceeded', scope: 'manager_profile' }),
        },
      });
      return { ok: false, changed: false, summary: 'AI budget exceeded' };
    }
    throw err;
  }

  if (!result.changed || result.patternsMd === profile.patternsMd) {
    return { ok: true, changed: false, summary: 'no new pattern' };
  }

  // Abdulla's edits win: discard if the profile changed while Claude was thinking.
  const fresh = await prisma.managerProfile.findUnique({ where: { id: profile.id } });
  if (!fresh || fresh.updatedAt.getTime() !== profile.updatedAt.getTime()) {
    await prisma.decisionLog.create({
      data: {
        tier: 1,
        actor: 'system',
        summaryAr: 'تم تجاهل تحديث نمط الإدارة لأن عبدالله عدّله أثناء المعالجة',
        refs: JSON.stringify({ type: 'manager_profile_conflict' }),
      },
    });
    return { ok: true, changed: false, summary: 'skipped — manual edit won' };
  }

  await prisma.managerProfile.update({ where: { id: profile.id }, data: { patternsMd: result.patternsMd } });
  await prisma.decisionLog.create({
    data: {
      tier: 1,
      actor: 'system',
      summaryAr: 'تم تحديث نمط إدارة عبدالله بناءً على قراراته الأخيرة',
      refs: JSON.stringify({ type: 'manager_profile_updated' }),
    },
  });
  await exportManagerProfile();
  return { ok: true, changed: true, summary: 'updated' };
}

/** Abdulla's manual edit — always applied, always wins over AI. */
export async function applyManualManagerProfileEdit(patternsMd: string) {
  const profile = await getOrCreateManagerProfile();
  const updated = await prisma.managerProfile.update({ where: { id: profile.id }, data: { patternsMd } });
  await prisma.decisionLog.create({
    data: {
      tier: 1,
      actor: 'abdulla',
      summaryAr: 'عدّل عبدالله وصف نمط إدارته يدوياً',
      refs: JSON.stringify({ type: 'manager_profile_manual_edit' }),
    },
  });
  await exportManagerProfile();
  return updated;
}
