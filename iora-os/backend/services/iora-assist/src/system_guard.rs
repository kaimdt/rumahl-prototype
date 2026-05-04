// System Guard – Protection & Control for IORA AI
use std::collections::{HashMap, VecDeque};
use std::time::Duration;

use chrono::Utc;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use tracing::{error, info};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SystemState { Running, Paused, EmergencyStop, PartialPause { paused_agents: Vec<String> } }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallRecord {
    pub tool_name: String, pub arguments_summary: String, pub success: bool,
    pub timestamp: chrono::DateTime<chrono::Utc>, pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentActivity {
    pub agent_id: String, pub session_id: String, pub tool_calls: Vec<ToolCallRecord>,
    pub started_at: chrono::DateTime<chrono::Utc>, pub last_activity: chrono::DateTime<chrono::Utc>,
    pub total_tool_calls: u32, pub failed_tool_calls: u32, pub current_task: String,
    pub call_history: VecDeque<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoopDetection {
    pub detected: bool, pub agent_id: String, pub pattern: Vec<String>,
    pub repetitions: u32, pub total_failures: u32, pub suggestion: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtectionRule {
    pub id: String, pub name: String, pub rule_type: ProtectionRuleType,
    pub threshold: u32, pub action: ProtectionAction, pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ProtectionRuleType { MaxConsecutiveFailures, MaxToolCallsPerMinute, MaxSessionDuration, RepetitivePattern, EmptyOutput, ResourceExhaustion }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ProtectionAction { PauseAgent, StopAgent, AdjustAndRetry, NotifyAdmin, EscalateToHuman }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecoveryAction {
    pub agent_id: String, pub original_input: String, pub adjusted_input: String,
    pub reason: String, pub loop_pattern: Vec<String>,
}

pub struct SystemGuard {
    state: RwLock<SystemState>,
    agent_activities: RwLock<HashMap<String, AgentActivity>>,
    rules: RwLock<Vec<ProtectionRule>>,
    loop_detections: RwLock<VecDeque<LoopDetection>>,
    recovery_queue: RwLock<VecDeque<RecoveryAction>>,
    started_at: chrono::DateTime<chrono::Utc>,
}

impl SystemGuard {
    pub fn new() -> Self {
        Self {
            state: RwLock::new(SystemState::Running),
            agent_activities: RwLock::new(HashMap::new()),
            rules: RwLock::new(vec![
                ProtectionRule { id: "max-failures".into(), name: "Max failures".into(), rule_type: ProtectionRuleType::MaxConsecutiveFailures, threshold: 5, action: ProtectionAction::AdjustAndRetry, enabled: true },
                ProtectionRule { id: "tool-rate".into(), name: "Tool rate limit".into(), rule_type: ProtectionRuleType::MaxToolCallsPerMinute, threshold: 30, action: ProtectionAction::PauseAgent, enabled: true },
                ProtectionRule { id: "max-time".into(), name: "Max session time".into(), rule_type: ProtectionRuleType::MaxSessionDuration, threshold: 3600, action: ProtectionAction::PauseAgent, enabled: true },
                ProtectionRule { id: "repetitive".into(), name: "Repetitive pattern".into(), rule_type: ProtectionRuleType::RepetitivePattern, threshold: 3, action: ProtectionAction::StopAgent, enabled: true },
                ProtectionRule { id: "empty-output".into(), name: "Empty output".into(), rule_type: ProtectionRuleType::EmptyOutput, threshold: 3, action: ProtectionAction::AdjustAndRetry, enabled: true },
            ]),
            loop_detections: RwLock::new(VecDeque::with_capacity(100)),
            recovery_queue: RwLock::new(VecDeque::new()),
            started_at: Utc::now(),
        }
    }

    pub fn pause_system(&self) { *self.state.write() = SystemState::Paused; info!("SystemGuard: PAUSED"); }
    pub fn resume_system(&self) { *self.state.write() = SystemState::Running; info!("SystemGuard: RESUMED"); }
    pub fn emergency_stop(&self) { *self.state.write() = SystemState::EmergencyStop; error!("SystemGuard: EMERGENCY STOP"); }

    pub fn pause_agent(&self, agent_id: &str) {
        let mut state = self.state.write();
        let mut agents = match &*state {
            SystemState::PartialPause { paused_agents } => paused_agents.clone(),
            SystemState::Running => Vec::new(),
            _ => return,
        };
        if !agents.contains(&agent_id.to_string()) { agents.push(agent_id.to_string()); }
        *state = SystemState::PartialPause { paused_agents: agents };
    }

    pub fn resume_agent(&self, agent_id: &str) {
        let mut state = self.state.write();
        if let SystemState::PartialPause { paused_agents } = &*state {
            let agents: Vec<String> = paused_agents.iter().filter(|a| *a != agent_id).cloned().collect();
            *state = if agents.is_empty() { SystemState::Running } else { SystemState::PartialPause { paused_agents: agents } };
        }
    }

    pub fn stop_agent(&self, agent_id: &str) {
        self.agent_activities.write().remove(agent_id);
        info!("SystemGuard: Agent {} stopped", agent_id);
    }

    pub fn can_proceed(&self, agent_id: Option<&str>) -> bool {
        match &*self.state.read() {
            SystemState::Running => true,
            SystemState::Paused | SystemState::EmergencyStop => false,
            SystemState::PartialPause { paused_agents } => agent_id.map_or(true, |id| !paused_agents.contains(&id.to_string())),
        }
    }

    pub fn get_state(&self) -> SystemState { self.state.read().clone() }

    pub fn record_tool_call(&self, agent_id: &str, session_id: &str, tool_name: &str, args: &str, success: bool, dur_ms: u64) -> Option<LoopDetection> {
        let mut activities = self.agent_activities.write();
        let now = Utc::now();
        let activity = activities.entry(agent_id.to_string()).or_insert_with(|| AgentActivity {
            agent_id: agent_id.to_string(), session_id: session_id.to_string(),
            tool_calls: Vec::new(), started_at: now, last_activity: now,
            total_tool_calls: 0, failed_tool_calls: 0, current_task: String::new(),
            call_history: VecDeque::with_capacity(20),
        });

        activity.tool_calls.push(ToolCallRecord { tool_name: tool_name.to_string(), arguments_summary: args.to_string(), success, timestamp: now, duration_ms: dur_ms });
        activity.total_tool_calls += 1;
        if !success { activity.failed_tool_calls += 1; }
        activity.last_activity = now;
        activity.call_history.push_back(tool_name.to_string());
        if activity.call_history.len() > 20 { activity.call_history.pop_front(); }

        self.detect_loops(agent_id, activity)
    }

    fn detect_loops(&self, agent_id: &str, activity: &AgentActivity) -> Option<LoopDetection> {
        let rules = self.rules.read();
        let now = Utc::now();

        // Max consecutive failures
        if let Some(rule) = rules.iter().find(|r| r.rule_type == ProtectionRuleType::MaxConsecutiveFailures && r.enabled) {
            let recent: Vec<_> = activity.tool_calls.iter().rev().take(rule.threshold as usize).filter(|tc| !tc.success).collect();
            if recent.len() >= rule.threshold as usize && recent.iter().all(|tc| (now - tc.timestamp).num_seconds() < 120) {
                let pattern: Vec<_> = recent.iter().map(|tc| tc.tool_name.clone()).collect();
                let detection = LoopDetection {
                    detected: true, agent_id: agent_id.to_string(), pattern: pattern.clone(),
                    repetitions: rule.threshold, total_failures: activity.failed_tool_calls,
                    suggestion: format!("Failed tools: {}. Try a different approach.", pattern.join(" → ")),
                };
                if rule.action == ProtectionAction::AdjustAndRetry {
                    self.recovery_queue.write().push_back(RecoveryAction {
                        agent_id: agent_id.to_string(), original_input: activity.current_task.clone(),
                        adjusted_input: format!("Previous attempt failed. Try a DIFFERENT strategy. Failed: {}", pattern.join(", ")),
                        reason: "consecutive failures".into(), loop_pattern: pattern,
                    });
                }
                self.loop_detections.write().push_back(detection.clone());
                return Some(detection);
            }
        }

        // Repetitive pattern
        if let Some(rule) = rules.iter().find(|r| r.rule_type == ProtectionRuleType::RepetitivePattern && r.enabled) {
            if activity.call_history.len() >= (rule.threshold * 2) as usize {
                let hist: Vec<String> = activity.call_history.iter().cloned().collect();
                if let Some((pat, reps)) = find_repeating_pattern(&hist, rule.threshold as usize) {
                    let detection = LoopDetection {
                        detected: true, agent_id: agent_id.to_string(), pattern: pat.clone(),
                        repetitions: reps as u32, total_failures: activity.failed_tool_calls,
                        suggestion: format!("Repeating {:?} ({}x). Break into smaller steps.", pat, reps),
                    };
                    self.loop_detections.write().push_back(detection.clone());
                    return Some(detection);
                }
            }
        }

        None
    }

    pub fn get_rules(&self) -> Vec<ProtectionRule> { self.rules.read().clone() }
    pub fn update_rule(&self, id: &str, enabled: bool, threshold: Option<u32>) {
        let mut rules = self.rules.write();
        if let Some(r) = rules.iter_mut().find(|r| r.id == id) { r.enabled = enabled; if let Some(t) = threshold { r.threshold = t; } }
    }
    pub fn get_loop_detections(&self) -> Vec<LoopDetection> { self.loop_detections.read().iter().cloned().collect() }
    pub fn get_agent_activities(&self) -> Vec<AgentActivity> { self.agent_activities.read().values().cloned().collect() }
    pub fn get_recovery_actions(&self) -> Vec<RecoveryAction> { self.recovery_queue.read().iter().cloned().collect() }
    pub fn take_recovery_action(&self) -> Option<RecoveryAction> { self.recovery_queue.write().pop_front() }
    pub fn uptime_secs(&self) -> i64 { (Utc::now() - self.started_at).num_seconds() }
}

fn find_repeating_pattern(seq: &[String], min_reps: usize) -> Option<(Vec<String>, usize)> {
    if seq.len() < min_reps * 2 { return None; }
    for plen in 2..=6.min(seq.len() / min_reps) {
        let pattern: Vec<_> = seq[seq.len() - plen..].to_vec();
        let mut reps = 1;
        let mut pos = seq.len() as isize - plen as isize - 1;
        while pos >= 0 {
            let s = pos as usize; let e = s + plen;
            if e > seq.len() { break; }
            if seq[s..e] == pattern[..] { reps += 1; pos -= plen as isize; } else { break; }
        }
        if reps >= min_reps { return Some((pattern, reps)); }
    }
    None
}
