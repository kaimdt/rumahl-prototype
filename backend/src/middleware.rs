use axum::{
    extract::Request,
    http::{header, StatusCode},
    middleware::Next,
    response::Response,
};
use tracing::warn;

use crate::auth;

/// Middleware that verifies JWT authentication and X-Action-Intent header
/// on service call routes to ensure actions are user-initiated.
pub async fn require_auth(
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let headers = request.headers();

    // 1. Extract and verify Authorization: Bearer <token>
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));

    let token = match token {
        Some(t) if !t.is_empty() => t,
        _ => {
            warn!("Service call rejected: missing or invalid Authorization header");
            return Err(StatusCode::UNAUTHORIZED);
        }
    };

    // 2. Verify the JWT token
    if let Err(e) = auth::verify_token(token) {
        warn!("Service call rejected: invalid token - {}", e);
        return Err(StatusCode::UNAUTHORIZED);
    }

    // 3. Check X-Action-Intent header exists and is non-empty
    let has_intent = headers
        .get("x-action-intent")
        .and_then(|v| v.to_str().ok())
        .map(|v| !v.is_empty())
        .unwrap_or(false);

    if !has_intent {
        warn!("Service call rejected: missing X-Action-Intent header");
        return Err(StatusCode::FORBIDDEN);
    }

    // All checks passed — forward the request
    Ok(next.run(request).await)
}
