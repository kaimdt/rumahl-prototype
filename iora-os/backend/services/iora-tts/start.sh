#!/bin/bash
# IORA TTS – Start Script
# Usage: ./start.sh [port]

PORT=${1:-${IORA_TTS_PORT:-8111}}
MODEL=${IORA_TTS_MODEL_PATH:-kokoro-v1.0.onnx}
VOICES=${IORA_TTS_VOICES_PATH:-voices-v1.0.bin}
VOICE=${IORA_TTS_VOICE:-af_nicole}
LANG=${IORA_TTS_LANG:-en-us}

cd "$(dirname "$0")"

# Download models if not present
if [ ! -f "$MODEL" ]; then
    echo "Downloading Kokoro model (v1.0)..."
    curl -L -o "$MODEL" \
        "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx"
fi

if [ ! -f "$VOICES" ]; then
    echo "Downloading Kokoro voices (v1.0)..."
    curl -L -o "$VOICES" \
        "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin"
fi

# Create venv if it doesn't exist
if [ ! -d ".venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv .venv
    source .venv/bin/activate
    pip install -r requirements.txt
else
    source .venv/bin/activate
fi

echo "Starting IORA TTS on port $PORT (voice=$VOICE, lang=$LANG)"
exec python main.py
