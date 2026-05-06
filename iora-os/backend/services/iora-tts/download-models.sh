#!/bin/bash
# Download Kokoro TTS models (v1.0)
# Saves kokoro-v1.0.onnx and voices-v1.0.bin to the current directory.

MODEL_URL="https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx"
VOICES_URL="https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin"

echo "=== IORA TTS Model Downloader ==="
echo ""

if [ -f "kokoro-v1.0.onnx" ]; then
    echo "[OK] kokoro-v1.0.onnx already exists"
else
    echo "[...] Downloading kokoro-v1.0.onnx (~330MB)..."
    curl -L -o "kokoro-v1.0.onnx" "$MODEL_URL" || {
        echo "[FAIL] Could not download model"
        exit 1
    }
    echo "[OK] Downloaded kokoro-v1.0.onnx"
fi

if [ -f "voices-v1.0.bin" ]; then
    echo "[OK] voices-v1.0.bin already exists"
else
    echo "[...] Downloading voices-v1.0.bin (~90MB)..."
    curl -L -o "voices-v1.0.bin" "$VOICES_URL" || {
        echo "[FAIL] Could not download voices"
        exit 1
    }
    echo "[OK] Downloaded voices-v1.0.bin"
fi

echo ""
echo "All models ready. Start IORA TTS with: ./start.sh"
