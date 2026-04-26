// Proactive Conversation Manager
// Manages continuous conversation threads and AI-initiated messages

use crate::database::{DbPool, conversations as db_conversations, notifications as db_notifications};
use crate::orchestrator::ProviderOrchestrator;
use crate::providers::ChatMessage;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::time::{interval, Duration};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MessageInitiator {
    User,
    AI,
    System,
}

impl MessageInitiator {
    pub fn as_str(&self) -> &str {
        match self {
            MessageInitiator::User => "user",
            MessageInitiator::AI => "ai",
            MessageInitiator::System => "system",
        }
    }
}

pub struct ConversationManager {
    db: DbPool,
    orchestrator: Arc<ProviderOrchestrator>,
    running: Arc<tokio::sync::RwLock<bool>>,
}

impl ConversationManager {
    pub fn new(db: DbPool, orchestrator: Arc<ProviderOrchestrator>) -> Self {
        Self {
            db,
            orchestrator,
            running: Arc::new(tokio::sync::RwLock::new(false)),
        }
    }

    /// Start the proactive conversation manager
    pub async fn start(&self) {
        let mut is_running = self.running.write().await;
        if *is_running {
            tracing::warn!("Conversation manager is already running");
            return;
        }
        *is_running = true;
        drop(is_running);

        let db = self.db.clone();
        let orchestrator = self.orchestrator.clone();
        let running = self.running.clone();

        tokio::spawn(async move {
            tracing::info!("Conversation manager started");
            let mut tick_interval = interval(Duration::from_secs(30)); // Check every 30 seconds

            loop {
                tick_interval.tick().await;

                if !*running.read().await {
                    tracing::info!("Conversation manager stopped");
                    break;
                }

                // Check for notifications to deliver
                if let Err(e) = Self::deliver_pending_notifications(&db).await {
                    tracing::error!("Error delivering notifications: {}", e);
                }
            }
        });
    }

    /// Stop the conversation manager
    pub async fn stop(&self) {
        let mut is_running = self.running.write().await;
        *is_running = false;
        tracing::info!("Conversation manager stop requested");
    }

    /// Deliver pending notifications
    async fn deliver_pending_notifications(
        db: &DbPool,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let notifications = db_notifications::get_pending_notifications(db, 10).await?;

        for notification in notifications {
            tracing::info!("Delivering notification: {}", notification.message);

            // Mark as delivered
            if let Err(e) = db_notifications::mark_delivered(db, notification.id).await {
                tracing::error!("Failed to mark notification as delivered: {}", e);
            }

            // In production, this would send the notification via WebSocket/SSE
            // For now, we just log it
            tracing::info!("Notification delivered: {}", notification.message);
        }

        Ok(())
    }

    /// Create a new conversation thread
    pub async fn create_thread(
        &self,
        user_id: Option<Uuid>,
        _initial_context: Option<serde_json::Value>,
    ) -> Result<Uuid, Box<dyn std::error::Error + Send + Sync>> {
        let thread = db_conversations::create_thread(&self.db, user_id).await?;
        Ok(thread.id)
    }

    /// Add a message to a thread
    pub async fn add_message(
        &self,
        thread_id: Uuid,
        role: &str,
        content: &str,
        provider: Option<&str>,
        initiated_by: MessageInitiator,
    ) -> Result<Uuid, Box<dyn std::error::Error + Send + Sync>> {
        let message = db_conversations::add_message(
            &self.db,
            thread_id,
            role,
            content,
            provider,
            Some(initiated_by.as_str()),
        )
        .await?;
        Ok(message.id)
    }

    /// Get messages from a thread
    pub async fn get_thread_messages(
        &self,
        thread_id: Uuid,
        limit: i64,
        _offset: i64,
    ) -> Result<Vec<db_conversations::ConversationMessage>, Box<dyn std::error::Error + Send + Sync>> {
        let messages = db_conversations::get_thread_messages(&self.db, thread_id, limit).await?;
        Ok(messages)
    }

    /// Generate an AI-initiated message
    pub async fn generate_proactive_message(
        &self,
        thread_id: Uuid,
        context: &str,
        purpose: &str,
    ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        let system_prompt = format!(
            "You are a proactive AI assistant. Generate a helpful message based on the following context and purpose.\n\nContext: {}\nPurpose: {}",
            context, purpose
        );

        let messages = vec![ChatMessage {
            role: "user".to_string(),
            content: "Generate a proactive message to help the user.".to_string(),
        }];

        let response = self.orchestrator
            .execute_chat(messages, Some(system_prompt), None)
            .await?;

        // Add the AI-initiated message to the thread
        self.add_message(
            thread_id,
            "assistant",
            &response.message,
            Some(&response.provider),
            MessageInitiator::AI,
        )
        .await?;

        Ok(response.message)
    }

    /// Respond to a user message in a thread
    pub async fn respond_to_user(
        &self,
        thread_id: Uuid,
        user_message: &str,
    ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        // Add user message to thread
        self.add_message(
            thread_id,
            "user",
            user_message,
            None,
            MessageInitiator::User,
        )
        .await?;

        // Get recent messages for context
        let history = self.get_thread_messages(thread_id, 10, 0).await?;

        // Convert to ChatMessage format
        let mut messages = Vec::new();
        for msg in history {
            messages.push(ChatMessage {
                role: msg.role.clone(),
                content: msg.content.clone(),
            });
        }

        // Generate response
        let response = self.orchestrator
            .execute_chat(messages, Some("You are a helpful AI assistant for a smart home system.".to_string()), None)
            .await?;

        // Add assistant response to thread
        self.add_message(
            thread_id,
            "assistant",
            &response.message,
            Some(&response.provider),
            MessageInitiator::AI,
        )
        .await?;

        Ok(response.message)
    }

    /// Send a proactive notification
    pub async fn send_proactive_notification(
        &self,
        user_id: Option<Uuid>,
        message: &str,
        notification_type: &str,
        priority: i32,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        db_notifications::queue_notification(
            &self.db,
            user_id,
            message,
            notification_type,
            priority,
            None,
        )
        .await?;

        tracing::info!("Proactive notification queued: {}", message);
        Ok(())
    }

    /// Check if a thread is active
    pub async fn is_thread_active(&self, thread_id: Uuid) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
        // Get thread from database and check if active
        // This is a placeholder - in production, we'd query the thread
        Ok(true)
    }

    /// Archive a conversation thread
    pub async fn archive_thread(&self, thread_id: Uuid) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // Mark thread as inactive
        sqlx::query("UPDATE conversation_threads SET active = false WHERE id = $1")
            .bind(thread_id)
            .execute(&self.db)
            .await?;

        tracing::info!("Thread {} archived", thread_id);
        Ok(())
    }

    /// Get active threads for a user
    pub async fn get_active_threads(
        &self,
        user_id: Option<Uuid>,
        limit: i64,
    ) -> Result<Vec<db_conversations::ConversationThread>, Box<dyn std::error::Error + Send + Sync>> {
        let threads = if let Some(uid) = user_id {
            sqlx::query_as::<_, db_conversations::ConversationThread>(
                "SELECT * FROM conversation_threads WHERE user_id = $1 AND active = true ORDER BY last_activity DESC LIMIT $2"
            )
            .bind(uid)
            .bind(limit)
            .fetch_all(&self.db)
            .await?
        } else {
            sqlx::query_as::<_, db_conversations::ConversationThread>(
                "SELECT * FROM conversation_threads WHERE active = true ORDER BY last_activity DESC LIMIT $1"
            )
            .bind(limit)
            .fetch_all(&self.db)
            .await?
        };

        Ok(threads)
    }

    /// Update thread context
    pub async fn update_thread_context(
        &self,
        thread_id: Uuid,
        context: serde_json::Value,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        sqlx::query("UPDATE conversation_threads SET context = $1, last_activity = NOW() WHERE id = $2")
            .bind(context)
            .bind(thread_id)
            .execute(&self.db)
            .await?;

        Ok(())
    }
}

/// Helper function to create a default conversation manager
pub async fn create_conversation_manager(
    db: DbPool,
    orchestrator: Arc<ProviderOrchestrator>,
) -> ConversationManager {
    ConversationManager::new(db, orchestrator)
}
