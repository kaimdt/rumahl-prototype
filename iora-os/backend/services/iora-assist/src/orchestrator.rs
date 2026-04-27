// Multi-Provider Orchestrator
// Manages multiple AI providers simultaneously and routes tasks to appropriate providers

use crate::providers::{AIProvider, ChatMessage, ChatResponse, AudioTranscription, SpeechSynthesis, ProviderConfig, create_provider, provider_type_from_str};
use crate::database::{DbPool, providers as db_providers};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TaskPurpose {
    Chat,
    Calendar,
    Automation,
    Monitoring,
    Voice,
    General,
}

impl TaskPurpose {
    pub fn as_str(&self) -> &str {
        match self {
            TaskPurpose::Chat => "chat",
            TaskPurpose::Calendar => "calendar",
            TaskPurpose::Automation => "automation",
            TaskPurpose::Monitoring => "monitoring",
            TaskPurpose::Voice => "voice",
            TaskPurpose::General => "general",
        }
    }
}

#[derive(Clone)]
pub struct ProviderOrchestrator {
    providers: Arc<RwLock<HashMap<String, Box<dyn AIProvider>>>>,
    db: Option<DbPool>,
}

impl ProviderOrchestrator {
    /// Create a new orchestrator
    pub fn new(db: Option<DbPool>) -> Self {
        Self {
            providers: Arc::new(RwLock::new(HashMap::new())),
            db,
        }
    }

    /// Initialize providers from database configuration
    pub async fn init_from_database(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        if let Some(db) = &self.db {
            let configs = db_providers::get_all_enabled_providers(db).await?;

            for config in configs {
                let provider_config = ProviderConfig {
                    api_key: config.config["api_key"].as_str().map(|s| s.to_string()),
                    base_url: config.config["base_url"].as_str().map(|s| s.to_string()),
                    model: config.config["model"].as_str().map(|s| s.to_string()),
                    api_version: config.config["api_version"].as_str().map(|s| s.to_string()),
                };

                let Some(provider_type) = provider_type_from_str(&config.provider_type) else {
                    continue;
                };

                let provider = create_provider(provider_type, provider_config);
                let key = format!("{}_{}", config.provider_type, config.purpose);
                self.providers.write().await.insert(key, provider);
            }

            tracing::info!("Initialized {} providers from database", self.providers.read().await.len());
        }

        Ok(())
    }

    /// Register a provider manually
    pub async fn register_provider(&self, id: String, provider: Box<dyn AIProvider>) {
        self.providers.write().await.insert(id, provider);
    }

    /// Get provider for a specific purpose
    pub async fn get_provider_for_purpose(&self, purpose: TaskPurpose) -> Option<Box<dyn AIProvider>> {
        let providers = self.providers.read().await;

        // Try purpose-specific provider first
        let purpose_key = format!("local_{}", purpose.as_str());
        if let Some(provider) = providers.get(&purpose_key) {
            // Clone the provider (this works because AIProvider is cloneable via the Box)
            // In a real implementation, we'd return a reference or Arc
            return None; // Placeholder - in production, we'd need to make providers Arc-based
        }

        // Fall back to general provider
        if let Some(provider) = providers.get("local_general") {
            return None; // Placeholder
        }

        None
    }

    /// Execute a chat task with the best available provider
    pub async fn execute_chat(
        &self,
        messages: Vec<ChatMessage>,
        system_prompt: Option<String>,
        preferred_purpose: Option<TaskPurpose>,
    ) -> Result<ChatResponse, Box<dyn std::error::Error + Send + Sync>> {
        let purpose = preferred_purpose.unwrap_or(TaskPurpose::Chat);
        let providers = self.providers.read().await;

        // Try to find a provider for this purpose
        let provider_key = format!("local_{}", purpose.as_str());

        // Get first available provider (simplified for now)
        for (key, provider) in providers.iter() {
            if provider.is_available().await {
                tracing::info!("Using provider {} for chat", key);
                return provider.chat(messages, system_prompt).await;
            }
        }

        Err("No available providers".into())
    }

    /// Execute with multiple providers in parallel (for consensus or comparison)
    pub async fn execute_parallel(
        &self,
        messages: Vec<ChatMessage>,
        system_prompt: Option<String>,
        provider_ids: Vec<String>,
    ) -> Vec<Result<ChatResponse, String>> {
        let providers = self.providers.read().await;
        let mut results: Vec<Result<ChatResponse, String>> = Vec::new();

        for provider_id in provider_ids {
            if let Some(provider) = providers.get(&provider_id) {
                let msgs = messages.clone();
                let prompt = system_prompt.clone();

                // In a real implementation, we'd need to handle the lifetime correctly
                // This is a simplified version
                tracing::info!("Queueing parallel execution for provider {}", provider_id);
            }
        }

        // Placeholder - in production, we'd use tokio::join! or similar
        results
    }

    /// Get all available providers
    pub async fn list_providers(&self) -> Vec<String> {
        self.providers.read().await.keys().cloned().collect()
    }

    /// Check if a provider is available
    pub async fn is_provider_available(&self, provider_id: &str) -> bool {
        if let Some(provider) = self.providers.read().await.get(provider_id) {
            provider.is_available().await
        } else {
            false
        }
    }

    /// Route a task to the appropriate provider based on task type
    pub async fn route_task(&self, task_type: &str) -> Option<String> {
        // Simple routing logic - can be enhanced with database-driven rules
        let purpose = match task_type {
            "chat" | "conversation" => TaskPurpose::Chat,
            "calendar" | "reminder" | "schedule" => TaskPurpose::Calendar,
            "automation" | "suggest" => TaskPurpose::Automation,
            "monitor" | "alert" | "watch" => TaskPurpose::Monitoring,
            "transcribe" | "synthesize" | "voice" => TaskPurpose::Voice,
            _ => TaskPurpose::General,
        };

        let key = format!("local_{}", purpose.as_str());

        if self.providers.read().await.contains_key(&key) {
            Some(key)
        } else {
            // Fall back to general
            Some("local_general".to_string())
        }
    }

    /// Get statistics about provider usage
    pub async fn get_stats(&self) -> ProviderStats {
        let providers = self.providers.read().await;

        let mut available_count = 0;
        for provider in providers.values() {
            if provider.is_available().await {
                available_count += 1;
            }
        }

        ProviderStats {
            total_providers: providers.len(),
            available_providers: available_count,
            provider_ids: providers.keys().cloned().collect(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderStats {
    pub total_providers: usize,
    pub available_providers: usize,
    pub provider_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutingRule {
    pub task_pattern: String,
    pub preferred_provider: String,
    pub fallback_providers: Vec<String>,
    pub priority: i32,
}

impl RoutingRule {
    /// Check if this rule matches a task
    pub fn matches(&self, task_description: &str) -> bool {
        task_description.to_lowercase().contains(&self.task_pattern.to_lowercase())
    }
}

// Helper function to create default orchestrator with single provider
pub async fn create_default_orchestrator(
    provider: Box<dyn AIProvider>,
    db: Option<DbPool>,
) -> ProviderOrchestrator {
    let orchestrator = ProviderOrchestrator::new(db);
    orchestrator.register_provider("default".to_string(), provider).await;
    orchestrator
}
