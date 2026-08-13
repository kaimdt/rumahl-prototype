use anyhow::{bail, Context, Result};
use axum::{extract::State, http::{HeaderMap, StatusCode}, response::IntoResponse, Json};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use tokio::{io::{AsyncBufReadExt, AsyncWriteExt, BufReader}, net::UnixStream};
use uuid::Uuid;

use crate::AppState;

const HELPER_SOCKET: &str = "/run/iora/security-helper.sock";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResponseAction { Log, Alert, TemporaryBlock, StopProcess, Quarantine, IsolateNetwork, BlockIp, StopService, Lockdown }

#[derive(Debug, Deserialize)]
pub struct PolicyInput { pub id: String, pub name: String, pub threat_type: String, pub minimum_severity: String, pub actions: Vec<ResponseAction>, pub enabled: bool }

#[derive(Debug, Deserialize)]
pub struct ScanInput { pub path: String, #[serde(default)] pub providers: Vec<String> }

#[derive(Debug, Deserialize)]
pub struct FirewallInput { pub ruleset: String }

#[derive(Debug, Deserialize)]
pub struct ProviderInput { pub provider_id: String, pub enabled: bool, pub priority: i32, pub mode: String }
#[derive(Debug, Deserialize)]
pub struct RestoreInput { pub id: String, pub destination_name: String }

pub async fn overview(State(state): State<AppState>, headers: HeaderMap) -> Result<impl IntoResponse, CenterError> {
    require_permission(&headers, "security_read")?;
    let helper = helper_call(serde_json::json!({"action":"status"})).await.unwrap_or_else(|error| serde_json::json!({"ok":false,"message":error.to_string()}));
    let policies = sqlx::query("SELECT COUNT(*) AS count FROM security_policies WHERE enabled = 1").fetch_one(&*state.security_db).await?.get::<i64,_>("count");
    let scans = sqlx::query("SELECT COUNT(*) AS count FROM scan_jobs WHERE status IN ('queued','running')").fetch_one(&*state.security_db).await?.get::<i64,_>("count");
    let quarantine = sqlx::query("SELECT COUNT(*) AS count FROM quarantine_items WHERE released_at IS NULL").fetch_one(&*state.security_db).await?.get::<i64,_>("count");
    let audit_chain_valid = verify_audit_chain(&state).await.unwrap_or(false);
    let (health, health_reasons) = classify_health(&helper, audit_chain_valid);
    Ok(Json(serde_json::json!({"health":health,"health_reasons":health_reasons,"helper":helper,"audit_chain_valid":audit_chain_valid,"enabled_policies":policies,"active_scans":scans,"quarantine_items":quarantine,"default_response":"detect_alert_contain_confirm"})))
}

fn classify_health(helper: &serde_json::Value, audit_chain_valid: bool) -> (&'static str, Vec<&'static str>) {
    let mut reasons = Vec::new();
    if !audit_chain_valid { reasons.push("audit_chain_invalid"); }
    if helper.get("ok").and_then(|value|value.as_bool()) != Some(true) { reasons.push("helper_unavailable"); }
    if helper.pointer("/data/firewall_effective").and_then(|value|value.as_bool()) != Some(true) { reasons.push("firewall_ineffective"); }
    if !reasons.is_empty() { return ("compromised", reasons); }
    let scanners = helper.pointer("/data/clamav").and_then(|value|value.as_bool()) == Some(true) || helper.pointer("/data/yara").and_then(|value|value.as_bool()) == Some(true);
    let integrity = helper.pointer("/data/integrity_monitor_fresh").and_then(|value|value.as_bool()) == Some(true);
    if !scanners { reasons.push("scanner_unavailable"); }
    if !integrity { reasons.push("integrity_stale"); }
    if helper.pointer("/data/clamav").and_then(|value|value.as_bool()) == Some(true) && helper.pointer("/data/clamav_definitions_age_seconds").and_then(|value|value.as_u64()).is_none_or(|age|age > 172_800) { reasons.push("definitions_outdated"); }
    if reasons.is_empty() { ("healthy", reasons) } else { ("degraded", reasons) }
}

async fn verify_audit_chain(state: &AppState) -> Result<bool> {
    let rows = sqlx::query("SELECT timestamp,event_type,severity,source_ip,service_name,user_id,event_data,hash,prev_hash FROM security_events ORDER BY id").fetch_all(&*state.security_db).await?;
    let mut previous: Option<String> = None;
    for row in rows {
        let event = crate::SecurityEvent { id:None, timestamp:row.get("timestamp"), event_type:row.get("event_type"), severity:row.get("severity"), source_ip:row.get("source_ip"), service_name:row.get("service_name"), user_id:row.get("user_id"), event_data:row.get("event_data"), hash:row.get("hash"), prev_hash:row.get("prev_hash") };
        let keyed = crate::compute_event_hash(&state.encryption_key, &event);
        let legacy = crate::compute_legacy_event_hash(&event);
        if event.prev_hash != previous || (keyed != event.hash && legacy != event.hash) { return Ok(false); }
        previous = Some(event.hash);
    }
    Ok(true)
}

pub async fn providers(State(state): State<AppState>, headers: HeaderMap) -> Result<impl IntoResponse, CenterError> {
    require_permission(&headers, "security_read")?;
    let rows = sqlx::query("SELECT provider_id, enabled, priority, mode, updated_at FROM scanner_providers ORDER BY priority").fetch_all(&*state.security_db).await?;
    let providers: Vec<_> = rows.into_iter().map(|r| serde_json::json!({"id":r.get::<String,_>("provider_id"),"enabled":r.get::<bool,_>("enabled"),"priority":r.get::<i32,_>("priority"),"mode":r.get::<String,_>("mode"),"updated_at":r.get::<String,_>("updated_at")})).collect();
    Ok(Json(serde_json::json!({"providers":providers,"selection":"resource_aware"})))
}

pub async fn configure_provider(State(state): State<AppState>, headers: HeaderMap, Json(input): Json<ProviderInput>) -> Result<impl IntoResponse, CenterError> {
    require_permission(&headers, "security_policy_manage")?;
    if !["internal","yara","clamav"].contains(&input.provider_id.as_str()) || !["auto","always","disabled"].contains(&input.mode.as_str()) { return Err(anyhow::anyhow!("invalid provider configuration").into()) }
    sqlx::query("INSERT INTO scanner_providers(provider_id,enabled,priority,mode,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(provider_id) DO UPDATE SET enabled=excluded.enabled,priority=excluded.priority,mode=excluded.mode,updated_at=excluded.updated_at")
        .bind(&input.provider_id).bind(input.enabled).bind(input.priority.clamp(0,1000)).bind(&input.mode).bind(chrono::Utc::now().to_rfc3339()).execute(&*state.security_db).await?;
    Ok(Json(serde_json::json!({"updated":true})))
}

pub async fn policies(State(state): State<AppState>, headers: HeaderMap) -> Result<impl IntoResponse, CenterError> {
    require_permission(&headers, "security_read")?;
    let rows = sqlx::query("SELECT id,name,threat_type,minimum_severity,actions,enabled,updated_at FROM security_policies ORDER BY name").fetch_all(&*state.security_db).await?;
    let policies: Vec<_> = rows.into_iter().map(|r| serde_json::json!({"id":r.get::<String,_>("id"),"name":r.get::<String,_>("name"),"threat_type":r.get::<String,_>("threat_type"),"minimum_severity":r.get::<String,_>("minimum_severity"),"actions":serde_json::from_str::<serde_json::Value>(&r.get::<String,_>("actions")).unwrap_or_default(),"enabled":r.get::<bool,_>("enabled"),"updated_at":r.get::<String,_>("updated_at")})).collect();
    Ok(Json(serde_json::json!({"policies":policies})))
}

pub async fn save_policy(State(state): State<AppState>, headers: HeaderMap, Json(input): Json<PolicyInput>) -> Result<impl IntoResponse, CenterError> {
    require_permission(&headers, "security_policy_manage")?;
    validate_token(&input.id)?; validate_token(&input.threat_type)?;
    if input.actions.is_empty() || !["info","low","medium","high","critical"].contains(&input.minimum_severity.as_str()) { return Err(anyhow::anyhow!("invalid policy").into()) }
    sqlx::query("INSERT INTO security_policies(id,name,threat_type,minimum_severity,actions,enabled,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,threat_type=excluded.threat_type,minimum_severity=excluded.minimum_severity,actions=excluded.actions,enabled=excluded.enabled,updated_at=excluded.updated_at")
        .bind(input.id).bind(input.name).bind(input.threat_type).bind(input.minimum_severity).bind(serde_json::to_string(&input.actions)?).bind(input.enabled).bind(chrono::Utc::now().to_rfc3339()).execute(&*state.security_db).await?;
    Ok(Json(serde_json::json!({"updated":true})))
}

pub async fn start_scan(State(state): State<AppState>, headers: HeaderMap, Json(input): Json<ScanInput>) -> Result<impl IntoResponse, CenterError> {
    require_permission(&headers, "security_scan_execute")?;
    let actor = headers.get("x-iora-user-id").and_then(|v|v.to_str().ok()).unwrap_or("admin");
    let providers = select_providers(&state, &input.providers).await?;
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO scan_jobs(id,target,providers,status,requested_by,created_at) VALUES(?,?,?,?,?,?)").bind(&id).bind(&input.path).bind(serde_json::to_string(&providers)?).bind("running").bind(actor).bind(chrono::Utc::now().to_rfc3339()).execute(&*state.security_db).await?;
    let mut results = Vec::new();
    for provider in &providers { results.push(helper_call(serde_json::json!({"action":"scan","provider":provider,"path":input.path})).await.unwrap_or_else(|e|serde_json::json!({"ok":false,"message":e.to_string()}))); }
    let infected = results.iter().any(|result| result.get("message").and_then(|v|v.as_str()) == Some("threat detected") || result.pointer("/data/infected").and_then(|v|v.as_bool()) == Some(true));
    let incomplete = results.iter().any(|result|result.get("ok").and_then(|value|value.as_bool()) != Some(true));
    let status = if infected { "threat_found" } else if incomplete { "not_scanned" } else { "clean" };
    sqlx::query("UPDATE scan_jobs SET status=?,result=?,completed_at=? WHERE id=?").bind(status).bind(serde_json::to_string(&results)?).bind(chrono::Utc::now().to_rfc3339()).bind(&id).execute(&*state.security_db).await?;
    Ok(Json(serde_json::json!({"id":id,"status":status,"providers":providers,"infected":infected,"results":results})))
}

pub async fn apply_firewall(headers: HeaderMap, Json(input): Json<FirewallInput>) -> Result<impl IntoResponse, CenterError> {
    require_permission(&headers, "security_firewall_manage")?;
    if input.ruleset.contains("flush ruleset") || !input.ruleset.contains("iora_security") { return Err(anyhow::anyhow!("unsafe firewall policy").into()) }
    Ok(Json(helper_call(serde_json::json!({"action":"apply_firewall","ruleset":input.ruleset})).await?))
}

pub async fn restore_quarantine(State(state): State<AppState>, headers: HeaderMap, Json(input): Json<RestoreInput>) -> Result<impl IntoResponse, CenterError> {
    require_permission(&headers, "security_quarantine_manage")?;
    validate_token(&input.destination_name)?;
    let actor = headers.get("x-iora-user-id").and_then(|value|value.to_str().ok()).unwrap_or("admin");
    let destination = format!("/var/lib/iora-security/restored/{}", input.destination_name);
    let response = helper_call(serde_json::json!({"action":"restore_quarantine","id":input.id,"destination":destination})).await?;
    if response.get("ok").and_then(|value|value.as_bool()) != Some(true) { return Err(anyhow::anyhow!("quarantine restore rejected").into()) }
    sqlx::query("UPDATE quarantine_items SET released_at=?,released_by=? WHERE id=? AND released_at IS NULL").bind(chrono::Utc::now().to_rfc3339()).bind(actor).bind(&input.id).execute(&*state.security_db).await?;
    crate::log_security_event(&state.security_db, &state.encryption_key, "quarantine_restore", "warning", None, Some("iora-security"), Some(actor), Some(&serde_json::json!({"id":input.id,"destination":destination}).to_string())).await?;
    Ok(Json(response))
}

async fn select_providers(state: &AppState, requested: &[String]) -> Result<Vec<String>> {
    if !requested.is_empty() { for item in requested { if !["internal","yara","clamav"].contains(&item.as_str()) { bail!("unknown scanner provider") } } return Ok(requested.to_vec()); }
    let memory = std::fs::read_to_string("/proc/meminfo").unwrap_or_default();
    let available_kib = meminfo_kib(&memory, "MemAvailable");
    let pressure = std::fs::read_to_string("/proc/pressure/memory").unwrap_or_default();
    let clamav_safe = available_kib >= 700_000 && memory_pressure_avg10(&pressure) < 10.0;
    let rows = sqlx::query("SELECT provider_id,mode FROM scanner_providers WHERE enabled=1 AND mode != 'disabled' ORDER BY priority").fetch_all(&*state.security_db).await?;
    Ok(rows.into_iter().filter_map(|r| { let id=r.get::<String,_>("provider_id"); let mode=r.get::<String,_>("mode"); if mode=="always" || id!="clamav" || clamav_safe {Some(id)} else {None} }).collect())
}

fn meminfo_kib(contents: &str, key: &str) -> u64 { contents.lines().find(|line| line.starts_with(key)).and_then(|line|line.split_whitespace().nth(1)).and_then(|value|value.parse().ok()).unwrap_or(0) }
fn memory_pressure_avg10(contents: &str) -> f64 { contents.lines().find(|line|line.starts_with("some ")).and_then(|line|line.split_whitespace().find_map(|part|part.strip_prefix("avg10="))).and_then(|value|value.parse().ok()).unwrap_or(0.0) }

async fn helper_call(value: serde_json::Value) -> Result<serde_json::Value> {
    let mut stream = UnixStream::connect(HELPER_SOCKET).await.context("security helper unavailable")?;
    stream.write_all(serde_json::to_string(&value)?.as_bytes()).await?; stream.write_all(b"\n").await?;
    let mut response=String::new(); BufReader::new(stream).read_line(&mut response).await?;
    Ok(serde_json::from_str(&response)?)
}

fn require_permission(headers: &HeaderMap, permission: &str) -> Result<()> {
    let trusted_proxy = headers.get("x-iora-proxy").and_then(|v|v.to_str().ok()) == Some("iora-home");
    let permissions = headers.get("x-iora-permissions").and_then(|v|v.to_str().ok()).unwrap_or("");
    if !trusted_proxy || !(permissions.split(',').any(|p|p.trim()==permission) || permissions.split(',').any(|p|p.trim()=="security_admin")) { bail!("missing security permission: {permission}") }
    Ok(())
}
fn validate_token(value: &str) -> Result<()> { if value.is_empty() || value.len()>80 || !value.chars().all(|c|c.is_ascii_alphanumeric()||c=='_'||c=='-') { bail!("invalid identifier") } Ok(()) }

pub struct CenterError(anyhow::Error);
impl<E> From<E> for CenterError where E: Into<anyhow::Error> { fn from(value:E)->Self{Self(value.into())} }
impl IntoResponse for CenterError { fn into_response(self)->axum::response::Response { (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error":self.0.to_string()}))).into_response() } }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resource_parser_uses_available_not_total_memory() {
        let data = "MemTotal: 2097152 kB\nMemAvailable: 240000 kB\n";
        assert_eq!(meminfo_kib(data, "MemAvailable"), 240000);
        assert_ne!(meminfo_kib(data, "MemAvailable"), meminfo_kib(data, "MemTotal"));
    }

    #[test]
    fn pressure_parser_is_fail_closed_for_reported_pressure() {
        assert_eq!(memory_pressure_avg10("some avg10=12.50 avg60=4.0 total=1\n"), 12.5);
        assert_eq!(memory_pressure_avg10(""), 0.0);
    }

    #[test]
    fn direct_requests_never_gain_permissions() {
        let mut headers = HeaderMap::new();
        headers.insert("x-iora-permissions", "security_admin".parse().unwrap());
        assert!(require_permission(&headers, "security_read").is_err());
    }

    #[test]
    fn health_distinguishes_degraded_from_compromised() {
        let effective = serde_json::json!({"ok":true,"data":{"firewall_effective":true,"clamav":false,"yara":false,"integrity_monitor_fresh":true}});
        assert_eq!(classify_health(&effective, true), ("degraded", vec!["scanner_unavailable"]));
        assert_eq!(classify_health(&effective, false).0, "compromised");
        let healthy = serde_json::json!({"ok":true,"data":{"firewall_effective":true,"yara":true,"integrity_monitor_fresh":true}});
        assert_eq!(classify_health(&healthy, true).0, "healthy");
    }
}
