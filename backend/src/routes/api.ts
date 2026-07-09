import { Router } from 'express';
import { prisma } from '../db';
import { requireAuth } from '../middleware/requireAuth';
import { runOverviewSync, getSyncStatus } from '../services/syncService';

export const apiRouter = Router();
apiRouter.use(requireAuth);

/** Sync health — the frontend renders lastError as a banner (never silent). */
apiRouter.get('/status', async (_req, res) => {
  res.json(await getSyncStatus());
});

/** Yesterday-vs-today key numbers for the dashboard. */
apiRouter.get('/metrics/summary', async (_req, res) => {
  const latest = await prisma.metricsSnapshot.findFirst({ orderBy: { date: 'desc' } });
  let previous = null;
  if (latest) {
    const dayStart = new Date(latest.date);
    dayStart.setHours(0, 0, 0, 0);
    previous = await prisma.metricsSnapshot.findFirst({
      where: { date: { lt: dayStart } },
      orderBy: { date: 'desc' },
    });
  }
  const shape = (s: typeof latest) =>
    s && {
      date: s.date,
      activeClients: s.activeClients,
      tasksStuck: s.tasksStuck,
      creditsDeducted: s.creditsDeducted,
    };
  res.json({ today: shape(latest), yesterday: shape(previous) });
});

/** Manual sync trigger (Tier 1, informational — logged like every sync). */
apiRouter.post('/sync/run', async (_req, res) => {
  const result = await runOverviewSync();
  res.status(result.ok ? 200 : 502).json(result);
});

/** Recent decision log entries for the dashboard. */
apiRouter.get('/logs/recent', async (_req, res) => {
  const entries = await prisma.decisionLog.findMany({ orderBy: { timestamp: 'desc' }, take: 20 });
  res.json(entries);
});
