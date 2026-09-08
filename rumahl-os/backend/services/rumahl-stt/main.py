#!/usr/bin/env python3
"""
rumahl-stt – Speech-to-Text Microservice powered by faster-whisper.
Exposes a lightweight HTTP API for audio transcription.

Usage:
    python main.py                    # uses defaults (port 8110)
    RUMAHL_STT_PORT=8111 python main.py
    RUMAHL_STT_MODEL=large-v3 python main.py
"""
import os
import io
import logging
import tempfile
import time
from contextlib import asynccontextmanager
from typing import Optional

import numpy as np
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel
from pydantic import BaseModel

# ─── Logging ────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s [%(levelname)s] rumahl-stt: %(message)s",
)
log = logging.getLogger("rumahl-stt")

# ─── Configuration ──────────────────────────────────────────────────────────
MODEL_SIZE = os.getenv("RUMAHL_STT_MODEL", "base")  # tiny, base, small, medium, large-v3
DEVICE = os.getenv("RUMAHL_STT_DEVICE", "cpu")       # cpu or cuda
COMPUTE_TYPE = os.getenv("RUMAHL_STT_COMPUTE_TYPE", "int8")  # int8, float16, int8_float16
BEAM_SIZE = int(os.getenv("RUMAHL_STT_BEAM_SIZE", "5"))
PORT = int(os.getenv("RUMAHL_STT_PORT", "8110"))

# ─── Global model reference ─────────────────────────────────────────────────
model: Optional[WhisperModel] = None


def load_model():
    """Load the faster-whisper model (lazy, on first request or startup)."""
    global model
    if model is not None:
        return
    log.info(f"Loading faster-whisper model '{MODEL_SIZE}' on {DEVICE} ({COMPUTE_TYPE})...")
    t0 = time.time()
    model = WhisperModel(
        MODEL_SIZE,
        device=DEVICE,
        compute_type=COMPUTE_TYPE,
    )
    log.info(f"Model loaded in {time.time() - t0:.1f}s")


# ─── FastAPI app ────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load model on startup if AUTO_LOAD is set."""
    if os.getenv("RUMAHL_STT_AUTO_LOAD", "1") == "1":
        load_model()
    yield


app = FastAPI(
    title="rumahl STT",
    description="Speech-to-Text via faster-whisper",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Models ─────────────────────────────────────────────────────────────────

class TranscriptionSegment(BaseModel):
    """A single transcribed segment with timestamps."""
    id: int
    start: float
    end: float
    text: str
    words: Optional[list[dict]] = None  # [{word, start, end, probability}, ...]


class TranscriptionResponse(BaseModel):
    """Full transcription result."""
    text: str
    language: str
    language_probability: float
    duration: float
    segments: list[TranscriptionSegment] = []
    model: str = MODEL_SIZE


class HealthResponse(BaseModel):
    status: str
    model: str
    model_loaded: bool
    device: str


# ─── Helpers ────────────────────────────────────────────────────────────────

def _read_audio(data: bytes, suffix: str = ".webm") -> str:
    """Write audio bytes to a temp file and return the path."""
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    tmp.write(data)
    tmp.close()
    return tmp.name


# ─── Routes ─────────────────────────────────────────────────────────────────

@app.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(
        status="healthy" if model is not None else "loading",
        model=MODEL_SIZE,
        model_loaded=model is not None,
        device=DEVICE,
    )


@app.post("/transcribe", response_model=TranscriptionResponse)
async def transcribe(
    audio: UploadFile = File(...),
    language: Optional[str] = Form(None),
    task: str = Form("transcribe"),
    vad_filter: bool = Form(True),
):
    """
    Transcribe an audio file (WAV, MP3, WebM, OGG, etc.) to text.

    - **audio**: Audio file (multipart upload)
    - **language**: Force language code (e.g. 'en', 'de'). Auto-detect if omitted.
    - **task**: 'transcribe' or 'translate' (to English)
    - **vad_filter**: Enable voice activity detection for better accuracy
    """
    if model is None:
        load_model()

    # Determine file extension
    filename = audio.filename or "audio.webm"
    suffix = os.path.splitext(filename)[1] or ".webm"

    # Read and save to temp file
    data = await audio.read()
    log.info(f"Received audio: {len(data)} bytes, format={suffix}")

    tmp_path = _read_audio(data, suffix=suffix)
    try:
        t0 = time.time()

        # Transcribe with faster-whisper
        segments, info = model.transcribe(
            tmp_path,
            language=language,
            task=task,
            beam_size=BEAM_SIZE,
            vad_filter=vad_filter,
        )

        # Collect all segments
        full_text_parts: list[str] = []
        segment_list: list[TranscriptionSegment] = []
        for i, seg in enumerate(segments):
            full_text_parts.append(seg.text.strip())
            words_data = None
            if seg.words:
                words_data = [
                    {
                        "word": w.word,
                        "start": round(w.start, 3),
                        "end": round(w.end, 3),
                        "probability": round(w.probability, 3),
                    }
                    for w in seg.words
                ]
            segment_list.append(TranscriptionSegment(
                id=i,
                start=round(seg.start, 3),
                end=round(seg.end, 3),
                text=seg.text.strip(),
                words=words_data,
            ))

        full_text = " ".join(full_text_parts)
        elapsed = time.time() - t0

        log.info(
            f"Transcription done in {elapsed:.1f}s: "
            f"lang={info.language} (p={info.language_probability:.2f}), "
            f"text={full_text[:100]}{'...' if len(full_text) > 100 else ''}"
        )

        return TranscriptionResponse(
            text=full_text,
            language=info.language,
            language_probability=round(info.language_probability, 3),
            duration=round(info.duration, 3),
            segments=segment_list,
        )

    except Exception as e:
        log.error(f"Transcription failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        os.unlink(tmp_path)


@app.get("/models")
async def list_models():
    """List available faster-whisper model sizes."""
    return {
        "available_models": [
            {"id": "tiny", "params": "39M", "ram": "~1GB"},
            {"id": "tiny.en", "params": "39M", "ram": "~1GB", "english_only": True},
            {"id": "base", "params": "74M", "ram": "~1GB"},
            {"id": "base.en", "params": "74M", "ram": "~1GB", "english_only": True},
            {"id": "small", "params": "244M", "ram": "~2GB"},
            {"id": "small.en", "params": "244M", "ram": "~2GB", "english_only": True},
            {"id": "medium", "params": "769M", "ram": "~5GB"},
            {"id": "medium.en", "params": "769M", "ram": "~5GB", "english_only": True},
            {"id": "large-v2", "params": "1550M", "ram": "~10GB"},
            {"id": "large-v3", "params": "1550M", "ram": "~10GB"},
            {"id": "distil-large-v3", "params": "756M", "ram": "~6GB"},
        ],
        "current": MODEL_SIZE,
        "device": DEVICE,
    }


# ─── Entrypoint ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    log.info(f"Starting rumahl STT on 0.0.0.0:{PORT} (model={MODEL_SIZE}, device={DEVICE})")
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
