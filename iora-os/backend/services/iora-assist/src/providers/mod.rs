// ORA AI Provider Module
// Abstraction layer for different AI providers

pub mod openai;
pub mod anthropic;
pub mod local;
pub mod desktop;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatResponse {
    pub message: String,
    pub model: String,
    pub provider: String,
    pub tokens_used: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioTranscription {
    pub text: String,
    pub language: Option<String>,
    pub duration: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpeechSynthesis {
    pub audio_data: Vec<u8>,
    pub format: String,
    pub duration: Option<f32>,
}

#[async_trait]
pub trait AIProvider: Send + Sync {
    /// Get the provider name
    fn name(&self) -> &str;

    /// Check if the provider is available/configured
    async fn is_available(&self) -> bool;

    /// Send a chat message and get a response
    async fn chat(
        &self,
        messages: Vec<ChatMessage>,
        system_prompt: Option<String>,
    ) -> Result<ChatResponse, Box<dyn std::error::Error + Send + Sync>>;

    /// Transcribe audio to text (Speech-to-Text)
    async fn transcribe_audio(
        &self,
        audio_data: Vec<u8>,
        format: &str,
    ) -> Result<AudioTranscription, Box<dyn std::error::Error + Send + Sync>>;

    /// Synthesize speech from text (Text-to-Speech)
    async fn synthesize_speech(
        &self,
        text: &str,
        voice: Option<&str>,
    ) -> Result<SpeechSynthesis, Box<dyn std::error::Error + Send + Sync>>;
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ProviderType {
    OpenAI,
    Anthropic,
    Local,
    Desktop,
}

pub fn create_provider(
    provider_type: ProviderType,
    config: ProviderConfig,
) -> Box<dyn AIProvider> {
    match provider_type {
        ProviderType::OpenAI => Box::new(openai::OpenAIProvider::new(config)),
        ProviderType::Anthropic => Box::new(anthropic::AnthropicProvider::new(config)),
        ProviderType::Local => Box::new(local::LocalAIProvider::new(config)),
        ProviderType::Desktop => Box::new(desktop::DesktopAIProvider::new(config)),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub api_version: Option<String>,
}

impl Default for ProviderConfig {
    fn default() -> Self {
        Self {
            api_key: None,
            base_url: None,
            model: None,
            api_version: None,
        }
    }
}
