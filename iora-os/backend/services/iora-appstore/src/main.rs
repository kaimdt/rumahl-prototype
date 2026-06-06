// Local `App` struct collides with `actix_web::App`, so alias the import.
use actix_web::{get, post, delete, web, App as ActixApp, HttpResponse, HttpServer, Responder};
use chrono::{DateTime, Utc};
use iora_shared::app_manifest::{AppManifest, TrustLevel};
use iora_shared::port_manager::PortManager;
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, postgres::PgPoolOptions};
use std::sync::Arc;
use tracing::{error, info, warn};
use uuid::Uuid;
use iora_shared::system_config;

/// IORA App Store Service
///
/// Manages app discovery, installation, and lifecycle.
/// Integrates with appstore.kaimdt.com and supports ZIP uploads.

#[allow(clippy::empty_line_after_doc_comments)]
#[allow(dead_code)]
struct AppState {
    db: PgPool,
    port_manager: Arc<PortManager>,
    supervisor_url: String,
    http_client: reqwest::Client,
    appstore_url: String,
}

// ─── Database Models ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
struct App {
    id: Uuid,
    app_id: String,
    name: String,
    version: String,
    developer: String,
    description: String,
    icon: Option<String>,
    manifest_json: serde_json::Value,
    trust_level: String,
    source: String, // "store" or "zip"
    installed_at: DateTime<Utc>,
    enabled: bool,
    container_name: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
struct AppPermission {
    id: Uuid,
    app_id: Uuid,
    permission: String,
    granted: bool,
    granted_at: Option<DateTime<Utc>>,
    granted_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
struct PortAssignment {
    id: Uuid,
    app_id: Uuid,
    internal_port: i32,
    external_port: i32,
    protocol: String,
    assignment_mode: String,
    assigned_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
struct AppSettings {
    id: Uuid,
    app_id: Uuid,
    settings_json: serde_json::Value,
    updated_at: DateTime<Utc>,
}

// ─── API Request/Response Models ─────────────────────────────────────────────

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct SearchQuery {
    q: Option<String>,
    category: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct InstallRequest {
    /// App ID from store
    app_id: Option<String>,

    /// Or direct manifest for ZIP upload
    manifest: Option<AppManifest>,

    /// ZIP file content (base64 encoded)
    zip_data: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PermissionGrantRequest {
    app_id: String,
    permissions: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct UpdateSettingsRequest {
    app_id: String,
    settings: serde_json::Value,
}

#[derive(Debug, Serialize)]
struct AppListResponse {
    apps: Vec<AppInfo>,
    total: i64,
}

#[derive(Debug, Serialize)]
struct AppInfo {
    id: String,
    name: String,
    version: String,
    developer: String,
    description: String,
    icon: Option<String>,
    trust_level: String,
    enabled: bool,
    installed_at: String,
    ports: Vec<PortInfo>,
}

#[derive(Debug, Serialize)]
struct PortInfo {
    internal: u16,
    external: u16,
    protocol: String,
    assignment_mode: String,
}

// ─── API Endpoints ──────────────────────────────────────────────────────────

/// Health check
#[get("/health")]
async fn health() -> impl Responder {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "healthy",
        "service": "iora-appstore",
        "timestamp": Utc::now().to_rfc3339(),
    }))
}

/// Search apps in the store
#[get("/api/appstore/search")]
async fn search_apps(
    query: web::Query<SearchQuery>,
    data: web::Data<AppState>,
) -> impl Responder {
    // This would query the remote appstore.kaimdt.com
    // For now, we'll query local installed apps

    let limit = query.limit.unwrap_or(20);
    let offset = query.offset.unwrap_or(0);

    let apps = match sqlx::query_as::<_, App>(
        "SELECT * FROM apps ORDER BY installed_at DESC LIMIT $1 OFFSET $2"
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(&data.db)
    .await
    {
        Ok(apps) => apps,
        Err(e) => {
            error!("Failed to query apps: {}", e);
            return HttpResponse::InternalServerError().json(serde_json::json!({
                "error": "Failed to query apps"
            }));
        }
    };

    let total = match sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM apps")
        .fetch_one(&data.db)
        .await
    {
        Ok(count) => count,
        Err(_) => apps.len() as i64,
    };

    let app_infos: Vec<AppInfo> = apps
        .into_iter()
        .map(|app| AppInfo {
            id: app.app_id.clone(),
            name: app.name,
            version: app.version,
            developer: app.developer,
            description: app.description,
            icon: app.icon,
            trust_level: app.trust_level,
            enabled: app.enabled,
            installed_at: app.installed_at.to_rfc3339(),
            ports: vec![], // Will be filled from port_assignments table
        })
        .collect();

    HttpResponse::Ok().json(AppListResponse {
        apps: app_infos,
        total,
    })
}

/// List installed apps
#[get("/api/appstore/installed")]
async fn list_installed(data: web::Data<AppState>) -> impl Responder {
    let apps = match sqlx::query_as::<_, App>(
        "SELECT * FROM apps ORDER BY installed_at DESC"
    )
    .fetch_all(&data.db)
    .await
    {
        Ok(apps) => apps,
        Err(e) => {
            error!("Failed to query apps: {}", e);
            return HttpResponse::InternalServerError().json(serde_json::json!({
                "error": "Failed to query apps"
            }));
        }
    };

    let mut app_infos = Vec::new();

    for app in apps {
        // Get port assignments
        let port_assignments = sqlx::query_as::<_, PortAssignment>(
            "SELECT * FROM port_assignments WHERE app_id = $1"
        )
        .bind(app.id)
        .fetch_all(&data.db)
        .await
        .unwrap_or_default();

        let ports: Vec<PortInfo> = port_assignments
            .into_iter()
            .map(|p| PortInfo {
                internal: p.internal_port as u16,
                external: p.external_port as u16,
                protocol: p.protocol,
                assignment_mode: p.assignment_mode,
            })
            .collect();

        app_infos.push(AppInfo {
            id: app.app_id.clone(),
            name: app.name,
            version: app.version,
            developer: app.developer,
            description: app.description,
            icon: app.icon,
            trust_level: app.trust_level,
            enabled: app.enabled,
            installed_at: app.installed_at.to_rfc3339(),
            ports,
        });
    }

    HttpResponse::Ok().json(serde_json::json!({
        "apps": app_infos,
        "total": app_infos.len()
    }))
}

/// Install an app
#[post("/api/appstore/install")]
async fn install_app(
    req: web::Json<InstallRequest>,
    data: web::Data<AppState>,
) -> impl Responder {
    let manifest = if let Some(ref manifest) = req.manifest {
        manifest.clone()
    } else if let Some(ref app_id) = req.app_id {
        // Fetch manifest from remote app store
        info!("Fetching app {} from store {}", app_id, data.appstore_url);
        let url = format!("{}/api/apps/{}/manifest", data.appstore_url.trim_end_matches('/'), app_id);
        match data.http_client.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => {
                match resp.json::<AppManifest>().await {
                    Ok(m) => m,
                    Err(e) => {
                        error!("Invalid manifest from store for {}: {}", app_id, e);
                        return HttpResponse::BadGateway().json(serde_json::json!({
                            "error": format!("Invalid manifest from store: {}", e)
                        }));
                    }
                }
            }
            Ok(resp) => {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                warn!("App store returned {} for {}: {}", status, app_id, body);
                return HttpResponse::BadGateway().json(serde_json::json!({
                    "error": format!("App store responded with {}", status),
                    "detail": body,
                }));
            }
            Err(e) => {
                error!("Failed to reach app store {}: {}", url, e);
                return HttpResponse::BadGateway().json(serde_json::json!({
                    "error": format!("Failed to reach app store: {}", e)
                }));
            }
        }
    } else {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": "Either app_id or manifest must be provided"
        }));
    };

    // Determine trust level
    let trust_level = if req.app_id.is_some() {
        TrustLevel::Trusted
    } else {
        TrustLevel::Untrusted
    };

    let source = if req.app_id.is_some() { "store" } else { "zip" };
    info!("Installing app: {} ({})", manifest.name, manifest.id);

    // Allocate ports if needed
    let mut port_assignments = Vec::new();
    if let Some(ref docker) = manifest.docker {
        for internal_port in &docker.internal_ports {
            let protocol = if internal_port.protocol == "udp" {
                iora_shared::port_manager::PortProtocol::Udp
            } else {
                iora_shared::port_manager::PortProtocol::Tcp
            };

            let mode = if internal_port.assignment_mode == "fixed" {
                iora_shared::port_manager::PortAssignmentMode::Fixed
            } else {
                iora_shared::port_manager::PortAssignmentMode::Random
            };

            match data.port_manager.allocate_port(&manifest.id, internal_port.port, protocol, mode).await {
                Ok(assignment) => {
                    info!(
                        "Allocated port {}:{} -> {} (mode: {:?})",
                        internal_port.port, assignment.external_port, assignment.protocol, assignment.assignment_mode
                    );
                    port_assignments.push(assignment);
                }
                Err(e) => {
                    error!("Failed to allocate port: {}", e);
                    return HttpResponse::InternalServerError().json(serde_json::json!({
                        "error": format!("Port allocation failed: {}", e)
                    }));
                }
            }
        }
    }

    // Insert into database
    let app_uuid = Uuid::new_v4();
    let manifest_json = serde_json::to_value(&manifest).unwrap();

    match sqlx::query(
        r#"
        INSERT INTO apps (id, app_id, name, version, developer, description, icon, manifest_json, trust_level, source, installed_at, enabled)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        "#
    )
    .bind(app_uuid)
    .bind(&manifest.id)
    .bind(&manifest.name)
    .bind(&manifest.version)
    .bind(&manifest.developer)
    .bind(&manifest.description)
    .bind(&manifest.icon)
    .bind(&manifest_json)
    .bind(format!("{:?}", trust_level).to_lowercase())
    .bind(source)
    .bind(Utc::now())
    .bind(false) // Start disabled, admin must enable
    .execute(&data.db)
    .await
    {
        Ok(_) => info!("App {} inserted into database", manifest.id),
        Err(e) => {
            error!("Failed to insert app: {}", e);
            return HttpResponse::InternalServerError().json(serde_json::json!({
                "error": "Failed to insert app"
            }));
        }
    }

    // Store port assignments in database
    for assignment in &port_assignments {
        let mode_str = match assignment.assignment_mode {
            iora_shared::port_manager::PortAssignmentMode::Random => "random",
            iora_shared::port_manager::PortAssignmentMode::Fixed => "fixed",
        };

        let _ = sqlx::query(
            r#"
            INSERT INTO port_assignments (id, app_id, internal_port, external_port, protocol, assignment_mode, assigned_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            "#
        )
        .bind(Uuid::new_v4())
        .bind(app_uuid)
        .bind(assignment.internal_port as i32)
        .bind(assignment.external_port as i32)
        .bind(assignment.protocol.to_string())
        .bind(mode_str)
        .bind(Utc::now())
        .execute(&data.db)
        .await;
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "message": format!("App {} installed successfully. Awaiting permission approval.", manifest.name),
        "app_id": manifest.id,
        "trust_level": format!("{:?}", trust_level).to_lowercase(),
        "ports": port_assignments.iter().map(|p| serde_json::json!({
            "internal": p.internal_port,
            "external": p.external_port,
            "protocol": p.protocol.to_string()
        })).collect::<Vec<_>>()
    }))
}

/// Uninstall an app
#[delete("/api/appstore/apps/{app_id}")]
async fn uninstall_app(
    path: web::Path<String>,
    data: web::Data<AppState>,
) -> impl Responder {
    let app_id = path.into_inner();

    info!("Uninstalling app: {}", app_id);

    // Get app from database
    let app = match sqlx::query_as::<_, App>("SELECT * FROM apps WHERE app_id = $1")
        .bind(&app_id)
        .fetch_one(&data.db)
        .await
    {
        Ok(app) => app,
        Err(_) => {
            return HttpResponse::NotFound().json(serde_json::json!({
                "error": "App not found"
            }));
        }
    };

    // Release ports
    if let Err(e) = data.port_manager.release_ports(&app_id).await {
        warn!("Failed to release ports for {}: {}", app_id, e);
    }

    // Delete port assignments from DB
    let _ = sqlx::query("DELETE FROM port_assignments WHERE app_id = $1")
        .bind(app.id)
        .execute(&data.db)
        .await;

    // Delete app settings
    let _ = sqlx::query("DELETE FROM app_settings WHERE app_id = $1")
        .bind(app.id)
        .execute(&data.db)
        .await;

    // Delete app permissions
    let _ = sqlx::query("DELETE FROM app_permissions WHERE app_id = $1")
        .bind(app.id)
        .execute(&data.db)
        .await;

    // Delete app
    match sqlx::query("DELETE FROM apps WHERE id = $1")
        .bind(app.id)
        .execute(&data.db)
        .await
    {
        Ok(_) => {
            info!("App {} uninstalled successfully", app_id);
            HttpResponse::Ok().json(serde_json::json!({
                "success": true,
                "message": format!("App {} uninstalled", app_id)
            }))
        }
        Err(e) => {
            error!("Failed to uninstall app: {}", e);
            HttpResponse::InternalServerError().json(serde_json::json!({
                "error": "Failed to uninstall app"
            }))
        }
    }
}

/// Grant permissions to an app
#[post("/api/appstore/permissions/grant")]
async fn grant_permissions(
    req: web::Json<PermissionGrantRequest>,
    data: web::Data<AppState>,
) -> impl Responder {
    // Get app
    let app = match sqlx::query_as::<_, App>("SELECT * FROM apps WHERE app_id = $1")
        .bind(&req.app_id)
        .fetch_one(&data.db)
        .await
    {
        Ok(app) => app,
        Err(_) => {
            return HttpResponse::NotFound().json(serde_json::json!({
                "error": "App not found"
            }));
        }
    };

    // Grant permissions
    for permission in &req.permissions {
        let _ = sqlx::query(
            r#"
            INSERT INTO app_permissions (id, app_id, permission, granted, granted_at)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (app_id, permission) DO UPDATE SET granted = $4, granted_at = $5
            "#
        )
        .bind(Uuid::new_v4())
        .bind(app.id)
        .bind(permission)
        .bind(true)
        .bind(Utc::now())
        .execute(&data.db)
        .await;
    }

    info!("Granted {} permissions to app {}", req.permissions.len(), req.app_id);

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "granted": req.permissions
    }))
}

/// Update app settings
#[post("/api/appstore/settings")]
async fn update_settings(
    req: web::Json<UpdateSettingsRequest>,
    data: web::Data<AppState>,
) -> impl Responder {
    // Get app
    let app = match sqlx::query_as::<_, App>("SELECT * FROM apps WHERE app_id = $1")
        .bind(&req.app_id)
        .fetch_one(&data.db)
        .await
    {
        Ok(app) => app,
        Err(_) => {
            return HttpResponse::NotFound().json(serde_json::json!({
                "error": "App not found"
            }));
        }
    };

    // Upsert settings
    match sqlx::query(
        r#"
        INSERT INTO app_settings (id, app_id, settings_json, updated_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (app_id) DO UPDATE SET settings_json = $3, updated_at = $4
        "#
    )
    .bind(Uuid::new_v4())
    .bind(app.id)
    .bind(&req.settings)
    .bind(Utc::now())
    .execute(&data.db)
    .await
    {
        Ok(_) => {
            info!("Updated settings for app {}", req.app_id);
            HttpResponse::Ok().json(serde_json::json!({
                "success": true
            }))
        }
        Err(e) => {
            error!("Failed to update settings: {}", e);
            HttpResponse::InternalServerError().json(serde_json::json!({
                "error": "Failed to update settings"
            }))
        }
    }
}

/// Get app settings
#[get("/api/appstore/apps/{app_id}/settings")]
async fn get_settings(
    path: web::Path<String>,
    data: web::Data<AppState>,
) -> impl Responder {
    let app_id = path.into_inner();

    // Get app
    let app = match sqlx::query_as::<_, App>("SELECT * FROM apps WHERE app_id = $1")
        .bind(&app_id)
        .fetch_one(&data.db)
        .await
    {
        Ok(app) => app,
        Err(_) => {
            return HttpResponse::NotFound().json(serde_json::json!({
                "error": "App not found"
            }));
        }
    };

    // Get settings
    match sqlx::query_as::<_, AppSettings>("SELECT * FROM app_settings WHERE app_id = $1")
        .bind(app.id)
        .fetch_one(&data.db)
        .await
    {
        Ok(settings) => HttpResponse::Ok().json(settings.settings_json),
        Err(_) => HttpResponse::Ok().json(serde_json::json!({})), // Empty settings
    }
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    info!("Starting IORA App Store v{}", env!("CARGO_PKG_VERSION"));

    // Connect to database
    let database_url = system_config::database_url_for("iora-appstore");

    let db = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await
        .expect("Failed to connect to database");

    info!("Connected to database successfully");

    // Initialize port manager
    let port_manager = Arc::new(PortManager::new());

    // Load existing port assignments from database
    if let Ok(assignments) = sqlx::query_as::<_, PortAssignment>(
        "SELECT * FROM port_assignments"
    )
    .fetch_all(&db)
    .await
    {
        let port_assignments: Vec<iora_shared::port_manager::PortAssignment> = assignments
            .into_iter()
            .map(|a| iora_shared::port_manager::PortAssignment {
                app_id: "".to_string(), // Will be filled from apps table
                internal_port: a.internal_port as u16,
                external_port: a.external_port as u16,
                protocol: if a.protocol == "udp" {
                    iora_shared::port_manager::PortProtocol::Udp
                } else {
                    iora_shared::port_manager::PortProtocol::Tcp
                },
                assignment_mode: iora_shared::port_manager::PortAssignmentMode::default(),
                assigned_at: a.assigned_at.to_rfc3339(),
            })
            .collect();

        port_manager.init_from_assignments(port_assignments).await;
        info!("Loaded {} port assignments", port_manager.get_all_assignments().await.len());
    }

    let supervisor_url = system_config::supervisor_url();
    let appstore_url = std::env::var("IORA_APPSTORE_REMOTE_URL")
        .unwrap_or_else(|_| "https://appstore.kaimdt.com".to_string());
    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent(concat!("iora-appstore/", env!("CARGO_PKG_VERSION")))
        .build()
        .expect("Failed to build reqwest client");

    let app_state = web::Data::new(AppState {
        db,
        port_manager,
        supervisor_url,
        http_client,
        appstore_url,
    });

    let port = system_config::service_port("iora-appstore", 8098);

    info!("Starting HTTP server on 0.0.0.0:{}", port);

    let _hb = iora_shared::heartbeat::spawn_default(
        "iora-appstore",
        port,
        "App store / app catalog",
    );

    HttpServer::new(move || {
        ActixApp::new()
            .app_data(app_state.clone())
            .service(health)
            .service(search_apps)
            .service(list_installed)
            .service(install_app)
            .service(uninstall_app)
            .service(grant_permissions)
            .service(update_settings)
            .service(get_settings)
    })
    .bind(("0.0.0.0", port))?
    .run()
    .await
}
