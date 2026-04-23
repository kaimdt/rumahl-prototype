use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};
use tracing::{info, warn};
use rumqttc::{AsyncClient, MqttOptions, QoS, Event, Packet};

/// Holds the MQTT connection configuration
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MqttConfig {
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
    pub client_id: String,
    pub use_tls: bool,
}

impl Default for MqttConfig {
    fn default() -> Self {
        Self {
            host: "localhost".into(),
            port: 1883,
            username: None,
            password: None,
            client_id: format!("mdt-dashboard-{}", uuid::Uuid::new_v4().to_string()[..8].to_string()),
            use_tls: false,
        }
    }
}

/// Status of the MQTT connection
#[derive(Debug, Clone, serde::Serialize)]
pub struct MqttStatus {
    pub connected: bool,
    pub config: Option<MqttConfigSafe>,
    pub subscribed_topics: Vec<String>,
    pub message_count: u64,
    pub last_message_at: Option<String>,
    pub error: Option<String>,
}

/// Safe version of config (password masked)
#[derive(Debug, Clone, serde::Serialize)]
pub struct MqttConfigSafe {
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub has_password: bool,
    pub client_id: String,
    pub use_tls: bool,
}

impl From<&MqttConfig> for MqttConfigSafe {
    fn from(c: &MqttConfig) -> Self {
        Self {
            host: c.host.clone(),
            port: c.port,
            username: c.username.clone(),
            has_password: c.password.is_some(),
            client_id: c.client_id.clone(),
            use_tls: c.use_tls,
        }
    }
}

/// Received MQTT message
#[derive(Debug, Clone, serde::Serialize)]
pub struct MqttMessage {
    pub topic: String,
    pub payload: String,
    pub qos: u8,
    pub retain: bool,
    pub received_at: String,
}

pub struct MqttClient {
    client: Mutex<Option<AsyncClient>>,
    config: RwLock<Option<MqttConfig>>,
    connected: RwLock<bool>,
    subscribed_topics: RwLock<Vec<String>>,
    recent_messages: RwLock<Vec<MqttMessage>>,
    message_count: RwLock<u64>,
    last_message_at: RwLock<Option<String>>,
    last_error: RwLock<Option<String>>,
    topic_values: RwLock<HashMap<String, MqttMessage>>,
}

impl MqttClient {
    pub fn new() -> Self {
        Self {
            client: Mutex::new(None),
            config: RwLock::new(None),
            connected: RwLock::new(false),
            subscribed_topics: RwLock::new(Vec::new()),
            recent_messages: RwLock::new(Vec::new()),
            message_count: RwLock::new(0),
            last_message_at: RwLock::new(None),
            last_error: RwLock::new(None),
            topic_values: RwLock::new(HashMap::new()),
        }
    }

    /// Connect to MQTT broker with the given config
    pub async fn connect(self: &Arc<Self>, config: MqttConfig) -> Result<(), String> {
        // Disconnect existing connection
        self.disconnect().await;

        let mut opts = MqttOptions::new(&config.client_id, &config.host, config.port);
        opts.set_keep_alive(std::time::Duration::from_secs(30));

        if let (Some(user), Some(pass)) = (&config.username, &config.password) {
            opts.set_credentials(user, pass);
        }

        let (client, mut eventloop) = AsyncClient::new(opts, 256);

        *self.client.lock().await = Some(client);
        *self.config.write().await = Some(config.clone());
        *self.last_error.write().await = None;

        info!("MQTT: Connecting to {}:{} ...", config.host, config.port);

        // Spawn event loop handler
        let mqtt_ref = Arc::clone(self);
        tokio::spawn(async move {
            loop {
                match eventloop.poll().await {
                    Ok(Event::Incoming(Packet::ConnAck(_))) => {
                        info!("MQTT: Connected to broker");
                        *mqtt_ref.connected.write().await = true;
                        *mqtt_ref.last_error.write().await = None;

                        // Re-subscribe to all topics
                        let topics = mqtt_ref.subscribed_topics.read().await.clone();
                        if let Some(client) = &*mqtt_ref.client.lock().await {
                            for topic in &topics {
                                let _ = client.subscribe(topic, QoS::AtMostOnce).await;
                            }
                        }
                    }
                    Ok(Event::Incoming(Packet::Publish(publish))) => {
                        let payload = String::from_utf8_lossy(&publish.payload).to_string();
                        let now = chrono::Utc::now().to_rfc3339();
                        let msg = MqttMessage {
                            topic: publish.topic.clone(),
                            payload,
                            qos: publish.qos as u8,
                            retain: publish.retain,
                            received_at: now.clone(),
                        };

                        // Update topic value map
                        mqtt_ref.topic_values.write().await.insert(publish.topic.clone(), msg.clone());

                        // Store recent messages (keep last 100)
                        let mut recent = mqtt_ref.recent_messages.write().await;
                        recent.push(msg);
                        let len = recent.len();
                        if len > 100 {
                            recent.drain(0..len - 100);
                        }

                        *mqtt_ref.message_count.write().await += 1;
                        *mqtt_ref.last_message_at.write().await = Some(now);
                    }
                    Ok(Event::Incoming(Packet::Disconnect)) => {
                        warn!("MQTT: Disconnected by broker");
                        *mqtt_ref.connected.write().await = false;
                    }
                    Err(e) => {
                        let err_msg = format!("{}", e);
                        // Only log connection errors, not routine polling
                        if mqtt_ref.connected.read().await.clone() {
                            warn!("MQTT: Connection error: {}", err_msg);
                        }
                        *mqtt_ref.connected.write().await = false;
                        *mqtt_ref.last_error.write().await = Some(err_msg);
                        // Wait before reconnect attempt
                        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                    }
                    _ => {}
                }
            }
        });

        Ok(())
    }

    /// Disconnect from broker
    pub async fn disconnect(&self) {
        if let Some(client) = self.client.lock().await.take() {
            let _ = client.disconnect().await;
        }
        *self.connected.write().await = false;
    }

    /// Subscribe to a topic
    pub async fn subscribe(&self, topic: &str) -> Result<(), String> {
        let client = self.client.lock().await;
        if let Some(c) = &*client {
            c.subscribe(topic, QoS::AtMostOnce)
                .await
                .map_err(|e| format!("Subscribe failed: {}", e))?;
            let mut topics = self.subscribed_topics.write().await;
            if !topics.contains(&topic.to_string()) {
                topics.push(topic.to_string());
            }
            Ok(())
        } else {
            Err("Not connected".into())
        }
    }

    /// Unsubscribe from a topic
    pub async fn unsubscribe(&self, topic: &str) -> Result<(), String> {
        let client = self.client.lock().await;
        if let Some(c) = &*client {
            c.unsubscribe(topic)
                .await
                .map_err(|e| format!("Unsubscribe failed: {}", e))?;
            self.subscribed_topics.write().await.retain(|t| t != topic);
            Ok(())
        } else {
            Err("Not connected".into())
        }
    }

    /// Publish a message
    pub async fn publish(&self, topic: &str, payload: &str, retain: bool) -> Result<(), String> {
        let client = self.client.lock().await;
        if let Some(c) = &*client {
            c.publish(topic, QoS::AtLeastOnce, retain, payload.as_bytes())
                .await
                .map_err(|e| format!("Publish failed: {}", e))?;
            Ok(())
        } else {
            Err("Not connected".into())
        }
    }

    /// Get current status
    pub async fn status(&self) -> MqttStatus {
        let config_safe = self.config.read().await.as_ref().map(|c| MqttConfigSafe::from(c));
        MqttStatus {
            connected: *self.connected.read().await,
            config: config_safe,
            subscribed_topics: self.subscribed_topics.read().await.clone(),
            message_count: *self.message_count.read().await,
            last_message_at: self.last_message_at.read().await.clone(),
            error: self.last_error.read().await.clone(),
        }
    }

    /// Get recent messages
    pub async fn recent_messages(&self) -> Vec<MqttMessage> {
        self.recent_messages.read().await.clone()
    }

    /// Get latest values for all subscribed topics
    pub async fn topic_values(&self) -> HashMap<String, MqttMessage> {
        self.topic_values.read().await.clone()
    }
}
