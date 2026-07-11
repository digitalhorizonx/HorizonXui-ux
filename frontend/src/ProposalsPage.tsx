import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type Proposal } from './api';

const ACTION_LABEL: Record<string, string> = {
  notify_abdulla_telegram: 'إشعار تيليجرام لعبدالله',
  create_reminder: 'إنشاء تذكير',
  flag_client_churn_risk: 'تنبيه خطر فقدان عميل',
  draft_client_message: 'مسودة رسالة لعميل',
  propose_content_direction_change: 'اقتراح تغيير التوجه البصري',
  strategic_decision_package: 'قرار استراتيجي',
};

const PAYLOAD_FIELD_LABEL: Record<string, string> = {
  messageAr: 'الرسالة',
  titleAr: 'العنوان',
  dueDate: 'تاريخ الاستحقاق',
  organizationId: 'العميل',
  reasonAr: 'السبب',
  draftAr: 'المسودة',
  changeAr: 'التغيير المقترح',
};

const TIER_BADGE: Record<number, string> = {
  1: 'bg-slate-100 text-slate-700',
  2: 'bg-amber-100 text-amber-800',
  3: 'bg-red-100 text-red-800',
};

function ProposalCard({ proposal, onDecided }: { proposal: Proposal; onDecided: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(action: 'approve' | 'reject') {
    setBusy(action);
    setError(null);
    try {
      await api(`/api/proposals/${proposal.id}/${action}`, { method: 'POST' });
      onDecided();
    } catch (err) {
      setError(err instanceof ApiError ? err.messageAr : 'حدث خطأ غير متوقع');
      setBusy(null);
    }
  }

  const dp = proposal.proposedAction.decisionPackage;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TIER_BADGE[proposal.tier] ?? TIER_BADGE[2]}`}>
          المستوى {proposal.tier}
        </span>
        <span className="text-xs text-slate-500">{ACTION_LABEL[proposal.proposedAction.actionType] ?? proposal.proposedAction.actionType}</span>
      </div>
      <h3 className="mb-1 font-semibold text-slate-900">{proposal.titleAr}</h3>
      <p className="mb-3 text-sm text-slate-700">{proposal.bodyAr}</p>

      {proposal.tier === 3 && dp && (
        <div className="mb-3 space-y-2 rounded-lg bg-red-50 p-3 text-sm">
          <p>
            <strong>السؤال:</strong> {dp.questionAr}
          </p>
          <div>
            <strong>الخيارات:</strong>
            <ul className="mr-4 list-disc">
              {dp.optionsAr.map((o, i) => (
                <li key={i}>{o}</li>
              ))}
            </ul>
          </div>
          {dp.risksAr.length > 0 && (
            <div>
              <strong>المخاطر:</strong>
              <ul className="mr-4 list-disc">
                {dp.risksAr.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}
          <p>
            <strong>التوصية:</strong> {dp.recommendationAr}
          </p>
        </div>
      )}

      {Object.keys(proposal.proposedAction.payload).length > 0 && (
        <dl className="mb-3 space-y-1 text-sm text-slate-600">
          {Object.entries(proposal.proposedAction.payload).map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <dt className="shrink-0 font-medium text-slate-500">{PAYLOAD_FIELD_LABEL[k] ?? k}:</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}

      <button onClick={() => setExpanded((e) => !e)} className="mb-3 text-sm text-blue-600 hover:underline">
        {expanded ? 'إخفاء الأدلة' : 'عرض الأدلة'}
      </button>
      {expanded && (
        <ul className="mb-3 mr-4 list-disc text-sm text-slate-600">
          {proposal.evidence.evidenceRefs.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}

      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

      <div className="flex gap-3">
        <button
          disabled={busy !== null}
          onClick={() => void decide('approve')}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy === 'approve' ? 'جارٍ…' : 'موافق'}
        </button>
        <button
          disabled={busy !== null}
          onClick={() => void decide('reject')}
          className="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          {busy === 'reject' ? 'جارٍ…' : 'رفض'}
        </button>
      </div>
    </div>
  );
}

export default function ProposalsPage() {
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const list = await api<Proposal[]>('/api/proposals?status=pending');
    setProposals(list);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runEngine() {
    setRunning(true);
    setNotice(null);
    try {
      const r = await api<{ stored: number; rejected: number }>('/api/proposals/run', { method: 'POST' });
      setNotice(
        r.stored > 0
          ? `تم إنشاء ${r.stored} مقترح جديد${r.rejected > 0 ? ` (رُفض ${r.rejected} غير مطابق)` : ''}`
          : 'لم يُنشأ أي مقترح جديد'
      );
    } catch (err) {
      setNotice(err instanceof ApiError ? err.messageAr : 'فشل تشغيل محرك المقترحات');
    } finally {
      setRunning(false);
      await load();
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-6 py-8">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-900">صندوق الموافقات</h2>
        <button
          disabled={running}
          onClick={() => void runEngine()}
          className="rounded-lg border border-blue-600 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50"
        >
          {running ? 'جارٍ التشغيل…' : 'تشغيل محرك المقترحات الآن'}
        </button>
      </div>

      {notice && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-800">{notice}</div>
      )}

      {proposals === null ? (
        <p className="text-slate-500">جارٍ التحميل…</p>
      ) : proposals.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white p-4 text-slate-500">
          لا توجد مقترحات معلقة حالياً.
        </p>
      ) : (
        <div className="space-y-4">
          {proposals.map((p) => (
            <ProposalCard key={p.id} proposal={p} onDecided={() => void load()} />
          ))}
        </div>
      )}
    </div>
  );
}
