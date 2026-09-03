use actix_web::{
    cookie::{time::Duration as CookieDuration, Cookie, SameSite},
    get, post, web, App, HttpRequest, HttpResponse, HttpServer, ResponseError,
};
use bcrypt::{hash, verify, DEFAULT_COST};
use chrono::{DateTime, Duration, Utc};
use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, PgPool};
use std::{env, io};
use thiserror::Error;
use tracing::{error, info};
use uuid::Uuid;

const SESSION_COOKIE: &str = "rumahl_session";

#[derive(Clone)]
struct State {
    pool: PgPool,
    config: Config,
}

#[derive(Clone)]
struct Config {
    bind: String,
    cookie_domain: String,
    secure_cookies: bool,
    session_days: i64,
}

impl Config {
    fn from_env() -> Self {
        Self {
            bind: env::var("ACCOUNT_BIND").unwrap_or_else(|_| "0.0.0.0:8110".into()),
            cookie_domain: env::var("ACCOUNT_COOKIE_DOMAIN")
                .unwrap_or_else(|_| ".rumahl.com".into()),
            secure_cookies: env::var("ACCOUNT_SECURE_COOKIES")
                .map(|v| v != "false")
                .unwrap_or(true),
            session_days: env::var("ACCOUNT_SESSION_DAYS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(30),
        }
    }
}

#[derive(Debug, Error)]
enum ApiError {
    #[error("The submitted account data is invalid")]
    Validation,
    #[error("The email address is already registered")]
    Conflict,
    #[error("The email address or password is incorrect")]
    Unauthorized,
    #[error("The account is not active")]
    Forbidden,
    #[error("An internal account service error occurred")]
    Internal,
}
impl ResponseError for ApiError {
    fn status_code(&self) -> actix_web::http::StatusCode {
        match self {
            Self::Validation => actix_web::http::StatusCode::BAD_REQUEST,
            Self::Conflict => actix_web::http::StatusCode::CONFLICT,
            Self::Unauthorized => actix_web::http::StatusCode::UNAUTHORIZED,
            Self::Forbidden => actix_web::http::StatusCode::FORBIDDEN,
            Self::Internal => actix_web::http::StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
    fn error_response(&self) -> HttpResponse {
        HttpResponse::build(self.status_code()).json(ErrorBody {
            code: match self {
                Self::Validation => "invalid_account_data",
                Self::Conflict => "email_already_registered",
                Self::Unauthorized => "invalid_credentials",
                Self::Forbidden => "account_not_active",
                Self::Internal => "internal_error",
            },
            message: self.to_string(),
        })
    }
}
#[derive(Serialize)]
struct ErrorBody {
    code: &'static str,
    message: String,
}

#[derive(Deserialize)]
struct Register {
    email: String,
    password: String,
    display_name: String,
}
#[derive(Deserialize)]
struct Login {
    email: String,
    password: String,
}
#[derive(Serialize, FromRow)]
struct User {
    id: Uuid,
    email: String,
    display_name: String,
    email_verified_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
}
#[derive(FromRow)]
struct LoginUser {
    id: Uuid,
    email: String,
    display_name: String,
    password_hash: String,
    status: String,
    email_verified_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
}
#[derive(Serialize)]
struct AuthResponse {
    user: User,
}
#[derive(Serialize)]
struct Health {
    status: &'static str,
    service: &'static str,
}

fn normalize_email(value: &str) -> Option<String> {
    let value = value.trim().to_lowercase();
    let mut parts = value.split('@');
    let local = parts.next()?;
    let domain = parts.next()?;
    if local.is_empty()
        || domain.is_empty()
        || parts.next().is_some()
        || !domain.contains('.')
        || value.len() > 320
    {
        None
    } else {
        Some(value)
    }
}
fn valid_password(value: &str) -> bool {
    value.len() >= 12
        && value.len() <= 128
        && value.chars().any(char::is_uppercase)
        && value.chars().any(char::is_lowercase)
        && value.chars().any(|c| c.is_ascii_digit())
}
fn token() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(64)
        .map(char::from)
        .collect()
}
fn digest(value: &str) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))
}
fn client_data(req: &HttpRequest) -> (Option<String>, Option<String>) {
    (
        req.connection_info()
            .realip_remote_addr()
            .map(str::to_owned),
        req.headers()
            .get("user-agent")
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned),
    )
}
fn session_cookie(value: String, config: &Config) -> Cookie<'static> {
    Cookie::build(SESSION_COOKIE, value)
        .path("/")
        .domain(config.cookie_domain.clone())
        .http_only(true)
        .secure(config.secure_cookies)
        .same_site(SameSite::Lax)
        .max_age(CookieDuration::days(config.session_days))
        .finish()
}

#[get("/health")]
async fn health() -> HttpResponse {
    HttpResponse::Ok().json(Health {
        status: "healthy",
        service: "rumahl-account",
    })
}

#[post("/v1/auth/register")]
async fn register(
    state: web::Data<State>,
    req: HttpRequest,
    body: web::Json<Register>,
) -> Result<HttpResponse, ApiError> {
    let email = normalize_email(&body.email).ok_or(ApiError::Validation)?;
    let name = body.display_name.trim();
    if name.len() < 2 || name.len() > 120 || !valid_password(&body.password) {
        return Err(ApiError::Validation);
    }
    let hash = hash(&body.password, DEFAULT_COST).map_err(|_| ApiError::Internal)?;
    let mut tx = state.pool.begin().await.map_err(|e| {
        error!(%e, "Failed to begin registration transaction");
        ApiError::Internal
    })?;
    let user = sqlx::query_as::<_, User>("INSERT INTO account_users (id,email,email_normalized,display_name,password_hash) VALUES ($1,$2,$2,$3,$4) RETURNING id,email,display_name,email_verified_at,created_at")
        .bind(Uuid::new_v4()).bind(&email).bind(name).bind(hash).fetch_one(&mut *tx).await.map_err(|e| if matches!(e, sqlx::Error::Database(ref db) if db.is_unique_violation()) { ApiError::Conflict } else { error!(%e, "Failed to register account"); ApiError::Internal })?;
    let raw = token();
    let expires = Utc::now() + Duration::days(state.config.session_days);
    let (ip, agent) = client_data(&req);
    sqlx::query("INSERT INTO account_sessions (id,user_id,token_hash,expires_at,user_agent,ip_address) VALUES ($1,$2,$3,$4,$5,$6::inet)").bind(Uuid::new_v4()).bind(user.id).bind(digest(&raw)).bind(expires).bind(&agent).bind(&ip).execute(&mut *tx).await.map_err(|_| ApiError::Internal)?;
    sqlx::query("INSERT INTO account_audit_log (actor_user_id,event_type,subject_type,subject_id,ip_address,user_agent) VALUES ($1,'account.registered','user',$2,$3::inet,$4)").bind(user.id).bind(user.id.to_string()).bind(ip).bind(agent).execute(&mut *tx).await.map_err(|_| ApiError::Internal)?;
    tx.commit().await.map_err(|_| ApiError::Internal)?;
    Ok(HttpResponse::Created()
        .cookie(session_cookie(raw, &state.config))
        .json(AuthResponse { user }))
}

#[post("/v1/auth/login")]
async fn login(
    state: web::Data<State>,
    req: HttpRequest,
    body: web::Json<Login>,
) -> Result<HttpResponse, ApiError> {
    let email = normalize_email(&body.email).ok_or(ApiError::Unauthorized)?;
    let row = sqlx::query_as::<_, LoginUser>("SELECT id,email,display_name,password_hash,status,email_verified_at,created_at FROM account_users WHERE email_normalized=$1").bind(email).fetch_optional(&state.pool).await.map_err(|_| ApiError::Internal)?.ok_or(ApiError::Unauthorized)?;
    if !verify(&body.password, &row.password_hash).map_err(|_| ApiError::Internal)? {
        return Err(ApiError::Unauthorized);
    }
    if row.status != "active" {
        return Err(ApiError::Forbidden);
    }
    let raw = token();
    let expires = Utc::now() + Duration::days(state.config.session_days);
    let (ip, agent) = client_data(&req);
    let mut tx = state.pool.begin().await.map_err(|_| ApiError::Internal)?;
    sqlx::query("INSERT INTO account_sessions (id,user_id,token_hash,expires_at,user_agent,ip_address) VALUES ($1,$2,$3,$4,$5,$6::inet)").bind(Uuid::new_v4()).bind(row.id).bind(digest(&raw)).bind(expires).bind(&agent).bind(&ip).execute(&mut *tx).await.map_err(|_| ApiError::Internal)?;
    sqlx::query("UPDATE account_users SET last_login_at=NOW() WHERE id=$1")
        .bind(row.id)
        .execute(&mut *tx)
        .await
        .map_err(|_| ApiError::Internal)?;
    sqlx::query("INSERT INTO account_audit_log (actor_user_id,event_type,subject_type,subject_id,ip_address,user_agent) VALUES ($1,'account.login','user',$2,$3::inet,$4)").bind(row.id).bind(row.id.to_string()).bind(ip).bind(agent).execute(&mut *tx).await.map_err(|_| ApiError::Internal)?;
    tx.commit().await.map_err(|_| ApiError::Internal)?;
    let user = User {
        id: row.id,
        email: row.email,
        display_name: row.display_name,
        email_verified_at: row.email_verified_at,
        created_at: row.created_at,
    };
    Ok(HttpResponse::Ok()
        .cookie(session_cookie(raw, &state.config))
        .json(AuthResponse { user }))
}

async fn current_user(state: &State, req: &HttpRequest) -> Result<(User, String), ApiError> {
    let raw = req
        .cookie(SESSION_COOKIE)
        .map(|c| c.value().to_owned())
        .ok_or(ApiError::Unauthorized)?;
    let user = sqlx::query_as::<_, User>("SELECT u.id,u.email,u.display_name,u.email_verified_at,u.created_at FROM account_users u JOIN account_sessions s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>NOW() AND u.status='active'").bind(digest(&raw)).fetch_optional(&state.pool).await.map_err(|_| ApiError::Internal)?.ok_or(ApiError::Unauthorized)?;
    Ok((user, raw))
}

#[get("/v1/account")]
async fn account(state: web::Data<State>, req: HttpRequest) -> Result<HttpResponse, ApiError> {
    let (user, _) = current_user(&state, &req).await?;
    Ok(HttpResponse::Ok().json(user))
}

#[post("/v1/auth/logout")]
async fn logout(state: web::Data<State>, req: HttpRequest) -> Result<HttpResponse, ApiError> {
    if let Some(cookie) = req.cookie(SESSION_COOKIE) {
        sqlx::query("UPDATE account_sessions SET revoked_at=NOW() WHERE token_hash=$1 AND revoked_at IS NULL").bind(digest(cookie.value())).execute(&state.pool).await.map_err(|_| ApiError::Internal)?;
    }
    let removal = Cookie::build(SESSION_COOKIE, "")
        .path("/")
        .domain(state.config.cookie_domain.clone())
        .http_only(true)
        .secure(state.config.secure_cookies)
        .same_site(SameSite::Lax)
        .max_age(CookieDuration::seconds(0))
        .finish();
    Ok(HttpResponse::NoContent().cookie(removal).finish())
}

#[actix_web::main]
async fn main() -> io::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "rumahl_account=info".into()),
        )
        .init();
    let config = Config::from_env();
    let database_url = env::var("ACCOUNT_DATABASE_URL")
        .or_else(|_| env::var("DATABASE_URL"))
        .map_err(|_| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                "ACCOUNT_DATABASE_URL is required",
            )
        })?;
    let pool = PgPool::connect(&database_url)
        .await
        .map_err(io::Error::other)?;
    sqlx::raw_sql(include_str!("../migrations/001_accounts.sql"))
        .execute(&pool)
        .await
        .map_err(io::Error::other)?;
    let bind = config.bind.clone();
    info!(%bind, "Starting central account service");
    HttpServer::new(move || {
        App::new()
            .app_data(web::Data::new(State {
                pool: pool.clone(),
                config: config.clone(),
            }))
            .service(health)
            .service(register)
            .service(login)
            .service(logout)
            .service(account)
    })
    .bind(bind)?
    .run()
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn normalizes_email() {
        assert_eq!(
            normalize_email(" User@Example.COM ").as_deref(),
            Some("user@example.com")
        );
        assert_eq!(normalize_email("invalid"), None);
    }
    #[test]
    fn enforces_password_policy() {
        assert!(valid_password("LongPassword1"));
        assert!(!valid_password("short1A"));
        assert!(!valid_password("longpassword1"));
    }
    #[test]
    fn hashes_session_tokens() {
        assert_eq!(digest("token").len(), 64);
        assert_ne!(digest("token"), "token");
    }
}
