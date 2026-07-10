import { Router } from 'express';
import { prisma } from '../db';
import { applyManualProfileEdit, updateClientProfileWithAi } from '../services/profileService';
import { exportClientProfile } from '../services/exportService';
import { AiBudgetExceededError } from '../services/aiClient';

export const clientsRouter = Router();

/** Client list: cache + profile summary. */
clientsRouter.get('/', async (_req, res) => {
  const clients = await prisma.clientCache.findMany({ orderBy: { name: 'asc' } });
  const profiles = await prisma.clientProfile.findMany();
  const byOrg = new Map(profiles.map((p) => [p.organizationId, p]));
  res.json(
    clients.map((c) => ({
      organizationId: c.organizationId,
      name: c.name,
      plan: c.plan,
      lastSyncedAt: c.lastSyncedAt,
      churnRisk: byOrg.get(c.organizationId)?.churnRisk ?? 'low',
    }))
  );
});

/** Client detail: profile, history from cache, recent diffs. */
clientsRouter.get('/:orgId', async (req, res) => {
  const organizationId = req.params.orgId;
  const client = await prisma.clientCache.findUnique({ where: { organizationId } });
  if (!client) {
    res.status(404).json({ error: 'not_found', messageAr: 'العميل غير موجود' });
    return;
  }
  const profile = await prisma.clientProfile.findUnique({ where: { organizationId } });
  const updates = await prisma.profileUpdate.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  let history: unknown = null;
  try {
    history = JSON.parse(client.rawSnapshot);
  } catch {
    // tolerate a corrupt snapshot; the profile view still works
  }
  res.json({
    organizationId,
    name: client.name,
    plan: client.plan,
    lastSyncedAt: client.lastSyncedAt,
    profile: {
      preferencesMd: profile?.preferencesMd ?? '',
      revisionPatternsMd: profile?.revisionPatternsMd ?? '',
      churnRisk: profile?.churnRisk ?? 'low',
      churnRiskReasonAr: profile?.churnRiskReasonAr ?? '',
      updatedAt: profile?.updatedAt ?? null,
    },
    history,
    updates: updates.map((u) => ({
      id: u.id,
      createdAt: u.createdAt,
      source: u.source,
      diff: JSON.parse(u.diffJson) as unknown,
    })),
  });
});

/** Abdulla's manual profile edit — always wins over AI edits. */
clientsRouter.put('/:orgId/profile', async (req, res) => {
  try {
    const updated = await applyManualProfileEdit(req.params.orgId, {
      preferencesMd: typeof req.body?.preferencesMd === 'string' ? req.body.preferencesMd : undefined,
      revisionPatternsMd:
        typeof req.body?.revisionPatternsMd === 'string' ? req.body.revisionPatternsMd : undefined,
      churnRisk: typeof req.body?.churnRisk === 'string' ? req.body.churnRisk : undefined,
      churnRiskReasonAr:
        typeof req.body?.churnRiskReasonAr === 'string' ? req.body.churnRiskReasonAr : undefined,
    });
    res.json({ ok: true, updatedAt: updated.updatedAt });
  } catch (err) {
    res.status(400).json({ error: 'invalid_edit', messageAr: 'تعذر حفظ التعديل', detail: String(err) });
  }
});

/** Manual AI refresh of one profile (Tier 1, budget-guarded). */
clientsRouter.post('/:orgId/profile/ai-refresh', async (req, res) => {
  try {
    const result = await updateClientProfileWithAi(req.params.orgId);
    res.json(result);
  } catch (err) {
    if (err instanceof AiBudgetExceededError) {
      res.status(429).json({
        error: 'ai_budget_exceeded',
        messageAr: 'تم تجاوز ميزانية الذكاء الاصطناعي الشهرية — توقفت الاستدعاءات',
      });
      return;
    }
    res.status(502).json({ error: 'ai_failed', messageAr: 'فشل تحديث الملف', detail: String(err) });
  }
});

/** Export one client profile to exports/clients/<name>.md. */
clientsRouter.post('/:orgId/export', async (req, res) => {
  try {
    const result = await exportClientProfile(req.params.orgId);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: 'export_failed', messageAr: 'فشل التصدير', detail: String(err) });
  }
});
