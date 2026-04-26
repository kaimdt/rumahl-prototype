// iora-updater — replaces the old /opt/iora/update/check-update.sh.
//
// Responsibilities:
//   * Ask update.kaimdt.com whether an update is available.
//   * Download the RAUC bundle to a tmp path.
//   * Verify the bundle's SHA-256 against what the update server advertised.
//   * (Optional) verify an Ed25519 signature of the bundle against the
//     IORA release public key stored under /etc/iora/iora-release.pub.
//   * Install via `rauc install`.
//   * Report success/failure back to the update server.
//
// Security notes:
//   * No shell interpolation.  We build argv explicitly.
//   * The download URL is read from the server response, but we constrain
//     the scheme to https:// and the host to *.kaimdt.com by default.  An
//     operator can override with IORA_DOWNLOAD_HOST_ALLOWLIST.
//   * Checksum verification happens on the downloaded file *before* we
//     hand anything to `rauc`.

use anyhow::{anyhow, bail, Context, Result};
use clap::Parser;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use futures_util::StreamExt;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::fs;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

const DEFAULT_UPDATE_SERVER: &str = "https://update.kaimdt.com";
const VERSION_FILE:    &str = "/etc/iora-version";
const BUILD_INFO_FILE: &str = "/etc/iora/build-info.json";
const MACHINE_ID_FILE: &str = "/etc/machine-id";
const PUBKEY_FILE:     &str = "/etc/iora/iora-release.pub";
const TMPDIR:          &str = "/tmp/iora-update";
const LOGFILE:         &str = "/var/log/iora-update.log";

#[derive(Parser, Debug)]
#[command(name = "iora-updater", about = "IORA OS update installer")]
struct Cli {
    /// Only check, do not download or install.
    #[arg(long)]
    check: bool,

    /// Release channel (stable|beta|edge).
    #[arg(long, default_value = "stable")]
    channel: String,

    /// Do not prompt, just install.  (Service mode.)
    #[arg(long)]
    yes: bool,

    /// Override the update server base URL.
    #[arg(long, env = "IORA_UPDATE_SERVER")]
    server: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CheckResponse {
    update_available: bool,
    #[serde(default)]
    latest_version: Option<String>,
    #[serde(default)]
    release: Option<ReleaseInfo>,
    #[serde(default)]
    release_notes: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ReleaseInfo {
    #[serde(default)]
    download_url: Option<String>,
    #[serde(default)]
    sha256_checksum: Option<String>,
    /// Optional hex-encoded Ed25519 signature over the raw bundle bytes.
    #[serde(default)]
    signature: Option<String>,
    #[serde(default)]
    size: Option<u64>,
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    let server = cli
        .server
        .clone()
        .unwrap_or_else(|| DEFAULT_UPDATE_SERVER.to_string());

    // Refuse to do anything on IORA OS Dev builds.  Such images have no
    // unique, server-known version, so asking the update server would
    // either 404 or — worse — overwrite the dev build with a production
    // image.
    if let Ok(buf) = tokio::fs::read_to_string(BUILD_INFO_FILE).await {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&buf) {
            if v.get("variant").and_then(|x| x.as_str()) == Some("os-dev")
                || v.get("updates_enabled").and_then(|x| x.as_bool()) == Some(false)
            {
                eprintln!(
                    "iora-updater: this is an IORA OS Dev build (variant=os-dev)."
                );
                eprintln!(
                    "Updates are disabled because the image has no unique version."
                );
                eprintln!(
                    "Rebuild with `iora-os/build.sh` (without --dev) to get a"
                );
                eprintln!("production image that can receive updates.");
                return Ok(());
            }
        }
    }

    let current_version = read_trimmed(VERSION_FILE)
        .await
        .ok()
        .and_then(|s| s.split_whitespace().last().map(str::to_string))
        .unwrap_or_else(|| "unknown".into());
    let device_id = read_trimmed(MACHINE_ID_FILE)
        .await
        .unwrap_or_else(|_| "unknown".into());

    let arch = match std::env::consts::ARCH {
        "x86_64" => "x86_64",
        "aarch64" => "aarch64",
        "arm" => "armhf",
        other => other,
    };

    log(&format!(
        "check current={current_version} channel={} arch={arch}",
        cli.channel
    ))
    .await;

    let url = format!(
        "{server}/v1/iora/os/check?version={current_version}&channel={}&arch={arch}&device_id={device_id}",
        cli.channel
    );
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()?;
    let resp_raw = client
        .get(&url)
        .send()
        .await
        .context("update server unreachable")?;

    // 404 = server simply has no record of this version/channel/arch yet.
    // Treat that as "no update available" instead of a hard error so the
    // periodic update timer doesn't spam the journal with FAILUREs and so
    // the systemd unit's Restart=on-failure doesn't loop forever.
    let status = resp_raw.status();
    if status == reqwest::StatusCode::NOT_FOUND {
        println!("Update server has no release listed for this build yet.");
        log("update server returned 404 — treating as no update available").await;
        return Ok(());
    }
    let resp: CheckResponse = resp_raw
        .error_for_status()
        .context("update server returned error status")?
        .json()
        .await
        .context("invalid JSON from update server")?;

    if !resp.update_available {
        println!("System is up to date.");
        log("no update available").await;
        return Ok(());
    }

    let latest = resp.latest_version.clone().unwrap_or_else(|| "?".into());
    let rel = resp
        .release
        .ok_or_else(|| anyhow!("server flagged update but returned no release block"))?;
    let download_url = rel
        .download_url
        .clone()
        .ok_or_else(|| anyhow!("release has no download_url"))?;
    let expected_sha = rel
        .sha256_checksum
        .clone()
        .ok_or_else(|| anyhow!("release has no sha256_checksum"))?;

    println!("Update available: {latest}");
    if let Some(size) = rel.size {
        println!("  Size: {:.1} MiB", size as f64 / 1024.0 / 1024.0);
    }
    if let Some(notes) = &resp.release_notes {
        println!();
        for line in notes.lines().take(15) {
            println!("  {line}");
        }
    }

    if cli.check {
        return Ok(());
    }

    validate_download_url(&download_url)?;

    fs::create_dir_all(TMPDIR).await.ok();
    let bundle_path =
        PathBuf::from(TMPDIR).join(format!("iora-update-{latest}.raucb"));

    if should_redownload(&bundle_path, &expected_sha).await {
        log(&format!("downloading {download_url}")).await;
        download(&client, &download_url, &bundle_path).await?;
    } else {
        log("reusing cached bundle").await;
    }

    let got_sha = sha256_file(&bundle_path).await?;
    if !ct_eq(got_sha.as_bytes(), expected_sha.as_bytes()) {
        let _ = fs::remove_file(&bundle_path).await;
        bail!("checksum mismatch: expected {expected_sha}, got {got_sha}");
    }
    log("checksum OK").await;

    if let Some(sig_hex) = rel.signature.as_deref() {
        if let Err(e) = verify_bundle_signature(&bundle_path, sig_hex).await {
            let _ = fs::remove_file(&bundle_path).await;
            bail!("bundle signature verification failed: {e:#}");
        }
        log("Ed25519 signature OK").await;
    }

    // Create pre-update backup if backup service is available
    log("checking for backup service").await;
    if let Ok(()) = create_pre_update_backup().await {
        log("pre-update backup completed").await;
    } else {
        log("pre-update backup skipped (service unavailable or disabled)").await;
    }

    log("installing via rauc").await;
    let status = Command::new("/usr/bin/rauc")
        .arg("install")
        .arg(&bundle_path)
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .await
        .context("failed to spawn rauc")?;

    let report_status = if status.success() { "completed" } else { "failed" };
    let _ = client
        .post(format!("{server}/v1/iora/os/report"))
        .json(&serde_json::json!({
            "device_id": device_id,
            "version":   latest,
            "status":    report_status,
        }))
        .send()
        .await;

    if !status.success() {
        bail!("rauc install failed (exit {:?})", status.code());
    }
    println!();
    println!("Update installed. Reboot to activate the new slot.");
    log("update installed").await;
    Ok(())
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async fn read_trimmed<P: AsRef<Path>>(p: P) -> Result<String> {
    Ok(fs::read_to_string(p).await?.trim().to_string())
}

async fn should_redownload(path: &Path, expected_sha: &str) -> bool {
    if !path.exists() {
        return true;
    }
    match sha256_file(path).await {
        Ok(h) if ct_eq(h.as_bytes(), expected_sha.as_bytes()) => false,
        _ => {
            let _ = fs::remove_file(path).await;
            true
        }
    }
}

async fn download(client: &reqwest::Client, url: &str, dest: &Path) -> Result<()> {
    let mut resp = client
        .get(url)
        .send()
        .await
        .context("download request failed")?
        .error_for_status()
        .context("download HTTP error")?;
    let mut file = fs::File::create(dest).await?;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.context("chunk read")?;
        file.write_all(&bytes).await?;
    }
    file.flush().await?;
    Ok(())
}

async fn sha256_file(path: &Path) -> Result<String> {
    use tokio::io::AsyncReadExt;
    let mut f = fs::File::open(path).await?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = f.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

async fn verify_bundle_signature(path: &Path, sig_hex: &str) -> Result<()> {
    let pub_bytes = fs::read(PUBKEY_FILE)
        .await
        .with_context(|| format!("reading release pubkey from {PUBKEY_FILE}"))?;
    let raw_pub: [u8; 32] = if pub_bytes.len() == 32 {
        pub_bytes.as_slice().try_into().unwrap()
    } else {
        hex::decode(std::str::from_utf8(&pub_bytes)?.trim())
            .context("pubkey not valid hex")?
            .as_slice()
            .try_into()
            .map_err(|_| anyhow!("pubkey wrong length"))?
    };
    let pubkey = VerifyingKey::from_bytes(&raw_pub).context("invalid pubkey bytes")?;

    let sig_raw: [u8; 64] = hex::decode(sig_hex.trim())
        .context("signature not valid hex")?
        .as_slice()
        .try_into()
        .map_err(|_| anyhow!("signature wrong length"))?;
    let sig = Signature::from_bytes(&sig_raw);

    let bytes = fs::read(path).await?;
    pubkey.verify(&bytes, &sig).context("bad signature")?;
    Ok(())
}

/// Accept only `https://…` URLs whose host ends with one of the allowed
/// suffixes.  Default allowlist is `kaimdt.com`; override with a comma-
/// separated list in IORA_DOWNLOAD_HOST_ALLOWLIST.
fn validate_download_url(url: &str) -> Result<()> {
    if !url.starts_with("https://") {
        bail!("refusing non-https download URL: {url}");
    }
    let host = url
        .trim_start_matches("https://")
        .split('/')
        .next()
        .unwrap_or("")
        .split('@')
        .last()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("");
    if host.is_empty() {
        bail!("download URL missing host");
    }
    let allow = std::env::var("IORA_DOWNLOAD_HOST_ALLOWLIST")
        .unwrap_or_else(|_| "kaimdt.com".to_string());
    let ok = allow
        .split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .any(|suffix| host == suffix || host.ends_with(&format!(".{suffix}")));
    if !ok {
        bail!("download host `{host}` not in allowlist `{allow}`");
    }
    Ok(())
}

fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut d: u8 = 0;
    for (x, y) in a.iter().zip(b.iter()) {
        d |= x ^ y;
    }
    d == 0
}

async fn log(msg: &str) {
    eprintln!("[iora-updater] {msg}");
    if let Ok(mut f) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(LOGFILE)
        .await
    {
        let _ = f.write_all(format!("{msg}\n").as_bytes()).await;
    }
}

/// Create a pre-update backup by calling the backup service
async fn create_pre_update_backup() -> Result<()> {
    // Check if backup service is available
    let backup_url = std::env::var("BACKUP_SERVICE_URL")
        .unwrap_or_else(|_| "http://iora-backup:8100".to_string());

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600)) // 10 minutes for backup
        .build()?;

    // Call the pre-update backup endpoint
    let response = client
        .post(format!("{}/api/backup/pre-update", backup_url))
        .send()
        .await?;

    if response.status().is_success() {
        let result: serde_json::Value = response.json().await?;

        // Check if backup was skipped or started
        if result.get("skipped").and_then(|v| v.as_bool()) == Some(true) {
            return Ok(()); // Backup disabled, not an error
        }

        // Wait for backup to complete (poll for status)
        if let Some(backup_id) = result.get("backup_id").and_then(|v| v.as_str()) {
            // Poll backup status for up to 10 minutes
            for _ in 0..60 {
                tokio::time::sleep(std::time::Duration::from_secs(10)).await;

                let status_response = client
                    .get(format!("{}/api/backup/{}", backup_url, backup_id))
                    .send()
                    .await?;

                if let Ok(backup) = status_response.json::<serde_json::Value>().await {
                    match backup.get("status").and_then(|v| v.as_str()) {
                        Some("completed") => return Ok(()),
                        Some("failed") => {
                            let error = backup.get("error_message")
                                .and_then(|v| v.as_str())
                                .unwrap_or("unknown error");
                            bail!("Pre-update backup failed: {}", error);
                        }
                        _ => continue, // Still creating
                    }
                }
            }

            bail!("Pre-update backup timed out");
        }

        Ok(())
    } else {
        bail!("Backup service returned error: {}", response.status());
    }
}
