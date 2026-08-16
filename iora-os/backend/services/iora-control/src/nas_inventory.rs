//! Read-only filesystem pool and NAS share inventory.

use axum::{extract::Extension, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashMap, path::Path};
use tokio::process::Command;

#[derive(Debug, Serialize, PartialEq)]
pub struct NasShare {
    pub protocol: String,
    pub name: String,
    pub path: String,
    pub read_only: bool,
    pub guest_access: bool,
    pub clients: Vec<String>,
    pub valid_users: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct StoragePool {
    pub backend: String,
    pub name: String,
    pub health: String,
    pub size_bytes: Option<u64>,
    pub allocated_bytes: Option<u64>,
    pub free_bytes: Option<u64>,
    pub mount_points: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case")]
pub enum NasPlanRequest {
    CreateVolume {
        backend: String,
        pool: String,
        name: String,
        quota_bytes: Option<u64>,
    },
    CreateShare {
        protocol: String,
        name: String,
        path: String,
        read_only: bool,
        guest_access: bool,
        principals: Vec<String>,
    },
}

#[derive(Debug, Serialize, PartialEq)]
pub struct PlannedCommand {
    pub program: String,
    pub arguments: Vec<String>,
    pub purpose: String,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct NasOperationPlan {
    pub operation: String,
    pub resource: String,
    pub summary: String,
    pub warnings: Vec<String>,
    pub commands: Vec<PlannedCommand>,
    pub confirmation_phrase: String,
    pub executable: bool,
}

#[derive(Debug, Deserialize)]
pub struct NasExecuteRequest {
    pub request: NasPlanRequest,
    pub confirmation: String,
}

#[derive(Debug, Serialize)]
pub struct NasExecutionResult {
    pub operation: String,
    pub resource: String,
    pub completed_at: String,
    pub commands_completed: usize,
}

pub async fn inventory() -> Json<Value> {
    let mounts = command_json(
        "findmnt",
        &[
            "--json",
            "--bytes",
            "--output",
            "SOURCE,TARGET,FSTYPE,OPTIONS,SIZE,USED,AVAIL,USE%",
        ],
    )
    .await
    .unwrap_or_else(|_| json!({ "filesystems": [] }));
    let mut pools = Vec::new();
    pools.extend(btrfs_pools(&mounts));
    pools.extend(zfs_pools().await);
    let smb_text = read_first(&["/etc/samba/smb.conf", "/etc/smb.conf"]).await;
    let nfs_text = tokio::fs::read_to_string("/etc/exports").await.ok();
    let mut shares = smb_text
        .as_deref()
        .map(parse_smb_shares)
        .unwrap_or_default();
    shares.extend(
        nfs_text
            .as_deref()
            .map(parse_nfs_exports)
            .unwrap_or_default(),
    );

    Json(json!({
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "read_only": true,
        "mounts": mounts.get("filesystems").cloned().unwrap_or_else(|| json!([])),
        "pools": pools,
        "shares": shares,
        "capabilities": {
            "btrfs": command_exists("btrfs").await,
            "zfs": command_exists("zpool").await,
            "smb": command_exists("smbd").await || Path::new("/etc/samba/smb.conf").exists(),
            "nfs": command_exists("exportfs").await || Path::new("/etc/exports").exists(),
        }
    }))
}

pub async fn plan(
    Json(request): Json<NasPlanRequest>,
) -> Result<Json<NasOperationPlan>, (StatusCode, Json<Value>)> {
    let plan = build_plan(request)?;
    Ok(Json(plan))
}

pub async fn execute(
    Extension(claims): Extension<crate::auth::Claims>,
    Json(request): Json<NasExecuteRequest>,
) -> Result<Json<NasExecutionResult>, (StatusCode, Json<Value>)> {
    require_fresh_admin(&claims)?;
    let plan = build_plan(request.request)?;
    if request.confirmation != plan.confirmation_phrase {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "The typed confirmation does not match the operation plan".into(),
        ));
    }
    for command in &plan.commands {
        if !command_exists(&command.program).await {
            return Err(api_error(
                StatusCode::NOT_IMPLEMENTED,
                format!(
                    "Required storage tool '{}' is not installed",
                    command.program
                ),
            ));
        }
    }
    for (index, command) in plan.commands.iter().enumerate() {
        if let Err(error) = execute_command(command).await {
            if index > 0 && plan.operation == "create_volume" {
                rollback_created_volume(&plan).await;
            }
            return Err(error);
        }
    }
    tracing::warn!(
        user_id = %claims.sub,
        username = %claims.username,
        operation = %plan.operation,
        resource = %plan.resource,
        commands = plan.commands.len(),
        "Storage write operation completed"
    );
    Ok(Json(NasExecutionResult {
        operation: plan.operation,
        resource: plan.resource,
        completed_at: chrono::Utc::now().to_rfc3339(),
        commands_completed: plan.commands.len(),
    }))
}

fn require_fresh_admin(claims: &crate::auth::Claims) -> Result<(), (StatusCode, Json<Value>)> {
    const FRESH_AUTH_SECONDS: i64 = 300;
    if !claims.is_admin {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "Administrator access is required".into(),
        ));
    }
    let now = chrono::Utc::now().timestamp();
    let age = now.saturating_sub(claims.iat as i64);
    if claims.iat == 0 || age > FRESH_AUTH_SECONDS {
        return Err(api_error(
            StatusCode::UNAUTHORIZED,
            "Fresh administrator authorization is required; sign in again before executing this operation".into(),
        ));
    }
    Ok(())
}

async fn execute_command(command: &PlannedCommand) -> Result<(), (StatusCode, Json<Value>)> {
    let output = Command::new(&command.program)
        .args(&command.arguments)
        .output()
        .await
        .map_err(|error| {
            api_error(
                StatusCode::BAD_GATEWAY,
                format!("Could not start storage command: {error}"),
            )
        })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(api_error(
            StatusCode::CONFLICT,
            format!(
                "Storage command failed with {}: {}",
                output.status,
                stderr.trim().chars().take(500).collect::<String>()
            ),
        ));
    }
    Ok(())
}

async fn rollback_created_volume(plan: &NasOperationPlan) {
    let rollback = match plan
        .commands
        .first()
        .map(|command| command.program.as_str())
    {
        Some("btrfs") => {
            Command::new("btrfs")
                .args(["subvolume", "delete", &plan.resource])
                .output()
                .await
        }
        Some("zfs") => {
            Command::new("zfs")
                .args(["destroy", &plan.resource])
                .output()
                .await
        }
        _ => return,
    };
    match rollback {
        Ok(output) if output.status.success() => tracing::warn!(
            resource = %plan.resource,
            "Rolled back partially completed storage volume operation"
        ),
        Ok(output) => tracing::error!(
            resource = %plan.resource,
            status = %output.status,
            "Failed to roll back partially completed storage volume operation"
        ),
        Err(error) => tracing::error!(
            resource = %plan.resource,
            %error,
            "Could not start storage volume rollback"
        ),
    }
}

fn build_plan(request: NasPlanRequest) -> Result<NasOperationPlan, (StatusCode, Json<Value>)> {
    match request {
        NasPlanRequest::CreateVolume {
            backend,
            pool,
            name,
            quota_bytes,
        } => {
            let backend = backend.trim().to_ascii_lowercase();
            let name = validate_resource_name(&name, "volume")?;
            let (resource, mut commands) = match backend.as_str() {
                "btrfs" => {
                    let mount = validate_managed_path(&pool)?;
                    let resource = format!("{mount}/{name}");
                    let mut commands = vec![PlannedCommand {
                        program: "btrfs".into(),
                        arguments: vec!["subvolume".into(), "create".into(), resource.clone()],
                        purpose: "Create the Btrfs subvolume".into(),
                    }];
                    if let Some(bytes) = quota_bytes {
                        commands.push(PlannedCommand {
                            program: "btrfs".into(),
                            arguments: vec![
                                "qgroup".into(),
                                "limit".into(),
                                bytes.to_string(),
                                resource.clone(),
                            ],
                            purpose: "Apply the requested Btrfs quota".into(),
                        });
                    }
                    (resource, commands)
                }
                "zfs" => {
                    let pool = validate_resource_name(&pool, "pool")?;
                    let resource = format!("{pool}/{name}");
                    let mut arguments = vec!["create".into()];
                    if let Some(bytes) = quota_bytes {
                        arguments.extend(["-o".into(), format!("quota={bytes}")]);
                    }
                    arguments.push(resource.clone());
                    (
                        resource,
                        vec![PlannedCommand {
                            program: "zfs".into(),
                            arguments,
                            purpose: "Create the ZFS dataset".into(),
                        }],
                    )
                }
                _ => {
                    return Err(api_error(
                        StatusCode::BAD_REQUEST,
                        "Only Btrfs and ZFS volume plans are supported".into(),
                    ))
                }
            };
            if quota_bytes == Some(0) {
                return Err(api_error(
                    StatusCode::BAD_REQUEST,
                    "Quota must be greater than zero".into(),
                ));
            }
            Ok(NasOperationPlan {
                operation: "create_volume".into(),
                resource: resource.clone(),
                summary: format!("Create {backend} volume {resource}"),
                warnings: vec![
                    "Confirm that the selected pool is healthy before creating the volume.".into(),
                    "A local snapshot is not a backup; configure an external backup separately."
                        .into(),
                ],
                commands: std::mem::take(&mut commands),
                confirmation_phrase: format!("CREATE VOLUME {name}"),
                executable: false,
            })
        }
        NasPlanRequest::CreateShare {
            protocol,
            name,
            path,
            read_only,
            guest_access,
            principals,
        } => {
            let protocol = protocol.trim().to_ascii_lowercase();
            let name = validate_resource_name(&name, "share")?;
            let path = validate_managed_path(&path)?;
            let principals = principals
                .into_iter()
                .map(|value| validate_principal(&value))
                .collect::<Result<Vec<_>, _>>()?;
            if guest_access && !read_only {
                return Err(api_error(
                    StatusCode::CONFLICT,
                    "Writable guest shares are not permitted".into(),
                ));
            }
            let commands = match protocol.as_str() {
                "smb" => vec![PlannedCommand {
                    program: "iora-storage-share".into(),
                    arguments: vec![
                        "apply-smb".into(),
                        "--name".into(),
                        name.clone(),
                        "--path".into(),
                        path.clone(),
                        "--mode".into(),
                        if read_only { "ro" } else { "rw" }.into(),
                        "--guest".into(),
                        if guest_access { "yes" } else { "no" }.into(),
                        "--principals".into(),
                        principals.join(","),
                    ],
                    purpose: "Atomically render and validate the managed Samba configuration"
                        .into(),
                }],
                "nfs" => vec![PlannedCommand {
                    program: "iora-storage-share".into(),
                    arguments: vec![
                        "apply-nfs".into(),
                        "--name".into(),
                        name.clone(),
                        "--path".into(),
                        path.clone(),
                        "--mode".into(),
                        if read_only { "ro" } else { "rw" }.into(),
                        "--clients".into(),
                        principals.join(","),
                    ],
                    purpose: "Atomically render and validate the managed NFS export".into(),
                }],
                _ => {
                    return Err(api_error(
                        StatusCode::BAD_REQUEST,
                        "Only SMB and NFS share plans are supported".into(),
                    ))
                }
            };
            Ok(NasOperationPlan {
                operation: "create_share".into(),
                resource: name.clone(),
                summary: format!("Create {protocol} share {name} for {path}"),
                warnings: vec![
                    "The target path must remain inside an ORA-managed storage volume.".into(),
                    "Access is denied by default unless an authorized principal or read-only guest access is configured.".into(),
                    "Share credentials must be resolved from the secrets vault during future execution.".into(),
                ],
                commands,
                confirmation_phrase: format!("CREATE SHARE {name}"),
                executable: false,
            })
        }
    }
}

fn validate_resource_name(value: &str, kind: &str) -> Result<String, (StatusCode, Json<Value>)> {
    let value = value.trim();
    if !value.is_empty()
        && value.len() <= 64
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        Ok(value.into())
    } else {
        Err(api_error(
            StatusCode::BAD_REQUEST,
            format!("Invalid {kind} name"),
        ))
    }
}

fn validate_absolute_path(value: &str) -> Result<String, (StatusCode, Json<Value>)> {
    let value = value.trim();
    let path = Path::new(value);
    if path.is_absolute()
        && !value.contains("..")
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "/_- .".contains(character))
    {
        Ok(value.trim_end_matches('/').into())
    } else {
        Err(api_error(
            StatusCode::BAD_REQUEST,
            "Invalid absolute storage path".into(),
        ))
    }
}

fn validate_managed_path(value: &str) -> Result<String, (StatusCode, Json<Value>)> {
    let value = validate_absolute_path(value)?;
    let configured =
        std::env::var("IORA_STORAGE_ROOTS").unwrap_or_else(|_| "/srv/iora:/mnt/iora".into());
    if configured
        .split(':')
        .filter(|root| !root.is_empty())
        .any(|root| Path::new(&value).starts_with(root))
    {
        Ok(value)
    } else {
        Err(api_error(
            StatusCode::FORBIDDEN,
            "Storage path is outside the configured ORA-managed roots".into(),
        ))
    }
}

fn validate_principal(value: &str) -> Result<String, (StatusCode, Json<Value>)> {
    let value = value.trim();
    if !value.is_empty()
        && value.len() <= 128
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "@._:/-*".contains(character))
    {
        Ok(value.into())
    } else {
        Err(api_error(
            StatusCode::BAD_REQUEST,
            "Invalid share principal or client".into(),
        ))
    }
}

fn api_error(status: StatusCode, message: String) -> (StatusCode, Json<Value>) {
    (status, Json(json!({ "error": message })))
}

fn btrfs_pools(mounts: &Value) -> Vec<StoragePool> {
    mounts
        .get("filesystems")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|entry| entry.get("fstype").and_then(Value::as_str) == Some("btrfs"))
        .map(|entry| StoragePool {
            backend: "btrfs".into(),
            name: entry
                .get("source")
                .and_then(Value::as_str)
                .unwrap_or("btrfs")
                .into(),
            health: "mounted".into(),
            size_bytes: number(entry.get("size")),
            allocated_bytes: number(entry.get("used")),
            free_bytes: number(entry.get("avail")),
            mount_points: entry
                .get("target")
                .and_then(Value::as_str)
                .map(|value| vec![value.into()])
                .unwrap_or_default(),
        })
        .collect()
}

async fn zfs_pools() -> Vec<StoragePool> {
    let Ok(output) = Command::new("zpool")
        .args(["list", "-H", "-p", "-o", "name,size,alloc,free,health"])
        .output()
        .await
    else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let fields: Vec<&str> = line.split_whitespace().collect();
            (fields.len() >= 5).then(|| StoragePool {
                backend: "zfs".into(),
                name: fields[0].into(),
                size_bytes: fields[1].parse().ok(),
                allocated_bytes: fields[2].parse().ok(),
                free_bytes: fields[3].parse().ok(),
                health: fields[4].to_ascii_lowercase(),
                mount_points: Vec::new(),
            })
        })
        .collect()
}

fn number(value: Option<&Value>) -> Option<u64> {
    value.and_then(|value| value.as_u64().or_else(|| value.as_str()?.parse().ok()))
}

pub fn parse_smb_shares(input: &str) -> Vec<NasShare> {
    let mut sections: HashMap<String, HashMap<String, String>> = HashMap::new();
    let mut current: Option<String> = None;
    for raw in input.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with(['#', ';']) {
            continue;
        }
        if line.starts_with('[') && line.ends_with(']') {
            current = Some(line[1..line.len() - 1].trim().to_string());
            continue;
        }
        if let (Some(name), Some((key, value))) = (current.as_ref(), line.split_once('=')) {
            sections
                .entry(name.clone())
                .or_default()
                .insert(key.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }
    sections
        .into_iter()
        .filter(|(name, values)| {
            !name.eq_ignore_ascii_case("global") && values.contains_key("path")
        })
        .map(|(name, values)| {
            let yes = |key: &str| {
                values.get(key).is_some_and(|value| {
                    matches!(value.to_ascii_lowercase().as_str(), "yes" | "true" | "1")
                })
            };
            NasShare {
                protocol: "smb".into(),
                name,
                path: values.get("path").cloned().unwrap_or_default(),
                read_only: !yes("writable")
                    && !yes("writeable")
                    && values.get("read only").is_none_or(|value| {
                        !matches!(value.to_ascii_lowercase().as_str(), "no" | "false" | "0")
                    }),
                guest_access: yes("guest ok") || yes("public"),
                clients: Vec::new(),
                valid_users: split_list(values.get("valid users")),
            }
        })
        .collect()
}

pub fn parse_nfs_exports(input: &str) -> Vec<NasShare> {
    input
        .lines()
        .filter_map(|raw| {
            let line = raw.split('#').next()?.trim();
            if line.is_empty() {
                return None;
            }
            let mut fields = line.split_whitespace();
            let path = fields.next()?.to_string();
            let clients: Vec<String> = fields.map(str::to_string).collect();
            let read_only = !clients.iter().any(|client| {
                client.split_once('(').is_some_and(|(_, options)| {
                    options
                        .trim_end_matches(')')
                        .split(',')
                        .any(|option| option == "rw")
                })
            });
            Some(NasShare {
                protocol: "nfs".into(),
                name: Path::new(&path)
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or(&path)
                    .into(),
                path,
                read_only,
                guest_access: clients.iter().any(|client| client.starts_with("*(")),
                clients,
                valid_users: Vec::new(),
            })
        })
        .collect()
}

fn split_list(value: Option<&String>) -> Vec<String> {
    value
        .map(|value| {
            value
                .split([',', ' '])
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}
async fn read_first(paths: &[&str]) -> Option<String> {
    for path in paths {
        if let Ok(value) = tokio::fs::read_to_string(path).await {
            return Some(value);
        }
    }
    None
}
async fn command_exists(name: &str) -> bool {
    Command::new("sh")
        .args(["-c", &format!("command -v {name} >/dev/null 2>&1")])
        .status()
        .await
        .is_ok_and(|status| status.success())
}
async fn command_json(program: &str, args: &[&str]) -> Result<Value, String> {
    let output = Command::new(program)
        .args(args)
        .output()
        .await
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(format!("{program} exited with {}", output.status));
    }
    serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_smb_security_settings() {
        let shares = parse_smb_shares("[global]\n workgroup = WORKGROUP\n[family]\n path = /srv/family\n read only = no\n guest ok = no\n valid users = @family, alice\n[public]\n path=/srv/public\n public=yes\n");
        assert_eq!(shares.len(), 2);
        let family = shares.iter().find(|share| share.name == "family").unwrap();
        assert!(!family.read_only);
        assert!(!family.guest_access);
        assert_eq!(family.valid_users, vec!["@family", "alice"]);
    }

    #[test]
    fn parses_nfs_access_modes() {
        let shares = parse_nfs_exports(
            "/srv/media 192.168.1.0/24(ro,sync)\n/srv/family 192.168.1.0/24(rw,sync)\n",
        );
        assert!(shares[0].read_only);
        assert!(!shares[1].read_only);
    }

    #[test]
    fn creates_non_executable_volume_plan() {
        let plan = build_plan(NasPlanRequest::CreateVolume {
            backend: "btrfs".into(),
            pool: "/srv/iora/storage".into(),
            name: "family".into(),
            quota_bytes: Some(1_000_000),
        })
        .unwrap();
        assert_eq!(plan.resource, "/srv/iora/storage/family");
        assert_eq!(plan.commands.len(), 2);
        assert!(!plan.executable);
    }

    #[test]
    fn rejects_writable_guest_share_and_unsafe_names() {
        let plan = build_plan(NasPlanRequest::CreateShare {
            protocol: "smb".into(),
            name: "public".into(),
            path: "/srv/iora/public".into(),
            read_only: false,
            guest_access: true,
            principals: Vec::new(),
        });
        assert!(plan.is_err());
        assert!(validate_resource_name("family;reboot", "share").is_err());
        assert!(validate_absolute_path("../../etc").is_err());
    }

    #[test]
    fn requires_recent_admin_authorization() {
        let now = chrono::Utc::now().timestamp() as usize;
        let claims = crate::auth::Claims {
            sub: "admin-id".into(),
            username: "admin".into(),
            role: String::new(),
            is_admin: true,
            exp: now + 3600,
            iat: now,
        };
        assert!(require_fresh_admin(&claims).is_ok());
        assert!(require_fresh_admin(&crate::auth::Claims {
            iat: now - 301,
            ..claims.clone()
        })
        .is_err());
        assert!(require_fresh_admin(&crate::auth::Claims {
            is_admin: false,
            ..claims
        })
        .is_err());
    }
}
