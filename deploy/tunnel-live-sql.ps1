# Open an SSH tunnel so local npm can use the VPS live SQL (127.0.0.1 on the server).
# Local port 14333 → VPS localhost:1433 (avoids conflict with any local SQL on 1433).
#
# Usage:
#   powershell -File deploy/tunnel-live-sql.ps1
#   powershell -File deploy/tunnel-live-sql.ps1 -VpsHost 51.79.177.9 -User erp_dev
#
# Keep this window open while developing. Then run: npm run dev

param(
  [string]$VpsHost = "51.79.177.9",
  [string]$User = "erp_dev",
  [int]$LocalPort = 14333,
  [int]$RemotePort = 1433
)

Write-Host "Tunnel: 127.0.0.1:$LocalPort  ->  ${User}@${VpsHost}:$RemotePort (VPS localhost)" -ForegroundColor Cyan
Write-Host "Keep this window open. In another terminal run: npm run dev" -ForegroundColor Yellow
Write-Host "Press Ctrl+C to stop the tunnel." -ForegroundColor DarkGray
Write-Host ""

ssh -N -L "${LocalPort}:127.0.0.1:${RemotePort}" "${User}@${VpsHost}"
