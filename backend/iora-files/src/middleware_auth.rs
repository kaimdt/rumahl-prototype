//! Authentication middleware for IORA Files routes.

use axum::{
    extract::{Request, State},
    http::{header, StatusCode},
    middleware::Next,
    response::Response,
};
use std::sync::Arc;

use crate::AppState;

/// Middleware that verifies JWT tokens on protected routes.
/// Passes through if valid; returns 401 otherwise.
pub async fn require_auth(
    State(state): State<Arc<AppState>>,
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let auth_header = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok());

    let token = match auth_header {
        Some(h) if h.starts_with("Bearer ") => &h[7..],
        _ => return Err(StatusCode::UNAUTHORIZED),
    };

    match crate::auth::verify_token(token, &state.jwt_secret) {
        Ok(_user_id) => Ok(next.run(request).await),
        Err(_) => Err(StatusCode::UNAUTHORIZED),
    }
}
