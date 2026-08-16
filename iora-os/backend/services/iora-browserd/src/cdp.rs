//! Minimal Chrome DevTools Protocol client for one page target.
//!
//! Connects to the page WebSocket of a headless Chromium instance, starts
//! the screencast (JPEG frames) and forwards commands (navigation, mouse,
//! keyboard). Screencast frames MUST be acknowledged via
//! `Page.screencastFrameAck` or Chromium stops producing frames.
//!
//! Only used on loopback — the CDP endpoint is bound to 127.0.0.1 by the
//! Chromium launch flags and never exposed to the network.

use futures_util::stream::SplitSink;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

pub const VIEWPORT_W: u32 = 1280;
pub const VIEWPORT_H: u32 = 800;

/// Messages produced by the CDP read loop of a tab.
pub enum TabEvent {
    /// A screencast JPEG frame (base64) in viewport resolution.
    Frame { data: String, w: u32, h: u32 },
    /// Navigation state changed (url/title/back/forward).
    Nav {
        url: String,
        title: String,
        can_go_back: bool,
        can_go_forward: bool,
    },
    /// The tab crashed / was closed.
    Closed,
}

/// One CDP connection per tab. Commands are serialized through an internal
/// mutex so command ids stay in sync with the responses.
pub struct CdpTab {
    write: Arc<Mutex<SplitSink<WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>, Message>>>,
    next_id: Arc<Mutex<u64>>,
}

impl CdpTab {
    /// Connect to a page target and start the screencast.
    pub async fn connect(ws_url: &str, events: mpsc::Sender<TabEvent>) -> anyhow::Result<CdpTab> {
        let (ws, _) = tokio_tungstenite::connect_async(ws_url).await?;
        let (mut write, mut read) = ws.split();

        // Fixed viewport: the screencast frames arrive in exactly this
        // resolution, so input coordinates map 1:1 onto the frames.
        let setup = [
            json!({"id": 1, "method": "Page.enable", "params": {}}),
            json!({"id": 2, "method": "Emulation.setDeviceMetricsOverride", "params": {
                "width": VIEWPORT_W, "height": VIEWPORT_H,
                "deviceScaleFactor": 1.0, "mobile": false
            }}),
            json!({"id": 3, "method": "Page.startScreencast", "params": {
                "format": "jpeg", "quality": 40, "everyNthFrame": 1
            }}),
            json!({"id": 4, "method": "Page.getNavigationHistory", "params": {}}),
        ];
        for msg in &setup {
            write.send(Message::Text(msg.to_string().into())).await?;
        }

        let write = Arc::new(Mutex::new(write));
        let next_id = Arc::new(Mutex::new(100));

        // Read loop: route screencast frames + navigation events.
        let read_write = write.clone();
        let read_next = next_id.clone();
        tokio::spawn(async move {
            let mut pending_nav: Option<(String, String)> = None;
            while let Some(Ok(message)) = read.next().await {
                let text = match message {
                    Message::Text(t) => t,
                    Message::Binary(b) => String::from_utf8_lossy(&b).to_string(),
                    _ => continue,
                };
                let Ok(value) = serde_json::from_str::<Value>(&text) else {
                    continue;
                };
                if let Some(method) = value["method"].as_str() {
                    match method {
                        "Page.screencastFrame" => {
                            let data = value["params"]["data"].as_str().unwrap_or("").to_string();
                            let session = value["params"]["sessionId"].as_str().unwrap_or("");
                            // Acknowledge — REQUIRED or the screencast stops.
                            let ack = json!({
                                "id": next_id_inc(&read_next).await,
                                "method": "Page.screencastFrameAck",
                                "params": { "sessionId": session }
                            });
                            let mut w = read_write.lock().await;
                            let _ = w.send(Message::Text(ack.to_string().into())).await;
                            drop(w);
                            if !data.is_empty() {
                                let _ = events
                                    .send(TabEvent::Frame {
                                        data,
                                        w: VIEWPORT_W,
                                        h: VIEWPORT_H,
                                    })
                                    .await;
                            }
                        }
                        "Page.frameNavigated" => {
                            let url = value["params"]["frame"]["url"]
                                .as_str()
                                .unwrap_or("")
                                .to_string();
                            let _ = events
                                .send(TabEvent::Nav {
                                    url: url.clone(),
                                    title: pending_nav.take().map(|(_, t)| t).unwrap_or_default(),
                                    can_go_back: false,
                                    can_go_forward: false,
                                })
                                .await;
                        }
                        "Page.titleChanged" => {
                            let title = value["params"]["title"].as_str().unwrap_or("").to_string();
                            if let Some((url, _)) = pending_nav.take() {
                                let _ = events
                                    .send(TabEvent::Nav {
                                        url,
                                        title,
                                        can_go_back: false,
                                        can_go_forward: false,
                                    })
                                    .await;
                            }
                        }
                        _ => {}
                    }
                } else if let Some(id) = value["id"].as_u64() {
                    if id == 4 {
                        // Page.getNavigationHistory response — push current
                        // url/title so the UI is populated right away.
                        if let Some(entries) = value["result"]["entries"].as_array() {
                            let index =
                                value["result"]["currentIndex"].as_u64().unwrap_or(0) as usize;
                            if let Some(entry) = entries.get(index) {
                                let url = entry["url"].as_str().unwrap_or("").to_string();
                                let title = entry["title"].as_str().unwrap_or("").to_string();
                                let _ = events
                                    .send(TabEvent::Nav {
                                        url,
                                        title,
                                        can_go_back: index > 0,
                                        can_go_forward: index + 1 < entries.len(),
                                    })
                                    .await;
                            }
                        }
                    }
                }
            }
            let _ = events.send(TabEvent::Closed).await;
        });

        Ok(CdpTab { write, next_id })
    }

    /// Send a command and return the matching response value.
    pub async fn command(&self, method: &str, params: Value) -> anyhow::Result<Value> {
        let id = next_id_inc(&self.next_id).await;
        let msg = json!({"id": id, "method": method, "params": params});
        let mut w = self.write.lock().await;
        w.send(Message::Text(msg.to_string().into())).await?;
        drop(w);
        // Commands are fire-and-forget for the UI; the responses are
        // consumed by the read loop (only id 4 is inspected). Navigation
        // commands do not need a response round-trip here.
        Ok(Value::Null)
    }

    pub async fn navigate(&self, url: &str) -> anyhow::Result<()> {
        self.command("Page.navigate", json!({"url": url})).await?;
        Ok(())
    }

    pub async fn back(&self) -> anyhow::Result<()> {
        self.command("Page.goBack", json!({})).await?;
        Ok(())
    }

    pub async fn forward(&self) -> anyhow::Result<()> {
        self.command("Page.goForward", json!({})).await?;
        Ok(())
    }

    pub async fn reload(&self) -> anyhow::Result<()> {
        self.command("Page.reload", json!({"ignoreCache": false}))
            .await?;
        Ok(())
    }

    pub async fn mouse(&self, event: &str, x: f64, y: f64, button: &str) -> anyhow::Result<()> {
        let (buttons, click_count) = match event {
            "mousePressed" => (1, 1),
            _ => (0, 0),
        };
        self.command(
            "Input.dispatchMouseEvent",
            json!({
                "type": event,
                "x": x.round() as u32,
                "y": y.round() as u32,
                "button": button,
                "buttons": buttons,
                "clickCount": click_count,
            }),
        )
        .await?;
        Ok(())
    }

    pub async fn wheel(&self, delta_x: f64, delta_y: f64) -> anyhow::Result<()> {
        self.command(
            "Input.dispatchMouseEvent",
            json!({"type": "mouseWheel", "deltaX": delta_x, "deltaY": delta_y}),
        )
        .await?;
        Ok(())
    }

    /// Dispatch a key event. `text` carries the character for printable
    /// keys (keyDown only), `code` the physical key code.
    pub async fn key(
        &self,
        down: bool,
        key: &str,
        code: &str,
        text: Option<&str>,
    ) -> anyhow::Result<()> {
        let vk = if key.len() == 1 {
            u32::from(key.as_bytes()[0])
        } else {
            match key {
                "Enter" => 13,
                "Backspace" => 8,
                "Tab" => 9,
                "Escape" => 27,
                "ArrowUp" => 38,
                "ArrowDown" => 40,
                "ArrowLeft" => 37,
                "ArrowRight" => 39,
                "Home" => 36,
                "End" => 35,
                "PageUp" => 33,
                "PageDown" => 34,
                "Delete" => 46,
                _ => 0,
            }
        };
        let params = if down {
            json!({
                "type": "keyDown",
                "key": key,
                "code": code,
                "windowsVirtualKeyCode": vk,
                "nativeVirtualKeyCode": vk,
                "text": text.unwrap_or(""),
            })
        } else {
            json!({
                "type": "keyUp",
                "key": key,
                "code": code,
                "windowsVirtualKeyCode": vk,
                "nativeVirtualKeyCode": vk,
            })
        };
        self.command("Input.dispatchKeyEvent", params).await?;
        Ok(())
    }
}

async fn next_id_inc(next: &Arc<Mutex<u64>>) -> u64 {
    let mut guard = next.lock().await;
    *guard += 1;
    *guard
}
