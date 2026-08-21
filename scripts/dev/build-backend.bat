@echo off
:: Build all backend crates (release mode is handled separately)
cd /d "%~dp0..\backend"
echo Building all rumahl backend crates...
cargo build
if %ERRORLEVEL% NEQ 0 (
    echo Build failed.
    pause
    exit /b 1
)
echo Build successful.
pause
