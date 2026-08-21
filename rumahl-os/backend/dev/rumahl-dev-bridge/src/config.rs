// config.rs — full Global Config access for the dev bridge.
//
// The rumahl dashboard stores its global, system-wide settings in the
// `system_preferences` table inside the `rumahl_home` PostgreSQL DB.
// This module exposes a thin REST surface so an IDE / rumahl Studio can
// read, write and delete those entries directly without going through
// rumahl-home auth (which is dashboard-user scoped).
//
// Endpoints (all require dev-bridge auth):
//
//   GET    /dev/config                 — list every preference
//   GET    /dev/config/:key            — get a single preference
//   PUT    /dev/config/:key            — upsert (body: raw JSON value)
//   DELETE /dev/config/:key            — delete

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::postgres::PgRow;
use sqlx::Row;
use uuid::Uuid;

use crate::db::open_pool;
use crate::AppState;

const HOME_DB: &str = "rumahl_home";

#[derive(Serialize)]
pub struct PreferenceEntry {
    pub id: String,
    pub key: String,
    pub value: Value,
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
}

fn err(status: StatusCode, msg: impl Into<String>) -> (StatusCode, Json<Value>) {
    (status, Json(json!({ "error": msg.into() })))
}

fn parse_value_text(text: &str) -> Value {
    serde_json::from_str(text).unwrap_or_else(|_| Value::String(text.to_string()))
}

pub async fn config_list(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    if let Err(e) = crate::check_auth(&state, &headers) {
        return Err((e.0, Json(json!({"error": e.1}))));
    }

    let pool = match open_pool(HOME_DB).await {
        Ok(p) => p,
        Err(e) => return Err(err(StatusCode::BAD_GATEWAY, format!("{e:#}"))),
    };

    let rows = match sqlx::query(
        "SELECT id, preference_key, preference_value, created_at, updated_at \
         FROM system_preferences ORDER BY preference_key",
    )
    .fetch_all(&pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            pool.close().await;
            return Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("listing preferences: {e}"),
            ));
        }
    };

    let entries: Vec<PreferenceEntry> = rows
        .iter()
        .map(|r: &PgRow| PreferenceEntry {
            id: r.try_get::<String, _>("id").unwrap_or_default(),
            key: r.try_get::<String, _>("preference_key").unwrap_or_default(),
            value: parse_value_text(
                &r.try_get::<String, _>("preference_value")
                    .unwrap_or_default(),
            ),
            created_at: r
                .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("created_at")
                .unwrap_or(None),
            updated_at: r
                .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("updated_at")
                .unwrap_or(None),
        })
        .collect();

    pool.close().await;
    Ok(Json(json!({ "preferences": entries })))
}

pub async fn config_get(
    State(state): State<AppState>,
    Path(key): Path<String>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    if let Err(e) = crate::check_auth(&state, &headers) {
        return Err((e.0, Json(json!({"error": e.1}))));
    }

    let pool = match open_pool(HOME_DB).await {
        Ok(p) => p,
        Err(e) => return Err(err(StatusCode::BAD_GATEWAY, format!("{e:#}"))),
    };

    let row: Option<PgRow> = match sqlx::query(
        "SELECT id, preference_key, preference_value, created_at, updated_at \
         FROM system_preferences WHERE preference_key = $1",
    )
    .bind(&key)
    .fetch_optional(&pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            pool.close().await;
            return Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("loading preference: {e}"),
            ));
        }
    };

    pool.close().await;

    match row {
        Some(r) => Ok(Json(json!({
            "preference": PreferenceEntry {
                id: r.try_get::<String, _>("id").unwrap_or_default(),
                key: r.try_get::<String, _>("preference_key").unwrap_or_default(),
                value: parse_value_text(&r.try_get::<String, _>("preference_value").unwrap_or_default()),
                created_at: r.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("created_at").unwrap_or(None),
                updated_at: r.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("updated_at").unwrap_or(None),
            }
        }))),
        None => Err(err(StatusCode::NOT_FOUND, format!("no such key: {key}"))),
    }
}

pub async fn config_put(
    State(state): State<AppState>,
    Path(key): Path<String>,
    headers: axum::http::HeaderMap,
    Json(value): Json<Value>,
) -> impl IntoResponse {
    if let Err(e) = crate::check_auth(&state, &headers) {
        return Err((e.0, Json(json!({"error": e.1}))));
    }
    if key.is_empty() || key.len() > 256 {
        return Err(err(StatusCode::BAD_REQUEST, "invalid preference key"));
    }

    let pool = match open_pool(HOME_DB).await {
        Ok(p) => p,
        Err(e) => return Err(err(StatusCode::BAD_GATEWAY, format!("{e:#}"))),
    };

    // Mirror rumahl-home's pattern: try UPDATE, fall back to INSERT.
    let value_text = value.to_string();
    let now = chrono::Utc::now();

    let upd = match sqlx::query(
        "UPDATE system_preferences \
         SET preference_value = $1, updated_at = $2 \
         WHERE preference_key = $3",
    )
    .bind(&value_text)
    .bind(now)
    .bind(&key)
    .execute(&pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            pool.close().await;
            return Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("updating preference: {e}"),
            ));
        }
    };

    let created = if upd.rows_affected() == 0 {
        let id = Uuid::new_v4().to_string();
        if let Err(e) = sqlx::query(
            "INSERT INTO system_preferences (id, preference_key, preference_value, created_at, updated_at) \
             VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(&id)
        .bind(&key)
        .bind(&value_text)
        .bind(now)
        .bind(now)
        .execute(&pool)
        .await
        {
            pool.close().await;
            return Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("inserting preference: {e}"),
            ));
        }
        true
    } else {
        false
    };

    pool.close().await;
    Ok(Json(json!({
        "key": key,
        "value": value,
        "created": created,
        "updated_at": now,
    })))
}

pub async fn config_delete(
    State(state): State<AppState>,
    Path(key): Path<String>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    if let Err(e) = crate::check_auth(&state, &headers) {
        return Err((e.0, Json(json!({"error": e.1}))));
    }

    let pool = match open_pool(HOME_DB).await {
        Ok(p) => p,
        Err(e) => return Err(err(StatusCode::BAD_GATEWAY, format!("{e:#}"))),
    };

    let res: sqlx::postgres::PgQueryResult =
        match sqlx::query("DELETE FROM system_preferences WHERE preference_key = $1")
            .bind(&key)
            .execute(&pool)
            .await
        {
            Ok(r) => r,
            Err(e) => {
                pool.close().await;
                return Err(err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("deleting preference: {e}"),
                ));
            }
        };

    pool.close().await;
    Ok(Json(json!({
        "key": key,
        "deleted": res.rows_affected() > 0,
    })))
}
