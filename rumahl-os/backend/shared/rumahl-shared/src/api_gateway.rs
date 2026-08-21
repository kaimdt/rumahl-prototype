//! API Gateway for Apps and Plugins
//!
//! Provides isolated API registration and routing for Apps and Plugins.
//! Apps and Plugins cannot access native rumahl services directly - they must
//! use the API Gateway which provides controlled access and crash isolation.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Arc};
use tokio::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiEndpoint {
    pub id: String,
    pub provider_id: String, // App or Plugin ID
    pub provider_type: ProviderType,
    pub path: String,
    pub method: HttpMethod,
    pub description: String,
    pub requires_auth: bool,
    pub permissions: Vec<String>,
    pub registered_at: String,
    pub is_healthy: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProviderType {
    App,
    Plugin,
    NativeService,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "UPPERCASE")]
pub enum HttpMethod {
    GET,
    POST,
    PUT,
    DELETE,
    PATCH,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiRequest {
    pub path: String,
    pub method: HttpMethod,
    pub headers: HashMap<String, String>,
    pub body: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiResponse {
    pub status_code: u16,
    pub headers: HashMap<String, String>,
    pub body: Option<serde_json::Value>,
    pub provider_id: String,
}

/// Trait for API providers (Apps, Plugins, or native services)
#[async_trait]
pub trait IApiProvider: Send + Sync {
    fn provider_id(&self) -> &str;
    fn provider_type(&self) -> ProviderType;

    /// Handle an API request
    async fn handle_request(&self, request: ApiRequest) -> anyhow::Result<ApiResponse>;

    /// Health check
    async fn is_healthy(&self) -> bool;
}

/// API Gateway manages API endpoints from Apps and Plugins
#[derive(Default)]
pub struct ApiGateway {
    endpoints: RwLock<HashMap<String, ApiEndpoint>>,
    providers: RwLock<HashMap<String, Arc<dyn IApiProvider>>>,
}

impl ApiGateway {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register an API endpoint
    pub async fn register_endpoint(&self, endpoint: ApiEndpoint) -> anyhow::Result<()> {
        let mut endpoints = self.endpoints.write().await;

        if endpoints.contains_key(&endpoint.id) {
            anyhow::bail!("API endpoint '{}' is already registered", endpoint.id);
        }

        endpoints.insert(endpoint.id.clone(), endpoint);
        Ok(())
    }

    /// Unregister an API endpoint
    pub async fn unregister_endpoint(&self, endpoint_id: &str) -> anyhow::Result<()> {
        let mut endpoints = self.endpoints.write().await;
        endpoints.remove(endpoint_id);
        Ok(())
    }

    /// Register an API provider
    pub async fn register_provider(&self, provider: Arc<dyn IApiProvider>) -> anyhow::Result<()> {
        let provider_id = provider.provider_id().to_string();
        let mut providers = self.providers.write().await;

        if providers.contains_key(&provider_id) {
            anyhow::bail!("API provider '{}' is already registered", provider_id);
        }

        providers.insert(provider_id, provider);
        Ok(())
    }

    /// Unregister an API provider and all its endpoints
    pub async fn unregister_provider(&self, provider_id: &str) -> anyhow::Result<()> {
        // Remove provider
        let mut providers = self.providers.write().await;
        providers.remove(provider_id);
        drop(providers);

        // Remove all endpoints from this provider
        let mut endpoints = self.endpoints.write().await;
        endpoints.retain(|_, endpoint| endpoint.provider_id != provider_id);

        Ok(())
    }

    /// Route a request to the appropriate provider
    /// Provides crash isolation - if provider fails, error is returned but system continues
    pub async fn route_request(&self, request: ApiRequest) -> anyhow::Result<ApiResponse> {
        // Find matching endpoint
        let endpoints = self.endpoints.read().await;
        let endpoint = endpoints
            .values()
            .find(|e| e.path == request.path && e.method == request.method)
            .ok_or_else(|| {
                anyhow::anyhow!("No endpoint found for {} {}", request.method, request.path)
            })?;

        let provider_id = endpoint.provider_id.clone();
        let endpoint_id = endpoint.id.clone();
        let is_healthy = endpoint.is_healthy;
        drop(endpoints);

        // Check if endpoint is healthy
        if !is_healthy {
            anyhow::bail!(
                "Endpoint {} is currently unavailable (provider unhealthy)",
                endpoint_id
            );
        }

        // Get provider
        let providers = self.providers.read().await;
        let provider = providers
            .get(&provider_id)
            .ok_or_else(|| anyhow::anyhow!("Provider '{}' not found", provider_id))?
            .clone();
        drop(providers);

        // Route request with timeout and crash protection
        match tokio::time::timeout(
            std::time::Duration::from_secs(30),
            provider.handle_request(request),
        )
        .await
        {
            Ok(Ok(response)) => Ok(response),
            Ok(Err(e)) => {
                // Provider error - mark endpoint as unhealthy
                self.mark_endpoint_unhealthy(&provider_id).await;
                Err(anyhow::anyhow!("Provider error: {}", e))
            }
            Err(_) => {
                // Timeout - mark endpoint as unhealthy
                self.mark_endpoint_unhealthy(&provider_id).await;
                Err(anyhow::anyhow!("Request timeout after 30 seconds"))
            }
        }
    }

    /// Mark all endpoints from a provider as unhealthy
    async fn mark_endpoint_unhealthy(&self, provider_id: &str) {
        let mut endpoints = self.endpoints.write().await;
        for endpoint in endpoints.values_mut() {
            if endpoint.provider_id == provider_id {
                endpoint.is_healthy = false;
            }
        }
    }

    /// List all registered endpoints
    pub async fn list_endpoints(&self) -> Vec<ApiEndpoint> {
        self.endpoints.read().await.values().cloned().collect()
    }

    /// Get endpoint by ID
    pub async fn get_endpoint(&self, endpoint_id: &str) -> Option<ApiEndpoint> {
        self.endpoints.read().await.get(endpoint_id).cloned()
    }

    /// List endpoints by provider
    pub async fn list_endpoints_by_provider(&self, provider_id: &str) -> Vec<ApiEndpoint> {
        self.endpoints
            .read()
            .await
            .values()
            .filter(|e| e.provider_id == provider_id)
            .cloned()
            .collect()
    }
}

impl std::fmt::Display for HttpMethod {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            HttpMethod::GET => write!(f, "GET"),
            HttpMethod::POST => write!(f, "POST"),
            HttpMethod::PUT => write!(f, "PUT"),
            HttpMethod::DELETE => write!(f, "DELETE"),
            HttpMethod::PATCH => write!(f, "PATCH"),
        }
    }
}
