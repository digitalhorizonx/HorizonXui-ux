import path from 'node:path';
import fs from 'node:fs/promises';
import { prisma } from '../db';

/**
 * Obsidian-compatible Markdown export — the "brain" of HorizonX (spec Phase
 * 2.3, extended). Every client profile, proposal, and day gets a live note
 * that's rewritten whenever its underlying state changes, so the vault
 * always reflects the database, not just a nightly snapshot. Files land in
 * <repo>/exports/{clients,proposals,daily}/ — covered by the daily backup
 * cron and the systemd ReadWritePaths.
 */

// dist/services/ -> dist -> backend -> repo root
const EXPORTS_ROOT = path.resolve(__dirname, '../../../exports');
const CLIENTS_DIR = path.join(EXPORTS_ROOT, 'clients');
const PROPOSALS_DIR = path.join(EXPORTS_ROOT, 'proposals');
const DAILY_DIR = path.join(EXPORTS_ROOT, 'daily');

function safeFileName(name: string): string {
  const cleaned = name.replace(/[/\\:*?"<>|]/g, '-').trim();
  return cleaned.length > 0 ? cleaned : 'note';
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function clientNoteName(organizationId: string | null): Promise<string | null> {
  if (!organizationId) return null;
  const client = await prisma.clientCache.findUnique({ where: { organizationId } });
  return client ? safeFileName(client.name) : null;
}

export async function exportClientProfile(
  organizationId: string
): Promise<{ filePath: string; markdown: string }> {
  const client = await prisma.clientCache.findUnique({ where: { organizationId } });
  const profile = await prisma.clientProfile.findUnique({ where: { organizationId } });
  if (!client) {
    throw new Error(`client ${organizationId} not found in cache`);
  }

  const relatedProposals = await prisma.proposal.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
    take: 15,
  });
  const proposalLinks =
    relatedProposals.length > 0
      ? relatedProposals.map((p) => `- [[${proposalNoteName(p.tier, p.titleAr, p.id)}|${p.titleAr}]] — ${p.status}`).join('\n')
      : '_لا توجد مقترحات مرتبطة بعد._';

  const markdown = `---
organizationId: ${client.organizationId}
plan: ${client.plan}
churnRisk: ${profile?.churnRisk ?? 'low'}
updated: ${new Date().toISOString()}
---

# ${client.name}

## التفضيلات

${profile?.preferencesMd || '_لا توجد تفضيلات مسجلة بعد._'}

## أنماط التعديلات

${profile?.revisionPatternsMd || '_لا توجد أنماط مسجلة بعد._'}

## خطر فقدان العميل

**${profile?.churnRisk ?? 'low'}**${profile?.churnRiskReasonAr ? ` — ${profile.churnRiskReasonAr}` : ''}

## المقترحات المرتبطة

${proposalLinks}
`;

  await fs.mkdir(CLIENTS_DIR, { recursive: true });
  const filePath = path.join(CLIENTS_DIR, `${safeFileName(client.name)}.md`);
  await fs.writeFile(filePath, markdown, 'utf8');
  return { filePath, markdown };
}

/** Nightly auto-export of every cached client's profile. */
export async function exportAllProfiles(): Promise<void> {
  const clients = await prisma.clientCache.findMany();
  let ok = 0;
  for (const client of clients) {
    try {
      await exportClientProfile(client.organizationId);
      ok++;
    } catch (err) {
      console.error(`export failed for ${client.organizationId}:`, err);
    }
  }
  console.log(`Profile export: ${ok}/${clients.length} written to ${CLIENTS_DIR}`);
}

function proposalNoteName(tier: number, titleAr: string, id: string): string {
  return `T${tier}-${safeFileName(titleAr).slice(0, 40)}-${id.slice(-6)}`;
}

const ACTION_LABEL_AR: Record<string, string> = {
  notify_abdulla_telegram: 'إشعار تيليجرام لعبدالله',
  create_reminder: 'إنشاء تذكير',
  flag_client_churn_risk: 'تنبيه خطر فقدان عميل',
  draft_client_message: 'مسودة رسالة لعميل',
  propose_content_direction_change: 'اقتراح تغيير التوجه البصري',
  strategic_decision_package: 'قرار استراتيجي',
};

/**
 * Writes/refreshes one proposal's note — called at creation and again after
 * every decision or execution attempt, so the note always shows current
 * state (never a stale one-time snapshot).
 */
export async function exportProposalNote(proposalId: string): Promise<{ filePath: string } | null> {
  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId },
    include: { approval: true, executions: { orderBy: { attemptNumber: 'asc' } } },
  });
  if (!proposal) return null;

  const action = JSON.parse(proposal.proposedActionJson) as {
    actionType: string;
    payload: Record<string, string>;
    decisionPackage?: { questionAr: string; optionsAr: string[]; risksAr: string[]; recommendationAr: string };
  };
  const evidence = JSON.parse(proposal.evidenceJson) as { evidenceRefs: string[] };

  const clientName = await clientNoteName(proposal.organizationId);

  const decisionSection = proposal.approval
    ? `**${proposal.approval.decision === 'approved' ? 'تمت الموافقة' : 'تم الرفض'}** بتاريخ ${proposal.approval.decidedAt.toISOString()}${proposal.approval.noteAr ? `\n\n> ${proposal.approval.noteAr}` : ''}`
    : '_بانتظار القرار._';

  const executionSection =
    proposal.executions.length > 0
      ? proposal.executions
          .map(
            (e) =>
              `| ${e.attemptNumber} | ${e.firedAt.toISOString()} | ${e.succeeded ? '✅ نجح' : '❌ فشل'} | ${e.responseStatus ?? '—'} | ${(e.responseBody ?? '').slice(0, 200)} |`
          )
          .join('\n')
      : null;
  const executionTable = executionSection
    ? `| المحاولة | التوقيت | النتيجة | HTTP | التفاصيل |\n|---|---|---|---|---|\n${executionSection}`
    : '_لم يُنفَّذ بعد._';

  const decisionPackageSection = action.decisionPackage
    ? `

## حزمة القرار الاستراتيجي

**السؤال:** ${action.decisionPackage.questionAr}

**الخيارات:**
${action.decisionPackage.optionsAr.map((o) => `- ${o}`).join('\n')}

**المخاطر:**
${action.decisionPackage.risksAr.map((r) => `- ${r}`).join('\n') || '- لا توجد'}

**التوصية:** ${action.decisionPackage.recommendationAr}`
    : '';

  const markdown = `---
proposalId: ${proposal.id}
tier: ${proposal.tier}
status: ${proposal.status}
actionType: ${action.actionType}
organizationId: ${proposal.organizationId ?? ''}
createdAt: ${proposal.createdAt.toISOString()}
---

# ${proposal.titleAr}

${proposal.bodyAr}

**المستوى:** ${proposal.tier} · **الإجراء:** ${ACTION_LABEL_AR[action.actionType] ?? action.actionType} · **الحالة:** ${proposal.status}
${clientName ? `\n**العميل:** [[${clientName}]]` : ''}

## الأدلة

${evidence.evidenceRefs.map((e) => `- ${e}`).join('\n')}
${decisionPackageSection}

## القرار

${decisionSection}

## سجل التنفيذ

${executionTable}
`;

  await fs.mkdir(PROPOSALS_DIR, { recursive: true });
  const filePath = path.join(PROPOSALS_DIR, `${proposalNoteName(proposal.tier, proposal.titleAr, proposal.id)}.md`);
  await fs.writeFile(filePath, markdown, 'utf8');
  return { filePath };
}

/**
 * Writes/refreshes the note for one day: metrics, links to that day's
 * proposals, and the day's decision-log entries. Idempotent — safe to call
 * repeatedly as the day's data changes (each sync/proposal run refreshes it).
 */
export async function exportDailyNote(date: Date = new Date()): Promise<{ filePath: string } | null> {
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const snapshot = await prisma.metricsSnapshot.findFirst({
    where: { date: { gte: dayStart, lt: dayEnd } },
    orderBy: { date: 'desc' },
  });
  if (!snapshot) return null;

  const parsed = snapshot.parsedNumbers ? (JSON.parse(snapshot.parsedNumbers) as Record<string, unknown>) : {};
  const proposalsToday = await prisma.proposal.findMany({
    where: { createdAt: { gte: dayStart, lt: dayEnd } },
    orderBy: { createdAt: 'asc' },
  });
  const logsToday = await prisma.decisionLog.findMany({
    where: { timestamp: { gte: dayStart, lt: dayEnd } },
    orderBy: { timestamp: 'asc' },
  });

  const proposalLinks =
    proposalsToday.length > 0
      ? proposalsToday
          .map((p) => `- [[${proposalNoteName(p.tier, p.titleAr, p.id)}|${p.titleAr}]] (T${p.tier}, ${p.status})`)
          .join('\n')
      : '_لا توجد مقترحات اليوم._';

  const logLines =
    logsToday.length > 0
      ? logsToday.map((l) => `- ${l.timestamp.toISOString().slice(11, 16)} — ${l.summaryAr}`).join('\n')
      : '_لا توجد سجلات اليوم._';

  const key = dateKey(dayStart);
  const markdown = `---
date: ${key}
activeClients: ${snapshot.activeClients ?? ''}
tasksStuck: ${snapshot.tasksStuck ?? ''}
---

# ${key}

## الأرقام

- العملاء النشطون: ${snapshot.activeClients ?? '—'}
- المهام المتعثرة: ${snapshot.tasksStuck ?? '—'}
- المهام قيد الإنتاج: ${typeof parsed.tasksInProduction === 'number' ? parsed.tasksInProduction : '—'}
- إنفاق الذكاء الاصطناعي (المنصة): ${typeof parsed.aiSpendUsd === 'number' ? `$${parsed.aiSpendUsd.toFixed(2)}` : '—'}

## المقترحات

${proposalLinks}

## سجل القرارات

${logLines}
`;

  await fs.mkdir(DAILY_DIR, { recursive: true });
  const filePath = path.join(DAILY_DIR, `${key}.md`);
  await fs.writeFile(filePath, markdown, 'utf8');
  return { filePath };
}
