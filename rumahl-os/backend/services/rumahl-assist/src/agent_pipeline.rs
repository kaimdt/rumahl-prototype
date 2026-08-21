// Agent Pipeline – Cloud Planner → Local Executor → Reassembly
// Zwei-Stufen-Architektur für große Projekte/Monorepos

use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
use tracing::{error, info};

use crate::agent_task_executor::AgentTaskEvent;
use crate::providers::{
    create_provider, provider_type_from_str, ChatMessage, ProviderConfig, ProviderType,
};
use crate::sandbox::{SandboxManager, TaskOutputLine, WorkspaceFile};

/// Status einer Pipeline-Phase
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub enum PipelinePhase {
    Idle,
    /// Cloud AI analysiert das Projekt und erstellt einen Plan
    Planning,
    /// Skeleton wird erstellt (nur benötigte Dateien)
    Skeletonizing,
    /// Lokaler/gewählter Agent führt die Änderungen aus
    Executing,
    /// Änderungen werden zurück ins Original-Projekt gemergt
    Reassembling,
    /// Validierung: Syntax, Imports, Referenzen
    Validating,
    Completed,
    Failed(String),
}

impl PipelinePhase {
    pub fn label(&self) -> &str {
        match self {
            Self::Idle => "Bereit",
            Self::Planning => "📋 Analysiere Codebasis und erstelle Plan…",
            Self::Skeletonizing => "🔬 Erstelle Skeleton mit benötigten Dateien…",
            Self::Executing => "⚡ Führe Änderungen aus…",
            Self::Reassembling => "🔗 Setze Änderungen zurück ins Projekt…",
            Self::Validating => "✅ Validiere Änderungen…",
            Self::Completed => "✅ Abgeschlossen",
            Self::Failed(e) => e,
        }
    }
}

/// Ein Schritt im Plan
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PlanStep {
    pub action: String, // "modify" | "create" | "delete" | "rename"
    pub file_path: String,
    pub new_path: Option<String>,
    pub description: String,
    pub reason: String,
    pub estimated_complexity: String, // "low" | "medium" | "high"
    pub dependencies: Vec<String>,    // Dateien, die zuerst bearbeitet werden müssen
}

/// Der vollständige Plan vom Cloud-Analyzer
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ExecutionPlan {
    pub summary: String,
    pub steps: Vec<PlanStep>,
    pub files_to_include: Vec<String>,
    pub estimated_total_changes: u32,
    pub risk_assessment: String, // "low" | "medium" | "high"
    pub notes: Vec<String>,
}

/// Pipeline-Konfiguration
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PipelineConfig {
    pub enabled: bool,
    pub cloud_provider: String,
    pub cloud_model: String,
    pub executor_provider: String,
    pub executor_model: String,
    pub include_all_files: bool,
    pub max_file_size: u64,
    pub validate_after_merge: bool,
}

impl Default for PipelineConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            cloud_provider: "anthropic".to_string(),
            cloud_model: "claude-sonnet-4-20250514".to_string(),
            executor_provider: "deepseek".to_string(),
            executor_model: "deepseek-coder".to_string(),
            include_all_files: false,
            max_file_size: 500_000,
            validate_after_merge: true,
        }
    }
}

/// Der Pipeline-Orchestrator
pub struct AgentPipeline {
    sandbox: Arc<SandboxManager>,
    event_tx: broadcast::Sender<AgentTaskEvent>,
    current_phase: Arc<RwLock<PipelinePhase>>,
}

impl AgentPipeline {
    pub fn new(sandbox: Arc<SandboxManager>, event_tx: broadcast::Sender<AgentTaskEvent>) -> Self {
        Self {
            sandbox,
            event_tx,
            current_phase: Arc::new(RwLock::new(PipelinePhase::Idle)),
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<AgentTaskEvent> {
        self.event_tx.subscribe()
    }

    pub async fn current_phase(&self) -> PipelinePhase {
        self.current_phase.read().await.clone()
    }

    fn set_phase(&self, phase: PipelinePhase) {
        let tx = self.event_tx.clone();
        let phase_clone = phase.clone();
        let current = self.current_phase.clone();
        tokio::spawn(async move {
            let label = phase_clone.label().to_string();
            *current.write().await = phase_clone;
            let _ = tx.send(AgentTaskEvent::StatusChange {
                task_id: "pipeline".to_string(),
                status: label,
            });
        });
    }

    fn emit_output(&self, task_id: &str, level: &str, message: String) {
        let tx = self.event_tx.clone();
        let tid = task_id.to_string();
        let line = TaskOutputLine {
            timestamp: chrono::Utc::now(),
            level: level.to_string(),
            message,
            stream: None,
        };
        tokio::spawn(async move {
            let _ = tx.send(AgentTaskEvent::Output { task_id: tid, line });
        });
    }

    /// Haupt-Pipeline: Führt den gesamten Two-Stage-Prozess aus
    pub async fn run_pipeline(
        self: Arc<Self>,
        workspace_id: &str,
        task_description: &str,
        pipeline_config: PipelineConfig,
    ) -> Result<(), String> {
        let _workspace = self
            .sandbox
            .get_workspace(workspace_id)
            .await
            .ok_or_else(|| "Workspace not found".to_string())?;

        // Prüfe Provider-Verfügbarkeit
        let cloud_available = self
            .check_provider(
                &pipeline_config.cloud_provider,
                &pipeline_config.cloud_model,
                None,
                None,
            )
            .await;
        let executor_available = self
            .check_provider(
                &pipeline_config.executor_provider,
                &pipeline_config.executor_model,
                None,
                None,
            )
            .await;

        if !cloud_available {
            return Err(format!(
                "Cloud-Planner-Provider '{}' nicht verfügbar",
                pipeline_config.cloud_provider
            ));
        }
        if !executor_available {
            return Err(format!(
                "Executor-Provider '{}' nicht verfügbar",
                pipeline_config.executor_provider
            ));
        }

        info!(
            "Starting pipeline for workspace {}: Cloud={}/{} Executor={}/{}",
            workspace_id,
            pipeline_config.cloud_provider,
            pipeline_config.cloud_model,
            pipeline_config.executor_provider,
            pipeline_config.executor_model,
        );

        let pipeline = self.clone();
        let ws_id = workspace_id.to_string();
        let task_desc = task_description.to_string();
        let cfg = pipeline_config.clone();

        tokio::spawn(async move {
            // Phase 1: Cloud Planning
            pipeline.set_phase(PipelinePhase::Planning);
            pipeline.emit_output(
                &ws_id,
                "system",
                "Phase 1/4: Cloud AI analysiert Codebasis…".to_string(),
            );

            let plan = match pipeline.phase_planning(&ws_id, &task_desc, &cfg).await {
                Ok(p) => p,
                Err(e) => {
                    pipeline.set_phase(PipelinePhase::Failed(format!("Planning failed: {}", e)));
                    return;
                }
            };

            // Phase 2: Skeletonizing
            pipeline.set_phase(PipelinePhase::Skeletonizing);
            pipeline.emit_output(
                &ws_id,
                "system",
                format!(
                    "Phase 2/4: Erstelle Skeleton mit {} Datei(en)…",
                    plan.files_to_include.len()
                ),
            );

            let skeleton_dir = match pipeline.phase_skeletonize(&ws_id, &plan, &cfg).await {
                Some(d) => d,
                None => {
                    pipeline.set_phase(PipelinePhase::Failed("Skeletonizing failed".to_string()));
                    return;
                }
            };

            // Phase 3: Execution
            pipeline.set_phase(PipelinePhase::Executing);
            pipeline.emit_output(
                &ws_id,
                "system",
                format!("Phase 3/4: Führe {} Änderung(en) aus…", plan.steps.len()),
            );

            if let Err(e) = pipeline
                .phase_execute(&ws_id, &skeleton_dir, &plan, &cfg)
                .await
            {
                pipeline.set_phase(PipelinePhase::Failed(format!("Execution failed: {}", e)));
                return;
            }

            // Phase 4: Reassembly + Validation
            pipeline.set_phase(PipelinePhase::Reassembling);
            pipeline.emit_output(
                &ws_id,
                "system",
                "Phase 4/4: Setze Änderungen zurück und validiere…".to_string(),
            );

            if let Err(e) = pipeline
                .phase_reassemble(&ws_id, &skeleton_dir, &plan, &cfg)
                .await
            {
                pipeline.set_phase(PipelinePhase::Failed(format!("Reassembly failed: {}", e)));
                return;
            }

            pipeline.set_phase(PipelinePhase::Completed);
            pipeline.emit_output(
                &ws_id,
                "success",
                "✅ Pipeline erfolgreich abgeschlossen!".to_string(),
            );
        });

        Ok(())
    }

    // ─── Phase 1: Cloud Planning ────────────────────────────────────────
    async fn phase_planning(
        &self,
        workspace_id: &str,
        task_description: &str,
        config: &PipelineConfig,
    ) -> Result<ExecutionPlan, String> {
        let workspace = self
            .sandbox
            .get_workspace(workspace_id)
            .await
            .ok_or_else(|| "Workspace not found".to_string())?;

        // Liste alle Dateien (rekursiv)
        let all_files = self.sandbox.list_files(workspace_id, None).await?;
        let source_files: Vec<_> = all_files
            .iter()
            .filter(|f| !f.is_dir && f.size_bytes < config.max_file_size)
            .collect();

        self.emit_output(
            workspace_id,
            "info",
            format!("Analysiere {} Datei(en)…", source_files.len()),
        );

        // Baue Projekt-Übersicht (Dateibaum + wichtige Dateien)
        let mut project_overview = String::new();
        project_overview.push_str(&format!("# Projekt: {}\n", workspace.name));
        project_overview.push_str(&format!("Pfad: {}\n", workspace.path));
        project_overview.push_str(&format!("Dateien: {}\n", source_files.len()));
        if let Some(ref remote) = workspace.git_remote {
            project_overview.push_str(&format!("Git: {}\n", remote));
        }
        project_overview.push_str("\n## Dateistruktur\n");

        // Gruppiere nach Verzeichnis
        let mut dirs: std::collections::BTreeMap<String, Vec<&WorkspaceFile>> =
            std::collections::BTreeMap::new();
        for f in &source_files {
            let path = std::path::Path::new(&f.path);
            let dir = path
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            dirs.entry(dir).or_default().push(f);
        }

        for (dir, files) in &dirs {
            project_overview.push_str(&format!("\n📁 {}/\n", dir));
            for f in files {
                let marker = if f.name.ends_with(".rs")
                    || f.name.ends_with(".ts")
                    || f.name.ends_with(".tsx")
                    || f.name.ends_with(".py")
                    || f.name.ends_with(".go")
                    || f.name.ends_with(".js")
                    || f.name == "Cargo.toml"
                    || f.name == "package.json"
                {
                    "📄"
                } else {
                    "📎"
                };
                project_overview
                    .push_str(&format!("  {} {} ({} B)\n", marker, f.name, f.size_bytes));
            }
        }

        // Lese Schlüsseldateien für Kontext
        let mut key_files_content = String::new();
        let key_extensions = [
            ".rs",
            ".ts",
            ".tsx",
            ".js",
            ".py",
            ".go",
            "Cargo.toml",
            "package.json",
        ];

        for f in source_files.iter().take(20) {
            if key_extensions.iter().any(|ext| f.path.ends_with(ext)) {
                if let Ok(content) = self.sandbox.read_file(workspace_id, &f.path).await {
                    if content.len() < 50_000 {
                        key_files_content.push_str(&format!(
                            "\n=== {} ===\n{}\n",
                            f.path,
                            &content[..content.len().min(10_000)]
                        ));
                    }
                }
            }
        }

        // Cloud AI Prompt
        let cloud_provider_enum =
            provider_type_from_str(&config.cloud_provider).unwrap_or(ProviderType::Anthropic);

        let cloud_config = ProviderConfig {
            api_key: None, // Wird aus Umgebungsvariablen oder DB geladen
            base_url: None,
            model: Some(config.cloud_model.clone()),
            api_version: None,
        };

        let provider = create_provider(cloud_provider_enum, cloud_config);
        let available = provider.is_available().await;
        if !available {
            return Err(format!(
                "Cloud provider '{}' nicht verfügbar",
                config.cloud_provider
            ));
        }

        let planning_prompt = format!(
            r#"You are an expert software architect. Your job is to analyze a codebase and create a detailed plan.

## Task
{}

## Project Overview
{}

## Key Files Content
{}

## Instructions
1. Analyze the codebase structure and understand what needs to change.
2. Create a JSON execution plan with these fields:
   - summary: Brief summary of what needs to be done
   - steps: Array of {{action, file_path, new_path, description, reason, estimated_complexity, dependencies}}
   - files_to_include: List of files that need to be included in the skeleton
   - estimated_total_changes: Total number of file changes
   - risk_assessment: "low" | "medium" | "high"
   - notes: Array of important notes/warnings

3. Be THOROUGH. Include ALL files that need modification.
4. Consider dependencies between files (e.g., imports that need updating).
5. For monorepos, focus only on the relevant packages/sections.
6. Return ONLY valid JSON, no explanation text.

## JSON Format
{{
  "summary": "...",
  "steps": [
    {{"action": "modify|create|delete|rename", "file_path": "...", "new_path": null, "description": "...", "reason": "...", "estimated_complexity": "low|medium|high", "dependencies": []}}
  ],
  "files_to_include": ["..."],
  "estimated_total_changes": 0,
  "risk_assessment": "low|medium|high",
  "notes": []
}}
"#,
            task_description, project_overview, key_files_content,
        );

        self.emit_output(
            workspace_id,
            "info",
            "Sende Planungsanfrage an Cloud AI…".to_string(),
        );

        let messages = vec![
            ChatMessage {
                role: "system".to_string(),
                content: "You are a JSON-only code planning assistant. Output ONLY valid JSON."
                    .to_string(),
            },
            ChatMessage {
                role: "user".to_string(),
                content: planning_prompt,
            },
        ];

        match provider.chat(messages, None).await {
            Ok(response) => {
                // Parse JSON from response
                let cleaned = response
                    .message
                    .trim()
                    .trim_start_matches("```json")
                    .trim_start_matches("```")
                    .trim_end_matches("```")
                    .trim();

                match serde_json::from_str::<ExecutionPlan>(cleaned) {
                    Ok(plan) => {
                        self.emit_output(
                            workspace_id,
                            "success",
                            format!(
                                "Plan erstellt: {} Änderung(en) an {} Datei(en) (Risiko: {})",
                                plan.estimated_total_changes,
                                plan.files_to_include.len(),
                                plan.risk_assessment,
                            ),
                        );
                        Ok(plan)
                    }
                    Err(e) => {
                        error!("Failed to parse plan JSON: {} | Response: {}", e, cleaned);
                        Err(format!("Cloud AI returned invalid JSON: {}", e))
                    }
                }
            }
            Err(e) => Err(format!("Cloud AI request failed: {}", e)),
        }
    }

    // ─── Phase 2: Skeletonizing ────────────────────────────────────────
    async fn phase_skeletonize(
        &self,
        workspace_id: &str,
        plan: &ExecutionPlan,
        _config: &PipelineConfig,
    ) -> Option<String> {
        let workspace = self.sandbox.get_workspace(workspace_id).await?;
        let skeleton_base = std::path::PathBuf::from(&workspace.path).join(".rumahl-skeleton");

        // Create skeleton directory
        std::fs::create_dir_all(&skeleton_base).ok()?;

        // Copy only needed files
        for file_path in &plan.files_to_include {
            let src = std::path::PathBuf::from(&workspace.path).join(file_path);
            let dst = skeleton_base.join(file_path);

            if src.exists() {
                if let Some(parent) = dst.parent() {
                    std::fs::create_dir_all(parent).ok()?;
                }
                match std::fs::copy(&src, &dst) {
                    Ok(_) => self.emit_output(workspace_id, "info", format!("  📦 {}", file_path)),
                    Err(e) => self.emit_output(
                        workspace_id,
                        "warn",
                        format!("  ⚠️  {}: {}", file_path, e),
                    ),
                }
            }
        }

        // Create plan file
        let plan_path = skeleton_base.join("_plan.json");
        if let Ok(json) = serde_json::to_string_pretty(plan) {
            std::fs::write(&plan_path, &json).ok();
        }

        self.emit_output(
            workspace_id,
            "success",
            format!(
                "Skeleton erstellt mit {} Datei(en) in .rumahl-skeleton/",
                plan.files_to_include.len()
            ),
        );

        Some(skeleton_base.to_string_lossy().to_string())
    }

    // ─── Phase 3: Execution ────────────────────────────────────────────
    async fn phase_execute(
        &self,
        workspace_id: &str,
        _skeleton_dir: &str,
        plan: &ExecutionPlan,
        config: &PipelineConfig,
    ) -> Result<(), String> {
        let executor_provider_enum =
            provider_type_from_str(&config.executor_provider).unwrap_or(ProviderType::DeepSeek);

        let executor_config = ProviderConfig {
            api_key: None,
            base_url: None,
            model: Some(config.executor_model.clone()),
            api_version: None,
        };

        let provider = create_provider(executor_provider_enum, executor_config);
        if !provider.is_available().await {
            return Err(format!(
                "Executor provider '{}' nicht verfügbar",
                config.executor_provider
            ));
        }

        // Process each step
        for (i, step) in plan.steps.iter().enumerate() {
            self.emit_output(
                workspace_id,
                "info",
                format!(
                    "[{}/{}] {}: {}",
                    i + 1,
                    plan.steps.len(),
                    step.action,
                    step.file_path,
                ),
            );

            let full_path = std::path::PathBuf::from(_skeleton_dir).join(&step.file_path);

            // Read current file content
            let current_content = if full_path.exists() {
                std::fs::read_to_string(&full_path).unwrap_or_default()
            } else {
                String::new()
            };

            let execution_prompt = format!(
                r#"You are an expert code editor. Apply the following change to the file.

## Action: {}
## File: {}
## Description: {}
## Reason: {}

## Current Content:
```{}
{}```
"#,
                step.action,
                step.file_path,
                step.description,
                step.reason,
                std::path::Path::new(&step.file_path)
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("txt"),
                &current_content[..current_content.len().min(50_000)],
            );

            let messages = vec![
                ChatMessage {
                    role: "system".to_string(),
                    content: format!(
                        "You are a code editing AI. {} Make LARGE changes when needed - the user explicitly allows major refactoring. \
                         Output ONLY the new complete file content, no explanations.",
                        match step.action.as_str() {
                            "create" => "Create the file with full implementation.",
                            "delete" => "Confirm deletion.",
                            "rename" => "Provide the new file content.",
                            _ => "Modify the file. You can make significant changes, restructure code, add new features.",
                        }
                    ),
                },
                ChatMessage { role: "user".to_string(), content: execution_prompt },
            ];

            match provider.chat(messages, None).await {
                Ok(response) => {
                    if step.action == "delete" {
                        std::fs::remove_file(&full_path).ok();
                        self.emit_output(
                            workspace_id,
                            "success",
                            format!("  🗑️  {} gelöscht", step.file_path),
                        );
                    } else if step.action == "rename" {
                        // Handle rename
                        if let Some(ref new_path) = step.new_path {
                            let new_full = std::path::PathBuf::from(_skeleton_dir).join(new_path);
                            if let Some(parent) = new_full.parent() {
                                std::fs::create_dir_all(parent).ok();
                            }
                            std::fs::rename(&full_path, &new_full).ok();
                            self.emit_output(
                                workspace_id,
                                "success",
                                format!("  📝 {} → {}", step.file_path, new_path),
                            );
                        }
                    } else {
                        // Write the new content
                        let new_content = response
                            .message
                            .trim()
                            .trim_start_matches("```")
                            .trim_end_matches("```")
                            .trim();

                        if let Some(parent) = full_path.parent() {
                            std::fs::create_dir_all(parent).ok();
                        }

                        let size_before = current_content.len();
                        std::fs::write(&full_path, new_content)
                            .map_err(|e| format!("Failed to write {}: {}", step.file_path, e))?;
                        let size_after = new_content.len();

                        self.emit_output(
                            workspace_id,
                            "success",
                            format!(
                                "  {} ({}B → {}B, {:+.1}%)",
                                step.file_path,
                                size_before,
                                size_after,
                                if size_before > 0 {
                                    (size_after as f64 - size_before as f64) / size_before as f64
                                        * 100.0
                                } else {
                                    100.0
                                },
                            ),
                        );
                    }
                }
                Err(e) => {
                    self.emit_output(
                        workspace_id,
                        "error",
                        format!("  ❌ {}: {}", step.file_path, e),
                    );
                    return Err(format!("Execution failed for {}: {}", step.file_path, e));
                }
            }
        }

        Ok(())
    }

    // ─── Phase 4: Reassembly ───────────────────────────────────────────
    async fn phase_reassemble(
        &self,
        workspace_id: &str,
        skeleton_dir: &str,
        plan: &ExecutionPlan,
        config: &PipelineConfig,
    ) -> Result<(), String> {
        let workspace = self
            .sandbox
            .get_workspace(workspace_id)
            .await
            .ok_or_else(|| "Workspace not found".to_string())?;
        let project_dir = std::path::PathBuf::from(&workspace.path);
        let skel_dir = std::path::PathBuf::from(skeleton_dir);

        // 1. Copy all changed files back to the project
        self.emit_output(
            workspace_id,
            "info",
            "Kopiere geänderte Dateien zurück…".to_string(),
        );
        let mut copied_files = 0u32;

        for entry in walkdir::WalkDir::new(&skel_dir)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_type().is_file()
                    && e.path().file_name().and_then(|n| n.to_str()) != Some("_plan.json")
            })
        {
            let relative = entry
                .path()
                .strip_prefix(&skel_dir)
                .map_err(|e| format!("Path error: {}", e))?;
            let dest = project_dir.join(relative);

            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent).ok();
            }

            match std::fs::copy(entry.path(), &dest) {
                Ok(_) => {
                    copied_files += 1;
                    self.emit_output(
                        workspace_id,
                        "info",
                        format!("  ↩️  {}", relative.display()),
                    );
                }
                Err(e) => {
                    self.emit_output(
                        workspace_id,
                        "error",
                        format!("  ❌ {}: {}", relative.display(), e),
                    );
                }
            }
        }

        self.emit_output(
            workspace_id,
            "success",
            format!("{} Datei(en) zurückkopiert", copied_files),
        );

        // 2. Clean up skeleton directory
        std::fs::remove_dir_all(&skel_dir).ok();

        // 3. Run git diff to show all changes
        let diff_result = self.sandbox.git_status(workspace_id).await;
        if let Ok(diffs) = diff_result {
            self.emit_output(
                workspace_id,
                "info",
                format!("→ {} geänderte Datei(en) im Git-Diff", diffs.len()),
            );
            for d in &diffs {
                self.emit_output(
                    workspace_id,
                    "info",
                    format!("  {} {}", d.status, d.file_path),
                );
            }
        }

        // 4. Optional: Validation
        if config.validate_after_merge {
            self.emit_output(workspace_id, "info", "Validiere Änderungen…".to_string());

            // Prüfe auf häufige Probleme
            let mut issues = Vec::new();

            // Check for missing files referenced in plan
            for step in &plan.steps {
                let full_path = project_dir.join(&step.file_path);
                if step.action != "delete" && !full_path.exists() {
                    issues.push(format!(
                        "⚠️  {} existiert nicht (sollte erstellt worden sein)",
                        step.file_path
                    ));
                }
            }

            // Check for broken symlinks or empty files
            for entry in walkdir::WalkDir::new(&project_dir)
                .into_iter()
                .filter_map(|e| e.ok())
                .filter(|e| e.file_type().is_file())
                .filter(|e| {
                    e.path()
                        .extension()
                        .map(|e| e == "rs" || e == "ts" || e == "tsx" || e == "js" || e == "py")
                        .unwrap_or(false)
                })
                .take(100)
            // Limit check
            {
                if let Ok(meta) = entry.metadata() {
                    if meta.len() == 0 {
                        issues.push(format!("⚠️  Leere Datei: {}", entry.path().display()));
                    }
                }
            }

            if issues.is_empty() {
                self.emit_output(
                    workspace_id,
                    "success",
                    "✅ Validierung: Keine Probleme gefunden".to_string(),
                );
            } else {
                for issue in &issues {
                    self.emit_output(workspace_id, "warn", issue.clone());
                }
                self.emit_output(
                    workspace_id,
                    "warn",
                    format!("⚠️  {} Validierungs-Warnung(en)", issues.len()),
                );
            }
        }

        // Refresh sandbox
        let _ = self.sandbox.list_workspaces().await;
        self.emit_output(
            workspace_id,
            "success",
            "✅ Reassembly abgeschlossen!".to_string(),
        );

        Ok(())
    }

    // ─── Helpers ───────────────────────────────────────────────────────
    async fn check_provider(
        &self,
        provider_type: &str,
        model: &str,
        api_key: Option<&str>,
        base_url: Option<&str>,
    ) -> bool {
        let provider_enum =
            provider_type_from_str(provider_type).unwrap_or(ProviderType::Anthropic);
        let config = ProviderConfig {
            api_key: api_key.map(|s| s.to_string()),
            base_url: base_url.map(|s| s.to_string()),
            model: Some(model.to_string()),
            api_version: None,
        };
        let provider = create_provider(provider_enum, config);
        provider.is_available().await
    }
}
