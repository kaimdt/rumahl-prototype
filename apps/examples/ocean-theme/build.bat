@echo off
echo Building Ocean Blue Theme ZIP...
cd /d "%~dp0"
if exist ocean-blue-theme.zip del ocean-blue-theme.zip
powershell -Command "Compress-Archive -Path manifest.json, variables.css -DestinationPath ocean-blue-theme.zip -Force"
if exist ocean-blue-theme.zip (
    for %%I in (ocean-blue-theme.zip) do echo Created: ocean-blue-theme.zip (%%~zI bytes)
) else (
    echo Error: ZIP creation failed
)
pause
