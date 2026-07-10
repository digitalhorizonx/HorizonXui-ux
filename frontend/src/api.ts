export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly messageAr: string
  ) {
    super(messageAr);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(res.status, typeof body.messageAr === 'string' ? body.messageAr : 'حدث خطأ غير متوقع');
  }
  return body as T;
}

export type SnapshotNumbers = {
  date: string;
  activeClients: number | null;
  tasksStuck: number | null;
  creditsDeducted: number | null;
  tasksInProduction?: number | null;
  pendingClientApprovals?: number | null;
  staffTotal?: number | null;
  aiSpendUsd?: number | null;
} | null;

export type MetricsSummary = { today: SnapshotNumbers; yesterday: SnapshotNumbers };

export type SyncStatus = {
  lastSnapshotAt: string | null;
  lastError: { at: string; summaryAr: string } | null;
};

export type LogEntry = {
  id: number;
  timestamp: string;
  tier: number;
  actor: string;
  summaryAr: string;
};
