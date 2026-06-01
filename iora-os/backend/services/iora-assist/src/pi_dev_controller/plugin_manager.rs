// Plugin Manager for pi.dev
// Manages pi.dev plugins: discovery, installation, tool registration
// Integrates with pi.dev package registry (https://pi.dev/packages/*)

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use tracing::{info, warn};

use super::PluginConfig;

// ─── Types ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginInfo {
    pub package_name: String,
    pub display_name: String,
    pub version: String,
    pub description: String,
    pub tools: Vec<PluginTool>,
    pub registry_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginTool {
    pub name: String,
    pub description: String,
    /// JSON Schema for the tool's parameters
    pub parameters: serde_json::Value,
}

// ─── Plugin Manager ────────────────────────────────────────────────────────

pub struct PluginManager {
    plugin_cache: RwLock<HashMap<String, PluginInfo>>,
    http_client: reqwest::Client,
}

impl PluginManager {
    pub fn new() -> Self {
        Self { plugin_cache: RwLock::new(HashMap::new()),
            http_client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .user_agent("IORA-pidev-plugin-manager/1.0")
                .build()
                .expect("Failed to create HTTP client"),
        }
    }

    /// Resolve a plugin from its package name
    /// First checks default plugins, then tries to fetch from registry
    pub async fn resolve_plugin(&self, config: &PluginConfig) -> Result<PluginInfo, String> {
        // Check cache
        {
            let cache = self.plugin_cache.read().await;
            if let Some(info) = cache.get(&config.package_name) {
                return Ok(info.clone());
            }
        }

        // Check if it's a default plugin
        let defaults = self.list_default_plugins().await;
        if let Some(info) = defaults.into_iter().find(|p| p.package_name == config.package_name) {
            self.plugin_cache.write().await.insert(config.package_name.clone(), info.clone());
            return Ok(info);
        }

        // Try to fetch from pi.dev registry
        match self.fetch_from_registry(&config.package_name).await {
            Ok(info) => {
                self.plugin_cache.write().await.insert(config.package_name.clone(), info.clone());
                Ok(info)
            }
            Err(e) => {
                warn!("Failed to fetch plugin {} from registry: {}", config.package_name, e);
                Err(format!("Plugin {} not found: {}", config.package_name, e))
            }
        }
    }

    /// Install a plugin into a running pi.dev container
    pub async fn install_plugin(
        &self,
        container_id: &str,
        package_name: &str,
        docker: &super::docker_sandbox::DockerSandbox,
    ) -> Result<(), String> {
        // Execute npm install inside the container
        let install_cmd = format!("npm install -g {}", package_name);
        let output = docker.exec_in_container(
            container_id,
            vec!["/bin/sh", "-c", &install_cmd],
        ).await?;

        info!("Installed plugin {} in container {}: {}", package_name, container_id, output);
        Ok(())
    }

    /// Fetch plugin metadata from pi.dev package registry
    async fn fetch_from_registry(&self, package_name: &str) -> Result<PluginInfo, String> {
        // pi.dev packages are published as npm packages
        // Try fetching from npm registry first, then pi.dev mirror
        let urls = vec![
            format!("https://registry.npmjs.org/{}", package_name),
            format!("https://pi.dev/api/packages/{}", package_name),
        ];

        for url in &urls {
            match self.http_client.get(url).send().await {
                Ok(resp) if resp.status().is_success() => {
                    let body: serde_json::Value = resp.json().await
                        .map_err(|e| format!("Failed to parse response: {}", e))?;

                    // Parse npm registry format
                    if let Some(name) = body["name"].as_str() {
                        let latest_version = body["dist-tags"]["latest"].as_str().unwrap_or("latest");
                        let description = body["description"].as_str().unwrap_or("").to_string();
                        let version_info = &body["versions"][latest_version];

                        // Extract pi.dev-specific metadata if available
                        let tools = if let Some(pi_dev) = version_info.get("pi-dev") {
                            self.parse_tools(pi_dev)
                        } else {
                            Vec::new()
                        };

                        return Ok(PluginInfo {
                            package_name: name.to_string(),
                            display_name: name.to_string(),
                            version: latest_version.to_string(),
                            description,
                            tools,
                            registry_url: format!("https://pi.dev/packages/{}", package_name),
                        });
                    }
                }
                _ => continue,
            }
        }

        Err(format!("Package {} not found in any registry", package_name))
    }

    /// Parse tool definitions from pi.dev package metadata
    fn parse_tools(&self, pi_dev_metadata: &serde_json::Value) -> Vec<PluginTool> {
        let mut tools = Vec::new();

        if let Some(tools_array) = pi_dev_metadata["tools"].as_array() {
            for tool in tools_array {
                let name = tool["name"].as_str().unwrap_or("unknown");
                let description = tool["description"].as_str().unwrap_or("");
                let parameters = tool["parameters"].clone();

                tools.push(PluginTool {
                    name: name.to_string(),
                    description: description.to_string(),
                    parameters,
                });
            }
        }

        tools
    }
}
