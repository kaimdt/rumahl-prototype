// Self-Evolution System - ORA improves itself using pi.dev and other AI providers
pub mod evolution_engine;
pub mod reflection;
pub mod tools;
pub mod planner;
pub mod prompt_engine;
pub mod code_generation;
pub mod evolution_cycle;
pub mod knowledge_base;
pub mod scheduler;

use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::{DateTime, Utc};

/// Evolution proposal representing a potential self-improvement
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvolutionProposal {
    pub id: Uuid,
    pub title: String,
    pub description: Option<String>,
    pub category: String,       // feature, bugfix, optimization, security, refactor
    pub priority: i32,          // 1-10 scale
    pub status: String,         // proposed, planned, in_progress, implemented, tested, rejected
    pub rationale: Option<String>,
    pub estimated_effort: Option<String>,
    pub created_by: String,     // ora, user, external
    pub provider_used: Option<String>,
    pub model_used: Option<String>,

    pub implementation_plan: Option<serde_json::Value>,
    pub files_to_modify: Vec<String>,
    pub tests_required: bool,

    pub approved_by: Option<String>,
    pub approved_at: Option<DateTime<Utc>>,
    pub rejected_reason: Option<String>,

    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Code change made during self-evolution
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvolutionImplementation {
    pub id: Uuid,
    pub proposal_id: Uuid,
    pub file_path: String,
    pub change_type: String,   // add, modify, delete
    pub old_content: Option<String>,
    pub new_content: String,
    pub diff_text: Option<String>,
    pub commit_message: Option<String>,
    pub implemented_at: DateTime<Utc>,

    pub tests_passed: Option<bool>,
    pub test_results: Option<serde_json::Value>,
    pub verified_by: Option<String>,

    pub created_at: DateTime<Utc>,
}

/// Self-reflection entry - ORA's learning from experience
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelfReflection {
    pub id: Uuid,
    pub reflection_type: String,  // success, failure, improvement, insight
    pub context: String,
    pub observation: String,

    pub lesson_learned: Option<String>,
    pub action_items: Option<serde_json::Value>,
    pub knowledge_updated: bool,

    pub related_task_id: Option<Uuid>,
    pub related_proposal_id: Option<Uuid>,

    pub created_at: DateTime<Utc>,
}

/// Evolution settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvolutionSetting {
    pub id: i32,
    pub setting_key: String,
    pub setting_value: serde_json::Value,
    pub description: Option<String>,
    pub updated_at: DateTime<Utc>,
}

/// Configuration for the self-evolution system
#[derive(Debug, Clone)]
pub struct EvolutionConfig {
    /// Auto-approve proposals with priority <= this value (lower = less risky)
    pub auto_approve_threshold: i32,
    /// Require tests for all self-modifications
    pub require_tests: bool,
    /// Automatically rollback if post-change tests fail
    pub rollback_on_failure: bool,
    /// How often ORA should evaluate itself (in minutes)
    pub evolution_interval_minutes: i64,
    /// Maximum number of in-progress proposals at once
    pub max_concurrent_proposals: i32,
    /// Categories ORA can propose without user approval
    pub allowed_categories: Vec<String>,
    /// Whether pi.dev provider is enabled for self-evolution
    pub pidev_enabled: bool,
}

impl Default for EvolutionConfig {
    fn default() -> Self {
        Self {
            auto_approve_threshold: 3,
            require_tests: true,
            rollback_on_failure: true,
            evolution_interval_minutes: 1440, // daily
            max_concurrent_proposals: 3,
            allowed_categories: vec![
                "feature".to_string(),
                "bugfix".to_string(),
                "optimization".to_string(),
            ],
            pidev_enabled: true,
        }
    }
}
