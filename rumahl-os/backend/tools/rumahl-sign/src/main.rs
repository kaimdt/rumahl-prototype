// rumahl-sign — build-host helper.  This does NOT ship on the device.
//
// Subcommands:
//   rumahl-sign keygen  --out-dir keys/                Generate key pair
//   rumahl-sign manifest --root <TARGET_DIR>          \
//                      --key keys/rumahl-release.key  \
//                      --out <TARGET_DIR>/etc/ora/manifest.json
//   rumahl-sign file    --key keys/rumahl-release.key --in <path>
//
// The manifest format matches what rumahl-verify consumes.

use anyhow::{bail, Context, Result};
use clap::{Parser, Subcommand};
use ed25519_dalek::{Signer, SigningKey, VerifyingKey};
use rand_core::OsRng;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[derive(Parser)]
#[command(name = "rumahl-sign")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Generate a new Ed25519 key pair (hex-encoded).
    Keygen {
        #[arg(long, default_value = "keys")]
        out_dir: PathBuf,
        #[arg(long, default_value = "rumahl-release")]
        name: String,
    },
    /// Build a signed manifest of protected files.
    Manifest {
        /// Filesystem root that will become the image (Buildroot TARGET_DIR).
        #[arg(long)]
        root: PathBuf,
        /// Private key file (hex-encoded 32 bytes).
        #[arg(long)]
        key: PathBuf,
        /// Output manifest JSON path (inside `root`).
        #[arg(long)]
        out: PathBuf,
        /// Extra top-level paths to include (relative to root), comma-sep.
        #[arg(long, default_value = "")]
        extra: String,
    },
    /// Sign a single file (emits hex signature on stdout).
    File {
        #[arg(long)]
        key: PathBuf,
        #[arg(long)]
        r#in: PathBuf,
    },
}

fn main() -> Result<()> {
    match Cli::parse().cmd {
        Cmd::Keygen { out_dir, name } => cmd_keygen(&out_dir, &name),
        Cmd::Manifest {
            root,
            key,
            out,
            extra,
        } => cmd_manifest(&root, &key, &out, &extra),
        Cmd::File { key, r#in } => cmd_file(&key, &r#in),
    }
}

fn cmd_keygen(out_dir: &Path, name: &str) -> Result<()> {
    fs::create_dir_all(out_dir)?;
    let mut csprng = OsRng;
    let sk = SigningKey::generate(&mut csprng);
    let vk: VerifyingKey = sk.verifying_key();
    let priv_path = out_dir.join(format!("{name}.key"));
    let pub_path = out_dir.join(format!("{name}.pub"));
    fs::write(&priv_path, hex::encode(sk.to_bytes()))?;
    fs::write(&pub_path, hex::encode(vk.to_bytes()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&priv_path, fs::Permissions::from_mode(0o600))?;
    }
    println!("Wrote {}", priv_path.display());
    println!("Wrote {}", pub_path.display());
    Ok(())
}

fn cmd_file(key: &Path, input: &Path) -> Result<()> {
    let sk = load_signing_key(key)?;
    let data = fs::read(input)?;
    let sig = sk.sign(&data);
    println!("{}", hex::encode(sig.to_bytes()));
    Ok(())
}

#[derive(Serialize)]
struct Manifest {
    version: String,
    created: String,
    files: Vec<ManifestEntry>,
}

#[derive(Serialize)]
struct ManifestEntry {
    path: String, // absolute path on the device, e.g. /opt/rumahl/update/…
    sha256: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    mode: Option<String>,
}

fn cmd_manifest(root: &Path, key: &Path, out: &Path, extra: &str) -> Result<()> {
    if !root.is_dir() {
        bail!("--root {} is not a directory", root.display());
    }
    // The protected surface: every file under these top-level paths will be
    // hashed and sealed into the manifest.  These are the things whose
    // tampering should brick the boot.
    let mut roots = vec![
        "opt/ora".to_string(),
        "etc/rumahl-version".to_string(),
        "etc/ora/build-info.json".to_string(),
        "etc/ora/rumahl-release.pub".to_string(),
        "etc/systemd/system/rumahl-stack.service".to_string(),
        "etc/systemd/system/rumahl-stack-watchdog.service".to_string(),
        "etc/systemd/system/rumahl-update-check.service".to_string(),
        "etc/systemd/system/rumahl-update-check.timer".to_string(),
        "etc/systemd/system/rumahl-verify.service".to_string(),
        "etc/systemd/system/rumahl-tamper.target".to_string(),
        "etc/systemd/system/rumahl-tamper-screen.service".to_string(),
        "etc/rauc/system.conf".to_string(),
        "usr/bin/rumahl-verify".to_string(),
        "usr/bin/rumahl-updater".to_string(),
    ];
    for s in extra.split(',').map(str::trim).filter(|s| !s.is_empty()) {
        roots.push(s.trim_start_matches('/').to_string());
    }

    let mut entries: Vec<ManifestEntry> = Vec::new();
    for rel in &roots {
        let abs = root.join(rel);
        if !abs.exists() {
            eprintln!("[rumahl-sign] skip missing: /{rel}");
            continue;
        }
        if abs.is_file() {
            push_entry(&mut entries, root, &abs)?;
        } else {
            for ent in WalkDir::new(&abs).follow_links(false) {
                let ent = ent.context("walking manifest root")?;
                if ent.file_type().is_file() {
                    push_entry(&mut entries, root, ent.path())?;
                }
            }
        }
    }
    entries.sort_by(|a, b| a.path.cmp(&b.path));

    let manifest = Manifest {
        version: env_or("RUMAHL_VERSION", "dev"),
        created: env_or(
            "SOURCE_DATE_EPOCH",
            &std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs().to_string())
                .unwrap_or_else(|_| "0".into()),
        ),
        files: entries,
    };

    // Canonicalise the JSON so signature is stable.
    let bytes = serde_json::to_vec_pretty(&manifest)?;
    if let Some(parent) = out.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(out, &bytes)?;

    // Sign.
    let sk = load_signing_key(key)?;
    let sig = sk.sign(&bytes);
    let sig_path = with_extra_ext(out, "sig");
    fs::write(&sig_path, hex::encode(sig.to_bytes()))?;
    println!(
        "manifest: {}\nsignature: {}\nentries: {}",
        out.display(),
        sig_path.display(),
        manifest.files.len()
    );
    Ok(())
}

fn push_entry(entries: &mut Vec<ManifestEntry>, root: &Path, abs: &Path) -> Result<()> {
    let rel = abs.strip_prefix(root).unwrap();
    let mut path_on_device = String::from("/");
    path_on_device.push_str(&rel.to_string_lossy());
    let hash = sha256_file(abs)?;
    let mode = {
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            Some(format!("{:o}", fs::metadata(abs)?.mode() & 0o7777))
        }
        #[cfg(not(unix))]
        {
            None
        }
    };
    entries.push(ManifestEntry {
        path: path_on_device,
        sha256: hash,
        mode,
    });
    Ok(())
}

fn load_signing_key(path: &Path) -> Result<SigningKey> {
    let raw = fs::read(path)?;
    let bytes: [u8; 32] = if raw.len() == 32 {
        raw.as_slice().try_into().unwrap()
    } else {
        hex::decode(std::str::from_utf8(&raw)?.trim())
            .context("private key not valid hex")?
            .as_slice()
            .try_into()
            .map_err(|_| anyhow::anyhow!("private key wrong length"))?
    };
    Ok(SigningKey::from_bytes(&bytes))
}

fn sha256_file(path: &Path) -> Result<String> {
    let mut f = fs::File::open(path)?;
    let mut h = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(hex::encode(h.finalize()))
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn with_extra_ext(p: &Path, ext: &str) -> PathBuf {
    let mut s = p.as_os_str().to_os_string();
    s.push(".");
    s.push(ext);
    PathBuf::from(s)
}
