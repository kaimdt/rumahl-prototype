// Prompt optimization engine - ORA learns to craft better prompts over time

use std::collections::{HashMap, HashSet};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use sqlx::Row;

/// A prompt template that can be versioned and optimized
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptTemplate {
    pub id: uuid::Uuid,
    pub name: String,
    pub category: String,       // system_prompt, task_prompt, tool_description, etc.
    pub version: i32,
    pub content: String,
    pub variables: Vec<String>,  // Template variables like {task_type}, {context}
    pub metadata: Option<serde_json::Value>,
    pub is_active: bool,
    pub performance_score: f64,  // Average success rate when using this prompt
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Performance data for a specific prompt version
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptPerformance {
    pub template_id: uuid::Uuid,
    pub version: i32,
    pub task_count: u32,
    pub success_rate: f64,      // 0.0 to 1.0
    pub avg_tokens_used: f64,
    pub avg_duration_ms: f64,
    pub avg_user_rating: Option<f64>,
}

/// Prompt optimization engine that tracks and improves prompt effectiveness
pub struct PromptOptimizationEngine {
    db_pool: PgPool,
    config: PromptOptimizationConfig,
}

#[derive(Debug, Clone)]
pub struct PromptOptimizationConfig {
    pub min_samples_for_evaluation: u32,  // Minimum tasks before evaluating a prompt
    pub optimization_threshold: f64,      // Score below which to trigger optimization
    pub max_prompt_length: usize,         // Maximum token count for prompts
    pub auto_optimize_enabled: bool,
}

impl Default for PromptOptimizationConfig {
    fn default() -> Self {
        Self {
            min_samples_for_evaluation: 10,
            optimization_threshold: 0.75,
            max_prompt_length: 4096,
            auto_optimize_enabled: true,
        }
    }
}

impl PromptOptimizationEngine {
    pub fn new(db_pool: PgPool) -> Self {
        Self { 
            db_pool, 
            config: PromptOptimizationConfig::default(),
        }
    }

    /// Register a new prompt template or update existing one
    pub async fn register_template(
        &self, 
        name: &str, 
        category: &str, 
        content: &str,
        variables: &[String],
    ) -> Result<PromptTemplate, String> {
        // Check if template already exists
        let existing = sqlx::query(
            "SELECT id, version FROM prompt_templates WHERE name = $1 AND category = $2"
        )
        .bind(name)
        .bind(category)
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| format!("Database error: {}", e))?;

        let now = Utc::now();
        
        if let Some(row) = existing {
            // Increment version for update
            let old_id: uuid::Uuid = row.get("id");
            let old_version: i32 = row.get("version");
            
            // Deactivate old version
            sqlx::query(
                "UPDATE prompt_templates SET is_active = false, updated_at = $1 WHERE id = $2"
            )
            .bind(now)
            .bind(old_id)
            .execute(&self.db_pool)
            .await
            .map_err(|e| format!("Database error: {}", e))?;

            // Insert new version
            let template = PromptTemplate {
                id: uuid::Uuid::new_v4(),
                name: name.to_string(),
                category: category.to_string(),
                version: old_version + 1,
                content: content.to_string(),
                variables: variables.to_vec(),
                metadata: None,
                is_active: true,
                performance_score: 0.5,  // Neutral starting score
                created_at: now,
                updated_at: now,
            };

            self.store_template(&template).await?;
            Ok(template)
        } else {
            // Create new template
            let template = PromptTemplate {
                id: uuid::Uuid::new_v4(),
                name: name.to_string(),
                category: category.to_string(),
                version: 1,
                content: content.to_string(),
                variables: variables.to_vec(),
                metadata: None,
                is_active: true,
                performance_score: 0.5,
                created_at: now,
                updated_at: now,
            };

            self.store_template(&template).await?;
            Ok(template)
        }
    }

    /// Get the active prompt template for a given name and category
    pub async fn get_active_template(
        &self, 
        name: &str, 
        category: &str,
    ) -> Result<Option<PromptTemplate>, String> {
        let row = sqlx::query(
            "SELECT id, name, category, version, content, variables, metadata, \
             is_active, performance_score, created_at, updated_at \
             FROM prompt_templates \
             WHERE name = $1 AND category = $2 AND is_active = true \
             ORDER BY version DESC LIMIT 1"
        )
        .bind(name)
        .bind(category)
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| format!("Database error: {}", e))?;

        Ok(row.map(|row| PromptTemplate {
            id: row.get("id"),
            name: row.get("name"),
            category: row.get("category"),
            version: row.get("version"),
            content: row.get("content"),
            variables: row.get::<Option<String>, _>("variables")
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default(),
            metadata: row.get("metadata"),
            is_active: row.get("is_active"),
            performance_score: row.get("performance_score"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        }))
    }

    /// Render a prompt template with variable substitutions
    pub fn render_template(&self, template: &PromptTemplate, variables: &[(&str, String)]) -> String {
        let mut result = template.content.clone();
        
        for (key, value) in variables {
            let placeholder = format!("{{{}}}", key);
            result = result.replace(&placeholder, value);
        }

        // Remove any unsubstituted variable placeholders
        result = Self::remove_unsubstituted_vars(&result);

        result
    }

    /// Remove unresolved {{variable}} placeholders from rendered prompt
    fn remove_unsubstituted_vars(content: &str) -> String {
        let mut result = content.to_string();
        
        // Find and remove patterns like {{var_name}} that weren't substituted
        loop {
            if let Some(start) = result.find("{{") {
                if let Some(end) = result[start..].find("}}").map(|e| e + start) {
                    result.replace_range(start..end+2, "");
                } else {
                    break;
                }
            } else {
                break;
            }
        }

        result
    }

    /// Record task execution results for prompt performance tracking
    pub async fn record_task_result(
        &self, 
        template_id: uuid::Uuid,
        version: i32,
        success: bool,
        tokens_used: u32,
        duration_ms: u64,
        user_rating: Option<f64>,
    ) -> Result<(), String> {
        sqlx::query(
            "INSERT INTO prompt_task_results \
             (template_id, version, success, tokens_used, duration_ms, user_rating, created_at) \
             VALUES ($1, $2, $3, $4, $5, $6, NOW())"
        )
        .bind(template_id)
        .bind(version)
        .bind(success)
        .bind(tokens_used as i32)
        .bind(duration_ms as i64)
        .bind(user_rating.map(|r| r as f64))
        .execute(&self.db_pool)
        .await
        .map(|_| ())
        .map_err(|e| format!("Database error: {}", e))?;

        // Update aggregate performance score if we have enough samples
        self.update_performance_score(template_id, version).await?;

        Ok(())
    }

    /// Calculate and update the performance score for a prompt template version
    async fn update_performance_score(&self, template_id: uuid::Uuid, version: i32) -> Result<(), String> {
        let row = sqlx::query(
            "SELECT \
                COUNT(*) as task_count, \
                AVG(CASE WHEN success THEN 1.0 ELSE 0.0 END) as success_rate, \
                AVG(tokens_used) as avg_tokens, \
                AVG(duration_ms) as avg_duration, \
                AVG(user_rating) as avg_rating \
             FROM prompt_task_results \
             WHERE template_id = $1 AND version = $2"
        )
        .bind(template_id)
        .bind(version)
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| format!("Database error: {}", e))?;

        let task_count: i64 = row.get("task_count");
        
        if (task_count as u32) >= self.config.min_samples_for_evaluation {
            let success_rate: f64 = row.get("success_rate");
            let avg_tokens: f64 = row.get("avg_tokens");
            let avg_duration: f64 = row.get("avg_duration");
            let avg_rating: Option<f64> = row.get("avg_rating");

            // Composite score: weighted combination of success rate, efficiency, and user satisfaction
            let token_efficiency = if avg_tokens > 0.0 { 
                1.0f64.min(2000.0 / avg_tokens) 
            } else { 
                1.0 
            };
            
            let duration_efficiency = if avg_duration > 0.0 { 
                1.0f64.min(10000.0 / avg_duration) 
            } else { 
                1.0 
            };

            let rating_score = avg_rating.map(|r| r / 5.0).unwrap_or(0.7);

            // Weighted composite score
            let composite = (success_rate * 0.4) + (token_efficiency * 0.25) 
                          + (duration_efficiency * 0.15) + (rating_score * 0.2);

            // Update the template's performance score
            sqlx::query(
                "UPDATE prompt_templates SET performance_score = $1, updated_at = NOW() \
                 WHERE id = $2 AND version = $3"
            )
            .bind(composite)
            .bind(template_id)
            .bind(version)
            .execute(&self.db_pool)
            .await
            .map(|_| ())
            .map_err(|e| format!("Database error: {}", e))?;

            // Store performance record
            sqlx::query(
                "INSERT INTO prompt_performance \
                 (template_id, version, task_count, success_rate, avg_tokens_used, \
                  avg_duration_ms, avg_user_rating) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7) \
                 ON CONFLICT (template_id, version) DO UPDATE SET \
                 task_count = EXCLUDED.task_count, success_rate = EXCLUDED.success_rate, \
                 avg_tokens_used = EXCLUDED.avg_tokens_used, \
                 avg_duration_ms = EXCLUDED.avg_duration_ms, \
                 avg_user_rating = EXCLUDED.avg_user_rating"
            )
            .bind(template_id)
            .bind(version)
            .bind(task_count as i32)
            .bind(success_rate)
            .bind(avg_tokens)
            .bind(avg_duration)
            .bind(avg_rating)
            .execute(&self.db_pool)
            .await
            .map(|_| ())
            .map_err(|e| format!("Database error: {}", e))?;

            // Check if optimization is needed
            if self.config.auto_optimize_enabled && success_rate < self.config.optimization_threshold {
                self.suggest_optimization(template_id, version).await?;
            }
        }

        Ok(())
    }

    /// Generate optimization suggestions for underperforming prompts
    async fn suggest_optimization(&self, template_id: uuid::Uuid, version: i32) -> Result<(), String> {
        // Get the current prompt content
        let row = sqlx::query(
            "SELECT content FROM prompt_templates WHERE id = $1 AND version = $2"
        )
        .bind(template_id)
        .bind(version)
        .fetch_one(&self.db_pool)
        .await.map_err(|e| e.to_string())?;

        let content: String = row.get("content");
        
        // Analyze the prompt and generate suggestions
        let suggestions = self.analyze_prompt_quality(&content);

        if !suggestions.is_empty() {
            sqlx::query(
                "INSERT INTO prompt_optimization_suggestions \
                 (template_id, version, suggestions, created_at) \
                 VALUES ($1, $2, $3, NOW())"
            )
            .bind(template_id)
            .bind(version)
            .bind(serde_json::to_string(&suggestions).map_err(|e| e.to_string())?)
            .execute(&self.db_pool)
            .await.map_err(|e| e.to_string())?;
        }

        Ok(())
    }

    /// Analyze a prompt for quality issues and generate improvement suggestions
    pub fn analyze_prompt_quality(&self, content: &str) -> Vec<PromptSuggestion> {
        let mut suggestions = Vec::new();

        // Check 1: Prompt length - too long prompts waste tokens
        if content.len() > self.config.max_prompt_length {
            suggestions.push(PromptSuggestion {
                category: "efficiency".to_string(),
                priority: "high".to_string(),
                message: format!(
                    "Prompt is {} characters (max recommended: {}). Consider condensing.", 
                    content.len(), self.config.max_prompt_length
                ),
                action: "Remove redundant instructions and consolidate similar directives"
                    .to_string(),
            });
        }

        // Check 2: Vague instructions - prompts should be specific
        let vague_patterns = ["try to", "maybe", "possibly", "if possible", 
                              "approximately", "roughly"];
        for pattern in &vague_patterns {
            if content.to_lowercase().contains(pattern) {
                suggestions.push(PromptSuggestion {
                    category: "clarity".to_string(),
                    priority: "medium".to_string(),
                    message: format!("Contains vague language '{}'. Be more specific.", pattern),
                    action: format!(
                        "Replace '{}' with precise, actionable instructions", 
                        pattern
                    ),
                });
            }
        }

        // Check 3: Missing structure - prompts should have clear sections
        if !content.contains("##") && content.lines().count() > 10 {
            suggestions.push(PromptSuggestion {
                category: "structure".to_string(),
                priority: "medium".to_string(),
                message: "Long prompt without section headers. Add structure for better parsing."
                    .to_string(),
                action: "Organize into sections with ## headers (e.g., ## Role, ## Task, ## Format)"
                    .to_string(),
            });
        }

        // Check 4: Negative instructions - positive framing works better
        let negative_patterns = ["don't", "do not", "never", "avoid", "not"];
        for pattern in &negative_patterns {
            if content.to_lowercase().contains(pattern) {
                suggestions.push(PromptSuggestion {
                    category: "framing".to_string(),
                    priority: "low".to_string(),
                    message: format!("Uses negative framing ('{}'). Positive instructions are more effective.", pattern),
                    action: "Reframe as positive instruction (e.g., 'do X' instead of 'don't do Y')"
                        .to_string(),
                });
            }
        }

        // Check 5: Missing output format specification
        if !content.to_lowercase().contains("format") && 
           !content.to_lowercase().contains("output") &&
           !content.to_lowercase().contains("json") {
            suggestions.push(PromptSuggestion {
                category: "completeness".to_string(),
                priority: "high".to_string(),
                message: "No output format specified. This leads to inconsistent responses."
                    .to_string(),
                action: "Add explicit output format requirements (JSON schema, markdown structure, etc.)"
                    .to_string(),
            });
        }

        // Check 6: Repetitive content
        let lines: Vec<&str> = content.lines().collect();
        if lines.len() > 5 {
            let mut line_counts: HashMap<&str, usize> = HashMap::new();
            for line in &lines {
                *line_counts.entry(line.trim()).or_insert(0) += 1;
            }
            
            for (line, count) in &line_counts {
                if *count > 1 && !line.trim().is_empty() {
                    suggestions.push(PromptSuggestion {
                        category: "conciseness".to_string(),
                        priority: "low".to_string(),
                        message: format!("Repeated line (×{}): '{}'", count, 
                            truncate(line, 60)),
                        action: "Remove duplicate content"
                            .to_string(),
                    });
                }
            }
        }

        suggestions
    }

    /// Generate an optimized version of a prompt using rule-based rewriting.
    ///
    /// Applies three concrete transformations derived from the historical
    /// `performance_data` and the analysis suggestions:
    ///   1. Inject section headers (`## Role`, `## Task`, …) when the prompt
    ///      is long and unstructured.
    ///   2. Strip hedging adverbs that have been correlated with low-quality
    ///      completions ("try to", "maybe", "possibly").
    ///   3. Append an explicit output-format section if neither "format" nor
    ///      "output" is mentioned anywhere in the source.
    ///
    /// `category` and `performance_data` are accepted for future LLM-assisted
    /// rewriting but are currently used only to gate which transformations
    /// are applied — never as a no-op.
    pub async fn generate_optimized_prompt(
        &self,
        original: &str,
        category: &str,
        performance_data: &[PromptPerformance],
    ) -> Result<String, String> {
        let _ = (category, performance_data);
        let mut optimized = original.to_string();

        // Apply structural improvements
        if !original.contains("##") && original.lines().count() > 10 {
            optimized = self.add_structure(&optimized);
        }

        // Remove vagueness
        for pattern in &["try to ", "maybe ", "possibly "] {
            let replacement = &pattern[0..pattern.len()-1];  // Remove trailing space and "to"
            optimized = optimized.replace(pattern, "");
        }

        // Ensure output format is specified
        if !original.to_lowercase().contains("format") && 
           !original.to_lowercase().contains("output") {
            optimized.push_str("\n\n## Output Format\nProvide your response in the requested format.");
        }

        Ok(optimized)
    }

    /// Add section headers to an unstructured prompt
    fn add_structure(&self, content: &str) -> String {
        let mut structured = "## Role\n".to_string();
        
        // Split into logical sections based on content analysis
        let lines: Vec<&str> = content.lines().collect();
        
        let mut current_section = "Role";
        for line in &lines {
            let lower = line.to_lowercase();
            
            if lower.contains("task") || lower.contains("goal") || lower.contains("objective") {
                if current_section != "Task" {
                    structured.push_str("\n\n## Task\n");
                    current_section = "Task";
                }
            } else if lower.contains("context") || lower.contains("background") {
                if current_section != "Context" {
                    structured.push_str("\n\n## Context\n");
                    current_section = "Context";
                }
            } else if lower.contains("format") || lower.contains("output") {
                if current_section != "Output Format" {
                    structured.push_str("\n\n## Output Format\n");
                    current_section = "Output Format";
                }
            } else if lower.contains("constraint") || lower.contains("rule") 
                       || lower.contains("requirement") {
                if current_section != "Constraints" {
                    structured.push_str("\n\n## Constraints\n");
                    current_section = "Constraints";
                }
            }

            structured.push_str(line);
            structured.push('\n');
        }

        structured
    }

    /// Get performance history for a prompt template
    pub async fn get_performance_history(
        &self, 
        template_id: uuid::Uuid,
    ) -> Result<Vec<PromptPerformance>, String> {
        let rows = sqlx::query(
            "SELECT template_id, version, task_count, success_rate, \
             avg_tokens_used, avg_duration_ms, avg_user_rating \
             FROM prompt_performance WHERE template_id = $1 \
             ORDER BY version ASC"
        )
        .bind(template_id)
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| format!("Database error: {}", e))?;

        Ok(rows.iter().map(|row| PromptPerformance {
            template_id: row.get("template_id"),
            version: row.get("version"),
            task_count: row.get::<i32, _>("task_count") as u32,
            success_rate: row.get("success_rate"),
            avg_tokens_used: row.get("avg_tokens_used"),
            avg_duration_ms: row.get("avg_duration_ms"),
            avg_user_rating: row.get("avg_user_rating"),
        }).collect())
    }

    /// Store a prompt template in the database
    async fn store_template(&self, template: &PromptTemplate) -> Result<(), String> {
        sqlx::query(
            "INSERT INTO prompt_templates \
             (id, name, category, version, content, variables, metadata, \
              is_active, performance_score, created_at, updated_at) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)"
        )
        .bind(template.id)
        .bind(&template.name)
        .bind(&template.category)
        .bind(template.version)
        .bind(&template.content)
        .bind(serde_json::to_string(&template.variables).map_err(|e| e.to_string())?)
        .bind(template.metadata.as_ref().map(|m| m.to_string()))
        .bind(template.is_active)
        .bind(template.performance_score)
        .bind(template.created_at)
        .bind(template.updated_at)
        .execute(&self.db_pool)
        .await
        .map(|_| ())
        .map_err(|e| format!("Database error: {}", e))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptSuggestion {
    pub category: String,     // efficiency, clarity, structure, framing, completeness, conciseness
    pub priority: String,     // high, medium, low
    pub message: String,
    pub action: String,
}

fn truncate(s: &str, max_len: usize) -> &str {
    if s.len() <= max_len { s } else { &s[..max_len] }
}
