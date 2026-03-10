#!/usr/bin/env pwsh
# setup-vps.ps1
# Run: powershell -ExecutionPolicy Bypass -File setup-vps.ps1
# Applies nginx config + pulls latest code on VPS

$VPS_HOST = "61.14.233.242"
$VPS_PORT = 2018
$VPS_USER = "root"
$VPS_PASS = "m0XIjj55m0"

Write-Host "🚀 THG VPS Setup Script" -ForegroundColor Cyan
Write-Host "Target: $VPS_USER@$VPS_HOST:$VPS_PORT`n" -ForegroundColor Gray

# One-liner script to run on VPS
$REMOTE_SCRIPT = @'
set -e
echo "━━━ 1. Pull latest code ━━━"
cd /root/THG_tool
git fetch origin main
git reset --hard origin/main
echo "✓ Code: $(git rev-parse --short HEAD)"

echo ""
echo "━━━ 2. Apply nginx config ━━━"
mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled
cp nginx/thg-lead-gen.conf /etc/nginx/sites-available/thg-lead-gen
ln -sf /etc/nginx/sites-available/thg-lead-gen /etc/nginx/sites-enabled/thg-lead-gen 2>/dev/null || true

# Remove default site if it conflicts
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

nginx -t && echo "✓ nginx config valid" || { echo "❌ nginx config invalid!"; exit 1; }
systemctl reload nginx && echo "✓ nginx reloaded"

echo ""
echo "━━━ 3. Reload PM2 ━━━"
cd /root/THG_tool
pm2 reload ecosystem.config.js --update-env 2>/dev/null \
  || pm2 restart ecosystem.config.js --update-env 2>/dev/null \
  || (pm2 delete all 2>/dev/null || true && pm2 start ecosystem.config.js)
pm2 save --force
echo "✓ PM2 reloaded"

echo ""
echo "━━━ 4. Health check ━━━"
sleep 5
PORT=$(grep '^PORT=' .env 2>/dev/null | cut -d= -f2 | tr -d '[:space:]' || echo 3000)
HTTP=$(curl -so /dev/null -w "%{http_code}" "http://localhost:${PORT}/api/stats" 2>/dev/null || echo "000")
if [ "$HTTP" = "200" ]; then
  echo "✅ App healthy (HTTP 200) on port $PORT"
else
  echo "⚠️  App returned HTTP $HTTP — check: pm2 logs thg-lead-gen --lines 30"
fi

echo ""
echo "━━━ ✅ VPS Setup Complete ━━━"
pm2 list
'@

# Install plink if needed, or use ssh with sshpass
$USE_SSHPASS = $false
if (Get-Command sshpass -ErrorAction SilentlyContinue) {
    $USE_SSHPASS = $true
    Write-Host "✓ Using sshpass for non-interactive SSH" -ForegroundColor Green
}

# Use PowerShell SSH if available
if (Get-Command ssh -ErrorAction SilentlyContinue) {
    Write-Host "🔑 Connecting via SSH..." -ForegroundColor Yellow
    Write-Host "   NOTE: You may be prompted for password: $VPS_PASS`n" -ForegroundColor Gray
    
    # Write remote script to temp file
    $tmpScript = [System.IO.Path]::GetTempFileName() + ".sh"
    $REMOTE_SCRIPT | Out-File -FilePath $tmpScript -Encoding UTF8 -NoNewline
    
    Write-Host "📋 Commands that will run on VPS:" -ForegroundColor Cyan
    Write-Host $REMOTE_SCRIPT -ForegroundColor DarkGray
    Write-Host ""
    
    # Run via SSH
    $result = ssh -o StrictHostKeyChecking=no -p $VPS_PORT "${VPS_USER}@${VPS_HOST}" $REMOTE_SCRIPT 2>&1
    
    Write-Host $result
    Remove-Item $tmpScript -Force -ErrorAction SilentlyContinue
} else {
    Write-Host "❌ SSH not found in PATH. Please run these commands manually:" -ForegroundColor Red
    Write-Host ""
    Write-Host "1. Open Command Prompt and SSH:" -ForegroundColor Yellow
    Write-Host "   ssh -p $VPS_PORT ${VPS_USER}@${VPS_HOST}" -ForegroundColor White
    Write-Host "   Password: $VPS_PASS" -ForegroundColor White
    Write-Host ""
    Write-Host "2. Once connected, run:" -ForegroundColor Yellow
    Write-Host $REMOTE_SCRIPT -ForegroundColor White
}
