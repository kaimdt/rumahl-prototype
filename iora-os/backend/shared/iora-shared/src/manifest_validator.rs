//! Manifest Validator – Unified validation for Themes, Apps, and Plugins
//!
//! Validates manifest.json content before installation. Returns detailed,
//! human-readable error messages for all three types.
//!
//! Usage:
//! ```rust
//! let result = validate_theme_manifest(&json);
//! if !result.is_valid() {
//!     for error in &result.errors {
//!         eprintln!("❌ {}: {}", error.field, error.message);
//!     }
//! }
//! ```

use serde::{Serialize};
use std::collections::HashSet;

// ─── Validation Result Types ──────────────────────────────────────────

/// Severity level of a validation issue
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ValidationSeverity {
    Error,
    Warning,
}

/// A single validation issue
#[derive(Debug, Clone, Serialize)]
pub struct ValidationIssue {
    /// Severity: error (blocks install) or warning (advisory)
    pub severity: ValidationSeverity,
    /// Which field in the manifest has the issue
    pub field: String,
    /// Human-readable message in German
    pub message: String,
    /// Suggested fix (if available)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggestion: Option<String>,
}

/// Complete validation result
#[derive(Debug, Clone, Serialize)]
pub struct ValidationResult {
    /// Whether the manifest is valid (no errors)
    pub valid: bool,
    /// What type was validated: "theme", "app", or "plugin"
    pub manifest_type: String,
    /// Manifest ID (if found)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manifest_id: Option<String>,
    /// Manifest name (if found)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manifest_name: Option<String>,
    /// List of validation issues
    pub issues: Vec<ValidationIssue>,
}

impl ValidationResult {
    pub fn new(manifest_type: &str) -> Self {
        Self {
            valid: true,
            manifest_type: manifest_type.to_string(),
            manifest_id: None,
            manifest_name: None,
            issues: vec![],
        }
    }

    pub fn is_valid(&self) -> bool {
        !self.issues.iter().any(|i| i.severity == ValidationSeverity::Error)
    }

    pub fn has_warnings(&self) -> bool {
        self.issues.iter().any(|i| i.severity == ValidationSeverity::Warning)
    }

    pub fn add_error(&mut self, field: &str, message: &str, suggestion: Option<&str>) {
        self.valid = false;
        self.issues.push(ValidationIssue {
            severity: ValidationSeverity::Error,
            field: field.to_string(),
            message: message.to_string(),
            suggestion: suggestion.map(|s| s.to_string()),
        });
    }

    pub fn add_warning(&mut self, field: &str, message: &str, suggestion: Option<&str>) {
        self.issues.push(ValidationIssue {
            severity: ValidationSeverity::Warning,
            field: field.to_string(),
            message: message.to_string(),
            suggestion: suggestion.map(|s| s.to_string()),
        });
    }
}

// ─── JSON Helpers ─────────────────────────────────────────────────────

fn get_str<'a>(json: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    json.get(key).and_then(|v| v.as_str())
}

fn get_obj<'a>(json: &'a serde_json::Value, key: &str) -> Option<&'a serde_json::Map<String, serde_json::Value>> {
    json.get(key).and_then(|v| v.as_object())
}

// ─── Theme Manifest Validation ────────────────────────────────────────

/// Valid required CSS variable names for themes
const REQUIRED_THEME_VARS: &[&str] = &[
    "background", "foreground", "card", "accent",
    "border", "muted",
];

/// Recommended CSS variable names
const RECOMMENDED_THEME_VARS: &[&str] = &[
    "primary", "secondary", "popover",
    "accent-foreground", "muted-foreground", "card-foreground",
    "ring", "success", "destructive",
    "radius", "glass-bg", "glass-blur",
];

/// Validate a theme manifest (JSON value)
pub fn validate_theme_manifest(json: &serde_json::Value) -> ValidationResult {
    let mut result = ValidationResult::new("theme");

    // Check if it's wrapped in a "theme" key (app-style packaging)
    let theme_json = if let Some(theme_obj) = get_obj(json, "theme") {
        serde_json::Value::Object(theme_obj.clone())
    } else {
        json.clone()
    };

    let id = get_str(&theme_json, "id");
    let name = get_str(&theme_json, "name");
    result.manifest_id = id.map(|s| s.to_string());
    result.manifest_name = name.map(|s| s.to_string());

    // ─── Required fields ──────────────────────────────────────────
    if id.as_ref().is_none_or(|s| s.is_empty()) {
        result.add_error("id", "Die Theme-ID fehlt oder ist leer. Jedes Theme braucht eine eindeutige ID (z.B. \"mein-theme\").",
            Some("Füge \"id\": \"mein-theme\" hinzu. Nur Kleinbuchstaben, Zahlen und Bindestriche."));
    } else {
        let id_val = id.as_ref().unwrap();
        if id_val.contains(' ') {
            result.add_error("id", "Die Theme-ID darf keine Leerzeichen enthalten.",
                Some(&format!("Ersetze Leerzeichen durch Bindestriche, z.B. \"{}\"", id_val.replace(' ', "-"))));
        }
        if id_val.chars().any(|c| c.is_uppercase()) {
            result.add_warning("id", "Theme-ID enthält Großbuchstaben. Kleinschreibung wird empfohlen.",
                Some(&format!("Verwende \"{}\"", id_val.to_lowercase())));
        }
    }

    if name.as_ref().is_none_or(|s| s.is_empty()) {
        result.add_error("name", "Der Theme-Name fehlt. Gib deinem Theme einen aussagekräftigen Namen.",
            Some("Füge \"name\": \"Mein Theme\" hinzu."));
    }

    if get_str(&theme_json, "version").is_none() {
        result.add_error("version", "Die Version fehlt. Jedes Theme braucht eine semantische Version.",
            Some("Füge \"version\": \"1.0.0\" hinzu."));
    } else {
        let ver = get_str(&theme_json, "version").unwrap();
        if !ver.chars().all(|c| c.is_ascii_digit() || c == '.') {
            result.add_error("version", "Die Version muss im Format X.Y.Z sein (z.B. \"1.0.0\").",
                Some(&format!("Korrigiere \"{}\" zu einem gültigen Semver-Format.", ver)));
        }
    }

    // ─── CSS Variables ────────────────────────────────────────────
    // Child themes that set parent_theme only need to override a subset
    // of variables — skip the required-variables check for them.
    let has_parent = get_str(&theme_json, "parent_theme")
        .map(|p| !p.is_empty())
        .unwrap_or(false);

    if let Some(vars) = get_obj(&theme_json, "css_variables") {
        // Only check required variables for standalone (non-child) themes
        if !has_parent {
            let mut missing_required: Vec<&str> = vec![];
            for req in REQUIRED_THEME_VARS {
                if !vars.contains_key(*req) {
                    missing_required.push(req);
                }
            }
            if !missing_required.is_empty() {
                result.add_error("css_variables",
                    &format!("Mindest-Farbwerte fehlen: {}. Ein Theme muss mindestens Hintergrund, Text, Karten, Akzent, Rahmen und gedämpfte Farbe definieren.",
                        missing_required.iter().map(|s| format!("--{}", s)).collect::<Vec<_>>().join(", ")),
                    Some(&format!("Füge fehlende Variablen hinzu:\n{}",
                        missing_required.iter().map(|v|
                            format!("  \"{}\": \"oklch(0.5 0.1 240)\"", v)
                        ).collect::<Vec<_>>().join(",\n"))
                    ));
            }
        }

        // Validate color values (applies to all themes, including children)
        for (key, val) in vars {
            if let Some(val_str) = val.as_str() {
                if val_str.is_empty() {
                    result.add_error(&format!("css_variables.{}", key),
                        &format!("Die CSS-Variable \"--{}\" ist leer.", key),
                        Some("Gib einen gültigen Farbwert an (oklch, hex, rgb, hsl)."));
                }
                // Basic color format check
                let is_valid_color = val_str.starts_with("oklch(")
                    || val_str.starts_with("#")
                    || val_str.starts_with("rgb")
                    || val_str.starts_with("hsl")
                    || val_str.starts_with("oklch")
                    || val_str == "transparent"
                    || val_str == "none";
                if !is_valid_color && !val_str.contains("px") && !val_str.contains("rem") && !val_str.contains("s") {
                    result.add_warning(&format!("css_variables.{}", key),
                        &format!("Unerwarteter Wert für \"--{}\": \"{}\". Erwarte einen Farbwert.", key, val_str),
                        Some("Verwende oklch(), #hex, rgb(), hsl() oder 'transparent'."));
                }
            }
        }

        // Check for recommended variables (non-blocking for child themes too)
        if !has_parent {
            let missing_rec: Vec<String> = RECOMMENDED_THEME_VARS.iter()
                .filter(|r| !vars.contains_key(**r))
                .map(|r| r.to_string())
                .collect();
            if !missing_rec.is_empty() {
                result.add_warning("css_variables",
                    &format!("Empfohlene Variablen fehlen: {}. Diese verbessern das Theme-Erlebnis.",
                        missing_rec.iter().map(|s| format!("--{}", s)).collect::<Vec<_>>().join(", ")),
                    Some("Erwäge, diese Variablen für bessere Kontrolle hinzuzufügen."));
            }
        }
    } else {
        // No css_variables at all: valid for child themes, error for standalone
        if !has_parent {
            result.add_error("css_variables",
                "Keine CSS-Variablen definiert. Ein Theme MUSS css_variables mit mindestens background, foreground, card, accent, border und muted enthalten.",
                Some("Füge ein \"css_variables\"-Objekt mit Farbwerten hinzu."));
        }
    }

    // ─── Source-Type ──────────────────────────────────────────────
    let source = get_str(&theme_json, "source").unwrap_or("inline");
    if source == "file" {
        if let Some(css_files) = theme_json.get("css_files").and_then(|v| v.as_array()) {
            if css_files.is_empty() {
                result.add_warning("css_files",
                    "source ist \"file\" aber css_files ist leer. File-basierte Themes sollten CSS-Dateien referenzieren.",
                    Some("Füge \"css_files\": [\"theme.css\"] hinzu oder ändere source zu \"inline\"."));
            }
        } else {
            result.add_warning("css_files",
                "source ist \"file\" aber kein css_files-Array gefunden.",
                Some("Füge \"css_files\": [\"theme.css\"] hinzu."));
        }
    }

    // ─── Fonts ────────────────────────────────────────────────────
    if let Some(fonts) = theme_json.get("fonts").and_then(|v| v.as_array()) {
        for (i, font) in fonts.iter().enumerate() {
            let font_name_str = format!("Font #{}", i + 1);
            let font_name = get_str(font, "name").unwrap_or(&font_name_str);
            if get_str(font, "family").is_none() {
                result.add_error(&format!("fonts[{}]", i),
                    &format!("Font \"{}\" hat keine \"family\"-Angabe (CSS font-family).", font_name),
                    Some("Füge \"family\": \"'Font Name', fallback\" hinzu."));
            }
            if get_str(font, "url").is_none() {
                result.add_error(&format!("fonts[{}]", i),
                    &format!("Font \"{}\" hat keine \"url\" (Google Fonts URL oder Dateipfad).", font_name),
                    Some("Füge eine URL zur Schriftart hinzu."));
            }
        }
    } else {
        result.add_warning("fonts",
            "Keine benutzerdefinierten Schriftarten definiert. Das Theme verwendet dann die System-Standardschrift.",
            Some("Erwäge, Google Fonts oder eigene Schriftarten über das \"fonts\"-Array einzubinden."));
    }

    // ─── Widget Templates ─────────────────────────────────────────
    if let Some(widgets) = theme_json.get("widget_templates").and_then(|v| v.as_array()) {
        for (i, wt) in widgets.iter().enumerate() {
            if get_str(wt, "widget_type").is_none() {
                result.add_error(&format!("widget_templates[{}]", i),
                    &format!("Widget-Template #{} hat keinen \"widget_type\" (z.B. \"light\", \"switch\").", i + 1),
                    Some("Füge \"widget_type\": \"light\" hinzu."));
            }
            if let Some(variants) = wt.get("variants").and_then(|v| v.as_array()) {
                if variants.is_empty() {
                    result.add_error(&format!("widget_templates[{}].variants", i),
                        &format!("Widget-Template \"{}\" hat keine Varianten.", get_str(wt, "widget_type").unwrap_or("?"), ),
                        Some("Füge mindestens eine Variante mit \"name\": \"default\" und \"template\" hinzu."));
                }
                for (j, variant) in variants.iter().enumerate() {
                    if get_str(variant, "template").is_none() {
                        result.add_error(&format!("widget_templates[{}].variants[{}]", i, j),
                            "Variante hat keinen \"template\"-Pfad zur HTML-Datei.",
                            Some("Füge \"template\": \"widgets/light.html\" hinzu."));
                    }
                    if get_str(variant, "name").is_none() {
                        result.add_error(&format!("widget_templates[{}].variants[{}]", i, j),
                            "Variante hat keinen \"name\" (z.B. \"default\", \"compact\").",
                            Some("Füge \"name\": \"default\" hinzu."));
                    }
                }
            } else {
                result.add_error(&format!("widget_templates[{}]", i),
                    &format!("Widget-Template \"{}\" hat kein \"variants\"-Array.", get_str(wt, "widget_type").unwrap_or("?")),
                    Some("Füge \"variants\": [{ \"name\": \"default\", \"template\": \"...\" }] hinzu."));
            }
        }
    }

    // ─── Capabilities ─────────────────────────────────────────────
    if theme_json.get("capabilities").is_some() {
        // Validate design modes if present
        if let Some(modes) = theme_json.get("capabilities").and_then(|c| c.get("design_modes")).and_then(|m| m.as_array()) {
            for (i, mode) in modes.iter().enumerate() {
                if get_str(mode, "id").is_none() {
                    result.add_error(&format!("capabilities.design_modes[{}]", i),
                        "Design-Modus hat keine \"id\".",
                        Some("Füge \"id\": \"mein-modus\" hinzu."));
                }
                let time_start = get_str(mode, "time_start");
                let time_end = get_str(mode, "time_end");
                if time_start.is_some() != time_end.is_some() {
                    result.add_warning(&format!("capabilities.design_modes[{}]", i),
                        "Design-Modus hat nur eine Zeitangabe. Entweder beide (time_start + time_end) oder keine angeben.",
                        Some("Füge sowohl time_start als auch time_end hinzu (Format: \"HH:MM\")."));
                }
                if let (Some(ts), Some(te)) = (time_start, time_end) {
                    if !is_valid_time(ts) { result.add_error(&format!("capabilities.design_modes[{}].time_start", i), "Ungültiges Zeitformat.", Some("Verwende \"HH:MM\" (z.B. \"06:00\").")); }
                    if !is_valid_time(te) { result.add_error(&format!("capabilities.design_modes[{}].time_end", i), "Ungültiges Zeitformat.", Some("Verwende \"HH:MM\" (z.B. \"22:00\").")); }
                }
            }
        }
    }

    // ─── parent_theme ─────────────────────────────────────────────
    if let Some(parent) = get_str(&theme_json, "parent_theme") {
        if parent == id.unwrap_or("") {
            result.add_error("parent_theme",
                "Ein Theme kann nicht sein eigenes Parent sein (zirkuläre Referenz).",
                Some("Entferne parent_theme oder verwende ein anderes Theme als Basis."));
        }
    }

    result
}

// ─── App/Plugin Manifest Validation ───────────────────────────────────

/// Valid required permissions that we know about
const KNOWN_PERMISSIONS: &[&str] = &[
    "AppStorageRead", "AppStorageWrite", "AppStorageDelete", "AppStorageManage",
    "AppDatabaseSqlite", "AppDatabaseManage",
    "AppScheduleCreate", "AppScheduleRead", "AppScheduleUpdate", "AppScheduleDelete",
    "MessagingPublish", "MessagingSubscribe", "MessagingWildcard", "MessagingDirect",
    "WebhookCreate", "WebhookRead", "WebhookUpdate", "WebhookDelete", "WebhookManage",
    "ThemeInstall",
    "HttpClient", "WebSocket", "EntityRead", "EntityWrite",
];

/// Validate an app or plugin manifest
pub fn validate_app_manifest(json: &serde_json::Value) -> ValidationResult {
    let app_type = get_str(json, "type").unwrap_or("app");
    let mut result = ValidationResult::new(if app_type == "plugin" { "plugin" } else { "app" });

    let id = get_str(json, "id");
    let name = get_str(json, "name");
    result.manifest_id = id.map(|s| s.to_string());
    result.manifest_name = name.map(|s| s.to_string());

    // ─── Required fields ──────────────────────────────────────────
    if id.as_ref().is_none_or(|s| s.is_empty()) {
        result.add_error("id", "Die App-ID fehlt. Jede App/Plugin braucht eine eindeutige ID.",
            Some("Füge \"id\": \"meine-app\" hinzu."));
    } else {
        let id_val = id.as_ref().unwrap();
        if id_val.contains(' ') {
            result.add_error("id", "Die App-ID darf keine Leerzeichen enthalten.",
                Some(&format!("Verwende \"{}\"", id_val.replace(' ', "-"))));
        }
    }

    if name.as_ref().is_none_or(|s| s.is_empty()) {
        result.add_error("name", "Der Name fehlt.",
            Some("Füge \"name\": \"Meine App\" hinzu."));
    }

    if get_str(json, "version").is_none() {
        result.add_error("version", "Die Version fehlt.",
            Some("Füge \"version\": \"1.0.0\" hinzu."));
    }

    // ─── Type validation ──────────────────────────────────────────
    match app_type {
        "app" | "plugin" => {},
        "" => result.add_error("type", "Der \"type\" fehlt. Muss \"app\" oder \"plugin\" sein.",
            Some("Füge \"type\": \"app\" oder \"type\": \"plugin\" hinzu.")),
        other => result.add_error("type", &format!("Unbekannter Typ \"{}\". Erlaubt sind nur \"app\" und \"plugin\".", other),
            Some("Ändere zu \"type\": \"app\" oder \"type\": \"plugin\".")),
    }

    // Plugin-specific checks
    if app_type == "plugin"
        && json.get("plugin_type").is_none() {
            result.add_error("plugin_type", "Plugin-Typ fehlt (z.B. \"widget\", \"theme\", \"automation\").",
                Some("Füge \"plugin_type\": \"widget\" hinzu."));
        }

    // App-specific checks
    if app_type == "app" {
        let has_docker = json.get("docker").is_some();
        let has_bundle = json.get("bundle").is_some();
        if !has_docker && !has_bundle {
            result.add_warning("docker", "App hat weder \"docker\" noch \"bundle\"-Konfiguration. Sie wird ohne Container gestartet.",
                Some("Füge eine docker-Konfiguration hinzu, wenn die App einen Server benötigt."));
        }
    }

    // ─── Permissions ──────────────────────────────────────────────
    if let Some(perms) = json.get("permissions").and_then(|p| p.as_array()) {
        let mut seen = HashSet::new();
        for (i, perm) in perms.iter().enumerate() {
            if let Some(p_str) = perm.as_str() {
                if !seen.insert(p_str) {
                    result.add_warning(&format!("permissions[{}]", i),
                        &format!("Doppelte Permission \"{}\".", p_str),
                        Some("Entferne die doppelte Permission."));
                }
                if !KNOWN_PERMISSIONS.contains(&p_str) {
                    result.add_warning(&format!("permissions[{}]", i),
                        &format!("Unbekannte Permission \"{}\". Wird trotzdem akzeptiert, könnte aber wirkungslos sein.", p_str),
                        Some("Überprüfe die Schreibweise oder verwende eine bekannte Permission."));
                }
            } else {
                result.add_error(&format!("permissions[{}]", i),
                    "Permission ist kein String.",
                    Some("Jede Permission muss ein Text sein, z.B. \"EntityRead\"."));
            }
        }
    }

    // ─── Bundle validation ────────────────────────────────────────
    if let Some(bundle) = json.get("bundle") {
        if bundle.get("services").is_none() || bundle.get("services").and_then(|s| s.as_array()).map(|a| a.is_empty()).unwrap_or(true) {
            result.add_error("bundle.services", "Bundle-Konfiguration hat keine Services.",
                Some("Füge \"services\": [{ \"name\": \"...\", \"image\": \"...\" }] hinzu."));
        }
    }

    // ─── Docker validation ────────────────────────────────────────
    if let Some(docker) = json.get("docker") {
        if docker.get("image").is_none() {
            result.add_error("docker.image", "Docker-Konfiguration hat kein \"image\".",
                Some("Füge \"image\": \"nginx:latest\" hinzu."));
        }
    }

    result
}

// ─── Unified Validator ────────────────────────────────────────────────

/// Auto-detect and validate any manifest type (theme, app, or plugin)
pub fn validate_manifest(json: &serde_json::Value) -> ValidationResult {
    // Check if it's a theme (has css_variables)
    let has_theme_fields = json.get("css_variables").is_some()
        || json.get("theme").and_then(|t| t.get("css_variables")).is_some();

    // Check if it's an app/plugin (has type field)
    let has_app_type = json.get("type").and_then(|v| v.as_str()).is_some();

    if has_theme_fields && !has_app_type {
        validate_theme_manifest(json)
    } else if has_app_type {
        validate_app_manifest(json)
    } else {
        // Try both and return the one with fewer errors
        let theme_result = validate_theme_manifest(json);
        let app_result = validate_app_manifest(json);

        let theme_errors = theme_result.issues.iter().filter(|i| i.severity == ValidationSeverity::Error).count();
        let app_errors = app_result.issues.iter().filter(|i| i.severity == ValidationSeverity::Error).count();

        if theme_errors <= app_errors {
            theme_result
        } else {
            app_result
        }
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────

fn is_valid_time(time: &str) -> bool {
    if time.len() != 5 { return false; }
    let parts: Vec<&str> = time.split(':').collect();
    if parts.len() != 2 { return false; }
    if let (Ok(h), Ok(m)) = (parts[0].parse::<u32>(), parts[1].parse::<u32>()) {
        return h < 24 && m < 60;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_theme_minimal() {
        let json = serde_json::json!({
            "id": "test-theme",
            "name": "Test Theme",
            "version": "1.0.0",
            "css_variables": {
                "background": "#000",
                "foreground": "#fff",
                "card": "#111",
                "accent": "#6366f1",
                "border": "#333",
                "muted": "#222"
            }
        });
        let result = validate_theme_manifest(&json);
        assert!(result.is_valid(), "Expected valid, got errors: {:?}", result.issues);
    }

    #[test]
    fn test_missing_css_variables() {
        let json = serde_json::json!({
            "id": "bad-theme",
            "name": "Bad Theme",
            "version": "1.0.0"
        });
        let result = validate_theme_manifest(&json);
        assert!(!result.is_valid());
        assert!(result.issues.iter().any(|i| i.field == "css_variables"));
    }

    #[test]
    fn test_missing_id() {
        let json = serde_json::json!({
            "name": "No ID",
            "version": "1.0.0",
            "css_variables": { "background": "#000", "foreground": "#fff", "card": "#111", "accent": "#f00", "border": "#333", "muted": "#222" }
        });
        let result = validate_theme_manifest(&json);
        assert!(!result.is_valid());
        assert!(result.issues.iter().any(|i| i.field == "id"));
    }

    #[test]
    fn test_valid_app() {
        let json = serde_json::json!({
            "id": "test-app",
            "name": "Test App",
            "version": "1.0.0",
            "type": "app",
            "developer": "Test",
            "description": "A test",
            "docker": { "image": "nginx:latest" }
        });
        let result = validate_app_manifest(&json);
        assert!(result.is_valid(), "Expected valid, got errors: {:?}", result.issues);
    }

    #[test]
    fn test_valid_plugin() {
        let json = serde_json::json!({
            "id": "test-plugin",
            "name": "Test Plugin",
            "version": "1.0.0",
            "type": "plugin",
            "plugin_type": "widget",
            "developer": "Test",
            "description": "A test"
        });
        let result = validate_app_manifest(&json);
        assert!(result.is_valid(), "Expected valid, got errors: {:?}", result.issues);
    }

    #[test]
    fn test_wrapped_theme() {
        let json = serde_json::json!({
            "type": "plugin",
            "plugin_type": "theme",
            "permissions": ["ThemeInstall"],
            "theme": {
                "id": "wrapped-theme",
                "name": "Wrapped Theme",
                "version": "1.0.0",
                "css_variables": {
                    "background": "#000", "foreground": "#fff",
                    "card": "#111", "accent": "#f00",
                    "border": "#333", "muted": "#222"
                }
            }
        });
        let result = validate_theme_manifest(&json);
        assert!(result.is_valid(), "Expected valid wrapped theme, got errors: {:?}", result.issues);
    }
}
