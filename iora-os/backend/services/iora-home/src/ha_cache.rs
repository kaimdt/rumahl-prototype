use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use tracing::info;

/// Cached item with TTL tracking
struct CachedItem {
    data: Value,
    fetched_at: Instant,
    ttl: Duration,
}

impl CachedItem {
    fn is_fresh(&self) -> bool {
        self.fetched_at.elapsed() < self.ttl
    }
}

/// In-memory cache for Home Assistant API responses and database statistics.
///
/// Background workers periodically refresh this cache so that handler functions
/// can serve data instantly from memory instead of making HTTP calls or DB queries.
pub struct HaDataCache {
    /// HA REST API response cache (keyed by API path, e.g. "/api/config")
    api_cache: RwLock<HashMap<String, CachedItem>>,
    /// Database statistics cache
    db_stats: RwLock<Option<CachedItem>>,
    /// Cache hit/miss metrics
    hits: AtomicU64,
    misses: AtomicU64,
}

impl HaDataCache {
    pub fn new() -> Self {
        Self {
            api_cache: RwLock::new(HashMap::with_capacity(16)),
            db_stats: RwLock::new(None),
            hits: AtomicU64::new(0),
            misses: AtomicU64::new(0),
        }
    }

    /// Get a cached HA API response. Returns None if not cached or expired.
    pub async fn get_api(&self, path: &str) -> Option<Value> {
        let cache = self.api_cache.read().await;
        if let Some(item) = cache.get(path) {
            if item.is_fresh() {
                self.hits.fetch_add(1, Ordering::Relaxed);
                return Some(item.data.clone());
            }
        }
        self.misses.fetch_add(1, Ordering::Relaxed);
        None
    }

    /// Store an HA API response in cache with a TTL.
    pub async fn set_api(&self, path: &str, data: Value, ttl: Duration) {
        let mut cache = self.api_cache.write().await;
        cache.insert(
            path.to_string(),
            CachedItem {
                data,
                fetched_at: Instant::now(),
                ttl,
            },
        );
    }

    /// Get cached database statistics. Returns None if not cached or expired.
    pub async fn get_db_stats(&self) -> Option<Value> {
        let stats = self.db_stats.read().await;
        if let Some(item) = stats.as_ref() {
            if item.is_fresh() {
                self.hits.fetch_add(1, Ordering::Relaxed);
                return Some(item.data.clone());
            }
        }
        self.misses.fetch_add(1, Ordering::Relaxed);
        None
    }

    /// Store database statistics in cache.
    pub async fn set_db_stats(&self, data: Value, ttl: Duration) {
        let mut stats = self.db_stats.write().await;
        *stats = Some(CachedItem {
            data,
            fetched_at: Instant::now(),
            ttl,
        });
    }

    /// Get or fetch: returns cached data if fresh, otherwise calls the fetcher
    /// and caches the result. This avoids thundering herd on cache expiry
    /// because background workers keep the cache warm.
    pub async fn get_or_fetch_api<F, Fut>(
        &self,
        path: &str,
        ttl: Duration,
        fetcher: F,
    ) -> Option<Value>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Option<Value>>,
    {
        if let Some(cached) = self.get_api(path).await {
            return Some(cached);
        }
        // Cache miss — fetch and store
        if let Some(data) = fetcher().await {
            self.set_api(path, data.clone(), ttl).await;
            Some(data)
        } else {
            None
        }
    }

    /// Return cache metrics for diagnostics
    pub fn metrics(&self) -> (u64, u64) {
        (
            self.hits.load(Ordering::Relaxed),
            self.misses.load(Ordering::Relaxed),
        )
    }
}

// ─── Background refresh workers ─────────────────────────────────────────

/// TTLs for different data types
const TTL_HA_CONFIG: Duration = Duration::from_secs(120); // HA config rarely changes
const TTL_HA_SERVICES: Duration = Duration::from_secs(300); // Services list is very stable
const TTL_HA_SUPERVISOR: Duration = Duration::from_secs(120);
const TTL_HA_ADDONS: Duration = Duration::from_secs(120);
const TTL_HA_BACKUPS: Duration = Duration::from_secs(180);
const TTL_HA_NETWORK: Duration = Duration::from_secs(120);
const TTL_HA_LOGS: Duration = Duration::from_secs(30); // Logs change frequently
const TTL_DB_STATS: Duration = Duration::from_secs(60); // DB stats every minute

/// Background task that proactively refreshes HA API data in cache.
/// Runs multiple fetches in parallel using tokio::join! for speed.
pub async fn background_ha_cache_refresh(
    cache: std::sync::Arc<HaDataCache>,
    http_client: reqwest::Client,
    db_pool: crate::db::DbPool,
) {
    // Wait a few seconds for the system to start up
    tokio::time::sleep(Duration::from_secs(5)).await;
    info!("HA data cache background worker started");

    let mut interval = tokio::time::interval(Duration::from_secs(45));

    loop {
        interval.tick().await;

        let ha_config = crate::load_ha_runtime_config_from_pool(&db_pool).await;
        if !ha_config.is_configured() {
            tracing::debug!("HA not configured; skipping cache refresh");
            continue;
        }
        let ha_url = ha_config.url;
        let ha_token = ha_config.token;

        // Fetch multiple HA API endpoints in parallel
        let (config_res, services_res, supervisor_res, addons_res, backups_res, network_res) = tokio::join!(
            fetch_ha_api(&http_client, &ha_url, &ha_token, "/api/config"),
            fetch_ha_api(&http_client, &ha_url, &ha_token, "/api/services"),
            fetch_ha_api(
                &http_client,
                &ha_url,
                &ha_token,
                "/api/hassio/supervisor/info"
            ),
            fetch_ha_api(&http_client, &ha_url, &ha_token, "/api/hassio/addons"),
            fetch_ha_api(&http_client, &ha_url, &ha_token, "/api/hassio/backups"),
            fetch_ha_api(&http_client, &ha_url, &ha_token, "/api/hassio/network/info"),
        );

        // Store successful responses in cache
        if let Some(data) = config_res {
            cache.set_api("/api/config", data, TTL_HA_CONFIG).await;
        }
        if let Some(data) = services_res {
            cache.set_api("/api/services", data, TTL_HA_SERVICES).await;
        }
        if let Some(data) = supervisor_res {
            cache
                .set_api("/api/hassio/supervisor/info", data, TTL_HA_SUPERVISOR)
                .await;
        }
        if let Some(data) = addons_res {
            cache
                .set_api("/api/hassio/addons", data, TTL_HA_ADDONS)
                .await;
        }
        if let Some(data) = backups_res {
            cache
                .set_api("/api/hassio/backups", data, TTL_HA_BACKUPS)
                .await;
        }
        if let Some(data) = network_res {
            cache
                .set_api("/api/hassio/network/info", data, TTL_HA_NETWORK)
                .await;
        }

        // Fetch error log (plain text endpoint) and logbook separately
        let (error_log_res, logbook_res, calendars_res) = tokio::join!(
            fetch_ha_api_text(&http_client, &ha_url, &ha_token, "/api/error_log"),
            fetch_ha_api(&http_client, &ha_url, &ha_token, "/api/logbook"),
            fetch_ha_api(&http_client, &ha_url, &ha_token, "/api/calendars"),
        );

        if let Some(log_text) = error_log_res {
            // Parse into structured format
            let parsed = crate::parse_ha_error_log(&log_text);
            cache.set_api("/api/error_log", parsed, TTL_HA_LOGS).await;
        }
        if let Some(data) = logbook_res {
            cache.set_api("/api/logbook", data, TTL_HA_LOGS).await;
        }
        if let Some(data) = calendars_res {
            cache.set_api("/api/calendars", data, TTL_HA_SERVICES).await;
        }

        // Refresh DB stats in parallel (runs in spawn_blocking since it's IO)
        let db = db_pool.clone();
        let cache_clone = cache.clone();
        tokio::spawn(async move {
            if let Some(stats) = fetch_db_stats(&db).await {
                cache_clone.set_db_stats(stats, TTL_DB_STATS).await;
            }
        });

        let (hits, misses) = cache.metrics();
        tracing::debug!(
            "HA cache refresh complete (hits={}, misses={})",
            hits,
            misses
        );
    }
}

/// Fetch a single HA API endpoint, returning None on failure
async fn fetch_ha_api(
    client: &reqwest::Client,
    ha_url: &str,
    ha_token: &str,
    path: &str,
) -> Option<Value> {
    let response = client
        .get(format!("{}{}", ha_url, path))
        .header("Authorization", format!("Bearer {}", ha_token))
        .header("Content-Type", "application/json")
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .ok()?;

    if !response.status().is_success() {
        return None;
    }

    response.json::<Value>().await.ok()
}

/// Fetch database statistics for caching
async fn fetch_db_stats(db_pool: &crate::db::DbPool) -> Option<Value> {
    let db_size: i64 = sqlx::query_scalar::<_, i64>(
        "SELECT page_count * page_size FROM pragma_page_count, pragma_page_size",
    )
    .fetch_one(db_pool)
    .await
    .unwrap_or(0);

    let (user_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users")
        .fetch_one(db_pool)
        .await
        .unwrap_or((0,));
    let (history_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM entity_history")
        .fetch_one(db_pool)
        .await
        .unwrap_or((0,));
    let (api_key_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM api_keys")
        .fetch_one(db_pool)
        .await
        .unwrap_or((0,));
    let (page_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM pages")
        .fetch_one(db_pool)
        .await
        .unwrap_or((0,));
    let (widget_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM widgets")
        .fetch_one(db_pool)
        .await
        .unwrap_or((0,));
    let (device_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM devices")
        .fetch_one(db_pool)
        .await
        .unwrap_or((0,));

    Some(serde_json::json!({
        "size_bytes": db_size,
        "size_mb": (db_size as f64 / 1_048_576.0 * 100.0).round() / 100.0,
        "tables": {
            "users": user_count,
            "entity_history": history_count,
            "api_keys": api_key_count,
            "pages": page_count,
            "widgets": widget_count,
            "devices": device_count,
        },
    }))
}

/// Fetch a plain-text HA API endpoint (e.g. /api/error_log), returning None on failure
async fn fetch_ha_api_text(
    client: &reqwest::Client,
    ha_url: &str,
    ha_token: &str,
    path: &str,
) -> Option<String> {
    let response = client
        .get(format!("{}{}", ha_url, path))
        .header("Authorization", format!("Bearer {}", ha_token))
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .ok()?;

    if !response.status().is_success() {
        return None;
    }

    response.text().await.ok()
}
