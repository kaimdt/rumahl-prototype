use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct ErrorResponse {
    pub error: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
    pub status: u16,
}

#[derive(Debug)]
#[allow(dead_code)]
pub enum AppError {
    NotFound(String),
    Unauthorized(String),
    Forbidden(String),
    BadRequest(String),
    InternalError(String),
    ServiceUnavailable(String),
    Conflict(String),
    RateLimitExceeded,
}

#[allow(dead_code)]
impl AppError {
    pub fn status_code(&self) -> StatusCode {
        match self {
            AppError::NotFound(_) => StatusCode::NOT_FOUND,
            AppError::Unauthorized(_) => StatusCode::UNAUTHORIZED,
            AppError::Forbidden(_) => StatusCode::FORBIDDEN,
            AppError::BadRequest(_) => StatusCode::BAD_REQUEST,
            AppError::InternalError(_) => StatusCode::INTERNAL_SERVER_ERROR,
            AppError::ServiceUnavailable(_) => StatusCode::SERVICE_UNAVAILABLE,
            AppError::Conflict(_) => StatusCode::CONFLICT,
            AppError::RateLimitExceeded => StatusCode::TOO_MANY_REQUESTS,
        }
    }

    pub fn error_type(&self) -> &str {
        match self {
            AppError::NotFound(_) => "NOT_FOUND",
            AppError::Unauthorized(_) => "UNAUTHORIZED",
            AppError::Forbidden(_) => "FORBIDDEN",
            AppError::BadRequest(_) => "BAD_REQUEST",
            AppError::InternalError(_) => "INTERNAL_ERROR",
            AppError::ServiceUnavailable(_) => "SERVICE_UNAVAILABLE",
            AppError::Conflict(_) => "CONFLICT",
            AppError::RateLimitExceeded => "RATE_LIMIT_EXCEEDED",
        }
    }

    pub fn message(&self) -> String {
        match self {
            AppError::NotFound(msg) => msg.clone(),
            AppError::Unauthorized(msg) => msg.clone(),
            AppError::Forbidden(msg) => msg.clone(),
            AppError::BadRequest(msg) => msg.clone(),
            AppError::InternalError(msg) => msg.clone(),
            AppError::ServiceUnavailable(msg) => msg.clone(),
            AppError::Conflict(msg) => msg.clone(),
            AppError::RateLimitExceeded => {
                "Rate limit exceeded. Please try again later.".to_string()
            }
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = self.status_code();
        let error_type = self.error_type().to_string();
        let message = self.message();

        // Log internal errors
        if matches!(self, AppError::InternalError(_)) {
            tracing::error!("Internal error: {}", message);
        }

        let body = Json(ErrorResponse {
            error: error_type,
            message,
            details: None,
            status: status.as_u16(),
        });

        (status, body).into_response()
    }
}

impl From<anyhow::Error> for AppError {
    fn from(err: anyhow::Error) -> Self {
        AppError::InternalError(err.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        AppError::InternalError(err.to_string())
    }
}

impl From<reqwest::Error> for AppError {
    fn from(err: reqwest::Error) -> Self {
        if err.is_timeout() {
            AppError::ServiceUnavailable("Service timeout".to_string())
        } else if err.is_connect() {
            AppError::ServiceUnavailable("Failed to connect to service".to_string())
        } else {
            AppError::InternalError(err.to_string())
        }
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        AppError::BadRequest(format!("Invalid JSON: {}", err))
    }
}
