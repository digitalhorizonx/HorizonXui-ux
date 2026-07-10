import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../db';
import { env } from '../config/env';

/**
 * Central Claude API access (Hard rule 5): every call is logged to ai_usage
 * with tokens + estimated USD cost, and a monthly budget guard stops calls
 * (never silently) once month-to-date cost reaches AI_BUDGET_USD.
 */

// Model fixed by the spec (§3). Pricing per million tokens (claude-sonnet-4-6).
export const AI_MODEL = 'claude-sonnet-4-6';
const INPUT_USD_PER_MTOK = 3.0;
const OUTPUT_USD_PER_MTOK = 15.0;

export class AiBudgetExceededError extends Error {
  constructor(readonly spentUsd: number, readonly budgetUsd: number) {
    super(`AI budget exceeded: $${spentUsd.toFixed(4)} of $${budgetUsd} this month`);
    this.name = 'AiBudgetExceededError';
  }
}

/** Month-to-date AI spend (UTC month) and whether the budget is exhausted. */
export async function getAiBudgetStatus() {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const agg = await prisma.aiUsage.aggregate({
    where: { timestamp: { gte: monthStart } },
    _sum: { estimatedCostUsd: true },
  });
  const spentUsd = agg._sum.estimatedCostUsd ?? 0;
  return { spentUsd, budgetUsd: env.aiBudgetUsd, exceeded: spentUsd >= env.aiBudgetUsd };
}

const client = env.anthropicApiKey ? new Anthropic({ apiKey: env.anthropicApiKey }) : null;

/**
 * Call Claude with a JSON-schema-constrained output. Enforces the budget guard,
 * logs to ai_usage, and returns the parsed JSON object.
 */
export async function callClaudeJson<T>(params: {
  purpose: string;
  system: string;
  userContent: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
}): Promise<T> {
  if (!client) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }
  const budget = await getAiBudgetStatus();
  if (budget.exceeded) {
    throw new AiBudgetExceededError(budget.spentUsd, budget.budgetUsd);
  }

  const response = await client.messages.create({
    model: AI_MODEL,
    max_tokens: params.maxTokens ?? 4096,
    system: params.system,
    messages: [{ role: 'user', content: params.userContent }],
    output_config: { format: { type: 'json_schema', schema: params.schema } },
  });

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  await prisma.aiUsage.create({
    data: {
      purpose: params.purpose,
      model: AI_MODEL,
      inputTokens,
      outputTokens,
      estimatedCostUsd:
        (inputTokens * INPUT_USD_PER_MTOK + outputTokens * OUTPUT_USD_PER_MTOK) / 1_000_000,
    },
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('Claude refused the request');
  }
  const text = response.content.find((b) => b.type === 'text')?.text;
  if (!text) {
    throw new Error(`Claude returned no text block (stop_reason: ${response.stop_reason})`);
  }
  return JSON.parse(text) as T;
}
