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
        // Greeting (plain read - it has no return/error member), then the
        // capabilities handshake. QEMU may interleave asynchronous events
        // at any point, so read until the matching {"return": ...} /
        // {"error": ...} response arrives.
        reader.read_line(&mut line).await?;
        writer
            .write_all(b"{\"execute\":\"qmp_capabilities\"}\n")
            .await?;
        read_channel_message(&mut reader, &mut line).await?;
    }
    let mut response = Value::Null;
    for message in messages {
        writer
            .write_all(format!("{}\n", message).as_bytes())
            .await?;
        response = read_channel_message(&mut reader, &mut line).await?;
    }
    Ok(response)
}

/// Read one QMP/QGA JSON line that is an actual response (has a `return` or
/// `error` member), skipping interleaved asynchronous events like
/// `{"event":"RTC_CHANGE",...}`. Reading a single line can otherwise pick
/// up an event instead of the reply, which made `qmp.ps1 status` report
/// empty fields (vCPUs 1 / RAM 0 GB).
async fn read_channel_message<R>(reader: &mut BufReader<R>, line: &mut String) -> Result<Value>
where
    R: AsyncRead + Unpin,
{
    loop {
        line.clear();
        timeout(Duration::from_secs(10), reader.read_line(line))
            .await
            .context("channel response timeout")??;
        if line.trim().is_empty() {
            continue;
        }
        let value: Value = serde_json::from_str(line)?;
        if value.get("return").is_some() || value.get("error").is_some() {
            return Ok(value);
        }
    }
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

/// Minimal base64 encoder (mirror of the decoder above) - used to upload
/// the self-heal script into the guest without extra dependencies.
pub fn base64_encode(input: &[u8]) -> String {
    const MAP: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = String::with_capacity((input.len() + 2) / 3 * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        output.push(MAP[(triple >> 18) as usize & 0x3f] as char);
        output.push(MAP[(triple >> 12) as usize & 0x3f] as char);
        if chunk.len() > 1 {
            output.push(MAP[(triple >> 6) as usize & 0x3f] as char);
        } else {
            output.push('=');
        }
        if chunk.len() > 2 {
            output.push(MAP[triple as usize & 0x3f] as char);
        } else {
            output.push('=');
        }
    }
    output
}
