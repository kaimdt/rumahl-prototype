//! Frontend Development Proxy
//!
//! When IORA_FRONTEND_DEV_URL is set (e.g., http://localhost:5173), this module
//! proxies frontend requests to a Vite dev server, enabling Hot Module Replacement (HMR)
//! during development while keeping the backend integration intact.
//!
//! This provides two development modes:
//! 1. **Dev Proxy Mode**: Frontend requests → Vite dev server (fast HMR)
//! 2. **Build Mode**: Frontend requests → static dist files (production-like)

use axum::{
    body::Body,
    extract::Request,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use tracing::{debug, error, warn};

/// Check if frontend dev proxy mode is enabled via IORA_FRONTEND_DEV_URL
pub fn is_dev_proxy_enabled() -> Option<String> {
    std::env::var("IORA_FRONTEND_DEV_URL")
        .ok()
        .filter(|s| !s.trim().is_empty())
}

/// Proxy a request to the Vite dev server
///
/// This handler forwards the request to the dev server specified by IORA_FRONTEND_DEV_URL,
/// preserving headers and handling both regular HTTP requests and WebSocket upgrades
/// (for Vite's HMR).
#[allow(dead_code)]
pub async fn proxy_to_vite_dev(req: Request) -> Response {
    let dev_url = match is_dev_proxy_enabled() {
        Some(url) => url,
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                "IORA_FRONTEND_DEV_URL not configured",
            )
                .into_response()
        }
    };

    let uri = req.uri();
    let path = uri.path();
    let query = uri.query().map(|q| format!("?{}", q)).unwrap_or_default();

    // Build target URL
    let target_url = format!("{}{}{}", dev_url.trim_end_matches('/'), path, query);

    debug!(
        target = %target_url,
        method = %req.method(),
        "Proxying to Vite dev server"
    );

    // Check if this is a WebSocket upgrade request (for HMR)
    let headers = req.headers();
    let is_websocket = headers
        .get("upgrade")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.eq_ignore_ascii_case("websocket"))
        .unwrap_or(false);

    if is_websocket {
        // For WebSocket upgrades, we need special handling
        // Note: This is a simplified version. Full WebSocket proxy would require
        // hyper-tungstenite or similar for proper upgrade handling.
        warn!("WebSocket proxy not yet fully implemented, Vite HMR may not work");
        return (
            StatusCode::NOT_IMPLEMENTED,
            "WebSocket proxying not yet implemented. Use Vite dev server directly on port 5173 for HMR.",
        )
            .into_response();
    }

    // Create HTTP client for proxying
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            error!(error = %e, "Failed to create HTTP client");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to create proxy client: {}", e),
            )
                .into_response();
        }
    };

    // Build proxied request
    // Convert axum::http::Method -> reqwest::Method (http 1.x -> 0.2.x)
    let method = reqwest::Method::from_bytes(req.method().as_str().as_bytes())
        .unwrap_or(reqwest::Method::GET);
    let mut proxy_req = client.request(method, &target_url);

    // Copy relevant headers (skip host, connection, etc.)
    for (name, value) in headers.iter() {
        let name_str = name.as_str();
        // Skip hop-by-hop headers and host
        if !matches!(
            name_str.to_lowercase().as_str(),
            "host" | "connection" | "transfer-encoding" | "content-length"
        ) {
            if let Ok(val) = value.to_str() {
                proxy_req = proxy_req.header(name.as_str(), val);
            }
        }
    }

    // Send request to Vite dev server
    let response = match proxy_req.send().await {
        Ok(resp) => resp,
        Err(e) => {
            error!(
                error = %e,
                target = %target_url,
                "Failed to proxy request to Vite dev server"
            );
            return (
                StatusCode::BAD_GATEWAY,
                format!(
                    "Failed to connect to Vite dev server at {}: {}. Is it running?",
                    dev_url, e
                ),
            )
                .into_response();
        }
    };

    // Build response
    // Convert reqwest::StatusCode -> axum::http::StatusCode (http 0.2.x -> 1.x)
    let status = axum::http::StatusCode::from_u16(response.status().as_u16())
        .unwrap_or(axum::http::StatusCode::BAD_GATEWAY);
    let mut builder = Response::builder().status(status);

    // Copy response headers
    for (name, value) in response.headers().iter() {
        if let Ok(val) = value.to_str() {
            builder = builder.header(name.as_str(), val);
        }
    }

    // Get response body
    let body_bytes = match response.bytes().await {
        Ok(bytes) => bytes,
        Err(e) => {
            error!(error = %e, "Failed to read response body");
            return (
                StatusCode::BAD_GATEWAY,
                format!("Failed to read response from Vite dev server: {}", e),
            )
                .into_response();
        }
    };

    match builder.body(Body::from(body_bytes)) {
        Ok(resp) => resp,
        Err(e) => {
            error!(error = %e, "Failed to build response");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to build proxy response: {}", e),
            )
                .into_response()
        }
    }
}

/// Check if a path should be proxied to the dev server
///
/// Returns true for frontend assets and routes, false for API endpoints
pub fn should_proxy_path(path: &str) -> bool {
    // Don't proxy API endpoints, uploads, or health checks
    if path.starts_with("/api/")
        || path.starts_with("/ws/")
        || path.starts_with("/health")
        || path.starts_with("/uploads/")
    {
        return false;
    }

    // Proxy everything else (frontend assets, routes, etc.)
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_should_proxy_path() {
        // API paths should not be proxied
        assert!(!should_proxy_path("/api/devices"));
        assert!(!should_proxy_path("/api/config/theme"));
        assert!(!should_proxy_path("/ws/updates"));
        assert!(!should_proxy_path("/health"));
        assert!(!should_proxy_path("/uploads/image.png"));

        // Frontend paths should be proxied
        assert!(should_proxy_path("/"));
        assert!(should_proxy_path("/dashboard"));
        assert!(should_proxy_path("/settings"));
        assert!(should_proxy_path("/assets/index.js"));
        assert!(should_proxy_path("/@vite/client"));
        assert!(should_proxy_path("/src/App.tsx"));
    }
}
