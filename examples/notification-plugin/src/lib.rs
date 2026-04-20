//! IORA Notification Formatter Plugin
//!
//! Ein Beispiel-Plugin, das Benachrichtigungen formatiert und anreichert.
//! Demonstriert die Sandbox-Execution und API-Registrierung.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::time::Instant;

use iora_shared::plugin::{
    IPlugin, PluginMetadata, PluginExecutionResult, PluginPermission,
    PluginType, SandboxConfig,
};
use iora_shared::api_gateway::{ApiEndpoint, HttpMethod, ProviderType};

mod formatter;
mod validator;

use formatter::NotificationFormatter as Formatter;
use validator::NotificationValidator;

/// Haupt-Plugin-Struktur
pub struct NotificationFormatterPlugin {
    metadata: PluginMetadata,
    formatter: Formatter,
    validator: NotificationValidator,
}

impl NotificationFormatterPlugin {
    pub fn new() -> Self {
        Self {
            metadata: PluginMetadata {
                id: "notification-formatter".to_string(),
                name: "Benachrichtigungs-Formatierer".to_string(),
                version: "1.0.0".to_string(),
                description: "Formatiert und validiert Benachrichtigungen".to_string(),
                author: "IORA Team".to_string(),
                plugin_type: PluginType::DataProcessor,
                permissions: vec![
                    PluginPermission::ReadEntities,
                    PluginPermission::Notifications,
                ],
                sandbox_config: SandboxConfig {
                    max_execution_time_ms: 5000,
                    max_memory_mb: 128,
                    allow_network: false,
                    allow_file_system: false,
                },
            },
            formatter: Formatter::new(),
            validator: NotificationValidator::new(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "action")]
enum PluginAction {
    #[serde(rename = "format")]
    Format { notification: Notification },
    #[serde(rename = "validate")]
    Validate { notification: Notification },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notification {
    pub title: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<String>,
}

#[async_trait]
impl IPlugin for NotificationFormatterPlugin {
    fn metadata(&self) -> &PluginMetadata {
        &self.metadata
    }

    async fn on_load(&self) -> anyhow::Result<()> {
        tracing::info!("Notification Formatter Plugin loaded");
        Ok(())
    }

    async fn on_unload(&self) -> anyhow::Result<()> {
        tracing::info!("Notification Formatter Plugin unloaded");
        Ok(())
    }

    async fn execute(
        &self,
        input: serde_json::Value,
    ) -> anyhow::Result<PluginExecutionResult> {
        let start = Instant::now();

        // Parse die Aktion
        let action: PluginAction = serde_json::from_value(input)?;

        let output = match action {
            PluginAction::Format { notification } => {
                tracing::debug!("Formatting notification: {:?}", notification.title);
                let formatted = self.formatter.format(notification)?;
                serde_json::to_value(formatted)?
            }
            PluginAction::Validate { notification } => {
                tracing::debug!("Validating notification: {:?}", notification.title);
                let result = self.validator.validate(&notification)?;
                serde_json::to_value(result)?
            }
        };

        let duration_ms = start.elapsed().as_millis() as u64;

        Ok(PluginExecutionResult {
            success: true,
            duration_ms,
            output: Some(output),
            error: None,
        })
    }

    async fn get_api_endpoints(&self) -> Vec<ApiEndpoint> {
        vec![
            ApiEndpoint {
                id: "notification-format".to_string(),
                provider_id: self.metadata.id.clone(),
                provider_type: ProviderType::Plugin,
                path: "/api/notifications/format".to_string(),
                method: HttpMethod::POST,
                description: "Formatiert eine Benachrichtigung".to_string(),
                requires_auth: true,
                permissions: vec!["Notifications".to_string()],
                registered_at: chrono::Utc::now().to_rfc3339(),
                is_healthy: true,
            },
            ApiEndpoint {
                id: "notification-validate".to_string(),
                provider_id: self.metadata.id.clone(),
                provider_type: ProviderType::Plugin,
                path: "/api/notifications/validate".to_string(),
                method: HttpMethod::POST,
                description: "Validiert eine Benachrichtigung".to_string(),
                requires_auth: true,
                permissions: vec!["Notifications".to_string()],
                registered_at: chrono::Utc::now().to_rfc3339(),
                is_healthy: true,
            },
        ]
    }
}

impl Default for NotificationFormatterPlugin {
    fn default() -> Self {
        Self::new()
    }
}

// Export für dynamisches Laden
#[no_mangle]
pub extern "C" fn create_plugin() -> *mut dyn IPlugin {
    Box::into_raw(Box::new(NotificationFormatterPlugin::new()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_plugin_format() {
        let plugin = NotificationFormatterPlugin::new();

        let input = serde_json::json!({
            "action": "format",
            "notification": {
                "title": "Test",
                "message": "Test message",
                "category": "info"
            }
        });

        let result = plugin.execute(input).await.unwrap();

        assert!(result.success);
        assert!(result.duration_ms < 1000);
        assert!(result.output.is_some());
    }

    #[tokio::test]
    async fn test_plugin_validate() {
        let plugin = NotificationFormatterPlugin::new();

        let input = serde_json::json!({
            "action": "validate",
            "notification": {
                "title": "Test",
                "message": "Test message"
            }
        });

        let result = plugin.execute(input).await.unwrap();

        assert!(result.success);
        assert!(result.output.is_some());
    }
}
