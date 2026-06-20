#!/usr/bin/env bash
# Full deploy sequence (after VPS is ready and .env exists)
set -euo pipefail

APP_DIR="${FISS_APP_DIR:-/var/www/fiss-erp}"
DOMAIN="${1:-}"

cd "$APP_DIR"

bash deploy/deploy-app.sh
bash deploy/install-pm2.sh

if [[ -n "$DOMAIN" ]]; then
  bash deploy/install-nginx.sh "$DOMAIN"
  bash deploy/go-live-checklist.sh "https://${DOMAIN}"
else
  bash deploy/go-live-checklist.sh "http://127.0.0.1:3000"
  echo "No domain passed — for public access run: bash deploy/install-nginx.sh your.domain.com"
fi
