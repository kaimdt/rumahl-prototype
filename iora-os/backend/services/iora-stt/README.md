# IORA STT – Speech-to-Text (faster-whisper)

Lokaler Speech-to-Text-Microservice powered by
[faster-whisper](https://github.com/SYSTRAN/faster-whisper) (CTranslate2-basiert).

## Schnellstart

```bash
cd iora-os/backend/services/iora-stt

# Virtuelle Umgebung erstellen & Abhängigkeiten installieren
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Starten (Port 8110, Modell "base")
python main.py
```

Beim ersten Start wird das gewählte Whisper-Modell automatisch heruntergeladen
(~150 MB für `base`, ~3 GB für `large-v3`).

## Konfiguration (Environment Variables)

| Variable | Default | Beschreibung |
|---|---|---|
| `IORA_STT_PORT` | `8110` | HTTP Port |
| `IORA_STT_MODEL` | `base` | Modell-Größe (`tiny`, `base`, `small`, `medium`, `large-v3`) |
| `IORA_STT_DEVICE` | `cpu` | Device (`cpu` oder `cuda`) |
| `IORA_STT_COMPUTE_TYPE` | `int8` | Quantisierung (`int8`, `float16`, `int8_float16`) |
| `IORA_STT_BEAM_SIZE` | `5` | Beam-Search-Größe |
| `IORA_STT_AUTO_LOAD` | `1` | Modell beim Start laden |

## API Endpunkte

### `GET /health`
Health-Check mit Status, Modell-Info und Device.

### `POST /transcribe`
Audio transkribieren (multipart upload).

**Parameter:**
- `audio` (file, required) – Audio-Datei (WAV, MP3, WebM, OGG, FLAC, M4A)
- `language` (string, optional) – Sprach-Code (z. B. `en`, `de`). Auto-Detect wenn weggelassen.
- `task` (string, default: `transcribe`) – `transcribe` oder `translate` (nach Englisch)
- `vad_filter` (bool, default: `true`) – Voice Activity Detection

**Response:**
```json
{
  "text": "Hello world",
  "language": "en",
  "language_probability": 0.98,
  "duration": 2.5,
  "segments": [
    {
      "id": 0,
      "start": 0.0,
      "end": 2.5,
      "text": "Hello world",
      "words": [...]
    }
  ],
  "model": "base"
}
```

### `GET /models`
Liste aller verfügbaren Whisper-Modelle.

## Integration in IORA Assist

Der iora-assist Service erkennt den STT-Service automatisch und registriert
ihn als Provider `iora_stt`. Die Dedicated-Endpunkte:

- `POST /api/assist/voice/stt` – Transkription (bevorzugt lokales STT, Fallback auf AI-Provider)
- `GET /api/assist/voice/stt/models` – Verfügbare STT-Modelle

## Systemd-Service (IORA OS)

```ini
[Unit]
Description=IORA STT (faster-whisper)
After=network.target

[Service]
Type=simple
User=iora
WorkingDirectory=/opt/iora/services/iora-stt
ExecStart=/opt/iora/services/iora-stt/.venv/bin/python main.py
Restart=on-failure
Environment=IORA_STT_PORT=8110
Environment=IORA_STT_MODEL=base

[Install]
WantedBy=multi-user.target
```
