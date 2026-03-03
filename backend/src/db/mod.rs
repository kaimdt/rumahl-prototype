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

    // Run migrations
    run_migrations(&pool).await?;

    Ok(pool)
}

/// Run database migrations
async fn run_migrations(pool: &DbPool) -> anyhow::Result<()> {
    // Read and execute the migration files
    let migration_1 = include_str!("../../migrations/001_initial_schema.sql");
    let migration_2 = include_str!("../../migrations/002_add_password_hash.sql");

    sqlx::query(migration_1)
        .execute(pool)
        .await?;

    sqlx::query(migration_2)
        .execute(pool)
        .await?;

    tracing::info!("Database migrations completed successfully");

    Ok(())
}
