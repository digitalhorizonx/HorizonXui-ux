import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type ClientDetail } from './api';

const FIELD_LABEL: Record<string, string> = {
  preferencesMd: 'التفضيلات',
  revisionPatternsMd: 'أنماط التعديلات',
  churnRisk: 'خطر الفقدان',
  churnRiskReasonAr: 'سبب الخطر',
};

export default function ClientDetailPage({ orgId }: { orgId: string }) {
  const [detail, setDetail] = useState<ClientDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [prefs, setPrefs] = useState('');
  const [patterns, setPatterns] = useState('');
  const [risk, setRisk] = useState('low');
  const [riskReason, setRiskReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api<ClientDetail>(`/api/clients/${encodeURIComponent(orgId)}`);
      setDetail(d);
      setPrefs(d.profile.preferencesMd);
      setPatterns(d.profile.revisionPatternsMd);
      setRisk(d.profile.churnRisk);
      setRiskReason(d.profile.churnRiskReasonAr);
    } catch {
      setNotFound(true);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(label: string, fn: () => Promise<string>) {
    setBusy(label);
    setNotice(null);
    try {
      setNotice(await fn());
    } catch (err) {
      setNotice(err instanceof ApiError ? err.messageAr : 'حدث خطأ غير متوقع');
    } finally {
      setBusy(null);
      await load();
    }
  }

  if (notFound) return <p className="p-8 text-slate-500">العميل غير موجود.</p>;
  if (!detail) return <p className="p-8 text-slate-500">جارٍ التحميل…</p>;

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">{detail.name}</h2>
          <p className="text-sm text-slate-500">
            الخطة: {detail.plan} · آخر مزامنة: {new Date(detail.lastSyncedAt).toLocaleString('ar-JO')}
          </p>
        </div>
        <a href="#/clients" className="text-sm text-blue-600 hover:underline">
          ← كل العملاء
        </a>
      </div>

      {notice && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-800">
          {notice}
        </div>
      )}

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="font-semibold text-slate-900">ملف العميل (تعديلاتك لها الأولوية دائماً)</h3>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">التفضيلات</span>
          <textarea
            value={prefs}
            onChange={(e) => setPrefs(e.target.value)}
            rows={5}
            className="w-full rounded-lg border border-slate-300 p-2 font-mono text-sm"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">أنماط التعديلات</span>
          <textarea
            value={patterns}
            onChange={(e) => setPatterns(e.target.value)}
            rows={5}
            className="w-full rounded-lg border border-slate-300 p-2 font-mono text-sm"
          />
        </label>
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700">خطر فقدان العميل</span>
            <select
              value={risk}
              onChange={(e) => setRisk(e.target.value)}
              className="rounded-lg border border-slate-300 p-2"
            >
              <option value="low">منخفض</option>
              <option value="medium">متوسط</option>
              <option value="high">مرتفع</option>
            </select>
          </label>
          <label className="grow text-sm">
            <span className="mb-1 block font-medium text-slate-700">السبب</span>
            <input
              value={riskReason}
              onChange={(e) => setRiskReason(e.target.value)}
              className="w-full rounded-lg border border-slate-300 p-2"
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            disabled={busy !== null}
            onClick={() =>
              void run('save', async () => {
                await api(`/api/clients/${encodeURIComponent(orgId)}/profile`, {
                  method: 'PUT',
                  body: JSON.stringify({
                    preferencesMd: prefs,
                    revisionPatternsMd: patterns,
                    churnRisk: risk,
                    churnRiskReasonAr: riskReason,
                  }),
                });
                return 'تم حفظ تعديلاتك';
              })
            }
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy === 'save' ? 'جارٍ الحفظ…' : 'حفظ التعديلات'}
          </button>
          <button
            disabled={busy !== null}
            onClick={() =>
              void run('ai', async () => {
                const r = await api<{ changed: boolean; summary: string }>(
                  `/api/clients/${encodeURIComponent(orgId)}/profile/ai-refresh`,
                  { method: 'POST' }
                );
                return r.changed ? 'حدّث الذكاء الاصطناعي الملف' : 'لا توجد أدلة جديدة — الملف بدون تغيير';
              })
            }
            className="rounded-lg border border-blue-600 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50"
          >
            {busy === 'ai' ? 'جارٍ التحديث…' : 'تحديث بالذكاء الاصطناعي'}
          </button>
          <button
            disabled={busy !== null}
            onClick={() =>
              void run('export', async () => {
                const r = await api<{ filePath: string }>(
                  `/api/clients/${encodeURIComponent(orgId)}/export`,
                  { method: 'POST' }
                );
                return `تم التصدير إلى ${r.filePath}`;
              })
            }
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {busy === 'export' ? 'جارٍ التصدير…' : 'تصدير Markdown'}
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 font-semibold text-slate-900">آخر التغييرات على الملف</h3>
        {detail.updates.length === 0 ? (
          <p className="text-sm text-slate-500">لا توجد تغييرات مسجلة بعد.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {detail.updates.map((u) => (
              <li key={u.id} className="flex items-baseline justify-between gap-4">
                <span className="text-slate-800">
                  {u.source === 'ai' ? 'الذكاء الاصطناعي' : 'عبدالله'} —{' '}
                  {Object.keys(u.diff)
                    .map((f) => FIELD_LABEL[f] ?? f)
                    .join('، ')}
                </span>
                <span className="shrink-0 text-slate-400">
                  {new Date(u.createdAt).toLocaleString('ar-JO', { dateStyle: 'short', timeStyle: 'short' })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 font-semibold text-slate-900">سجل الطلبات (من المنصة)</h3>
        {detail.history == null ? (
          <p className="text-sm text-slate-500">لا توجد بيانات من المنصة بعد.</p>
        ) : (
          <pre className="max-h-72 overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-700" dir="ltr">
            {JSON.stringify(detail.history, null, 2)}
          </pre>
        )}
      </section>
    </div>
  );
}
