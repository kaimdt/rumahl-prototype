param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot ".."))
)

$ErrorActionPreference = "Stop"
$missing = New-Object System.Collections.Generic.List[string]

Get-ChildItem $RepoRoot -Recurse -Filter "*.ps1" |
    Where-Object { $_.FullName -notmatch '[\\/](\.git|node_modules|target|dist|build)[\\/]' } |
    ForEach-Object {
        $shellPath = [System.IO.Path]::ChangeExtension($_.FullName, ".sh")
        if (-not (Test-Path $shellPath)) {
            $relative = Resolve-Path -Relative $_.FullName
            $missing.Add($relative) | Out-Null
        }
    }

if ($missing.Count -eq 0) {
    Write-Host "OK: every PowerShell script has a sibling .sh script."
    exit 0
}

Write-Host "ERROR: PowerShell scripts without sibling .sh script:"
$missing | ForEach-Object { Write-Host "  $_" }
exit 1