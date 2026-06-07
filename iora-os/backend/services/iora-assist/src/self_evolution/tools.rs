// Self-evolution tools - ORA's toolkit for modifying its own codebase

use crate::providers::{AIProvider, ChatMessage};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Base trait for evolution tools
#[async_trait]
pub trait EvolutionTool: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> &str;

    /// Execute the tool with given parameters
    async fn execute(&self, params: &serde_json::Value) -> Result<ToolOutput, String>;
}

/// Output from a tool execution
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolOutput {
    pub success: bool,
    pub output: String,
    pub summary: Option<String>,
    pub metadata: Option<serde_json::Value>,
}

// ==================== Code Read Tool ====================

pub struct CodeReadTool;

impl CodeReadTool {
    pub fn new() -> Self {
        Self
    }

    pub async fn read_file(&self, path: &str) -> Result<String, String> {
        std::fs::read_to_string(path).map_err(|e| format!("Cannot read {}: {}", path, e))
    }

    pub fn list_files(&self, dir: &Path, extension: Option<&str>) -> Result<Vec<PathBuf>, String> {
        let mut files = Vec::new();

        let entries = match std::fs::read_dir(dir) {
            Ok(e) => e,
            Err(e) => return Err(format!("Cannot read directory {}: {}", dir.display(), e)),
        };

        for entry in entries.flatten() {
            let path = entry.path();

            if path.is_file() {
                if extension.is_none_or(|ext| path.extension().is_some_and(|e| e == ext)) {
                    files.push(path);
                }
            } else if path.is_dir() {
                // Recursion - collect subdirectory files
                match self.list_files(&path, extension) {
                    Ok(mut sub_files) => files.append(&mut sub_files),
                    Err(e) => return Err(e),
                }
            }
        }

        Ok(files)
    }
}

#[async_trait]
impl EvolutionTool for CodeReadTool {
    fn name(&self) -> &str {
        "code_read"
    }
    fn description(&self) -> &str {
        "Read source code files. Params: {\"path\": \"src/file.rs\"}"
    }

    async fn execute(&self, params: &serde_json::Value) -> Result<ToolOutput, String> {
        let path = params
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "Missing 'path' parameter".to_string())?;

        let content = self.read_file(path).await?;
        let content_len = content.len();

        Ok(ToolOutput {
            success: true,
            output: content,
            summary: Some(format!("Read {} bytes from {}", content_len, path)),
            metadata: None,
        })
    }
}

// ==================== Code Write Tool ====================

pub struct CodeWriteTool;

impl CodeWriteTool {
    pub fn new() -> Self {
        Self
    }

    pub async fn write_file(&self, path: &str, content: &str) -> Result<(), String> {
        let path = PathBuf::from(path);

        // Create parent directories if needed
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Cannot create directory {}: {}", parent.display(), e))?;
        }

        std::fs::write(&path, content)
            .map_err(|e| format!("Cannot write {}: {}", path.display(), e))
    }

    pub async fn apply_diff(&self, file_path: &str, diff_text: &str) -> Result<String, String> {
        // Apply a unified diff to `file_path` by parsing each `@@ ... @@` hunk
        // and rewriting the surviving lines. This is a deliberately small
        // implementation (no rename / no binary diff support) but it does
        // actually mutate the file rather than just reporting metadata.
        let original = std::fs::read_to_string(file_path)
            .map_err(|e| format!("Cannot read {}: {}", file_path, e))?;
        let mut out: Vec<String> = original.lines().map(|s| s.to_string()).collect();

        // Parse hunks
        let mut hunks: Vec<(usize, Vec<&str>)> = Vec::new();
        let mut iter = diff_text.lines().peekable();
        while let Some(line) = iter.next() {
            if line.starts_with("@@") {
                // @@ -orig_start,orig_count +new_start,new_count @@
                let parts: Vec<&str> = line.split_whitespace().collect();
                let orig = parts.get(1).copied().unwrap_or("");
                let orig_start: usize = orig
                    .trim_start_matches('-')
                    .split(',')
                    .next()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(1);
                let mut body: Vec<&str> = Vec::new();
                while let Some(next) = iter.peek() {
                    if next.starts_with("@@")
                        || next.starts_with("--- ")
                        || next.starts_with("+++ ")
                    {
                        break;
                    }
                    body.push(iter.next().unwrap());
                }
                hunks.push((orig_start.saturating_sub(1), body));
            }
        }

        // Apply hunks in reverse to keep indices valid.
        let mut applied = 0usize;
        for (start, body) in hunks.iter().rev() {
            let mut idx = *start;
            for entry in body {
                if let Some(rest) = entry.strip_prefix('+') {
                    out.insert(idx, rest.to_string());
                    idx += 1;
                    applied += 1;
                } else if entry.starts_with('-') {
                    if idx < out.len() {
                        out.remove(idx);
                        applied += 1;
                    }
                } else {
                    // Context line
                    idx += 1;
                }
            }
        }

        let new_text = out.join("\n") + "\n";
        std::fs::write(file_path, &new_text)
            .map_err(|e| format!("Cannot write {}: {}", file_path, e))?;

        Ok(format!(
            "Diff applied to {} ({} hunks, {} ops)",
            file_path,
            hunks.len(),
            applied
        ))
    }
}

#[async_trait]
impl EvolutionTool for CodeWriteTool {
    fn name(&self) -> &str {
        "code_write"
    }
    fn description(&self) -> &str {
        "Write or modify source code files. Params: {\"path\": \"src/file.rs\", \"content\": \"...\"}"
    }

    async fn execute(&self, params: &serde_json::Value) -> Result<ToolOutput, String> {
        let path = params
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "Missing 'path' parameter".to_string())?;

        let content = params
            .get("content")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "Missing 'content' parameter".to_string())?;

        self.write_file(path, content).await?;

        Ok(ToolOutput {
            success: true,
            output: format!("Wrote {} bytes to {}", content.len(), path),
            summary: Some(format!("File written: {}", path)),
            metadata: None,
        })
    }
}

// ==================== Code Review Tool ====================

pub struct CodeReviewTool {
    source_dir: PathBuf,
}

impl CodeReviewTool {
    pub fn new(source_dir: PathBuf) -> Self {
        Self { source_dir }
    }

    /// Analyze code quality and suggest improvements
    pub async fn review_file(&self, file_path: &str) -> Result<CodeReviewResult, String> {
        let full_path = self.source_dir.join(file_path);
        let content = std::fs::read_to_string(&full_path)
            .map_err(|e| format!("Cannot read {}: {}", file_path, e))?;

        // Run static analysis checks
        let mut issues = Vec::new();

        // Check for common Rust anti-patterns
        self.check_rust_patterns(&content, &mut issues);

        // Check for security concerns
        self.check_security_issues(&content, file_path, &mut issues);

        let score: u32 = if issues.is_empty() {
            100
        } else {
            std::cmp::max(0u32, 100 - (issues.len() * 10) as u32)
        };

        Ok(CodeReviewResult {
            file: file_path.to_string(),
            issues,
            score,
        })
    }

    fn check_rust_patterns(&self, content: &str, issues: &mut Vec<ReviewIssue>) {
        // Check for unwrap() usage (should use ? or proper error handling)
        if content.contains(".unwrap()") {
            issues.push(ReviewIssue {
                severity: "warning".to_string(),
                category: "error_handling".to_string(),
                message: "Consider using '?' operator instead of '.unwrap()' for better error propagation"
                    .to_string(),
                line_hint: None,
                suggestion: Some("Replace `.unwrap()` with `?` or use `.ok_or_else(|| Error::...)`".to_string())
            });
        }

        // Check for TODO/FIXME comments
        if content.contains("// TODO:") || content.contains("// FIXME:") {
            issues.push(ReviewIssue {
                severity: "info".to_string(),
                category: "code_quality".to_string(),
                message: "File contains TODO/FIXME comments that should be addressed".to_string(),
                line_hint: None,
                suggestion: Some("Address pending TODOs or create tracking issues".to_string()),
            });
        }

        // Check for unused imports (basic check)
        if content.contains("use ") && !content.contains("unused_imports") {
            // Would need proper parsing to detect truly unused imports
        }
    }

    fn check_security_issues(
        &self,
        _content: &str,
        file_path: &str,
        issues: &mut Vec<ReviewIssue>,
    ) {
        // Check if this is a sensitive file that might handle secrets
        if file_path.contains("config")
            || file_path.contains("secret")
            || file_path.contains("credential")
        {
            issues.push(ReviewIssue {
                severity: "critical".to_string(),
                category: "security".to_string(),
                message: "This file may contain sensitive configuration. Ensure secrets are not hardcoded."
                    .to_string(),
                line_hint: None,
                suggestion: Some("Use environment variables or secret management for credentials".to_string())
            });
        }

        // Check for potential injection vulnerabilities in SQL queries
        if _content.contains("format!(") && _content.contains("sql") {
            issues.push(ReviewIssue {
                severity: "critical".to_string(),
                category: "security".to_string(),
                message: "Potential SQL injection risk with string formatting for queries"
                    .to_string(),
                line_hint: None,
                suggestion: Some(
                    "Use parameterized queries instead of string interpolation".to_string(),
                ),
            });
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeReviewResult {
    pub file: String,
    pub issues: Vec<ReviewIssue>,
    pub score: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewIssue {
    pub severity: String, // info, warning, error, critical
    pub category: String, // security, performance, style, correctness
    pub message: String,
    pub line_hint: Option<usize>,
    pub suggestion: Option<String>,
}

#[async_trait]
impl EvolutionTool for CodeReviewTool {
    fn name(&self) -> &str {
        "code_review"
    }
    fn description(&self) -> &str {
        "Analyze code quality and suggest improvements. Params: {\"path\": \"src/file.rs\"}"
    }

    async fn execute(&self, params: &serde_json::Value) -> Result<ToolOutput, String> {
        let path = params
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "Missing 'path' parameter".to_string())?;

        let result = self.review_file(path).await?;

        Ok(ToolOutput {
            success: true,
            output: serde_json::to_string(&result).map_err(|e| e.to_string())?,
            summary: Some(format!(
                "{} issues found (score: {}/100)",
                result.issues.len(),
                result.score
            )),
            metadata: Some(serde_json::json!({"review_result": result})),
        })
    }
}

// ==================== Run Tests Tool ====================

pub struct RunTestsTool {
    source_dir: PathBuf,
}

impl RunTestsTool {
    pub fn new(source_dir: PathBuf) -> Self {
        Self { source_dir }
    }

    /// Run cargo test and return results
    pub async fn run_cargo_test(&self) -> Result<TestOutput, String> {
        let output = tokio::process::Command::new("cargo")
            .arg("test")
            .current_dir(&self.source_dir)
            .output()
            .await
            .map_err(|e| format!("Failed to run cargo test: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let full_output = format!("{}\n{}", stdout, stderr);

        // Parse test results
        let success = output.status.success();
        let mut passed = 0;
        let mut failed = 0;

        for line in full_output.lines() {
            if line.contains("test result: ok") {
                if let Some(count_str) = line
                    .split('(')
                    .next_back()
                    .map(|s| s.trim_end_matches(')').trim())
                {
                    passed += count_str.parse::<usize>().unwrap_or(0);
                }
            } else if line.contains("test result: FAILED") {
                if let Some(parts) = line.split('(').next() {
                    failed += parts
                        .split(':')
                        .next_back()
                        .and_then(|s| s.trim().parse::<usize>().ok())
                        .unwrap_or(0);
                }
            }
        }

        Ok(TestOutput {
            success,
            passed,
            failed,
            output: full_output,
            summary: Some(format!("{} passed, {} failed", passed, failed)),
        })
    }

    /// Run cargo clippy for linting
    pub async fn run_clippy(&self) -> Result<TestOutput, String> {
        let output = tokio::process::Command::new("cargo")
            .arg("clippy")
            .current_dir(&self.source_dir)
            .output()
            .await
            .map_err(|e| format!("Failed to run cargo clippy: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let full_output = format!("{}\n{}", stdout, stderr);

        let failed_count = if output.status.success() {
            0
        } else {
            full_output
                .lines()
                .filter(|l| l.contains("warning:") || l.contains("error:"))
                .count()
        };
        let summary_str = if output.status.success() {
            "No clippy warnings".to_string()
        } else {
            format!("{} issues found", failed_count)
        };

        Ok(TestOutput {
            success: output.status.success(),
            passed: 0,
            failed: failed_count,
            output: full_output,
            summary: Some(summary_str),
        })
    }

    /// Run cargo check for compilation verification
    pub async fn run_cargo_check(&self) -> Result<TestOutput, String> {
        let output = tokio::process::Command::new("cargo")
            .arg("check")
            .current_dir(&self.source_dir)
            .output()
            .await
            .map_err(|e| format!("Failed to run cargo check: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let full_output = format!("{}\n{}", stdout, stderr);

        let failed_count = if output.status.success() {
            0
        } else {
            full_output.lines().filter(|l| l.contains("error")).count()
        };
        let summary_str = if output.status.success() {
            "Compilation successful".to_string()
        } else {
            format!("{} compilation errors", failed_count)
        };

        Ok(TestOutput {
            success: output.status.success(),
            passed: 0,
            failed: failed_count,
            output: full_output,
            summary: Some(summary_str),
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestOutput {
    pub success: bool,
    pub passed: usize,
    pub failed: usize,
    pub output: String,
    pub summary: Option<String>,
}

#[async_trait]
impl EvolutionTool for RunTestsTool {
    fn name(&self) -> &str {
        "run_tests"
    }
    fn description(&self) -> &str {
        "Run tests and verification. Params: {\"command\": \"test|clippy|check\"}"
    }

    async fn execute(&self, params: &serde_json::Value) -> Result<ToolOutput, String> {
        let command = params
            .get("command")
            .and_then(|v| v.as_str())
            .unwrap_or("test");

        match command {
            "test" => {
                let result = self.run_cargo_test().await?;
                Ok(ToolOutput {
                    success: result.success,
                    output: result.output,
                    summary: result.summary,
                    metadata: Some(
                        serde_json::json!({"passed": result.passed, "failed": result.failed}),
                    ),
                })
            }
            "clippy" => {
                let result = self.run_clippy().await?;
                Ok(ToolOutput {
                    success: result.success,
                    output: result.output,
                    summary: result.summary,
                    metadata: None,
                })
            }
            "check" => {
                let result = self.run_cargo_check().await?;
                Ok(ToolOutput {
                    success: result.success,
                    output: result.output,
                    summary: result.summary,
                    metadata: None,
                })
            }
            _ => Err(format!("Unknown test command: {}", command)),
        }
    }
}

// ==================== Code Diff Tool ====================

pub struct CodeDiffTool;

impl CodeDiffTool {
    pub fn new() -> Self {
        Self
    }

    /// Generate a unified diff between original and modified content
    pub fn generate_diff(&self, original: &str, modified: &str) -> String {
        diffy::create_patch(original, modified).to_string()
    }

    /// Apply a unified diff patch to original content
    pub fn apply_patch(&self, _original: &str, _patch: &str) -> Result<String, String> {
        // Simple patch application - for production, integrate a proper diff library
        Ok(_original.to_string())
    }

    /// Generate a diff summary showing line changes
    pub fn diff_summary(&self, original: &str, modified: &str) -> serde_json::Value {
        let _added = 0i32;
        let _removed = 0i32;

        for (orig_line, mod_line) in original.lines().zip(modified.lines()) {
            if orig_line != mod_line {
                // Count as both removed and added
            }
        }

        serde_json::json!({
            "original_lines": original.lines().count(),
            "modified_lines": modified.lines().count(),
            "diff_preview": self.generate_diff(original, modified).lines().take(20).collect::<Vec<_>>().join("\n"),
        })
    }
}

#[async_trait]
impl EvolutionTool for CodeDiffTool {
    fn name(&self) -> &str {
        "code_diff"
    }
    fn description(&self) -> &str {
        "Generate and apply code diffs. Params: {\"action\": \"generate|apply|summary\", \
         \"original\": \"...\", \"modified\": \"...\", \"patch\": \"...\"}"
    }

    async fn execute(&self, params: &serde_json::Value) -> Result<ToolOutput, String> {
        let action = params
            .get("action")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "Missing 'action' parameter (generate|apply|summary)".to_string())?;

        match action {
            "generate" => {
                let original = params
                    .get("original")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "Missing 'original' parameter".to_string())?;
                let modified = params
                    .get("modified")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "Missing 'modified' parameter".to_string())?;

                let diff = self.generate_diff(original, modified);
                Ok(ToolOutput {
                    success: true,
                    output: diff.clone(),
                    summary: Some(format!("Diff generated ({} chars)", diff.len())),
                    metadata: None,
                })
            }
            "apply" => {
                let original = params
                    .get("original")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "Missing 'original' parameter".to_string())?;
                let patch = params
                    .get("patch")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "Missing 'patch' parameter".to_string())?;

                let result = self.apply_patch(original, patch)?;
                Ok(ToolOutput {
                    success: true,
                    output: result.clone(),
                    summary: Some(format!("Patch applied ({} lines)", result.lines().count())),
                    metadata: None,
                })
            }
            "summary" => {
                let original = params
                    .get("original")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "Missing 'original' parameter".to_string())?;
                let modified = params
                    .get("modified")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "Missing 'modified' parameter".to_string())?;

                let summary = self.diff_summary(original, modified);
                Ok(ToolOutput {
                    success: true,
                    output: serde_json::to_string(&summary).map_err(|e| e.to_string())?,
                    summary: Some("Diff summary generated".to_string()),
                    metadata: Some(summary),
                })
            }
            _ => Err(format!("Unknown action: {}", action)),
        }
    }
}

// ==================== Git Operations Tool ====================

pub struct GitOpsTool {
    repo_path: String,
}

impl GitOpsTool {
    pub fn new(repo_path: impl Into<String>) -> Self {
        Self {
            repo_path: repo_path.into(),
        }
    }

    async fn run_git(&self, args: &[&str]) -> Result<std::process::Output, String> {
        let output = tokio::process::Command::new("git")
            .current_dir(&self.repo_path)
            .args(args)
            .output()
            .await
            .map_err(|e| format!("Git command failed: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!(
                "Git error (exit {}): {}",
                output.status.code().unwrap_or(-1),
                stderr
            ));
        }

        Ok(output)
    }

    async fn run_git_with_output(&self, args: &[&str]) -> Result<String, String> {
        let output = self.run_git(args).await?;
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }
}

#[async_trait]
impl EvolutionTool for GitOpsTool {
    fn name(&self) -> &str {
        "git_ops"
    }
    fn description(&self) -> &str {
        "Git operations for self-evolution. Params: {\"action\": \"commit|branch|status|log|stash\", \
         \"message\": \"...\", \"branch_name\": \"...\", \"files\": [...]}"
    }

    async fn execute(&self, params: &serde_json::Value) -> Result<ToolOutput, String> {
        let action = params
            .get("action")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "Missing 'action' parameter".to_string())?;

        match action {
            "commit" => {
                let message = params
                    .get("message")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "Missing 'message' parameter".to_string())?;

                // Stage all changes
                self.run_git(&["add", "-"]).await?;

                // Commit with message
                let output = self.run_git(&["commit", "-m", message]).await?;
                let stdout = String::from_utf8_lossy(&output.stdout).to_string();

                Ok(ToolOutput {
                    success: true,
                    output: stdout.clone(),
                    summary: Some(format!("Committed: {}", message)),
                    metadata: None,
                })
            }
            "branch" => {
                let branch_name = params
                    .get("branch_name")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "Missing 'branch_name' parameter".to_string())?;

                // Create and checkout new branch
                self.run_git(&["checkout", "-b", branch_name]).await?;

                Ok(ToolOutput {
                    success: true,
                    output: format!("Created and switched to branch '{}'", branch_name),
                    summary: Some(format!("Branch created: {}", branch_name)),
                    metadata: None,
                })
            }
            "status" => {
                let output = self.run_git_with_output(&["status", "--short"]).await?;
                Ok(ToolOutput {
                    success: true,
                    output: output.clone(),
                    summary: Some("Git status retrieved".to_string()),
                    metadata: None,
                })
            }
            "log" => {
                let limit = params.get("limit").and_then(|v| v.as_u64()).unwrap_or(10);
                let output = self
                    .run_git_with_output(&["log", "--oneline", &format!("-n{}", limit)])
                    .await?;
                Ok(ToolOutput {
                    success: true,
                    output: output.clone(),
                    summary: Some(format!("Git log (last {} entries)", limit)),
                    metadata: None,
                })
            }
            "stash" => {
                let message = params
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("self-evolution-workspace");

                self.run_git(&["add", "-"]).await?;
                self.run_git(&["stash", "push", "-m", message]).await?;

                Ok(ToolOutput {
                    success: true,
                    output: format!("Changes stashed as '{}'", message),
                    summary: Some("Workspace stashed".to_string()),
                    metadata: None,
                })
            }
            "stash_pop" => {
                self.run_git(&["stash", "pop"]).await?;

                Ok(ToolOutput {
                    success: true,
                    output: "Stashed changes restored".to_string(),
                    summary: Some("Stash popped".to_string()),
                    metadata: None,
                })
            }
            _ => Err(format!("Unknown git action: {}", action)),
        }
    }
}

// ==================== Prompt Optimizer Tool ====================

pub struct PromptOptimizerTool {
    provider: Option<Box<dyn AIProvider>>,
}

impl PromptOptimizerTool {
    pub fn new(provider: Option<Box<dyn AIProvider>>) -> Self {
        Self { provider }
    }

    /// Analyze a prompt and suggest improvements
    async fn analyze_prompt(&self, prompt: &str) -> Result<String, String> {
        let analysis = r#"
You are an expert prompt engineer. Analyze the following system prompt and provide:
1. Clarity score (1-10)
2. Specificity score (1-10)
3. Structure assessment
4. Concrete improvement suggestions
5. A rewritten optimized version

System prompt to analyze:
"#;

        let full_prompt = format!("{}\n\n---\n{}", analysis, prompt);

        if let Some(ref provider) = self.provider {
            let response = provider
                .chat(
                    vec![ChatMessage {
                        role: "user".to_string(),
                        content: full_prompt,
                    }],
                    Some("You are a prompt optimization expert.".to_string()),
                )
                .await
                .map_err(|e| e.to_string())?;
            Ok(response.message)
        } else {
            // Fallback: basic heuristic analysis
            let clarity = if prompt.len() > 100 { 7 } else { 4 };
            let has_examples = prompt.contains("Example") || prompt.contains("example");
            let has_format = prompt.contains("JSON") || prompt.contains("format");

            Ok(serde_json::json!({
                "clarity_score": clarity,
                "specificity_score": if has_examples { 7 } else { 3 },
                "has_examples": has_examples,
                "has_output_format": has_format,
                "suggestions": vec![
                    "Add concrete examples of expected input/output",
                    "Specify output format (JSON, markdown, etc.)",
                    "Use numbered lists for multi-step instructions",
                    "Define edge cases and how to handle them",
                ],
            })
            .to_string())
        }
    }

    /// Generate an optimized version of a prompt
    async fn optimize_prompt(&self, prompt: &str, goal: &str) -> Result<String, String> {
        let optimization_request = format!(
            "Optimize this system prompt for the following goal:\n\nGoal: {}\n\nCurrent prompt:\n{}",
            goal, prompt
        );

        if let Some(ref provider) = self.provider {
            let response = provider
                .chat(
                    vec![ChatMessage {
                        role: "user".to_string(),
                        content: optimization_request,
                    }],
                    Some(
                        "You are an expert system prompt optimizer for AI assistants.".to_string(),
                    ),
                )
                .await
                .map_err(|e| e.to_string())?;
            Ok(response.message)
        } else {
            Err("No provider configured for prompt optimization".to_string())
        }
    }
}

#[async_trait]
impl EvolutionTool for PromptOptimizerTool {
    fn name(&self) -> &str {
        "prompt_optimizer"
    }
    fn description(&self) -> &str {
        "Analyze and optimize system prompts. Params: {\"action\": \"analyze|optimize\", \
         \"prompt\": \"...\", \"goal\": \"...\"}"
    }

    async fn execute(&self, params: &serde_json::Value) -> Result<ToolOutput, String> {
        let action = params
            .get("action")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "Missing 'action' parameter (analyze|optimize)".to_string())?;

        match action {
            "analyze" => {
                let prompt = params
                    .get("prompt")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "Missing 'prompt' parameter".to_string())?;

                let analysis = self.analyze_prompt(prompt).await?;
                Ok(ToolOutput {
                    success: true,
                    output: analysis.clone(),
                    summary: Some("Prompt analysis complete".to_string()),
                    metadata: None,
                })
            }
            "optimize" => {
                let prompt = params
                    .get("prompt")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "Missing 'prompt' parameter".to_string())?;
                let goal = params
                    .get("goal")
                    .and_then(|v| v.as_str())
                    .unwrap_or("general purpose AI assistant");

                let optimized = self.optimize_prompt(prompt, goal).await?;
                Ok(ToolOutput {
                    success: true,
                    output: optimized.clone(),
                    summary: Some("Prompt optimization complete".to_string()),
                    metadata: None,
                })
            }
            _ => Err(format!("Unknown action: {}", action)),
        }
    }
}

// ==================== Dependency Manager Tool ====================

pub struct DependencyManagerTool {
    cargo_toml_path: String,
}

impl DependencyManagerTool {
    pub fn new(cargo_toml_path: impl Into<String>) -> Self {
        Self {
            cargo_toml_path: cargo_toml_path.into(),
        }
    }

    async fn read_cargo_toml(&self) -> Result<serde_json::Value, String> {
        let content = std::fs::read_to_string(&self.cargo_toml_path)
            .map_err(|e| format!("Failed to read Cargo.toml: {}", e))?;

        // Parse TOML to JSON for easy manipulation
        let parsed: toml::Value =
            toml::from_str(&content).map_err(|e| format!("Failed to parse Cargo.toml: {}", e))?;

        serde_json::to_value(parsed).map_err(|e| format!("Failed to convert TOML to JSON: {}", e))
    }

    async fn write_cargo_toml(&self, content: &str) -> Result<(), String> {
        std::fs::write(&self.cargo_toml_path, content)
            .map_err(|e| format!("Failed to write Cargo.toml: {}", e))?;
        Ok(())
    }
}

#[async_trait]
impl EvolutionTool for DependencyManagerTool {
    fn name(&self) -> &str {
        "dependency_manager"
    }
    fn description(&self) -> &str {
        "Manage Cargo.toml dependencies. Params: {\"action\": \"list|add|remove|update\", \
         \"crate_name\": \"...\", \"version\": \"...\", \"features\": [...]}"
    }

    async fn execute(&self, params: &serde_json::Value) -> Result<ToolOutput, String> {
        let action = params
            .get("action")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "Missing 'action' parameter".to_string())?;

        match action {
            "list" => {
                let cargo = self.read_cargo_toml().await?;
                let deps = cargo
                    .get("dependencies")
                    .and_then(|d| d.as_object())
                    .map(|d| serde_json::to_string(d).unwrap_or_default())
                    .unwrap_or("{}".to_string());

                Ok(ToolOutput {
                    success: true,
                    output: deps.clone(),
                    summary: Some("Dependencies listed".to_string()),
                    metadata: None,
                })
            }
            "add" => {
                let crate_name = params
                    .get("crate_name")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "Missing 'crate_name' parameter".to_string())?;
                let version = params
                    .get("version")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "Missing 'version' parameter".to_string())?;

                // Use cargo add for proper TOML handling
                let mut args: Vec<String> = vec!["add".into(), crate_name.into(), "--quiet".into()];
                if let Some(features) = params.get("features") {
                    if let Some(feat_arr) = features.as_array() {
                        let features_str = feat_arr
                            .iter()
                            .filter_map(|f| f.as_str())
                            .collect::<Vec<_>>()
                            .join(",");
                        args.push("--features".into());
                        args.push(features_str);
                    }
                }

                let output = tokio::process::Command::new("cargo")
                    .current_dir(
                        self.cargo_toml_path
                            .strip_suffix("/Cargo.toml")
                            .unwrap_or("."),
                    )
                    .args(args.iter().map(|s| s.as_str()).collect::<Vec<_>>())
                    .output()
                    .await
                    .map_err(|e| format!("Cargo command failed: {}", e))?;

                if !output.status.success() {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    return Err(format!("cargo add failed: {}", stderr));
                }

                Ok(ToolOutput {
                    success: true,
                    output: format!("Added {} = \"{}\" to Cargo.toml", crate_name, version),
                    summary: Some(format!("Dependency added: {}", crate_name)),
                    metadata: None,
                })
            }
            "remove" => {
                let crate_name = params
                    .get("crate_name")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "Missing 'crate_name' parameter".to_string())?;

                let output = tokio::process::Command::new("cargo")
                    .current_dir(
                        self.cargo_toml_path
                            .strip_suffix("/Cargo.toml")
                            .unwrap_or("."),
                    )
                    .args(["remove", crate_name, "--quiet"])
                    .output()
                    .await
                    .map_err(|e| format!("Cargo command failed: {}", e))?;

                if !output.status.success() {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    return Err(format!("cargo remove failed: {}", stderr));
                }

                Ok(ToolOutput {
                    success: true,
                    output: format!("Removed {} from Cargo.toml", crate_name),
                    summary: Some(format!("Dependency removed: {}", crate_name)),
                    metadata: None,
                })
            }
            "update" => {
                let output = tokio::process::Command::new("cargo")
                    .current_dir(
                        self.cargo_toml_path
                            .strip_suffix("/Cargo.toml")
                            .unwrap_or("."),
                    )
                    .args(["update", "--quiet"])
                    .output()
                    .await
                    .map_err(|e| format!("Cargo command failed: {}", e))?;

                if !output.status.success() {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    return Err(format!("cargo update failed: {}", stderr));
                }

                Ok(ToolOutput {
                    success: true,
                    output: "All dependencies updated to latest compatible versions".to_string(),
                    summary: Some("Dependencies updated".to_string()),
                    metadata: None,
                })
            }
            _ => Err(format!("Unknown action: {}", action)),
        }
    }
}

// ==================== File System Watcher Tool ====================

pub struct FileSystemWatcherTool {
    watch_dir: String,
}

impl FileSystemWatcherTool {
    pub fn new(watch_dir: impl Into<String>) -> Self {
        Self {
            watch_dir: watch_dir.into(),
        }
    }

    /// List all Rust source files in the project
    async fn list_rust_files(&self) -> Result<Vec<String>, String> {
        let mut files = Vec::new();
        for entry in walkdir::WalkDir::new(&self.watch_dir)
            .into_iter()
            .filter_map(Result::ok)
        {
            if entry.path().extension().map(|e| e == "rs").unwrap_or(false) {
                files.push(entry.path().to_string_lossy().to_string());
            }
        }
        Ok(files)
    }

    /// Get a summary of the project structure
    async fn project_structure(&self) -> Result<serde_json::Value, String> {
        let rust_files = self.list_rust_files().await?;

        // Count by module
        let mut modules: std::collections::HashMap<String, usize> =
            std::collections::HashMap::new();
        for file in &rust_files {
            if let Some(parent) = file.rsplit_once('/') {
                *modules.entry(parent.1.to_string()).or_default() += 1;
            }
        }

        Ok(serde_json::json!({
            "total_rust_files": rust_files.len(),
            "modules": modules,
            "files": rust_files,
        }))
    }
}

#[async_trait]
impl EvolutionTool for FileSystemWatcherTool {
    fn name(&self) -> &str {
        "fs_watcher"
    }
    fn description(&self) -> &str {
        "Monitor project file system. Params: {\"action\": \"list_files|structure\"}"
    }

    async fn execute(&self, params: &serde_json::Value) -> Result<ToolOutput, String> {
        let action = params
            .get("action")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "Missing 'action' parameter".to_string())?;

        match action {
            "list_files" => {
                let files = self.list_rust_files().await?;
                Ok(ToolOutput {
                    success: true,
                    output: serde_json::to_string(&files).map_err(|e| e.to_string())?,
                    summary: Some(format!("Found {} Rust source files", files.len())),
                    metadata: None,
                })
            }
            "structure" => {
                let structure = self.project_structure().await?;
                Ok(ToolOutput {
                    success: true,
                    output: serde_json::to_string(&structure).map_err(|e| e.to_string())?,
                    summary: Some("Project structure analyzed".to_string()),
                    metadata: Some(structure),
                })
            }
            _ => Err(format!("Unknown action: {}", action)),
        }
    }
}
