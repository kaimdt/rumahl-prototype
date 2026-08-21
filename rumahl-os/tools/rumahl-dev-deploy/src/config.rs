use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

const FILE_NAME: &str = "config.toml";

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Config {
    pub host: String,
    pub token: String,
}

fn dir() -> Result<PathBuf> {
    let base = dirs::config_dir().context("no config dir on this OS")?;
    Ok(base.join("rumahl-dev-deploy"))
}

fn path() -> Result<PathBuf> {
    Ok(dir()?.join(FILE_NAME))
}

/// Public accessor for callers (e.g. daemon::h_disconnect).
pub fn config_file_path() -> Result<PathBuf> { path() }

pub fn save(cfg: &Config) -> Result<PathBuf> {
    let d = dir()?;
    std::fs::create_dir_all(&d).with_context(|| format!("create {}", d.display()))?;
    let p = path()?;
    let s = toml::to_string_pretty(cfg)?;
    std::fs::write(&p, s).with_context(|| format!("write {}", p.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o600));
    }
    Ok(p)
}

pub fn load() -> Result<Config> {
    let p = path()?;
    let s = std::fs::read_to_string(&p)
        .with_context(|| format!("read {}", p.display()))?;
    let c: Config = toml::from_str(&s).with_context(|| format!("parse {}", p.display()))?;
    Ok(c)
}
