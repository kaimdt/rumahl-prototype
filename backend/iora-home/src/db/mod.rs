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
        )"
    )
    .execute(pool)
    .await?;

    // Define migrations
    let migrations = vec![
        ("001_initial_schema", include_str!("../../migrations/001_initial_schema.sql")),
        ("002_add_password_hash", include_str!("../../migrations/002_add_password_hash.sql")),
        ("003_entity_history", include_str!("../../migrations/003_entity_history.sql")),
        ("004_system_preferences", include_str!("../../migrations/004_system_preferences.sql")),
        ("005_weather_forecast_cache", include_str!("../../migrations/005_weather_forecast_cache.sql")),
        ("006_page_subpages", include_str!("../../migrations/006_page_subpages.sql")),
        ("007_modal_settings", include_str!("../../migrations/007_modal_settings.sql")),
        ("008_pin_auth_and_page_layouts", include_str!("../../migrations/008_pin_auth_and_page_layouts.sql")),
        ("009_page_settings", include_str!("../../migrations/009_page_settings.sql")),
        ("010_admin_api_keys", include_str!("../../migrations/010_admin_api_keys.sql")),
        ("011_warning_log", include_str!("../../migrations/011_warning_log.sql")),
        ("012_notifications", include_str!("../../migrations/012_notifications.sql")),
        ("013_nina_warning_cache", include_str!("../../migrations/013_nina_warning_cache.sql")),
        ("014_webhooks", include_str!("../../migrations/014_webhooks.sql")),
        ("015_person_tracking", include_str!("../../migrations/015_person_tracking.sql")),
        ("016_automation_rules", include_str!("../../migrations/016_automation_rules.sql")),
        ("017_entity_analytics_snapshots", include_str!("../../migrations/017_entity_analytics_snapshots.sql")),
    ];

    // Apply each migration if not already applied
    for (name, sql) in migrations {
        let result: Option<(i32,)> = sqlx::query_as(
            "SELECT 1 FROM _migrations WHERE name = $1"
        )
        .bind(name)
        .fetch_optional(pool)
        .await?;

        if result.is_none() {
            tracing::info!("Applying migration: {}", name);
            // Split by semicolons and execute each statement individually
            // because prepared statements cannot contain multiple commands
            for statement in sql.split(';') {
                // Strip comment-only lines and whitespace to find actual SQL
                let trimmed: String = statement
                    .lines()
                    .filter(|line| {
                        let t = line.trim();
                        !t.is_empty() && !t.starts_with("--")
                    })
                    .collect::<Vec<_>>()
                    .join("\n");
                if trimmed.is_empty() {
                    continue;
                }
                sqlx::query(&trimmed).execute(pool).await?;
            }
            sqlx::query("INSERT INTO _migrations (name) VALUES ($1)")
                .bind(name)
                .execute(pool)
                .await?;
            tracing::info!("Migration {} applied successfully", name);
        } else {
            tracing::debug!("Migration {} already applied, skipping", name);
        }
    }

    tracing::info!("Database migrations completed successfully");
    Ok(())
}
