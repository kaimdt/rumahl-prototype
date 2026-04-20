//! Notification Validator
//!
//! Validiert Benachrichtigungen auf Vollständigkeit und Korrektheit.

use serde::{Deserialize, Serialize};
use anyhow::Result;

use super::Notification;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationResult {
    pub valid: bool,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

pub struct NotificationValidator;

impl NotificationValidator {
    pub fn new() -> Self {
        Self
    }

    pub fn validate(&self, notification: &Notification) -> Result<ValidationResult> {
        let mut errors = Vec::new();
        let mut warnings = Vec::new();

        // Validiere Titel
        if notification.title.trim().is_empty() {
            errors.push("Titel darf nicht leer sein".to_string());
        } else if notification.title.len() > 100 {
            warnings.push("Titel ist sehr lang (>100 Zeichen)".to_string());
        }

        // Validiere Nachricht
        if notification.message.trim().is_empty() {
            errors.push("Nachricht darf nicht leer sein".to_string());
        } else if notification.message.len() > 1000 {
            warnings.push("Nachricht ist sehr lang (>1000 Zeichen)".to_string());
        }

        // Validiere Kategorie (optional)
        if let Some(ref category) = notification.category {
            let valid_categories = vec!["info", "warning", "error", "security", "automation"];
            if !valid_categories.contains(&category.as_str()) {
                warnings.push(format!(
                    "Unbekannte Kategorie '{}'. Gültig: {}",
                    category,
                    valid_categories.join(", ")
                ));
            }
        } else {
            warnings.push("Kategorie fehlt - empfohlen für bessere Formatierung".to_string());
        }

        // Validiere Priorität (optional)
        if let Some(ref priority) = notification.priority {
            let valid_priorities = vec!["low", "normal", "high", "urgent"];
            if !valid_priorities.contains(&priority.as_str()) {
                warnings.push(format!(
                    "Unbekannte Priorität '{}'. Gültig: {}",
                    priority,
                    valid_priorities.join(", ")
                ));
            }
        }

        let valid = errors.is_empty();

        Ok(ValidationResult {
            valid,
            errors,
            warnings,
        })
    }
}

impl Default for NotificationValidator {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_notification() {
        let validator = NotificationValidator::new();
        let notification = Notification {
            title: "Test".to_string(),
            message: "Test message".to_string(),
            category: Some("info".to_string()),
            priority: None,
        };

        let result = validator.validate(&notification).unwrap();

        assert!(result.valid);
        assert!(result.errors.is_empty());
    }

    #[test]
    fn test_empty_title() {
        let validator = NotificationValidator::new();
        let notification = Notification {
            title: "".to_string(),
            message: "Test message".to_string(),
            category: None,
            priority: None,
        };

        let result = validator.validate(&notification).unwrap();

        assert!(!result.valid);
        assert!(!result.errors.is_empty());
        assert!(result.errors[0].contains("Titel"));
    }

    #[test]
    fn test_empty_message() {
        let validator = NotificationValidator::new();
        let notification = Notification {
            title: "Test".to_string(),
            message: "".to_string(),
            category: None,
            priority: None,
        };

        let result = validator.validate(&notification).unwrap();

        assert!(!result.valid);
        assert!(result.errors.iter().any(|e| e.contains("Nachricht")));
    }

    #[test]
    fn test_invalid_category() {
        let validator = NotificationValidator::new();
        let notification = Notification {
            title: "Test".to_string(),
            message: "Test message".to_string(),
            category: Some("invalid".to_string()),
            priority: None,
        };

        let result = validator.validate(&notification).unwrap();

        assert!(result.valid); // Immer noch valide, nur Warnung
        assert!(!result.warnings.is_empty());
    }

    #[test]
    fn test_long_title() {
        let validator = NotificationValidator::new();
        let notification = Notification {
            title: "A".repeat(150),
            message: "Test".to_string(),
            category: None,
            priority: None,
        };

        let result = validator.validate(&notification).unwrap();

        assert!(result.valid);
        assert!(!result.warnings.is_empty());
    }
}
