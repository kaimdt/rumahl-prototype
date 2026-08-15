//! Theme handler – complete file-based theme engine.
//!
//! Themes are ZIP packages containing CSS files, JS, images, fonts, icons, HTML.
//! They are extracted to `<data_dir>/themes/{theme_id>/` and served
//! statically via `/api/themes/assets/{theme_id>/{path>`.
//!
//! API:
//!   GET    /api/themes                               – list themes
//!   POST   /api/themes/install                       – install ZIP (base64 JSON)
//!   POST   /api/themes/install-from-manifest          – install inline theme
//!   DELETE /api/themes/:theme_id                     – uninstall theme
//!   GET    /api/themes/user/:profile_id               – get user selection
//!   POST   /api/themes/user/:profile_id               – set user selection
//!   GET    /api/themes/css/:profile_id                – compiled theme data
//!   GET    /api/themes/assets/:theme_id/*path         – static theme files

use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path as FsPath, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use tracing::{info, warn};
use uuid::Uuid;
use zip::ZipArchive;

use crate::db::DbPool;
use crate::AppState;

// ─── Constants ──────────────────────────────────────────────────────

/// Base directory for extracted theme files.
// ─── ThemeState (inner state type) ──────────────────────────────────

#[derive(Clone)]
pub struct ThemeState {
    pub db_pool: DbPool,
    pub theme_cache: Arc<RwLock<HashMap<String, (InstalledThemeRow, Instant)>>>,
    pub themes_dir: PathBuf,
}

impl ThemeState {
    pub fn new(db_pool: DbPool, data_dir: &FsPath) -> Self {
        let requested = if data_dir.file_name().and_then(|v| v.to_str()) == Some("themes") {
            data_dir.to_path_buf()
        } else {
            data_dir.join("themes")
        };
        let themes_dir = pick_writable_theme_dir(requested);
        Self {
            db_pool,
            theme_cache: Arc::new(RwLock::new(HashMap::new())),
            themes_dir,
        }
    }

    pub async fn refresh_cache(&self) -> anyhow::Result<()> {
        let rows = sqlx::query("SELECT * FROM installed_themes WHERE enabled = TRUE")
            .fetch_all(&self.db_pool)
            .await?;
        let mut cache = self.theme_cache.write().await;
        cache.clear();
        for row in &rows {
            let t = map_theme_row(row);
            cache.insert(t.id.clone(), (t, Instant::now()));
        }
        info!("Theme cache refreshed: {} themes", cache.len());
        Ok(())
    }
}

fn pick_writable_theme_dir(requested: PathBuf) -> PathBuf {
    let mut candidates = vec![requested];
    if cfg!(target_os = "linux") {
        candidates.push(PathBuf::from("/var/lib/iora/iora-home/themes"));
    }
    if !cfg!(target_os = "linux") {
        if let Ok(cwd) = std::env::current_dir() {
            candidates.push(cwd.join("data").join("themes"));
        }
        candidates.push(std::env::temp_dir().join("iora-home").join("themes"));
    }

    for dir in candidates {
        match ensure_writable_dir(&dir) {
            Ok(()) => return dir,
            Err(e) => warn!("Theme directory {} is not writable: {}", dir.display(), e),
        }
    }

    if cfg!(target_os = "linux") {
        PathBuf::from("/var/lib/iora/iora-home/themes")
    } else {
        std::env::temp_dir().join("iora-home").join("themes")
    }
}

fn ensure_writable_dir(dir: &FsPath) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let probe = dir.join(".write-test");
    std::fs::write(&probe, b"ok")?;
    let _ = std::fs::remove_file(probe);
    Ok(())
}

// The handler functions below use State<AppState> and access theme_manager via app_state.theme_manager

// ─── DB Row types ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledThemeRow {
    pub id: String,
    pub name: String,
    pub version: String,
    pub developer: String,
    pub description: String,
    pub icon: Option<String>,
    pub preview_image: Option<String>,
    pub parent_theme: Option<String>,
    pub source: String,
    pub css_variables: String,
    pub additional_css: Option<String>,
    pub css_files_json: Option<String>,
    pub js_files_json: Option<String>,
    pub html_templates_json: Option<String>,
    pub fonts_json: Option<String>,
    pub icon_font_json: Option<String>,
    pub capabilities_json: Option<String>,
    pub widget_templates_json: Option<String>,
    pub system: bool,
    pub enabled: bool,
    pub installed_at: String,
    pub source_app_id: Option<String>,
    pub updated_at: String,
}

fn map_theme_row(row: &sqlx::postgres::PgRow) -> InstalledThemeRow {
    let installed_at: chrono::DateTime<chrono::Utc> = row.get("installed_at");
    let updated_at: chrono::DateTime<chrono::Utc> = row.get("updated_at");
    InstalledThemeRow {
        id: row.get("id"),
        name: row.get("name"),
        version: row.get("version"),
        developer: row.get("developer"),
        description: row.get("description"),
        icon: row.get("icon"),
        preview_image: row.get("preview_image"),
        parent_theme: row.get("parent_theme"),
        source: row.get::<String, _>("source"),
        css_variables: row.get("css_variables"),
        additional_css: row.get("additional_css"),
        css_files_json: row.get("css_files_json"),
        js_files_json: row.get("js_files_json"),
        html_templates_json: row.get("html_templates_json"),
        fonts_json: row.get("fonts_json"),
        icon_font_json: row.get("icon_font_json"),
        capabilities_json: row.get("capabilities_json"),
        widget_templates_json: row.get("widget_templates_json"),
        system: row.get("system"),
        enabled: row.get("enabled"),
        installed_at: installed_at.to_rfc3339(),
        source_app_id: row.get("source_app_id"),
        updated_at: updated_at.to_rfc3339(),
    }
}

fn normalize_zip_path(name: &str) -> String {
    name.replace('\\', "/").trim_start_matches('/').to_string()
}

fn strip_zip_prefix(name: &str, prefix: &str) -> String {
    let normalized = normalize_zip_path(name);
    if prefix.is_empty() {
        return normalized;
    }
    if let Some(value) = normalized.strip_prefix(prefix) {
        value.trim_start_matches('/').to_string()
    } else {
        normalized
    }
}

// ─── Full implementations on ThemeState ─────────────────────────────

impl ThemeState {
    /// Install a theme from ZIP data.
    pub fn extract_zip(
        &self,
        zip_data: &[u8],
    ) -> anyhow::Result<iora_shared::theme::ThemeDefinition> {
        use std::io::Cursor;

        // Anti-zip-bomb hard limits.
        const MAX_TOTAL_UNCOMPRESSED: u64 = 50 * 1024 * 1024; // 50 MiB total
        const MAX_SINGLE_FILE: u64 = 20 * 1024 * 1024; // 20 MiB per entry
        const MAX_ENTRIES: usize = 2_000;

        let mut archive = ZipArchive::new(Cursor::new(zip_data))
            .map_err(|e| anyhow::anyhow!("Invalid ZIP: {}", e))?;

        if archive.len() > MAX_ENTRIES {
            anyhow::bail!(
                "ZIP contains too many entries ({} > {})",
                archive.len(),
                MAX_ENTRIES
            );
        }

        // Pre-flight: sum declared uncompressed sizes and reject obvious bombs.
        let mut declared_total: u64 = 0;
        for i in 0..archive.len() {
            let entry = archive.by_index(i)?;
            let sz = entry.size();
            if sz > MAX_SINGLE_FILE {
                anyhow::bail!(
                    "ZIP entry '{}' exceeds per-file limit ({} > {})",
                    entry.name(),
                    sz,
                    MAX_SINGLE_FILE
                );
            }
            declared_total = declared_total.saturating_add(sz);
            if declared_total > MAX_TOTAL_UNCOMPRESSED {
                anyhow::bail!(
                    "ZIP uncompressed size exceeds limit ({} > {})",
                    declared_total,
                    MAX_TOTAL_UNCOMPRESSED
                );
            }
        }

        let mut manifest_bytes = Vec::new();
        let mut manifest_prefix = String::new();
        let mut found = false;
        for i in 0..archive.len() {
            let mut file = archive.by_index(i)?;
            let name = normalize_zip_path(file.name());
            // Skip directories, but NOT manifest.json itself
            if name.ends_with('/') {
                continue;
            }
            // Check if this is manifest.json (at root or in a subfolder)
            if name == "manifest.json" || name.ends_with("/manifest.json") {
                file.read_to_end(&mut manifest_bytes)?;
                manifest_prefix = name
                    .trim_end_matches("manifest.json")
                    .trim_end_matches('/')
                    .to_string();
                found = true;
                break;
            }
        }
        if !found || manifest_bytes.is_empty() {
            anyhow::bail!("ZIP must contain a manifest.json at the root");
        }

        let manifest_json: serde_json::Value = serde_json::from_slice(&manifest_bytes)
            .map_err(|e| anyhow::anyhow!("Invalid manifest.json: {}", e))?;
        let mut merged_manifest = manifest_json.clone();
        if let (Some(root), Some(theme)) = (
            merged_manifest.as_object_mut(),
            manifest_json.get("theme").and_then(|v| v.as_object()),
        ) {
            for (key, value) in theme {
                root.insert(key.clone(), value.clone());
            }
        }
        let mut def: iora_shared::theme::ThemeDefinition = serde_json::from_value(merged_manifest)
            .map_err(|e| anyhow::anyhow!("Invalid manifest.json: {}", e))?;
        def.source = "file".to_string();

        // Extract
        let theme_dir = self.themes_dir.join(&def.id);
        if theme_dir.exists() {
            std::fs::remove_dir_all(&theme_dir).map_err(|e| {
                anyhow::anyhow!(
                    "cannot replace existing theme dir {}: {}",
                    theme_dir.display(),
                    e
                )
            })?;
        }
        std::fs::create_dir_all(&theme_dir).map_err(|e| {
            anyhow::anyhow!("cannot create theme dir {}: {}", theme_dir.display(), e)
        })?;

        for i in 0..archive.len() {
            let mut file = archive.by_index(i)?;
            let name = normalize_zip_path(file.name());
            if name == "manifest.json" || name.ends_with('/') {
                continue;
            }
            let relative_name = strip_zip_prefix(&name, &manifest_prefix);
            if relative_name.is_empty() || relative_name == "manifest.json" {
                continue;
            }
            let relative_path = FsPath::new(&relative_name);
            if relative_name.contains(':')
                || relative_path.components().any(|c| {
                    matches!(
                        c,
                        std::path::Component::ParentDir | std::path::Component::RootDir
                    )
                })
            {
                anyhow::bail!("Unsafe ZIP path: {}", name);
            }
            if let Some(parent) = relative_path.parent() {
                if !parent.as_os_str().is_empty() {
                    let parent_dir = theme_dir.join(parent);
                    std::fs::create_dir_all(&parent_dir).map_err(|e| {
                        anyhow::anyhow!(
                            "cannot create theme asset dir {}: {}",
                            parent_dir.display(),
                            e
                        )
                    })?;
                }
            }
            let target = theme_dir.join(relative_path);
            let mut buf = Vec::new();
            file.read_to_end(&mut buf)?;
            std::fs::write(&target, &buf).map_err(|e| {
                anyhow::anyhow!("cannot write theme asset {}: {}", target.display(), e)
            })?;
        }

        // Preview
        if def.preview_image.is_none() {
            for c in &[
                "preview.png",
                "images/preview.png",
                "preview.jpg",
                "screenshot.png",
            ] {
                if theme_dir.join(c).exists() {
                    def.preview_image = Some(format!("file:{}", c));
                    break;
                }
            }
        }

        Ok(def)
    }

    /// Store extracted theme in the database (async)
    pub async fn store_theme(
        &self,
        def: iora_shared::theme::ThemeDefinition,
    ) -> anyhow::Result<iora_shared::theme::ThemeDefinition> {
        // DB insert
        let now = chrono::Utc::now();
        let css_vars_json = serde_json::to_string(&def.css_variables)?;
        let css_files_json = serde_json::to_string(&def.css_files)?;
        let js_files_json = serde_json::to_string(&def.js_files)?;
        let html_templates_json = serde_json::to_string(&def.html_templates)?;
        let fonts_json = serde_json::to_string(&def.fonts)?;
        let icon_font_json = def
            .icon_font
            .as_ref()
            .map(|f| serde_json::to_string(f).unwrap_or_default());
        let capabilities_json = def
            .capabilities
            .as_ref()
            .map(|c| serde_json::to_string(c).unwrap_or_default());
        let widget_templates_json = if !def.widget_templates.is_empty() {
            Some(serde_json::to_string(&def.widget_templates)?)
        } else {
            None
        };

        sqlx::query(
            "INSERT INTO installed_themes \
             (id,name,version,developer,description,icon,preview_image,parent_theme,\
             source,css_variables,additional_css,css_files_json,js_files_json,\
             html_templates_json,fonts_json,icon_font_json,capabilities_json,\
             widget_templates_json,system,enabled,installed_at,source_app_id,updated_at) \
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) \
             ON CONFLICT(id) DO UPDATE SET \
             name=$2,version=$3,developer=$4,description=$5,icon=$6,preview_image=$7,\
             parent_theme=$8,source=$9,css_variables=$10,additional_css=$11,\
             css_files_json=$12,js_files_json=$13,html_templates_json=$14,\
             fonts_json=$15,icon_font_json=$16,capabilities_json=$17,widget_templates_json=$18,updated_at=$23"
        )
        .bind(&def.id).bind(&def.name).bind(&def.version)
        .bind(&def.developer).bind(&def.description)
        .bind(&def.icon).bind(&def.preview_image).bind(&def.parent_theme)
        .bind(&def.source).bind(&css_vars_json).bind(&def.additional_css)
        .bind(&css_files_json).bind(&js_files_json).bind(&html_templates_json)
        .bind(&fonts_json).bind(&icon_font_json).bind(&capabilities_json)
        .bind(&widget_templates_json)
        .bind(def.system).bind(true).bind(now).bind(Option::<&str>::None).bind(now)
        .execute(&self.db_pool).await?;

        self.refresh_cache().await?;
        Ok(def)
    }

    /// Install an inline theme from manifest data (no ZIP).
    pub async fn install_inline(
        &self,
        mut def: iora_shared::theme::ThemeDefinition,
    ) -> anyhow::Result<()> {
        def.source = "inline".to_string();
        let now = chrono::Utc::now();
        let css_vars_json = serde_json::to_string(&def.css_variables)?;
        let css_files_json = serde_json::to_string(&def.css_files)?;
        let js_files_json = serde_json::to_string(&def.js_files)?;
        let html_templates_json = serde_json::to_string(&def.html_templates)?;
        let fonts_json = serde_json::to_string(&def.fonts)?;
        let icon_font_json = def
            .icon_font
            .as_ref()
            .map(|f| serde_json::to_string(f).unwrap_or_default());
        let capabilities_json = def
            .capabilities
            .as_ref()
            .map(|c| serde_json::to_string(c).unwrap_or_default());
        let widget_templates_json = if !def.widget_templates.is_empty() {
            Some(serde_json::to_string(&def.widget_templates)?)
        } else {
            None
        };

        sqlx::query(
            "INSERT INTO installed_themes \
             (id,name,version,developer,description,icon,preview_image,parent_theme,\
             source,css_variables,additional_css,css_files_json,js_files_json,\
             html_templates_json,fonts_json,icon_font_json,capabilities_json,\
             widget_templates_json,system,enabled,installed_at,source_app_id,updated_at) \
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) \
             ON CONFLICT(id) DO UPDATE SET \
             name=$2,version=$3,developer=$4,description=$5,icon=$6,preview_image=$7,\
             parent_theme=$8,source=$9,css_variables=$10,additional_css=$11,\
             css_files_json=$12,js_files_json=$13,html_templates_json=$14,\
             fonts_json=$15,icon_font_json=$16,capabilities_json=$17,widget_templates_json=$18,updated_at=$23"
        )
        .bind(&def.id).bind(&def.name).bind(&def.version)
        .bind(&def.developer).bind(&def.description)
        .bind(&def.icon).bind(&def.preview_image).bind(&def.parent_theme)
        .bind(&def.source).bind(&css_vars_json).bind(&def.additional_css)
        .bind(&css_files_json).bind(&js_files_json).bind(&html_templates_json)
        .bind(&fonts_json).bind(&icon_font_json).bind(&capabilities_json)
        .bind(&widget_templates_json)
        .bind(def.system).bind(true).bind(now).bind(Option::<&str>::None).bind(now)
        .execute(&self.db_pool).await?;

        self.refresh_cache().await?;
        Ok(())
    }

    /// Uninstall a theme.
    pub async fn uninstall(&self, theme_id: &str) -> anyhow::Result<()> {
        let row = sqlx::query("SELECT system FROM installed_themes WHERE id = $1")
            .bind(theme_id)
            .fetch_optional(&self.db_pool)
            .await?;
        match row {
            Some(r) => {
                if r.get::<bool, _>("system") {
                    anyhow::bail!("Cannot uninstall system theme '{}'", theme_id);
                }
                sqlx::query("DELETE FROM installed_themes WHERE id = $1")
                    .bind(theme_id)
                    .execute(&self.db_pool)
                    .await?;
                sqlx::query(
                    "UPDATE user_theme_selections SET theme_id = 'auto' WHERE theme_id = $1",
                )
                .bind(theme_id)
                .execute(&self.db_pool)
                .await?;
                let d = self.themes_dir.join(theme_id);
                if d.exists() {
                    tokio::fs::remove_dir_all(&d).await.ok();
                }
                self.refresh_cache().await?;
                Ok(())
            }
            None => anyhow::bail!("Theme '{}' not found", theme_id),
        }
    }

    /// Set user theme selection.
    pub async fn set_user_theme(
        &self,
        user_id: &str,
        profile_id: &str,
        sel: iora_shared::theme::UserThemeSelection,
    ) -> anyhow::Result<()> {
        let now = chrono::Utc::now();
        let overrides_json = serde_json::to_string(&sel.overrides)?;
        let id = format!("theme_sel_{}", Uuid::new_v4());
        sqlx::query(
            "INSERT INTO user_theme_selections(id,user_id,profile_id,theme_id,auto_theme,overrides,created_at,updated_at) \
             VALUES($1,$2,$3,$4,$5,$6,$7,$8) \
             ON CONFLICT(profile_id) DO UPDATE SET theme_id=$4,auto_theme=$5,overrides=$6,updated_at=$8"
        ).bind(&id).bind(user_id).bind(profile_id)
        .bind(&sel.theme_id).bind(sel.auto_theme)
        .bind(&overrides_json).bind(now).bind(now)
        .execute(&self.db_pool).await?;
        Ok(())
    }

    /// Get user theme selection.
    pub async fn get_user_theme(
        &self,
        profile_id: &str,
    ) -> anyhow::Result<Option<iora_shared::theme::UserThemeSelection>> {
        let row = sqlx::query(
            "SELECT theme_id,auto_theme,overrides FROM user_theme_selections WHERE profile_id=$1",
        )
        .bind(profile_id)
        .fetch_optional(&self.db_pool)
        .await?;
        Ok(row.map(|r| iora_shared::theme::UserThemeSelection {
            theme_id: r.get("theme_id"),
            auto_theme: r.get("auto_theme"),
            overrides: serde_json::from_str(&r.get::<String, _>("overrides")).unwrap_or_default(),
        }))
    }

    /// Build full theme CSS response for a user.
    pub async fn get_theme_css1(
        &self,
        profile_id: &str,
    ) -> anyhow::Result<iora_shared::theme::ThemeCssResponse> {
        let selection = self.get_user_theme(profile_id).await?;
        let theme_id = selection
            .as_ref()
            .map(|s| s.theme_id.as_str())
            .unwrap_or("auto");

        if theme_id == "auto" || theme_id == "default" {
            return Ok(iora_shared::theme::ThemeCssResponse {
                theme_id: "auto".into(),
                source: "inline".into(),
                css_variables: HashMap::new(),
                additional_css: None,
                css_urls: vec![],
                js_urls: vec![],
                assets_base_url: None,
                fonts: vec![],
                icon_font: None,
                html_templates: HashMap::new(),
                capabilities: None,
                widget_templates: vec![],
                animation: None, // auto theme has no animation
            });
        }

        let cache = self.theme_cache.read().await;
        if let Some((row, cached_at)) = cache.get(theme_id) {
            if cached_at.elapsed() > Duration::from_secs(60) {
                tracing::debug!(
                    "Theme cache entry for {} is stale ({}s old)",
                    theme_id,
                    cached_at.elapsed().as_secs()
                );
            }
            let mut vars: HashMap<String, String> = serde_json::from_str(&row.css_variables)
                .unwrap_or_else(|e| {
                    tracing::warn!("Failed to parse css_variables for theme {}: {}", row.id, e);
                    HashMap::new()
                });
            if let Some(ref sel) = selection {
                vars.extend(sel.overrides.clone());
            }

            // ─── Parent Theme Inheritance ──────────────────────────────
            // If this theme has a parent, merge parent's data first
            if let Some(ref parent_id) = row.parent_theme {
                if !parent_id.is_empty() && parent_id != "auto" && parent_id != "default" {
                    if let Some((parent_row, _)) = cache.get(parent_id) {
                        // Merge parent CSS variables (child wins)
                        let parent_vars: HashMap<String, String> =
                            serde_json::from_str(&parent_row.css_variables).unwrap_or_else(|e| {
                                tracing::warn!(
                                "Failed to parse parent css_variables for theme {} (parent={}): {}",
                                row.id,
                                parent_id,
                                e
                            );
                                HashMap::new()
                            });
                        for (k, v) in parent_vars {
                            vars.entry(k).or_insert(v);
                        }
                    }
                }
            }
            // ─── End parent inheritance ───────────────────────────────

            let fonts: Vec<iora_shared::theme::ThemeFont> = row
                .fonts_json
                .as_ref()
                .and_then(|j| match serde_json::from_str(j) {
                    Ok(v) => Some(v),
                    Err(e) => {
                        tracing::warn!("Failed to parse fonts for theme {}: {}", row.id, e);
                        None
                    }
                })
                .unwrap_or_default();

            // Merge parent fonts (child fonts with same name override parent)
            let mut merged_fonts = fonts.clone();
            if let Some(ref parent_id) = row.parent_theme {
                if !parent_id.is_empty() && parent_id != "auto" && parent_id != "default" {
                    if let Some((parent_row, _)) = cache.get(parent_id) {
                        let parent_fonts: Vec<iora_shared::theme::ThemeFont> = parent_row
                            .fonts_json
                            .as_ref()
                            .and_then(|j| match serde_json::from_str(j) {
                                Ok(v) => Some(v),
                                Err(e) => {
                                    tracing::warn!(
                                        "Failed to parse parent fonts for theme {} (parent={}): {}",
                                        row.id,
                                        parent_id,
                                        e
                                    );
                                    None
                                }
                            })
                            .unwrap_or_default();
                        for pf in parent_fonts {
                            if !merged_fonts.iter().any(|f| f.name == pf.name) {
                                merged_fonts.push(pf);
                            }
                        }
                    }
                }
            }
            let fonts = merged_fonts;
            let icon_font: Option<iora_shared::theme::ThemeIconConfig> = row
                .icon_font_json
                .as_ref()
                .and_then(|j| match serde_json::from_str(j) {
                    Ok(v) => Some(v),
                    Err(e) => {
                        tracing::warn!("Failed to parse icon_font for theme {}: {}", row.id, e);
                        None
                    }
                });
            let css_files: Vec<String> = row
                .css_files_json
                .as_ref()
                .and_then(|j| match serde_json::from_str(j) {
                    Ok(v) => Some(v),
                    Err(e) => {
                        tracing::warn!("Failed to parse css_files for theme {}: {}", row.id, e);
                        None
                    }
                })
                .unwrap_or_default();
            let js_files: Vec<String> = row
                .js_files_json
                .as_ref()
                .and_then(|j| match serde_json::from_str(j) {
                    Ok(v) => Some(v),
                    Err(e) => {
                        tracing::warn!("Failed to parse js_files for theme {}: {}", row.id, e);
                        None
                    }
                })
                .unwrap_or_default();
            let html_templates: HashMap<String, String> = row
                .html_templates_json
                .as_ref()
                .and_then(|j| match serde_json::from_str(j) {
                    Ok(v) => Some(v),
                    Err(e) => {
                        tracing::warn!(
                            "Failed to parse html_templates for theme {}: {}",
                            row.id,
                            e
                        );
                        None
                    }
                })
                .unwrap_or_default();

            let assets_base = if row.source == "file" {
                Some(format!("/api/themes/assets/{}", theme_id))
            } else {
                None
            };

            let mut resolved_fonts = fonts.clone();
            for f in &mut resolved_fonts {
                if !f.url.starts_with("http") && !f.url.starts_with("data:") {
                    if let Some(ref base) = assets_base {
                        f.url = format!("{}/{}", base, f.url);
                    }
                }
            }

            // Resolve icon font paths
            let mut resolved_icon_font: Option<iora_shared::theme::ThemeIconConfig> = None;
            if let Some(mut ic) = icon_font {
                // Only prepend the asset base when a non-empty relative path was provided.
                // Without this guard, an empty `css_path` (common in sample manifests)
                // would resolve to the assets directory URL and the frontend would inject
                // a broken <link rel="stylesheet"> tag.
                if !ic.css_path.is_empty()
                    && !ic.css_path.starts_with("http")
                    && !ic.css_path.starts_with("data:")
                {
                    if let Some(ref base) = assets_base {
                        ic.css_path = format!("{}/{}", base, ic.css_path);
                    }
                }
                if let Some(ff) = ic.font_file.take() {
                    let ff: String = ff;
                    if ff.starts_with("http") || ff.starts_with("data:") {
                        ic.font_file = Some(ff);
                    } else if let Some(ref base) = assets_base {
                        ic.font_file = Some(format!("{}/{}", base, ff));
                    } else {
                        ic.font_file = Some(ff);
                    }
                }
                resolved_icon_font = Some(ic);
            }

            let mut css_urls: Vec<String> = Vec::new();
            for f in &css_files {
                if let Some(ref base) = assets_base {
                    css_urls.push(format!("{}/{}", base, f));
                } else {
                    css_urls.push(f.clone());
                }
            }
            let mut js_urls: Vec<String> = Vec::new();
            for f in &js_files {
                if let Some(ref base) = assets_base {
                    js_urls.push(format!("{}/{}", base, f));
                } else {
                    js_urls.push(f.clone());
                }
            }
            let html_resolved: HashMap<String, String> = html_templates
                .iter()
                .map(|(k, v)| {
                    let resolved = if let Some(ref base) = assets_base {
                        format!("{}/{}", base, v)
                    } else {
                        v.clone()
                    };
                    (k.clone(), resolved)
                })
                .collect();

            let capabilities: Option<iora_shared::theme::ThemeCapabilities> = row
                .capabilities_json
                .as_ref()
                .and_then(|j| match serde_json::from_str(j) {
                    Ok(v) => Some(v),
                    Err(e) => {
                        tracing::warn!("Failed to parse capabilities for theme {}: {}", row.id, e);
                        None
                    }
                });

            // Parse and resolve widget templates
            let mut widget_templates: Vec<iora_shared::theme::WidgetTemplate> = row
                .widget_templates_json
                .as_ref()
                .and_then(|j| match serde_json::from_str(j) {
                    Ok(v) => Some(v),
                    Err(e) => {
                        tracing::warn!(
                            "Failed to parse widget_templates for theme {}: {}",
                            row.id,
                            e
                        );
                        None
                    }
                })
                .unwrap_or_default();

            // Merge parent widget templates (child wins for same widget_type)
            if let Some(ref parent_id) = row.parent_theme {
                if !parent_id.is_empty() && parent_id != "auto" && parent_id != "default" {
                    if let Some((parent_row, _)) = cache.get(parent_id) {
                        let parent_wts: Vec<iora_shared::theme::WidgetTemplate> = parent_row.widget_templates_json.as_ref()
                            .and_then(|j| match serde_json::from_str(j) {
                                Ok(v) => Some(v),
                                Err(e) => {
                                    tracing::warn!("Failed to parse parent widget_templates for theme {} (parent={}): {}", row.id, parent_id, e);
                                    None
                                }
                            }).unwrap_or_default();
                        for pwt in parent_wts {
                            if !widget_templates
                                .iter()
                                .any(|w| w.widget_type == pwt.widget_type)
                            {
                                widget_templates.push(pwt);
                            }
                        }
                    }
                }
            }
            // Resolve asset paths in widget templates (same logic as css/js files)
            for wt in &mut widget_templates {
                for variant in &mut wt.variants {
                    if let Some(ref base) = assets_base {
                        variant.template = format!("{}/{}", base, variant.template);
                        if let Some(ref css) = variant.css {
                            variant.css = Some(format!("{}/{}", base, css));
                        }
                        if let Some(ref js) = variant.js {
                            variant.js = Some(format!("{}/{}", base, js));
                        }
                    }
                }
            }

            let animation = capabilities.as_ref().and_then(|c| c.animation.clone());

            return Ok(iora_shared::theme::ThemeCssResponse {
                theme_id: theme_id.to_string(),
                source: row.source.clone(),
                css_variables: vars,
                additional_css: row.additional_css.clone(),
                css_urls,
                js_urls,
                assets_base_url: assets_base,
                fonts: resolved_fonts,
                icon_font: resolved_icon_font,
                html_templates: html_resolved,
                animation,
                capabilities,
                widget_templates,
            });
        }

        Ok(iora_shared::theme::ThemeCssResponse {
            theme_id: theme_id.into(),
            source: "inline".into(),
            css_variables: HashMap::new(),
            additional_css: None,
            css_urls: vec![],
            js_urls: vec![],
            assets_base_url: None,
            fonts: vec![],
            icon_font: None,
            html_templates: HashMap::new(),
            capabilities: None,
            widget_templates: vec![],
            animation: None,
        })
    }

    /// Serve a static file from a theme directory.
    pub async fn serve_asset(
        &self,
        theme_id: &str,
        file_path: &str,
    ) -> Result<Response, (StatusCode, String)> {
        let clean = file_path
            .replace("\\", "/")
            .trim_start_matches('/')
            .to_string();
        if clean.contains("..") {
            return Err((StatusCode::BAD_REQUEST, "Invalid path".into()));
        }
        let file = self.themes_dir.join(theme_id).join(&clean);
        if !file.exists() || !file.starts_with(self.themes_dir.join(theme_id)) {
            return Err((StatusCode::NOT_FOUND, "File not found".into()));
        }
        let data = tokio::fs::read(&file)
            .await
            .map_err(|_| (StatusCode::NOT_FOUND, "File not found".into()))?;
        let mime = mime_type(&clean);
        let mut headers = HeaderMap::new();
        let mime_value = header::HeaderValue::from_str(mime)
            .unwrap_or_else(|_| header::HeaderValue::from_static("application/octet-stream"));
        headers.insert(header::CONTENT_TYPE, mime_value);
        headers.insert(
            header::CACHE_CONTROL,
            header::HeaderValue::from_static("public, max-age=3600"),
        );
        Ok((headers, data).into_response())
    }
}

// ─── Helper functions ───────────────────────────────────────────────

pub fn mime_type(path: &str) -> &'static str {
    if path.ends_with(".css") {
        "text/css"
    } else if path.ends_with(".js") {
        "application/javascript"
    } else if path.ends_with(".html") || path.ends_with(".htm") {
        "text/html"
    } else if path.ends_with(".svg") {
        "image/svg+xml"
    } else if path.ends_with(".png") {
        "image/png"
    } else if path.ends_with(".jpg") || path.ends_with(".jpeg") {
        "image/jpeg"
    } else if path.ends_with(".gif") {
        "image/gif"
    } else if path.ends_with(".webp") {
        "image/webp"
    } else if path.ends_with(".woff2") {
        "font/woff2"
    } else if path.ends_with(".woff") {
        "font/woff"
    } else if path.ends_with(".ttf") {
        "font/ttf"
    } else if path.ends_with(".otf") {
        "font/otf"
    } else if path.ends_with(".json") {
        "application/json"
    } else if path.ends_with(".xml") {
        "application/xml"
    } else {
        "application/octet-stream"
    }
}

fn builtin_themes() -> Vec<iora_shared::theme::ThemeDefinition> {
    macro_rules! t {
        ($id:expr, $name:expr, $desc:expr, $icon:expr, $order:expr) => {
            iora_shared::theme::ThemeDefinition {
                id: $id.into(),
                name: $name.into(),
                version: "1.0.0".into(),
                developer: "IORA".into(),
                description: $desc.into(),
                icon: Some($icon.into()),
                preview_image: None,
                parent_theme: None,
                source: "inline".into(),
                css_variables: HashMap::new(),
                css_files: vec![],
                js_files: vec![],
                html_templates: HashMap::new(),
                fonts: vec![],
                icon_font: None,
                additional_css: None,
                system: true,
                order: $order,
                capabilities: None,
                widget_templates: vec![],
            }
        };
    }
    vec![
        t!("light", "Hell", "Maximale Helligkeit", "Sun", 5),
        t!("day", "Tag", "Helles Tages-Design", "CloudSun", 10),
        t!(
            "day-classic",
            "Klassisch",
            "Dunkler Hintergrund",
            "Monitor",
            20
        ),
        t!("evening", "Abend", "Warme Töne", "SunDim", 30),
        t!("night", "Nacht", "Dunkles Design", "MoonStars", 40),
        t!("sleep", "Schlaf", "OLED Schwarz", "Moon", 50),
    ]
}

// ─── Request/Response types ─────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct SetUserThemeRequest {
    pub theme_id: String,
    #[serde(default)]
    pub auto_theme: bool,
    #[serde(default)]
    pub overrides: HashMap<String, String>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct ThemeZipInstallBody {
    pub zip_data: String,
    pub file_name: Option<String>,
}

// ─── API Handlers (use AppState, access .theme_manager) ─────────────

/// GET /api/themes
pub async fn list_themes(
    State(gs): State<AppState>,
) -> Result<Json<iora_shared::theme::ThemeListResponse>, (StatusCode, String)> {
    let state = &gs.theme_manager;
    let builtin = builtin_themes();
    let rows = sqlx::query("SELECT * FROM installed_themes ORDER BY system DESC, name ASC")
        .fetch_all(&state.db_pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB: {}", e)))?;
    let installed: Vec<iora_shared::theme::InstalledTheme> = rows
        .iter()
        .map(|r| {
            let r = map_theme_row(r);
            let preview = r.preview_image.as_ref().map(|p| {
                if p.starts_with("file:") {
                    format!(
                        "/api/themes/assets/{}/{}",
                        r.id,
                        p.trim_start_matches("file:")
                    )
                } else {
                    p.clone()
                }
            });
            iora_shared::theme::InstalledTheme {
                id: r.id,
                name: r.name,
                version: r.version,
                developer: r.developer,
                description: r.description,
                icon: r.icon,
                preview_image: preview,
                parent_theme: r.parent_theme,
                source: r.source,
                system: r.system,
                enabled: r.enabled,
                installed_at: r.installed_at,
                fonts_json: r.fonts_json,
                icon_font_json: r.icon_font_json,
                css_files_json: r.css_files_json,
                js_files_json: r.js_files_json,
                html_templates_json: r.html_templates_json,
                capabilities_json: r.capabilities_json,
                widget_templates_json: r.widget_templates_json,
                css_variables_json: Some(r.css_variables),
                additional_css: r.additional_css,
            }
        })
        .collect();
    Ok(Json(iora_shared::theme::ThemeListResponse {
        builtin,
        installed,
    }))
}

/// POST /api/themes/install-from-manifest
/// Accepts both flat ThemeDefinition and {"theme": {...}} wrapped format
pub async fn handle_install_theme_inline(
    State(gs): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    // If manifest has a "theme" wrapper, merge its fields into the top level.
    let mut merged = body.clone();
    if let Some(theme_obj) = body.get("theme").and_then(|v| v.as_object()) {
        if let Some(root) = merged.as_object_mut() {
            for (key, value) in theme_obj {
                if !root.contains_key(key) {
                    root.insert(key.clone(), value.clone());
                }
            }
        }
    }

    // Deserialize from the (possibly merged) flat format
    let def: iora_shared::theme::ThemeDefinition =
        serde_json::from_value(merged.clone()).map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                format!("Invalid theme manifest: {}", e),
            )
        })?;

    // Validate (use the merged JSON for validation)
    let validation = iora_shared::manifest_validator::validate_theme_manifest(&merged);
    if !validation.is_valid() {
        let errors: Vec<String> = validation
            .issues
            .iter()
            .filter(|i| i.severity == iora_shared::manifest_validator::ValidationSeverity::Error)
            .map(|i| format!("{}: {}", i.field, i.message))
            .collect();
        return Err((
            StatusCode::BAD_REQUEST,
            format!("Manifest enth\u{e4}lt Fehler:\n{}", errors.join("\n")),
        ));
    }

    gs.theme_manager
        .install_inline(def)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Install: {}", e)))?;
    Ok(Json(serde_json::json!({"status":"ok"})))
}

/// DELETE /api/themes/:theme_id
pub async fn uninstall_theme(
    State(gs): State<AppState>,
    Path(theme_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    gs.theme_manager.uninstall(&theme_id).await.map_err(|e| {
        let s = e.to_string();
        if s.contains("system theme") {
            (StatusCode::BAD_REQUEST, s)
        } else if s.contains("not found") {
            (StatusCode::NOT_FOUND, s)
        } else {
            (StatusCode::INTERNAL_SERVER_ERROR, s)
        }
    })?;
    Ok(Json(serde_json::json!({"status":"ok"})))
}

/// GET /api/themes/user/:profile_id
pub async fn get_user_theme(
    State(gs): State<AppState>,
    Path(profile_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let selection = gs
        .theme_manager
        .get_user_theme(&profile_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(serde_json::json!({"selection": selection})))
}

/// POST /api/themes/user/:profile_id
pub async fn set_user_theme(
    State(gs): State<AppState>,
    Path(profile_id): Path<String>,
    Json(req): Json<SetUserThemeRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    // Guard: profile_id must exist in configuration_profiles (FK constraint
    // user_theme_selections_profile_id_fkey). Return a clean 404 instead of
    // leaking the raw SQL error as a 500.
    let profile_exists: Option<(String,)> = sqlx::query_as(
        "SELECT id FROM configuration_profiles WHERE id = $1",
    )
    .bind(&profile_id)
    .fetch_optional(&gs.db_pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if profile_exists.is_none() {
        return Err((
            StatusCode::NOT_FOUND,
            format!("Unknown configuration profile: {}", profile_id),
        ));
    }

    let sel = iora_shared::theme::UserThemeSelection {
        theme_id: req.theme_id,
        auto_theme: req.auto_theme,
        overrides: req.overrides,
    };
    gs.theme_manager
        .set_user_theme(&profile_id, &profile_id, sel)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(serde_json::json!({"status":"ok"})))
}

/// GET /api/themes/css/:profile_id
pub async fn get_theme_css(
    State(gs): State<AppState>,
    Path(profile_id): Path<String>,
) -> Result<Json<iora_shared::theme::ThemeCssResponse>, (StatusCode, String)> {
    let css = gs
        .theme_manager
        .get_theme_css1(&profile_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(css))
}

// ─── Default Theme API ───────────────────────────────────────────────

/// GET /api/themes/default – Get the global default theme configuration.
pub async fn get_default_theme(
    State(gs): State<AppState>,
) -> Result<Json<iora_shared::theme::DefaultThemeConfig>, (StatusCode, String)> {
    let raw: Option<String> = sqlx::query_scalar(
        "SELECT preference_value FROM system_preferences WHERE preference_key = 'default_theme'",
    )
    .fetch_optional(&gs.db_pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let config: iora_shared::theme::DefaultThemeConfig = match raw {
        Some(val) => serde_json::from_str(&val).unwrap_or_default(),
        None => iora_shared::theme::DefaultThemeConfig::default(),
    };
    Ok(Json(config))
}

/// PUT /api/themes/default – Set the global default theme configuration.
pub async fn set_default_theme(
    State(gs): State<AppState>,
    Json(config): Json<iora_shared::theme::DefaultThemeConfig>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let json = serde_json::to_string(&config)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    sqlx::query(
        "INSERT INTO system_preferences (id, preference_key, preference_value, created_at, updated_at) \
         VALUES($1, $2, $3, NOW(), NOW()) \
         ON CONFLICT (preference_key) DO UPDATE SET \
         preference_value = $3, updated_at = NOW()"
    )
    .bind(format!("default_theme_{}", uuid::Uuid::new_v4()))
    .bind("default_theme")
    .bind(&json)
    .execute(&gs.db_pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(serde_json::json!({"status":"ok", "config": config})))
}

/// GET /api/themes/assets/:theme_id/*path
pub async fn serve_theme_asset(
    State(gs): State<AppState>,
    Path((theme_id, path)): Path<(String, String)>,
) -> Result<Response, (StatusCode, String)> {
    gs.theme_manager.serve_asset(&theme_id, &path).await
}

/// GET /api/themes/assets/:theme_id
/// Returns the entire theme directory packaged as a ZIP. Used by the admin
/// panel's "Export theme" button so users can back up or share installed
/// themes. Only file-based themes (those with an on-disk directory) have a
/// non-empty bundle; built-in themes return 404.
pub async fn export_theme_bundle(
    State(gs): State<AppState>,
    Path(theme_id): Path<String>,
) -> Result<Response, (StatusCode, String)> {
    let theme_dir = gs.theme_manager.themes_dir.join(&theme_id);
    if !theme_dir.exists() || !theme_dir.is_dir() {
        return Err((
            StatusCode::NOT_FOUND,
            format!("Theme '{}' has no exportable assets", theme_id),
        ));
    }

    // Build the ZIP in a blocking task because zip::ZipWriter is sync I/O.
    let dir_clone = theme_dir.clone();
    let buf = tokio::task::spawn_blocking(move || -> Result<Vec<u8>, String> {
        let mut out = std::io::Cursor::new(Vec::<u8>::new());
        {
            let mut zw = zip::ZipWriter::new(&mut out);
            let opts: zip::write::FileOptions = zip::write::FileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated);
            fn walk(
                base: &FsPath,
                dir: &FsPath,
                zw: &mut zip::ZipWriter<&mut std::io::Cursor<Vec<u8>>>,
                opts: &zip::write::FileOptions,
            ) -> Result<(), String> {
                for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
                    let entry = entry.map_err(|e| e.to_string())?;
                    let path = entry.path();
                    let rel = path.strip_prefix(base).map_err(|e| e.to_string())?;
                    let rel_str = rel.to_string_lossy().replace('\\', "/");
                    if path.is_dir() {
                        zw.add_directory(format!("{}/", rel_str), *opts)
                            .map_err(|e| e.to_string())?;
                        walk(base, &path, zw, opts)?;
                    } else {
                        zw.start_file(rel_str, *opts).map_err(|e| e.to_string())?;
                        let data = std::fs::read(&path).map_err(|e| e.to_string())?;
                        use std::io::Write;
                        zw.write_all(&data).map_err(|e| e.to_string())?;
                    }
                }
                Ok(())
            }
            walk(&dir_clone, &dir_clone, &mut zw, &opts)?;
            zw.finish().map_err(|e| e.to_string())?;
        }
        Ok(out.into_inner())
    })
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("zip task join error: {}", e),
        )
    })?
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("zip error: {}", e),
        )
    })?;

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        header::HeaderValue::from_static("application/zip"),
    );
    let disp = format!("attachment; filename=\"{}.zip\"", theme_id.replace('"', ""));
    if let Ok(v) = header::HeaderValue::from_str(&disp) {
        headers.insert(header::CONTENT_DISPOSITION, v);
    }
    Ok((headers, buf).into_response())
}

// ════════════════════════════════════════════════════════════════
// User Theme Custom Settings API
// ════════════════════════════════════════════════════════════════

/// GET /api/themes/user/:profile_id/settings/:theme_id
/// Returns custom settings for a user's active theme
pub async fn get_user_theme_settings(
    State(gs): State<AppState>,
    Path((profile_id, theme_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let rows = sqlx::query(
        "SELECT setting_key, setting_value FROM user_theme_settings 
         WHERE profile_id = $1 AND theme_id = $2",
    )
    .bind(&profile_id)
    .bind(&theme_id)
    .fetch_all(&gs.db_pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut settings = serde_json::Map::new();
    for row in &rows {
        let key: String = row.get("setting_key");
        let value: String = row.get("setting_value");
        // Try to parse as JSON, fall back to string
        let parsed = serde_json::from_str::<serde_json::Value>(&value)
            .unwrap_or(serde_json::Value::String(value));
        settings.insert(key, parsed);
    }

    Ok(Json(serde_json::json!({
        "theme_id": theme_id,
        "settings": settings
    })))
}

/// PUT /api/themes/user/:profile_id/settings/:theme_id
/// Saves custom settings for a user's theme
#[derive(Debug, Deserialize)]
pub struct UpdateThemeSettingsRequest {
    pub settings: HashMap<String, serde_json::Value>,
}

pub async fn update_user_theme_settings(
    State(gs): State<AppState>,
    Path((profile_id, theme_id)): Path<(String, String)>,
    Json(req): Json<UpdateThemeSettingsRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let now = chrono::Utc::now();

    // Batch all upserts in a single transaction. On SQLite this collapses N
    // independent fsyncs into one and gives ~5–10x speedup for large setting
    // payloads; on Postgres it removes N round-trips.
    let mut tx = gs.db_pool.begin().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("DB begin: {}", e),
        )
    })?;

    for (key, value) in &req.settings {
        let value_str = serde_json::to_string(value).map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                format!("Invalid value for {}: {}", key, e),
            )
        })?;

        sqlx::query(
            "INSERT INTO user_theme_settings (id, user_id, profile_id, theme_id, setting_key, setting_value, created_at, updated_at) 
             VALUES($1, $2, $3, $4, $5, $6, $7, $8) 
             ON CONFLICT (profile_id, theme_id, setting_key) DO UPDATE SET 
             setting_value = $6, updated_at = $8"
        )
        .bind(format!("uts_{}", uuid::Uuid::new_v4()))
        .bind(&profile_id).bind(&profile_id).bind(&theme_id)
        .bind(key).bind(&value_str).bind(now).bind(now)
        .execute(&mut *tx).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB: {}", e)))?;
    }

    tx.commit().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("DB commit: {}", e),
        )
    })?;

    Ok(Json(
        serde_json::json!({"status": "ok", "updated": req.settings.len()}),
    ))
}
