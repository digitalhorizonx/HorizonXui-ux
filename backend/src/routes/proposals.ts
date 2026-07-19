import { Router } from 'express';
import { prisma } from '../db';
import { runProposalEngine } from '../services/proposalEngine';
import { fireProposalExecution } from '../services/executionService';
import { exportProposalNote, exportClientProfile } from '../services/exportService';

export const proposalsRouter = Router();

/** Manual proposal-engine trigger (Tier 1, informational — logged like every run). */
proposalsRouter.post('/run', async (_req, res) => {
  const result = await runProposalEngine();
  res.status(result.ok ? 200 : 502).json(result);
});

/** List proposals, optionally filtered by status (defaults to pending for the inbox). */
proposalsRouter.get('/', async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const proposals = await prisma.proposal.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: 'desc' },
    include: { approval: true, executions: { orderBy: { attemptNumber: 'desc' }, take: 1 } },
  });
  res.json(
    proposals.map((p) => ({
      id: p.id,
      createdAt: p.createdAt,
      tier: p.tier,
      status: p.status,
      titleAr: p.titleAr,
      bodyAr: p.bodyAr,
      evidence: JSON.parse(p.evidenceJson) as unknown,
      proposedAction: JSON.parse(p.proposedActionJson) as unknown,
      organizationId: p.organizationId,
      approval: p.approval ? { decidedAt: p.approval.decidedAt, decision: p.approval.decision } : null,
      lastExecution: p.executions[0]
        ? {
            attemptNumber: p.executions[0].attemptNumber,
            firedAt: p.executions[0].firedAt,
            succeeded: p.executions[0].succeeded,
            responseStatus: p.executions[0].responseStatus,
            responseBody: p.executions[0].responseBody,
          }
        : null,
    }))
  );
});

/** Refreshes a proposal's note and (if it's tied to a client) that client's note too. */
async function refreshNotes(proposalId: string, organizationId: string | null) {
  await exportProposalNote(proposalId);
  if (organizationId) {
    await exportClientProfile(organizationId).catch(() => {
      // client may not be in cache (e.g. deleted) — proposal note already refreshed, not fatal
    });
  }
}

/** Abdulla's explicit decision — Hard rule 2: this IS the approval record. */
async function decide(proposalId: string, decision: 'approved' | 'rejected', noteAr?: string) {
  const proposal = await prisma.proposal.findUnique({ where: { id: proposalId }, include: { approval: true } });
  if (!proposal) return { ok: false as const, code: 404 };
  if (proposal.status !== 'pending') return { ok: false as const, code: 409 };

  await prisma.approval.create({ data: { proposalId, decision, noteAr } });
  await prisma.proposal.update({ where: { id: proposalId }, data: { status: decision } });
  await prisma.decisionLog.create({
    data: {
      tier: proposal.tier,
      actor: 'abdulla',
      summaryAr:
        decision === 'approved'
          ? `وافق عبدالله على المقترح: ${proposal.titleAr}`
          : `رفض عبدالله المقترح: ${proposal.titleAr}`,
      refs: JSON.stringify({ type: 'proposal_decision', proposalId, decision }),
    },
  });
  return { ok: true as const, organizationId: proposal.organizationId };
}

proposalsRouter.post('/:id/approve', async (req, res) => {
  const noteAr = typeof req.body?.noteAr === 'string' ? req.body.noteAr : undefined;
  const result = await decide(req.params.id, 'approved', noteAr);
  if (!result.ok) {
    res
      .status(result.code)
      .json({ error: result.code === 404 ? 'not_found' : 'already_decided', messageAr: 'تعذر تنفيذ الطلب' });
    return;
  }
  // Fire immediately on approval (spec Phase 4.1). Never silent — the
  // outcome (executed/failed) is returned and also visible in the inbox.
  const execution = await fireProposalExecution(req.params.id);
  await refreshNotes(req.params.id, result.organizationId); // Obsidian brain stays live
  res.json({ ok: true, execution });
});

proposalsRouter.post('/:id/reject', async (req, res) => {
  const noteAr = typeof req.body?.noteAr === 'string' ? req.body.noteAr : undefined;
  const result = await decide(req.params.id, 'rejected', noteAr);
  if (!result.ok) {
    res
      .status(result.code)
      .json({ error: result.code === 404 ? 'not_found' : 'already_decided', messageAr: 'تعذر تنفيذ الطلب' });
    return;
  }
  await refreshNotes(req.params.id, result.organizationId);
  res.json({ ok: true });
});

/** Retry a failed execution — new attempt row, still idempotent (Hard rule 7). */
proposalsRouter.post('/:id/retry', async (req, res) => {
  const proposal = await prisma.proposal.findUnique({ where: { id: req.params.id } });
  if (!proposal) {
    res.status(404).json({ error: 'not_found', messageAr: 'المقترح غير موجود' });
    return;
  }
  if (proposal.status !== 'failed') {
    res.status(409).json({ error: 'not_failed', messageAr: 'إعادة المحاولة متاحة فقط للمقترحات الفاشلة' });
    return;
  }
  const execution = await fireProposalExecution(req.params.id);
  await refreshNotes(req.params.id, proposal.organizationId);
  res.json({ ok: true, execution });
});
