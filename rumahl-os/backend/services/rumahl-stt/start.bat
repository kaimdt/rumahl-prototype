@echo off
REM rumahl STT – Start Script (Windows)
cd /d "%~dp0"

if not exist ".venv" (
    echo Creating virtual environment...
    python -m venv .venv
    call .venv\Scripts\activate.bat
    pip install -r requirements.txt
) else (
    call .venv\Scripts\activate.bat
)

echo Starting rumahl STT on port %rumahl_STT_PORT:8110% (model=%rumahl_STT_MODEL:base%)
python main.py
