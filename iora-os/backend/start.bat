@echo off
echo Kompiliere alle Workspace-Projekte...
cargo build

if %ERRORLEVEL% NEQ 0 (
    echo Build fehlgeschlagen.
    pause
    exit /b
)

echo Starte Binaries mit Verzögerung...

:: Kern-Dienste
start /b cargo run -p iora-core
timeout /t 2 >nul

start /b cargo run -p iora-home
timeout /t 2 >nul

start /b cargo run -p iora-gateway
timeout /t 2 >nul

start /b cargo run -p iora-security
timeout /t 2 >nul

start /b cargo run -p iora-secrets
timeout /t 2 >nul

:: Zusatz-Dienste
start /b cargo run -p iora-control
timeout /t 2 >nul

start /b cargo run -p iora-assist
timeout /t 2 >nul

start /b cargo run -p iora-watchdog

echo Alle Dienste gestartet.
pause