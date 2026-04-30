// Maps friendly component names to systemd units and on-device binary paths.
//
// Convention from the IORA OS rootfs:
//   * binaries live at /usr/bin/<name>
//   * the systemd unit is <name>.service

use serde::Serialize;
use std::sync::RwLock;

#[derive(Clone, Debug, Serialize)]
pub struct Component {
    pub name: String,
    pub unit: String,
    pub target_path: String,
}

fn custom_components() -> &'static RwLock<Vec<Component>> {
    static C: RwLock<Vec<Component>> = RwLock::new(Vec::new());
    &C
}

pub fn register_custom(name: String, unit: String, target_path: String) {
    if let Ok(mut list) = custom_components().write() {
        list.retain(|c| c.name != name);
        list.push(Component { name, unit, target_path });
    }
}

const NAMES: &[&str] = &[
    "iora-home",
    "iora-core",
    "iora-control",
    "iora-assist",
    "iora-secrets",
    "iora-watchdog",
    "iora-installer",
    "iora-security",
    "iora-gateway",
    "iora-files",
    "iora-connector",
    "iora-api",
    "iora-supervisor",
    "iora-cli",
    "iora-appstore",
    "iora-nginx",
    "iora-network-monitor",
    "iora-domain-validator",
    "iora-resource-manager",
    "iora-developer-app",
    "iora-verify",
    "iora-updater",
    "iora-sign",
    "iora-dev-bridge",
    "iora-backup",
    "iora-intelligence",
];

pub fn all() -> Vec<Component> {
    let mut builtins: Vec<Component> = NAMES
        .iter()
        .map(|n| Component {
            name: n.to_string(),
            unit: format!("{n}.service"),
            target_path: format!("/usr/bin/{n}"),
        })
        .collect();
    if let Ok(custom) = custom_components().read() {
        builtins.extend(custom.clone());
    }
    builtins
}

pub fn lookup(name: &str) -> Option<Component> {
    all().into_iter().find(|c| c.name == name)
}
