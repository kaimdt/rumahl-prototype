use sqlx::Row;
// Code generation engine - ORA generates, reviews, and applies its own code modifications

use std::collections::HashMap;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

/// Represents a proposed code change that ORA wants to make to itself
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeChangeProposal {
    pub id: uuid::Uuid,
    pub title: String,
    pub description: String,
    pub rationale: String,       // Why this change is needed (linked to reflection)
    pub file_path: String,
    pub change_type: ChangeType,  // add, modify, delete, refactor
    pub old_code: Option<String>,
    pub new_code: String,
    pub expected_impact: ImpactAssessment,
    pub risk_level: RiskLevel,
    pub status: ProposalStatus,
    pub review_notes: Option<String>,
    pub applied_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ChangeType {
    Add,          // New code (new file or new function)
    Modify,       // Change existing code
    Delete,       // Remove code
    Refactor,     // Restructure without changing behavior
    Config,       // Configuration change
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum RiskLevel {
    Low,          // Safe changes (comments, logging, minor refactoring)
    Medium,       // Changes that could affect functionality but are reversible
    High,         // Significant behavioral changes requiring careful review
    Critical,     // Changes to core system components
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ProposalStatus {
    Draft,        // Initial proposal, not yet reviewed
    UnderReview,  // Being evaluated by ORA's self-review process
    Approved,     // Passed review, ready for application
    Rejected,     // Failed review
    Applied,      // Successfully applied to codebase
    RolledBack,   // Was applied but had issues, reverted
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ImpactAssessment {
    pub affected_modules: Vec<String>,
    pub estimated_effort: EffortLevel,
    pub expected_benefits: Vec<String>,
    pub potential_risks: Vec<String>,
    pub rollback_strategy: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EffortLevel {
    Trivial,      // < 10 minutes
    Small,        // 10-30 minutes  
    Medium,       // 30 min - 2 hours
    Large,        // 2-8 hours
    Extensive,    // Multiple days
}

impl Default for EffortLevel {
    fn default() -> Self { EffortLevel::Medium }
}

/// Code generation engine that allows ORA to modify its own source code
pub struct CodeGenerationEngine {
    pub db_pool: PgPool,
    pub config: CodeGenerationConfig,
    pub project_root: String,
}

#[derive(Debug, Clone)]
pub struct CodeGenerationConfig {
    pub auto_apply_low_risk: bool,      // Automatically apply low-risk changes
    pub require_tests: bool,            // Require test coverage for new code
    pub max_changes_per_session: usize, // Limit changes per self-evolution cycle
    pub allowed_directories: Vec<String>,// Directories ORA can modify
    pub git_commit_on_apply: bool,      // Create git commit when applying changes
}

impl Default for CodeGenerationConfig {
    fn default() -> Self {
        Self {
            auto_apply_low_risk: false,  // Conservative default - require approval
            require_tests: true,
            max_changes_per_session: 5,
            allowed_directories: vec![
                "src/".to_string(),
                "config/".to_string(),
                "prompts/".to_string(),
            ],
            git_commit_on_apply: true,
        }
    }
}

impl CodeGenerationEngine {
    pub fn new(db_pool: PgPool, project_root: String) -> Self {
        Self { 
            db_pool, 
            config: CodeGenerationConfig::default(),
            project_root,
        }
    }

    /// Generate a code change proposal from a reflection/lesson learned
    pub async fn generate_proposal(
        &self,
        title: String,
        description: String,
        rationale: String,
        file_path: String,
        change_type: ChangeType,
        old_code: Option<String>,
        new_code: String,
        reflection_id: Option<uuid::Uuid>,
    ) -> Result<CodeChangeProposal, String> {
        // Validate the proposal
        self.validate_proposal(&file_path, &change_type, &new_code)?;

        let impact = self.assess_impact(&file_path, &change_type, &new_code);
        let risk = self.assess_risk(&impact, &change_type);

        let mut status = ProposalStatus::Draft;
        
        // Auto-approve low-risk changes if configured
        if self.config.auto_apply_low_risk && risk == RiskLevel::Low {
            status = ProposalStatus::Approved;
        }

        let proposal = CodeChangeProposal {
            id: uuid::Uuid::new_v4(),
            title,
            description,
            rationale,
            file_path,
            change_type,
            old_code,
            new_code,
            expected_impact: impact,
            risk_level: risk,
            status,
            review_notes: None,
            applied_at: None,
            created_at: Utc::now(),
        };

        self.store_proposal(&proposal).await?;
        Ok(proposal)
    }

    /// Validate that a proposed change is allowed and well-formed
    fn validate_proposal(
        &self, 
        file_path: &str, 
        change_type: &ChangeType, 
        new_code: &str,
    ) -> Result<(), String> {
        // Check if the target directory is in allowed list
        let mut is_allowed = false;
        for dir in &self.config.allowed_directories {
            if file_path.starts_with(dir) {
                is_allowed = true;
                break;
            }
        }
        
        if !is_allowed {
            return Err(format!(
                "Cannot modify '{}' - directory not in allowed list: {:?}", 
                file_path, self.config.allowed_directories
            ));
        }

        // Validate code quality for new/modified code
        let issues = self.analyze_code_quality(new_code);
        
        if !issues.is_empty() && matches!(change_type, ChangeType::Add | ChangeType::Modify) {
            // Non-blocking warnings stored in the proposal
            tracing::warn!("Code quality issues detected: {:?}", issues);
        }

        // Check for dangerous patterns
        let dangerous_patterns = [
            "std::process::Command",  // Shell commands
            "unsafe ",                // Unsafe Rust code
            "include_str!",          // File inclusion at compile time
        ];

        for pattern in &dangerous_patterns {
            if new_code.contains(pattern) {
                return Err(format!(
                    "Proposed code contains dangerous pattern: '{}'. Manual review required.", 
                    pattern
                ));
            }
        }

        Ok(())
    }

    /// Analyze generated code for quality issues
    fn analyze_code_quality(&self, code: &str) -> Vec<String> {
        let mut issues = Vec::new();

        // Check 1: Missing error handling (no Result/Option return types in functions)
        if code.contains("fn ") && !code.contains("Result") && !code.contains("Option") 
           && !code.contains("pub fn main") {
            issues.push("Function has no error handling (missing Result<> return type)".to_string());
        }

        // Check 2: TODO/FIXME comments left in code
        if code.to_lowercase().contains("todo") || code.to_lowercase().contains("fixme") {
            issues.push("Code contains TODO/FIXME comments that should be resolved".to_string());
        }

        // Check 3: No documentation for public functions
        let has_public_fn = code.contains("pub fn");
        let has_doc_comments = code.contains("///") || code.contains("//!");
        
        if has_public_fn && !has_doc_comments {
            issues.push("Public function without documentation comments".to_string());
        }

        // Check 4: Magic numbers/strings (should be constants)
        let lines: Vec<&str> = code.lines().collect();
        for line in &lines {
            let trimmed = line.trim();
            if trimmed.contains("== ") || trimmed.contains("!= ") {
                // Check for numeric literals in comparisons
                if trimmed.contains("== 0") || trimmed.contains("== 1") 
                   || trimmed.contains("== -1") {
                    issues.push(format!("Magic number in comparison: '{}'", trimmed));
                }
            }
        }

        // Check 5: Overly long functions (> 50 lines)
        let mut current_fn_lines = 0;
        for line in &lines {
            if line.trim().starts_with("fn ") || line.trim().starts_with("pub fn ") {
                if current_fn_lines > 50 {
                    issues.push(format!(
                        "Function exceeds 50 lines ({} lines). Consider splitting.", 
                        current_fn_lines
                    ));
                }
                current_fn_lines = 0;
            } else if current_fn_lines > 0 || line.trim().starts_with("{") {
                current_fn_lines += 1;
            }
        }

        issues
    }

    /// Assess the impact of a proposed change
    fn assess_impact(&self, file_path: &str, change_type: &ChangeType, new_code: &str) -> ImpactAssessment {
        let mut affected_modules = Vec::new();
        
        // Extract module from file path
        if let Some(module) = file_path.strip_suffix(".rs").map(|p| p.replace('/', ".")) {
            affected_modules.push(module);
        }

        // Detect imports to find dependencies
        for line in new_code.lines() {
            if let Some(import) = line.trim().strip_prefix("use ") {
                if let Some(crate_name) = import.split("::").next() {
                    if !affected_modules.contains(&crate_name.to_string()) 
                       && !["std", "core", "serde", "tokio"].contains(&crate_name) {
                        affected_modules.push(crate_name.to_string());
                    }
                }
            }
        }

        // Estimate effort based on change type and code size
        let effort = match change_type {
            ChangeType::Config => EffortLevel::Trivial,
            ChangeType::Delete if new_code.lines().count() < 10 => EffortLevel::Small,
            ChangeType::Modify if new_code.lines().count() < 20 => EffortLevel::Small,
            ChangeType::Add | ChangeType::Modify if new_code.lines().count() < 50 => EffortLevel::Medium,
            _ => EffortLevel::Large,
        };

        let benefits = match change_type {
            ChangeType::Refactor => vec![
                "Improved code maintainability".to_string(),
                "Better code organization".to_string(),
            ],
            ChangeType::Add => vec![
                "New functionality added".to_string(),
            ],
            ChangeType::Modify => vec![
                "Bug fix or improvement applied".to_string(),
            ],
            _ => vec![],
        };

        let risks = if matches!(change_type, ChangeType::Delete) {
            vec!["Removing code may break dependent functionality".to_string()]
        } else if new_code.contains("unsafe") {
            vec!["Unsafe code introduces memory safety risks".to_string()]
        } else {
            vec![]
        };

        ImpactAssessment {
            affected_modules,
            estimated_effort: effort,
            expected_benefits: benefits,
            potential_risks: risks,
            rollback_strategy: if matches!(change_type, ChangeType::Add) {
                Some("Delete the added code".to_string())
            } else if matches!(change_type, ChangeType::Modify) {
                Some("Restore original code from git".to_string())
            } else {
                None
            },
        }
    }

    /// Assess risk level based on impact analysis
    fn assess_risk(&self, impact: &ImpactAssessment, change_type: &ChangeType) -> RiskLevel {
        let mut score = 0;

        // More affected modules = higher risk
        score += impact.affected_modules.len();

        // Risks mentioned increase level
        score += impact.potential_risks.len() * 2;

        match change_type {
            ChangeType::Config => RiskLevel::Low,
            ChangeType::Refactor if score <= 1 => RiskLevel::Low,
            ChangeType::Add if score <= 2 => RiskLevel::Medium,
            ChangeType::Modify if score <= 3 => RiskLevel::Medium,
            _ if score > 5 => RiskLevel::Critical,
            _ => RiskLevel::High,
        }
    }

    /// Self-review a proposal using static analysis and heuristics
    pub async fn self_review(&self, proposal_id: uuid::Uuid) -> Result<ReviewResult, String> {
        let proposal = self.get_proposal(proposal_id).await?;

        let mut result = ReviewResult {
            proposal_id,
            passed: true,
            issues: Vec::new(),
            warnings: Vec::new(),
        };

        // Run code quality analysis on new code
        let quality_issues = self.analyze_code_quality(&proposal.new_code);
        
        for issue in quality_issues {
            if issue.contains("unsafe") || issue.contains("error handling") {
                result.issues.push(issue);
                result.passed = false;
            } else {
                result.warnings.push(issue);
            }
        }

        // Check that the change is syntactically valid Rust (basic check)
        if !self.validate_rust_syntax(&proposal.new_code) {
            result.issues.push("Generated code has syntax errors".to_string());
            result.passed = false;
        }

        // For modifications, verify old code matches current file content
        if let ChangeType::Modify | ChangeType::Delete = proposal.change_type {
            if let Some(ref old_code) = proposal.old_code {
                let full_path = format!("{}/{}", self.project_root, proposal.file_path);
                
                if let Ok(current_content) = std::fs::read_to_string(&full_path) {
                    if !current_content.contains(old_code.trim()) {
                        result.issues.push(format!(
                            "Old code no longer matches file content. \
                             The target code may have been modified since proposal was created."
                        ));
                        result.passed = false;
                    }
                } else {
                    result.issues.push(format!("Cannot read target file: {}", full_path));
                    result.passed = false;
                }
            }
        }

        // Update proposal status based on review
        let new_status = if result.passed {
            ProposalStatus::Approved
        } else {
            ProposalStatus::Rejected
        };

        sqlx::query(
            "UPDATE code_change_proposals SET status = $1, review_notes = $2 \
             WHERE id = $3"
        )
        .bind(serde_json::to_string(&new_status).map_err(|e| e.to_string())?)
        .bind(result.warnings.join("; "))
        .bind(proposal_id)
        .execute(&self.db_pool)
        .await
        .map(|_| ())
        .map_err(|e| format!("Database error: {}", e))?;

        Ok(result)
    }

    /// Basic Rust syntax validation (checks for common issues)
    fn validate_rust_syntax(&self, code: &str) -> bool {
        let mut brace_count = 0i32;
        let mut paren_count = 0i32;
        let mut bracket_count = 0i32;

        for ch in code.chars() {
            match ch {
                '{' => brace_count += 1,
                '}' => { brace_count -= 1; if brace_count < 0 { return false; } }
                '(' => paren_count += 1,
                ')' => { paren_count -= 1; if paren_count < 0 { return false; } }
                '[' => bracket_count += 1,
                ']' => { bracket_count -= 1; if bracket_count < 0 { return false; } }
                _ => {}
            }
        }

        brace_count == 0 && paren_count == 0 && bracket_count == 0
    }

    /// Apply an approved code change to the file system
    pub async fn apply_change(&self, proposal_id: uuid::Uuid) -> Result<ApplyResult, String> {
        let proposal = self.get_proposal(proposal_id).await?;

        if proposal.status != ProposalStatus::Approved {
            return Err(format!(
                "Cannot apply proposal with status {:?}. Must be Approved.", 
                proposal.status
            ));
        }

        let full_path = format!("{}/{}", self.project_root, proposal.file_path);

        // Ensure parent directory exists
        if let Some(parent) = std::path::Path::new(&full_path).parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Cannot create directory: {}", e))?;
        }

        match proposal.change_type {
            ChangeType::Add => {
                // Write new file or append to existing
                if let Ok(current) = std::fs::read_to_string(&full_path) {
                    // File exists, append the new code
                    std::fs::write(&full_path, format!("{}{}", current, proposal.new_code))
                        .map_err(|e| format!("Cannot write to file: {}", e))?;
                } else {
                    // New file
                    std::fs::write(&full_path, &proposal.new_code)
                        .map_err(|e| format!("Cannot create file: {}", e))?;
                }
            }
            ChangeType::Modify => {
                let current = std::fs::read_to_string(&full_path)
                    .map_err(|e| format!("Cannot read file: {}", e))?;

                if let Some(ref old_code) = proposal.old_code {
                    let updated = current.replace(old_code.trim(), &proposal.new_code);
                    
                    if updated == current {
                        return Err("Could not find the target code to replace".to_string());
                    }

                    std::fs::write(&full_path, updated)
                        .map_err(|e| format!("Cannot write to file: {}", e))?;
                } else {
                    return Err("Modify operation requires old_code to be specified".to_string());
                }
            }
            ChangeType::Delete => {
                let current = std::fs::read_to_string(&full_path)
                    .map_err(|e| format!("Cannot read file: {}", e))?;

                if let Some(ref old_code) = proposal.old_code {
                    let updated = current.replace(old_code.trim(), "");
                    
                    // Clean up extra blank lines
                    let cleaned = Self::clean_blank_lines(&updated);
                    
                    std::fs::write(&full_path, cleaned)
                        .map_err(|e| format!("Cannot write to file: {}", e))?;
                } else {
                    // Delete entire file if no specific code specified
                    std::fs::remove_file(&full_path)
                        .map_err(|e| format!("Cannot delete file: {}", e))?;
                }
            }
            ChangeType::Refactor => {
                // Same as modify but semantically different
                let current = std::fs::read_to_string(&full_path)
                    .map_err(|e| format!("Cannot read file: {}", e))?;

                if let Some(ref old_code) = proposal.old_code {
                    let updated = current.replace(old_code.trim(), &proposal.new_code);
                    std::fs::write(&full_path, updated)
                        .map_err(|e| format!("Cannot write to file: {}", e))?;
                } else {
                    return Err("Refactor operation requires old_code".to_string());
                }
            }
            ChangeType::Config => {
                // For config files, replace entire content
                std::fs::write(&full_path, &proposal.new_code)
                    .map_err(|e| format!("Cannot write to file: {}", e))?;
            }
        }

        // Update proposal status
        sqlx::query(
            "UPDATE code_change_proposals SET status = $1, applied_at = NOW() WHERE id = $2"
        )
        .bind("'Applied'")
        .bind(proposal_id)
        .execute(&self.db_pool)
        .await
        .map(|_| ())
        .map_err(|e| format!("Database error: {}", e))?;

        // Create git commit if configured
        if self.config.git_commit_on_apply {
            self.create_git_commit(&proposal)?;
        }

        Ok(ApplyResult {
            proposal_id,
            file_path: full_path,
            change_type: format!("{:?}", proposal.change_type),
            committed: self.config.git_commit_on_apply,
        })
    }

    /// Rollback an applied change using git
    pub async fn rollback_change(&self, proposal_id: uuid::Uuid) -> Result<ApplyResult, String> {
        let proposal = self.get_proposal(proposal_id).await?;

        // Use git to revert the commit
        self.rollback_git_commit(&proposal)?;

        sqlx::query(
            "UPDATE code_change_proposals SET status = 'RolledBack' WHERE id = $1"
        )
        .bind(proposal_id)
        .execute(&self.db_pool)
        .await
        .map(|_| ())
        .map_err(|e| format!("Database error: {}", e))?;

        Ok(ApplyResult {
            proposal_id,
            file_path: format!("{}/{}", self.project_root, proposal.file_path),
            change_type: "rollback".to_string(),
            committed: true,
        })
    }

    /// Create a git commit for an applied change
    fn create_git_commit(&self, proposal: &CodeChangeProposal) -> Result<(), String> {
        let output = std::process::Command::new("git")
            .current_dir(&self.project_root)
            .args(&["add", &proposal.file_path])
            .output()
            .map_err(|e| format!("Git add failed: {}", e))?;

        if !output.status.success() {
            tracing::warn!("Git add warning: {}", String::from_utf8_lossy(&output.stderr));
        }

        let commit_msg = format!(
            "self-evolution: {} - {}\n\nORA-generated change. Rationale: {}",
            proposal.title,
            format!("{:?}", proposal.change_type),
            proposal.rationale.chars().take(100).collect::<String>()
        );

        let output = std::process::Command::new("git")
            .current_dir(&self.project_root)
            .args(&["commit", "-m", &commit_msg])
            .output()
            .map_err(|e| format!("Git commit failed: {}", e))?;

        if !output.status.success() {
            return Err(format!(
                "Git commit failed: {}", 
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        tracing::info!("Created git commit for self-evolution change: {}", proposal.title);
        Ok(())
    }

    /// Rollback a git commit
    fn rollback_git_commit(&self, proposal: &CodeChangeProposal) -> Result<(), String> {
        let output = std::process::Command::new("git")
            .current_dir(&self.project_root)
            .args(&["reset", "--hard", "HEAD~1"])
            .output()
            .map_err(|e| format!("Git reset failed: {}", e))?;

        if !output.status.success() {
            return Err(format!(
                "Git rollback failed: {}", 
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        tracing::info!("Rolled back self-evolution change: {}", proposal.title);
        Ok(())
    }

    /// Clean up excessive blank lines in code
    fn clean_blank_lines(code: &str) -> String {
        let mut result = String::new();
        let mut prev_blank = false;

        for line in code.lines() {
            if line.trim().is_empty() {
                if !prev_blank {
                    result.push('\n');
                }
                prev_blank = true;
            } else {
                result.push_str(line);
                result.push('\n');
                prev_blank = false;
            }
        }

        result.trim_end().to_string()
    }

    /// Get a proposal by ID
    pub async fn get_proposal(&self, id: uuid::Uuid) -> Result<CodeChangeProposal, String> {
        let row = sqlx::query(
            "SELECT id, title, description, rationale, file_path, change_type, \
             old_code, new_code, expected_impact, risk_level, status, review_notes, \
             applied_at, created_at \
             FROM code_change_proposals WHERE id = $1"
        )
        .bind(id)
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| format!("Database error: {}", e))?;

        Ok(CodeChangeProposal {
            id: row.get("id"),
            title: row.get("title"),
            description: row.get("description"),
            rationale: row.get("rationale"),
            file_path: row.get("file_path"),
            change_type: serde_json::from_str::<ChangeType>(&row.get::<String, _>("change_type"))
                .unwrap_or(ChangeType::Modify),
            old_code: row.get("old_code"),
            new_code: row.get("new_code"),
            expected_impact: row.get::<Option<String>, _>("expected_impact")
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_default(),
            risk_level: serde_json::from_str::<RiskLevel>(&row.get::<String, _>("risk_level"))
                .unwrap_or(RiskLevel::Medium),
            status: serde_json::from_str::<ProposalStatus>(&row.get::<String, _>("status"))
                .unwrap_or(ProposalStatus::Draft),
            review_notes: row.get("review_notes"),
            applied_at: row.get("applied_at"),
            created_at: row.get("created_at"),
        })
    }

    /// List proposals filtered by status and risk level
    pub async fn list_proposals(
        &self, 
        status: Option<&str>,
        risk_level: Option<&str>,
        limit: i64,
    ) -> Result<Vec<CodeChangeProposal>, String> {
        let mut query = "SELECT id, title, description, rationale, file_path, change_type, \
             old_code, new_code, expected_impact, risk_level, status, review_notes, \
             applied_at, created_at FROM code_change_proposals WHERE 1=1".to_string();
        
        let mut params: Vec<String> = Vec::new();
        let mut bind_count = 1;

        if let Some(s) = status {
            query.push_str(" AND status = $");
            query.push_str(&bind_count.to_string());
            params.push(s.to_string());
            bind_count += 1;
        }

        if let Some(r) = risk_level {
            query.push_str(" AND risk_level = $");
            query.push_str(&bind_count.to_string());
            params.push(r.to_string());
            bind_count += 1;
        }

        query.push_str(" ORDER BY created_at DESC LIMIT $");
        query.push_str(&bind_count.to_string());
        params.push(limit.to_string());

        // Execute with dynamic parameters (simplified - in production use sqlx::query_with)
        let rows = sqlx::query(&query)
            .fetch_all(&self.db_pool)
            .await
            .map_err(|e| format!("Database error: {}", e))?;

        Ok(rows.iter().map(|row| CodeChangeProposal {
            id: row.get("id"),
            title: row.get("title"),
            description: row.get("description"),
            rationale: row.get("rationale"),
            file_path: row.get("file_path"),
            change_type: serde_json::from_str::<ChangeType>(&row.get::<String, _>("change_type"))
                .unwrap_or(ChangeType::Modify),
            old_code: row.get("old_code"),
            new_code: row.get("new_code"),
            expected_impact: row.get::<Option<String>, _>("expected_impact")
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default(),
            risk_level: serde_json::from_str::<RiskLevel>(&row.get::<String, _>("risk_level"))
                .unwrap_or(RiskLevel::Medium),
            status: serde_json::from_str::<ProposalStatus>(&row.get::<String, _>("status"))
                .unwrap_or(ProposalStatus::Draft),
            review_notes: row.get("review_notes"),
            applied_at: row.get("applied_at"),
            created_at: row.get("created_at"),
        }).collect())
    }

    /// Store a proposal in the database
    async fn store_proposal(&self, proposal: &CodeChangeProposal) -> Result<(), String> {
        sqlx::query(
            "INSERT INTO code_change_proposals \
             (id, title, description, rationale, file_path, change_type, old_code, new_code, \
              expected_impact, risk_level, status, review_notes, applied_at, created_at) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)"
        )
        .bind(proposal.id)
        .bind(&proposal.title)
        .bind(&proposal.description)
        .bind(&proposal.rationale)
        .bind(&proposal.file_path)
        .bind(serde_json::to_string(&proposal.change_type).map_err(|e| e.to_string())?)
        .bind(proposal.old_code.as_deref())
        .bind(&proposal.new_code)
        .bind(serde_json::to_string(&proposal.expected_impact).map_err(|e| e.to_string())?)
        .bind(serde_json::to_string(&proposal.risk_level).map_err(|e| e.to_string())?)
        .bind(serde_json::to_string(&proposal.status).map_err(|e| e.to_string())?)
        .bind(proposal.review_notes.as_deref())
        .bind(proposal.applied_at)
        .bind(proposal.created_at)
        .execute(&self.db_pool)
        .await
        .map(|_| ())
        .map_err(|e| format!("Database error: {}", e))
    }
}

/// Result of a self-review operation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewResult {
    pub proposal_id: uuid::Uuid,
    pub passed: bool,
    pub issues: Vec<String>,     // Blocking issues
    pub warnings: Vec<String>,   // Non-blocking warnings
}

/// Result of applying a code change
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApplyResult {
    pub proposal_id: uuid::Uuid,
    pub file_path: String,
    pub change_type: String,
    pub committed: bool,
}

// Helper trait for default values
trait UnwrapDefault<T> {
    fn unwrap_default(self) -> T;
}

impl<T: Default> UnwrapDefault<T> for Option<T> {
    fn unwrap_default(self) -> T {
        self.unwrap_or_default()
    }
}
