//! App system-event hooks — dispatch `OnSystemEvent` lifecycle hooks.
//!
//! Apps declare lifecycle hooks in their manifest (`lifecycle_hooks.hooks`):
//!
//! ```json
//! {
//!   "lifecycle_hooks": {
//!     "hooks": [
//!       { "event": "on_system_event", "handler": "/hooks/system-event", "filter": "error" }
//!     ]
//!   }
//! }
//! ```
//!
//! When a system event is recorded, iora-home resolves each app's runtime
//! target (docker-published port) and POSTs the event payload to
//! `http://<host>:<port><handler>`. The optional `filter` is a glob matched
//! against `severity` and `source` (`error`, `backup.*`, ...). The fan-out is
//! best-effort and time-boxed so a slow or unreachable app never blocks the
//! event pipeline.

use serde_json::json;
use tracing::debug;

use iora_shared::app_capabilities::LifecycleEvent;

use crate::local_appstore::LocalAppStore;
use crate::system_events::SystemEventHookEvent;

/// Simple `*`/`?` glob matcher (case-insensitive).
fn glob_match(pattern: &str, value: &str) -> bool {
    let pattern = pattern.to_lowercase();
    let value = value.to_lowercase();
    let p: Vec<char> = pattern.chars().collect();
    let v: Vec<char> = value.chars().collect();
    let (mut pi, mut vi) = (0usize, 0usize);
    let (mut star, mut mark) = (None, 0usize);
    while vi < v.len() {
        if pi < p.len() && (p[pi] == '?' || p[pi] == v[vi]) {
            pi += 1;
            vi += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star = Some(pi);
            mark = vi;
            pi += 1;
        } else if let Some(s) = star {
            pi = s + 1;
            mark += 1;
            vi = mark;
        } else {
            return false;
        }
    }
    while pi < p.len() && p[pi] == '*' {
        pi += 1;
    }
    pi == p.len()
}

/// Deliver a system event to every app with an `on_system_event` hook whose
/// filter matches the event.
pub async fn dispatch_to_apps(store: &LocalAppStore, event: &SystemEventHookEvent) {
    let apps = store.list().await;
    for app in apps {
        // local_appstore::AppManifest round-trips unknown manifest fields in
        // `extra`; parse the v2.4 lifecycle hooks from there.
        let hooks: Option<iora_shared::app_capabilities::LifecycleHooks> = app
            .manifest
            .extra
            .get("lifecycle_hooks")
            .and_then(|value| serde_json::from_value(value.clone()).ok());
        let Some(hooks) = hooks else {
            continue;
        };
        let Some(hook) = hooks
            .hooks
            .iter()
            .find(|h| matches!(h.event, LifecycleEvent::OnSystemEvent))
        else {
            continue;
        };

        // Filter: glob against severity, source or "severity:source"
        // (e.g. `error`, `backup.*`, `error:backup`).
        if let Some(filter) = hook.filter.as_deref() {
            let severity_source = format!("{}:{}", event.severity, event.source);
            let matches = glob_match(filter, &event.severity)
                || glob_match(filter, &event.source)
                || glob_match(filter, &severity_source);
            if !matches {
                continue;
            }
        }

        let Some(target) = crate::app_gateway::resolve_runtime_target(store, &app).await else {
            debug!(
                "system-event hook: app {} has no resolvable runtime target — skipping",
                app.id
            );
            continue;
        };

        let handler = hook.handler.trim_start_matches('/');
        let url = format!("http://{}/{}", target.addr(), handler);
        let payload = json!({
            "event": "system_event",
            "severity": event.severity,
            "source": event.source,
            "message": event.message,
            "timestamp": chrono::Utc::now().to_rfc3339(),
        });

        let client = reqwest::Client::new();
        match client
            .post(&url)
            .json(&payload)
            .timeout(std::time::Duration::from_secs(3))
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {}
            Ok(resp) => {
                debug!(
                    "system-event hook: app {} returned HTTP {}",
                    app.id,
                    resp.status()
                )
            }
            Err(e) => {
                debug!("system-event hook: app {} unreachable: {}", app.id, e);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::glob_match;

    #[test]
    fn glob_matches_basic() {
        assert!(glob_match("error", "error"));
        assert!(glob_match("backup*", "backup"));
        assert!(glob_match("backup.*", "backup.job"));
        assert!(glob_match("backup*", "backup"));
        assert!(glob_match("backup.*", "backup.job"));
        assert!(glob_match("*", "anything"));
        assert!(glob_match("?rror", "error"));
        assert!(!glob_match("backup.*", "update:done"));
        assert!(!glob_match("error", "warning"));
    }
}
