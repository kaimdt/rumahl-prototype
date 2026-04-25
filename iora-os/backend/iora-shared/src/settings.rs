//! Generic IORA settings registry.
//!
//! Goal: every configuration value that IORA cares about (HA URL, MQTT broker, JWT secret,
//! feature flags, …) is described exactly once as a [`SettingDefinition`] and from then on
//! shows up automatically in:
//!
//! * the **first-boot setup wizard** (only if [`SettingDefinition::wizard`] is `true`)
//! * the **Admin Control Center** UI (everything that is not [`SettingVisibility::Hidden`])
//! * a generic REST API exposed by `iora-home`
//!
//! Values are stored as JSON in the existing `system_preferences` table
//! (`preference_key` → `preference_value`). No `.env` files for user-facing config.
//!
//! Adding a new IORA setting is therefore a single-file change: register a new
//! [`SettingDefinition`] in [`default_registry()`] (or add it from another service via
//! [`SettingsRegistry::register`]) — the wizard and Control Center pick it up automatically.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::{Arc, RwLock};

/// The data type of a setting. Drives validation on write and the input control on the UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SettingType {
    /// Free-form text.
    String,
    /// Sensitive text (password, token, secret) – masked in API responses.
    Secret,
    /// Boolean toggle.
    Bool,
    /// Signed integer.
    Integer,
    /// Floating-point number.
    Float,
    /// HTTP/HTTPS URL.
    Url,
    /// One of a fixed set of strings (see [`SettingDefinition::options`]).
    Enum,
    /// Arbitrary JSON object.
    Json,
}

/// Where a setting may be displayed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SettingVisibility {
    /// Visible everywhere (Wizard if flagged + Control Center).
    Visible,
    /// Editable via API but never rendered in any UI (debug/internal).
    Hidden,
    /// Read-only in UI (e.g. derived/system-managed).
    ReadOnly,
}

impl Default for SettingVisibility {
    fn default() -> Self {
        Self::Visible
    }
}

/// Top-level grouping shown as tabs/sections in the Control Center UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SettingCategory {
    /// Bootstrap / system-critical (DB, network, security keys).
    System,
    /// Home Assistant integration.
    HomeAssistant,
    /// Smart-home protocols (MQTT, Matter, Zigbee, Z-Wave, BLE, HomeKit …).
    Integrations,
    /// User experience (theme, language, units).
    Appearance,
    /// Privacy, telemetry, recording.
    Privacy,
    /// Developer / debug switches.
    Developer,
    /// Anything else.
    Other,
}

impl SettingCategory {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::System => "system",
            Self::HomeAssistant => "home_assistant",
            Self::Integrations => "integrations",
            Self::Appearance => "appearance",
            Self::Privacy => "privacy",
            Self::Developer => "developer",
            Self::Other => "other",
        }
    }
}

/// A single setting's metadata. Stored once at startup, never mutated at runtime.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingDefinition {
    /// Stable key – used in `system_preferences.preference_key` and the API path.
    /// Convention: lowercase snake_case, dotted namespace (e.g. `ha.url`, `mqtt.broker`).
    pub key: String,
    /// Human-readable label (English; UI may translate).
    pub label: String,
    /// One-line help text shown under the input.
    pub description: String,
    pub category: SettingCategory,
    pub setting_type: SettingType,
    /// JSON-encoded default value (`null` if no default).
    pub default: serde_json::Value,
    /// Show this setting in the first-boot setup wizard? Reserve for **system-critical**
    /// values only (everything else is configured later in the Control Center).
    pub wizard: bool,
    /// Required to start IORA at all (wizard cannot be skipped).
    pub required: bool,
    /// Setting back-end services need to be restarted to pick up changes.
    /// Contains systemd unit names (e.g. `iora-home.service`).
    pub requires_restart: Vec<String>,
    /// Visibility in UI surfaces.
    #[serde(default)]
    pub visibility: SettingVisibility,
    /// For `SettingType::Enum` – the allowed values.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<String>,
    /// Optional minimum (for Integer/Float/String length).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,
    /// Optional maximum (for Integer/Float/String length).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,
    /// Free-form tags for grouping inside a category.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
}

impl SettingDefinition {
    /// Validate `value` against this definition. Returns `Err` with a user-readable message
    /// if invalid. Used by the generic write API.
    pub fn validate(&self, value: &serde_json::Value) -> Result<(), String> {
        use SettingType::*;
        match (self.setting_type, value) {
            (Bool, serde_json::Value::Bool(_)) => Ok(()),
            (Integer, serde_json::Value::Number(n)) if n.is_i64() || n.is_u64() => {
                let v = n.as_f64().unwrap_or(0.0);
                if let Some(min) = self.min {
                    if v < min {
                        return Err(format!("value must be ≥ {min}"));
                    }
                }
                if let Some(max) = self.max {
                    if v > max {
                        return Err(format!("value must be ≤ {max}"));
                    }
                }
                Ok(())
            }
            (Float, serde_json::Value::Number(_)) => Ok(()),
            (String | Secret, serde_json::Value::String(s)) => {
                if let Some(min) = self.min {
                    if (s.chars().count() as f64) < min {
                        return Err(format!("value must be at least {min} characters"));
                    }
                }
                if let Some(max) = self.max {
                    if (s.chars().count() as f64) > max {
                        return Err(format!("value must be at most {max} characters"));
                    }
                }
                Ok(())
            }
            (Url, serde_json::Value::String(s)) => {
                if s.is_empty() {
                    return Ok(()); // empty URL == "not configured"
                }
                if !(s.starts_with("http://") || s.starts_with("https://")) {
                    return Err("URL must start with http:// or https://".into());
                }
                Ok(())
            }
            (Enum, serde_json::Value::String(s)) => {
                if self.options.iter().any(|o| o == s) {
                    Ok(())
                } else {
                    Err(format!("must be one of: {}", self.options.join(", ")))
                }
            }
            (Json, _) => Ok(()),
            (_, serde_json::Value::Null) if !self.required => Ok(()),
            (t, v) => Err(format!(
                "type mismatch: expected {t:?}, got {}",
                match v {
                    serde_json::Value::Null => "null",
                    serde_json::Value::Bool(_) => "bool",
                    serde_json::Value::Number(_) => "number",
                    serde_json::Value::String(_) => "string",
                    serde_json::Value::Array(_) => "array",
                    serde_json::Value::Object(_) => "object",
                }
            )),
        }
    }

    /// Mask sensitive values for API responses.
    pub fn redact(&self, value: &serde_json::Value) -> serde_json::Value {
        if matches!(self.setting_type, SettingType::Secret) {
            if let Some(s) = value.as_str() {
                if s.is_empty() {
                    return serde_json::Value::String(String::new());
                }
                return serde_json::Value::String("••••••••".into());
            }
        }
        value.clone()
    }
}

/// Builder helper for ergonomic registration.
#[derive(Debug, Clone)]
pub struct SettingBuilder(SettingDefinition);

impl SettingBuilder {
    pub fn new(
        key: impl Into<String>,
        label: impl Into<String>,
        category: SettingCategory,
        setting_type: SettingType,
    ) -> Self {
        Self(SettingDefinition {
            key: key.into(),
            label: label.into(),
            description: String::new(),
            category,
            setting_type,
            default: serde_json::Value::Null,
            wizard: false,
            required: false,
            requires_restart: Vec::new(),
            visibility: SettingVisibility::Visible,
            options: Vec::new(),
            min: None,
            max: None,
            tags: Vec::new(),
        })
    }

    pub fn description(mut self, s: impl Into<String>) -> Self {
        self.0.description = s.into();
        self
    }
    pub fn default(mut self, v: serde_json::Value) -> Self {
        self.0.default = v;
        self
    }
    pub fn wizard(mut self, on: bool) -> Self {
        self.0.wizard = on;
        self
    }
    pub fn required(mut self, on: bool) -> Self {
        self.0.required = on;
        self
    }
    pub fn restart(mut self, units: &[&str]) -> Self {
        self.0.requires_restart = units.iter().map(|s| (*s).to_string()).collect();
        self
    }
    pub fn visibility(mut self, v: SettingVisibility) -> Self {
        self.0.visibility = v;
        self
    }
    pub fn options(mut self, opts: &[&str]) -> Self {
        self.0.options = opts.iter().map(|s| (*s).to_string()).collect();
        self
    }
    pub fn range(mut self, min: f64, max: f64) -> Self {
        self.0.min = Some(min);
        self.0.max = Some(max);
        self
    }
    pub fn tags(mut self, tags: &[&str]) -> Self {
        self.0.tags = tags.iter().map(|s| (*s).to_string()).collect();
        self
    }
    pub fn build(self) -> SettingDefinition {
        self.0
    }
}

/// Thread-safe registry of [`SettingDefinition`]s. Cloneable handle (Arc inside).
#[derive(Debug, Clone, Default)]
pub struct SettingsRegistry {
    inner: Arc<RwLock<BTreeMap<String, SettingDefinition>>>,
}

impl SettingsRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Insert (or replace) a definition. The last call wins, which lets downstream services
    /// tighten constraints set by the defaults.
    pub fn register(&self, def: SettingDefinition) {
        if let Ok(mut g) = self.inner.write() {
            g.insert(def.key.clone(), def);
        }
    }

    /// Bulk-register.
    pub fn extend<I: IntoIterator<Item = SettingDefinition>>(&self, defs: I) {
        if let Ok(mut g) = self.inner.write() {
            for d in defs {
                g.insert(d.key.clone(), d);
            }
        }
    }

    pub fn get(&self, key: &str) -> Option<SettingDefinition> {
        self.inner.read().ok().and_then(|g| g.get(key).cloned())
    }

    pub fn all(&self) -> Vec<SettingDefinition> {
        self.inner
            .read()
            .map(|g| g.values().cloned().collect())
            .unwrap_or_default()
    }

    /// Subset that should be shown in the first-boot setup wizard.
    pub fn wizard(&self) -> Vec<SettingDefinition> {
        self.all().into_iter().filter(|d| d.wizard).collect()
    }

    /// Subset visible in the Admin Control Center (everything except `Hidden`).
    pub fn control_center(&self) -> Vec<SettingDefinition> {
        self.all()
            .into_iter()
            .filter(|d| !matches!(d.visibility, SettingVisibility::Hidden))
            .collect()
    }
}

/// Built-in IORA settings. Every service is encouraged to call this once at startup
/// and then add its own definitions on top via [`SettingsRegistry::register`].
pub fn default_registry() -> SettingsRegistry {
    let r = SettingsRegistry::new();
    r.extend(default_settings());
    r
}

/// All the IORA defaults in one place. **Add new system-wide settings here** – they will
/// then automatically appear in the API, the Control Center UI and (if `wizard(true)`)
/// in the setup wizard.
pub fn default_settings() -> Vec<SettingDefinition> {
    use SettingCategory::*;
    use SettingType::*;
    vec![
        // ── System ────────────────────────────────────────────────────────────
        SettingBuilder::new("system.hostname", "Hostname", System, String)
            .description("Network hostname for this IORA device.")
            .default(serde_json::json!("iora"))
            .wizard(true)
            .required(true)
            .restart(&["systemd-hostnamed.service"])
            .tags(&["network", "identity"])
            .build(),
        SettingBuilder::new("system.timezone", "Timezone", System, String)
            .description("IANA timezone (e.g. Europe/Berlin).")
            .default(serde_json::json!("UTC"))
            .wizard(true)
            .required(true)
            .build(),
        SettingBuilder::new("system.locale", "Language", System, Enum)
            .description("UI language for the dashboard.")
            .options(&["de-DE", "en-US", "en-GB", "fr-FR", "es-ES"])
            .default(serde_json::json!("de-DE"))
            .wizard(true)
            .build(),
        SettingBuilder::new("system.admin_email", "Admin email", System, String)
            .description("Used for security notifications.")
            .default(serde_json::json!(""))
            .wizard(false)
            .build(),
        // ── Home Assistant ───────────────────────────────────────────────────
        SettingBuilder::new("ha.url", "Home Assistant URL", HomeAssistant, Url)
            .description("Base URL of your Home Assistant instance, e.g. http://homeassistant.local:8123.")
            .default(serde_json::json!(""))
            .restart(&["iora-home.service"])
            .tags(&["ha"])
            .build(),
        SettingBuilder::new("ha.token", "Home Assistant access token", HomeAssistant, Secret)
            .description("Long-lived access token (HA → Profile → Long-Lived Tokens).")
            .default(serde_json::json!(""))
            .restart(&["iora-home.service"])
            .tags(&["ha"])
            .build(),
        // ── Integrations (smart-home protocols) ──────────────────────────────
        SettingBuilder::new("mqtt.enabled", "Enable MQTT", Integrations, Bool)
            .description("Connect to an MQTT broker for sensor + automation events.")
            .default(serde_json::json!(false))
            .restart(&["iora-home.service"])
            .build(),
        SettingBuilder::new("mqtt.broker_url", "MQTT broker URL", Integrations, Url)
            .description("e.g. mqtt://localhost:1883")
            .default(serde_json::json!(""))
            .restart(&["iora-home.service"])
            .build(),
        SettingBuilder::new("mqtt.username", "MQTT username", Integrations, String)
            .default(serde_json::json!(""))
            .restart(&["iora-home.service"])
            .build(),
        SettingBuilder::new("mqtt.password", "MQTT password", Integrations, Secret)
            .default(serde_json::json!(""))
            .restart(&["iora-home.service"])
            .build(),
        SettingBuilder::new("matter.enabled", "Enable Matter", Integrations, Bool)
            .default(serde_json::json!(false))
            .restart(&["iora-home.service"])
            .build(),
        SettingBuilder::new("zigbee.enabled", "Enable Zigbee", Integrations, Bool)
            .default(serde_json::json!(false))
            .restart(&["iora-home.service"])
            .build(),
        SettingBuilder::new("zwave.enabled", "Enable Z-Wave", Integrations, Bool)
            .default(serde_json::json!(false))
            .restart(&["iora-home.service"])
            .build(),
        SettingBuilder::new("homekit.enabled", "Enable HomeKit bridge", Integrations, Bool)
            .default(serde_json::json!(false))
            .restart(&["iora-home.service"])
            .build(),
        SettingBuilder::new("ble.enabled", "Enable Bluetooth LE", Integrations, Bool)
            .default(serde_json::json!(false))
            .restart(&["iora-home.service"])
            .build(),
        // ── Appearance ───────────────────────────────────────────────────────
        SettingBuilder::new("ui.theme", "Theme", Appearance, Enum)
            .options(&["dark", "light", "auto"])
            .default(serde_json::json!("dark"))
            .build(),
        SettingBuilder::new("ui.units", "Units", Appearance, Enum)
            .options(&["metric", "imperial"])
            .default(serde_json::json!("metric"))
            .build(),
        // ── Privacy ──────────────────────────────────────────────────────────
        SettingBuilder::new("privacy.telemetry", "Send anonymous telemetry", Privacy, Bool)
            .description("Help us improve IORA by sending anonymous usage statistics.")
            .default(serde_json::json!(false))
            .build(),
        SettingBuilder::new("privacy.crash_reports", "Send crash reports", Privacy, Bool)
            .default(serde_json::json!(false))
            .build(),
        // ── Developer ────────────────────────────────────────────────────────
        SettingBuilder::new("developer.log_level", "Log level", Developer, Enum)
            .options(&["error", "warn", "info", "debug", "trace"])
            .default(serde_json::json!("info"))
            .restart(&["iora-home.service", "iora-core.service"])
            .build(),
        SettingBuilder::new("developer.api_debug", "Enable verbose API logging", Developer, Bool)
            .default(serde_json::json!(false))
            .restart(&["iora-home.service"])
            .build(),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_register_and_get() {
        let r = default_registry();
        assert!(r.get("ha.url").is_some());
        assert!(r.wizard().iter().all(|d| d.wizard));
        assert!(r.wizard().iter().any(|d| d.key == "system.hostname"));
        assert!(r
            .control_center()
            .iter()
            .all(|d| !matches!(d.visibility, SettingVisibility::Hidden)));
    }

    #[test]
    fn validate_url() {
        let def = SettingBuilder::new("x.url", "X", SettingCategory::System, SettingType::Url)
            .build();
        assert!(def.validate(&serde_json::json!("http://x")).is_ok());
        assert!(def.validate(&serde_json::json!("ftp://x")).is_err());
        assert!(def.validate(&serde_json::json!("")).is_ok());
    }

    #[test]
    fn validate_enum() {
        let def = SettingBuilder::new("x.t", "X", SettingCategory::Appearance, SettingType::Enum)
            .options(&["a", "b"])
            .build();
        assert!(def.validate(&serde_json::json!("a")).is_ok());
        assert!(def.validate(&serde_json::json!("c")).is_err());
    }

    #[test]
    fn redact_secret() {
        let def = SettingBuilder::new("x.s", "X", SettingCategory::System, SettingType::Secret)
            .build();
        assert_eq!(
            def.redact(&serde_json::json!("supersecret")),
            serde_json::json!("••••••••")
        );
        assert_eq!(def.redact(&serde_json::json!("")), serde_json::json!(""));
    }
}
