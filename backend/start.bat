@echo off
echo Kompiliere alle Workspace-Projekte...
cargo build

if %ERRORLEVEL% NEQ 0 (
    echo Build fehlgeschlagen.
    pause
    exit /b
)

echo Starte Binaries mit Verzögerung...

:: Dienst 1
start /b cargo run -p iora-core
timeout /t 2 >nul

:: Dienst 2
start /b cargo run -p iora-home
timeout /t 2 >nul

:: Weitere Dienste...
start /b cargo run -p iora-control
start /b cargo run -p iora-assist

echo Alle Dienste gestartet.
pause