use sqlx::{postgres::PgPool, Pool, Postgres};

pub mod models;
pub mod repositories;

pub type DbPool = Pool<Postgres>;

/// Initialize the database connection pool and run migrations
pub async fn init_db(database_url: &str) -> anyhow::Result<DbPool> {
    let pool = PgPool::connect(database_url).await?;

    // Run migrations
    run_migrations(&pool).await?;

    Ok(pool)
}

/// Run database migrations
async fn run_migrations(pool: &DbPool) -> anyhow::Result<()> {
    // Create migrations tracking table if it doesn't exist
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS _migrations (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )",
    )
    .execute(pool)
    .await?;

    // Define migrations
    let migrations = vec![
        (
            "001_initial_schema",
            include_str!("../../migrations/001_initial_schema.sql"),
        ),
        (
            "002_add_password_hash",
            include_str!("../../migrations/002_add_password_hash.sql"),
        ),
        (
            "003_entity_history",
            include_str!("../../migrations/003_entity_history.sql"),
        ),
        (
            "004_system_preferences",
            include_str!("../../migrations/004_system_preferences.sql"),
        ),
        (
            "005_weather_forecast_cache",
            include_str!("../../migrations/005_weather_forecast_cache.sql"),
        ),
        (
            "006_page_subpages",
            include_str!("../../migrations/006_page_subpages.sql"),
        ),
        (
            "007_modal_settings",
            include_str!("../../migrations/007_modal_settings.sql"),
        ),
        (
            "008_pin_auth_and_page_layouts",
            include_str!("../../migrations/008_pin_auth_and_page_layouts.sql"),
        ),
        (
            "009_page_settings",
            include_str!("../../migrations/009_page_settings.sql"),
        ),
        (
            "010_admin_api_keys",
            include_str!("../../migrations/010_admin_api_keys.sql"),
        ),
        (
            "011_warning_log",
            include_str!("../../migrations/011_warning_log.sql"),
        ),
        (
            "012_notifications",
            include_str!("../../migrations/012_notifications.sql"),
        ),
        (
            "013_nina_warning_cache",
            include_str!("../../migrations/013_nina_warning_cache.sql"),
        ),
        (
            "014_webhooks",
            include_str!("../../migrations/014_webhooks.sql"),
        ),
        (
            "015_person_tracking",
            include_str!("../../migrations/015_person_tracking.sql"),
        ),
        (
            "016_automation_rules",
            include_str!("../../migrations/016_automation_rules.sql"),
        ),
        (
            "017_entity_analytics_snapshots",
            include_str!("../../migrations/017_entity_analytics_snapshots.sql"),
        ),
        (
            "018_location_sync_system",
            include_str!("../../migrations/018_location_sync_system.sql"),
        ),
        (
            "019_temp_db_users",
            include_str!("../../migrations/019_temp_db_users.sql"),
        ),
        (
            "020_notification_channels",
            include_str!("../../migrations/020_notification_channels.sql"),
        ),
        (
            "021_desktop_commands",
            include_str!("../../migrations/021_desktop_commands.sql"),
        ),
        (
            "022_app_extended_capabilities",
            include_str!("../../migrations/022_app_extended_capabilities.sql"),
        ),
        (
            "023_core_registrations_and_updates",
            include_str!("../../migrations/023_core_registrations_and_updates.sql"),
        ),
        (
            "024_home_state",
            include_str!("../../migrations/024_home_state.sql"),
        ),
        (
            "025_desktop_clients",
            include_str!("../../migrations/025_desktop_clients.sql"),
        ),
        (
            "026_themes",
            include_str!("../../migrations/026_themes.sql"),
        ),
        (
            "027_theme_capabilities",
            include_str!("../../migrations/027_theme_capabilities.sql"),
        ),
        (
            "028_theme_widget_templates",
            include_str!("../../migrations/028_theme_widget_templates.sql"),
        ),
        (
            "029_theme_performance_indexes",
            include_str!("../../migrations/029_theme_performance_indexes.sql"),
        ),
        (
            "030_hot_path_indexes",
            include_str!("../../migrations/030_hot_path_indexes.sql"),
        ),
        (
            "031_system_events",
            include_str!("../../migrations/031_system_events.sql"),
        ),
        (
            "032_refresh_tokens",
            include_str!("../../migrations/032_refresh_tokens.sql"),
        ),
        (
            "033_user_os_permissions",
            include_str!("../../migrations/033_user_os_permissions.sql"),
        ),
        (
            "034_automation_flows",
            include_str!("../../migrations/034_automation_flows.sql"),
        ),
        (
            "035_automation_flow_edges",
            include_str!("../../migrations/035_automation_flow_edges.sql"),
        ),
    ];

    // Apply each migration if not already applied
    for (name, sql) in migrations {
        let result: Option<(i32,)> = sqlx::query_as("SELECT 1 FROM _migrations WHERE name = $1")
            .bind(name)
            .fetch_optional(pool)
            .await?;

        if result.is_none() {
            tracing::info!("Applying migration: {}", name);

            // Wrap the entire migration in a transaction so that a failure in
            // any single statement rolls back the whole migration. This avoids
            // "already exists" / FK errors on retry after a partial failure.
            let mut tx = pool.begin().await.map_err(|e| {
                tracing::error!("Failed to begin transaction for migration {}: {}", name, e);
                e
            })?;

            // Strip `--` line comments BEFORE splitting on `;`, otherwise a
            // semicolon inside a comment (e.g. "handlers; the iora-updater")
            // breaks the split and produces invalid SQL fragments.
            let mut cleaned = String::with_capacity(sql.len());
            for line in sql.lines() {
                // Find an unquoted "--" and trim from there. We do not need
                // to support escaped/quoted "--" because none of our
                // migration files use string literals containing it.
                let mut in_squote = false;
                let mut in_dquote = false;
                let mut idx = line.len();
                let bytes = line.as_bytes();
                let mut i = 0;
                while i < bytes.len() {
                    let c = bytes[i] as char;
                    match c {
                        '\'' if !in_dquote => in_squote = !in_squote,
                        '"' if !in_squote => in_dquote = !in_dquote,
                        '-' if !in_squote
                            && !in_dquote
                            && i + 1 < bytes.len()
                            && bytes[i + 1] == b'-' =>
                        {
                            idx = i;
                            break;
                        }
                        _ => {}
                    }
                    i += 1;
                }
                cleaned.push_str(line[..idx].trim_end());
                cleaned.push('\n');
            }

            // Split by semicolons and execute each statement individually
            // because prepared statements cannot contain multiple commands.
            for statement in cleaned.split(';') {
                let trimmed = statement.trim();
                if trimmed.is_empty() {
                    continue;
                }
                sqlx::query(trimmed).execute(&mut *tx).await.map_err(|e| {
                    tracing::error!(
                        "Migration {} failed on statement (rolling back): {}",
                        name,
                        e
                    );
                    e
                })?;
            }

            // Record migration as applied INSIDE the same transaction.
            sqlx::query("INSERT INTO _migrations (name) VALUES ($1)")
                .bind(name)
                .execute(&mut *tx)
                .await?;

            tx.commit().await.map_err(|e| {
                tracing::error!("Failed to commit migration {}: {}", name, e);
                e
            })?;

            tracing::info!("Migration {} applied successfully", name);
        } else {
            tracing::debug!("Migration {} already applied, skipping", name);
        }
    }

    tracing::info!("Database migrations completed successfully");
    Ok(())
}
