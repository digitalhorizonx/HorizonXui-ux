import { useEffect, useState } from 'react';
import { api, type ClientListItem } from './api';

const RISK_LOW = { text: 'منخفض', cls: 'bg-emerald-100 text-emerald-800' };
const RISK_LABEL: Record<string, { text: string; cls: string }> = {
  low: RISK_LOW,
  medium: { text: 'متوسط', cls: 'bg-amber-100 text-amber-800' },
  high: { text: 'مرتفع', cls: 'bg-red-100 text-red-800' },
};

export default function ClientsPage() {
  const [clients, setClients] = useState<ClientListItem[] | null>(null);

  useEffect(() => {
    api<ClientListItem[]>('/api/clients').then(setClients).catch(() => setClients([]));
  }, []);

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-6 py-8">
      <h2 className="text-lg font-bold text-slate-900">العملاء</h2>
      {clients === null ? (
        <p className="text-slate-500">جارٍ التحميل…</p>
      ) : clients.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white p-4 text-slate-500">
          لا يوجد عملاء في الذاكرة المؤقتة بعد — تتطلب هذه الصفحة أن توفر المنصة قائمة العملاء عبر
          واجهة التقارير.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {clients.map((c) => {
            const risk = RISK_LABEL[c.churnRisk] ?? RISK_LOW;
            return (
              <a
                key={c.organizationId}
                href={`#/clients/${encodeURIComponent(c.organizationId)}`}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-blue-300"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-900">{c.name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${risk.cls}`}>
                    خطر الفقدان: {risk.text}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-500">الخطة: {c.plan}</p>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
