use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{info, warn};

/// Central Home Assistant connection health manager.
/// All components check this before attempting HA calls, enabling
/// graceful degradation when HA goes offline.
pub struct HaConnectionManager {
    available: AtomicBool,
    last_check: RwLock<Option<String>>,
    last_error: RwLock<Option<String>>,
    ha_version: RwLock<Option<String>>,
    ha_url: RwLock<String>,
    /// Consecutive failure count (used for backoff decisions)
    failure_count: std::sync::atomic::AtomicU32,
    /// Cached entity count from last successful fetch
    cached_entity_count: std::sync::atomic::AtomicU32,
    /// Tracks which integrations are loaded in HA
    integrations: RwLock<Vec<HaIntegration>>,
    /// Connection history for diagnostics
    history: RwLock<Vec<ConnectionEvent>>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct HaIntegration {
    pub domain: String,
    pub title: String,
    pub available: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ConnectionEvent {
    pub timestamp: String,
    pub event_type: ConnectionEventType,
    pub message: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub enum ConnectionEventType {
    Connected,
    Disconnected,
    Error,
    Recovered,
    HealthCheck,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct HaConnectionStatus {
    pub available: bool,
    pub ha_version: Option<String>,
    pub ha_url: String,
    pub last_check: Option<String>,
    pub last_error: Option<String>,
    pub failure_count: u32,
    pub cached_entity_count: u32,
    pub integrations: Vec<HaIntegration>,
    pub recent_events: Vec<ConnectionEvent>,
}

impl HaConnectionManager {
    pub fn new(ha_url: &str) -> Self {
        Self {
            available: AtomicBool::new(false),
            last_check: RwLock::new(None),
            last_error: RwLock::new(None),
            ha_version: RwLock::new(None),
            ha_url: RwLock::new(ha_url.to_string()),
            failure_count: std::sync::atomic::AtomicU32::new(0),
            cached_entity_count: std::sync::atomic::AtomicU32::new(0),
            integrations: RwLock::new(Vec::new()),
            history: RwLock::new(Vec::new()),
        }
    }

    pub fn is_available(&self) -> bool {
        self.available.load(Ordering::Relaxed)
    }

    /// Update the HA URL at runtime (after admin changes settings).
    pub async fn update_url(&self, url: &str) {
        if !url.is_empty() {
            *self.ha_url.write().await = url.to_string();
            info!("HA Connection: URL updated to {}", url);
        }
    }

    /// Reset connection state to force reconnection with new credentials.
    /// Call after updating HA credentials in the admin settings.
    pub fn reset_for_reconnect(&self) {
        self.available.store(false, Ordering::Relaxed);
        self.failure_count.store(0, Ordering::Relaxed);
        info!("HA Connection: state reset for reconnection");
    }

    pub fn set_available(&self, val: bool) {
        let was = self.available.swap(val, Ordering::Relaxed);
        if was != val {
            if val {
                self.failure_count.store(0, Ordering::Relaxed);
                info!("HA Connection: Home Assistant is now AVAILABLE");
            } else {
                warn!("HA Connection: Home Assistant is now UNAVAILABLE");
            }
        }
    }

    pub fn record_success(&self) {
        self.available.store(true, Ordering::Relaxed);
        self.failure_count.store(0, Ordering::Relaxed);
    }

    pub fn record_failure(&self, error: &str) {
        self.failure_count.fetch_add(1, Ordering::Relaxed);
        let count = self.failure_count.load(Ordering::Relaxed);
        // Only mark unavailable after 3 consecutive failures
        if count >= 3 {
            self.available.store(false, Ordering::Relaxed);
        }
        // Fire-and-forget async updates via blocking (acceptable for diagnostics)
        warn!("HA Connection: failure #{}: {}", count, error);
    }

    pub fn set_cached_entity_count(&self, count: u32) {
        self.cached_entity_count.store(count, Ordering::Relaxed);
    }

    pub async fn set_ha_version(&self, version: &str) {
        *self.ha_version.write().await = Some(version.to_string());
    }

    pub async fn set_last_check(&self, ts: &str) {
        *self.last_check.write().await = Some(ts.to_string());
    }

    pub async fn set_last_error(&self, err: Option<String>) {
        *self.last_error.write().await = err;
    }

    pub async fn set_integrations(&self, integrations: Vec<HaIntegration>) {
        *self.integrations.write().await = integrations;
    }

    pub async fn add_event(&self, event_type: ConnectionEventType, message: &str) {
        let mut hist = self.history.write().await;
        hist.push(ConnectionEvent {
            timestamp: chrono::Utc::now().to_rfc3339(),
            event_type,
            message: message.to_string(),
        });
        // Keep last 50 events
        let len = hist.len();
        if len > 50 {
            hist.drain(0..len - 50);
        }
    }

    /// Get detected HA integrations list
    pub async fn get_integrations(&self) -> Vec<HaIntegration> {
        self.integrations.read().await.clone()
    }

    /// Check if a specific integration is available in HA
    pub async fn has_integration(&self, domain: &str) -> bool {
        self.integrations.read().await.iter().any(|i| i.domain == domain && i.available)
    }

    pub async fn status(&self) -> HaConnectionStatus {
        HaConnectionStatus {
            available: self.available.load(Ordering::Relaxed),
            ha_version: self.ha_version.read().await.clone(),
            ha_url: self.ha_url.read().await.clone(),
            last_check: self.last_check.read().await.clone(),
            last_error: self.last_error.read().await.clone(),
            failure_count: self.failure_count.load(Ordering::Relaxed),
            cached_entity_count: self.cached_entity_count.load(Ordering::Relaxed),
            integrations: self.integrations.read().await.clone(),
            recent_events: self.history.read().await.clone(),
        }
    }
}

/// Background health-check loop.
/// Pings HA every 30s, updates integrations list, detects version.
pub async fn ha_health_check_loop(
    manager: Arc<HaConnectionManager>,
    http_client: reqwest::Client,
    ha_url: String,
    ha_token: String,
    entity_cache: Arc<crate::entity_cache::EntityStateCache>,
) {
    // Initial delay to let the main connection establish
    tokio::time::sleep(std::time::Duration::from_secs(5)).await;

    loop {
        let now = chrono::Utc::now().to_rfc3339();
        manager.set_last_check(&now).await;

        // 1. Ping HA API
        let check = http_client
            .get(format!("{}/api/", ha_url))
            .header("Authorization", format!("Bearer {}", ha_token))
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await;

        match check {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(body) = resp.json::<serde_json::Value>().await {
                    if let Some(version) = body.get("version").and_then(|v| v.as_str()) {
                        manager.set_ha_version(version).await;
                    }
                }
                manager.record_success();
                manager.set_last_error(None).await;

                // Update entity count
                let count = entity_cache.get_all().await.len() as u32;
                manager.set_cached_entity_count(count);

                // Detect integrations
                let integ = detect_integrations(&http_client, &ha_url, &ha_token).await;
                manager.set_integrations(integ).await;
            }
            Ok(resp) => {
                let err = format!("HA returned status {}", resp.status());
                manager.record_failure(&err);
                manager.set_last_error(Some(err.clone())).await;
                manager.add_event(ConnectionEventType::Error, &err).await;
            }
            Err(e) => {
                let err = format!("HA unreachable: {}", e);
                manager.record_failure(&err);
                manager.set_last_error(Some(err.clone())).await;
                manager.add_event(ConnectionEventType::Error, &err).await;
            }
        }

        // Adaptive interval: faster when disconnected (10s), slower when healthy (30s)
        let interval = if manager.is_available() { 30 } else { 10 };
        tokio::time::sleep(std::time::Duration::from_secs(interval)).await;
    }
}

/// Detect which integrations are loaded in HA by probing known endpoints
async fn detect_integrations(
    client: &reqwest::Client,
    ha_url: &str,
    ha_token: &str,
) -> Vec<HaIntegration> {
    let known = vec![
        ("mqtt", "MQTT"),
        ("matter", "Matter"),
        ("zha", "Zigbee (ZHA)"),
        ("zwave_js", "Z-Wave JS"),
        ("bluetooth", "Bluetooth"),
        ("homekit", "HomeKit"),
        ("esphome", "ESPHome"),
        ("hue", "Philips Hue"),
        ("zigbee2mqtt", "Zigbee2MQTT"),
        ("thread", "Thread"),
        ("knx", "KNX"),
        ("modbus", "Modbus"),
    ];

    // Fetch component list from HA
    let resp = client
        .get(format!("{}/api/components", ha_url))
        .header("Authorization", format!("Bearer {}", ha_token))
        .timeout(std::time::Duration::from_secs(8))
        .send()
        .await;

    let loaded_components: Vec<String> = match resp {
        Ok(r) if r.status().is_success() => {
            r.json::<Vec<String>>().await.unwrap_or_default()
        }
        _ => Vec::new(),
    };

    known.iter().map(|(domain, title)| {
        let available = loaded_components.iter().any(|c| c == domain || c.starts_with(&format!("{}.", domain)));
        HaIntegration {
            domain: domain.to_string(),
            title: title.to_string(),
            available,
        }
    }).collect()
}
