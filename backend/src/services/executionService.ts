import crypto from 'node:crypto';
import { prisma } from '../db';
import { ACTION_CATALOG, type ActionType } from './actionCatalog';
import { fireN8nWebhook, N8nNotConfiguredError } from './n8nClient';

/**
 * Execution layer (Phase 4 — "the hands"). Fires the mapped n8n webhook for
 * an approved proposal and records the outcome. Idempotency (Hard rule 7) is
 * enforced by checking proposal.status BEFORE ever firing — once a proposal
 * reaches "executed" it is never fired again, no matter how many times this
 * is called. A "failed" proposal may be retried; each attempt is a new
 * Execution row so the failure history is never lost.
 */

type ProposedAction = {
  actionType: ActionType;
  payload: Record<string, string>;
  decisionPackage?: unknown;
};

export type ExecutionResult = {
  status: 'executed' | 'failed';
  detail: string;
};

async function logDecision(tier: number, summaryAr: string, refs: Record<string, unknown>) {
  await prisma.decisionLog.create({ data: { tier, actor: 'system', summaryAr, refs: JSON.stringify(refs) } });
}

/**
 * Fires (or re-fires after a failure) the action for one proposal.
 * Callers must already know the proposal is "approved" or "failed" — this
 * function itself re-checks status as the authoritative idempotency guard.
 */
export async function fireProposalExecution(proposalId: string): Promise<ExecutionResult> {
  const proposal = await prisma.proposal.findUnique({ where: { id: proposalId } });
  if (!proposal) {
    throw new Error(`proposal ${proposalId} not found`);
  }

  // Idempotency guard (Hard rule 7): already executed — never fire again.
  if (proposal.status === 'executed') {
    return { status: 'executed', detail: 'تم التنفيذ مسبقاً — لا حاجة لإعادة الإرسال' };
  }
  if (proposal.status !== 'approved' && proposal.status !== 'failed') {
    throw new Error(`cannot execute proposal in status "${proposal.status}" — must be approved or failed`);
  }

  const action = JSON.parse(proposal.proposedActionJson) as ProposedAction;
  const catalogEntry = ACTION_CATALOG[action.actionType];
  const priorAttempts = await prisma.execution.count({ where: { proposalId } });
  const attemptNumber = priorAttempts + 1;

  // Tier 3 (strategic_decision_package) has no n8n path — it's display-only.
  // Abdulla's approval IS the completed action; nothing to fire.
  if (catalogEntry.n8nPath === null) {
    await prisma.execution.create({
      data: {
        proposalId,
        attemptNumber,
        n8nWebhook: '(بدون تنفيذ — قرار استراتيجي معروض فقط)',
        requestPayloadHash: crypto.createHash('sha256').update(proposalId).digest('hex'),
        responseStatus: null,
        responseBody: 'قرار استراتيجي — لا يتطلب تنفيذاً آلياً عبر n8n',
        succeeded: true,
      },
    });
    await prisma.proposal.update({ where: { id: proposalId }, data: { status: 'executed' } });
    await logDecision(proposal.tier, `تم اعتماد القرار الاستراتيجي: ${proposal.titleAr}`, {
      type: 'proposal_executed',
      proposalId,
      actionType: action.actionType,
    });
    return { status: 'executed', detail: 'قرار استراتيجي — لا يتطلب تنفيذاً آلياً' };
  }

  const requestPayload = { ...action.payload, proposalId };
  const requestPayloadHash = crypto.createHash('sha256').update(JSON.stringify(requestPayload)).digest('hex');

  let responseStatus: number | null = null;
  let responseBody = '';
  let succeeded = false;
  try {
    const result = await fireN8nWebhook(catalogEntry.n8nPath, requestPayload);
    responseStatus = result.status;
    responseBody = result.body;
    succeeded = result.status !== null && result.status >= 200 && result.status < 300;
  } catch (err) {
    responseBody =
      err instanceof N8nNotConfiguredError
        ? 'n8n غير مهيأ على الخادم (N8N_WEBHOOK_BASE / N8N_WEBHOOK_SECRET)'
        : err instanceof Error
          ? err.message
          : String(err);
  }

  await prisma.execution.create({
    data: {
      proposalId,
      attemptNumber,
      n8nWebhook: catalogEntry.n8nPath,
      requestPayloadHash,
      responseStatus,
      responseBody,
      succeeded,
    },
  });

  const newStatus = succeeded ? 'executed' : 'failed';
  await prisma.proposal.update({ where: { id: proposalId }, data: { status: newStatus } });
  await logDecision(
    proposal.tier,
    succeeded
      ? `تم تنفيذ الإجراء بنجاح: ${proposal.titleAr}`
      : `فشلت المحاولة ${attemptNumber} لتنفيذ الإجراء: ${proposal.titleAr}`,
    { type: succeeded ? 'proposal_executed' : 'proposal_execution_failed', proposalId, attemptNumber, responseStatus }
  );

  return {
    status: newStatus,
    detail: succeeded ? 'تم التنفيذ بنجاح' : `فشل التنفيذ: ${responseBody || `HTTP ${responseStatus ?? 'غير معروف'}`}`,
  };
}
