// ORA TTS Provider – calls the rumahl-tts microservice (Kokoro ONNX)
use super::{
    AIProvider, AudioTranscription, ChatMessage, ChatResponse, ProviderConfig, ProviderError,
    ProviderModel, SpeechSynthesis,
};
use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};

pub struct RumahlTtsProvider {
    client: Client,
    config: ProviderConfig,
}

impl RumahlTtsProvider {
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
            .unwrap_or_else(|| "http://localhost:8111".to_string())
            .trim_end_matches('/')
            .to_string()
    }
}

#[derive(Debug, Serialize)]
struct SynthesizeRequest {
    text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    voice: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    speed: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    lang: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    format: Option<String>,
}

#[derive(Debug, Deserialize)]
struct VoiceInfo {
    id: String,
    name: String,
    gender: String,
    language: String,
}

#[derive(Debug, Deserialize)]
struct VoicesResponse {
    voices: Vec<VoiceInfo>,
    default: String,
    default_lang: String,
    languages: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct TtsHealthResponse {
    status: String,
    model_loaded: bool,
    default_voice: String,
    voices_count: i32,
}

#[async_trait]
impl AIProvider for RumahlTtsProvider {
    fn name(&self) -> &str {
        "ORA TTS (Kokoro)"
    }

    fn provider_id(&self) -> &str {
        "rumahl_tts"
    }

    fn capabilities(&self) -> &'static [&'static str] {
        &["tts"]
    }

    async fn is_available(&self) -> bool {
        let url = format!("{}/health", self.base_url());
        match self.client.get(&url).send().await {
            Ok(resp) => resp.status().is_success(),
            Err(_) => false,
        }
    }

    async fn list_models(&self) -> Result<Vec<ProviderModel>, ProviderError> {
        let url = format!("{}/voices", self.base_url());
        let resp = self.client.get(&url).send().await?;

        if !resp.status().is_success() {
            return Err(format!("TTS voices endpoint returned {}", resp.status()).into());
        }

        let payload: VoicesResponse = resp.json().await?;
        Ok(payload
            .voices
            .into_iter()
            .map(|v| ProviderModel {
                id: v.id.clone(),
                name: format!("{} ({}/{})", v.name, v.gender, v.language),
                provider: "rumahl_tts".to_string(),
            })
            .collect())
    }

    async fn chat(
        &self,
        _messages: Vec<ChatMessage>,
        _system_prompt: Option<String>,
    ) -> Result<ChatResponse, ProviderError> {
        Err("ORA TTS provider does not support chat. Use for speech synthesis only.".into())
    }

    async fn transcribe_audio(
        &self,
        _audio_data: Vec<u8>,
        _format: &str,
    ) -> Result<AudioTranscription, ProviderError> {
        Err("ORA TTS provider does not support STT. Use ORA STT for transcription.".into())
    }

    async fn synthesize_speech(
        &self,
        text: &str,
        voice: Option<&str>,
    ) -> Result<SpeechSynthesis, ProviderError> {
        let base_url = self.base_url();

        // If model is configured in ProviderConfig, use it as the voice
        let effective_voice = voice
            .or(self.config.model.as_deref())
            .map(|s| s.to_string());

        // Determine language from voice if possible
        let lang = self.config.api_version.clone().or_else(|| {
            // Derive language from voice prefix (e.g., "af_" -> "en-us")
            voice.and_then(|v| {
                let prefix = v.split('_').next()?;
                match prefix {
                    "af" | "am" => Some("en-us".to_string()),
                    "bf" | "bm" => Some("en-gb".to_string()),
                    "sf" | "sm" => Some("es".to_string()),
                    "ff" | "fm" => Some("fr-fr".to_string()),
                    "if" | "im" => Some("it".to_string()),
                    "jf" | "jm" => Some("ja".to_string()),
                    "zf" | "zm" => Some("zh".to_string()),
                    "kf" => Some("ko".to_string()),
                    "pf" | "pm" => Some("pt-br".to_string()),
                    "df" | "dm" => Some("de".to_string()),
                    _ => None,
                }
            })
        });

        let request = SynthesizeRequest {
            text: text.to_string(),
            voice: effective_voice,
            speed: None,
            lang,
            format: Some("wav".to_string()),
        };

        let response = self
            .client
            .post(format!("{}/synthesize", base_url))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await?;

        if !response.status().is_success() {
            let error_text = response.text().await?;
            return Err(format!("TTS synthesis error: {}", error_text).into());
        }

        // Extract metadata from headers
        let format = "wav".to_string();
        let duration: Option<f32> = response
            .headers()
            .get("X-Audio-Duration")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse().ok());

        let audio_data = response.bytes().await?.to_vec();

        Ok(SpeechSynthesis {
            audio_data,
            format,
            duration,
        })
    }
}
