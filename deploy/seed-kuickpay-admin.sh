#!/usr/bin/env bash
# Recreate Kuickpay Admin role + fee-desk user (usr-kuickpay-admin / kuickpay).
# Run on VPS: bash deploy/seed-kuickpay-admin.sh
set -euo pipefail

APP_DIR="${FISS_APP_DIR:-/var/www/fiss-erp}"
cd "$APP_DIR"

ENV_FILE="$APP_DIR/.env"
touch "$ENV_FILE"

if grep -q '^FORCE_RESET_KUICKPAY=' "$ENV_FILE" 2>/dev/null; then
  sed -i 's/^FORCE_RESET_KUICKPAY=.*/FORCE_RESET_KUICKPAY=1/' "$ENV_FILE"
else
  echo 'FORCE_RESET_KUICKPAY=1' >> "$ENV_FILE"
fi

echo "==> Restarting app to seed Kuickpay Admin user..."
pm2 restart fiss-erp --update-env
sleep 5
pm2 logs fiss-erp --lines 15 --nostream | grep -i kuickpay || true

sed -i '/^FORCE_RESET_KUICKPAY=1$/d' "$ENV_FILE"
pm2 restart fiss-erp --update-env

cat <<'EOF'

Done. Login credentials (change password after first login if policy requires):
  Username: kuickpay
  Password: Kuickpay@123
  Role:     Kuickpay Admin

Rights: Fees (generate, pay, vouchers), Reports (view), Kuickpay setup, Students (view).
EOF
