#!/bin/bash
# rumahl STT – Start Script
# Usage: ./start.sh [port]

PORT=${1:-${RUMAHL_STT_PORT:-8110}}
MODEL=${RUMAHL_STT_MODEL:-base}
DEVICE=${RUMAHL_STT_DEVICE:-cpu}

cd "$(dirname "$0")"

# Create venv if it doesn't exist
if [ ! -d ".venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv .venv
    source .venv/bin/activate
    pip install -r requirements.txt
else
    source .venv/bin/activate
fi

echo "Starting rumahl STT on port $PORT (model=$MODEL, device=$DEVICE)"
exec python main.py
