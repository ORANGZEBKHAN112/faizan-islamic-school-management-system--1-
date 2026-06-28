$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$out = Join-Path $root "fiss-erp-smarterasp.zip"

if (Test-Path $out) { Remove-Item $out -Force }

$exclude = @(
  ".git", ".cursor", "Frontend", "Frontend\node_modules",
  "Backend\bin", "Backend\obj", "qa-output\screenshots",
  "fiss-erp-deploy.zip", "fiss-erp-smarterasp.zip"
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
  Write-Host "Upload this zip to SmarterASP, unzip into the site root, and make sure NodeJS is enabled for the site."
  Write-Host "If the site still returns 500, check the generated node-stdout log files in the site root."
} finally {
  Pop-Location
}
