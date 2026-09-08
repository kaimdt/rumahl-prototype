# rumahl TTS – Text-to-Speech (Kokoro ONNX)

Lokaler Text-to-Speech-Microservice powered by
[Kokoro ONNX](https://github.com/thewh1teagle/kokoro-onnx) (82M-Parameter TTS-Modell).

## Schnellstart

```bash
cd rumahl-os/backend/services/rumahl-tts

# Modelle herunterladen (~420 MB)
./download-models.sh

# Virtuelle Umgebung erstellen & Abhängigkeiten installieren
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Starten (Port 8111, Voice "af_nicole")
python main.py
```

## Verfügbare Stimmen

Kokoro unterstützt **30+ Stimmen** in **10 Sprachen**:

| Sprache | Stimmen |
|---|---|
| Englisch (US) | `af_sarah`, `af_nicole`, `af_bella`, `af_sky`, `am_adam`, `am_michael`, `am_liam` |
| Englisch (UK) | `bf_emma`, `bf_isabella`, `bm_george`, `bm_lewis` |
| Spanisch | `sf_abuela`, `sm_mario` |
| Französisch | `ff_siwis`, `fm_alex` |
| Italienisch | `if_eima`, `im_nicola` |
| Japanisch | `jf_alpha`, `jf_gongitsune`, `jf_nezumi`, `jf_tebukuro`, `jm_kumo` |
| Chinesisch | `zf_xiaobei`, `zf_xiaoni`, `zf_xiaoxiao`, `zf_xiaoyi`, `zm_yunjian`, `zm_yunxia` |
| Koreanisch | `kf_kongbaksa` |
| Portugiesisch | `pf_dora`, `pm_alex`, `pm_santa` |
| Deutsch | `df_clara` |

## Konfiguration (Environment Variables)

| Variable | Default | Beschreibung |
|---|---|---|
| `RUMAHL_TTS_PORT` | `8111` | HTTP Port |
| `RUMAHL_TTS_VOICE` | `af_nicole` | Standard-Stimme |
| `RUMAHL_TTS_LANG` | `en-us` | Standard-Sprache |
| `RUMAHL_TTS_SPEED` | `1.0` | Geschwindigkeit (0.5–2.0) |
| `RUMAHL_TTS_MODEL_PATH` | `kokoro-v1.0.onnx` | Pfad zum ONNX-Modell |
| `RUMAHL_TTS_VOICES_PATH` | `voices-v1.0.bin` | Pfad zur Voices-Datei |
| `RUMAHL_TTS_FORMAT` | `wav` | Ausgabeformat (`wav` oder `raw`) |
| `RUMAHL_TTS_AUTO_LOAD` | `1` | Modell beim Start laden |

## API Endpunkte

### `GET /health`
Health-Check mit Status und geladener Stimme.

### `GET /voices`
Liste aller verfügbaren Stimmen mit Metadaten.

### `POST /synthesize`
Text in Sprache umwandeln.

**Request:**
```json
{
  "text": "Hello, I am rumahl.",
  "voice": "af_nicole",
  "speed": 1.0,
  "lang": "en-us",
  "format": "wav"
}
```

**Response:** Audio-Daten (WAV) mit Headers:
- `X-Audio-Duration` – Dauer in Sekunden
- `X-Synthesis-Time` – Synthesezeit in Sekunden
- `X-Voice` – Verwendete Stimme
- `X-Language` – Verwendete Sprache

### `POST /synthesize/stream`
Streaming-Synthese (Chunked Transfer).

## Integration in rumahl Assist

Der rumahl-assist Service erkennt den TTS-Service automatisch und registriert
ihn als Provider `rumahl_tts`. Die Dedicated-Endpunkte:

- `POST /api/assist/voice/tts` – Synthese (bevorzugt lokales TTS, Fallback auf AI-Provider)
- `GET /api/assist/voice/tts/voices` – Verfügbare TTS-Stimmen

## Systemd-Service (rumahl OS)

```ini
[Unit]
Description=rumahl TTS (Kokoro ONNX)
After=network.target

[Service]
Type=simple
User=ora
WorkingDirectory=/opt/rumahl/services/rumahl-tts
ExecStart=/opt/rumahl/services/rumahl-tts/.venv/bin/python main.py
Restart=on-failure
Environment=RUMAHL_TTS_PORT=8111
Environment=RUMAHL_TTS_VOICE=af_nicole

[Install]
WantedBy=multi-user.target
```
