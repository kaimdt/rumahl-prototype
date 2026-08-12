//! Web terminal (Package 9) — interactive shell for the Admin Center.
//!
//! A WebSocket endpoint that spawns an interactive `bash` in a pseudo
//! terminal (via util-linux `script`, so no PTY crate is needed) and
//! streams bytes both ways. Requires the `os.terminal` permission.
//!
//! Route (authenticated via `?token=…`, like the other WS endpoints):
//!   GET /api/os/terminal/ws

use std::process::Stdio;

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Extension, State,
    },
    http::StatusCode,
    response::{IntoResponse, Response},
};
use futures_util::{SinkExt, StreamExt};
use tokio::io::AsyncWriteExt;

use crate::middleware::AuthIdentity;
use crate::{user_has_os_permission, AppState};

/// GET /api/os/terminal/ws — upgrade to an interactive shell session.
pub async fn terminal_ws(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Extension(identity): Extension<AuthIdentity>,
) -> Response {
    match user_has_os_permission(&state, identity.user_id(), "os.terminal").await {
        Ok(true) => ws.on_upgrade(terminal_session),
        Ok(false) => StatusCode::FORBIDDEN.into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

/// Bridge the WebSocket to a `script`-spawned PTY running bash.
async fn terminal_session(socket: WebSocket) {
    // `script -qec bash /dev/null` runs bash inside a pseudo terminal and
    // mirrors the terminal stream (ANSI included) to stdout.
    let mut child = match tokio::process::Command::new("script")
        .args(["-qec", "bash", "/dev/null"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(child) => child,
        Err(e) => {
            tracing::warn!("terminal: failed to spawn script: {e}");
            return;
        }
    };

    let Some(mut stdin) = child.stdin.take() else {
        return;
    };
    let Some(mut stdout) = child.stdout.take() else {
        return;
    };

    let (mut sender, mut receiver) = socket.split();

    // PTY stdout → WebSocket
    let out_task = tokio::spawn(async move {
        let mut buf = vec![0u8; 8192];
        loop {
            match tokio::io::AsyncReadExt::read(&mut stdout, &mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let text = String::from_utf8_lossy(&buf[..n]).to_string();
                    if sender.send(Message::Text(text)).await.is_err() {
                        break;
                    }
                }
            }
        }
    });

    // WebSocket → PTY stdin
    while let Some(message) = receiver.next().await {
        match message {
            Ok(Message::Text(text)) => {
                if stdin.write_all(text.as_bytes()).await.is_err() {
                    break;
                }
                let _ = stdin.flush().await;
            }
            Ok(Message::Binary(data)) => {
                if stdin.write_all(&data).await.is_err() {
                    break;
                }
            }
            Ok(Message::Close(_)) | Err(_) => break,
            _ => {}
        }
    }

    let _ = child.kill().await;
    let _ = child.wait().await;
    let _ = out_task.await;
}
