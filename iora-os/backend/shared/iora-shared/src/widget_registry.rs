//! Widget Registry for Apps and Plugins
//!
//! Allows Apps and Plugins to register custom widgets that can be displayed
//! in the IORA dashboard. Provides crash isolation - if an App/Plugin crashes,
//! its widgets become unavailable but don't affect other widgets or the system.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WidgetDefaultView {
    /// HTML/Component content for default view
    pub content: String,
    /// Message to display when provider is unavailable
    pub message: String,
    /// Icon or image URL for default view
    pub icon_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WidgetDefinition {
    pub id: String,
    pub provider_id: String, // App or Plugin ID
    pub provider_type: ProviderType,
    pub name: String,
    pub description: String,
    pub widget_type: WidgetType,
    pub component_url: String, // URL to widget component (for dynamic loading)
    pub config_schema: Option<serde_json::Value>,
    pub default_config: Option<serde_json::Value>,
    pub default_view: Option<WidgetDefaultView>, // Fallback view when provider unavailable
    pub permissions: Vec<String>,
    pub registered_at: String,
    pub is_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProviderType {
    App,
    Plugin,
    Native,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WidgetType {
    /// Visual widget for dashboard
    Display,
    /// Interactive control widget
    Control,
    /// Data visualization (charts, graphs)
    Visualization,
    /// Information/status widget
    Info,
    /// Custom widget type
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WidgetInstance {
    pub instance_id: String,
    pub widget_id: String,
    pub config: serde_json::Value,
    pub created_at: String,
}

/// Widget Registry manages widget definitions from Apps and Plugins
#[derive(Default)]
pub struct WidgetRegistry {
    widgets: RwLock<HashMap<String, WidgetDefinition>>,
    instances: RwLock<HashMap<String, WidgetInstance>>,
}

impl WidgetRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a widget definition
    pub async fn register_widget(&self, widget: WidgetDefinition) -> anyhow::Result<()> {
        let mut widgets = self.widgets.write().await;

        if widgets.contains_key(&widget.id) {
            anyhow::bail!("Widget '{}' is already registered", widget.id);
        }

        widgets.insert(widget.id.clone(), widget);
        Ok(())
    }

    /// Unregister a widget definition
    pub async fn unregister_widget(&self, widget_id: &str) -> anyhow::Result<()> {
        let mut widgets = self.widgets.write().await;
        widgets.remove(widget_id);

        // Remove all instances of this widget
        let mut instances = self.instances.write().await;
        instances.retain(|_, instance| instance.widget_id != widget_id);

        Ok(())
    }

    /// Unregister all widgets from a provider (App or Plugin)
    pub async fn unregister_provider_widgets(&self, provider_id: &str) -> anyhow::Result<()> {
        let mut widgets = self.widgets.write().await;
        let widget_ids: Vec<String> = widgets
            .iter()
            .filter(|(_, w)| w.provider_id == provider_id)
            .map(|(id, _)| id.clone())
            .collect();

        for widget_id in &widget_ids {
            widgets.remove(widget_id);
        }
        drop(widgets);

        // Remove all instances of these widgets
        let mut instances = self.instances.write().await;
        instances.retain(|_, instance| !widget_ids.contains(&instance.widget_id));

        Ok(())
    }

    /// Mark provider widgets as unavailable (e.g., when provider crashes)
    pub async fn mark_provider_widgets_unavailable(&self, provider_id: &str) {
        let mut widgets = self.widgets.write().await;
        for widget in widgets.values_mut() {
            if widget.provider_id == provider_id {
                widget.is_available = false;
            }
        }
    }

    /// Mark provider widgets as available (e.g., when provider recovers)
    pub async fn mark_provider_widgets_available(&self, provider_id: &str) {
        let mut widgets = self.widgets.write().await;
        for widget in widgets.values_mut() {
            if widget.provider_id == provider_id {
                widget.is_available = true;
            }
        }
    }

    /// List all registered widgets
    pub async fn list_widgets(&self) -> Vec<WidgetDefinition> {
        self.widgets.read().await.values().cloned().collect()
    }

    /// List only available widgets
    pub async fn list_available_widgets(&self) -> Vec<WidgetDefinition> {
        self.widgets
            .read()
            .await
            .values()
            .filter(|w| w.is_available)
            .cloned()
            .collect()
    }

    /// Get widget by ID
    pub async fn get_widget(&self, widget_id: &str) -> Option<WidgetDefinition> {
        self.widgets.read().await.get(widget_id).cloned()
    }

    /// List widgets by provider
    pub async fn list_widgets_by_provider(&self, provider_id: &str) -> Vec<WidgetDefinition> {
        self.widgets
            .read()
            .await
            .values()
            .filter(|w| w.provider_id == provider_id)
            .cloned()
            .collect()
    }

    /// Create a widget instance
    /// Widgets can be created even if provider is unavailable (will show default view)
    pub async fn create_instance(&self, instance: WidgetInstance) -> anyhow::Result<()> {
        // Check if widget exists (but don't require it to be available)
        let widgets = self.widgets.read().await;
        let _widget = widgets
            .get(&instance.widget_id)
            .ok_or_else(|| anyhow::anyhow!("Widget '{}' not found", instance.widget_id))?;

        // Widget availability no longer blocks instance creation
        // If unavailable, default view will be shown
        drop(widgets);

        let mut instances = self.instances.write().await;
        if instances.contains_key(&instance.instance_id) {
            anyhow::bail!("Widget instance '{}' already exists", instance.instance_id);
        }

        instances.insert(instance.instance_id.clone(), instance);
        Ok(())
    }

    /// Delete a widget instance
    pub async fn delete_instance(&self, instance_id: &str) -> anyhow::Result<()> {
        let mut instances = self.instances.write().await;
        instances
            .remove(instance_id)
            .ok_or_else(|| anyhow::anyhow!("Widget instance '{}' not found", instance_id))?;
        Ok(())
    }

    /// List all widget instances
    pub async fn list_instances(&self) -> Vec<WidgetInstance> {
        self.instances.read().await.values().cloned().collect()
    }

    /// Get widget instance by ID
    pub async fn get_instance(&self, instance_id: &str) -> Option<WidgetInstance> {
        self.instances.read().await.get(instance_id).cloned()
    }
}
