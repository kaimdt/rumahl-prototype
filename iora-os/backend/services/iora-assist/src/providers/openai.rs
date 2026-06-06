// OpenAI Provider Implementation
use super::{AIProvider, AudioTranscription, ChatMessage, ChatResponse, ProviderConfig, ProviderError, ProviderModel, SpeechSynthesis};
use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};

pub struct OpenAIProvider {
    client: Client,
    config: ProviderConfig,
    provider_id: &'static str,
    display_name: &'static str,
    default_base_url: &'static str,
    default_model: &'static str,
}

impl OpenAIProvider {
    pub fn new(config: ProviderConfig) -> Self {
        Self::with_defaults(config, "openai", "OpenAI", "https://api.openai.com/v1", "gpt-4o-mini")
    }

    pub fn new_compatible(config: ProviderConfig) -> Self {
        Self::with_defaults(config, "compatible", "Custom API", "", "gpt-4o-mini")
    }

    pub fn new_pidev(config: ProviderConfig) -> Self {
        Self::with_defaults(config, "pidev", "pi.dev", "", "gpt-4o-mini")
    }

    fn with_defaults(
        config: ProviderConfig,
        provider_id: &'static str,
        display_name: &'static str,
        default_base_url: &'static str,
        default_model: &'static str,
    ) -> Self {
        Self {
            client: Client::new(),
            config,
            provider_id,
            display_name,
            default_base_url,
            default_model,
        }
    }

    fn base_url(&self) -> Option<&str> {
        self.config.base_url.as_deref().or({
            if self.default_base_url.is_empty() {
                None
            } else {
                Some(self.default_base_url)
            }
        })
    }

    fn selected_model(&self) -> &str {
        self.config.model.as_deref().unwrap_or(self.default_model)
    }
}

#[derive(Debug, Serialize)]
struct OpenAIChatRequest {
    model: String,
    messages: Vec<OpenAIChatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
}

#[derive(Debug, Serialize, Deserialize)]
struct OpenAIChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct OpenAIChatResponse {
    choices: Vec<OpenAIChoice>,
    usage: OpenAIUsage,
    model: String,
}

#[derive(Debug, Deserialize)]
struct OpenAIChoice {
    message: OpenAIChatMessage,
}

#[derive(Debug, Deserialize)]
struct OpenAIUsage {
    total_tokens: u32,
}

#[derive(Debug, Deserialize)]
struct OpenAIModelListResponse {
    data: Vec<OpenAIModel>,
}

#[derive(Debug, Deserialize)]
struct OpenAIModel {
    id: String,
}

#[async_trait]
impl AIProvider for OpenAIProvider {
    fn name(&self) -> &str {
        self.display_name
    }

    fn provider_id(&self) -> &str {
        self.provider_id
    }

    fn capabilities(&self) -> &'static [&'static str] {
        &["chat", "stt", "tts", "models"]
    }

    async fn is_available(&self) -> bool {
        let Some(api_key) = self.config.api_key.as_ref() else {
            return false;
        };
        let Some(base_url) = self.base_url() else {
            return false;
        };

        self.client
            .get(format!("{}/models", base_url.trim_end_matches('/')))
            .header("Authorization", format!("Bearer {}", api_key))
            .send()
            .await
            .map(|response| response.status().is_success())
            .unwrap_or(false)
    }

    async fn list_models(&self) -> Result<Vec<ProviderModel>, ProviderError> {
        let api_key = self.config.api_key.as_ref()
            .ok_or("OpenAI-compatible API key not configured")?;
        let base_url = self.base_url()
            .ok_or("OpenAI-compatible base URL not configured")?;

        let response = self.client
            .get(format!("{}/models", base_url.trim_end_matches('/')))
            .header("Authorization", format!("Bearer {}", api_key))
            .send()
            .await?;

        if !response.status().is_success() {
            let error_text = response.text().await?;
            return Err(format!("{} models API error: {}", self.display_name, error_text).into());
        }

        let payload: OpenAIModelListResponse = response.json().await?;
        Ok(payload.data.into_iter().map(|model| ProviderModel {
            id: model.id.clone(),
            name: model.id,
            provider: self.provider_id.to_string(),
        }).collect())
    }

    async fn chat(
        &self,
        messages: Vec<ChatMessage>,
        system_prompt: Option<String>,
    ) -> Result<ChatResponse, ProviderError> {
        let api_key = self.config.api_key.as_ref()
            .ok_or("OpenAI API key not configured")?;

        let base_url = self.base_url()
            .ok_or("OpenAI-compatible base URL not configured")?;

        let model = self.selected_model();

        let mut openai_messages = Vec::new();

        if let Some(prompt) = system_prompt {
            openai_messages.push(OpenAIChatMessage {
                role: "system".to_string(),
                content: prompt,
            });
        }

        for msg in messages {
            openai_messages.push(OpenAIChatMessage {
                role: msg.role,
                content: msg.content,
            });
        }

        let request = OpenAIChatRequest {
            model: model.to_string(),
            messages: openai_messages,
            temperature: Some(0.7),
        };

        let response = self.client
            .post(format!("{}/chat/completions", base_url.trim_end_matches('/')))
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await?;

        if !response.status().is_success() {
            let error_text = response.text().await?;
            return Err(format!("OpenAI API error: {}", error_text).into());
        }

        let openai_response: OpenAIChatResponse = response.json().await?;

        Ok(ChatResponse {
            message: openai_response.choices[0].message.content.clone(),
            model: openai_response.model,
            provider: self.display_name.to_string(),
            tokens_used: Some(openai_response.usage.total_tokens),
        })
    }

    async fn transcribe_audio(
        &self,
        audio_data: Vec<u8>,
        format: &str,
    ) -> Result<AudioTranscription, ProviderError> {
        let api_key = self.config.api_key.as_ref()
            .ok_or("OpenAI API key not configured")?;

        let base_url = self.base_url()
            .ok_or("OpenAI-compatible base URL not configured")?;

        let form = reqwest::multipart::Form::new()
            .text("model", "whisper-1")
            .part(
                "file",
                reqwest::multipart::Part::bytes(audio_data)
                    .file_name(format!("audio.{}", format))
                    .mime_str(&format!("audio/{}", format))?,
            );

        let response = self.client
            .post(format!("{}/audio/transcriptions", base_url.trim_end_matches('/')))
            .header("Authorization", format!("Bearer {}", api_key))
            .multipart(form)
            .send()
            .await?;

        if !response.status().is_success() {
            let error_text = response.text().await?;
            return Err(format!("OpenAI Whisper API error: {}", error_text).into());
        }

        #[derive(Deserialize)]
        struct WhisperResponse {
            text: String,
            #[serde(default)]
            language: Option<String>,
        }

        let whisper_response: WhisperResponse = response.json().await?;

        Ok(AudioTranscription {
            text: whisper_response.text,
            language: whisper_response.language,
            duration: None,
        })
    }

    async fn synthesize_speech(
        &self,
        text: &str,
        voice: Option<&str>,
    ) -> Result<SpeechSynthesis, ProviderError> {
        let api_key = self.config.api_key.as_ref()
            .ok_or("OpenAI API key not configured")?;

        let base_url = self.base_url()
            .ok_or("OpenAI-compatible base URL not configured")?;

        let voice_name = voice.unwrap_or("alloy");

        #[derive(Serialize)]
        struct TTSRequest {
            model: String,
            input: String,
            voice: String,
        }

        let request = TTSRequest {
            model: "tts-1".to_string(),
            input: text.to_string(),
            voice: voice_name.to_string(),
        };

        let response = self.client
            .post(format!("{}/audio/speech", base_url.trim_end_matches('/')))
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await?;

        if !response.status().is_success() {
            let error_text = response.text().await?;
            return Err(format!("OpenAI TTS API error: {}", error_text).into());
        }

        let audio_bytes = response.bytes().await?.to_vec();

        Ok(SpeechSynthesis {
            audio_data: audio_bytes,
            format: "mp3".to_string(),
            duration: None,
        })
    }
}
