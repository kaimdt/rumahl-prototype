// Cost Manager – Token Budgeting & Economy Mode
// Tracks token usage, enforces budgets, routes to cheapest capable model.

use std::collections::HashMap;
use std::sync::Arc;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

/// Pricing per 1K tokens (USD)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelPricing {
    pub input_cost_per_1k: f64,
    pub output_cost_per_1k: f64,
    /// "economy" | "balanced" | "premium"
    pub tier: String,
    /// Minimum capability score 0.0-1.0
    pub capability_score: f64,
}

/// Known model prices (approximate, updated periodically)
impl ModelPricing {
    pub fn known_models() -> HashMap<&'static str, ModelPricing> {
        let mut map = HashMap::new();
        // OpenAI
        map.insert("gpt-4o", ModelPricing { input_cost_per_1k: 0.0025, output_cost_per_1k: 0.01, tier: "premium".into(), capability_score: 0.95 });
        map.insert("gpt-4o-mini", ModelPricing { input_cost_per_1k: 0.00015, output_cost_per_1k: 0.0006, tier: "economy".into(), capability_score: 0.80 });
        map.insert("gpt-3.5-turbo", ModelPricing { input_cost_per_1k: 0.0005, output_cost_per_1k: 0.0015, tier: "economy".into(), capability_score: 0.65 });
        // Anthropic
        map.insert("claude-sonnet-4-20250514", ModelPricing { input_cost_per_1k: 0.003, output_cost_per_1k: 0.015, tier: "premium".into(), capability_score: 0.98 });
        map.insert("claude-3-haiku", ModelPricing { input_cost_per_1k: 0.00025, output_cost_per_1k: 0.00125, tier: "economy".into(), capability_score: 0.70 });
        // DeepSeek
        map.insert("deepseek-chat", ModelPricing { input_cost_per_1k: 0.00014, output_cost_per_1k: 0.00028, tier: "economy".into(), capability_score: 0.78 });
        map.insert("deepseek-coder", ModelPricing { input_cost_per_1k: 0.00014, output_cost_per_1k: 0.00028, tier: "economy".into(), capability_score: 0.82 });
        // Mistral
        map.insert("mistral-small", ModelPricing { input_cost_per_1k: 0.001, output_cost_per_1k: 0.003, tier: "economy".into(), capability_score: 0.72 });
        map.insert("mistral-large", ModelPricing { input_cost_per_1k: 0.004, output_cost_per_1k: 0.012, tier: "premium".into(), capability_score: 0.90 });
        // Grok
        map.insert("grok-2", ModelPricing { input_cost_per_1k: 0.005, output_cost_per_1k: 0.015, tier: "premium".into(), capability_score: 0.88 });
        // Cohere
        map.insert("command-r", ModelPricing { input_cost_per_1k: 0.0005, output_cost_per_1k: 0.0015, tier: "economy".into(), capability_score: 0.75 });
        // Local (free tier)
        map.insert("local-llama3", ModelPricing { input_cost_per_1k: 0.0, output_cost_per_1k: 0.0, tier: "economy".into(), capability_score: 0.60 });
        map.insert("local-mistral", ModelPricing { input_cost_per_1k: 0.0, output_cost_per_1k: 0.0, tier: "economy".into(), capability_score: 0.55 });
        map.insert("local-codestral", ModelPricing { input_cost_per_1k: 0.0, output_cost_per_1k: 0.0, tier: "economy".into(), capability_score: 0.65 });
        map
    }

    pub fn lookup(model: &str) -> Option<ModelPricing> {
        let known = Self::known_models();
        // Exact match first
        if let Some(p) = known.get(model) {
            return Some(p.clone());
        }
        // Partial match
        let model_lower = model.to_lowercase();
        for (key, pricing) in &known {
            if model_lower.contains(key) || key.contains(&model_lower) {
                return Some(pricing.clone());
            }
        }
        // Default for unknown models
        Some(ModelPricing {
            input_cost_per_1k: 0.003,
            output_cost_per_1k: 0.01,
            tier: "balanced".into(),
            capability_score: 0.75,
        })
    }

    pub fn estimate_cost(&self, input_tokens: u32, output_tokens: u32) -> f64 {
        (input_tokens as f64 / 1000.0 * self.input_cost_per_1k)
            + (output_tokens as f64 / 1000.0 * self.output_cost_per_1k)
    }
}

/// Represents a single API call cost record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CostRecord {
    pub timestamp: DateTime<Utc>,
    pub provider: String,
    pub model: String,
    pub purpose: String,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub estimated_cost_usd: f64,
    pub mode: String, // "economy" | "balanced" | "premium"
}

/// Budget configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BudgetConfig {
    /// Maximum USD per day
    pub daily_limit: Option<f64>,
    /// Maximum USD per month
    pub monthly_limit: Option<f64>,
    /// Maximum tokens per request
    pub max_tokens_per_request: Option<u32>,
    /// Preferred mode: "economy" | "balanced" | "premium" | "auto"
    pub mode: String,
    /// Minimum capability score for routing (0.0-1.0)
    pub min_capability: Option<f64>,
    /// Allow local models when available (free)
    pub prefer_local: bool,
    /// Cache common responses to save tokens
    pub enable_cache: bool,
    /// Truncate long context automatically
    pub auto_truncate_context: bool,
    /// Max context tokens to send
    pub max_context_tokens: Option<u32>,
}

impl Default for BudgetConfig {
    fn default() -> Self {
        Self {
            daily_limit: Some(5.0),
            monthly_limit: Some(50.0),
            max_tokens_per_request: Some(100_000),
            mode: "auto".to_string(),
            min_capability: None,
            prefer_local: true,
            enable_cache: true,
            auto_truncate_context: true,
            max_context_tokens: Some(32_000),
        }
    }
}

/// The Cost Manager handles token tracking, budget enforcement, and economy routing
pub struct CostManager {
    /// Rolling cost records
    records: Arc<RwLock<Vec<CostRecord>>>,
    /// Budget config
    config: Arc<RwLock<BudgetConfig>>,
    /// Simple response cache: (hash_key -> (response_text, timestamp))
    cache: Arc<RwLock<HashMap<String, (String, DateTime<Utc>)>>>,
    /// Cache TTL in seconds
    cache_ttl_secs: u64,
}

impl CostManager {
    pub fn new() -> Self {
        Self {
            records: Arc::new(RwLock::new(Vec::new())),
            config: Arc::new(RwLock::new(BudgetConfig::default())),
            cache: Arc::new(RwLock::new(HashMap::new())),
            cache_ttl_secs: 3600, // 1 hour
        }
    }

    pub fn with_config(config: BudgetConfig) -> Self {
        Self {
            records: Arc::new(RwLock::new(Vec::new())),
            config: Arc::new(RwLock::new(config)),
            cache: Arc::new(RwLock::new(HashMap::new())),
            cache_ttl_secs: 3600,
        }
    }

    /// Get current config
    pub async fn get_config(&self) -> BudgetConfig {
        self.config.read().await.clone()
    }

    /// Update config
    pub async fn update_config(&self, config: BudgetConfig) {
        *self.config.write().await = config;
    }

    /// Check if request is within budget
    pub async fn check_budget(&self) -> Result<(), String> {
        let config = self.config.read().await.clone();
        let records = self.records.read().await;
        let now = Utc::now();

        // Check daily limit
        if let Some(daily_limit) = config.daily_limit {
            let daily_spend: f64 = records
                .iter()
                .filter(|r| (now - r.timestamp).num_hours() < 24)
                .map(|r| r.estimated_cost_usd)
                .sum();

            if daily_spend >= daily_limit {
                return Err(format!(
                    "Daily budget limit of ${:.2} reached (spent: ${:.4}). Try again tomorrow or increase the limit.",
                    daily_limit, daily_spend
                ));
            }
        }

        // Check monthly limit
        if let Some(monthly_limit) = config.monthly_limit {
            let monthly_spend: f64 = records
                .iter()
                .filter(|r| (now - r.timestamp).num_days() < 30)
                .map(|r| r.estimated_cost_usd)
                .sum();

            if monthly_spend >= monthly_limit {
                return Err(format!(
                    "Monthly budget limit of ${:.2} reached (spent: ${:.4}). Try again next month or increase the limit.",
                    monthly_limit, monthly_spend
                ));
            }
        }

        Ok(())
    }

    /// Record a completed API call
    pub async fn record_call(
        &self,
        provider: &str,
        model: &str,
        purpose: &str,
        input_tokens: u32,
        output_tokens: u32,
        mode: &str,
    ) {
        let pricing = ModelPricing::lookup(model).unwrap_or_else(|| ModelPricing {
            input_cost_per_1k: 0.003,
            output_cost_per_1k: 0.01,
            tier: "balanced".into(),
            capability_score: 0.75,
        });

        let cost = pricing.estimate_cost(input_tokens, output_tokens);

        let record = CostRecord {
            timestamp: Utc::now(),
            provider: provider.to_string(),
            model: model.to_string(),
            purpose: purpose.to_string(),
            input_tokens,
            output_tokens,
            estimated_cost_usd: cost,
            mode: mode.to_string(),
        };

        self.records.write().await.push(record);
    }

    /// Get cost summary
    pub async fn get_summary(&self) -> CostSummary {
        let records = self.records.read().await;
        let now = Utc::now();

        let daily: f64 = records.iter()
            .filter(|r| (now - r.timestamp).num_hours() < 24)
            .map(|r| r.estimated_cost_usd)
            .sum();

        let monthly: f64 = records.iter()
            .filter(|r| (now - r.timestamp).num_days() < 30)
            .map(|r| r.estimated_cost_usd)
            .sum();

        let total: f64 = records.iter().map(|r| r.estimated_cost_usd).sum();
        let total_tokens: u64 = records.iter()
            .map(|r| (r.input_tokens + r.output_tokens) as u64)
            .sum();

        let call_count = records.len() as u64;

        // Per-provider breakdown
        let mut by_provider: HashMap<String, f64> = HashMap::new();
        let mut by_model: HashMap<String, f64> = HashMap::new();
        let mut by_mode: HashMap<String, f64> = HashMap::new();

        for r in records.iter() {
            *by_provider.entry(r.provider.clone()).or_default() += r.estimated_cost_usd;
            *by_model.entry(r.model.clone()).or_default() += r.estimated_cost_usd;
            *by_mode.entry(r.mode.clone()).or_default() += r.estimated_cost_usd;
        }

        CostSummary {
            daily_spend: daily,
            monthly_spend: monthly,
            total_spend: total,
            total_tokens,
            total_calls: call_count,
            by_provider,
            by_model,
            by_mode,
            recent_records: records.iter().rev().take(50).cloned().collect(),
        }
    }

    /// Clear cost records
    pub async fn clear_records(&self) {
        self.records.write().await.clear();
    }

    /// Determine the best model for a given purpose and mode
    pub fn route_model<'a>(
        &self,
        purpose: &str,
        mode: &str,
        available_models: &[(&'a str, &'a str)], // (model, provider)
    ) -> Option<(&'a str, &'a str)> {
        let tier = match mode {
            "economy" | "cost-save" | "cheap" => "economy",
            "premium" | "best" | "maximum" => "premium",
            _ => "balanced",
        };

        let mut scored: Vec<_> = available_models
            .iter()
            .map(|&(model, provider)| {
                let pricing = ModelPricing::lookup(model).unwrap_or_else(|| ModelPricing {
                    input_cost_per_1k: 0.003,
                    output_cost_per_1k: 0.01,
                    tier: "balanced".into(),
                    capability_score: 0.75,
                });

                // Score: higher capability = better, lower cost = better (for economy)
                let cost_factor = if tier == "economy" {
                    // Prefer cheaper models strongly
                    1.0 / (pricing.input_cost_per_1k + pricing.output_cost_per_1k + 0.0001)
                } else if tier == "premium" {
                    // Prefer high capability, cost is secondary
                    pricing.capability_score * 100.0
                } else {
                    // Balanced: capability / cost ratio
                    pricing.capability_score / (pricing.input_cost_per_1k + pricing.output_cost_per_1k + 0.0001)
                };

                // Tier bonus
                let tier_bonus = match (tier, pricing.tier.as_str()) {
                    ("economy", "economy") => 1.5,
                    ("premium", "premium") => 1.5,
                    ("balanced", "balanced") => 1.2,
                    _ => 0.7,
                };

                let score = cost_factor * tier_bonus;
                (model, provider, score)
            })
            .collect();

        // Sort by score descending
        scored.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));

        scored.first().map(|(m, p, _)| (*m, *p))
    }

    /// Cache a response
    pub async fn cache_get(&self, key: &str) -> Option<String> {
        let cache = self.cache.read().await;
        if let Some((response, timestamp)) = cache.get(key) {
            if (Utc::now() - *timestamp).num_seconds() < self.cache_ttl_secs as i64 {
                return Some(response.clone());
            }
        }
        None
    }

    /// Store a response in cache
    pub async fn cache_set(&self, key: String, response: String) {
        let mut cache = self.cache.write().await;
        // Limit cache size
        if cache.len() > 10_000 {
            cache.clear();
        }
        cache.insert(key, (response, Utc::now()));
    }

    /// Clear cache
    pub async fn cache_clear(&self) {
        self.cache.write().await.clear();
    }

    /// Build a hash key for caching similar requests
    pub fn cache_key(messages: &[crate::providers::ChatMessage], system_prompt: Option<&str>) -> String {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};

        let mut hasher = DefaultHasher::new();
        if let Some(sp) = system_prompt {
            sp.hash(&mut hasher);
        }
        for msg in messages {
            msg.role.hash(&mut hasher);
            msg.content.hash(&mut hasher);
        }
        format!("cache_{:x}", hasher.finish())
    }

    /// Truncate context to save tokens when in economy mode
    pub fn truncate_context(&self, content: &str, config: &BudgetConfig) -> String {
        if !config.auto_truncate_context {
            return content.to_string();
        }

        let max_chars = config.max_context_tokens
            .map(|t| t as usize * 4) // ~4 chars per token
            .unwrap_or(128_000);

        if content.len() <= max_chars {
            return content.to_string();
        }

        // Keep first and last portions (beginning + end = more useful)
        let head_size = max_chars * 3 / 4;
        let tail_size = max_chars - head_size;

        let head = &content[..head_size.min(content.len())];
        let tail_start = (content.len() - tail_size).max(head_size);
        let tail = &content[tail_start..];

        format!("{}\n\n[... {} characters truncated to save tokens ...]\n\n{}",
            head,
            content.len() - head_size - tail_size,
            tail
        )
    }

    /// Get economy-optimized system prompt additions
    pub fn economy_system_prompt() -> &'static str {
        r#"
### Economy Mode (Token & Cost Saving)
You are running in economy mode to save tokens and costs. Follow these rules:
1. Be CONCISE – short sentences, no fluff, no repetition.
2. Skip pleasantries – go straight to the answer.
3. No markdown formatting unless strictly needed for code blocks.
4. Don't list options unless asked – give the BEST answer directly.
5. For code: output only the changed parts, not the full file when possible.
6. Skip explanations unless the user explicitly asks for them.
7. Use bullet points only when listing >2 items.
"#
    }

    /// Inject economy instructions into a system prompt
    pub fn inject_economy_prompt(base_prompt: &str, mode: &str) -> String {
        if mode == "economy" || mode == "cost-save" {
            format!("{}{}", base_prompt, Self::economy_system_prompt())
        } else {
            base_prompt.to_string()
        }
    }
}

/// Cost summary for API responses
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CostSummary {
    pub daily_spend: f64,
    pub monthly_spend: f64,
    pub total_spend: f64,
    pub total_tokens: u64,
    pub total_calls: u64,
    pub by_provider: HashMap<String, f64>,
    pub by_model: HashMap<String, f64>,
    pub by_mode: HashMap<String, f64>,
    pub recent_records: Vec<CostRecord>,
}
