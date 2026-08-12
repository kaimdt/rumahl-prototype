//! Read-only storage, SMART and Linux MD RAID inventory.
//!
//! This module never opens block devices for writing and never invokes mdadm
//! mutation commands. Missing optional host tools are reported as capabilities.

use axum::{http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashMap, path::Path};
use tokio::process::Command;

#[derive(Debug, Serialize)]
struct Capability {
    available: bool,
    detail: String,
}


#[derive(Debug, Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case")]
pub enum RaidPlanRequest {
    ReplaceMember { array: String, failed_member: Option<String>, replacement: String },
    Scrub { array: String },
}

#[derive(Debug, Serialize)]
pub struct PlannedCommand {
    pub program: String,
    pub arguments: Vec<String>,
    pub purpose: String,
}

#[derive(Debug, Serialize)]
pub struct RaidOperationPlan {
    pub operation: String,
    pub array: String,
    pub summary: String,
    pub warnings: Vec<String>,
    pub commands: Vec<PlannedCommand>,
    pub confirmation_phrase: String,
    pub executable: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct RaidArray {
    pub name: String,
    pub active: bool,
    pub level: String,
    pub members: Vec<String>,
    pub blocks: Option<u64>,
    pub expected_devices: Option<u32>,
    pub active_devices: Option<u32>,
    pub health: String,
    pub operation: Option<String>,
    pub progress_percent: Option<f64>,
}

pub async fn inventory() -> Json<Value> {
    let lsblk = command_json("lsblk", &["--bytes", "--json", "--output", "NAME,KNAME,PATH,TYPE,SIZE,MODEL,SERIAL,VENDOR,TRAN,ROTA,RM,RO,FSTYPE,FSVER,LABEL,UUID,MOUNTPOINTS,FSAVAIL,FSUSED,FSUSE%"])
        .await;
    let block_devices = lsblk.as_ref().ok().and_then(|value| value.get("blockdevices")).cloned().unwrap_or_else(|| json!([]));
    let physical_paths = physical_disk_paths(&block_devices);
    let smart = collect_smart(&physical_paths).await;
    let mdstat = tokio::fs::read_to_string("/proc/mdstat").await.ok();
    let arrays = mdstat.as_deref().map(parse_mdstat).unwrap_or_default();

    Json(json!({
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "read_only": true,
        "capabilities": {
            "lsblk": capability(lsblk.as_ref().err()),
            "smartctl": Capability { available: command_exists("smartctl").await, detail: "SMART/NVMe health inspection".into() },
            "mdraid": Capability { available: Path::new("/proc/mdstat").exists(), detail: "Linux MD RAID inspection".into() },
            "mdadm": Capability { available: command_exists("mdadm").await, detail: "Linux MD management tool detected; this API remains read-only".into() },
        },
        "block_devices": block_devices,
        "smart": smart,
        "raid_arrays": arrays,
    }))
}

fn capability(error: Option<&String>) -> Capability {
    Capability { available: error.is_none(), detail: error.cloned().unwrap_or_else(|| "Available".into()) }
}

async fn command_exists(name: &str) -> bool {
    Command::new("sh").args(["-c", &format!("command -v {name} >/dev/null 2>&1")]).status().await.is_ok_and(|status| status.success())
}

async fn command_json(program: &str, args: &[&str]) -> Result<Value, String> {
    let output = Command::new(program).args(args).output().await.map_err(|error| format!("{program} unavailable: {error}"))?;
    if !output.status.success() { return Err(format!("{program} exited with {}", output.status)); }
    serde_json::from_slice(&output.stdout).map_err(|error| format!("Invalid {program} output: {error}"))
}

fn physical_disk_paths(devices: &Value) -> Vec<String> {
    devices.as_array().into_iter().flatten().filter(|device| device.get("type").and_then(Value::as_str) == Some("disk"))
        .filter_map(|device| device.get("path").and_then(Value::as_str).map(str::to_string)).collect()
}

async fn collect_smart(paths: &[String]) -> HashMap<String, Value> {
    if !command_exists("smartctl").await { return HashMap::new(); }
    let futures = paths.iter().map(|path| async move {
        let output = Command::new("smartctl").args(["--json", "--health", "--attributes", path]).output().await.ok()?;
        // smartctl uses bit flags and can return non-zero while still providing valid health JSON.
        let value = serde_json::from_slice::<Value>(&output.stdout).ok()?;
        Some((path.clone(), value))
    });
    futures_util::future::join_all(futures).await.into_iter().flatten().collect()
}

pub async fn plan(Json(request): Json<RaidPlanRequest>) -> Result<Json<RaidOperationPlan>, (StatusCode, Json<Value>)> {
    Ok(Json(build_plan(request).await?))
}

pub async fn build_plan(request: RaidPlanRequest) -> Result<RaidOperationPlan, (StatusCode, Json<Value>)> {
    let mdstat = tokio::fs::read_to_string("/proc/mdstat").await.map_err(|error| api_error(StatusCode::SERVICE_UNAVAILABLE, format!("Linux MD status is unavailable: {error}")))?;
    let arrays = parse_mdstat(&mdstat);
    let plan = match request {
        RaidPlanRequest::Scrub { array } => {
            let array = validate_array_name(&array)?;
            let current = arrays.iter().find(|entry| entry.name == array).ok_or_else(|| api_error(StatusCode::NOT_FOUND, format!("RAID array '{array}' was not found")))?;
            if !current.active { return Err(api_error(StatusCode::CONFLICT, "Inactive arrays cannot be scrubbed".into())); }
            RaidOperationPlan {
                operation: "scrub".into(), array: format!("/dev/{array}"),
                summary: format!("Request a consistency check for /dev/{array}"),
                warnings: vec!["A scrub increases disk I/O and can affect application performance.".into()],
                commands: vec![PlannedCommand { program: "sh".into(), arguments: vec!["-c".into(), format!("echo check > /sys/block/{array}/md/sync_action")], purpose: "Start the kernel MD consistency check".into() }],
                confirmation_phrase: format!("SCRUB {array}"), executable: false,
            }
        }
        RaidPlanRequest::ReplaceMember { array, failed_member, replacement } => {
            let array = validate_array_name(&array)?;
            let failed_member = failed_member.as_deref().map(validate_device_path).transpose()?;
            let replacement = validate_device_path(&replacement)?;
            let current = arrays.iter().find(|entry| entry.name == array).ok_or_else(|| api_error(StatusCode::NOT_FOUND, format!("RAID array '{array}' was not found")))?;
            if current.health != "degraded" { return Err(api_error(StatusCode::CONFLICT, "Member replacement is only planned for degraded arrays".into())); }
            if failed_member.as_ref().is_some_and(|failed| !current.members.iter().any(|member| Path::new(failed).file_name().and_then(|name| name.to_str()) == Some(member.as_str()))) { return Err(api_error(StatusCode::BAD_REQUEST, "The failed member does not belong to this array".into())); }
            let replacement_info = inspect_replacement(&replacement).await?;
            if replacement_info.mounted { return Err(api_error(StatusCode::CONFLICT, "The replacement device or one of its children is mounted".into())); }
            if replacement_info.has_signatures { return Err(api_error(StatusCode::CONFLICT, "The replacement device contains a filesystem or RAID signature".into())); }
            let required_bytes = member_required_bytes(&current.members).await.ok_or_else(|| api_error(StatusCode::SERVICE_UNAVAILABLE, "Could not determine the RAID member capacity".into()))?;
            if replacement_info.size_bytes < required_bytes { return Err(api_error(StatusCode::CONFLICT, format!("Replacement capacity is {} bytes but at least {required_bytes} bytes are required", replacement_info.size_bytes))); }
            RaidOperationPlan {
                operation: "replace_member".into(), array: format!("/dev/{array}"),
                summary: failed_member.as_ref().map_or_else(|| format!("Add {replacement} to the degraded /dev/{array}"), |failed| format!("Replace {failed} with {replacement} in /dev/{array}")),
                warnings: vec!["Verify the physical disk serial number before executing this plan.".into(), "The replacement will be overwritten when it is added to the array.".into(), "ORA will monitor the kernel rebuild before declaring the array healthy.".into()],
                commands: {
                    let mut commands = Vec::new();
                    if let Some(failed) = failed_member {
                        commands.push(PlannedCommand { program: "mdadm".into(), arguments: vec![format!("/dev/{array}"), "--fail".into(), failed.clone()], purpose: "Mark the failed member".into() });
                        commands.push(PlannedCommand { program: "mdadm".into(), arguments: vec![format!("/dev/{array}"), "--remove".into(), failed], purpose: "Remove the failed member".into() });
                    }
                    commands.push(PlannedCommand { program: "mdadm".into(), arguments: vec![format!("/dev/{array}"), "--add".into(), replacement], purpose: "Add the verified replacement and start rebuild".into() });
                    commands
                },
                confirmation_phrase: format!("REPLACE {array}"), executable: false,
            }
        }
    };
    Ok(plan)
}

struct ReplacementInfo { size_bytes: u64, mounted: bool, has_signatures: bool }

async fn member_required_bytes(members: &[String]) -> Option<u64> {
    let futures = members.iter().map(|member| async move {
        let output = Command::new("lsblk").args(["--bytes", "--noheadings", "--output", "SIZE", &format!("/dev/{member}")]).output().await.ok()?;
        output.status.success().then(|| String::from_utf8_lossy(&output.stdout).trim().parse::<u64>().ok()).flatten()
    });
    futures_util::future::join_all(futures).await.into_iter().flatten().max()
}

async fn inspect_replacement(path: &str) -> Result<ReplacementInfo, (StatusCode, Json<Value>)> {
    let value = command_json("lsblk", &["--bytes", "--json", "--output", "PATH,SIZE,FSTYPE,MOUNTPOINTS,TYPE", path]).await
        .map_err(|error| api_error(StatusCode::BAD_GATEWAY, error))?;
    let device = value.get("blockdevices").and_then(Value::as_array).and_then(|items| items.first()).ok_or_else(|| api_error(StatusCode::NOT_FOUND, "Replacement device was not found".into()))?;
    let mut stack = vec![device]; let mut mounted = false; let mut has_signatures = false;
    while let Some(entry) = stack.pop() {
        mounted |= entry.get("mountpoints").and_then(Value::as_array).is_some_and(|points| points.iter().any(|point| !point.is_null()));
        has_signatures |= entry.get("fstype").and_then(Value::as_str).is_some_and(|value| !value.is_empty());
        if let Some(children) = entry.get("children").and_then(Value::as_array) { stack.extend(children); }
    }
    Ok(ReplacementInfo { size_bytes: device.get("size").and_then(Value::as_u64).unwrap_or(0), mounted, has_signatures })
}

fn validate_array_name(value: &str) -> Result<String, (StatusCode, Json<Value>)> {
    let value = value.trim().trim_start_matches("/dev/");
    if value.starts_with("md") && value.chars().all(|character| character.is_ascii_alphanumeric() || character == '_') { Ok(value.into()) } else { Err(api_error(StatusCode::BAD_REQUEST, "Invalid Linux MD array name".into())) }
}

fn validate_device_path(value: &str) -> Result<String, (StatusCode, Json<Value>)> {
    let value = value.trim();
    if value.starts_with("/dev/") && value[5..].chars().all(|character| character.is_ascii_alphanumeric() || matches!(character, '/' | '_' | '-')) { Ok(value.into()) } else { Err(api_error(StatusCode::BAD_REQUEST, "Invalid block device path".into())) }
}

fn api_error(status: StatusCode, message: String) -> (StatusCode, Json<Value>) { (status, Json(json!({ "error": message }))) }

pub fn parse_mdstat(input: &str) -> Vec<RaidArray> {
    let lines: Vec<&str> = input.lines().collect();
    let mut arrays = Vec::new();
    let mut index = 0;
    while index < lines.len() {
        let line = lines[index].trim();
        let Some((name, definition)) = line.split_once(" : ") else { index += 1; continue };
        if !name.starts_with("md") { index += 1; continue; }
        let tokens: Vec<&str> = definition.split_whitespace().collect();
        let active = tokens.first() == Some(&"active");
        let level_index = tokens.iter().position(|token| token.starts_with("raid"));
        let level = level_index.and_then(|position| tokens.get(position)).copied().unwrap_or("unknown").to_string();
        let members = level_index.map(|position| tokens.iter().skip(position + 1).take_while(|token| token.contains('[')).map(|token| token.split('[').next().unwrap_or(token).to_string()).collect()).unwrap_or_default();
        let detail = lines.get(index + 1).map(|line| line.trim()).unwrap_or("");
        let blocks = detail.split_whitespace().find_map(|token| token.parse::<u64>().ok());
        let counts = detail.split_whitespace().find_map(parse_counts);
        let pattern = detail.split_whitespace().find(|token| token.starts_with('[') && token.contains(['U', '_']));
        let operation_line = lines.get(index + 2).map(|line| line.trim()).unwrap_or("");
        let operation = ["recovery", "resync", "reshape", "check"].into_iter().find(|name| operation_line.contains(name)).map(str::to_string);
        let progress_percent = operation.as_ref().and_then(|_| operation_line.split_whitespace().find_map(|token| token.strip_suffix('%')?.parse().ok()));
        let (expected_devices, active_devices) = counts.unwrap_or((None, None));
        let degraded = pattern.is_some_and(|pattern| pattern.contains('_')) || matches!((expected_devices, active_devices), (Some(expected), Some(current)) if current < expected);
        arrays.push(RaidArray { name: name.into(), active, level, members, blocks, expected_devices, active_devices, health: if !active { "inactive" } else if degraded { "degraded" } else { "healthy" }.into(), operation, progress_percent });
        index += 1;
    }
    arrays
}

fn parse_counts(token: &str) -> Option<(Option<u32>, Option<u32>)> {
    let value = token.strip_prefix('[')?.strip_suffix(']')?;
    let (expected, active) = value.split_once('/')?;
    Some((expected.parse().ok(), active.parse().ok()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_array_and_device_identifiers() {
        assert_eq!(validate_array_name("/dev/md0").unwrap(), "md0");
        assert!(validate_array_name("md0;reboot").is_err());
        assert_eq!(validate_device_path("/dev/disk/by-id/test_disk-1").unwrap(), "/dev/disk/by-id/test_disk-1");
        assert!(validate_device_path("/tmp/not-a-device").is_err());
    }

    #[test]
    fn parses_healthy_and_degraded_arrays() {
        let mdstat = "Personalities : [raid1]\nmd0 : active raid1 sdb1[1] sda1[0]\n      976630336 blocks super 1.2 [2/2] [UU]\n\nmd1 : active raid5 sdd1[2] sdc1[1]\n      1953260672 blocks super 1.2 level 5 [3/2] [_UU]\n      [=>...................] recovery =  7.5% finish=120.0min speed=100000K/sec\n";
        let arrays = parse_mdstat(mdstat);
        assert_eq!(arrays.len(), 2);
        assert_eq!(arrays[0].health, "healthy");
        assert_eq!(arrays[1].health, "degraded");
        assert_eq!(arrays[1].operation.as_deref(), Some("recovery"));
        assert_eq!(arrays[1].progress_percent, Some(7.5));
    }
}
