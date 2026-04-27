use serde::{Deserialize, Serialize};
use crate::error::Result;

/// Widget configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WidgetConfig {
    pub id: String,
    pub name: String,
    pub config: serde_json::Value,
}

/// Widget trait for creating dashboard widgets
pub trait Widget: Send + Sync {
    /// Get widget ID
    fn id(&self) -> &str;

    /// Get widget name
    fn name(&self) -> &str;

    /// Get widget default configuration
    fn default_config(&self) -> serde_json::Value {
        serde_json::json!({})
    }

    /// Render widget (returns HTML/JSON for display)
    fn render(&self, config: &WidgetConfig) -> Result<serde_json::Value>;

    /// Handle widget events
    fn handle_event(&self, event: &str, data: serde_json::Value) -> Result<serde_json::Value> {
        Ok(serde_json::json!({
            "status": "not_implemented"
        }))
    }
}

/// Widget event types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum WidgetEvent {
    Click,
    Change,
    Refresh,
    Custom(String),
}

/// Widget builder for creating widget definitions
pub struct WidgetBuilder {
    id: String,
    name: String,
    component_url: String,
    description: String,
    default_config: Option<serde_json::Value>,
}

impl WidgetBuilder {
    pub fn new(id: impl Into<String>, name: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            component_url: String::new(),
            description: String::new(),
            default_config: None,
        }
    }

    pub fn component_url(mut self, url: impl Into<String>) -> Self {
        self.component_url = url.into();
        self
    }

    pub fn description(mut self, description: impl Into<String>) -> Self {
        self.description = description.into();
        self
    }

    pub fn default_config(mut self, config: serde_json::Value) -> Self {
        self.default_config = Some(config);
        self
    }

    pub fn build(self) -> crate::manifest::WidgetDefinition {
        crate::manifest::WidgetDefinition {
            id: self.id,
            name: self.name,
            widget_type: "dashboard".to_string(),
            component_url: self.component_url,
            description: self.description,
            default_config: self.default_config,
        }
    }
}
