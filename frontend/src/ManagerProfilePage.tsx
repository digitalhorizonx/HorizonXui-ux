import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type ManagerProfile } from './api';

export default function ManagerProfilePage() {
  const [profile, setProfile] = useState<ManagerProfile | null>(null);
  const [patterns, setPatterns] = useState('');
  const [busy, setBusy] = useState<'save' | 'ai' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const p = await api<ManagerProfile>('/api/manager-profile');
    setProfile(p);
    setPatterns(p.patternsMd);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(label: 'save' | 'ai', fn: () => Promise<string>) {
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

  if (!profile) return <p className="p-8 text-slate-500">جارٍ التحميل…</p>;

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-8">
      <div>
        <h2 className="text-xl font-bold text-slate-900">نمط إدارة عبدالله</h2>
        <p className="text-sm text-slate-500">
          {profile.updatedAt ? `آخر تحديث: ${new Date(profile.updatedAt).toLocaleString('ar-JO')}` : 'لم يُحدَّث بعد'}
        </p>
      </div>

      {notice && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-800">{notice}</div>
      )}

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="font-semibold text-slate-900">الأنماط المُتعلَّمة (تعديلاتك لها الأولوية دائماً)</h3>
        <textarea
          value={patterns}
          onChange={(e) => setPatterns(e.target.value)}
          rows={10}
          className="w-full rounded-lg border border-slate-300 p-2 font-mono text-sm"
        />
        <div className="flex flex-wrap gap-3">
          <button
            disabled={busy !== null}
            onClick={() =>
              void run('save', async () => {
                await api('/api/manager-profile', { method: 'PUT', body: JSON.stringify({ patternsMd: patterns }) });
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
                const r = await api<{ changed: boolean }>('/api/manager-profile/run', { method: 'POST' });
                return r.changed ? 'حدّث الذكاء الاصطناعي النمط من قراراتك الأخيرة' : 'لا توجد قرارات جديدة كافية — بدون تغيير';
              })
            }
            className="rounded-lg border border-blue-600 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50"
          >
            {busy === 'ai' ? 'جارٍ التحديث…' : 'تحديث بالذكاء الاصطناعي'}
          </button>
        </div>
      </section>
    </div>
  );
}
