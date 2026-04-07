//! LM Studio client — uses the OpenAI-compatible REST API that LM Studio
//! exposes on port 1234 by default.

use anyhow::{anyhow, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};

// ─── Request / response types ────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct ChatRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    pub temperature: f32,
    pub max_tokens: Option<i32>,
    pub stream: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct ChatResponse {
    pub id: String,
    pub choices: Vec<ChatChoice>,
    pub usage: Option<Usage>,
}

#[derive(Debug, Deserialize)]
pub struct ChatChoice {
    pub message: ChatMessage,
    pub finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct Usage {
    pub prompt_tokens: i32,
    pub completion_tokens: i32,
    pub total_tokens: i32,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Model {
    pub id: String,
    pub object: String,
    pub owned_by: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ModelsResponse {
    data: Vec<Model>,
}

// ─── Client ──────────────────────────────────────────────────────────────────

pub struct LmStudioClient {
    client: Client,
    base_url: String,
    api_key: String,
}

impl LmStudioClient {
    pub fn new(base_url: impl Into<String>, api_key: impl Into<String>) -> Self {
        Self {
            client: Client::builder()
                .timeout(std::time::Duration::from_secs(120))
                .build()
                .expect("failed to build HTTP client"),
            base_url: base_url.into().trim_end_matches('/').to_string(),
            api_key: api_key.into(),
        }
    }

    fn auth_header(&self) -> Option<String> {
        if self.api_key.is_empty() {
            None
        } else {
            Some(format!("Bearer {}", self.api_key))
        }
    }

    /// List models available in LM Studio.
    pub async fn list_models(&self) -> Result<Vec<Model>> {
        let url = format!("{}/v1/models", self.base_url);
        let mut req = self.client.get(&url);
        if let Some(auth) = self.auth_header() {
            req = req.header("Authorization", auth);
        }
        let resp = req.send().await?;
        if !resp.status().is_success() {
            return Err(anyhow!("LM Studio returned HTTP {}", resp.status()));
        }
        let models: ModelsResponse = resp.json().await?;
        Ok(models.data)
    }

    /// Send a chat completion request.
    pub async fn chat(&self, req: ChatRequest) -> Result<ChatResponse> {
        let url = format!("{}/v1/chat/completions", self.base_url);
        let mut builder = self.client.post(&url).json(&req);
        if let Some(auth) = self.auth_header() {
            builder = builder.header("Authorization", auth);
        }
        let resp = builder.send().await?;
        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(anyhow!("LM Studio error: {}", text));
        }
        Ok(resp.json().await?)
    }

    /// Health check — returns true if LM Studio is reachable.
    pub async fn ping(&self) -> bool {
        self.list_models().await.is_ok()
    }
}
