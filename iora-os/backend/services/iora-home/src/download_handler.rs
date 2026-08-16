//! Universal Download Manager (Package 6).
//!
//! Downloads run in the backend as system jobs: the browser/UI only starts
//! them, the file streams server-side and lands in the user's personal
//! Downloads folder — surviving tab closes and app switches. The Job Center
//! shows progress, pause/cancel and history automatically because downloads
//! are regular `system_jobs` (job_type `download`).
//!
//! API:
//!   POST /api/downloads            { url, filename? } → start a download job
//!   GET  /api/downloads            → the user's download jobs
//!   POST /api/downloads/:job_id/cancel → cancel a download job

use axum::{
    extract::{Extension, Path as AxumPath, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use tracing::{debug, warn};
use uuid::Uuid;

use crate::middleware::AuthIdentity;

/// Row shape of the download job listing query.
type DownloadJobRow = (
    String,
    String,
    String,
    i32,
    String,
    serde_json::Value,
    chrono::DateTime<chrono::Utc>,
    Option<chrono::DateTime<chrono::Utc>>,
);
use crate::AppState;
use crate::ErrorResponse;

/// Request body for starting a download.
#[derive(Debug, Deserialize)]
pub struct StartDownloadRequest {
    pub url: String,
    #[serde(default)]
    pub filename: Option<String>,
}

/// Guard against SSRF: allow http/https, block loopback and link-local hosts.
/// Private LAN ranges stay allowed — a home OS downloads from its NAS.
fn url_is_safe(url: &str) -> bool {
    let Ok(parsed) = reqwest::Url::parse(url) else {
        return false;
    };
    if !matches!(parsed.scheme(), "http" | "https") {
        return false;
    }
    let Some(host) = parsed.host_str() else {
        return false;
    };
    let host = host.trim_end_matches('.').to_lowercase();
    if host == "localhost" || host.ends_with(".localhost") {
        return false;
    }
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        if ip.is_loopback() || ip.is_multicast() || ip.is_unspecified() {
            return false;
        }
    }
    true
}

/// Build a minimal multipart body by hand (reqwest here has no multipart
/// feature; axum's Multipart extractor on the iora-files side accepts this).
fn multipart_body(boundary: &str, filename: &str, folder_id: Option<&str>, data: &[u8]) -> Vec<u8> {
    let safe_name = filename
        .chars()
        .filter(|c| !matches!(c, '\r' | '\n' | '"'))
        .take(200)
        .collect::<String>();
    let mut body = Vec::new();
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{safe_name}\"\r\nContent-Type: application/octet-stream\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(data);
    body.extend_from_slice(b"\r\n");
    if let Some(folder_id) = folder_id {
        body.extend_from_slice(
            format!("--{boundary}\r\nContent-Disposition: form-data; name=\"folder_id\"\r\n\r\n{folder_id}\r\n").as_bytes(),
        );
    }
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    body
}

/// POST /api/downloads — start a backend download into the user's Downloads.
pub async fn start_download(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthIdentity>,
    headers: axum::http::HeaderMap,
    Json(body): Json<StartDownloadRequest>,
) -> Result<(StatusCode, Json<Value>), ErrorResponse> {
    let url = body.url.trim().to_string();
    if !url_is_safe(&url) {
        return Err(ErrorResponse::bad_request(
            "invalid or blocked URL (only http/https, no loopback hosts)",
        ));
    }
    let user_id = identity.user_id().to_string();

    // The background task needs the user's token to upload into iora-files.
    let token = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(|value| value.to_string())
        .unwrap_or_default();

    // Resolve the personal Downloads folder (create on first use).
    let files_base = crate::microservice_url("IORA_FILES_URL", "iora-files", 8100);
    let folder = fetch_or_create_downloads_folder(&files_base, &token).await;

    // Create the system job.
    let job_id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO system_jobs (id, name, job_type, status, progress, message, source, metadata, created_by) \
         VALUES ($1, $2, 'download', 'queued', 0, '', 'downloads', $3, $4)",
    )
    .bind(&job_id)
    .bind(body.filename.as_deref().unwrap_or("Download").to_string())
    .bind(json!({ "url": url, "folder_id": folder.as_ref().map(|f| f.0.clone()) }))
    .bind(&user_id)
    .execute(&state.db_pool)
    .await
    .map_err(|e| ErrorResponse::internal(format!("failed to create download job: {e}")))?;

    // Spawn the background download task (survives the request).
    let db = state.db_pool.clone();
    let task_job_id = job_id.clone();
    let task_user_id = user_id.clone();
    let task_url = url.clone();
    let task_filename = body.filename.clone();
    let task_token = token;
    let task_folder = folder.clone();
    tokio::spawn(async move {
        run_download_task(
            &db,
            &task_job_id,
            &task_user_id,
            &task_url,
            task_filename.as_deref(),
            &task_token,
            task_folder.as_ref(),
            &files_base,
        )
        .await;
    });

    Ok((
        StatusCode::ACCEPTED,
        Json(json!({ "job_id": job_id, "status": "queued", "url": url })),
    ))
}

/// Resolve the user's Downloads folder id via iora-files (create on first use).
async fn fetch_or_create_downloads_folder(
    files_base: &str,
    token: &str,
) -> Option<(String, String)> {
    let client = reqwest::Client::new();
    let url = format!("{files_base}/api/files/system-folder?name=Downloads");
    let mut request = client.get(&url).timeout(std::time::Duration::from_secs(5));
    if !token.is_empty() {
        request = request.bearer_auth(token);
    }
    match request.send().await {
        Ok(response) if response.status().is_success() => {
            let data: serde_json::Value = response.json().await.ok()?;
            let folder = data.get("folder")?;
            Some((
                folder.get("id")?.as_str()?.to_string(),
                folder.get("name")?.as_str()?.to_string(),
            ))
        }
        _ => None,
    }
}

/// Background download: stream → temp file → upload to iora-files → job done.
#[allow(clippy::too_many_arguments)] // internal task parameter bundle; not a public API
async fn run_download_task(
    db: &sqlx::PgPool,
    job_id: &str,
    user_id: &str,
    url: &str,
    filename: Option<&str>,
    token: &str,
    folder: Option<&(String, String)>,
    files_base: &str,
) {
    let client = reqwest::Client::new();
    let _ = sqlx::query("UPDATE system_jobs SET status = 'running', started_at = NOW(), updated_at = NOW() WHERE id = $1")
        .bind(job_id)
        .execute(db)
        .await;

    let result: Result<serde_json::Value, String> = async {
        let response = client
            .get(url)
            .send()
            .await
            .map_err(|e| format!("download failed: {e}"))?;
        if !response.status().is_success() {
            return Err(format!("download returned HTTP {}", response.status()));
        }
        let total = response.content_length().unwrap_or(0);
        let filename = filename
            .filter(|f| !f.trim().is_empty())
            .map(|f| f.to_string())
            .or_else(|| {
                url.split('/')
                    .next_back()
                    .filter(|part| part.contains('.'))
                    .map(|part| part.to_string())
            })
            .unwrap_or_else(|| format!("download-{}.bin", chrono::Utc::now().timestamp()));

        let mut stream = response.bytes_stream();
        let mut downloaded: u64 = 0;
        let mut buffer: Vec<u8> = Vec::new();
        use futures_util::StreamExt;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("stream error: {e}"))?;
            downloaded += chunk.len() as u64;
            buffer.extend_from_slice(&chunk);
            if total > 0 {
                let progress = ((downloaded as f64 / total as f64) * 100.0).round() as i32;
                let _ = sqlx::query(
                    "UPDATE system_jobs SET progress = $1, message = $2, updated_at = NOW() WHERE id = $3",
                )
                .bind(progress.clamp(0, 100))
                .bind(format!("{}/{}", bytes_human(downloaded), bytes_human(total)))
                .bind(job_id)
                .execute(db)
                .await;
            }
        }

        // Honour cancellation: skip the upload if the user cancelled.
        let cancelled: Option<(String,)> = sqlx::query_as(
            "SELECT status FROM system_jobs WHERE id = $1",
        )
        .bind(job_id)
        .fetch_optional(db)
        .await
        .ok()
        .flatten();
        if cancelled.as_ref().map(|c| c.0.as_str()) == Some("cancelled") {
            return Ok(json!({ "cancelled": true }));
        }

        // Upload into the user's Downloads folder (multipart, hand-built).
        if let Some((folder_id, folder_name)) = folder {
            let boundary = format!("----iora{}", Uuid::new_v4().simple());
            let body = multipart_body(&boundary, &filename, Some(folder_id), &buffer);
            let mut request = client
                .post(format!("{files_base}/api/files/upload"))
                .header(
                    "content-type",
                    format!("multipart/form-data; boundary={boundary}"),
                )
                .timeout(std::time::Duration::from_secs(120));
            if !token.is_empty() {
                request = request.bearer_auth(token);
            }
            let upload = request.body(body).send().await;
            match upload {
                Ok(response) if response.status().is_success() => {
                    let data: serde_json::Value = response.json().await.unwrap_or_else(|_| json!({}));
                    let file_id = data.get("file_id").or_else(|| data.get("id")).and_then(|v| v.as_str());
                    Ok(json!({
                        "file_id": file_id,
                        "folder_id": folder_id,
                        "folder_name": folder_name,
                    }))
                }
                Ok(response) => Err(format!("upload to files failed: HTTP {}", response.status())),
                Err(e) => Err(format!("upload to files failed: {e}")),
            }
        } else {
            Err("could not resolve the Downloads folder".to_string())
        }
    }
    .await;

    match result {
        Ok(meta) => {
            let _ = sqlx::query(
                "UPDATE system_jobs SET status = 'completed', progress = 100, message = 'Downloaded into Downloads', metadata = $2, finished_at = NOW(), updated_at = NOW() WHERE id = $1",
            )
            .bind(job_id)
            .bind(&meta)
            .execute(db)
            .await;
            debug!("download job {job_id} finished for user {user_id}");
        }
        Err(e) => {
            warn!("download job {job_id} failed: {e}");
            let _ = sqlx::query(
                "UPDATE system_jobs SET status = 'failed', message = $2, finished_at = NOW(), updated_at = NOW() WHERE id = $1",
            )
            .bind(job_id)
            .bind(&e)
            .execute(db)
            .await;
        }
    }
}

fn bytes_human(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut amount = bytes as f64;
    let mut unit = 0;
    while amount >= 1024.0 && unit < UNITS.len() - 1 {
        amount /= 1024.0;
        unit += 1;
    }
    format!("{:.1}{}", amount, UNITS[unit])
}

/// GET /api/downloads — the user's download jobs (newest first).
pub async fn list_downloads(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthIdentity>,
) -> Result<Json<Value>, ErrorResponse> {
    let user_id = identity.user_id();
    let rows: Vec<DownloadJobRow> = sqlx::query_as(
        "SELECT id, name, status, progress, message, metadata, created_at, finished_at \
         FROM system_jobs WHERE created_by = $1 AND job_type = 'download' \
         ORDER BY created_at DESC LIMIT 50",
    )
    .bind(user_id)
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| ErrorResponse::internal(format!("failed to list downloads: {e}")))?;

    let downloads: Vec<Value> = rows
        .iter()
        .map(
            |(id, name, status, progress, message, metadata, created_at, finished_at)| {
                json!({
                    "id": id,
                    "name": name,
                    "status": status,
                    "progress": progress,
                    "message": message,
                    "url": metadata.get("url"),
                    "file_id": metadata.get("file_id"),
                    "folder_name": metadata.get("folder_name"),
                    "created_at": created_at,
                    "finished_at": finished_at,
                })
            },
        )
        .collect();
    Ok(Json(json!({ "downloads": downloads })))
}

/// POST /api/downloads/:job_id/cancel — cancel a queued/running download.
pub async fn cancel_download(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthIdentity>,
    AxumPath(job_id): AxumPath<String>,
) -> Result<Json<Value>, ErrorResponse> {
    let user_id = identity.user_id();
    let affected = sqlx::query(
        "UPDATE system_jobs SET status = 'cancelled', finished_at = NOW(), updated_at = NOW() \
         WHERE id = $1 AND created_by = $2 AND job_type = 'download' AND status NOT IN ('completed', 'failed', 'cancelled')",
    )
    .bind(&job_id)
    .bind(user_id)
    .execute(&state.db_pool)
    .await
    .map_err(|e| ErrorResponse::internal(format!("failed to cancel download: {e}")))?
    .rows_affected();

    if affected == 0 {
        return Err(ErrorResponse::not_found(format!(
            "download job {job_id} not found or already finished"
        )));
    }
    Ok(Json(json!({ "cancelled": true, "job_id": job_id })))
}
