use dashmap::DashMap;
use serde::{de::DeserializeOwned, Serialize};
use std::{
    sync::Arc,
    time::{Duration, Instant},
};

#[derive(Clone)]
#[allow(dead_code)]
pub struct CacheEntry<T> {
    data: T,
    expires_at: Instant,
}

#[derive(Clone)]
pub struct Cache {
    store: Arc<DashMap<String, Vec<u8>>>,
    expirations: Arc<DashMap<String, Instant>>,
}

#[allow(dead_code)]
impl Cache {
    pub fn new() -> Self {
        Self {
            store: Arc::new(DashMap::new()),
            expirations: Arc::new(DashMap::new()),
        }
    }

    pub fn get<T: DeserializeOwned>(&self, key: &str) -> Option<T> {
        // Check if expired
        if let Some(expires_at) = self.expirations.get(key) {
            if Instant::now() > *expires_at {
                self.invalidate(key);
                return None;
            }
        }

        self.store.get(key).and_then(|entry| {
            serde_json::from_slice(&entry).ok()
        })
    }

    pub fn set<T: Serialize>(&self, key: String, value: T, ttl: Duration) {
        if let Ok(serialized) = serde_json::to_vec(&value) {
            let expires_at = Instant::now() + ttl;
            self.store.insert(key.clone(), serialized);
            self.expirations.insert(key, expires_at);
        }
    }

    pub fn invalidate(&self, key: &str) {
        self.store.remove(key);
        self.expirations.remove(key);
    }

    pub fn clear(&self) {
        self.store.clear();
        self.expirations.clear();
    }

    /// Clean up expired entries
    pub fn cleanup_expired(&self) {
        let now = Instant::now();
        let mut to_remove = Vec::new();

        for entry in self.expirations.iter() {
            if now > *entry.value() {
                to_remove.push(entry.key().clone());
            }
        }

        for key in to_remove {
            self.invalidate(&key);
        }
    }
}

impl Default for Cache {
    fn default() -> Self {
        Self::new()
    }
}

/// Helper macro for caching handler responses
#[macro_export]
macro_rules! with_cache {
    ($cache:expr, $key:expr, $ttl:expr, $compute:expr) => {
        if let Some(cached) = $cache.get::<_>($key) {
            cached
        } else {
            let result = $compute;
            $cache.set($key.to_string(), result.clone(), $ttl);
            result
        }
    };
}
