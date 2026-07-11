import { useEffect, useState } from 'react';
import { api, type DailyBrief } from './api';

export default function DailyBriefPage() {
  const [brief, setBrief] = useState<DailyBrief | null>(null);

  useEffect(() => {
    api<DailyBrief>('/api/daily-brief').then(setBrief).catch(() => setBrief(null));
  }, []);

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-6 py-8">
      <h2 className="text-lg font-bold text-slate-900">الملخص الصباحي</h2>
      {brief === null ? (
        <p className="text-slate-500">جارٍ التحميل…</p>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="mb-4 text-lg text-slate-800">{brief.summaryAr}</p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs text-slate-500">العملاء النشطون</p>
              <p className="text-2xl font-bold text-slate-900">{brief.activeClients ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">المهام المتعثرة</p>
              <p className="text-2xl font-bold text-slate-900">{brief.tasksStuck ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">قيد الإنتاج</p>
              <p className="text-2xl font-bold text-slate-900">{brief.tasksInProduction ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">مقترحات معلقة</p>
              <p className="text-2xl font-bold text-slate-900">{brief.pendingProposals}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
