#!/usr/bin/env bash
# Phase 3 — Build app and verify /api/health (run from app root on VPS)
set -euo pipefail

APP_DIR="${FISS_APP_DIR:-/var/www/fiss-erp}"
cd "$APP_DIR"

if [[ ! -f .env ]]; then
  echo "Missing .env — copy deploy/env.production.example to .env and fill SQL + JWT_SECRET"
  exit 1
fi

if ! grep -q '^JWT_SECRET=.' .env || grep -q 'change-me-to-a-long-random-string' .env; then
  echo "Set a strong JWT_SECRET in .env before production deploy"
  exit 1
fi

echo "==> Installing dependencies..."
npm ci

echo "==> Building frontend..."
npm run build

echo "==> Type-check..."
npm run lint

echo "==> Smoke test (start server briefly)..."
export NODE_ENV=production
set -a
# shellcheck disable=SC1091
source .env
set +a

npx tsx server.ts &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT

for i in {1..30}; do
  if curl -fsS "http://127.0.0.1:${PORT:-3000}/api/health" >/tmp/fiss-health.json 2>/dev/null; then
    echo "Health response:"
    cat /tmp/fiss-health.json
    echo ""
    if grep -qi '"db".*"connected"' /tmp/fiss-health.json 2>/dev/null || grep -qi 'connected' /tmp/fiss-health.json; then
      echo "Deploy build OK — database connected."
      kill $SERVER_PID 2>/dev/null || true
      exit 0
    fi
    echo "WARNING: Server started but DB may not be connected. Check SQL_* in .env"
    kill $SERVER_PID 2>/dev/null || true
    exit 1
  fi
  sleep 2
done

echo "ERROR: Server did not respond on /api/health within 60s"
exit 1
