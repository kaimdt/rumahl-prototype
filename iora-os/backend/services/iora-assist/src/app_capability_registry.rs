//! App Capability Registry
//!
//! Runtime registry for capabilities that installed IORA apps / plugins expose
//! to IORA Assist and the pi.dev agents. iora-home pushes an app's
//! `assist_tools` and `exposed_services` here on install and removes them on
//! uninstall, giving the agent a single discovery surface for app-provided
//! tools and inter-app RPC services.
//!
//! The registry is purely in-memory: it mirrors the source of truth in
//! iora-home's app index and is repopulated whenever iora-home (re)pushes an
//! app on install or on its own startup. This keeps iora-assist stateless with
//! respect to app persistence.

use std::collections::HashMap;
use std::sync::Arc;

use iora_shared::app_capabilities::{AssistToolDefinition, ServiceExport};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::RwLock;

/// Capabilities registered by a single installed app.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppCapabilities {
    /// Owning app/plugin id (filled in from the request path by the handler).
    #[serde(default)]
    pub app_id: String,
    /// Human-readable app name, used for tool discovery output.
    #[serde(default)]
    pub app_name: String,
    /// AI tools the app exposes to IORA Assist / pi.dev agents.
    #[serde(default)]
    pub tools: Vec<AssistToolDefinition>,
    /// RPC services the app exposes for discovery by other apps / the agent.
    #[serde(default)]
    pub services: Vec<ServiceExport>,
}

/// In-memory registry keyed by app id. Cheap to clone (shared `Arc`).
#[derive(Clone, Default)]
pub struct AppCapabilityRegistry {
    inner: Arc<RwLock<HashMap<String, AppCapabilities>>>,
}

impl AppCapabilityRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register (or replace) the capabilities for an app.
    /// Returns the number of `(tools, services)` registered.
    pub async fn register(&self, caps: AppCapabilities) -> (usize, usize) {
        let counts = (caps.tools.len(), caps.services.len());
        self.inner.write().await.insert(caps.app_id.clone(), caps);
        counts
    }

    /// Remove all capabilities for an app. Returns true if anything was removed.
    pub async fn unregister(&self, app_id: &str) -> bool {
        self.inner.write().await.remove(app_id).is_some()
    }

    /// All registered capabilities, grouped by app.
    pub async fn list(&self) -> Vec<AppCapabilities> {
        self.inner.read().await.values().cloned().collect()
    }

    /// Flat list of every registered tool, annotated with its owning app.
    /// This is the shape the agent / UI consumes for tool discovery.
    pub async fn list_tools(&self) -> Vec<Value> {
        let guard = self.inner.read().await;
        let mut out = Vec::new();
        for caps in guard.values() {
            for tool in &caps.tools {
                out.push(json!({
                    "app_id": caps.app_id,
                    "app_name": caps.app_name,
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.parameters,
                    "requires_confirmation": tool.requires_confirmation,
                    "tags": tool.tags,
                }));
            }
        }
        out
    }

    /// Resolve a tool by name across all apps (first match wins).
    /// Returns the owning app id together with the tool definition so the
    /// caller can forward the invocation to the app's handler endpoint.
    #[allow(dead_code)] // used by the upcoming tool-dispatch path
    pub async fn find_tool(&self, name: &str) -> Option<(String, AssistToolDefinition)> {
        let guard = self.inner.read().await;
        for caps in guard.values() {
            if let Some(tool) = caps.tools.iter().find(|t| t.name == name) {
                return Some((caps.app_id.clone(), tool.clone()));
            }
        }
        None
    }
}
