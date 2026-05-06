@echo off
REM IORA STT – Start Script (Windows)
cd /d "%~dp0"

if not exist ".venv" (
    echo Creating virtual environment...
    python -m venv .venv
    call .venv\Scripts\activate.bat
    pip install -r requirements.txt
) else (
    call .venv\Scripts\activate.bat
)

echo Starting IORA STT on port %IORA_STT_PORT:8110% (model=%IORA_STT_MODEL:base%)
python main.py
