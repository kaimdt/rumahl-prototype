// DLP Guard & AI Token System – Sensitive data protection for all AI I/O
// Prevents accidental leakage of passwords, tokens, secrets, credentials

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use chrono::{DateTime, Utc};
use parking_lot::RwLock;
use rand::Rng;
use regex::Regex;
use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};
use tracing::{error, info, warn};

// ─── Sensitive Data Patterns ───────────────────────────────────────────────

lazy_static::lazy_static! {
    /// Patterns that indicate sensitive data
    static ref SENSITIVE_PATTERNS: Vec<(Regex, &'static str, Severity)> = vec![
        (Regex::new("(?i)(api[_-]?key|apikey|api_secret|secret[_-]?key)[\\s]*[:=][\\s]*[\"']?([a-zA-Z0-9_\\-]{20,})[\"']?").unwrap(), "API Key", Severity::Critical),
        (Regex::new(r"(?i)sk-[a-zA-Z0-9]{32,}").unwrap(), "OpenAI Key", Severity::Critical),
        (Regex::new(r"(?i)sk-ant-[a-zA-Z0-9]{32,}").unwrap(), "Anthropic Key", Severity::Critical),

        // Passwords
        (Regex::new(r"(?i)(password|passwd|pwd)\s*[:=]\s*[\x22\x27]?(\S{4,})[\x22\x27]?").unwrap(), "Password", Severity::Critical),
        (Regex::new(r"(?i)(DB_PASSWORD|DATABASE_URL|POSTGRES_PASSWORD)\s*=\s*(\S+)").unwrap(), "DB Credentials", Severity::Critical),

        // Tokens
        (Regex::new(r"(?i)(bearer|token|jwt|auth[_-]?token)\s+[\x22\x27]?([a-zA-Z0-9\-_\.]{20,})[\x22\x27]?").unwrap(), "Auth Token", Severity::Critical),
        (Regex::new(r"eyJ[a-zA-Z0-9\-_]+\.eyJ[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+").unwrap(), "JWT Token", Severity::Critical),
        (Regex::new(r"ghp_[a-zA-Z0-9]{36}").unwrap(), "GitHub Token", Severity::Critical),
        (Regex::new(r"gho_[a-zA-Z0-9]{36}").unwrap(), "GitHub OAuth", Severity::Critical),

        // Private Keys
        (Regex::new(r"-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----").unwrap(), "Private Key", Severity::Critical),
        (Regex::new(r"-----BEGIN CERTIFICATE-----").unwrap(), "Certificate", Severity::Warning),

        // Connection strings with credentials
        (Regex::new(r"(?i)(mysql|postgres|postgresql|mongodb|redis)://[^:]+:[^@]+@").unwrap(), "DB Connection String", Severity::Critical),
        (Regex::new(r"(?i)mongodb\+srv://[^:]+:[^@]+@").unwrap(), "MongoDB SRV", Severity::Critical),

        // IORA-specific: AI system token (iora_ait_ prefix)
        (Regex::new(r"iora_ait_[a-zA-Z0-9]{32,}").unwrap(), "IORA AI Token", Severity::Critical),

        // IP addresses with ports (potential internal services)
        (Regex::new(r"(?i)(internal|private|admin)\s+(host|url|endpoint)\s*[:=]\s*[\x22\x27]?(\S+)[\x22\x27]?").unwrap(), "Internal Endpoint", Severity::Warning),

        // Environment variable dumps containing secrets
        (Regex::new(r"(?i)(env|environment)\s*\|[\s\S]*?(PASSWORD|SECRET|TOKEN|KEY)").unwrap(), "Env Dump with Secrets", Severity::Critical),
    ];
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum Severity {
    /// Block the message entirely — return error
    Critical,
    /// Redact the sensitive data — replace with [REDACTED]
    Warning,
    /// Log but allow through
    Info,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DlpFinding {
    pub pattern_name: String,
    pub severity: Severity,
    pub matched_text_preview: String, // First 20 chars of matched text
    pub position: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DlpScanResult {
    pub passed: bool,
    pub findings: Vec<DlpFinding>,
    pub sanitized_text: String,
    pub blocked: bool,
    pub reason: Option<String>,
}

// ─── DLP Guard ─────────────────────────────────────────────────────────────

pub struct DlpGuard {
    /// Custom patterns added by admin
    custom_patterns: RwLock<Vec<(Regex, String, Severity)>>,
    /// List of strings that should always be redacted (AI token, etc.)
    redaction_list: RwLock<Vec<String>>,
    /// Stats
    total_scans: RwLock<u64>,
    total_blocks: RwLock<u64>,
    total_redactions: RwLock<u64>,
}

impl DlpGuard {
    pub fn new() -> Self {
        Self {
            custom_patterns: RwLock::new(Vec::new()),
            redaction_list: RwLock::new(Vec::new()),
            total_scans: RwLock::new(0),
            total_blocks: RwLock::new(0),
            total_redactions: RwLock::new(0),
        }
    }

    /// Add a string to the redaction list (e.g., the current AI token)
    pub fn add_redaction(&self, value: &str) {
        if !value.is_empty() {
            self.redaction_list.write().push(value.to_string());
        }
    }

    /// Remove a string from the redaction list (e.g., expired token)
    pub fn remove_redaction(&self, value: &str) {
        self.redaction_list.write().retain(|v| v != value);
    }

    /// Scan text for sensitive data — used for AI INPUTS
    pub fn scan_input(&self, text: &str) -> DlpScanResult {
        *self.total_scans.write() += 1;

        let mut findings = Vec::new();
        let mut sanitized = text.to_string();
        let mut blocked = false;
        let mut reason = None;

        // 1. Check built-in patterns
        for (regex, name, severity) in SENSITIVE_PATTERNS.iter() {
            for cap in regex.captures_iter(text) {
                let full_match = cap.get(0).map(|m| m.as_str()).unwrap_or("");
                let preview = &full_match[..full_match.len().min(30)];

                findings.push(DlpFinding {
                    pattern_name: name.to_string(),
                    severity: severity.clone(),
                    matched_text_preview: preview.to_string(),
                    position: cap.get(0).map(|m| m.start()).unwrap_or(0),
                });

                // Redact the sensitive data
                sanitized = sanitized.replace(full_match, &format!("[REDACTED:{}]", name));

                if *severity == Severity::Critical {
                    blocked = true;
                    reason = Some(format!("Sensitive data detected: {}", name));
                    *self.total_blocks.write() += 1;
                }
            }
        }

        // 2. Check redaction list (exact string matches)
        let redactions = self.redaction_list.read();
        for value in redactions.iter() {
            if sanitized.contains(value) {
                sanitized = sanitized.replace(value, "[REDACTED:AI_TOKEN]");
                findings.push(DlpFinding {
                    pattern_name: "AI System Token".into(),
                    severity: Severity::Critical,
                    matched_text_preview: "***".into(),
                    position: 0,
                });
                blocked = true;
                reason = Some("AI system token detected in input".into());
                *self.total_blocks.write() += 1;
            }
        }

        // 3. Check custom patterns
        let customs = self.custom_patterns.read();
        for (regex, name, severity) in customs.iter() {
            if regex.is_match(&sanitized) {
                sanitized = regex.replace_all(&sanitized, &format!("[REDACTED:{}]", name)).to_string();
                findings.push(DlpFinding {
                    pattern_name: name.clone(),
                    severity: severity.clone(),
                    matched_text_preview: "[custom pattern]".into(),
                    position: 0,
                });
                if *severity == Severity::Critical {
                    blocked = true;
                    reason = Some(format!("Custom DLP rule triggered: {}", name));
                }
            }
        }

        if !findings.is_empty() {
            *self.total_redactions.write() += findings.len() as u64;
        }

        DlpScanResult {
            passed: findings.is_empty(),
            findings,
            sanitized_text: sanitized,
            blocked,
            reason,
        }
    }

    /// Scan AI output before it reaches the user — stricter: blocks all sensitive data
    pub fn scan_output(&self, text: &str) -> DlpScanResult {
        let mut result = self.scan_input(text);
        // For outputs, ANY sensitive data = block
        if !result.findings.is_empty() {
            result.blocked = true;
            result.reason = Some(format!(
                "AI attempted to output sensitive data: {}",
                result.findings.iter().map(|f| f.pattern_name.as_str()).collect::<Vec<_>>().join(", ")
            ));
            // Replace the entire output with a safe message
            result.sanitized_text = "[Output blocked: contained sensitive data. This incident has been logged.]".into();
        }
        result
    }

    /// Add a custom DLP pattern
    pub fn add_custom_pattern(&self, pattern: &str, name: &str, severity: Severity) -> Result<(), String> {
        let regex = Regex::new(pattern).map_err(|e| format!("Invalid regex: {}", e))?;
        self.custom_patterns.write().push((regex, name.to_string(), severity));
        info!("DLP: Added custom pattern '{}'", name);
        Ok(())
    }

    pub fn get_stats(&self) -> DlpStats {
        DlpStats {
            total_scans: *self.total_scans.read(),
            total_blocks: *self.total_blocks.read(),
            total_redactions: *self.total_redactions.read(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DlpStats {
    pub total_scans: u64,
    pub total_blocks: u64,
    pub total_redactions: u64,
}

// ─── AI System Token Manager ───────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiToken {
    /// The token value — NEVER logged or stored in plain text
    pub token_hash: String,
    /// When the token was created
    pub created_at: DateTime<Utc>,
    /// When the token expires
    pub expires_at: DateTime<Utc>,
    /// Human-readable label
    pub label: String,
    /// Scopes/permissions
    pub scopes: Vec<String>,
    /// Whether the token is still active
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiTokenConfig {
    /// Lifetime of each token in seconds
    pub token_lifetime_secs: u64,
    /// Auto-rotate tokens before expiry (seconds before)
    pub rotate_before_secs: u64,
    /// Maximum number of active tokens
    pub max_active_tokens: u32,
    /// Scopes granted to AI tokens
    pub default_scopes: Vec<String>,
}

impl Default for AiTokenConfig {
    fn default() -> Self {
        Self {
            token_lifetime_secs: 3600,     // 1 hour
            rotate_before_secs: 300,        // Rotate 5 minutes before expiry
            max_active_tokens: 3,
            default_scopes: vec![
                "read:workspace".into(),
                "write:workspace".into(),
                "execute:bash".into(),
            ],
        }
    }
}

pub struct AiTokenManager {
    config: RwLock<AiTokenConfig>,
    active_tokens: RwLock<Vec<AiToken>>,
    /// The currently ACTIVE token VALUE — stored ONLY here, never in logs
    current_token: RwLock<Option<String>>,
    revoke_log: RwLock<Vec<(String, DateTime<Utc>)>>, // (reason, when)
}

impl AiTokenManager {
    pub fn new() -> Self {
        Self {
            config: RwLock::new(AiTokenConfig::default()),
            active_tokens: RwLock::new(Vec::new()),
            current_token: RwLock::new(None),
            revoke_log: RwLock::new(Vec::new()),
        }
    }

    /// Generate a new AI system token
    pub fn generate_token(&self, label: &str) -> Result<String, String> {
        let config = self.config.read();
        let mut tokens = self.active_tokens.write();

        // Check max active tokens
        if tokens.len() >= config.max_active_tokens as usize {
            // Revoke the oldest token
            if let Some(oldest) = tokens.first() {
                self.revoke_log.write().push(("max_tokens_exceeded".into(), Utc::now()));
            }
            tokens.remove(0);
        }

        // Generate cryptographically secure random token
        let random_bytes: Vec<u8> = (0..48).map(|_| rand::thread_rng().gen()).collect();
        let token_value = format!("iora_ait_{}", hex::encode(&random_bytes));

        // Hash the token for storage
        let mut hasher = Sha256::new();
        hasher.update(token_value.as_bytes());
        let token_hash = hex::encode(hasher.finalize());

        let now = Utc::now();
        let expires = now + chrono::Duration::seconds(config.token_lifetime_secs as i64);

        let ai_token = AiToken {
            token_hash,
            created_at: now,
            expires_at: expires,
            label: label.to_string(),
            scopes: config.default_scopes.clone(),
            is_active: true,
        };

        tokens.push(ai_token);
        *self.current_token.write() = Some(token_value.clone());

        info!("AI Token generated: {} (expires {})", label, expires);
        Ok(token_value)
    }

    /// Get the current active token value (dangerous — only for internal use)
    pub fn get_current_token(&self) -> Option<String> {
        self.current_token.read().clone()
    }

    /// Check if a token is valid (by hash)
    pub fn validate_token(&self, token_value: &str) -> bool {
        let mut hasher = Sha256::new();
        hasher.update(token_value.as_bytes());
        let hash = hex::encode(hasher.finalize());

        self.active_tokens.read().iter().any(|t| {
            t.token_hash == hash && t.is_active && Utc::now() < t.expires_at
        })
    }

    /// Revoke a token by hash
    pub fn revoke_token(&self, token_hash: &str, reason: &str) {
        let mut tokens = self.active_tokens.write();
        for t in tokens.iter_mut() {
            if t.token_hash == token_hash {
                t.is_active = false;
                self.revoke_log.write().push((reason.to_string(), Utc::now()));
                info!("AI Token revoked: {} ({})", t.label, reason);
                return;
            }
        }
    }

    /// Revoke ALL active tokens immediately
    pub fn revoke_all(&self, reason: &str) {
        let mut tokens = self.active_tokens.write();
        for t in tokens.iter_mut() {
            t.is_active = false;
        }
        *self.current_token.write() = None;
        self.revoke_log.write().push((reason.to_string(), Utc::now()));
        warn!("ALL AI tokens revoked: {}", reason);
    }

    /// Clean up expired tokens
    pub fn cleanup_expired(&self) {
        let now = Utc::now();
        let mut tokens = self.active_tokens.write();
        tokens.retain(|t| t.is_active && t.expires_at > now);
    }

    /// Check if token rotation is needed
    pub fn needs_rotation(&self) -> bool {
        let config = self.config.read();
        let tokens = self.active_tokens.read();
        let now = Utc::now();

        tokens.iter().any(|t| {
            t.is_active && (t.expires_at - now).num_seconds() < config.rotate_before_secs as i64
        })
    }

    /// Auto-rotate tokens that are about to expire
    pub fn auto_rotate(&self) -> Option<String> {
        if self.needs_rotation() {
            self.cleanup_expired();
            self.generate_token("auto-rotated").ok()
        } else {
            None
        }
    }

    pub fn get_config(&self) -> AiTokenConfig { self.config.read().clone() }
    pub fn update_config(&self, cfg: AiTokenConfig) { *self.config.write() = cfg; }
    pub fn get_active_tokens(&self) -> Vec<AiToken> {
        self.active_tokens.read().iter().filter(|t| t.is_active).cloned().collect()
    }
    pub fn get_revoke_log(&self) -> Vec<(String, DateTime<Utc>)> {
        self.revoke_log.read().clone()
    }
}
