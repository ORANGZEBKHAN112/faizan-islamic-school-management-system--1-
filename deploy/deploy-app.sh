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
# msnodesqlv8 is optionalDependencies (Windows LocalDB). On Linux it may warn/fail to build — that is OK.
npm ci

# Vite needs write access under node_modules/.vite-temp and empties dist/ before build.
# Root-owned files from a prior sudo npm/build cause EACCES for erp_dev.
ensure_writable_dir() {
  local dir="$1"
  mkdir -p "$dir" 2>/dev/null || true
  if [[ ! -w "$dir" ]] || ! touch "$dir/.write-test" 2>/dev/null; then
    echo "$dir is not writable by $(whoami). Fix with:"
    echo "  sudo chown -R \"$(whoami):$(whoami)\" \"$APP_DIR\""
    echo "  # or narrowly: sudo chown -R \"$(whoami):$(whoami)\" \"$dir\""
    exit 1
  fi
  rm -f "$dir/.write-test"
}

echo "==> Ensuring Vite temp + dist are writable by $(whoami)..."
ensure_writable_dir "$APP_DIR/node_modules"
ensure_writable_dir "$APP_DIR/node_modules/.vite-temp"
if [[ -d dist ]]; then
  ensure_writable_dir "$APP_DIR/dist"
fi

echo "==> Building frontend..."
# Keep NODE_ENV out of .env for Vite; production mode is the default for `vite build`.
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
