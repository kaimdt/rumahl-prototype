// db.rs — full PostgreSQL access endpoints for the dev bridge.
//
// ⚠️  THIS MODULE GIVES THE CALLER COMPLETE READ/WRITE/DDL ACCESS TO
//     EVERY rumahl DATABASE, INCLUDING THE POSTGRES SUPERUSER ROLE.
//     It is gated by the dev-bridge auth middleware and only ever
//     ships on `RUMAHL_OS_DEV=1` images. Production images do not
//     contain the rumahl-dev-bridge binary at all.
//
// Endpoints (all require dev-bridge auth):
//
//   GET    /dev/db/databases                 — list non-template databases
//   GET    /dev/db/:db/tables                — list tables in a database
//   GET    /dev/db/:db/tables/:table         — describe columns + indexes
//   POST   /dev/db/:db/query                 — run a query, return rows as JSON
//   POST   /dev/db/:db/exec                  — exec DDL/DML, return rows_affected
//   POST   /dev/db/:db/explain               — EXPLAIN (FORMAT JSON) a query
//
// Connection strategy: we open a fresh single-connection PgPool per
// request and close it after. This is fine for a dev tool and avoids
// any worry about long-lived state, password rotation, or stuck
// connections after a service restart.
//
// Authentication to PG: we read the password from /etc/ora/db.password
// (the same file that first-boot writes; mode 0640, group ora). The
// dev bridge runs as root so it can read it. As a fallback we honour
// `$RUMAHL_DB_PASSWORD` and `$DATABASE_URL` for local dev outside rumahl OS.

use anyhow::{anyhow, Context, Result};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{
    postgres::{PgConnectOptions, PgPoolOptions, PgRow},
    Column, Row, TypeInfo,
};
use std::path::Path as StdPath;
use std::str::FromStr;
use std::time::Duration;

use crate::AppState;

const DB_PASSWORD_FILE: &str = "/etc/ora/db.password";
const DEFAULT_PG_USER: &str = "ora";
const DEFAULT_PG_HOST: &str = "127.0.0.1";
const DEFAULT_PG_PORT: u16 = 5432;
/// Catalog DB used for cross-database operations (listing, etc).
const ADMIN_DB: &str = "postgres";

/// Resolve the DB password from (in order):
///   1. `$RUMAHL_DB_PASSWORD`
///   2. `/etc/ora/db.password` (first-boot writes this)
///   3. None — caller can decide to fall back to peer auth or fail.
fn resolve_db_password() -> Option<String> {
    if let Ok(p) = std::env::var("RUMAHL_DB_PASSWORD") {
        let t = p.trim();
        if !t.is_empty() {
            return Some(t.to_string());
        }
    }
    if StdPath::new(DB_PASSWORD_FILE).exists() {
        if let Ok(s) = std::fs::read_to_string(DB_PASSWORD_FILE) {
            let t = s.trim();
            if !t.is_empty() {
                return Some(t.to_string());
            }
        }
    }
    None
}

/// Build a `PgConnectOptions` for a given database name.
///
/// If `$DATABASE_URL` is set we honour it but override the database
/// component, so a developer running this bridge on their workstation
/// against a remote PG can still target arbitrary DBs via the API.
fn pg_options_for(database: &str) -> Result<PgConnectOptions> {
    if let Ok(url) = std::env::var("DATABASE_URL") {
        let t = url.trim();
        if !t.is_empty() {
            let opts = PgConnectOptions::from_str(t)
                .context("parsing $DATABASE_URL")?
                .database(database);
            return Ok(opts);
        }
    }

    let user = std::env::var("RUMAHL_DB_USER").unwrap_or_else(|_| DEFAULT_PG_USER.to_string());
    let host = std::env::var("RUMAHL_DB_HOST").unwrap_or_else(|_| DEFAULT_PG_HOST.to_string());
    let port: u16 = std::env::var("RUMAHL_DB_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(DEFAULT_PG_PORT);

    let mut opts = PgConnectOptions::new()
        .host(&host)
        .port(port)
        .username(&user)
        .database(database);

    if let Some(pw) = resolve_db_password() {
        opts = opts.password(&pw);
    }

    Ok(opts)
}

/// Open a short-lived single-connection pool against `database`.
pub(crate) async fn open_pool(database: &str) -> Result<sqlx::PgPool> {
    let opts = pg_options_for(database)?;
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(Duration::from_secs(5))
        .connect_with(opts)
        .await
        .with_context(|| format!("connecting to PostgreSQL database '{database}'"))?;
    Ok(pool)
}

/// Validate a database/table identifier so we can safely interpolate it
/// into SQL where placeholders are not allowed (e.g. table names in
/// `\d` queries).  PostgreSQL identifiers are at most 63 chars and must
/// match `[A-Za-z_][A-Za-z0-9_]*`. We deliberately reject quoted
/// identifiers — the dev bridge never needs them and refusing them
/// removes an entire class of injection risk.
fn validate_ident(name: &str) -> Result<()> {
    if name.is_empty() || name.len() > 63 {
        return Err(anyhow!("identifier '{name}' has invalid length"));
    }
    let mut chars = name.chars();
    let first = chars.next().unwrap();
    if !(first.is_ascii_alphabetic() || first == '_') {
        return Err(anyhow!(
            "identifier '{name}' must start with a letter or '_'"
        ));
    }
    for c in chars {
        if !(c.is_ascii_alphanumeric() || c == '_') {
            return Err(anyhow!(
                "identifier '{name}' contains invalid character '{c}'"
            ));
        }
    }
    Ok(())
}

fn err_response(status: StatusCode, msg: impl Into<String>) -> (StatusCode, Json<Value>) {
    (status, Json(json!({ "error": msg.into() })))
}

// ─── Row → JSON conversion ─────────────────────────────────────────────────

/// Convert a single PG row to a JSON object using the column names as
/// keys. We try the most common SQL types first; anything we can't
/// decode is rendered as a string via the Postgres TEXT codec, and if
/// even that fails we emit a `{ "<unsupported>": "<typename>" }`
/// placeholder so the API never silently drops data.
fn row_to_json(row: &PgRow) -> Value {
    let mut obj = serde_json::Map::with_capacity(row.columns().len());
    for col in row.columns() {
        let name = col.name();
        let val = decode_column(row, col);
        obj.insert(name.to_string(), val);
    }
    Value::Object(obj)
}

fn decode_column(row: &PgRow, col: &sqlx::postgres::PgColumn) -> Value {
    let name = col.name();
    let type_name = col.type_info().name();

    // NULL fast-path
    if let Ok(opt) = row.try_get::<Option<String>, _>(name) {
        if opt.is_none()
            && row
                .try_get::<Option<i64>, _>(name)
                .map(|v| v.is_none())
                .unwrap_or(false)
        {
            return Value::Null;
        }
    }

    macro_rules! try_get_value {
        ($ty:ty, $row:expr, $name:expr) => {
            if let Ok(v) = $row.try_get::<Option<$ty>, _>($name) {
                return match v {
                    Some(x) => match serde_json::to_value(x) {
                        Ok(j) => j,
                        Err(_) => Value::Null,
                    },
                    None => Value::Null,
                };
            }
        };
    }

    // Try strongly-typed decoders first based on the PG type name.
    match type_name {
        "BOOL" => try_get_value!(bool, row, name),
        "INT2" => try_get_value!(i16, row, name),
        "INT4" => try_get_value!(i32, row, name),
        "INT8" => try_get_value!(i64, row, name),
        "FLOAT4" => try_get_value!(f32, row, name),
        "FLOAT8" => try_get_value!(f64, row, name),
        "NUMERIC" => {
            // Render as string to avoid precision loss.
            if let Ok(v) = row.try_get::<Option<String>, _>(name) {
                return match v {
                    Some(s) => Value::String(s),
                    None => Value::Null,
                };
            }
        }
        "JSON" | "JSONB" => try_get_value!(Value, row, name),
        "UUID" => {
            if let Ok(v) = row.try_get::<Option<uuid::Uuid>, _>(name) {
                return match v {
                    Some(u) => Value::String(u.to_string()),
                    None => Value::Null,
                };
            }
        }
        "TIMESTAMPTZ" => try_get_value!(chrono::DateTime<chrono::Utc>, row, name),
        "TIMESTAMP" => try_get_value!(chrono::NaiveDateTime, row, name),
        "DATE" => try_get_value!(chrono::NaiveDate, row, name),
        "TIME" => try_get_value!(chrono::NaiveTime, row, name),
        "BYTEA" => {
            if let Ok(v) = row.try_get::<Option<Vec<u8>>, _>(name) {
                return match v {
                    Some(b) => {
                        let mut s = String::with_capacity(2 + b.len() * 2);
                        s.push_str("\\x");
                        for byte in &b {
                            s.push_str(&format!("{byte:02x}"));
                        }
                        Value::String(s)
                    }
                    None => Value::Null,
                };
            }
        }
        "TEXT" | "VARCHAR" | "BPCHAR" | "NAME" | "CITEXT" => {
            try_get_value!(String, row, name);
        }
        // Array of text — best-effort. More exotic array types fall
        // through to the generic string fallback below.
        "TEXT[]" | "VARCHAR[]" | "_TEXT" | "_VARCHAR" => {
            try_get_value!(Vec<String>, row, name);
        }
        "INT4[]" | "_INT4" => try_get_value!(Vec<i32>, row, name),
        "INT8[]" | "_INT8" => try_get_value!(Vec<i64>, row, name),
        _ => {}
    }

    // Generic fallback: try to decode as String.
    if let Ok(v) = row.try_get::<Option<String>, _>(name) {
        return match v {
            Some(s) => Value::String(s),
            None => Value::Null,
        };
    }

    json!({ "<unsupported>": type_name })
}

// ─── Handlers ───────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct DatabaseInfo {
    pub name: String,
    pub owner: Option<String>,
    pub size_bytes: Option<i64>,
}

pub async fn list_databases(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    if let Err(e) = crate::check_auth(&state, &headers) {
        return Err((e.0, Json(json!({"error": e.1}))));
    }

    let pool = match open_pool(ADMIN_DB).await {
        Ok(p) => p,
        Err(e) => return Err(err_response(StatusCode::BAD_GATEWAY, format!("{e:#}"))),
    };

    let rows = match sqlx::query(
        "SELECT d.datname AS name, \
                pg_get_userbyid(d.datdba) AS owner, \
                pg_database_size(d.datname) AS size_bytes \
         FROM pg_database d \
         WHERE d.datistemplate = false \
         ORDER BY d.datname",
    )
    .fetch_all(&pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            return Err(err_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("listing databases: {e}"),
            ))
        }
    };

    let dbs: Vec<DatabaseInfo> = rows
        .iter()
        .map(|r| DatabaseInfo {
            name: r.try_get::<String, _>("name").unwrap_or_default(),
            owner: r.try_get::<Option<String>, _>("owner").unwrap_or(None),
            size_bytes: r.try_get::<Option<i64>, _>("size_bytes").unwrap_or(None),
        })
        .collect();

    pool.close().await;
    Ok(Json(json!({ "databases": dbs })))
}

#[derive(Serialize)]
pub struct TableInfo {
    pub schema: String,
    pub name: String,
    pub kind: String, // r=table, v=view, m=materialized view, f=foreign
    pub rows_estimate: Option<i64>,
}

pub async fn list_tables(
    State(state): State<AppState>,
    Path(database): Path<String>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    if let Err(e) = crate::check_auth(&state, &headers) {
        return Err((e.0, Json(json!({"error": e.1}))));
    }
    if let Err(e) = validate_ident(&database) {
        return Err(err_response(StatusCode::BAD_REQUEST, format!("{e}")));
    }

    let pool = match open_pool(&database).await {
        Ok(p) => p,
        Err(e) => return Err(err_response(StatusCode::BAD_GATEWAY, format!("{e:#}"))),
    };

    let rows = match sqlx::query(
        "SELECT n.nspname AS schema, c.relname AS name, c.relkind::text AS kind, \
                c.reltuples::bigint AS rows_estimate \
         FROM pg_class c \
         JOIN pg_namespace n ON n.oid = c.relnamespace \
         WHERE c.relkind IN ('r','v','m','f','p') \
           AND n.nspname NOT IN ('pg_catalog','information_schema') \
         ORDER BY n.nspname, c.relname",
    )
    .fetch_all(&pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            return Err(err_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("listing tables: {e}"),
            ))
        }
    };

    let tables: Vec<TableInfo> = rows
        .iter()
        .map(|r| TableInfo {
            schema: r.try_get::<String, _>("schema").unwrap_or_default(),
            name: r.try_get::<String, _>("name").unwrap_or_default(),
            kind: r.try_get::<String, _>("kind").unwrap_or_default(),
            rows_estimate: r.try_get::<Option<i64>, _>("rows_estimate").unwrap_or(None),
        })
        .collect();

    pool.close().await;
    Ok(Json(json!({ "tables": tables })))
}

#[derive(Serialize)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub is_nullable: bool,
    pub default: Option<String>,
}

pub async fn describe_table(
    State(state): State<AppState>,
    Path((database, table)): Path<(String, String)>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    if let Err(e) = crate::check_auth(&state, &headers) {
        return Err((e.0, Json(json!({"error": e.1}))));
    }
    if let Err(e) = validate_ident(&database) {
        return Err(err_response(StatusCode::BAD_REQUEST, format!("{e}")));
    }
    // Allow schema.table
    let (schema, table_only) = match table.split_once('.') {
        Some((s, t)) => (s.to_string(), t.to_string()),
        None => ("public".to_string(), table.clone()),
    };
    if let Err(e) = validate_ident(&schema) {
        return Err(err_response(StatusCode::BAD_REQUEST, format!("{e}")));
    }
    if let Err(e) = validate_ident(&table_only) {
        return Err(err_response(StatusCode::BAD_REQUEST, format!("{e}")));
    }

    let pool = match open_pool(&database).await {
        Ok(p) => p,
        Err(e) => return Err(err_response(StatusCode::BAD_GATEWAY, format!("{e:#}"))),
    };

    let col_rows = match sqlx::query(
        "SELECT column_name AS name, \
                data_type, \
                is_nullable = 'YES' AS is_nullable, \
                column_default AS default \
         FROM information_schema.columns \
         WHERE table_schema = $1 AND table_name = $2 \
         ORDER BY ordinal_position",
    )
    .bind(&schema)
    .bind(&table_only)
    .fetch_all(&pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            return Err(err_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("describing table: {e}"),
            ))
        }
    };

    let columns: Vec<ColumnInfo> = col_rows
        .iter()
        .map(|r| ColumnInfo {
            name: r.try_get::<String, _>("name").unwrap_or_default(),
            data_type: r.try_get::<String, _>("data_type").unwrap_or_default(),
            is_nullable: r.try_get::<bool, _>("is_nullable").unwrap_or(true),
            default: r.try_get::<Option<String>, _>("default").unwrap_or(None),
        })
        .collect();

    let idx_rows = sqlx::query(
        "SELECT indexname AS name, indexdef AS definition \
         FROM pg_indexes \
         WHERE schemaname = $1 AND tablename = $2 \
         ORDER BY indexname",
    )
    .bind(&schema)
    .bind(&table_only)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    let indexes: Vec<Value> = idx_rows
        .iter()
        .map(|r| {
            json!({
                "name": r.try_get::<String, _>("name").unwrap_or_default(),
                "definition": r.try_get::<String, _>("definition").unwrap_or_default(),
            })
        })
        .collect();

    pool.close().await;
    Ok(Json(json!({
        "schema": schema,
        "table": table_only,
        "columns": columns,
        "indexes": indexes,
    })))
}

#[derive(Deserialize)]
pub struct QueryRequest {
    pub sql: String,
    /// Optional positional parameters bound as $1..$N. Only string,
    /// number, bool and null are supported — if you need typed binds,
    /// inline them in the SQL.
    #[serde(default)]
    pub params: Vec<Value>,
    /// Cap on rows returned. Defaults to 1000; the maximum is 100_000
    /// to keep the JSON response under control.
    #[serde(default)]
    pub max_rows: Option<usize>,
}

const DEFAULT_QUERY_LIMIT: usize = 1000;
const MAX_QUERY_LIMIT: usize = 100_000;

pub async fn run_query(
    State(state): State<AppState>,
    Path(database): Path<String>,
    headers: axum::http::HeaderMap,
    Json(req): Json<QueryRequest>,
) -> impl IntoResponse {
    if let Err(e) = crate::check_auth(&state, &headers) {
        return Err((e.0, Json(json!({"error": e.1}))));
    }
    if let Err(e) = validate_ident(&database) {
        return Err(err_response(StatusCode::BAD_REQUEST, format!("{e}")));
    }
    if req.sql.trim().is_empty() {
        return Err(err_response(StatusCode::BAD_REQUEST, "empty sql"));
    }

    let limit = req
        .max_rows
        .unwrap_or(DEFAULT_QUERY_LIMIT)
        .min(MAX_QUERY_LIMIT);

    let pool = match open_pool(&database).await {
        Ok(p) => p,
        Err(e) => return Err(err_response(StatusCode::BAD_GATEWAY, format!("{e:#}"))),
    };

    let mut q = sqlx::query(&req.sql);
    for p in &req.params {
        q = bind_param(q, p);
    }

    let started = std::time::Instant::now();
    let rows = match q.fetch_all(&pool).await {
        Ok(r) => r,
        Err(e) => {
            pool.close().await;
            return Err(err_response(
                StatusCode::BAD_REQUEST,
                format!("query error: {e}"),
            ));
        }
    };
    let elapsed_ms = started.elapsed().as_millis() as u64;

    let total = rows.len();
    let truncated = total > limit;
    let body: Vec<Value> = rows.iter().take(limit).map(row_to_json).collect();

    pool.close().await;
    Ok(Json(json!({
        "rows": body,
        "row_count": total,
        "returned": body.len(),
        "truncated": truncated,
        "elapsed_ms": elapsed_ms,
    })))
}

pub async fn run_exec(
    State(state): State<AppState>,
    Path(database): Path<String>,
    headers: axum::http::HeaderMap,
    Json(req): Json<QueryRequest>,
) -> impl IntoResponse {
    if let Err(e) = crate::check_auth(&state, &headers) {
        return Err((e.0, Json(json!({"error": e.1}))));
    }
    if let Err(e) = validate_ident(&database) {
        return Err(err_response(StatusCode::BAD_REQUEST, format!("{e}")));
    }
    if req.sql.trim().is_empty() {
        return Err(err_response(StatusCode::BAD_REQUEST, "empty sql"));
    }

    let pool = match open_pool(&database).await {
        Ok(p) => p,
        Err(e) => return Err(err_response(StatusCode::BAD_GATEWAY, format!("{e:#}"))),
    };

    let mut q = sqlx::query(&req.sql);
    for p in &req.params {
        q = bind_param(q, p);
    }

    let started = std::time::Instant::now();
    match q.execute(&pool).await {
        Ok(res) => {
            pool.close().await;
            Ok(Json(json!({
                "rows_affected": res.rows_affected(),
                "elapsed_ms": started.elapsed().as_millis() as u64,
            })))
        }
        Err(e) => {
            pool.close().await;
            Err(err_response(
                StatusCode::BAD_REQUEST,
                format!("exec error: {e}"),
            ))
        }
    }
}

pub async fn run_explain(
    State(state): State<AppState>,
    Path(database): Path<String>,
    headers: axum::http::HeaderMap,
    Json(req): Json<QueryRequest>,
) -> impl IntoResponse {
    if let Err(e) = crate::check_auth(&state, &headers) {
        return Err((e.0, Json(json!({"error": e.1}))));
    }
    if let Err(e) = validate_ident(&database) {
        return Err(err_response(StatusCode::BAD_REQUEST, format!("{e}")));
    }

    let pool = match open_pool(&database).await {
        Ok(p) => p,
        Err(e) => return Err(err_response(StatusCode::BAD_GATEWAY, format!("{e:#}"))),
    };

    let explain_sql = format!("EXPLAIN (FORMAT JSON) {}", req.sql);
    let mut q = sqlx::query(&explain_sql);
    for p in &req.params {
        q = bind_param(q, p);
    }

    match q.fetch_all(&pool).await {
        Ok(rows) => {
            let plan: Value = rows
                .first()
                .and_then(|r| r.try_get::<Value, _>(0).ok())
                .unwrap_or(Value::Null);
            pool.close().await;
            Ok(Json(json!({ "plan": plan })))
        }
        Err(e) => {
            pool.close().await;
            Err(err_response(
                StatusCode::BAD_REQUEST,
                format!("explain error: {e}"),
            ))
        }
    }
}

/// Bind a single JSON value as a query parameter. We pick the smallest
/// unambiguous type, so e.g. `42` binds as `i64` rather than as a
/// string.
fn bind_param<'q>(
    q: sqlx::query::Query<'q, sqlx::Postgres, sqlx::postgres::PgArguments>,
    v: &'q Value,
) -> sqlx::query::Query<'q, sqlx::Postgres, sqlx::postgres::PgArguments> {
    match v {
        Value::Null => q.bind(None::<String>),
        Value::Bool(b) => q.bind(*b),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                q.bind(i)
            } else if let Some(f) = n.as_f64() {
                q.bind(f)
            } else {
                q.bind(n.to_string())
            }
        }
        Value::String(s) => q.bind(s.clone()),
        // Arrays/objects: bind as JSONB (works for params declared
        // jsonb in the SQL; for plain text columns the caller should
        // stringify themselves).
        other => q.bind(other.clone()),
    }
}
