use crate::build;
use anyhow::{anyhow, Context, Result};
use reqwest::{multipart, Client as HttpClient};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::fs::File;
use std::path::Path;
use std::time::Duration;
use tar::Builder;
use tempfile::NamedTempFile;
use walkdir::WalkDir;

#[derive(Deserialize, Debug, serde::Serialize)]
pub struct Status {
    pub dev_mode: bool,
    pub variant: String,
    pub build: String,
    pub hostname: String,
    pub capabilities: Vec<String>,
}

#[derive(Deserialize, Debug, serde::Serialize)]
pub struct CmdResult {
    pub ok: bool,
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Deserialize, Debug, serde::Serialize)]
pub struct FsEntry {
    pub name: String,
    pub path: String,
    pub kind: String,
    pub size: u64,
}

#[derive(Deserialize, Debug, serde::Serialize)]
pub struct FsListResult {
    pub path: String,
    pub entries: Vec<FsEntry>,
}

#[derive(Deserialize, Debug, serde::Serialize)]
pub struct FsReadResult {
    pub path: String,
    pub content: String,
    pub bytes: usize,
    pub total_bytes: usize,
    pub truncated: bool,
    pub binary_hint: bool,
}

pub struct Client {
    base: String,
    token: String,
    http: HttpClient,
}

impl Client {
    pub fn new(host: &str, token: &str) -> Result<Self> {
        let base = normalize_base(host);
        let http = HttpClient::builder()
            .timeout(Duration::from_secs(120))
            .build()?;
        Ok(Self { base, token: token.to_string(), http })
    }

    fn with_auth(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        if self.token.is_empty() {
            return request;
        }
        request
            .header("X-IORA-Dev-Token", &self.token)
            .bearer_auth(&self.token)
    }

    pub async fn status(&self) -> Result<Status> {
        let url = format!("{}/dev/status", self.base);
        let r = self.http.get(&url).send().await
            .with_context(|| format!("GET {url}"))?;
        if !r.status().is_success() {
            return Err(anyhow!("status {} from {url}", r.status()));
        }
        Ok(r.json().await?)
    }

    pub async fn restart_unit(&self, unit: &str) -> Result<CmdResult> {
        let url = format!("{}/dev/service/{}/restart", self.base, unit);
        let r = self.with_auth(self.http.post(&url))
            .send().await?;
        Ok(r.json().await?)
    }

    pub async fn reload_unit(&self, unit: &str) -> Result<CmdResult> {
        let url = format!("{}/dev/service/{}/reload", self.base, unit);
        let r = self.with_auth(self.http.post(&url))
            .send().await?;
        Ok(r.json().await?)
    }

    pub async fn reload_compose(&self, svc: &str) -> Result<CmdResult> {
        let url = format!("{}/dev/compose/{}/reload", self.base, svc);
        let r = self.with_auth(self.http.post(&url))
            .send().await?;
        Ok(r.json().await?)
    }

    pub async fn compose_logs(&self, svc: &str, tail: u32) -> Result<CmdResult> {
        let url = format!("{}/dev/compose/{}/logs", self.base, svc);
        let r = self.with_auth(self.http.post(&url))
            .json(&serde_json::json!({ "tail": tail }))
            .send().await?;
        Ok(r.json().await?)
    }

    pub async fn service_logs(&self, unit: &str, tail: u32) -> Result<CmdResult> {
        let url = format!("{}/dev/service/{}/logs", self.base, unit);
        let r = self.with_auth(self.http.post(&url))
            .json(&serde_json::json!({ "tail": tail }))
            .send().await?;
        let status = r.status();
        let body_text = r.text().await.unwrap_or_default();
        // Bridge may return empty body on timeout or restart — return a
        // best-effort result instead of failing JSON parse.
        if body_text.trim().is_empty() {
            return Ok(CmdResult {
                ok: status.is_success(),
                code: status.as_u16() as i32,
                stdout: String::new(),
                stderr: format!("empty response from bridge (HTTP {})", status.as_u16()),
            });
        }
        serde_json::from_str(&body_text)
            .with_context(|| format!("parse service_logs response: {}", &body_text[..body_text.len().min(200)]))
    }

    /// Aggregated live service status from the bridge (which proxies it
    /// from `iora-core` heartbeats). Returns the raw JSON document so we
    /// don't have to redefine every field on the daemon side.
    pub async fn services(&self) -> Result<serde_json::Value> {
        let url = format!("{}/dev/services", self.base);
        let r = self.with_auth(self.http.get(&url))
            .send().await?;
        if !r.status().is_success() {
            return Err(anyhow!("services {} from {url}", r.status()));
        }
        Ok(r.json().await?)
    }

    pub async fn system_info(&self) -> Result<serde_json::Value> {
        let url = format!("{}/dev/system/info", self.base);
        let r = self.with_auth(self.http.get(&url))
            .send().await?;
        if !r.status().is_success() {
            return Err(anyhow!("system/info {} from {url}", r.status()));
        }
        Ok(r.json().await?)
    }

    pub async fn system_reboot(&self) -> Result<serde_json::Value> {
        let url = format!("{}/dev/system/reboot", self.base);
        let r = self.with_auth(self.http.post(&url))
            .send().await?;
        if !r.status().is_success() {
            return Err(anyhow!("system/reboot {} from {url}", r.status()));
        }
        Ok(r.json().await?)
    }

    /// URL the VS Code extension uses for its EventSource connection
    /// (live service log streaming). The daemon hands this to the IDE
    /// instead of proxying SSE itself — streaming through axum's
    /// `WebSocket` is fine but proxying SSE end-to-end with backpressure
    /// is tricky and there's no privacy benefit when both endpoints are
    /// already on the same trust boundary (developer LAN).
    pub fn service_logs_stream_url(&self, unit: &str) -> String {
        format!(
            "{}/dev/service/{}/logs/stream?token={}",
            self.base,
            unit,
            urlencoding::encode(&self.token),
        )
    }

    pub fn base(&self) -> &str { &self.base }
    pub fn token(&self) -> &str { &self.token }

    /// Authenticate with IORA dashboard credentials (username/password).
    /// Returns a session token that can be used for subsequent API calls.
    /// Requires iora-dev-bridge v0.2+ with /dev/auth endpoint.
    pub async fn dev_auth(&self, username: &str, password: &str) -> Result<serde_json::Value> {
        let url = format!("{}/dev/auth", self.base);
        let r = self.http.post(&url)
            .json(&serde_json::json!({"username": username, "password": password}))
            .send().await
            .with_context(|| format!("POST {url}"))?;
        if !r.status().is_success() {
            let status = r.status();
            let body = r.text().await.unwrap_or_default();
            return Err(anyhow!("Auth failed ({}): {}", status, body));
        }
        Ok(r.json().await?)
    }

    pub async fn fs_list(&self, path: &str) -> Result<FsListResult> {
        let url = format!("{}/dev/fs/list", self.base);
        let r = self.with_auth(self.http.post(&url))
            .json(&serde_json::json!({ "path": path }))
            .send().await?;
        Ok(r.json().await?)
    }

    pub async fn fs_read(&self, path: &str, max_bytes: usize) -> Result<FsReadResult> {
        let url = format!("{}/dev/fs/read", self.base);
        let r = self.with_auth(self.http.post(&url))
            .json(&serde_json::json!({ "path": path, "max_bytes": max_bytes }))
            .send().await?;
        Ok(r.json().await?)
    }

    pub async fn replace_binary(
        &self,
        local: &Path,
        target: &str,
        unit: Option<&str>,
    ) -> Result<serde_json::Value> {
        let bytes = tokio::fs::read(local).await
            .with_context(|| format!("read {}", local.display()))?;
        let sha = hex::encode(Sha256::digest(&bytes));

        let file_part = multipart::Part::bytes(bytes)
            .file_name(local.file_name().map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| "binary".into()))
            .mime_str("application/octet-stream")?;

        let mut form = multipart::Form::new()
            .text("target", target.to_string())
            .text("sha256", sha)
            .part("file", file_part);
        if let Some(u) = unit {
            form = form.text("unit", u.to_string());
        }

        let url = format!("{}/dev/replace-binary", self.base);
        let r = self.with_auth(self.http.post(&url))
            .multipart(form)
            .send().await?;
        let status = r.status();
        let body: serde_json::Value = r.json().await
            .unwrap_or_else(|_| serde_json::json!({ "error": "non-JSON response" }));
        if !status.is_success() {
            return Err(anyhow!("replace-binary failed ({status}): {body}"));
        }
        Ok(body)
    }

    pub async fn build_replace_remote(
        &self,
        component: &str,
        target: &str,
        unit: Option<&str>,
    ) -> Result<serde_json::Value> {
        let status = self.status().await.context("contacting device /dev/status before device build")?;
        if !status.capabilities.iter().any(|capability| capability == "binary.build_replace") {
            return Err(anyhow!(
                "device bridge at {} does not support remote builds yet; missing capability `binary.build_replace`. Update iora-dev-bridge on the device first",
                self.base,
            ));
        }

        let archive = create_backend_bundle()
            .with_context(|| format!("bundle backend workspace for {component}"))?;
        let bytes = tokio::fs::read(archive.path()).await
            .with_context(|| format!("read {}", archive.path().display()))?;

        let file_part = multipart::Part::bytes(bytes)
            .file_name("backend.tar")
            .mime_str("application/x-tar")?;

        let mut form = multipart::Form::new()
            .text("component", component.to_string())
            .text("target", target.to_string())
            .part("bundle", file_part);
        if let Some(u) = unit {
            form = form.text("unit", u.to_string());
        }

        let url = format!("{}/dev/build-replace", self.base);
        let r = self.with_auth(self.http.post(&url))
            .timeout(Duration::from_secs(60 * 60))
            .multipart(form)
            .send().await?;
        let status = r.status();
        let body: serde_json::Value = r.json().await
            .unwrap_or_else(|_| serde_json::json!({ "error": "non-JSON response" }));
        if !status.is_success() {
            if status == reqwest::StatusCode::NOT_FOUND {
                return Err(anyhow!(
                    "device bridge at {} returned 404 for /dev/build-replace; update iora-dev-bridge on the device first",
                    self.base,
                ));
            }
            return Err(anyhow!("build-replace failed ({status}): {}", summarize_build_replace_error(&body)));
        }
        Ok(body)
    }
}

fn summarize_build_replace_error(body: &serde_json::Value) -> String {
    let top = body["error"].as_str().unwrap_or("device build failed");
    let detail = body["build"]["stderr"]
        .as_str()
        .or_else(|| body["bootstrap"]["stderr"].as_str())
        .or_else(|| body["extract"]["stderr"].as_str())
        .unwrap_or("")
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("")
        .trim();
    if detail.is_empty() {
        top.to_string()
    } else {
        format!("{top}: {detail}")
    }
}

/// Windows reserved filenames that cannot be used as regular files.
/// See: https://docs.microsoft.com/en-us/windows/win32/fileio/naming-a-file
#[cfg(windows)]
fn is_windows_reserved(name: &str) -> bool {
    let upper = name.to_uppercase();
    // Strip extension for comparison (NUL, NUL.txt, etc.)
    let stem = upper.split('.').next().unwrap_or(&upper);
    matches!(stem, "NUL" | "CON" | "AUX" | "PRN")
        || (stem.len() == 4 && &stem[..3] == "COM" && stem[3..].parse::<u8>().is_ok())
        || (stem.len() == 4 && &stem[..3] == "LPT" && stem[3..].parse::<u8>().is_ok())
}

#[cfg(not(windows))]
fn is_windows_reserved(_name: &str) -> bool { false }

fn create_backend_bundle() -> Result<NamedTempFile> {
    let root = build::workspace_root()?;
    let backend = root.join("backend");
    let tmp = NamedTempFile::new().context("create temp archive")?;
    let file = File::create(tmp.path()).with_context(|| format!("open {}", tmp.path().display()))?;
    let mut builder = Builder::new(file);

    builder.append_dir("backend", &backend)
        .with_context(|| format!("append backend dir {}", backend.display()))?;

    let walker = WalkDir::new(&backend).into_iter().filter_entry(|entry| {
        let name = entry.file_name().to_string_lossy();
        // Skip build artifacts, .git, and Windows reserved filenames.
        name != "target"
            && name != ".git"
            && !is_windows_reserved(&name)
    });

    for entry in walker {
        let entry = entry?;
        let path = entry.path();
        if path == backend {
            continue;
        }
        let rel = path.strip_prefix(&backend)?;
        let archive_path = Path::new("backend").join(rel);
        if entry.file_type().is_dir() {
            builder.append_dir(&archive_path, path)?;
        } else if entry.file_type().is_file() {
            builder.append_path_with_name(path, &archive_path)?;
        }
    }

    builder.finish().context("finish backend archive")?;
    Ok(tmp)
}

fn normalize_base(host: &str) -> String {
    let h = host.trim().trim_end_matches('/');
    if h.starts_with("http://") || h.starts_with("https://") {
        return h.to_string();
    }
    // Default to port 8101 (iora-dev-bridge). If the user only enters an IP
    // or hostname without a port, we assume they want the dev bridge.
    let with_port = if h.contains(':') { h.to_string() } else { format!("{h}:8101") };
    format!("http://{with_port}")
}
