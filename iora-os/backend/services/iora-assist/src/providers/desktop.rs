// Desktop AI Provider Implementation (via IORA Desktop client)
use super::{AIProvider, AudioTranscription, ChatMessage, ChatResponse, ProviderConfig, ProviderError, ProviderModel, SpeechSynthesis};
use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};

pub struct DesktopAIProvider {
    client: Client,
    config: ProviderConfig,
}

impl DesktopAIProvider {
    pub fn new(config: ProviderConfig) -> Self {
        Self {
            client: Client::new(),
            config,
        }
    }
}

#[derive(Debug, Serialize)]
struct DesktopChatRequest {
    model: String,
    messages: Vec<DesktopChatMessage>,
}

#[derive(Debug, Serialize, Deserialize)]
struct DesktopChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct DesktopChatResponse {
    choices: Vec<DesktopChoice>,
    model: String,
}

#[derive(Debug, Deserialize)]
struct DesktopChoice {
    message: DesktopChatMessage,
}

#[derive(Debug, Deserialize)]
struct DesktopModelsResponse {
    data: Vec<DesktopModel>,
}

#[derive(Debug, Deserialize)]
struct DesktopModel {
    id: String,
}

#[async_trait]
impl AIProvider for DesktopAIProvider {
    fn name(&self) -> &str {
        "DesktopAI"
    }

    fn provider_id(&self) -> &str {
        "desktop"
    }

    fn capabilities(&self) -> &'static [&'static str] {
        &["chat", "stt", "tts", "models"]
    }

    async fn is_available(&self) -> bool {
        if let Some(base_url) = &self.config.base_url {
            // Try to ping the desktop AI proxy (LM Studio via IORA Desktop)
            if let Ok(response) = self.client
                .get(format!("{}/v1/models", base_url))
                .send()
                .await
            {
                return response.status().is_success();
            }
        }
        false
    }

    async fn list_models(&self) -> Result<Vec<ProviderModel>, ProviderError> {
        let base_url = self.config.base_url.as_ref()
            .ok_or("Desktop AI base URL not configured")?;

        let mut req_builder = self.client
            .get(format!("{}/v1/models", base_url.trim_end_matches('/')));

        if let Some(api_key) = &self.config.api_key {
            req_builder = req_builder.header("Authorization", format!("Bearer {}", api_key));
        }

        let response = req_builder.send().await?;
        if !response.status().is_success() {
            let error_text = response.text().await?;
            return Err(format!("Desktop AI model discovery failed: {}", error_text).into());
        }

        let payload: DesktopModelsResponse = response.json().await?;
        Ok(payload.data.into_iter().map(|model| ProviderModel {
            id: model.id.clone(),
            name: model.id,
            provider: "desktop".to_string(),
        }).collect())
    }

    async fn chat(
        &self,
        messages: Vec<ChatMessage>,
        system_prompt: Option<String>,
    ) -> Result<ChatResponse, ProviderError> {
        let base_url = self.config.base_url.as_ref()
            .ok_or("Desktop AI base URL not configured (should point to IORA Desktop proxy)")?;

        let model = if let Some(model) = self.config.model.as_deref() {
            model.to_string()
        } else {
            self.list_models().await?
                .into_iter()
                .next()
                .map(|model| model.id)
                .unwrap_or_else(|| "local-model".to_string())
        };

        let mut desktop_messages = Vec::new();

        if let Some(prompt) = system_prompt {
            desktop_messages.push(DesktopChatMessage {
                role: "system".to_string(),
                content: prompt,
            });
        }

        for msg in messages {
            desktop_messages.push(DesktopChatMessage {
                role: msg.role,
                content: msg.content,
            });
        }

        let request = DesktopChatRequest {
            model,
            messages: desktop_messages,
        };

        let mut req_builder = self.client
            .post(format!("{}/v1/chat/completions", base_url))
            .header("Content-Type", "application/json")
            .json(&request);

        // Add API key if configured (optional for local desktop proxy)
        if let Some(api_key) = &self.config.api_key {
            req_builder = req_builder.header("Authorization", format!("Bearer {}", api_key));
        }

        let response = req_builder.send().await?;

        if !response.status().is_success() {
            let error_text = response.text().await?;
            return Err(format!("Desktop AI proxy error: {}", error_text).into());
        }

        let desktop_response: DesktopChatResponse = response.json().await?;

        Ok(ChatResponse {
            message: desktop_response.choices[0].message.content.clone(),
            model: desktop_response.model,
            provider: "DesktopAI".to_string(),
            tokens_used: None,
        })
    }

    async fn transcribe_audio(
        &self,
        audio_data: Vec<u8>,
        format: &str,
    ) -> Result<AudioTranscription, ProviderError> {
        let base_url = self.config.base_url.as_ref()
            .ok_or("Desktop AI base URL not configured")?;

        // OpenAI-compatible Whisper endpoint via desktop proxy
        let form = reqwest::multipart::Form::new()
            .text("model", "whisper-1")
            .part(
                "file",
                reqwest::multipart::Part::bytes(audio_data)
                    .file_name(format!("audio.{}", format))
                    .mime_str(&format!("audio/{}", format))?,
            );

        let mut req_builder = self.client
            .post(format!("{}/v1/audio/transcriptions", base_url))
            .multipart(form);

        if let Some(api_key) = &self.config.api_key {
            req_builder = req_builder.header("Authorization", format!("Bearer {}", api_key));
        }

        let response = req_builder.send().await?;

        if !response.status().is_success() {
            let error_text = response.text().await?;
            return Err(format!("Desktop AI transcription error: {}", error_text).into());
        }

        #[derive(Deserialize)]
        struct DesktopTranscriptionResponse {
            text: String,
            #[serde(default)]
            language: Option<String>,
        }

        let transcription: DesktopTranscriptionResponse = response.json().await?;

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
        let base_url = self.config.base_url.as_ref()
            .ok_or("Desktop AI base URL not configured")?;

        #[derive(Serialize)]
        struct DesktopTTSRequest {
            model: String,
            input: String,
            voice: String,
        }

        let request = DesktopTTSRequest {
            model: "tts-1".to_string(),
            input: text.to_string(),
            voice: voice.unwrap_or("alloy").to_string(),
        };

        let mut req_builder = self.client
            .post(format!("{}/v1/audio/speech", base_url))
            .header("Content-Type", "application/json")
            .json(&request);

        if let Some(api_key) = &self.config.api_key {
            req_builder = req_builder.header("Authorization", format!("Bearer {}", api_key));
        }

        let response = req_builder.send().await?;

        if !response.status().is_success() {
            let error_text = response.text().await?;
            return Err(format!("Desktop AI TTS error: {}", error_text).into());
        }

        let audio_bytes = response.bytes().await?.to_vec();

        Ok(SpeechSynthesis {
            audio_data: audio_bytes,
            format: "mp3".to_string(),
            duration: None,
        })
    }
}
