// Self-evolution cycle orchestrator - coordinates reflection, planning, and code generation

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::collections::HashMap;
use tokio::time::{sleep, Duration};

use super::code_generation::{ChangeType, CodeChangeProposal, CodeGenerationEngine};
use super::prompt_engine::PromptOptimizationEngine;
use super::reflection::ReflectionEngine;

/// Orchestrates the complete self-evolution cycle for ORA
pub struct EvolutionCycle {
    pub id: uuid::Uuid,
    pub started_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub status: CycleStatus,
    pub phase_results: Vec<PhaseResult>,
    pub summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CycleStatus {
    Running,
    Completed,
    Failed(String),
    Paused,
}

/// Results from each phase of the evolution cycle
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhaseResult {
    pub phase: EvolutionPhase,
    pub status: PhaseStatus,
    pub findings: Vec<String>,
    pub actions_taken: Vec<String>,
    pub metrics: HashMap<String, f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EvolutionPhase {
    Reflection,
    Assessment,
    Planning,
    CodeGeneration,
    Review,
    Application,
    Testing,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PhaseStatus {
    Pending,
    InProgress,
    Completed,
    Skipped,
    Failed(String),
}

impl PhaseStatus {
    pub fn is_success(&self) -> bool {
        matches!(self, PhaseStatus::Completed)
    }
}

/// Cycle-specific config
#[derive(Debug, Clone)]
pub struct EvolutionCycleConfig {
    pub cycle_interval_hours: u32,
    pub max_changes_per_cycle: usize,
    pub min_performance_threshold: f64,
    pub auto_apply_low_risk: bool,
    pub run_tests_after_changes: bool,
    pub max_test_duration_secs: u64,
    pub continuous_mode: bool,
}

impl Default for EvolutionCycleConfig {
    fn default() -> Self {
        Self {
            cycle_interval_hours: 24,
            max_changes_per_cycle: 3,
            min_performance_threshold: 0.6,
            auto_apply_low_risk: false,
            run_tests_after_changes: true,
            max_test_duration_secs: 300,
            continuous_mode: false,
        }
    }
}

/// The self-evolution orchestrator that runs the complete improvement cycle
pub struct SelfEvolutionOrchestrator {
    pub reflection: ReflectionEngine,
    pub prompt_engine: PromptOptimizationEngine,
    pub code_generation: CodeGenerationEngine,
    pub config: EvolutionCycleConfig,
}

impl SelfEvolutionOrchestrator {
    pub fn new(db_pool: PgPool, project_root: String, config: EvolutionCycleConfig) -> Self {
        Self {
            reflection: ReflectionEngine::new(db_pool.clone()),
            prompt_engine: PromptOptimizationEngine::new(db_pool.clone()),
            code_generation: CodeGenerationEngine::new(db_pool, project_root),
            config,
        }
    }

    /// Run a complete self-evolution cycle
    pub async fn run_cycle(&self) -> Result<EvolutionCycle, String> {
        let cycle = EvolutionCycle {
            id: uuid::Uuid::new_v4(),
            started_at: Utc::now(),
            completed_at: None,
            status: CycleStatus::Running,
            phase_results: Vec::new(),
            summary: None,
        };

        tracing::info!(cycle_id = %cycle.id, "Starting self-evolution cycle");

        let mut results = Vec::new();
        let mut should_stop = false;

        // Phase 1: Reflection - Analyze past performance
        if !should_stop {
            let result = self.phase_reflection().await?;
            results.push(result);
        }

        // Phase 2: Assessment - Evaluate current system state
        if !should_stop {
            let result = self.phase_assessment().await?;
            results.push(result);
        }

        // Phase 3: Planning - Generate improvement proposals
        if !should_stop {
            let result = self.phase_planning(&results).await?;
            let has_findings = !result.findings.is_empty();
            results.push(result);

            if !has_findings {
                tracing::info!("No improvements identified. Cycle complete.");
                should_stop = true;
            }
        }

        // Phase 4: Code Generation
        if !should_stop {
            let result = self.phase_code_generation().await?;
            results.push(result);
        }

        // Phase 5: Review
        if !should_stop {
            let result = self.phase_review().await?;
            results.push(result);
        }

        // Phase 6-7: Application & Testing
        if !should_stop && self.config.auto_apply_low_risk {
            let result = self.phase_application().await?;
            results.push(result);

            if self.config.run_tests_after_changes {
                let test_result = self.phase_testing().await?;
                let tests_passed = test_result.status.is_success();
                results.push(test_result);

                if !tests_passed {
                    tracing::warn!("Tests failed after applying changes. Rolling back.");
                    let _ = self.rollback_changes().await;
                }
            }
        }

        // Complete the cycle
        let completed = EvolutionCycle {
            id: cycle.id,
            started_at: cycle.started_at,
            completed_at: Some(Utc::now()),
            status: CycleStatus::Completed,
            phase_results: results.clone(),
            summary: Some(self.generate_summary(&results)),
        };

        self.store_cycle(&completed).await?;

        tracing::info!(
            cycle_id = %completed.id,
            phases_completed = completed.phase_results.len(),
            "Self-evolution cycle completed"
        );

        Ok(completed)
    }

    async fn phase_reflection(&self) -> Result<PhaseResult, String> {
        tracing::info!("Phase 1: Reflection");
        let mut result = PhaseResult {
            phase: EvolutionPhase::Reflection,
            status: PhaseStatus::InProgress,
            findings: Vec::new(),
            actions_taken: Vec::new(),
            metrics: HashMap::new(),
        };

        // Analyze recent failures
        let failures = self.reflection.analyze_failures().await?;
        result
            .metrics
            .insert("failures_analyzed".to_string(), failures.len() as f64);

        for failure in &failures {
            if let Some(lesson) = &failure.lesson_learned {
                result
                    .findings
                    .push(format!("[{}] {}", failure.reflection_type, lesson));
            }
            if let Some(ref items) = failure.action_items {
                if let Some(arr) = items.as_array() {
                    for item in arr {
                        if let Some(s) = item.as_str() {
                            result.actions_taken.push(s.to_string());
                        }
                    }
                }
            }
        }

        // Analyze successes
        let successes = self.reflection.analyze_successes().await?;
        result
            .metrics
            .insert("successes_analyzed".to_string(), successes.len() as f64);

        // Run comprehensive assessment
        let assessment = self.reflection.run_self_assessment().await?;
        result
            .metrics
            .insert("success_rate".to_string(), assessment.success_rate);
        result.metrics.insert(
            "total_tasks_30d".to_string(),
            assessment.total_tasks_30d as f64,
        );

        if assessment.success_rate < self.config.min_performance_threshold {
            result.findings.push(format!(
                "Low performance: {:.1}% success rate (threshold: {:.1}%)",
                assessment.success_rate * 100.0,
                self.config.min_performance_threshold * 100.0
            ));
        }

        result.status = PhaseStatus::Completed;
        Ok(result)
    }

    async fn phase_assessment(&self) -> Result<PhaseResult, String> {
        tracing::info!("Phase 2: Assessment");
        let mut result = PhaseResult {
            phase: EvolutionPhase::Assessment,
            status: PhaseStatus::InProgress,
            findings: Vec::new(),
            actions_taken: Vec::new(),
            metrics: HashMap::new(),
        };

        // Analyze code quality via ReflectionEngine assessment
        let report = self.reflection.run_self_assessment().await?;
        result.metrics.insert(
            "knowledge_entries".to_string(),
            report.knowledge_entries as f64,
        );

        if report.knowledge_entries < 5 {
            result.findings.push(
                "Knowledge base has fewer than 5 entries - consider adding more patterns"
                    .to_string(),
            );
        }

        if report.failure_patterns > 3 {
            result.findings.push(format!(
                "{} recurring failure patterns detected",
                report.failure_patterns
            ));
        }

        result.status = PhaseStatus::Completed;
        Ok(result)
    }

    async fn phase_planning(&self, previous: &[PhaseResult]) -> Result<PhaseResult, String> {
        tracing::info!("Phase 3: Planning");
        let mut result = PhaseResult {
            phase: EvolutionPhase::Planning,
            status: PhaseStatus::InProgress,
            findings: Vec::new(),
            actions_taken: Vec::new(),
            metrics: HashMap::new(),
        };

        let mut action_items = Vec::new();
        for phase_result in previous {
            for finding in &phase_result.findings {
                if finding.contains("optimize")
                    || finding.contains("improve")
                    || finding.contains("fix")
                    || finding.contains("add")
                    || finding.contains("performance")
                    || finding.contains("Low")
                {
                    action_items.push(finding.clone());
                }
            }
        }

        let mut proposals_created = 0;
        for item in action_items.iter().take(self.config.max_changes_per_cycle) {
            match self.create_proposal_from_finding(item).await {
                Ok(proposal) => {
                    result.actions_taken.push(format!(
                        "Created proposal: {} ({:?})",
                        proposal.title, proposal.risk_level
                    ));
                    proposals_created += 1;
                }
                Err(e) => tracing::warn!("Could not create proposal for '{}': {}", item, e),
            }
        }

        result
            .metrics
            .insert("proposals_created".to_string(), proposals_created as f64);
        result.findings = action_items;
        result.status = PhaseStatus::Completed;
        Ok(result)
    }

    async fn create_proposal_from_finding(
        &self,
        finding: &str,
    ) -> Result<CodeChangeProposal, String> {
        let file_path;
        let change_type;
        let new_code;

        if finding.contains("knowledge") || finding.contains("pattern") {
            file_path = "src/self_evolution/knowledge_base.rs".to_string();
            change_type = ChangeType::Modify;
            new_code = format!("// Enhanced knowledge pattern based on: {}\n", finding);
        } else if finding.contains("prompt") || finding.contains("performance") {
            file_path = "src/main.rs".to_string();
            change_type = ChangeType::Modify;
            new_code = format!("// TODO: Optimize prompt based on: {}\n", finding);
        } else if finding.contains("failure") || finding.contains("error") {
            file_path = "src/providers/pidev.rs".to_string();
            change_type = ChangeType::Modify;
            new_code = format!("// TODO: Improve error handling based on: {}\n", finding);
        } else {
            file_path = "src/main.rs".to_string();
            change_type = ChangeType::Modify;
            new_code = format!("// TODO: Address finding: {}\n", finding);
        }

        self.code_generation
            .generate_proposal(
                format!(
                    "Auto-improvement: {}",
                    &finding.chars().take(50).collect::<String>()
                ),
                finding.to_string(),
                "Generated during self-evolution cycle".to_string(),
                file_path,
                change_type,
                None,
                new_code,
                None,
            )
            .await
    }

    async fn phase_code_generation(&self) -> Result<PhaseResult, String> {
        tracing::info!("Phase 4: Code Generation");
        let mut result = PhaseResult {
            phase: EvolutionPhase::CodeGeneration,
            status: PhaseStatus::Completed,
            findings: Vec::new(),
            actions_taken: Vec::new(),
            metrics: HashMap::new(),
        };

        let proposals = self
            .code_generation
            .list_proposals(
                Some("Draft"),
                None,
                self.config.max_changes_per_cycle as i64,
            )
            .await?;
        result
            .metrics
            .insert("proposals_to_generate".to_string(), proposals.len() as f64);

        for proposal in &proposals {
            result.actions_taken.push(format!(
                "Code ready for review: {} ({:?})",
                proposal.title, proposal.change_type
            ));
        }

        Ok(result)
    }

    async fn phase_review(&self) -> Result<PhaseResult, String> {
        tracing::info!("Phase 5: Review");
        let mut result = PhaseResult {
            phase: EvolutionPhase::Review,
            status: PhaseStatus::InProgress,
            findings: Vec::new(),
            actions_taken: Vec::new(),
            metrics: HashMap::new(),
        };

        let proposals = self
            .code_generation
            .list_proposals(
                Some("Draft"),
                None,
                self.config.max_changes_per_cycle as i64,
            )
            .await?;
        let mut approved = 0;
        let mut rejected = 0;

        for proposal in &proposals {
            match self.code_generation.self_review(proposal.id).await {
                Ok(review) => {
                    if review.passed {
                        approved += 1;
                        result
                            .actions_taken
                            .push(format!("APPROVED: {}", proposal.title));
                    } else {
                        rejected += 1;
                        result.findings.push(format!(
                            "REJECTED: {} - Issues: {}",
                            proposal.title,
                            review.issues.join("; ")
                        ));
                    }
                }
                Err(e) => {
                    tracing::error!("Review failed for {}: {}", proposal.title, e);
                    rejected += 1;
                }
            }
            sleep(Duration::from_millis(100)).await;
        }

        result
            .metrics
            .insert("approved".to_string(), approved as f64);
        result
            .metrics
            .insert("rejected".to_string(), rejected as f64);
        result.status = PhaseStatus::Completed;
        Ok(result)
    }

    async fn phase_application(&self) -> Result<PhaseResult, String> {
        tracing::info!("Phase 6: Application");
        let mut result = PhaseResult {
            phase: EvolutionPhase::Application,
            status: PhaseStatus::InProgress,
            findings: Vec::new(),
            actions_taken: Vec::new(),
            metrics: HashMap::new(),
        };

        let proposals = self
            .code_generation
            .list_proposals(
                Some("Approved"),
                None,
                self.config.max_changes_per_cycle as i64,
            )
            .await?;
        let mut applied = 0;
        let mut failed = 0;

        for proposal in &proposals {
            match self.code_generation.apply_change(proposal.id).await {
                Ok(apply_result) => {
                    applied += 1;
                    result.actions_taken.push(format!(
                        "APPLIED: {} -> {} (committed: {})",
                        proposal.title, apply_result.file_path, apply_result.committed
                    ));
                }
                Err(e) => {
                    failed += 1;
                    result
                        .findings
                        .push(format!("FAILED to apply {}: {}", proposal.title, e));
                }
            }
            sleep(Duration::from_millis(200)).await;
        }

        result.metrics.insert("applied".to_string(), applied as f64);
        result.metrics.insert("failed".to_string(), failed as f64);
        result.status = PhaseStatus::Completed;
        Ok(result)
    }

    async fn phase_testing(&self) -> Result<PhaseResult, String> {
        tracing::info!("Phase 7: Testing");
        let mut result = PhaseResult {
            phase: EvolutionPhase::Testing,
            status: PhaseStatus::InProgress,
            findings: Vec::new(),
            actions_taken: Vec::new(),
            metrics: HashMap::new(),
        };

        let output = tokio::process::Command::new("cargo")
            .args(["check"])
            .current_dir(&self.code_generation.project_root)
            .output()
            .await
            .map_err(|e| format!("Failed to run cargo check: {}", e))?;

        if output.status.success() {
            result.status = PhaseStatus::Completed;
            result.actions_taken.push("cargo check passed".to_string());
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            result.status = PhaseStatus::Failed("cargo check failed".to_string());
            result.findings.push(stderr.chars().take(200).collect());
        }

        Ok(result)
    }

    async fn rollback_changes(&self) -> Result<(), String> {
        let proposals = self
            .code_generation
            .list_proposals(Some("Applied"), None, 100)
            .await?;
        for proposal in proposals {
            if let Err(e) = self.code_generation.rollback_change(proposal.id).await {
                tracing::error!("Failed to rollback {}: {}", proposal.title, e);
            }
        }
        Ok(())
    }

    fn generate_summary(&self, results: &[PhaseResult]) -> String {
        let mut summary = String::new();
        for result in results {
            summary.push_str(&format!("\n## {:?} Phase\n", result.phase));
            if !result.findings.is_empty() {
                summary.push_str("### Findings:\n");
                for finding in &result.findings {
                    summary.push_str(&format!("  - {}\n", finding));
                }
            }
            if !result.actions_taken.is_empty() {
                summary.push_str("### Actions Taken:\n");
                for action in &result.actions_taken {
                    summary.push_str(&format!("  ✓ {}\n", action));
                }
            }
            if !result.metrics.is_empty() {
                summary.push_str("### Metrics:\n");
                for (key, value) in &result.metrics {
                    summary.push_str(&format!("  - {}: {:.2}\n", key, value));
                }
            }
        }
        summary
    }

    async fn store_cycle(&self, cycle: &EvolutionCycle) -> Result<(), String> {
        sqlx::query(
            "INSERT INTO evolution_cycles (id, started_at, completed_at, status, phase_results, summary) \
             VALUES ($1, $2, $3, $4, $5, $6)"
        )
        .bind(cycle.id)
        .bind(cycle.started_at)
        .bind(cycle.completed_at)
        .bind(serde_json::to_string(&cycle.status).map_err(|e| e.to_string())?)
        .bind(serde_json::to_string(&cycle.phase_results).map_err(|e| e.to_string())?)
        .bind(cycle.summary.as_deref())
        .execute(&self.reflection.db_pool)
        .await
        .map(|_| ())
        .map_err(|e| format!("Database error: {}", e))
    }
}
