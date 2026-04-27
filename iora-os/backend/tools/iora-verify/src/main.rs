// iora-verify — boot-time integrity check for IORA OS
//
// Philosophy: this is the single sharp edge we rely on.  Everything it
// touches is read-only during the check.  If the manifest signature or any
// file hash fails to match, we DO NOT continue booting: we switch to an
// offline "tamper screen" target that only allows a recovery boot.
//
// The check is intentionally simple and self-contained — no networking, no
// dynamic config, no shelling out.  The more code this binary pulls in, the
// larger its own attack surface becomes.

use anyhow::{bail, Context, Result};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

const MANIFEST_PATH:   &str = "/etc/iora/manifest.json";
const SIGNATURE_PATH:  &str = "/etc/iora/manifest.json.sig";
const PUBKEY_PATH:     &str = "/etc/iora/iora-release.pub";
const TAMPER_FLAG:     &str = "/run/iora-tamper";
const TAMPER_LOG:      &str = "/var/log/iora-tamper.log";

#[derive(Debug, Deserialize)]
struct Manifest {
    version: String,
    created: String,
    files:   Vec<ManifestEntry>,
}

#[derive(Debug, Deserialize)]
struct ManifestEntry {
    path:   String,
    sha256: String,
    // `mode` is informational only; we never try to chmod here.
    #[serde(default)]
    mode:   Option<String>,
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => {
            eprintln!("[iora-verify] integrity check passed");
            ExitCode::SUCCESS
        }
        Err(e) => {
            // Write a durable record before we pivot the boot.
            let _ = fs::write(TAMPER_FLAG, format!("{e:#}\n"));
            let _ = append_line(TAMPER_LOG, &format!("{}  {e:#}", now_rfc3339()));
            eprintln!("[iora-verify] INTEGRITY FAILURE: {e:#}");
            // Divert the boot to the tamper target.  `isolate` makes systemd
            // stop every other unit and start only `iora-tamper.target`,
            // which shows the bluescreen and blocks further boot.
            let _ = Command::new("/bin/systemctl")
                .arg("--no-block")
                .arg("isolate")
                .arg("iora-tamper.target")
                .status();
            ExitCode::from(2)
        }
    }
}

fn run() -> Result<()> {
    let pubkey = load_pubkey(PUBKEY_PATH)
        .with_context(|| format!("loading release public key from {PUBKEY_PATH}"))?;

    let manifest_bytes = fs::read(MANIFEST_PATH)
        .with_context(|| format!("reading manifest {MANIFEST_PATH}"))?;
    let sig_bytes = fs::read(SIGNATURE_PATH)
        .with_context(|| format!("reading signature {SIGNATURE_PATH}"))?;

    verify_signature(&pubkey, &manifest_bytes, &sig_bytes)
        .context("manifest signature verification")?;

    let manifest: Manifest = serde_json::from_slice(&manifest_bytes)
        .context("parsing manifest JSON")?;

    let mut failures: Vec<String> = Vec::new();
    for entry in &manifest.files {
        match verify_file(&entry.path, &entry.sha256) {
            Ok(()) => {}
            Err(e) => failures.push(format!("{}: {e}", entry.path)),
        }
    }

    if !failures.is_empty() {
        bail!(
            "{} file(s) failed integrity check (manifest {}):\n  - {}",
            failures.len(),
            manifest.version,
            failures.join("\n  - ")
        );
    }
    Ok(())
}

fn load_pubkey(path: &str) -> Result<VerifyingKey> {
    let bytes = fs::read(path)?;
    // Accept either raw 32-byte Ed25519 key or hex-encoded key.  We do NOT
    // support PEM here to keep the parser small — the build scripts always
    // write the raw key.
    let key_bytes: [u8; 32] = if bytes.len() == 32 {
        bytes.as_slice().try_into().unwrap()
    } else {
        let s = std::str::from_utf8(&bytes)
            .context("pubkey file is neither 32 bytes nor valid UTF-8")?;
        let trimmed = s.trim();
        let decoded = hex::decode(trimmed).context("pubkey file is not valid hex")?;
        decoded
            .as_slice()
            .try_into()
            .map_err(|_| anyhow::anyhow!("decoded pubkey has wrong length ({})", decoded.len()))?
    };
    VerifyingKey::from_bytes(&key_bytes).context("invalid Ed25519 public key")
}

fn verify_signature(pubkey: &VerifyingKey, msg: &[u8], sig_bytes: &[u8]) -> Result<()> {
    // Accept raw 64-byte or hex-encoded signature.
    let sig_raw: [u8; 64] = if sig_bytes.len() == 64 {
        sig_bytes.try_into().unwrap()
    } else {
        let s = std::str::from_utf8(sig_bytes)
            .context("signature is neither 64 bytes nor valid UTF-8")?;
        let decoded = hex::decode(s.trim()).context("signature is not valid hex")?;
        decoded
            .as_slice()
            .try_into()
            .map_err(|_| anyhow::anyhow!("decoded signature has wrong length ({})", decoded.len()))?
    };
    let signature = Signature::from_bytes(&sig_raw);
    pubkey.verify(msg, &signature).context("bad signature")?;
    Ok(())
}

fn verify_file(path: &str, expected_hex: &str) -> Result<()> {
    let p = PathBuf::from(path);
    if !p.exists() {
        bail!("missing");
    }
    let got = sha256_file(&p)?;
    if !constant_time_eq(got.as_bytes(), expected_hex.as_bytes()) {
        bail!("sha256 mismatch (expected {expected_hex}, got {got})");
    }
    Ok(())
}

fn sha256_file(path: &Path) -> Result<String> {
    let mut f = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

fn append_line(path: &str, line: &str) -> std::io::Result<()> {
    use std::io::Write;
    let mut f = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    writeln!(f, "{line}")
}

fn now_rfc3339() -> String {
    // Avoid pulling in chrono here; /bin/date exists in busybox.
    std::process::Command::new("/bin/date")
        .arg("-Iseconds")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "0".to_string())
}
