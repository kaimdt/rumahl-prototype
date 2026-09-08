use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const SCHEMA_VERSION: &str = "ora.runtime.v2";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EventClass {
    ProcessStart,
    ProcessExec,
    ProcessExit,
    ConnectionAttempt,
    ConnectionResult,
    ExecutableIdentity,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IdentityKind {
    System,
    Container,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HashState {
    Pending,
    Available,
    Skipped,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionState {
    Attempt,
    Success,
    Failed,
    InProgress,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutableIdentity {
    pub path: Option<String>,
    pub hash_state: HashState,
    pub sha256: Option<String>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeIdentity {
    pub kind: IdentityKind,
    pub cgroup_id: u64,
    pub cgroup_path: Option<String>,
    pub container_id: Option<String>,
    pub app_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessContext {
    pub process_instance_id: String,
    pub parent_process_instance_id: Option<String>,
    pub pid: u32,
    pub ppid: u32,
    pub process_start_time_ns: u64,
    pub exec_generation: u32,
    pub uid: u32,
    pub gid: u32,
    pub executable: ExecutableIdentity,
    pub command_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkContext {
    pub connection_state: ConnectionState,
    pub result_errno: Option<i32>,
    pub protocol: String,
    pub local_address: Option<String>,
    pub local_port: Option<u16>,
    pub remote_address: String,
    pub remote_port: u16,
    pub address_family: String,
    pub network_namespace: u64,
    pub socket_cookie: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeEvent {
    pub schema_version: String,
    pub event_id: Uuid,
    pub host_boot_id: Uuid,
    pub sensor_instance_id: Uuid,
    pub sequence: u64,
    pub monotonic_ns: u64,
    pub observed_at: String,
    pub class: EventClass,
    pub critical: bool,
    pub process: ProcessContext,
    pub identity: RuntimeIdentity,
    pub network: Option<NetworkContext>,
}

#[derive(Debug, Deserialize)]
pub struct KernelEvent {
    pub class: EventClass,
    pub monotonic_ns: u64,
    pub pid: u32,
    pub ppid: u32,
    pub process_start_time_ns: u64,
    #[serde(default)]
    pub exec_generation: u32,
    pub uid: u32,
    pub gid: u32,
    pub cgroup_id: u64,
    pub command_name: String,
    pub executable: Option<String>,
    pub remote_address: Option<String>,
    pub remote_port: Option<u16>,
    pub local_address: Option<String>,
    pub local_port: Option<u16>,
    pub protocol: Option<String>,
    pub address_family: Option<String>,
    #[serde(default)]
    pub network_namespace: u64,
    #[serde(default)]
    pub socket_cookie: u64,
    pub result_errno: Option<i32>,
}
