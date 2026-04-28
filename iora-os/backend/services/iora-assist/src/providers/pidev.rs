// Pi.dev Provider - Enables ORA to use pi.dev for self-evolution and code generation
use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};

use super::{AIProvider, AudioTranscription, ChatMessage, ChatResponse, ProviderConfig, ProviderError, ProviderModel, SpeechSynthesis};

pub struct PiDevProvider {
    client: Client,
    config: ProviderConfig,
}

impl PiDevProvider {
    pub fn new(config: ProviderConfig) -> Self {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(120)) // longer timeout for code generation
            .build()
            .expect("Failed to create HTTP client");

        Self { client, config }
    }

    pub fn from_config(config: ProviderConfig) -> Box<dyn AIProvider> {
        Box::new(Self::new(config))
    }

    fn base_url(&self) -> &str {
        self.config.base_url.as_deref().unwrap_or("http://localhost:3000")
    }

    fn selected_model(&self) -> String {
        self.config.model.clone().unwrap_or_else(|| "pi-dev".to_string())
    }
}

#[async_trait]
impl AIProvider for PiDevProvider {
    fn name(&self) -> &str {
        "Pi.dev"
    }

    fn provider_id(&self) -> &str {
        "pidev"
    }

    fn capabilities(&self) -> &'static [&'static str] {
        &["chat", "stt", "tts", "code_generation", "self_evolution"]
    }

    async fn is_available(&self) -> bool {
        let Some(api_key) = self.config.api_key.as_ref() else {
            return false;
        };
        let base_url = self.base_url();

        #[derive(Serialize)]
        struct PingRequest {
            model: String,
            messages: Vec<serde_json::Value>,
            max_tokens: u32,
        }

        let ping = PingRequest {
            model: self.selected_model(),
            messages: vec![serde_json::json!({"role": "user", "content": "ok"})],
            max_tokens: 1,
        };

        match self.client
            .post(format!("{}/v1/chat/completions", base_url))
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&ping)
            .send()
            .await
        {
            Ok(resp) => resp.status().is_success(),
            Err(_) => false,
        }
    }

    async fn list_models(&self) -> Result<Vec<ProviderModel>, ProviderError> {
        let api_key = self.config.api_key.as_ref()
            .ok_or("Pi.dev API key not configured")?;
        let base_url = self.base_url();

        #[derive(Deserialize)]
        struct ModelsResponse {
            data: Vec<ModelInfo>,
        }
        #[derive(Deserialize)]
        struct ModelInfo {
            id: String,
        }

        match self.client
            .get(format!("{}/v1/models", base_url))
            .header("Authorization", format!("Bearer {}", api_key))
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                let body: ModelsResponse = resp.json().await?;
                Ok(body.data.into_iter().map(|m| ProviderModel {
                    id: m.id.clone(),
                    name: m.id,
                    provider: "pidev".to_string(),
                }).collect())
            }
            _ => {
                // Fallback to configured model if endpoint not available
                Ok(vec![ProviderModel {
                    id: self.selected_model(),
                    name: format!("Pi.dev {}", self.selected_model()),
                    provider: "pidev".to_string(),
                }])
            }
        }
    }

    async fn chat(
        &self,
        messages: Vec<ChatMessage>,
        system_prompt: Option<String>,
    ) -> Result<ChatResponse, ProviderError> {
        let api_key = self.config.api_key.as_ref()
            .ok_or("Pi.dev API key not configured")?;

        let base_url = self.base_url();
        let model = self.selected_model();

        // Build messages with optional system prompt
        #[derive(Serialize, Deserialize)]
        struct ChatMessageInner {
            role: String,
            content: String,
        }

        let mut all_messages: Vec<ChatMessageInner> = Vec::new();

        if let Some(sys) = system_prompt {
            all_messages.push(ChatMessageInner {
                role: "system".to_string(),
                content: sys,
            });
        }

        for m in &messages {
            all_messages.push(ChatMessageInner {
                role: m.role.clone(),
                content: m.content.clone(),
            });
        }

        #[derive(Serialize)]
        struct PiDevRequest {
            model: String,
            messages: Vec<ChatMessageInner>,
            temperature: f32,
            max_tokens: u32,
        }

        let req_body = PiDevRequest {
            model,
            messages: all_messages,
            temperature: 0.7,
            max_tokens: 4096,
        };

        // Add custom pi.dev headers for self-evolution context
        let response = self.client
            .post(format!("{}/v1/chat/completions", base_url))
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .header("X-Evolution-Mode", "true")
            .json(&req_body)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("Pi.dev API error ({}): {}", status, error_text).into());
        }

        #[derive(Deserialize)]
        struct PiDevResponse {
            choices: Vec<PiDevChoice>,
            usage: Option<PiDevUsage>,
        }

        #[derive(Deserialize)]
        struct PiDevChoice {
            message: ChatMessageInner,
            finish_reason: Option<String>,
        }

        #[derive(Deserialize)]
        struct PiDevUsage {
            prompt_tokens: u32,
            completion_tokens: u32,
            total_tokens: u32,
        }

        let resp: PiDevResponse = response.json().await?;

        if resp.choices.is_empty() {
            return Err("Pi.dev returned no choices".to_string().into());
        }

        let choice = &resp.choices[0];

        Ok(ChatResponse {
            message: choice.message.content.clone(),
            model: self.selected_model(),
            provider: "pidev".to_string(),
            tokens_used: resp.usage.as_ref().map(|u| u.total_tokens),
        })
    }

    async fn transcribe_audio(
        &self,
        audio_data: Vec<u8>,
        format: &str,
    ) -> Result<AudioTranscription, ProviderError> {
        let api_key = self.config.api_key.as_ref()
            .ok_or("Pi.dev API key not configured")?;

        let base_url = self.base_url();

        // Pi.dev supports OpenAI-compatible Whisper endpoint
        let form = reqwest::multipart::Form::new()
            .text("model", "whisper-1")
            .part(
                "file",
                reqwest::multipart::Part::bytes(audio_data)
                    .file_name(format!("audio.{}", format))
                    .mime_str(&format!("audio/{}", format))?,
            );

        let response = self.client
            .post(format!("{}/v1/audio/transcriptions", base_url))
            .header("Authorization", format!("Bearer {}", api_key))
            .multipart(form)
            .send()
            .await?;

        if !response.status().is_success() {
            let error_text = response.text().await?;
            return Err(format!("Pi.dev transcription error: {}", error_text).into());
        }

        #[derive(Deserialize)]
        struct PiDevTranscriptionResponse {
            text: String,
            #[serde(default)]
            language: Option<String>,
        }

        let transcription: PiDevTranscriptionResponse = response.json().await?;

        Ok(AudioTranscription {
            text: transcription.text,
            language: transcription.language,
            duration: None,
        })
    }

    async fn synthesize_speech(
        &self,
        text: &str,
        voice: Option<&str>,
    ) -> Result<SpeechSynthesis, ProviderError> {
        let api_key = self.config.api_key.as_ref()
            .ok_or("Pi.dev API key not configured")?;

        let base_url = self.base_url();

        #[derive(Serialize)]
        struct PiDevTTSRequest {
            model: String,
            input: String,
            voice: String,
        }

        let request = PiDevTTSRequest {
            model: "tts-1".to_string(),
            input: text.to_string(),
            voice: voice.unwrap_or("alloy").to_string(),
        };

        let response = self.client
            .post(format!("{}/v1/audio/speech", base_url))
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await?;

        if !response.status().is_success() {
            let error_text = response.text().await?;
            return Err(format!("Pi.dev TTS error: {}", error_text).into());
        }

        let audio_bytes = response.bytes().await?.to_vec();

        Ok(SpeechSynthesis {
            audio_data: audio_bytes,
            format: "mp3".to_string(),
            duration: None,
        })
    }
}
