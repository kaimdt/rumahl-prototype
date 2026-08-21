param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot ".."))
)

$ErrorActionPreference = "Stop"

$migrationsDir = Join-Path $RepoRoot "rumahl-os/backend/services/rumahl-home/migrations"
$dbMod = Join-Path $RepoRoot "rumahl-os/backend/services/rumahl-home/src/db/mod.rs"

if (-not (Test-Path $migrationsDir)) {
    Write-Error "Migrations directory not found: $migrationsDir"
}
if (-not (Test-Path $dbMod)) {
    Write-Error "rumahl-home db/mod.rs not found: $dbMod"
}

$sqlFiles = Get-ChildItem $migrationsDir -Filter "*.sql" | Sort-Object Name
$dbText = Get-Content $dbMod -Raw
$registered = [regex]::Matches($dbText, 'include_str!\("\.\./\.\./migrations/([^"\)]+\.sql)"\)') |
    ForEach-Object { $_.Groups[1].Value } |
    Sort-Object -Unique

$fileNames = $sqlFiles | ForEach-Object { $_.Name }
$missing = $fileNames | Where-Object { $_ -notin $registered }
$stale = $registered | Where-Object { $_ -notin $fileNames }

$numbered = $sqlFiles | ForEach-Object {
    if ($_.Name -match '^(\d{3})_') { [int]$Matches[1] } else { $null }
}
$expected = if ($numbered.Count -gt 0) { 1..($numbered | Measure-Object -Maximum).Maximum } else { @() }
$missingNumbers = $expected | Where-Object { $_ -notin $numbered }

if ($missing.Count -eq 0 -and $stale.Count -eq 0 -and $missingNumbers.Count -eq 0) {
    Write-Host "OK: rumahl-home migrations are registered and sequential ($($fileNames.Count) files)."
    exit 0
}

if ($missing.Count -gt 0) {
    Write-Host "ERROR: SQL files missing from db/mod.rs:"
    $missing | ForEach-Object { Write-Host "  $_" }
}
if ($stale.Count -gt 0) {
    Write-Host "ERROR: db/mod.rs references missing SQL files:"
    $stale | ForEach-Object { Write-Host "  $_" }
}
if ($missingNumbers.Count -gt 0) {
    Write-Host "ERROR: Migration number gaps:"
    $missingNumbers | ForEach-Object { Write-Host ("  {0:D3}" -f $_) }
}

exit 1
