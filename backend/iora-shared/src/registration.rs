//! App and Plugin Registration System
//!
//! Apps and Plugins must register with IORA before accessing the API.
//! This provides security and control over what code can access system resources.

use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RegistrationStatus {
    Pending,       // Waiting for approval
    Approved,      // Registered and can access API
    Rejected,      // Registration denied
    Suspended,     // Temporarily disabled
    Revoked,       // Permanently revoked
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegistrationRequest {
    pub provider_id: String,
    pub provider_type: ProviderType,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
    pub website: Option<String>,
    pub requested_permissions: Vec<String>,
    pub signature: Option<String>,  // Cryptographic signature for verification
    pub metadata: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProviderType {
    App,
    Plugin,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Registration {
    pub id: String,
    pub provider_id: String,
    pub provider_type: ProviderType,
    pub name: String,
    pub version: String,
    pub status: RegistrationStatus,
    pub granted_permissions: Vec<String>,
    pub api_token: String,  // Unique token for API access
    pub registered_at: String,
    pub approved_at: Option<String>,
    pub approved_by: Option<String>,  // Admin user ID
    pub notes: Option<String>,
}

/// Registration Registry manages App and Plugin registrations
#[derive(Default)]
pub struct RegistrationRegistry {
    registrations: RwLock<HashMap<String, Registration>>,
    pending_requests: RwLock<HashMap<String, RegistrationRequest>>,
}

impl RegistrationRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Submit a registration request
    pub async fn submit_request(&self, request: RegistrationRequest) -> anyhow::Result<String> {
        let mut pending = self.pending_requests.write().await;

        let request_id = format!("reg_{}", uuid::Uuid::new_v4());

        // Check if provider is already registered
        let registrations = self.registrations.read().await;
        if registrations.values().any(|r| r.provider_id == request.provider_id) {
            anyhow::bail!("Provider '{}' is already registered", request.provider_id);
        }
        drop(registrations);

        // Check if there's already a pending request
        if pending.values().any(|r| r.provider_id == request.provider_id) {
            anyhow::bail!("Provider '{}' already has a pending registration request", request.provider_id);
        }

        pending.insert(request_id.clone(), request);
        Ok(request_id)
    }

    /// Approve a registration request
    pub async fn approve_request(
        &self,
        request_id: &str,
        approved_by: &str,
        granted_permissions: Vec<String>,
    ) -> anyhow::Result<Registration> {
        let mut pending = self.pending_requests.write().await;
        let request = pending.remove(request_id)
            .ok_or_else(|| anyhow::anyhow!("Registration request '{}' not found", request_id))?;

        let registration = Registration {
            id: format!("reg_{}", uuid::Uuid::new_v4()),
            provider_id: request.provider_id.clone(),
            provider_type: request.provider_type,
            name: request.name,
            version: request.version,
            status: RegistrationStatus::Approved,
            granted_permissions,
            api_token: self.generate_api_token(),
            registered_at: chrono::Utc::now().to_rfc3339(),
            approved_at: Some(chrono::Utc::now().to_rfc3339()),
            approved_by: Some(approved_by.to_string()),
            notes: None,
        };

        let mut registrations = self.registrations.write().await;
        registrations.insert(registration.id.clone(), registration.clone());

        Ok(registration)
    }

    /// Reject a registration request
    pub async fn reject_request(&self, request_id: &str, reason: Option<String>) -> anyhow::Result<()> {
        let mut pending = self.pending_requests.write().await;
        let request = pending.remove(request_id)
            .ok_or_else(|| anyhow::anyhow!("Registration request '{}' not found", request_id))?;

        // Create a rejected registration record for audit trail
        let registration = Registration {
            id: format!("reg_{}", uuid::Uuid::new_v4()),
            provider_id: request.provider_id,
            provider_type: request.provider_type,
            name: request.name,
            version: request.version,
            status: RegistrationStatus::Rejected,
            granted_permissions: vec![],
            api_token: String::new(),
            registered_at: chrono::Utc::now().to_rfc3339(),
            approved_at: None,
            approved_by: None,
            notes: reason,
        };

        let mut registrations = self.registrations.write().await;
        registrations.insert(registration.id.clone(), registration);

        Ok(())
    }

    /// Check if a provider is registered and approved
    pub async fn is_approved(&self, provider_id: &str) -> bool {
        let registrations = self.registrations.read().await;
        registrations.values().any(|r|
            r.provider_id == provider_id && r.status == RegistrationStatus::Approved
        )
    }

    /// Get registration by provider ID
    pub async fn get_by_provider(&self, provider_id: &str) -> Option<Registration> {
        self.registrations
            .read()
            .await
            .values()
            .find(|r| r.provider_id == provider_id)
            .cloned()
    }

    /// Get registration by API token
    pub async fn get_by_token(&self, api_token: &str) -> Option<Registration> {
        self.registrations
            .read()
            .await
            .values()
            .find(|r| r.api_token == api_token && r.status == RegistrationStatus::Approved)
            .cloned()
    }

    /// Verify API token and check permissions
    pub async fn verify_token(&self, api_token: &str, required_permission: &str) -> bool {
        if let Some(reg) = self.get_by_token(api_token).await {
            reg.granted_permissions.contains(&required_permission.to_string())
        } else {
            false
        }
    }

    /// Suspend a registration
    pub async fn suspend(&self, provider_id: &str) -> anyhow::Result<()> {
        let mut registrations = self.registrations.write().await;
        for registration in registrations.values_mut() {
            if registration.provider_id == provider_id {
                registration.status = RegistrationStatus::Suspended;
                return Ok(());
            }
        }
        anyhow::bail!("Registration for provider '{}' not found", provider_id)
    }

    /// Revoke a registration
    pub async fn revoke(&self, provider_id: &str) -> anyhow::Result<()> {
        let mut registrations = self.registrations.write().await;
        for registration in registrations.values_mut() {
            if registration.provider_id == provider_id {
                registration.status = RegistrationStatus::Revoked;
                return Ok(());
            }
        }
        anyhow::bail!("Registration for provider '{}' not found", provider_id)
    }

    /// List all registrations
    pub async fn list_all(&self) -> Vec<Registration> {
        self.registrations.read().await.values().cloned().collect()
    }

    /// List pending requests
    pub async fn list_pending(&self) -> Vec<(String, RegistrationRequest)> {
        self.pending_requests
            .read()
            .await
            .iter()
            .map(|(id, req)| (id.clone(), req.clone()))
            .collect()
    }

    /// Generate a unique API token
    fn generate_api_token(&self) -> String {
        format!("iora_token_{}", uuid::Uuid::new_v4())
    }
}
