# HorizonX Agentic OS — Master Build Prompt for Claude Code

---

## 1. Mission

You are building the **HorizonX Agentic OS** — a personal operations system for Abdulla, CEO of HorizonX. It will be deployed at `cs.horizonx.site`. It is a SEPARATE application from the HorizonX platform. It never modifies the platform.

The loop it implements:

**Gather data → analyze → propose actions in Arabic → Abdulla approves → execute → log → learn.**

Concretely, the system:
1. Pulls business stats and per-client history from the HorizonX platform's read-only Reports API on a schedule
2. Maintains a "client intelligence profile" per client (preferences, revision patterns, churn risk) that improves with every request/edit
3. Uses the Claude API to analyze data and generate **proposals** (e.g. "Client X rejected 3 posts for the same reason — update their visual direction")
4. Shows proposals in an **Approval Inbox** — nothing executes without Abdulla's explicit approval
5. Executes approved actions by calling n8n webhooks
6. Writes an immutable decision log of everything proposed, approved, rejected, executed
7. Exports client intelligence profiles as Markdown files (Obsidian-compatible)

## 2. Hard rules — violating any of these means stop and report, never work around

1. **READ-ONLY toward the HorizonX platform.** The only allowed platform access is HTTPS GET calls to the Reports API using the `X-Report-Key` header. Never connect to the platform database. Never import platform code. Never write, POST, PATCH, or DELETE anything on the platform.
2. **No action without an approval record.** Every executed action must reference an `approvals` row created by Abdulla's explicit click. There is no auto-execute mode. Do not build one, even as a hidden flag.
3. **Decision tiers are enforced in code**, not just prompts:
   - Tier 1 (informational): daily briefs, logging, profile updates → auto, logged
   - Tier 2 (significant): anything client-facing, anything touching money topics, content direction changes → proposal + approval required
   - Tier 3 (strategic): flagged proposals rendered as a full decision package → approval required
   - When the AI classifier is unsure of the tier, it MUST default to Tier 2.
4. **Secrets** only in environment variables, documented in `.env.example`, never hardcoded, never logged, never sent to the frontend bundle.
5. **Every Claude API call** is written to an `ai_usage` table: timestamp, purpose, model, input/output tokens, estimated USD cost. Monthly budget guard: if month-to-date cost exceeds `AI_BUDGET_USD` (default 10), stop making AI calls and surface a banner — never fail silently.
6. **All user-facing text is Arabic** (RTL layout), with English acceptable only in logs and code.
7. **Idempotency:** executing the same approval twice must not fire the n8n webhook twice (store execution state; check before firing).
8. **Never fake completion.** No mock data presented as real, no buttons that do nothing, no "works on my machine" claims — every "done" claim must come with the actual command output or screenshot-equivalent evidence.
9. **Single-user auth.** This app has exactly one user (Abdulla). Simple session login with a strong password from env (`ADMIN_PASSWORD_HASH`, bcrypt). Rate-limit login attempts. No public signup.

## 3. Tech stack (fixed — do not substitute)

- Backend: Node.js + TypeScript + Express + Prisma + **SQLite** (file DB — this is a single-user app; do not provision Postgres)
- Frontend: React + TypeScript + Vite + Tailwind CSS, RTL-first, Arabic fonts (IBM Plex Sans Arabic or Cairo)
- Scheduler: node-cron inside the backend process (no external queue — keep it simple)
- AI: Anthropic API, model `claude-sonnet-4-6`, structured JSON outputs
- Deployment target: single VPS process behind Nginx at `cs.horizonx.site` (produce a deployment runbook; do not claim it is live until verified)

## 4. Data model (Prisma, SQLite)

- `clients_cache` — organizationId (from platform), name, plan, lastSyncedAt, raw JSON snapshot
- `client_profiles` — organizationId (unique), preferencesMd (text), revisionPatternsMd (text), churnRisk (low/medium/high), updatedAt. This is the learned intelligence layer.
- `metrics_snapshots` — date, raw overview JSON, parsed key numbers (activeClients, tasksStuck, creditsDeducted…)
- `proposals` — id, createdAt, tier (1/2/3), status (pending/approved/rejected/executed/failed/expired), titleAr, bodyAr, evidenceJson (the data that justified it), proposedActionJson (type + n8n webhook payload), organizationId (nullable)
- `approvals` — proposalId, decidedAt, decision (approved/rejected), noteAr (optional voice-note-transcribed reason later)
- `executions` — proposalId (unique — idempotency), firedAt, n8nWebhook, requestPayloadHash, responseStatus, responseBody
- `decision_log` — append-only: timestamp, tier, actor (system/abdulla), summaryAr, refs. Never updated or deleted.
- `ai_usage` — as defined in rule 5.

## 5. Build phases — work strictly in order, one phase per session if needed

### Phase 0 — Prerequisite check + skeleton  ⛔ gate at end
1. Ask Abdulla for: the deployed platform base URL, and confirmation that `GET /api/reports/overview` and `GET /api/reports/clients/:organizationId/context` exist and return JSON with the `X-Report-Key`. **If they don't exist yet, stop** — they are built in the platform repo first (separate prompt already prepared).
2. Scaffold the repo: backend + frontend folders, Prisma schema from §4, `.env.example` with every variable (PLATFORM_BASE_URL, REPORT_API_KEY, ANTHROPIC_API_KEY, AI_BUDGET_USD, ADMIN_PASSWORD_HASH, SESSION_SECRET, N8N_WEBHOOK_BASE, N8N_WEBHOOK_SECRET, PORT).
3. Migrations run, `npm run build` and lint pass in both folders. Show the actual output.
⛔ STOP. Report what was created, show the folder tree, wait for approval.

### Phase 1 — Data ingestion (the eyes)  ⛔ gate at end
1. Service that calls the Reports API: overview daily at 07:30 Asia/Amman, per-client context nightly. Retries with backoff; failures create a Tier-1 log entry AND a visible banner — never silent.
2. Store snapshots in `metrics_snapshots` and `clients_cache`.
3. Minimal UI: login page + a dashboard page showing yesterday vs today key numbers, in Arabic, RTL.
4. Test with the real deployed Reports API (Abdulla provides the key at runtime — never commit it). Show real fetched data on screen.
⛔ STOP. Demonstrate a real successful sync with evidence.

### Phase 2 — Client intelligence profiles (the memory)  ⛔ gate at end
1. Nightly job per client: send the new tasks/revisions since last sync + current profile to Claude API with a strict prompt: "Update the preferences and revision-patterns sections in Arabic based only on this evidence; if there is no new evidence, return the profile unchanged." Structured JSON out. Diff stored; profile updated.
2. Client page in UI: profile (editable by Abdulla — his edits always win over AI edits), request history from cache, churn risk with the reason.
3. Export button + nightly auto-export: writes `exports/clients/<name>.md` in Obsidian-compatible Markdown (frontmatter: organizationId, plan, churnRisk).
⛔ STOP. Show one real client profile generated from real data, and its exported .md file.

### Phase 3 — Proposal engine (the brain)  ⛔ gate at end
1. After each morning sync, an analysis run sends the snapshot + deltas + profiles summary to Claude API. Output: JSON array of proposals, each with tier, Arabic title/body, evidence references, and a proposedAction from an **allowed action catalog only** (see §6). The prompt must instruct: propose nothing without evidence; when unsure of tier, choose 2; maximum 5 proposals per day ranked by impact.
2. Validate every returned proposal against the catalog schema — reject and log malformed ones; never store or execute free-form actions.
3. Approval Inbox UI: pending proposals as cards — Arabic title, body, the evidence shown expandable, two buttons: موافق / رفض. Tier 3 renders the full decision-package layout (question → options → risks → recommendation).
4. Daily brief page: Arabic morning summary (numbers, stuck items, proposals count).
⛔ STOP. Show 2–3 real proposals generated from real data, with their evidence.

### Phase 4 — Execution layer (the hands)  ⛔ gate at end
1. On approval: create `approvals` row, then fire the mapped n8n webhook (`N8N_WEBHOOK_BASE` + action path) with HMAC signature using `N8N_WEBHOOK_SECRET`, payload = proposal action JSON + proposalId. Record in `executions` (idempotent — a proposalId can execute once).
2. n8n's response updates the proposal to executed/failed; failures are visible in the inbox with a retry button (retry still respects idempotency via a new execution attempt record — design this explicitly).
3. Everything appended to `decision_log`.
4. Provide 2 starter n8n workflow JSON files in `n8n-workflows/` for Abdulla to import: (a) send a Telegram message to Abdulla, (b) create a reminder/task entry. Nothing that messages clients yet.
⛔ STOP. Demonstrate one full loop end-to-end with a real approval and real n8n execution.

### Phase 5 — Deployment + QA + docs  ⛔ final gate
1. Production build, Nginx config, systemd/pm2 config, SSL notes, backup note (the SQLite file + exports folder — daily copy), health-check endpoint `/healthz`.
2. QA checklist executed and reported honestly: auth (wrong password, rate limit), Reports API down (banner appears), AI budget exceeded (calls stop, banner appears), double-click approve (one execution), malformed AI output (rejected + logged), RTL rendering on mobile width.
3. Docs in `/docs`: setup guide, env guide, runbook (what to do when sync fails / n8n fails / restore backup), and a one-page Arabic user guide for Abdulla.
4. Deployment to the VPS happens with Abdulla executing the runbook commands; verify live by hitting `/healthz` and logging in. State plainly anything not verified.

## 6. Allowed action catalog (Phase 3/4 — the ONLY executable actions)

| action_type | tier | n8n path | payload |
|---|---|---|---|
| notify_abdulla_telegram | 1 | /webhook/notify | { messageAr } |
| create_reminder | 1 | /webhook/reminder | { titleAr, dueDate } |
| flag_client_churn_risk | 2 | /webhook/notify | { organizationId, reasonAr } |
| draft_client_message | 2 | /webhook/notify | { organizationId, draftAr } — draft is sent to ABDULLA, never to the client |
| propose_content_direction_change | 2 | /webhook/notify | { organizationId, changeAr } |
| strategic_decision_package | 3 | (none — display only) | full package rendered in UI |

Expanding this catalog is itself a Tier 2 decision — new action types require Abdulla's approval and a new row here.

## 7. Working discipline for you (Claude Code)

- Before each phase: restate the goal in 3 lines, list files you will create/change, then build.
- After each phase: run build + lint + typecheck, show real output, list remaining risks, then STOP at the gate.
- If anything in this document conflicts with something you discover, surface the conflict — do not silently choose.
- Small commits per logical step with clear messages.

---

## Build status (updated by Claude Code at each gate)

- [x] Phase 0 — skeleton scaffolded and approved by Abdulla (2026-07-09). Deployment target changed by Abdulla from claude.horizonx.site to **cs.horizonx.site**.
- [x] Phase 1 — data ingestion built; **real sync verified 2026-07-10** against the live Agent Reports API (`https://claude.horizonx.site/api/agent-reports/overview`, `X-Report-Key`). Note: real paths are `/api/agent-reports/*`, not the spec's `/api/reports/*`. **Gap for Phase 2:** the overview carries only aggregate client health (no per-client list) and no per-client context endpoint exists — must be added in the platform repo before client intelligence profiles can work. Deployment runbook: docs/runbook-deploy-cs.md.
- [x] **Deployed and verified live at `cs.horizonx.site` (2026-07-10).** Old app (Docker container behind an existing Certbot-managed nginx site) stopped and replaced; systemd service `horizonx-assistant` running on port 3000; nginx repointed in place. End-to-end verified in a real browser: Arabic login → dashboard → manual sync → real production numbers (4 عملاء نشطون، 5 مهام متعثرة، 5 قيد الإنتاج، $0.07 إنفاق AI، 14 موظف). Daily backup cron installed.
- [x] Phase 2 — client intelligence profiles built (2026-07-10): nightly AI profile updates (`claude-sonnet-4-6`, structured JSON, ai_usage logging + monthly budget guard with banner), Abdulla-editable client pages (his edits win via optimistic concurrency), diff history (`profile_updates` table + `churnRiskReasonAr` column — additions to §4 needed for "diff stored" and "churn risk with reason"), Obsidian export (button + nightly 03:00/03:30 jobs). **Verified end-to-end against stubs of the platform-context contract and the Anthropic API.** Real-data demo still blocked on the platform's missing per-client endpoints; needs ANTHROPIC_API_KEY in the VPS .env.
- [x] Phase 3 — proposal engine built (2026-07-11): analysis run after morning sync sends snapshot+deltas+profile summaries to Claude; every candidate validated against the §6 action catalog in code (unknown action types and missing/extra payload fields rejected and logged — never stored or executed); tier is derived from the catalog per action type, never trusted from the AI (Hard rule 3); max 5/day. Approval Inbox UI (موافق/رفض, expandable evidence, Tier-3 full decision-package layout) + daily brief page. Approving/rejecting creates the `approvals` row + decision_log entry now — **firing the n8n webhook is Phase 4, not built yet.** **Verified end-to-end against a stub Anthropic API**: 5 candidate proposals in → 3 valid stored with correct tiers (1/2/3) + 2 malformed rejected and logged; approve/reject tested incl. 409 on double-decide; AI budget guard blocks the engine and logs it. Real generation blocked only on Anthropic account credits (key is configured; account has $0 balance as of 2026-07-11) — add billing at console.anthropic.com to unblock, no code changes needed.
- [x] Phase 4 — execution layer built (2026-07-11): on approval the mapped n8n webhook fires immediately, HMAC-SHA256 signed (`X-HorizonX-Signature`) with `N8N_WEBHOOK_SECRET`; idempotency (Hard rule 7) enforced by checking `proposal.status` before ever firing — an already-`executed` proposal is never re-fired, at the route layer (re-approve returns 409, retry-on-executed is refused) and again inside the execution service itself (defense in depth). Failed attempts flip status to `failed`, surface in the Approval Inbox with a "إعادة المحاولة" button, and each retry is a new `Execution` row (attempt history preserved, never overwritten) — schema changed from a unique `proposalId` on `Execution` to `attemptNumber`-tracked multiple rows for this reason. Tier-3 `strategic_decision_package` has no n8n path (display-only per §6) — approval itself completes it, no webhook call. Two starter n8n workflows in `n8n-workflows/` (notify + reminder), both with a working HMAC-verification Code node and a clearly-labeled placeholder node Abdulla must replace with his own Telegram/task credentials — neither messages clients. **Verified end-to-end against a stub n8n receiver**: notify succeeded first try, the decision package auto-completed with no webhook, the reminder failed its first attempt (simulated 500) then succeeded on retry — confirmed via both the API responses and the stub's own call log (`/webhook/notify` called exactly once, proving no double-fire even under a forced re-approve/retry-on-executed attempt). Real n8n execution needs Abdulla's own n8n instance — `N8N_WEBHOOK_BASE`/`N8N_WEBHOOK_SECRET` in `.env`, workflows imported per `n8n-workflows/README.md`.
- [x] **Obsidian "brain" extension (2026-07-19, out-of-spec addition at Abdulla's request):** every proposal and every day now gets a live-updating Obsidian note in `exports/`, not just client profiles. `exports/daily/<date>.md` is created the moment that day's sync lands and refreshes when proposals are generated; `exports/proposals/<T{tier}-slug-id6>.md` is written the instant a proposal is created and rewritten after every decision and every execution attempt (full attempt-history table); client notes gained a "المقترحات المرتبطة" section and now auto-refresh whenever a proposal tied to that client changes state — no manual export click needed. All three note types wikilink to each other (client ↔ proposal ↔ daily). **Note:** Abdulla also asked for agents to "perform tasks on their own after discussing with each other" — flagged as a direct conflict with Hard rule 2 ("no auto-execute mode... not even a hidden flag") and resolved via explicit confirmation to keep the full approval gate; nothing changed about execution requiring the موافق click. **Verified**: full pipeline run against stubs — daily note appears after sync alone, proposal notes exist before any decision, client note is created automatically (not just refreshed) on first approval, decision + execution table both reflected live, all wikilinks resolve to the correct filenames.
- [x] **Manager (decision-maker) profile + self-improvement engine (2026-07-19, out-of-spec additions at Abdulla's request):** two more asks from the same request as the Obsidian brain — "learns my way of managing the business" and "the system should develop itself, always suggest needed improvements." Both resolved through `AskUserQuestion` toward the safest option (Abdulla chose "keep full approval gate" and "suggests only," respectively), so neither adds any new execution path — Hard rule 2 is untouched.
  - **Manager profile** (`ManagerProfile` singleton table, `managerProfileService.ts`): nightly at 03:10 Asia/Amman (and on-demand via `POST /api/manager-profile/run`), Claude reads Abdulla's last 30 approve/reject decisions (tier, action type, title, his notes) and updates an Arabic Markdown description of his decision-making patterns — evidence-only, same optimistic-concurrency "Abdulla's manual edit always wins" rule as client profiles. Fed into the proposal engine's evidence (`managerPatterns` field) so future proposals account for what he tends to approve/reject. Editable at `#/manager` in the UI; exports to `exports/manager/نمط-إدارة-عبدالله.md`.
  - **Self-improvement engine** (`selfImprovementEngine.ts`, weekly Monday 08:00 Asia/Amman, and on-demand via `POST /api/proposals/self-improve/run`): analyzes rejection rates by action type, recent sync/execution/validation/budget failures, count of stale (>3 day) pending proposals, and the manager profile, then asks Claude for at most 2 suggested improvements **to the system itself**. Deliberately reuses the existing `strategic_decision_package` action type from the §6 catalog and the existing Approval Inbox — no new action types, no code-generation or auto-deploy capability of any kind. Suggestions are for a human (Abdulla, in a future Claude Code session) to review and explicitly request; approving one in the inbox does not build or ship anything. Tagged `evidence.source: "self_improvement"` and shown with a purple "تحسين النظام" badge in the UI to distinguish from business proposals.
  - **Verified end-to-end against stubs** (fresh local DB, `stub-phase3.mjs` extended with manager-profile and self-improvement system-prompt branches, `stub-n8n.mjs` unchanged): synced → ran the proposal engine (4 stored/1 rejected, matching the original Phase 3/4 stub run) → approved/rejected a mix of tiers with a rejection note → manager-profile AI run correctly returned `changed:false` before any decisions existed and `changed:true` with a learned pattern after them → manual edit via `PUT /api/manager-profile` confirmed to win and persist → self-improvement run stored exactly 1 tagged Tier-3 proposal from the stale-pending-proposals evidence → Obsidian notes for both (`exports/manager/نمط-إدارة-عبدالله.md`, the new proposal's `exports/proposals/T3-*.md`) confirmed written with correct content. Backend and frontend `build`/`lint` both clean. **Not yet verified against real data** — same external blockers as Phases 2-4 (Anthropic billing, platform per-client endpoints, real n8n instance); per Abdulla's instruction, that verification is deferred until he resolves those bottlenecks.
- [ ] Phase 5 — deployment + QA + docs
