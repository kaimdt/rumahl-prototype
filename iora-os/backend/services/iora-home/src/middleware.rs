use axum::{
    extract::{Request, State},
    http::{header, StatusCode},
    middleware::Next,
    response::Response,
};
use tracing::warn;

use crate::auth;
use crate::AppState;

/// Authentication result: either JWT claims or API key identity
#[derive(Debug, Clone)]
pub enum AuthIdentity {
    Jwt(auth::Claims),
    ApiKey {
        user_id: String,
        #[allow(dead_code)]
        key_id: String,
        permissions: Vec<String>,
    },
}

impl AuthIdentity {
    pub fn user_id(&self) -> &str {
        match self {
            AuthIdentity::Jwt(claims) => &claims.sub,
            AuthIdentity::ApiKey { user_id, .. } => user_id,
        }
    }

    pub fn is_admin(&self) -> bool {
        match self {
            AuthIdentity::Jwt(claims) => claims.is_admin,
            AuthIdentity::ApiKey { .. } => false, // API keys are never admin
        }
    }

    pub fn has_permission(&self, perm: &str) -> bool {
        match self {
            AuthIdentity::Jwt(_) => true, // JWT users have all permissions
            AuthIdentity::ApiKey { permissions, .. } => {
                permissions.contains(&perm.to_string()) || permissions.contains(&"*".to_string())
            }
        }
    }
}

/// Try to authenticate a request via Bearer JWT token, X-API-Key header, or token query parameter.
/// Returns None if no auth is present, Some(identity) if valid.
pub async fn try_authenticate(
    authorization_header: Option<String>,
    api_key_header: Option<String>,
    query_string: Option<String>,
    state: &AppState,
) -> Option<AuthIdentity> {
    // 1. Try JWT Bearer token
    if let Some(token) = authorization_header
        .as_deref()
        .and_then(|v| v.strip_prefix("Bearer "))
    {
        // Check if it looks like an API key (starts with "mdt_")
        if token.starts_with("mdt_") {
            return try_api_key_auth(token, state).await;
        }
        // Otherwise treat as JWT
        if let Ok(claims) = auth::verify_token(token) {
            // Check if this JWT has been blacklisted (logout/revoke)
            if state
                .config_repo
                .is_jwt_blacklisted(&claims.jti)
                .await
                .unwrap_or(false)
            {
                warn!("Rejected blacklisted JWT (jti={})", &claims.jti[..8]);
                return None;
            }
            return Some(AuthIdentity::Jwt(claims));
        }
    }

    // 2. Try X-API-Key header
    if let Some(api_key) = api_key_header.as_deref() {
        return try_api_key_auth(api_key, state).await;
    }

    // 3. Try token query parameter
    if let Some(query) = query_string.as_deref() {
        if let Some(token) = query.split('&').find_map(|pair| {
            let mut parts = pair.splitn(2, '=');
            let key = parts.next()?;
            let value = parts.next()?;
            if key == "token" {
                Some(value)
            } else {
                None
            }
        }) {
            // Check if it looks like an API key (starts with "mdt_")
            if token.starts_with("mdt_") {
                return try_api_key_auth(token, state).await;
            }
            if let Ok(claims) = auth::verify_token(token) {
                // Check if this JWT has been blacklisted
                if state
                    .config_repo
                    .is_jwt_blacklisted(&claims.jti)
                    .await
                    .unwrap_or(false)
                {
                    warn!("Rejected blacklisted JWT from query param (jti={})", &claims.jti[..8]);
                    return None;
                }
                return Some(AuthIdentity::Jwt(claims));
            }
        }
    }

    None
}

/// Validate an API key and return auth identity
async fn try_api_key_auth(key: &str, state: &AppState) -> Option<AuthIdentity> {
    let prefix = auth::api_key_prefix(key);

    let api_key = match state.config_repo.get_api_key_by_prefix(&prefix).await {
        Ok(Some(k)) => k,
        _ => return None,
    };

    // Check if expired
    if let Some(ref expires) = api_key.expires_at {
        if *expires < chrono::Utc::now() {
            return None;
        }
    }

    // Verify key hash
    if auth::verify_password(key, &api_key.key_hash).ok() != Some(true) {
        return None;
    }

    // Check rate limit
    if state
        .config_repo
        .check_rate_limit(&api_key.id, api_key.rate_limit)
        .await
        .ok()
        != Some(true)
    {
        return None;
    }

    // Update last used (fire and forget)
    let repo = state.config_repo.clone();
    let key_id = api_key.id.clone();
    tokio::spawn(async move {
        let _ = repo.update_api_key_last_used(&key_id).await;
    });

    let permissions: Vec<String> =
        serde_json::from_str(&api_key.permissions).unwrap_or_else(|_| vec!["read".to_string()]);

    Some(AuthIdentity::ApiKey {
        user_id: api_key.user_id,
        key_id: api_key.id,
        permissions,
    })
}

/// Middleware that verifies JWT authentication and X-Action-Intent header
/// on service call routes to ensure actions are user-initiated.
pub async fn require_auth(
    state: State<AppState>,
    mut request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let state = state.0;
    let identity = try_authenticate(
        request
            .headers()
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string()),
        request
            .headers()
            .get("x-api-key")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string()),
        request.uri().query().map(|s| s.to_string()),
        &state,
    )
    .await;

    match identity {
        Some(id) => {
            // For service calls, require X-Action-Intent header (CSRF protection)
            let has_intent = request
                .headers()
                .get("x-action-intent")
                .and_then(|v| v.to_str().ok())
                .map(|v| !v.is_empty())
                .unwrap_or(false);

            // API keys don't need intent header (they're programmatic)
            if !has_intent && matches!(id, AuthIdentity::Jwt(_)) {
                warn!("Service call rejected: missing X-Action-Intent header");
                return Err(StatusCode::FORBIDDEN);
            }

            // Check write permission for API keys
            if !id.has_permission("write") && !id.has_permission("*") {
                if matches!(id, AuthIdentity::ApiKey { .. }) {
                    warn!("Service call rejected: API key lacks write permission");
                    return Err(StatusCode::FORBIDDEN);
                }
            }

            request.extensions_mut().insert(id);
            Ok(next.run(request).await)
        }
        None => {
            warn!("Service call rejected: missing or invalid authentication");
            Err(StatusCode::UNAUTHORIZED)
        }
    }
}

/// Middleware that requires admin access
pub async fn require_admin(
    state: State<AppState>,
    mut request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let state = state.0;
    let identity = try_authenticate(
        request
            .headers()
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string()),
        request
            .headers()
            .get("x-api-key")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string()),
        request.uri().query().map(|s| s.to_string()),
        &state,
    )
    .await;

    match identity {
        Some(id) if id.is_admin() => {
            request.extensions_mut().insert(id);
            Ok(next.run(request).await)
        }
        Some(_) => {
            warn!("Admin access rejected: user is not admin");
            Err(StatusCode::FORBIDDEN)
        }
        None => {
            warn!("Admin access rejected: not authenticated");
            Err(StatusCode::UNAUTHORIZED)
        }
    }
}

/// Middleware that requires authentication (JWT or API key) but not admin
pub async fn require_authenticated(
    state: State<AppState>,
    mut request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let state = state.0;
    let identity = try_authenticate(
        request
            .headers()
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string()),
        request
            .headers()
            .get("x-api-key")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string()),
        request.uri().query().map(|s| s.to_string()),
        &state,
    )
    .await;

    match identity {
        Some(id) => {
            request.extensions_mut().insert(id);
            Ok(next.run(request).await)
        }
        None => {
            warn!("Authenticated access rejected: not authenticated");
            Err(StatusCode::UNAUTHORIZED)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_jwt_claims(sub: &str, is_admin: bool) -> auth::Claims {
        auth::Claims {
            sub: sub.to_string(),
            jti: "test-jti".to_string(),
            username: "testuser".to_string(),
            is_admin,
            exp: 9999999999,
        }
    }

    #[test]
    fn test_auth_identity_jwt_user_id() {
        let identity = AuthIdentity::Jwt(make_jwt_claims("user_123", false));
        assert_eq!(identity.user_id(), "user_123");
        assert!(!identity.is_admin());
        assert!(identity.has_permission("read"));
        assert!(identity.has_permission("anything"));
    }

    #[test]
    fn test_auth_identity_jwt_admin() {
        let identity = AuthIdentity::Jwt(make_jwt_claims("admin_001", true));
        assert_eq!(identity.user_id(), "admin_001");
        assert!(identity.is_admin());
    }

    #[test]
    fn test_auth_identity_api_key_read_only() {
        let identity = AuthIdentity::ApiKey {
            user_id: "user_456".to_string(),
            key_id: "key_001".to_string(),
            permissions: vec!["read".to_string()],
        };
        assert_eq!(identity.user_id(), "user_456");
        assert!(!identity.is_admin());
        assert!(identity.has_permission("read"));
        assert!(!identity.has_permission("write"));
    }

    #[test]
    fn test_auth_identity_api_key_wildcard() {
        let identity = AuthIdentity::ApiKey {
            user_id: "user_789".to_string(),
            key_id: "key_002".to_string(),
            permissions: vec!["*".to_string()],
        };
        assert!(identity.has_permission("read"));
        assert!(identity.has_permission("write"));
        assert!(identity.has_permission("admin"));
    }

    #[test]
    fn test_auth_identity_api_key_no_permissions() {
        let identity = AuthIdentity::ApiKey {
            user_id: "user_000".to_string(),
            key_id: "key_000".to_string(),
            permissions: vec![],
        };
        assert!(!identity.has_permission("read"));
        assert!(!identity.has_permission("write"));
    }
}
