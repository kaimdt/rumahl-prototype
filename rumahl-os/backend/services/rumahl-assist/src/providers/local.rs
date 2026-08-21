// Local AI Provider Implementation (Ollama, LM Studio, LocalAI)
use super::{
    AIProvider, AudioTranscription, ChatMessage, ChatResponse, ProviderConfig, ProviderError,
    ProviderModel, SpeechSynthesis,
};
use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};

pub struct LocalAIProvider {
    client: Client,
    config: ProviderConfig,
}

impl LocalAIProvider {
    pub fn new(config: ProviderConfig) -> Self {
        Self {
            client: Client::new(),
            config,
        }
    }
}

#[derive(Debug, Serialize)]
struct LocalChatRequest {
    model: String,
    messages: Vec<LocalChatMessage>,
    stream: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct LocalChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct LocalChatResponse {
    message: LocalChatMessage,
    model: String,
    #[serde(default)]
    done: bool,
}

#[derive(Debug, Deserialize)]
struct OllamaTagsResponse {
    #[serde(default)]
    models: Vec<OllamaModel>,
}

#[derive(Debug, Deserialize)]
struct OllamaModel {
    name: String,
}

#[derive(Debug, Deserialize)]
struct OpenAiModelsResponse {
    data: Vec<OpenAiModel>,
}

#[derive(Debug, Deserialize)]
struct OpenAiModel {
    id: String,
}

#[async_trait]
impl AIProvider for LocalAIProvider {
    fn name(&self) -> &str {
        "LocalAI"
    }

    fn provider_id(&self) -> &str {
        "local"
    }

    fn capabilities(&self) -> &'static [&'static str] {
        &["chat", "stt", "tts", "models"]
    }

    async fn is_available(&self) -> bool {
        if let Some(base_url) = &self.config.base_url {
            let base_url = base_url.trim_end_matches('/');
            for path in ["/v1/models", "/api/tags"] {
                if let Ok(response) = self
                    .client
                    .get(format!("{}{}", base_url, path))
                    .send()
                    .await
                {
                    if response.status().is_success() {
                        return true;
                    }
                }
            }
        }
        false
    }

    async fn list_models(&self) -> Result<Vec<ProviderModel>, ProviderError> {
        let base_url = self
            .config
            .base_url
            .as_ref()
            .ok_or("Local AI base URL not configured")?;
        let base_url = base_url.trim_end_matches('/');

        if let Ok(response) = self
            .client
            .get(format!("{}/v1/models", base_url))
            .send()
            .await
        {
            if response.status().is_success() {
                let payload: OpenAiModelsResponse = response.json().await?;
                return Ok(payload
                    .data
                    .into_iter()
                    .map(|model| ProviderModel {
                        id: model.id.clone(),
                        name: model.id,
                        provider: "local".to_string(),
                    })
                    .collect());
            }
        }

        let response = self
            .client
            .get(format!("{}/api/tags", base_url))
            .send()
            .await?;
        if !response.status().is_success() {
            let error_text = response.text().await?;
            return Err(format!("Local AI model discovery failed: {}", error_text).into());
        }

        let payload: OllamaTagsResponse = response.json().await?;
        Ok(payload
            .models
            .into_iter()
            .map(|model| ProviderModel {
                id: model.name.clone(),
                name: model.name,
                provider: "local".to_string(),
            })
            .collect())
    }

    async fn chat(
        &self,
        messages: Vec<ChatMessage>,
        system_prompt: Option<String>,
    ) -> Result<ChatResponse, ProviderError> {
        let base_url = self
            .config
            .base_url
            .as_ref()
            .ok_or("Local AI base URL not configured")?;

        let model = self.config.model.as_deref().unwrap_or("llama3.2");

        let mut local_messages = Vec::new();

        if let Some(prompt) = system_prompt {
            local_messages.push(LocalChatMessage {
                role: "system".to_string(),
                content: prompt,
            });
        }

        for msg in messages {
            local_messages.push(LocalChatMessage {
                role: msg.role,
                content: msg.content,
            });
        }

        let request = LocalChatRequest {
            model: model.to_string(),
            messages: local_messages,
            stream: false,
        };

        let response = self
            .client
            .post(format!("{}/api/chat", base_url))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await?;

        if !response.status().is_success() {
            let error_text = response.text().await?;
            return Err(format!("Local AI API error: {}", error_text).into());
        }

        let local_response: LocalChatResponse = response.json().await?;

        Ok(ChatResponse {
            message: local_response.message.content,
            model: local_response.model,
            provider: "LocalAI".to_string(),
            tokens_used: None,
        })
    }

    async fn transcribe_audio(
        &self,
        audio_data: Vec<u8>,
        format: &str,
    ) -> Result<AudioTranscription, ProviderError> {
        let base_url = self
            .config
            .base_url
            .as_ref()
            .ok_or("Local AI base URL not configured")?;

        // Whisper via Ollama or LocalAI
        let form = reqwest::multipart::Form::new()
            .text("model", "whisper")
            .part(
                "file",
                reqwest::multipart::Part::bytes(audio_data)
                    .file_name(format!("audio.{}", format))
                    .mime_str(&format!("audio/{}", format))?,
            );

        let response = self
            .client
            .post(format!("{}/api/transcribe", base_url))
            .multipart(form)
            .send()
            .await?;

        if !response.status().is_success() {
            let error_text = response.text().await?;
            return Err(format!("Local AI transcription error: {}", error_text).into());
        }

        #[derive(Deserialize)]
        struct LocalTranscriptionResponse {
            text: String,
            #[serde(default)]
            language: Option<String>,
        }

        let transcription: LocalTranscriptionResponse = response.json().await?;

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
        let base_url = self
            .config
            .base_url
            .as_ref()
            .ok_or("Local AI base URL not configured")?;

        #[derive(Serialize)]
        struct LocalTTSRequest {
            text: String,
            voice: String,
        }

        let request = LocalTTSRequest {
            text: text.to_string(),
            voice: voice.unwrap_or("default").to_string(),
        };

        let response = self
            .client
            .post(format!("{}/api/tts", base_url))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await?;

        if !response.status().is_success() {
            let error_text = response.text().await?;
            return Err(format!("Local AI TTS error: {}", error_text).into());
        }

        let audio_bytes = response.bytes().await?.to_vec();

        Ok(SpeechSynthesis {
            audio_data: audio_bytes,
            format: "wav".to_string(),
            duration: None,
        })
    }
}
