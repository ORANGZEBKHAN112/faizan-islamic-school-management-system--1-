#!/usr/bin/env bash
# Phase 6 — Post go-live automated checks + manual reminders
set -euo pipefail

BASE_URL="${1:-http://127.0.0.1:3000}"
BASE_URL="${BASE_URL%/}"

echo "==> FISS ERP go-live checklist"
echo "    Base URL: $BASE_URL"
echo

FAIL=0

check() {
  local name="$1"
  local url="$2"
  local expect="$3"
  if curl -fsS "$url" | grep -qi "$expect"; then
    echo "[OK] $name"
  else
    echo "[FAIL] $name — $url"
    FAIL=1
  fi
}

check "Health endpoint" "$BASE_URL/api/health" "connected\|ok\|status"
check "Login page" "$BASE_URL/login" "html\|root\|FISS"
check "Public apply" "$BASE_URL/apply" "html\|admission\|apply"
check "Public track" "$BASE_URL/track" "html\|track"

echo
cat <<EOF
Manual steps (complete in the admin UI):
  [ ] Log in as admin and CHANGE default password (admin123)
  [ ] Disable demo users if not needed (teacher, accountant, campusadmin)
  [ ] Take SQL Server backup of production database
  [ ] Backup folder: wwwroot/uploads/ (student photos, admission docs)
  [ ] QuickPay callback URL: ${BASE_URL}/api/payments/quickpay-callback
  [ ] Test Principal login, student portal, admissions workflow

Update app later:
  cd /var/www/fiss-erp && git pull && npm ci && npm run build && pm2 restart fiss-erp
EOF

if [[ "$FAIL" -ne 0 ]]; then
  echo
  echo "Some automated checks failed — fix before announcing go-live."
  exit 1
fi

echo
echo "Automated checks passed."
