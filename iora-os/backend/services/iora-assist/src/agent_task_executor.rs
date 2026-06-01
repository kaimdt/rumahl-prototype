// Agent Task Executor – führt Agent Tasks parallel in Sandboxes aus
// Kommuniziert mit pi.dev / anderen AI-Providern und streamt Live-Output

use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
use tracing::{error, info};

use crate::providers::{ChatMessage, ProviderConfig, ProviderType, create_provider, provider_type_from_str};
use crate::sandbox::{FileDiff, SandboxManager, TaskOutputLine};

/// Event, das an SSE-Listener gesendet wird
#[derive(Debug, Clone)]
pub enum AgentTaskEvent {
    Output { task_id: String, line: TaskOutputLine },
    Progress { task_id: String, progress: f32 },
    StatusChange { task_id: String, status: String },
    Completed { task_id: String, changes: Vec<FileDiff> },
    Failed { task_id: String, error: String },
}

/// Der Agent Task Executor
pub struct AgentTaskExecutor {
    sandbox: Arc<SandboxManager>,
    /// Broadcast-Kanal für Live-Events
    event_tx: broadcast::Sender<AgentTaskEvent>,
    /// Laufende Tasks (task_id -> JoinHandle)
    running_tasks: Arc<RwLock<Vec<String>>>,
}

impl AgentTaskExecutor {
    pub fn new(sandbox: Arc<SandboxManager>) -> Self {
        let (tx, _) = broadcast::channel(1024);
        Self {
            sandbox,
            event_tx: tx,
            running_tasks: Arc::new(RwLock::new(Vec::new())),
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<AgentTaskEvent> {
        self.event_tx.subscribe()
    }

    /// Starte einen Agent Task in einer Sandbox
    pub async fn execute_task(
        self: Arc<Self>,
        task_id: String,
        provider_type: String,
        model: String,
        api_key: Option<String>,
        base_url: Option<String>,
    ) -> Result<(), String> {
        let task = self.sandbox.get_task(&task_id).await
            .ok_or_else(|| "Task not found".to_string())?;

        let workspace_id = task.workspace_id.clone();
        let task_id_clone = task.id.clone();

        // Check for running tasks in same workspace for parallelism
        {
            let running = self.running_tasks.read().await;
            info!(
                "Starting task {} with {} task(s) already running in workspace {}",
                task_id_clone,
                running.len(),
                workspace_id
            );
        }

        // Mark task as running
        self.sandbox.start_task(&task_id_clone).await;
        let _ = self.event_tx.send(AgentTaskEvent::StatusChange {
            task_id: task_id_clone.clone(),
            status: "running".to_string(),
        });

        // Get the workspace
        let workspace = match self.sandbox.get_workspace(&workspace_id).await {
            Some(w) => w,
            None => {
                self.sandbox.fail_task(&task_id_clone, "Workspace not found").await;
                return Err("Workspace not found".to_string());
            }
        };

        // Add task to running list
        {
            let mut running = self.running_tasks.write().await;
            running.push(task_id_clone.clone());
        }

        let executor = self.clone();
        let task_id_owned = task_id_clone.clone();
        let sandbox = self.sandbox.clone();
        let event_tx = self.event_tx.clone();
        let wid = workspace_id.clone();

        // Spawn the actual execution
        tokio::spawn(async move {
            info!("Executing task {} with provider {}", task_id_owned, provider_type);

            // Send system message
            let system_msg = format!("Starting task with provider '{}', model '{}'", provider_type, model);
            let line = TaskOutputLine {
                timestamp: chrono::Utc::now(),
                level: "system".to_string(),
                message: system_msg,
                stream: None,
            };
            sandbox.update_task_output(&task_id_owned, line.clone()).await;
            let _ = event_tx.send(AgentTaskEvent::Output {
                task_id: task_id_owned.clone(),
                line: line.clone(),
            });

            // Get task config from sandbox for steering
            let task_config = sandbox.get_task(&task_id_owned).await
                .map(|t| t.config)
                .unwrap_or_default();

            // Build the prompt with workspace context
            let workspace_context = build_workspace_prompt(&workspace).await;

            let mode_instruction = match task_config.mode.as_str() {
                "fast" => "Work QUICKLY. Make minimal changes, focus on the core request. Be concise.",
                "detailed" => "Be THOROUGH. Add comments, error handling, documentation. Consider edge cases.",
                "creative" => "Be CREATIVE. Suggest improvements, refactor if beneficial. Think outside the box.",
                "economy" => "SAVE TOKENS. Be extremely concise. Skip explanations, output only essential code changes. Use abbreviations.",
                _ => "Work methodically. Balance speed and quality. Keep existing code style.",
            };

            let thinking_instruction = if task_config.thinking_enabled {
                "Think step by step before making changes. Explain your reasoning."
            } else {
                "Don't explain your reasoning. Just make the changes directly."
            };

            let context_instruction = match task_config.context_level.as_str() {
                "none" => "Don't read the existing code. Just write what's requested.",
                "changed" => "Read only the files you need to modify.",
                "all" => "Read all project files for full context.",
                _ => "Read the relevant files for context.",
            };

            let auto_apply_instruction = if task_config.auto_apply {
                "Changes will be auto-applied. Make them directly."
            } else {
                "Output the changes – user will review and apply them."
            };

            let custom_instructions = task_config.custom_instructions.as_ref()
                .map(|ci| format!("\n\n## Custom Instructions\n{}\n", ci))
                .unwrap_or_default();

            let system_prompt = format!(
                "You are ORA Agent – an AI coding assistant integrated into the IORA smart home system.\n\
                 You work inside an isolated sandbox at: {}\n\n\
                 ## Mode: {}\n{}\n\n\
                 ## Thinking\n{}\n\n\
                 ## Context\n{}\n\n\
                 ## Auto-Apply\n{}\n\n\
                 ## Workspace Context\n{}\n\n\
                 ## Active Task\nThe user asked: \"{}\"\n\
                 Temperature: {:.1}{}\n",
                workspace.path,
                task_config.mode, mode_instruction,
                thinking_instruction,
                context_instruction,
                auto_apply_instruction,
                workspace_context,
                line.message,
                task_config.temperature,
                custom_instructions,
            );

            // Provider-agnostic chat call
            let provider_type_enum = provider_type_from_str(&provider_type)
                .unwrap_or(ProviderType::OpenAI);

            let config = ProviderConfig {
                api_key,
                base_url,
                model: Some(model.clone()),
                api_version: None,
            };

            let provider = create_provider(provider_type_enum, config);
            let available = provider.is_available().await;

            if !available {
                let err = format!("Provider '{}' is not available", provider_type);
                sandbox.fail_task(&task_id_owned, &err).await;
                let _ = event_tx.send(AgentTaskEvent::Failed {
                    task_id: task_id_owned.clone(),
                    error: err,
                });
                executor.remove_from_running(&task_id_owned).await;
                return;
            }

            // Read current files
            let files = match sandbox.list_files(&wid, None).await {
                Ok(f) => f,
                Err(e) => {
                    let err = format!("Failed to list files: {}", e);
                    sandbox.fail_task(&task_id_owned, &err).await;
                    let _ = event_tx.send(AgentTaskEvent::Failed {
                        task_id: task_id_owned.clone(),
                        error: err,
                    });
                    executor.remove_from_running(&task_id_owned).await;
                    return;
                }
            };

            // Send file list
            let file_msg = format!("Found {} file(s) in workspace", files.len());
            sandbox.update_task_output(&task_id_owned, TaskOutputLine {
                timestamp: chrono::Utc::now(),
                level: "info".to_string(),
                message: file_msg.clone(),
                stream: None,
            }).await;
            let _ = event_tx.send(AgentTaskEvent::Output {
                task_id: task_id_owned.clone(),
                line: TaskOutputLine {
                    timestamp: chrono::Utc::now(),
                    level: "info".to_string(),
                    message: file_msg,
                    stream: None,
                },
            });

            // Read all source files for context (limit to 50 files, 100KB each)
            let mut file_contents = Vec::new();
            for f in files.iter().filter(|f| !f.is_dir) {
                if file_contents.len() >= 50 {
                    break;
                }
                // Skip binary files
                let ext = std::path::Path::new(&f.path)
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("");
                if matches!(ext, "png" | "jpg" | "jpeg" | "gif" | "ico" | "woff" | "woff2" | "ttf" | "eot") {
                    continue;
                }
                match sandbox.read_file(&wid, &f.path).await {
                    Ok(content) => {
                        if content.len() > 100_000 {
                            file_contents.push((f.path.clone(), format!("[File too large: {} bytes]", content.len())));
                        } else {
                            file_contents.push((f.path.clone(), content));
                        }
                    }
                    Err(_) => {}
                }
            }

            // Build messages for the AI
            let files_content = file_contents.iter()
                .map(|(path, content)| format!("=== {} ===\n{}", path, content))
                .collect::<Vec<_>>()
                .join("\n\n");

            let messages = vec![
                ChatMessage {
                    role: "system".to_string(),
                    content: system_prompt,
                },
                ChatMessage {
                    role: "user".to_string(),
                    content: format!(
                        "Here are the current files in the workspace:\n\n{}\n\nPlease analyze the code and perform the requested task.",
                        files_content
                    ),
                },
            ];

            // Add progress update
            let progress_msg = format!("Sending code to {} ({})...", provider.name(), model);
            sandbox.update_task_output(&task_id_owned, TaskOutputLine {
                timestamp: chrono::Utc::now(),
                level: "info".to_string(),
                message: progress_msg.clone(),
                stream: None,
            }).await;
            let _ = event_tx.send(AgentTaskEvent::Output {
                task_id: task_id_owned.clone(),
                line: TaskOutputLine {
                    timestamp: chrono::Utc::now(),
                    level: "info".to_string(),
                    message: progress_msg,
                    stream: None,
                },
            });
            sandbox.update_task_progress(&task_id_owned, 0.3).await;
            let _ = event_tx.send(AgentTaskEvent::Progress {
                task_id: task_id_owned.clone(),
                progress: 0.3,
            });

            // Call the AI
            match provider.chat(messages, None).await {
                Ok(response) => {
                    info!("Provider response received for task {}", task_id_owned);
                    
                    let response_msg = format!("AI response received ({} tokens)", response.tokens_used.unwrap_or(0));
                    sandbox.update_task_output(&task_id_owned, TaskOutputLine {
                        timestamp: chrono::Utc::now(),
                        level: "success".to_string(),
                        message: response_msg.clone(),
                        stream: None,
                    }).await;
                    let _ = event_tx.send(AgentTaskEvent::Output {
                        task_id: task_id_owned.clone(),
                        line: TaskOutputLine {
                            timestamp: chrono::Utc::now(),
                            level: "success".to_string(),
                            message: response_msg,
                            stream: None,
                        },
                    });

                    sandbox.update_task_output(&task_id_owned, TaskOutputLine {
                        timestamp: chrono::Utc::now(),
                        level: "info".to_string(),
                        message: response.message.clone(),
                        stream: None,
                    }).await;
                    let _ = event_tx.send(AgentTaskEvent::Output {
                        task_id: task_id_owned.clone(),
                        line: TaskOutputLine {
                            timestamp: chrono::Utc::now(),
                            level: "info".to_string(),
                            message: response.message,
                            stream: None,
                        },
                    });

                    sandbox.update_task_progress(&task_id_owned, 0.8).await;
                    let _ = event_tx.send(AgentTaskEvent::Progress {
                        task_id: task_id_owned.clone(),
                        progress: 0.8,
                    });

                    // Get the git diff to see changes
                    let changes = match sandbox.refresh_changes(&wid, &task_id_owned).await {
                        Ok(diffs) => {
                            let change_msg = format!("Detected {} changed file(s)", diffs.len());
                            sandbox.update_task_output(&task_id_owned, TaskOutputLine {
                                timestamp: chrono::Utc::now(),
                                level: "success".to_string(),
                                message: change_msg.clone(),
                                stream: None,
                            }).await;
                            let _ = event_tx.send(AgentTaskEvent::Output {
                                task_id: task_id_owned.clone(),
                                line: TaskOutputLine {
                                    timestamp: chrono::Utc::now(),
                                    level: "success".to_string(),
                                    message: change_msg,
                                    stream: None,
                                },
                            });
                            diffs
                        }
                        Err(e) => {
                            let err_msg = format!("Could not get git diff: {}", e);
                            sandbox.update_task_output(&task_id_owned, TaskOutputLine {
                                timestamp: chrono::Utc::now(),
                                level: "warn".to_string(),
                                message: err_msg.clone(),
                                stream: None,
                            }).await;
                            let _ = event_tx.send(AgentTaskEvent::Output {
                                task_id: task_id_owned.clone(),
                                line: TaskOutputLine {
                                    timestamp: chrono::Utc::now(),
                                    level: "warn".to_string(),
                                    message: err_msg,
                                    stream: None,
                                },
                            });
                            Vec::new()
                        }
                    };

                    // Mark as completed
                    sandbox.complete_task(&task_id_owned, changes.clone()).await;
                    let _ = event_tx.send(AgentTaskEvent::Completed {
                        task_id: task_id_owned.clone(),
                        changes,
                    });

                    info!("Task {} completed successfully", task_id_owned);
                }
                Err(e) => {
                    error!("AI provider error for task {}: {}", task_id_owned, e);
                    let err = format!("AI provider error: {}", e);
                    sandbox.fail_task(&task_id_owned, &err).await;
                    let _ = event_tx.send(AgentTaskEvent::Failed {
                        task_id: task_id_owned.clone(),
                        error: err,
                    });
                }
            }

            executor.remove_from_running(&task_id_owned).await;
        });

        Ok(())
    }

    async fn remove_from_running(&self, task_id: &str) {
        let mut running = self.running_tasks.write().await;
        running.retain(|id| id != task_id);
    }

    /// Get currently running task count
    pub async fn running_count(&self) -> usize {
        self.running_tasks.read().await.len()
    }

    /// Get running task IDs
    pub async fn running_tasks(&self) -> Vec<String> {
        self.running_tasks.read().await.clone()
    }
}

/// Baue einen Kontext-Prompt aus dem Workspace
async fn build_workspace_prompt(workspace: &crate::sandbox::Workspace) -> String {
    let git_info = match (&workspace.git_remote, &workspace.git_branch) {
        (Some(url), Some(branch)) => format!("Git remote: {}\nBranch: {}", url, branch),
        (Some(url), None) => format!("Git remote: {}", url),
        (None, Some(branch)) => format!("Branch: {}", branch),
        (None, None) => "No git remote configured".to_string(),
    };

    format!(
        "Sandbox path: {}\n\
         Files: {}\n\
         Size: {} bytes\n\
         {}\n\
         Source: {}",
        workspace.path,
        workspace.file_count,
        workspace.total_size_bytes,
        git_info,
        workspace.source,
    )
}
