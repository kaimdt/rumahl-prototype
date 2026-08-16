//! Privileged IORA Security enforcement helper.
//!
//! The helper exposes a root-owned Unix socket, accepts a closed command enum,
//! validates every argument, and invokes binaries directly without a shell.
//!
//! This service is Linux-only: it binds a root-owned Unix socket, verifies
//! peer credentials and owns host mutations. On other platforms the binary
//! exits with an explanatory error instead of attempting a partial run.

#[cfg(not(target_os = "linux"))]
fn main() -> anyhow::Result<()> {
    anyhow::bail!("iora-security-helper is a Linux-only privileged service: it must run as root on the IORA host")
}

#[cfg(target_os = "linux")]
mod linux {
    use anyhow::{bail, Context, Result};
    use serde::{Deserialize, Serialize};
    use sha2::{Digest, Sha256};
    use std::{
        os::unix::fs::{MetadataExt, OpenOptionsExt},
        path::{Component, Path, PathBuf},
        process::Stdio,
        sync::Arc,
        time::Duration,
    };
    use tokio::sync::Semaphore;
    use tokio::{
        io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWriteExt, BufReader},
        net::{UnixListener, UnixStream},
        process::Command,
    };
    use tracing::{error, info, warn};

    const SOCKET_PATH: &str = "/run/iora/security-helper.sock";
    const POLICY_PATH: &str = "/etc/iora/security/firewall.nft";
    const QUARANTINE_DIR: &str = "/var/lib/iora-security/quarantine";
    const MAX_SCAN_BYTES: u64 = 256 * 1024 * 1024;
    const MAX_CONCURRENT_SCANS: usize = 2;
    const SCAN_TIMEOUT: Duration = Duration::from_secs(120);

    #[derive(Debug, Deserialize)]
    #[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
    enum Request {
        Status,
        ApplyFirewall {
            ruleset: String,
        },
        BlockIp {
            address: String,
            timeout_seconds: u32,
        },
        IsolateContainer {
            container_id: String,
        },
        Scan {
            provider: Provider,
            path: String,
        },
        Quarantine {
            path: String,
            reason: String,
        },
        RestoreQuarantine {
            id: String,
            destination: String,
        },
        StopProcess {
            pid: u32,
        },
        StopService {
            service: String,
        },
        Lockdown {
            reason: String,
        },
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "snake_case")]
    enum Provider {
        Internal,
        Yara,
        Clamav,
    }

    #[derive(Debug, Serialize)]
    struct Response {
        ok: bool,
        message: String,
        data: serde_json::Value,
    }

    impl Response {
        fn rejected(code: &str, message: impl Into<String>) -> Self {
            Self {
                ok: false,
                message: message.into(),
                data: serde_json::json!({"reason_code":code}),
            }
        }
    }

    #[tokio::main]
    async fn main() -> Result<()> {
        tracing_subscriber::fmt()
            .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
            .init();
        tokio::fs::create_dir_all("/run/iora").await?;
        if Path::new(SOCKET_PATH).exists() {
            tokio::fs::remove_file(SOCKET_PATH).await?;
        }
        let listener = UnixListener::bind(SOCKET_PATH).context("bind security helper socket")?;
        let security_uid = account_id("/etc/passwd", "iora-security")
            .context("dedicated iora-security service account missing")?;
        let security_gid = account_id("/etc/group", "iora-security")
            .context("dedicated iora-security service group missing")?;
        let ownership_result = unsafe {
            libc::chown(
                std::ffi::CString::new(SOCKET_PATH)?.as_ptr(),
                0,
                security_gid,
            )
        };
        if ownership_result != 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        set_mode(SOCKET_PATH, 0o660)?;
        info!(socket = SOCKET_PATH, "IORA Security helper ready");
        let scan_slots = Arc::new(Semaphore::new(MAX_CONCURRENT_SCANS));
        loop {
            let (stream, _) = listener.accept().await?;
            let peer_uid = stream.peer_cred()?.uid();
            if !peer_is_authorized(peer_uid, security_uid) {
                warn!(peer_uid, "rejected unauthorized security helper peer");
                continue;
            }
            let scan_slots = scan_slots.clone();
            tokio::spawn(async move {
                if let Err(error) = handle(stream, scan_slots).await {
                    error!(%error, "security helper request failed");
                }
            });
        }
    }

    fn set_mode(path: &str, mode: u32) -> Result<()> {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode))?;
        Ok(())
    }

    async fn handle(stream: UnixStream, scan_slots: Arc<Semaphore>) -> Result<()> {
        let (read, mut write) = stream.into_split();
        let mut line = String::new();
        BufReader::new(read)
            .take(1_048_576)
            .read_line(&mut line)
            .await?;
        let response = match serde_json::from_str::<Request>(&line) {
            Ok(request) => execute(request, &scan_slots).await.unwrap_or_else(|error| {
                Response::rejected(classify_error(&error), error.to_string())
            }),
            Err(error) => Response {
                ok: false,
                message: format!("invalid request: {error}"),
                data: serde_json::Value::Null,
            },
        };
        write
            .write_all(serde_json::to_string(&response)?.as_bytes())
            .await?;
        write.write_all(b"\n").await?;
        Ok(())
    }

    async fn execute(request: Request, scan_slots: &Arc<Semaphore>) -> Result<Response> {
        match request {
            Request::Status => Ok(success(
                "ready",
                serde_json::json!({
                    "nftables_installed": available("/usr/sbin/nft").await,
                    "firewall_effective": probe("/usr/sbin/nft", &["list", "table", "inet", "iora_security"]).await,
                    "clamav": available("/usr/bin/clamscan").await,
                    "yara": available("/usr/bin/yara").await,
                    "integrity_monitor_fresh": integrity_monitor_fresh(),
                    "clamav_definitions_age_seconds": clamav_definitions_age_seconds(),
                }),
            )),
            Request::ApplyFirewall { ruleset } => apply_firewall(&ruleset).await,
            Request::BlockIp {
                address,
                timeout_seconds,
            } => {
                validate_ip(&address)?;
                let timeout = timeout_seconds.clamp(60, 86_400).to_string();
                run(
                    "/usr/sbin/nft",
                    &[
                        "add",
                        "element",
                        "inet",
                        "iora_security",
                        "blocked_v4",
                        &format!("{{ {address} timeout {timeout}s }}"),
                    ],
                )
                .await?;
                Ok(success(
                    "IP blocked",
                    serde_json::json!({"address": address, "timeout_seconds": timeout}),
                ))
            }
            Request::IsolateContainer { container_id } => {
                validate_identifier(&container_id)?;
                // Stopping is the only fail-secure isolation primitive that also
                // covers host networking, IPv6, custom bridges and attached veths.
                run("/usr/bin/docker", &["stop", "--time", "10", &container_id]).await?;
                Ok(success(
                    "container stopped and all network paths isolated",
                    serde_json::json!({"container_id": container_id}),
                ))
            }
            Request::Scan { provider, path } => {
                let permit = scan_slots
                    .clone()
                    .try_acquire_owned()
                    .map_err(|_| anyhow::anyhow!("scanner capacity exhausted"))?;
                let result =
                    tokio::time::timeout(SCAN_TIMEOUT, scan(provider, checked_scan_path(&path)?))
                        .await
                        .context("scan timed out")?;
                drop(permit);
                result
            }
            Request::Quarantine { path, reason } => {
                quarantine(checked_scan_path(&path)?, &reason).await
            }
            Request::RestoreQuarantine { id, destination } => {
                restore_quarantine(&id, &destination).await
            }
            Request::StopProcess { pid } => {
                if pid <= 1 {
                    bail!("refusing to stop protected process");
                }
                run("/bin/kill", &["-STOP", &pid.to_string()]).await?;
                Ok(success("process stopped", serde_json::json!({"pid": pid})))
            }
            Request::StopService { service } => {
                validate_service(&service)?;
                if service == "iora-security.service"
                    || service == "iora-security-helper.service"
                    || service == "iora-security-firewall.service"
                {
                    bail!("security services are protected");
                }
                run("/bin/systemctl", &["stop", &service]).await?;
                Ok(success(
                    "service stopped",
                    serde_json::json!({"service": service}),
                ))
            }
            Request::Lockdown { reason } => {
                warn!(%reason, "entering security lockdown");
                run("/usr/sbin/nft", &["-f", "/etc/iora/security/lockdown.nft"]).await?;
                Ok(success(
                    "lockdown activated",
                    serde_json::json!({"reason": reason}),
                ))
            }
        }
    }

    async fn apply_firewall(ruleset: &str) -> Result<Response> {
        if ruleset.len() > 262_144 || !ruleset.contains("table inet iora_security") {
            bail!("invalid IORA ruleset");
        }
        tokio::fs::create_dir_all("/etc/iora/security").await?;
        let candidate = format!("{POLICY_PATH}.candidate");
        tokio::fs::write(&candidate, ruleset).await?;
        run("/usr/sbin/nft", &["-c", "-f", &candidate])
            .await
            .context("nftables validation failed")?;
        let previous = tokio::fs::read(POLICY_PATH).await.ok();
        if let Err(error) = run("/usr/sbin/nft", &["-f", &candidate]).await {
            if let Some(previous) = previous {
                tokio::fs::write(POLICY_PATH, previous).await?;
                let _ = run("/usr/sbin/nft", &["-f", POLICY_PATH]).await;
            }
            bail!("firewall activation failed and was rolled back: {error}");
        }
        tokio::fs::rename(candidate, POLICY_PATH).await?;
        Ok(success(
            "firewall policy activated transactionally",
            serde_json::Value::Null,
        ))
    }

    async fn scan(provider: Provider, path: PathBuf) -> Result<Response> {
        let snapshot = secure_snapshot(&path).await?;
        let result = match provider {
            // Use clamscan for bounded on-demand jobs: clamdscan delegates archive
            // limits to daemon-wide configuration and cannot enforce them per job.
            Provider::Clamav => {
                command_scan(
                    "/usr/bin/clamscan",
                    &[
                        "--no-summary",
                        "--max-filesize=64M",
                        "--max-scansize=256M",
                        "--max-files=10000",
                        "--max-recursion=16",
                        "--max-embeddedpe=32M",
                        snapshot.to_str().unwrap(),
                    ],
                )
                .await
            }
            Provider::Yara => {
                command_scan(
                    "/usr/bin/yara",
                    &["-r", "/etc/iora/security/yara", snapshot.to_str().unwrap()],
                )
                .await
            }
            Provider::Internal => internal_scan(&snapshot).await,
        };
        let _ = tokio::fs::remove_file(snapshot).await;
        result
    }

    async fn secure_snapshot(path: &Path) -> Result<PathBuf> {
        reject_symlink_components(path)?;
        let before = std::fs::metadata(path)?;
        if !before.is_file() || before.len() > MAX_SCAN_BYTES {
            bail!("scanner accepts regular files up to 256 MiB");
        }
        let file = std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(path)?;
        let opened = file.metadata()?;
        if before.dev() != opened.dev() || before.ino() != opened.ino() {
            bail!("scan target changed while opening");
        }
        tokio::fs::create_dir_all("/run/iora/security-scans").await?;
        let snapshot = Path::new("/run/iora/security-scans").join(format!(
            "{}-{}",
            std::process::id(),
            opened.ino()
        ));
        let mut source = tokio::fs::File::from_std(file);
        let mut output = tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&snapshot)
            .await?;
        tokio::io::copy(&mut source, &mut output).await?;
        Ok(snapshot)
    }

    async fn internal_scan(path: &Path) -> Result<Response> {
        let metadata = tokio::fs::metadata(path).await?;
        if !metadata.is_file() || metadata.len() > MAX_SCAN_BYTES {
            bail!("internal scanner accepts files up to 256 MiB");
        }
        let bytes = tokio::fs::read(path).await?;
        let hash = hex::encode(Sha256::digest(&bytes));
        let text = String::from_utf8_lossy(&bytes[..bytes.len().min(131_072)]).to_ascii_lowercase();
        let indicators = [
            "curl ",
            "wget ",
            "/dev/tcp/",
            "base64 -d",
            "eval(",
            "nc -e",
            "chmod +x",
        ];
        let matches: Vec<_> = indicators
            .iter()
            .filter(|indicator| text.contains(**indicator))
            .copied()
            .collect();
        Ok(success(
            "internal scan complete",
            serde_json::json!({"sha256": hash, "heuristic_indicators": matches, "infected": !matches.is_empty()}),
        ))
    }

    async fn command_scan(binary: &str, args: &[&str]) -> Result<Response> {
        let mut child = Command::new(binary)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .context("scanner unavailable")?;
        let stdout = child.stdout.take().context("scanner stdout unavailable")?;
        let stderr = child.stderr.take().context("scanner stderr unavailable")?;
        let (stdout, stderr, status) = tokio::join!(
            capture_bounded(stdout),
            capture_bounded(stderr),
            child.wait()
        );
        let code = status?.code().unwrap_or(2);
        let stdout = stdout?;
        let stderr = stderr?;
        Ok(Response {
            ok: code <= 1,
            message: if code == 1 {
                "threat detected"
            } else if code == 0 {
                "scan clean"
            } else {
                "scanner error"
            }
            .into(),
            data: serde_json::json!({"exit_code":code,"stdout":stdout,"stderr":stderr}),
        })
    }

    async fn capture_bounded(mut reader: impl AsyncRead + Unpin) -> Result<String> {
        const CAPTURE_LIMIT: usize = 8 * 1024;
        let mut captured = Vec::with_capacity(CAPTURE_LIMIT);
        let mut buffer = [0_u8; 4096];
        loop {
            let read = reader.read(&mut buffer).await?;
            if read == 0 {
                break;
            }
            let remaining = CAPTURE_LIMIT.saturating_sub(captured.len());
            captured.extend_from_slice(&buffer[..read.min(remaining)]);
        }
        Ok(String::from_utf8_lossy(&captured).into_owned())
    }

    fn classify_error(error: &anyhow::Error) -> &'static str {
        let message = error.to_string();
        if message.contains("256 MiB") {
            "file_too_large"
        } else if message.contains("capacity exhausted") {
            "scanner_capacity_exhausted"
        } else if message.contains("timed out") {
            "scanner_timeout"
        } else if message.contains("scanner unavailable") {
            "scanner_unavailable"
        } else {
            "scan_failed"
        }
    }

    async fn quarantine(path: PathBuf, reason: &str) -> Result<Response> {
        if reason.trim().is_empty() || reason.len() > 512 {
            bail!("invalid quarantine reason");
        }
        tokio::fs::create_dir_all(QUARANTINE_DIR).await?;
        reject_symlink_components(&path)?;
        let before = std::fs::metadata(&path)?;
        if !before.is_file() {
            bail!("only regular files can be quarantined");
        }
        let hash = hex::encode(Sha256::digest(tokio::fs::read(&path).await?));
        let destination = Path::new(QUARANTINE_DIR).join(&hash);
        tokio::fs::rename(&path, &destination).await?;
        let moved = std::fs::metadata(&destination)?;
        if before.dev() != moved.dev() || before.ino() != moved.ino() {
            bail!("quarantine target changed during move");
        }
        set_mode(destination.to_str().unwrap(), 0o000)?;
        tokio::fs::write(
            destination.with_extension("json"),
            serde_json::to_vec(
                &serde_json::json!({"original_path": path, "reason": reason, "sha256": hash}),
            )?,
        )
        .await?;
        Ok(success("file quarantined", serde_json::json!({"id": hash})))
    }

    async fn restore_quarantine(id: &str, destination: &str) -> Result<Response> {
        if id.len() != 64 || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
            bail!("invalid quarantine id");
        }
        let source = Path::new(QUARANTINE_DIR).join(id);
        let destination = PathBuf::from(destination);
        let recovery = Path::new("/var/lib/iora-security/restored");
        if destination.parent() != Some(recovery) {
            bail!("restore destination must be directly inside the recovery area");
        }
        validate_identifier(
            destination
                .file_name()
                .and_then(|name| name.to_str())
                .context("invalid restore filename")?,
        )?;
        tokio::fs::create_dir_all(recovery).await?;
        reject_symlink_components(recovery)?;
        if destination.exists() {
            bail!("restore destination already exists");
        }
        tokio::fs::rename(&source, &destination).await?;
        set_mode(destination.to_str().unwrap(), 0o600)?;
        Ok(success(
            "quarantine item restored into recovery area",
            serde_json::json!({"id":id,"destination":destination}),
        ))
    }

    fn checked_scan_path(value: &str) -> Result<PathBuf> {
        let path = std::fs::canonicalize(value)?;
        let allowed = ["/opt/iora", "/var/lib/iora", "/srv/iora", "/tmp/iora-scans"];
        if !allowed.iter().any(|root| path.starts_with(root)) {
            bail!("path is outside approved scan roots");
        }
        Ok(path)
    }
    fn reject_symlink_components(path: &Path) -> Result<()> {
        let mut current = PathBuf::new();
        for component in path.components() {
            match component {
                Component::RootDir => current.push("/"),
                Component::Normal(part) => current.push(part),
                _ => bail!("relative path components are forbidden"),
            }
            if std::fs::symlink_metadata(&current)?
                .file_type()
                .is_symlink()
            {
                bail!("symlink path components are forbidden");
            }
        }
        Ok(())
    }
    fn account_id(database: &str, account: &str) -> Option<u32> {
        std::fs::read_to_string(database)
            .ok()?
            .lines()
            .find_map(|line| {
                let fields: Vec<_> = line.split(':').collect();
                (fields.first() == Some(&account))
                    .then(|| fields.get(2)?.parse().ok())
                    .flatten()
            })
    }
    fn peer_is_authorized(peer_uid: u32, security_uid: u32) -> bool {
        peer_uid == security_uid
    }
    fn validate_ip(value: &str) -> Result<()> {
        value
            .parse::<std::net::IpAddr>()
            .map(|_| ())
            .context("invalid IP address")
    }
    fn validate_identifier(value: &str) -> Result<()> {
        if value.len() >= 12
            && value.len() <= 64
            && value
                .as_bytes()
                .first()
                .is_some_and(u8::is_ascii_alphanumeric)
            && value
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.')
        {
            Ok(())
        } else {
            bail!("invalid identifier")
        }
    }
    fn validate_service(value: &str) -> Result<()> {
        validate_identifier(value)?;
        if !value.ends_with(".service") {
            bail!("service unit suffix required")
        }
        Ok(())
    }
    async fn available(binary: &str) -> bool {
        tokio::fs::metadata(binary).await.is_ok()
    }
    async fn probe(binary: &str, args: &[&str]) -> bool {
        Command::new(binary)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await
            .map(|status| status.success())
            .unwrap_or(false)
    }
    fn integrity_monitor_fresh() -> bool {
        std::fs::metadata("/run/iora/integrity-last-result")
            .and_then(|metadata| metadata.modified())
            .and_then(|modified| modified.elapsed().map_err(std::io::Error::other))
            .map(|elapsed| elapsed.as_secs() < 900)
            .unwrap_or(false)
    }
    fn clamav_definitions_age_seconds() -> Option<u64> {
        [
            "/var/lib/clamav/daily.cvd",
            "/var/lib/clamav/daily.cld",
            "/var/lib/clamav/main.cvd",
            "/var/lib/clamav/main.cld",
        ]
        .iter()
        .filter_map(|path| {
            std::fs::metadata(path)
                .ok()?
                .modified()
                .ok()?
                .elapsed()
                .ok()
                .map(|age| age.as_secs())
        })
        .min()
    }
    async fn run(binary: &str, args: &[&str]) -> Result<()> {
        let status = Command::new(binary)
            .args(args)
            .stdin(Stdio::null())
            .status()
            .await?;
        if !status.success() {
            bail!("command failed with status {status}")
        }
        Ok(())
    }
    fn success(message: &str, data: serde_json::Value) -> Response {
        Response {
            ok: true,
            message: message.into(),
            data,
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn protocol_rejects_unknown_actions_and_fields() {
            assert!(
                serde_json::from_str::<Request>(r#"{"action":"exec","binary":"/bin/sh"}"#).is_err()
            );
            assert!(serde_json::from_str::<Request>(
                r#"{"action":"stop_service","service":"x.service","command":"sh"}"#
            )
            .is_err());
        }

        #[test]
        fn identifiers_cannot_become_arguments() {
            for value in [
                "../../x.service",
                "x;sh.service",
                "x service.service",
                "--now.service",
                "iora-security.service",
            ] {
                if value == "iora-security.service" {
                    assert!(validate_service(value).is_ok());
                } else {
                    assert!(validate_service(value).is_err());
                }
            }
        }

        #[test]
        fn only_exact_service_uid_is_authorized() {
            assert!(peer_is_authorized(1000, 1000));
            assert!(!peer_is_authorized(0, 1000));
            assert!(!peer_is_authorized(1001, 1000));
        }

        #[test]
        fn symlink_components_are_rejected() {
            let root =
                std::env::temp_dir().join(format!("iora-helper-test-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&root);
            std::fs::create_dir_all(root.join("real")).unwrap();
            std::os::unix::fs::symlink(root.join("real"), root.join("link")).unwrap();
            assert!(reject_symlink_components(&root.join("link/file")).is_err());
            std::fs::remove_dir_all(root).unwrap();
        }

        #[test]
        fn scan_rejections_have_machine_readable_reason_codes() {
            assert_eq!(
                classify_error(&anyhow::anyhow!(
                    "scanner accepts regular files up to 256 MiB"
                )),
                "file_too_large"
            );
            assert_eq!(
                classify_error(&anyhow::anyhow!("scanner capacity exhausted")),
                "scanner_capacity_exhausted"
            );
            assert_eq!(
                classify_error(&anyhow::anyhow!("scan timed out")),
                "scanner_timeout"
            );
        }

        #[tokio::test]
        async fn scanner_output_capture_is_bounded_while_draining_input() {
            let payload = vec![b'x'; 64 * 1024];
            let captured = capture_bounded(std::io::Cursor::new(payload))
                .await
                .unwrap();
            assert_eq!(captured.len(), 8 * 1024);
        }
    }
}
