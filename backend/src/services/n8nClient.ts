import crypto from 'node:crypto';
import { env } from '../config/env';

/**
 * n8n webhook client (Phase 4 — "the hands"). Every payload is HMAC-SHA256
 * signed with N8N_WEBHOOK_SECRET so the receiving workflow can verify it
 * actually came from this app (see n8n-workflows/*.json for the verify step).
 */

export type N8nResult = { status: number | null; body: string };

export class N8nNotConfiguredError extends Error {}

export function signPayload(rawBody: string): string {
  return crypto.createHmac('sha256', env.n8nWebhookSecret).update(rawBody).digest('hex');
}

export async function fireN8nWebhook(path: string, payload: Record<string, unknown>): Promise<N8nResult> {
  if (!env.n8nWebhookBase || !env.n8nWebhookSecret) {
    throw new N8nNotConfiguredError('N8N_WEBHOOK_BASE / N8N_WEBHOOK_SECRET are not configured');
  }
  const rawBody = JSON.stringify(payload);
  const url = new URL(path, env.n8nWebhookBase).toString();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-HorizonX-Signature': signPayload(rawBody) },
    body: rawBody,
  });
  const body = await res.text();
  return { status: res.status, body };
}
