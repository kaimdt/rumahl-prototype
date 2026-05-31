use reqwest::{Client, header};
use serde_json::Value;
use std::sync::Arc;
use std::time::Duration;
use thiserror::Error;

use crate::EntityState;

#[derive(Error, Debug)]
pub enum HAClientError {
    #[error("HTTP request failed: {0}")]
    RequestError(#[from] reqwest::Error),

    #[error("Upstream status {status}: {body}")]
    UpstreamStatus {
        status: u16,
        body: String,
    },

    #[error("Invalid response: {0}")]
    InvalidResponse(String),
}

impl HAClientError {
    pub fn status_code(&self) -> Option<u16> {
        match self {
            HAClientError::UpstreamStatus { status, .. } => Some(*status),
            _ => None,
        }
    }
}

pub type Result<T> = std::result::Result<T, HAClientError>;

pub struct ProxyGetResponse {
    pub status: u16,
    pub content_type: Option<String>,
    pub body: Vec<u8>,
}

/// Home Assistant HTTP client
///
/// Uses **two separate connection pools** so that long-running polling
/// requests (`get_states` – 400+ kB) never starve quick command calls.
///
/// URL and token are stored behind an `Arc<RwLock<>>` so they can be
/// updated at runtime when the admin changes HA credentials via the
/// Control Center — no service restart required.
pub struct HomeAssistantClient {
    base_url: Arc<tokio::sync::RwLock<String>>,
    token: Arc<tokio::sync::RwLock<String>>,
    /// Client for large / slow reads (get_states, get_history).
    /// Generous timeout, separate pool.
    poll_client: Client,
    /// Client for fast commands (call_service, get single state).
    /// Short timeout, separate pool, never blocked by polling.
    cmd_client: Client,
}

impl HomeAssistantClient {
    /// Create a new Home Assistant client
    pub fn new(base_url: String, token: String) -> Self {
        let poll_client = Client::builder()
            .timeout(Duration::from_secs(30))
            .pool_max_idle_per_host(2)
            .tcp_keepalive(Some(Duration::from_secs(30)))
            .build()
            .expect("Failed to create poll HTTP client");

        let cmd_client = Client::builder()
            .timeout(Duration::from_secs(8))
            .pool_max_idle_per_host(4)
            .tcp_keepalive(Some(Duration::from_secs(30)))
            .build()
            .expect("Failed to create cmd HTTP client");

        Self {
            base_url: Arc::new(tokio::sync::RwLock::new(base_url)),
            token: Arc::new(tokio::sync::RwLock::new(token)),
            poll_client,
            cmd_client,
        }
    }

    /// Update HA credentials at runtime — no service restart required.
    /// Called automatically when the admin changes `ha.url` / `ha.token`
    /// settings in the Control Center.
    pub async fn update_credentials(&self, url: &str, token: &str) {
        if !url.is_empty() {
            *self.base_url.write().await = url.to_string();
        }
        if !token.is_empty() {
            *self.token.write().await = token.to_string();
        }
        tracing::info!(
            "HA client credentials updated: url={}, token_len={}",
            if url.is_empty() { "(unchanged)" } else { url },
            token.len(),
        );
    }

    /// Get the current base URL (for diagnostics)
    pub async fn get_base_url(&self) -> String {
        self.base_url.read().await.clone()
    }

    /// Quick connectivity test — returns true if HA is reachable with current creds.
    pub async fn test_connection(&self) -> Result<bool> {
        let url = format!("{}/api/", self.base_url.read().await);
        let token = self.token.read().await.clone();
        let response = self
            .cmd_client
            .get(&url)
            .header(header::AUTHORIZATION, format!("Bearer {}", token))
            .timeout(Duration::from_secs(5))
            .send()
            .await?;
        Ok(response.status().is_success())
    }

    /// Get authorization header
    async fn auth_header(&self) -> String {
        format!("Bearer {}", self.token.read().await)
    }

    /// Get all entity states (uses poll_client — slow path)
    pub async fn get_states(&self) -> Result<Vec<EntityState>> {
        let url = format!("{}/api/states", self.base_url.read().await);

        let response = self
            .poll_client
            .get(&url)
            .header(header::AUTHORIZATION, self.auth_header().await)
            .header(header::CONTENT_TYPE, "application/json")
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status().as_u16();
            let body = response.text().await.unwrap_or_default();
            return Err(HAClientError::UpstreamStatus { status, body });
        }

        let states: Vec<EntityState> = response.json().await?;
        Ok(states)
    }

    /// Get single entity state (uses cmd_client — fast path)
    pub async fn get_state(&self, entity_id: &str) -> Result<Option<EntityState>> {
        let url = format!("{}/api/states/{}", self.base_url.read().await, entity_id);

        let response = self
            .cmd_client
            .get(&url)
            .header(header::AUTHORIZATION, self.auth_header().await)
            .header(header::CONTENT_TYPE, "application/json")
            .send()
            .await?;

        if response.status().as_u16() == 404 {
            return Ok(None);
        }

        if !response.status().is_success() {
            let status = response.status().as_u16();
            let body = response.text().await.unwrap_or_default();
            return Err(HAClientError::UpstreamStatus { status, body });
        }

        let state: EntityState = response.json().await?;
        Ok(Some(state))
    }

    /// Call a Home Assistant service (full response - used for return_response queries)
    pub async fn call_service(
        &self,
        domain: &str,
        service: &str,
        data: Value,
        query: &str,
    ) -> Result<Value> {
        let url = if query.is_empty() {
            format!("{}/api/services/{}/{}", self.base_url.read().await, domain, service)
        } else {
            format!("{}/api/services/{}/{}?{}", self.base_url.read().await, domain, service, query)
        };

        let response = self
            .cmd_client
            .post(&url)
            .header(header::AUTHORIZATION, self.auth_header().await)
            .header(header::CONTENT_TYPE, "application/json")
            .json(&data)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status().as_u16();
            let body = response.text().await.unwrap_or_default();
            return Err(HAClientError::UpstreamStatus { status, body });
        }

        let body: Value = response.json().await.unwrap_or(Value::Null);
        Ok(body)
    }

    /// Call a Home Assistant service without reading the response body.
    /// Only checks the HTTP status code, then drops the connection.
    /// Much faster because HA returns all changed entity states in the body
    /// which can be very large and slow to transfer/parse.
    pub async fn call_service_fast(
        &self,
        domain: &str,
        service: &str,
        data: Value,
    ) -> Result<()> {
        let url = format!("{}/api/services/{}/{}", self.base_url.read().await, domain, service);

        let response = self
            .cmd_client
            .post(&url)
            .header(header::AUTHORIZATION, self.auth_header().await)
            .header(header::CONTENT_TYPE, "application/json")
            .json(&data)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status().as_u16();
            let body = response.text().await.unwrap_or_default();
            return Err(HAClientError::UpstreamStatus { status, body });
        }

        // Intentionally NOT reading the body — drop the response immediately.
        Ok(())
    }

    /// Get entity history (uses poll_client — slow path)
    pub async fn get_history(
        &self,
        start_time: &str,
        query: &str,
    ) -> Result<Value> {
        let url = format!(
            "{}/api/history/period/{}?{}",
            self.base_url.read().await, start_time, query
        );

        let response = self
            .poll_client
            .get(&url)
            .header(header::AUTHORIZATION, self.auth_header().await)
            .header(header::CONTENT_TYPE, "application/json")
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status().as_u16();
            let body = response.text().await.unwrap_or_default();
            return Err(HAClientError::UpstreamStatus { status, body });
        }

        let body: Value = response.json().await.unwrap_or(Value::Null);
        Ok(body)
    }

    async fn proxy_api_get(
        &self,
        api_relative_path: &str,
        query: &str,
        retry_without_auth: bool,
    ) -> Result<ProxyGetResponse> {
        let base = self.base_url.read().await;
        let base = base.trim_end_matches('/');
        let path = api_relative_path.trim_start_matches('/');
        let url = if query.is_empty() {
            format!("{}/api/{}", base, path)
        } else {
            format!("{}/api/{}?{}", base, path, query)
        };

        let token = self.token.read().await.clone();
        let auth_value = format!("Bearer {}", token);
        let response = self
            .cmd_client
            .get(&url)
            .header(header::AUTHORIZATION, &auth_value)
            .send()
            .await?;

        // Some image endpoints are intentionally public and may behave differently
        // when an Authorization header is present. Retry without auth when needed.
        let response = if retry_without_auth && matches!(response.status().as_u16(), 401 | 403) {
            self.cmd_client
                .get(&url)
                .send()
                .await?
        } else {
            response
        };

        let status = response.status().as_u16();
        let content_type = response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(|v| v.to_string());
        let body = response.bytes().await?.to_vec();

        Ok(ProxyGetResponse {
            status,
            content_type,
            body,
        })
    }

    /// Proxy a GET request to Home Assistant's hass_agent API.
    /// This is used for media thumbnails so clients do not need direct HA reachability.
    pub async fn proxy_hass_agent_get(
        &self,
        relative_path: &str,
        query: &str,
    ) -> Result<ProxyGetResponse> {
        let path = relative_path.trim_start_matches('/');
        self.proxy_api_get(&format!("hass_agent/{}", path), query, true).await
    }

    /// Proxy a GET request to Home Assistant's /api/image/serve endpoint.
    pub async fn proxy_image_serve_get(
        &self,
        relative_path: &str,
        query: &str,
    ) -> Result<ProxyGetResponse> {
        let path = relative_path.trim_start_matches('/');
        self.proxy_api_get(&format!("image/serve/{}", path), query, true).await
    }

    /// Render a Jinja2 template in Home Assistant
    pub async fn render_template(&self, template: &str) -> Result<String> {
        let url = format!("{}/api/template", self.base_url.read().await);
        let response = self
            .cmd_client
            .post(&url)
            .header(header::AUTHORIZATION, self.auth_header().await)
            .header(header::CONTENT_TYPE, "application/json")
            .json(&serde_json::json!({ "template": template }))
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status().as_u16();
            let body = response.text().await.unwrap_or_default();
            return Err(HAClientError::UpstreamStatus { status, body });
        }

        response.text().await.map_err(|e| HAClientError::InvalidResponse(e.to_string()))
    }

    /// Get logbook entries for a time period
    pub async fn get_logbook(&self, start_time: &str, query: &str) -> Result<Value> {
        let url = if query.is_empty() {
            format!("{}/api/logbook/{}", self.base_url.read().await, start_time)
        } else {
            format!("{}/api/logbook/{}?{}", self.base_url.read().await, start_time, query)
        };

        let response = self
            .poll_client
            .get(&url)
            .header(header::AUTHORIZATION, self.auth_header().await)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status().as_u16();
            let body = response.text().await.unwrap_or_default();
            return Err(HAClientError::UpstreamStatus { status, body });
        }

        response.json::<Value>().await.map_err(|e| HAClientError::InvalidResponse(e.to_string()))
    }

    /// Get available calendars
    pub async fn get_calendars(&self) -> Result<Value> {
        let url = format!("{}/api/calendars", self.base_url.read().await);
        let response = self
            .cmd_client
            .get(&url)
            .header(header::AUTHORIZATION, self.auth_header().await)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status().as_u16();
            let body = response.text().await.unwrap_or_default();
            return Err(HAClientError::UpstreamStatus { status, body });
        }

        response.json::<Value>().await.map_err(|e| HAClientError::InvalidResponse(e.to_string()))
    }

    /// Get calendar events for a specific calendar
    pub async fn get_calendar_events(
        &self,
        entity_id: &str,
        start: &str,
        end: &str,
    ) -> Result<Value> {
        // HA calendar API requires URL-encoded ISO datetime params
        let url = format!(
            "{}/api/calendars/{}",
            self.base_url.read().await, entity_id
        );
        let response = self
            .cmd_client
            .get(&url)
            .header(header::AUTHORIZATION, self.auth_header().await)
            .query(&[("start", start), ("end", end)])
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status().as_u16();
            let body = response.text().await.unwrap_or_default();
            return Err(HAClientError::UpstreamStatus { status, body });
        }

        response.json::<Value>().await.map_err(|e| HAClientError::InvalidResponse(e.to_string()))
    }

    /// Fire an event on Home Assistant
    pub async fn fire_event(&self, event_type: &str, data: Value) -> Result<Value> {
        let url = format!("{}/api/events/{}", self.base_url.read().await, event_type);
        let response = self
            .cmd_client
            .post(&url)
            .header(header::AUTHORIZATION, self.auth_header().await)
            .header(header::CONTENT_TYPE, "application/json")
            .json(&data)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status().as_u16();
            let body = response.text().await.unwrap_or_default();
            return Err(HAClientError::UpstreamStatus { status, body });
        }

        response.json::<Value>().await.map_err(|e| HAClientError::InvalidResponse(e.to_string()))
    }

    /// Get HA error log as plain text
    pub async fn get_error_log(&self) -> Result<String> {
        let url = format!("{}/api/error_log", self.base_url.read().await);
        let response = self
            .cmd_client
            .get(&url)
            .header(header::AUTHORIZATION, self.auth_header().await)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status().as_u16();
            let body = response.text().await.unwrap_or_default();
            return Err(HAClientError::UpstreamStatus { status, body });
        }

        response.text().await.map_err(|e| HAClientError::InvalidResponse(e.to_string()))
    }

    /// Generic GET to any HA REST API path, returning JSON
    pub async fn api_get(&self, path: &str) -> Result<Value> {
        let url = format!("{}{}", self.base_url.read().await, path);
        let response = self
            .cmd_client
            .get(&url)
            .header(header::AUTHORIZATION, self.auth_header().await)
            .header(header::CONTENT_TYPE, "application/json")
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status().as_u16();
            let body = response.text().await.unwrap_or_default();
            return Err(HAClientError::UpstreamStatus { status, body });
        }

        response.json::<Value>().await.map_err(|e| HAClientError::InvalidResponse(e.to_string()))
    }

    /// Set entity state directly (POST /api/states/<entity_id>)
    /// Used by desktop client gateway to update sensor values
    pub async fn set_state(&self, entity_id: &str, state_data: Value) -> Result<()> {
        let url = format!("{}/api/states/{}", self.base_url.read().await, entity_id);
        let response = self
            .cmd_client
            .post(&url)
            .header(header::AUTHORIZATION, self.auth_header().await)
            .header(header::CONTENT_TYPE, "application/json")
            .json(&state_data)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status().as_u16();
            let body = response.text().await.unwrap_or_default();
            return Err(HAClientError::UpstreamStatus { status, body });
        }

        Ok(())
    }
}
