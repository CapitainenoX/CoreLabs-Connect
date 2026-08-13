# CoreLabs Tunnel PowerShell Instant Installer
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "          CORELABS TUNNEL INSTANT INSTALLER           " -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan

$InstallDir = "$env:USERPROFILE\.corelabs-tunnel"
if (!(Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir | Out-Null
}

Write-Host "[+] Téléchargement de CoreLabs Tunnel depuis le serveur..." -ForegroundColor Green
$CliPath = "$InstallDir\cli.js"
Invoke-WebRequest -Uri "https://tunnel.corelabs.network/cli.js" -OutFile $CliPath

# Create batch wrapper script in User Local Bin / Path
$BinDir = "$env:LOCALAPPDATA\Microsoft\WindowsApps"
$BatchFile = "$BinDir\corelabs-tunnel.cmd"

$BatchContent = @"
@echo off
node "$CliPath" %*
"@

Set-Content -Path $BatchFile -Value $BatchContent
Write-Host "[+] Commande 'corelabs-tunnel' disponible dans la console !" -ForegroundColor Green
Write-Host "[✓] Lancement immédiat de CoreLabs Tunnel..." -ForegroundColor Yellow

node "$CliPath" $args
