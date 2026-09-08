use axum::{
    extract::{Request, State},
    http::{HeaderMap, StatusCode},
    middleware::Next,
    response::Response,
};
use jsonwebtoken::{decode, DecodingKey, Validation};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Debug, Clone)]
pub struct AuthState {}

impl AuthState {
    pub fn new() -> Self {
        Self {}
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    pub sub: String, // user ID
    pub username: String,
    // role/iat are NOT emitted by rumahl-home's JWT generator; make them
    // optional so tokens issued by /api/auth/login validate here.
    #[serde(default)]
    pub role: String,
    pub is_admin: bool,
    pub exp: usize, // expiration time
    #[serde(default)]
    pub iat: usize, // issued at
}

/// Extract and validate JWT token from Authorization header
pub async fn auth_middleware(
    State(_state): State<Arc<AuthState>>,
    headers: HeaderMap,
    mut request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    // Extract Authorization header
    let auth_header = headers
        .get("Authorization")
        .and_then(|h| h.to_str().ok())
        .ok_or(StatusCode::UNAUTHORIZED)?;

    // Parse Bearer token
    let token = auth_header
        .strip_prefix("Bearer ")
        .ok_or(StatusCode::UNAUTHORIZED)?;

    // Validate JWT
    let mut validation = Validation::default();
    validation.validate_exp = true;

    let token_data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(rumahl_shared_config::system_config::jwt_secret().as_bytes()),
        &validation,
    )
    .map_err(|e| {
        tracing::warn!("JWT validation failed: {}", e);
        StatusCode::UNAUTHORIZED
    })?;

    // Check admin permissions
    if !token_data.claims.is_admin {
        tracing::warn!(
            "Non-admin user attempted to access control center: {}",
            token_data.claims.username
        );
        return Err(StatusCode::FORBIDDEN);
    }

    // Add claims to request extensions for downstream handlers
    request.extensions_mut().insert(token_data.claims);

    Ok(next.run(request).await)
}

/// Optional auth middleware that allows unauthenticated requests but extracts claims if present
#[allow(dead_code)]
pub async fn optional_auth_middleware(
    State(_state): State<Arc<AuthState>>,
    headers: HeaderMap,
    mut request: Request,
    next: Next,
) -> Response {
    if let Some(auth_header) = headers.get("Authorization") {
        if let Ok(header_str) = auth_header.to_str() {
            if let Some(token) = header_str.strip_prefix("Bearer ") {
                let validation = Validation::default();
                if let Ok(token_data) = decode::<Claims>(
                    token,
                    &DecodingKey::from_secret(
                        rumahl_shared_config::system_config::jwt_secret().as_bytes(),
                    ),
                    &validation,
                ) {
                    request.extensions_mut().insert(token_data.claims);
                }
            }
        }
    }

    next.run(request).await
}

/// Extract claims from request extensions
#[allow(dead_code)]
pub fn get_claims(request: &Request) -> Option<Claims> {
    request.extensions().get::<Claims>().cloned()
}
