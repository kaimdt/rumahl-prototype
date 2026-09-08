//! User Profiles Handler – family/child profiles with restrictions.
//!
//! API endpoints:
//!   PUT /api/admin/users/:id/profile – Update profile_type/restrictions
//!                                      (admin only)
//!
//! The current user's profile fields are also attached to `/api/auth/verify`
//! responses (see main.rs), so the shell can enforce restrictions without an
//! extra round trip.

use axum::{
    extract::{Path as AxumPath, State},
    Json,
};
use serde_json::{json, Value};

use rumahl_shared::user_profiles::{
    UpdateUserProfileRequest, PROFILE_TYPE_CHILD, PROFILE_TYPE_STANDARD,
};

use crate::{AppState, ErrorResponse};

/// Load profile_type + restrictions for a user (used by auth_verify and the
/// admin update handler).
pub async fn get_user_profile(
    state: &AppState,
    user_id: &str,
) -> Result<(String, Value), ErrorResponse> {
    let row: Option<(String, Value)> =
        sqlx::query_as("SELECT profile_type, restrictions FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_optional(&state.db_pool)
            .await
            .map_err(|e| ErrorResponse::internal(format!("failed to load user profile: {e}")))?;

    match row {
        Some((profile_type, restrictions)) => Ok((profile_type, restrictions)),
        None => Err(ErrorResponse::not_found(format!(
            "user {user_id} not found"
        ))),
    }
}

/// PUT /api/admin/users/:id/profile
pub async fn update_user_profile(
    State(state): State<AppState>,
    AxumPath(user_id): AxumPath<String>,
    Json(body): Json<UpdateUserProfileRequest>,
) -> Result<Json<Value>, ErrorResponse> {
    // Validate profile_type against the known kinds.
    let profile_type = match body.profile_type {
        None => None,
        Some(value)
            if value == PROFILE_TYPE_STANDARD || value == PROFILE_TYPE_CHILD =>
        {
            Some(value)
        }
        Some(other) => {
            return Err(ErrorResponse::bad_request(format!(
                "invalid profile_type '{other}' (expected '{PROFILE_TYPE_STANDARD}' or '{PROFILE_TYPE_CHILD}')"
            )))
        }
    };

    // Restrictions must be a JSON object.
    if let Some(restrictions) = &body.restrictions {
        if !restrictions.is_object() {
            return Err(ErrorResponse::bad_request(
                "restrictions must be a JSON object",
            ));
        }
    }

    let mut sets: Vec<&str> = Vec::new();
    let mut idx = 1;
    let mut query = String::from("UPDATE users SET ");
    if profile_type.is_some() {
        query.push_str(&format!("profile_type = ${idx}"));
        idx += 1;
        sets.push("profile_type");
    }
    if body.restrictions.is_some() {
        if !sets.is_empty() {
            query.push_str(", ");
        }
        query.push_str(&format!("restrictions = ${idx}"));
        idx += 1;
        sets.push("restrictions");
    }
    if sets.is_empty() {
        return Err(ErrorResponse::bad_request("nothing to update"));
    }
    query.push_str(&format!(", updated_at = NOW() WHERE id = ${idx}"));

    let mut q = sqlx::query(&query);
    if let Some(pt) = &profile_type {
        q = q.bind(pt);
    }
    if let Some(restrictions) = &body.restrictions {
        q = q.bind(restrictions);
    }
    q = q.bind(&user_id);

    let affected = q
        .execute(&state.db_pool)
        .await
        .map_err(|e| ErrorResponse::internal(format!("failed to update user profile: {e}")))?
        .rows_affected();

    if affected == 0 {
        return Err(ErrorResponse::not_found(format!(
            "user {user_id} not found"
        )));
    }

    let (profile_type, restrictions) = get_user_profile(&state, &user_id).await?;
    Ok(Json(
        json!({ "profile_type": profile_type, "restrictions": restrictions }),
    ))
}

/// GET /api/admin/users — all users with their profile fields (admin only).
/// Used by the family-profile settings UI.
/// Row shape of the user-with-profile listing query.
type UserProfileRow = (
    String,
    String,
    Option<String>,
    Option<String>,
    String,
    bool,
    String,
    Value,
);
pub async fn admin_list_users_with_profiles(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    let rows: Vec<UserProfileRow> = sqlx::query_as(
        "SELECT id, username, display_name, avatar_url, role, is_admin, profile_type, restrictions \
         FROM users WHERE username != 'guest' ORDER BY username",
    )
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| ErrorResponse::internal(format!("failed to list users: {e}")))?;

    let users: Vec<Value> = rows
        .into_iter()
        .map(
            |(
                id,
                username,
                display_name,
                avatar_url,
                role,
                is_admin,
                profile_type,
                restrictions,
            )| {
                json!({
                    "id": id,
                    "username": username,
                    "display_name": display_name,
                    "avatar_url": avatar_url,
                    "role": role,
                    "is_admin": is_admin,
                    "profile_type": profile_type,
                    "restrictions": restrictions,
                })
            },
        )
        .collect();

    Ok(Json(json!({ "users": users })))
}
