#!/usr/bin/env bash
# Build-and-restart script for the HorizonX Agentic OS on the VPS.
# Run as root (or with sudo) from /opt/horizonx-assistant after the first-time
# setup in docs/runbook-deploy-cs.md has been completed.
set -euo pipefail

APP_DIR=/opt/horizonx-assistant
BRANCH=claude/horizonx-agentic-os-setup-dc4hs1

cd "$APP_DIR"
echo "==> Pulling latest $BRANCH"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull origin "$BRANCH"

echo "==> Backend: install, migrate, build"
cd "$APP_DIR/backend"
npm ci
npx prisma migrate deploy
npm run build

echo "==> Frontend: install, build"
cd "$APP_DIR/frontend"
npm ci
npm run build

echo "==> Restarting service"
systemctl restart horizonx-assistant
sleep 2
systemctl --no-pager --lines=5 status horizonx-assistant

echo "==> Health check"
curl -fsS http://127.0.0.1:3000/healthz && echo
echo "==> Done. Verify from outside: curl https://cs.horizonx.site/healthz"
