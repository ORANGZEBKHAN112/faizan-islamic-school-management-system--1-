#!/usr/bin/env bash
# Phase 2 — One-time VPS setup (Ubuntu 22.04/24.04)
set -euo pipefail

APP_DIR="${FISS_APP_DIR:-/var/www/fiss-erp}"
LOG_DIR="/var/log/fiss-erp"

echo "==> Updating system packages..."
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -qq

echo "==> Installing Node.js 20..."
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node -v
npm -v

echo "==> Installing Nginx, Git, Certbot, build tools..."
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
  nginx git certbot python3-certbot-nginx netcat-openbsd ufw

echo "==> Installing PM2 globally..."
sudo npm install -g pm2

echo "==> Creating app and log directories..."
sudo mkdir -p "$APP_DIR" "$LOG_DIR" "$APP_DIR/wwwroot/uploads/students" "$APP_DIR/wwwroot/uploads/admissions"
sudo chown -R "$USER:$USER" "$APP_DIR" "$LOG_DIR"

echo "==> Configuring firewall (SSH + Nginx)..."
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
echo "y" | sudo ufw enable || true

echo ""
echo "VPS setup complete."
echo "  App directory: $APP_DIR"
echo "  Next: clone/upload project into $APP_DIR, copy deploy/env.production.example to .env, then run deploy/deploy-app.sh"
