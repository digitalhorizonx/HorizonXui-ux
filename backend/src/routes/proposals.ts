import { Router } from 'express';
import { prisma } from '../db';
import { runProposalEngine } from '../services/proposalEngine';

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
    include: { approval: true, execution: true },
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
    }))
  );
});

/**
 * Approve or reject a proposal — Hard rule 2: this IS the approval record.
 * Execution (firing the n8n webhook) is Phase 4 and does not happen here yet.
 */
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
  return { ok: true as const };
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
  res.json({ ok: true });
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
  res.json({ ok: true });
});
