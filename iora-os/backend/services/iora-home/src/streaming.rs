use axum::extract::ws::{Message, WebSocket};
use futures_util::{sink::SinkExt, stream::StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
use tracing::{info, warn};
use uuid::Uuid;

/// Maximum number of concurrent streams
const MAX_STREAMS: usize = 10;
/// Broadcast channel capacity per stream — must be large enough so viewers
/// don't lag behind while the sender pushes 200ms WebM chunks at high FPS.
const CHANNEL_CAPACITY: usize = 128;
/// Maximum chunks to buffer per segment (prevents unbounded memory growth).
/// At 100ms timeslice / 3s restart cycle, this is ~30 chunks + some headroom.
const MAX_SEGMENT_BUFFER: usize = 60;
/// EBML magic bytes — first 4 bytes of any WebM/Matroska file
const EBML_MAGIC: [u8; 4] = [0x1A, 0x45, 0xDF, 0xA3];

/// A stream session managed by the streaming server
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamSession {
    pub id: String,
    pub name: String,
    pub description: String,
    pub status: StreamStatus,
    pub created_at: String,
    pub source_type: StreamSourceType,
    /// Optional direct URL (for RTMP/HLS/WHEP sources that frontend can play directly)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
    /// Number of currently connected viewers
    pub viewer_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum StreamStatus {
    /// Stream session is created but no source is pushing frames
    Waiting,
    /// Source is actively pushing frames
    Live,
    /// Stream has been stopped
    Stopped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StreamSourceType {
    /// Frames pushed via WebSocket relay (ingest → viewers)
    WebsocketRelay,
    /// External URL (RTMP/HLS/DASH) — frontend plays directly
    ExternalUrl,
}

#[derive(Debug, Deserialize)]
pub struct CreateStreamRequest {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_source_type")]
    pub source_type: StreamSourceType,
    /// Required when source_type is "external_url"
    #[serde(default)]
    pub source_url: Option<String>,
}

fn default_source_type() -> StreamSourceType {
    StreamSourceType::WebsocketRelay
}

#[derive(Debug, Deserialize)]
pub struct UpdateStreamRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub source_url: Option<String>,
}

/// Internal state for a single stream including its broadcast channel
struct StreamState {
    session: StreamSession,
    /// Sender side of the broadcast channel for WebSocket relay streams.
    /// Viewers subscribe to this channel.
    relay_tx: broadcast::Sender<Vec<u8>>,
    /// Ingest secret token (only the creator gets this)
    ingest_token: String,
    /// Viewer count tracking
    viewer_count: Arc<std::sync::atomic::AtomicU32>,
    /// Buffered WebM chunks since the last init segment (MediaRecorder restart).
    /// The first entry is always the init segment (EBML header + Tracks + keyframe).
    /// Sent in full to new viewers so they get a complete, decodable sequence.
    segment_buffer: Arc<RwLock<Vec<Vec<u8>>>>,
    /// Latest JPEG snapshot for the feed view
    latest_snapshot: Arc<RwLock<Option<Vec<u8>>>>,
}

/// Manages all active stream sessions
pub struct StreamManager {
    streams: RwLock<HashMap<String, StreamState>>,
}

impl StreamManager {
    pub fn new() -> Self {
        Self {
            streams: RwLock::new(HashMap::new()),
        }
    }

    /// Create a new stream session. Returns the session info plus a secret
    /// ingest token for WebSocket relay streams.
    pub async fn create_stream(
        &self,
        req: CreateStreamRequest,
    ) -> Result<(StreamSession, String), String> {
        let mut streams = self.streams.write().await;
        if streams.len() >= MAX_STREAMS {
            return Err("Maximum number of concurrent streams reached".into());
        }

        let id = Uuid::new_v4().to_string();
        let ingest_token = Uuid::new_v4().to_string();
        let (relay_tx, _) = broadcast::channel(CHANNEL_CAPACITY);

        // Validate external URL if provided
        if let StreamSourceType::ExternalUrl = &req.source_type {
            if req.source_url.is_none() {
                return Err("source_url is required for external_url source type".into());
            }
        }

        let session = StreamSession {
            id: id.clone(),
            name: req.name,
            description: req.description,
            status: match req.source_type {
                StreamSourceType::ExternalUrl => StreamStatus::Live,
                StreamSourceType::WebsocketRelay => StreamStatus::Waiting,
            },
            created_at: chrono::Utc::now().to_rfc3339(),
            source_type: req.source_type,
            source_url: req.source_url,
            viewer_count: 0,
        };

        let state = StreamState {
            session: session.clone(),
            relay_tx,
            ingest_token: ingest_token.clone(),
            viewer_count: Arc::new(std::sync::atomic::AtomicU32::new(0)),
            segment_buffer: Arc::new(RwLock::new(Vec::new())),
            latest_snapshot: Arc::new(RwLock::new(None)),
        };

        streams.insert(id, state);
        info!("Stream created: {} ({})", session.name, session.id);
        Ok((session, ingest_token))
    }

    /// List all active (non-stopped) streams
    pub async fn list_streams(&self) -> Vec<StreamSession> {
        let streams = self.streams.read().await;
        streams
            .values()
            .filter(|s| s.session.status != StreamStatus::Stopped)
            .map(|s| {
                let mut session = s.session.clone();
                session.viewer_count = s.viewer_count.load(std::sync::atomic::Ordering::Relaxed);
                session
            })
            .collect()
    }

    /// Get a specific stream by ID
    pub async fn get_stream(&self, id: &str) -> Option<StreamSession> {
        let streams = self.streams.read().await;
        streams.get(id).map(|s| {
            let mut session = s.session.clone();
            session.viewer_count = s.viewer_count.load(std::sync::atomic::Ordering::Relaxed);
            session
        })
    }

    /// Update stream metadata
    pub async fn update_stream(&self, id: &str, req: UpdateStreamRequest) -> Option<StreamSession> {
        let mut streams = self.streams.write().await;
        let state = streams.get_mut(id)?;
        if let Some(name) = req.name {
            state.session.name = name;
        }
        if let Some(desc) = req.description {
            state.session.description = desc;
        }
        if let Some(url) = req.source_url {
            state.session.source_url = Some(url);
        }
        Some(state.session.clone())
    }

    /// Stop and remove a stream
    pub async fn stop_stream(&self, id: &str) -> bool {
        let mut streams = self.streams.write().await;
        if let Some(mut state) = streams.remove(id) {
            state.session.status = StreamStatus::Stopped;
            info!("Stream stopped: {} ({})", state.session.name, id);
            true
        } else {
            false
        }
    }

    /// Validate an ingest token for a stream. Returns the stream ID if valid.
    pub async fn validate_ingest(&self, stream_id: &str, token: &str) -> bool {
        let streams = self.streams.read().await;
        streams
            .get(stream_id)
            .map(|s| s.ingest_token == token)
            .unwrap_or(false)
    }

    /// Mark a stream as live (called when ingest source connects)
    pub async fn set_live(&self, stream_id: &str) {
        let mut streams = self.streams.write().await;
        if let Some(state) = streams.get_mut(stream_id) {
            state.session.status = StreamStatus::Live;
            info!("Stream is now live: {}", stream_id);
        }
    }

    /// Mark a stream as waiting (called when ingest source disconnects)
    pub async fn set_waiting(&self, stream_id: &str) {
        let mut streams = self.streams.write().await;
        if let Some(state) = streams.get_mut(stream_id) {
            state.session.status = StreamStatus::Waiting;
            info!("Stream source disconnected: {}", stream_id);
        }
    }

    /// Get a broadcast sender for a stream (for publishing frames)
    pub async fn get_relay_tx(
        &self,
        stream_id: &str,
    ) -> Option<(broadcast::Sender<Vec<u8>>, Arc<RwLock<Vec<Vec<u8>>>>)> {
        let streams = self.streams.read().await;
        streams
            .get(stream_id)
            .map(|s| (s.relay_tx.clone(), s.segment_buffer.clone()))
    }

    /// Subscribe to a stream's relay channel (for viewing frames)
    pub async fn subscribe(
        &self,
        stream_id: &str,
    ) -> Option<(
        broadcast::Receiver<Vec<u8>>,
        Arc<std::sync::atomic::AtomicU32>,
        Vec<Vec<u8>>,
    )> {
        let (rx, counter, seg_buf) = {
            let streams = self.streams.read().await;
            match streams.get(stream_id) {
                Some(s) => {
                    let rx = s.relay_tx.subscribe();
                    let counter = s.viewer_count.clone();
                    counter.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    (rx, counter, s.segment_buffer.clone())
                }
                None => return None,
            }
        };
        let buffered = seg_buf.read().await.clone();
        Some((rx, counter, buffered))
    }

    /// Store a JPEG snapshot for a stream
    pub async fn set_snapshot(&self, stream_id: &str, data: Vec<u8>) -> bool {
        let streams = self.streams.read().await;
        if let Some(s) = streams.get(stream_id) {
            *s.latest_snapshot.write().await = Some(data);
            true
        } else {
            false
        }
    }

    /// Get the latest JPEG snapshot for a stream
    pub async fn get_snapshot(&self, stream_id: &str) -> Option<Vec<u8>> {
        let streams = self.streams.read().await;
        let snapshot_arc = match streams.get(stream_id) {
            Some(s) => s.latest_snapshot.clone(),
            None => return None,
        };
        drop(streams);
        let guard = snapshot_arc.read().await;
        guard.clone()
    }
}

// ─── WebSocket Handlers ─────────────────────────────────────────────────

/// Handle the ingest WebSocket connection (OBS / capture source pushes frames here).
///
/// Protocol:
/// 1. Source sends a text message: `{"type":"auth","stream_id":"...","token":"..."}`
/// 2. Backend validates and responds with `{"type":"auth_ok"}`
/// 3. Source sends binary messages (JPEG/PNG/H.264 frames)
/// 4. Backend broadcasts to all viewers
pub async fn handle_stream_ingest(socket: WebSocket, manager: Arc<StreamManager>) {
    let (mut ws_tx, mut ws_rx) = socket.split();

    // 1) Wait for auth message
    let (stream_id, relay_tx, segment_buffer) = match ws_rx.next().await {
        Some(Ok(Message::Text(text))) => {
            #[derive(Deserialize)]
            struct AuthMsg {
                stream_id: String,
                token: String,
            }
            match serde_json::from_str::<AuthMsg>(&text) {
                Ok(auth) => {
                    if !manager.validate_ingest(&auth.stream_id, &auth.token).await {
                        let _ = ws_tx
                            .send(Message::Text(
                                serde_json::json!({"type":"auth_failed","message":"Invalid token"})
                                    .to_string(),
                            ))
                            .await;
                        return;
                    }
                    let (tx, init_store) = match manager.get_relay_tx(&auth.stream_id).await {
                        Some(pair) => pair,
                        None => return,
                    };
                    let _ = ws_tx
                        .send(Message::Text(
                            serde_json::json!({"type":"auth_ok"}).to_string(),
                        ))
                        .await;
                    (auth.stream_id, tx, init_store)
                }
                Err(_) => {
                    let _ = ws_tx
                        .send(Message::Text(
                            serde_json::json!({"type":"error","message":"Invalid auth message"})
                                .to_string(),
                        ))
                        .await;
                    return;
                }
            }
        }
        _ => return,
    };

    // 2) Mark stream as live & clear old segment buffer
    manager.set_live(&stream_id).await;
    {
        segment_buffer.write().await.clear();
    }
    info!("Stream ingest connected: {}", stream_id);

    // 3) Relay incoming binary frames to all viewers
    while let Some(Ok(msg)) = ws_rx.next().await {
        match msg {
            Message::Binary(data) => {
                let bytes = data.to_vec();
                // Detect new init segment (MediaRecorder restart) by EBML magic bytes.
                // When detected, reset the buffer so it always starts from a fresh keyframe.
                let is_init = bytes.len() >= 4 && bytes[..4] == EBML_MAGIC;
                {
                    let mut buf = segment_buffer.write().await;
                    if is_init {
                        buf.clear();
                    }
                    // Cap buffer size to prevent unbounded memory growth
                    if buf.len() < MAX_SEGMENT_BUFFER {
                        buf.push(bytes.clone());
                    }
                }
                // Broadcast frame to viewers (ignore errors — means no receivers)
                let _ = relay_tx.send(bytes);
            }
            Message::Close(_) => break,
            _ => {} // Ignore text/ping/pong
        }
    }

    // 4) Source disconnected
    manager.set_waiting(&stream_id).await;
    info!("Stream ingest disconnected: {}", stream_id);
}

/// Handle a viewer WebSocket connection (dashboard watches stream here).
///
/// Protocol:
/// 1. Viewer sends text: `{"type":"watch","stream_id":"..."}`
/// 2. Backend responds with `{"type":"watching","stream_id":"..."}`
/// 3. Backend forwards binary frames from the ingest source
pub async fn handle_stream_watch(socket: WebSocket, manager: Arc<StreamManager>) {
    let (mut ws_tx, mut ws_rx) = socket.split();

    // 1) Wait for watch request
    let (stream_id, mut relay_rx, viewer_counter, buffered_chunks) = match ws_rx.next().await {
        Some(Ok(Message::Text(text))) => {
            #[derive(Deserialize)]
            struct WatchMsg {
                stream_id: String,
            }
            match serde_json::from_str::<WatchMsg>(&text) {
                Ok(watch) => match manager.subscribe(&watch.stream_id).await {
                    Some((rx, counter, init)) => {
                        let _ = ws_tx
                            .send(Message::Text(
                                serde_json::json!({
                                    "type": "watching",
                                    "stream_id": watch.stream_id
                                })
                                .to_string(),
                            ))
                            .await;
                        (watch.stream_id, rx, counter, init)
                    }
                    None => {
                        let _ = ws_tx
                            .send(Message::Text(
                                serde_json::json!({
                                    "type": "error",
                                    "message": "Stream not found"
                                })
                                .to_string(),
                            ))
                            .await;
                        return;
                    }
                },
                Err(_) => return,
            }
        }
        _ => return,
    };

    info!(
        "Viewer connected to stream: {} ({} buffered chunks)",
        stream_id,
        buffered_chunks.len()
    );

    // 2) Send all buffered chunks so the viewer gets a complete sequence
    //    (init segment + all subsequent frames since last MediaRecorder restart).
    //    This ensures no gap in the decode chain — viewer starts from a keyframe.
    for chunk in buffered_chunks {
        if ws_tx.send(Message::Binary(chunk)).await.is_err() {
            viewer_counter.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
            return;
        }
    }

    // 3) Forward frames from broadcast channel to viewer
    loop {
        tokio::select! {
            // Forward broadcast frames to viewer
            frame = relay_rx.recv() => {
                match frame {
                    Ok(data) => {
                        if ws_tx.send(Message::Binary(data)).await.is_err() {
                            break; // Viewer disconnected
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        warn!("Viewer lagged {} frames on stream {}", n, stream_id);
                        // Continue — viewer skips frames
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        // Stream ended
                        let _ = ws_tx
                            .send(Message::Text(
                                serde_json::json!({"type":"stream_ended"}).to_string(),
                            ))
                            .await;
                        break;
                    }
                }
            }
            // Check if viewer sends close
            msg = ws_rx.next() => {
                match msg {
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
        }
    }

    // Decrement viewer count
    viewer_counter.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
    info!("Viewer disconnected from stream: {}", stream_id);
}
