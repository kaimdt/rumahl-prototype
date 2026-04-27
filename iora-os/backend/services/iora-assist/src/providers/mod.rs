// ORA AI Provider Module
// Abstraction layer for different AI providers

pub mod openai;
pub mod anthropic;
pub mod local;
pub mod desktop;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

pub type ProviderError = Box<dyn std::error::Error + Send + Sync>;

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderModel {
    pub id: String,
    pub name: String,
    pub provider: String,
}

#[async_trait]
pub trait AIProvider: Send + Sync {
    /// Get the provider name
    fn name(&self) -> &str;

    /// Stable provider identifier for persistence and UI selection.
    fn provider_id(&self) -> &str;

    /// Feature set exposed by the provider.
    fn capabilities(&self) -> &'static [&'static str];

    /// Check if the provider is available/configured
    async fn is_available(&self) -> bool;

    /// Discover models from the provider when the upstream supports it.
    async fn list_models(&self) -> Result<Vec<ProviderModel>, ProviderError> {
        Ok(Vec::new())
    }

    /// Send a chat message and get a response
    async fn chat(
        &self,
        messages: Vec<ChatMessage>,
        system_prompt: Option<String>,
    ) -> Result<ChatResponse, ProviderError>;

    /// Transcribe audio to text (Speech-to-Text)
    async fn transcribe_audio(
        &self,
        audio_data: Vec<u8>,
        format: &str,
    ) -> Result<AudioTranscription, ProviderError>;

    /// Synthesize speech from text (Text-to-Speech)
    async fn synthesize_speech(
        &self,
        text: &str,
        voice: Option<&str>,
    ) -> Result<SpeechSynthesis, ProviderError>;
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ProviderType {
    OpenAI,
    Anthropic,
    Local,
    Desktop,
    Compatible,
    PiDev,
}

impl ProviderType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::OpenAI => "openai",
            Self::Anthropic => "anthropic",
            Self::Local => "local",
            Self::Desktop => "desktop",
            Self::Compatible => "compatible",
            Self::PiDev => "pidev",
        }
    }
}

pub fn provider_type_from_str(value: &str) -> Option<ProviderType> {
    match value.trim().to_ascii_lowercase().as_str() {
        "openai" => Some(ProviderType::OpenAI),
        "anthropic" | "claude" => Some(ProviderType::Anthropic),
        "local" | "localai" | "ollama" | "lmstudio" | "lm-studio" => Some(ProviderType::Local),
        "desktop" | "desktopai" => Some(ProviderType::Desktop),
        "compatible" | "custom" | "openai-compatible" | "openai_compatible" => Some(ProviderType::Compatible),
        "pidev" | "pi.dev" | "pi_dev" => Some(ProviderType::PiDev),
        _ => None,
    }
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
        ProviderType::Compatible => Box::new(openai::OpenAIProvider::new_compatible(config)),
        ProviderType::PiDev => Box::new(openai::OpenAIProvider::new_pidev(config)),
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
