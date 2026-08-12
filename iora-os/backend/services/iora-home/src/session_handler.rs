//! Session Restore Handler – persist open OS windows per user.
//!
//! API endpoints (scoped to the authenticated user):
//!   GET  /api/session/windows – Load the user's persisted window set
//!   PUT  /api/session/windows – Replace the user's persisted window set
//!   DELETE /api/session/windows – Clear the user's persisted window set
//!
//! The frontend saves the window manager state (debounced, and flushed on
//! pagehide) and restores it on boot so the desktop comes back after login
//! or reload. localStorage is the offline fallback client-side.

use axum::{
    extract::{Extension, State},
    Json,
};
use serde_json::{json, Value};
use tracing::warn;

use iora_shared::session::{SaveSessionWindowsRequest, SessionWindow};

use crate::middleware::AuthIdentity;
use crate::{AppState, ErrorResponse};

/// Row layout: user_id, page_id, layout, x, y, width, height, z, minimized.
type SessionRow = (String, String, String, i32, i32, i32, i32, i32, bool);

const SESSION_SELECT: &str = "SELECT user_id, page_id, layout, x, y, width, height, z, minimized \
                              FROM session_windows";

/// GET /api/session/windows
pub async fn get_session_windows(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthIdentity>,
) -> Result<Json<Value>, ErrorResponse> {
    let user_id = identity.user_id();

    let result = sqlx::query_as::<_, SessionRow>(&format!(
        "{SESSION_SELECT} WHERE user_id = $1 ORDER BY z ASC"
    ))
    .bind(user_id)
    .fetch_all(&state.db_pool)
    .await;

    match result {
        Ok(rows) => {
            let windows: Vec<Value> = rows
                .iter()
                .map(|r| {
                    json!({
                        "page_id": r.1,
                        "layout": r.2,
                        "x": r.3,
                        "y": r.4,
                        "width": r.5,
                        "height": r.6,
                        "z": r.7,
                        "minimized": r.8,
                    })
                })
                .collect();
            Ok(Json(json!({ "windows": windows })))
        }
        Err(e) => {
            warn!("Failed to load session windows: {}", e);
            Err(ErrorResponse::internal(format!(
                "failed to load session: {e}"
            )))
        }
    }
}

/// PUT /api/session/windows — replace the user's persisted window set.
pub async fn save_session_windows(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthIdentity>,
    Json(body): Json<SaveSessionWindowsRequest>,
) -> Result<Json<Value>, ErrorResponse> {
    let user_id = identity.user_id().to_string();

    // Cap the window count to keep the table tidy (a desktop has ≤ 16 windows).
    let windows: Vec<SessionWindow> = body.windows.into_iter().take(16).collect();

    let mut tx = state
        .db_pool
        .begin()
        .await
        .map_err(|e| ErrorResponse::internal(format!("failed to begin transaction: {e}")))?;

    sqlx::query("DELETE FROM session_windows WHERE user_id = $1")
        .bind(&user_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| ErrorResponse::internal(format!("failed to clear session: {e}")))?;

    for window in &windows {
        sqlx::query(
            "INSERT INTO session_windows (user_id, page_id, layout, x, y, width, height, z, minimized) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        )
        .bind(&user_id)
        .bind(&window.page_id)
        .bind(&window.layout)
        .bind(window.x)
        .bind(window.y)
        .bind(window.width)
        .bind(window.height)
        .bind(window.z)
        .bind(window.minimized)
        .execute(&mut *tx)
        .await
        .map_err(|e| ErrorResponse::internal(format!("failed to store session window: {e}")))?;
    }

    tx.commit()
        .await
        .map_err(|e| ErrorResponse::internal(format!("failed to commit session: {e}")))?;

    Ok(Json(json!({ "saved": windows.len() })))
}

/// DELETE /api/session/windows — clear the user's persisted window set.
pub async fn clear_session_windows(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthIdentity>,
) -> Result<Json<Value>, ErrorResponse> {
    let user_id = identity.user_id();

    let affected = sqlx::query("DELETE FROM session_windows WHERE user_id = $1")
        .bind(user_id)
        .execute(&state.db_pool)
        .await
        .map_err(|e| ErrorResponse::internal(format!("failed to clear session: {e}")))?
        .rows_affected();

    Ok(Json(json!({ "deleted": affected })))
}
