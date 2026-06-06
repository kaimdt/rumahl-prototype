// IORA STT Provider – calls the iora-stt microservice (faster-whisper)
use super::{AIProvider, AudioTranscription, ChatMessage, ChatResponse, ProviderConfig, ProviderError, ProviderModel, SpeechSynthesis};
use async_trait::async_trait;
use reqwest::Client;
use serde::Deserialize;

pub struct IoraSttProvider {
    client: Client,
    config: ProviderConfig,
}

impl IoraSttProvider {
    pub fn new(config: ProviderConfig) -> Self {
        Self {
            client: Client::new(),
            config,
        }
    }

    fn base_url(&self) -> String {
        self.config
            .base_url
            .clone()
            .unwrap_or_else(|| "http://localhost:8110".to_string())
            .trim_end_matches('/')
            .to_string()
    }
}

#[derive(Debug, Deserialize)]
struct TranscriptionResponse {
    text: String,
    language: String,
    language_probability: f32,
    duration: f32,
    #[serde(default)]
    segments: Vec<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct SttHealthResponse {
    status: String,
    model: String,
    model_loaded: bool,
    device: String,
}

#[async_trait]
impl AIProvider for IoraSttProvider {
    fn name(&self) -> &str {
        "IORA STT (faster-whisper)"
    }

    fn provider_id(&self) -> &str {
        "iora_stt"
    }

    fn capabilities(&self) -> &'static [&'static str] {
        &["stt"]
    }

    async fn is_available(&self) -> bool {
        let url = format!("{}/health", self.base_url());
        match self.client.get(&url).send().await {
            Ok(resp) => resp.status().is_success(),
            Err(_) => false,
        }
    }

    async fn list_models(&self) -> Result<Vec<ProviderModel>, ProviderError> {
        let url = format!("{}/models", self.base_url());
        let resp = self.client.get(&url).send().await?;

        if !resp.status().is_success() {
            return Err(format!("STT models endpoint returned {}", resp.status()).into());
        }

        #[derive(Deserialize)]
        struct ModelsResponse {
            available_models: Vec<SttModelInfo>,
            current: String,
        }

        #[derive(Deserialize)]
        struct SttModelInfo {
            id: String,
            #[serde(default)]
            params: String,
        }

        let payload: ModelsResponse = resp.json().await?;
        Ok(payload
            .available_models
            .into_iter()
            .map(|m| ProviderModel {
                id: m.id.clone(),
                name: format!("{} ({})", m.id, m.params),
                provider: "iora_stt".to_string(),
            })
            .collect())
    }

    async fn chat(
        &self,
        _messages: Vec<ChatMessage>,
        _system_prompt: Option<String>,
    ) -> Result<ChatResponse, ProviderError> {
        Err("IORA STT provider does not support chat. Use for transcription only.".into())
    }

    async fn transcribe_audio(
        &self,
        audio_data: Vec<u8>,
        format: &str,
    ) -> Result<AudioTranscription, ProviderError> {
        let base_url = self.base_url();

        let extension = format;

        let part = reqwest::multipart::Part::bytes(audio_data)
            .file_name(format!("audio.{}", extension))
            .mime_str(&format!("audio/{}", extension))?;

        let form = reqwest::multipart::Form::new()
            .part("audio", part)
            .text("vad_filter", "true");

        let response = self
            .client
            .post(format!("{}/transcribe", base_url))
            .multipart(form)
            .send()
            .await?;

        if !response.status().is_success() {
            let error_text = response.text().await?;
            return Err(format!("STT transcription error: {}", error_text).into());
        }

        let transcription: TranscriptionResponse = response.json().await?;

        Ok(AudioTranscription {
            text: transcription.text,
            language: Some(transcription.language),
            duration: Some(transcription.duration),
        })
    }

    async fn synthesize_speech(
        &self,
        _text: &str,
        _voice: Option<&str>,
    ) -> Result<SpeechSynthesis, ProviderError> {
        Err("IORA STT provider does not support TTS. Use IORA TTS for synthesis.".into())
    }
}
