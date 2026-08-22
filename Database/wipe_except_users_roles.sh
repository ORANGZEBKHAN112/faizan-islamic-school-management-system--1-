#!/usr/bin/env bash
# Wipe LIVE Docker SQL on this VPS — keeps Users / AppRoles / AppRolePermissions
# Run on VPS inside /var/www/fiss-erp:
#   bash Database/wipe_except_users_roles.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "Missing .env in $ROOT"
  exit 1
fi

# shellcheck disable=SC1091
set -a
source .env
set +a

DB="${SQL_DATABASE:-FaizanIslamicSchool}"
USER="${SQL_USER:-sa}"
PASS="${SQL_PASSWORD:-}"
CONTAINER="${SQL_DOCKER_CONTAINER:-fiss-sql}"

if [[ -z "$PASS" ]]; then
  echo "SQL_PASSWORD missing in .env"
  exit 1
fi

echo "About to WIPE database: $DB on docker container: $CONTAINER"
echo "Keeping: Users, AppRoles, AppRolePermissions"
read -r -p "Type YES to continue: " CONFIRM
if [[ "$CONFIRM" != "YES" ]]; then
  echo "Cancelled."
  exit 0
fi

SQLCMD18="/opt/mssql-tools18/bin/sqlcmd"
SQLCMD="/opt/mssql-tools/bin/sqlcmd"

run_sql() {
  if docker exec "$CONTAINER" test -x "$SQLCMD18"; then
    docker exec -i "$CONTAINER" "$SQLCMD18" -S localhost -U "$USER" -P "$PASS" -C -d "$DB"
  else
    docker exec -i "$CONTAINER" "$SQLCMD" -S localhost -U "$USER" -P "$PASS" -d "$DB"
  fi
}

echo "Running wipe..."
cat Database/wipe_except_users_roles.sql | run_sql

echo "Done."
echo "Restart app if needed: pm2 restart fiss-erp"
