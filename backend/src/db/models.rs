use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct User {
    pub id: String,
    pub username: String,
    pub display_name: Option<String>,
    #[serde(skip_serializing)]  // Never send password hash to client
    pub password_hash: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Device {
    pub id: String,
    pub device_name: String,
    pub device_type: Option<String>,
    pub user_agent: Option<String>,
    pub last_seen: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ConfigurationProfile {
    pub id: String,
    pub name: String,
    pub profile_type: String, // 'user' or 'device'
    pub owner_id: String,
    pub is_default: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Page {
    pub id: String,
    pub profile_id: String,
    pub page_id: String,
    pub name: String,
    pub icon: String,
    pub position: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Widget {
    pub id: String,
    pub page_id: String,
    pub widget_type: String,
    pub entity_id: Option<String>,
    pub position_x: i64,
    pub position_y: i64,
    pub width: i64,
    pub height: i64,
    pub config: Option<String>, // JSON string
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ThemeSettings {
    pub id: String,
    pub profile_id: String,
    pub sleep_mode: bool,
    pub auto_theme: bool,
    pub selected_theme: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct BackgroundConfig {
    pub id: String,
    pub profile_id: String,
    pub background_type: String, // 'static', 'slideshow', 'video', 'gradient'
    pub config: String, // JSON string
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct BackgroundTrigger {
    pub id: String,
    pub profile_id: String,
    pub trigger_type: String, // 'time', 'entity_state', 'event'
    pub trigger_config: String, // JSON string
    pub background_config_id: String,
    pub priority: i64,
    pub is_enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct UserPreference {
    pub id: String,
    pub user_id: String,
    pub device_id: Option<String>,
    pub preference_key: String,
    pub preference_value: String, // JSON string
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SyncMetadata {
    pub id: String,
    pub table_name: String,
    pub record_id: String,
    pub operation: String, // 'INSERT', 'UPDATE', 'DELETE'
    pub changed_at: String,
    pub changed_by_device: Option<String>,
}

// Request/Response DTOs

#[derive(Debug, Deserialize)]
pub struct CreateUserRequest {
    pub username: String,
    pub display_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RegisterDeviceRequest {
    pub device_name: String,
    pub device_type: Option<String>,
    pub user_agent: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateProfileRequest {
    pub name: String,
    pub profile_type: String,
    pub owner_id: String,
}

#[derive(Debug, Deserialize)]
pub struct SavePageRequest {
    pub page_id: String,
    pub name: String,
    pub icon: String,
    pub position: i64,
    pub widgets: Vec<SaveWidgetRequest>,
}

#[derive(Debug, Deserialize)]
pub struct SaveWidgetRequest {
    pub widget_type: String,
    pub entity_id: Option<String>,
    pub position_x: i64,
    pub position_y: i64,
    pub width: i64,
    pub height: i64,
    pub config: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct SaveThemeRequest {
    pub sleep_mode: bool,
    pub auto_theme: bool,
    pub selected_theme: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SaveBackgroundRequest {
    pub background_type: String,
    pub config: serde_json::Value,
}

#[derive(Debug, Deserialize)]
pub struct SavePreferenceRequest {
    pub preference_key: String,
    pub preference_value: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub struct ProfileWithData {
    pub profile: ConfigurationProfile,
    pub pages: Vec<PageWithWidgets>,
    pub theme: Option<ThemeSettings>,
    pub background: Option<BackgroundConfig>,
}

#[derive(Debug, Serialize)]
pub struct PageWithWidgets {
    pub page: Page,
    pub widgets: Vec<Widget>,
}

// Authentication DTOs

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub username: String,
    pub password: String,
    pub display_name: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub token: String,
    pub user: User,
}

