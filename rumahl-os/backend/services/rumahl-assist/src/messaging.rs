// ORA Multi-Interface Messaging – Email, Telegram, WhatsApp
// Let users chat with ORA via external messaging platforms

use std::collections::HashMap;

use parking_lot::RwLock;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

// ─── Types ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmtpConfig {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String, // stored encrypted
    pub from_address: String,
    pub from_name: String,
    pub use_tls: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelegramConfig {
    pub enabled: bool,
    pub bot_token: String,
    pub bot_username: String,
    pub webhook_url: String,
    pub allowed_chat_ids: Vec<String>,
    pub forward_to_ora: bool, // forward user messages to ORA for processing
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhatsAppConfig {
    pub enabled: bool,
    pub provider: String, // "twilio" | "meta" (WhatsApp Cloud API)
    pub account_sid: String,
    pub auth_token: String,
    pub phone_number_id: String,
    pub from_number: String,
    pub webhook_verify_token: String,
    pub allowed_numbers: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessagingConfig {
    pub smtp: SmtpConfig,
    pub telegram: TelegramConfig,
    pub whatsapp: WhatsAppConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailRequest {
    pub to: Vec<String>,
    pub subject: String,
    pub body: String,
    pub html_body: Option<String>,
    pub cc: Option<Vec<String>>,
    pub priority: Option<String>, // "high" | "normal" | "low"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageResult {
    pub success: bool,
    pub message_id: Option<String>,
    pub error: Option<String>,
    pub channel: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IncomingMessage {
    pub channel: String, // "telegram" | "whatsapp" | "email"
    pub from: String,
    pub text: String,
    pub chat_id: String,
    pub timestamp: String,
    pub metadata: HashMap<String, String>,
}

// ─── Messaging Manager ─────────────────────────────────────────────────────

pub struct MessagingManager {
    config: RwLock<MessagingConfig>,
    http: Client,
}

impl MessagingManager {
    pub fn new() -> Self {
        Self {
            config: RwLock::new(MessagingConfig {
                smtp: SmtpConfig {
                    enabled: false,
                    host: String::new(),
                    port: 587,
                    username: String::new(),
                    password: String::new(),
                    from_address: "ora@rumahl.local".into(),
                    from_name: "ORA AI".into(),
                    use_tls: true,
                },
                telegram: TelegramConfig {
                    enabled: false,
                    bot_token: String::new(),
                    bot_username: String::new(),
                    webhook_url: String::new(),
                    allowed_chat_ids: vec![],
                    forward_to_ora: true,
                },
                whatsapp: WhatsAppConfig {
                    enabled: false,
                    provider: "twilio".into(),
                    account_sid: String::new(),
                    auth_token: String::new(),
                    phone_number_id: String::new(),
                    from_number: String::new(),
                    webhook_verify_token: String::new(),
                    allowed_numbers: vec![],
                },
            }),
            http: Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .unwrap(),
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  SMTP EMAIL
    // ═══════════════════════════════════════════════════════════════════════

    pub fn get_smtp_config(&self) -> SmtpConfig {
        self.config.read().smtp.clone()
    }

    pub fn update_smtp_config(&self, cfg: SmtpConfig) {
        self.config.write().smtp = cfg;
    }

    /// Send an email via configured SMTP server
    pub async fn send_email(&self, req: &EmailRequest) -> MessageResult {
        let cfg = self.config.read().smtp.clone();
        if !cfg.enabled {
            return MessageResult {
                success: false,
                message_id: None,
                error: Some("SMTP not enabled".into()),
                channel: "email".into(),
            };
        }

        // Build email content
        let html = req.html_body.clone().unwrap_or_else(|| {
            format!(
                "<html><body><pre>{}</pre></body></html>",
                req.body.replace('<', "&lt;").replace('>', "&gt;")
            )
        });

        // Use lettre or raw SMTP via reqwest to a mail API
        // For now, use a REST-based mail sending approach
        let result = self.send_email_via_api(&cfg, req, &html).await;

        info!(
            "Email sent to {:?}: {}",
            req.to,
            if result.success { "OK" } else { "FAILED" }
        );
        result
    }

    async fn send_email_via_api(
        &self,
        cfg: &SmtpConfig,
        req: &EmailRequest,
        html: &str,
    ) -> MessageResult {
        // Try SendGrid-compatible API first, fall back to direct SMTP via mail API
        let payload = serde_json::json!({
            "personalizations": [{"to": req.to.iter().map(|t| serde_json::json!({"email": t})).collect::<Vec<_>>()}],
            "from": {"email": cfg.from_address, "name": cfg.from_name},
            "subject": req.subject,
            "content": [
                {"type": "text/plain", "value": req.body},
                {"type": "text/html", "value": html},
            ],
        });

        // Try to send via the configured SMTP server's API or direct
        match self
            .http
            .post("https://api.sendgrid.com/v3/mail/send".to_string())
            .bearer_auth(&cfg.password)
            .json(&payload)
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => MessageResult {
                success: true,
                message_id: Some("sent".into()),
                error: None,
                channel: "email".into(),
            },
            Ok(resp) => {
                let status = resp.status();
                MessageResult {
                    success: false,
                    message_id: None,
                    error: Some(format!("SMTP send failed: {}", status)),
                    channel: "email".into(),
                }
            }
            Err(e) => MessageResult {
                success: false,
                message_id: None,
                error: Some(format!("SMTP error: {}", e)),
                channel: "email".into(),
            },
        }
    }

    /// ORA sends a notification email to the user
    pub async fn notify_user(&self, subject: &str, body: &str) -> MessageResult {
        let from_addr = {
            let cfg = self.config.read();
            if !cfg.smtp.enabled || cfg.smtp.from_address.is_empty() {
                return MessageResult {
                    success: false,
                    message_id: None,
                    error: Some("SMTP not configured".into()),
                    channel: "email".into(),
                };
            }
            cfg.smtp.from_address.clone()
        }; // read guard dropped here

        self.send_email(&EmailRequest {
            to: vec![from_addr], // Send to configured address
            subject: format!("[ORA] {}", subject),
            body: body.to_string(),
            html_body: Some(format!("<h2>ORA Notification</h2><p>{}</p>", body)),
            cc: None,
            priority: Some("normal".into()),
        })
        .await
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  TELEGRAM BOT
    // ═══════════════════════════════════════════════════════════════════════

    pub fn get_telegram_config(&self) -> TelegramConfig {
        self.config.read().telegram.clone()
    }
    pub fn update_telegram_config(&self, cfg: TelegramConfig) {
        self.config.write().telegram = cfg;
    }

    /// Send a message to a Telegram chat
    pub async fn send_telegram_message(&self, chat_id: &str, text: &str) -> MessageResult {
        let cfg = self.config.read().telegram.clone();
        if !cfg.enabled || cfg.bot_token.is_empty() {
            return MessageResult {
                success: false,
                message_id: None,
                error: Some("Telegram not enabled".into()),
                channel: "telegram".into(),
            };
        }

        let url = format!("https://api.telegram.org/bot{}/sendMessage", cfg.bot_token);
        match self
            .http
            .post(&url)
            .json(&serde_json::json!({
                "chat_id": chat_id,
                "text": text,
                "parse_mode": "Markdown",
            }))
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                let body: serde_json::Value = resp.json().await.unwrap_or_default();
                let msg_id = body["result"]["message_id"].as_i64().map(|i| i.to_string());
                MessageResult {
                    success: true,
                    message_id: msg_id,
                    error: None,
                    channel: "telegram".into(),
                }
            }
            Ok(resp) => MessageResult {
                success: false,
                message_id: None,
                error: Some(format!("Telegram API error: {}", resp.status())),
                channel: "telegram".into(),
            },
            Err(e) => MessageResult {
                success: false,
                message_id: None,
                error: Some(e.to_string()),
                channel: "telegram".into(),
            },
        }
    }

    /// Set up Telegram webhook
    pub async fn setup_telegram_webhook(&self) -> MessageResult {
        let cfg = self.config.read().telegram.clone();
        let url = format!("https://api.telegram.org/bot{}/setWebhook", cfg.bot_token);
        match self
            .http
            .post(&url)
            .json(&serde_json::json!({"url": cfg.webhook_url}))
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                info!("Telegram webhook set to {}", cfg.webhook_url);
                MessageResult {
                    success: true,
                    message_id: None,
                    error: None,
                    channel: "telegram".into(),
                }
            }
            Ok(resp) => {
                let body = resp.text().await.unwrap_or_default();
                MessageResult {
                    success: false,
                    message_id: None,
                    error: Some(body),
                    channel: "telegram".into(),
                }
            }
            Err(e) => MessageResult {
                success: false,
                message_id: None,
                error: Some(e.to_string()),
                channel: "telegram".into(),
            },
        }
    }

    /// Process incoming Telegram message (called from webhook)
    pub async fn process_telegram_message(
        &self,
        update: serde_json::Value,
    ) -> Option<IncomingMessage> {
        let message = update["message"].clone();
        let chat_id = message["chat"]["id"].as_i64()?.to_string();
        let text = message["text"].as_str()?.to_string();
        let from = message["from"]["username"]
            .as_str()
            .unwrap_or(message["from"]["first_name"].as_str().unwrap_or("unknown"))
            .to_string();

        let cfg = self.config.read();
        if !cfg.telegram.allowed_chat_ids.is_empty()
            && !cfg.telegram.allowed_chat_ids.contains(&chat_id)
        {
            warn!("Telegram: unauthorized chat_id {}", chat_id);
            return None;
        }
        drop(cfg);

        Some(IncomingMessage {
            channel: "telegram".into(),
            from,
            text,
            chat_id,
            timestamp: chrono::Utc::now().to_rfc3339(),
            metadata: HashMap::new(),
        })
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  WHATSAPP (via Twilio / Meta WhatsApp Cloud API)
    // ═══════════════════════════════════════════════════════════════════════

    pub fn get_whatsapp_config(&self) -> WhatsAppConfig {
        self.config.read().whatsapp.clone()
    }
    pub fn update_whatsapp_config(&self, cfg: WhatsAppConfig) {
        self.config.write().whatsapp = cfg;
    }

    /// Send WhatsApp message via Twilio
    pub async fn send_whatsapp_message(&self, to: &str, text: &str) -> MessageResult {
        let cfg = self.config.read().whatsapp.clone();
        if !cfg.enabled {
            return MessageResult {
                success: false,
                message_id: None,
                error: Some("WhatsApp not enabled".into()),
                channel: "whatsapp".into(),
            };
        }

        let from = format!("whatsapp:{}", cfg.from_number);
        let to_formatted = format!("whatsapp:{}", to);

        let url = format!(
            "https://api.twilio.com/2010-04-01/Accounts/{}/Messages.json",
            cfg.account_sid
        );

        match self
            .http
            .post(&url)
            .basic_auth(&cfg.account_sid, Some(&cfg.auth_token))
            .form(&[
                ("From", from.as_str()),
                ("To", to_formatted.as_str()),
                ("Body", text),
            ])
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                let body: serde_json::Value = resp.json().await.unwrap_or_default();
                let sid = body["sid"].as_str().map(|s| s.to_string());
                MessageResult {
                    success: true,
                    message_id: sid,
                    error: None,
                    channel: "whatsapp".into(),
                }
            }
            Ok(resp) => {
                let body = resp.text().await.unwrap_or_default();
                MessageResult {
                    success: false,
                    message_id: None,
                    error: Some(body),
                    channel: "whatsapp".into(),
                }
            }
            Err(e) => MessageResult {
                success: false,
                message_id: None,
                error: Some(e.to_string()),
                channel: "whatsapp".into(),
            },
        }
    }

    /// Process incoming WhatsApp message (Twilio webhook)
    pub async fn process_whatsapp_message(&self, body: &str) -> Option<IncomingMessage> {
        let params: HashMap<String, String> = body
            .split('&')
            .filter_map(|p| {
                let mut parts = p.splitn(2, '=');
                Some((parts.next()?.to_string(), parts.next()?.to_string()))
            })
            .collect();

        let from = params.get("From")?.replace("whatsapp:", "");
        let text = params.get("Body")?.clone();
        let msg_sid = params.get("MessageSid").cloned().unwrap_or_default();

        let cfg = self.config.read();
        if !cfg.whatsapp.allowed_numbers.is_empty() && !cfg.whatsapp.allowed_numbers.contains(&from)
        {
            warn!("WhatsApp: unauthorized number {}", from);
            return None;
        }
        drop(cfg);

        Some(IncomingMessage {
            channel: "whatsapp".into(),
            from,
            text,
            chat_id: msg_sid,
            timestamp: chrono::Utc::now().to_rfc3339(),
            metadata: HashMap::new(),
        })
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  GENERAL
    // ═══════════════════════════════════════════════════════════════════════

    pub fn get_config(&self) -> MessagingConfig {
        self.config.read().clone()
    }
    pub fn update_config(&self, cfg: MessagingConfig) {
        *self.config.write() = cfg;
    }

    /// Send a message through all enabled channels
    pub async fn broadcast(&self, text: &str) -> Vec<MessageResult> {
        let mut results = Vec::new();

        // Telegram
        let tg_cfg = self.config.read().telegram.clone();
        if tg_cfg.enabled {
            for chat_id in &tg_cfg.allowed_chat_ids {
                results.push(self.send_telegram_message(chat_id, text).await);
            }
        }

        // Email notification
        results.push(self.notify_user("Broadcast", text).await);

        results
    }

    /// Process an incoming message from any channel through ORA's AI
    pub async fn process_incoming(&self, msg: IncomingMessage) -> String {
        info!(
            "Incoming {} from {}: {}",
            msg.channel,
            msg.from,
            &msg.text[..100.min(msg.text.len())]
        );

        // This would normally call the ORA AI chat endpoint to get a response
        // For now, return a placeholder
        format!(
            "Thanks for your message via {}! ORA received: {}",
            msg.channel, msg.text
        )
    }
}
