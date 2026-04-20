//! Notification Formatter
//!
//! Formatiert Benachrichtigungen mit Emojis und strukturierten Daten.

use serde::{Deserialize, Serialize};
use anyhow::Result;

use super::Notification;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FormattedNotification {
    pub title: String,
    pub message: String,
    pub category: String,
    pub priority: String,
    pub emoji: String,
    pub formatted_text: String,
    pub timestamp: String,
    pub metadata: Metadata,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Metadata {
    pub processed_by: String,
    pub version: String,
}

pub struct NotificationFormatter;

impl NotificationFormatter {
    pub fn new() -> Self {
        Self
    }

    pub fn format(&self, notification: Notification) -> Result<FormattedNotification> {
        let category = notification
            .category
            .clone()
            .unwrap_or_else(|| "info".to_string());

        let priority = notification
            .priority
            .clone()
            .unwrap_or_else(|| self.determine_priority(&category));

        let emoji = self.get_emoji(&category, &notification.title);
        let formatted_title = format!("{} {}", emoji, notification.title);
        let formatted_text = self.create_formatted_text(&formatted_title, &notification.message);

        Ok(FormattedNotification {
            title: formatted_title,
            message: notification.message,
            category,
            priority,
            emoji,
            formatted_text,
            timestamp: chrono::Utc::now().to_rfc3339(),
            metadata: Metadata {
                processed_by: "notification-formatter".to_string(),
                version: "1.0.0".to_string(),
            },
        })
    }

    fn determine_priority(&self, category: &str) -> String {
        match category {
            "security" => "high",
            "error" => "high",
            "warning" => "normal",
            "info" => "low",
            "automation" => "low",
            _ => "normal",
        }
        .to_string()
    }

    fn get_emoji(&self, category: &str, title: &str) -> String {
        let title_lower = title.to_lowercase();

        // Spezifische Titel-basierte Emojis
        if title_lower.contains("tür") || title_lower.contains("klingel") {
            return "🚪".to_string();
        }
        if title_lower.contains("bewegung") || title_lower.contains("motion") {
            return "👤".to_string();
        }
        if title_lower.contains("temperatur") || title_lower.contains("temp") {
            return "🌡️".to_string();
        }
        if title_lower.contains("licht") || title_lower.contains("light") {
            return "💡".to_string();
        }
        if title_lower.contains("fenster") {
            return "🪟".to_string();
        }
        if title_lower.contains("alarm") {
            return "🚨".to_string();
        }
        if title_lower.contains("batterie") || title_lower.contains("battery") {
            return "🔋".to_string();
        }

        // Kategorie-basierte Emojis
        match category {
            "info" => "ℹ️",
            "warning" => "⚠️",
            "error" => "❌",
            "security" => "🔒",
            "automation" => "⚙️",
            _ => "🔔",
        }
        .to_string()
    }

    fn create_formatted_text(&self, title: &str, message: &str) -> String {
        format!("**{}**\n\n{}", title, message)
    }
}

impl Default for NotificationFormatter {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_basic() {
        let formatter = NotificationFormatter::new();
        let notification = Notification {
            title: "Test".to_string(),
            message: "Test message".to_string(),
            category: Some("info".to_string()),
            priority: None,
        };

        let result = formatter.format(notification).unwrap();

        assert!(result.title.contains("Test"));
        assert!(result.emoji == "ℹ️");
        assert!(result.category == "info");
    }

    #[test]
    fn test_format_doorbell() {
        let formatter = NotificationFormatter::new();
        let notification = Notification {
            title: "Türklingel".to_string(),
            message: "Jemand an der Tür".to_string(),
            category: Some("security".to_string()),
            priority: None,
        };

        let result = formatter.format(notification).unwrap();

        assert!(result.emoji == "🚪");
        assert!(result.priority == "high");
    }

    #[test]
    fn test_priority_determination() {
        let formatter = NotificationFormatter::new();

        assert_eq!(formatter.determine_priority("security"), "high");
        assert_eq!(formatter.determine_priority("error"), "high");
        assert_eq!(formatter.determine_priority("warning"), "normal");
        assert_eq!(formatter.determine_priority("info"), "low");
    }

    #[test]
    fn test_emoji_selection() {
        let formatter = NotificationFormatter::new();

        assert_eq!(formatter.get_emoji("info", "Test"), "ℹ️");
        assert_eq!(formatter.get_emoji("security", "Alarm"), "🚨");
        assert_eq!(formatter.get_emoji("info", "Türklingel"), "🚪");
        assert_eq!(formatter.get_emoji("info", "Temperatur zu hoch"), "🌡️");
    }
}
