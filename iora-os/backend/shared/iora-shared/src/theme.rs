//! Theme system for IORA – File-based theme engine
//!
//! Themes are full file packages (ZIP) containing:
//! - manifest.json    Theme definition (id, name, version, css_files, fonts, etc.)
//! - *.css            One or more CSS stylesheets
//! - *.js             Optional JavaScript for theme interactivity
//! - fonts/           Self-hosted web fonts (woff2, woff, ttf)
//! - images/          Backgrounds, patterns, logo, preview
//! - icons/           Custom icon fonts
//! - html/            HTML templates for custom pages/widgets
//!
//! Themes are extracted to `<data_dir>/themes/{theme_id>/` and served
//! statically via `/api/themes/assets/{theme_id>/{path>`.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// A font definition for use in a theme.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeFont {
    /// Display name (e.g. "Cinzel Decorative")
    pub name: String,

    /// CSS font-family value (e.g. "'Cinzel Decorative', serif")
    pub family: String,

    /// URL or file path within the theme ZIP (e.g. "fonts/steampunk.woff2")
    /// If it's a relative path (no http/https), the backend resolves it
    /// to `/api/themes/assets/{theme_id>/fonts/steampunk.woff2`.
    pub url: String,

    /// Font format (woff2, woff, truetype, opentype)
    #[serde(default = "default_font_format")]
    pub format: String,

    /// Font weight(s) to load (e.g. "400;700;900")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub weights: Option<String>,

    /// Font subset(s), e.g. "latin,latin-ext"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subsets: Option<String>,

    /// Whether this is the primary UI font
    #[serde(default)]
    pub is_primary: bool,

    /// Whether this is the heading font
    #[serde(default)]
    pub is_heading: bool,

    #[serde(default)]
    pub is_monospace: bool,
}

fn default_font_format() -> String { "woff2".to_string() }

/// Icon font configuration.
/// Can reference a file inside the theme ZIP or an external URL.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeIconConfig {
    /// Name of the icon font (e.g. "Steampunk Icons", "Font Awesome")
    pub font_name: String,

    /// Path to the icon font CSS inside the theme or external URL.
    /// Relative paths resolve to `/api/themes/assets/{theme_id>/...`
    pub css_path: String,

    /// Path to the actual font file (woff2) inside the theme.
    /// Relative paths resolve to `/api/themes/assets/{theme_id>/...`
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_file: Option<String>,

    /// CSS class prefix for icons (e.g. "sp-icon", "fa")
    pub class_prefix: String,

    /// Mapping of IORA icon names to custom icon classes.
    /// Key: IORA icon name (e.g. "Lightbulb", "Sun")
    /// Value: Custom icon class (e.g. "sp-icon-lightbulb", "fa-lightbulb")
    #[serde(default)]
    pub icon_map: HashMap<String, String>,
}

// ════════════════════════════════════════════════════════════════
// Widget Template System – Theme-Defined Widget Rendering
// ════════════════════════════════════════════════════════════════

/// A single variant of a widget template.
/// Themes can provide multiple visual variants per widget type
/// (e.g. "default", "compact", "detailed", "minimal").
/// Responsive variants adapt to screen size automatically.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WidgetTemplateVariant {
    /// Variant name (e.g. "default", "compact", "detailed")
    pub name: String,
    /// Path to the HTML template file within the theme
    pub template: String,
    /// Optional CSS file for this variant (scoped to the widget)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub css: Option<String>,
    /// Optional JavaScript file for interactive behavior
    #[serde(skip_serializing_if = "Option::is_none")]
    pub js: Option<String>,
    /// Human-readable label for the variant picker
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// Icon name for the variant picker (Phosphor icon)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    /// Whether this is the default variant
    #[serde(default)]
    pub is_default: bool,
    /// Responsive breakpoint: "all" (default), "mobile" (<768px),
    /// "tablet" (768-1024px), "desktop" (>1024px).
    /// When multiple variants match, the most specific one wins.
    #[serde(default = "default_responsive")]
    pub responsive: String,
}

fn default_responsive() -> String { "all".to_string() }

/// Widget template collection for a single widget type.
/// Maps widget types ("light", "switch", "climate", etc.) to their theme templates.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WidgetTemplate {
    /// The widget type this template applies to (e.g. "light", "switch")
    pub widget_type: String,
    /// Available variants for this widget type
    #[serde(default)]
    pub variants: Vec<WidgetTemplateVariant>,
    /// Custom CSS properties exposed to this widget's template
    #[serde(default)]
    pub css_variables: HashMap<String, String>,
    /// Whether this widget template completely replaces the default rendering
    #[serde(default = "default_replace")]
    pub replace_default: bool,
}

fn default_replace() -> bool { true }

// ════════════════════════════════════════════════════════════════

/// A complete file-based theme definition (from manifest.json inside ZIP).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeDefinition {
    /// Unique theme ID (e.g. "steampunk", "midnight-ocean")
    pub id: String,

    /// Human-readable name (e.g. "Steampunk", "Midnight Ocean")
    pub name: String,

    /// Semantic version
    pub version: String,

    /// Developer/author
    #[serde(default)]
    pub developer: String,

    /// Short description
    #[serde(default)]
    pub description: String,

    /// Optional icon (Phosphor icon name or 'file:images/icon.svg')
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,

    /// Preview image for the theme picker.
    /// Can be a relative path inside the ZIP (e.g. "images/preview.png")
    /// or a data: URL.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview_image: Option<String>,

    /// Parent theme to extend. Built-in: "day", "night", "light",
    /// "evening", "day-classic", "sleep".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_theme: Option<String>,

    /// ─── Theme type: inline vs file-based ───
    /// "inline" = everything in manifest.json (simpler themes)
    /// "file"   = files extracted from ZIP (complex themes)
    #[serde(default = "default_theme_source")]
    pub source: String,

    /// CSS custom property overrides (always applied, even for file-based themes).
    /// These are applied as `--key: value` on `:root` before loading CSS files.
    #[serde(default)]
    pub css_variables: HashMap<String, String>,

    /// CSS files to load, in order. Relative to the theme directory.
    /// E.g. ["variables.css", "theme.css", "components.css"]
    /// The first file is treated as the entry point.
    #[serde(default)]
    pub css_files: Vec<String>,

    /// JavaScript files to load, in order. Relative to the theme directory.
    /// E.g. ["js/theme.js"]
    #[serde(default)]
    pub js_files: Vec<String>,

    /// HTML templates provided by the theme.
    /// Key: template name (e.g. "header", "custom-page", "widget-frame")
    /// Value: path relative to theme directory (e.g. "html/templates/header.html")
    #[serde(default)]
    pub html_templates: HashMap<String, String>,

    /// Custom web fonts
    #[serde(default)]
    pub fonts: Vec<ThemeFont>,

    /// Icon font configuration
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_font: Option<ThemeIconConfig>,

    /// Inline additional CSS (for backward compatibility, used when source="inline")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub additional_css: Option<String>,

    /// Whether this is a built-in system theme (cannot be uninstalled)
    #[serde(default)]
    pub system: bool,

    /// Sorting order in the theme picker (lower = first)
    #[serde(default)]
    pub order: i32,

    /// Theme capabilities: design modes, auto, accent, glass, custom settings
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<ThemeCapabilities>,

    /// Widget templates provided by the theme.
    /// Each entry maps a widget type to one or more template variants.
    /// When present, these completely replace the default React widget rendering.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub widget_templates: Vec<WidgetTemplate>,
}

fn default_theme_source() -> String { "inline".to_string() }

/// A theme that has been installed in the system (DB row).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledTheme {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub developer: String,
    #[serde(default)]
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview_image: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_theme: Option<String>,
    /// "inline" or "file"
    #[serde(default)]
    pub source: String,
    pub system: bool,
    pub enabled: bool,
    pub installed_at: String,
    /// JSON: list of CSS files
    #[serde(default)]
    pub css_files_json: Option<String>,
    /// JSON: list of JS files
    #[serde(default)]
    pub js_files_json: Option<String>,
    /// JSON: key-value html templates
    #[serde(default)]
    pub html_templates_json: Option<String>,
    /// JSON serialized ThemeFont[]
    #[serde(default)]
    pub fonts_json: Option<String>,
    /// JSON serialized ThemeIconConfig
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_font_json: Option<String>,
    /// JSON serialized ThemeCapabilities
    #[serde(default)]
    pub capabilities_json: Option<String>,
    /// JSON serialized WidgetTemplate[]
    #[serde(default)]
    pub widget_templates_json: Option<String>,
}

/// Per-user theme selection stored in the profile.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserThemeSelection {
    /// The selected theme ID (or "auto" for auto-switching)
    pub theme_id: String,
    /// Whether to auto-switch between day/night themes
    #[serde(default)]
    pub auto_theme: bool,
    /// Custom CSS variable overrides for this user
    #[serde(default)]
    pub overrides: HashMap<String, String>,
}

/// Response for listing available themes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeListResponse {
    pub builtin: Vec<ThemeDefinition>,
    pub installed: Vec<InstalledTheme>,
}

/// Response for theme application data.
/// The frontend uses this to load all theme resources.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeCssResponse {
    pub theme_id: String,
    /// "inline" or "file"
    pub source: String,
    /// CSS variables as key-value pairs
    pub css_variables: HashMap<String, String>,
    /// For inline themes: raw CSS rules
    pub additional_css: Option<String>,
    /// For file-based themes: URLs to load
    /// E.g. ["/api/themes/assets/steampunk/variables.css", ...]
    pub css_urls: Vec<String>,
    /// JS file URLs to load
    /// E.g. ["/api/themes/assets/steampunk/js/theme.js"]
    pub js_urls: Vec<String>,
    /// Base URL for all theme assets
    pub assets_base_url: Option<String>,
    /// Font definitions
    pub fonts: Vec<ThemeFont>,
    /// Icon font configuration
    pub icon_font: Option<ThemeIconConfig>,
    /// HTML templates with resolved URLs
    pub html_templates: HashMap<String, String>,
    /// Theme capabilities (design modes, auto, accent, glass, settings)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<ThemeCapabilities>,

    /// Widget template definitions with resolved asset URLs
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub widget_templates: Vec<WidgetTemplate>,
}

// ════════════════════════════════════════════════════════════════
// Theme Capabilities – Design Modes, Auto, Accent, Glass, Settings
// ════════════════════════════════════════════════════════════════

/// A custom design mode provided by a theme.
/// Themes can add modes beyond the built-in day/night/evening/sleep.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeDesignMode {
    /// Unique mode ID (e.g. "aurora", "sunset")
    pub id: String,
    /// Display name in the mode picker
    pub name: String,
    /// Phosphor icon name
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    /// When auto-switching: start time (HH:MM, 24h)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_start: Option<String>,
    /// When auto-switching: end time (HH:MM, 24h)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_end: Option<String>,
    /// CSS variable overrides specific to this mode
    #[serde(default)]
    pub css_variables: HashMap<String, String>,
}

/// Time range for auto-switching
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeRange {
    pub start: String,  // "06:00"
    pub end: String,    // "18:00"
}

/// Theme's auto-switching behavior (overrides built-in time-based logic)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeAutoBehavior {
    /// "time" (default), "sun", "custom", "disabled"
    #[serde(default = "default_auto_mode")]
    pub mode: String,
    /// Custom time ranges: mode_id → TimeRange
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub time_ranges: HashMap<String, TimeRange>,
    /// Default mode when no time range matches
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_mode: Option<String>,
}

fn default_auto_mode() -> String { "time".to_string() }

/// Accent color preset offered by a theme
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccentPreset {
    pub name: String,
    /// OKLCH color value (e.g. "oklch(0.55 0.22 210)")
    pub color: String,
}

/// How the theme controls the accent color
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeAccentControl {
    /// "user" (user picks), "force" (theme locks), "presets" (theme offers choices)
    #[serde(default = "default_accent_mode")]
    pub mode: String,
    /// For mode="force": the locked accent color
    #[serde(skip_serializing_if = "Option::is_none")]
    pub forced_color: Option<String>,
    /// For mode="presets": available accent options
    #[serde(skip_serializing_if = "Option::is_none")]
    pub presets: Option<Vec<AccentPreset>>,
}

fn default_accent_mode() -> String { "user".to_string() }

/// How the theme controls glass effects
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeGlassControl {
    /// "user" (default), "force_on", "force_off", "force_values"
    #[serde(default = "default_glass_mode")]
    pub mode: String,
    /// For mode="force_values": forced blur value (e.g. "40px")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blur: Option<String>,
    /// For mode="force_values": forced opacity value
    #[serde(skip_serializing_if = "Option::is_none")]
    pub opacity: Option<String>,
}

fn default_glass_mode() -> String { "user".to_string() }

/// Option for a select-type custom setting
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeSettingOption {
    pub label: String,
    /// Optional i18n key inside the theme namespace (served from theme assets).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label_key: Option<String>,
    pub value: String,
}

/// A custom setting field defined by the theme.
/// Rendered in the Appearance tab below the theme switcher.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeSetting {
    /// Unique setting key (e.g. "animation_speed")
    pub id: String,
    /// Display label
    pub name: String,
    /// Optional i18n key inside the theme namespace (served from theme assets).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name_key: Option<String>,
    /// Help text / description
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Optional i18n key inside the theme namespace (served from theme assets).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description_key: Option<String>,
    /// Input type: "toggle", "select", "slider", "color", "text"
    pub setting_type: String,
    /// Default value (JSON: bool, string, number)
    pub default_value: serde_json::Value,
    /// Options for "select" type
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<ThemeSettingOption>>,
    /// Min value for "slider" type
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,
    /// Max value for "slider" type
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,
    /// Step for "slider" type
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step: Option<f64>,
    /// If set, auto-binds to this CSS variable on :root
    #[serde(skip_serializing_if = "Option::is_none")]
    pub css_variable: Option<String>,
}

/// Complete theme capabilities – what a theme can control beyond colors.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ThemeCapabilities {
    /// Custom design modes added by the theme
    #[serde(skip_serializing_if = "Option::is_none")]
    pub design_modes: Option<Vec<ThemeDesignMode>>,
    /// Auto-switching override
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_behavior: Option<ThemeAutoBehavior>,
    /// Accent color control
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accent_control: Option<ThemeAccentControl>,
    /// Glass effect control
    #[serde(skip_serializing_if = "Option::is_none")]
    pub glass_control: Option<ThemeGlassControl>,
    /// Custom settings fields
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_settings: Option<Vec<ThemeSetting>>,
}

/// Global default theme configuration.
/// Stored in `system_preferences` as JSON.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DefaultThemeConfig {
    /// The theme ID to use as default for all users without explicit selection.
    /// If "auto", the built-in auto-switching logic applies.
    pub theme_id: String,
    /// Whether users are allowed to override the default theme.
    #[serde(default = "default_true")]
    pub allow_user_override: bool,
    /// If true, new users without a profile default to this theme.
    #[serde(default = "default_true")]
    pub apply_to_new_users: bool,
}

fn default_true() -> bool { true }

impl Default for DefaultThemeConfig {
    fn default() -> Self {
        Self {
            theme_id: "auto".to_string(),
            allow_user_override: true,
            apply_to_new_users: true,
        }
    }
}
