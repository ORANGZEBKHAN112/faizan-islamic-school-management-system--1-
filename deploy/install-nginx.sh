#!/usr/bin/env bash
# Phase 5 — Nginx reverse proxy + optional Let's Encrypt SSL
set -euo pipefail

DOMAIN="${1:-}"
APP_DIR="${FISS_APP_DIR:-/var/www/fiss-erp}"

if [[ -z "$DOMAIN" ]]; then
  echo "Usage: bash deploy/install-nginx.sh your.domain.com"
  echo "Example: bash deploy/install-nginx.sh erp.faizan.edu.pk"
  exit 1
fi

CONF_SRC="$APP_DIR/deploy/nginx/fiss-erp.conf"
CONF_DST="/etc/nginx/sites-available/fiss-erp"

if [[ ! -f "$CONF_SRC" ]]; then
  echo "Missing $CONF_SRC — run from deployed app directory"
  exit 1
fi

echo "==> Installing Nginx site for $DOMAIN ..."
sudo sed "s/erp.example.com/${DOMAIN}/g" "$CONF_SRC" | sudo tee "$CONF_DST" >/dev/null
sudo ln -sf "$CONF_DST" /etc/nginx/sites-enabled/fiss-erp
sudo rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
sudo nginx -t
sudo systemctl reload nginx

echo "==> HTTP proxy ready at http://${DOMAIN}"
read -r -p "Run Let's Encrypt SSL now? [y/N] " SSL_CHOICE
if [[ "${SSL_CHOICE,,}" == "y" ]]; then
  sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email || \
    sudo certbot --nginx -d "$DOMAIN"
  echo "HTTPS enabled at https://${DOMAIN}"
else
  echo "Skip SSL for now. Run later: sudo certbot --nginx -d ${DOMAIN}"
fi

echo "Done. Users should open: https://${DOMAIN}/login"
