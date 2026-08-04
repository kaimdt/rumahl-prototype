use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::path::Path;
#[cfg(unix)]
use tokio::net::UnixStream;
use tokio::{
    io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader},
    net::TcpStream,
    time::{sleep, timeout, Duration},
};

async fn exchange<S>(stream: S, messages: &[Value], qmp: bool) -> Result<Value>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let (reader, mut writer) = tokio::io::split(stream);
    let mut reader = BufReader::new(reader);
    let mut line = String::new();
    if qmp {
        reader.read_line(&mut line).await?;
        writer
            .write_all(b"{\"execute\":\"qmp_capabilities\"}\n")
            .await?;
        line.clear();
        reader.read_line(&mut line).await?;
    }
    let mut response = Value::Null;
    for message in messages {
        writer
            .write_all(format!("{}\n", message).as_bytes())
            .await?;
        line.clear();
        timeout(Duration::from_secs(10), reader.read_line(&mut line))
            .await
            .context("channel response timeout")??;
        response = serde_json::from_str(&line)?;
    }
    Ok(response)
}

async fn request(port: u16, _socket: &Path, messages: &[Value], qmp: bool) -> Result<Value> {
    #[cfg(unix)]
    if _socket.exists() {
        let stream = timeout(Duration::from_secs(3), UnixStream::connect(_socket))
            .await
            .context("Unix channel connection timeout")??;
        return exchange(stream, messages, qmp).await;
    }
    let stream = timeout(
        Duration::from_secs(3),
        TcpStream::connect(("127.0.0.1", port)),
    )
    .await
    .context("TCP channel connection timeout")??;
    exchange(stream, messages, qmp).await
}

pub async fn qmp(port: u16, socket: &Path, command: &str) -> Result<Value> {
    request(port, socket, &[json!({"execute": command})], true).await
}
pub async fn qmp_command(
    port: u16,
    socket: &Path,
    execute: &str,
    arguments: Value,
) -> Result<Value> {
    request(
        port,
        socket,
        &[json!({"execute": execute, "arguments": arguments})],
        true,
    )
    .await
}
pub async fn qga(port: u16, socket: &Path, value: Value) -> Result<Value> {
    request(port, socket, &[value], false).await
}

pub async fn guest_exec(port: u16, socket: &Path, command: &str) -> Result<String> {
    let started = qga(port, socket, json!({"execute":"guest-exec","arguments":{"path":"/bin/sh","arg":["-c",command],"capture-output":true}})).await?;
    let pid = started
        .pointer("/return/pid")
        .and_then(Value::as_i64)
        .context("QGA returned no guest PID")?;
    for _ in 0..120 {
        sleep(Duration::from_millis(250)).await;
        let status = qga(
            port,
            socket,
            json!({"execute":"guest-exec-status","arguments":{"pid":pid}}),
        )
        .await?;
        let Some(code) = status.pointer("/return/exitcode").and_then(Value::as_i64) else {
            continue;
        };
        let stdout = decode(
            status
                .pointer("/return/out-data")
                .and_then(Value::as_str)
                .unwrap_or_default(),
        );
        let stderr = decode(
            status
                .pointer("/return/err-data")
                .and_then(Value::as_str)
                .unwrap_or_default(),
        );
        if code == 0 {
            return Ok(stdout);
        }
        bail!("guest command failed ({code}): {stderr}{stdout}");
    }
    bail!("guest command timed out")
}

fn decode(input: &str) -> String {
    const MAP: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let (mut bits, mut count, mut output) = (0_u32, 0_u8, Vec::new());
    for byte in input
        .bytes()
        .filter(|b| *b != b'=' && !b.is_ascii_whitespace())
    {
        let Some(value) = MAP.iter().position(|candidate| *candidate == byte) else {
            continue;
        };
        bits = (bits << 6) | value as u32;
        count += 6;
        if count >= 8 {
            count -= 8;
            output.push(((bits >> count) & 0xff) as u8);
        }
    }
    String::from_utf8_lossy(&output).into_owned()
}
