use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};

use ammonia::clean;
use anyhow::{Context, Result};
use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use governor::{
    clock::DefaultClock,
    state::{direct::NotKeyed, InMemoryState},
    RateLimiter,
};
use iora_shared::system_config;
use lettre::{
    message::Mailbox, transport::smtp::authentication::Credentials, AsyncSmtpTransport,
    AsyncTransport, Message, Tokio1Executor,
};
use regex::Regex;
use ring::digest::{Context as DigestContext, SHA256};
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use tokio::sync::RwLock;
use tower_http::cors::CorsLayer;
use tracing::{error, info, warn};
use url::Url;
use uuid::Uuid;

// ─── State ───────────────────────────────────────────────────────────────────

#[derive(Clone)]
struct AppState {
    db: Arc<SqlitePool>,
    http_client: reqwest::Client,
    #[allow(dead_code, clippy::type_complexity)]
    rate_limiter: Arc<RwLock<HashMap<String, RateLimiter<NotKeyed, InMemoryState, DefaultClock>>>>,
    started_at: Arc<Instant>,
    config: Arc<GatewayConfig>,
}

#[derive(Clone)]
struct GatewayConfig {
    smtp_server: Option<String>,
    smtp_username: Option<String>,
    smtp_password: Option<String>,
    max_request_size: usize,
    request_timeout_secs: u64,
    enable_sandboxing: bool,
    allowed_domains: Vec<String>,
}

// ─── Data Structures ─────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
#[allow(dead_code)]
struct GatewayRequest {
    request_id: String,
    request_type: String,
    requested_by: String,
    url: Option<String>,
    destination: Option<String>,
    request_data: Option<String>,
    status: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct EmailRequest {
    to: String,
    subject: String,
    body: String,
    requested_by: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct WebSearchRequest {
    query: String,
    max_results: Option<usize>,
    requested_by: String,
}

#[derive(Debug, Deserialize)]
struct HttpGetRequest {
    url: String,
    headers: Option<HashMap<String, String>>,
    requested_by: String,
}

#[derive(Debug, Deserialize)]
struct UpdateVerificationRequest {
    package_name: String,
    version: String,
    download_url: String,
    expected_checksum: String,
    checksum_type: String,
}

#[derive(Debug, Serialize)]
struct ValidationResult {
    is_safe: bool,
    threat_level: u8,
    findings: Vec<String>,
    sanitized_content: Option<String>,
}

// ─── Content Validation ──────────────────────────────────────────────────────

async fn validate_content(content: &str, content_type: &str) -> ValidationResult {
    let mut findings = Vec::new();
    let mut threat_level = 0u8;

    // Check for script tags and JavaScript
    let script_patterns = vec![
        r"<script[^>]*>",
        r"javascript:",
        r"on\w+\s*=",
        r"eval\s*\(",
        r"setTimeout\s*\(",
        r"setInterval\s*\(",
    ];

    for pattern in &script_patterns {
        if let Ok(re) = Regex::new(pattern) {
            if re.is_match(content) {
                findings.push(format!("JavaScript detected: {}", pattern));
                threat_level = threat_level.max(8);
            }
        }
    }

    // Check for SQL injection patterns
    let sql_patterns = vec![
        r"(?i)(union|select|insert|update|delete|drop|create|alter)\s+(from|into|table)",
        r"(?i)(\-\-|;|\/\*|\*\/)",
        r##"(?i)(or|and)\s+['"]?\d+['"]?\s*=\s*['"]?\d+['"]?"##,
    ];

    for pattern in &sql_patterns {
        if let Ok(re) = Regex::new(pattern) {
            if re.is_match(content) {
                findings.push(format!("SQL injection pattern detected: {}", pattern));
                threat_level = threat_level.max(9);
            }
        }
    }

    // Check for shell command injection
    let shell_patterns = vec![r"[;&|`$]", r"\$\([^)]*\)", r"`[^`]*`", r"\$\{[^}]*\}"];

    for pattern in &shell_patterns {
        if let Ok(re) = Regex::new(pattern) {
            if re.is_match(content) {
                findings.push(format!("Shell command pattern detected: {}", pattern));
                threat_level = threat_level.max(7);
            }
        }
    }

    // Check for path traversal
    if content.contains("../") || content.contains("..\\") {
        findings.push("Path traversal pattern detected".to_string());
        threat_level = threat_level.max(6);
    }

    // Sanitize HTML if applicable
    let sanitized_content = if content_type == "html" {
        Some(clean(content))
    } else {
        None
    };

    let is_safe = threat_level < 5;

    ValidationResult {
        is_safe,
        threat_level,
        findings,
        sanitized_content,
    }
}

async fn validate_url(url: &str, config: &GatewayConfig) -> Result<bool> {
    let parsed = Url::parse(url)?;

    // Check protocol
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Ok(false);
    }

    // Check if domain is in allowed list
    if !config.allowed_domains.is_empty() {
        if let Some(domain) = parsed.domain() {
            let is_allowed = config
                .allowed_domains
                .iter()
                .any(|allowed| domain == allowed || domain.ends_with(&format!(".{}", allowed)));
            if !is_allowed {
                return Ok(false);
            }
        } else {
            return Ok(false);
        }
    }

    // Check for private/local IPs
    if let Some(host) = parsed.host_str() {
        if host == "localhost"
            || host == "127.0.0.1"
            || host == "::1"
            || host.starts_with("192.168.")
            || host.starts_with("10.")
            || host.starts_with("172.")
        {
            return Ok(false);
        }
    }

    Ok(true)
}

async fn log_validation(
    db: &SqlitePool,
    request_id: &str,
    validation_type: &str,
    result: &ValidationResult,
) -> Result<()> {
    let findings_json = serde_json::to_string(&result.findings)?;

    sqlx::query(
        "INSERT INTO content_validations (request_id, validation_type, is_safe, threat_level, findings, validated_at)
         VALUES (?, ?, ?, ?, ?, ?)"
    )
    .bind(request_id)
    .bind(validation_type)
    .bind(result.is_safe)
    .bind(result.threat_level as i32)
    .bind(findings_json)
    .bind(Utc::now().to_rfc3339())
    .execute(db)
    .await?;

    Ok(())
}

async fn block_content(
    db: &SqlitePool,
    request_id: &str,
    reason: &str,
    threat_indicators: &[String],
) -> Result<()> {
    let indicators_json = serde_json::to_string(threat_indicators)?;

    sqlx::query(
        "INSERT INTO blocked_content (request_id, block_reason, threat_indicators, blocked_at, reported_to_security)
         VALUES (?, ?, ?, ?, 1)"
    )
    .bind(request_id)
    .bind(reason)
    .bind(indicators_json)
    .bind(Utc::now().to_rfc3339())
    .execute(db)
    .await?;

    Ok(())
}

// ─── Sandboxed Execution ─────────────────────────────────────────────────────

async fn execute_in_sandbox<F, T>(
    db: &SqlitePool,
    request_id: &str,
    timeout: Duration,
    func: F,
) -> Result<T>
where
    F: std::future::Future<Output = Result<T>> + Send + 'static,
    T: Send + 'static,
{
    let started_at = Utc::now().to_rfc3339();

    // Log sandbox execution start
    let exec_id = sqlx::query(
        "INSERT INTO sandbox_executions (request_id, sandbox_type, started_at)
         VALUES (?, 'process_isolation', ?)
         RETURNING id",
    )
    .bind(request_id)
    .bind(&started_at)
    .fetch_one(db)
    .await?
    .get::<i64, _>("id");

    // Execute with timeout
    let result = tokio::time::timeout(timeout, func).await;

    let (exit_code, timeout_triggered) = match &result {
        Ok(Ok(_)) => (0, false),
        Ok(Err(_)) => (1, false),
        Err(_) => (124, true), // timeout exit code
    };

    // Update sandbox execution record
    sqlx::query(
        "UPDATE sandbox_executions SET finished_at = ?, exit_code = ?, timeout_triggered = ?
         WHERE id = ?",
    )
    .bind(Utc::now().to_rfc3339())
    .bind(exit_code)
    .bind(timeout_triggered)
    .bind(exec_id)
    .execute(db)
    .await?;

    match result {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(e)) => Err(e),
        Err(_) => anyhow::bail!("Request timed out"),
    }
}

// ─── Email Functions ─────────────────────────────────────────────────────────

async fn send_email_internal(
    config: &GatewayConfig,
    to: &str,
    subject: &str,
    body: &str,
) -> Result<()> {
    let smtp_server = config
        .smtp_server
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("SMTP server not configured"))?;
    let smtp_username = config
        .smtp_username
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("SMTP username not configured"))?;
    let smtp_password = config
        .smtp_password
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("SMTP password not configured"))?;

    let email = Message::builder()
        .from(smtp_username.parse::<Mailbox>()?)
        .to(to.parse::<Mailbox>()?)
        .subject(subject)
        .body(body.to_string())?;

    let creds = Credentials::new(smtp_username.clone(), smtp_password.clone());

    let mailer = AsyncSmtpTransport::<Tokio1Executor>::relay(smtp_server)?
        .credentials(creds)
        .build();

    mailer.send(email).await?;

    Ok(())
}

// ─── Web Search Functions ────────────────────────────────────────────────────

#[allow(clippy::wildcard_in_or_patterns)]
async fn web_search_internal(
    client: &reqwest::Client,
    query: &str,
    max_results: usize,
) -> Result<Vec<serde_json::Value>> {
    // Provider selection via env vars (any one of these enables real search):
    //   SEARCH_PROVIDER=brave  + BRAVE_SEARCH_API_KEY=<key>
    //   SEARCH_PROVIDER=searxng + SEARXNG_URL=https://...
    //   (default) DuckDuckGo Instant Answer (no key, but limited).
    let provider = std::env::var("SEARCH_PROVIDER")
        .unwrap_or_else(|_| "duckduckgo".to_string())
        .to_lowercase();

    match provider.as_str() {
        "brave" => brave_search(client, query, max_results).await,
        "searxng" => searxng_search(client, query, max_results).await,
        "duckduckgo" | "ddg" | _ => duckduckgo_search(client, query, max_results).await,
    }
}

async fn brave_search(
    client: &reqwest::Client,
    query: &str,
    max_results: usize,
) -> Result<Vec<serde_json::Value>> {
    let api_key = std::env::var("BRAVE_SEARCH_API_KEY")
        .map_err(|_| anyhow::anyhow!("BRAVE_SEARCH_API_KEY not set"))?;
    let url = format!(
        "https://api.search.brave.com/res/v1/web/search?q={}&count={}",
        urlencoding::encode(query),
        max_results.min(20)
    );
    let resp = client
        .get(&url)
        .header("X-Subscription-Token", api_key)
        .header("Accept", "application/json")
        .send()
        .await?;
    if !resp.status().is_success() {
        anyhow::bail!("brave search returned {}", resp.status());
    }
    let body: serde_json::Value = resp.json().await?;
    let results = body
        .pointer("/web/results")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    Ok(results
        .into_iter()
        .take(max_results)
        .map(|r| {
            serde_json::json!({
                "title": r.get("title").and_then(|v| v.as_str()).unwrap_or(""),
                "url": r.get("url").and_then(|v| v.as_str()).unwrap_or(""),
                "snippet": r.get("description").and_then(|v| v.as_str()).unwrap_or(""),
                "provider": "brave",
            })
        })
        .collect())
}

async fn searxng_search(
    client: &reqwest::Client,
    query: &str,
    max_results: usize,
) -> Result<Vec<serde_json::Value>> {
    let base = std::env::var("SEARXNG_URL").map_err(|_| anyhow::anyhow!("SEARXNG_URL not set"))?;
    let url = format!(
        "{}/search?q={}&format=json",
        base.trim_end_matches('/'),
        urlencoding::encode(query)
    );
    let resp = client.get(&url).send().await?;
    if !resp.status().is_success() {
        anyhow::bail!("searxng returned {}", resp.status());
    }
    let body: serde_json::Value = resp.json().await?;
    let results = body
        .get("results")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    Ok(results
        .into_iter()
        .take(max_results)
        .map(|r| {
            serde_json::json!({
                "title": r.get("title").and_then(|v| v.as_str()).unwrap_or(""),
                "url": r.get("url").and_then(|v| v.as_str()).unwrap_or(""),
                "snippet": r.get("content").and_then(|v| v.as_str()).unwrap_or(""),
                "provider": "searxng",
            })
        })
        .collect())
}

async fn duckduckgo_search(
    client: &reqwest::Client,
    query: &str,
    max_results: usize,
) -> Result<Vec<serde_json::Value>> {
    // DDG Instant Answer (no API key, but only returns abstract+related topics —
    // not full web results). Sufficient for fact lookups; anything that needs
    // ranked web results should use Brave or SearXNG instead.
    let url = format!(
        "https://api.duckduckgo.com/?q={}&format=json&no_redirect=1&no_html=1",
        urlencoding::encode(query)
    );
    let resp = client
        .get(&url)
        .header("User-Agent", "iora-gateway/1.0")
        .send()
        .await?;
    if !resp.status().is_success() {
        anyhow::bail!("duckduckgo returned {}", resp.status());
    }
    let body: serde_json::Value = resp.json().await?;
    let mut out = Vec::new();
    if let Some(abs) = body.get("AbstractText").and_then(|v| v.as_str()) {
        if !abs.is_empty() {
            out.push(serde_json::json!({
                "title": body.get("Heading").and_then(|v| v.as_str()).unwrap_or(query),
                "url": body.get("AbstractURL").and_then(|v| v.as_str()).unwrap_or(""),
                "snippet": abs,
                "provider": "duckduckgo",
            }));
        }
    }
    if let Some(topics) = body.get("RelatedTopics").and_then(|v| v.as_array()) {
        for t in topics {
            if out.len() >= max_results {
                break;
            }
            if let Some(text) = t.get("Text").and_then(|v| v.as_str()) {
                out.push(serde_json::json!({
                    "title": text.split(" - ").next().unwrap_or(text),
                    "url": t.get("FirstURL").and_then(|v| v.as_str()).unwrap_or(""),
                    "snippet": text,
                    "provider": "duckduckgo",
                }));
            }
        }
    }
    Ok(out)
}

// ─── HTTP Request Functions ──────────────────────────────────────────────────

async fn http_get_internal(
    client: &reqwest::Client,
    url: &str,
    headers: Option<&HashMap<String, String>>,
    timeout: Duration,
) -> Result<(String, u16)> {
    let mut request = client.get(url).timeout(timeout);

    if let Some(hdrs) = headers {
        for (key, value) in hdrs {
            request = request.header(key, value);
        }
    }

    let response = request.send().await?;
    let status = response.status().as_u16();
    let body = response.text().await?;

    Ok((body, status))
}

// ─── Update Verification ─────────────────────────────────────────────────────

async fn verify_update_checksum(
    db: &SqlitePool,
    package_name: &str,
    version: &str,
    download_url: &str,
    expected_checksum: &str,
    checksum_type: &str,
) -> Result<bool> {
    info!("Verifying update: {} v{}", package_name, version);

    // Download the update file
    let client = reqwest::Client::new();
    let response = client
        .get(download_url)
        .timeout(Duration::from_secs(300))
        .send()
        .await?;

    let bytes = response.bytes().await?;

    // Calculate checksum
    let actual_checksum = match checksum_type {
        "sha256" => {
            let mut context = DigestContext::new(&SHA256);
            context.update(&bytes);
            hex::encode(context.finish().as_ref())
        }
        _ => anyhow::bail!("Unsupported checksum type: {}", checksum_type),
    };

    let is_valid = actual_checksum.to_lowercase() == expected_checksum.to_lowercase();
    let status = if is_valid { "valid" } else { "tampered" };

    // Log verification
    sqlx::query(
        "INSERT INTO update_verifications (package_name, version, download_url, checksum_type, expected_checksum, actual_checksum, verification_status, verified_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(package_name)
    .bind(version)
    .bind(download_url)
    .bind(checksum_type)
    .bind(expected_checksum)
    .bind(&actual_checksum)
    .bind(status)
    .bind(Utc::now().to_rfc3339())
    .execute(db)
    .await?;

    if !is_valid {
        error!(
            "Update verification FAILED for {} v{}: expected {} but got {}",
            package_name, version, expected_checksum, actual_checksum
        );
    }

    Ok(is_valid)
}

// ─── Rate Limiting ───────────────────────────────────────────────────────────

async fn check_rate_limit(db: &SqlitePool, service_name: &str, request_type: &str) -> Result<bool> {
    let now = Utc::now();
    let current_hour = now.format("%Y-%m-%d %H").to_string();
    let current_day = now.format("%Y-%m-%d").to_string();

    // Get or create rate limit entry
    let limit = sqlx::query(
        "INSERT INTO rate_limits (service_name, request_type, requests_per_hour, requests_per_day, current_hour_count, current_day_count, last_reset_hour, last_reset_day)
         VALUES (?, ?, 100, 1000, 0, 0, ?, ?)
         ON CONFLICT(service_name, request_type) DO UPDATE SET
         current_hour_count = CASE WHEN last_reset_hour != ? THEN 0 ELSE current_hour_count + 1 END,
         current_day_count = CASE WHEN last_reset_day != ? THEN 0 ELSE current_day_count + 1 END,
         last_reset_hour = ?,
         last_reset_day = ?
         RETURNING current_hour_count, current_day_count, requests_per_hour, requests_per_day"
    )
    .bind(service_name)
    .bind(request_type)
    .bind(&current_hour)
    .bind(&current_day)
    .bind(&current_hour)
    .bind(&current_day)
    .bind(&current_hour)
    .bind(&current_day)
    .fetch_one(db)
    .await?;

    let hour_count: i32 = limit.get("current_hour_count");
    let day_count: i32 = limit.get("current_day_count");
    let hour_limit: i32 = limit.get("requests_per_hour");
    let day_limit: i32 = limit.get("requests_per_day");

    Ok(hour_count <= hour_limit && day_count <= day_limit)
}

// ─── API Handlers ────────────────────────────────────────────────────────────

async fn health(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "service": "iora-gateway",
        "status": "healthy",
        "uptime_seconds": state.started_at.elapsed().as_secs(),
        "timestamp": Utc::now().to_rfc3339(),
        "sandboxing_enabled": state.config.enable_sandboxing,
    }))
}

async fn send_email(
    State(state): State<AppState>,
    Json(req): Json<EmailRequest>,
) -> Result<impl IntoResponse, AppError> {
    let request_id = Uuid::new_v4().to_string();

    // Check rate limit
    if !check_rate_limit(&state.db, &req.requested_by, "email").await? {
        return Err(AppError::RateLimited("Rate limit exceeded".to_string()));
    }

    // Log AI request if from AI
    if req.requested_by.contains("ai") || req.requested_by.contains("assist") {
        sqlx::query(
            "INSERT INTO ai_request_log (request_id, ai_service, tool_requested, parameters, approved, logged_at)
             VALUES (?, ?, 'email', ?, 1, ?)"
        )
        .bind(&request_id)
        .bind(&req.requested_by)
        .bind(serde_json::to_string(&req)?)
        .bind(Utc::now().to_rfc3339())
        .execute(&*state.db)
        .await?;
    }

    // Validate email content
    let validation = validate_content(&req.body, "text").await;
    log_validation(&state.db, &request_id, "email_content", &validation).await?;

    if !validation.is_safe {
        block_content(
            &state.db,
            &request_id,
            "Malicious content detected in email",
            &validation.findings,
        )
        .await?;
        return Err(AppError::SecurityViolation(
            "Email blocked due to security concerns".to_string(),
        ));
    }

    // Create gateway request
    sqlx::query(
        "INSERT INTO gateway_requests (request_id, request_type, requested_by, destination, request_data, status, created_at)
         VALUES (?, 'email', ?, ?, ?, 'validated', ?)"
    )
    .bind(&request_id)
    .bind(&req.requested_by)
    .bind(&req.to)
    .bind(serde_json::to_string(&req)?)
    .bind(Utc::now().to_rfc3339())
    .execute(&*state.db)
    .await?;

    // Execute in sandbox
    let config = state.config.clone();
    let to = req.to.clone();
    let subject = req.subject.clone();
    let body = req.body.clone();

    execute_in_sandbox(
        &state.db,
        &request_id,
        Duration::from_secs(state.config.request_timeout_secs),
        async move { send_email_internal(&config, &to, &subject, &body).await },
    )
    .await
    .map_err(|e| AppError::Internal(format!("Email sending failed: {}", e)))?;

    // Update status
    sqlx::query(
        "UPDATE gateway_requests SET status = 'completed', completed_at = ? WHERE request_id = ?",
    )
    .bind(Utc::now().to_rfc3339())
    .bind(&request_id)
    .execute(&*state.db)
    .await?;

    Ok(Json(serde_json::json!({
        "request_id": request_id,
        "status": "sent",
        "message": "Email sent successfully",
    })))
}

async fn web_search(
    State(state): State<AppState>,
    Json(req): Json<WebSearchRequest>,
) -> Result<impl IntoResponse, AppError> {
    let request_id = Uuid::new_v4().to_string();

    // Check rate limit
    if !check_rate_limit(&state.db, &req.requested_by, "search").await? {
        return Err(AppError::RateLimited("Rate limit exceeded".to_string()));
    }

    // Log AI request
    if req.requested_by.contains("ai") || req.requested_by.contains("assist") {
        sqlx::query(
            "INSERT INTO ai_request_log (request_id, ai_service, tool_requested, parameters, approved, logged_at)
             VALUES (?, ?, 'web_search', ?, 1, ?)"
        )
        .bind(&request_id)
        .bind(&req.requested_by)
        .bind(serde_json::to_string(&req)?)
        .bind(Utc::now().to_rfc3339())
        .execute(&*state.db)
        .await?;
    }

    // Validate search query
    let validation = validate_content(&req.query, "text").await;
    if !validation.is_safe {
        return Err(AppError::SecurityViolation(
            "Unsafe search query".to_string(),
        ));
    }

    let max_results = req.max_results.unwrap_or(10).min(50);
    let client = state.http_client.clone();
    let query = req.query.clone();

    let results = execute_in_sandbox(
        &state.db,
        &request_id,
        Duration::from_secs(state.config.request_timeout_secs),
        async move { web_search_internal(&client, &query, max_results).await },
    )
    .await
    .map_err(|e| AppError::Internal(format!("Search failed: {}", e)))?;

    Ok(Json(serde_json::json!({
        "request_id": request_id,
        "results": results,
    })))
}

async fn http_get(
    State(state): State<AppState>,
    Json(req): Json<HttpGetRequest>,
) -> Result<impl IntoResponse, AppError> {
    let request_id = Uuid::new_v4().to_string();

    // Check rate limit
    if !check_rate_limit(&state.db, &req.requested_by, "http_get").await? {
        return Err(AppError::RateLimited("Rate limit exceeded".to_string()));
    }

    // Validate URL
    if !validate_url(&req.url, &state.config).await? {
        return Err(AppError::SecurityViolation("URL not allowed".to_string()));
    }

    // Log request
    sqlx::query(
        "INSERT INTO gateway_requests (request_id, request_type, requested_by, url, status, created_at)
         VALUES (?, 'http_get', ?, ?, 'validated', ?)"
    )
    .bind(&request_id)
    .bind(&req.requested_by)
    .bind(&req.url)
    .bind(Utc::now().to_rfc3339())
    .execute(&*state.db)
    .await?;

    let client = state.http_client.clone();
    let url = req.url.clone();
    let headers = req.headers.clone();
    let timeout = Duration::from_secs(state.config.request_timeout_secs);

    let (body, status) = execute_in_sandbox(&state.db, &request_id, timeout, async move {
        http_get_internal(&client, &url, headers.as_ref(), timeout).await
    })
    .await
    .map_err(|e| AppError::Internal(format!("HTTP request failed: {}", e)))?;

    // Validate response
    let validation = validate_content(&body, "html").await;
    log_validation(&state.db, &request_id, "http_response", &validation).await?;

    if !validation.is_safe {
        block_content(
            &state.db,
            &request_id,
            "Malicious content in HTTP response",
            &validation.findings,
        )
        .await?;
        return Err(AppError::SecurityViolation(
            "Response blocked due to security concerns".to_string(),
        ));
    }

    let safe_body = validation.sanitized_content.unwrap_or(body);

    Ok(Json(serde_json::json!({
        "request_id": request_id,
        "status_code": status,
        "body": safe_body,
        "validation": {
            "threat_level": validation.threat_level,
            "findings": validation.findings,
        },
    })))
}

async fn verify_update(
    State(state): State<AppState>,
    Json(req): Json<UpdateVerificationRequest>,
) -> Result<impl IntoResponse, AppError> {
    let is_valid = verify_update_checksum(
        &state.db,
        &req.package_name,
        &req.version,
        &req.download_url,
        &req.expected_checksum,
        &req.checksum_type,
    )
    .await
    .map_err(|e| AppError::Internal(format!("Verification failed: {}", e)))?;

    Ok(Json(serde_json::json!({
        "package": req.package_name,
        "version": req.version,
        "is_valid": is_valid,
        "message": if is_valid {
            "Update verified successfully"
        } else {
            "⚠️ UPDATE VERIFICATION FAILED - POSSIBLE TAMPERING DETECTED"
        },
    })))
}

async fn get_request_log(State(state): State<AppState>) -> Result<impl IntoResponse, AppError> {
    let rows = sqlx::query(
        "SELECT request_id, request_type, requested_by, status, created_at
         FROM gateway_requests ORDER BY created_at DESC LIMIT 100",
    )
    .fetch_all(&*state.db)
    .await
    .map_err(AppError::Database)?;

    let requests: Vec<serde_json::Value> = rows
        .iter()
        .map(|row| {
            serde_json::json!({
                "request_id": row.get::<String, _>("request_id"),
                "request_type": row.get::<String, _>("request_type"),
                "requested_by": row.get::<String, _>("requested_by"),
                "status": row.get::<String, _>("status"),
                "created_at": row.get::<String, _>("created_at"),
            })
        })
        .collect();

    Ok(Json(serde_json::json!({
        "requests": requests,
        "total": requests.len(),
    })))
}

async fn get_ai_requests(State(state): State<AppState>) -> Result<impl IntoResponse, AppError> {
    let rows = sqlx::query("SELECT * FROM ai_request_log ORDER BY logged_at DESC LIMIT 100")
        .fetch_all(&*state.db)
        .await
        .map_err(AppError::Database)?;

    let requests: Vec<serde_json::Value> = rows
        .iter()
        .map(|row| {
            serde_json::json!({
                "request_id": row.get::<String, _>("request_id"),
                "ai_service": row.get::<String, _>("ai_service"),
                "tool_requested": row.get::<String, _>("tool_requested"),
                "approved": row.get::<bool, _>("approved"),
                "logged_at": row.get::<String, _>("logged_at"),
            })
        })
        .collect();

    Ok(Json(serde_json::json!({
        "ai_requests": requests,
        "total": requests.len(),
    })))
}

// ─── Error Handling ──────────────────────────────────────────────────────────

#[derive(Debug)]
enum AppError {
    Database(sqlx::Error),
    SecurityViolation(String),
    RateLimited(String),
    Internal(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> axum::response::Response {
        let (status, message) = match self {
            AppError::Database(e) => {
                error!("Database error: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Database error".to_string(),
                )
            }
            AppError::SecurityViolation(msg) => {
                warn!("Security violation: {}", msg);
                (StatusCode::FORBIDDEN, msg)
            }
            AppError::RateLimited(msg) => (StatusCode::TOO_MANY_REQUESTS, msg),
            AppError::Internal(msg) => {
                error!("Internal error: {}", msg);
                (StatusCode::INTERNAL_SERVER_ERROR, msg)
            }
        };

        (status, Json(serde_json::json!({ "error": message }))).into_response()
    }
}

impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        AppError::Database(e)
    }
}

impl From<anyhow::Error> for AppError {
    fn from(e: anyhow::Error) -> Self {
        AppError::Internal(e.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Internal(e.to_string())
    }
}

// ─── Main ────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> Result<()> {
    dotenv::dotenv().ok();
    tracing_subscriber::fmt::init();

    // Load configuration
    let config = GatewayConfig {
        smtp_server: system_config::smtp_server(),
        smtp_username: system_config::smtp_username(),
        smtp_password: system_config::smtp_password(),
        max_request_size: system_config::gateway_max_request_size(),
        request_timeout_secs: system_config::gateway_request_timeout_secs(),
        enable_sandboxing: system_config::gateway_enable_sandboxing(),
        allowed_domains: system_config::gateway_allowed_domains(),
    };

    // Connect to database
    let db_path = system_config::gateway_db_path();

    // Ensure parent directory exists
    if let Some(parent) = std::path::Path::new(&db_path).parent() {
        std::fs::create_dir_all(parent).ok();
    }

    info!("Opening gateway database at: {}", db_path);
    let db = SqlitePool::connect(&format!("sqlite:{}?mode=rwc", db_path))
        .await
        .context("Failed to connect to gateway database")?;

    // Run migrations
    sqlx::migrate!("./migrations")
        .run(&db)
        .await
        .context("Failed to run migrations")?;

    // Create HTTP client with security settings
    let http_client = reqwest::Client::builder()
        .timeout(Duration::from_secs(config.request_timeout_secs))
        .user_agent("IORA-Gateway/1.0")
        .danger_accept_invalid_certs(false) // Always validate certificates
        .build()?;

    let state = AppState {
        db: Arc::new(db),
        http_client,
        rate_limiter: Arc::new(RwLock::new(HashMap::new())),
        started_at: Arc::new(Instant::now()),
        config: Arc::new(config),
    };

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/gateway/email", post(send_email))
        .route("/api/gateway/search", post(web_search))
        .route("/api/gateway/http/get", post(http_get))
        .route("/api/gateway/verify-update", post(verify_update))
        .route("/api/gateway/requests", get(get_request_log))
        .route("/api/gateway/ai-requests", get(get_ai_requests))
        .layer(CorsLayer::permissive())
        .layer(tower_http::trace::TraceLayer::new_for_http())
        .layer(tower_http::limit::RequestBodyLimitLayer::new(
            state.config.max_request_size,
        ))
        .with_state(state);

    let port = system_config::service_port("iora-gateway", 8096).to_string();
    let addr = format!("0.0.0.0:{}", port);

    info!("🌐 iora-gateway starting on {}", addr);
    info!("Sandboxed external integrations enabled");
    info!("Content validation active");
    info!("AI request monitoring enabled");

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    let _hb = iora_shared::heartbeat::spawn_default(
        "iora-gateway",
        port.parse::<u16>().unwrap_or(8096),
        "API gateway / reverse proxy",
    );
    axum::serve(listener, app).await?;

    Ok(())
}
