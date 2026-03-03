use reqwest::{Client, header};
use serde_json::Value;
use std::time::Duration;
use thiserror::Error;

use crate::EntityState;

#[derive(Error, Debug)]
pub enum HAClientError {
    #[error("HTTP request failed: {0}")]
    RequestError(#[from] reqwest::Error),

    #[error("Invalid response: {0}")]
    InvalidResponse(String),
}

pub type Result<T> = std::result::Result<T, HAClientError>;

/// Home Assistant HTTP client
pub struct HomeAssistantClient {
    base_url: String,
    token: String,
    client: Client,
}

impl HomeAssistantClient {
    /// Create a new Home Assistant client
    pub fn new(base_url: String, token: String) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .expect("Failed to create HTTP client");

        Self {
            base_url,
            token,
            client,
        }
    }

    /// Get authorization header
    fn auth_header(&self) -> String {
        format!("Bearer {}", self.token)
    }

    /// Get all entity states
    pub async fn get_states(&self) -> Result<Vec<EntityState>> {
        let url = format!("{}/api/states", self.base_url);

        let response = self
            .client
            .get(&url)
            .header(header::AUTHORIZATION, self.auth_header())
            .header(header::CONTENT_TYPE, "application/json")
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(HAClientError::InvalidResponse(
                format!("Status code: {}", response.status())
            ));
        }

        let states: Vec<EntityState> = response.json().await?;
        Ok(states)
    }

    /// Get single entity state
    pub async fn get_state(&self, entity_id: &str) -> Result<Option<EntityState>> {
        let url = format!("{}/api/states/{}", self.base_url, entity_id);

        let response = self
            .client
            .get(&url)
            .header(header::AUTHORIZATION, self.auth_header())
            .header(header::CONTENT_TYPE, "application/json")
            .send()
            .await?;

        if response.status().as_u16() == 404 {
            return Ok(None);
        }

        if !response.status().is_success() {
            return Err(HAClientError::InvalidResponse(
                format!("Status code: {}", response.status())
            ));
        }

        let state: EntityState = response.json().await?;
        Ok(Some(state))
    }

    /// Call a Home Assistant service
    pub async fn call_service(
        &self,
        domain: &str,
        service: &str,
        data: Value,
    ) -> Result<()> {
        let url = format!("{}/api/services/{}/{}", self.base_url, domain, service);

        let response = self
            .client
            .post(&url)
            .header(header::AUTHORIZATION, self.auth_header())
            .header(header::CONTENT_TYPE, "application/json")
            .json(&data)
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(HAClientError::InvalidResponse(
                format!("Status code: {}", response.status())
            ));
        }

        Ok(())
    }
}
