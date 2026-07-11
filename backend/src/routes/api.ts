import { Router } from 'express';
import { prisma } from '../db';
import { requireAuth } from '../middleware/requireAuth';
import { runOverviewSync, getSyncStatus } from '../services/syncService';
import { getAiBudgetStatus } from '../services/aiClient';
import { clientsRouter } from './clients';
import { proposalsRouter } from './proposals';

export const apiRouter = Router();
apiRouter.use(requireAuth);
apiRouter.use('/clients', clientsRouter);
apiRouter.use('/proposals', proposalsRouter);

/** Arabic morning brief: numbers, stuck items, proposal count (Phase 3.4). Templated, no AI cost. */
apiRouter.get('/daily-brief', async (_req, res) => {
  const latest = await prisma.metricsSnapshot.findFirst({ orderBy: { date: 'desc' } });
  const pendingCount = await prisma.proposal.count({ where: { status: 'pending' } });
  const parsed = latest?.parsedNumbers ? (JSON.parse(latest.parsedNumbers) as Record<string, unknown>) : {};
  const activeClients = latest?.activeClients ?? null;
  const tasksStuck = latest?.tasksStuck ?? null;
  const tasksInProduction = typeof parsed.tasksInProduction === 'number' ? parsed.tasksInProduction : null;

  const parts: string[] = [];
  parts.push(activeClients != null ? `${activeClients} عميل نشط` : 'لا توجد بيانات عملاء بعد');
  if (tasksStuck != null) parts.push(tasksStuck > 0 ? `${tasksStuck} مهمة متعثرة` : 'لا توجد مهام متعثرة');
  if (tasksInProduction != null) parts.push(`${tasksInProduction} مهمة قيد الإنتاج`);
  parts.push(pendingCount > 0 ? `${pendingCount} مقترح بانتظار قرارك` : 'لا توجد مقترحات معلقة');

  res.json({
    date: latest?.date ?? null,
    activeClients,
    tasksStuck,
    tasksInProduction,
    pendingProposals: pendingCount,
    summaryAr: `صباح الخير — ${parts.join('، ')}.`,
  });
});

/** Sync + AI-budget health — the frontend renders both as banners (never silent). */
apiRouter.get('/status', async (_req, res) => {
  const [sync, aiBudget] = await Promise.all([getSyncStatus(), getAiBudgetStatus()]);
  res.json({ ...sync, aiBudget });
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
  const shape = (s: typeof latest) => {
    if (!s) return null;
    let extras: Record<string, unknown> = {};
    try {
      extras = s.parsedNumbers ? (JSON.parse(s.parsedNumbers) as Record<string, unknown>) : {};
    } catch {
      // tolerate old/corrupt snapshots — base columns still render
    }
    return {
      ...extras,
      date: s.date,
      activeClients: s.activeClients,
      tasksStuck: s.tasksStuck,
      creditsDeducted: s.creditsDeducted,
    };
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
