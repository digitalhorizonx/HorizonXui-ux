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
  aiBudget?: { spentUsd: number; budgetUsd: number; exceeded: boolean };
};

export type ClientListItem = {
  organizationId: string;
  name: string;
  plan: string;
  lastSyncedAt: string;
  churnRisk: 'low' | 'medium' | 'high';
};

export type DecisionPackage = {
  questionAr: string;
  optionsAr: string[];
  risksAr: string[];
  recommendationAr: string;
};

export type ProposedAction = {
  actionType: string;
  payload: Record<string, string>;
  decisionPackage?: DecisionPackage;
};

export type ExecutionAttempt = {
  attemptNumber: number;
  firedAt: string;
  succeeded: boolean;
  responseStatus: number | null;
  responseBody: string | null;
};

export type Proposal = {
  id: string;
  createdAt: string;
  tier: 1 | 2 | 3;
  status: 'pending' | 'approved' | 'rejected' | 'executed' | 'failed' | 'expired';
  titleAr: string;
  bodyAr: string;
  evidence: { evidenceRefs: string[]; snapshotId: number };
  proposedAction: ProposedAction;
  organizationId: string | null;
  approval: { decidedAt: string; decision: string } | null;
  lastExecution: ExecutionAttempt | null;
};

export type DailyBrief = {
  date: string | null;
  activeClients: number | null;
  tasksStuck: number | null;
  tasksInProduction: number | null;
  pendingProposals: number;
  summaryAr: string;
};

export type ClientDetail = {
  organizationId: string;
  name: string;
  plan: string;
  lastSyncedAt: string;
  profile: {
    preferencesMd: string;
    revisionPatternsMd: string;
    churnRisk: 'low' | 'medium' | 'high';
    churnRiskReasonAr: string;
    updatedAt: string | null;
  };
  history: unknown;
  updates: {
    id: number;
    createdAt: string;
    source: 'ai' | 'abdulla';
    diff: Record<string, { before: string; after: string }>;
  }[];
};

export type LogEntry = {
  id: number;
  timestamp: string;
  tier: number;
  actor: string;
  summaryAr: string;
};
