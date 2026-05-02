@echo off
echo Building Steampunk Theme ZIP...
cd /d "%~dp0"
if exist steampunk-theme.zip del steampunk-theme.zip
powershell -Command "Compress-Archive -Path manifest.json, variables.css, theme.css, js, images, html -DestinationPath steampunk-theme.zip -Force"
if exist steampunk-theme.zip (
    for %%I in (steampunk-theme.zip) do echo Created: steampunk-theme.zip (%%~zI bytes)
) else (
    echo.
    echo Trying alternative method...
    cd /d "%~dp0"
    powershell -Command "$files = @('manifest.json','variables.css','theme.css'); Get-ChildItem -Path 'js','images','html' -Recurse | ForEach-Object { $files += $_.FullName }; Compress-Archive -Path $files -DestinationPath steampunk-theme.zip -Force"
    if exist steampunk-theme.zip (
        for %%I in (steampunk-theme.zip) do echo Created: steampunk-theme.zip (%%~zI bytes)
    ) else (
        echo Error: ZIP creation failed
    )
)
pause
