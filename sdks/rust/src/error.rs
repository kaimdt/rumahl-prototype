use thiserror::Error;

#[derive(Error, Debug)]
pub enum RumahlError {
    #[error("HTTP request failed: {0}")]
    Http(#[from] reqwest::Error),

    #[error("JSON serialization error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Permission denied: {0}")]
    PermissionDenied(String),

    #[error("Resource not found: {0}")]
    NotFound(String),

    #[error("Invalid manifest: {0}")]
    InvalidManifest(String),

    #[error("API error: {0}")]
    ApiError(String),

    #[error("Authentication failed: {0}")]
    AuthenticationFailed(String),

    #[error("Network access denied: {0}")]
    NetworkAccessDenied(String),

    #[error("Plugin execution error: {0}")]
    PluginError(String),

    #[error("Runtime error: {0}")]
    Runtime(String),

    #[error("Timeout: {0}")]
    Timeout(String),

    #[error("Unknown error: {0}")]
    Unknown(String),
}

pub type Result<T> = std::result::Result<T, RumahlError>;
