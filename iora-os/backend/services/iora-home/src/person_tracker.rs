//! Person Tracker – background service that monitors person entities from Home
//! Assistant and stores movement data in PostgreSQL for long-term analytics and
//! presence-based automation.

use chrono::Utc;
use serde::Deserialize;
use sqlx::PgPool;
use std::{collections::HashMap, sync::Arc, time::Duration};
use tokio::sync::RwLock;
use tracing::{debug, info, warn};

// ─── Public re-export ────────────────────────────────────────────────────────

pub use tracker::PersonTracker;

// ─── HA entity shapes ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
pub struct HaPersonAttributes {
    pub friendly_name: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub gps_accuracy: Option<i32>,
    pub source: Option<String>,
    #[serde(flatten)]
    pub extra: serde_json::Value,
}

// ─── Internal state ──────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
struct PersonState {
    current_location: String,
    arrived_at: chrono::DateTime<Utc>,
    row_id: i64,
}

mod tracker {
    use super::*;
    use crate::ha_client::HomeAssistantClient;

    pub struct PersonTracker {
        pool: PgPool,
        ha_client: Arc<HomeAssistantClient>,
        /// entity_id → active location record
        active: RwLock<HashMap<String, PersonState>>,
    }

    impl PersonTracker {
        pub fn new(pool: PgPool, ha_client: Arc<HomeAssistantClient>) -> Arc<Self> {
            Arc::new(Self {
                pool,
                ha_client,
                active: RwLock::new(HashMap::new()),
            })
        }

        /// Spawns the background polling loop. Returns immediately.
        pub fn start(self: Arc<Self>) {
            let this = self.clone();
            tokio::spawn(async move {
                this.run().await;
            });
        }

        async fn run(&self) {
            info!("PersonTracker starting background poll loop");
            let mut interval = tokio::time::interval(Duration::from_secs(30));
            loop {
                interval.tick().await;
                if let Err(e) = self.poll_once().await {
                    warn!("PersonTracker poll error: {}", e);
                }
            }
        }

        #[allow(clippy::unnecessary_filter_map)]
        async fn poll_once(&self) -> anyhow::Result<()> {
            let states = self.ha_client.get_states().await?;
            let persons: Vec<(String, String, HaPersonAttributes, String)> = states
                .into_iter()
                .filter(|e| e.entity_id.starts_with("person."))
                .filter_map(|e| {
                    let attrs: HaPersonAttributes = serde_json::from_value(e.attributes.clone())
                        .unwrap_or(HaPersonAttributes {
                            friendly_name: None,
                            latitude: None,
                            longitude: None,
                            gps_accuracy: None,
                            source: None,
                            extra: e.attributes,
                        });
                    Some((e.entity_id, e.state, attrs, e.last_changed))
                })
                .collect();

            debug!("PersonTracker: found {} person entities", persons.len());

            for (entity_id, state, attrs, _last_changed) in persons {
                if let Err(e) = self.handle_person(&entity_id, &state, &attrs).await {
                    warn!("PersonTracker error for {}: {}", entity_id, e);
                }
            }

            if let Err(e) = self.evaluate_automations().await {
                warn!("PersonTracker automation eval error: {}", e);
            }

            Ok(())
        }

        async fn handle_person(
            &self,
            entity_id: &str,
            location: &str,
            attrs: &HaPersonAttributes,
        ) -> anyhow::Result<()> {
            let person_name = attrs
                .friendly_name
                .clone()
                .unwrap_or_else(|| entity_id.replace("person.", ""));
            let now = Utc::now();

            let prev_opt = {
                let map = self.active.read().await;
                map.get(entity_id).cloned()
            };

            match prev_opt {
                None => {
                    let row_id = self
                        .insert_location(entity_id, &person_name, location, attrs, now)
                        .await?;
                    self.active.write().await.insert(
                        entity_id.to_string(),
                        PersonState {
                            current_location: location.to_string(),
                            arrived_at: now,
                            row_id,
                        },
                    );
                }

                Some(prev) if prev.current_location == location => {}

                Some(prev) => {
                    let duration_secs = (now - prev.arrived_at).num_seconds() as i32;
                    self.close_location(prev.row_id, now, duration_secs).await?;

                    let summary_date = prev.arrived_at.date_naive();
                    self.update_daily_summary(
                        entity_id,
                        summary_date,
                        &prev.current_location,
                        duration_secs,
                        prev.arrived_at,
                        now,
                    )
                    .await?;

                    let row_id = self
                        .insert_location(entity_id, &person_name, location, attrs, now)
                        .await?;
                    self.active.write().await.insert(
                        entity_id.to_string(),
                        PersonState {
                            current_location: location.to_string(),
                            arrived_at: now,
                            row_id,
                        },
                    );

                    info!(
                        "PersonTracker: {} moved from '{}' to '{}' (was there for {}s)",
                        entity_id, prev.current_location, location, duration_secs
                    );
                }
            }

            Ok(())
        }

        async fn insert_location(
            &self,
            entity_id: &str,
            person_name: &str,
            location: &str,
            attrs: &HaPersonAttributes,
            started_at: chrono::DateTime<Utc>,
        ) -> anyhow::Result<i64> {
            let attrs_json = attrs.extra.clone();
            let row: (i64,) = sqlx::query_as(
                r#"
                INSERT INTO person_location_history
                    (person_entity_id, person_name, location_state, latitude, longitude,
                     gps_accuracy, source, attributes, started_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                RETURNING id
                "#,
            )
            .bind(entity_id)
            .bind(person_name)
            .bind(location)
            .bind(attrs.latitude)
            .bind(attrs.longitude)
            .bind(attrs.gps_accuracy)
            .bind(attrs.source.as_deref())
            .bind(sqlx::types::Json(attrs_json))
            .bind(started_at)
            .fetch_one(&self.pool)
            .await?;
            Ok(row.0)
        }

        async fn close_location(
            &self,
            row_id: i64,
            ended_at: chrono::DateTime<Utc>,
            duration_seconds: i32,
        ) -> anyhow::Result<()> {
            sqlx::query(
                "UPDATE person_location_history SET ended_at = $1, duration_seconds = $2 WHERE id = $3",
            )
            .bind(ended_at)
            .bind(duration_seconds)
            .bind(row_id)
            .execute(&self.pool)
            .await?;
            Ok(())
        }

        async fn update_daily_summary(
            &self,
            entity_id: &str,
            date: chrono::NaiveDate,
            location: &str,
            duration_secs: i32,
            started_at: chrono::DateTime<Utc>,
            ended_at: chrono::DateTime<Utc>,
        ) -> anyhow::Result<()> {
            let existing: Option<(i64, serde_json::Value, i32)> = sqlx::query_as(
                "SELECT id, location_breakdown, time_at_home_seconds FROM person_daily_summary WHERE person_entity_id = $1 AND summary_date = $2"
            )
            .bind(entity_id)
            .bind(date)
            .fetch_optional(&self.pool)
            .await?;

            let is_home = location == "home";

            match existing {
                None => {
                    let mut breakdown = serde_json::json!({});
                    breakdown[location] = serde_json::json!(duration_secs);
                    let time_at_home = if is_home { duration_secs } else { 0 };
                    sqlx::query(
                        r#"
                        INSERT INTO person_daily_summary
                            (person_entity_id, summary_date, location_breakdown,
                             most_visited_location, time_at_home_seconds,
                             first_departure_at, last_return_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7)
                        "#,
                    )
                    .bind(entity_id)
                    .bind(date)
                    .bind(sqlx::types::Json(&breakdown))
                    .bind(location)
                    .bind(time_at_home)
                    .bind(if !is_home { Some(started_at) } else { None })
                    .bind(if is_home { Some(ended_at) } else { None })
                    .execute(&self.pool)
                    .await?;
                }
                Some((id, mut breakdown, existing_home_secs)) => {
                    let prev = breakdown[location].as_i64().unwrap_or(0) as i32;
                    breakdown[location] = serde_json::json!(prev + duration_secs);

                    let most_visited = breakdown
                        .as_object()
                        .and_then(|obj| {
                            obj.iter()
                                .max_by_key(|(_, v)| v.as_i64().unwrap_or(0))
                                .map(|(k, _)| k.clone())
                        })
                        .unwrap_or_else(|| location.to_string());

                    let new_home_secs = if is_home {
                        existing_home_secs + duration_secs
                    } else {
                        existing_home_secs
                    };

                    sqlx::query(
                        r#"
                        UPDATE person_daily_summary
                        SET location_breakdown = $1,
                            most_visited_location = $2,
                            time_at_home_seconds = $3,
                            computed_at = NOW()
                        WHERE id = $4
                        "#,
                    )
                    .bind(sqlx::types::Json(&breakdown))
                    .bind(&most_visited)
                    .bind(new_home_secs)
                    .bind(id)
                    .execute(&self.pool)
                    .await?;
                }
            }

            Ok(())
        }

        #[allow(clippy::type_complexity)]
        async fn evaluate_automations(&self) -> anyhow::Result<()> {
            let rules: Vec<(
                String,
                String,
                serde_json::Value,
                serde_json::Value,
                i32,
                Option<chrono::DateTime<Utc>>,
            )> = sqlx::query_as(
                r#"
                SELECT id, rule_type, trigger_config, action_config, cooldown_seconds, last_triggered_at
                FROM automation_rules
                WHERE enabled = TRUE
                "#,
            )
            .fetch_all(&self.pool)
            .await?;

            let active = self.active.read().await;
            let now = Utc::now();

            for (rule_id, rule_type, trigger_config, action_config, cooldown, last_triggered) in
                rules
            {
                if let Some(last) = last_triggered {
                    if (now - last).num_seconds() < cooldown as i64 {
                        continue;
                    }
                }

                let triggered = match rule_type.as_str() {
                    "departure_light" => {
                        let person_id = trigger_config["person_entity_id"].as_str().unwrap_or("");
                        if let Some(state) = active.get(person_id) {
                            state.current_location != "home"
                                && (now - state.arrived_at).num_seconds() < 120
                        } else {
                            false
                        }
                    }
                    "arrival_light" => {
                        let person_id = trigger_config["person_entity_id"].as_str().unwrap_or("");
                        if let Some(state) = active.get(person_id) {
                            state.current_location == "home"
                                && (now - state.arrived_at).num_seconds() < 120
                        } else {
                            false
                        }
                    }
                    _ => false,
                };

                if triggered {
                    if let Err(e) = self
                        .execute_automation(&rule_id, &action_config, &trigger_config)
                        .await
                    {
                        warn!("Automation rule {} failed: {}", rule_id, e);
                    }
                }
            }

            Ok(())
        }

        async fn execute_automation(
            &self,
            rule_id: &str,
            action: &serde_json::Value,
            trigger_data: &serde_json::Value,
        ) -> anyhow::Result<()> {
            let entity_id = action["entity_id"].as_str().unwrap_or("");
            let service = action["service"].as_str().unwrap_or("");
            let mut call_data = action.get("data").cloned().unwrap_or(serde_json::json!({}));

            info!(
                "Automation {}: calling {} on {}",
                rule_id, service, entity_id
            );

            let (domain, service_name) = service
                .split_once('/')
                .ok_or_else(|| anyhow::anyhow!("invalid service format: {}", service))?;

            if let Some(obj) = call_data.as_object_mut() {
                obj.insert("entity_id".to_string(), serde_json::json!(entity_id));
            }

            match self
                .ha_client
                .call_service(domain, service_name, call_data.clone(), "")
                .await
            {
                Ok(_) => {
                    sqlx::query(
                        "INSERT INTO automation_executions (rule_id, triggered_by, trigger_data, success, result) VALUES ($1, $2, $3, $4, $5)",
                    )
                    .bind(rule_id)
                    .bind("person_tracker")
                    .bind(sqlx::types::Json(trigger_data))
                    .bind(true)
                    .bind(sqlx::types::Json(serde_json::json!({"called": service, "entity": entity_id})))
                    .execute(&self.pool)
                    .await?;

                    sqlx::query(
                        "UPDATE automation_rules SET last_triggered_at = NOW(), trigger_count = trigger_count + 1 WHERE id = $1",
                    )
                    .bind(rule_id)
                    .execute(&self.pool)
                    .await?;

                    info!("Automation {} executed successfully", rule_id);
                }
                Err(e) => {
                    sqlx::query(
                        "INSERT INTO automation_executions (rule_id, triggered_by, trigger_data, success, error) VALUES ($1, $2, $3, $4, $5)",
                    )
                    .bind(rule_id)
                    .bind("person_tracker")
                    .bind(sqlx::types::Json(trigger_data))
                    .bind(false)
                    .bind(e.to_string())
                    .execute(&self.pool)
                    .await?;

                    return Err(anyhow::anyhow!("{}", e));
                }
            }

            Ok(())
        }
    }
}
