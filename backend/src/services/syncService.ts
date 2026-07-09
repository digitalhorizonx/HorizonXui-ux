import { prisma } from '../db';
import { reportsApi } from './reportsClient';

/**
 * Data ingestion (Phase 1 — "the eyes"). Failures are never silent: every
 * failure writes a Tier-1 decision_log entry, and /api/status surfaces it as a
 * banner in the UI.
 */

type SyncResult = { ok: boolean; summary: string; snapshotId?: number; error?: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Defensively pick the first numeric value found under any of the given keys,
 *  looking at the top level and one level down (stats/metrics/overview/data). */
function pickNumber(raw: unknown, keys: string[]): number | null {
  if (!isRecord(raw)) return null;
  const scopes: Record<string, unknown>[] = [raw];
  for (const nested of ['stats', 'metrics', 'overview', 'data', 'summary']) {
    const v = raw[nested];
    if (isRecord(v)) scopes.push(v);
  }
  for (const scope of scopes) {
    for (const key of keys) {
      const v = scope[key];
      if (typeof v === 'number' && Number.isFinite(v)) return v;
    }
  }
  return null;
}

type ClientRow = { organizationId: string; name: string; plan: string; raw: unknown };

/** Defensively extract the client/organization list from the overview payload. */
function extractClients(raw: unknown): ClientRow[] {
  if (!isRecord(raw)) return [];
  const candidates = [raw['clients'], raw['organizations'], isRecord(raw['data']) ? (raw['data'] as Record<string, unknown>)['clients'] : undefined];
  const list = candidates.find(Array.isArray) as unknown[] | undefined;
  if (!list) return [];
  const rows: ClientRow[] = [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    const organizationId = String(item['organizationId'] ?? item['organization_id'] ?? item['id'] ?? '');
    if (!organizationId) continue;
    rows.push({
      organizationId,
      name: String(item['name'] ?? item['organizationName'] ?? organizationId),
      plan: String(item['plan'] ?? item['planName'] ?? 'unknown'),
      raw: item,
    });
  }
  return rows;
}

async function logTier1(summaryAr: string, refs: Record<string, unknown>): Promise<void> {
  await prisma.decisionLog.create({
    data: { tier: 1, actor: 'system', summaryAr, refs: JSON.stringify(refs) },
  });
}

/** Daily overview sync: GET /api/reports/overview → metrics_snapshots + clients_cache. */
export async function runOverviewSync(): Promise<SyncResult> {
  try {
    const raw = await reportsApi.overview();
    const activeClients = pickNumber(raw, ['activeClients', 'active_clients', 'clientsActive']);
    const tasksStuck = pickNumber(raw, ['tasksStuck', 'tasks_stuck', 'stuckTasks']);
    const creditsDeducted = pickNumber(raw, ['creditsDeducted', 'credits_deducted', 'creditsUsed']);

    const snapshot = await prisma.metricsSnapshot.create({
      data: {
        date: new Date(),
        rawOverview: JSON.stringify(raw),
        activeClients,
        tasksStuck,
        creditsDeducted,
        parsedNumbers: JSON.stringify({ activeClients, tasksStuck, creditsDeducted }),
      },
    });

    const clients = extractClients(raw);
    for (const c of clients) {
      await prisma.clientCache.upsert({
        where: { organizationId: c.organizationId },
        create: {
          organizationId: c.organizationId,
          name: c.name,
          plan: c.plan,
          lastSyncedAt: new Date(),
          rawSnapshot: JSON.stringify(c.raw),
        },
        update: { name: c.name, plan: c.plan, lastSyncedAt: new Date(), rawSnapshot: JSON.stringify(c.raw) },
      });
    }

    const summaryAr = `تمت مزامنة النظرة العامة بنجاح (${clients.length} عميل)`;
    await logTier1(summaryAr, { type: 'overview_sync', snapshotId: snapshot.id, clients: clients.length });
    return { ok: true, summary: summaryAr, snapshotId: snapshot.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logTier1('فشلت مزامنة النظرة العامة من منصة HorizonX', {
      type: 'sync_error',
      scope: 'overview',
      message,
    });
    return { ok: false, summary: 'فشلت المزامنة', error: message };
  }
}

/** Nightly per-client context sync: refreshes each cached client's raw snapshot. */
export async function runClientContextSync(): Promise<SyncResult> {
  const clients = await prisma.clientCache.findMany();
  let okCount = 0;
  const failures: string[] = [];
  for (const client of clients) {
    try {
      const raw = await reportsApi.clientContext(client.organizationId);
      await prisma.clientCache.update({
        where: { organizationId: client.organizationId },
        data: { lastSyncedAt: new Date(), rawSnapshot: JSON.stringify(raw) },
      });
      okCount++;
    } catch (err) {
      failures.push(`${client.organizationId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (failures.length > 0) {
    await logTier1(`فشلت مزامنة سياق ${failures.length} من العملاء`, {
      type: 'sync_error',
      scope: 'client_context',
      failures,
    });
    return { ok: false, summary: `فشل جزئي (${okCount}/${clients.length})`, error: failures.join('; ') };
  }
  const summaryAr = `تمت مزامنة سياق العملاء (${okCount} عميل)`;
  await logTier1(summaryAr, { type: 'client_context_sync', clients: okCount });
  return { ok: true, summary: summaryAr };
}

/** Sync health for the UI banner: latest snapshot vs latest sync error. */
export async function getSyncStatus() {
  const lastSnapshot = await prisma.metricsSnapshot.findFirst({ orderBy: { date: 'desc' } });
  const lastErrorEntry = await prisma.decisionLog.findFirst({
    where: { refs: { contains: '"sync_error"' } },
    orderBy: { timestamp: 'desc' },
  });
  const lastError =
    lastErrorEntry && (!lastSnapshot || lastErrorEntry.timestamp > lastSnapshot.date)
      ? { at: lastErrorEntry.timestamp, summaryAr: lastErrorEntry.summaryAr }
      : null;
  return {
    lastSnapshotAt: lastSnapshot?.date ?? null,
    lastError,
  };
}
