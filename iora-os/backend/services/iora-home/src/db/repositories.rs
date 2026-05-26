use super::models::*;
use super::DbPool;
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
        let now = chrono::Utc::now();

        let user = sqlx::query_as::<_, User>(
            r#"
            INSERT INTO users (id, username, display_name, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5)
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
        let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE username = $1")
            .bind(username)
            .fetch_optional(&self.pool)
            .await?;

        Ok(user)
    }

    pub async fn get_user_by_id(&self, user_id: &str) -> anyhow::Result<Option<User>> {
        let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
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
        let now = chrono::Utc::now();

        let updated = sqlx::query_as::<_, User>(
            r#"
            UPDATE users
            SET username = $1, display_name = $2, updated_at = $3
            WHERE id = $4
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
        let now = chrono::Utc::now();

        let device = sqlx::query_as::<_, Device>(
            r#"
            INSERT INTO devices (id, device_name, device_type, user_agent, last_seen, created_at)
            VALUES ($1, $2, $3, $4, $5, $6)
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
        let device = sqlx::query_as::<_, Device>("SELECT * FROM devices WHERE id = $1")
            .bind(device_id)
            .fetch_optional(&self.pool)
            .await?;

        Ok(device)
    }

    pub async fn update_device_last_seen(&self, device_id: &str) -> anyhow::Result<()> {
        let now = chrono::Utc::now();

        sqlx::query("UPDATE devices SET last_seen = $1 WHERE id = $2")
            .bind(&now)
            .bind(device_id)
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    /// List all registered devices ordered by most recently seen first.
    /// Used by the admin "Verbundene Geräte" tab to show every dashboard
    /// client (IORA Desktop, browser tabs, kiosk terminals) that has ever
    /// registered with this backend.
    pub async fn list_devices(&self) -> anyhow::Result<Vec<Device>> {
        let devices = sqlx::query_as::<_, Device>(
            "SELECT * FROM devices ORDER BY last_seen DESC NULLS LAST LIMIT 500",
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(devices)
    }

    /// Delete a registered device. Useful when a kiosk/desktop entry is
    /// retired and the admin wants to drop its profile assignment.
    pub async fn delete_device(&self, device_id: &str) -> anyhow::Result<bool> {
        let res = sqlx::query("DELETE FROM devices WHERE id = $1")
            .bind(device_id)
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected() > 0)
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
        let now = chrono::Utc::now();

        let profile = sqlx::query_as::<_, ConfigurationProfile>(
            r#"
            INSERT INTO configuration_profiles (id, name, profile_type, owner_id, is_default, created_at, updated_at)
            VALUES ($1, $2, $3, $4, TRUE, $5, $6)
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
            "SELECT * FROM configuration_profiles WHERE owner_id = $1 AND profile_type = $2 AND is_default = TRUE ORDER BY updated_at DESC LIMIT 1"
        )
        .bind(owner_id)
        .bind(profile_type)
        .fetch_optional(&self.pool)
        .await?;

        Ok(profile)
    }

    /// List all profiles owned by a user. Used by the frontend to discover an
    /// existing profile for a freshly logged-in user before falling back to
    /// creating a new one.
    pub async fn list_profiles_by_owner(&self, owner_id: &str) -> anyhow::Result<Vec<ConfigurationProfile>> {
        let profiles = sqlx::query_as::<_, ConfigurationProfile>(
            "SELECT * FROM configuration_profiles WHERE owner_id = $1 ORDER BY is_default DESC, updated_at DESC"
        )
        .bind(owner_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(profiles)
    }

    pub async fn get_profile(&self, profile_id: &str) -> anyhow::Result<Option<ConfigurationProfile>> {
        let profile = sqlx::query_as::<_, ConfigurationProfile>(
            "SELECT * FROM configuration_profiles WHERE id = $1"
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
        sqlx::query("DELETE FROM pages WHERE profile_id = $1")
            .bind(profile_id)
            .execute(&mut *tx)
            .await?;

        let now = chrono::Utc::now();

        // Insert new pages
        for page_req in pages {
            let page_db_id = Uuid::new_v4().to_string();

            sqlx::query(
                r#"
                INSERT INTO pages (id, profile_id, page_id, name, icon, position, show_in_nav, display_mode, parent_page_id, modal_settings, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                "#,
            )
            .bind(&page_db_id)
            .bind(profile_id)
            .bind(&page_req.page_id)
            .bind(&page_req.name)
            .bind(&page_req.icon)
            .bind(page_req.position)
            .bind(page_req.show_in_nav.unwrap_or(true))
            .bind(page_req.display_mode.as_deref().unwrap_or("page"))
            .bind(&page_req.parent_page_id)
            .bind(page_req.modal_settings.as_ref().map(|s| s.to_string()))
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
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
            "SELECT * FROM pages WHERE profile_id = $1 ORDER BY position"
        )
        .bind(profile_id)
        .fetch_all(&self.pool)
        .await?;

        let mut result = Vec::new();

        for page in pages {
            let widgets = sqlx::query_as::<_, Widget>(
                "SELECT * FROM widgets WHERE page_id = $1 ORDER BY position_y, position_x"
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
        let now = chrono::Utc::now();

        // Try to update existing theme
        let updated = sqlx::query(
            r#"
            UPDATE theme_settings
            SET sleep_mode = $1, auto_theme = $2, selected_theme = $3, updated_at = $4
            WHERE profile_id = $5
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
                VALUES ($1, $2, $3, $4, $5, $6, $7)
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
            "SELECT * FROM theme_settings WHERE profile_id = $1"
        )
        .bind(profile_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(theme)
    }

    pub async fn get_theme(&self, profile_id: &str) -> anyhow::Result<Option<ThemeSettings>> {
        let theme = sqlx::query_as::<_, ThemeSettings>(
            "SELECT * FROM theme_settings WHERE profile_id = $1"
        )
        .bind(profile_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(theme)
    }

    // Background operations
    pub async fn save_background(&self, profile_id: &str, req: SaveBackgroundRequest) -> anyhow::Result<BackgroundConfig> {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now();
        let config_json = req.config.to_string();

        // Deactivate all backgrounds for this profile
        sqlx::query("UPDATE background_configs SET is_active = FALSE WHERE profile_id = $1")
            .bind(profile_id)
            .execute(&self.pool)
            .await?;

        // Insert new background config
        let background = sqlx::query_as::<_, BackgroundConfig>(
            r#"
            INSERT INTO background_configs (id, profile_id, background_type, config, is_active, created_at, updated_at)
            VALUES ($1, $2, $3, $4, TRUE, $5, $6)
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
            "SELECT * FROM background_configs WHERE profile_id = $1 AND is_active = TRUE"
        )
        .bind(profile_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(background)
    }

    // User preferences
    pub async fn save_preference(&self, user_id: &str, device_id: Option<&str>, req: SavePreferenceRequest) -> anyhow::Result<UserPreference> {
        let now = chrono::Utc::now();
        let value_json = req.preference_value.to_string();

        // Try to update existing preference
        let updated = sqlx::query(
            r#"
            UPDATE user_preferences
            SET preference_value = $1, updated_at = $2
            WHERE user_id = $3 AND device_id IS NOT DISTINCT FROM $4 AND preference_key = $5
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
                VALUES ($1, $2, $3, $4, $5, $6, $7)
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
            "SELECT * FROM user_preferences WHERE user_id = $1 AND device_id IS NOT DISTINCT FROM $2 AND preference_key = $3"
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
            "SELECT * FROM user_preferences WHERE user_id = $1 AND device_id IS NOT DISTINCT FROM $2 AND preference_key = $3"
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
            "SELECT * FROM user_preferences WHERE user_id = $1 AND device_id IS NOT DISTINCT FROM $2"
        )
        .bind(user_id)
        .bind(device_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(prefs)
    }

    // Global system preferences
    pub async fn save_system_preference(&self, req: SaveSystemPreferenceRequest) -> anyhow::Result<SystemPreference> {
        let now = chrono::Utc::now();
        let value_json = req.preference_value.to_string();

        let updated = sqlx::query(
            r#"
            UPDATE system_preferences
            SET preference_value = $1, updated_at = $2
            WHERE preference_key = $3
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
                VALUES ($1, $2, $3, $4, $5)
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
            "SELECT * FROM system_preferences WHERE preference_key = $1"
        )
        .bind(&req.preference_key)
        .fetch_one(&self.pool)
        .await?;

        Ok(pref)
    }

    pub async fn get_system_preference(&self, key: &str) -> anyhow::Result<Option<SystemPreference>> {
        let pref = sqlx::query_as::<_, SystemPreference>(
            "SELECT * FROM system_preferences WHERE preference_key = $1"
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
        let now = chrono::Utc::now();

        sqlx::query(
            r#"
            INSERT INTO sync_metadata (id, table_name, record_id, operation, changed_at, changed_by_device)
            VALUES ($1, $2, $3, $4, $5, $6)
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
            "SELECT * FROM sync_metadata WHERE changed_at > $1 ORDER BY changed_at"
        )
        .bind(since)
        .fetch_all(&self.pool)
        .await?;

        Ok(changes)
    }

    // ── User listing for terminal/kiosk mode ───────────────────────────
    pub async fn list_users(&self) -> anyhow::Result<Vec<User>> {
        let users = sqlx::query_as::<_, User>(
            "SELECT * FROM users ORDER BY username"
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(users)
    }

    pub async fn set_user_pin(&self, user_id: &str, pin_hash: &str) -> anyhow::Result<()> {
        let now = chrono::Utc::now();
        sqlx::query("UPDATE users SET pin_hash = $1, updated_at = $2 WHERE id = $3")
            .bind(pin_hash)
            .bind(&now)
            .bind(user_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn remove_user_pin(&self, user_id: &str) -> anyhow::Result<()> {
        let now = chrono::Utc::now();
        sqlx::query("UPDATE users SET pin_hash = NULL, updated_at = $1 WHERE id = $2")
            .bind(&now)
            .bind(user_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn set_user_avatar(&self, user_id: &str, avatar_url: &str) -> anyhow::Result<()> {
        let now = chrono::Utc::now();
        sqlx::query("UPDATE users SET avatar_url = $1, updated_at = $2 WHERE id = $3")
            .bind(avatar_url)
            .bind(&now)
            .bind(user_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    // ── Terminal/kiosk device management ────────────────────────────────
    pub async fn set_terminal_mode(&self, device_id: &str, is_terminal: bool, terminal_name: Option<&str>) -> anyhow::Result<()> {
        sqlx::query("UPDATE devices SET is_terminal = $1, terminal_name = $2 WHERE id = $3")
            .bind(is_terminal)
            .bind(terminal_name)
            .bind(device_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    // ── Page layout persistence ────────────────────────────────────────
    pub async fn save_page_layout(&self, profile_id: &str, req: SavePageLayoutRequest) -> anyhow::Result<PageLayout> {
        let now = chrono::Utc::now();

        let updated = sqlx::query(
            "UPDATE page_layouts SET cols = $1, rows = $2, gap = $3, updated_at = $4 WHERE profile_id = $5 AND page_id = $6"
        )
        .bind(req.cols)
        .bind(req.rows)
        .bind(req.gap)
        .bind(&now)
        .bind(profile_id)
        .bind(&req.page_id)
        .execute(&self.pool)
        .await?;

        if updated.rows_affected() == 0 {
            let id = Uuid::new_v4().to_string();
            sqlx::query(
                "INSERT INTO page_layouts (id, profile_id, page_id, cols, rows, gap, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)"
            )
            .bind(&id)
            .bind(profile_id)
            .bind(&req.page_id)
            .bind(req.cols)
            .bind(req.rows)
            .bind(req.gap)
            .bind(&now)
            .bind(&now)
            .execute(&self.pool)
            .await?;
        }

        let layout = sqlx::query_as::<_, PageLayout>(
            "SELECT * FROM page_layouts WHERE profile_id = $1 AND page_id = $2"
        )
        .bind(profile_id)
        .bind(&req.page_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(layout)
    }

    pub async fn get_page_layout(&self, profile_id: &str, page_id: &str) -> anyhow::Result<Option<PageLayout>> {
        let layout = sqlx::query_as::<_, PageLayout>(
            "SELECT * FROM page_layouts WHERE profile_id = $1 AND page_id = $2"
        )
        .bind(profile_id)
        .bind(page_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(layout)
    }

    pub async fn get_all_page_layouts(&self, profile_id: &str) -> anyhow::Result<Vec<PageLayout>> {
        let layouts = sqlx::query_as::<_, PageLayout>(
            "SELECT * FROM page_layouts WHERE profile_id = $1 ORDER BY page_id"
        )
        .bind(profile_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(layouts)
    }

    // ── Per-page settings ──────────────────────────────────────────────

    pub async fn save_page_settings(&self, profile_id: &str, req: &SavePageSettingsRequest) -> anyhow::Result<PageSettings> {
        let now = chrono::Utc::now();
        let bg_config_json = req.background_config.as_ref().map(|v| v.to_string());

        let existing = sqlx::query_as::<_, PageSettings>(
            "SELECT * FROM page_settings WHERE profile_id = $1 AND page_id = $2"
        )
        .bind(profile_id)
        .bind(&req.page_id)
        .fetch_optional(&self.pool)
        .await?;

        if let Some(ex) = existing {
            sqlx::query(
                "UPDATE page_settings SET card_style = $1, background_type = $2, background_config = $3, custom_css = $4, hide_header = $5, padding = $6, updated_at = $7 WHERE id = $8"
            )
            .bind(req.card_style.as_deref().or(ex.card_style.as_deref()))
            .bind(req.background_type.as_deref().or(ex.background_type.as_deref()))
            .bind(bg_config_json.as_deref().or(ex.background_config.as_deref()))
            .bind(req.custom_css.as_deref().or(ex.custom_css.as_deref()))
            .bind(req.hide_header.unwrap_or(ex.hide_header))
            .bind(req.padding.or(ex.padding))
            .bind(&now)
            .bind(&ex.id)
            .execute(&self.pool)
            .await?;
        } else {
            let id = uuid::Uuid::new_v4().to_string();
            sqlx::query(
                "INSERT INTO page_settings (id, profile_id, page_id, card_style, background_type, background_config, custom_css, hide_header, padding, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)"
            )
            .bind(&id)
            .bind(profile_id)
            .bind(&req.page_id)
            .bind(&req.card_style)
            .bind(&req.background_type)
            .bind(&bg_config_json)
            .bind(&req.custom_css)
            .bind(req.hide_header.unwrap_or(false))
            .bind(req.padding.unwrap_or(16))
            .bind(&now)
            .bind(&now)
            .execute(&self.pool)
            .await?;
        }

        let settings = sqlx::query_as::<_, PageSettings>(
            "SELECT * FROM page_settings WHERE profile_id = $1 AND page_id = $2"
        )
        .bind(profile_id)
        .bind(&req.page_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(settings)
    }

    pub async fn get_page_settings(&self, profile_id: &str, page_id: &str) -> anyhow::Result<Option<PageSettings>> {
        let settings = sqlx::query_as::<_, PageSettings>(
            "SELECT * FROM page_settings WHERE profile_id = $1 AND page_id = $2"
        )
        .bind(profile_id)
        .bind(page_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(settings)
    }

    pub async fn get_all_page_settings(&self, profile_id: &str) -> anyhow::Result<Vec<PageSettings>> {
        let settings = sqlx::query_as::<_, PageSettings>(
            "SELECT * FROM page_settings WHERE profile_id = $1 ORDER BY page_id"
        )
        .bind(profile_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(settings)
    }

    pub async fn delete_page_settings(&self, profile_id: &str, page_id: &str) -> anyhow::Result<()> {
        sqlx::query("DELETE FROM page_settings WHERE profile_id = $1 AND page_id = $2")
            .bind(profile_id)
            .bind(page_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    // ── Admin & API Key operations ─────────────────────────────────────

    pub async fn count_users(&self) -> anyhow::Result<i64> {
        let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users")
            .fetch_one(&self.pool)
            .await?;
        Ok(count)
    }

    pub async fn set_user_admin(&self, user_id: &str, is_admin: bool) -> anyhow::Result<()> {
        let now = chrono::Utc::now();
        sqlx::query("UPDATE users SET is_admin = $1, updated_at = $2 WHERE id = $3")
            .bind(is_admin)
            .bind(&now)
            .bind(user_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn set_user_role(&self, user_id: &str, role: &str) -> anyhow::Result<()> {
        let now = chrono::Utc::now();
        sqlx::query("UPDATE users SET role = $1, updated_at = $2 WHERE id = $3")
            .bind(role)
            .bind(&now)
            .bind(user_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn set_user_password(&self, user_id: &str, password_hash: &str) -> anyhow::Result<()> {
        let now = chrono::Utc::now();
        sqlx::query("UPDATE users SET password_hash = $1, updated_at = $2 WHERE id = $3")
            .bind(password_hash)
            .bind(&now)
            .bind(user_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn delete_user(&self, user_id: &str) -> anyhow::Result<()> {
        sqlx::query("DELETE FROM users WHERE id = $1")
            .bind(user_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Ensure at least one admin exists. If no admin found, promote the oldest user.
    pub async fn ensure_admin_exists(&self) -> anyhow::Result<Option<String>> {
        let admin: Option<(String,)> = sqlx::query_as(
            "SELECT id FROM users WHERE is_admin = TRUE LIMIT 1"
        )
        .fetch_optional(&self.pool)
        .await?;

        if admin.is_some() {
            return Ok(None);
        }

        // No admin found – promote oldest user
        let oldest: Option<(String, String)> = sqlx::query_as(
            "SELECT id, username FROM users ORDER BY created_at ASC LIMIT 1"
        )
        .fetch_optional(&self.pool)
        .await?;

        if let Some((user_id, username)) = oldest {
            self.set_user_admin(&user_id, true).await?;
            Ok(Some(username))
        } else {
            Ok(None)
        }
    }

    pub async fn list_all_users_admin(&self) -> anyhow::Result<Vec<User>> {
        let users = sqlx::query_as::<_, User>("SELECT * FROM users ORDER BY created_at ASC")
            .fetch_all(&self.pool)
            .await?;
        Ok(users)
    }

    // API Key CRUD
    pub async fn create_api_key(&self, user_id: &str, name: &str, key_hash: &str, key_prefix: &str, permissions: &str, rate_limit: i32, expires_at: Option<chrono::DateTime<chrono::Utc>>) -> anyhow::Result<ApiKey> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now();

        sqlx::query(
            "INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, permissions, rate_limit, expires_at, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)"
        )
        .bind(&id)
        .bind(user_id)
        .bind(name)
        .bind(key_hash)
        .bind(key_prefix)
        .bind(permissions)
        .bind(rate_limit)
        .bind(expires_at)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await?;

        let key = sqlx::query_as::<_, ApiKey>("SELECT * FROM api_keys WHERE id = $1")
            .bind(&id)
            .fetch_one(&self.pool)
            .await?;
        Ok(key)
    }

    pub async fn list_api_keys(&self, user_id: &str) -> anyhow::Result<Vec<ApiKey>> {
        let keys = sqlx::query_as::<_, ApiKey>(
            "SELECT * FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC"
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(keys)
    }

    pub async fn list_all_api_keys(&self) -> anyhow::Result<Vec<ApiKey>> {
        let keys = sqlx::query_as::<_, ApiKey>(
            "SELECT * FROM api_keys ORDER BY created_at DESC"
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(keys)
    }

    pub async fn get_api_key_by_prefix(&self, prefix: &str) -> anyhow::Result<Option<ApiKey>> {
        let key = sqlx::query_as::<_, ApiKey>(
            "SELECT * FROM api_keys WHERE key_prefix = $1 AND is_active = TRUE"
        )
        .bind(prefix)
        .fetch_optional(&self.pool)
        .await?;
        Ok(key)
    }

    pub async fn update_api_key_last_used(&self, key_id: &str) -> anyhow::Result<()> {
        let now = chrono::Utc::now();
        sqlx::query("UPDATE api_keys SET last_used_at = $1 WHERE id = $2")
            .bind(&now)
            .bind(key_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn update_api_key(&self, key_id: &str, req: &UpdateApiKeyRequest) -> anyhow::Result<Option<ApiKey>> {
        let existing = sqlx::query_as::<_, ApiKey>("SELECT * FROM api_keys WHERE id = $1")
            .bind(key_id)
            .fetch_optional(&self.pool)
            .await?;

        let existing = match existing {
            Some(k) => k,
            None => return Ok(None),
        };

        let now = chrono::Utc::now();
        let name = req.name.as_deref().unwrap_or(&existing.name);
        let permissions = req.permissions.as_ref()
            .map(|p| serde_json::to_string(p).unwrap_or_else(|_| existing.permissions.clone()))
            .unwrap_or(existing.permissions.clone());
        let rate_limit = req.rate_limit.unwrap_or(existing.rate_limit);
        let is_active = req.is_active.unwrap_or(existing.is_active);

        sqlx::query(
            "UPDATE api_keys SET name = $1, permissions = $2, rate_limit = $3, is_active = $4, updated_at = $5 WHERE id = $6"
        )
        .bind(name)
        .bind(&permissions)
        .bind(rate_limit)
        .bind(is_active)
        .bind(&now)
        .bind(key_id)
        .execute(&self.pool)
        .await?;

        let key = sqlx::query_as::<_, ApiKey>("SELECT * FROM api_keys WHERE id = $1")
            .bind(key_id)
            .fetch_one(&self.pool)
            .await?;
        Ok(Some(key))
    }

    pub async fn delete_api_key(&self, key_id: &str) -> anyhow::Result<bool> {
        let result = sqlx::query("DELETE FROM api_keys WHERE id = $1")
            .bind(key_id)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn check_rate_limit(&self, key_id: &str, limit: i32) -> anyhow::Result<bool> {
        let window = chrono::Utc::now().format("%Y-%m-%dT%H:%M").to_string();

        // Try to increment or insert
        let row: Option<(i32,)> = sqlx::query_as(
            "SELECT request_count FROM api_key_rate_limits WHERE key_id = $1 AND window_start = $2"
        )
        .bind(key_id)
        .bind(&window)
        .fetch_optional(&self.pool)
        .await?;

        match row {
            Some((count,)) => {
                if count >= limit {
                    return Ok(false); // Rate limited
                }
                sqlx::query(
                    "UPDATE api_key_rate_limits SET request_count = request_count + 1 WHERE key_id = $1 AND window_start = $2"
                )
                .bind(key_id)
                .bind(&window)
                .execute(&self.pool)
                .await?;
            }
            None => {
                // Clean old windows and insert new
                sqlx::query("DELETE FROM api_key_rate_limits WHERE key_id = $1 AND window_start < $2")
                    .bind(key_id)
                    .bind(&window)
                    .execute(&self.pool)
                    .await?;
                sqlx::query(
                    "INSERT INTO api_key_rate_limits (key_id, window_start, request_count) VALUES ($1, $2, 1)"
                )
                .bind(key_id)
                .bind(&window)
                .execute(&self.pool)
                .await?;
            }
        }

        Ok(true) // Within limit
    }
}
