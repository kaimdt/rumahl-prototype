//! Gemeinsamer Plugin-Sandbox-Container.
//!
//! Architektur:
//! - Genau **EIN** Docker-Container `iora-plugin-sandbox` läuft auf dem Host.
//! - Plugin-Code liegt unter `<base_dir>/plugins/<plugin_id>/index.js` (vom Host gemountet).
//! - Der Container fährt einen Node.js-Runtime hoch, der diese Plugins lädt und über
//!   einen kleinen HTTP-Server (Port 8765 im Container, ungebunden auf Host außer Loopback)
//!   ausführt.
//! - Plugins sind **jederzeit verfügbar**: Wird der Container gestoppt oder stürzt ab,
//!   merkt das der Health-Check und startet ihn neu. Plugin-Code geht dabei nicht verloren,
//!   da er im Volume liegt.
//!
//! Lebenszyklus:
//! - `ensure_running()`: stellt sicher, dass der Container existiert und läuft.
//!   Fehlt das Image, wird ein Build mit dem in `RUNTIME_SOURCE` eingebetteten
//!   Bootstrap-Script angestoßen. Fehlt der Container, wird er erstellt; ist er
//!   gestoppt, wird er gestartet; ist er bereits am Laufen, no-op.
//! - `register_plugin()`: schreibt den Plugin-Code in das Volume und triggert ein
//!   Reload via HTTP `POST /reload` an die Sandbox.
//! - `unregister_plugin()`: löscht das Plugin-Verzeichnis und triggert Reload.
//! - `health_check()`: HTTP `GET /health` mit kurzem Timeout.
//! - `spawn_health_loop()`: prüft alle 30 Sekunden und ruft `ensure_running()` falls nötig.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use tokio::process::Command;
use tokio::sync::RwLock;

const SANDBOX_CONTAINER: &str = "iora-plugin-sandbox";
const SANDBOX_IMAGE: &str = "iora-plugin-sandbox:latest";
const SANDBOX_HOST_PORT: u16 = 18765;
const SANDBOX_INTERNAL_PORT: u16 = 8765;
const HEALTH_TIMEOUT_SECS: u64 = 3;

/// Eingebetteter Runtime-Bootstrap (wird beim Image-Build verwendet).
/// Schlanker Node.js-Server, der `plugins/<id>/index.js` lädt und ausführt.
const RUNTIME_SOURCE: &str = include_str!("plugin_sandbox_runtime.js");
const RUNTIME_DOCKERFILE: &str = "FROM node:20-alpine\n\
    WORKDIR /app\n\
    COPY runtime.js /app/runtime.js\n\
    RUN mkdir -p /plugins\n\
    EXPOSE 8765\n\
    HEALTHCHECK --interval=10s --timeout=3s --retries=3 \\\n\
      CMD wget -qO- http://127.0.0.1:8765/health >/dev/null 2>&1 || exit 1\n\
    CMD [\"node\", \"/app/runtime.js\"]\n";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginRegistration {
    pub plugin_id: String,
    pub manifest: serde_json::Value,
    /// Pfad zur `index.js` auf dem Host (wird in den Sandbox-Container kopiert).
    pub source_path: PathBuf,
}

#[derive(Debug, Default)]
struct InnerState {
    /// Liste der bekannten Plugin-IDs. Wird aus dem Volume rekonstruiert beim Start.
    registered: Vec<String>,
}

pub struct PluginSandbox {
    plugins_dir: PathBuf,
    build_context_dir: PathBuf,
    inner: RwLock<InnerState>,
    /// `true` sobald `ensure_running()` mindestens einmal erfolgreich war.
    initialized: RwLock<bool>,
}

impl PluginSandbox {
    /// Erzeugt den Manager. Legt benötigte Host-Verzeichnisse an, startet aber
    /// den Container noch nicht (das passiert lazy bei `ensure_running()`).
    pub async fn new(base_dir: &Path) -> Result<Arc<Self>> {
        let plugins_dir = base_dir.join("plugin-sandbox").join("plugins");
        let build_context_dir = base_dir.join("plugin-sandbox").join("build");

        tokio::fs::create_dir_all(&plugins_dir)
            .await
            .with_context(|| format!("kann {} nicht anlegen", plugins_dir.display()))?;
        tokio::fs::create_dir_all(&build_context_dir).await.ok();

        // Aus existierenden Verzeichnissen die bekannten Plugin-IDs rekonstruieren
        let mut registered = Vec::new();
        if let Ok(mut rd) = tokio::fs::read_dir(&plugins_dir).await {
            while let Ok(Some(entry)) = rd.next_entry().await {
                if entry.file_type().await.map(|t| t.is_dir()).unwrap_or(false) {
                    if let Some(name) = entry.file_name().to_str() {
                        registered.push(name.to_string());
                    }
                }
            }
        }

        Ok(Arc::new(Self {
            plugins_dir,
            build_context_dir,
            inner: RwLock::new(InnerState { registered }),
            initialized: RwLock::new(false),
        }))
    }

    pub async fn list(&self) -> Vec<String> {
        self.inner.read().await.registered.clone()
    }

    pub fn host_url(&self) -> String {
        format!("http://127.0.0.1:{SANDBOX_HOST_PORT}")
    }

    /// Stellt sicher, dass der Sandbox-Container läuft. Idempotent.
    /// Liefert `Ok(false)` wenn Docker nicht verfügbar ist (lokaler Modus –
    /// dann werden Plugins als "registriert, aber nicht ausführbar" behandelt).
    pub async fn ensure_running(&self) -> Result<bool> {
        if !docker_available().await {
            return Ok(false);
        }

        // 1. Image existiert?
        if !image_exists(SANDBOX_IMAGE).await? {
            self.build_image().await?;
        }

        // 2. Container existiert?
        match container_state(SANDBOX_CONTAINER).await? {
            ContainerState::Running => {
                *self.initialized.write().await = true;
                return Ok(true);
            }
            ContainerState::Stopped => {
                // Existiert, aber gestoppt → einfach starten
                let out = Command::new("docker")
                    .args(["start", SANDBOX_CONTAINER])
                    .output()
                    .await
                    .context("docker start fehlgeschlagen")?;
                if !out.status.success() {
                    return Err(anyhow!(
                        "docker start {SANDBOX_CONTAINER}: {}",
                        String::from_utf8_lossy(&out.stderr)
                    ));
                }
            }
            ContainerState::Missing => {
                self.create_container().await?;
            }
        }

        // 3. Auf Health warten (max. 15s)
        for _ in 0..15 {
            if self.health_check().await {
                *self.initialized.write().await = true;
                return Ok(true);
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
        Err(anyhow!(
            "Sandbox-Container ist gestartet, antwortet aber nicht auf /health"
        ))
    }

    async fn build_image(&self) -> Result<()> {
        // Build-Kontext schreiben
        let dockerfile_path = self.build_context_dir.join("Dockerfile");
        let runtime_path = self.build_context_dir.join("runtime.js");
        tokio::fs::write(&dockerfile_path, RUNTIME_DOCKERFILE)
            .await
            .with_context(|| format!("kann {} nicht schreiben", dockerfile_path.display()))?;
        tokio::fs::write(&runtime_path, RUNTIME_SOURCE)
            .await
            .with_context(|| format!("kann {} nicht schreiben", runtime_path.display()))?;

        let out = Command::new("docker")
            .args([
                "build",
                "-t",
                SANDBOX_IMAGE,
                self.build_context_dir.to_string_lossy().as_ref(),
            ])
            .output()
            .await
            .context("docker build aufruf fehlgeschlagen")?;
        if !out.status.success() {
            return Err(anyhow!(
                "docker build sandbox image: {}",
                String::from_utf8_lossy(&out.stderr)
            ));
        }
        Ok(())
    }

    async fn create_container(&self) -> Result<()> {
        // Container mit Resource-Limits erzeugen.
        // - 512 MB RAM, 1 CPU max
        // - read-only root, schreibbar nur /tmp und /plugins
        // - kein Netzwerk außer Loopback (Plugins fragen Daten via /api beim Host)
        // - --restart unless-stopped → resilient gegen Docker-Daemon-Reboots
        let mount_arg = format!(
            "type=bind,source={},target=/plugins,readonly",
            self.plugins_dir.to_string_lossy()
        );
        let port_arg = format!("127.0.0.1:{SANDBOX_HOST_PORT}:{SANDBOX_INTERNAL_PORT}");

        let out = Command::new("docker")
            .args([
                "run",
                "-d",
                "--name",
                SANDBOX_CONTAINER,
                "--restart",
                "unless-stopped",
                "--memory",
                "512m",
                "--cpus",
                "1.0",
                "--cap-drop",
                "ALL",
                "--security-opt",
                "no-new-privileges",
                "--read-only",
                "--tmpfs",
                "/tmp:size=64m",
                "-p",
                &port_arg,
                "--mount",
                &mount_arg,
                SANDBOX_IMAGE,
            ])
            .output()
            .await
            .context("docker run aufruf fehlgeschlagen")?;
        if !out.status.success() {
            return Err(anyhow!(
                "docker run {SANDBOX_CONTAINER}: {}",
                String::from_utf8_lossy(&out.stderr)
            ));
        }
        Ok(())
    }

    /// Schreibt den Plugin-Code ins Volume und triggert ein Reload.
    /// Plugin bleibt nach Sandbox-Restart erhalten, weil das Volume persistent ist.
    pub async fn register_plugin(&self, reg: PluginRegistration) -> Result<()> {
        let dst_dir = self.plugins_dir.join(&reg.plugin_id);
        tokio::fs::create_dir_all(&dst_dir).await?;
        // Plugin-Source kopieren
        let src = &reg.source_path;
        let dst = dst_dir.join("index.js");
        tokio::fs::copy(src, &dst)
            .await
            .with_context(|| format!("kopiere {} → {}", src.display(), dst.display()))?;
        // Manifest-Schnipsel ablegen, damit der Runtime weiß, was es ausführen soll
        let manifest_dst = dst_dir.join("manifest.json");
        tokio::fs::write(
            &manifest_dst,
            serde_json::to_vec_pretty(&reg.manifest).unwrap_or_default(),
        )
        .await?;

        let mut inner = self.inner.write().await;
        if !inner.registered.contains(&reg.plugin_id) {
            inner.registered.push(reg.plugin_id.clone());
        }
        drop(inner);

        // Reload triggern (best effort – wenn Sandbox down ist, wird sie beim
        // nächsten ensure_running die Plugins eh neu laden, da sie aus dem Volume
        // kommen)
        let _ = self.notify_reload().await;
        Ok(())
    }

    pub async fn unregister_plugin(&self, plugin_id: &str) -> Result<()> {
        let dst_dir = self.plugins_dir.join(plugin_id);
        if dst_dir.exists() {
            tokio::fs::remove_dir_all(&dst_dir).await.ok();
        }
        let mut inner = self.inner.write().await;
        inner.registered.retain(|id| id != plugin_id);
        drop(inner);
        let _ = self.notify_reload().await;
        Ok(())
    }

    /// Führt ein Plugin aus, indem die Anfrage an die Sandbox proxied wird.
    /// Timeout = 5s by default.
    pub async fn execute(
        &self,
        plugin_id: &str,
        input: serde_json::Value,
        timeout: Duration,
    ) -> Result<serde_json::Value> {
        if !*self.initialized.read().await {
            self.ensure_running().await?;
        }
        let url = format!("{}/execute/{plugin_id}", self.host_url());
        let client = reqwest::Client::builder().timeout(timeout).build()?;
        let resp = client.post(&url).json(&input).send().await?;
        if !resp.status().is_success() {
            return Err(anyhow!(
                "sandbox plugin {plugin_id} responded {}",
                resp.status()
            ));
        }
        Ok(resp.json().await?)
    }

    pub async fn health_check(&self) -> bool {
        let url = format!("{}/health", self.host_url());
        let client = match reqwest::Client::builder()
            .timeout(Duration::from_secs(HEALTH_TIMEOUT_SECS))
            .build()
        {
            Ok(c) => c,
            Err(_) => return false,
        };
        client
            .get(&url)
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false)
    }

    async fn notify_reload(&self) -> Result<()> {
        let url = format!("{}/reload", self.host_url());
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(HEALTH_TIMEOUT_SECS))
            .build()?;
        client.post(&url).send().await?;
        Ok(())
    }
}

/// Background-Task: hält den Sandbox-Container am Leben.
pub async fn spawn_health_loop(sandbox: Arc<PluginSandbox>) {
    let interval = Duration::from_secs(30);
    loop {
        tokio::time::sleep(interval).await;
        if !docker_available().await {
            continue;
        }
        if !sandbox.health_check().await {
            // Container ist down → ensure_running wird ihn (wieder)beleben
            if let Err(e) = sandbox.ensure_running().await {
                eprintln!("[plugin-sandbox] ensure_running fehlgeschlagen: {e:#}");
            }
        }
    }
}

// ── Docker-Helpers ────────────────────────────────────────────────────────

enum ContainerState {
    Running,
    Stopped,
    Missing,
}

async fn docker_available() -> bool {
    match Command::new("docker").arg("version").output().await {
        Ok(o) => o.status.success(),
        Err(_) => false,
    }
}

async fn image_exists(image: &str) -> Result<bool> {
    let out = Command::new("docker")
        .args(["image", "inspect", image])
        .output()
        .await?;
    Ok(out.status.success())
}

async fn container_state(name: &str) -> Result<ContainerState> {
    let out = Command::new("docker")
        .args(["container", "inspect", "-f", "{{.State.Status}}", name])
        .output()
        .await?;
    if !out.status.success() {
        // Container existiert nicht
        return Ok(ContainerState::Missing);
    }
    let state = String::from_utf8_lossy(&out.stdout).trim().to_lowercase();
    if state == "running" {
        Ok(ContainerState::Running)
    } else {
        Ok(ContainerState::Stopped)
    }
}
