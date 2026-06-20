#!/usr/bin/env bash
# Phase 1 — Test TCP reachability to live SQL Server from this VPS
set -euo pipefail

SQL_HOST="${1:-}"
SQL_PORT="${2:-1433}"

if [[ -z "$SQL_HOST" ]]; then
  echo "Usage: bash deploy/sql-connect-test.sh SQL_HOST [SQL_PORT]"
  echo "Example: bash deploy/sql-connect-test.sh 51.79.177.9 1433"
  exit 1
fi

echo "Testing connection to ${SQL_HOST}:${SQL_PORT} ..."
echo "VPS public IP (give this to SQL host for firewall whitelist):"
curl -fsS https://api.ipify.org 2>/dev/null || curl -fsS https://ifconfig.me 2>/dev/null || echo "(could not detect — run: curl ifconfig.me)"
echo

if command -v nc >/dev/null 2>&1; then
  if nc -z -w 5 "$SQL_HOST" "$SQL_PORT" 2>/dev/null; then
    echo "OK — port ${SQL_PORT} is reachable on ${SQL_HOST}."
    echo "You can proceed with deploy/deploy-app.sh after configuring .env"
    exit 0
  fi
elif command -v telnet >/dev/null 2>&1; then
  if timeout 5 bash -c "echo quit | telnet $SQL_HOST $SQL_PORT" 2>&1 | grep -qi connected; then
    echo "OK — port appears open."
    exit 0
  fi
else
  sudo apt-get update -qq && sudo apt-get install -y netcat-openbsd
  exec bash "$0" "$SQL_HOST" "$SQL_PORT"
fi

echo "FAILED — cannot reach ${SQL_HOST}:${SQL_PORT}"
cat <<EOF

Ask your SQL Server host to:
  1. Allow inbound TCP ${SQL_PORT} from this VPS public IP
  2. Enable SQL Server remote connections
  3. Confirm SQL login has access to your production database

Then re-run: bash deploy/sql-connect-test.sh ${SQL_HOST} ${SQL_PORT}
EOF
exit 1
