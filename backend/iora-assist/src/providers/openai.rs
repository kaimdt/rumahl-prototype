// OpenAI Provider Implementation
use super::{AIProvider, AudioTranscription, ChatMessage, ChatResponse, ProviderConfig, SpeechSynthesis};
use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};

pub struct OpenAIProvider {
    client: Client,
    config: ProviderConfig,
}

impl OpenAIProvider {
    pub fn new(config: ProviderConfig) -> Self {
        Self {
            client: Client::new(),
            config,
        }
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

#[async_trait]
impl AIProvider for OpenAIProvider {
    fn name(&self) -> &str {
        "OpenAI"
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
            .ok_or("OpenAI API key not configured")?;

        let base_url = self.config.base_url.as_deref()
            .unwrap_or("https://api.openai.com/v1");

        let model = self.config.model.as_deref()
            .unwrap_or("gpt-4o-mini");

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
            .post(format!("{}/chat/completions", base_url))
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
            provider: "OpenAI".to_string(),
            tokens_used: Some(openai_response.usage.total_tokens),
        })
    }

    async fn transcribe_audio(
        &self,
        audio_data: Vec<u8>,
        format: &str,
    ) -> Result<AudioTranscription, Box<dyn std::error::Error + Send + Sync>> {
        let api_key = self.config.api_key.as_ref()
            .ok_or("OpenAI API key not configured")?;

        let base_url = self.config.base_url.as_deref()
            .unwrap_or("https://api.openai.com/v1");

        let form = reqwest::multipart::Form::new()
            .text("model", "whisper-1")
            .part(
                "file",
                reqwest::multipart::Part::bytes(audio_data)
                    .file_name(format!("audio.{}", format))
                    .mime_str(&format!("audio/{}", format))?,
            );

        let response = self.client
            .post(format!("{}/audio/transcriptions", base_url))
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
    ) -> Result<SpeechSynthesis, Box<dyn std::error::Error + Send + Sync>> {
        let api_key = self.config.api_key.as_ref()
            .ok_or("OpenAI API key not configured")?;

        let base_url = self.config.base_url.as_deref()
            .unwrap_or("https://api.openai.com/v1");

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
            .post(format!("{}/audio/speech", base_url))
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
