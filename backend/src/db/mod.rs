use sqlx::{sqlite::SqlitePool, Pool, Sqlite};
use std::path::Path;

pub mod models;
pub mod repositories;

pub type DbPool = Pool<Sqlite>;

/// Initialize the database connection pool and run migrations
pub async fn init_db(database_url: &str) -> anyhow::Result<DbPool> {
    // Create database file if it doesn't exist
    if database_url.starts_with("sqlite:") {
        let db_path = database_url.strip_prefix("sqlite:").unwrap();
        if let Some(parent) = Path::new(db_path).parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
    }

    // Create connection pool
    let pool = SqlitePool::connect(database_url).await?;

    // Enable WAL mode for better concurrent read/write performance
    sqlx::query("PRAGMA journal_mode=WAL")
        .execute(&pool)
        .await?;
    sqlx::query("PRAGMA synchronous=NORMAL")
        .execute(&pool)
        .await?;

    // Run migrations
    run_migrations(&pool).await?;

    Ok(pool)
}

/// Run database migrations
async fn run_migrations(pool: &DbPool) -> anyhow::Result<()> {
    // Create migrations tracking table if it doesn't exist
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS _migrations (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
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
    ];

    // Apply each migration if not already applied
    for (name, sql) in migrations {
        // Check if migration already applied
        let result: Option<(i32,)> = sqlx::query_as(
            "SELECT 1 FROM _migrations WHERE name = ?"
        )
        .bind(name)
        .fetch_optional(pool)
        .await?;

        if result.is_none() {
            tracing::info!("Applying migration: {}", name);

            // Execute migration
            sqlx::query(sql)
                .execute(pool)
                .await?;

            // Record migration as applied
            sqlx::query(
                "INSERT INTO _migrations (name) VALUES (?)"
            )
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
