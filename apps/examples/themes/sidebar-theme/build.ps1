# Build script for Windows PowerShell
$ErrorActionPreference = "Stop"
$DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$NAME = Split-Path -Leaf $DIR

$VERSION = "0.0.0"
if (Test-Path "$DIR\manifest.json") {
  $json = Get-Content "$DIR\manifest.json" -Raw | ConvertFrom-Json
  $VERSION = $json.version
} elseif (Test-Path "$DIR\plugin.json") {
  $json = Get-Content "$DIR\plugin.json" -Raw | ConvertFrom-Json
  if ($json.version) { $VERSION = $json.version } else { $VERSION = $json.metadata.version }
}

$ZIP = Join-Path $DIR "${NAME}-v${VERSION}.zip"
Remove-Item $ZIP -ErrorAction SilentlyContinue

# Collect files excluding build scripts and existing zips
$files = Get-ChildItem -Path $DIR -Exclude "build.sh","build.ps1","*.bat","*.zip",".DS_Store" | Resolve-Path -Relative
Push-Location $DIR
Compress-Archive -Path $files -DestinationPath $ZIP -Force
Pop-Location

Write-Host "Created: $ZIP"
