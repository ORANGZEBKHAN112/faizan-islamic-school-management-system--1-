#!/usr/bin/env bash
set -euo pipefail

# One-shot SQL Server bootstrap for the active Express app.
# Usage:
#   bash Database/install_fresh_seed.sh
# Optional env overrides:
#   DB_NAME=FaizanIslamicSchool
#   SQL_CONTAINER=fiss-sql
#   SQL_USER=sa
#   SQL_PASSWORD='YourStrongPassword!'

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_NAME="${DB_NAME:-FaizanIslamicSchool}"
SQL_CONTAINER="${SQL_CONTAINER:-fiss-sql}"
SQL_USER="${SQL_USER:-sa}"
SQL_PASSWORD="${SQL_PASSWORD:-FaizanSql@2026!}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required but not installed."
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$SQL_CONTAINER"; then
  echo "SQL Server container '$SQL_CONTAINER' is not running."
  exit 1
fi

SQLCMD_PATH=""
if docker exec "$SQL_CONTAINER" test -x /opt/mssql-tools18/bin/sqlcmd; then
  SQLCMD_PATH="/opt/mssql-tools18/bin/sqlcmd"
elif docker exec "$SQL_CONTAINER" test -x /opt/mssql-tools/bin/sqlcmd; then
  SQLCMD_PATH="/opt/mssql-tools/bin/sqlcmd"
else
  echo "sqlcmd was not found inside container '$SQL_CONTAINER'."
  exit 1
fi

run_sql() {
  docker exec -i "$SQL_CONTAINER" "$SQLCMD_PATH" -I -S localhost -U "$SQL_USER" -P "$SQL_PASSWORD" -C
}

echo "==> Dropping database '$DB_NAME' if it exists..."
printf "IF DB_ID(N'%s') IS NOT NULL BEGIN ALTER DATABASE [%s] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [%s]; END\nGO\n" "$DB_NAME" "$DB_NAME" "$DB_NAME" | run_sql

echo "==> Creating database '$DB_NAME'..."
printf "IF DB_ID(N'%s') IS NULL BEGIN CREATE DATABASE [%s]; END\nGO\nUSE [%s];\nGO\n" "$DB_NAME" "$DB_NAME" "$DB_NAME" | run_sql

echo "==> Applying schema..."
(
  printf "SET ANSI_NULLS ON\nGO\nSET QUOTED_IDENTIFIER ON\nGO\n"
  sed "s/FaizanIslamicSchool/${DB_NAME}/g" "$ROOT_DIR/Database/schema.sql"
) | run_sql

echo "==> Seeding default users and QuickPay config..."
sed "s/USE FaizanIslamicSchool;/USE ${DB_NAME};/" "$ROOT_DIR/Database/02_seed_users_roles.sql" | run_sql

echo "==> Current tables:"
printf "USE [%s];\nGO\nSELECT name FROM sys.tables ORDER BY name;\nGO\n" "$DB_NAME" | run_sql

cat <<EOF

Database bootstrap complete.

Default users:
  admin / admin123
  superadmin / superadmin123
  accountant / accountant123
  teacher / teacher123
  campusadmin / campusadmin123

Make sure your app .env uses:
  SQL_SERVER=127.0.0.1
  SQL_PORT=1433
  SQL_DATABASE=$DB_NAME
  SQL_USER=$SQL_USER
  SQL_PASSWORD=$SQL_PASSWORD
EOF
