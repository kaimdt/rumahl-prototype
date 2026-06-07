// ORA Features 4-12: Multi-Agent, Code Review, Self-Healing, Cost, Learning
use chrono::{DateTime, Datelike, Utc};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ─── 4. Multi-Agent Collaboration ────────────────────────────────────────
pub mod multi_agent {
    use super::*;

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct AgentRole {
        pub id: String,
        pub role: String,
        pub provider: String,
        pub model: String,
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct CollaborationPlan {
        pub id: String,
        pub goal: String,
        pub phases: Vec<CollaborationPhase>,
        pub agents: Vec<AgentRole>,
        pub status: String,
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct CollaborationPhase {
        pub name: String,
        pub agent_role: String,
        pub prompt: String,
        pub depends_on: Vec<String>,
        pub status: String,
        pub output: Option<String>,
    }

    pub struct Orchestrator {
        plans: RwLock<Vec<CollaborationPlan>>,
    }

    impl Orchestrator {
        pub fn new() -> Self {
            Self {
                plans: RwLock::new(Vec::new()),
            }
        }

        pub fn create_plan(&self, goal: &str) -> CollaborationPlan {
            let plan = CollaborationPlan {
                id: uuid::Uuid::new_v4().to_string(),
                goal: goal.to_string(),
                phases: vec![
                    CollaborationPhase {
                        name: "Plan".into(),
                        agent_role: "planner".into(),
                        prompt: format!("Create a detailed plan for: {}", goal),
                        depends_on: vec![],
                        status: "pending".into(),
                        output: None,
                    },
                    CollaborationPhase {
                        name: "Implement".into(),
                        agent_role: "coder".into(),
                        prompt: "Implement according to plan".into(),
                        depends_on: vec!["Plan".into()],
                        status: "pending".into(),
                        output: None,
                    },
                    CollaborationPhase {
                        name: "Test".into(),
                        agent_role: "tester".into(),
                        prompt: "Write tests and verify".into(),
                        depends_on: vec!["Implement".into()],
                        status: "pending".into(),
                        output: None,
                    },
                    CollaborationPhase {
                        name: "Review".into(),
                        agent_role: "reviewer".into(),
                        prompt: "Review all changes".into(),
                        depends_on: vec!["Test".into()],
                        status: "pending".into(),
                        output: None,
                    },
                ],
                agents: vec![
                    AgentRole {
                        id: "planner".into(),
                        role: "Planner".into(),
                        provider: "anthropic".into(),
                        model: "claude-sonnet".into(),
                    },
                    AgentRole {
                        id: "coder".into(),
                        role: "Coder".into(),
                        provider: "pidev".into(),
                        model: "pi-dev".into(),
                    },
                    AgentRole {
                        id: "tester".into(),
                        role: "Tester".into(),
                        provider: "pidev".into(),
                        model: "pi-dev".into(),
                    },
                    AgentRole {
                        id: "reviewer".into(),
                        role: "Reviewer".into(),
                        provider: "pidev".into(),
                        model: "pi-dev".into(),
                    },
                ],
                status: "created".into(),
            };
            self.plans.write().push(plan.clone());
            plan
        }

        pub fn list_plans(&self) -> Vec<CollaborationPlan> {
            self.plans.read().clone()
        }
        pub fn get_plan(&self, id: &str) -> Option<CollaborationPlan> {
            self.plans.read().iter().find(|p| p.id == id).cloned()
        }
    }
}

// ─── 5. Autonomous Code Review ───────────────────────────────────────────
pub mod code_review {
    use super::*;

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct ReviewRequest {
        pub diff_content: String,
        pub repo_name: String,
        pub pr_number: Option<u32>,
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct ReviewResult {
        pub id: String,
        pub summary: String,
        pub score: u8,
        pub issues: Vec<ReviewIssue>,
        pub suggestions: Vec<String>,
        pub security_concerns: Vec<String>,
        pub performance_notes: Vec<String>,
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct ReviewIssue {
        pub file: String,
        pub line: Option<u32>,
        pub severity: String,
        pub category: String,
        pub description: String,
        pub suggestion: String,
    }

    pub fn build_review_prompt(req: &ReviewRequest) -> String {
        format!(
            "Review this code diff from {}. PR #{:?}.\n\
             Analyze: 1) Code quality 2) Security 3) Performance 4) Best practices 5) Test gaps 6) Breaking changes\n\
             Output JSON with: summary, score (0-100), issues[], suggestions[], security_concerns[], performance_notes[]\n\n{}",
            req.repo_name, req.pr_number, req.diff_content
        )
    }
}

// ─── 8. IORA Self-Healing ────────────────────────────────────────────────
pub mod self_healing {
    use super::*;

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct HealthCheck {
        pub id: String,
        pub name: String,
        pub status: String,
        pub check_type: String,
        pub last_check: DateTime<Utc>,
        pub message: Option<String>,
        pub auto_fix_available: bool,
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct AutoFix {
        pub check_id: String,
        pub description: String,
        pub script: String,
        pub applied: bool,
    }

    pub struct SelfHealing {
        checks: RwLock<Vec<HealthCheck>>,
        fixes: RwLock<Vec<AutoFix>>,
    }

    impl SelfHealing {
        pub fn new() -> Self {
            let checks = vec![
                HealthCheck {
                    id: "disk".into(),
                    name: "Disk Space".into(),
                    status: "healthy".into(),
                    check_type: "system".into(),
                    last_check: Utc::now(),
                    message: None,
                    auto_fix_available: true,
                },
                HealthCheck {
                    id: "memory".into(),
                    name: "Memory Usage".into(),
                    status: "healthy".into(),
                    check_type: "system".into(),
                    last_check: Utc::now(),
                    message: None,
                    auto_fix_available: false,
                },
                HealthCheck {
                    id: "cpu".into(),
                    name: "CPU Load".into(),
                    status: "healthy".into(),
                    check_type: "system".into(),
                    last_check: Utc::now(),
                    message: None,
                    auto_fix_available: false,
                },
                HealthCheck {
                    id: "db".into(),
                    name: "Database".into(),
                    status: "healthy".into(),
                    check_type: "service".into(),
                    last_check: Utc::now(),
                    message: None,
                    auto_fix_available: true,
                },
                HealthCheck {
                    id: "agents".into(),
                    name: "Active Agents".into(),
                    status: "healthy".into(),
                    check_type: "service".into(),
                    last_check: Utc::now(),
                    message: None,
                    auto_fix_available: false,
                },
            ];
            Self {
                checks: RwLock::new(checks),
                fixes: RwLock::new(Vec::new()),
            }
        }

        pub fn get_checks(&self) -> Vec<HealthCheck> {
            self.checks.read().clone()
        }
        pub fn update_check(&self, id: &str, status: &str, msg: Option<&str>) {
            if let Some(c) = self.checks.write().iter_mut().find(|c| c.id == id) {
                c.status = status.to_string();
                c.message = msg.map(|s| s.to_string());
                c.last_check = Utc::now();
            }
        }
        pub fn get_fixes(&self) -> Vec<AutoFix> {
            self.fixes.read().clone()
        }
    }
}

// ─── 9. Cost Intelligence ────────────────────────────────────────────────
pub mod cost_intel {
    use super::*;

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct CostRecord {
        pub provider: String,
        pub model: String,
        pub tokens: u32,
        pub cost_estimate: f32,
        pub timestamp: DateTime<Utc>,
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct BudgetConfig {
        pub daily_limit: f32,
        pub monthly_limit: f32,
        pub alert_threshold: f32,
        pub provider_limits: HashMap<String, f32>,
    }

    pub struct CostTracker {
        records: RwLock<Vec<CostRecord>>,
        config: RwLock<BudgetConfig>,
    }

    impl CostTracker {
        pub fn new() -> Self {
            Self {
                records: RwLock::new(Vec::new()),
                config: RwLock::new(BudgetConfig {
                    daily_limit: 10.0,
                    monthly_limit: 200.0,
                    alert_threshold: 0.8,
                    provider_limits: HashMap::new(),
                }),
            }
        }

        pub fn record(&self, provider: &str, model: &str, tokens: u32) {
            let cost = tokens as f32 * 0.00001;
            self.records.write().push(CostRecord {
                provider: provider.into(),
                model: model.into(),
                tokens,
                cost_estimate: cost,
                timestamp: Utc::now(),
            });
        }

        pub fn daily_cost(&self) -> f32 {
            let today = Utc::now().date_naive();
            self.records
                .read()
                .iter()
                .filter(|r| r.timestamp.date_naive() == today)
                .map(|r| r.cost_estimate)
                .sum()
        }

        pub fn monthly_cost(&self) -> f32 {
            let now = Utc::now();
            self.records
                .read()
                .iter()
                .filter(|r| r.timestamp.year() == now.year() && r.timestamp.month() == now.month())
                .map(|r| r.cost_estimate)
                .sum()
        }

        pub fn within_budget(&self) -> bool {
            let cfg = self.config.read();
            self.daily_cost() < cfg.daily_limit && self.monthly_cost() < cfg.monthly_limit
        }

        pub fn get_config(&self) -> BudgetConfig {
            self.config.read().clone()
        }
        pub fn update_config(&self, c: BudgetConfig) {
            *self.config.write() = c;
        }
        pub fn get_records(&self, limit: usize) -> Vec<CostRecord> {
            self.records
                .read()
                .iter()
                .rev()
                .take(limit)
                .cloned()
                .collect()
        }

        pub fn suggest_cheaper(&self, provider: &str) -> Option<String> {
            let suggestions: HashMap<&str, &str> = [
                ("openai", "local"),
                ("anthropic", "deepseek"),
                ("pidev", "desktop"),
            ]
            .into();
            suggestions
                .get(provider)
                .map(|s| format!("Switch to {} to save costs", s))
        }
    }
}

// ─── 11. Learning from Mistakes ──────────────────────────────────────────
pub mod mistake_learner {
    use super::*;

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct Mistake {
        pub id: String,
        pub pattern: String,
        pub agent_id: String,
        pub task: String,
        pub lesson: String,
        pub severity: String,
        pub occurrences: u32,
        pub timestamp: DateTime<Utc>,
    }

    pub struct MistakeLearner {
        mistakes: RwLock<Vec<Mistake>>,
        avoid_list: RwLock<Vec<String>>,
    }

    impl MistakeLearner {
        pub fn new() -> Self {
            Self {
                mistakes: RwLock::new(Vec::new()),
                avoid_list: RwLock::new(Vec::new()),
            }
        }

        pub fn learn(&self, agent_id: &str, task: &str, error_pattern: &str, severity: &str) {
            let lesson = format!(
                "Avoid pattern '{}'. Break task into smaller steps.",
                error_pattern
            );
            let m = Mistake {
                id: uuid::Uuid::new_v4().to_string(),
                pattern: error_pattern.into(),
                agent_id: agent_id.into(),
                task: task.into(),
                lesson,
                severity: severity.into(),
                occurrences: 1,
                timestamp: Utc::now(),
            };
            self.mistakes.write().push(m);
            self.avoid_list.write().push(error_pattern.to_string());
        }

        pub fn get_avoid_list(&self) -> Vec<String> {
            self.avoid_list.read().clone()
        }
        pub fn get_mistakes(&self) -> Vec<Mistake> {
            self.mistakes.read().clone()
        }

        pub fn build_warning(&self, task: &str) -> String {
            let avoid = self.avoid_list.read();
            if avoid.is_empty() {
                return String::new();
            }
            let relevant: Vec<&String> = avoid
                .iter()
                .filter(|p| task.to_lowercase().contains(&p.to_lowercase()))
                .collect();
            if relevant.is_empty() {
                return String::new();
            }
            let joined: Vec<String> = relevant.iter().map(|s| s.to_string()).collect();
            format!(
                "Previous failures with similar patterns. Avoid: {}. Try a different approach.",
                joined.join(", ")
            )
        }
    }
}
