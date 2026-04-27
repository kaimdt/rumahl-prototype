use crate::error::{IoraError, Result};
use crate::types::*;
use reqwest::{Client, header};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use base64::{Engine as _, engine::general_purpose};

/// Main IORA API client
pub struct IoraClient {
    base_url: String,
    client: Client,
    api_key: Option<String>,
}

impl IoraClient {
    /// Create a new IORA client
    ///
    /// # Arguments
    /// * `base_url` - The base URL of the IORA instance (e.g., "http://localhost:8080")
    pub fn new(base_url: impl Into<String>) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .expect("Failed to build HTTP client");

        Self {
            base_url: base_url.into(),
            client,
            api_key: None,
        }
    }

    /// Set the API key for authentication
    pub fn with_api_key(mut self, api_key: impl Into<String>) -> Self {
        self.api_key = Some(api_key.into());
        self
    }

    /// Get the entities API
    pub fn entities(&self) -> EntitiesApi {
        EntitiesApi { client: self }
    }

    /// Get the notifications API
    pub fn notifications(&self) -> NotificationsApi {
        NotificationsApi { client: self }
    }

    /// Get the storage API
    pub fn storage(&self) -> StorageApi {
        StorageApi { client: self }
    }

    /// Get the settings API
    pub fn settings(&self) -> SettingsApi {
        SettingsApi { client: self }
    }

    /// Get the files API (iora-share)
    pub fn files(&self) -> FilesApi {
        FilesApi { client: self }
    }

    /// Get the automations API
    pub fn automations(&self) -> AutomationsApi {
        AutomationsApi { client: self }
    }

    /// Internal method to make authenticated requests
    async fn request<T: for<'de> Deserialize<'de>>(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<serde_json::Value>,
    ) -> Result<T> {
        let url = format!("{}{}", self.base_url, path);
        let mut req = self.client.request(method, &url);

        if let Some(api_key) = &self.api_key {
            req = req.header("Authorization", format!("Bearer {}", api_key));
        }

        if let Some(body) = body {
            req = req.json(&body);
        }

        let res = req.send().await?;

        if !res.status().is_success() {
            let status = res.status();
            let error_text = res.text().await.unwrap_or_else(|_| "Unknown error".to_string());
            return Err(IoraError::ApiError(format!("Status {}: {}", status, error_text)));
        }

        Ok(res.json().await?)
    }
}

/// Entities API
pub struct EntitiesApi<'a> {
    client: &'a IoraClient,
}

impl<'a> EntitiesApi<'a> {
    /// List all entities
    pub async fn list(&self) -> Result<Vec<Entity>> {
        self.client.request(reqwest::Method::GET, "/api/states", None).await
    }

    /// Get a specific entity
    pub async fn get(&self, entity_id: &str) -> Result<Entity> {
        let path = format!("/api/states/{}", entity_id);
        self.client.request(reqwest::Method::GET, &path, None).await
    }

    /// Call a service on an entity
    pub async fn call_service(
        &self,
        domain: &str,
        service: &str,
        entity_id: &str,
        data: serde_json::Value,
    ) -> Result<serde_json::Value> {
        let path = format!("/api/services/{}/{}", domain, service);
        let body = serde_json::json!({
            "entity_id": entity_id,
            "service_data": data
        });
        self.client.request(reqwest::Method::POST, &path, Some(body)).await
    }
}

/// Notifications API
pub struct NotificationsApi<'a> {
    client: &'a IoraClient,
}

impl<'a> NotificationsApi<'a> {
    /// Send a notification
    pub async fn send(&self, notification: NotificationPayload) -> Result<serde_json::Value> {
        self.client.request(
            reqwest::Method::POST,
            "/api/notifications/send",
            Some(serde_json::to_value(notification)?),
        ).await
    }

    /// Get all notifications
    pub async fn list(&self) -> Result<Vec<serde_json::Value>> {
        self.client.request(reqwest::Method::GET, "/api/notifications", None).await
    }
}

/// Storage API for persistent data
pub struct StorageApi<'a> {
    client: &'a IoraClient,
}

impl<'a> StorageApi<'a> {
    /// Store a value
    pub async fn set(&self, key: &str, value: serde_json::Value) -> Result<serde_json::Value> {
        let path = format!("/api/storage/{}", key);
        self.client.request(reqwest::Method::PUT, &path, Some(value)).await
    }

    /// Get a value
    pub async fn get(&self, key: &str) -> Result<serde_json::Value> {
        let path = format!("/api/storage/{}", key);
        self.client.request(reqwest::Method::GET, &path, None).await
    }

    /// Delete a value
    pub async fn delete(&self, key: &str) -> Result<serde_json::Value> {
        let path = format!("/api/storage/{}", key);
        self.client.request(reqwest::Method::DELETE, &path, None).await
    }
}

/// Settings API for app configuration
pub struct SettingsApi<'a> {
    client: &'a IoraClient,
}

impl<'a> SettingsApi<'a> {
    /// Get app settings
    pub async fn get(&self, app_id: &str) -> Result<AppSettings> {
        let path = format!("/api/appstore/apps/{}/settings", app_id);
        self.client.request(reqwest::Method::GET, &path, None).await
    }

    /// Update app settings
    pub async fn update(&self, app_id: &str, settings: serde_json::Value) -> Result<serde_json::Value> {
        self.client.request(
            reqwest::Method::POST,
            "/api/appstore/settings",
            Some(serde_json::json!({
                "app_id": app_id,
                "settings": settings
            })),
        ).await
    }
}

/// Files API for iora-share file management
/// Requires FileShareRead, FileShareWrite, FileShareDelete, or FileShareManage permissions
pub struct FilesApi<'a> {
    client: &'a IoraClient,
}

impl<'a> FilesApi<'a> {
    /// List all files accessible to the app
    /// Requires: FileShareRead permission
    pub async fn list(&self, path: Option<&str>) -> Result<Vec<FileMetadata>> {
        let path_param = path.unwrap_or("/");
        let endpoint = format!("/api/files?path={}", path_param);
        self.client.request(reqwest::Method::GET, &endpoint, None).await
    }

    /// Get file metadata
    /// Requires: FileShareRead permission
    pub async fn get_metadata(&self, file_id: &str) -> Result<FileMetadata> {
        let path = format!("/api/files/{}/metadata", file_id);
        self.client.request(reqwest::Method::GET, &path, None).await
    }

    /// Download a file
    /// Requires: FileShareRead permission
    pub async fn download(&self, file_id: &str) -> Result<Vec<u8>> {
        let url = format!("{}/api/files/{}/download", self.client.base_url, file_id);
        let mut req = self.client.client.get(&url);

        if let Some(api_key) = &self.client.api_key {
            req = req.header("Authorization", format!("Bearer {}", api_key));
        }

        let res = req.send().await?;
        if !res.status().is_success() {
            let status = res.status();
            let error_text = res.text().await.unwrap_or_else(|_| "Unknown error".to_string());
            return Err(IoraError::ApiError(format!("Status {}: {}", status, error_text)));
        }

        Ok(res.bytes().await?.to_vec())
    }

    /// Upload a file
    /// Requires: FileShareWrite permission
    pub async fn upload(&self, upload: FileUpload) -> Result<FileMetadata> {
        let body = serde_json::json!({
            "name": upload.name,
            "path": upload.path,
            "content": general_purpose::STANDARD.encode(&upload.content),
            "mime_type": upload.mime_type
        });
        self.client.request(reqwest::Method::POST, "/api/files/upload", Some(body)).await
    }

    /// Delete a file
    /// Requires: FileShareDelete permission
    pub async fn delete(&self, file_id: &str) -> Result<serde_json::Value> {
        let path = format!("/api/files/{}", file_id);
        self.client.request(reqwest::Method::DELETE, &path, None).await
    }

    /// Share a file with other users or apps
    /// Requires: FileShareManage permission
    pub async fn share(&self, file_id: &str, share_with: Vec<String>, permissions: FilePermissions) -> Result<serde_json::Value> {
        let body = serde_json::json!({
            "share_with": share_with,
            "permissions": permissions
        });
        let path = format!("/api/files/{}/share", file_id);
        self.client.request(reqwest::Method::POST, &path, Some(body)).await
    }

    /// Update file permissions for a share
    /// Requires: FileShareManage permission
    pub async fn update_permissions(&self, file_id: &str, user_or_app: &str, permissions: FilePermissions) -> Result<serde_json::Value> {
        let body = serde_json::json!({
            "user_or_app": user_or_app,
            "permissions": permissions
        });
        let path = format!("/api/files/{}/permissions", file_id);
        self.client.request(reqwest::Method::PUT, &path, Some(body)).await
    }
}

/// Automations API for creating and managing automations
/// Requires Automations permission (App-only)
pub struct AutomationsApi<'a> {
    client: &'a IoraClient,
}

impl<'a> AutomationsApi<'a> {
    /// List all automations
    pub async fn list(&self) -> Result<Vec<Automation>> {
        self.client.request(reqwest::Method::GET, "/api/automations", None).await
    }

    /// Get a specific automation
    pub async fn get(&self, automation_id: &str) -> Result<Automation> {
        let path = format!("/api/automations/{}", automation_id);
        self.client.request(reqwest::Method::GET, &path, None).await
    }

    /// Create a new automation
    pub async fn create(&self, automation: Automation) -> Result<Automation> {
        self.client.request(
            reqwest::Method::POST,
            "/api/automations",
            Some(serde_json::to_value(automation)?),
        ).await
    }

    /// Update an existing automation
    pub async fn update(&self, automation_id: &str, automation: Automation) -> Result<Automation> {
        let path = format!("/api/automations/{}", automation_id);
        self.client.request(
            reqwest::Method::PUT,
            &path,
            Some(serde_json::to_value(automation)?),
        ).await
    }

    /// Delete an automation
    pub async fn delete(&self, automation_id: &str) -> Result<serde_json::Value> {
        let path = format!("/api/automations/{}", automation_id);
        self.client.request(reqwest::Method::DELETE, &path, None).await
    }

    /// Enable/disable an automation
    pub async fn set_enabled(&self, automation_id: &str, enabled: bool) -> Result<serde_json::Value> {
        let path = format!("/api/automations/{}/enabled", automation_id);
        let body = serde_json::json!({ "enabled": enabled });
        self.client.request(reqwest::Method::PUT, &path, Some(body)).await
    }

    /// Trigger an automation manually
    pub async fn trigger(&self, automation_id: &str) -> Result<serde_json::Value> {
        let path = format!("/api/automations/{}/trigger", automation_id);
        self.client.request(reqwest::Method::POST, &path, None).await
    }
}

