# IORA STT – Docker Image
FROM python:3.12-slim

WORKDIR /app

# Install system dependencies for audio processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY main.py .

# Pre-download the small model (override with IORA_STT_MODEL env var)
ENV IORA_STT_PORT=8110
ENV IORA_STT_MODEL=base
ENV IORA_STT_DEVICE=cpu

EXPOSE 8110

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8110/health')" || exit 1

CMD ["python", "main.py"]
