use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    net::IpAddr,
    sync::Arc,
    time::{Duration, SystemTime},
};
use tokio::sync::RwLock;
use tower_http::cors::CorsLayer;
use tracing::{error, info, warn};

mod scanner;
use scanner::NetworkScanner;

/// Application state
#[derive(Clone)]
struct AppState {
    scanner: Arc<RwLock<NetworkScanner>>,
    rumahl_client: Arc<rumahl_sdk::rumahlClient>,
    discovered_devices: Arc<RwLock<HashMap<IpAddr, DiscoveredDevice>>>,
}

/// Discovered network device
#[derive(Debug, Clone, Serialize, Deserialize)]
struct DiscoveredDevice {
    ip: String,
    mac: Option<String>,
    hostname: Option<String>,
    manufacturer: Option<String>,
    first_seen: SystemTime,
    last_seen: SystemTime,
    is_online: bool,
    open_ports: Vec<u16>,
}

/// Scan request parameters
#[derive(Debug, Deserialize)]
struct ScanParams {
    network: Option<String>,
    timeout: Option<u64>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize tracing
    tracing_subscriber::fmt::init();

    info!("Starting Network Scanner App v1.0.0");

    // Get rumahl base URL from environment
    let rumahl_url = std::env::var("RUMAHL_BASE_URL").unwrap_or_else(|_| "http://rumahl-home:8080".to_string());
    let api_key = std::env::var("RUMAHL_API_KEY").ok();

    // Create rumahl client
    let mut client = rumahl_sdk::rumahlClient::new(&rumahl_url);
    if let Some(key) = api_key {
        client = client.with_api_key(key);
    }

    // Load settings from rumahl
    let settings = match client.settings().get("network-scanner").await {
        Ok(s) => s,
        Err(e) => {
            warn!("Failed to load settings: {}", e);
            default_settings()
        }
    };

    info!("Loaded settings: {:?}", settings);

    // Create scanner
    let scanner = NetworkScanner::new(
        settings.settings.get("network_range")
            .and_then(|v| v.as_str())
            .unwrap_or("192.168.1.0/24"),
        settings.settings.get("scan_timeout")
            .and_then(|v| v.as_u64())
            .unwrap_or(5),
    )?;

    // Create app state
    let state = AppState {
        scanner: Arc::new(RwLock::new(scanner)),
        rumahl_client: Arc::new(client),
        discovered_devices: Arc::new(RwLock::new(HashMap::new())),
    };

    // Start background scanner
    let state_clone = state.clone();
    let scan_interval = settings.settings.get("scan_interval")
        .and_then(|v| v.as_u64())
        .unwrap_or(300);

    tokio::spawn(async move {
        background_scanner(state_clone, scan_interval).await;
    });

    // Build router
    let app = Router::new()
        .route("/health", get(health_check))
        .route("/api/scan", post(scan_network))
        .route("/api/devices", get(get_devices))
        .route("/api/device/:ip", get(get_device))
        .route("/widget.js", get(serve_widget))
        .route("/", get(serve_dashboard))
        .layer(CorsLayer::permissive())
        .with_state(state);

    // Start server
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await?;
    info!("Network Scanner API listening on :3000");

    axum::serve(listener, app).await?;

    Ok(())
}

/// Health check endpoint
async fn health_check() -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "healthy",
        "service": "network-scanner",
        "version": "1.0.0"
    }))
}

/// Scan network endpoint
async fn scan_network(
    State(state): State<AppState>,
    Query(params): Query<ScanParams>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    info!("Starting network scan");

    let scanner = state.scanner.read().await;
    let devices = match scanner.scan().await {
        Ok(d) => d,
        Err(e) => {
            error!("Scan failed: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    // Update discovered devices
    let mut discovered = state.discovered_devices.write().await;
    let now = SystemTime::now();

    for device in &devices {
        discovered.entry(device.ip)
            .and_modify(|d| {
                d.last_seen = now;
                d.is_online = true;
                d.open_ports = device.open_ports.clone();
            })
            .or_insert_with(|| DiscoveredDevice {
                ip: device.ip.to_string(),
                mac: device.mac.clone(),
                hostname: device.hostname.clone(),
                manufacturer: device.manufacturer.clone(),
                first_seen: now,
                last_seen: now,
                is_online: true,
                open_ports: device.open_ports.clone(),
            });
    }

    info!("Scan complete: found {} devices", devices.len());

    Ok(Json(serde_json::json!({
        "success": true,
        "device_count": devices.len(),
        "devices": devices
    })))
}

/// Get all discovered devices
async fn get_devices(State(state): State<AppState>) -> Json<serde_json::Value> {
    let devices = state.discovered_devices.read().await;
    Json(serde_json::json!({
        "devices": devices.values().collect::<Vec<_>>()
    }))
}

/// Get specific device
async fn get_device(
    State(state): State<AppState>,
    axum::extract::Path(ip): axum::extract::Path<String>,
) -> Result<Json<DiscoveredDevice>, StatusCode> {
    let devices = state.discovered_devices.read().await;
    let ip_addr: IpAddr = ip.parse().map_err(|_| StatusCode::BAD_REQUEST)?;

    devices.get(&ip_addr)
        .cloned()
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

/// Serve widget JavaScript
async fn serve_widget() -> impl IntoResponse {
    let widget_js = r#"
// rumahl Network Scanner Widget
class NetworkScannerWidget {
    constructor(config) {
        this.config = config;
        this.devices = [];
    }

    async render(container) {
        this.container = container;
        await this.loadDevices();
        this.updateView();

        // Auto-refresh
        const interval = this.config.refresh_interval || 60;
        setInterval(() => this.loadDevices(), interval * 1000);
    }

    async loadDevices() {
        try {
            const response = await fetch('/api/devices');
            const data = await response.json();
            this.devices = data.devices;
            this.updateView();
        } catch (error) {
            console.error('Failed to load devices:', error);
        }
    }

    updateView() {
        if (!this.container) return;

        const onlineDevices = this.devices.filter(d => d.is_online);
        const showOffline = this.config.show_offline;
        const displayDevices = showOffline ? this.devices : onlineDevices;

        this.container.innerHTML = `
            <div class="network-scanner-widget">
                <div class="header">
                    <h3>Network Devices</h3>
                    <span class="badge">${onlineDevices.length} online</span>
                </div>
                <div class="device-list">
                    ${displayDevices.map(d => this.renderDevice(d)).join('')}
                </div>
            </div>
        `;
    }

    renderDevice(device) {
        return `
            <div class="device ${device.is_online ? 'online' : 'offline'}">
                <div class="device-icon">📱</div>
                <div class="device-info">
                    <div class="device-name">${device.hostname || device.ip}</div>
                    <div class="device-ip">${device.ip}</div>
                    ${device.mac ? `<div class="device-mac">${device.mac}</div>` : ''}
                </div>
                <div class="device-status">
                    <span class="status-dot"></span>
                    ${device.is_online ? 'Online' : 'Offline'}
                </div>
            </div>
        `;
    }
}

window.NetworkScannerWidget = NetworkScannerWidget;
"#;

    (
        [(axum::http::header::CONTENT_TYPE, "application/javascript")],
        widget_js,
    )
}

/// Serve dashboard HTML
async fn serve_dashboard() -> impl IntoResponse {
    let html = r#"
<!DOCTYPE html>
<html>
<head>
    <title>Network Scanner</title>
    <style>
        body {
            font-family: system-ui, -apple-system, sans-serif;
            margin: 0;
            padding: 20px;
            background: #f5f5f5;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        .card {
            background: white;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 20px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        button {
            background: #007bff;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 4px;
            cursor: pointer;
        }
        button:hover { background: #0056b3; }
        .device-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 15px;
            margin-top: 20px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="card">
            <h1>Network Scanner</h1>
            <button onclick="scanNetwork()">Scan Network</button>
        </div>
        <div class="card">
            <h2>Discovered Devices</h2>
            <div id="devices" class="device-grid"></div>
        </div>
    </div>
    <script src="/widget.js"></script>
    <script>
        async function scanNetwork() {
            await fetch('/api/scan', { method: 'POST' });
            loadDevices();
        }
        async function loadDevices() {
            const response = await fetch('/api/devices');
            const data = await response.json();
            document.getElementById('devices').innerHTML = data.devices.map(d => `
                <div class="card">
                    <h3>${d.hostname || d.ip}</h3>
                    <p>IP: ${d.ip}</p>
                    ${d.mac ? `<p>MAC: ${d.mac}</p>` : ''}
                    <p>Status: ${d.is_online ? '✅ Online' : '❌ Offline'}</p>
                </div>
            `).join('');
        }
        loadDevices();
        setInterval(loadDevices, 30000);
    </script>
</body>
</html>
"#;

    ([(axum::http::header::CONTENT_TYPE, "text/html")], html)
}

/// Background scanner task
async fn background_scanner(state: AppState, interval_secs: u64) {
    let mut interval = tokio::time::interval(Duration::from_secs(interval_secs));

    loop {
        interval.tick().await;

        info!("Running background scan");
        let scanner = state.scanner.read().await;

        match scanner.scan().await {
            Ok(devices) => {
                let mut discovered = state.discovered_devices.write().await;
                let now = SystemTime::now();

                // Mark all as offline first
                for device in discovered.values_mut() {
                    device.is_online = false;
                }

                // Update with scan results
                for device in devices {
                    discovered.entry(device.ip)
                        .and_modify(|d| {
                            let was_offline = !d.is_online;
                            d.last_seen = now;
                            d.is_online = true;

                            // Notify if device came back online
                            if was_offline {
                                info!("Device {} came back online", device.ip);
                            }
                        })
                        .or_insert_with(|| {
                            info!("New device discovered: {}", device.ip);
                            DiscoveredDevice {
                                ip: device.ip.to_string(),
                                mac: device.mac.clone(),
                                hostname: device.hostname.clone(),
                                manufacturer: device.manufacturer.clone(),
                                first_seen: now,
                                last_seen: now,
                                is_online: true,
                                open_ports: device.open_ports.clone(),
                            }
                        });
                }

                info!("Background scan complete: {} devices", discovered.len());
            }
            Err(e) => {
                error!("Background scan failed: {}", e);
            }
        }
    }
}

fn default_settings() -> rumahl_sdk::types::AppSettings {
    rumahl_sdk::types::AppSettings {
        app_id: "network-scanner".to_string(),
        settings: {
            let mut map = HashMap::new();
            map.insert("scan_interval".to_string(), serde_json::json!(300));
            map.insert("network_range".to_string(), serde_json::json!("192.168.1.0/24"));
            map.insert("notify_new_devices".to_string(), serde_json::json!(true));
            map.insert("scan_timeout".to_string(), serde_json::json!(5));
            map
        },
    }
}
