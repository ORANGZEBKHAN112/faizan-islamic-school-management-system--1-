# Open an SSH tunnel so local npm can use the VPS live SQL (127.0.0.1 on the server).
# Local port 14333 → VPS localhost:1433 (avoids conflict with any local SQL on 1433).
#
# Usage:
#   powershell -File deploy/tunnel-live-sql.ps1
#   powershell -File deploy/tunnel-live-sql.ps1 -VpsHost 51.79.177.9 -User erp_dev
#
# Keep this window open while developing. Then run: npm run dev
#
# In .env for tunnel dev:
#   SQL_SERVER=127.0.0.1
#   SQL_PORT=14333   (same as -LocalPort below)
#   SQL_ENCRYPT=false
#   SQL_TRUST_SERVER_CERTIFICATE=true
# Do not use SQL_PORT=1433 unless you intend local SQL Server, not live DB.

param(
  [string]$VpsHost = "51.79.177.9",
  [string]$User = "erp_dev",
  # Must match SQL_SERVER on the VPS .env (often 127.0.0.1 OR a remote SQL IP)
  [string]$RemoteSqlHost = "127.0.0.1",
  [int]$LocalPort = 14333,
  [int]$RemotePort = 1433
)

Write-Host "Tunnel: 127.0.0.1:$LocalPort  ->  ${RemoteSqlHost}:$RemotePort via ${User}@${VpsHost}" -ForegroundColor Cyan
Write-Host "Keep this window open. In another terminal run: npm run dev" -ForegroundColor Yellow
Write-Host "Press Ctrl+C to stop the tunnel." -ForegroundColor DarkGray
Write-Host ""

ssh -N -L "${LocalPort}:${RemoteSqlHost}:${RemotePort}" "${User}@${VpsHost}"
