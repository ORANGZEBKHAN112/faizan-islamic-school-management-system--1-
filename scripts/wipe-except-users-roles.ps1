# Wipe LIVE/local SQL Server data EXCEPT Users + AppRoles + AppRolePermissions
# Run from project root, or double-click / right-click → Run with PowerShell
#
# Example:
#   .\scripts\wipe-except-users-roles.ps1
#   .\scripts\wipe-except-users-roles.ps1 -UseAppSettings
#   .\scripts\wipe-except-users-roles.ps1 -Server "YOUR_HOST" -Database "YOUR_DB" -User "sa" -Password "YOUR_PASS"

param(
  [string]$Server = "",
  [string]$Database = "",
  [string]$User = "",
  [string]$Password = "",
  [int]$Port = 1433,
  [switch]$UseAppSettings,
  [switch]$Yes
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $Root "package.json"))) {
  $Root = (Get-Location).Path
}
Set-Location $Root

Write-Host ""
Write-Host "=== Faizan ERP — Wipe DB (keep Users / Roles / Permissions) ===" -ForegroundColor Cyan
Write-Host "Project: $Root"
Write-Host ""

if ($UseAppSettings) {
  $env:TARGET = "live"
  Write-Host "Using Backend\FaizanIslamicSchool.WebApi\appsettings.json connection" -ForegroundColor Yellow
} elseif ($Server -and $Database) {
  $env:TARGET = "custom"
  $env:SQL_SERVER = $Server
  $env:SQL_DATABASE = $Database
  $env:SQL_PORT = "$Port"
  $env:SQL_USER = $User
  $env:SQL_PASSWORD = $Password
  $env:SQL_ENCRYPT = "true"
  $env:SQL_TRUST_SERVER_CERTIFICATE = "true"
  $env:SQL_TRUSTED_CONNECTION = "false"
  Remove-Item Env:SQL_DRIVER -ErrorAction SilentlyContinue
  Write-Host "Using custom connection: $Server / $Database" -ForegroundColor Yellow
} else {
  Write-Host "No -Server/-Database and no -UseAppSettings." -ForegroundColor Yellow
  Write-Host "You can:"
  Write-Host "  1) Enter live SQL details now"
  Write-Host "  2) Use appsettings.json (TARGET=live)"
  Write-Host "  3) Cancel"
  $choice = Read-Host "Choose 1 / 2 / 3"
  if ($choice -eq "2") {
    $env:TARGET = "live"
  } elseif ($choice -eq "1") {
    $env:TARGET = "custom"
    $env:SQL_SERVER = Read-Host "SQL_SERVER (e.g. 51.79.177.9)"
    $env:SQL_DATABASE = Read-Host "SQL_DATABASE"
    $env:SQL_USER = Read-Host "SQL_USER"
    $secure = Read-Host "SQL_PASSWORD" -AsSecureString
    $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    $env:SQL_PASSWORD = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
    $env:SQL_PORT = "1433"
    $env:SQL_ENCRYPT = "true"
    $env:SQL_TRUST_SERVER_CERTIFICATE = "true"
    $env:SQL_TRUSTED_CONNECTION = "false"
    Remove-Item Env:SQL_DRIVER -ErrorAction SilentlyContinue
  } else {
    Write-Host "Cancelled."
    exit 0
  }
}

Write-Host ""
Write-Host "THIS WILL DELETE ALL DATA except Users, AppRoles, AppRolePermissions." -ForegroundColor Red
if (-not $Yes) {
  $confirm = Read-Host "Type YES to continue"
  if ($confirm -ne "YES") {
    Write-Host "Cancelled."
    exit 0
  }
}

$env:CONFIRM = "YES"
node (Join-Path $Root "scripts\wipe-except-users-roles.mjs")
$exit = $LASTEXITCODE
if ($exit -ne 0) {
  Write-Host ""
  Write-Host "Failed (exit $exit). Check server/database/user/password." -ForegroundColor Red
  exit $exit
}
Write-Host ""
Write-Host "Finished." -ForegroundColor Green
