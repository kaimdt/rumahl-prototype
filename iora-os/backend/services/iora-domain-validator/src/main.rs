//! IORA Domain Validator Service
//!
//! This service validates network access against app-declared domain whitelists and IP access rules.
//! It provides validation APIs and enforcement mechanisms for network security.
//!
//! Key Features:
//! - Domain whitelist validation (including wildcards)
//! - IP address/subnet validation
//! - DNS resolution checking
//! - Access logging and monitoring
//! - Real-time domain list updates

use anyhow::{Context, Result};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use iora_shared_config::system_config;
use ipnetwork::IpNetwork;
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use std::collections::HashMap;
use std::net::IpAddr;
use std::str::FromStr;
use std::sync::Arc;
use tokio::sync::RwLock;
use tower_http::cors::CorsLayer;
use tracing::{error, info};
use trust_dns_resolver::config::*;
use trust_dns_resolver::TokioAsyncResolver;
use uuid::Uuid;

// ─── Configuration ──────────────────────────────────────────────────────────

const DEFAULT_PORT: u16 = 8100;

// ─── Data Structures ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AppNetworkPolicy {
    app_id: String,
    allowed_domains: Vec<String>,
    allow_user_domains: bool,
    allowed_local_ips: Vec<String>,
    allow_user_local_ips: bool,
    allow_network_scan: bool,
    user_added_domains: Vec<String>,
    user_added_ips: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
struct DomainAccessLog {
    id: Uuid,
    app_id: String,
    domain: String,
    ip_address: Option<String>,
    allowed: bool,
    reason: String,
    timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ValidationRequest {
    app_id: String,
    target: String, // domain or IP
    target_type: TargetType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum TargetType {
    Domain,
    Ip,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ValidationResponse {
    allowed: bool,
    reason: String,
    matched_rule: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AddDomainRequest {
    domain: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AddIpRequest {
    ip: String,
}

#[derive(Debug, Clone)]
struct AppState {
    db: PgPool,
    policies: Arc<RwLock<HashMap<String, AppNetworkPolicy>>>,
    #[allow(dead_code)]
    resolver: Arc<TokioAsyncResolver>,
}

// ─── Domain Validation ──────────────────────────────────────────────────────

/// Check if a domain matches a pattern (supports wildcards)
fn domain_matches_pattern(domain: &str, pattern: &str) -> bool {
    if pattern == domain {
        return true;
    }

    // Handle wildcard patterns like *.example.com
    if let Some(pattern_suffix) = pattern.strip_prefix("*.") {
        // Match exact suffix or subdomain
        return domain == pattern_suffix || domain.ends_with(&format!(".{}", pattern_suffix));
    }

    // Handle wildcard at end like example.*
    if let Some(pattern_prefix) = pattern.strip_suffix(".*") {
        return domain.starts_with(&format!("{}.", pattern_prefix)) || domain == pattern_prefix;
    }

    false
}

/// Validate domain access for an app
async fn validate_domain_access(
    state: &AppState,
    app_id: &str,
    domain: &str,
) -> Result<ValidationResponse> {
    let policies = state.policies.read().await;

    let policy = match policies.get(app_id) {
        Some(p) => p,
        None => {
            return Ok(ValidationResponse {
                allowed: false,
                reason: "No network policy found for app".to_string(),
                matched_rule: None,
            });
        }
    };

    // Check against allowed domains
    for allowed_domain in &policy.allowed_domains {
        if domain_matches_pattern(domain, allowed_domain) {
            return Ok(ValidationResponse {
                allowed: true,
                reason: "Matched manifest domain whitelist".to_string(),
                matched_rule: Some(allowed_domain.clone()),
            });
        }
    }

    // Check against user-added domains (if permitted)
    if policy.allow_user_domains {
        for user_domain in &policy.user_added_domains {
            if domain_matches_pattern(domain, user_domain) {
                return Ok(ValidationResponse {
                    allowed: true,
                    reason: "Matched user-added domain".to_string(),
                    matched_rule: Some(user_domain.clone()),
                });
            }
        }
    }

    Ok(ValidationResponse {
        allowed: false,
        reason: "Domain not in whitelist".to_string(),
        matched_rule: None,
    })
}

/// Validate IP access for an app
async fn validate_ip_access(
    state: &AppState,
    app_id: &str,
    ip: &str,
) -> Result<ValidationResponse> {
    let policies = state.policies.read().await;

    let policy = match policies.get(app_id) {
        Some(p) => p,
        None => {
            return Ok(ValidationResponse {
                allowed: false,
                reason: "No network policy found for app".to_string(),
                matched_rule: None,
            });
        }
    };

    let target_ip = match IpAddr::from_str(ip) {
        Ok(ip) => ip,
        Err(_) => {
            return Ok(ValidationResponse {
                allowed: false,
                reason: "Invalid IP address format".to_string(),
                matched_rule: None,
            });
        }
    };

    // Check against allowed local IPs
    for allowed_ip_str in &policy.allowed_local_ips {
        // Try parsing as network (CIDR)
        if let Ok(network) = IpNetwork::from_str(allowed_ip_str) {
            if network.contains(target_ip) {
                return Ok(ValidationResponse {
                    allowed: true,
                    reason: "Matched manifest IP whitelist (CIDR)".to_string(),
                    matched_rule: Some(allowed_ip_str.clone()),
                });
            }
        }
        // Try parsing as single IP
        else if let Ok(allowed_ip) = IpAddr::from_str(allowed_ip_str) {
            if allowed_ip == target_ip {
                return Ok(ValidationResponse {
                    allowed: true,
                    reason: "Matched manifest IP whitelist".to_string(),
                    matched_rule: Some(allowed_ip_str.clone()),
                });
            }
        }
    }

    // Check against user-added IPs (if permitted)
    if policy.allow_user_local_ips {
        for user_ip_str in &policy.user_added_ips {
            if let Ok(network) = IpNetwork::from_str(user_ip_str) {
                if network.contains(target_ip) {
                    return Ok(ValidationResponse {
                        allowed: true,
                        reason: "Matched user-added IP (CIDR)".to_string(),
                        matched_rule: Some(user_ip_str.clone()),
                    });
                }
            } else if let Ok(user_ip) = IpAddr::from_str(user_ip_str) {
                if user_ip == target_ip {
                    return Ok(ValidationResponse {
                        allowed: true,
                        reason: "Matched user-added IP".to_string(),
                        matched_rule: Some(user_ip_str.clone()),
                    });
                }
            }
        }
    }

    Ok(ValidationResponse {
        allowed: false,
        reason: "IP not in whitelist".to_string(),
        matched_rule: None,
    })
}

/// Log access attempt
async fn log_access(
    pool: &PgPool,
    app_id: &str,
    target: &str,
    ip_address: Option<&str>,
    allowed: bool,
    reason: &str,
) -> Result<()> {
    sqlx::query(
        r#"
        INSERT INTO domain_access_logs (id, app_id, domain, ip_address, allowed, reason, timestamp)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(app_id)
    .bind(target)
    .bind(ip_address)
    .bind(allowed)
    .bind(reason)
    .bind(Utc::now())
    .execute(pool)
    .await
    .context("Failed to log access")?;

    Ok(())
}

// ─── API Endpoints ──────────────────────────────────────────────────────────

/// Health check
async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "service": "iora-domain-validator",
        "status": "healthy",
        "timestamp": Utc::now().to_rfc3339(),
    }))
}

/// Validate network access
async fn validate_access(
    State(state): State<AppState>,
    Json(req): Json<ValidationRequest>,
) -> impl IntoResponse {
    let validation_result = match req.target_type {
        TargetType::Domain => validate_domain_access(&state, &req.app_id, &req.target).await,
        TargetType::Ip => validate_ip_access(&state, &req.app_id, &req.target).await,
    };

    let response = match validation_result {
        Ok(resp) => resp,
        Err(e) => ValidationResponse {
            allowed: false,
            reason: format!("Validation error: {}", e),
            matched_rule: None,
        },
    };

    // Log the access attempt
    let target_type_str = match req.target_type {
        TargetType::Domain => "domain",
        TargetType::Ip => "ip",
    };

    if let Err(e) = log_access(
        &state.db,
        &req.app_id,
        &req.target,
        None,
        response.allowed,
        &format!("{} ({})", response.reason, target_type_str),
    )
    .await
    {
        error!("Failed to log access: {}", e);
    }

    (StatusCode::OK, Json(response))
}

/// Get app network policy
async fn get_app_policy(
    State(state): State<AppState>,
    Path(app_id): Path<String>,
) -> impl IntoResponse {
    let policies = state.policies.read().await;

    match policies.get(&app_id) {
        Some(policy) => (StatusCode::OK, Json(policy.clone())).into_response(),
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({
                "error": "App policy not found"
            })),
        )
            .into_response(),
    }
}

/// Add user domain to app whitelist
async fn add_user_domain(
    State(state): State<AppState>,
    Path(app_id): Path<String>,
    Json(req): Json<AddDomainRequest>,
) -> impl IntoResponse {
    let mut policies = state.policies.write().await;

    let policy = match policies.get_mut(&app_id) {
        Some(p) => p,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({
                    "error": "App not found"
                })),
            )
                .into_response();
        }
    };

    if !policy.allow_user_domains {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({
                "error": "App does not allow user-added domains"
            })),
        )
            .into_response();
    }

    // Validate domain format
    if req.domain.is_empty() || req.domain.contains(' ') {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "Invalid domain format"
            })),
        )
            .into_response();
    }

    // Add domain if not already present
    if !policy.user_added_domains.contains(&req.domain) {
        policy.user_added_domains.push(req.domain.clone());

        // Persist to database
        if let Err(e) = sqlx::query(
            r#"
            UPDATE app_network_policies
            SET user_added_domains = array_append(user_added_domains, $1)
            WHERE app_id = $2
            "#,
        )
        .bind(&req.domain)
        .bind(&app_id)
        .execute(&state.db)
        .await
        {
            error!("Failed to persist user domain: {}", e);
        }

        info!("Added user domain {} for app {}", req.domain, app_id);
    }

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "message": "Domain added successfully",
            "domain": req.domain
        })),
    )
        .into_response()
}

/// Add user IP to app whitelist
async fn add_user_ip(
    State(state): State<AppState>,
    Path(app_id): Path<String>,
    Json(req): Json<AddIpRequest>,
) -> impl IntoResponse {
    let mut policies = state.policies.write().await;

    let policy = match policies.get_mut(&app_id) {
        Some(p) => p,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({
                    "error": "App not found"
                })),
            )
                .into_response();
        }
    };

    if !policy.allow_user_local_ips {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({
                "error": "App does not allow user-added IPs"
            })),
        )
            .into_response();
    }

    // Validate IP format (single IP or CIDR)
    if IpAddr::from_str(&req.ip).is_err() && IpNetwork::from_str(&req.ip).is_err() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "Invalid IP or CIDR format"
            })),
        )
            .into_response();
    }

    // Add IP if not already present
    if !policy.user_added_ips.contains(&req.ip) {
        policy.user_added_ips.push(req.ip.clone());

        // Persist to database
        if let Err(e) = sqlx::query(
            r#"
            UPDATE app_network_policies
            SET user_added_ips = array_append(user_added_ips, $1)
            WHERE app_id = $2
            "#,
        )
        .bind(&req.ip)
        .bind(&app_id)
        .execute(&state.db)
        .await
        {
            error!("Failed to persist user IP: {}", e);
        }

        info!("Added user IP {} for app {}", req.ip, app_id);
    }

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "message": "IP added successfully",
            "ip": req.ip
        })),
    )
        .into_response()
}

/// Get access logs for an app
async fn get_access_logs(
    State(state): State<AppState>,
    Path(app_id): Path<String>,
) -> impl IntoResponse {
    match sqlx::query_as::<_, DomainAccessLog>(
        "SELECT * FROM domain_access_logs WHERE app_id = $1 ORDER BY timestamp DESC LIMIT 100",
    )
    .bind(&app_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(logs) => (StatusCode::OK, Json(logs)).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": format!("Failed to fetch logs: {}", e)
            })),
        )
            .into_response(),
    }
}

// ─── Database Setup ─────────────────────────────────────────────────────────

async fn init_database(pool: &PgPool) -> Result<()> {
    // Create app network policies table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS app_network_policies (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            app_id VARCHAR(255) UNIQUE NOT NULL,
            allowed_domains TEXT[] NOT NULL DEFAULT '{}',
            allow_user_domains BOOLEAN NOT NULL DEFAULT false,
            allowed_local_ips TEXT[] NOT NULL DEFAULT '{}',
            allow_user_local_ips BOOLEAN NOT NULL DEFAULT false,
            allow_network_scan BOOLEAN NOT NULL DEFAULT false,
            user_added_domains TEXT[] NOT NULL DEFAULT '{}',
            user_added_ips TEXT[] NOT NULL DEFAULT '{}',
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        )
        "#,
    )
    .execute(pool)
    .await
    .context("Failed to create app_network_policies table")?;

    // Create domain access logs table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS domain_access_logs (
            id UUID PRIMARY KEY,
            app_id VARCHAR(255) NOT NULL,
            domain VARCHAR(255) NOT NULL,
            ip_address VARCHAR(45),
            allowed BOOLEAN NOT NULL,
            reason TEXT NOT NULL,
            timestamp TIMESTAMP WITH TIME ZONE NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await
    .context("Failed to create domain_access_logs table")?;

    // Create indexes
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_domain_logs_app_id ON domain_access_logs(app_id)")
        .execute(pool)
        .await
        .ok();

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_domain_logs_timestamp ON domain_access_logs(timestamp DESC)")
        .execute(pool)
        .await
        .ok();

    info!("Database initialized successfully");
    Ok(())
}

/// Load policies from database into memory
async fn load_policies(pool: &PgPool) -> Result<HashMap<String, AppNetworkPolicy>> {
    let rows = sqlx::query(
        "SELECT app_id, allowed_domains, allow_user_domains, allowed_local_ips, allow_user_local_ips, allow_network_scan, user_added_domains, user_added_ips FROM app_network_policies"
    )
    .fetch_all(pool)
    .await
    .context("Failed to load policies")?;

    let mut policies = HashMap::new();

    for row in rows {
        let app_id: String = row.try_get("app_id")?;
        let policy = AppNetworkPolicy {
            app_id: app_id.clone(),
            allowed_domains: row.try_get("allowed_domains").unwrap_or_default(),
            allow_user_domains: row.try_get("allow_user_domains").unwrap_or(false),
            allowed_local_ips: row.try_get("allowed_local_ips").unwrap_or_default(),
            allow_user_local_ips: row.try_get("allow_user_local_ips").unwrap_or(false),
            allow_network_scan: row.try_get("allow_network_scan").unwrap_or(false),
            user_added_domains: row.try_get("user_added_domains").unwrap_or_default(),
            user_added_ips: row.try_get("user_added_ips").unwrap_or_default(),
        };

        policies.insert(app_id, policy);
    }

    info!("Loaded {} network policies", policies.len());
    Ok(policies)
}

// ─── Main ───────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "iora_domain_validator=info".to_string()),
        )
        .init();

    info!("Starting IORA Domain Validator service...");

    // Load environment
    dotenv::dotenv().ok();

    // Database connection
    let database_url = system_config::database_url();

    let pool = PgPool::connect(&database_url)
        .await
        .context("Failed to connect to database")?;

    info!("Connected to database");

    // Initialize database schema
    init_database(&pool).await?;

    // Load network policies
    let policies = Arc::new(RwLock::new(load_policies(&pool).await?));

    // Create DNS resolver
    let resolver = Arc::new(TokioAsyncResolver::tokio(
        ResolverConfig::default(),
        ResolverOpts::default(),
    ));

    // Create app state
    let state = AppState {
        db: pool,
        policies,
        resolver,
    };

    // Build router
    let app = Router::new()
        .route("/health", get(health))
        .route("/api/domain-validator/validate", post(validate_access))
        .route("/api/domain-validator/policy/:app_id", get(get_app_policy))
        .route(
            "/api/domain-validator/policy/:app_id/domains",
            post(add_user_domain),
        )
        .route(
            "/api/domain-validator/policy/:app_id/ips",
            post(add_user_ip),
        )
        .route("/api/domain-validator/logs/:app_id", get(get_access_logs))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], DEFAULT_PORT));
    info!("iora-domain-validator listening on {}", addr);
    let _hb = iora_shared_heartbeat::spawn_default(
        "iora-domain-validator",
        addr.port(),
        "Domain ownership validator",
    );

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
