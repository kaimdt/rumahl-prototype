# ═══════════════════════════════════════════════════════════════════
# connect-ssh.ps1 – SSH into the IORA dev VM
# ═══════════════════════════════════════════════════════════════════
# Usage: .\connect-ssh.ps1 [-Port 2222] [-User root]
# ═══════════════════════════════════════════════════════════════════

param(
    [int]$Port = 2222,
    [string]$User = "root"
)

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$SSH_KEY = Join-Path $SCRIPT_DIR ".cache\iora-dev-key"

if (-not (Test-Path $SSH_KEY)) {
    Write-Host "[X] SSH key not found: $SSH_KEY" -ForegroundColor Red
    Write-Host "    Start the VM first: .\dev-local.ps1 -SkipWhpx" -ForegroundColor Yellow
    exit 1
}

# Fix permissions on key (WSL creates world-readable keys, SSH rejects them)
$acl = Get-Acl $SSH_KEY
$acl.SetAccessRuleProtection($true, $false)
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($env:USERNAME, "Read", "Allow")
$acl.SetAccessRule($rule)
Set-Acl $SSH_KEY $acl 2>$null

Write-Host "Connecting to IORA Dev VM..." -ForegroundColor Cyan
Write-Host "  User: $User" -ForegroundColor DarkGray
Write-Host "  Port: $Port" -ForegroundColor DarkGray
Write-Host "  Key:  $SSH_KEY" -ForegroundColor DarkGray
Write-Host ""

& ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL -o IdentitiesOnly=yes -o AddressFamily=inet -i $SSH_KEY -p $Port "${User}@127.0.0.1"
