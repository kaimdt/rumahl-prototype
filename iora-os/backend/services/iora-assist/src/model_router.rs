// AI Model Router – Intelligent provider selection based on task analysis
// Routes requests to the best AI provider: cheap models for simple questions,
// pi.dev for complex code, web-enabled for research, etc.

use std::collections::HashMap;

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};

// ─── Types ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TaskCategory {
    SimpleChat,
    CodeGeneration,
    CodeReview,
    BugFix,
    Refactoring,
    Research,
    Documentation,
    Testing,
    Planning,
    DataAnalysis,
    SystemAdmin,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutingDecision {
    pub provider_type: String,
    pub model: String,
    pub reasoning: String,
    pub estimated_cost_tokens: u32,
    pub priority: RoutingPriority,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum RoutingPriority {
    Low,
    Normal,
    High,
    Critical,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouterConfig {
    pub default_provider: String,
    pub default_model: String,
    pub prefer_local: bool,
    pub max_cost_per_request: f32,
    pub daily_budget: f32,
    pub rules: Vec<RoutingRule>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutingRule {
    pub category: TaskCategory,
    pub provider: String,
    pub model: String,
    pub priority: RoutingPriority,
    pub max_tokens: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderCapability {
    pub provider_id: String,
    pub name: String,
    pub supported_categories: Vec<TaskCategory>,
    pub cost_per_1k_tokens: f32,
    pub max_context_tokens: u32,
    pub is_local: bool,
    pub is_available: bool,
}

// ─── Router ────────────────────────────────────────────────────────────────

pub struct ModelRouter {
    config: RwLock<RouterConfig>,
    providers: RwLock<HashMap<String, ProviderCapability>>,
    daily_usage_tokens: RwLock<u32>,
}

impl ModelRouter {
    pub fn new() -> Self {
        let default_rules = vec![
            RoutingRule {
                category: TaskCategory::SimpleChat,
                provider: "local".into(),
                model: "default".into(),
                priority: RoutingPriority::Low,
                max_tokens: 1024,
            },
            RoutingRule {
                category: TaskCategory::CodeGeneration,
                provider: "pidev".into(),
                model: "pi-dev".into(),
                priority: RoutingPriority::High,
                max_tokens: 8192,
            },
            RoutingRule {
                category: TaskCategory::CodeReview,
                provider: "pidev".into(),
                model: "pi-dev".into(),
                priority: RoutingPriority::Normal,
                max_tokens: 4096,
            },
            RoutingRule {
                category: TaskCategory::BugFix,
                provider: "pidev".into(),
                model: "pi-dev".into(),
                priority: RoutingPriority::High,
                max_tokens: 8192,
            },
            RoutingRule {
                category: TaskCategory::Refactoring,
                provider: "pidev".into(),
                model: "pi-dev".into(),
                priority: RoutingPriority::Normal,
                max_tokens: 8192,
            },
            RoutingRule {
                category: TaskCategory::Research,
                provider: "perplexity".into(),
                model: "default".into(),
                priority: RoutingPriority::Normal,
                max_tokens: 4096,
            },
            RoutingRule {
                category: TaskCategory::Documentation,
                provider: "local".into(),
                model: "default".into(),
                priority: RoutingPriority::Low,
                max_tokens: 4096,
            },
            RoutingRule {
                category: TaskCategory::Testing,
                provider: "pidev".into(),
                model: "pi-dev".into(),
                priority: RoutingPriority::Normal,
                max_tokens: 4096,
            },
            RoutingRule {
                category: TaskCategory::Planning,
                provider: "anthropic".into(),
                model: "claude-sonnet".into(),
                priority: RoutingPriority::High,
                max_tokens: 8192,
            },
            RoutingRule {
                category: TaskCategory::SystemAdmin,
                provider: "local".into(),
                model: "default".into(),
                priority: RoutingPriority::Low,
                max_tokens: 2048,
            },
        ];

        Self {
            config: RwLock::new(RouterConfig {
                default_provider: "local".into(),
                default_model: "default".into(),
                prefer_local: true,
                max_cost_per_request: 0.50,
                daily_budget: 10.0,
                rules: default_rules,
            }),
            providers: RwLock::new(HashMap::new()),
            daily_usage_tokens: RwLock::new(0),
        }
    }

    /// Register a provider's capabilities
    pub fn register_provider(&self, capability: ProviderCapability) {
        self.providers
            .write()
            .insert(capability.provider_id.clone(), capability);
    }

    /// Analyze a message and determine the task category
    pub fn classify_task(&self, message: &str) -> TaskCategory {
        let msg_lower = message.to_lowercase();

        // Keyword-based classification (can be enhanced with ML/LLM)
        let code_keywords = [
            "code",
            "function",
            "class",
            "implement",
            "build",
            "create",
            "component",
            "api",
            "endpoint",
            "route",
            "handler",
            "module",
            "package",
            "crate",
        ];
        let bug_keywords = [
            "bug",
            "fix",
            "error",
            "crash",
            "broken",
            "issue",
            "wrong",
            "incorrect",
            "fails",
            "exception",
            "panic",
            "null",
            "undefined",
        ];
        let refactor_keywords = [
            "refactor",
            "clean",
            "improve",
            "optimize",
            "restructure",
            "rewrite",
            "simplify",
            "extract",
        ];
        let test_keywords = [
            "test",
            "spec",
            "assert",
            "mock",
            "stub",
            "coverage",
            "unit test",
            "integration test",
        ];
        let doc_keywords = [
            "document", "readme", "comment", "explain", "describe", "doc", "api doc",
        ];
        let research_keywords = [
            "research",
            "find",
            "search",
            "look up",
            "what is",
            "how does",
            "compare",
            "alternative",
            "best practice",
        ];
        let review_keywords = [
            "review",
            "check",
            "audit",
            "inspect",
            "examine",
            "analyze code",
        ];
        let plan_keywords = [
            "plan",
            "design",
            "architecture",
            "strategy",
            "roadmap",
            "approach",
        ];
        let admin_keywords = [
            "deploy", "config", "settings", "monitor", "health", "status", "log",
        ];

        let score = |keywords: &[&str]| -> u32 {
            keywords.iter().filter(|k| msg_lower.contains(*k)).count() as u32
        };

        let scores: Vec<(TaskCategory, u32)> = vec![
            (TaskCategory::BugFix, score(&bug_keywords) * 3),
            (TaskCategory::CodeGeneration, score(&code_keywords) * 2),
            (TaskCategory::Testing, score(&test_keywords) * 3),
            (TaskCategory::Refactoring, score(&refactor_keywords) * 3),
            (TaskCategory::Documentation, score(&doc_keywords) * 2),
            (TaskCategory::Research, score(&research_keywords) * 2),
            (TaskCategory::CodeReview, score(&review_keywords) * 3),
            (TaskCategory::Planning, score(&plan_keywords) * 2),
            (TaskCategory::SystemAdmin, score(&admin_keywords) * 2),
        ];

        let best = scores.into_iter().max_by_key(|(_, s)| *s);
        match best {
            Some((cat, s)) if s > 0 => cat,
            _ => TaskCategory::SimpleChat,
        }
    }

    /// Route a task to the optimal provider based on classification
    pub fn route(&self, message: &str, force_provider: Option<&str>) -> RoutingDecision {
        if let Some(fp) = force_provider {
            let config = self.config.read();
            return RoutingDecision {
                provider_type: fp.to_string(),
                model: config.default_model.clone(),
                reasoning: "User-forced provider".into(),
                estimated_cost_tokens: 1024,
                priority: RoutingPriority::Normal,
            };
        }

        let category = self.classify_task(message);
        let config = self.config.read();

        // Try matching rule first
        if let Some(rule) = config.rules.iter().find(|r| r.category == category) {
            let providers = self.providers.read();

            // Check if preferred provider is available
            if let Some(cap) = providers.get(&rule.provider) {
                if cap.is_available {
                    return RoutingDecision {
                        provider_type: rule.provider.clone(),
                        model: rule.model.clone(),
                        reasoning: format!("Rule match: {:?} → {}", category, cap.name),
                        estimated_cost_tokens: rule.max_tokens,
                        priority: rule.priority.clone(),
                    };
                }
            }

            // Fallback: prefer local if available and prefer_local is set
            if config.prefer_local {
                for (id, cap) in providers.iter() {
                    if cap.is_local
                        && cap.is_available
                        && cap.supported_categories.contains(&category)
                    {
                        return RoutingDecision {
                            provider_type: id.clone(),
                            model: "default".into(),
                            reasoning: format!("Local fallback for {:?}", category),
                            estimated_cost_tokens: rule.max_tokens / 2,
                            priority: RoutingPriority::Low,
                        };
                    }
                }
            }
        }

        // Ultimate fallback: default provider
        RoutingDecision {
            provider_type: config.default_provider.clone(),
            model: config.default_model.clone(),
            reasoning: format!("Default route for {:?}", category),
            estimated_cost_tokens: 1024,
            priority: RoutingPriority::Normal,
        }
    }

    /// Record token usage for budget tracking
    pub fn record_usage(&self, tokens: u32) {
        *self.daily_usage_tokens.write() += tokens;
    }

    /// Check if we're within budget
    pub fn within_budget(&self) -> bool {
        let config = self.config.read();
        let usage = *self.daily_usage_tokens.read();
        // Rough estimate: $0.01 per 1K tokens for paid providers
        let estimated_cost = (usage as f32 / 1000.0) * 0.01;
        estimated_cost < config.daily_budget
    }

    pub fn get_daily_usage(&self) -> u32 {
        *self.daily_usage_tokens.read()
    }
    pub fn get_config(&self) -> RouterConfig {
        self.config.read().clone()
    }
    pub fn update_config(&self, cfg: RouterConfig) {
        *self.config.write() = cfg;
    }
    pub fn reset_daily_usage(&self) {
        *self.daily_usage_tokens.write() = 0;
    }
}
