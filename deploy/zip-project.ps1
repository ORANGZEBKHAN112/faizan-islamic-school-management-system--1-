# Zip project for WinSCP upload (excludes node_modules, dist, .env)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$out = Join-Path $root "fiss-erp-deploy.zip"

if (Test-Path $out) { Remove-Item $out -Force }

$exclude = @(
  "node_modules", "dist", ".git", "Frontend", "Frontend\node_modules",
  "Backend\bin", "Backend\obj", ".cursor", "qa-output\screenshots"
)

Push-Location $root
try {
  $files = Get-ChildItem -Recurse -File | Where-Object {
    $rel = $_.FullName.Substring($root.Length + 1)
    $skip = $false
    foreach ($e in $exclude) {
      if ($rel -like "$e*" -or $rel -like "*\$e\*") { $skip = $true; break }
    }
    if ($rel -like ".env" -or $rel -like ".env.*") { $skip = $true }
    -not $skip
  }
  Compress-Archive -Path ($files | ForEach-Object { $_.FullName }) -DestinationPath $out -CompressionLevel Optimal
  Write-Host "Created: $out"
  Write-Host "Upload to VPS /var/www/fiss-erp and unzip, then copy deploy/env.production.example to .env"
} finally {
  Pop-Location
}
