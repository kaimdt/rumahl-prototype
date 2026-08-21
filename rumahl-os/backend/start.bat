@echo off
setlocal enabledelayedexpansion

:: Prüfe, ob PostgreSQL via Docker läuft
:: Alle rumahl-Services benötigen PostgreSQL als Datenbank.
:: Starte es mit: docker compose -f ..\..\deploy\docker-compose.yml up -d postgres
docker ps --format "{{.Names}}" 2>nul | findstr /i "postgres" >nul
if %ERRORLEVEL% NEQ 0 (
    echo ============================================================
    echo WARNUNG: Kein PostgreSQL-Container gefunden!
    echo.
    echo Starte PostgreSQL mit:
    echo   cd ..\..\deploy
    echo   docker compose up -d postgres
    echo.
    echo Druecke eine Taste um trotzdem zu starten, oder STRG+C zum Abbrechen.
    echo ============================================================
    pause
)

:: Standard PostgreSQL-Verbindung fuer lokale Entwicklung
:: Kann via Umgebungsvariable ueberschrieben werden
if "%DATABASE_URL%"=="" (
    set "DATABASE_URL=postgres://rumahl:changeme@localhost:5432/rumahl_home"
    echo DATABASE_URL nicht gesetzt - verwende Standard: !DATABASE_URL!
)

:: Standard Admin-Benutzer fuer lokale Entwicklung (optional)
if "%rumahl_BOOTSTRAP_ADMIN_USER%"=="" (
    set "rumahl_BOOTSTRAP_ADMIN_USER=admin"
    set "rumahl_BOOTSTRAP_ADMIN_PASSWORD=admin"
    set "rumahl_BOOTSTRAP_ADMIN_DISPLAY_NAME=Admin"
    echo Kein Admin-Benutzer konfiguriert - erzeuge Default: admin/admin
)

echo.
echo Kompiliere alle Workspace-Projekte...
cargo build

if %ERRORLEVEL% NEQ 0 (
    echo Build fehlgeschlagen.
    pause
    exit /b
)

echo Starte Binaries mit Verzögerung...

:: Kern-Dienste
start /b cmd /c "set DATABASE_URL=!DATABASE_URL! && cargo run -p rumahl-core"
timeout /t 2 >nul

start /b cmd /c "set DATABASE_URL=!DATABASE_URL! && cargo run -p rumahl-home"
timeout /t 2 >nul

start /b cargo run -p rumahl-gateway
timeout /t 2 >nul

start /b cargo run -p rumahl-security
timeout /t 2 >nul

start /b cmd /c "set DATABASE_URL=!DATABASE_URL! && cargo run -p rumahl-secrets"
timeout /t 2 >nul

:: Zusatz-Dienste
start /b cargo run -p rumahl-control
timeout /t 2 >nul

start /b cargo run -p rumahl-assist
timeout /t 2 >nul

start /b cargo run -p rumahl-watchdog

echo Alle Dienste gestartet.
pause