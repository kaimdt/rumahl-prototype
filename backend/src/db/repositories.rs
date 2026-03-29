use super::models::*;
use super::DbPool;
use sqlx::Row;
use uuid::Uuid;

pub struct ConfigRepository {
    pool: DbPool,
}

impl ConfigRepository {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }

    // User operations
    pub async fn create_user(&self, req: CreateUserRequest) -> anyhow::Result<User> {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        let user = sqlx::query_as::<_, User>(
            r#"
            INSERT INTO users (id, username, display_name, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            RETURNING *
            "#,
        )
        .bind(&id)
        .bind(&req.username)
        .bind(&req.display_name)
        .bind(&now)
        .bind(&now)
        .fetch_one(&self.pool)
        .await?;

        Ok(user)
    }

    pub async fn get_user_by_username(&self, username: &str) -> anyhow::Result<Option<User>> {
        let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE username = ?")
            .bind(username)
            .fetch_optional(&self.pool)
            .await?;

        Ok(user)
    }

    pub async fn get_user_by_id(&self, user_id: &str) -> anyhow::Result<Option<User>> {
        let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = ?")
            .bind(user_id)
            .fetch_optional(&self.pool)
            .await?;

        Ok(user)
    }

    pub async fn update_user(&self, user_id: &str, req: UpdateUserRequest) -> anyhow::Result<Option<User>> {
        let existing = match self.get_user_by_id(user_id).await? {
            Some(user) => user,
            None => return Ok(None),
        };

        let target_username = req
            .username
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(&existing.username)
            .to_string();

        if target_username != existing.username {
            if let Some(conflict) = self.get_user_by_username(&target_username).await? {
                if conflict.id != existing.id {
                    anyhow::bail!("USERNAME_CONFLICT");
                }
            }
        }

        let target_display_name = req.display_name.or(existing.display_name);
        let now = chrono::Utc::now().to_rfc3339();

        let updated = sqlx::query_as::<_, User>(
            r#"
            UPDATE users
            SET username = ?, display_name = ?, updated_at = ?
            WHERE id = ?
            RETURNING *
            "#,
        )
        .bind(&target_username)
        .bind(&target_display_name)
        .bind(&now)
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(Some(updated))
    }

    // Device operations
    pub async fn register_device(&self, req: RegisterDeviceRequest) -> anyhow::Result<Device> {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        let device = sqlx::query_as::<_, Device>(
            r#"
            INSERT INTO devices (id, device_name, device_type, user_agent, last_seen, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            RETURNING *
            "#,
        )
        .bind(&id)
        .bind(&req.device_name)
        .bind(&req.device_type)
        .bind(&req.user_agent)
        .bind(&now)
        .bind(&now)
        .fetch_one(&self.pool)
        .await?;

        Ok(device)
    }

    pub async fn get_device(&self, device_id: &str) -> anyhow::Result<Option<Device>> {
        let device = sqlx::query_as::<_, Device>("SELECT * FROM devices WHERE id = ?")
            .bind(device_id)
            .fetch_optional(&self.pool)
            .await?;

        Ok(device)
    }

    pub async fn update_device_last_seen(&self, device_id: &str) -> anyhow::Result<()> {
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query("UPDATE devices SET last_seen = ? WHERE id = ?")
            .bind(&now)
            .bind(device_id)
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    // Configuration Profile operations
    pub async fn create_profile(&self, req: CreateProfileRequest) -> anyhow::Result<ConfigurationProfile> {
        // Reuse the existing default profile for this owner/type instead of creating duplicates.
        if let Some(existing) = self
            .get_profile_by_owner(&req.owner_id, &req.profile_type)
            .await?
        {
            return Ok(existing);
        }

        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        let profile = sqlx::query_as::<_, ConfigurationProfile>(
            r#"
            INSERT INTO configuration_profiles (id, name, profile_type, owner_id, is_default, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, ?, ?)
            RETURNING *
            "#,
        )
        .bind(&id)
        .bind(&req.name)
        .bind(&req.profile_type)
        .bind(&req.owner_id)
        .bind(&now)
        .bind(&now)
        .fetch_one(&self.pool)
        .await?;

        Ok(profile)
    }

    pub async fn get_profile_by_owner(&self, owner_id: &str, profile_type: &str) -> anyhow::Result<Option<ConfigurationProfile>> {
        let profile = sqlx::query_as::<_, ConfigurationProfile>(
            "SELECT * FROM configuration_profiles WHERE owner_id = ? AND profile_type = ? AND is_default = 1 ORDER BY updated_at DESC LIMIT 1"
        )
        .bind(owner_id)
        .bind(profile_type)
        .fetch_optional(&self.pool)
        .await?;

        Ok(profile)
    }

    pub async fn get_profile(&self, profile_id: &str) -> anyhow::Result<Option<ConfigurationProfile>> {
        let profile = sqlx::query_as::<_, ConfigurationProfile>(
            "SELECT * FROM configuration_profiles WHERE id = ?"
        )
        .bind(profile_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(profile)
    }

    // Page operations
    pub async fn save_pages(&self, profile_id: &str, pages: Vec<SavePageRequest>) -> anyhow::Result<()> {
        let mut tx = self.pool.begin().await?;

        // Delete existing pages for this profile
        sqlx::query("DELETE FROM pages WHERE profile_id = ?")
            .bind(profile_id)
            .execute(&mut *tx)
            .await?;

        let now = chrono::Utc::now().to_rfc3339();

        // Insert new pages
        for page_req in pages {
            let page_db_id = Uuid::new_v4().to_string();

            sqlx::query(
                r#"
                INSERT INTO pages (id, profile_id, page_id, name, icon, position, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                "#,
            )
            .bind(&page_db_id)
            .bind(profile_id)
            .bind(&page_req.page_id)
            .bind(&page_req.name)
            .bind(&page_req.icon)
            .bind(page_req.position)
            .bind(&now)
            .bind(&now)
            .execute(&mut *tx)
            .await?;

            // Insert widgets for this page
            for widget_req in page_req.widgets {
                let widget_id = Uuid::new_v4().to_string();
                let config_json = widget_req.config.map(|c| c.to_string());

                sqlx::query(
                    r#"
                    INSERT INTO widgets (id, page_id, widget_type, entity_id, position_x, position_y, width, height, config, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    "#,
                )
                .bind(&widget_id)
                .bind(&page_db_id)
                .bind(&widget_req.widget_type)
                .bind(&widget_req.entity_id)
                .bind(widget_req.position_x)
                .bind(widget_req.position_y)
                .bind(widget_req.width)
                .bind(widget_req.height)
                .bind(config_json)
                .bind(&now)
                .bind(&now)
                .execute(&mut *tx)
                .await?;
            }
        }

        tx.commit().await?;

        Ok(())
    }

    pub async fn get_pages(&self, profile_id: &str) -> anyhow::Result<Vec<PageWithWidgets>> {
        let pages = sqlx::query_as::<_, Page>(
            "SELECT * FROM pages WHERE profile_id = ? ORDER BY position"
        )
        .bind(profile_id)
        .fetch_all(&self.pool)
        .await?;

        let mut result = Vec::new();

        for page in pages {
            let widgets = sqlx::query_as::<_, Widget>(
                "SELECT * FROM widgets WHERE page_id = ? ORDER BY position_y, position_x"
            )
            .bind(&page.id)
            .fetch_all(&self.pool)
            .await?;

            result.push(PageWithWidgets { page, widgets });
        }

        Ok(result)
    }

    // Theme operations
    pub async fn save_theme(&self, profile_id: &str, req: SaveThemeRequest) -> anyhow::Result<ThemeSettings> {
        let now = chrono::Utc::now().to_rfc3339();

        // Try to update existing theme
        let updated = sqlx::query(
            r#"
            UPDATE theme_settings
            SET sleep_mode = ?, auto_theme = ?, selected_theme = ?, updated_at = ?
            WHERE profile_id = ?
            "#,
        )
        .bind(req.sleep_mode)
        .bind(req.auto_theme)
        .bind(&req.selected_theme)
        .bind(&now)
        .bind(profile_id)
        .execute(&self.pool)
        .await?;

        if updated.rows_affected() == 0 {
            // Insert new theme settings
            let id = Uuid::new_v4().to_string();

            let theme = sqlx::query_as::<_, ThemeSettings>(
                r#"
                INSERT INTO theme_settings (id, profile_id, sleep_mode, auto_theme, selected_theme, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                RETURNING *
                "#,
            )
            .bind(&id)
            .bind(profile_id)
            .bind(req.sleep_mode)
            .bind(req.auto_theme)
            .bind(&req.selected_theme)
            .bind(&now)
            .bind(&now)
            .fetch_one(&self.pool)
            .await?;

            return Ok(theme);
        }

        // Fetch the updated theme
        let theme = sqlx::query_as::<_, ThemeSettings>(
            "SELECT * FROM theme_settings WHERE profile_id = ?"
        )
        .bind(profile_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(theme)
    }

    pub async fn get_theme(&self, profile_id: &str) -> anyhow::Result<Option<ThemeSettings>> {
        let theme = sqlx::query_as::<_, ThemeSettings>(
            "SELECT * FROM theme_settings WHERE profile_id = ?"
        )
        .bind(profile_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(theme)
    }

    // Background operations
    pub async fn save_background(&self, profile_id: &str, req: SaveBackgroundRequest) -> anyhow::Result<BackgroundConfig> {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let config_json = req.config.to_string();

        // Deactivate all backgrounds for this profile
        sqlx::query("UPDATE background_configs SET is_active = 0 WHERE profile_id = ?")
            .bind(profile_id)
            .execute(&self.pool)
            .await?;

        // Insert new background config
        let background = sqlx::query_as::<_, BackgroundConfig>(
            r#"
            INSERT INTO background_configs (id, profile_id, background_type, config, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, ?, ?)
            RETURNING *
            "#,
        )
        .bind(&id)
        .bind(profile_id)
        .bind(&req.background_type)
        .bind(&config_json)
        .bind(&now)
        .bind(&now)
        .fetch_one(&self.pool)
        .await?;

        Ok(background)
    }

    pub async fn get_active_background(&self, profile_id: &str) -> anyhow::Result<Option<BackgroundConfig>> {
        let background = sqlx::query_as::<_, BackgroundConfig>(
            "SELECT * FROM background_configs WHERE profile_id = ? AND is_active = 1"
        )
        .bind(profile_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(background)
    }

    // User preferences
    pub async fn save_preference(&self, user_id: &str, device_id: Option<&str>, req: SavePreferenceRequest) -> anyhow::Result<UserPreference> {
        let now = chrono::Utc::now().to_rfc3339();
        let value_json = req.preference_value.to_string();

        // Try to update existing preference
        let updated = sqlx::query(
            r#"
            UPDATE user_preferences
            SET preference_value = ?, updated_at = ?
            WHERE user_id = ? AND device_id IS ? AND preference_key = ?
            "#,
        )
        .bind(&value_json)
        .bind(&now)
        .bind(user_id)
        .bind(device_id)
        .bind(&req.preference_key)
        .execute(&self.pool)
        .await?;

        if updated.rows_affected() == 0 {
            // Insert new preference
            let id = Uuid::new_v4().to_string();

            let pref = sqlx::query_as::<_, UserPreference>(
                r#"
                INSERT INTO user_preferences (id, user_id, device_id, preference_key, preference_value, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                RETURNING *
                "#,
            )
            .bind(&id)
            .bind(user_id)
            .bind(device_id)
            .bind(&req.preference_key)
            .bind(&value_json)
            .bind(&now)
            .bind(&now)
            .fetch_one(&self.pool)
            .await?;

            return Ok(pref);
        }

        // Fetch the updated preference
        let pref = sqlx::query_as::<_, UserPreference>(
            "SELECT * FROM user_preferences WHERE user_id = ? AND device_id IS ? AND preference_key = ?"
        )
        .bind(user_id)
        .bind(device_id)
        .bind(&req.preference_key)
        .fetch_one(&self.pool)
        .await?;

        Ok(pref)
    }

    pub async fn get_preference(&self, user_id: &str, device_id: Option<&str>, key: &str) -> anyhow::Result<Option<UserPreference>> {
        let pref = sqlx::query_as::<_, UserPreference>(
            "SELECT * FROM user_preferences WHERE user_id = ? AND device_id IS ? AND preference_key = ?"
        )
        .bind(user_id)
        .bind(device_id)
        .bind(key)
        .fetch_optional(&self.pool)
        .await?;

        Ok(pref)
    }

    pub async fn get_all_preferences(&self, user_id: &str, device_id: Option<&str>) -> anyhow::Result<Vec<UserPreference>> {
        let prefs = sqlx::query_as::<_, UserPreference>(
            "SELECT * FROM user_preferences WHERE user_id = ? AND device_id IS ?"
        )
        .bind(user_id)
        .bind(device_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(prefs)
    }

    // Global system preferences
    pub async fn save_system_preference(&self, req: SaveSystemPreferenceRequest) -> anyhow::Result<SystemPreference> {
        let now = chrono::Utc::now().to_rfc3339();
        let value_json = req.preference_value.to_string();

        let updated = sqlx::query(
            r#"
            UPDATE system_preferences
            SET preference_value = ?, updated_at = ?
            WHERE preference_key = ?
            "#,
        )
        .bind(&value_json)
        .bind(&now)
        .bind(&req.preference_key)
        .execute(&self.pool)
        .await?;

        if updated.rows_affected() == 0 {
            let id = Uuid::new_v4().to_string();

            let pref = sqlx::query_as::<_, SystemPreference>(
                r#"
                INSERT INTO system_preferences (id, preference_key, preference_value, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                RETURNING *
                "#,
            )
            .bind(&id)
            .bind(&req.preference_key)
            .bind(&value_json)
            .bind(&now)
            .bind(&now)
            .fetch_one(&self.pool)
            .await?;

            return Ok(pref);
        }

        let pref = sqlx::query_as::<_, SystemPreference>(
            "SELECT * FROM system_preferences WHERE preference_key = ?"
        )
        .bind(&req.preference_key)
        .fetch_one(&self.pool)
        .await?;

        Ok(pref)
    }

    pub async fn get_system_preference(&self, key: &str) -> anyhow::Result<Option<SystemPreference>> {
        let pref = sqlx::query_as::<_, SystemPreference>(
            "SELECT * FROM system_preferences WHERE preference_key = ?"
        )
        .bind(key)
        .fetch_optional(&self.pool)
        .await?;

        Ok(pref)
    }

    pub async fn get_all_system_preferences(&self) -> anyhow::Result<Vec<SystemPreference>> {
        let prefs = sqlx::query_as::<_, SystemPreference>(
            "SELECT * FROM system_preferences ORDER BY preference_key"
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(prefs)
    }

    // Get complete profile with all data
    pub async fn get_profile_with_data(&self, profile_id: &str) -> anyhow::Result<Option<ProfileWithData>> {
        let profile = match self.get_profile(profile_id).await? {
            Some(p) => p,
            None => return Ok(None),
        };

        let pages = self.get_pages(profile_id).await?;
        let theme = self.get_theme(profile_id).await?;
        let background = self.get_active_background(profile_id).await?;

        Ok(Some(ProfileWithData {
            profile,
            pages,
            theme,
            background,
        }))
    }

    // Sync operations
    pub async fn record_change(&self, table_name: &str, record_id: &str, operation: &str, device_id: Option<&str>) -> anyhow::Result<()> {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query(
            r#"
            INSERT INTO sync_metadata (id, table_name, record_id, operation, changed_at, changed_by_device)
            VALUES (?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&id)
        .bind(table_name)
        .bind(record_id)
        .bind(operation)
        .bind(&now)
        .bind(device_id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn get_changes_since(&self, since: &str) -> anyhow::Result<Vec<SyncMetadata>> {
        let changes = sqlx::query_as::<_, SyncMetadata>(
            "SELECT * FROM sync_metadata WHERE changed_at > ? ORDER BY changed_at"
        )
        .bind(since)
        .fetch_all(&self.pool)
        .await?;

        Ok(changes)
    }
}
