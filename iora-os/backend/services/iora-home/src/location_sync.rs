//! Location History Sync Service
//!
//! Background service that periodically syncs location history from Home Assistant
//! into our own database for long-term retention. HA typically only keeps ~10 days
//! of history; we keep it indefinitely (configurable).
//!
//! Features:
//! - Per-entity sync tracking (last_sync_at, oldest/newest data)
//! - Gap detection: if data is stale, attempts to backfill from HA
//! - Admin notifications when HA data is no longer available for backfill
//! - Configurable retention (default: unlimited)

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::sync::Arc;
use tracing::{debug, info, warn};

use crate::ha_client::HomeAssistantClient;

// ─── Public API ──────────────────────────────────────────────────────────────

pub struct LocationSyncService {
    pool: PgPool,
    ha_client: Arc<HomeAssistantClient>,
}

impl LocationSyncService {
    pub fn new(pool: PgPool, ha_client: Arc<HomeAssistantClient>) -> Arc<Self> {
        Arc::new(Self { pool, ha_client })
    }

    /// Start the background sync loop. Returns immediately.
    pub fn start(self: Arc<Self>) {
        let this = self.clone();
        tokio::spawn(async move {
            this.run().await;
        });
    }

    async fn run(&self) {
        info!("LocationSyncService: starting background sync loop");
        // Initial delay to let HA connection stabilize
        tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;

        // Do an initial full sync
        if let Err(e) = self.sync_all_entities().await {
            warn!("LocationSyncService: initial sync failed: {}", e);
        }

        // Then sync every 5 minutes
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(300));
        loop {
            interval.tick().await;
            if let Err(e) = self.sync_all_entities().await {
                warn!("LocationSyncService: periodic sync failed: {}", e);
            }
        }
    }

    /// Sync location history for all person/device_tracker entities
    async fn sync_all_entities(&self) -> anyhow::Result<()> {
        // Get all person + device_tracker entities from HA
        let states = self.ha_client.get_states().await?;
        let trackable: Vec<(String, String)> = states
            .into_iter()
            .filter(|e| {
                e.entity_id.starts_with("person.") || e.entity_id.starts_with("device_tracker.")
            })
            .filter(|e| {
                // Only entities that have lat/lng
                e.attributes.get("latitude").is_some() && e.attributes.get("longitude").is_some()
            })
            .map(|e| {
                let name = e.attributes.get("friendly_name")
                    .and_then(|v| v.as_str())
                    .unwrap_or(&e.entity_id)
                    .to_string();
                (e.entity_id, name)
            })
            .collect();

        debug!("LocationSyncService: found {} trackable entities", trackable.len());

        for (entity_id, friendly_name) in &trackable {
            if let Err(e) = self.sync_entity(entity_id, friendly_name).await {
                warn!("LocationSyncService: sync failed for {}: {}", entity_id, e);
                self.update_sync_status(entity_id, "error", Some(&e.to_string())).await;
            }
        }

        Ok(())
    }

    /// Sync a single entity's location history
    async fn sync_entity(&self, entity_id: &str, friendly_name: &str) -> anyhow::Result<()> {
        // Ensure sync status row exists
        sqlx::query(
            r#"INSERT INTO location_sync_status (entity_id, friendly_name)
               VALUES ($1, $2)
               ON CONFLICT (entity_id) DO UPDATE SET friendly_name = $2, updated_at = NOW()"#,
        )
        .bind(entity_id)
        .bind(friendly_name)
        .execute(&self.pool)
        .await?;

        // Get current sync status
        let sync_row: Option<(Option<DateTime<Utc>>, Option<DateTime<Utc>>)> = sqlx::query_as(
            "SELECT last_sync_at, newest_data_at FROM location_sync_status WHERE entity_id = $1",
        )
        .bind(entity_id)
        .fetch_optional(&self.pool)
        .await?;

        let (last_sync, newest_data) = sync_row.unwrap_or((None, None));

        // Determine the start time for the HA history query
        let sync_from = match (last_sync, newest_data) {
            // If we have recent data, sync from the newest point
            (_, Some(newest)) => newest,
            // If we've synced before but have no data (edge case), go back 24h
            (Some(_), None) => Utc::now() - chrono::Duration::hours(24),
            // First sync: try to get as much as HA has (typically 10 days)
            (None, None) => Utc::now() - chrono::Duration::days(10),
        };

        // Don't re-sync if we synced very recently (< 2 minutes ago)
        if let Some(ls) = last_sync {
            if (Utc::now() - ls).num_seconds() < 120 {
                debug!("LocationSyncService: {} synced recently, skipping", entity_id);
                return Ok(());
            }
        }

        self.update_sync_status(entity_id, "syncing", None).await;

        // Fetch history from HA
        let start_iso = sync_from.to_rfc3339();
        let query = format!("filter_entity_id={}&minimal_response&no_attributes=false", entity_id);
        let history = self.ha_client.get_history(&start_iso, &query).await;

        match history {
            Ok(data) => {
                let points = self.extract_location_points(entity_id, &data);
                let inserted = self.store_points(entity_id, &points).await?;

                // Update sync status
                let total: (i64,) = sqlx::query_as(
                    "SELECT COUNT(*) FROM location_history_points WHERE entity_id = $1",
                )
                .bind(entity_id)
                .fetch_one(&self.pool)
                .await?;

                let oldest: Option<(Option<DateTime<Utc>>,)> = sqlx::query_as(
                    "SELECT MIN(recorded_at) FROM location_history_points WHERE entity_id = $1",
                )
                .bind(entity_id)
                .fetch_optional(&self.pool)
                .await?;

                let newest: Option<(Option<DateTime<Utc>>,)> = sqlx::query_as(
                    "SELECT MAX(recorded_at) FROM location_history_points WHERE entity_id = $1",
                )
                .bind(entity_id)
                .fetch_optional(&self.pool)
                .await?;

                sqlx::query(
                    r#"UPDATE location_sync_status
                       SET last_sync_at = NOW(), sync_state = 'synced', last_error = NULL,
                           total_points = $2, oldest_data_at = $3, newest_data_at = $4,
                           updated_at = NOW()
                       WHERE entity_id = $1"#,
                )
                .bind(entity_id)
                .bind(total.0 as i32)
                .bind(oldest.and_then(|o| o.0))
                .bind(newest.and_then(|n| n.0))
                .execute(&self.pool)
                .await?;

                if inserted > 0 {
                    debug!(
                        "LocationSyncService: {} — inserted {} new points (total: {})",
                        entity_id, inserted, total.0
                    );
                }

                // Check for gaps: if our newest data is much older than expected
                // and HA couldn't provide older data, create admin notification
                if let Some((Some(ref newest_ts),)) = newest {
                    let gap_hours = (Utc::now() - *newest_ts).num_hours();
                    if gap_hours > 24 && points.is_empty() {
                        self.create_gap_notification(entity_id, friendly_name, gap_hours).await;
                    }
                }
            }
            Err(e) => {
                warn!("LocationSyncService: HA history fetch failed for {}: {}", entity_id, e);
                self.update_sync_status(entity_id, "error", Some(&e.to_string())).await;

                // Create admin notification for persistent failures
                self.create_sync_error_notification(entity_id, friendly_name, &e.to_string()).await;
            }
        }

        Ok(())
    }

    /// Extract lat/lng points from HA history response
    fn extract_location_points(&self, entity_id: &str, data: &serde_json::Value) -> Vec<LocationPoint> {
        let mut points = Vec::new();

        // HA history returns [[{state, last_changed, attributes: {latitude, longitude, ...}}, ...]]
        let entries = match data.as_array() {
            Some(outer) => outer.first().and_then(|inner| inner.as_array()),
            None => None,
        };

        let entries = match entries {
            Some(e) => e,
            None => return points,
        };

        for entry in entries {
            let attrs = match entry.get("attributes") {
                Some(a) => a,
                None => continue,
            };

            let lat = attrs.get("latitude").and_then(|v| v.as_f64());
            let lng = attrs.get("longitude").and_then(|v| v.as_f64());
            let (lat, lng) = match (lat, lng) {
                (Some(la), Some(lo)) => (la, lo),
                _ => continue,
            };

            let recorded_at = entry
                .get("last_changed")
                .and_then(|v| v.as_str())
                .and_then(|s| DateTime::parse_from_rfc3339(s).ok().or_else(|| {
                    // HA sometimes uses formats without timezone
                    chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S%.f")
                        .ok()
                        .map(|ndt| ndt.and_utc().fixed_offset())
                }))
                .map(|dt| dt.with_timezone(&Utc));

            let recorded_at = match recorded_at {
                Some(dt) => dt,
                None => continue,
            };

            let state = entry.get("state").and_then(|v| v.as_str()).map(|s| s.to_string());
            let gps_accuracy = attrs.get("gps_accuracy").and_then(|v| v.as_i64()).map(|v| v as i32);
            let source = attrs.get("source_type").and_then(|v| v.as_str()).map(|s| s.to_string());

            points.push(LocationPoint {
                entity_id: entity_id.to_string(),
                latitude: lat,
                longitude: lng,
                gps_accuracy,
                state,
                source,
                recorded_at,
            });
        }

        // Deduplicate: remove consecutive points that haven't moved significantly
        let mut deduped: Vec<LocationPoint> = Vec::new();
        for p in points {
            if let Some(last) = deduped.last() {
                if (p.latitude - last.latitude).abs() < 0.00005
                    && (p.longitude - last.longitude).abs() < 0.00005
                {
                    continue;
                }
            }
            deduped.push(p.clone());
        }

        deduped
    }

    /// Store points in the database (ignoring duplicates)
    async fn store_points(&self, _entity_id: &str, points: &[LocationPoint]) -> anyhow::Result<i64> {
        if points.is_empty() {
            return Ok(0);
        }

        let mut inserted: i64 = 0;
        for point in points {
            let result = sqlx::query(
                r#"INSERT INTO location_history_points
                       (entity_id, latitude, longitude, gps_accuracy, state, source, recorded_at)
                   VALUES ($1, $2, $3, $4, $5, $6, $7)
                   ON CONFLICT (entity_id, recorded_at, latitude, longitude) DO NOTHING"#,
            )
            .bind(&point.entity_id)
            .bind(point.latitude)
            .bind(point.longitude)
            .bind(point.gps_accuracy)
            .bind(point.state.as_deref())
            .bind(point.source.as_deref())
            .bind(point.recorded_at)
            .execute(&self.pool)
            .await?;

            inserted += result.rows_affected() as i64;
        }

        Ok(inserted)
    }

    async fn update_sync_status(&self, entity_id: &str, state: &str, error: Option<&str>) {
        let _ = sqlx::query(
            r#"UPDATE location_sync_status
               SET sync_state = $2, last_error = $3, updated_at = NOW()
               WHERE entity_id = $1"#,
        )
        .bind(entity_id)
        .bind(state)
        .bind(error)
        .execute(&self.pool)
        .await;
    }

    /// Create an admin notification about data gaps
    async fn create_gap_notification(&self, entity_id: &str, name: &str, gap_hours: i64) {
        let notif_id = format!("sync_gap_{}_{}", entity_id, Utc::now().format("%Y%m%d"));

        // Don't create duplicate notifications for the same day
        let exists: Option<(String,)> = sqlx::query_as(
            "SELECT id FROM admin_system_notifications WHERE id = $1",
        )
        .bind(&notif_id)
        .fetch_optional(&self.pool)
        .await
        .unwrap_or(None);

        if exists.is_some() {
            return;
        }

        let details = serde_json::json!({
            "entity_id": entity_id,
            "gap_hours": gap_hours,
            "action": "Data may have been lost. HA history is no longer available for this period."
        });

        let _ = sqlx::query(
            r#"INSERT INTO admin_system_notifications
                   (id, category, severity, title, message, details, source, auto_resolve)
               VALUES ($1, 'sync', 'warning', $2, $3, $4, 'location_sync', false)"#,
        )
        .bind(&notif_id)
        .bind(format!("Datenlücke: {}", name))
        .bind(format!(
            "Für {} ({}) fehlen Standortdaten der letzten {} Stunden. Home Assistant hat keine historischen Daten mehr für diesen Zeitraum.",
            name, entity_id, gap_hours
        ))
        .bind(sqlx::types::Json(&details))
        .execute(&self.pool)
        .await;
    }

    /// Create an admin notification about sync errors
    async fn create_sync_error_notification(&self, entity_id: &str, name: &str, error: &str) {
        let notif_id = format!("sync_err_{}_{}", entity_id, Utc::now().format("%Y%m%d%H"));

        let exists: Option<(String,)> = sqlx::query_as(
            "SELECT id FROM admin_system_notifications WHERE id = $1",
        )
        .bind(&notif_id)
        .fetch_optional(&self.pool)
        .await
        .unwrap_or(None);

        if exists.is_some() {
            return;
        }

        let details = serde_json::json!({
            "entity_id": entity_id,
            "error": error,
        });

        let _ = sqlx::query(
            r#"INSERT INTO admin_system_notifications
                   (id, category, severity, title, message, details, source, auto_resolve)
               VALUES ($1, 'sync', 'error', $2, $3, $4, 'location_sync', true)"#,
        )
        .bind(&notif_id)
        .bind(format!("Sync-Fehler: {}", name))
        .bind(format!(
            "Standort-Synchronisation für {} ({}) fehlgeschlagen: {}",
            name, entity_id, error
        ))
        .bind(sqlx::types::Json(&details))
        .execute(&self.pool)
        .await;
    }
}

// ─── Data types ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocationPoint {
    pub entity_id: String,
    pub latitude: f64,
    pub longitude: f64,
    pub gps_accuracy: Option<i32>,
    pub state: Option<String>,
    pub source: Option<String>,
    pub recorded_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SyncStatus {
    pub entity_id: String,
    pub friendly_name: String,
    pub last_sync_at: Option<DateTime<Utc>>,
    pub oldest_data_at: Option<DateTime<Utc>>,
    pub newest_data_at: Option<DateTime<Utc>>,
    pub total_points: i32,
    pub sync_state: String,
    pub last_error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AdminSystemNotification {
    pub id: String,
    pub category: String,
    pub severity: String,
    pub title: String,
    pub message: String,
    pub details: Option<serde_json::Value>,
    pub source: String,
    pub acknowledged: bool,
    pub acknowledged_by: Option<String>,
    pub acknowledged_at: Option<DateTime<Utc>>,
    pub resolved: bool,
    pub resolved_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}
