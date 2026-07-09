import { useCallback, useEffect, useState } from 'react';
import { api, type LogEntry, type MetricsSummary, type SyncStatus } from './api';

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ar-JO', { dateStyle: 'medium', timeStyle: 'short' });
}

function MetricCard({
  title,
  today,
  yesterday,
}: {
  title: string;
  today: number | null | undefined;
  yesterday: number | null | undefined;
}) {
  const delta = today != null && yesterday != null ? today - yesterday : null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="mb-1 text-sm text-slate-500">{title}</p>
      <p className="text-3xl font-bold text-slate-900">{today ?? '—'}</p>
      <p className="mt-1 text-sm text-slate-500">
        الأمس: {yesterday ?? '—'}
        {delta != null && delta !== 0 && (
          <span className={delta > 0 ? 'mr-2 text-emerald-600' : 'mr-2 text-red-600'}>
            ({delta > 0 ? `+${delta}` : delta})
          </span>
        )}
      </p>
    </div>
  );
}

export default function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [summary, setSummary] = useState<MetricsSummary | null>(null);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    const [s, st, lg] = await Promise.all([
      api<MetricsSummary>('/api/metrics/summary'),
      api<SyncStatus>('/api/status'),
      api<LogEntry[]>('/api/logs/recent'),
    ]);
    setSummary(s);
    setStatus(st);
    setLogs(lg);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function syncNow() {
    setSyncing(true);
    try {
      await api('/api/sync/run', { method: 'POST' });
    } catch {
      // failure is recorded server-side and surfaces via the status banner
    } finally {
      setSyncing(false);
      await refresh();
    }
  }

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' });
    onLogout();
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <h1 className="text-xl font-bold text-slate-900">نظام هورايزن إكس — لوحة المؤشرات</h1>
          <button onClick={() => void logout()} className="text-sm text-slate-500 hover:text-slate-800">
            تسجيل الخروج
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-4xl space-y-6 px-6 py-8">
        {status?.lastError && (
          <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-red-800">
            <strong>تنبيه:</strong> {status.lastError.summaryAr}
            <span className="mr-2 text-sm text-red-600">({fmtDate(status.lastError.at)})</span>
          </div>
        )}

        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-500">آخر مزامنة ناجحة: {fmtDate(status?.lastSnapshotAt)}</p>
          <button
            onClick={() => void syncNow()}
            disabled={syncing}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {syncing ? 'جارٍ المزامنة…' : 'مزامنة الآن'}
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <MetricCard
            title="العملاء النشطون"
            today={summary?.today?.activeClients}
            yesterday={summary?.yesterday?.activeClients}
          />
          <MetricCard
            title="المهام المتعثرة"
            today={summary?.today?.tasksStuck}
            yesterday={summary?.yesterday?.tasksStuck}
          />
          <MetricCard
            title="الرصيد المخصوم"
            today={summary?.today?.creditsDeducted}
            yesterday={summary?.yesterday?.creditsDeducted}
          />
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-semibold text-slate-900">سجل القرارات الأخير</h2>
          {logs.length === 0 ? (
            <p className="text-sm text-slate-500">لا توجد سجلات بعد — نفّذ أول مزامنة.</p>
          ) : (
            <ul className="space-y-2">
              {logs.map((l) => (
                <li key={l.id} className="flex items-baseline justify-between gap-4 text-sm">
                  <span className="text-slate-800">{l.summaryAr}</span>
                  <span className="shrink-0 text-slate-400">{fmtDate(l.timestamp)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
