# rumahl TTS – Docker Image
FROM python:3.12-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY main.py .

# Download models at build time (optional – can also be mounted as volume)
ARG DOWNLOAD_MODELS=false
RUN if [ "$DOWNLOAD_MODELS" = "true" ]; then \
    curl -L -o kokoro-v1.0.onnx \
        https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx && \
    curl -L -o voices-v1.0.bin \
        https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin; \
    fi

ENV rumahl_TTS_PORT=8111
ENV rumahl_TTS_VOICE=af_nicole
ENV rumahl_TTS_LANG=en-us

EXPOSE 8111

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8111/health')" || exit 1

CMD ["python", "main.py"]
