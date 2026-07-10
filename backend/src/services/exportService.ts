import path from 'node:path';
import fs from 'node:fs/promises';
import { prisma } from '../db';

/**
 * Obsidian-compatible Markdown export of client profiles (Phase 2.3).
 * Files land in <repo>/exports/clients/<name>.md — the folder covered by the
 * daily backup cron and the systemd ReadWritePaths.
 */

// dist/services/ -> dist -> backend -> repo root
const EXPORTS_DIR = path.resolve(__dirname, '../../../exports/clients');

function safeFileName(name: string): string {
  const cleaned = name.replace(/[/\\:*?"<>|]/g, '-').trim();
  return cleaned.length > 0 ? cleaned : 'client';
}

export async function exportClientProfile(
  organizationId: string
): Promise<{ filePath: string; markdown: string }> {
  const client = await prisma.clientCache.findUnique({ where: { organizationId } });
  const profile = await prisma.clientProfile.findUnique({ where: { organizationId } });
  if (!client) {
    throw new Error(`client ${organizationId} not found in cache`);
  }

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
`;

  await fs.mkdir(EXPORTS_DIR, { recursive: true });
  const filePath = path.join(EXPORTS_DIR, `${safeFileName(client.name)}.md`);
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
  console.log(`Profile export: ${ok}/${clients.length} written to ${EXPORTS_DIR}`);
}
