// Models Registry — auto-fetch and periodically refresh the model catalog
// from every configured AI provider, persisting the result so the UI can
// render a global model picker without waiting on slow upstream calls.
//
// * Cloud providers (openai, anthropic, deepseek, …) — refreshed every
//   `CLOUD_REFRESH_INTERVAL` (default 30 min) and on demand.
// * Local/Desktop providers — refreshed every `LOCAL_REFRESH_INTERVAL`
//   (default 60 s) so the list reflects models the user just loaded in
//   LM Studio / Ollama. Marked `is_live=true`.

use crate::database::{self, DbPool};
use crate::providers::{create_provider, provider_type_from_str, ProviderConfig};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Notify;

pub const CLOUD_REFRESH_INTERVAL: Duration = Duration::from_secs(1800); // 30 min
pub const LOCAL_REFRESH_INTERVAL: Duration = Duration::from_secs(60);

#[derive(Clone)]
pub struct ModelsRegistry {
    pool: DbPool,
    notify: Arc<Notify>,
}

impl ModelsRegistry {
    pub fn new(pool: DbPool) -> Self {
        Self {
            pool,
            notify: Arc::new(Notify::new()),
        }
    }

    /// Schedule an out-of-band refresh of all providers (e.g. after the user
    /// added/edited a provider via the Control Center).
    pub fn schedule_refresh(&self) {
        self.notify.notify_one();
    }

    /// Refresh models for a single provider. `provider_row` is the row from
    /// `provider_configs`. Returns `(model_count, is_live)`.
    pub async fn refresh_one(
        &self,
        provider_row: &database::providers::ProviderConfig,
    ) -> Result<(usize, bool), String> {
        let Some(ptype) = provider_type_from_str(&provider_row.provider_type) else {
            let msg = format!("unknown provider_type '{}'", provider_row.provider_type);
            let _ =
                database::models_registry::record_fetch_error(&self.pool, provider_row.id, &msg)
                    .await;
            return Err(msg);
        };
        let cfg = ProviderConfig {
            api_key: provider_row
                .config
                .get("api_key")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            base_url: provider_row
                .config
                .get("base_url")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            model: provider_row
                .config
                .get("model")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            api_version: provider_row
                .config
                .get("api_version")
                .and_then(|v| v.as_str())
                .map(str::to_string),
        };
        let is_live = matches!(provider_row.provider_type.as_str(), "local" | "desktop");
        let provider = create_provider(ptype, cfg.clone());
        let models = match provider.list_models().await {
            Ok(list) => list,
            Err(e) => {
                let msg = format!("{}", e);
                let _ = database::models_registry::record_fetch_error(
                    &self.pool,
                    provider_row.id,
                    &msg,
                )
                .await;
                return Err(msg);
            }
        };
        let pairs: Vec<(String, String)> = models.into_iter().map(|m| (m.id, m.name)).collect();
        let count = pairs.len();
        if let Err(e) =
            database::models_registry::replace_models(&self.pool, provider_row.id, &pairs, is_live)
                .await
        {
            let msg = format!("db write failed: {}", e);
            let _ =
                database::models_registry::record_fetch_error(&self.pool, provider_row.id, &msg)
                    .await;
            return Err(msg);
        }
        Ok((count, is_live))
    }

    /// Refresh all providers, optionally restricted to local/desktop ones.
    pub async fn refresh_all(&self, only_live: bool) -> usize {
        let providers = match database::providers::get_all_enabled_providers(&self.pool).await {
            Ok(p) => p,
            Err(e) => {
                tracing::warn!("models_registry: list providers failed: {}", e);
                return 0;
            }
        };
        let mut total_models = 0usize;
        for p in providers {
            let is_local = matches!(p.provider_type.as_str(), "local" | "desktop");
            if only_live && !is_local {
                continue;
            }
            match self.refresh_one(&p).await {
                Ok((n, live)) => {
                    total_models += n;
                    tracing::debug!(
                        "models_registry: refreshed {} ({}): {} models (live={})",
                        p.provider_type,
                        p.id,
                        n,
                        live
                    );
                }
                Err(e) => {
                    tracing::warn!(
                        "models_registry: refresh {} ({}) failed: {}",
                        p.provider_type,
                        p.id,
                        e
                    );
                }
            }
        }
        total_models
    }
}

/// Spawn the background refresh loop. Call once at startup.
pub fn spawn_refresh_loop(registry: ModelsRegistry) {
    tokio::spawn(async move {
        // Initial full refresh shortly after startup.
        tokio::time::sleep(Duration::from_secs(5)).await;
        let n = registry.refresh_all(false).await;
        tracing::info!("models_registry: initial refresh discovered {} models", n);

        let mut last_cloud = std::time::Instant::now();
        loop {
            tokio::select! {
                _ = registry.notify.notified() => {
                    // On-demand refresh (e.g. provider added/updated).
                    let n = registry.refresh_all(false).await;
                    tracing::info!("models_registry: on-demand refresh found {} models", n);
                    last_cloud = std::time::Instant::now();
                }
                _ = tokio::time::sleep(LOCAL_REFRESH_INTERVAL) => {
                    let need_cloud = last_cloud.elapsed() >= CLOUD_REFRESH_INTERVAL;
                    let _ = registry.refresh_all(!need_cloud).await;
                    if need_cloud {
                        last_cloud = std::time::Instant::now();
                    }
                }
            }
        }
    });
}
