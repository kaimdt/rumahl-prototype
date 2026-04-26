// Maps friendly component names to systemd units and on-device binary paths.
//
// Convention from the IORA OS rootfs:
//   * binaries live at /usr/bin/<name>
//   * the systemd unit is <name>.service

#[derive(Clone, Debug)]
pub struct Component {
    pub name: &'static str,
    pub unit: String,
    pub target_path: String,
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
];

pub fn all() -> Vec<Component> {
    NAMES
        .iter()
        .map(|n| Component {
            name: n,
            unit: format!("{n}.service"),
            target_path: format!("/usr/bin/{n}"),
        })
        .collect()
}

pub fn lookup(name: &str) -> Option<Component> {
    all().into_iter().find(|c| c.name == name)
}
