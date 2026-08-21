# ORA AI (ORA Assist)

**ORA AI** is the AI platform for ORA, providing intelligent assistance through multiple AI providers with full voice capability support.

## Features

- **Multi-Provider Support**: Switch between OpenAI, Anthropic Claude, local AI (Ollama/LM Studio), or desktop AI
- **Voice Interaction**: Full speech-to-text and text-to-speech capabilities
- **Smart Home Integration**: Context-aware AI that understands your rumahl system
- **Natural Language**: Control your home and get insights using plain language
- **Runtime Provider Switching**: Change AI providers without restarting

## Supported AI Providers

| Provider | Chat | STT | TTS | API Key | Notes |
|----------|------|-----|-----|---------|-------|
| **OpenAI** | ✅ | ✅ | ✅ | Required | GPT-4, Whisper, TTS-1 |
| **Anthropic** | ✅ | ❌ | ❌ | Required | Claude 3.5 Sonnet |
| **LocalAI** | ✅ | ✅ | ✅ | Optional | Ollama, LM Studio |
| **DesktopAI** | ✅ | ✅ | ✅ | Optional | Via ORA Desktop |

## Quick Start

### 1. Configuration

Create a `.env` file or set environment variables:

```env
# Choose your AI provider
RUMAHL_AI_PROVIDER=local

# Provider-specific configuration
RUMAHL_AI_BASE_URL=http://localhost:11434
RUMAHL_AI_MODEL=llama3.2
```

### 2. Run the Service

```bash
# Development
cargo run

# Production
cargo build --release
./target/release/rumahl-assist
```

The service will start on port 8092 by default.

### 3. Test the API

```bash
# Check health
curl http://localhost:8092/health

# Send a chat message
curl -X POST http://localhost:8092/api/assist/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello, what can you do?"}'

# Transcribe audio
curl -X POST http://localhost:8092/api/assist/voice/transcribe \
  -F "audio=@recording.webm" \
  -F "format=webm"

# Synthesize speech
curl -X POST http://localhost:8092/api/assist/voice/synthesize \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello, this is ORA Assist", "voice": "alloy"}' \
  --output speech.mp3
```

## Configuration Examples

### OpenAI

```env
RUMAHL_AI_PROVIDER=openai
RUMAHL_AI_API_KEY=sk-proj-your-key-here
RUMAHL_AI_MODEL=gpt-4o-mini
```

Capabilities: Chat, STT (Whisper), TTS

### Anthropic Claude

```env
RUMAHL_AI_PROVIDER=anthropic
RUMAHL_AI_API_KEY=sk-ant-your-key-here
RUMAHL_AI_MODEL=claude-3-5-sonnet-20241022
RUMAHL_AI_API_VERSION=2023-06-01
```

Capabilities: Chat only (no voice)

### Local AI (Ollama)

```env
RUMAHL_AI_PROVIDER=local
RUMAHL_AI_BASE_URL=http://localhost:11434
RUMAHL_AI_MODEL=llama3.2
```

Prerequisites:
- Install [Ollama](https://ollama.ai/)
- Pull a model: `ollama pull llama3.2`
- Start Ollama: `ollama serve`

### Desktop AI (ORA Desktop)

```env
RUMAHL_AI_PROVIDER=desktop
RUMAHL_AI_BASE_URL=http://localhost:11435
```

Prerequisites:
- Install ORA Desktop
- Configure LM Studio proxy in desktop settings
- Ensure proxy is running

## API Endpoints

### Chat

```http
POST /api/assist/chat
Content-Type: application/json

{
  "message": "What's the weather like?",
  "system_prompt": "You are ORA Assist...",
  "context": {}
}
```

Response:
```json
{
  "message": "I'll check the weather for you...",
  "model": "gpt-4o-mini",
  "provider": "OpenAI",
  "tokens_used": 150,
  "message_id": "uuid",
  "timestamp": "2024-01-01T12:00:00Z"
}
```

### Speech-to-Text

```http
POST /api/assist/voice/transcribe
Content-Type: multipart/form-data

audio: <file>
format: webm
```

Response:
```json
{
  "text": "Turn on the living room lights",
  "language": "en",
  "duration": 2.5,
  "provider": "OpenAI"
}
```

### Text-to-Speech

```http
POST /api/assist/voice/synthesize
Content-Type: application/json

{
  "text": "The lights are now on",
  "voice": "alloy"
}
```

Response: Audio file (MP3/WAV/OGG)

### Provider Management

List providers:
```http
GET /api/assist/providers
```

Switch provider:
```http
POST /api/assist/providers/switch
Content-Type: application/json

{
  "provider": "openai",
  "config": {
    "api_key": "sk-...",
    "model": "gpt-4o-mini"
  }
}
```

## Voice Capabilities

### Supported Audio Formats

**Input (STT)**:
- WebM (browser recording)
- MP3
- WAV
- OGG/Opus
- M4A
- FLAC

**Output (TTS)**:
- MP3 (OpenAI, Desktop)
- WAV (Local)
- OGG (Local)

### Voice Options

OpenAI voices: `alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`

Local AI voices depend on your TTS engine configuration.

## Architecture

ORA AI uses a trait-based provider abstraction:

```rust
#[async_trait]
pub trait AIProvider: Send + Sync {
    fn name(&self) -> &str;
    async fn is_available(&self) -> bool;
    async fn chat(messages, system_prompt) -> Result<ChatResponse>;
    async fn transcribe_audio(audio, format) -> Result<AudioTranscription>;
    async fn synthesize_speech(text, voice) -> Result<SpeechSynthesis>;
}
```

This allows:
- Runtime provider switching
- Unified API regardless of backend
- Easy addition of new providers
- Graceful fallback handling

## Integration with ORA

ORA AI integrates with the ORA ecosystem:

1. **Smart Home Context**: Access to entity states via `rumahl-home`
2. **Automation Creation**: Natural language to automation rules
3. **Insights**: AI-generated analysis of home patterns
4. **Voice Control**: Hands-free home management
5. **Desktop Integration**: Offline AI via ORA Desktop

## Development

### Adding a New Provider

1. Create a new file in `src/providers/`:

```rust
// src/providers/my_provider.rs
use super::{AIProvider, ChatResponse, /* ... */};
use async_trait::async_trait;

pub struct MyProvider {
    config: ProviderConfig,
}

#[async_trait]
impl AIProvider for MyProvider {
    fn name(&self) -> &str { "MyProvider" }
    // Implement required methods...
}
```

2. Add to `src/providers/mod.rs`:

```rust
pub mod my_provider;

pub enum ProviderType {
    // ...
    MyProvider,
}

pub fn create_provider(provider_type: ProviderType, config: ProviderConfig) -> Box<dyn AIProvider> {
    match provider_type {
        // ...
        ProviderType::MyProvider => Box::new(my_provider::MyProvider::new(config)),
    }
}
```

3. Update environment configuration in `main.rs`.

### Testing

```bash
# Check compilation
cargo check

# Run tests
cargo test

# Run with debug logging
RUST_LOG=debug cargo run
```

## Troubleshooting

### "AI provider not available"

Check that:
- Provider is configured correctly
- API keys are valid (for OpenAI/Anthropic)
- Local AI server is running (for Local/Desktop)
- Network connectivity is working

### "Transcription failed"

Ensure:
- Audio format is supported
- Audio file is not corrupted
- Provider supports STT (Anthropic does not)

### "Speech synthesis failed"

Verify:
- Text is not empty
- Provider supports TTS
- Voice name is valid for the provider

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RUMAHL_AI_PROVIDER` | No | `local` | AI provider (openai/anthropic/local/desktop) |
| `RUMAHL_AI_API_KEY` | Sometimes | - | API key for OpenAI/Anthropic |
| `RUMAHL_AI_BASE_URL` | Sometimes | - | Base URL for Local/Desktop |
| `RUMAHL_AI_MODEL` | No | Provider-specific | Model name to use |
| `RUMAHL_AI_API_VERSION` | No | - | API version (Anthropic) |
| `PORT` | No | `8092` | Service port |
| `RUST_LOG` | No | `info` | Logging level |

## License

MIT

## Links

- [ORA Architecture](../../ARCHITECTURE.md)
- [OpenAI API](https://platform.openai.com/docs)
- [Anthropic API](https://docs.anthropic.com/)
- [Ollama](https://ollama.ai/)
- [LM Studio](https://lmstudio.ai/)
