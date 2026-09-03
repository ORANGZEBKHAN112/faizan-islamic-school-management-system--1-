#!/usr/bin/env bash
# Phase 4 — Start / restart app with PM2
set -euo pipefail

APP_DIR="${FISS_APP_DIR:-/var/www/fiss-erp}"
export FISS_APP_DIR="$APP_DIR"
cd "$APP_DIR"

sudo mkdir -p /var/log/fiss-erp
sudo chown -R "$USER:$USER" /var/log/fiss-erp

PORT="${PORT:-3000}"
echo "==> Ensuring port ${PORT} is free..."
pm2 stop fiss-erp >/dev/null 2>&1 || true
# Kill any leftover Node process still bound to PORT (common after crash loops)
if command -v fuser >/dev/null 2>&1; then
  sudo fuser -k "${PORT}/tcp" >/dev/null 2>&1 || true
elif command -v lsof >/dev/null 2>&1; then
  PIDS=$(sudo lsof -t -iTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null || true)
  if [[ -n "${PIDS}" ]]; then
    # shellcheck disable=SC2086
    sudo kill -9 ${PIDS} || true
  fi
fi
sleep 1

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
