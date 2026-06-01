param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot ".."))
)

$ErrorActionPreference = "Stop"
$checker = Join-Path $PSScriptRoot "check-app-plugin-theme-examples.mjs"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js is required for app/plugin/theme example validation."
}

node $checker --repo-root $RepoRoot
exit $LASTEXITCODE