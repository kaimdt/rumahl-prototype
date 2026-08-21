use crate::providers::ChatMessage;
use crate::AppState;
use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use chrono::Utc;
use lazy_static::lazy_static;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// Simple privacy filter to mask emails and phone numbers
lazy_static! {
    static ref EMAIL_REGEX: Regex =
        Regex::new(r"([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})").unwrap();
    static ref PHONE_REGEX: Regex = Regex::new(r"(\+?[0-9][0-9\- ]{7,14}[0-9])").unwrap();
}

// For stateless unmasking, we define a struct and return it.
// The code reviewer correctly identified the memory leak in the global Vault.
// Using a local vault per request prevents this.
pub struct RequestPrivacyVault {
    // Map of token -> original value
    map: HashMap<String, String>,
}

impl RequestPrivacyVault {
    pub fn new() -> Self {
        Self {
            map: HashMap::new(),
        }
    }

    pub fn mask(&mut self, text: &str) -> String {
        let mut masked_text = text.to_string();

        for cap in EMAIL_REGEX.captures_iter(text) {
            let email = &cap[1];
            let token = format!(
                "[MASKED_EMAIL_{}]",
                uuid::Uuid::new_v4()
                    .simple()
                    .to_string()
                    .chars()
                    .take(8)
                    .collect::<String>()
            );
            self.map.insert(token.clone(), email.to_string());
            masked_text = masked_text.replace(email, &token);
        }

        for cap in PHONE_REGEX.captures_iter(&masked_text.clone()) {
            let phone = &cap[1];
            let token = format!(
                "[MASKED_PHONE_{}]",
                uuid::Uuid::new_v4()
                    .simple()
                    .to_string()
                    .chars()
                    .take(8)
                    .collect::<String>()
            );
            self.map.insert(token.clone(), phone.to_string());
            masked_text = masked_text.replace(phone, &token);
        }

        masked_text
    }

    pub fn unmask(&self, text: &str) -> String {
        let mut unmasked_text = text.to_string();

        for (token, original) in self.map.iter() {
            unmasked_text = unmasked_text.replace(token, original);
        }

        unmasked_text
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OpenAIChatRequest {
    pub model: String,
    pub messages: Vec<OpenAIMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OpenAIMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
pub struct OpenAIChatResponse {
    pub id: String,
    pub object: String,
    pub created: i64,
    pub model: String,
    pub choices: Vec<OpenAIChoice>,
    pub usage: Option<OpenAIUsage>,
}

#[derive(Debug, Serialize)]
pub struct OpenAIChoice {
    pub index: u32,
    pub message: OpenAIMessage,
    pub finish_reason: String,
}

#[derive(Debug, Serialize)]
pub struct OpenAIUsage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
}

#[derive(Debug, Serialize)]
pub struct OpenAIModelList {
    pub object: String,
    pub data: Vec<OpenAIModel>,
}

#[derive(Debug, Serialize)]
pub struct OpenAIModel {
    pub id: String,
    pub object: String,
    pub created: i64,
    pub owned_by: String,
}

pub async fn list_models(State(_state): State<AppState>) -> impl IntoResponse {
    let models = vec![
        OpenAIModel {
            id: "gpt-4".to_string(),
            object: "model".to_string(),
            created: 1686935002,
            owned_by: "openai".to_string(),
        },
        OpenAIModel {
            id: "gpt-3.5-turbo".to_string(),
            object: "model".to_string(),
            created: 1677610602,
            owned_by: "openai".to_string(),
        },
        OpenAIModel {
            id: "rumahl-local".to_string(),
            object: "model".to_string(),
            created: 1686935002,
            owned_by: "ora".to_string(),
        },
        OpenAIModel {
            id: "rumahl-desktop".to_string(),
            object: "model".to_string(),
            created: 1686935002,
            owned_by: "ora".to_string(),
        },
    ];

    let response = OpenAIModelList {
        object: "list".to_string(),
        data: models,
    };

    (StatusCode::OK, Json(response))
}

pub async fn chat_completions(
    State(state): State<AppState>,
    Json(req): Json<OpenAIChatRequest>,
) -> impl IntoResponse {
    let mut internal_messages = Vec::new();
    let mut system_prompt = None;
    let mut vault = RequestPrivacyVault::new();

    for msg in req.messages {
        let masked_content = vault.mask(&msg.content);
        if msg.role == "system" {
            system_prompt = Some(masked_content);
        } else {
            internal_messages.push(ChatMessage {
                role: msg.role,
                content: masked_content,
            });
        }
    }

    // We can add logic to intercept/block messages here if we detect certain keywords.

    let provider = state.current_provider.read().await;
    let result = provider
        .chat(internal_messages.clone(), system_prompt)
        .await;

    match result {
        Ok(res) => {
            let unmasked_response = vault.unmask(&res.message);

            // Log interaction optionally, to monitor usage.
            if let Some(cm) = &state.conversation_manager {
                // To track conversation, normally thread_id is passed, here we mock it
                let thread_id = uuid::Uuid::new_v4();

                // Add the user message
                let _ = cm
                    .add_message(
                        thread_id,
                        "user",
                        internal_messages
                            .last()
                            .map(|m| m.content.as_str())
                            .unwrap_or(""),
                        Some("api_proxy"),
                        crate::conversation_manager::MessageInitiator::User,
                    )
                    .await;

                // Add the AI response
                let _ = cm
                    .add_message(
                        thread_id,
                        "assistant",
                        &unmasked_response,
                        Some("api_proxy"),
                        crate::conversation_manager::MessageInitiator::AI,
                    )
                    .await;
            }

            let choice = OpenAIChoice {
                index: 0,
                message: OpenAIMessage {
                    role: "assistant".to_string(),
                    content: unmasked_response,
                },
                finish_reason: "stop".to_string(),
            };

            let response = OpenAIChatResponse {
                id: format!("chatcmpl-{}", uuid::Uuid::new_v4().simple()),
                object: "chat.completion".to_string(),
                created: Utc::now().timestamp(),
                model: res.model,
                choices: vec![choice],
                usage: res.tokens_used.map(|t| OpenAIUsage {
                    prompt_tokens: 0,
                    completion_tokens: t,
                    total_tokens: t,
                }),
            };

            (
                StatusCode::OK,
                Json(serde_json::to_value(response).unwrap()),
            )
                .into_response()
        }
        Err(e) => {
            let error_json = serde_json::json!({
                "error": {
                    "message": format!("Provider error: {}", e),
                    "type": "server_error"
                }
            });
            (StatusCode::INTERNAL_SERVER_ERROR, Json(error_json)).into_response()
        }
    }
}
