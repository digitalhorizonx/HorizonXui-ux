# Runbook — deploy the HorizonX Agentic OS to cs.horizonx.site

Audience: Abdulla, executed on the VPS over SSH. Claude Code cannot reach the
VPS from its sandbox, so these commands are run by you. Nothing is "live" until
step 8 verification passes.

Current state discovered on 2026-07-09: `cs.horizonx.site` serves an old
Angular/Bootstrap app (title "Frontend") behind Cloudflare. Step 2 backs it up
and removes it, per your instruction to clean the subdomain.

## 0. Prerequisites on the VPS

- Ubuntu/Debian with nginx
- Node.js ≥ 20 (`node --version`)
- git with access to `digitalhorizonx/HorizonXui-ux`

## 1. Find what currently serves cs.horizonx.site

```bash
grep -rl "cs.horizonx.site" /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null
# note the config file and its root/proxy_pass — that's the old app
```

## 2. Back up, then clean the old app (destructive — backup first)

```bash
# backup old web root (adjust path from step 1) + old nginx config
OLD_ROOT=/var/www/old-app        # <- replace with the real root from step 1
tar czf ~/cs-horizonx-backup-$(date +%F).tar.gz "$OLD_ROOT" /etc/nginx/sites-available/ 2>/dev/null
# disable the old site (keep the file in sites-available as a second backup)
rm /etc/nginx/sites-enabled/<old-config-name>
# if the old app runs as a service/container, stop it:
#   systemctl list-units | grep -i <name>   /   docker ps
```

## 3. Clone this repo

```bash
sudo mkdir -p /opt/horizonx-assistant && cd /opt/horizonx-assistant
git clone https://github.com/digitalhorizonx/HorizonXui-ux.git .
git checkout claude/horizonx-agentic-os-setup-dc4hs1
```

## 4. Configure environment (secrets never leave the VPS)

```bash
cd /opt/horizonx-assistant/backend
cp .env.example .env
npm ci   # needed before generating the hash below

# generate the admin password hash (replace your-strong-password):
node -e "require('bcryptjs').hash(process.argv[1], 12).then(console.log)" 'your-strong-password'
# generate the session secret:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

nano .env   # fill in: ADMIN_PASSWORD_HASH, SESSION_SECRET, PORT=3000,
            # PLATFORM_BASE_URL=https://claude.horizonx.site and REPORT_API_KEY
            # (the Agent Reports API key — keep it only in this file on the VPS)
```

## 5. Build and migrate

```bash
cd /opt/horizonx-assistant/backend && npx prisma migrate deploy && npm run build
cd /opt/horizonx-assistant/frontend && npm ci && npm run build
```

## 6. Install the service and nginx config

```bash
cp /opt/horizonx-assistant/deploy/horizonx-assistant.service /etc/systemd/system/
chown -R www-data:www-data /opt/horizonx-assistant
systemctl daemon-reload && systemctl enable --now horizonx-assistant
systemctl status horizonx-assistant   # must be active (running)

cp /opt/horizonx-assistant/deploy/nginx-cs.horizonx.site.conf /etc/nginx/sites-available/cs.horizonx.site
# TLS: install a Cloudflare Origin Certificate at the paths in the config
# (Cloudflare dashboard -> SSL/TLS -> Origin Server), or use certbot.
ln -s /etc/nginx/sites-available/cs.horizonx.site /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

## 7. Backups (SQLite file + exports)

```bash
crontab -e   # add:
# 0 4 * * * tar czf /root/backups/horizonx-assistant-$(date +\%F).tar.gz /opt/horizonx-assistant/backend/prisma/data /opt/horizonx-assistant/exports 2>/dev/null
```

## 8. Verify (the deployment is not done until these pass)

```bash
curl https://cs.horizonx.site/healthz      # expect {"ok":true,"db":"up"}
```

Then open `https://cs.horizonx.site` in a browser: the Arabic login page must
appear; log in with your password; the dashboard must load.

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
