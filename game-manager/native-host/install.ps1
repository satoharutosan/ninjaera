# Ninja Era Native Messaging Host Installer
# Run as Administrator for best results

param(
    [string]$ExtensionId = ""
)

$ErrorActionPreference = "Stop"
$HostDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BatPath = Join-Path $HostDir "ninja-era-host.bat"
$ManifestTemplate = Join-Path $HostDir "com.ninjaera.gamemanager.json"
$ManifestPath = Join-Path $HostDir "com.ninjaera.gamemanager.installed.json"

Write-Host "=== Ninja Era Native Host Installer ===" -ForegroundColor Cyan

# Verify Node.js
try {
    $nodeVersion = node --version
    Write-Host "Node.js: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Node.js is required. Install from https://nodejs.org" -ForegroundColor Red
    exit 1
}

# Create data directory
$dataDir = "$env:PROGRAMDATA\NinjaEra\GameManager"
if (-not (Test-Path $dataDir)) {
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
    Write-Host "Created data directory: $dataDir" -ForegroundColor Green
}

# Build manifest with absolute bat path
$manifest = Get-Content $ManifestTemplate -Raw
$manifest = $manifest -replace 'PLACEHOLDER_PATH', ($BatPath -replace '\\', '\\')

if ($ExtensionId) {
    $manifest = $manifest -replace 'PLACEHOLDER_EXTENSION_ID', $ExtensionId
} else {
    Write-Host ""
    Write-Host "Extension ID not provided. After loading the extension in Chrome:" -ForegroundColor Yellow
    Write-Host "  1. Go to chrome://extensions" -ForegroundColor Yellow
    Write-Host "  2. Enable Developer mode" -ForegroundColor Yellow
    Write-Host "  3. Copy the extension ID" -ForegroundColor Yellow
    Write-Host "  4. Re-run: .\install.ps1 -ExtensionId YOUR_EXTENSION_ID" -ForegroundColor Yellow
    Write-Host ""
}

$manifest | Set-Content $ManifestPath -Encoding UTF8

# Register native messaging host for Chrome
$regPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.ninjaera.gamemanager"
New-Item -Path $regPath -Force | Out-Null
Set-ItemProperty -Path $regPath -Name "(Default)" -Value $ManifestPath

Write-Host "Registered native messaging host" -ForegroundColor Green
Write-Host "Manifest: $ManifestPath" -ForegroundColor Gray
Write-Host "Host script: $BatPath" -ForegroundColor Gray

# Verify startup folder exists
$startupPath = "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\StartUp"
if (Test-Path $startupPath) {
    Write-Host "Startup folder OK: $startupPath" -ForegroundColor Green
} else {
    Write-Host "WARNING: Startup folder not found at $startupPath" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Installation complete!" -ForegroundColor Cyan
if (-not $ExtensionId) {
    Write-Host "Remember to re-run with your Extension ID." -ForegroundColor Yellow
}
