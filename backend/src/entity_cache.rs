use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::RwLock;

use crate::EntityState;

/// In-memory cache for Home Assistant entity states.
/// The poll loop writes here; HTTP handlers and WebSocket reads from here.
pub struct EntityStateCache {
    states: RwLock<HashMap<String, EntityState>>,
    ha_connected: AtomicBool,
    initialized: AtomicBool,
}

impl EntityStateCache {
    pub fn new() -> Self {
        Self {
            states: RwLock::new(HashMap::new()),
            ha_connected: AtomicBool::new(false),
            initialized: AtomicBool::new(false),
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
        map.get(entity_id).cloned()
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
    pub async fn update(&self, new_states: Vec<EntityState>) -> (Vec<EntityState>, bool) {
        let is_initial = !self.initialized.load(Ordering::Relaxed);

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

        // Phase 2: swap under write-lock (very fast — just a pointer swap)
        {
            let mut map = self.states.write().await;
            *map = new_map;
        }

        self.initialized.store(true, Ordering::Relaxed);
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
}
