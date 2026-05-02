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
use base64::Engine as _;
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path as FsPath, PathBuf};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{info, warn};
use uuid::Uuid;
use sqlx::Row;
use zip::ZipArchive;

use crate::AppState;
use crate::db::DbPool;

// ─── Constants ──────────────────────────────────────────────────────

/// Base directory for extracted theme files.
const THEMES_DIR: &str = "data/themes";

// ─── ThemeState (inner state type) ──────────────────────────────────

#[derive(Clone)]
pub struct ThemeState {
    pub db_pool: DbPool,
    pub theme_cache: Arc<RwLock<HashMap<String, InstalledThemeRow>>>,
    pub themes_dir: PathBuf,
}

impl ThemeState {
    pub fn new(db_pool: DbPool, data_dir: &FsPath) -> Self {
        let themes_dir = data_dir.join("themes");
        std::fs::create_dir_all(&themes_dir).ok();
        Self { db_pool, theme_cache: Arc::new(RwLock::new(HashMap::new())), themes_dir }
    }

    pub async fn refresh_cache(&self) -> anyhow::Result<()> {
        let rows = sqlx::query("SELECT * FROM installed_themes WHERE enabled = TRUE")
            .fetch_all(&self.db_pool).await?;
        let mut cache = self.theme_cache.write().await;
        cache.clear();
        for row in &rows { let t = map_theme_row(row); cache.insert(t.id.clone(), t); }
        info!("Theme cache refreshed: {} themes", cache.len());
        Ok(())
    }
}

// The handler functions below use State<AppState> and access theme_manager via app_state.theme_manager

// Helper to extract ThemeState reference from AppState
fn tm(state: &AppState) -> &ThemeState {
    &state.theme_manager
}

// ─── DB Row types ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledThemeRow {
    pub id: String, pub name: String, pub version: String,
    pub developer: String, pub description: String,
    pub icon: Option<String>, pub preview_image: Option<String>,
    pub parent_theme: Option<String>,
    pub source: String,
    pub css_variables: String,
    pub additional_css: Option<String>,
    pub css_files_json: Option<String>,
    pub js_files_json: Option<String>,
    pub html_templates_json: Option<String>,
    pub fonts_json: Option<String>,
    pub icon_font_json: Option<String>,
    pub system: bool, pub enabled: bool,
    pub installed_at: String, pub source_app_id: Option<String>,
    pub updated_at: String,
}

fn map_theme_row(row: &sqlx::postgres::PgRow) -> InstalledThemeRow {
    InstalledThemeRow {
        id: row.get("id"), name: row.get("name"),
        version: row.get("version"), developer: row.get("developer"),
        description: row.get("description"),
        icon: row.get("icon"), preview_image: row.get("preview_image"),
        parent_theme: row.get("parent_theme"),
        source: row.get::<String, _>("source"),
        css_variables: row.get("css_variables"),
        additional_css: row.get("additional_css"),
        css_files_json: row.get("css_files_json"),
        js_files_json: row.get("js_files_json"),
        html_templates_json: row.get("html_templates_json"),
        fonts_json: row.get("fonts_json"),
        icon_font_json: row.get("icon_font_json"),
        system: row.get("system"), enabled: row.get("enabled"),
        installed_at: row.get("installed_at"),
        source_app_id: row.get("source_app_id"),
        updated_at: row.get("updated_at"),
    }
}

// ─── Full implementations on ThemeState ─────────────────────────────

impl ThemeState {
    /// Install a theme from ZIP data.
    pub fn extract_zip(&self, zip_data: &[u8]) -> anyhow::Result<iora_shared::theme::ThemeDefinition> {
        use std::io::Cursor;
        let mut archive = ZipArchive::new(Cursor::new(zip_data))
            .map_err(|e| anyhow::anyhow!("Invalid ZIP: {}", e))?;

        let mut manifest_bytes = Vec::new();
        let mut found = false;
        for i in 0..archive.len() {
            let mut file = archive.by_index(i)?;
            let name = file.name().to_string();
            if name == "manifest.json" || name.ends_with('/') { continue; }
            // Also check if it's in a subfolder
            if name.ends_with("manifest.json") {
                file.read_to_end(&mut manifest_bytes)?;
                found = true;
                break;
            }
        }
        if !found || manifest_bytes.is_empty() {
            anyhow::bail!("ZIP must contain a manifest.json at the root");
        }

        let mut def: iora_shared::theme::ThemeDefinition = serde_json::from_slice(&manifest_bytes)
            .map_err(|e| anyhow::anyhow!("Invalid manifest.json: {}", e))?;
        def.source = "file".to_string();

        // Extract
        let theme_dir = self.themes_dir.join(&def.id);
        if theme_dir.exists() { std::fs::remove_dir_all(&theme_dir)?; }
        std::fs::create_dir_all(&theme_dir)?;

        for i in 0..archive.len() {
            let mut file = archive.by_index(i)?;
            let name = file.name().to_string();
            if name == "manifest.json" || name.ends_with('/') { continue; }
            if let Some(parent) = FsPath::new(&name).parent() {
                if !parent.as_os_str().is_empty() {
                    std::fs::create_dir_all(theme_dir.join(parent))?;
                }
            }
            let target = theme_dir.join(&name);
            let mut buf = Vec::new();
            file.read_to_end(&mut buf)?;
            std::fs::write(&target, &buf)?;
        }

        // Preview
        if def.preview_image.is_none() {
            for c in &["preview.png", "images/preview.png", "preview.jpg", "screenshot.png"] {
                if theme_dir.join(c).exists() {
                    def.preview_image = Some(format!("file:{}", c));
                    break;
                }
            }
        }

        Ok(def)
    }

    /// Store extracted theme in the database (async)
    pub async fn store_theme(&self, def: iora_shared::theme::ThemeDefinition) -> anyhow::Result<iora_shared::theme::ThemeDefinition> {
        // DB insert
        let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
        let css_vars_json = serde_json::to_string(&def.css_variables)?;
        let css_files_json = serde_json::to_string(&def.css_files)?;
        let js_files_json = serde_json::to_string(&def.js_files)?;
        let html_templates_json = serde_json::to_string(&def.html_templates)?;
        let fonts_json = serde_json::to_string(&def.fonts)?;
        let icon_font_json = def.icon_font.as_ref().map(|f| serde_json::to_string(f).unwrap_or_default());

        sqlx::query(
            "INSERT INTO installed_themes \
             (id,name,version,developer,description,icon,preview_image,parent_theme,\
             source,css_variables,additional_css,css_files_json,js_files_json,\
             html_templates_json,fonts_json,icon_font_json,system,enabled,installed_at,\
             source_app_id,updated_at) \
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) \
             ON CONFLICT(id) DO UPDATE SET \
             name=$2,version=$3,developer=$4,description=$5,icon=$6,preview_image=$7,\
             parent_theme=$8,source=$9,css_variables=$10,additional_css=$11,\
             css_files_json=$12,js_files_json=$13,html_templates_json=$14,\
             fonts_json=$15,icon_font_json=$16,updated_at=$21"
        )
        .bind(&def.id).bind(&def.name).bind(&def.version)
        .bind(&def.developer).bind(&def.description)
        .bind(&def.icon).bind(&def.preview_image).bind(&def.parent_theme)
        .bind(&def.source).bind(&css_vars_json).bind(&def.additional_css)
        .bind(&css_files_json).bind(&js_files_json).bind(&html_templates_json)
        .bind(&fonts_json).bind(&icon_font_json)
        .bind(false).bind(true).bind(&now).bind(Option::<&str>::None).bind(&now)
        .execute(&self.db_pool).await?;

        self.refresh_cache().await?;
        Ok(def)
    }

    /// Install an inline theme from manifest data (no ZIP).
    pub async fn install_inline(&self, mut def: iora_shared::theme::ThemeDefinition) -> anyhow::Result<()> {
        def.source = "inline".to_string();
        let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
        let css_vars_json = serde_json::to_string(&def.css_variables)?;
        let css_files_json = serde_json::to_string(&def.css_files)?;
        let js_files_json = serde_json::to_string(&def.js_files)?;
        let html_templates_json = serde_json::to_string(&def.html_templates)?;
        let fonts_json = serde_json::to_string(&def.fonts)?;
        let icon_font_json = def.icon_font.as_ref().map(|f| serde_json::to_string(f).unwrap_or_default());

        sqlx::query(
            "INSERT INTO installed_themes \
             (id,name,version,developer,description,icon,preview_image,parent_theme,\
             source,css_variables,additional_css,css_files_json,js_files_json,\
             html_templates_json,fonts_json,icon_font_json,system,enabled,installed_at,\
             source_app_id,updated_at) \
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) \
             ON CONFLICT(id) DO UPDATE SET \
             name=$2,version=$3,developer=$4,description=$5,icon=$6,preview_image=$7,\
             parent_theme=$8,source=$9,css_variables=$10,additional_css=$11,\
             css_files_json=$12,js_files_json=$13,html_templates_json=$14,\
             fonts_json=$15,icon_font_json=$16,updated_at=$21"
        )
        .bind(&def.id).bind(&def.name).bind(&def.version)
        .bind(&def.developer).bind(&def.description)
        .bind(&def.icon).bind(&def.preview_image).bind(&def.parent_theme)
        .bind(&def.source).bind(&css_vars_json).bind(&def.additional_css)
        .bind(&css_files_json).bind(&js_files_json).bind(&html_templates_json)
        .bind(&fonts_json).bind(&icon_font_json)
        .bind(false).bind(true).bind(&now).bind(Option::<&str>::None).bind(&now)
        .execute(&self.db_pool).await?;

        self.refresh_cache().await?;
        Ok(())
    }

    /// Uninstall a theme.
    pub async fn uninstall(&self, theme_id: &str) -> anyhow::Result<()> {
        let row = sqlx::query("SELECT system FROM installed_themes WHERE id = $1")
            .bind(theme_id).fetch_optional(&self.db_pool).await?;
        match row {
            Some(r) => {
                if r.get::<bool, _>("system") { anyhow::bail!("Cannot uninstall system theme '{}'", theme_id); }
                sqlx::query("DELETE FROM installed_themes WHERE id = $1")
                    .bind(theme_id).execute(&self.db_pool).await?;
                sqlx::query("UPDATE user_theme_selections SET theme_id = 'auto' WHERE theme_id = $1")
                    .bind(theme_id).execute(&self.db_pool).await?;
                let d = self.themes_dir.join(theme_id);
                if d.exists() { tokio::fs::remove_dir_all(&d).await.ok(); }
                self.refresh_cache().await?;
                Ok(())
            }
            None => anyhow::bail!("Theme '{}' not found", theme_id),
        }
    }

    /// Set user theme selection.
    pub async fn set_user_theme(&self, user_id: &str, profile_id: &str, sel: iora_shared::theme::UserThemeSelection) -> anyhow::Result<()> {
        let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
        let overrides_json = serde_json::to_string(&sel.overrides)?;
        let id = format!("theme_sel_{}", Uuid::new_v4());
        sqlx::query(
            "INSERT INTO user_theme_selections(id,user_id,profile_id,theme_id,auto_theme,overrides,created_at,updated_at) \
             VALUES($1,$2,$3,$4,$5,$6,$7,$8) \
             ON CONFLICT(profile_id) DO UPDATE SET theme_id=$4,auto_theme=$5,overrides=$6,updated_at=$8"
        ).bind(&id).bind(user_id).bind(profile_id)
        .bind(&sel.theme_id).bind(sel.auto_theme)
        .bind(&overrides_json).bind(&now).bind(&now)
        .execute(&self.db_pool).await?;
        Ok(())
    }

    /// Get user theme selection.
    pub async fn get_user_theme(&self, profile_id: &str) -> anyhow::Result<Option<iora_shared::theme::UserThemeSelection>> {
        let row = sqlx::query("SELECT theme_id,auto_theme,overrides FROM user_theme_selections WHERE profile_id=$1")
            .bind(profile_id).fetch_optional(&self.db_pool).await?;
        Ok(row.map(|r| {
            iora_shared::theme::UserThemeSelection {
                theme_id: r.get("theme_id"), auto_theme: r.get("auto_theme"),
                overrides: serde_json::from_str(&r.get::<String, _>("overrides")).unwrap_or_default(),
            }
        }))
    }

    /// Build full theme CSS response for a user.
    pub async fn get_theme_css1(&self, profile_id: &str) -> anyhow::Result<iora_shared::theme::ThemeCssResponse> {
        let selection = self.get_user_theme(profile_id).await?;
        let theme_id = selection.as_ref().map(|s| s.theme_id.as_str()).unwrap_or("auto");

        if theme_id == "auto" || theme_id == "default" {
            return Ok(iora_shared::theme::ThemeCssResponse {
                theme_id: "auto".into(), source: "inline".into(),
                css_variables: HashMap::new(), additional_css: None,
                css_urls: vec![], js_urls: vec![],
                assets_base_url: None, fonts: vec![], icon_font: None,
                html_templates: HashMap::new(),
            });
        }

        let cache = self.theme_cache.read().await;
        if let Some(row) = cache.get(theme_id) {
            let mut vars: HashMap<String, String> = serde_json::from_str(&row.css_variables).unwrap_or_default();
            if let Some(ref sel) = selection { vars.extend(sel.overrides.clone()); }

            let fonts: Vec<iora_shared::theme::ThemeFont> = row.fonts_json.as_ref()
                .and_then(|j| serde_json::from_str(j).ok()).unwrap_or_default();
            let icon_font: Option<iora_shared::theme::ThemeIconConfig> = row.icon_font_json.as_ref()
                .and_then(|j| serde_json::from_str(j).ok());
            let css_files: Vec<String> = row.css_files_json.as_ref()
                .and_then(|j| serde_json::from_str(j).ok()).unwrap_or_default();
            let js_files: Vec<String> = row.js_files_json.as_ref()
                .and_then(|j| serde_json::from_str(j).ok()).unwrap_or_default();
            let html_templates: HashMap<String, String> = row.html_templates_json.as_ref()
                .and_then(|j| serde_json::from_str(j).ok()).unwrap_or_default();

            let assets_base = if row.source == "file" { Some(format!("/api/themes/assets/{}", theme_id)) } else { None };

            let mut resolved_fonts = fonts.clone();
            for f in &mut resolved_fonts {
                if !f.url.starts_with("http") && !f.url.starts_with("data:") {
                    if let Some(ref base) = assets_base { f.url = format!("{}/{}", base, f.url); }
                }
            }

                        // Resolve icon font paths
            let mut resolved_icon_font: Option<iora_shared::theme::ThemeIconConfig> = None;
            if let Some(mut ic) = icon_font {
                if !ic.css_path.starts_with("http") && !ic.css_path.starts_with("data:") {
                    if let Some(ref base) = assets_base { ic.css_path = format!("{}/{}", base, ic.css_path); }
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
                if let Some(ref base) = assets_base { css_urls.push(format!("{}/{}", base, f)); }
                else { css_urls.push(f.clone()); }
            }
            let mut js_urls: Vec<String> = Vec::new();
            for f in &js_files {
                if let Some(ref base) = assets_base { js_urls.push(format!("{}/{}", base, f)); }
                else { js_urls.push(f.clone()); }
            }
            let html_resolved: HashMap<String, String> = html_templates.iter().map(|(k,v)| {
                let resolved = if let Some(ref base) = assets_base { format!("{}/{}", base, v) } else { v.clone() };
                (k.clone(), resolved)
            }).collect();

            return Ok(iora_shared::theme::ThemeCssResponse {
                theme_id: theme_id.to_string(), source: row.source.clone(),
                css_variables: vars, additional_css: row.additional_css.clone(),
                css_urls, js_urls,
                assets_base_url: assets_base,
                fonts: resolved_fonts, icon_font: resolved_icon_font,
                html_templates: html_resolved,
            });
        }

        Ok(iora_shared::theme::ThemeCssResponse {
            theme_id: theme_id.into(), source: "inline".into(),
            css_variables: HashMap::new(), additional_css: None,
            css_urls: vec![], js_urls: vec![],
            assets_base_url: None, fonts: vec![], icon_font: None,
            html_templates: HashMap::new(),
        })
    }

    /// Serve a static file from a theme directory.
    pub async fn serve_asset(&self, theme_id: &str, file_path: &str) -> Result<Response, (StatusCode, String)> {
        let clean = file_path.replace("\\", "/").trim_start_matches('/').to_string();
        if clean.contains("..") { return Err((StatusCode::BAD_REQUEST, "Invalid path".into())); }
        let file = self.themes_dir.join(theme_id).join(&clean);
        if !file.exists() || !file.starts_with(&self.themes_dir.join(theme_id)) {
            return Err((StatusCode::NOT_FOUND, "File not found".into()));
        }
        let data = tokio::fs::read(&file).await
            .map_err(|_| (StatusCode::NOT_FOUND, "File not found".into()))?;
        let mime = mime_type(&clean);
        let mut headers = HeaderMap::new();
        headers.insert(header::CONTENT_TYPE, mime.parse().unwrap());
        headers.insert(header::CACHE_CONTROL, "public, max-age=3600".parse().unwrap());
        Ok((headers, data).into_response())
    }
}

// ─── Helper functions ───────────────────────────────────────────────

fn mime_type(path: &str) -> &'static str {
    if path.ends_with(".css") { "text/css" }
    else if path.ends_with(".js") { "application/javascript" }
    else if path.ends_with(".html")||path.ends_with(".htm") { "text/html" }
    else if path.ends_with(".svg") { "image/svg+xml" }
    else if path.ends_with(".png") { "image/png" }
    else if path.ends_with(".jpg")||path.ends_with(".jpeg") { "image/jpeg" }
    else if path.ends_with(".gif") { "image/gif" }
    else if path.ends_with(".webp") { "image/webp" }
    else if path.ends_with(".woff2") { "font/woff2" }
    else if path.ends_with(".woff") { "font/woff" }
    else if path.ends_with(".ttf") { "font/ttf" }
    else if path.ends_with(".otf") { "font/otf" }
    else if path.ends_with(".json") { "application/json" }
    else if path.ends_with(".xml") { "application/xml" }
    else { "application/octet-stream" }
}

fn builtin_themes() -> Vec<iora_shared::theme::ThemeDefinition> {
    macro_rules! t {
        ($id:expr, $name:expr, $desc:expr, $icon:expr, $order:expr) => {
            iora_shared::theme::ThemeDefinition {
                id: $id.into(), name: $name.into(), version: "1.0.0".into(),
                developer: "IORA".into(), description: $desc.into(),
                icon: Some($icon.into()), preview_image: None, parent_theme: None,
                source: "inline".into(), css_variables: HashMap::new(),
                css_files: vec![], js_files: vec![], html_templates: HashMap::new(),
                fonts: vec![], icon_font: None, additional_css: None,
                system: true, order: $order,
            }
        };
    }
    vec![
        t!("light", "Hell", "Maximale Helligkeit", "Sun", 5),
        t!("day", "Tag", "Helles Tages-Design", "CloudSun", 10),
        t!("day-classic", "Klassisch", "Dunkler Hintergrund", "Monitor", 20),
        t!("evening", "Abend", "Warme Töne", "SunDim", 30),
        t!("night", "Nacht", "Dunkles Design", "MoonStars", 40),
        t!("sleep", "Schlaf", "OLED Schwarz", "Moon", 50),
    ]
}

// ─── Request/Response types ─────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct SetUserThemeRequest {
    pub theme_id: String,
    #[serde(default)] pub auto_theme: bool,
    #[serde(default)] pub overrides: HashMap<String, String>,
}

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
        .fetch_all(&state.db_pool).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB: {}", e)))?;
    let installed: Vec<iora_shared::theme::InstalledTheme> = rows.iter().map(|r| {
        let r = map_theme_row(r);
        let preview = r.preview_image.as_ref().and_then(|p| {
            if p.starts_with("file:") { Some(format!("/api/themes/assets/{}/{}", r.id, p.trim_start_matches("file:"))) }
            else { Some(p.clone()) }
        });
        iora_shared::theme::InstalledTheme {
            id: r.id, name: r.name, version: r.version,
            developer: r.developer, description: r.description,
            icon: r.icon, preview_image: preview, parent_theme: r.parent_theme,
            source: r.source, system: r.system, enabled: r.enabled,
            installed_at: r.installed_at,
            fonts_json: r.fonts_json, icon_font_json: r.icon_font_json,
            css_files_json: r.css_files_json, js_files_json: r.js_files_json,
            html_templates_json: r.html_templates_json,
        }
    }).collect();
    Ok(Json(iora_shared::theme::ThemeListResponse { builtin, installed }))
}

/// POST /api/themes/install-from-manifest
pub async fn handle_install_theme_inline(
    State(gs): State<AppState>,
    Json(def): Json<iora_shared::theme::ThemeDefinition>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    gs.theme_manager.install_inline(def).await
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
        if s.contains("system theme") { (StatusCode::BAD_REQUEST, s) }
        else if s.contains("not found") { (StatusCode::NOT_FOUND, s) }
        else { (StatusCode::INTERNAL_SERVER_ERROR, s) }
    })?;
    Ok(Json(serde_json::json!({"status":"ok"})))
}

/// GET /api/themes/user/:profile_id
pub async fn get_user_theme(
    State(gs): State<AppState>,
    Path(profile_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let selection = gs.theme_manager.get_user_theme(&profile_id).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(serde_json::json!({"selection": selection})))
}

/// POST /api/themes/user/:profile_id
pub async fn set_user_theme(
    State(gs): State<AppState>,
    Path(profile_id): Path<String>,
    Json(req): Json<SetUserThemeRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let sel = iora_shared::theme::UserThemeSelection {
        theme_id: req.theme_id, auto_theme: req.auto_theme, overrides: req.overrides,
    };
    gs.theme_manager.set_user_theme(&profile_id, &profile_id, sel).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(serde_json::json!({"status":"ok"})))
}

/// GET /api/themes/css/:profile_id
pub async fn get_theme_css(
    State(gs): State<AppState>,
    Path(profile_id): Path<String>,
) -> Result<Json<iora_shared::theme::ThemeCssResponse>, (StatusCode, String)> {
    let css = gs.theme_manager.get_theme_css1(&profile_id).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(css))
}

/// GET /api/themes/assets/:theme_id/*path
pub async fn serve_theme_asset(
    State(gs): State<AppState>,
    Path((theme_id, path)): Path<(String, String)>,
) -> Result<Response, (StatusCode, String)> {
    gs.theme_manager.serve_asset(&theme_id, &path).await
}


