// Local app store — works without `iora-appstore`.
//
// This is the minimum we need to let users install ZIP-packaged apps and
// plugins on a fresh / dashboard-only image. The proper iora-appstore
// service has its own Postgres schema and a port manager, but it isn't
// always deployed (and on dev images we explicitly want to avoid that
// dependency). This module mirrors the API shape the frontend already
// uses (`/api/appstore/...`) so the AppStoreTab works without any
// frontend changes when iora-appstore is missing.
//
// Storage layout:
//
//   <base_dir>/
//     index.json                — catalogue of installed apps
//     install-history.json      — recent installation entries shown in the UI
//     <app_id>/
//       manifest.json           — copy of the app's manifest
//       <… extracted ZIP …>
//
// Defaults to `/var/lib/iora/iora-home/local-apps` on Linux, falls back to a
// `iora-local-apps` folder under the current working directory on
// Windows / unprivileged dev envs.

use anyhow::{anyhow, Context as _, Result};
use iora_shared::manifest_validator::{self, ValidationSeverity};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
use uuid::Uuid;

const INDEX_FILE: &str = "index.json";
const JOBS_FILE: &str = "install-history.json";
const MAX_LOG_LINES: usize = 200;
const MAX_INSTALL_HISTORY: usize = 50;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub developer: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub icon: Option<String>,
    /// "app" or "plugin" — informational only.
    #[serde(default)]
    pub r#type: Option<String>,
    #[serde(default)]
    pub permissions: Vec<String>,
    /// Catch-all for the rest of the manifest (docker config, …) so we
    /// can round-trip it back to the UI.
    #[serde(flatten)]
    pub extra: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledApp {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub developer: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub icon: Option<String>,
    pub trust_level: String,
    pub enabled: bool,
    #[serde(default)]
    pub autostart: bool,
    #[serde(default = "default_status")]
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_started_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_stopped_at: Option<String>,
    pub installed_at: String,
    pub source: String,
    /// "app" / "plugin" / "system" — used by the UI to filter.
    #[serde(default = "default_kind")]
    pub kind: String,
    /// Set for built-in/system apps that can't be uninstalled (e.g.
    /// the Developer App).
    #[serde(default)]
    pub system: bool,
    pub manifest: AppManifest,
    /// Custom pages extracted from the manifest (custom_pages).
    #[serde(default)]
    pub custom_pages: Vec<CustomPageEntry>,
    /// Docker config extracted from the manifest.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub docker_config: Option<serde_json::Value>,
    /// Port mappings (external:internal), populated when app is started.
    #[serde(default)]
    pub ports: Vec<PortMapping>,
    /// Whether this is a multi-container bundle app (v2.3).
    #[serde(default)]
    pub is_bundle: bool,
    /// Bundle configuration (services, network, volumes) if is_bundle.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bundle_config: Option<serde_json::Value>,
    /// Permissions explicitly granted for this installed app/plugin.
    #[serde(default)]
    pub permission_grants: Vec<AppPermissionGrant>,
    /// Permissions requested by the manifest but not granted.
    #[serde(default)]
    pub denied_permissions: Vec<String>,
    /// Install-time permission audit entries.
    #[serde(default)]
    pub permission_audit: Vec<AppPermissionAuditEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppPermissionGrant {
    pub permission: String,
    pub granted_at: String,
    pub granted_by: String,
    pub risk_level: String,
    #[serde(default = "default_true")]
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppPermissionAuditEntry {
    pub timestamp: String,
    pub action: String,
    pub permission: String,
    pub actor: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct InstallOptions {
    pub replace_existing: bool,
    pub granted_permissions: Option<Vec<String>>,
    pub denied_permissions: Vec<String>,
    pub actor: Option<String>,
}

fn default_status() -> String {
    "stopped".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomPageEntry {
    pub id: String,
    pub title: String,
    pub icon: String,
    pub url: String,
    #[serde(default = "default_true")]
    pub show_in_nav: bool,
    #[serde(default)]
    pub order: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_page_id: Option<String>,
    #[serde(default)]
    pub iframe: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub iframe_config: Option<serde_json::Value>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortMapping {
    pub internal: u16,
    pub external: u16,
    pub protocol: String,
}

fn default_kind() -> String {
    "app".to_string()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InstallStatus {
    Pending,
    Extracting,
    Validating,
    Installing,
    Succeeded,
    Failed,
    Canceled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallJob {
    pub id: Uuid,
    pub file_name: String,
    pub size_bytes: u64,
    pub status: InstallStatus,
    /// 0..100
    pub progress: u8,
    pub message: String,
    pub app_id: Option<String>,
    pub app_name: Option<String>,
    pub app_version: Option<String>,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub error: Option<String>,
    #[serde(default)]
    pub log: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    pub timestamp: String,
    pub level: String,
    pub message: String,
    #[serde(default)]
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum InstallEvent {
    Snapshot {
        installed: Vec<InstalledApp>,
        jobs: Vec<InstallJob>,
    },
    JobUpdated {
        job: InstallJob,
    },
    AppsChanged {
        installed: Vec<InstalledApp>,
    },
    LogEntry {
        app_id: String,
        entry: LogEntry,
    },
}

const MAX_APP_LOG_LINES: usize = 500;

#[derive(Default)]
struct Inner {
    apps: HashMap<String, InstalledApp>,
    jobs: HashMap<Uuid, InstallJob>,
    /// FIFO of recent job ids so we can prune.
    job_order: Vec<Uuid>,
}

pub struct LocalAppStore {
    base_dir: PathBuf,
    inner: RwLock<Inner>,
    /// Per-app log ring buffers. Stored in a sync mutex (separate from
    /// the async `Inner` lock) so that `append_log` can be safely called
    /// from synchronous contexts without panicking — `tokio::sync::
    /// RwLock::blocking_write` panics when invoked inside the runtime,
    /// which previously caused HTTP handlers to abort with
    /// ERR_EMPTY_RESPONSE.
    app_logs: std::sync::Mutex<HashMap<String, Vec<LogEntry>>>,
    events: broadcast::Sender<InstallEvent>,
}

impl LocalAppStore {
    /// Pick the base dir based on env / OS conventions, create it, and
    /// load the on-disk index.
    pub async fn open() -> Result<Arc<Self>> {
        let base = std::env::var("IORA_LOCAL_APPS_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                if cfg!(target_os = "linux") {
                    PathBuf::from("/var/lib/iora/iora-home/local-apps")
                } else {
                    std::env::current_dir()
                        .unwrap_or_else(|_| PathBuf::from("."))
                        .join("data")
                        .join("iora-local-apps")
                }
            });
        tokio::fs::create_dir_all(&base)
            .await
            .with_context(|| format!("creating local-apps dir at {}", base.display()))?;
        let (tx, _rx) = broadcast::channel(64);
        let store = Arc::new(Self {
            base_dir: base,
            inner: RwLock::new(Inner::default()),
            app_logs: std::sync::Mutex::new(HashMap::new()),
            events: tx,
        });
        store.reload_index().await?;
        store.reload_jobs().await?;
        Ok(store)
    }

    async fn reload_index(&self) -> Result<()> {
        let path = self.base_dir.join(INDEX_FILE);
        let apps = match tokio::fs::read(&path).await {
            Ok(bytes) => serde_json::from_slice::<Vec<InstalledApp>>(&bytes).unwrap_or_else(|e| {
                tracing::warn!("local-apps index corrupted ({e}); starting empty");
                Vec::new()
            }),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(e) => return Err(e).context("reading local-apps index"),
        };
        // Populate custom_pages and docker_config from manifest extra for
        // apps that were installed before these fields were added.
        let mut changed = false;
        let enriched: Vec<InstalledApp> = apps
            .into_iter()
            .map(|mut a| {
                if a.enabled && !a.autostart {
                    a.autostart = true;
                    changed = true;
                }
                if a.status == "installing" || a.status == "starting" {
                    a.status = "error".to_string();
                    a.error_message =
                        Some("Recovered after interrupted install/runtime preparation".to_string());
                    changed = true;
                }
                if a.custom_pages.is_empty() {
                    if let Some(cp) = a.manifest.extra.get("custom_pages") {
                        if let Ok(pages) =
                            serde_json::from_value::<Vec<CustomPageEntry>>(cp.clone())
                        {
                            a.custom_pages = pages;
                            changed = true;
                        }
                    }
                }
                if a.docker_config.is_none() {
                    a.docker_config = a.manifest.extra.get("docker").cloned();
                    if a.docker_config.is_some() {
                        changed = true;
                    }
                }
                if !a.is_bundle && a.bundle_config.is_none() {
                    if let Some(bundle) = a.manifest.extra.get("bundle") {
                        a.is_bundle = true;
                        a.bundle_config = Some(bundle.clone());
                        changed = true;
                    }
                }
                a
            })
            .collect();

        if changed {
            let bytes = serde_json::to_vec_pretty(&enriched)
                .context("serialising recovered local-apps index")?;
            tokio::fs::write(&path, bytes)
                .await
                .context("writing recovered local-apps index")?;
        }

        let mut inner = self.inner.write().await;
        inner.apps = enriched.into_iter().map(|a| (a.id.clone(), a)).collect();
        Ok(())
    }

    async fn persist_index(&self) -> Result<()> {
        let inner = self.inner.read().await;
        let list: Vec<&InstalledApp> = inner.apps.values().collect();
        let bytes = serde_json::to_vec_pretty(&list).context("serialising index")?;
        let path = self.base_dir.join(INDEX_FILE);
        let tmp = path.with_extension("json.tmp");
        tokio::fs::write(&tmp, bytes)
            .await
            .context("writing tmp index")?;
        tokio::fs::rename(&tmp, &path)
            .await
            .context("rotating index")?;
        Ok(())
    }

    async fn reload_jobs(&self) -> Result<()> {
        let path = self.base_dir.join(JOBS_FILE);
        let jobs = match tokio::fs::read(&path).await {
            Ok(bytes) => serde_json::from_slice::<Vec<InstallJob>>(&bytes).unwrap_or_else(|e| {
                tracing::warn!("install history corrupted ({e}); starting empty");
                Vec::new()
            }),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(e) => return Err(e).context("reading install history"),
        };
        let mut inner = self.inner.write().await;
        inner.jobs.clear();
        inner.job_order.clear();
        for job in jobs.into_iter().rev().take(MAX_INSTALL_HISTORY).rev() {
            inner.job_order.push(job.id);
            inner.jobs.insert(job.id, job);
        }
        Ok(())
    }

    async fn persist_jobs(&self) -> Result<()> {
        let inner = self.inner.read().await;
        let list: Vec<InstallJob> = inner
            .job_order
            .iter()
            .filter_map(|id| inner.jobs.get(id).cloned())
            .collect();
        drop(inner);
        let bytes = serde_json::to_vec_pretty(&list).context("serialising install history")?;
        let path = self.base_dir.join(JOBS_FILE);
        let tmp = path.with_extension("json.tmp");
        tokio::fs::write(&tmp, bytes)
            .await
            .context("writing tmp install history")?;
        tokio::fs::rename(&tmp, &path)
            .await
            .context("rotating install history")?;
        Ok(())
    }

    pub async fn list(&self) -> Vec<InstalledApp> {
        let inner = self.inner.read().await;
        let mut v: Vec<InstalledApp> = inner.apps.values().cloned().collect();
        v.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        v
    }

    pub async fn jobs(&self) -> Vec<InstallJob> {
        let inner = self.inner.read().await;
        let mut v: Vec<InstallJob> = inner.jobs.values().cloned().collect();
        v.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        v
    }

    pub async fn active_jobs(&self) -> Vec<InstallJob> {
        self.jobs()
            .await
            .into_iter()
            .filter(|j| {
                !matches!(
                    j.status,
                    InstallStatus::Succeeded | InstallStatus::Failed | InstallStatus::Canceled
                )
            })
            .collect()
    }

    pub async fn clear_job(&self, id: Uuid) -> Result<bool> {
        let removed = {
            let mut inner = self.inner.write().await;
            let Some(job) = inner.jobs.get(&id) else {
                return Ok(false);
            };
            if !matches!(
                job.status,
                InstallStatus::Succeeded | InstallStatus::Failed | InstallStatus::Canceled
            ) {
                anyhow::bail!("aktive Installation kann nicht aus der Historie entfernt werden");
            }
            inner.job_order.retain(|job_id| *job_id != id);
            inner.jobs.remove(&id).is_some()
        };
        if removed {
            self.persist_jobs().await?;
        }
        Ok(removed)
    }

    pub fn subscribe(&self) -> broadcast::Receiver<InstallEvent> {
        self.events.subscribe()
    }

    pub async fn snapshot_event(&self) -> InstallEvent {
        InstallEvent::Snapshot {
            installed: self.list().await,
            jobs: self.jobs().await,
        }
    }

    /// Attach (or detach) the virtual Developer-App entry. Called when
    /// the developer.mode flag changes.
    pub async fn set_developer_app(&self, present: bool) -> Result<()> {
        let id = "iora-developer-app";
        self.set_system_app_inner(id, present, || InstalledApp {
            id: id.to_string(),
            name: "IORA Developer App".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            developer: "IORA Project".to_string(),
            description:
                "Stellt Plugin- und App-Entwicklern erweiterte APIs, einen Hot-Reload-Bridge \
                 und Debugging-Tools bereit. Wird automatisch mit dem Developer-Modus aktiviert."
                    .to_string(),
            icon: None,
            trust_level: "trusted".to_string(),
            enabled: true,
            autostart: true,
            status: "running".to_string(),
            error_message: None,
            last_started_at: Some(now_iso()),
            last_stopped_at: None,
            installed_at: now_iso(),
            source: "system".to_string(),
            kind: "system".to_string(),
            system: true,
            manifest: AppManifest {
                id: id.to_string(),
                name: "IORA Developer App".to_string(),
                version: env!("CARGO_PKG_VERSION").to_string(),
                developer: "IORA Project".to_string(),
                description: "System app — Developer Mode.".to_string(),
                icon: None,
                r#type: Some("system".to_string()),
                permissions: vec!["dev-bridge".to_string(), "service-control".to_string()],
                extra: serde_json::Value::Null,
            },
            custom_pages: Vec::new(),
            docker_config: None,
            ports: Vec::new(),
            is_bundle: false,
            bundle_config: None,
            permission_grants: Vec::new(),
            denied_permissions: Vec::new(),
            permission_audit: Vec::new(),
        })
        .await
    }

    /// Register ORA Share as a built-in system app.
    pub async fn set_share_app(&self, present: bool) -> Result<()> {
        let id = "io.iora.share";
        self.set_system_app_inner(id, present, || InstalledApp {
            id: id.to_string(),
            name: "ORA Share".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            developer: "IORA Project".to_string(),
            description: "Teile Dateien & Links zwischen Geräten im lokalen Netzwerk — eigene Pairdrop-Implementation ohne externe Dienste.".to_string(),
            icon: Some("share-network".to_string()),
            trust_level: "trusted".to_string(),
            enabled: true,
            autostart: true,
            status: "running".to_string(),
            error_message: None,
            last_started_at: Some(now_iso()),
            last_stopped_at: None,
            installed_at: now_iso(),
            source: "system".to_string(),
            kind: "app".to_string(),
            system: true,
            manifest: AppManifest {
                id: id.to_string(),
                name: "ORA Share".to_string(),
                version: env!("CARGO_PKG_VERSION").to_string(),
                developer: "IORA Project".to_string(),
                description: "Lokales Datei-Sharing".to_string(),
                icon: Some("share-network".to_string()),
                r#type: Some("app".to_string()),
                permissions: vec!["NetworkLocalAccess".to_string()],
                extra: serde_json::json!({
                    "custom_pages": [{
                        "id": "share",
                        "title": "ORA Share",
                        "icon": "ShareNetwork",
                        "url": "/share",
                        "show_in_nav": true,
                        "order": 500
                    }]
                }),
            },
            custom_pages: vec![CustomPageEntry {
                id: "share".to_string(),
                title: "ORA Share".to_string(),
                icon: "ShareNetwork".to_string(),
                url: "/share".to_string(),
                show_in_nav: true,
                order: 500,
                parent_page_id: None,
                iframe: false,
                iframe_config: None,
            }],
            docker_config: None,
            ports: Vec::new(),
            is_bundle: false,
            bundle_config: None,
            permission_grants: Vec::new(),
            denied_permissions: Vec::new(),
            permission_audit: Vec::new(),
        }).await
    }

    /// Register ORA Streaming as a built-in system app.
    pub async fn set_streaming_app(&self, present: bool) -> Result<()> {
        let id = "io.iora.streaming";
        self.set_system_app_inner(id, present, || InstalledApp {
            id: id.to_string(),
            name: "ORA Streaming".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            developer: "IORA Project".to_string(),
            description: "Streame Kamera, Mikrofon oder Bildschirm live über IORA — niedrige Latenz, ideal für Überwachungskameras oder Präsentationen.".to_string(),
            icon: Some("broadcast".to_string()),
            trust_level: "trusted".to_string(),
            enabled: true,
            autostart: true,
            status: "running".to_string(),
            error_message: None,
            last_started_at: Some(now_iso()),
            last_stopped_at: None,
            installed_at: now_iso(),
            source: "system".to_string(),
            kind: "app".to_string(),
            system: true,
            manifest: AppManifest {
                id: id.to_string(),
                name: "ORA Streaming".to_string(),
                version: env!("CARGO_PKG_VERSION").to_string(),
                developer: "IORA Project".to_string(),
                description: "Live-Streaming von Kamera, Mikro und Bildschirm".to_string(),
                icon: Some("broadcast".to_string()),
                r#type: Some("app".to_string()),
                permissions: vec!["NetworkLocalAccess".to_string(), "MediaCapture".to_string()],
                extra: serde_json::json!({
                    "custom_pages": [{
                        "id": "streaming",
                        "title": "ORA Streaming",
                        "icon": "Broadcast",
                        "url": "/streaming",
                        "show_in_nav": true,
                        "order": 510
                    }]
                }),
            },
            custom_pages: vec![CustomPageEntry {
                id: "streaming".to_string(),
                title: "ORA Streaming".to_string(),
                icon: "Broadcast".to_string(),
                url: "/streaming".to_string(),
                show_in_nav: true,
                order: 510,
                parent_page_id: None,
                iframe: false,
                iframe_config: None,
            }],
            docker_config: None,
            ports: Vec::new(),
            is_bundle: false,
            bundle_config: None,
            permission_grants: Vec::new(),
            denied_permissions: Vec::new(),
            permission_audit: Vec::new(),
        }).await
    }

    /// Internal helper to add/remove a system app atomically.
    async fn set_system_app_inner(
        &self,
        id: &str,
        present: bool,
        make_app: impl FnOnce() -> InstalledApp,
    ) -> Result<()> {
        let mut inner = self.inner.write().await;
        let changed = if present {
            if !inner.apps.contains_key(id) {
                inner.apps.insert(id.to_string(), make_app());
                true
            } else {
                false
            }
        } else {
            inner.apps.remove(id).is_some()
        };
        drop(inner);
        if changed {
            self.persist_index().await.ok();
            let _ = self.events.send(InstallEvent::AppsChanged {
                installed: self.list().await,
            });
        }
        Ok(())
    }

    pub async fn enable(&self, app_id: &str, enable: bool) -> Result<InstalledApp> {
        let mut inner = self.inner.write().await;
        let app = inner
            .apps
            .get_mut(app_id)
            .ok_or_else(|| anyhow!("app '{}' not installed", app_id))?;
        if app.system {
            return Err(anyhow!(
                "system app '{}' wird automatisch verwaltet und kann nicht manuell {}",
                app_id,
                if enable { "aktiviert" } else { "deaktiviert" }
            ));
        }
        app.enabled = enable;
        app.autostart = enable;
        if enable && app.status == "stopped" {
            app.status = "running".to_string();
            app.last_started_at = Some(now_iso());
        } else if !enable {
            app.status = "stopped".to_string();
            app.last_stopped_at = Some(now_iso());
        }
        let updated = app.clone();
        drop(inner);
        self.persist_index().await?;
        let _ = self.events.send(InstallEvent::AppsChanged {
            installed: self.list().await,
        });
        Ok(updated)
    }

    pub async fn set_status(&self, app_id: &str, status: &str) -> Result<InstalledApp> {
        let mut inner = self.inner.write().await;
        let app = inner
            .apps
            .get_mut(app_id)
            .ok_or_else(|| anyhow!("app '{}' not installed", app_id))?;
        if app.system {
            return Err(anyhow!(
                "system app '{}' wird automatisch verwaltet",
                app_id
            ));
        }
        app.status = status.to_string();
        if matches!(status, "running" | "starting") {
            app.enabled = true;
            app.last_started_at = Some(now_iso());
        } else if matches!(status, "stopped" | "paused" | "error") {
            app.last_stopped_at = Some(now_iso());
        }
        let updated = app.clone();
        drop(inner);
        self.persist_index().await?;
        let _ = self.events.send(InstallEvent::AppsChanged {
            installed: self.list().await,
        });
        Ok(updated)
    }

    /// Start the app (mark as running and optionally assign ports).
    pub async fn start(&self, app_id: &str) -> Result<InstalledApp> {
        self.set_status(app_id, "running").await
    }

    /// Stop the app (mark as stopped).
    pub async fn stop(&self, app_id: &str) -> Result<InstalledApp> {
        self.set_status(app_id, "stopped").await
    }

    pub async fn uninstall(&self, app_id: &str) -> Result<()> {
        self.uninstall_inner(app_id, false).await
    }

    /// Force-uninstall — bypasses the `system` flag. Used by the
    /// Developer App on OS-dev images where every app (including system
    /// apps and the Developer App itself) must be replaceable.
    pub async fn uninstall_force(&self, app_id: &str) -> Result<()> {
        self.uninstall_inner(app_id, true).await
    }

    async fn uninstall_inner(&self, app_id: &str, force: bool) -> Result<()> {
        let mut inner = self.inner.write().await;
        let app = inner
            .apps
            .get(app_id)
            .ok_or_else(|| anyhow!("app '{}' not installed", app_id))?;
        if app.system && !force {
            return Err(anyhow!(
                "system app '{}' kann nicht deinstalliert werden",
                app_id
            ));
        }
        inner.apps.remove(app_id);
        drop(inner);
        let dir = self.base_dir.join(app_id);
        if dir.exists() {
            tokio::fs::remove_dir_all(&dir).await.ok();
        }
        self.persist_index().await?;
        let _ = self.events.send(InstallEvent::AppsChanged {
            installed: self.list().await,
        });
        Ok(())
    }

    /// Spawn an install task and return the job id immediately.
    pub fn start_install(self: &Arc<Self>, file_name: String, zip_bytes: Vec<u8>) -> Uuid {
        self.start_install_with_options(file_name, zip_bytes, InstallOptions::default())
    }

    /// Spawn an install task with explicit install options and return the job id immediately.
    pub fn start_install_with_options(
        self: &Arc<Self>,
        file_name: String,
        zip_bytes: Vec<u8>,
        options: InstallOptions,
    ) -> Uuid {
        let id = Uuid::new_v4();
        let job = InstallJob {
            id,
            file_name: file_name.clone(),
            size_bytes: zip_bytes.len() as u64,
            status: InstallStatus::Pending,
            progress: 0,
            message: "warte auf Verarbeitung…".to_string(),
            app_id: None,
            app_name: None,
            app_version: None,
            started_at: now_iso(),
            finished_at: None,
            error: None,
            log: Vec::new(),
        };
        let store = Arc::clone(self);
        tokio::spawn(async move {
            store.upsert_job(&job).await;
            let _ = store.run_install(id, file_name, zip_bytes, options).await;
        });
        id
    }

    async fn upsert_job(&self, job: &InstallJob) {
        let mut inner = self.inner.write().await;
        if !inner.jobs.contains_key(&job.id) {
            inner.job_order.push(job.id);
            // Prune to last server-side history entries.
            while inner.job_order.len() > MAX_INSTALL_HISTORY {
                let evict = inner.job_order.remove(0);
                inner.jobs.remove(&evict);
            }
        }
        inner.jobs.insert(job.id, job.clone());
        drop(inner);
        if let Err(e) = self.persist_jobs().await {
            tracing::warn!("failed to persist install history: {e:#}");
        }
        let _ = self
            .events
            .send(InstallEvent::JobUpdated { job: job.clone() });
    }

    async fn update_job<F>(&self, id: Uuid, f: F)
    where
        F: FnOnce(&mut InstallJob),
    {
        let snapshot = {
            let mut inner = self.inner.write().await;
            if let Some(job) = inner.jobs.get_mut(&id) {
                f(job);
                if job.log.len() > MAX_LOG_LINES {
                    let drop_n = job.log.len() - MAX_LOG_LINES;
                    job.log.drain(0..drop_n);
                }
                Some(job.clone())
            } else {
                None
            }
        };
        if let Some(job) = snapshot {
            if let Err(e) = self.persist_jobs().await {
                tracing::warn!("failed to persist install history: {e:#}");
            }
            let _ = self.events.send(InstallEvent::JobUpdated { job });
        }
    }

    async fn run_install(
        self: Arc<Self>,
        id: Uuid,
        file_name: String,
        zip_bytes: Vec<u8>,
        options: InstallOptions,
    ) -> Result<()> {
        let res = self
            .run_install_inner(id, &file_name, zip_bytes, options)
            .await;
        match res {
            Ok(app) => {
                self.update_job(id, |j| {
                    j.status = InstallStatus::Succeeded;
                    j.progress = 100;
                    j.message = format!("App '{}' installiert.", app.name);
                    j.finished_at = Some(now_iso());
                    j.app_id = Some(app.id.clone());
                    j.app_name = Some(app.name.clone());
                    j.app_version = Some(app.version.clone());
                    j.log.push(format!(
                        "[ok] App '{}' v{} installiert.",
                        app.name, app.version
                    ));
                })
                .await;
                let _ = self.events.send(InstallEvent::AppsChanged {
                    installed: self.list().await,
                });
                Ok(())
            }
            Err(e) => {
                let msg = format!("{e:#}");
                tracing::warn!(install_id = %id, "install failed: {msg}");
                self.update_job(id, |j| {
                    j.status = InstallStatus::Failed;
                    j.message = "Installation fehlgeschlagen.".to_string();
                    j.error = Some(msg.clone());
                    j.finished_at = Some(now_iso());
                    j.log.push(format!("[error] {msg}"));
                })
                .await;
                Err(e)
            }
        }
    }

    async fn run_install_inner(
        &self,
        id: Uuid,
        file_name: &str,
        zip_bytes: Vec<u8>,
        options: InstallOptions,
    ) -> Result<InstalledApp> {
        // 1) Extract.
        self.update_job(id, |j| {
            j.status = InstallStatus::Extracting;
            j.progress = 5;
            j.message = format!("Entpacke {file_name}…");
            j.log.push(format!(
                "[start] datei={} ({} bytes)",
                file_name, j.size_bytes
            ));
        })
        .await;

        // Run the (synchronous, CPU-bound) zip extraction off the runtime.
        let store_dir = self.base_dir.clone();
        let id_for_progress = id;
        let events = self.events.clone();

        let extract_result =
            tokio::task::spawn_blocking(move || -> Result<(AppManifest, PathBuf)> {
                extract_zip(&zip_bytes, &store_dir, id_for_progress, &events)
            })
            .await
            .map_err(|e| anyhow!("extract task panicked: {e}"))??;

        let (manifest, staging_dir) = extract_result;

        // 2) Validate.
        self.update_job(id, |j| {
            j.status = InstallStatus::Validating;
            j.progress = 70;
            j.message = format!("Prüfe Manifest von '{}'.", manifest.name);
            j.app_id = Some(manifest.id.clone());
            j.app_name = Some(manifest.name.clone());
            j.app_version = Some(manifest.version.clone());
            j.log.push(format!(
                "[manifest] id={} name={} version={}",
                manifest.id, manifest.name, manifest.version
            ));
        })
        .await;

        let manifest_json =
            serde_json::to_value(&manifest).context("serialising manifest for validation")?;
        let validation = manifest_validator::validate_app_manifest(&manifest_json);
        if !validation.is_valid() {
            let errors: Vec<String> = validation
                .issues
                .iter()
                .filter(|issue| issue.severity == ValidationSeverity::Error)
                .map(|issue| format!("{}: {}", issue.field, issue.message))
                .collect();
            let _ = tokio::fs::remove_dir_all(&staging_dir).await;
            return Err(anyhow!("manifest.json is invalid: {}", errors.join("; ")));
        }

        for warning in validation
            .issues
            .iter()
            .filter(|issue| issue.severity == ValidationSeverity::Warning)
        {
            self.update_job(id, |j| {
                j.log
                    .push(format!("[warn] {}: {}", warning.field, warning.message));
            })
            .await;
        }

        // 3) Register.
        self.update_job(id, |j| {
            j.status = InstallStatus::Installing;
            j.progress = 90;
            j.message = "Registriere App…".to_string();
        })
        .await;

        // Extract custom_pages from manifest extra.
        let custom_pages = manifest
            .extra
            .get("custom_pages")
            .and_then(|v| serde_json::from_value::<Vec<CustomPageEntry>>(v.clone()).ok())
            .unwrap_or_default();

        // Extract docker config from manifest extra.
        let docker_config = manifest.extra.get("docker").cloned();

        // Extract bundle config (v2.3 multi-container apps).
        let is_bundle = manifest.extra.get("bundle").is_some();
        let bundle_config = manifest.extra.get("bundle").cloned();

        let needs_runtime_prep = docker_config.is_some() || bundle_config.is_some();
        let requested_permissions = manifest.permissions.clone();
        let (permission_grants, denied_permissions, permission_audit) = build_permission_grants(
            &requested_permissions,
            options.granted_permissions.as_deref(),
            &options.denied_permissions,
            options.actor.as_deref().unwrap_or("local-appstore"),
        );

        let replacing_existing = {
            let inner = self.inner.read().await;
            inner.apps.get(&manifest.id).cloned()
        };
        if let Some(existing) = replacing_existing.as_ref() {
            if !options.replace_existing {
                let _ = tokio::fs::remove_dir_all(&staging_dir).await;
                return Err(anyhow!(
                    "App '{}' is already installed. Send replace_existing=true to replace it explicitly.",
                    manifest.id
                ));
            }
            if matches!(
                existing.status.as_str(),
                "running" | "starting" | "installing"
            ) {
                let _ = tokio::fs::remove_dir_all(&staging_dir).await;
                return Err(anyhow!(
                    "App '{}' is currently in status '{}'. Stop it before replacing it.",
                    manifest.id,
                    existing.status
                ));
            }
        }

        let app = InstalledApp {
            id: manifest.id.clone(),
            name: manifest.name.clone(),
            version: manifest.version.clone(),
            developer: manifest.developer.clone(),
            description: manifest.description.clone(),
            icon: manifest.icon.clone(),
            trust_level: "untrusted".to_string(),
            enabled: false,
            autostart: false,
            status: if needs_runtime_prep {
                "installing".to_string()
            } else {
                "stopped".to_string()
            },
            error_message: None,
            last_started_at: None,
            last_stopped_at: Some(now_iso()),
            installed_at: now_iso(),
            source: "zip".to_string(),
            kind: manifest
                .r#type
                .clone()
                .filter(|t| t == "plugin" || t == "service")
                .map(|_| "plugin".to_string())
                .unwrap_or_else(|| "app".to_string()),
            system: false,
            manifest: manifest.clone(),
            custom_pages,
            docker_config,
            ports: Vec::new(),
            is_bundle,
            bundle_config,
            permission_grants,
            denied_permissions,
            permission_audit,
        };

        let app_dir = self.base_dir.join(&app.id);
        if app_dir.exists() {
            tokio::fs::remove_dir_all(&app_dir).await.with_context(|| {
                format!("replacing existing app directory {}", app_dir.display())
            })?;
        }
        tokio::fs::rename(&staging_dir, &app_dir)
            .await
            .with_context(|| format!("moving app from staging to {}", app_dir.display()))?;

        // Persist manifest.json next to the extracted files (not strictly
        // necessary because we already keep it in the index, but useful
        // for offline inspection).
        let manifest_path = app_dir.join("manifest.json");
        if let Ok(bytes) = serde_json::to_vec_pretty(&manifest) {
            tokio::fs::write(&manifest_path, bytes).await.ok();
        }

        let mut inner = self.inner.write().await;
        inner.apps.insert(app.id.clone(), app.clone());
        drop(inner);
        self.persist_index().await?;

        self.append_log(
            &app.id,
            LogEntry {
                timestamp: now_iso(),
                level: "INFO".to_string(),
                message: format!(
                    "Installed with {} granted and {} denied permissions.",
                    app.permission_grants.len(),
                    app.denied_permissions.len()
                ),
                source: "permission-audit".to_string(),
            },
        );

        Ok(app)
    }

    pub async fn has_permission(&self, app_id: &str, permission: &str) -> bool {
        let inner = self.inner.read().await;
        inner
            .apps
            .get(app_id)
            .map(|app| {
                app.permission_grants
                    .iter()
                    .any(|grant| grant.is_active && grant.permission == permission)
            })
            .unwrap_or(false)
    }

    pub fn base_dir(&self) -> &Path {
        &self.base_dir
    }

    /// Append a log entry for a specific app.
    pub fn append_log(&self, app_id: &str, entry: LogEntry) {
        {
            let mut logs_map = self.app_logs.lock().unwrap_or_else(|p| p.into_inner());
            let logs = logs_map.entry(app_id.to_string()).or_default();
            logs.push(entry.clone());
            if logs.len() > MAX_APP_LOG_LINES {
                let drop_n = logs.len() - MAX_APP_LOG_LINES;
                logs.drain(0..drop_n);
            }
        }
        let _ = self.events.send(InstallEvent::LogEntry {
            app_id: app_id.to_string(),
            entry,
        });
    }

    /// Get all log entries for a specific app.
    pub async fn get_logs(&self, app_id: &str) -> Vec<LogEntry> {
        let logs_map = self.app_logs.lock().unwrap_or_else(|p| p.into_inner());
        logs_map.get(app_id).cloned().unwrap_or_default()
    }

    /// Get all log entries across all apps.
    pub async fn get_all_logs(&self) -> HashMap<String, Vec<LogEntry>> {
        let logs_map = self.app_logs.lock().unwrap_or_else(|p| p.into_inner());
        logs_map.clone()
    }
}

fn build_permission_grants(
    requested: &[String],
    granted_override: Option<&[String]>,
    denied_override: &[String],
    actor: &str,
) -> (
    Vec<AppPermissionGrant>,
    Vec<String>,
    Vec<AppPermissionAuditEntry>,
) {
    let now = now_iso();
    let granted: std::collections::HashSet<String> = granted_override
        .map(|items| items.iter().cloned().collect())
        .unwrap_or_else(|| requested.iter().cloned().collect());
    let denied: std::collections::HashSet<String> = denied_override.iter().cloned().collect();

    let mut grants = Vec::new();
    let mut denied_permissions = Vec::new();
    let mut audit = Vec::new();

    for permission in requested {
        if granted.contains(permission) && !denied.contains(permission) {
            grants.push(AppPermissionGrant {
                permission: permission.clone(),
                granted_at: now.clone(),
                granted_by: actor.to_string(),
                risk_level: permission_risk_level(permission).to_string(),
                is_active: true,
            });
            audit.push(AppPermissionAuditEntry {
                timestamp: now.clone(),
                action: "granted".to_string(),
                permission: permission.clone(),
                actor: actor.to_string(),
                reason: Some("Granted during ZIP install".to_string()),
            });
        } else {
            denied_permissions.push(permission.clone());
            audit.push(AppPermissionAuditEntry {
                timestamp: now.clone(),
                action: "denied".to_string(),
                permission: permission.clone(),
                actor: actor.to_string(),
                reason: Some("Denied during ZIP install".to_string()),
            });
        }
    }

    (grants, denied_permissions, audit)
}

fn permission_risk_level(permission: &str) -> &'static str {
    match permission {
        "SystemControl"
        | "SystemRestart"
        | "PluginManager"
        | "CreateUser"
        | "ModifyUser"
        | "DeleteUser"
        | "FileShareManage"
        | "DeveloperAccess"
        | "InterAppCommunication"
        | "LiveMetrics"
        | "DirectDeploy"
        | "DebugAccess"
        | "LiveLogs"
        | "HotReload"
        | "AppStorageManage"
        | "AppDatabaseManage"
        | "WebhookManage"
        | "AppQueueManage"
        | "AppSecretsManage"
        | "ThemeManage"
        | "AssistTaskManage"
        | "GitHubWrite" => "critical",
        "CreateEntities"
        | "DeleteEntities"
        | "StorageDelete"
        | "NetworkOutbound"
        | "NetworkInbound"
        | "NetworkLocalAccess"
        | "DatabaseCreate"
        | "DatabaseDelete"
        | "FileSystemExecute"
        | "InstallPlugins"
        | "UninstallPlugins"
        | "CameraAccess"
        | "MicrophoneAccess"
        | "LocationPrecise"
        | "NetworkScan"
        | "FileShareWrite"
        | "FileShareDelete"
        | "AppStorageDelete"
        | "AppScheduleDelete"
        | "WebhookDelete"
        | "AppDatabaseSqlite"
        | "MessagingWildcard"
        | "NetworkAccess"
        | "ExternalHttpRequest"
        | "GitHubPullRequestComment"
        | "GitHubWorkflowTrigger" => "high",
        "ReadEntities"
        | "StorageRead"
        | "SystemInfo"
        | "DatabaseRead"
        | "ReadNotifications"
        | "FileSystemRead"
        | "ReadUserData"
        | "MediaAccess"
        | "FileShareRead"
        | "AppStorageRead"
        | "AppRuntimeAuditRead"
        | "AppSecretsRead"
        | "AppScheduleRead"
        | "WebhookRead"
        | "ThemeSelect"
        | "ReadCache"
        | "ReadSystemInfo"
        | "AssistContextRead"
        | "AssistEventsSubscribe"
        | "GitHubRead"
        | "GitHubPullRequestRead" => "low",
        _ => "medium",
    }
}

fn parse_app_manifest(bytes: &[u8]) -> Result<AppManifest> {
    let mut value: serde_json::Value = serde_json::from_slice(bytes)?;

    let metadata = value.get("metadata").cloned();
    if let (Some(object), Some(metadata)) = (
        value.as_object_mut(),
        metadata.as_ref().and_then(|v| v.as_object()),
    ) {
        for key in ["id", "name", "version", "developer", "description"] {
            if !object.contains_key(key) {
                if let Some(metadata_value) = metadata.get(key) {
                    object.insert(key.to_string(), metadata_value.clone());
                }
            }
        }
    }

    if value.get("developer").is_none() {
        value["developer"] = serde_json::Value::String("Unknown".to_string());
    }
    if value.get("description").is_none() {
        value["description"] = serde_json::Value::String(String::new());
    }

    serde_json::from_value(value).map_err(Into::into)
}

fn extract_zip(
    bytes: &[u8],
    base: &Path,
    job_id: Uuid,
    events: &broadcast::Sender<InstallEvent>,
) -> Result<(AppManifest, PathBuf)> {
    // Hard caps shared with [`iora_shared::upload_store`] — protect against
    // ZIP bombs. Apps can be larger than themes but still must stay bounded.
    const MAX_TOTAL_UNCOMPRESSED: u64 = 512 * 1024 * 1024; // 512 MiB total
    const MAX_SINGLE_FILE: u64 = 128 * 1024 * 1024; // 128 MiB per entry
    const MAX_ENTRIES: usize = 10_000;

    let cursor = Cursor::new(bytes);
    let mut zip = zip::ZipArchive::new(cursor).context("öffnen der ZIP-Datei")?;

    if zip.len() > MAX_ENTRIES {
        return Err(anyhow!(
            "ZIP enthält zu viele Einträge ({} > {})",
            zip.len(),
            MAX_ENTRIES
        ));
    }

    // Pre-flight: declared uncompressed sizes must stay within limits.
    let mut declared_total: u64 = 0;
    for i in 0..zip.len() {
        let entry = zip.by_index(i).context("ZIP-Eintrag lesen")?;
        let sz = entry.size();
        if sz > MAX_SINGLE_FILE {
            return Err(anyhow!(
                "ZIP-Eintrag '{}' überschreitet Datei-Limit ({} > {})",
                entry.name(),
                sz,
                MAX_SINGLE_FILE
            ));
        }
        declared_total = declared_total.saturating_add(sz);
        if declared_total > MAX_TOTAL_UNCOMPRESSED {
            return Err(anyhow!(
                "ZIP unkomprimierte Gesamtgröße überschreitet Limit ({} > {})",
                declared_total,
                MAX_TOTAL_UNCOMPRESSED
            ));
        }
    }

    // First pass: locate manifest.json.
    let manifest_idx = (0..zip.len())
        .find(|i| {
            zip.by_index(*i)
                .ok()
                .map(|f| {
                    let n = f.name();
                    n == "manifest.json" || n.ends_with("/manifest.json")
                })
                .unwrap_or(false)
        })
        .ok_or_else(|| anyhow!("ZIP enthält keine manifest.json im Root"))?;

    let manifest: AppManifest = {
        let mut f = zip.by_index(manifest_idx)?;
        let mut buf = Vec::new();
        f.read_to_end(&mut buf).context("lese manifest.json")?;
        parse_app_manifest(&buf).context("parse manifest.json")?
    };

    // Sanitize id (filesystem-safe).
    if !manifest
        .id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    {
        return Err(anyhow!(
            "manifest.id enthält ungültige Zeichen: '{}'",
            manifest.id
        ));
    }

    let target_dir = base.join(".install-tmp").join(job_id.to_string());
    if target_dir.exists() {
        std::fs::remove_dir_all(&target_dir).ok();
    }
    std::fs::create_dir_all(&target_dir).context("Zielverzeichnis anlegen")?;

    // If the ZIP is wrapped in a single top-level folder (e.g. when zipping
    // a directory directly), strip it.
    let common_prefix = detect_common_prefix(&mut zip);

    let total = zip.len() as u64;
    for i in 0..zip.len() {
        let mut file = zip.by_index(i)?;
        let raw = file.name().to_string();
        let stripped = match &common_prefix {
            Some(p) => raw.strip_prefix(p).unwrap_or(&raw),
            None => raw.as_str(),
        };
        if stripped.is_empty() {
            continue;
        }
        // Reject zip-slip.
        let safe = sanitize_path(stripped)
            .ok_or_else(|| anyhow!("unsicherer Pfad in ZIP: '{stripped}'"))?;
        let out_path = target_dir.join(&safe);
        if file.is_dir() {
            std::fs::create_dir_all(&out_path).ok();
            continue;
        }
        if let Some(p) = out_path.parent() {
            std::fs::create_dir_all(p).ok();
        }
        let mut out = std::fs::File::create(&out_path)
            .with_context(|| format!("schreibe {}", out_path.display()))?;
        // Defensive cap: the actual decompressed stream must not exceed the
        // pre-flight per-file limit (a malicious ZIP header may lie about
        // declared size).
        let mut limited = (&mut file).take(MAX_SINGLE_FILE + 1);
        let written = std::io::copy(&mut limited, &mut out)?;
        if written > MAX_SINGLE_FILE {
            // Best-effort cleanup of the half-written file.
            let _ = std::fs::remove_file(&out_path);
            return Err(anyhow!(
                "ZIP-Eintrag '{}' tatsächliche Größe überschreitet Datei-Limit",
                raw
            ));
        }

        // Periodic progress update (every ~16 entries).
        if i % 16 == 0 {
            let pct = 5 + ((i as u64 + 1) * 60 / total.max(1)) as u8;
            let event = InstallEvent::JobUpdated {
                job: InstallJob {
                    id: job_id,
                    file_name: String::new(),
                    size_bytes: bytes.len() as u64,
                    status: InstallStatus::Extracting,
                    progress: pct.min(70),
                    message: format!("Entpacke ({}/{}…)", i + 1, total),
                    app_id: None,
                    app_name: Some(manifest.name.clone()),
                    app_version: Some(manifest.version.clone()),
                    started_at: String::new(),
                    finished_at: None,
                    error: None,
                    log: Vec::new(),
                },
            };
            // Best-effort — receivers may have lagged; we don't care.
            let _ = events.send(event);
        }
    }
    Ok((manifest, target_dir))
}

fn detect_common_prefix(zip: &mut zip::ZipArchive<Cursor<&[u8]>>) -> Option<String> {
    let names: Vec<String> = (0..zip.len())
        .filter_map(|i| zip.by_index(i).ok().map(|f| f.name().to_string()))
        .collect();
    if names.is_empty() {
        return None;
    }
    let first = names[0].split('/').next().unwrap_or("").to_string();
    if first.is_empty() {
        return None;
    }
    let prefix = format!("{first}/");
    if names.iter().all(|n| n.starts_with(&prefix) || n == &first) {
        Some(prefix)
    } else {
        None
    }
}

fn sanitize_path(input: &str) -> Option<PathBuf> {
    let mut out = PathBuf::new();
    for component in Path::new(input).components() {
        match component {
            std::path::Component::Normal(c) => out.push(c),
            std::path::Component::CurDir => {}
            _ => return None, // RootDir, ParentDir, Prefix → rejected.
        }
    }
    Some(out)
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}
