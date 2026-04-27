//! System information collection for Home Assistant integration.
//!
//! Collects CPU, memory, disk, network, and battery metrics that can be
//! sent to Home Assistant as sensor updates.

use anyhow::Result;
use battery::Manager as BatteryManager;
use serde::{Deserialize, Serialize};
use sysinfo::{CpuRefreshKind, Disks, MemoryRefreshKind, Networks, RefreshKind, System};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemMetrics {
    pub timestamp: String,
    pub hostname: String,
    pub os: String,
    pub cpu_usage: f32,
    pub cpu_temp: Option<f32>,
    pub memory_total_gb: f32,
    pub memory_used_gb: f32,
    pub memory_percent: f32,
    pub swap_total_gb: f32,
    pub swap_used_gb: f32,
    pub disk_total_gb: f64,
    pub disk_used_gb: f64,
    pub disk_percent: f32,
    pub network_rx_mb: f64,
    pub network_tx_mb: f64,
    pub battery_percent: Option<f32>,
    pub battery_state: Option<String>,
    pub is_charging: Option<bool>,
    pub screen_on: bool,
}

/// Collects current system metrics.
pub fn collect_metrics() -> Result<SystemMetrics> {
    let mut sys = System::new_with_specifics(
        RefreshKind::new()
            .with_cpu(CpuRefreshKind::everything())
            .with_memory(MemoryRefreshKind::everything()),
    );

    // Need to refresh twice for accurate CPU usage
    sys.refresh_cpu();
    std::thread::sleep(std::time::Duration::from_millis(200));
    sys.refresh_cpu();
    sys.refresh_memory();

    let cpu_usage = sys.global_cpu_info().cpu_usage();
    let cpu_temp = get_cpu_temperature(&sys);

    let memory_total_gb = bytes_to_gb(sys.total_memory());
    let memory_used_gb = bytes_to_gb(sys.used_memory());
    let memory_percent = if memory_total_gb > 0.0 {
        (memory_used_gb / memory_total_gb) * 100.0
    } else {
        0.0
    };

    let swap_total_gb = bytes_to_gb(sys.total_swap());
    let swap_used_gb = bytes_to_gb(sys.used_swap());

    // Disk info
    let disks = Disks::new_with_refreshed_list();
    let (disk_total_gb, disk_used_gb) = calculate_disk_usage(&disks);
    let disk_percent = if disk_total_gb > 0.0 {
        ((disk_used_gb / disk_total_gb) * 100.0) as f32
    } else {
        0.0
    };

    // Network info
    let networks = Networks::new_with_refreshed_list();
    let (network_rx_mb, network_tx_mb) = calculate_network_stats(&networks);

    // Battery info
    let (battery_percent, battery_state, is_charging) = get_battery_info();

    // Screen detection (simplified - actual detection is platform-specific)
    let screen_on = is_screen_on();

    Ok(SystemMetrics {
        timestamp: chrono::Utc::now().to_rfc3339(),
        hostname: System::host_name().unwrap_or_else(|| "unknown".to_string()),
        os: System::long_os_version().unwrap_or_else(|| "unknown".to_string()),
        cpu_usage,
        cpu_temp,
        memory_total_gb,
        memory_used_gb,
        memory_percent,
        swap_total_gb,
        swap_used_gb,
        disk_total_gb,
        disk_used_gb,
        disk_percent,
        network_rx_mb,
        network_tx_mb,
        battery_percent,
        battery_state,
        is_charging,
        screen_on,
    })
}

fn bytes_to_gb(bytes: u64) -> f32 {
    bytes as f32 / 1_073_741_824.0 // 1024^3
}

fn get_cpu_temperature(_sys: &System) -> Option<f32> {
    // Try to get CPU temperature from components
    let components = sysinfo::Components::new_with_refreshed_list();
    for component in &components {
        let label = component.label().to_lowercase();
        if label.contains("cpu") || label.contains("core") || label.contains("package") {
            return Some(component.temperature());
        }
    }
    None
}

fn calculate_disk_usage(disks: &Disks) -> (f64, f64) {
    let mut total = 0u64;
    let mut used = 0u64;

    for disk in disks {
        total += disk.total_space();
        used += total - disk.available_space();
    }

    (
        total as f64 / 1_073_741_824.0,
        used as f64 / 1_073_741_824.0,
    )
}

fn calculate_network_stats(networks: &Networks) -> (f64, f64) {
    let mut rx_bytes = 0u64;
    let mut tx_bytes = 0u64;

    for (_name, network) in networks {
        rx_bytes += network.total_received();
        tx_bytes += network.total_transmitted();
    }

    (
        rx_bytes as f64 / 1_048_576.0, // to MB
        tx_bytes as f64 / 1_048_576.0,
    )
}

fn get_battery_info() -> (Option<f32>, Option<String>, Option<bool>) {
    if let Ok(manager) = BatteryManager::new() {
        if let Some(Ok(battery)) = manager.batteries().ok().and_then(|mut b| b.next()) {
            let percent = battery.state_of_charge().value * 100.0;
            let state = format!("{:?}", battery.state());
            let is_charging = matches!(battery.state(), battery::State::Charging);
            return (Some(percent), Some(state), Some(is_charging));
        }
    }
    (None, None, None)
}

fn is_screen_on() -> bool {
    // Simplified detection - in production, use platform-specific APIs
    // On Windows: GetSystemMetrics(SM_CMONITORS)
    // On Linux: check DPMS status
    // On macOS: IODisplayWrangler
    true // Default to true for now
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_collect_metrics() {
        let metrics = collect_metrics().unwrap();
        assert!(metrics.cpu_usage >= 0.0);
        assert!(metrics.memory_total_gb > 0.0);
        println!("Metrics: {:?}", metrics);
    }
}
