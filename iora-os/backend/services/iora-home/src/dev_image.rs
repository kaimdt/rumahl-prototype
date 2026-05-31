// Detects whether we're running on an "OS dev image" — i.e. a build
// that was produced via `build-all-images.sh` with the dev profile,
// where `/etc/iora/os-dev-mode` is dropped by `board/iora/post-build.sh`.
//
// On those images:
//   * the Developer Mode setting is forced ON and cannot be disabled
//     from the UI,
//   * `iora-developer-app.service` and `iora-dev-bridge.service` are
//     started automatically on boot,
//   * the dashboard surfaces a banner with the dev-token and bridge URL.
//
// On non-dev images and on developer workstations (Windows/macOS) the
// markers are absent and `is_os_dev` returns false.

use std::path::Path;

#[derive(Debug, Clone)]
pub struct DevImageInfo {
    pub is_os_dev: bool,
    pub dev_token_present: bool,
    pub bridge_unit_installed: bool,
    pub developer_app_unit_installed: bool,
    pub build_id: Option<String>,
}

impl DevImageInfo {
    pub fn detect() -> Self {
        let is_os_dev = Path::new("/etc/iora/os-dev-mode").exists();
        let dev_token_present = Path::new("/etc/iora/dev-token").exists();
        let bridge_unit_installed = Path::new("/etc/systemd/system/iora-dev-bridge.service")
            .exists()
            || Path::new("/lib/systemd/system/iora-dev-bridge.service").exists()
            || Path::new("/usr/lib/systemd/system/iora-dev-bridge.service").exists();
        let developer_app_unit_installed =
            Path::new("/etc/systemd/system/iora-developer-app.service").exists()
                || Path::new("/lib/systemd/system/iora-developer-app.service").exists()
                || Path::new("/usr/lib/systemd/system/iora-developer-app.service").exists();
        let build_id = std::fs::read_to_string("/etc/iora/build-id")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        Self {
            is_os_dev,
            dev_token_present,
            bridge_unit_installed,
            developer_app_unit_installed,
            build_id,
        }
    }

    pub fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "is_os_dev": self.is_os_dev,
            "dev_token_present": self.dev_token_present,
            "bridge_unit_installed": self.bridge_unit_installed,
            "developer_app_unit_installed": self.developer_app_unit_installed,
            "build_id": self.build_id,
        })
    }
}
