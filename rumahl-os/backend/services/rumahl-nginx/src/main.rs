//! rumahl NGINX Service
//!
//! This service manages the NGINX reverse proxy instance for all web traffic in rumahl.
//! It dynamically generates NGINX configuration based on installed apps and their port assignments.
//!
//! Key Features:
//! - Reverse proxy for all rumahl services
//! - Dynamic app route generation
//! - Automatic NGINX reload on configuration changes
//! - Health monitoring
//! - Rate limiting and security headers

use anyhow::{Context, Result};
use rumahl_shared_config::system_config;
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use std::fs;
use std::path::Path;
use std::process::{Command, Stdio};
use tera::{Context as TeraContext, Tera};
use tokio::signal;
use tokio::time::{sleep, Duration};
use tracing::{error, info, warn};

// ─── Configuration ──────────────────────────────────────────────────────────

#[allow(dead_code)]
const NGINX_CONFIG_DIR: &str = "/etc/nginx";
const NGINX_CONFIG_FILE: &str = "/etc/nginx/nginx.conf";
/// Default template location used when neither `$NGINX_TEMPLATE_PATH`
/// nor a co-located `./nginx-config/nginx.conf.template` exists. On
/// rumahl OS the template is shipped under `/usr/share/ora/rumahl-nginx/`.
const NGINX_TEMPLATE_DEFAULT: &str = "./nginx-config/nginx.conf.template";
const NGINX_TEMPLATE_FALLBACK: &str = "/usr/share/ora/rumahl-nginx/nginx.conf.template";

fn nginx_template_path() -> String {
    if let Ok(p) = std::env::var("NGINX_TEMPLATE_PATH") {
        if !p.trim().is_empty() {
            return p;
        }
    }
    if std::path::Path::new(NGINX_TEMPLATE_DEFAULT).exists() {
        return NGINX_TEMPLATE_DEFAULT.to_string();
    }
    NGINX_TEMPLATE_FALLBACK.to_string()
}
const DEFAULT_PORT: u16 = 80;
const CONFIG_RELOAD_INTERVAL_SECS: u64 = 30;

// ─── Data Structures ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AppRoute {
    id: String,
    name: String,
    port: u16,
    enabled: bool,
}

#[allow(dead_code)]
#[derive(Debug, Serialize)]
struct NginxConfig {
    apps: Vec<AppRoute>,
}

// ─── NGINX Management ───────────────────────────────────────────────────────

/// Generate NGINX configuration from template
fn generate_nginx_config(apps: Vec<AppRoute>) -> Result<String> {
    let mut tera = Tera::default();

    // Load template
    let template_path = nginx_template_path();
    let template_content = fs::read_to_string(&template_path)
        .with_context(|| format!("Failed to read NGINX template at {template_path}"))?;

    tera.add_raw_template("nginx.conf", &template_content)
        .context("Failed to parse NGINX template")?;

    // Create context with app data
    let mut context = TeraContext::new();
    context.insert("apps", &apps);

    // Render template
    let rendered = tera
        .render("nginx.conf", &context)
        .context("Failed to render NGINX template")?;

    Ok(rendered)
}

/// Write NGINX configuration to file
fn write_nginx_config(config: &str) -> Result<()> {
    // Ensure parent directory exists
    if let Some(parent) = Path::new(NGINX_CONFIG_FILE).parent() {
        fs::create_dir_all(parent).context("Failed to create NGINX config directory")?;
    }

    // Create backup of existing config
    if Path::new(NGINX_CONFIG_FILE).exists() {
        let backup_path = format!("{}.backup", NGINX_CONFIG_FILE);
        fs::copy(NGINX_CONFIG_FILE, &backup_path).context("Failed to create config backup")?;
        info!("Created config backup at {}", backup_path);
    }

    // Write new configuration
    fs::write(NGINX_CONFIG_FILE, config).context("Failed to write NGINX config")?;

    info!("Wrote NGINX configuration to {}", NGINX_CONFIG_FILE);
    Ok(())
}

/// Test NGINX configuration
fn test_nginx_config() -> Result<bool> {
    let output = Command::new("nginx")
        .args(["-t"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .context("Failed to test NGINX config")?;

    if output.status.success() {
        info!("NGINX configuration test passed");
        Ok(true)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        error!("NGINX configuration test failed: {}", stderr);
        Ok(false)
    }
}

/// Reload NGINX configuration
fn reload_nginx() -> Result<()> {
    let output = Command::new("nginx")
        .args(["-s", "reload"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .context("Failed to reload NGINX")?;

    if output.status.success() {
        info!("NGINX reloaded successfully");
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        error!("Failed to reload NGINX: {}", stderr);
        anyhow::bail!("NGINX reload failed: {}", stderr)
    }
}

/// Start NGINX process
fn start_nginx() -> Result<()> {
    let output = Command::new("nginx")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .context("Failed to start NGINX")?;

    if output.status.success() {
        info!("NGINX started successfully");
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        warn!(
            "NGINX start returned non-zero status (may already be running): {}",
            stderr
        );
        Ok(())
    }
}

/// Stop NGINX process
fn stop_nginx() -> Result<()> {
    let output = Command::new("nginx")
        .args(["-s", "quit"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .context("Failed to stop NGINX")?;

    if output.status.success() {
        info!("NGINX stopped successfully");
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        warn!("NGINX stop returned non-zero status: {}", stderr);
        Ok(())
    }
}

// ─── Database Queries ───────────────────────────────────────────────────────

/// Fetch all enabled apps with their port assignments from the database
async fn fetch_app_routes(pool: &PgPool) -> Result<Vec<AppRoute>> {
    let rows = match sqlx::query(
        r#"
        SELECT
            a.app_id,
            a.name,
            a.enabled,
            p.external_port
        FROM apps a
        LEFT JOIN port_assignments p ON a.id = p.app_id
        WHERE a.enabled = true
        AND p.external_port IS NOT NULL
        ORDER BY a.name
        "#,
    )
    .fetch_all(pool)
    .await
    {
        Ok(r) => r,
        Err(sqlx::Error::Database(db_err)) if db_err.message().contains("does not exist") => {
            // Tables haven't been created yet (rumahl-supervisor / rumahl-appstore
            // own the schema). Treat as "no apps" instead of failing.
            warn!("apps/port_assignments tables not yet present — treating as zero routes");
            return Ok(Vec::new());
        }
        Err(e) => {
            return Err(anyhow::Error::from(e).context("Failed to fetch app routes from database"))
        }
    };

    let mut apps = Vec::new();

    for row in rows {
        let app_id: String = row.try_get("app_id")?;
        let name: String = row.try_get("name")?;
        let enabled: bool = row.try_get("enabled")?;
        let external_port: i32 = row.try_get("external_port")?;

        apps.push(AppRoute {
            id: app_id,
            name,
            port: external_port as u16,
            enabled,
        });
    }

    info!("Fetched {} enabled app routes from database", apps.len());
    Ok(apps)
}

// ─── Configuration Update Loop ──────────────────────────────────────────────

/// Periodically update NGINX configuration based on database changes
async fn config_update_loop(pool: PgPool) -> Result<()> {
    loop {
        match update_nginx_config(&pool).await {
            Ok(changed) => {
                if changed {
                    info!("NGINX configuration updated and reloaded");
                }
            }
            Err(e) => {
                error!("Failed to update NGINX config: {}", e);
            }
        }

        sleep(Duration::from_secs(CONFIG_RELOAD_INTERVAL_SECS)).await;
    }
}

/// Update NGINX configuration if apps have changed
async fn update_nginx_config(pool: &PgPool) -> Result<bool> {
    // Fetch current app routes
    let apps = fetch_app_routes(pool).await?;

    // Generate new configuration
    let new_config = generate_nginx_config(apps)?;

    // Check if configuration has changed
    let current_config = fs::read_to_string(NGINX_CONFIG_FILE).ok();

    if let Some(current) = current_config {
        if current == new_config {
            // No changes, skip reload
            return Ok(false);
        }
    }

    // Write new configuration
    write_nginx_config(&new_config)?;

    // Test configuration
    if !test_nginx_config()? {
        error!("New NGINX configuration is invalid, reverting to backup");
        // Restore backup
        let backup_path = format!("{}.backup", NGINX_CONFIG_FILE);
        if Path::new(&backup_path).exists() {
            fs::copy(&backup_path, NGINX_CONFIG_FILE)?;
            info!("Restored backup configuration");
        }
        return Ok(false);
    }

    // Reload NGINX
    reload_nginx()?;

    Ok(true)
}

// ─── Main ───────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG")
                .unwrap_or_else(|_| "rumahl_nginx=info,tower_http=info".to_string()),
        )
        .init();

    info!("Starting rumahl NGINX service...");

    // Load environment
    dotenv::dotenv().ok();

    // Database connection — retry forever instead of crashing the
    // service. On a fresh image the `rumahl_core` database may not yet
    // contain the `apps` / `port_assignments` tables (they are created
    // by rumahl-supervisor on demand). systemd Restart=on-failure used to
    // turn that into an infinite crash-loop spamming the journal.
    let database_url = system_config::database_url();

    let pool = loop {
        match PgPool::connect(&database_url).await {
            Ok(pool) => {
                info!("Connected to database");
                break pool;
            }
            Err(e) => {
                warn!(
                    "Database not yet reachable ({}). Retrying in 30s — rumahl-nginx \
                     will idle until the rumahl_core schema exists.",
                    e
                );
                sleep(Duration::from_secs(30)).await;
            }
        }
    };

    // Generate initial NGINX configuration
    info!("Generating initial NGINX configuration...");
    update_nginx_config(&pool).await?;

    // Start NGINX
    info!("Starting NGINX...");
    start_nginx()?;

    // Spawn configuration update loop
    let pool_clone = pool.clone();
    tokio::spawn(async move {
        if let Err(e) = config_update_loop(pool_clone).await {
            error!("Config update loop failed: {}", e);
        }
    });

    info!("rumahl NGINX service is running on port {}", DEFAULT_PORT);

    let _hb = rumahl_shared_heartbeat::spawn_default(
        "rumahl-nginx",
        DEFAULT_PORT,
        "NGINX reverse-proxy controller",
    );
    info!(
        "Configuration will be auto-updated every {} seconds",
        CONFIG_RELOAD_INTERVAL_SECS
    );

    // Wait for shutdown signal
    signal::ctrl_c().await?;

    info!("Shutting down rumahl NGINX service...");
    stop_nginx()?;

    Ok(())
}
