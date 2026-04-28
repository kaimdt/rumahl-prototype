use sqlx::Row;
// Self-reflection system - ORA learns from its experiences and improves over time

use uuid::Uuid;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

/// A self-reflection entry where ORA analyzes its performance and learns
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelfReflection {
    pub id: Uuid,
    pub reflection_type: String,  // failure_analysis, success_pattern, optimization, security_review
    pub context: String,          // What situation triggered this reflection
    pub observation: String,      // What ORA observed
    pub lesson_learned: Option<String>,
    pub action_items: Option<serde_json::Value>,
    pub knowledge_updated: bool,  // Whether this led to updating the knowledge base
    pub related_task_id: Option<Uuid>,
    pub related_proposal_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}

/// Performance metrics collected during task execution for reflection analysis
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerformanceMetrics {
    pub task_type: String,
    pub duration_ms: u64,
    pub tokens_used: u32,
    pub tool_calls: usize,
    pub success_rate: f64,  // 0.0 to 1.0
    pub error_count: u32,
    pub user_satisfaction: Option<f64>,  // from feedback
}

/// Reflection engine that drives ORA's continuous learning
pub struct ReflectionEngine {
    pub db_pool: PgPool,
    config: ReflectionConfig,
}

#[derive(Debug, Clone)]
pub struct ReflectionConfig {
    pub reflection_interval_minutes: u32,
    pub max_reflections_per_session: usize,
    pub auto_apply_lessons: bool,
    pub feedback_weight: f64,       // Weight of user feedback in learning (0.0-1.0)
    pub failure_analysis_depth: i32, // How deeply to analyze failures (1=surface, 5=deep)
}

impl Default for ReflectionConfig {
    fn default() -> Self {
        Self {
            reflection_interval_minutes: 60,
            max_reflections_per_session: 5,
            auto_apply_lessons: true,
            feedback_weight: 0.7,
            failure_analysis_depth: 3,
        }
    }
}

impl ReflectionEngine {
    pub fn new(db_pool: PgPool) -> Self {
        Self { db_pool, config: ReflectionConfig::default() }
    }

    /// Analyze recent task failures and generate insights
    pub async fn analyze_failures(&self) -> Result<Vec<SelfReflection>, String> {
        // Get failed tasks from the past week
        let cutoff = Utc::now() - chrono::TimeDelta::days(7);
        
        let rows = sqlx::query(
            "SELECT id, task_type, error_message, duration_ms, created_at \
             FROM task_executions \
             WHERE status = 'failed' AND created_at > $1 \
             ORDER BY created_at DESC LIMIT 20"
        )
        .bind(cutoff)
        .fetch_all(&self.db_pool)
        .await.map_err(|e| e.to_string())?;

        if rows.is_empty() {
            return Ok(Vec::new());
        }

        let mut reflections = Vec::new();

        // Group failures by type and pattern
        let mut failure_patterns: std::collections::HashMap<String, Vec<String>> = 
            std::collections::HashMap::new();

        for row in &rows {
            let _task_type: String = row.get("task_type");
            let error_msg: String = row.get("error_message");
            
            // Categorize the failure
            let category = self.categorize_failure(&error_msg);
            failure_patterns.entry(category).or_default().push(error_msg);
        }

        // Generate reflection for each pattern
        for (category, errors) in failure_patterns {
            if errors.len() >= 2 {  // Only reflect on recurring issues
                reflections.push(SelfReflection {
                    id: Uuid::new_v4(),
                    reflection_type: "failure_analysis".to_string(),
                    context: format!("Recurring {} failures detected ({} occurrences)", category, errors.len()),
                    observation: self.analyze_failure_pattern(&category, &errors),
                    lesson_learned: Some(self.generate_lesson(&category, &errors)),
                    action_items: Some(serde_json::to_value(self.generate_action_items(&category, &errors)).unwrap_or_default()),
                    knowledge_updated: false,
                    related_task_id: None,
                    related_proposal_id: None,
                    created_at: Utc::now(),
                });
            }
        }

        // Store reflections in database
        for reflection in &reflections {
            self.store_reflection(reflection).await?;
        }

        Ok(reflections)
    }

    /// Categorize a failure based on error message patterns
    fn categorize_failure(&self, error: &str) -> String {
        let lower = error.to_lowercase();
        
        if lower.contains("timeout") || lower.contains("timed out") {
            "timeout".to_string()
        } else if lower.contains("permission") || lower.contains("access denied") 
            || lower.contains("unauthorized") {
            "authentication".to_string()
        } else if lower.contains("connection") || lower.contains("network") 
            || lower.contains("dns") {
            "connectivity".to_string()
        } else if lower.contains("provider") || lower.contains("api key") 
            || lower.contains("rate limit") {
            "provider_error".to_string()
        } else if lower.contains("parse") || lower.contains("json") 
            || lower.contains("format") {
            "data_formatting".to_string()
        } else if lower.contains("memory") || lower.contains("allocation") {
            "resource_limit".to_string()
        } else {
            "logic_error".to_string()
        }
    }

    /// Analyze a pattern of failures to understand root causes
    fn analyze_failure_pattern(&self, category: &str, errors: &[String]) -> String {
        let mut analysis = format!("## {} Failure Pattern Analysis\n\n", category);
        
        // Count frequency of each specific error message
        let mut error_counts: std::collections::HashMap<&str, usize> = 
            std::collections::HashMap::new();
        for error in errors {
            *error_counts.entry(error).or_insert(0) += 1;
        }

        analysis.push_str("### Error Distribution:\n");
        let mut sorted: Vec<_> = error_counts.into_iter().collect();
        sorted.sort_by(|a, b| b.1.cmp(&a.1));

        for (error, count) in &sorted {
            analysis.push_str(&format!("- \"{}\" (×{})\n", 
                truncate(error, 80), count));
        }

        // Suggest root cause based on category
        analysis.push_str("\n### Likely Root Causes:\n");
        match category {
            "timeout" => {
                analysis.push_str("- Operations taking longer than configured timeout\n");
                analysis.push_str("- Network latency to AI provider endpoints\n");
                analysis.push_str("- Complex tasks exceeding token limits\n");
            }
            "authentication" => {
                analysis.push_str("- Expired or invalid API credentials\n");
                analysis.push_str("- Missing permission scopes in integrations\n");
                analysis.push_str("- Token refresh mechanism not working\n");
            }
            "connectivity" => {
                analysis.push_str("- Network configuration issues (DNS, firewall)\n");
                analysis.push_str("- Service endpoint unreachable or down\n");
                analysis.push_str("- SSL/TLS certificate problems\n");
            }
            "provider_error" => {
                analysis.push_str("- AI provider API changes or deprecations\n");
                analysis.push_str("- Rate limiting due to high request volume\n");
                analysis.push_str("- Model compatibility issues\n");
            }
            _ => {
                analysis.push_str("- Review error messages for specific failure patterns\n");
                analysis.push_str("- Check recent code changes that may have introduced bugs\n");
            }
        }

        analysis.to_string()
    }

    /// Generate a lesson learned from failure pattern
    fn generate_lesson(&self, category: &str, errors: &[String]) -> String {
        match category {
            "timeout" => format!(
                "Increase timeout thresholds for {} operations. Consider implementing \
                 retry logic with exponential backoff.", 
                category
            ),
            "authentication" => format!(
                "Implement credential rotation and validation checks before task execution. \
                 Add pre-flight authentication verification."
            ),
            "connectivity" => format!(
                "Add connection health checks and fallback endpoints. Implement circuit breaker \
                 pattern for external service calls."
            ),
            "provider_error" => format!(
                "Implement provider failover mechanism. Cache responses where possible to \
                 reduce API dependency. Add rate limit awareness."
            ),
            _ => format!(
                "Review and improve error handling in {} scenarios. Consider adding more \
                 specific error types and recovery strategies.", 
                category
            ),
        }
    }

    /// Generate action items from failure analysis
    fn generate_action_items(&self, category: &str, errors: &[String]) -> Vec<String> {
        let mut items = Vec::new();
        
        match category {
            "timeout" => {
                items.push("Review and increase timeout configurations".to_string());
                items.push("Implement retry logic with exponential backoff".to_string());
                items.push("Add progress indicators for long-running operations".to_string());
            }
            "authentication" => {
                items.push("Audit all API credential storage and rotation".to_string());
                items.push("Add pre-execution authentication validation".to_string());
                items.push("Implement automatic token refresh mechanism".to_string());
            }
            "connectivity" => {
                items.push("Add connection health monitoring".to_string());
                items.push("Implement circuit breaker for external services".to_string());
                items.push("Configure fallback endpoints and retry policies".to_string());
            }
            "provider_error" => {
                items.push("Research provider API changes and update integrations".to_string());
                items.push("Implement multi-provider failover capability".to_string());
                items.push("Add request caching to reduce API dependency".to_string());
            }
            _ => {
                items.push(format!("Investigate {} failures in detail", category));
                items.push("Review recent code changes for regression introduction".to_string());
                items.push("Add more comprehensive error handling and logging".to_string());
            }
        }

        // Always add these general improvement items
        items.push("Update knowledge base with failure patterns and solutions".to_string());
        items.push("Consider creating self-evolution proposal for systematic fix".to_string());

        items
    }

    /// Analyze successful task patterns to reinforce good practices
    pub async fn analyze_successes(&self) -> Result<Vec<SelfReflection>, String> {
        let cutoff = Utc::now() - chrono::TimeDelta::days(7);
        
        let rows = sqlx::query(
            "SELECT id, task_type, duration_ms, tokens_used, tool_calls, created_at \
             FROM task_executions \
             WHERE status = 'completed' AND created_at > $1 \
             ORDER BY duration_ms ASC LIMIT 20"
        )
        .bind(cutoff)
        .fetch_all(&self.db_pool)
        .await.map_err(|e| e.to_string())?;

        if rows.is_empty() {
            return Ok(Vec::new());
        }

        let mut reflections = Vec::new();

        // Find most efficient task patterns (fastest execution, fewest tool calls)
        for row in &rows {
            let task_type: String = row.get("task_type");
            let duration_ms: i64 = row.get("duration_ms");
            let tokens_used: i32 = row.get("tokens_used");
            let tool_calls: i32 = row.get("tool_calls");

            if duration_ms < 5000 && tool_calls <= 3 {
                reflections.push(SelfReflection {
                    id: Uuid::new_v4(),
                    reflection_type: "success_pattern".to_string(),
                    context: format!("Highly efficient {} task execution", task_type),
                    observation: format!(
                        "Task completed in {}ms using {} tokens and {} tool calls. \
                         This represents an optimal execution pattern.",
                        duration_ms, tokens_used, tool_calls
                    ),
                    lesson_learned: Some(format!(
                        "{} tasks can be optimized to complete quickly with minimal tool usage. \
                         Apply this pattern to similar task types.",
                        task_type
                    )),
                    action_items: Some(serde_json::Value::Array(vec![
                        serde_json::Value::String(format!("Document {} execution pattern as best practice", task_type)),
                        serde_json::Value::String("Store optimization strategy in knowledge base".to_string()),
                    ])),
                    knowledge_updated: true,
                    related_task_id: Some(row.get::<Uuid, _>("id")),
                    related_proposal_id: None,
                    created_at: Utc::now(),
                });
            }
        }

        for reflection in &reflections {
            self.store_reflection(reflection).await?;
        }

        Ok(reflections)
    }

    /// Process user feedback and incorporate into learning
    pub async fn process_feedback(
        &self, 
        task_id: Uuid, 
        feedback: &str, 
        rating: f64,
    ) -> Result<SelfReflection, String> {
        // Determine sentiment from feedback text
        let sentiment = self.analyze_sentiment(feedback);
        
        let reflection = SelfReflection {
            id: Uuid::new_v4(),
            reflection_type: "user_feedback".to_string(),
            context: format!("User feedback for task {}", task_id),
            observation: feedback.to_string(),
            lesson_learned: if rating < 3.0 {
                Some(format!(
                    "User rated this {}/5 and noted: '{}'. Need to improve approach.", 
                    rating, truncate(feedback, 100)
                ))
            } else {
                Some(format!("User satisfied ({} rating). Current approach is effective.", rating))
            },
            action_items: if rating < 3.0 {
                Some(serde_json::Value::Array(vec![
                    serde_json::Value::String("Review task execution strategy".to_string()),
                    serde_json::Value::String(format!("Address user concern: '{}'", truncate(feedback, 50))),
                ]))
            } else {
                None
            },
            knowledge_updated: false,
            related_task_id: Some(task_id),
            related_proposal_id: None,
            created_at: Utc::now(),
        };

        self.store_reflection(&reflection).await?;

        // Store feedback in knowledge base if it reveals important insights
        if sentiment == "negative" && rating < 2.0 {
            sqlx::query(
                "INSERT INTO knowledge_base (topic, content, source, created_at) \
                 VALUES ('user_feedback', $1, 'direct_feedback', NOW())"
            )
            .bind(feedback)
            .execute(&self.db_pool)
            .await.map_err(|e| e.to_string())?;
        }

        Ok(reflection)
    }

    /// Analyze sentiment of user feedback text
    fn analyze_sentiment(&self, text: &str) -> &'static str {
        let lower = text.to_lowercase();
        
        let positive_words = ["great", "excellent", "perfect", "good", "works", "thanks", 
                              "awesome", "love", "improved", "better"];
        let negative_words = ["bad", "wrong", "broken", "error", "bug", "fail", "poor", 
                              "slow", "doesn't work", "not working", "issue"];

        let mut positive_count = 0;
        let mut negative_count = 0;

        for word in &positive_words {
            if lower.contains(word) { positive_count += 1; }
        }
        for word in &negative_words {
            if lower.contains(word) { negative_count += 1; }
        }

        if positive_count > negative_count { "positive" }
        else if negative_count > positive_count { "negative" }
        else { "neutral" }
    }

    /// Run a comprehensive self-assessment across all dimensions
    pub async fn run_self_assessment(&self) -> Result<SelfAssessmentReport, String> {
        let mut report = SelfAssessmentReport {
            timestamp: Utc::now(),
            ..Default::default()
        };

        // Analyze recent failures
        let failure_reflections = self.analyze_failures().await?;
        report.failure_patterns = failure_reflections.len();
        
        // Analyze successful patterns
        let success_reflections = self.analyze_successes().await?;
        report.success_patterns = success_reflections.len();

        // Calculate overall performance metrics
        let cutoff_30d = Utc::now() - chrono::TimeDelta::days(30);
        
        let row = sqlx::query(
            "SELECT \
                COUNT(*) as total_tasks, \
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_tasks, \
                AVG(duration_ms) as avg_duration, \
                AVG(tokens_used) as avg_tokens \
             FROM task_executions WHERE created_at > $1"
        )
        .bind(cutoff_30d)
        .fetch_one(&self.db_pool)
        .await.map_err(|e| e.to_string())?;

        let total: i64 = row.get("total_tasks");
        let completed: i64 = row.get("completed_tasks");
        
        report.total_tasks_30d = total as u32;
        report.completed_tasks_30d = completed as u32;
        report.success_rate = if total > 0 { 
            (completed as f64) / (total as f64) 
        } else { 
            1.0 
        };
        report.avg_duration_ms = row.get::<i64, _>("avg_duration") as u64;
        report.avg_tokens_per_task = row.get::<i64, _>("avg_tokens") as u32;

        // Assess knowledge base health
        let kb_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM knowledge_base"
        )
        .fetch_one(&self.db_pool)
        .await.map_err(|e| e.to_string())?;
        
        report.knowledge_entries = kb_count as u32;

        // Generate overall assessment
        report.overall_assessment = self.generate_overall_assessment(&report);
        report.recommendations = self.generate_recommendations(&report);

        Ok(report)
    }

    /// Generate a natural language overall assessment
    fn generate_overall_assessment(&self, report: &SelfAssessmentReport) -> String {
        let mut assessment = String::from("## ORA Self-Assessment Report\n\n");

        // Performance evaluation
        if report.success_rate >= 0.95 {
            assessment.push_str("### Overall Status: EXCELLENT ✅\n");
            assessment.push_str(&format!(
                "Task success rate of {:.1}% over the past 30 days is outstanding.\n\n", 
                report.success_rate * 100.0
            ));
        } else if report.success_rate >= 0.85 {
            assessment.push_str("### Overall Status: GOOD 👍\n");
            assessment.push_str(&format!(
                "Task success rate of {:.1}% is solid but has room for improvement.\n\n", 
                report.success_rate * 100.0
            ));
        } else if report.success_rate >= 0.70 {
            assessment.push_str("### Overall Status: NEEDS IMPROVEMENT ⚠️\n");
            assessment.push_str(&format!(
                "Task success rate of {:.1}% indicates significant issues to address.\n\n", 
                report.success_rate * 100.0
            ));
        } else {
            assessment.push_str("### Overall Status: CRITICAL 🚨\n");
            assessment.push_str(&format!(
                "Task success rate of {:.1}% requires immediate attention and systematic fixes.\n\n", 
                report.success_rate * 100.0
            ));
        }

        // Efficiency metrics
        assessment.push_str("### Efficiency Metrics:\n");
        assessment.push_str(&format!("- Average task duration: {}ms\n", report.avg_duration_ms));
        assessment.push_str(&format!("- Average tokens per task: {}\n", report.avg_tokens_per_task));
        assessment.push_str(&format!("- Knowledge base entries: {}\n\n", report.knowledge_entries));

        // Pattern analysis summary
        if report.failure_patterns > 0 {
            assessment.push_str(&format!(
                "### Areas of Concern:\n- {} recurring failure pattern(s) detected\n", 
                report.failure_patterns
            ));
        }
        if report.success_patterns > 0 {
            assessment.push_str(&format!(
                "- {} successful execution pattern(s) identified for reinforcement\n", 
                report.success_patterns
            ));
        }

        assessment.to_string()
    }

    /// Generate actionable recommendations based on assessment
    fn generate_recommendations(&self, report: &SelfAssessmentReport) -> Vec<String> {
        let mut recommendations = Vec::new();

        if report.success_rate < 0.90 {
            recommendations.push("Priority: Improve task success rate through better error handling and retry logic".to_string());
        }

        if report.avg_duration_ms > 30000 {
            recommendations.push("Optimize task execution speed - consider caching, parallel processing, or prompt optimization".to_string());
        }

        if report.avg_tokens_per_task > 4000 {
            recommendations.push("Reduce token usage by optimizing prompts and reducing unnecessary context".to_string());
        }

        if report.knowledge_entries < 10 {
            recommendations.push("Expand knowledge base - more systematic learning will improve future performance".to_string());
        }

        if report.failure_patterns > 3 {
            recommendations.push("Multiple failure patterns detected - run deep self-evolution cycle to address systematically".to_string());
        }

        // Always recommend continuous improvement
        recommendations.push("Schedule regular self-assessment cycles (weekly recommended)".to_string());
        recommendations.push("Review and update system prompts based on learned patterns".to_string());

        recommendations
    }

    /// Store a reflection in the database
    async fn store_reflection(&self, reflection: &SelfReflection) -> Result<(), String> {
        sqlx::query(
            "INSERT INTO self_reflections \
             (id, reflection_type, context, observation, lesson_learned, action_items, \
              knowledge_updated, related_task_id, related_proposal_id, created_at) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)"
        )
        .bind(reflection.id)
        .bind(&reflection.reflection_type)
        .bind(&reflection.context)
        .bind(&reflection.observation)
        .bind(reflection.lesson_learned.as_deref())
        .bind(
            reflection.action_items
                .as_ref()
                .map(|items| serde_json::to_string(items).ok()),
        )
        .bind(reflection.knowledge_updated)
        .bind(reflection.related_task_id)
        .bind(reflection.related_proposal_id)
        .bind(reflection.created_at)
        .execute(&self.db_pool)
        .await.map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Get recent reflections for a specific type
    pub async fn get_reflections(
        &self, 
        reflection_type: Option<&str>,
        limit: i64,
    ) -> Result<Vec<SelfReflection>, String> {
        let rows = if let Some(rtype) = reflection_type {
            sqlx::query(
                "SELECT id, reflection_type, context, observation, lesson_learned, \
                 action_items, knowledge_updated, related_task_id, related_proposal_id, created_at \
                 FROM self_reflections WHERE reflection_type = $1 \
                 ORDER BY created_at DESC LIMIT $2"
            )
            .bind(rtype)
            .bind(limit)
            .fetch_all(&self.db_pool)
            .await.map_err(|e| e.to_string())?
        } else {
            sqlx::query(
                "SELECT id, reflection_type, context, observation, lesson_learned, \
                 action_items, knowledge_updated, related_task_id, related_proposal_id, created_at \
                 FROM self_reflections ORDER BY created_at DESC LIMIT $1"
            )
            .bind(limit)
            .fetch_all(&self.db_pool)
            .await.map_err(|e| e.to_string())?
        };

        Ok(rows.iter().map(|row| SelfReflection {
            id: row.get("id"),
            reflection_type: row.get("reflection_type"),
            context: row.get("context"),
            observation: row.get("observation"),
            lesson_learned: row.get("lesson_learned"),
            action_items: row.get::<Option<serde_json::Value>, _>("action_items"),
            knowledge_updated: row.get("knowledge_updated"),
            related_task_id: row.get("related_task_id"),
            related_proposal_id: row.get("related_proposal_id"),
            created_at: row.get("created_at"),
        }).collect())
    }
}


/// Comprehensive self-assessment report
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SelfAssessmentReport {
    pub timestamp: DateTime<Utc>,
    
    // Task performance metrics (30-day window)
    pub total_tasks_30d: u32,
    pub completed_tasks_30d: u32,
    pub success_rate: f64,
    pub avg_duration_ms: u64,
    pub avg_tokens_per_task: u32,
    
    // Pattern analysis counts
    pub failure_patterns: usize,
    pub success_patterns: usize,
    
    // Knowledge base metrics
    pub knowledge_entries: u32,
    
    // Generated insights
    pub overall_assessment: String,
    pub recommendations: Vec<String>,
}

fn truncate(s: &str, max_len: usize) -> &str {
    if s.len() <= max_len { s } else { &s[..max_len] }
}
