#!/usr/bin/env python3
"""
rumahl-tts – Text-to-Speech Microservice powered by Kokoro ONNX.
Exposes a lightweight HTTP API for speech synthesis.

Usage:
    python main.py                     # uses defaults (port 8111)
    RUMAHL_TTS_PORT=8112 python main.py
    RUMAHL_TTS_VOICE=af_nicole python main.py
"""
import os
import io
import logging
import time
import wave
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from kokoro_onnx import Kokoro
from pydantic import BaseModel

# ─── Logging ────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s [%(levelname)s] rumahl-tts: %(message)s",
)
log = logging.getLogger("rumahl-tts")

# ─── Configuration ──────────────────────────────────────────────────────────
MODEL_PATH = os.getenv("RUMAHL_TTS_MODEL_PATH", "kokoro-v1.0.onnx")
VOICES_PATH = os.getenv("RUMAHL_TTS_VOICES_PATH", "voices-v1.0.bin")
DEFAULT_VOICE = os.getenv("RUMAHL_TTS_VOICE", "af_nicole")
DEFAULT_LANG = os.getenv("RUMAHL_TTS_LANG", "en-us")
DEFAULT_SPEED = float(os.getenv("RUMAHL_TTS_SPEED", "1.0"))
PORT = int(os.getenv("RUMAHL_TTS_PORT", "8111"))
AUDIO_FORMAT = os.getenv("RUMAHL_TTS_FORMAT", "wav")  # wav or raw pcm16

# ─── Available voices ───────────────────────────────────────────────────────
# See https://github.com/KoljaB/Kokoro-82M/blob/main/VOICES.md
KOKORO_VOICES: dict[str, dict] = {
    # American English – Female
    "af_sarah":    {"name": "Sarah",    "gender": "female", "lang": "en-us"},
    "af_nicole":   {"name": "Nicole",   "gender": "female", "lang": "en-us"},
    "af_bella":    {"name": "Bella",    "gender": "female", "lang": "en-us"},
    "af_sky":      {"name": "Sky",      "gender": "female", "lang": "en-us"},
    "af_irulan":   {"name": "Irulan",   "gender": "female", "lang": "en-us"},
    # American English – Male
    "am_adam":     {"name": "Adam",     "gender": "male",   "lang": "en-us"},
    "am_michael":  {"name": "Michael",  "gender": "male",   "lang": "en-us"},
    "am_liam":     {"name": "Liam",     "gender": "male",   "lang": "en-us"},
    # British English
    "bf_emma":     {"name": "Emma",     "gender": "female", "lang": "en-gb"},
    "bf_isabella": {"name": "Isabella", "gender": "female", "lang": "en-gb"},
    "bm_george":   {"name": "George",   "gender": "male",   "lang": "en-gb"},
    "bm_lewis":    {"name": "Lewis",    "gender": "male",   "lang": "en-gb"},
    # Spanish
    "sf_abuela":   {"name": "Abuela",   "gender": "female", "lang": "es"},
    "sm_mario":    {"name": "Mario",    "gender": "male",   "lang": "es"},
    # French
    "ff_siwis":    {"name": "Siwis",    "gender": "female", "lang": "fr-fr"},
    "fm_alex":     {"name": "Alex",     "gender": "male",   "lang": "fr-fr"},
    # Italian
    "if_eima":     {"name": "Eima",     "gender": "female", "lang": "it"},
    "im_nicola":   {"name": "Nicola",   "gender": "male",   "lang": "it"},
    # Japanese
    "jf_alpha":    {"name": "Alpha",    "gender": "female", "lang": "ja"},
    "jf_gongitsune": {"name": "Gongitsune", "gender": "female", "lang": "ja"},
    "jf_nezumi":   {"name": "Nezumi",   "gender": "female", "lang": "ja"},
    "jf_tebukuro": {"name": "Tebukuro", "gender": "female", "lang": "ja"},
    "jm_kumo":     {"name": "Kumo",     "gender": "male",   "lang": "ja"},
    # Mandarin Chinese
    "zf_xiaobei":  {"name": "Xiaobei",  "gender": "female", "lang": "zh"},
    "zf_xiaoni":   {"name": "Xiaoni",   "gender": "female", "lang": "zh"},
    "zf_xiaoxiao": {"name": "Xiaoxiao", "gender": "female", "lang": "zh"},
    "zf_xiaoyi":   {"name": "Xiaoyi",   "gender": "female", "lang": "zh"},
    "zm_yunjian":  {"name": "Yunjian",  "gender": "male",   "lang": "zh"},
    "zm_yunxia":   {"name": "Yunxia",   "gender": "male",   "lang": "zh"},
    # Korean
    "kf_kongbaksa": {"name": "Kongbaksa", "gender": "female", "lang": "ko"},
    # Portuguese (Brazil)
    "pf_dora":     {"name": "Dora",     "gender": "female", "lang": "pt-br"},
    "pm_alex":     {"name": "Alex",     "gender": "male",   "lang": "pt-br"},
    "pm_santa":    {"name": "Santa",    "gender": "male",   "lang": "pt-br"},
    # German (from community / v1.0 experimental)
    "df_clara":    {"name": "Clara",    "gender": "female", "lang": "de"},
}


def _map_lang_to_kokoro(lang: str) -> str:
    """Map common language codes to Kokoro language codes."""
    mapping = {
        "en": "en-us",
        "de": "de",
        "es": "es",
        "fr": "fr-fr",
        "it": "it",
        "ja": "ja",
        "zh": "zh",
        "ko": "ko",
        "pt": "pt-br",
    }
    return mapping.get(lang, lang)


# ─── Global TTS engine ──────────────────────────────────────────────────────
kokoro: Optional[Kokoro] = None


def load_engine():
    """Load the Kokoro ONNX model (lazy, on first request or startup)."""
    global kokoro
    if kokoro is not None:
        return

    model_path = Path(MODEL_PATH)
    voices_path = Path(VOICES_PATH)

    if not model_path.exists():
        raise FileNotFoundError(
            f"Kokoro model not found at {model_path}. "
            f"Download from: https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx"
        )
    if not voices_path.exists():
        raise FileNotFoundError(
            f"Kokoro voices not found at {voices_path}. "
            f"Download from: https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin"
        )

    log.info(f"Loading Kokoro model: {model_path}")
    t0 = time.time()
    kokoro = Kokoro(str(model_path), str(voices_path))
    log.info(f"Kokoro loaded in {time.time() - t0:.1f}s")


# ─── FastAPI app ────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load engine on startup if AUTO_LOAD is set."""
    if os.getenv("RUMAHL_TTS_AUTO_LOAD", "1") == "1":
        load_engine()
    yield


app = FastAPI(
    title="rumahl TTS",
    description="Text-to-Speech via Kokoro ONNX",
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

class SynthesizeRequest(BaseModel):
    text: str
    voice: Optional[str] = None
    speed: Optional[float] = None
    lang: Optional[str] = None
    format: Optional[str] = None  # 'wav' or 'raw'


class VoiceInfo(BaseModel):
    id: str
    name: str
    gender: str
    language: str


class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    default_voice: str
    voices_count: int


# ─── Helpers ────────────────────────────────────────────────────────────────

def _samples_to_wav(samples: np.ndarray, sample_rate: int = 24000) -> bytes:
    """Convert float32 numpy array to WAV bytes (16-bit PCM)."""
    buf = io.BytesIO()
    pcm = (samples * 32767).astype(np.int16)
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm.tobytes())
    return buf.getvalue()


# ─── Routes ─────────────────────────────────────────────────────────────────

@app.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(
        status="healthy" if kokoro is not None else "loading",
        model_loaded=kokoro is not None,
        default_voice=DEFAULT_VOICE,
        voices_count=len(KOKORO_VOICES),
    )


@app.get("/voices")
async def list_voices():
    """List all available Kokoro voices with metadata."""
    return {
        "voices": [
            VoiceInfo(
                id=vid,
                name=info["name"],
                gender=info["gender"],
                language=info["lang"],
            )
            for vid, info in KOKORO_VOICES.items()
        ],
        "default": DEFAULT_VOICE,
        "default_lang": DEFAULT_LANG,
        "languages": sorted(set(v["lang"] for v in KOKORO_VOICES.values())),
    }


@app.post("/synthesize")
async def synthesize(req: SynthesizeRequest):
    """
    Synthesize speech from text.

    - **text**: Text to speak
    - **voice**: Voice ID (e.g. 'af_nicole', 'am_adam', 'bf_emma')
    - **speed**: Playback speed (0.5 - 2.0, default 1.0)
    - **lang**: Language code (e.g. 'en-us', 'de', 'fr-fr')
    - **format**: Output format ('wav' or 'raw')
    """
    if kokoro is None:
        load_engine()

    voice = req.voice or DEFAULT_VOICE
    speed = req.speed if req.speed is not None else DEFAULT_SPEED
    lang = _map_lang_to_kokoro(req.lang or DEFAULT_LANG)
    fmt = req.format or AUDIO_FORMAT

    # Validate voice
    if voice not in KOKORO_VOICES:
        available = list(KOKORO_VOICES.keys())
        raise HTTPException(
            status_code=400,
            detail=f"Unknown voice '{voice}'. Available: {available[:10]}... ({len(available)} total)",
        )

    # Clamp speed
    speed = max(0.5, min(2.0, speed))

    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Text must not be empty")

    log.info(
        f"Synthesizing: voice={voice}, lang={lang}, speed={speed}, "
        f"text_len={len(req.text)}, format={fmt}"
    )

    try:
        t0 = time.time()

        # Generate all samples at once (not streaming)
        samples, sample_rate = kokoro.create(
            req.text,
            voice=voice,
            speed=speed,
            lang=lang,
        )

        elapsed = time.time() - t0

        if fmt == "raw":
            # Return raw 16-bit PCM
            pcm = (samples * 32767).astype(np.int16).tobytes()
            log.info(f"Synthesis done in {elapsed:.1f}s ({len(pcm)} bytes raw PCM)")
            return Response(
                content=pcm,
                media_type="audio/pcm",
                headers={
                    "X-Audio-Sample-Rate": str(sample_rate),
                    "X-Audio-Channels": "1",
                    "X-Audio-Bits": "16",
                    "X-Audio-Duration": str(round(len(samples) / sample_rate, 2)),
                    "X-Synthesis-Time": str(round(elapsed, 3)),
                    "X-Voice": voice,
                    "X-Language": lang,
                },
            )

        # Default: return WAV
        wav_bytes = _samples_to_wav(samples, sample_rate)
        duration = len(samples) / sample_rate

        log.info(
            f"Synthesis done in {elapsed:.1f}s: "
            f"duration={duration:.1f}s, wav_size={len(wav_bytes)} bytes"
        )

        return Response(
            content=wav_bytes,
            media_type="audio/wav",
            headers={
                "Content-Disposition": f'attachment; filename="speech_{voice}.wav"',
                "X-Audio-Duration": str(round(duration, 2)),
                "X-Synthesis-Time": str(round(elapsed, 3)),
                "X-Voice": voice,
                "X-Language": lang,
                "X-Sample-Rate": str(sample_rate),
            },
        )

    except Exception as e:
        log.error(f"Synthesis failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/synthesize/stream")
async def synthesize_stream(req: SynthesizeRequest):
    """
    Synthesize speech and return as streaming response.
    Audio chunks are sent as they are generated.
    """
    if kokoro is None:
        load_engine()

    voice = req.voice or DEFAULT_VOICE
    speed = req.speed if req.speed is not None else DEFAULT_SPEED
    lang = _map_lang_to_kokoro(req.lang or DEFAULT_LANG)

    if voice not in KOKORO_VOICES:
        raise HTTPException(status_code=400, detail=f"Unknown voice: {voice}")

    speed = max(0.5, min(2.0, speed))

    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Text must not be empty")

    log.info(f"Streaming synthesis: voice={voice}, text_len={len(req.text)}")

    try:
        stream = kokoro.create_stream(
            req.text,
            voice=voice,
            speed=speed,
            lang=lang,
        )

        from starlette.responses import StreamingResponse

        async def audio_generator():
            async for samples, sample_rate in stream:
                wav_chunk = _samples_to_wav(samples, sample_rate)
                yield wav_chunk

        return StreamingResponse(
            audio_generator(),
            media_type="audio/wav",
            headers={
                "X-Voice": voice,
                "X-Language": lang,
            },
        )

    except Exception as e:
        log.error(f"Stream synthesis failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ─── Entrypoint ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    log.info(
        f"Starting rumahl TTS on 0.0.0.0:{PORT} "
        f"(voice={DEFAULT_VOICE}, lang={DEFAULT_LANG})"
    )
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
