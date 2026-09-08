param(
    [switch]$FullWorkspace,
    [switch]$SkipFrontend,
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot ".."))
)

$ErrorActionPreference = "Stop"
$failures = New-Object System.Collections.Generic.List[string]

function Invoke-Check {
    param(
        [string]$Name,
        [scriptblock]$Body
    )

    Write-Host ""
    Write-Host "== $Name =="
    try {
        & $Body
        if ($LASTEXITCODE -ne $null -and $LASTEXITCODE -ne 0) {
            throw "Command exited with code $LASTEXITCODE"
        }
        Write-Host "OK: $Name"
    } catch {
        Write-Host "FAILED: $Name"
        Write-Host "  $($_.Exception.Message)"
        $failures.Add($Name) | Out-Null
    }
}

Invoke-Check "Migration registration" {
    & (Join-Path $RepoRoot "scripts/check-rumahl-migrations.ps1") -RepoRoot $RepoRoot
}

Invoke-Check "Frontend config cache scan" {
    & (Join-Path $RepoRoot "scripts/check-frontend-config-cache.ps1") -RepoRoot $RepoRoot -FailOnFinding
}

Invoke-Check "Cross-platform script pairs" {
    & (Join-Path $RepoRoot "scripts/check-cross-platform-scripts.ps1") -RepoRoot $RepoRoot
}

Invoke-Check "App/plugin/theme examples" {
    & (Join-Path $RepoRoot "scripts/check-app-plugin-theme-examples.ps1") -RepoRoot $RepoRoot
}

Invoke-Check "rumahl-dev-watch build" {
    Push-Location (Join-Path $RepoRoot "rumahl-os/backend")
    try { cargo build -p rumahl-dev-watch } finally { Pop-Location }
}

Invoke-Check "rumahl-home build" {
    Push-Location (Join-Path $RepoRoot "rumahl-os/backend")
    try { cargo build -p rumahl-home } finally { Pop-Location }
}

if ($FullWorkspace) {
    Invoke-Check "Rust workspace build" {
        Push-Location (Join-Path $RepoRoot "rumahl-os/backend")
        try { cargo build --workspace } finally { Pop-Location }
    }
}

if (-not $SkipFrontend) {
    $frontendDir = Join-Path $RepoRoot "frontend"
    if (Test-Path (Join-Path $frontendDir "package.json")) {
        Invoke-Check "frontend build" {
            Push-Location $frontendDir
            try { npm run build } finally { Pop-Location }
        }
    }
}

Write-Host ""
if ($failures.Count -eq 0) {
    Write-Host "All health-suite checks passed."
    exit 0
}

Write-Host "Health-suite failures:"
$failures | ForEach-Object { Write-Host "  $_" }
exit 1
