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
}

/// Request body for installing a theme from base64-encoded ZIP.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeZipInstallBody {
    /// Base64-encoded ZIP file data (optionally with data: URL prefix)
    pub zip_data: String,
    /// Optional filename for display
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
}
