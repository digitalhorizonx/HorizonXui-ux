import { Router } from 'express';
import { getManagerProfile, updateManagerProfileWithAi, applyManualManagerProfileEdit } from '../services/managerProfileService';

export const managerProfileRouter = Router();

managerProfileRouter.get('/', async (_req, res) => {
  const profile = await getManagerProfile();
  res.json({ patternsMd: profile.patternsMd, updatedAt: profile.updatedAt });
});

/** Abdulla's manual edit — always wins over the AI's version. */
managerProfileRouter.put('/', async (req, res) => {
  if (typeof req.body?.patternsMd !== 'string') {
    res.status(400).json({ error: 'invalid_edit', messageAr: 'نص غير صالح' });
    return;
  }
  const updated = await applyManualManagerProfileEdit(req.body.patternsMd);
  res.json({ ok: true, updatedAt: updated.updatedAt });
});

/** Manual AI refresh from recent decision history. */
managerProfileRouter.post('/run', async (_req, res) => {
  const result = await updateManagerProfileWithAi();
  res.status(result.ok ? 200 : 502).json(result);
});
