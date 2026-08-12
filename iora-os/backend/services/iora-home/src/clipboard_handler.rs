//! Clipboard Manager Handler – personal clipboard history per user.
//!
//! API endpoints (all scoped to the authenticated user):
//!   GET    /api/clipboard?limit=50 – List history (newest first, pinned on top)
//!   POST   /api/clipboard          – Add an entry (deduplicates by content)
//!   POST   /api/clipboard/:id/pin  – Toggle the pinned flag
//!   DELETE /api/clipboard/:id      – Remove one entry
//!   DELETE /api/clipboard          – Clear the user's history
//!
//! The frontend captures copy/cut events and posts them here; the Clipboard
//! panel (Ctrl+Shift+V) lists, pins, searches and re-copies entries. Content
//! is capped at 64 KiB and empty payloads are rejected.

use axum::{
    extract::{Extension, Path as AxumPath, Query, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use tracing::warn;
use uuid::Uuid;

use iora_shared::clipboard::{AddClipboardRequest, MAX_CLIPBOARD_CONTENT_LEN};

use crate::middleware::AuthIdentity;
use crate::{AppState, ErrorResponse};

/// Row layout: id, content, content_type, source, created_by, pinned, created_at.
type ClipboardRow = (String, String, String, String, String, bool, DateTime<Utc>);

const CLIPBOARD_SELECT: &str =
    "SELECT id, content, content_type, source, created_by, pinned, created_at \
     FROM clipboard_entries";

fn row_to_value(row: &ClipboardRow) -> Value {
    json!({
        "id": row.0,
        "content": row.1,
        "content_type": row.2,
        "source": row.3,
        "created_by": row.4,
        "pinned": row.5,
        "created_at": row.6,
    })
}

/// GET /api/clipboard?limit=50
pub async fn list_clipboard(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthIdentity>,
    Query(params): Query<ClipboardListParams>,
) -> Result<Json<Value>, ErrorResponse> {
    let user_id = identity.user_id();
    let limit = params.limit.unwrap_or(50).clamp(1, 200);

    let result = sqlx::query_as::<_, ClipboardRow>(&format!(
        "{CLIPBOARD_SELECT} WHERE created_by = $1 ORDER BY pinned DESC, created_at DESC LIMIT $2"
    ))
    .bind(user_id)
    .bind(limit as i64)
    .fetch_all(&state.db_pool)
    .await;

    match result {
        Ok(rows) => {
            let entries: Vec<Value> = rows.iter().map(row_to_value).collect();
            Ok(Json(json!({ "entries": entries })))
        }
        Err(e) => {
            warn!("Failed to list clipboard entries: {}", e);
            Err(ErrorResponse::internal(format!(
                "failed to list clipboard: {e}"
            )))
        }
    }
}

/// POST /api/clipboard
pub async fn add_clipboard_entry(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthIdentity>,
    Json(body): Json<AddClipboardRequest>,
) -> Result<(StatusCode, Json<Value>), ErrorResponse> {
    let user_id = identity.user_id().to_string();
    let content = body.content.trim().to_string();

    if content.is_empty() {
        return Err(ErrorResponse::bad_request(
            "clipboard content must not be empty",
        ));
    }
    if content.len() > MAX_CLIPBOARD_CONTENT_LEN {
        return Err(ErrorResponse::bad_request(format!(
            "clipboard content exceeds the {MAX_CLIPBOARD_CONTENT_LEN}-byte limit"
        )));
    }

    // Deduplicate: an identical existing entry moves to the top instead of
    // creating a duplicate row.
    let existing: Option<(String,)> = sqlx::query_as(
        "SELECT id FROM clipboard_entries WHERE created_by = $1 AND content = $2 LIMIT 1",
    )
    .bind(&user_id)
    .bind(&content)
    .fetch_optional(&state.db_pool)
    .await
    .map_err(|e| ErrorResponse::internal(format!("failed to look up clipboard entry: {e}")))?;

    let id =
        match existing {
            Some((existing_id,)) => {
                sqlx::query("UPDATE clipboard_entries SET created_at = NOW() WHERE id = $1")
                    .bind(&existing_id)
                    .execute(&state.db_pool)
                    .await
                    .map_err(|e| {
                        ErrorResponse::internal(format!("failed to touch clipboard entry: {e}"))
                    })?;
                existing_id
            }
            None => {
                let new_id = Uuid::new_v4().to_string();
                sqlx::query(
                "INSERT INTO clipboard_entries (id, content, content_type, source, created_by) \
                 VALUES ($1, $2, $3, $4, $5)",
            )
            .bind(&new_id)
            .bind(&content)
            .bind(&body.content_type)
            .bind(&body.source)
            .bind(&user_id)
            .execute(&state.db_pool)
            .await
            .map_err(|e| ErrorResponse::internal(format!("failed to store clipboard entry: {e}")))?;
                new_id
            }
        };

    let row = sqlx::query_as::<_, ClipboardRow>(&format!("{CLIPBOARD_SELECT} WHERE id = $1"))
        .bind(&id)
        .fetch_one(&state.db_pool)
        .await
        .map_err(|e| ErrorResponse::internal(format!("failed to reload clipboard entry: {e}")))?;

    Ok((StatusCode::CREATED, Json(row_to_value(&row))))
}

/// POST /api/clipboard/:id/pin — toggle the pinned flag.
pub async fn toggle_clipboard_pin(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthIdentity>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Value>, ErrorResponse> {
    let user_id = identity.user_id();

    let current: Option<(bool,)> =
        sqlx::query_as("SELECT pinned FROM clipboard_entries WHERE id = $1 AND created_by = $2")
            .bind(&id)
            .bind(user_id)
            .fetch_optional(&state.db_pool)
            .await
            .map_err(|e| ErrorResponse::internal(format!("failed to load clipboard entry: {e}")))?;

    let Some((pinned,)) = current else {
        return Err(ErrorResponse::not_found(format!(
            "clipboard entry {id} not found"
        )));
    };

    sqlx::query("UPDATE clipboard_entries SET pinned = $1 WHERE id = $2")
        .bind(!pinned)
        .bind(&id)
        .execute(&state.db_pool)
        .await
        .map_err(|e| ErrorResponse::internal(format!("failed to update clipboard entry: {e}")))?;

    Ok(Json(json!({ "id": id, "pinned": !pinned })))
}

/// DELETE /api/clipboard/:id — remove one of the user's entries.
pub async fn delete_clipboard_entry(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthIdentity>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Value>, ErrorResponse> {
    let user_id = identity.user_id();

    let affected = sqlx::query("DELETE FROM clipboard_entries WHERE id = $1 AND created_by = $2")
        .bind(&id)
        .bind(user_id)
        .execute(&state.db_pool)
        .await
        .map_err(|e| ErrorResponse::internal(format!("failed to delete clipboard entry: {e}")))?
        .rows_affected();

    if affected == 0 {
        return Err(ErrorResponse::not_found(format!(
            "clipboard entry {id} not found"
        )));
    }
    Ok(Json(json!({ "deleted": true })))
}

/// DELETE /api/clipboard — clear the user's clipboard history.
pub async fn clear_clipboard(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthIdentity>,
) -> Result<Json<Value>, ErrorResponse> {
    let user_id = identity.user_id();

    let affected = sqlx::query("DELETE FROM clipboard_entries WHERE created_by = $1")
        .bind(user_id)
        .execute(&state.db_pool)
        .await
        .map_err(|e| ErrorResponse::internal(format!("failed to clear clipboard: {e}")))?
        .rows_affected();

    Ok(Json(json!({ "deleted": affected })))
}

#[derive(Deserialize)]
pub struct ClipboardListParams {
    pub limit: Option<i32>,
}
