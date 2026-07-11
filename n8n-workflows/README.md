# n8n starter workflows

Two starter workflows for the execution layer (Phase 4). **Neither messages clients** — one notifies Abdulla on Telegram, the other creates a reminder. Both are skeletons: the webhook, HMAC signature verification, and response are wired and working; the actual Telegram/reminder step is a placeholder `NoOp` node you must replace with your own credentials.

| File | Fires on action_type | n8n path |
|---|---|---|
| `notify-abdulla-telegram.json` | `notify_abdulla_telegram` | `/webhook/notify` |
| `create-reminder.json` | `create_reminder` | `/webhook/reminder` |

## Import

1. In n8n: **Workflows → Import from File** → pick the `.json` file.
2. Set the environment variable `N8N_WEBHOOK_SECRET` in your n8n instance to the **same value** as `N8N_WEBHOOK_SECRET` in the backend's `.env` — this is the shared secret both sides use to sign/verify requests.
3. Replace the sticky-note-flagged `NoOp` node with the real action (a Telegram "Send a text message" node with your bot credentials, or a Google Tasks/Notion/calendar node for the reminder).
4. Activate the workflow.
5. Set `N8N_WEBHOOK_BASE` in the backend's `.env` to your n8n instance's webhook base URL (e.g. `https://your-n8n-host/`).

## How the signature works

The backend signs every request body with HMAC-SHA256 using `N8N_WEBHOOK_SECRET` (header `X-HorizonX-Signature`). Each workflow's **Verify HMAC Signature** code node recomputes the same HMAC over the raw request body and compares it — a mismatch returns `401` and never reaches the placeholder action node. This is what makes the webhook trustworthy: n8n only acts on requests that were actually signed by this backend.

## Idempotency

The backend never fires a webhook for a proposal that's already `executed` — see `backend/src/services/executionService.ts`. A failed attempt can be retried from the Approval Inbox; each attempt is recorded separately so the failure history is preserved.
