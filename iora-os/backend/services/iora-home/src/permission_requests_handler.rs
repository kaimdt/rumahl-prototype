//! Permission Requests Handler – Android/iOS-style runtime permission
//! dialogs for the OS shell.
//!
//! API endpoints (scoped to the authenticated user):
//!   GET  /api/os/permissions/catalog
//!        – All OS permissions with English descriptions (UI translates).
//!   POST /api/os/permissions/request
//!        – Create a pending request (idempotent per permission: an existing
//!          pending request for the same permission is returned).
//!   GET  /api/os/permissions/requests?status=pending
//!        – List the user's requests.
//!   POST /api/os/permissions/requests/:id/respond
//!        – Answer with Allow/Deny. Approving upserts the grant into
//!          `user_os_permissions` so `effective_os_permissions` sees it.
//!
//! The shell polls pending requests while no dialog is open and shows them
//! one at a time (oldest first).

use axum::{
    extract::{Extension, Path as AxumPath, Query, State},
    http::StatusCode,
    Json,
};
use chrono::Utc;
use serde::Deserialize;
use serde_json::{json, Value};
use tracing::warn;
use uuid::Uuid;

use iora_shared::permission_requests::{
    CreatePermissionRequest, PermissionRequestStatus, RespondPermissionRequest,
};

use crate::middleware::AuthIdentity;
use crate::{AppState, ErrorResponse};

/// Catalog of OS permissions with short English descriptions. The frontend
/// renders translated labels via `permissions.catalog.<id>` i18n keys.
const OS_PERMISSION_CATALOG: [(&str, &str); 8] = [
    ("os.files.read", "Read files"),
    ("os.files.write", "Write files"),
    ("os.network.read", "Read network status"),
    ("os.network.write", "Modify network settings"),
    ("os.system.read", "Read system information"),
    ("os.power", "Power the system on/off"),
    ("os.updates", "Manage updates"),
    ("os.backups", "Manage backups"),
];

/// Row layout: id, user_id, permission, requester, scope, reason, status,
/// created_at, responded_at, responded_by.
type RequestRow = (
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    chrono::DateTime<Utc>,
    Option<chrono::DateTime<Utc>>,
    Option<String>,
);

const REQUEST_SELECT: &str = "SELECT id, user_id, permission, requester, scope, reason, status, \
                              created_at, responded_at, responded_by \
                              FROM permission_requests";

fn row_to_value(row: &RequestRow) -> Value {
    json!({
        "id": row.0,
        "user_id": row.1,
        "permission": row.2,
        "requester": row.3,
        "scope": row.4,
        "reason": row.5,
        "status": row.6,
        "created_at": row.7,
        "responded_at": row.8,
        "responded_by": row.9,
    })
}

/// GET /api/os/permissions/catalog
pub async fn get_permission_catalog() -> Json<Value> {
    let catalog: Vec<Value> = OS_PERMISSION_CATALOG
        .iter()
        .map(|(id, description)| json!({ "id": id, "description": description }))
        .collect();
    Json(json!({ "permissions": catalog }))
}

/// POST /api/os/permissions/request
pub async fn create_permission_request(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthIdentity>,
    Json(body): Json<CreatePermissionRequest>,
) -> Result<(StatusCode, Json<Value>), ErrorResponse> {
    let user_id = identity.user_id();

    if !OS_PERMISSION_CATALOG
        .iter()
        .any(|(id, _)| *id == body.permission)
    {
        return Err(ErrorResponse::bad_request(format!(
            "unknown OS permission '{}'",
            body.permission
        )));
    }

    // The user may not request a permission they already hold (admin or grant).
    let already_has = super::user_has_os_permission(&state, user_id, &body.permission).await?;
    if already_has {
        return Err(ErrorResponse::conflict(format!(
            "permission '{}' is already granted",
            body.permission
        )));
    }

    // Idempotent: reuse an existing pending request for the same permission.
    let existing: Option<(String,)> = sqlx::query_as(
        "SELECT id FROM permission_requests \
         WHERE user_id = $1 AND permission = $2 AND status = 'pending' LIMIT 1",
    )
    .bind(user_id)
    .bind(&body.permission)
    .fetch_optional(&state.db_pool)
    .await
    .map_err(|e| ErrorResponse::internal(format!("failed to look up request: {e}")))?;

    let id = match existing {
        Some((existing_id,)) => existing_id,
        None => {
            let new_id = Uuid::new_v4().to_string();
            sqlx::query(
                "INSERT INTO permission_requests (id, user_id, permission, requester, scope, reason, status) \
                 VALUES ($1, $2, $3, $4, $5, $6, 'pending')",
            )
            .bind(&new_id)
            .bind(user_id)
            .bind(&body.permission)
            .bind(&body.requester)
            .bind(&body.scope)
            .bind(&body.reason)
            .execute(&state.db_pool)
            .await
            .map_err(|e| ErrorResponse::internal(format!("failed to create request: {e}")))?;
            new_id
        }
    };

    let row = sqlx::query_as::<_, RequestRow>(&format!("{REQUEST_SELECT} WHERE id = $1"))
        .bind(&id)
        .fetch_one(&state.db_pool)
        .await
        .map_err(|e| ErrorResponse::internal(format!("failed to reload request: {e}")))?;

    Ok((StatusCode::CREATED, Json(row_to_value(&row))))
}

/// GET /api/os/permissions/requests?status=pending
pub async fn list_permission_requests(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthIdentity>,
    Query(params): Query<RequestListParams>,
) -> Result<Json<Value>, ErrorResponse> {
    let user_id = identity.user_id();

    let result = match params.status {
        Some(status) if !status.trim().is_empty() => {
            sqlx::query_as::<_, RequestRow>(&format!(
                "{REQUEST_SELECT} WHERE user_id = $1 AND status = $2 ORDER BY created_at ASC"
            ))
            .bind(user_id)
            .bind(status)
            .fetch_all(&state.db_pool)
            .await
        }
        _ => {
            sqlx::query_as::<_, RequestRow>(&format!(
                "{REQUEST_SELECT} WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100"
            ))
            .bind(user_id)
            .fetch_all(&state.db_pool)
            .await
        }
    };

    match result {
        Ok(rows) => {
            let requests: Vec<Value> = rows.iter().map(row_to_value).collect();
            Ok(Json(json!({ "requests": requests })))
        }
        Err(e) => {
            warn!("Failed to list permission requests: {}", e);
            Err(ErrorResponse::internal(format!(
                "failed to list requests: {e}"
            )))
        }
    }
}

/// POST /api/os/permissions/requests/:id/respond — Allow/Deny.
pub async fn respond_permission_request(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthIdentity>,
    AxumPath(id): AxumPath<String>,
    Json(body): Json<RespondPermissionRequest>,
) -> Result<Json<Value>, ErrorResponse> {
    let user_id = identity.user_id();

    let current: Option<RequestRow> =
        sqlx::query_as::<_, RequestRow>(&format!("{REQUEST_SELECT} WHERE id = $1"))
            .bind(&id)
            .fetch_optional(&state.db_pool)
            .await
            .map_err(|e| ErrorResponse::internal(format!("failed to load request: {e}")))?;

    let Some(current) = current else {
        return Err(ErrorResponse::not_found(format!("request {id} not found")));
    };
    if current.1 != user_id {
        return Err(ErrorResponse::forbidden(
            "cannot respond to another user's request",
        ));
    }
    if current.6 != "pending" {
        return Err(ErrorResponse::conflict(format!(
            "request {id} is already {}",
            current.6
        )));
    }

    let status = if body.approved {
        PermissionRequestStatus::Approved
    } else {
        PermissionRequestStatus::Denied
    };

    // Approving persists the grant so effective_os_permissions sees it.
    if body.approved {
        sqlx::query(
            "INSERT INTO user_os_permissions (user_id, permission, allowed, updated_at) \
             VALUES ($1, $2, TRUE, NOW()) \
             ON CONFLICT (user_id, permission) DO UPDATE SET allowed = TRUE, updated_at = NOW()",
        )
        .bind(user_id)
        .bind(&current.2)
        .execute(&state.db_pool)
        .await
        .map_err(|e| ErrorResponse::internal(format!("failed to grant permission: {e}")))?;
    }

    sqlx::query(
        "UPDATE permission_requests SET status = $1, responded_at = NOW(), responded_by = $2 WHERE id = $3",
    )
    .bind(status.as_str())
    .bind(user_id)
    .bind(&id)
    .execute(&state.db_pool)
    .await
    .map_err(|e| ErrorResponse::internal(format!("failed to update request: {e}")))?;

    let row = sqlx::query_as::<_, RequestRow>(&format!("{REQUEST_SELECT} WHERE id = $1"))
        .bind(&id)
        .fetch_one(&state.db_pool)
        .await
        .map_err(|e| ErrorResponse::internal(format!("failed to reload request: {e}")))?;

    Ok(Json(row_to_value(&row)))
}

#[derive(Deserialize)]
pub struct RequestListParams {
    pub status: Option<String>,
}
