// Security Monitor for pi.dev Sessions
// Actively monitors and enforces security policies for pi.dev agent execution.
// Tracks file access, command execution, network requests, and resource usage.
// Supports approval workflows for sensitive operations.

use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use tracing::info;

use super::{PiDevSessionConfig, SecurityLevel};

// ─── Types ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityPolicy {
    pub level: String,
    pub allowed_paths: Vec<String>,
    pub denied_paths: Vec<String>,
    pub allowed_commands: Vec<String>,
    pub denied_commands: Vec<String>,
    pub require_approval_for: Vec<String>,
    pub max_file_size_bytes: u64,
    pub max_files_per_session: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SecurityEvent {
    pub id: String,
    pub event_type: String,
    pub description: String,
    pub severity: String,
    pub timestamp: chrono::DateTime<chrono::Utc>,
    pub metadata: HashMap<String, String>,
}

#[derive(Debug, Clone)]
struct PendingApproval {
    event_id: String,
    session_id: String,
    action: String,
    details: String,
    timestamp: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionVerdict {
    pub allowed: bool,
    pub requires_approval: bool,
    pub reason: Option<String>,
    pub event_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionStats {
    pub files_read: u32,
    pub files_written: u32,
    pub files_deleted: u32,
    pub commands_executed: u32,
    pub network_requests: u32,
    pub bytes_written: u64,
    pub total_tool_calls: u32,
}

// ─── Security Monitor ──────────────────────────────────────────────────────

pub struct SecurityMonitor {
    pending_approvals: Arc<RwLock<HashMap<String, PendingApproval>>>,
    session_stats: Arc<RwLock<HashMap<String, SessionStats>>>,
}

impl SecurityMonitor {
    pub fn new() -> Self {
        Self {
            pending_approvals: Arc::new(RwLock::new(HashMap::new())),
            session_stats: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Create a security policy from session configuration
    pub fn create_policy(&self, config: &PiDevSessionConfig) -> SecurityPolicy {
        let workspace_path = config.workspace_path.clone();

        let (allowed_commands, denied_commands, require_approval_for) = match config.security_level {
            SecurityLevel::Permissive => (
                vec!["*".to_string()],
                vec!["rm -rf /".to_string(), "mkfs".to_string(), "dd if=".to_string()],
                vec!["rm -rf".to_string(), "git push".to_string(), "curl".to_string(), "wget".to_string()],
            ),
            SecurityLevel::Standard => (
                vec![
                    "ls".into(), "cat".into(), "grep".into(), "find".into(), "head".into(), "tail".into(),
                    "git".into(), "npm".into(), "cargo".into(), "python".into(), "node".into(),
                    "mkdir".into(), "touch".into(), "cp".into(), "mv".into(), "echo".into(),
                    "curl".into(), "wget".into(),
                ],
                vec!["rm -rf /".into(), "mkfs".into(), "chmod 777".into(), "sudo".into()],
                vec!["rm".into(), "git push --force".into(), "npm publish".into(), "cargo publish".into()],
            ),
            SecurityLevel::Strict => (
                vec![
                    "ls".into(), "cat".into(), "grep".into(), "find".into(), "head".into(), "tail".into(),
                    "git status".into(), "git diff".into(), "git log".into(),
                    "npm test".into(), "cargo check".into(), "cargo test".into(),
                ],
                vec!["rm".into(), "mv".into(), "cp".into(), "curl".into(), "wget".into(),
                     "chmod".into(), "chown".into(), "sudo".into(), "kill".into()],
                vec!["git commit".into(), "git push".into(), "npm install".into(), "cargo build".into()],
            ),
            SecurityLevel::ReadOnly => (
                vec!["ls".into(), "cat".into(), "grep".into(), "find".into(), "head".into(), "tail".into(),
                     "git status".into(), "git diff".into(), "git log".into()],
                vec!["*".to_string()],
                vec![],
            ),
        };

        SecurityPolicy {
            level: format!("{:?}", config.security_level).to_lowercase(),
            allowed_paths: vec![workspace_path.clone(), format!("{}/**", workspace_path)],
            denied_paths: vec![
                "/etc/**".into(), "/root/**".into(), "/var/log/**".into(),
                "/proc/**".into(), "/sys/**".into(), "/dev/**".into(),
            ],
            allowed_commands,
            denied_commands,
            require_approval_for,
            max_file_size_bytes: 10 * 1024 * 1024, // 10MB
            max_files_per_session: 500,
        }
    }

    /// Evaluate whether a tool call is allowed
    pub async fn evaluate_action(
        &self,
        session_id: &str,
        policy: &SecurityPolicy,
        tool_name: &str,
        arguments: &serde_json::Value,
    ) -> ActionVerdict {
        // Read-only tools are always allowed
        match tool_name {
            "read" | "code_search" | "web_search" | "fetch_content" | "todo" | "ask_user_question" => {
                self.record_stat(session_id, "read").await;
                return ActionVerdict {
                    allowed: true,
                    requires_approval: false,
                    reason: None,
                    event_id: None,
                };
            }
            _ => {}
        }

        // For write/edit/bash — check against policy
        let is_workspace_op = match tool_name {
            "write" | "edit" => {
                if let Some(path) = arguments.get("path").and_then(|p| p.as_str()) {
                    path.starts_with(&policy.allowed_paths[0])
                } else {
                    false
                }
            }
            "bash" => {
                if let Some(cmd) = arguments.get("command").and_then(|c| c.as_str()) {
                    // Check if command is in denied list
                    for denied in &policy.denied_commands {
                        if denied == "*" || cmd.contains(denied.as_str()) {
                            self.record_security_event(
                                session_id,
                                "denied_command",
                                &format!("Denied command: {}", cmd),
                                "high",
                            ).await;
                            return ActionVerdict {
                                allowed: false,
                                requires_approval: false,
                                reason: Some(format!("Command '{}' is denied by security policy", cmd)),
                                event_id: None,
                            };
                        }
                    }
                    // Check if command requires approval
                    for required in &policy.require_approval_for {
                        if cmd.contains(required.as_str()) {
                            let event = self.record_security_event(
                                session_id,
                                "requires_approval",
                                &format!("Command requires approval: {}", cmd),
                                "medium",
                            ).await;
                            return ActionVerdict {
                                allowed: false,
                                requires_approval: true,
                                reason: Some(format!("Command '{}' requires approval", cmd)),
                                event_id: Some(event.id),
                            };
                        }
                    }
                    true
                } else {
                    false
                }
            }
            _ => true,
        };

        if is_workspace_op {
            self.record_stat(session_id, tool_name).await;
            ActionVerdict {
                allowed: true,
                requires_approval: false,
                reason: None,
                event_id: None,
            }
        } else {
            let event = self.record_security_event(
                session_id,
                "outside_workspace",
                &format!("Tool '{}' attempted to access outside workspace", tool_name),
                "high",
            ).await;

            ActionVerdict {
                allowed: false,
                requires_approval: true,
                reason: Some("Access outside workspace requires approval".into()),
                event_id: Some(event.id),
            }
        }
    }

    /// Approve a pending action
    pub async fn approve(&self, session_id: &str, event_id: &str) -> Result<(), String> {
        let mut approvals = self.pending_approvals.write().await;
        let key = format!("{}:{}", session_id, event_id);
        approvals.remove(&key)
            .ok_or_else(|| "No pending approval found".to_string())?;
        info!("Approved action {} for session {}", event_id, session_id);
        Ok(())
    }

    /// Deny a pending action
    pub async fn deny(&self, session_id: &str, event_id: &str) -> Result<(), String> {
        let mut approvals = self.pending_approvals.write().await;
        let key = format!("{}:{}", session_id, event_id);
        approvals.remove(&key)
            .ok_or_else(|| "No pending approval found".to_string())?;
        info!("Denied action {} for session {}", event_id, session_id);
        Ok(())
    }

    /// Get session statistics
    pub async fn get_stats(&self, session_id: &str) -> SessionStats {
        self.session_stats.read().await
            .get(session_id)
            .cloned()
            .unwrap_or(SessionStats {
                files_read: 0,
                files_written: 0,
                files_deleted: 0,
                commands_executed: 0,
                network_requests: 0,
                bytes_written: 0,
                total_tool_calls: 0,
            })
    }

    // ─── Internal helpers ───────────────────────────────────────────────────

    async fn record_stat(&self, session_id: &str, tool: &str) {
        let mut stats = self.session_stats.write().await;
        let entry = stats.entry(session_id.to_string()).or_insert(SessionStats {
            files_read: 0, files_written: 0, files_deleted: 0,
            commands_executed: 0, network_requests: 0, bytes_written: 0,
            total_tool_calls: 0,
        });

        entry.total_tool_calls += 1;
        match tool {
            "read" => entry.files_read += 1,
            "write" | "edit" => entry.files_written += 1,
            "bash" => entry.commands_executed += 1,
            "web_search" | "fetch_content" => entry.network_requests += 1,
            _ => {}
        }
    }

    async fn record_security_event(
        &self,
        session_id: &str,
        event_type: &str,
        description: &str,
        severity: &str,
    ) -> SecurityEvent {
        let event = SecurityEvent {
            id: uuid::Uuid::new_v4().to_string(),
            event_type: event_type.to_string(),
            description: description.to_string(),
            severity: severity.to_string(),
            timestamp: chrono::Utc::now(),
            metadata: HashMap::new(),
        };

        // Store as pending if it requires approval
        if event_type == "requires_approval" {
            let mut approvals = self.pending_approvals.write().await;
            let key = format!("{}:{}", session_id, event.id);
            approvals.insert(key, PendingApproval {
                event_id: event.id.clone(),
                session_id: session_id.to_string(),
                action: event_type.to_string(),
                details: description.to_string(),
                timestamp: event.timestamp,
            });
        }

        event
    }
}
