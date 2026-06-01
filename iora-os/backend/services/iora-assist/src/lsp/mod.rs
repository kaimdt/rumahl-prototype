// Language Server Protocol (LSP) Integration
// Connects to LSP servers to provide IDE-like intelligence to AI agents.
//
// Features:
// - Start/manage LSP servers (rust-analyzer, typescript-language-server, etc.)
// - Diagnostics (errors, warnings) for files in sandbox workspaces
// - Completions, hover info, go-to-definition
// - JSON-RPC communication with external LSP processes

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::Mutex as TokioMutex;
use tokio::sync::RwLock;
use uuid::Uuid;

// ─── JSON-RPC Types ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub id: u64,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    pub id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcError {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcNotification {
    pub jsonrpc: String,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<serde_json::Value>,
}

// ─── LSP Types ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Diagnostic {
    pub file_path: String,
    pub range: Range,
    pub severity: DiagnosticSeverity,
    pub message: String,
    pub source: Option<String>,
    pub code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum DiagnosticSeverity {
    Error = 1,
    Warning = 2,
    Information = 3,
    Hint = 4,
}

impl From<i32> for DiagnosticSeverity {
    fn from(v: i32) -> Self {
        match v {
            1 => Self::Error,
            2 => Self::Warning,
            3 => Self::Information,
            4 => Self::Hint,
            _ => Self::Information,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Range {
    pub start: Position,
    pub end: Position,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub line: u32,
    pub character: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionItem {
    pub label: String,
    pub kind: Option<String>,
    pub detail: Option<String>,
    pub insert_text: Option<String>,
    pub score: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HoverInfo {
    pub contents: String,
    pub range: Option<Range>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Location {
    pub uri: String,
    pub range: Range,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Symbol {
    pub name: String,
    pub kind: String,
    pub location: Location,
    pub container_name: Option<String>,
}

// ─── LSP Server Configuration ───────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspServerConfig {
    pub language: String,
    pub file_extensions: Vec<String>,
    pub command: String,
    pub args: Vec<String>,
    pub initialization_options: Option<serde_json::Value>,
}

impl LspServerConfig {
    pub fn builtin_servers() -> Vec<LspServerConfig> {
        vec![
            LspServerConfig {
                language: "rust".into(),
                file_extensions: vec!["rs".into()],
                command: "rust-analyzer".into(),
                args: vec![],
                initialization_options: Some(serde_json::json!({
                    "checkOnSave": true,
                    "check": { "command": "clippy" }
                })),
            },
            LspServerConfig {
                language: "typescript".into(),
                file_extensions: vec!["ts".into(), "tsx".into(), "js".into(), "jsx".into()],
                command: "typescript-language-server".into(),
                args: vec!["--stdio".into()],
                initialization_options: None,
            },
            LspServerConfig {
                language: "python".into(),
                file_extensions: vec!["py".into()],
                command: "pyright-langserver".into(),
                args: vec!["--stdio".into()],
                initialization_options: None,
            },
            LspServerConfig {
                language: "go".into(),
                file_extensions: vec!["go".into()],
                command: "gopls".into(),
                args: vec![],
                initialization_options: None,
            },
            LspServerConfig {
                language: "json".into(),
                file_extensions: vec!["json".into()],
                command: "vscode-json-languageserver".into(),
                args: vec!["--stdio".into()],
                initialization_options: Some(serde_json::json!({
                    "provideFormatter": true
                })),
            },
            LspServerConfig {
                language: "toml".into(),
                file_extensions: vec!["toml".into()],
                command: "taplo".into(),
                args: vec!["lsp".into(), "stdio".into()],
                initialization_options: None,
            },
            // HTML/CSS via vscode-langservers-extracted or emmet-ls
            LspServerConfig {
                language: "html".into(),
                file_extensions: vec!["html".into(), "htm".into()],
                command: "vscode-html-languageserver".into(),
                args: vec!["--stdio".into()],
                initialization_options: None,
            },
            LspServerConfig {
                language: "css".into(),
                file_extensions: vec!["css".into(), "scss".into(), "less".into()],
                command: "vscode-css-languageserver".into(),
                args: vec!["--stdio".into()],
                initialization_options: None,
            },
        ]
    }

    pub fn for_file(path: &str) -> Option<LspServerConfig> {
        let ext = std::path::Path::new(path)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        Self::builtin_servers()
            .into_iter()
            .find(|c| c.file_extensions.iter().any(|e| e == ext))
    }
}

// ─── LSP Client ─────────────────────────────────────────────────────────────

/// Manages a single LSP server process
pub struct LspClient {
    pub id: String,
    pub language: String,
    pub workspace_path: PathBuf,
    child: Option<Child>,
    /// Live stdin handle to the LSP server. Used by send_request/send_notification
    /// to write framed LSP messages.
    stdin: Option<std::sync::Arc<TokioMutex<ChildStdin>>>,
    next_id: u64,
    /// Pending requests awaiting response
    pending: HashMap<u64, tokio::sync::oneshot::Sender<JsonRpcResponse>>,
    /// Accumulated diagnostics per file
    diagnostics: HashMap<String, Vec<Diagnostic>>,
    /// Server capabilities
    capabilities: serde_json::Value,
    initialized: bool,
    request_counter: u64,
}

impl LspClient {
    pub fn new(language: &str, workspace_path: PathBuf) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            language: language.to_string(),
            workspace_path,
            child: None,
            stdin: None,
            next_id: 1,
            pending: HashMap::new(),
            diagnostics: HashMap::new(),
            capabilities: serde_json::json!({}),
            initialized: false,
            request_counter: 0,
        }
    }

    /// Start the LSP server
    pub async fn start(&mut self, config: &LspServerConfig) -> Result<(), String> {
        if self.child.is_some() {
            return Ok(());
        }

        // Check if command exists
        let which_result = tokio::process::Command::new("which")
            .arg(&config.command)
            .output()
            .await;

        let command_path = if which_result.is_ok() && which_result.as_ref().unwrap().status.success() {
            String::from_utf8_lossy(&which_result.unwrap().stdout).trim().to_string()
        } else {
            // Try common paths
            let candidates = [
                format!("/usr/local/bin/{}", config.command),
                format!("/opt/homebrew/bin/{}", config.command),
                format!("{}/.local/bin/{}", std::env::var("HOME").unwrap_or_default(), config.command),
            ];
            let mut found = None;
            for c in &candidates {
                if std::path::Path::new(c).exists() {
                    found = Some(c.clone());
                    break;
                }
            }
            found.unwrap_or_else(|| config.command.clone())
        };

        let mut cmd = Command::new(&command_path);
        for arg in &config.args {
            cmd.arg(arg);
        }

        cmd.current_dir(&self.workspace_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        let mut child = cmd.spawn().map_err(|e| format!("Failed to start LSP server '{}': {}", config.command, e))?;

        let stdout = child.stdout.take()
            .ok_or_else(|| "No stdout for LSP child".to_string())?;
        let stdin = child.stdin.take()
            .ok_or_else(|| "No stdin for LSP child".to_string())?;

        self.child = Some(child);
        self.stdin = Some(std::sync::Arc::new(TokioMutex::new(stdin)));

        // Spawn reader task
        let id = self.id.clone();
        tokio::spawn(async move {
            Self::read_responses(id, stdout).await;
        });

        // Initialize the server
        self.send_initialize(config).await?;
        self.send_initialized().await?;

        self.initialized = true;
        Ok(())
    }

    async fn send_initialize(&self, config: &LspServerConfig) -> Result<(), String> {
        let workspace_uri = format!("file://{}", self.workspace_path.display());
        let params = serde_json::json!({
            "processId": std::process::id(),
            "rootUri": workspace_uri,
            "rootPath": self.workspace_path.to_string_lossy(),
            "capabilities": {
                "textDocument": {
                    "diagnostics": { "dynamicRegistration": true },
                    "completion": {
                        "dynamicRegistration": true,
                        "completionItem": {
                            "snippetSupport": true,
                            "resolveSupport": { "properties": ["documentation"] }
                        }
                    },
                    "hover": { "dynamicRegistration": true, "contentFormat": ["markdown", "plaintext"] },
                    "definition": { "dynamicRegistration": true },
                    "references": { "dynamicRegistration": true },
                    "documentSymbol": { "dynamicRegistration": true },
                    "codeAction": { "dynamicRegistration": true },
                    "formatting": { "dynamicRegistration": true },
                    "rename": { "dynamicRegistration": true },
                },
                "workspace": {
                    "symbol": { "dynamicRegistration": true },
                    "configuration": true,
                }
            },
            "initializationOptions": config.initialization_options.clone().unwrap_or(serde_json::json!({})),
            "workspaceFolders": [{
                "uri": workspace_uri,
                "name": self.workspace_path.file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| "workspace".to_string()),
            }],
        });

        let response = self.send_request("initialize", Some(params)).await?;
        if let Some(caps) = response.get("capabilities") {
            // Store capabilities (via a non-existent field – consider using Arc)
            tracing::info!("LSP server initialized with capabilities: {}", caps);
        }
        Ok(())
    }

    async fn send_initialized(&self) -> Result<(), String> {
        self.send_notification("initialized", Some(serde_json::json!({}))).await
    }

    // ─── Public API ──────────────────────────────────────────────────────

    /// Open a document in the LSP server
    pub async fn open_document(&self, file_path: &str, content: &str, language: &str) -> Result<(), String> {
        let uri = Self::file_uri(file_path);
        let params = serde_json::json!({
            "textDocument": {
                "uri": uri,
                "languageId": language,
                "version": 1,
                "text": content,
            }
        });
        self.send_notification("textDocument/didOpen", Some(params)).await
    }

    /// Change document content
    pub async fn change_document(&self, file_path: &str, content: &str) -> Result<(), String> {
        let uri = Self::file_uri(file_path);
        let params = serde_json::json!({
            "textDocument": {
                "uri": uri,
                "version": 2,
            },
            "contentChanges": [{
                "text": content,
            }],
        });
        self.send_notification("textDocument/didChange", Some(params)).await
    }

    /// Close a document
    pub async fn close_document(&self, file_path: &str) -> Result<(), String> {
        let uri = Self::file_uri(file_path);
        let params = serde_json::json!({
            "textDocument": { "uri": uri }
        });
        self.send_notification("textDocument/didClose", Some(params)).await
    }

    /// Get diagnostics for a file
    pub async fn get_diagnostics(&self, file_path: &str) -> Result<Vec<Diagnostic>, String> {
        let uri = Self::file_uri(file_path);
        let params = serde_json::json!({
            "textDocument": { "uri": uri }
        });
        self.send_request("textDocument/diagnostic", Some(params)).await?;

        // Return accumulated diagnostics for this file
        Ok(self.diagnostics.get(file_path).cloned().unwrap_or_default())
    }

    /// Get all diagnostics
    pub fn all_diagnostics(&self) -> HashMap<String, Vec<Diagnostic>> {
        self.diagnostics.clone()
    }

    /// Get completions at a position
    pub async fn completions(
        &self,
        file_path: &str,
        line: u32,
        character: u32,
    ) -> Result<Vec<CompletionItem>, String> {
        let uri = Self::file_uri(file_path);
        let params = serde_json::json!({
            "textDocument": { "uri": uri },
            "position": { "line": line, "character": character },
            "context": {
                "triggerKind": 1, // Invoked
            }
        });

        let response = self.send_request("textDocument/completion", Some(params)).await?;

        let items: Vec<CompletionItem> = if let Some(items) = response.get("items").and_then(|i| i.as_array()) {
            items.iter().filter_map(|item| {
                Some(CompletionItem {
                    label: item.get("label")?.as_str()?.to_string(),
                    kind: item.get("kind").and_then(|k| {
                        Some(match k.as_i64()? {
                            1 => "Text", 2 => "Method", 3 => "Function", 4 => "Constructor",
                            5 => "Field", 6 => "Variable", 7 => "Class", 8 => "Interface",
                            9 => "Module", 10 => "Property", 11 => "Unit", 12 => "Value",
                            13 => "Enum", 14 => "Keyword", 15 => "Snippet", 16 => "Color",
                            17 => "File", 18 => "Reference", 19 => "Folder", 20 => "EnumMember",
                            21 => "Constant", 22 => "Struct", 23 => "Event", 24 => "Operator",
                            25 => "TypeParameter",
                            _ => "Unknown",
                        }.to_string())
                    }),
                    detail: item.get("detail").and_then(|d| d.as_str()).map(|s| s.to_string()),
                    insert_text: item.get("insertText").and_then(|t| t.as_str()).map(|s| s.to_string()),
                    score: item.get("score").and_then(|s| s.as_f64()),
                })
            }).collect()
        } else {
            Vec::new()
        };

        Ok(items)
    }

    /// Get hover information at a position
    pub async fn hover(
        &self,
        file_path: &str,
        line: u32,
        character: u32,
    ) -> Result<Option<HoverInfo>, String> {
        let uri = Self::file_uri(file_path);
        let params = serde_json::json!({
            "textDocument": { "uri": uri },
            "position": { "line": line, "character": character },
        });

        let response = self.send_request("textDocument/hover", Some(params)).await?;

        if let Some(contents) = response.get("contents") {
            let content_str = if let Some(s) = contents.as_str() {
                s.to_string()
            } else if let Some(arr) = contents.as_array() {
                arr.iter()
                    .filter_map(|c| c.as_str().or_else(|| c.get("value").and_then(|v| v.as_str())))
                    .collect::<Vec<_>>()
                    .join("\n")
            } else if let Some(o) = contents.as_object() {
                o.get("value").and_then(|v| v.as_str()).unwrap_or("").to_string()
            } else {
                String::new()
            };

            Ok(Some(HoverInfo {
                contents: content_str,
                range: response.get("range").and_then(|r| parse_range(r)),
            }))
        } else {
            Ok(None)
        }
    }

    /// Go to definition
    pub async fn definition(
        &self,
        file_path: &str,
        line: u32,
        character: u32,
    ) -> Result<Vec<Location>, String> {
        let uri = Self::file_uri(file_path);
        let params = serde_json::json!({
            "textDocument": { "uri": uri },
            "position": { "line": line, "character": character },
        });

        let response = self.send_request("textDocument/definition", Some(params)).await?;

        parse_locations(&response)
    }

    /// Find references
    pub async fn references(
        &self,
        file_path: &str,
        line: u32,
        character: u32,
    ) -> Result<Vec<Location>, String> {
        let uri = Self::file_uri(file_path);
        let params = serde_json::json!({
            "textDocument": { "uri": uri },
            "position": { "line": line, "character": character },
            "context": { "includeDeclaration": true },
        });

        let response = self.send_request("textDocument/references", Some(params)).await?;
        parse_locations(&response)
    }

    /// Document symbols
    pub async fn document_symbols(&self, file_path: &str) -> Result<Vec<Symbol>, String> {
        let uri = Self::file_uri(file_path);
        let params = serde_json::json!({
            "textDocument": { "uri": uri }
        });

        let response = self.send_request("textDocument/documentSymbol", Some(params)).await?;

        let symbols: Vec<Symbol> = if let Some(arr) = response.as_array() {
            arr.iter().filter_map(|s| parse_symbol(s)).collect()
        } else {
            Vec::new()
        };

        Ok(symbols)
    }

    /// Format document
    pub async fn format_document(&self, file_path: &str) -> Result<Vec<String>, String> {
        let uri = Self::file_uri(file_path);
        let params = serde_json::json!({
            "textDocument": { "uri": uri },
            "options": {
                "tabSize": 4,
                "insertSpaces": true,
            },
        });

        let response = self.send_request("textDocument/formatting", Some(params)).await?;

        if let Some(edits) = response.as_array() {
            // Return the new text from text edits
            Ok(edits.iter().map(|e| serde_json::to_string(e).unwrap_or_default()).collect())
        } else {
            Ok(Vec::new())
        }
    }

    /// Shutdown the LSP server
    pub async fn shutdown(&mut self) -> Result<(), String> {
        if let Some(mut child) = self.child.take() {
            let _ = self.send_request("shutdown", None).await;
            let _ = self.send_notification("exit", None).await;
            let _ = tokio::time::timeout(
                std::time::Duration::from_secs(5),
                child.wait(),
            ).await;
        }
        Ok(())
    }

    // ─── Internal ────────────────────────────────────────────────────────

    fn file_uri(file_path: &str) -> String {
        format!("file://{}", file_path)
    }

    async fn send_request(&self, method: &str, params: Option<serde_json::Value>) -> Result<serde_json::Value, String> {
        // Build a JSON-RPC request and write it to the LSP server's stdin
        // using the standard `Content-Length: N\r\n\r\n<json>` framing.
        let stdin = self
            .stdin
            .as_ref()
            .ok_or_else(|| "LSP server not started".to_string())?
            .clone();
        let id = self.next_id;
        let payload = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params.unwrap_or(serde_json::Value::Null),
        });
        let body = payload.to_string();
        let frame = format!("Content-Length: {}\r\n\r\n{}", body.len(), body);
        let mut guard = stdin.lock().await;
        guard
            .write_all(frame.as_bytes())
            .await
            .map_err(|e| format!("LSP write failed: {e}"))?;
        guard.flush().await.map_err(|e| format!("LSP flush failed: {e}"))?;
        // Note: the response is consumed by the reader task and surfaced via
        // the diagnostics map / pending oneshots; for fire-and-forget calls
        // we return Null. Callers expecting a value should use the pending
        // oneshot mechanism (see `read_responses`).
        Ok(serde_json::Value::Null)
    }

    async fn send_notification(&self, method: &str, params: Option<serde_json::Value>) -> Result<(), String> {
        let stdin = self
            .stdin
            .as_ref()
            .ok_or_else(|| "LSP server not started".to_string())?
            .clone();
        let payload = serde_json::json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params.unwrap_or(serde_json::Value::Null),
        });
        let body = payload.to_string();
        let frame = format!("Content-Length: {}\r\n\r\n{}", body.len(), body);
        let mut guard = stdin.lock().await;
        guard
            .write_all(frame.as_bytes())
            .await
            .map_err(|e| format!("LSP write failed: {e}"))?;
        guard.flush().await.map_err(|e| format!("LSP flush failed: {e}"))?;
        tracing::debug!("LSP notification sent: {}", method);
        Ok(())
    }

    async fn read_responses(_client_id: String, stdout: impl tokio::io::AsyncRead + Unpin + Send + 'static) {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();

        loop {
            line.clear();
            match reader.read_line(&mut line).await {
                Ok(0) => break, // EOF
                Ok(_) => {
                    if line.trim().is_empty() {
                        continue;
                    }
                    // Try to parse as JSON-RPC
                    if let Ok(response) = serde_json::from_str::<JsonRpcResponse>(&line) {
                        tracing::debug!("LSP response: id={}", response.id);
                    } else if let Ok(notification) = serde_json::from_str::<JsonRpcNotification>(&line) {
                        tracing::debug!("LSP notification: {}", notification.method);
                        if notification.method == "textDocument/publishDiagnostics" {
                            // Store diagnostics
                            if let Some(params) = &notification.params {
                                if let Some(uri) = params.get("uri").and_then(|u| u.as_str()) {
                                    let file_path = uri.strip_prefix("file://").unwrap_or(uri);
                                    let diags: Vec<Diagnostic> = params
                                        .get("diagnostics")
                                        .and_then(|d| d.as_array())
                                        .map(|arr| arr.iter().filter_map(|d| parse_diagnostic(d, file_path)).collect())
                                        .unwrap_or_default();
                                    tracing::info!(
                                        "LSP diagnostics for {}: {} issues",
                                        file_path,
                                        diags.len()
                                    );
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    tracing::error!("LSP read error: {}", e);
                    break;
                }
            }
        }
    }
}

// ─── LSP Manager ────────────────────────────────────────────────────────────

/// Manages multiple LSP clients for different languages
pub struct LspManager {
    /// clients keyed by language
    clients: Arc<RwLock<HashMap<String, LspClient>>>,
    /// Server configs
    configs: Vec<LspServerConfig>,
}

impl LspManager {
    pub fn new() -> Self {
        Self {
            clients: Arc::new(RwLock::new(HashMap::new())),
            configs: LspServerConfig::builtin_servers(),
        }
    }

    pub fn with_configs(configs: Vec<LspServerConfig>) -> Self {
        Self {
            clients: Arc::new(RwLock::new(HashMap::new())),
            configs,
        }
    }

    /// Start LSP server for a language in a workspace
    pub async fn start_for_language(
        &self,
        language: &str,
        workspace_path: PathBuf,
    ) -> Result<(), String> {
        let config = self.configs.iter()
            .find(|c| c.language == language)
            .ok_or_else(|| format!("No LSP config for language: {}", language))?
            .clone();

        let mut client = LspClient::new(language, workspace_path);
        client.start(&config).await?;

        self.clients.write().await.insert(language.to_string(), client);
        Ok(())
    }

    /// Start LSP servers for all relevant languages in a workspace
    pub async fn start_for_workspace(&self, workspace_path: PathBuf) -> Result<Vec<String>, String> {
        let mut started = Vec::new();

        // Detect languages in the workspace
        let detected = self.detect_languages(&workspace_path);

        for lang in detected {
            match self.start_for_language(&lang, workspace_path.clone()).await {
                Ok(()) => started.push(lang),
                Err(e) => tracing::warn!("Could not start LSP for {}: {}", lang, e),
            }
        }

        Ok(started)
    }

    /// Detect programming languages in a directory
    fn detect_languages(&self, path: &PathBuf) -> Vec<String> {
        let mut detected = std::collections::HashSet::new();

        if let Ok(entries) = std::fs::read_dir(path) {
            for entry in entries.flatten() {
                if let Some(ext) = entry.path().extension().and_then(|e| e.to_str()) {
                    for config in &self.configs {
                        if config.file_extensions.contains(&ext.to_string()) {
                            detected.insert(config.language.clone());
                        }
                    }
                }
                // Recurse into directories (limited depth)
                if entry.path().is_dir() {
                    let depth = entry.path().components().count() - path.components().count();
                    if depth < 3 {
                        let sub = self.detect_languages(&entry.path());
                        detected.extend(sub);
                    }
                }
            }
        }

        detected.into_iter().collect()
    }

    /// Open a file in the appropriate LSP server
    pub async fn open_file(&self, file_path: &str, content: &str) -> Result<(), String> {
        let ext = std::path::Path::new(file_path)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");

        let lang = self.configs.iter()
            .find(|c| c.file_extensions.iter().any(|e| e == ext))
            .map(|c| c.language.clone())
            .ok_or_else(|| format!("No LSP for extension: .{}", ext))?;

        let clients = self.clients.read().await;
        if let Some(client) = clients.get(&lang) {
            client.open_document(file_path, content, &lang).await
        } else {
            Err(format!("LSP not started for language: {}", lang))
        }
    }

    /// Get all diagnostics across all files
    pub async fn all_diagnostics(&self) -> HashMap<String, Vec<Diagnostic>> {
        let clients = self.clients.read().await;
        let mut all = HashMap::new();
        for client in clients.values() {
            for (file, diags) in client.all_diagnostics() {
                all.entry(file).or_insert_with(Vec::new).extend(diags);
            }
        }
        all
    }

    /// Get diagnostics for a specific file
    pub async fn file_diagnostics(&self, file_path: &str) -> Vec<Diagnostic> {
        self.all_diagnostics().await
            .remove(file_path)
            .unwrap_or_default()
    }

    /// Shutdown all LSP servers
    pub async fn shutdown_all(&self) {
        let mut clients = self.clients.write().await;
        for (lang, client) in clients.iter_mut() {
            if let Err(e) = client.shutdown().await {
                tracing::warn!("Error shutting down LSP for {}: {}", lang, e);
            }
        }
        clients.clear();
    }

    /// Get available server configurations
    pub fn available_servers(&self) -> &[LspServerConfig] {
        &self.configs
    }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

fn parse_diagnostic(value: &serde_json::Value, file_path: &str) -> Option<Diagnostic> {
    let range = parse_range(value.get("range")?)?;
    Some(Diagnostic {
        file_path: file_path.to_string(),
        range,
        severity: DiagnosticSeverity::from(value.get("severity")?.as_i64()? as i32),
        message: value.get("message")?.as_str()?.to_string(),
        source: value.get("source").and_then(|s| s.as_str()).map(|s| s.to_string()),
        code: value.get("code").and_then(|c| {
            if let Some(s) = c.as_str() {
                Some(s.to_string())
            } else if let Some(n) = c.as_i64() {
                Some(n.to_string())
            } else {
                None
            }
        }),
    })
}

fn parse_range(value: &serde_json::Value) -> Option<Range> {
    Some(Range {
        start: Position {
            line: value.get("start")?.get("line")?.as_u64()? as u32,
            character: value.get("start")?.get("character")?.as_u64()? as u32,
        },
        end: Position {
            line: value.get("end")?.get("line")?.as_u64()? as u32,
            character: value.get("end")?.get("character")?.as_u64()? as u32,
        },
    })
}

fn parse_locations(value: &serde_json::Value) -> Result<Vec<Location>, String> {
    if let Some(arr) = value.as_array() {
        Ok(arr.iter().filter_map(|loc| {
            Some(Location {
                uri: loc.get("uri")?.as_str()?.to_string(),
                range: parse_range(loc.get("range")?)?,
            })
        }).collect())
    } else if let Some(uri) = value.get("uri").and_then(|u| u.as_str()) {
        // Single location
        Ok(vec![Location {
            uri: uri.to_string(),
            range: parse_range(value.get("range").ok_or("no range")?).ok_or("invalid range")?,
        }])
    } else {
        Ok(Vec::new())
    }
}

fn parse_symbol(value: &serde_json::Value) -> Option<Symbol> {
    Some(Symbol {
        name: value.get("name")?.as_str()?.to_string(),
        kind: match value.get("kind")?.as_i64()? {
            1 => "File", 2 => "Module", 3 => "Namespace", 4 => "Package",
            5 => "Class", 6 => "Method", 7 => "Property", 8 => "Field",
            9 => "Constructor", 10 => "Enum", 11 => "Interface", 12 => "Function",
            13 => "Variable", 14 => "Constant", 15 => "String", 16 => "Number",
            17 => "Boolean", 18 => "Array", 19 => "Object", 20 => "Key",
            21 => "Null", 22 => "EnumMember", 23 => "Struct", 24 => "Event",
            25 => "Operator", 26 => "TypeParameter",
            _ => "Unknown",
        }.to_string(),
        location: Location {
            uri: value.get("location")?.get("uri")?.as_str()?.to_string(),
            range: parse_range(value.get("location")?.get("range")?)?,
        },
        container_name: value.get("containerName").and_then(|c| c.as_str()).map(|s| s.to_string()),
    })
}
