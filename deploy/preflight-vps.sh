#!/usr/bin/env bash
# Phase 0 — VPS purchase checklist (run on your PC before ordering)
set -euo pipefail

cat <<'EOF'
================================================================================
FISS ERP — VPS purchase checklist (Pakistan go-live)
================================================================================

Order a Linux VPS with:
  - Ubuntu 22.04 or 24.04 LTS
  - 1 vCPU, 2 GB RAM, 40 GB SSD (minimum)
  - Budget: about $4–8/month

Suggested providers (pick one):
  - Hostinger VPS (easy payments from Pakistan)
  - Contabo / Hetzner (cheap EU)
  - DigitalOcean / Vultr Singapore (better Asia latency)

After purchase, save these values:
  1. VPS public IP address ................. (for DNS + SQL firewall)
  2. SSH user (root or sudo user) .......... 
  3. SSH private key or password ......... 

Next steps on the VPS (in order):
  1. bash deploy/sql-connect-test.sh YOUR_SQL_HOST
  2. bash deploy/setup-vps.sh
  3. Upload/clone app to /var/www/fiss-erp, copy deploy/env.production.example → .env
  4. bash deploy/deploy-app.sh
  5. bash deploy/install-pm2.sh
  6. bash deploy/install-nginx.sh erp.yourdomain.com
  7. bash deploy/go-live-checklist.sh https://erp.yourdomain.com

================================================================================
EOF
