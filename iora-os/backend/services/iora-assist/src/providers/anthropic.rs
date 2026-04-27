// Anthropic Claude Provider Implementation
use super::{AIProvider, AudioTranscription, ChatMessage, ChatResponse, ProviderConfig, SpeechSynthesis};
use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};

pub struct AnthropicProvider {
    client: Client,
    config: ProviderConfig,
}

impl AnthropicProvider {
    pub fn new(config: ProviderConfig) -> Self {
        Self {
            client: Client::new(),
            config,
        }
    }
}

#[derive(Debug, Serialize)]
struct AnthropicChatRequest {
    model: String,
    messages: Vec<AnthropicMessage>,
    max_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct AnthropicMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct AnthropicChatResponse {
    content: Vec<AnthropicContent>,
    model: String,
    usage: AnthropicUsage,
}

#[derive(Debug, Deserialize)]
struct AnthropicContent {
    text: String,
}

#[derive(Debug, Deserialize)]
struct AnthropicUsage {
    input_tokens: u32,
    output_tokens: u32,
}

#[async_trait]
impl AIProvider for AnthropicProvider {
    fn name(&self) -> &str {
        "Anthropic"
    }

    async fn is_available(&self) -> bool {
        self.config.api_key.is_some()
    }

    async fn chat(
        &self,
        messages: Vec<ChatMessage>,
        system_prompt: Option<String>,
    ) -> Result<ChatResponse, Box<dyn std::error::Error + Send + Sync>> {
        let api_key = self.config.api_key.as_ref()
            .ok_or("Anthropic API key not configured")?;

        let base_url = self.config.base_url.as_deref()
            .unwrap_or("https://api.anthropic.com/v1");

        let model = self.config.model.as_deref()
            .unwrap_or("claude-3-5-sonnet-20241022");

        let api_version = self.config.api_version.as_deref()
            .unwrap_or("2023-06-01");

        let anthropic_messages: Vec<AnthropicMessage> = messages
            .into_iter()
            .map(|msg| AnthropicMessage {
                role: msg.role,
                content: msg.content,
            })
            .collect();

        let request = AnthropicChatRequest {
            model: model.to_string(),
            messages: anthropic_messages,
            max_tokens: 4096,
            system: system_prompt,
        };

        let response = self.client
            .post(format!("{}/messages", base_url))
            .header("x-api-key", api_key)
            .header("anthropic-version", api_version)
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await?;

        if !response.status().is_success() {
            let error_text = response.text().await?;
            return Err(format!("Anthropic API error: {}", error_text).into());
        }

        let anthropic_response: AnthropicChatResponse = response.json().await?;

        let text = anthropic_response.content
            .first()
            .map(|c| c.text.clone())
            .unwrap_or_default();

        let total_tokens = anthropic_response.usage.input_tokens
            + anthropic_response.usage.output_tokens;

        Ok(ChatResponse {
            message: text,
            model: anthropic_response.model,
            provider: "Anthropic".to_string(),
            tokens_used: Some(total_tokens),
        })
    }

    async fn transcribe_audio(
        &self,
        _audio_data: Vec<u8>,
        _format: &str,
    ) -> Result<AudioTranscription, Box<dyn std::error::Error + Send + Sync>> {
        Err("Anthropic does not currently support native audio transcription. Use OpenAI Whisper or local STT.".into())
    }

    async fn synthesize_speech(
        &self,
        _text: &str,
        _voice: Option<&str>,
    ) -> Result<SpeechSynthesis, Box<dyn std::error::Error + Send + Sync>> {
        Err("Anthropic does not support text-to-speech. Use OpenAI TTS or local TTS.".into())
    }
}
