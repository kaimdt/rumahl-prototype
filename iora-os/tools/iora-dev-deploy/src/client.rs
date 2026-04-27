use anyhow::{anyhow, Context, Result};
use reqwest::{multipart, Client as HttpClient};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::path::Path;
use std::time::Duration;

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
        let r = self.http.post(&url)
            .header("X-IORA-Dev-Token", &self.token)
            .send().await?;
        Ok(r.json().await?)
    }

    pub async fn reload_unit(&self, unit: &str) -> Result<CmdResult> {
        let url = format!("{}/dev/service/{}/reload", self.base, unit);
        let r = self.http.post(&url)
            .header("X-IORA-Dev-Token", &self.token)
            .send().await?;
        Ok(r.json().await?)
    }

    pub async fn reload_compose(&self, svc: &str) -> Result<CmdResult> {
        let url = format!("{}/dev/compose/{}/reload", self.base, svc);
        let r = self.http.post(&url)
            .header("X-IORA-Dev-Token", &self.token)
            .send().await?;
        Ok(r.json().await?)
    }

    pub async fn compose_logs(&self, svc: &str, tail: u32) -> Result<CmdResult> {
        let url = format!("{}/dev/compose/{}/logs", self.base, svc);
        let r = self.http.post(&url)
            .header("X-IORA-Dev-Token", &self.token)
            .json(&serde_json::json!({ "tail": tail }))
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
        let r = self.http.post(&url)
            .header("X-IORA-Dev-Token", &self.token)
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
}

fn normalize_base(host: &str) -> String {
    let h = host.trim().trim_end_matches('/');
    if h.starts_with("http://") || h.starts_with("https://") {
        return h.to_string();
    }
    let with_port = if h.contains(':') { h.to_string() } else { format!("{h}:8099") };
    format!("http://{with_port}")
}
