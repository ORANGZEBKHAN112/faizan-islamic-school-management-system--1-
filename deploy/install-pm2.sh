#!/usr/bin/env bash
# Phase 4 — Start / restart app with PM2
set -euo pipefail

APP_DIR="${FISS_APP_DIR:-/var/www/fiss-erp}"
export FISS_APP_DIR="$APP_DIR"
cd "$APP_DIR"

sudo mkdir -p /var/log/fiss-erp
sudo chown -R "$USER:$USER" /var/log/fiss-erp

if pm2 describe fiss-erp >/dev/null 2>&1; then
  echo "==> Restarting fiss-erp..."
  pm2 restart deploy/pm2/ecosystem.config.cjs --update-env
else
  echo "==> Starting fiss-erp..."
  pm2 start deploy/pm2/ecosystem.config.cjs
fi

pm2 save

if ! pm2 startup systemd -u "$USER" --hp "$HOME" 2>/dev/null | grep -q "already"; then
  echo "Run the command printed below if this is first install:"
  pm2 startup systemd -u "$USER" --hp "$HOME" | tail -1
fi

sleep 3
curl -fsS "http://127.0.0.1:3000/api/health" && echo ""
echo "PM2 status:"
pm2 status fiss-erp
