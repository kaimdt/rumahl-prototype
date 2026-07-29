// Cloud Provider - Unified provider for DeepSeek, Grok, Mistral, Cohere, etc.
// All use OpenAI-compatible chat completion endpoints
use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};

use super::{
    AIProvider, AudioTranscription, ChatMessage, ChatResponse, ProviderConfig, ProviderError,
    ProviderModel, SpeechSynthesis,
};

/// Known cloud AI providers with their default base URLs and models
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum CloudProviderType {
    DeepSeek,
    Grok,
    Mistral,
    Cohere,
    Together,
    Fireworks,
    Perplexity,
    Custom,
}

impl CloudProviderType {
    pub fn from_str(s: &str) -> Option<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "deepseek" => Some(Self::DeepSeek),
            "grok" | "xai" => Some(Self::Grok),
            "mistral" | "mistralai" | "mistral-ai" => Some(Self::Mistral),
            "cohere" | "cohereai" => Some(Self::Cohere),
            "together" | "together-ai" | "together_ai" => Some(Self::Together),
            "fireworks" | "fireworks-ai" | "fireworks_ai" => Some(Self::Fireworks),
            "perplexity" | "perplexity-ai" | "perplexity_ai" => Some(Self::Perplexity),
            "custom" | "openai-compatible" => Some(Self::Custom),
            _ => None,
        }
    }

    pub fn default_base_url(&self) -> &'static str {
        match self {
            Self::DeepSeek => "https://api.deepseek.com/v1",
            Self::Grok => "https://api.x.ai/v1",
            Self::Mistral => "https://api.mistral.ai/v1",
            Self::Cohere => "https://api.cohere.ai/v1",
            Self::Together => "https://api.together.xyz/v1",
            Self::Fireworks => "https://api.fireworks.ai/v1",
            Self::Perplexity => "https://api.perplexity.ai/v1",
            Self::Custom => "",
        }
    }

    pub fn default_model(&self) -> &'static str {
        match self {
            Self::DeepSeek => "deepseek-chat",
            Self::Grok => "grok-2",
            Self::Mistral => "mistral-large-latest",
            Self::Cohere => "command-r-plus",
            Self::Together => "mistralai/Mixtral-8x22B-Instruct-v0.1",
            Self::Fireworks => "accounts/fireworks/models/llama-v3p1-405b-instruct",
            Self::Perplexity => "llama-3.1-sonar-huge-128k-online",
            Self::Custom => "gpt-4o-mini",
        }
    }
}

pub struct CloudAIProvider {
    client: Client,
    config: ProviderConfig,
    cloud_type: CloudProviderType,
}

impl CloudAIProvider {
    pub fn new(cloud_type: CloudProviderType, config: ProviderConfig) -> Self {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(180))
            .build()
            .expect("Failed to create HTTP client");

        Self {
            client,
            config,
            cloud_type,
        }
    }

    fn base_url(&self) -> String {
        self.config
            .base_url
            .clone()
            .filter(|u| !u.is_empty())
            .unwrap_or_else(|| self.cloud_type.default_base_url().to_string())
            .trim_end_matches('/')
            .to_string()
    }

    fn model(&self) -> String {
        self.config
            .model
            .clone()
            .unwrap_or_else(|| self.cloud_type.default_model().to_string())
    }
}

#[derive(Serialize)]
struct ChatCompletionRequest {
    model: String,
    messages: Vec<ChatMessageInner>,
    temperature: f32,
    max_tokens: u32,
    stream: bool,
}

#[derive(Serialize, Deserialize)]
struct ChatMessageInner {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<Choice>,
    usage: Option<Usage>,
    model: String,
}

#[derive(Deserialize)]
struct Choice {
    message: ChatMessageInner,
    finish_reason: Option<String>,
}

#[derive(Deserialize)]
struct Usage {
    prompt_tokens: u32,
    completion_tokens: u32,
    total_tokens: u32,
}

#[async_trait]
impl AIProvider for CloudAIProvider {
    fn name(&self) -> &str {
        match self.cloud_type {
            CloudProviderType::DeepSeek => "DeepSeek",
            CloudProviderType::Grok => "Grok (xAI)",
            CloudProviderType::Mistral => "Mistral AI",
            CloudProviderType::Cohere => "Cohere",
            CloudProviderType::Together => "Together AI",
            CloudProviderType::Fireworks => "Fireworks AI",
            CloudProviderType::Perplexity => "Perplexity",
            CloudProviderType::Custom => "Custom API",
        }
    }

    fn provider_id(&self) -> &str {
        match self.cloud_type {
            CloudProviderType::DeepSeek => "deepseek",
            CloudProviderType::Grok => "grok",
            CloudProviderType::Mistral => "mistral",
            CloudProviderType::Cohere => "cohere",
            CloudProviderType::Together => "together",
            CloudProviderType::Fireworks => "fireworks",
            CloudProviderType::Perplexity => "perplexity",
            CloudProviderType::Custom => "custom",
        }
    }

    fn capabilities(&self) -> &'static [&'static str] {
        &["chat", "models"]
    }

    async fn is_available(&self) -> bool {
        self.config.api_key.is_some()
    }

    async fn list_models(&self) -> Result<Vec<ProviderModel>, ProviderError> {
        Ok(vec![ProviderModel {
            id: self.model(),
            name: format!("{} {}", self.name(), self.model()),
            provider: self.provider_id().to_string(),
        }])
    }

    async fn chat(
        &self,
        messages: Vec<ChatMessage>,
        system_prompt: Option<String>,
    ) -> Result<ChatResponse, ProviderError> {
        let api_key = self
            .config
            .api_key
            .as_ref()
            .ok_or_else(|| format!("{} API key not configured", self.name()))?;

        let base_url = self.base_url();
        let model = self.model();

        let mut req_messages: Vec<ChatMessageInner> = Vec::new();

        if let Some(sys) = system_prompt {
            req_messages.push(ChatMessageInner {
                role: "system".to_string(),
                content: sys,
            });
        }

        for msg in &messages {
            req_messages.push(ChatMessageInner {
                role: msg.role.clone(),
                content: msg.content.clone(),
            });
        }

        let request = ChatCompletionRequest {
            model,
            messages: req_messages,
            temperature: 0.7,
            max_tokens: 4096,
            stream: false,
        };

        let response = self
            .client
            .post(format!("{}/chat/completions", base_url))
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("{} API error ({}): {}", self.name(), status, error_text).into());
        }

        let completion: ChatCompletionResponse = response.json().await?;

        Ok(ChatResponse {
            message: completion
                .choices
                .into_iter()
                .next()
                .map(|c| c.message.content)
                .unwrap_or_default(),
            model: completion.model,
            provider: self.provider_id().to_string(),
            tokens_used: completion.usage.map(|u| u.total_tokens),
        })
    }

    async fn transcribe_audio(
        &self,
        _audio_data: Vec<u8>,
        _format: &str,
    ) -> Result<AudioTranscription, ProviderError> {
        Err(format!("{} does not support audio transcription", self.name()).into())
    }

    async fn synthesize_speech(
        &self,
        _text: &str,
        _voice: Option<&str>,
    ) -> Result<SpeechSynthesis, ProviderError> {
        Err(format!("{} does not support speech synthesis", self.name()).into())
    }
}
