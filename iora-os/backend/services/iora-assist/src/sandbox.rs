// Sandbox/Workspace-Manager für IORA Agent Tasks
// Verwaltet isolierte Arbeitsverzeichnisse mit Git-Integration

use std::path::{Path, PathBuf};
use std::sync::Arc;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use tracing::{error, info};
use uuid::Uuid;

/// Ein isoliertes Projekt-Workspace
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    /// Absolute path on disk
    pub path: String,
    /// Source: "new" | "clone" | "import"
    pub source: String,
    /// Git remote URL if cloned
    pub git_remote: Option<String>,
    pub git_branch: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub file_count: u64,
    pub total_size_bytes: u64,
    pub status: String, // "active" | "building" | "idle" | "error"
}

/// Eine Datei im Workspace
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceFile {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub size_bytes: u64,
    pub modified_at: DateTime<Utc>,
}

/// Git-Diff einer geänderten Datei
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileDiff {
    pub file_path: String,
    pub status: String, // "modified" | "added" | "deleted" | "renamed"
    pub hunks: Vec<DiffHunk>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffHunk {
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub content: String,
}

/// Steering/Task-Konfiguration – erlaubt User-Steering
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskConfig {
    /// Chain-of-Thought Reasoning (Thinking)
    pub thinking_enabled: bool,
    /// Creativity (0.0 = precise, 1.0 = creative)
    pub temperature: f32,
    /// Wie viel Code-Kontext soll mitgesendet werden
    /// "none" | "changed" | "all" | "full"
    pub context_level: String,
    /// Änderungen automatisch anwenden oder reviewen lassen
    pub auto_apply: bool,
    /// Bei jeder Datei nachfragen oder Batch
    pub confirm_each_file: bool,
    /// Maximale Anzahl Dateien im Kontext
    pub max_context_files: u32,
    /// Modus: "fast" | "balanced" | "detailed" | "creative" | "economy"
    pub mode: String,
    /// Custom instructions, die dem System-Prompt hinzugefügt werden
    pub custom_instructions: Option<String>,
}

impl Default for TaskConfig {
    fn default() -> Self {
        Self {
            thinking_enabled: true,
            temperature: 0.3,
            context_level: "changed".to_string(),
            auto_apply: false,
            confirm_each_file: true,
            max_context_files: 30,
            mode: "balanced".to_string(),
            custom_instructions: None,
        }
    }
}

/// Agent Task, der in einem Workspace läuft
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentTask {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub description: String,
    pub model: String,
    pub provider: String,
    pub status: String, // "queued" | "running" | "completed" | "failed" | "cancelled"
    pub progress: f32,
    pub output: Vec<TaskOutputLine>,
    pub changes: Vec<FileDiff>,
    pub created_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub error: Option<String>,
    /// User-Steering Konfiguration
    pub config: TaskConfig,
}

/// Git Commit History Eintrag
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitCommitEntry {
    pub hash: String,
    pub author: String,
    pub email: String,
    pub message: String,
    pub timestamp: String,
    pub files_changed: u32,
    pub insertions: u32,
    pub deletions: u32,
}

/// Git Branch Info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitBranch {
    pub name: String,
    pub is_current: bool,
    pub is_remote: bool,
    pub last_commit_hash: Option<String>,
    pub last_commit_message: Option<String>,
    pub behind_main: Option<u32>,
    pub ahead_main: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskOutputLine {
    pub timestamp: DateTime<Utc>,
    pub level: String, // "info" | "warn" | "error" | "success" | "system"
    pub message: String,
    pub stream: Option<String>, // "stdout" | "stderr" für Shell-Ausgaben
}

/// SandboxManager – zentrale Verwaltung aller Workspaces und Agent Tasks
pub struct SandboxManager {
    base_dir: PathBuf,
    workspaces: Arc<RwLock<Vec<Workspace>>>,
    agent_tasks: Arc<RwLock<Vec<AgentTask>>>,
}

impl SandboxManager {
    pub fn new(base_dir: PathBuf) -> Self {
        std::fs::create_dir_all(&base_dir).ok();
        Self {
            base_dir,
            workspaces: Arc::new(RwLock::new(Vec::new())),
            agent_tasks: Arc::new(RwLock::new(Vec::new())),
        }
    }

    // ─── Workspace Operations ───────────────────────────────────────────────

    /// Create a new empty workspace
    pub async fn create_workspace(&self, name: &str, source: &str, git_url: Option<&str>) -> Result<Workspace, String> {
        let id = Uuid::new_v4().to_string();
        let safe_name = sanitize_name(name);
        let workspace_path = self.base_dir.join(&id);

        // Create directory
        std::fs::create_dir_all(&workspace_path)
            .map_err(|e| format!("Failed to create workspace dir: {}", e))?;

        // If git URL provided, clone
        let (git_remote, git_branch) = if let Some(url) = git_url {
            info!("Cloning git repo: {} into {}", url, workspace_path.display());
            let output = tokio::process::Command::new("git")
                .args(["clone", url, "."])
                .current_dir(&workspace_path)
                .output()
                .await
                .map_err(|e| format!("Git clone failed: {}", e))?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                error!("Git clone failed: {}", stderr);
                // Clean up
                std::fs::remove_dir_all(&workspace_path).ok();
                return Err(format!("Git clone failed: {}", stderr));
            }
            (Some(url.to_string()), Some("main".to_string()))
        } else if source == "new" {
            // Initialize empty git repo
            tokio::process::Command::new("git")
                .args(["init"])
                .current_dir(&workspace_path)
                .output()
                .await
                .ok();
            
            // Create .gitignore
            std::fs::write(workspace_path.join(".gitignore"), "node_modules/\n.env\ndist/\nbuild/\n")
                .ok();
            
            tokio::process::Command::new("git")
                .args(["add", "."])
                .current_dir(&workspace_path)
                .output()
                .await
                .ok();
            
            tokio::process::Command::new("git")
                .args(["commit", "-m", "Initial commit"])
                .current_dir(&workspace_path)
                .output()
                .await
                .ok();
            
            (None, Some("main".to_string()))
        } else {
            (None, None)
        };

        // Count files
        let (file_count, total_size) = self.count_files(&workspace_path);

        let now = Utc::now();
        let workspace = Workspace {
            id: id.clone(),
            name: safe_name,
            path: workspace_path.to_string_lossy().to_string(),
            source: source.to_string(),
            git_remote,
            git_branch,
            created_at: now,
            updated_at: now,
            file_count,
            total_size_bytes: total_size,
            status: "active".to_string(),
        };

        self.workspaces.write().await.push(workspace.clone());
        info!("Workspace created: {} at {}", workspace.id, workspace.path);
        Ok(workspace)
    }

    /// List all workspaces
    pub async fn list_workspaces(&self) -> Vec<Workspace> {
        let mut ws = self.workspaces.read().await.clone();
        // Refresh file counts
        for w in ws.iter_mut() {
            let p = PathBuf::from(&w.path);
            if p.exists() {
                let (fc, ts) = self.count_files(&p);
                w.file_count = fc;
                w.total_size_bytes = ts;
            }
        }
        ws
    }

    /// Get single workspace
    pub async fn get_workspace(&self, id: &str) -> Option<Workspace> {
        let ws = self.workspaces.read().await;
        ws.iter().find(|w| w.id == id).cloned()
    }

    /// Delete workspace and all its files
    pub async fn delete_workspace(&self, id: &str) -> Result<(), String> {
        let ws = {
            let mut workspaces = self.workspaces.write().await;
            let idx = workspaces.iter().position(|w| w.id == id)
                .ok_or_else(|| format!("Workspace not found: {}", id))?;
            workspaces.remove(idx)
        };

        // Remove directory
        let path = PathBuf::from(&ws.path);
        if path.exists() {
            std::fs::remove_dir_all(&path)
                .map_err(|e| format!("Failed to delete workspace dir: {}", e))?;
        }

        // Also remove associated agent tasks
        let mut tasks = self.agent_tasks.write().await;
        tasks.retain(|t| t.workspace_id != id);

        info!("Workspace deleted: {}", id);
        Ok(())
    }

    // ─── File Operations ────────────────────────────────────────────────────

    /// List files in a workspace
    pub async fn list_files(&self, workspace_id: &str, sub_path: Option<&str>) -> Result<Vec<WorkspaceFile>, String> {
        let ws = self.get_workspace(workspace_id).await
            .ok_or_else(|| "Workspace not found".to_string())?;
        
        let dir_path = match sub_path {
            Some(p) => PathBuf::from(&ws.path).join(p.trim_start_matches('/')),
            None => PathBuf::from(&ws.path),
        };

        if !dir_path.exists() || !dir_path.is_dir() {
            return Err("Directory not found".to_string());
        }

        let mut files = Vec::new();
        let mut entries: Vec<_> = std::fs::read_dir(&dir_path)
            .map_err(|e| format!("Failed to read dir: {}", e))?
            .filter_map(|e| e.ok())
            .collect();
        entries.sort_by_key(|e| e.file_name());

        for entry in entries {
            let meta = entry.metadata().ok();
            let relative = entry.path().strip_prefix(&ws.path)
                .unwrap_or(entry.path().as_path())
                .to_string_lossy()
                .to_string();

            let file_size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
            let modified = meta.as_ref().and_then(|m| m.modified().ok())
                .map(|t| {
                    let duration = t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
                    DateTime::from_timestamp(duration.as_secs() as i64, duration.subsec_nanos())
                        .unwrap_or(Utc::now())
                })
                .unwrap_or(Utc::now());

            files.push(WorkspaceFile {
                path: relative,
                name: entry.file_name().to_string_lossy().to_string(),
                is_dir: entry.file_type().map(|t| t.is_dir()).unwrap_or(false),
                size_bytes: file_size,
                modified_at: modified,
            });
        }

        Ok(files)
    }

    /// Read file contents
    pub async fn read_file(&self, workspace_id: &str, file_path: &str) -> Result<String, String> {
        let ws = self.get_workspace(workspace_id).await
            .ok_or_else(|| "Workspace not found".to_string())?;
        
        let full_path = PathBuf::from(&ws.path).join(file_path.trim_start_matches('/'));
        if !full_path.exists() || !full_path.is_file() {
            return Err("File not found".to_string());
        }

        std::fs::read_to_string(&full_path)
            .map_err(|e| format!("Failed to read file: {}", e))
    }

    /// Write file contents
    pub async fn write_file(&self, workspace_id: &str, file_path: &str, content: &str) -> Result<(), String> {
        let ws = self.get_workspace(workspace_id).await
            .ok_or_else(|| "Workspace not found".to_string())?;
        
        let full_path = PathBuf::from(&ws.path).join(file_path.trim_start_matches('/'));
        
        // Create parent directories
        if let Some(parent) = full_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create dirs: {}", e))?;
        }

        std::fs::write(&full_path, content)
            .map_err(|e| format!("Failed to write file: {}", e))?;

        // Update workspace timestamp
        let mut ws_list = self.workspaces.write().await;
        if let Some(w) = ws_list.iter_mut().find(|w| w.id == workspace_id) {
            w.updated_at = Utc::now();
        }

        Ok(())
    }

    // ─── Git Operations ─────────────────────────────────────────────────────

    /// Get git status as diff
    pub async fn git_status(&self, workspace_id: &str) -> Result<Vec<FileDiff>, String> {
        let ws = self.get_workspace(workspace_id).await
            .ok_or_else(|| "Workspace not found".to_string())?;
        git_diff(&PathBuf::from(&ws.path)).await
    }

    /// Git add all and commit
    pub async fn git_commit(&self, workspace_id: &str, message: &str) -> Result<String, String> {
        let ws = self.get_workspace(workspace_id).await
            .ok_or_else(|| "Workspace not found".to_string())?;
        let dir = PathBuf::from(&ws.path);
        
        // git add -A
        let add = tokio::process::Command::new("git")
            .args(["add", "-A"])
            .current_dir(&dir)
            .output()
            .await
            .map_err(|e| format!("Git add failed: {}", e))?;

        if !add.status.success() {
            return Err(format!("Git add failed: {}", String::from_utf8_lossy(&add.stderr)));
        }

        // git commit
        let commit = tokio::process::Command::new("git")
            .args(["commit", "-m", message])
            .current_dir(&dir)
            .output()
            .await
            .map_err(|e| format!("Git commit failed: {}", e))?;

        if commit.status.success() {
            let output = String::from_utf8_lossy(&commit.stdout).to_string();
            Ok(output)
        } else {
            let stderr = String::from_utf8_lossy(&commit.stderr);
            if stderr.contains("nothing to commit") {
                Ok("Nothing to commit".to_string())
            } else {
                Err(format!("Git commit failed: {}", stderr))
            }
        }
    }

    /// Git push to remote
    pub async fn git_push(&self, workspace_id: &str, remote: &str, branch: &str) -> Result<String, String> {
        let ws = self.get_workspace(workspace_id).await
            .ok_or_else(|| "Workspace not found".to_string())?;
        let dir = PathBuf::from(&ws.path);

        let push = tokio::process::Command::new("git")
            .args(["push", remote, branch])
            .current_dir(&dir)
            .output()
            .await
            .map_err(|e| format!("Git push failed: {}", e))?;

        if push.status.success() {
            Ok(String::from_utf8_lossy(&push.stdout).to_string())
        } else {
            Err(format!("Git push failed: {}", String::from_utf8_lossy(&push.stderr)))
        }
    }

    /// Create a new branch
    pub async fn git_create_branch(&self, workspace_id: &str, branch_name: &str, base_branch: Option<&str>) -> Result<String, String> {
        let ws = self.get_workspace(workspace_id).await
            .ok_or_else(|| "Workspace not found".to_string())?;
        let dir = PathBuf::from(&ws.path);

        // Checkout base branch if specified
        if let Some(base) = base_branch {
            tokio::process::Command::new("git")
                .args(["checkout", base])
                .current_dir(&dir)
                .output()
                .await
                .map_err(|e| format!("Git checkout failed: {}", e))?;
        }

        // Create and checkout new branch
        let branch = tokio::process::Command::new("git")
            .args(["checkout", "-b", branch_name])
            .current_dir(&dir)
            .output()
            .await
            .map_err(|e| format!("Git branch creation failed: {}", e))?;

        if branch.status.success() {
            // Push new branch to remote
            if let Some(ref remote) = ws.git_remote {
                tokio::process::Command::new("git")
                    .args(["push", "-u", "origin", branch_name])
                    .current_dir(&dir)
                    .output()
                    .await
                    .ok();
            }
            
            // Update workspace branch
            let mut ws_list = self.workspaces.write().await;
            if let Some(w) = ws_list.iter_mut().find(|w| w.id == workspace_id) {
                w.git_branch = Some(branch_name.to_string());
            }

            Ok(format!("Branch '{}' created", branch_name))
        } else {
            Err(format!("Failed to create branch: {}", String::from_utf8_lossy(&branch.stderr)))
        }
    }

    /// Create GitHub Pull Request (requires gh CLI or GitHub API)
    pub async fn create_pull_request(&self, workspace_id: &str, title: &str, body: &str, head_branch: &str, base_branch: &str) -> Result<String, String> {
        let ws = self.get_workspace(workspace_id).await
            .ok_or_else(|| "Workspace not found".to_string())?;
        
        // Try using gh CLI first
        let dir = PathBuf::from(&ws.path);
        let pr = tokio::process::Command::new("gh")
            .args(["pr", "create", "--title", title, "--body", body, "--base", base_branch, "--head", head_branch])
            .current_dir(&dir)
            .output()
            .await;

        match pr {
            Ok(output) if output.status.success() => {
                Ok(String::from_utf8_lossy(&output.stdout).to_string())
            }
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                Err(format!("PR creation failed: {}", stderr))
            }
            Err(e) => Err(format!("gh CLI not available: {}", e))
        }
    }

    // ─── Enhanced Git Operations ────────────────────────────────────────────

    /// Git log – commit history
    pub async fn git_log(&self, workspace_id: &str, max_count: u32) -> Result<Vec<GitCommitEntry>, String> {
        let ws = self.get_workspace(workspace_id).await
            .ok_or_else(|| "Workspace not found".to_string())?;
        let dir = PathBuf::from(&ws.path);

        let format = "--format=%H|%an|%ae|%s|%ai";
        let count = format!("--max-count={}", max_count);
        
        let output = tokio::process::Command::new("git")
            .args(["log", format, &count, "--shortstat"])
            .current_dir(&dir)
            .output()
            .await
            .map_err(|e| format!("Git log failed: {}", e))?;

        if !output.status.success() {
            return Err(format!("Git log failed: {}", String::from_utf8_lossy(&output.stderr)));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut entries = Vec::new();
        // (hash, author, email, message, timestamp, files_changed, insertions, deletions)
        let mut current_entry: Option<(String, String, String, String, String, u32, u32, u32)> = None;

        for line in stdout.lines() {
            if line.contains('|') && line.chars().filter(|&c| c == '|').count() >= 4 {
                // Save previous
                if let Some(entry) = current_entry.take() {
                    entries.push(GitCommitEntry {
                        hash: entry.0, author: entry.1, email: entry.2,
                        message: entry.3, timestamp: entry.4,
                        files_changed: entry.5, insertions: entry.6, deletions: entry.7,
                    });
                }
                let parts: Vec<&str> = line.split('|').collect();
                if parts.len() >= 5 {
                    current_entry = Some((
                        parts[0].to_string(), parts[1].to_string(),
                        parts[2].to_string(), parts[3].to_string(),
                        parts[4].to_string(),
                        0, 0, 0,
                    ));
                }
            } else if line.contains("changed") {
                if let Some(ref mut entry) = current_entry {
                    // Parse: "X files changed, Y insertions(+), Z deletions(-)"
                    for part in line.split(',') {
                        let part = part.trim();
                        let n: u32 = part
                            .split_whitespace()
                            .next()
                            .and_then(|s| s.parse::<u32>().ok())
                            .unwrap_or(0);
                        if part.contains("file") && part.contains("changed") {
                            entry.5 = n;
                        } else if part.contains("insertion") {
                            entry.6 = n;
                        } else if part.contains("deletion") {
                            entry.7 = n;
                        }
                    }
                }
            }
        }
        // Save last entry
        if let Some(entry) = current_entry.take() {
            entries.push(GitCommitEntry {
                hash: entry.0, author: entry.1, email: entry.2,
                message: entry.3, timestamp: entry.4,
                files_changed: entry.5, insertions: entry.6, deletions: entry.7,
            });
        }

        Ok(entries)
    }

    /// List all branches
    pub async fn git_branches(&self, workspace_id: &str) -> Result<Vec<GitBranch>, String> {
        let ws = self.get_workspace(workspace_id).await
            .ok_or_else(|| "Workspace not found".to_string())?;
        let dir = PathBuf::from(&ws.path);

        let output = tokio::process::Command::new("git")
            .args(["branch", "-a"])
            .current_dir(&dir)
            .output()
            .await
            .map_err(|e| format!("Git branch list failed: {}", e))?;

        let mut branches = Vec::new();
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            let line = line.trim();
            if line.is_empty() { continue; }
            let is_current = line.starts_with('*');
            let name = line.trim_start_matches("* ").trim();
            let is_remote = name.starts_with("remotes/");
            branches.push(GitBranch {
                name: if is_remote { name.trim_start_matches("remotes/").to_string() } else { name.to_string() },
                is_current,
                is_remote,
                last_commit_hash: None,
                last_commit_message: None,
                behind_main: None,
                ahead_main: None,
            });
        }
        Ok(branches)
    }

    /// Switch/checkout branch
    pub async fn git_checkout(&self, workspace_id: &str, branch: &str) -> Result<String, String> {
        let ws = self.get_workspace(workspace_id).await
            .ok_or_else(|| "Workspace not found".to_string())?;
        let dir = PathBuf::from(&ws.path);

        let output = tokio::process::Command::new("git")
            .args(["checkout", branch])
            .current_dir(&dir)
            .output()
            .await
            .map_err(|e| format!("Git checkout failed: {}", e))?;

        if output.status.success() {
            // Update workspace branch
            let mut ws_list = self.workspaces.write().await;
            if let Some(w) = ws_list.iter_mut().find(|w| w.id == workspace_id) {
                w.git_branch = Some(branch.to_string());
            }
            Ok(format!("Switched to branch '{}'", branch))
        } else {
            Err(format!("Git checkout failed: {}", String::from_utf8_lossy(&output.stderr)))
        }
    }

    /// Delete branch
    pub async fn git_delete_branch(&self, workspace_id: &str, branch: &str) -> Result<String, String> {
        let ws = self.get_workspace(workspace_id).await
            .ok_or_else(|| "Workspace not found".to_string())?;
        let dir = PathBuf::from(&ws.path);

        let output = tokio::process::Command::new("git")
            .args(["branch", "-D", branch])
            .current_dir(&dir)
            .output()
            .await
            .map_err(|e| format!("Git delete branch failed: {}", e))?;

        if output.status.success() {
            Ok(format!("Branch '{}' deleted", branch))
        } else {
            Err(format!("Git delete branch failed: {}", String::from_utf8_lossy(&output.stderr)))
        }
    }

    /// Git stash – push current changes to stash
    pub async fn git_stash(&self, workspace_id: &str, message: Option<&str>) -> Result<String, String> {
        let ws = self.get_workspace(workspace_id).await
            .ok_or_else(|| "Workspace not found".to_string())?;
        let dir = PathBuf::from(&ws.path);

        let mut args = vec!["stash", "push"];
        if let Some(msg) = message {
            args.push("-m");
            args.push(msg);
        }

        let output = tokio::process::Command::new("git")
            .args(&args)
            .current_dir(&dir)
            .output()
            .await
            .map_err(|e| format!("Git stash failed: {}", e))?;

        if output.status.success() {
            Ok("Changes stashed".to_string())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            if stderr.contains("No local changes") {
                Ok("No changes to stash".to_string())
            } else {
                Err(format!("Git stash failed: {}", stderr))
            }
        }
    }

    /// Git stash pop
    pub async fn git_stash_pop(&self, workspace_id: &str, index: Option<u32>) -> Result<String, String> {
        let ws = self.get_workspace(workspace_id).await
            .ok_or_else(|| "Workspace not found".to_string())?;
        let dir = PathBuf::from(&ws.path);

        let mut cmd = tokio::process::Command::new("git");
        cmd.arg("stash").arg("pop");
        if let Some(idx) = index {
            cmd.arg(format!("stash@{{{}}}", idx));
        }
        cmd.current_dir(&dir);
        
        let output = cmd.output().await.map_err(|e| format!("Git stash pop failed: {}", e))?;

        if output.status.success() {
            Ok("Stash popped".to_string())
        } else {
            Err(format!("Git stash pop failed: {}", String::from_utf8_lossy(&output.stderr)))
        }
    }

    /// Git stash list
    pub async fn git_stash_list(&self, workspace_id: &str) -> Result<Vec<String>, String> {
        let ws = self.get_workspace(workspace_id).await
            .ok_or_else(|| "Workspace not found".to_string())?;
        let dir = PathBuf::from(&ws.path);

        let output = tokio::process::Command::new("git")
            .args(["stash", "list"])
            .current_dir(&dir)
            .output()
            .await
            .map_err(|e| format!("Git stash list failed: {}", e))?;

        let lines: Vec<String> = String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(|l| l.to_string())
            .collect();
        Ok(lines)
    }

    /// Git reset (soft = keep changes, hard = discard)
    pub async fn git_reset(&self, workspace_id: &str, mode: &str, target: &str) -> Result<String, String> {
        let ws = self.get_workspace(workspace_id).await
            .ok_or_else(|| "Workspace not found".to_string())?;
        let dir = PathBuf::from(&ws.path);

        let flag = match mode {
            "hard" => "--hard",
            "soft" => "--soft",
            "mixed" => "--mixed",
            _ => "--mixed",
        };

        let output = tokio::process::Command::new("git")
            .args(["reset", flag, target])
            .current_dir(&dir)
            .output()
            .await
            .map_err(|e| format!("Git reset failed: {}", e))?;

        if output.status.success() {
            Ok(format!("Reset {} (mode: {}) completed", target, mode))
        } else {
            Err(format!("Git reset failed: {}", String::from_utf8_lossy(&output.stderr)))
        }
    }

    /// Git revert a commit
    pub async fn git_revert(&self, workspace_id: &str, commit_hash: &str) -> Result<String, String> {
        let ws = self.get_workspace(workspace_id).await
            .ok_or_else(|| "Workspace not found".to_string())?;
        let dir = PathBuf::from(&ws.path);

        let output = tokio::process::Command::new("git")
            .args(["revert", "--no-edit", commit_hash])
            .current_dir(&dir)
            .output()
            .await
            .map_err(|e| format!("Git revert failed: {}", e))?;

        if output.status.success() {
            Ok(format!("Reverted commit {}", commit_hash))
        } else {
            Err(format!("Git revert failed: {}", String::from_utf8_lossy(&output.stderr)))
        }
    }

    /// Git blame for a file
    pub async fn git_blame(&self, workspace_id: &str, file_path: &str) -> Result<Vec<String>, String> {
        let ws = self.get_workspace(workspace_id).await
            .ok_or_else(|| "Workspace not found".to_string())?;
        let dir = PathBuf::from(&ws.path);

        let output = tokio::process::Command::new("git")
            .args(["blame", "--line-porcelain", file_path])
            .current_dir(&dir)
            .output()
            .await
            .map_err(|e| format!("Git blame failed: {}", e))?;

        if output.status.success() {
            let lines: Vec<String> = String::from_utf8_lossy(&output.stdout)
                .lines()
                .map(|l| l.to_string())
                .collect();
            Ok(lines)
        } else {
            Err(format!("Git blame failed: {}", String::from_utf8_lossy(&output.stderr)))
        }
    }

    /// Git merge branch into current
    pub async fn git_merge(&self, workspace_id: &str, source_branch: &str) -> Result<String, String> {
        let ws = self.get_workspace(workspace_id).await
            .ok_or_else(|| "Workspace not found".to_string())?;
        let dir = PathBuf::from(&ws.path);

        let output = tokio::process::Command::new("git")
            .args(["merge", source_branch])
            .current_dir(&dir)
            .output()
            .await
            .map_err(|e| format!("Git merge failed: {}", e))?;

        if output.status.success() {
            Ok(format!("Merged '{}' into current branch", source_branch))
        } else {
            Err(format!("Git merge failed: {}", String::from_utf8_lossy(&output.stderr)))
        }
    }

    /// Git rebase
    pub async fn git_rebase(&self, workspace_id: &str, onto: &str) -> Result<String, String> {
        let ws = self.get_workspace(workspace_id).await
            .ok_or_else(|| "Workspace not found".to_string())?;
        let dir = PathBuf::from(&ws.path);

        let output = tokio::process::Command::new("git")
            .args(["rebase", onto])
            .current_dir(&dir)
            .output()
            .await
            .map_err(|e| format!("Git rebase failed: {}", e))?;

        if output.status.success() {
            Ok(format!("Rebased onto '{}'", onto))
        } else {
            Err(format!("Git rebase failed: {}", String::from_utf8_lossy(&output.stderr)))
        }
    }

    /// Git diff between two branches/commits
    pub async fn git_diff_between(&self, workspace_id: &str, a: &str, b: &str) -> Result<Vec<FileDiff>, String> {
        let ws = self.get_workspace(workspace_id).await
            .ok_or_else(|| "Workspace not found".to_string())?;
        let dir = PathBuf::from(&ws.path);

        let output = tokio::process::Command::new("git")
            .args(["diff", a, b])
            .current_dir(&dir)
            .output()
            .await
            .map_err(|e| format!("Git diff failed: {}", e))?;

        if output.status.success() {
            Ok(parse_git_diff(&String::from_utf8_lossy(&output.stdout)))
        } else {
            Err(format!("Git diff failed: {}", String::from_utf8_lossy(&output.stderr)))
        }
    }

    /// Git fetch from remote
    pub async fn git_fetch(&self, workspace_id: &str, remote: &str) -> Result<String, String> {
        let ws = self.get_workspace(workspace_id).await
            .ok_or_else(|| "Workspace not found".to_string())?;
        let dir = PathBuf::from(&ws.path);

        let output = tokio::process::Command::new("git")
            .args(["fetch", remote])
            .current_dir(&dir)
            .output()
            .await
            .map_err(|e| format!("Git fetch failed: {}", e))?;

        if output.status.success() {
            Ok("Fetch completed".to_string())
        } else {
            Err(format!("Git fetch failed: {}", String::from_utf8_lossy(&output.stderr)))
        }
    }

    // ─── Agent Task Operations ──────────────────────────────────────────────

    /// Create and queue a new agent task
    pub async fn create_task(
        &self,
        workspace_id: &str,
        name: &str,
        description: &str,
        model: &str,
        provider: &str,
        config: Option<TaskConfig>,
    ) -> Result<AgentTask, String> {
        // Verify workspace exists
        self.get_workspace(workspace_id).await
            .ok_or_else(|| "Workspace not found".to_string())?;

        let task_config = config.unwrap_or_default();

        let task = AgentTask {
            id: Uuid::new_v4().to_string(),
            workspace_id: workspace_id.to_string(),
            name: name.to_string(),
            description: description.to_string(),
            model: model.to_string(),
            provider: provider.to_string(),
            status: "queued".to_string(),
            progress: 0.0,
            output: vec![TaskOutputLine {
                timestamp: Utc::now(),
                level: "system".to_string(),
                message: format!("Task queued (mode: {}, thinking: {}, temperature: {:.1})",
                    task_config.mode, task_config.thinking_enabled, task_config.temperature),
                stream: None,
            }],
            changes: Vec::new(),
            created_at: Utc::now(),
            started_at: None,
            completed_at: None,
            error: None,
            config: task_config,
        };

        let id = task.id.clone();
        self.agent_tasks.write().await.push(task);

        let task = self.agent_tasks.read().await
            .iter().find(|t| t.id == id).cloned()
            .unwrap();

        Ok(task)
    }

    /// Get all tasks (optionally filtered by workspace)
    pub async fn list_tasks(&self, workspace_id: Option<&str>) -> Vec<AgentTask> {
        let tasks = self.agent_tasks.read().await;
        match workspace_id {
            Some(wid) => tasks.iter().filter(|t| t.workspace_id == wid).cloned().collect(),
            None => tasks.clone(),
        }
    }

    /// Get single task
    pub async fn get_task(&self, task_id: &str) -> Option<AgentTask> {
        self.agent_tasks.read().await.iter().find(|t| t.id == task_id).cloned()
    }

    /// Cancel a task
    pub async fn cancel_task(&self, task_id: &str) -> Result<(), String> {
        let mut tasks = self.agent_tasks.write().await;
        if let Some(task) = tasks.iter_mut().find(|t| t.id == task_id) {
            if task.status == "running" || task.status == "queued" {
                task.status = "cancelled".to_string();
                task.completed_at = Some(Utc::now());
                task.output.push(TaskOutputLine {
                    timestamp: Utc::now(),
                    level: "system".to_string(),
                    message: "Task cancelled by user".to_string(),
                    stream: None,
                });
                Ok(())
            } else {
                Err(format!("Task is in state '{}', cannot cancel", task.status))
            }
        } else {
            Err("Task not found".to_string())
        }
    }

    /// Update task with new output (called by task executor)
    pub async fn update_task_output(&self, task_id: &str, line: TaskOutputLine) {
        let mut tasks = self.agent_tasks.write().await;
        if let Some(task) = tasks.iter_mut().find(|t| t.id == task_id) {
            task.output.push(line);
        }
    }

    /// Mark task as running
    pub async fn start_task(&self, task_id: &str) {
        let mut tasks = self.agent_tasks.write().await;
        if let Some(task) = tasks.iter_mut().find(|t| t.id == task_id) {
            task.status = "running".to_string();
            task.started_at = Some(Utc::now());
            task.output.push(TaskOutputLine {
                timestamp: Utc::now(),
                level: "system".to_string(),
                message: "Task started".to_string(),
                stream: None,
            });
        }
    }

    /// Mark task as completed with changes
    pub async fn complete_task(&self, task_id: &str, changes: Vec<FileDiff>) {
        let mut tasks = self.agent_tasks.write().await;
        if let Some(task) = tasks.iter_mut().find(|t| t.id == task_id) {
            task.status = "completed".to_string();
            task.progress = 1.0;
            task.completed_at = Some(Utc::now());
            task.changes = changes;
            task.output.push(TaskOutputLine {
                timestamp: Utc::now(),
                level: "success".to_string(),
                message: format!("Task completed with {} change(s)", task.changes.len()),
                stream: None,
            });
        }
    }

    /// Mark task as failed
    pub async fn fail_task(&self, task_id: &str, error: &str) {
        let mut tasks = self.agent_tasks.write().await;
        if let Some(task) = tasks.iter_mut().find(|t| t.id == task_id) {
            task.status = "failed".to_string();
            task.completed_at = Some(Utc::now());
            task.error = Some(error.to_string());
            task.output.push(TaskOutputLine {
                timestamp: Utc::now(),
                level: "error".to_string(),
                message: format!("Task failed: {}", error),
                stream: None,
            });
        }
    }

    /// Update task progress
    pub async fn update_task_progress(&self, task_id: &str, progress: f32) {
        let mut tasks = self.agent_tasks.write().await;
        if let Some(task) = tasks.iter_mut().find(|t| t.id == task_id) {
            task.progress = progress;
        }
    }

    /// Refresh git changes for a workspace (called after task execution)
    pub async fn refresh_changes(&self, workspace_id: &str, task_id: &str) -> Result<Vec<FileDiff>, String> {
        let diffs = self.git_status(workspace_id).await?;
        
        let mut tasks = self.agent_tasks.write().await;
        if let Some(task) = tasks.iter_mut().find(|t| t.id == task_id) {
            task.changes = diffs.clone();
        }
        
        Ok(diffs)
    }

    // ─── Helpers ────────────────────────────────────────────────────────────

    fn count_files(&self, dir: &Path) -> (u64, u64) {
        let mut count = 0u64;
        let mut size = 0u64;
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                if let Ok(meta) = entry.metadata() {
                    if meta.is_dir() {
                        // Skip .git
                        if entry.file_name() != ".git" {
                            let (c, s) = self.count_files(&entry.path());
                            count += c;
                            size += s;
                        }
                    } else {
                        count += 1;
                        size += meta.len();
                    }
                }
            }
        }
        (count, size)
    }
}

// ─── Git Diff Helper ─────────────────────────────────────────────────────────

async fn git_diff(dir: &Path) -> Result<Vec<FileDiff>, String> {
    let output = tokio::process::Command::new("git")
        .args(["diff", "--cached"])
        .current_dir(dir)
        .output()
        .await
        .map_err(|e| format!("Git diff failed: {}", e))?;

    let mut diffs = parse_git_diff(&String::from_utf8_lossy(&output.stdout));

    // Also include unstaged changes
    let unstaged = tokio::process::Command::new("git")
        .args(["diff"])
        .current_dir(dir)
        .output()
        .await
        .map_err(|e| format!("Git diff unstaged failed: {}", e))?;

    let unstaged_diffs = parse_git_diff(&String::from_utf8_lossy(&unstaged.stdout));
    
    // Merge staged and unstaged diffs
    for ud in unstaged_diffs {
        if let Some(existing) = diffs.iter_mut().find(|d: &&mut FileDiff| d.file_path == ud.file_path) {
            existing.hunks.extend(ud.hunks);
        } else {
            diffs.push(ud);
        }
    }

    // Also check for untracked files
    let untracked = tokio::process::Command::new("git")
        .args(["ls-files", "--others", "--exclude-standard"])
        .current_dir(dir)
        .output()
        .await
        .map_err(|e| format!("Git ls-files failed: {}", e))?;

    for line in String::from_utf8_lossy(&untracked.stdout).lines() {
        if !line.is_empty() && !diffs.iter().any(|d| d.file_path == line) {
            diffs.push(FileDiff {
                file_path: line.to_string(),
                status: "added".to_string(),
                hunks: vec![DiffHunk {
                    old_start: 0,
                    old_lines: 0,
                    new_start: 0,
                    new_lines: 0,
                    content: "[Untracked file]".to_string(),
                }],
            });
        }
    }

    // Get deleted files
    let deleted = tokio::process::Command::new("git")
        .args(["ls-files", "--deleted"])
        .current_dir(dir)
        .output()
        .await
        .map_err(|e| format!("Git ls-files deleted failed: {}", e))?;

    for line in String::from_utf8_lossy(&deleted.stdout).lines() {
        if !line.is_empty() && !diffs.iter().any(|d| d.file_path == line) {
            diffs.push(FileDiff {
                file_path: line.to_string(),
                status: "deleted".to_string(),
                hunks: Vec::new(),
            });
        }
    }

    Ok(diffs)
}

fn parse_git_diff(diff_output: &str) -> Vec<FileDiff> {
    let mut diffs = Vec::new();
    let mut current_file: Option<FileDiff> = None;
    let mut current_hunk: Option<DiffHunk> = None;

    for line in diff_output.lines() {
        if line.starts_with("diff --git") {
            // Save previous hunk/file
            if let Some(hunk) = current_hunk.take() {
                if let Some(ref mut file) = current_file {
                    file.hunks.push(hunk);
                }
            }
            if let Some(file) = current_file.take() {
                diffs.push(file);
            }

            // Extract file path
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 4 {
                let path = parts[3].trim_start_matches("b/").to_string();
                current_file = Some(FileDiff {
                    file_path: path,
                    status: "modified".to_string(),
                    hunks: Vec::new(),
                });
            }
        } else if line.starts_with("@@") {
            // Save previous hunk
            if let Some(hunk) = current_hunk.take() {
                if let Some(ref mut file) = current_file {
                    file.hunks.push(hunk);
                }
            }

            // Parse hunk header: @@ -old,new +new,start @@
            if let Some(caps) = parse_hunk_header(line) {
                current_hunk = Some(caps);
            }
        } else if let Some(ref mut hunk) = current_hunk {
            hunk.content.push_str(line);
            hunk.content.push('\n');
        }
    }

    // Save last hunk and file
    if let Some(hunk) = current_hunk.take() {
        if let Some(ref mut file) = current_file {
            file.hunks.push(hunk);
        }
    }
    if let Some(file) = current_file.take() {
        diffs.push(file);
    }

    diffs
}

fn parse_hunk_header(line: &str) -> Option<DiffHunk> {
    // Format: @@ -old_start,old_lines +new_start,new_lines @@
    let line = line.trim_start_matches("@@").trim_end_matches("@@").trim();
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() >= 2 {
        let old = parts[0].trim_start_matches('-');
        let new = parts[1].trim_start_matches('+');
        
        let old_parts: Vec<&str> = old.split(',').collect();
        let new_parts: Vec<&str> = new.split(',').collect();

        return Some(DiffHunk {
            old_start: old_parts[0].parse().unwrap_or(0),
            old_lines: old_parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0),
            new_start: new_parts[0].parse().unwrap_or(0),
            new_lines: new_parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0),
            content: String::new(),
        });
    }
    None
}

fn sanitize_name(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' || c == '.' { c } else { '_' })
        .collect::<String>()
        .trim_matches('_')
        .to_string()
}
