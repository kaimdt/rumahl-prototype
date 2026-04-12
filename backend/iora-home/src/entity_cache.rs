use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Instant;
use tokio::sync::RwLock;

use crate::EntityState;

/// Tracks per-entity analytics: change count, flip rate, staleness
#[derive(Debug, Clone, serde::Serialize)]
pub struct EntityAnalytics {
    pub entity_id: String,
    pub change_count: u64,
    pub last_change_ts: Option<String>,
    pub first_seen_ts: String,
    /// Average seconds between state changes (0 if only one observation)
    pub avg_change_interval_secs: f64,
    /// Current state (for quick access)
    pub current_state: String,
    /// Previous state before the last change
    pub previous_state: Option<String>,
    /// Seconds since last state change
    pub stale_seconds: u64,
}

/// Entity health status derived from analytics
#[derive(Debug, Clone, serde::Serialize)]
pub struct EntityHealthEntry {
    pub entity_id: String,
    pub status: &'static str, // "healthy", "stale", "unavailable", "unknown"
    pub detail: String,
    pub stale_seconds: u64,
    pub change_count: u64,
}

/// Internal per-entity tracking data
struct EntityTracker {
    change_count: u64,
    first_seen: Instant,
    first_seen_ts: String,
    last_change: Option<Instant>,
    last_change_ts: Option<String>,
    previous_state: Option<String>,
    /// Rolling buffer of time-between-changes for averaging
    change_intervals: Vec<f64>,
}

/// In-memory cache for Home Assistant entity states.
/// The poll loop writes here; HTTP handlers and WebSocket reads from here.
pub struct EntityStateCache {
    states: RwLock<HashMap<String, EntityState>>,
    ha_connected: AtomicBool,
    initialized: AtomicBool,
    /// Performance metrics
    update_count: AtomicU64,
    last_update_ms: AtomicU64,
    cache_hits: AtomicU64,
    cache_misses: AtomicU64,
    /// Per-entity analytics trackers
    trackers: RwLock<HashMap<String, EntityTracker>>,
}

impl EntityStateCache {
    pub fn new() -> Self {
        Self {
            states: RwLock::new(HashMap::new()),
            ha_connected: AtomicBool::new(false),
            initialized: AtomicBool::new(false),
            update_count: AtomicU64::new(0),
            last_update_ms: AtomicU64::new(0),
            cache_hits: AtomicU64::new(0),
            cache_misses: AtomicU64::new(0),
            trackers: RwLock::new(HashMap::new()),
        }
    }

    /// Get all cached entity states.
    pub async fn get_all(&self) -> Vec<EntityState> {
        let map = self.states.read().await;
        map.values().cloned().collect()
    }

    /// Get a single cached entity state.
    pub async fn get(&self, entity_id: &str) -> Option<EntityState> {
        let map = self.states.read().await;
        match map.get(entity_id) {
            Some(entity) => {
                self.cache_hits.fetch_add(1, Ordering::Relaxed);
                crate::METRICS.cache_hits.fetch_add(1, Ordering::Relaxed);
                Some(entity.clone())
            }
            None => {
                self.cache_misses.fetch_add(1, Ordering::Relaxed);
                crate::METRICS.cache_misses.fetch_add(1, Ordering::Relaxed);
                None
            }
        }
    }

    /// Get multiple entities by domain prefix (e.g. "light.", "sensor.")
    pub async fn get_by_domain(&self, domain: &str) -> Vec<EntityState> {
        let prefix = if domain.ends_with('.') {
            domain.to_string()
        } else {
            format!("{}.", domain)
        };
        let map = self.states.read().await;
        map.values()
            .filter(|e| e.entity_id.starts_with(&prefix))
            .cloned()
            .collect()
    }

    /// Update a single entity in the cache (used after service calls for
    /// instant feedback without waiting for the full polling loop).
    /// Returns true if the entity was actually changed.
    pub async fn update_single(&self, entity: EntityState) -> bool {
        let mut map = self.states.write().await;
        let changed = match map.get(&entity.entity_id) {
            Some(existing) => existing.last_updated != entity.last_updated,
            None => true,
        };
        if changed {
            map.insert(entity.entity_id.clone(), entity);
        }
        changed
    }

    /// Remove an entity from the cache (entity deleted in HA).
    pub async fn remove(&self, entity_id: &str) -> bool {
        let mut map = self.states.write().await;
        map.remove(entity_id).is_some()
    }

    /// Returns true if the cache has been populated at least once.
    pub async fn is_populated(&self) -> bool {
        !self.states.read().await.is_empty()
    }

    /// Update the cache with new states from HA.
    /// Returns (changed_entities, is_initial_load).
    /// On initial load, all entities are "changed" but should not be logged to history.
    ///
    /// The diff is computed while holding only a **read** lock (cheap, non-blocking
    /// for other readers).  Only the final swap takes a short **write** lock.
    ///
    /// Stale entities (present in old cache but not in new_states) are automatically
    /// removed, preventing unbounded memory growth.
    pub async fn update(&self, new_states: Vec<EntityState>) -> (Vec<EntityState>, bool) {
        let start = Instant::now();
        let is_initial = !self.initialized.load(Ordering::Relaxed);
        let now_ts = chrono::Utc::now().to_rfc3339();

        // Phase 1: diff under read-lock (does NOT block other readers)
        let mut changed = Vec::new();
        let mut new_map = HashMap::with_capacity(new_states.len());
        {
            let old = self.states.read().await;
            for entity in new_states {
                let is_changed = match old.get(&entity.entity_id) {
                    Some(existing) => existing.last_updated != entity.last_updated,
                    None => true,
                };
                if is_changed {
                    changed.push(entity.clone());
                }
                new_map.insert(entity.entity_id.clone(), entity);
            }
        } // read-lock released

        // Phase 1b: update analytics trackers for changed entities
        if !is_initial && !changed.is_empty() {
            let mut trackers = self.trackers.write().await;
            let old_states = self.states.read().await;
            for entity in &changed {
                let tracker = trackers
                    .entry(entity.entity_id.clone())
                    .or_insert_with(|| EntityTracker {
                        change_count: 0,
                        first_seen: start,
                        first_seen_ts: now_ts.clone(),
                        last_change: None,
                        last_change_ts: None,
                        previous_state: None,
                        change_intervals: Vec::new(),
                    });

                // Record the previous state
                if let Some(old) = old_states.get(&entity.entity_id) {
                    if old.state != entity.state {
                        tracker.previous_state = Some(old.state.clone());
                    }
                }

                // Update change metrics
                if let Some(last) = tracker.last_change {
                    let interval = start.duration_since(last).as_secs_f64();
                    if tracker.change_intervals.len() >= 100 {
                        tracker.change_intervals.remove(0);
                    }
                    tracker.change_intervals.push(interval);
                }
                tracker.change_count += 1;
                tracker.last_change = Some(start);
                tracker.last_change_ts = Some(now_ts.clone());
            }
            drop(old_states);
        } else if is_initial {
            // Seed trackers for initial load
            let mut trackers = self.trackers.write().await;
            for entity in new_map.values() {
                trackers.entry(entity.entity_id.clone()).or_insert_with(|| EntityTracker {
                    change_count: 0,
                    first_seen: start,
                    first_seen_ts: now_ts.clone(),
                    last_change: None,
                    last_change_ts: None,
                    previous_state: None,
                    change_intervals: Vec::new(),
                });
            }
        }

        // Phase 2: swap under write-lock (very fast — just a pointer swap)
        // This also removes stale entities since new_map only contains current entities
        {
            let mut map = self.states.write().await;
            *map = new_map;
        }

        self.initialized.store(true, Ordering::Relaxed);
        self.update_count.fetch_add(1, Ordering::Relaxed);
        self.last_update_ms.store(start.elapsed().as_millis() as u64, Ordering::Relaxed);
        (changed, is_initial)
    }

    pub fn set_ha_connected(&self, connected: bool) {
        self.ha_connected.store(connected, Ordering::Relaxed);
    }

    pub fn is_ha_connected(&self) -> bool {
        self.ha_connected.load(Ordering::Relaxed)
    }

    pub async fn count(&self) -> usize {
        self.states.read().await.len()
    }

    /// Return performance metrics for diagnostics
    pub fn metrics(&self) -> CacheMetrics {
        CacheMetrics {
            update_count: self.update_count.load(Ordering::Relaxed),
            last_update_ms: self.last_update_ms.load(Ordering::Relaxed),
            cache_hits: self.cache_hits.load(Ordering::Relaxed),
            cache_misses: self.cache_misses.load(Ordering::Relaxed),
        }
    }

    /// Get the top N most-active entities by state change count
    pub async fn top_active_entities(&self, n: usize) -> Vec<EntityAnalytics> {
        let trackers = self.trackers.read().await;
        let states = self.states.read().await;
        let now = Instant::now();

        let mut entries: Vec<EntityAnalytics> = trackers
            .iter()
            .map(|(id, t)| {
                let avg = if t.change_intervals.is_empty() {
                    0.0
                } else {
                    t.change_intervals.iter().sum::<f64>() / t.change_intervals.len() as f64
                };
                let stale_secs = t.last_change
                    .map(|lc| now.duration_since(lc).as_secs())
                    .unwrap_or_else(|| now.duration_since(t.first_seen).as_secs());
                EntityAnalytics {
                    entity_id: id.clone(),
                    change_count: t.change_count,
                    last_change_ts: t.last_change_ts.clone(),
                    first_seen_ts: t.first_seen_ts.clone(),
                    avg_change_interval_secs: (avg * 10.0).round() / 10.0,
                    current_state: states.get(id).map(|s| s.state.clone()).unwrap_or_default(),
                    previous_state: t.previous_state.clone(),
                    stale_seconds: stale_secs,
                }
            })
            .collect();

        entries.sort_by(|a, b| b.change_count.cmp(&a.change_count));
        entries.truncate(n);
        entries
    }

    /// Get analytics for a specific entity
    pub async fn entity_analytics(&self, entity_id: &str) -> Option<EntityAnalytics> {
        let trackers = self.trackers.read().await;
        let states = self.states.read().await;
        let now = Instant::now();

        trackers.get(entity_id).map(|t| {
            let avg = if t.change_intervals.is_empty() {
                0.0
            } else {
                t.change_intervals.iter().sum::<f64>() / t.change_intervals.len() as f64
            };
            let stale_secs = t.last_change
                .map(|lc| now.duration_since(lc).as_secs())
                .unwrap_or_else(|| now.duration_since(t.first_seen).as_secs());
            EntityAnalytics {
                entity_id: entity_id.to_string(),
                change_count: t.change_count,
                last_change_ts: t.last_change_ts.clone(),
                first_seen_ts: t.first_seen_ts.clone(),
                avg_change_interval_secs: (avg * 10.0).round() / 10.0,
                current_state: states.get(entity_id).map(|s| s.state.clone()).unwrap_or_default(),
                previous_state: t.previous_state.clone(),
                stale_seconds: stale_secs,
            }
        })
    }

    /// Get entity health report — flags stale and unavailable entities,
    /// detects entities stuck in "unavailable" or "unknown" states, and
    /// identifies entities that haven't changed for an unusually long time
    pub async fn entity_health_report(&self, stale_threshold_secs: u64) -> Vec<EntityHealthEntry> {
        let states = self.states.read().await;
        let trackers = self.trackers.read().await;
        let now = Instant::now();
        let mut report = Vec::new();

        for (id, entity) in states.iter() {
            let tracker = trackers.get(id);
            let stale_secs = tracker
                .and_then(|t| t.last_change.map(|lc| now.duration_since(lc).as_secs()))
                .unwrap_or(0);
            let change_count = tracker.map(|t| t.change_count).unwrap_or(0);

            let (status, detail) = if entity.state == "unavailable" {
                ("unavailable", format!("Entity meldet 'unavailable' seit {} Sekunden", stale_secs))
            } else if entity.state == "unknown" {
                ("unknown", "Entity-Status ist 'unknown'".to_string())
            } else if stale_secs > stale_threshold_secs && change_count > 0 {
                ("stale", format!(
                    "Keine Statusänderung seit {} Minuten (letzte: {})",
                    stale_secs / 60,
                    tracker.and_then(|t| t.last_change_ts.as_deref()).unwrap_or("?")
                ))
            } else {
                continue; // healthy — skip
            };

            // Check if entity has low battery (common attribute)
            let battery_low = entity.attributes.get("battery_level")
                .and_then(|v| v.as_f64())
                .map(|b| b < 15.0)
                .unwrap_or(false);

            let final_detail = if battery_low {
                format!("{} | ⚠ Batterie niedrig (<15%)", detail)
            } else {
                detail
            };

            report.push(EntityHealthEntry {
                entity_id: id.clone(),
                status,
                detail: final_detail,
                stale_seconds: stale_secs,
                change_count,
            });
        }

        // Sort: unavailable first, then stale by staleness
        report.sort_by(|a, b| {
            let prio = |s: &str| match s { "unavailable" => 0, "unknown" => 1, "stale" => 2, _ => 3 };
            prio(a.status).cmp(&prio(b.status))
                .then(b.stale_seconds.cmp(&a.stale_seconds))
        });
        report
    }

    /// Get analytics summary for integration_status
    pub async fn analytics_summary(&self) -> serde_json::Value {
        let trackers = self.trackers.read().await;
        let states = self.states.read().await;

        let total_changes: u64 = trackers.values().map(|t| t.change_count).sum();
        let entities_with_changes = trackers.values().filter(|t| t.change_count > 0).count();
        let unavailable_count = states.values().filter(|e| e.state == "unavailable").count();
        let unknown_count = states.values().filter(|e| e.state == "unknown").count();

        // Top 5 most active
        let mut top5: Vec<(&String, u64)> = trackers.iter()
            .map(|(id, t)| (id, t.change_count))
            .collect();
        top5.sort_by(|a, b| b.1.cmp(&a.1));
        top5.truncate(5);

        serde_json::json!({
            "total_state_changes": total_changes,
            "entities_with_changes": entities_with_changes,
            "unavailable_count": unavailable_count,
            "unknown_count": unknown_count,
            "most_active": top5.iter().map(|(id, c)| {
                serde_json::json!({"entity_id": id, "changes": c})
            }).collect::<Vec<_>>(),
        })
    }
}

/// Performance metrics for the entity cache
pub struct CacheMetrics {
    pub update_count: u64,
    pub last_update_ms: u64,
    pub cache_hits: u64,
    pub cache_misses: u64,
}
