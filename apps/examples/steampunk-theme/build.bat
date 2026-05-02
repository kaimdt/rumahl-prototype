@echo off
echo Building Steampunk Theme ZIP...
cd /d "%~dp0"
del steampunk-theme.zip 2>nul
powershell -Command "Compress-Archive -Path manifest.json, variables.css, theme.css, js, images, html -DestinationPath steampunk-theme.zip -Force"
if exist steampunk-theme.zip (
    echo Created: steampunk-theme.zip (% ~z bytes)
) else (
    echo Error: ZIP creation failed
)
