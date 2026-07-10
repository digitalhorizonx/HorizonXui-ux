# Runbook — deploy the HorizonX Agentic OS to cs.horizonx.site

Audience: Abdulla, executed on the VPS over SSH. Claude Code cannot reach the
VPS from its sandbox, so these commands are run by you.

**Verified live on 2026-07-10**: full loop (login → dashboard → manual sync →
real production numbers) confirmed working at `https://cs.horizonx.site`.
Steps below reflect what actually worked on that server.

## 0. Prerequisites on the VPS

- Ubuntu/Debian with nginx
- Node.js ≥ 20 (`node --version`)
- git with access to `digitalhorizonx/HorizonXui-ux`

## 1. Find what currently serves cs.horizonx.site

```bash
ls -la /etc/nginx/sites-enabled/
```

`grep -rl` on `sites-enabled/` will **not** find it — those are symlinks and
`grep -r` doesn't follow them by default. List the directory instead, then:

```bash
cat /etc/nginx/sites-available/cs.horizonx.site
```

Note the `proxy_pass` target (e.g. `http://127.0.0.1:8800`) — that's the old
app. On the 2026-07-10 deployment this nginx site already had a valid
Certbot-managed TLS certificate; the app behind it turned out to be a Docker
container. Find it:

```bash
docker ps --filter "publish=<port-from-proxy_pass>"
```

If instead the domain doesn't appear under `sites-available` at all, it may be
routed through a Cloudflare Tunnel (check for a running `cloudflared` process
and `/etc/cloudflared/`) — routing rules for a remotely-managed tunnel live in
the Cloudflare Zero Trust dashboard, not on disk.

## 2. Stop the old app (reversible — do this only after step 6 passes)

Prefer **stopping** over deleting — it's fully reversible with `docker start
<name>` (find the container's compose project with `docker inspect <name>
--format '{{.Config.Labels}}'` if you ever need to fully recreate it):

```bash
docker stop <old-container-name>
```

Do this step **last**, right before the final nginx flip in step 6 — install
and verify the new app first (steps 3–5) so the old app keeps serving traffic
until the new one is proven healthy, minimizing downtime.

## 3. Clone this repo

```bash
mkdir -p /opt/horizonx-assistant
git clone https://github.com/digitalhorizonx/HorizonXui-ux.git /opt/horizonx-assistant
cd /opt/horizonx-assistant && git checkout claude/horizonx-agentic-os-setup-dc4hs1
```

## 4. Configure environment (secrets never leave the VPS)

```bash
cd /opt/horizonx-assistant/backend
npm ci
cp .env.example .env

# generate the admin password hash (replace your-strong-password):
node -e "require('bcryptjs').hash(process.argv[1], 12).then(console.log)" 'your-strong-password'
# generate the session secret:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

nano .env   # fill in: ADMIN_PASSWORD_HASH, SESSION_SECRET, PORT=3000,
            # PLATFORM_BASE_URL=https://claude.horizonx.site and REPORT_API_KEY
            # (the Agent Reports API key — keep it only in this file on the VPS)
```

## 5. Build, migrate, and run as a service

```bash
cd /opt/horizonx-assistant/backend && npx prisma migrate deploy && npm run build
cd /opt/horizonx-assistant/frontend && npm ci && npm run build

mkdir -p /opt/horizonx-assistant/exports   # required — the systemd unit's
                                            # ReadWritePaths fails to start
                                            # (226/NAMESPACE) if this is missing

cp /opt/horizonx-assistant/deploy/horizonx-assistant.service /etc/systemd/system/
chown -R www-data:www-data /opt/horizonx-assistant
systemctl daemon-reload && systemctl enable --now horizonx-assistant
systemctl status horizonx-assistant   # must say active (running)

curl http://127.0.0.1:3000/healthz    # expect {"ok":true,"db":"up"} — go/no-go
                                       # checkpoint before touching nginx
```

## 6. Point nginx at the new app, then retire the old one

If an nginx site with a working TLS cert already exists for the domain (the
2026-07-10 case), **edit it in place** rather than installing
`deploy/nginx-cs.horizonx.site.conf` (that file is a fallback for a domain
with no existing nginx site/cert at all):

```bash
sed -i 's/proxy_pass http:\/\/127.0.0.1:<old-port>;/proxy_pass http:\/\/127.0.0.1:3000;/' /etc/nginx/sites-available/cs.horizonx.site
nginx -t && systemctl reload nginx
curl https://cs.horizonx.site/healthz   # expect {"ok":true,"db":"up"}
```

Once that's confirmed, stop the old app (step 2):

```bash
docker stop <old-container-name>
curl -s -o /dev/null -w "%{http_code}\n" https://cs.horizonx.site/healthz   # still 200
```

## 7. Backups (SQLite file + exports)

Append to the existing crontab non-interactively (safer than `crontab -e` —
an interactive editor session can accidentally glue a new line onto an
existing comment line, silently disabling it):

```bash
(crontab -l 2>/dev/null; echo '0 4 * * * mkdir -p /root/backups && tar czf /root/backups/horizonx-assistant-$(date +\%F).tar.gz /opt/horizonx-assistant/backend/prisma/data /opt/horizonx-assistant/exports 2>/dev/null') | crontab -
crontab -l   # verify the new line is on its own row, not appended to a comment
```

## 8. Verify (the deployment is not done until these pass)

```bash
curl https://cs.horizonx.site/healthz      # expect {"ok":true,"db":"up"}
```

Then open `https://cs.horizonx.site` in a browser: the Arabic login page must
appear; log in with your password; the dashboard must load; clicking
"مزامنة الآن" must populate the four metric cards with real numbers.

## Platform API status (updated 2026-07-10)

The Agent Reports API is **live**: `GET /api/agent-reports/overview` and
`GET /api/agent-reports/health` on `https://claude.horizonx.site`, with the
`X-Report-Key` header. A real sync was verified against it on 2026-07-10.

Known gap: the overview has no per-client list and there is no per-client
context endpoint yet, so `clients_cache` stays empty. Phase 2 (client
intelligence profiles) needs a per-client endpoint added in the platform repo.

## Updates after the first deployment

```bash
cd /opt/horizonx-assistant && sudo bash deploy/deploy.sh
```

### Phase 2 (client intelligence) — one-time additions

Before or after running deploy.sh for the Phase 2 update:

```bash
nano /opt/horizonx-assistant/backend/.env
# set: ANTHROPIC_API_KEY=sk-ant-...      (from console.anthropic.com)
# optionally adjust: AI_BUDGET_USD=10    (monthly cap; calls stop + banner when exceeded)
systemctl restart horizonx-assistant
```

Phase 2's nightly jobs (03:00 profile updates, 03:30 export) only produce real
profiles once the platform exposes per-client data:
`GET /api/agent-reports/clients` (list) and
`GET /api/agent-reports/clients/:organizationId/context` (history/revisions).
Until then the clients page shows an explanatory empty state.
