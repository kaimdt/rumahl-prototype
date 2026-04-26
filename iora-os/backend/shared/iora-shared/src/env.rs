//! IORA environment detection and install marker.
//!
//! The system distinguishes between:
//! - **production** – self-installed (marker file present) or `IORA_ENV=production`
//! - **development** – default when no marker and no env override
//!
//! On first production install the installer writes a marker file.  All services
//! call [`IoraEnv::detect()`] at startup to determine the current mode.

use std::path::{Path, PathBuf};

/// Runtime environment of the IORA system.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IoraEnv {
    /// Development / local hacking – relaxed defaults.
    Development,
    /// Production – self-installed, stricter behaviour.
    Production,
}

impl IoraEnv {
    /// Detect the current environment.
    ///
    /// Priority (highest first):
    /// 1. `IORA_ENV` environment variable (`production` | `development`)
    /// 2. Presence of the install marker file (`<data_dir>/installed.marker`)
    /// 3. Fallback to [`Development`](IoraEnv::Development)
    pub fn detect() -> Self {
        // 1. Explicit env var
        if let Ok(val) = std::env::var("IORA_ENV") {
            return match val.to_ascii_lowercase().as_str() {
                "production" | "prod" => Self::Production,
                _ => Self::Development,
            };
        }

        // 2. Install marker
        if Self::marker_path().exists() {
            return Self::Production;
        }

        // 3. Default
        Self::Development
    }

    pub fn is_production(self) -> bool {
        self == Self::Production
    }

    pub fn is_development(self) -> bool {
        self == Self::Development
    }

    /// Write the install marker (called once by the installer or first-start
    /// bootstrap).  Returns the path written to.
    pub fn write_install_marker() -> std::io::Result<PathBuf> {
        let path = Self::marker_path();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let content = format!(
            "installed_at={}\nversion={}\n",
            chrono::Utc::now().to_rfc3339(),
            env!("CARGO_PKG_VERSION"),
        );
        std::fs::write(&path, content)?;
        Ok(path)
    }

    /// Check whether the install marker exists.
    pub fn is_installed() -> bool {
        Self::marker_path().exists()
    }

    /// Platform-dependent path for the marker file.
    fn marker_path() -> PathBuf {
        let base = std::env::var("IORA_DATA_DIR").unwrap_or_else(|_| {
            if cfg!(target_os = "windows") {
                "./data".to_string()
            } else {
                "/var/lib/iora".to_string()
            }
        });
        Path::new(&base).join("installed.marker")
    }
}

impl std::fmt::Display for IoraEnv {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Development => write!(f, "development"),
            Self::Production => write!(f, "production"),
        }
    }
}
