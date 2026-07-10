import { prisma } from '../db';
import { callClaudeJson, AiBudgetExceededError } from './aiClient';

/**
 * Client intelligence profiles (Phase 2 — "the memory").
 * Nightly per-client AI updates; Abdulla's manual edits always win
 * (optimistic concurrency: an AI result is discarded if the profile changed
 * while Claude was thinking). Every change is stored as a diff.
 */

const CHURN_LEVELS = ['low', 'medium', 'high'] as const;
type ChurnRisk = (typeof CHURN_LEVELS)[number];

type AiProfileResult = {
  changed: boolean;
  preferencesMd: string;
  revisionPatternsMd: string;
  churnRisk: ChurnRisk;
  churnRiskReasonAr: string;
};

const PROFILE_SCHEMA = {
  type: 'object',
  properties: {
    changed: {
      type: 'boolean',
      description: 'false if the evidence contains nothing new and the profile is unchanged',
    },
    preferencesMd: { type: 'string', description: 'Client preferences, Markdown, Arabic' },
    revisionPatternsMd: { type: 'string', description: 'Revision patterns, Markdown, Arabic' },
    churnRisk: { type: 'string', enum: [...CHURN_LEVELS] },
    churnRiskReasonAr: { type: 'string', description: 'One-sentence reason in Arabic' },
  },
  required: ['changed', 'preferencesMd', 'revisionPatternsMd', 'churnRisk', 'churnRiskReasonAr'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You maintain a client intelligence profile for a content-marketing agency.
Update the preferences and revision-patterns sections in Arabic based ONLY on the evidence provided — never invent information that is not in the evidence.
If there is no new evidence, return the profile unchanged with changed=false.
Assess churn risk (low/medium/high) from the evidence and give a one-sentence reason in Arabic.
All profile text must be Arabic Markdown.`;

type Diff = Record<string, { before: string; after: string }>;

function computeDiff(
  before: { preferencesMd: string; revisionPatternsMd: string; churnRisk: string; churnRiskReasonAr: string },
  after: AiProfileResult
): Diff {
  const diff: Diff = {};
  for (const field of ['preferencesMd', 'revisionPatternsMd', 'churnRisk', 'churnRiskReasonAr'] as const) {
    if (before[field] !== after[field]) {
      diff[field] = { before: before[field], after: after[field] };
    }
  }
  return diff;
}

async function getOrCreateProfile(organizationId: string) {
  return prisma.clientProfile.upsert({
    where: { organizationId },
    create: { organizationId },
    update: {},
  });
}

/** One AI-driven profile update for a single client. */
export async function updateClientProfileWithAi(
  organizationId: string
): Promise<{ ok: boolean; changed: boolean; summary: string }> {
  const client = await prisma.clientCache.findUnique({ where: { organizationId } });
  if (!client) {
    return { ok: false, changed: false, summary: 'client not found in cache' };
  }
  const profile = await getOrCreateProfile(organizationId);

  const result = await callClaudeJson<AiProfileResult>({
    purpose: `profile_update:${organizationId}`,
    system: SYSTEM_PROMPT,
    userContent: JSON.stringify({
      currentProfile: {
        preferencesMd: profile.preferencesMd,
        revisionPatternsMd: profile.revisionPatternsMd,
        churnRisk: profile.churnRisk,
        churnRiskReasonAr: profile.churnRiskReasonAr,
      },
      evidence: JSON.parse(client.rawSnapshot),
    }),
    schema: PROFILE_SCHEMA,
  });

  if (!CHURN_LEVELS.includes(result.churnRisk)) {
    throw new Error(`AI returned invalid churnRisk: ${String(result.churnRisk)}`);
  }
  const diff = computeDiff(profile, result);
  if (!result.changed || Object.keys(diff).length === 0) {
    return { ok: true, changed: false, summary: 'no new evidence' };
  }

  // Abdulla's edits win: discard the AI result if the profile changed while
  // Claude was thinking (his manual save bumped updatedAt).
  const fresh = await prisma.clientProfile.findUnique({ where: { organizationId } });
  if (!fresh || fresh.updatedAt.getTime() !== profile.updatedAt.getTime()) {
    await prisma.decisionLog.create({
      data: {
        tier: 1,
        actor: 'system',
        summaryAr: `تم تجاهل تحديث الذكاء الاصطناعي لملف العميل ${client.name} لأن عبدالله عدّله أثناء المعالجة`,
        refs: JSON.stringify({ type: 'profile_update_conflict', organizationId }),
      },
    });
    return { ok: true, changed: false, summary: 'skipped — manual edit won' };
  }

  await prisma.clientProfile.update({
    where: { organizationId },
    data: {
      preferencesMd: result.preferencesMd,
      revisionPatternsMd: result.revisionPatternsMd,
      churnRisk: result.churnRisk,
      churnRiskReasonAr: result.churnRiskReasonAr,
    },
  });
  await prisma.profileUpdate.create({
    data: { organizationId, source: 'ai', diffJson: JSON.stringify(diff) },
  });
  await prisma.decisionLog.create({
    data: {
      tier: 1,
      actor: 'system',
      summaryAr: `تم تحديث ملف العميل ${client.name} بواسطة الذكاء الاصطناعي (${Object.keys(diff).length} حقول)`,
      refs: JSON.stringify({ type: 'profile_update', organizationId, fields: Object.keys(diff) }),
    },
  });
  return { ok: true, changed: true, summary: `updated ${Object.keys(diff).length} fields` };
}

/** Abdulla's manual edit — always applied, always diffed and logged. */
export async function applyManualProfileEdit(
  organizationId: string,
  edit: Partial<Pick<AiProfileResult, 'preferencesMd' | 'revisionPatternsMd' | 'churnRisk' | 'churnRiskReasonAr'>>
) {
  if (edit.churnRisk !== undefined && !CHURN_LEVELS.includes(edit.churnRisk)) {
    throw new Error(`invalid churnRisk: ${String(edit.churnRisk)}`);
  }
  const profile = await getOrCreateProfile(organizationId);
  const merged: AiProfileResult = {
    changed: true,
    preferencesMd: edit.preferencesMd ?? profile.preferencesMd,
    revisionPatternsMd: edit.revisionPatternsMd ?? profile.revisionPatternsMd,
    churnRisk: (edit.churnRisk ?? profile.churnRisk) as ChurnRisk,
    churnRiskReasonAr: edit.churnRiskReasonAr ?? profile.churnRiskReasonAr,
  };
  const diff = computeDiff(profile, merged);
  if (Object.keys(diff).length === 0) {
    return profile;
  }
  const updated = await prisma.clientProfile.update({
    where: { organizationId },
    data: {
      preferencesMd: merged.preferencesMd,
      revisionPatternsMd: merged.revisionPatternsMd,
      churnRisk: merged.churnRisk,
      churnRiskReasonAr: merged.churnRiskReasonAr,
    },
  });
  await prisma.profileUpdate.create({
    data: { organizationId, source: 'abdulla', diffJson: JSON.stringify(diff) },
  });
  await prisma.decisionLog.create({
    data: {
      tier: 1,
      actor: 'abdulla',
      summaryAr: `عدّل عبدالله ملف العميل ${organizationId} يدوياً`,
      refs: JSON.stringify({ type: 'profile_manual_edit', organizationId, fields: Object.keys(diff) }),
    },
  });
  return updated;
}

/** Nightly job: AI profile update for every cached client. Budget-aware. */
export async function runNightlyProfileUpdates(): Promise<void> {
  const clients = await prisma.clientCache.findMany();
  let updated = 0;
  const failures: string[] = [];
  for (const client of clients) {
    try {
      const r = await updateClientProfileWithAi(client.organizationId);
      if (r.changed) updated++;
    } catch (err) {
      if (err instanceof AiBudgetExceededError) {
        // Never silent (Hard rule 5): log and stop making AI calls.
        await prisma.decisionLog.create({
          data: {
            tier: 1,
            actor: 'system',
            summaryAr: 'توقفت تحديثات ملفات العملاء: تم تجاوز ميزانية الذكاء الاصطناعي الشهرية',
            refs: JSON.stringify({ type: 'ai_budget_exceeded', scope: 'profile_updates' }),
          },
        });
        return;
      }
      failures.push(`${client.organizationId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (failures.length > 0) {
    await prisma.decisionLog.create({
      data: {
        tier: 1,
        actor: 'system',
        summaryAr: `فشل تحديث ملفات ${failures.length} من العملاء`,
        refs: JSON.stringify({ type: 'profile_update_errors', failures }),
      },
    });
  }
  console.log(`Nightly profile updates: ${updated} updated, ${failures.length} failed, ${clients.length} total`);
}
