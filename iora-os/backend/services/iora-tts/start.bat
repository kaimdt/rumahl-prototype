@echo off
REM IORA TTS – Start Script (Windows) + auto-download models
cd /d "%~dp0"

if not exist "kokoro-v1.0.onnx" (
    echo Downloading Kokoro model v1.0...
    curl -L -o kokoro-v1.0.onnx https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
)
if not exist "voices-v1.0.bin" (
    echo Downloading Kokoro voices v1.0...
    curl -L -o voices-v1.0.bin https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
)

if not exist ".venv" (
    echo Creating virtual environment...
    python -m venv .venv
    call .venv\Scripts\activate.bat
    pip install -r requirements.txt
) else (
    call .venv\Scripts\activate.bat
)

echo Starting IORA TTS on port %IORA_TTS_PORT:8111% (voice=%IORA_TTS_VOICE:af_nicole%)
python main.py
