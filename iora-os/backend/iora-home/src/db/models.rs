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
    #[serde(skip_serializing)]  // Never send pin hash to client
    pub pin_hash: Option<String>,
    pub avatar_url: Option<String>,
    pub role: String,
    pub is_admin: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Device {
    pub id: String,
    pub device_name: String,
    pub device_type: Option<String>,
    pub user_agent: Option<String>,
    pub is_terminal: bool,
    pub terminal_name: Option<String>,
    pub assigned_profile_id: Option<String>,
    pub last_seen: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ConfigurationProfile {
    pub id: String,
    pub name: String,
    pub profile_type: String, // 'user' or 'device'
    pub owner_id: String,
    pub is_default: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Page {
    pub id: String,
    pub profile_id: String,
    pub page_id: String,
    pub name: String,
    pub icon: String,
    pub position: i32,
    pub show_in_nav: bool,
    pub display_mode: String,
    pub parent_page_id: Option<String>,
    pub modal_settings: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Widget {
    pub id: String,
    pub page_id: String,
    pub widget_type: String,
    pub entity_id: Option<String>,
    pub position_x: i32,
    pub position_y: i32,
    pub width: i32,
    pub height: i32,
    pub config: Option<String>, // JSON string
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ThemeSettings {
    pub id: String,
    pub profile_id: String,
    pub sleep_mode: bool,
    pub auto_theme: bool,
    pub selected_theme: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct BackgroundConfig {
    pub id: String,
    pub profile_id: String,
    pub background_type: String, // 'static', 'slideshow', 'video', 'gradient'
    pub config: String, // JSON string
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct BackgroundTrigger {
    pub id: String,
    pub profile_id: String,
    pub trigger_type: String, // 'time', 'entity_state', 'event'
    pub trigger_config: String, // JSON string
    pub background_config_id: String,
    pub priority: i32,
    pub is_enabled: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct UserPreference {
    pub id: String,
    pub user_id: String,
    pub device_id: Option<String>,
    pub preference_key: String,
    pub preference_value: String, // JSON string
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SystemPreference {
    pub id: String,
    pub preference_key: String,
    pub preference_value: String, // JSON string
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SyncMetadata {
    pub id: String,
    pub table_name: String,
    pub record_id: String,
    pub operation: String, // 'INSERT', 'UPDATE', 'DELETE'
    pub changed_at: DateTime<Utc>,
    pub changed_by_device: Option<String>,
}

// Request/Response DTOs

#[derive(Debug, Deserialize)]
pub struct CreateUserRequest {
    pub username: String,
    pub display_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateUserRequest {
    pub username: Option<String>,
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
    pub position: i32,
    pub widgets: Vec<SaveWidgetRequest>,
    pub show_in_nav: Option<bool>,
    pub display_mode: Option<String>,
    pub parent_page_id: Option<String>,
    pub modal_settings: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct SaveWidgetRequest {
    pub widget_type: String,
    pub entity_id: Option<String>,
    pub position_x: i32,
    pub position_y: i32,
    pub width: i32,
    pub height: i32,
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

#[derive(Debug, Deserialize)]
pub struct SaveSystemPreferenceRequest {
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
    pub remember_me: Option<bool>,
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

// PIN authentication
#[derive(Debug, Deserialize)]
pub struct PinLoginRequest {
    pub user_id: String,
    pub pin: String,
}

#[derive(Debug, Deserialize)]
pub struct SetPinRequest {
    pub pin: String,
}

// User listing for terminal/kiosk quick-switch
#[derive(Debug, Serialize)]
pub struct UserListEntry {
    pub id: String,
    pub username: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub has_pin: bool,
}

// Page layout persistence
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct PageLayout {
    pub id: String,
    pub profile_id: String,
    pub page_id: String,
    pub cols: i32,
    pub rows: i32,
    pub gap: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct SavePageLayoutRequest {
    pub page_id: String,
    pub cols: i32,
    pub rows: i32,
    pub gap: i32,
}

// Terminal/kiosk device settings
#[derive(Debug, Deserialize)]
pub struct SetTerminalModeRequest {
    pub is_terminal: bool,
    pub terminal_name: Option<String>,
}

// Per-page settings
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct PageSettings {
    pub id: String,
    pub profile_id: String,
    pub page_id: String,
    pub card_style: Option<String>,
    pub background_type: Option<String>,
    pub background_config: Option<String>,
    pub custom_css: Option<String>,
    pub hide_header: bool,
    pub padding: Option<i32>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct SavePageSettingsRequest {
    pub page_id: String,
    pub card_style: Option<String>,
    pub background_type: Option<String>,
    pub background_config: Option<serde_json::Value>,
    pub custom_css: Option<String>,
    pub hide_header: Option<bool>,
    pub padding: Option<i32>,
}

// API Key models
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ApiKey {
    pub id: String,
    pub user_id: String,
    pub name: String,
    #[serde(skip_serializing)]
    pub key_hash: String,
    pub key_prefix: String,
    pub permissions: String,  // JSON array
    pub rate_limit: i32,
    pub last_used_at: Option<DateTime<Utc>>,
    pub expires_at: Option<DateTime<Utc>>,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct ApiKeyWithSecret {
    pub id: String,
    pub name: String,
    pub key: String,  // Only returned on creation
    pub key_prefix: String,
    pub permissions: Vec<String>,
    pub rate_limit: i32,
    pub expires_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateApiKeyRequest {
    pub name: String,
    pub permissions: Option<Vec<String>>,
    pub rate_limit: Option<i32>,
    pub expires_in_days: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateApiKeyRequest {
    pub name: Option<String>,
    pub permissions: Option<Vec<String>>,
    pub rate_limit: Option<i32>,
    pub is_active: Option<bool>,
}

// Admin DTOs
#[derive(Debug, Deserialize)]
pub struct SetAdminRequest {
    pub is_admin: bool,
}

#[derive(Debug, Serialize)]
pub struct AdminUserEntry {
    pub id: String,
    pub username: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub role: String,
    pub is_admin: bool,
    pub has_password: bool,
    pub has_pin: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
