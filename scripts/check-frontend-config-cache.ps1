param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")),
    [switch]$FailOnFinding
)

$ErrorActionPreference = "Stop"

$frontendSrc = Join-Path $RepoRoot "frontend/src"
if (-not (Test-Path $frontendSrc)) {
    Write-Host "WARN: frontend/src not found; skipping frontend config cache scan."
    exit 0
}

$pattern = '^\s*(const|let)\s+[A-Za-z0-9_]+\s*=\s*(getBackendUrl|getAssistUrl)\(\)'
$findings = New-Object System.Collections.Generic.List[string]

Get-ChildItem $frontendSrc -Recurse -Include *.ts,*.tsx | ForEach-Object {
    $file = $_.FullName
    $relative = Resolve-Path -Relative $file
    $lines = Get-Content $file
    $braceDepth = 0
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $line = $lines[$i]
        if ($braceDepth -eq 0 -and $line -match $pattern) {
            $findings.Add("${relative}:$($i + 1): $($lines[$i].Trim())") | Out-Null
        }
        $withoutStrings = $line -replace '"(?:[^"\\]|\\.)*"', '""' -replace "'(?:[^'\\]|\\.)*'", "''" -replace '`(?:[^`\\]|\\.)*`', '``'
        $opens = ([regex]::Matches($withoutStrings, '\{')).Count
        $closes = ([regex]::Matches($withoutStrings, '\}')).Count
        $braceDepth = [Math]::Max(0, $braceDepth + $opens - $closes)
    }
}

if ($findings.Count -eq 0) {
    Write-Host "OK: no obvious module-scope frontend URL caches found."
    exit 0
}

Write-Host "WARN: possible frontend URL caches found. Prefer call-time helpers like apiBase() => getBackendUrl() || ''."
$findings | ForEach-Object { Write-Host "  $_" }

if ($FailOnFinding) { exit 1 }
exit 0
