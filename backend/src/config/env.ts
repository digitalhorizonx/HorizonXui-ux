import 'dotenv/config';

/**
 * Central typed access to environment variables (Hard rule 4: secrets live only
 * here, documented in .env.example, never hardcoded, never logged).
 *
 * Phase 0: only PORT and DATABASE_URL are required to boot. Later phases add
 * hard requirements as the features that consume them land.
 */
export const env = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? 'file:./data/horizonx-assistant.db',

  platformBaseUrl: process.env.PLATFORM_BASE_URL ?? '',
  reportApiKey: process.env.REPORT_API_KEY ?? '',

  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  aiBudgetUsd: Number(process.env.AI_BUDGET_USD ?? 10),

  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH ?? '',
  sessionSecret: process.env.SESSION_SECRET ?? '',

  n8nWebhookBase: process.env.N8N_WEBHOOK_BASE ?? '',
  n8nWebhookSecret: process.env.N8N_WEBHOOK_SECRET ?? '',
} as const;

/** Names of variables that must be set before the given phase can run. */
export const requiredByPhase: Record<number, (keyof typeof env)[]> = {
  1: ['platformBaseUrl', 'reportApiKey', 'adminPasswordHash', 'sessionSecret'],
  2: ['anthropicApiKey'],
  4: ['n8nWebhookBase', 'n8nWebhookSecret'],
};
