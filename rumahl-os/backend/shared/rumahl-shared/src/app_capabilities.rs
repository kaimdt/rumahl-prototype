//! Extended App/Plugin capabilities (v2.4)
//!
//! This module introduces three additive, opt-in capabilities that apps and
//! plugins can declare in their manifest:
//!
//! 1. **Assist Tools** (`assist_tools`): callable AI tools/functions that rumahl
//!    Assist and pi.dev coding agents can invoke. Each tool maps to an app
//!    endpoint and advertises a JSON Schema for its parameters.
//! 2. **Lifecycle Hooks** (`lifecycle_hooks`): event subscriptions that let an
//!    app react to system/lifecycle events (install, entity change, user login,
//!    Assist task completion, ...) without polling.
//! 3. **Exposed Services** (`exposed_services`): RPC-style services that an app
//!    publishes for discovery and invocation by other apps (inter-app RPC).
//!
//! All types are forward-compatible: every field is optional or defaulted so
//! that adding them never breaks existing manifests.

use serde::{Deserialize, Serialize};
use serde_json::Value;

// ─── Assist Tools ────────────────────────────────────────────────────────────

/// A callable AI tool that an app/plugin exposes to rumahl Assist and pi.dev
/// coding agents. When the model decides to call the tool, rumahl dispatches the
/// call to the app's `handler` endpoint and feeds the result back to the model.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssistToolDefinition {
    /// Unique tool name in snake_case, e.g. `create_invoice`.
    pub name: String,

    /// Human-readable description shown to the model. Make it precise so the
    /// model knows when to call the tool.
    pub description: String,

    /// JSON Schema (object) describing the tool's input parameters.
    #[serde(default)]
    pub parameters: Value,

    /// Relative app endpoint the tool call is dispatched to (e.g. `/tools/invoice`).
    pub handler: String,

    /// HTTP method used to invoke the handler. Defaults to `POST`.
    #[serde(default = "default_tool_method")]
    pub method: String,

    /// Whether invoking this tool requires explicit user confirmation before
    /// it runs (for destructive or sensitive actions).
    #[serde(default)]
    pub requires_confirmation: bool,

    /// Optional tags/categories used to group tools in the UI.
    #[serde(default)]
    pub tags: Vec<String>,
}

fn default_tool_method() -> String {
    "POST".to_string()
}

// ─── Lifecycle Hooks ─────────────────────────────────────────────────────────

/// Set of lifecycle/system event hooks an app subscribes to.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LifecycleHooks {
    /// Individual hook subscriptions.
    #[serde(default)]
    pub hooks: Vec<LifecycleHook>,
}

/// A single lifecycle hook: when `event` fires, rumahl invokes `handler`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LifecycleHook {
    /// Event that triggers the hook.
    pub event: LifecycleEvent,

    /// Relative app endpoint invoked when the event fires.
    pub handler: String,

    /// Optional filter narrowing which events match (e.g. an entity-id glob
    /// like `light.*` for `on_entity_change`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter: Option<String>,
}

/// Supported lifecycle/system events an app can subscribe to.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LifecycleEvent {
    /// Fired once right after the app is installed.
    OnInstall,
    /// Fired right before the app is uninstalled.
    OnUninstall,
    /// Fired when the app's container/service starts.
    OnStart,
    /// Fired when the app's container/service stops.
    OnStop,
    /// Fired when the app's settings change.
    OnConfigChanged,
    /// Fired when a Home Assistant entity changes state (use `filter`).
    OnEntityChange,
    /// Fired when a user logs in.
    OnUserLogin,
    /// Fired when a user logs out.
    OnUserLogout,
    /// Fired when another app publishes an app event.
    OnAppEvent,
    /// Fired when an rumahl Assist agent task completes.
    OnAssistTaskComplete,
    /// Fired when a system event is recorded (filter on `severity` or
    /// `source`, e.g. `error` or `backup.*`).
    OnSystemEvent,
}

// ─── Exposed Services (inter-app RPC) ────────────────────────────────────────

/// An RPC-style service an app exposes for discovery and invocation by other
/// apps. Other apps locate it via the service registry and call its methods.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceExport {
    /// Stable, namespaced service id, e.g. `billing.invoices`.
    pub id: String,

    /// Display name shown in the service registry UI.
    pub name: String,

    /// Description of what the service provides.
    pub description: String,

    /// Semantic version of the service contract (callers can pin a minimum).
    #[serde(default = "default_service_version")]
    pub version: String,

    /// Relative base path under which the service methods are mounted.
    pub base_path: String,

    /// Methods the service exposes.
    #[serde(default)]
    pub methods: Vec<ServiceMethod>,

    /// Permission a caller must hold to invoke this service. If `None`, the
    /// generic `ServiceCall` permission is sufficient.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required_permission: Option<String>,
}

fn default_service_version() -> String {
    "1.0.0".to_string()
}

/// A single method on an exposed service.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceMethod {
    /// Method name in snake_case, e.g. `get_invoice`.
    pub name: String,

    /// Human-readable description.
    pub description: String,

    /// HTTP method used to invoke this method. Defaults to `POST`.
    #[serde(default = "default_tool_method")]
    pub method: String,

    /// Relative path appended to the service `base_path`.
    pub path: String,

    /// JSON Schema describing the request payload.
    #[serde(default)]
    pub input_schema: Value,

    /// JSON Schema describing the response payload.
    #[serde(default)]
    pub output_schema: Value,
}
