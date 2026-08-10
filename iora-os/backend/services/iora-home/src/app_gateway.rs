//! App Embedding Gateway
//!
//! Serves installed ORA apps on their own origin:
//!
//! ```text
//! https://<app-id>.apps.ora.local/
//! ```
//!
//! The ORA desktop (e.g. `https://ora.local`) embeds these origins as
//! iframes inside its App Runner. This module is a **transparent reverse
//! proxy / app gateway** — it is NOT server-side rendering and NOT the ORA
//! Browser. The app content is fully rendered and executed by the user's
//! browser; the gateway only:
//!
//! 1. Resolves `<app-id>.apps.ora.local` against the **live** app lifecycle
//!    (no static port/route tables — restarting an app with a changed
//!    runtime target needs no reconfiguration).
//! 2. Forwards all HTTP methods with streaming bodies.
//! 3. Tunnels WebSocket upgrades transparently (no app changes needed).
//! 4. Rewrites iframe-blocking response headers:
//!    - removes `X-Frame-Options`,
//!    - keeps every other CSP directive but controls `frame-ancestors` so
//!      only the ORA desktop origin may frame the app,
//!    - rewrites internal `Location` redirects to the public app origin.
//! 5. Keeps the app on a separate origin: no desktop cookies are injected,
//!    app cookies stay host-scoped to the app subdomain.
//! 6. Serves a structured app-state page (STARTING / RUNNING / STOPPING /
//!    STOPPED / FAILED / UNHEALTHY) instead of raw proxy errors, so the App
//!    Runner can render a proper state UI and trigger a lifecycle start.

use std::collections::HashSet;
use std::str::FromStr;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use axum::extract::{Request, State};
use axum::http::header::{self, HeaderMap, HeaderName, HeaderValue};
use axum::http::{StatusCode, Uri};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use hyper_util::client::legacy::connect::HttpConnector;
use hyper_util::client::legacy::Client;
use hyper_util::rt::TokioExecutor;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tracing::{debug, warn};

use crate::app_lifecycle;
use crate::local_appstore::{InstalledApp, LocalAppStore};
use crate::AppState;

/// Response type used by all gateway handlers.
pub type GatewayResponse = axum::http::Response<axum::body::Body>;

/// Default host suffix for installed apps. Requests with
/// `Host: <app-id><SUFFIX>` are routed to the gateway.
pub const DEFAULT_APPS_HOST_SUFFIX: &str = ".apps.ora.local";

pub fn apps_host_suffix() -> String {
    std::env::var("IORA_APPS_HOST_SUFFIX")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_APPS_HOST_SUFFIX.to_string())
}

/// Optional override for the ORA desktop origin used in `frame-ancestors`
/// and redirect rewriting. When unset, the gateway derives it from the
/// request (`<scheme>://<parent-of-app-subdomain>[:port]`).
pub fn desktop_origin_override() -> Option<String> {
    std::env::var("IORA_DESKTOP_ORIGIN")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

// ─── Lifecycle state ───────────────────────────────────────────────────────

/// Canonical lifecycle states exposed to the App Runner.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum AppLifecycleState {
    Starting,
    Running,
    Stopping,
    Stopped,
    Failed,
    Unhealthy,
    /// App is not installed at all.
    NotFound,
}

impl AppLifecycleState {
    pub fn as_str(&self) -> &'static str {
        match self {
            AppLifecycleState::Starting => "STARTING",
            AppLifecycleState::Running => "RUNNING",
            AppLifecycleState::Stopping => "STOPPING",
            AppLifecycleState::Stopped => "STOPPED",
            AppLifecycleState::Failed => "FAILED",
            AppLifecycleState::Unhealthy => "UNHEALTHY",
            AppLifecycleState::NotFound => "NOT_FOUND",
        }
    }
}

/// Map an installed app to its canonical lifecycle state. The docker
/// compose state is authoritative when the app needs containers; the stored
/// status is used for local (non-Docker) apps.
pub async fn resolve_lifecycle_state(app: &InstalledApp) -> AppLifecycleState {
    let needs_docker = app.docker_config.is_some() || app.bundle_config.is_some();
    if needs_docker {
        // The live compose status wins over the stored status which may lag
        // behind an actual container restart.
        if let Some(status) = app_lifecycle::docker_compose_status(&app.id).await {
            if status.unhealthy > 0 {
                return AppLifecycleState::Unhealthy;
            }
            if status.exited > 0 {
                return AppLifecycleState::Failed;
            }
            if status.all_running() {
                return AppLifecycleState::Running;
            }
            return AppLifecycleState::Stopped;
        }
    }
    match app.status.as_str() {
        "starting" => AppLifecycleState::Starting,
        "stopping" => AppLifecycleState::Stopping,
        "running" => AppLifecycleState::Running,
        "paused" | "stopped" => AppLifecycleState::Stopped,
        "error" => AppLifecycleState::Failed,
        other if !other.is_empty() && app.error_message.is_some() => AppLifecycleState::Unhealthy,
        _ => AppLifecycleState::Stopped,
    }
}

/// Runtime target of a running app, resolved from the lifecycle system.
#[derive(Debug, Clone)]
pub struct RuntimeTarget {
    /// Host the app is reachable on from the ORA host (127.0.0.1).
    pub host: String,
    /// Published (host) port.
    pub port: u16,
    /// Internal container port the app listens on (used for redirect
    /// rewriting heuristics).
    pub internal_port: u16,
    /// Upstream scheme — always http for docker-published ports today.
    pub protocol: String,
}

impl RuntimeTarget {
    pub fn addr(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }
}

/// Resolve the current runtime target from the app lifecycle. Never a
/// static table: docker-compose published ports are queried live, falling
/// back to the last stored port mapping. The upstream scheme honours the
/// manifest `docker.scheme` / `bundle.scheme` ("https" for apps that serve
/// TLS inside their container).
pub async fn resolve_runtime_target(
    store: &LocalAppStore,
    app: &InstalledApp,
) -> Option<RuntimeTarget> {
    let needs_docker = app.docker_config.is_some() || app.bundle_config.is_some();
    let protocol = upstream_scheme(app);
    if needs_docker {
        if let Some(ports) = app_lifecycle::docker_compose_ports(&app.id).await {
            if let Some((external, internal, _protocol)) = ports.first() {
                return Some(RuntimeTarget {
                    host: "127.0.0.1".to_string(),
                    port: *external,
                    internal_port: *internal,
                    protocol: protocol.clone(),
                });
            }
        }
    }
    if let Some(p) = app.ports.first() {
        return Some(RuntimeTarget {
            host: "127.0.0.1".to_string(),
            port: p.external,
            internal_port: p.internal,
            protocol: protocol.clone(),
        });
    }
    // Last resort: the port manager assigned a host port.
    let _ = store;
    None
}

/// Upstream scheme from the manifest (`docker.scheme` / `bundle.scheme`).
fn upstream_scheme(app: &InstalledApp) -> String {
    for config in [app.docker_config.as_ref(), app.bundle_config.as_ref()] {
        if let Some(scheme) = config
            .and_then(|c| c.get("scheme"))
            .and_then(|v| v.as_str())
        {
            if scheme.eq_ignore_ascii_case("https") {
                return "https".to_string();
            }
        }
    }
    "http".to_string()
}

// ─── Host parsing (pure, unit-tested) ─────────────────────────────────────

pub fn split_host_port(host: &str) -> (&str, Option<u16>) {
    let host = host.trim();
    if let Some(rest) = host.strip_prefix('[') {
        // IPv6 literal — optional :port after the closing bracket.
        if let Some((inner, after)) = rest.split_once(']') {
            let port = after
                .strip_prefix(':')
                .and_then(|p| p.parse::<u16>().ok());
            return (inner, port);
        }
        return (host, None);
    }
    match host.rsplit_once(':') {
        Some((h, p)) if !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()) => {
            (h, p.parse::<u16>().ok())
        }
        _ => (host, None),
    }
}

/// Extract the app id from a `Host: <app-id>.apps.ora.local[:port]` header.
/// Returns `None` for the bare base domain, multi-label prefixes, and any
/// host that does not match the configured suffix.
pub fn apps_subdomain_app_id(host: &str, suffix: &str) -> Option<String> {
    let (hostname, _port) = split_host_port(host);
    let hostname = hostname.to_ascii_lowercase();
    let base = suffix.trim().trim_start_matches('.').trim_end_matches('.');
    if base.is_empty() {
        return None;
    }
    let prefix = hostname.strip_suffix(&format!(".{base}"))?;
    if prefix.is_empty() || prefix.contains('.') {
        return None;
    }
    if !prefix
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return None;
    }
    Some(prefix.to_string())
}

/// Desktop origin derived from an app-subdomain request:
/// `https://nextcloud.apps.ora.local:3001` → `https://ora.local:3001`.
/// Falls back to the configured `IORA_DESKTOP_ORIGIN` when present.
pub fn desktop_origin_for_host(host: &str, scheme: &str) -> String {
    if let Some(origin) = desktop_origin_override() {
        return origin.trim_end_matches('/').to_string();
    }
    let suffix = apps_host_suffix();
    let base = suffix.trim().trim_start_matches('.').trim_end_matches('.');
    let (hostname, port) = split_host_port(host);
    // hostname = <app-id>.apps.ora.local → desktop = ora.local. The apps
    // root label ("apps") is dropped as well — the desktop is the parent
    // of the apps subdomain, never an app origin itself.
    let desktop_host = if !base.is_empty() && hostname.ends_with(&format!(".{base}")) {
        base.split_once('.')
            .map(|(_, rest)| rest)
            .unwrap_or(hostname)
    } else {
        hostname
    };
    origin_for(desktop_host, port, scheme)
}

fn origin_for(hostname: &str, port: Option<u16>, scheme: &str) -> String {
    let default_port = if scheme == "https" { 443 } else { 80 };
    match port {
        Some(p) if p != default_port => format!("{scheme}://{hostname}:{p}"),
        _ => format!("{scheme}://{hostname}"),
    }
}

// ─── Response header rewriting (pure, unit-tested) ────────────────────────

const HOP_BY_HOP: &[&str] = &[
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
];

pub fn strip_hop_headers(headers: &mut HeaderMap) {
    for name in HOP_BY_HOP {
        headers.remove(*name);
    }
}

/// Rewrite an app response so it can be embedded by the ORA desktop:
/// - remove `X-Frame-Options` entirely,
/// - rewrite/add `frame-ancestors` in every `Content-Security-Policy`
///   header (all other directives are preserved; identical merged policies
///   are deduplicated so multiple CSP headers never conflict),
/// - rewrite internal `Location` redirects to the public app origin.
pub fn rewrite_response_headers(
    headers: &mut HeaderMap,
    desktop_origin: &str,
    upstream: &RuntimeTarget,
    public_origin: &str,
) {
    // 1) X-Frame-Options blocks iframe embedding — the gateway controls
    // framing via CSP frame-ancestors instead.
    headers.remove(header::X_FRAME_OPTIONS);

    // 2) Content-Security-Policy: keep every directive, only control
    // frame-ancestors.
    let csp_values: Vec<String> = headers
        .get_all(header::CONTENT_SECURITY_POLICY)
        .iter()
        .filter_map(|v| v.to_str().ok().map(|s| s.to_string()))
        .collect();
    if !csp_values.is_empty() {
        headers.remove(header::CONTENT_SECURITY_POLICY);
        let mut seen = HashSet::new();
        for policy in csp_values {
            let rewritten = sanitize_csp(&policy, desktop_origin);
            if seen.insert(rewritten.clone()) {
                if let Ok(value) = HeaderValue::from_str(&rewritten) {
                    headers.append(header::CONTENT_SECURITY_POLICY, value);
                }
            }
        }
    }

    // 3) Redirect rewriting: internal Location targets must not leak the
    // container address to the browser.
    if headers.contains_key(header::LOCATION) {
        let locations: Vec<String> = headers
            .get_all(header::LOCATION)
            .iter()
            .filter_map(|v| v.to_str().ok().map(|s| s.to_string()))
            .collect();
        headers.remove(header::LOCATION);
        for location in locations {
            let rewritten = rewrite_location(&location, upstream, public_origin);
            if let Ok(value) = HeaderValue::from_str(&rewritten) {
                headers.append(header::LOCATION, value);
            }
        }
    }
}

/// Rewrite a single `Content-Security-Policy` value: keep all directives,
/// replace any existing `frame-ancestors` with the desktop origin and add
/// it when missing. Directives are case-insensitive per spec; values are
/// preserved verbatim.
pub fn sanitize_csp(policy: &str, frame_ancestors: &str) -> String {
    let mut directives: Vec<String> = Vec::new();
    let mut found = false;
    for part in policy.split(';') {
        let trimmed = part.trim();
        if trimmed.is_empty() {
            continue;
        }
        let name = trimmed
            .split_whitespace()
            .next()
            .unwrap_or("")
            .to_ascii_lowercase();
        if name == "frame-ancestors" {
            found = true;
            directives.push(format!("frame-ancestors {frame_ancestors}"));
        } else {
            directives.push(trimmed.to_string());
        }
    }
    if !found {
        directives.push(format!("frame-ancestors {frame_ancestors}"));
    }
    directives.join("; ")
}

fn is_private_host(hostname: &str) -> bool {
    let hostname = hostname.trim().to_ascii_lowercase();
    if hostname == "localhost" {
        return true;
    }
    let parts: Vec<&str> = hostname.split('.').collect();
    if parts.len() != 4 {
        return false;
    }
    let octets: Vec<u8> = parts
        .iter()
        .filter_map(|p| p.parse::<u8>().ok())
        .collect();
    if octets.len() != 4 {
        return false;
    }
    let [a, b, _, _] = [octets[0], octets[1], octets[2], octets[3]];
    a == 10 || a == 127 || (a == 172 && (16..=31).contains(&b)) || (a == 192 && b == 168)
}

/// Rewrite a `Location` header value so redirects stay inside the app's
/// public origin. Rules:
/// - absolute URL on the resolved upstream host:port → public origin
/// - absolute URL on localhost/127.0.0.1 with the upstream or internal
///   port → public origin
/// - absolute URL on any private IP with the upstream internal port
///   (docker bridge container address) → public origin
/// - anything else (relative paths, external hosts) is returned unchanged.
pub fn rewrite_location(location: &str, upstream: &RuntimeTarget, public_origin: &str) -> String {
    let parsed = match reqwest::Url::parse(location) {
        Ok(u) => u,
        Err(_) => return location.to_string(), // relative or malformed — keep
    };
    let scheme = parsed.scheme().to_string();
    let hostname = parsed.host_str().unwrap_or("").to_string();
    // `port()` drops the port when it equals the scheme default (e.g.
    // http://172.20.0.5:80), so use the known default for comparisons.
    let port = parsed.port_or_known_default();
    let upstream_host = upstream.host.to_ascii_lowercase();

    let host_matches_upstream = hostname.eq_ignore_ascii_case(&upstream_host)
        && port == Some(upstream.port);
    let is_loopback = hostname.eq_ignore_ascii_case("localhost") || hostname == "127.0.0.1";
    let loopback_with_app_port = is_loopback
        && (port == Some(upstream.port) || port == Some(upstream.internal_port));
    let container_ip_redirect =
        is_private_host(&hostname) && port == Some(upstream.internal_port);

    if !(host_matches_upstream || loopback_with_app_port || container_ip_redirect) {
        return location.to_string();
    }

    // Rebuild against the public origin, keeping path + query + fragment.
    let mut out = format!("{}{}", public_origin.trim_end_matches('/'), parsed.path());
    if let Some(query) = parsed.query() {
        out.push('?');
        out.push_str(query);
    }
    if let Some(fragment) = parsed.fragment() {
        out.push('#');
        out.push_str(fragment);
    }
    let _ = scheme;
    out
}

// ─── App-state page ────────────────────────────────────────────────────────

/// Minimal self-contained state page served on the app origin when the app
/// is not running. It talks to the desktop App Runner exclusively via
/// postMessage (origin+appId validated on both sides).
fn app_state_page(
    app_id: &str,
    app_name: &str,
    state: AppLifecycleState,
    desktop_origin: &str,
) -> GatewayResponse {
    let (badge_class, badge_text, detail) = match state {
        AppLifecycleState::Running => ("running", "RUNNING", "Die App läuft."),
        AppLifecycleState::Starting => ("starting", "STARTING", "Die App wird gestartet…"),
        AppLifecycleState::Stopping => ("stopping", "STOPPING", "Die App wird gestoppt…"),
        AppLifecycleState::Failed => ("failed", "FAILED", "Die App konnte nicht gestartet werden."),
        AppLifecycleState::Unhealthy => ("failed", "UNHEALTHY", "Die App läuft, ist aber nicht gesund."),
        AppLifecycleState::Stopped => ("stopped", "STOPPED", "Die App ist gestoppt."),
        AppLifecycleState::NotFound => ("stopped", "NOT_FOUND", "Die App ist nicht installiert."),
    };
    let show_start = matches!(
        state,
        AppLifecycleState::Stopped
            | AppLifecycleState::Failed
            | AppLifecycleState::Unhealthy
    );
    let html = format!(
        r#"<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8">
<title>{name} · ORA</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
* {{ margin:0; padding:0; box-sizing:border-box; }}
body {{ font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; background:#0e1116; color:#e6e8eb; }}
.card {{ text-align:center; padding:2.5rem; max-width:26rem; }}
.badge {{ display:inline-block; padding:4px 14px; border-radius:999px; font-size:11px; font-weight:700; letter-spacing:.12em; margin-bottom:18px; }}
.badge.running {{ background:rgba(5,150,105,.14); color:#34d399; }}
.badge.starting {{ background:rgba(245,158,11,.14); color:#fbbf24; }}
.badge.stopping {{ background:rgba(148,163,184,.14); color:#cbd5e1; }}
.badge.stopped {{ background:rgba(100,116,139,.14); color:#94a3b8; }}
.badge.failed {{ background:rgba(239,68,68,.14); color:#f87171; }}
h1 {{ font-size:20px; margin-bottom:8px; }}
p {{ color:#94a3b8; font-size:13px; line-height:1.6; }}
button {{ margin-top:22px; padding:10px 22px; border-radius:12px; border:none; background:#6366f1; color:#fff; font-size:13px; font-weight:600; cursor:pointer; }}
button:hover {{ background:#4f46e5; }}
.hidden {{ display:none !important; }}
</style></head><body>
<div class="card">
  <span id="badge" class="badge {badge_class}">{badge_text}</span>
  <h1>{name}</h1>
  <p id="detail">{detail}</p>
  <button id="start" class="{hidden}">App starten</button>
</div>
<script>
(function () {{
  'use strict';
  var appId = {app_id_json};
  function send(type) {{
    window.parent.postMessage({{ source: 'ora-app', appId: appId, type: type }}, '*');
  }}
  document.getElementById('start').addEventListener('click', function () {{
    send('app.requestStart');
  }});
  // The desktop runner pushes lifecycle updates so the page can update in
  // place without reloading the iframe.
  window.addEventListener('message', function (event) {{
    var d = event.data;
    if (!d || typeof d !== 'object' || d.type !== 'ora.lifecycleChanged') return;
    if (d.appId && d.appId !== appId) return;
    var map = {{ STARTING: ['starting','Die App wird gestartet…',false], RUNNING: ['running','Die App läuft.',false], STOPPING: ['stopping','Die App wird gestoppt…',false], STOPPED: ['stopped','Die App ist gestoppt.',true], FAILED: ['failed','Die App konnte nicht gestartet werden.',true], UNHEALTHY: ['failed','Die App läuft, ist aber nicht gesund.',true] }};
    var m = map[d.state];
    if (!m) return;
    var badge = document.getElementById('badge');
    badge.className = 'badge ' + m[0];
    badge.textContent = d.state;
    document.getElementById('detail').textContent = m[1];
    document.getElementById('start').classList.toggle('hidden', !m[2]);
  }});
  send('app.ready');
}})();
</script>
</body></html>"#,
        name = app_name,
        app_id_json = serde_json::to_string(app_id).unwrap_or_default(),
        hidden = if show_start { "" } else { "hidden" },
    );
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::CONTENT_SECURITY_POLICY, format!("default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors {}", desktop_origin))
        .body(axum::body::Body::from(html))
        .unwrap_or_else(|_| Response::new(axum::body::Body::empty()))
}

// ─── HTTPS upstream support ────────────────────────────────────────────────

/// Whether to accept self-signed / untrusted certificates when proxying to
/// an app that serves TLS inside its container
/// (`IORA_GATEWAY_INSECURE_UPSTREAM_TLS=1`). LAN-internal apps often use
/// self-signed certificates; this must be enabled explicitly.
pub fn upstream_insecure_tls() -> bool {
    std::env::var("IORA_GATEWAY_INSECURE_UPSTREAM_TLS")
        .ok()
        .map(|v| matches!(v.to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(false)
}

/// Install the ring crypto provider for rustls 0.23 once. Multiple crates
/// enable different rustls features, which disables automatic provider
/// detection — we pick ring explicitly (also used by hyper-rustls here).
pub fn ensure_tls_provider() {
    static INSTALLED: OnceLock<()> = OnceLock::new();
    INSTALLED.get_or_init(|| {
        let _ = rustls_gw::crypto::ring::default_provider().install_default();
    });
}

/// rustls client config for upstream TLS: webpki (Mozilla) roots by
/// default, or an accept-any verifier when `IORA_GATEWAY_INSECURE_UPSTREAM_TLS`
/// is enabled.
fn upstream_tls_config(insecure: bool) -> rustls_gw::ClientConfig {
    ensure_tls_provider();
    if insecure {
        rustls_gw::ClientConfig::builder()
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(AcceptAllVerifier))
            .with_no_client_auth()
    } else {
        let mut roots = rustls_gw::RootCertStore::empty();
        roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        rustls_gw::ClientConfig::builder()
            .with_root_certificates(roots)
            .with_no_client_auth()
    }
}

/// Accept-any certificate verifier (opt-in via env var). Only used for
/// upstream connections to ORA-controlled apps on the local host.
#[derive(Debug)]
struct AcceptAllVerifier;

impl rustls_gw::client::danger::ServerCertVerifier for AcceptAllVerifier {
    fn verify_server_cert(
        &self,
        _end_entity: &rustls_gw::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls_gw::pki_types::CertificateDer<'_>],
        _server_name: &rustls_gw::pki_types::ServerName<'_>,
        _ocsp_response: &[u8],
        _now: rustls_gw::pki_types::UnixTime,
    ) -> Result<rustls_gw::client::danger::ServerCertVerified, rustls_gw::Error> {
        Ok(rustls_gw::client::danger::ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &rustls_gw::pki_types::CertificateDer<'_>,
        _dss: &rustls_gw::DigitallySignedStruct,
    ) -> Result<rustls_gw::client::danger::HandshakeSignatureValid, rustls_gw::Error> {
        Ok(rustls_gw::client::danger::HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &rustls_gw::pki_types::CertificateDer<'_>,
        _dss: &rustls_gw::DigitallySignedStruct,
    ) -> Result<rustls_gw::client::danger::HandshakeSignatureValid, rustls_gw::Error> {
        Ok(rustls_gw::client::danger::HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<rustls_gw::SignatureScheme> {
        rustls_gw::crypto::ring::default_provider()
            .signature_verification_algorithms
            .supported_schemes()
    }
}

/// Connector that always connects to the FIXED runtime target address,
/// ignoring the destination derived from the request URI. The URI keeps the
/// PUBLIC host so TLS SNI / certificate verification and the Host header
/// stay correct even though the connection goes to `127.0.0.1:<port>`.
#[derive(Clone)]
struct FixedTargetConnector {
    addr: std::net::SocketAddr,
}

impl tower::Service<Uri> for FixedTargetConnector {
    type Response = hyper_util::rt::TokioIo<tokio::net::TcpStream>;
    type Error = std::io::Error;
    type Future =
        std::pin::Pin<Box<dyn std::future::Future<Output = Result<Self::Response, Self::Error>> + Send>>;

    fn poll_ready(
        &mut self,
        _cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Result<(), Self::Error>> {
        std::task::Poll::Ready(Ok(()))
    }

    fn call(&mut self, _dst: Uri) -> Self::Future {
        let addr = self.addr;
        Box::pin(async move {
            let stream = tokio::net::TcpStream::connect(addr).await?;
            Ok(hyper_util::rt::TokioIo::new(stream))
        })
    }
}

// ─── HTTP proxying ─────────────────────────────────────────────────────────

type ProxyClient = Client<HttpConnector, axum::body::Body>;
type HttpsProxyClient = Client<hyper_rustls::HttpsConnector<FixedTargetConnector>, axum::body::Body>;

fn proxy_client() -> &'static ProxyClient {
    static CLIENT: OnceLock<ProxyClient> = OnceLock::new();
    CLIENT.get_or_init(|| {
        let mut connector = HttpConnector::new();
        connector.enforce_http(false);
        connector.set_connect_timeout(Some(Duration::from_secs(5)));
        Client::builder(TokioExecutor::new())
            .pool_idle_timeout(Duration::from_secs(90))
            .retry_canceled_requests(false)
            .build(connector)
    })
}

fn request_scheme(req: &Request) -> String {
    req.headers()
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "http".to_string())
}

fn request_host(req: &Request) -> String {
    req.headers()
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_string()
}

/// Full streaming HTTP proxy (all methods). Response headers are rewritten
/// for iframe embedding; cookies pass through untouched (browser-scoped to
/// the app subdomain — the desktop auth cookie is host-only on the desktop
/// origin and never sent here).
///
/// HTTPS upstreams are supported: when `target.protocol == "https"` the
/// request URI keeps the PUBLIC host (correct TLS SNI / Host) while the
/// connection goes to the fixed runtime target; TLS trust follows
/// `tls_insecure` (self-signed app certs opt-in via env var).
async fn proxy_http(
    req: Request,
    target: &RuntimeTarget,
    public_host: &str,
    public_origin: &str,
    desktop_origin: &str,
    tls_insecure: bool,
    app_id: &str,
) -> GatewayResponse {
    let scheme = request_scheme(&req);
    let (mut parts, body) = req.into_parts();

    // Absolute-form URI so the client knows where to connect. For https
    // upstreams the authority is the PUBLIC host (SNI + verification) with
    // the target's published port — the FixedTargetConnector routes the
    // connection to 127.0.0.1:<port>.
    let path_and_query = parts
        .uri
        .path_and_query()
        .map(|x| x.as_str().to_string())
        .unwrap_or_else(|| "/".to_string());
    let (public_hostname, _) = split_host_port(public_host);
    let upstream_uri = if target.protocol == "https" {
        format!("https://{}:{}{}", public_hostname, target.port, path_and_query)
    } else {
        format!("{}://{}{}", target.protocol, target.addr(), path_and_query)
    };
    match Uri::from_str(&upstream_uri) {
        Ok(uri) => parts.uri = uri,
        Err(_) => {
            return app_state_page(app_id, app_id, AppLifecycleState::Failed, desktop_origin);
        }
    }

    strip_hop_headers(&mut parts.headers);
    // Keep the PUBLIC host so the app generates URLs for the public origin.
    if let Ok(value) = HeaderValue::from_str(public_host) {
        parts.headers.insert(header::HOST, value);
    }
    if let Ok(value) = HeaderValue::from_str(public_host) {
        parts.headers.insert("x-forwarded-host", value);
    }
    if let Ok(value) = HeaderValue::from_str(&scheme) {
        parts.headers.insert("x-forwarded-proto", value);
    }
    if let Ok(value) = HeaderValue::from_str(app_id) {
        parts.headers.insert("x-app-id", value);
    }
    if let Ok(value) = HeaderValue::from_str(app_id) {
        parts.headers.insert("x-iora-app", value);
    }

    let upstream_req = axum::http::Request::from_parts(parts, body);

    // Choose the pooled plain-HTTP client or a per-target TLS client.
    let request_future: std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<hyper::Response<hyper::body::Incoming>, hyper_util::client::legacy::Error>> + Send>,
    > = if target.protocol == "https" {
        let addr = match target.addr().parse::<std::net::SocketAddr>() {
            Ok(a) => a,
            Err(_) => {
                return app_state_page(app_id, app_id, AppLifecycleState::Failed, desktop_origin);
            }
        };
        let connector = hyper_rustls::HttpsConnectorBuilder::new()
            .with_tls_config(upstream_tls_config(tls_insecure))
            .https_or_http()
            .enable_http1()
            .wrap_connector(FixedTargetConnector { addr });
        let client: HttpsProxyClient = Client::builder(TokioExecutor::new()).build(connector);
        Box::pin(client.request(upstream_req))
    } else {
        Box::pin(proxy_client().request(upstream_req))
    };

    let result = tokio::time::timeout(Duration::from_secs(120), request_future).await;
    match result {
        Ok(Ok(resp)) => {
            let (mut resp_parts, resp_body) = resp.into_parts();
            rewrite_response_headers(&mut resp_parts.headers, desktop_origin, target, public_origin);
            Response::from_parts(resp_parts, axum::body::Body::new(resp_body))
        }
        Ok(Err(e)) => {
            debug!(app_id, error = %e, "app gateway upstream request failed");
            app_state_page(app_id, app_id, AppLifecycleState::Failed, desktop_origin)
        }
        Err(_) => {
            warn!(app_id, "app gateway upstream request timed out");
            app_state_page(app_id, app_id, AppLifecycleState::Failed, desktop_origin)
        }
    }
}

// ─── WebSocket tunneling ───────────────────────────────────────────────────

/// Raw upstream stream (plain TCP or TLS for wss:// upstreams).
enum UpstreamStream {
    Plain(tokio::net::TcpStream),
    Tls(tokio_rustls::client::TlsStream<tokio::net::TcpStream>),
}

impl tokio::io::AsyncRead for UpstreamStream {
    fn poll_read(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &mut tokio::io::ReadBuf<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        match &mut *self {
            UpstreamStream::Plain(s) => std::pin::Pin::new(s).poll_read(cx, buf),
            UpstreamStream::Tls(s) => std::pin::Pin::new(s).poll_read(cx, buf),
        }
    }
}

impl tokio::io::AsyncWrite for UpstreamStream {
    fn poll_write(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &[u8],
    ) -> std::task::Poll<Result<usize, std::io::Error>> {
        match &mut *self {
            UpstreamStream::Plain(s) => std::pin::Pin::new(s).poll_write(cx, buf),
            UpstreamStream::Tls(s) => std::pin::Pin::new(s).poll_write(cx, buf),
        }
    }

    fn poll_flush(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Result<(), std::io::Error>> {
        match &mut *self {
            UpstreamStream::Plain(s) => std::pin::Pin::new(s).poll_flush(cx),
            UpstreamStream::Tls(s) => std::pin::Pin::new(s).poll_flush(cx),
        }
    }

    fn poll_shutdown(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Result<(), std::io::Error>> {
        match &mut *self {
            UpstreamStream::Plain(s) => std::pin::Pin::new(s).poll_shutdown(cx),
            UpstreamStream::Tls(s) => std::pin::Pin::new(s).poll_shutdown(cx),
        }
    }
}

/// Connect to the runtime target, wrapping the socket in TLS when the app
/// serves its container over https. The TLS server name is the PUBLIC app
/// hostname so certificates issued for `https://<app-id>.apps.ora.local/`
/// verify correctly.
async fn connect_upstream_stream(
    target: &RuntimeTarget,
    public_host: &str,
    tls_insecure: bool,
) -> std::io::Result<UpstreamStream> {
    let tcp = tokio::net::TcpStream::connect(target.addr()).await?;
    if target.protocol != "https" {
        return Ok(UpstreamStream::Plain(tcp));
    }
    let (public_hostname, _) = split_host_port(public_host);
    let connector = tokio_rustls::TlsConnector::from(Arc::new(upstream_tls_config(tls_insecure)));
    let server_name = rustls_gw::pki_types::ServerName::try_from(public_hostname.to_string())
        .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidInput, "invalid TLS server name"))?;
    let tls = connector.connect(server_name, tcp).await?;
    Ok(UpstreamStream::Tls(tls))
}

/// True when the request is an HTTP upgrade (WebSocket) handshake.
fn is_upgrade_request(req: &Request) -> bool {
    let connection = req
        .headers()
        .get(header::CONNECTION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    connection.split(',').any(|token| token.trim() == "upgrade")
}

/// Tunnel a WebSocket upgrade transparently: the client's handshake headers
/// (including Sec-WebSocket-Key) are forwarded to the upstream so its
/// computed Sec-WebSocket-Accept matches; the 101 response headers are then
/// relayed back and the two raw byte streams are spliced. No message-level
/// bridging, so apps need no special implementation for
/// `wss://<app-id>.apps.ora.local/socket`.
async fn proxy_websocket(
    mut req: Request,
    target: &RuntimeTarget,
    public_host: &str,
    desktop_origin: &str,
    tls_insecure: bool,
    app_id: &str,
) -> GatewayResponse {
    let on_upgrade = hyper::upgrade::on(&mut req);
    let (parts, _body) = req.into_parts();
    let method = parts.method.clone();
    let path_and_query = parts
        .uri
        .path_and_query()
        .map(|x| x.as_str().to_string())
        .unwrap_or_else(|| "/".to_string());

    // Forward the client's handshake headers (minus hop-by-hop, which we
    // rebuild explicitly). Sec-WebSocket-Key/-Version pass through so the
    // upstream handshake matches the client's.
    let mut handshake_headers = parts.headers.clone();
    strip_hop_headers(&mut handshake_headers);
    handshake_headers.remove(header::HOST);

    let mut head = format!(
        "{} {} HTTP/1.1\r\nHost: {}\r\nConnection: Upgrade\r\n",
        method.as_str(),
        path_and_query,
        public_host
    );
    if let Some(upgrade) = parts
        .headers
        .get(header::UPGRADE)
        .and_then(|v| v.to_str().ok())
    {
        head.push_str(&format!("Upgrade: {upgrade}\r\n"));
    } else {
        head.push_str("Upgrade: websocket\r\n");
    }
    for (name, value) in handshake_headers.iter() {
        if let Ok(value_str) = value.to_str() {
            head.push_str(&format!("{}: {}\r\n", name.as_str(), value_str));
        }
    }
    head.push_str("\r\n");

    let mut upstream = match connect_upstream_stream(target, public_host, tls_insecure).await {
        Ok(s) => s,
        Err(e) => {
            debug!(app_id, error = %e, "websocket upstream connect failed");
            return app_state_page(app_id, app_id, AppLifecycleState::Failed, desktop_origin);
        }
    };
    if let Err(e) = upstream.write_all(head.as_bytes()).await {
        debug!(app_id, error = %e, "websocket handshake write failed");
        return app_state_page(app_id, app_id, AppLifecycleState::Failed, desktop_origin);
    }

    let (status, response_headers, mut extra) = match read_http_head(&mut upstream).await {
        Ok(v) => v,
        Err(e) => {
            debug!(app_id, error = %e, "websocket handshake read failed");
            return app_state_page(app_id, app_id, AppLifecycleState::Failed, desktop_origin);
        }
    };

    if status != StatusCode::SWITCHING_PROTOCOLS {
        // The upstream refused the upgrade — relay its response (e.g. an
        // error page) to the client as a normal response.
        let mut builder = Response::builder().status(status);
        for (name, value) in response_headers.iter() {
            builder = builder.header(name, value);
        }
        let body = read_remaining_body(&mut upstream, &response_headers, &mut extra).await;
        return builder
            .body(axum::body::Body::from(body))
            .unwrap_or_else(|_| Response::new(axum::body::Body::empty()));
    }

    // Relay the upstream 101 headers. Connection/Upgrade are set exactly
    // once below — hyper joins duplicate values ("upgrade, upgrade"), which
    // breaks RFC 6455 clients that require an exact "Upgrade" match.
    let mut builder = Response::builder().status(StatusCode::SWITCHING_PROTOCOLS);
    for (name, value) in response_headers.iter() {
        if name == header::CONNECTION || name == header::UPGRADE {
            continue;
        }
        builder = builder.header(name, value);
    }
    builder = builder
        .header(header::CONNECTION, "Upgrade")
        .header(header::UPGRADE, "websocket");
    let response = builder
        .body(axum::body::Body::empty())
        .unwrap_or_else(|_| Response::new(axum::body::Body::empty()));

    // Complete the client-side handshake and splice the raw streams.
    let app_id_owned = app_id.to_string();
    tokio::spawn(async move {
        match on_upgrade.await {
            Ok(client_upgraded) => {
                let mut client = hyper_util::rt::TokioIo::new(client_upgraded);
                let mut upstream = upstream;
                // Flush any bytes read past the 101 head into the tunnel.
                if !extra.is_empty() {
                    let _ = upstream.write_all(&extra).await;
                }
                let _ = tokio::io::copy_bidirectional(&mut client, &mut upstream).await;
            }
            Err(e) => {
                debug!(app_id = %app_id_owned, error = %e, "client websocket upgrade failed");
            }
        }
    });

    response
}

/// Read an HTTP/1.1 response head (status line + headers) from a raw
/// stream (plain TCP or TLS). Returns (status, headers, bytes read beyond
/// the head).
async fn read_http_head(
    stream: &mut (impl tokio::io::AsyncRead + Unpin),
) -> std::io::Result<(StatusCode, HeaderMap, Vec<u8>)> {
    let mut buf: Vec<u8> = Vec::with_capacity(4096);
    let mut tmp = [0u8; 2048];
    loop {
        let n = stream.read(&mut tmp).await?;
        if n == 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                "connection closed before response head",
            ));
        }
        buf.extend_from_slice(&tmp[..n]);
        if let Some(head_len) = find_head_end(&buf) {
            let head = &buf[..head_len];
            let text = String::from_utf8_lossy(head);
            let mut lines = text.split("\r\n");
            let status_line = lines.next().unwrap_or("");
            let status: u16 = status_line
                .split_whitespace()
                .nth(1)
                .and_then(|s| s.parse().ok())
                .unwrap_or(0);
            let mut headers = HeaderMap::new();
            for line in lines {
                if line.is_empty() {
                    continue;
                }
                if let Some((name, value)) = line.split_once(':') {
                    if let Ok(nv) = HeaderName::from_bytes(name.trim().as_bytes()) {
                        if let Ok(vv) = HeaderValue::from_str(value.trim()) {
                            headers.append(nv, vv);
                        }
                    }
                }
            }
            let extra = buf[head_len + 4..].to_vec(); // skip trailing CRLFCRLF
            let code = StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY);
            return Ok((code, headers, extra));
        }
        if buf.len() > 64 * 1024 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "response head too large",
            ));
        }
    }
}

fn find_head_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n")
}

/// Read a bounded response body for the non-101 (upgrade refused) path.
async fn read_remaining_body(
    stream: &mut (impl tokio::io::AsyncRead + Unpin),
    headers: &HeaderMap,
    extra: &mut Vec<u8>,
) -> Vec<u8> {
    let content_length = headers
        .get(header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<usize>().ok());
    let mut body = std::mem::take(extra);
    if let Some(len) = content_length {
        let mut remaining = len.saturating_sub(body.len());
        let mut tmp = [0u8; 8192];
        while remaining > 0 {
            let n = match stream.read(&mut tmp).await {
                Ok(n) if n > 0 => n,
                _ => break,
            };
            let take = n.min(remaining);
            body.extend_from_slice(&tmp[..take]);
            remaining -= take;
        }
    } else {
        // No content-length: read until EOF (bounded).
        let mut tmp = [0u8; 8192];
        loop {
            match stream.read(&mut tmp).await {
                Ok(n) if n > 0 => {
                    body.extend_from_slice(&tmp[..n]);
                    if body.len() > 16 * 1024 * 1024 {
                        break;
                    }
                }
                _ => break,
            }
        }
    }
    body
}

// ─── Gateway handler + middleware ─────────────────────────────────────────

/// Main gateway entry point. Resolves the app from the subdomain, checks
/// its lifecycle state and proxies (HTTP or WebSocket) to the live runtime
/// target. Non-running apps get the structured state page instead of a raw
/// proxy error.
pub async fn handle_gateway_request(
    State(state): State<AppState>,
    app_id: String,
    req: Request,
) -> GatewayResponse {
    let installed = state.local_appstore.list().await;
    let Some(app) = installed.iter().find(|a| a.id == app_id) else {
        let host = request_host(&req);
        let scheme = request_scheme(&req);
        return app_state_page(
            &app_id,
            &app_id,
            AppLifecycleState::NotFound,
            &desktop_origin_for_host(&host, &scheme),
        );
    };

    let host = request_host(&req);
    let scheme = request_scheme(&req);
    let desktop_origin = desktop_origin_for_host(&host, &scheme);

    let lifecycle = resolve_lifecycle_state(app).await;
    if lifecycle != AppLifecycleState::Running {
        return app_state_page(&app_id, &app.name, lifecycle, &desktop_origin);
    }

    let Some(target) = resolve_runtime_target(&state.local_appstore, app).await else {
        return app_state_page(&app_id, &app.name, AppLifecycleState::Failed, &desktop_origin);
    };

    let (hostname, port) = split_host_port(&host);
    let public_origin = origin_for(hostname, port, &scheme);

    let tls_insecure = upstream_insecure_tls();

    if is_upgrade_request(&req) {
        return proxy_websocket(req, &target, &host, &desktop_origin, tls_insecure, &app_id).await;
    }
    proxy_http(
        req,
        &target,
        &host,
        &public_origin,
        &desktop_origin,
        tls_insecure,
        &app_id,
    )
    .await
}

/// Axum middleware: intercept requests whose Host matches
/// `<app-id><suffix>` and route them to the app gateway. Applied as the
/// outermost layer so app subdomain traffic never reaches ORA desktop
/// routes (separate origins, no desktop auth cookies involved).
pub async fn apps_host_middleware(
    State(state): State<AppState>,
    req: Request,
    next: Next,
) -> GatewayResponse {
    let host = request_host(&req);
    if let Some(app_id) = apps_subdomain_app_id(&host, &apps_host_suffix()) {
        debug!(host = %host, app_id = %app_id, "app gateway: subdomain request");
        return handle_gateway_request(State(state), app_id, req).await;
    }
    next.run(req).await
}

/// Runtime info endpoint used by the App Runner:
/// `GET /api/apps/:app_id/runtime`.
pub async fn runtime_info(
    State(state): State<AppState>,
    axum::extract::Path(app_id): axum::extract::Path<String>,
) -> impl IntoResponse {
    let installed = state.local_appstore.list().await;
    let Some(app) = installed.iter().find(|a| a.id == app_id) else {
        return (
            StatusCode::NOT_FOUND,
            axum::Json(serde_json::json!({
                "app_id": app_id,
                "state": AppLifecycleState::NotFound.as_str(),
                "display": null,
                "runtime_url": null,
                "external_url": null,
                "ws_supported": false,
                "startable": false,
            })),
        );
    };

    let lifecycle = resolve_lifecycle_state(app).await;
    let running = lifecycle == AppLifecycleState::Running;
    let suffix = apps_host_suffix();
    let base = suffix.trim().trim_start_matches('.').trim_end_matches('.');
    let runtime_url = if running {
        resolve_runtime_target(&state.local_appstore, app)
            .await
            .map(|_| {
                // Public URL is derived from the subdomain, not the target —
                // the browser must never see the internal host/port.
                format!("https://{app_id}.{base}/")
            })
    } else {
        None
    };

    let display = app
        .manifest
        .display
        .as_ref()
        .map(|d| serde_json::to_value(d).unwrap_or(serde_json::Value::Null));

    let external_url = app
        .custom_pages
        .first()
        .map(|p| p.url.clone())
        .or_else(|| {
            app.ports
                .first()
                .map(|p| format!("http://localhost:{}", p.external))
        });

    (
        StatusCode::OK,
        axum::Json(serde_json::json!({
            "app_id": app_id,
            "state": lifecycle.as_str(),
            "display": display,
            "runtime_url": runtime_url,
            "external_url": external_url,
            "ws_supported": running,
            "startable": matches!(lifecycle, AppLifecycleState::Stopped | AppLifecycleState::Failed | AppLifecycleState::Unhealthy),
        })),
    )
}

// ─── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn target(port: u16, internal: u16) -> RuntimeTarget {
        RuntimeTarget {
            host: "127.0.0.1".to_string(),
            port,
            internal_port: internal,
            protocol: "http".to_string(),
        }
    }

    #[test]
    fn subdomain_parsing() {
        let suffix = ".apps.ora.local";
        assert_eq!(
            apps_subdomain_app_id("nextcloud.apps.ora.local", suffix).as_deref(),
            Some("nextcloud")
        );
        assert_eq!(
            apps_subdomain_app_id("nextcloud.apps.ora.local:3001", suffix).as_deref(),
            Some("nextcloud")
        );
        assert_eq!(
            apps_subdomain_app_id("files.apps.ora.local", suffix).as_deref(),
            Some("files")
        );
        // Bare base domain / wrong suffix / multi-label prefixes are rejected.
        assert_eq!(apps_subdomain_app_id("ora.local", suffix), None);
        assert_eq!(apps_subdomain_app_id("apps.ora.local", suffix), None);
        assert_eq!(apps_subdomain_app_id("example.com", suffix), None);
        assert_eq!(
            apps_subdomain_app_id("sub.nextcloud.apps.ora.local", suffix),
            None
        );
        assert_eq!(
            apps_subdomain_app_id("nextcloud.apps.ora.local.evil.com", suffix),
            None
        );
        // Custom suffix.
        assert_eq!(
            apps_subdomain_app_id("grafana.apps.example.test", ".apps.example.test")
                .as_deref(),
            Some("grafana")
        );
    }

    #[test]
    fn desktop_origin_derivation() {
        assert_eq!(
            desktop_origin_for_host("nextcloud.apps.ora.local", "https"),
            "https://ora.local"
        );
        assert_eq!(
            desktop_origin_for_host("nextcloud.apps.ora.local:3001", "http"),
            "http://ora.local:3001"
        );
        assert_eq!(
            desktop_origin_for_host("files.apps.ora.local:8443", "https"),
            "https://ora.local:8443"
        );
    }

    #[test]
    fn x_frame_options_removed() {
        let mut headers = HeaderMap::new();
        headers.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
        rewrite_response_headers(&mut headers, "https://ora.local", &target(8180, 80), "https://nextcloud.apps.ora.local");
        assert!(!headers.contains_key(header::X_FRAME_OPTIONS));
    }

    #[test]
    fn x_frame_options_sameorigin_removed() {
        let mut headers = HeaderMap::new();
        headers.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("SAMEORIGIN"));
        rewrite_response_headers(&mut headers, "https://ora.local", &target(8180, 80), "https://nextcloud.apps.ora.local");
        assert!(!headers.contains_key(header::X_FRAME_OPTIONS));
    }

    #[test]
    fn csp_frame_ancestors_none_replaced() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::CONTENT_SECURITY_POLICY,
            HeaderValue::from_static("default-src 'self'; frame-ancestors 'none'"),
        );
        rewrite_response_headers(&mut headers, "https://ora.local", &target(8180, 80), "https://nextcloud.apps.ora.local");
        let csp = headers
            .get(header::CONTENT_SECURITY_POLICY)
            .unwrap()
            .to_str()
            .unwrap();
        assert!(csp.contains("default-src 'self'"));
        assert!(csp.contains("frame-ancestors https://ora.local"));
        assert!(!csp.contains("'none'"));
    }

    #[test]
    fn csp_frame_ancestors_added_when_missing() {
        let policy = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'";
        let rewritten = sanitize_csp(policy, "https://ora.local");
        assert!(rewritten.contains("default-src 'self'"));
        assert!(rewritten.contains("img-src 'self' data:"));
        assert!(rewritten.contains("script-src 'self'"));
        assert!(rewritten.contains("frame-ancestors https://ora.local"));
        // All original directives preserved.
        let original_directives = policy.split(';').map(|d| d.trim().split_whitespace().next().unwrap()).collect::<Vec<_>>();
        for directive in original_directives {
            assert!(rewritten.contains(directive));
        }
    }

    #[test]
    fn complex_csp_preserved_and_rewritten() {
        let policy = "default-src 'self' https://*.nextcloud.com; connect-src 'self' wss://push.nextcloud.com; font-src 'self' data:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; frame-src 'self'; frame-ancestors 'self' https://cloud.example.org; worker-src 'self' blob:; manifest-src 'self'";
        let rewritten = sanitize_csp(policy, "https://ora.local");
        assert!(rewritten.contains("connect-src 'self' wss://push.nextcloud.com"));
        assert!(rewritten.contains("frame-src 'self'"));
        assert!(rewritten.contains("worker-src 'self' blob:"));
        assert!(rewritten.contains("frame-ancestors https://ora.local"));
        assert!(!rewritten.contains("cloud.example.org"));
        // Every other directive is untouched.
        for part in policy.split(';') {
            let d = part.trim();
            if d.is_empty() || d.to_ascii_lowercase().starts_with("frame-ancestors") {
                continue;
            }
            assert!(rewritten.contains(d));
        }
    }

    #[test]
    fn multiple_csp_headers_deduplicated() {
        let mut headers = HeaderMap::new();
        headers.append(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static("default-src 'self'; frame-ancestors 'none'"));
        headers.append(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static("default-src 'self'; frame-ancestors 'none'"));
        rewrite_response_headers(&mut headers, "https://ora.local", &target(8180, 80), "https://nextcloud.apps.ora.local");
        let values = headers
            .get_all(header::CONTENT_SECURITY_POLICY)
            .iter()
            .count();
        assert_eq!(values, 1);
        let csp = headers.get(header::CONTENT_SECURITY_POLICY).unwrap().to_str().unwrap();
        assert!(csp.contains("frame-ancestors https://ora.local"));
    }

    #[test]
    fn location_rewritten_to_public_origin() {
        let t = target(8180, 80);
        assert_eq!(
            rewrite_location("http://127.0.0.1:8180/login", &t, "https://nextcloud.apps.ora.local"),
            "https://nextcloud.apps.ora.local/login"
        );
        assert_eq!(
            rewrite_location("http://localhost:8180/apps/files?x=1#top", &t, "https://nextcloud.apps.ora.local"),
            "https://nextcloud.apps.ora.local/apps/files?x=1#top"
        );
        // Container IP redirect with the internal port.
        assert_eq!(
            rewrite_location("http://172.20.0.5:80/index.php", &t, "https://nextcloud.apps.ora.local"),
            "https://nextcloud.apps.ora.local/index.php"
        );
        // Private IP with a non-matching port is left alone.
        assert_eq!(
            rewrite_location("http://192.168.1.50:8080/other", &t, "https://nextcloud.apps.ora.local"),
            "http://192.168.1.50:8080/other"
        );
        // Relative and external redirects pass through.
        assert_eq!(rewrite_location("/login", &t, "https://nextcloud.apps.ora.local"), "/login");
        assert_eq!(
            rewrite_location("https://example.com/sso", &t, "https://nextcloud.apps.ora.local"),
            "https://example.com/sso"
        );
    }

    #[tokio::test]
    async fn lifecycle_state_mapping() {
        fn app(status: &str) -> InstalledApp {
            InstalledApp {
                id: "test".to_string(),
                name: "Test".to_string(),
                version: "1.0.0".to_string(),
                developer: "dev".to_string(),
                description: "".to_string(),
                icon: None,
                trust_level: "trusted".to_string(),
                enabled: true,
                autostart: false,
                status: status.to_string(),
                error_message: None,
                last_started_at: None,
                last_stopped_at: None,
                installed_at: "now".to_string(),
                source: "zip".to_string(),
                kind: "app".to_string(),
                system: false,
                manifest: crate::local_appstore::AppManifest {
                    id: "test".to_string(),
                    name: "Test".to_string(),
                    version: "1.0.0".to_string(),
                    developer: "dev".to_string(),
                    description: "".to_string(),
                    icon: None,
                    r#type: Some("app".to_string()),
                    permissions: vec![],
                    display: None,
                    extra: serde_json::Value::Null,
                },
                custom_pages: vec![],
                docker_config: None,
                ports: vec![],
                is_bundle: false,
                bundle_config: None,
                permission_grants: vec![],
                denied_permissions: vec![],
                permission_audit: vec![],
                assets_base_url: None,
            }
        }
        assert_eq!(resolve_lifecycle_state(&app("running")).await, AppLifecycleState::Running);
        assert_eq!(resolve_lifecycle_state(&app("starting")).await, AppLifecycleState::Starting);
        assert_eq!(resolve_lifecycle_state(&app("stopping")).await, AppLifecycleState::Stopping);
        assert_eq!(resolve_lifecycle_state(&app("stopped")).await, AppLifecycleState::Stopped);
        assert_eq!(resolve_lifecycle_state(&app("paused")).await, AppLifecycleState::Stopped);
        assert_eq!(resolve_lifecycle_state(&app("error")).await, AppLifecycleState::Failed);
    }

    #[test]
    fn hop_by_hop_stripped() {
        let mut headers = HeaderMap::new();
        headers.insert(header::CONNECTION, HeaderValue::from_static("keep-alive, upgrade"));
        headers.insert(header::UPGRADE, HeaderValue::from_static("websocket"));
        headers.insert(header::COOKIE, HeaderValue::from_static("app-session=abc"));
        headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("text/plain"));
        strip_hop_headers(&mut headers);
        assert!(!headers.contains_key(header::CONNECTION));
        assert!(!headers.contains_key(header::UPGRADE));
        assert!(headers.contains_key(header::COOKIE)); // app cookies pass through
        assert!(headers.contains_key(header::CONTENT_TYPE));
    }
}


// ─── Integration tests (mock upstream) ─────────────────────────────────────

#[cfg(test)]
mod integration_tests {
    use super::*;
    use axum::body::Body;
    use axum::routing::{get, post};
    use axum::Router;
    use futures_util::{SinkExt, StreamExt};
    use std::convert::Infallible;

    /// Mock upstream app: serves iframe-blocking headers, redirects,
    /// absolute-path assets, POST echo and a Set-Cookie.
    async fn spawn_mock_upstream() -> (u16, tokio::sync::oneshot::Sender<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let port = addr.port();
        // Redirect target must use THIS test's upstream port (tests run in
        // parallel — a shared static would race).
        let redirect = get(move || async move {
            axum::response::Redirect::temporary(&format!("http://127.0.0.1:{port}/target"))
        });
        let app = Router::new()
            .route(
                "/xfo-deny",
                get(|| async {
                    ([(header::X_FRAME_OPTIONS, "DENY")], "deny ok")
                }),
            )
            .route(
                "/xfo-sameorigin",
                get(|| async {
                    ([(header::X_FRAME_OPTIONS, "SAMEORIGIN")], "sameorigin ok")
                }),
            )
            .route(
                "/csp-none",
                get(|| async {
                    (
                        [
                            (
                                header::CONTENT_SECURITY_POLICY,
                                "default-src 'self'; frame-ancestors 'none'; style-src 'self'",
                            ),
                        ],
                        "csp ok",
                    )
                }),
            )
            .route(
                "/csp-complex",
                get(|| async {
                    (
                        [
                            (
                                header::CONTENT_SECURITY_POLICY,
                                "default-src 'self' https://cdn.example.com; connect-src 'self' wss://push.example.com; img-src 'self' data:; script-src 'self' 'unsafe-inline'; frame-ancestors 'self' https://cloud.example.org; worker-src 'self' blob:",
                            ),
                        ],
                        "complex ok",
                    )
                }),
            )
            .route("/redirect", redirect)
            .route("/target", get(|| async { "target reached" }))
            .route(
                "/assets/app.js",
                get(|| async {
                    (
                        [(header::CONTENT_TYPE, "text/javascript")],
                        "console.log('app');",
                    )
                }),
            )
            .route(
                "/echo",
                post(|body: String| async move {
                    (
                        [(header::SET_COOKIE, "app_session=abc; Path=/; SameSite=Lax")],
                        body,
                    )
                }),
            );
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let (_tx, _rx) = tokio::sync::oneshot::channel();
        (port, _tx)
    }

    fn target_for(port: u16) -> RuntimeTarget {
        RuntimeTarget {
            host: "127.0.0.1".to_string(),
            port,
            internal_port: 80,
            protocol: "http".to_string(),
        }
    }

    fn gateway_req(method: &str, path: &str) -> axum::extract::Request {
        axum::extract::Request::builder()
            .method(method)
            .uri(path)
            .header(header::HOST, "nextcloud.apps.ora.local")
            .body(Body::empty())
            .unwrap()
    }

    #[tokio::test]
    async fn proxies_and_removes_xfo_deny() {
        let (port, _keep) = spawn_mock_upstream().await;
        let resp = proxy_http(
            gateway_req("GET", "/xfo-deny"),
            &target_for(port),
            "nextcloud.apps.ora.local",
            "https://nextcloud.apps.ora.local",
            "https://ora.local",
            false,
            "nextcloud",
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);
        assert!(!resp.headers().contains_key(header::X_FRAME_OPTIONS));
    }

    #[tokio::test]
    async fn proxies_and_removes_xfo_sameorigin() {
        let (port, _keep) = spawn_mock_upstream().await;
        let resp = proxy_http(
            gateway_req("GET", "/xfo-sameorigin"),
            &target_for(port),
            "nextcloud.apps.ora.local",
            "https://nextcloud.apps.ora.local",
            "https://ora.local",
            false,
            "nextcloud",
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);
        assert!(!resp.headers().contains_key(header::X_FRAME_OPTIONS));
    }

    #[tokio::test]
    async fn rewrites_csp_frame_ancestors_none() {
        let (port, _keep) = spawn_mock_upstream().await;
        let resp = proxy_http(
            gateway_req("GET", "/csp-none"),
            &target_for(port),
            "nextcloud.apps.ora.local",
            "https://nextcloud.apps.ora.local",
            "https://ora.local",
            false,
            "nextcloud",
        )
        .await;
        let csp = resp
            .headers()
            .get(header::CONTENT_SECURITY_POLICY)
            .unwrap()
            .to_str()
            .unwrap();
        assert!(csp.contains("frame-ancestors https://ora.local"));
        assert!(csp.contains("default-src 'self'"));
        assert!(csp.contains("style-src 'self'"));
        assert!(!csp.contains("'none'"));
    }

    #[tokio::test]
    async fn preserves_complex_csp_and_controls_only_frame_ancestors() {
        let (port, _keep) = spawn_mock_upstream().await;
        let resp = proxy_http(
            gateway_req("GET", "/csp-complex"),
            &target_for(port),
            "nextcloud.apps.ora.local",
            "https://nextcloud.apps.ora.local",
            "https://ora.local",
            false,
            "nextcloud",
        )
        .await;
        let csp = resp
            .headers()
            .get(header::CONTENT_SECURITY_POLICY)
            .unwrap()
            .to_str()
            .unwrap();
        assert!(csp.contains("connect-src 'self' wss://push.example.com"));
        assert!(csp.contains("img-src 'self' data:"));
        assert!(csp.contains("worker-src 'self' blob:"));
        assert!(csp.contains("frame-ancestors https://ora.local"));
        assert!(!csp.contains("cloud.example.org"));
    }

    #[tokio::test]
    async fn rewrites_internal_redirect_to_public_origin() {
        let (port, _keep) = spawn_mock_upstream().await;
        let resp = proxy_http(
            gateway_req("GET", "/redirect"),
            &target_for(port),
            "nextcloud.apps.ora.local",
            "https://nextcloud.apps.ora.local",
            "https://ora.local",
            false,
            "nextcloud",
        )
        .await;
        assert_eq!(resp.status(), StatusCode::TEMPORARY_REDIRECT);
        let location = resp.headers().get(header::LOCATION).unwrap().to_str().unwrap();
        assert!(location.starts_with("https://nextcloud.apps.ora.local/"), "got {location}");
        assert!(!location.contains("127.0.0.1"));
    }

    #[tokio::test]
    async fn preserves_absolute_asset_paths() {
        let (port, _keep) = spawn_mock_upstream().await;
        let resp = proxy_http(
            gateway_req("GET", "/assets/app.js"),
            &target_for(port),
            "nextcloud.apps.ora.local",
            "https://nextcloud.apps.ora.local",
            "https://ora.local",
            false,
            "nextcloud",
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(
            resp.headers().get(header::CONTENT_TYPE).unwrap(),
            "text/javascript"
        );
    }

    #[tokio::test]
    async fn forwards_post_body_and_app_cookies() {
        let (port, _keep) = spawn_mock_upstream().await;
        let req = axum::extract::Request::builder()
            .method("POST")
            .uri("/echo")
            .header(header::HOST, "nextcloud.apps.ora.local")
            .header(header::CONTENT_TYPE, "text/plain")
            .header(header::COOKIE, "app_session=from-browser")
            .body(Body::from("hello upstream"))
            .unwrap();
        let resp = proxy_http(
            req,
            &target_for(port),
            "nextcloud.apps.ora.local",
            "https://nextcloud.apps.ora.local",
            "https://ora.local",
            false,
            "nextcloud",
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);
        // The app's own Set-Cookie passes through untouched (host-scoped to
        // the app subdomain by the browser).
        assert!(resp.headers().contains_key(header::SET_COOKIE));
    }

    #[tokio::test]
    async fn websocket_tunnel_echoes_transparently() {
        let (port, _keep) = spawn_mock_upstream().await;
        let _ = port;

        // Upstream: raw TCP listener that upgrades to WebSocket and echoes.
        let upstream_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let upstream_port = upstream_listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            loop {
                let (stream, _) = upstream_listener.accept().await.unwrap();
                tokio::spawn(async move {
                    let ws = match tokio_tungstenite::accept_async(stream).await {
                        Ok(ws) => ws,
                        Err(_) => return,
                    };
                    let (mut sink, mut source) = ws.split();
                    while let Some(Ok(msg)) = source.next().await {
                        if sink.send(msg).await.is_err() {
                            break;
                        }
                    }
                });
            }
        });

        let target = RuntimeTarget {
            host: "127.0.0.1".to_string(),
            port: upstream_port,
            internal_port: 80,
            protocol: "http".to_string(),
        };

        // Hyper server running our gateway WebSocket handler.
        let gateway_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let gateway_port = gateway_listener.local_addr().unwrap().port();
        let svc = hyper::service::service_fn(move |req: hyper::Request<hyper::body::Incoming>| {
            let target = target.clone();
            async move {
                let req = axum::extract::Request::from_parts(req.into_parts().0, Body::empty());
                Ok::<_, Infallible>(
                    proxy_websocket(req, &target, "wstest.apps.ora.local", "https://ora.local", false, "wstest").await,
                )
            }
        });
        tokio::spawn(async move {
            loop {
                let (stream, _) = gateway_listener.accept().await.unwrap();
                let svc = svc.clone();
                tokio::spawn(async move {
                    let _ = hyper::server::conn::http1::Builder::new()
                        .serve_connection(hyper_util::rt::TokioIo::new(stream), svc)
                        .with_upgrades()
                        .await;
                });
            }
        });

        // Client connects through the gateway with a normal WebSocket URL.
        let (mut ws, _) =
            tokio_tungstenite::connect_async(format!("ws://127.0.0.1:{gateway_port}/echo"))
                .await
                .expect("websocket handshake through gateway");
        ws.send(tokio_tungstenite::tungstenite::Message::Text("ping".into()))
            .await
            .unwrap();
        let reply = ws
            .next()
            .await
            .expect("echo reply")
            .expect("valid frame");
        assert_eq!(
            reply,
            tokio_tungstenite::tungstenite::Message::Text("ping".into())
        );
    }
}


#[cfg(test)]
mod gateway_more_tests {
    use super::*;

    #[tokio::test]
    async fn state_page_for_stopped_app_has_start_action() {
        let resp = app_state_page("nextcloud", "Nextcloud", AppLifecycleState::Stopped, "https://ora.local");
        assert_eq!(resp.status(), StatusCode::OK);
        // The state page may only be framed by the ORA desktop origin.
        let csp = resp
            .headers()
            .get(header::CONTENT_SECURITY_POLICY)
            .unwrap()
            .to_str()
            .unwrap();
        assert!(csp.contains("frame-ancestors https://ora.local"));
        let body = axum::body::to_bytes(resp.into_body(), 128 * 1024).await.unwrap();
        let html = String::from_utf8_lossy(&body);
        assert!(html.contains("STOPPED"));
        assert!(html.contains("App starten"));
        assert!(html.contains("app.requestStart"));
    }

    #[tokio::test]
    async fn state_page_for_failed_app_has_start_action() {
        let resp = app_state_page("nextcloud", "Nextcloud", AppLifecycleState::Failed, "https://ora.local");
        let body = axum::body::to_bytes(resp.into_body(), 128 * 1024).await.unwrap();
        let html = String::from_utf8_lossy(&body);
        assert!(html.contains("FAILED"));
        assert!(html.contains("App starten"));
    }

    #[tokio::test]
    async fn state_page_for_starting_app_has_no_start_button() {
        let resp = app_state_page("nextcloud", "Nextcloud", AppLifecycleState::Starting, "https://ora.local");
        let body = axum::body::to_bytes(resp.into_body(), 128 * 1024).await.unwrap();
        let html = String::from_utf8_lossy(&body);
        assert!(html.contains("STARTING"));
        // The start button exists but is hidden while the app is starting.
        assert!(html.contains("id=\"start\" class=\"hidden\""));
        assert!(html.contains("App starten"));
    }

    #[tokio::test]
    async fn state_page_restricts_framing_to_desktop_origin() {
        let resp = app_state_page("files", "Files", AppLifecycleState::Stopped, "http://ora.local:3001");
        let csp = resp
            .headers()
            .get(header::CONTENT_SECURITY_POLICY)
            .unwrap()
            .to_str()
            .unwrap();
        assert!(csp.contains("frame-ancestors http://ora.local:3001"));
        assert!(!csp.contains("frame-ancestors *"));
    }
}

#[cfg(test)]
mod restart_target_tests {
    use super::*;
    use axum::body::Body;
    use axum::routing::get;
    use axum::Router;

    /// Simulates an app restart with a CHANGED runtime target: the gateway
    /// resolves the target per request (live lifecycle), so two consecutive
    /// requests to different upstream ports both succeed without any static
    /// proxy configuration.
    async fn spawn_port_echo_upstream(label: &'static str) -> u16 {
        let app = Router::new().route(
            "/whoami",
            get(move || async move { format!("upstream:{label}") }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        port
    }

    fn req() -> axum::extract::Request {
        axum::extract::Request::builder()
            .uri("/whoami")
            .header(header::HOST, "nextcloud.apps.ora.local")
            .body(Body::empty())
            .unwrap()
    }

    #[tokio::test]
    async fn restart_with_changed_target_serves_new_runtime() {
        // "Before restart": upstream A on port P1.
        let port_a = spawn_port_echo_upstream("before-restart").await;
        let target_a = RuntimeTarget {
            host: "127.0.0.1".to_string(),
            port: port_a,
            internal_port: 80,
            protocol: "http".to_string(),
        };
        let resp_a = proxy_http(
            req(),
            &target_a,
            "nextcloud.apps.ora.local",
            "https://nextcloud.apps.ora.local",
            "https://ora.local",
            false,
            "nextcloud",
        )
        .await;
        let body_a = axum::body::to_bytes(resp_a.into_body(), 128 * 1024).await.unwrap();
        assert_eq!(body_a, "upstream:before-restart");

        // "After restart": the container gets a NEW host port P2. The gateway
        // simply resolves the new target — no reconfiguration.
        let port_b = spawn_port_echo_upstream("after-restart").await;
        let target_b = RuntimeTarget {
            host: "127.0.0.1".to_string(),
            port: port_b,
            internal_port: 80,
            protocol: "http".to_string(),
        };
        assert_ne!(port_a, port_b);
        let resp_b = proxy_http(
            req(),
            &target_b,
            "nextcloud.apps.ora.local",
            "https://nextcloud.apps.ora.local",
            "https://ora.local",
            false,
            "nextcloud",
        )
        .await;
        let body_b = axum::body::to_bytes(resp_b.into_body(), 128 * 1024).await.unwrap();
        assert_eq!(body_b, "upstream:after-restart");
    }
}

#[cfg(test)]
mod https_upstream_tests {
    use super::*;
    use axum::body::Body;
    use std::convert::Infallible;
    use std::io::Read as _;

    // Self-signed cert (CN=localhost, SAN localhost + 127.0.0.1) + PKCS#8 key
    // generated with openssl — used ONLY by this test to run a TLS mock
    // upstream. Real apps use their own certificates.
    const TEST_CERT_PEM: &str = "-----BEGIN CERTIFICATE-----
MIIDJTCCAg2gAwIBAgIUM5G458hv254IWnNg4Z1eLpqgG4IwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJbG9jYWxob3N0MB4XDTI2MDgxMDA2NTMwMFoXDTM2MDgw
NzA2NTMwMFowFDESMBAGA1UEAwwJbG9jYWxob3N0MIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEA6jYlSwyOAmrR6FbfvQlEJ0OqGuU/VvK2DflmyIg7JD0x
V/zCotMMP63PLfLcfQsQkjAnP5vJYUcs7zFdQHlV8las6drUceLDtR9UMeE/aR7B
12M+YmqHLo99kRqB/MuwRAXfHGzTHJa2XePL/9oS7QOEB7vJss7g/OR7gUun51qc
E9YL74OuEhxNwAYYhd06IuAp/NpP+gq2QAkgVAg+PGmJDOCr5AM+Hv5Gqk6Fia6S
hGBVRiButzCFGQVyDHO7B3FAbMkRVUUM3RiX6LbVeyeOrIX6VZQVca8q5XpifxYq
0B+HJXznzZ282U7PrhPmO/cY3xCQWj+XNJpSjifRZwIDAQABo28wbTAdBgNVHQ4E
FgQUu7WclhnSkfQL71aE3dmhMRQNxk0wHwYDVR0jBBgwFoAUu7WclhnSkfQL71aE
3dmhMRQNxk0wDwYDVR0TAQH/BAUwAwEB/zAaBgNVHREEEzARgglsb2NhbGhvc3SH
BH8AAAEwDQYJKoZIhvcNAQELBQADggEBADH5tve7zLHWV9xTqvRN/DdnCuYe1KTo
Yjg9xXEK6x7aGhIZ74HVCdl3/uOR/YDW/pKx3vOuDbYhCEF1YW1zJXPd491mlCYQ
6qWHVTWJz6rxmN102pqjdBWRqxcjSeU1rvGAeZOz9Eaqyr3aJrRXR0zXC1a+hNgC
Q/lksDZg7VdFChqt7I9mpRUTS0qv+7iFZvmT9za9bPOzlIPlf37+b7cUY9q/cOyv
dR5OgNYGj1lnFC3CFRomexhjizrXOX/vgDrRXXa7SpW2fDaOJ3GESIHr3o6STJgf
lnyR9pu7xgRdA8Gfdp8HNox/wrtDjyKjWKZ6ac/1BM8nJ8YnA+8Mx28=
-----END CERTIFICATE-----";

    const TEST_KEY_PEM: &str = "-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDqNiVLDI4CatHo
Vt+9CUQnQ6oa5T9W8rYN+WbIiDskPTFX/MKi0ww/rc8t8tx9CxCSMCc/m8lhRyzv
MV1AeVXyVqzp2tRx4sO1H1Qx4T9pHsHXYz5iaocuj32RGoH8y7BEBd8cbNMclrZd
48v/2hLtA4QHu8myzuD85HuBS6fnWpwT1gvvg64SHE3ABhiF3Toi4Cn82k/6CrZA
CSBUCD48aYkM4KvkAz4e/kaqToWJrpKEYFVGIG63MIUZBXIMc7sHcUBsyRFVRQzd
GJfottV7J46shfpVlBVxryrlemJ/FirQH4clfOfNnbzZTs+uE+Y79xjfEJBaP5c0
mlKOJ9FnAgMBAAECggEATALtoIk/D3bGkC6dp3a56TpTGy56m4fi4O8n1f4sn4rC
mGk+a+StzX7lxeZTe7ubEa7SFhlDxq/4W9q8BoA6jg9mR/FO0HVFieNUimmtkDq8
s2AQr5UeMVS9blnZhQdAOhtjuRByhY0+O4OCQhNu4AArmezuvXrZ1wl6MdCxeeo1
usRDU3sq8xHCiQo48T25nOkdMmOFu0YmdPtXt9lskzotff64qD1q3Tfx9nqbOYd2
xltnARRTE+5eDGmsaGL7wv2g/N6Z4QgT3tkIbJQaKEVNUNdETiIw8xczEdzcK1C+
ynQsPKHcW4dHC+OwKfZh47GHqM6MJG50VOeczSufEQKBgQD+8JJknt8cMlJ4H1aC
pEwO7jKJGmBgUbVOCXgY3IhEw+Ht2nkNjoDj7h4j9mj29f9l6cMsTim1DaxzcxUL
NivG/cBnqGgzvOSg5jDGft9AYkPPw6FHp8qQ8hzNh0arbUVcZ/5YVElgEr1ahy82
crfTT4pezsElq6GM61z/jY1qdwKBgQDrL4FG355lbB0g4qDLHenjUzeGFiHa7AUC
fsXiBsZfwc7VLaXhA5XNHwW737slRa01bbMLDaYR7Noe4/U+Ck1RzgL06dC5ryY5
B2oCILwsbv7qfxb7kGtaUhwjmCgA8c0Gk5Fqmjg35X0Gn1ZwpQX1QPwVYga4RcOy
nIeJKsKckQKBgQCjY2dPWYrANXgpSFxXahjc0MhOmjr+QB+knej8dgpXl/rqR8Sh
bZ0pd2iVv8zRyiMfG8xcTtPoF5VYgH8SKmuwItz3EjWGQx98B0tnS9SlHNU9CLIK
jH0EnEbdaj9eiq+TY4rc7VgBXMFCjbUyfh9WLHoP/Q5IqFDnUcjOd9gUTQKBgDGV
ZWME2Ec3wPhi71WDbAEiVU1usxqNsgyxn5SkqwQbPzkQk61Z7SY+yR2v8KvOAdOG
2j2VVhLnZaEnnFfFIkIB9fuepAPR2nQhjQb/0cxoZlQYEUdeTlPPheE3Pg/c6sXd
LMZV105pkq9nvninQhdP6RW1AgetpbGtcKHJoxgRAoGBAOlESgR4Y7AzG/zqgXdC
7PcuiqTNH1hR5e1gq7Igu4HTyaA1Q0X/J+uYZLw5RwVPLu81tiU8R5b0GI9DkqmU
uYMz9/53jIdcDjSSh8ATFyGYPjt3DXLrpCrbTky8cFKygrhoEupPTg2mcYqVWPEM
rzZT/YXil/zH/pH27a+wO0dH
-----END PRIVATE KEY-----";

    fn pem_to_der(pem: &str) -> Vec<u8> {
        use base64::Engine as _;
        let body: String = pem
            .lines()
            .filter(|l| !l.starts_with("-----"))
            .collect();
        base64::engine::general_purpose::STANDARD
            .decode(body.trim())
            .expect("valid base64 pem body")
    }

    /// Spawn a TLS (https) mock upstream with iframe-blocking headers.
    async fn spawn_tls_upstream() -> u16 {
        ensure_tls_provider();
        let cert_der = rustls_gw::pki_types::CertificateDer::from(pem_to_der(TEST_CERT_PEM));
        let key_der = rustls_gw::pki_types::PrivatePkcs8KeyDer::from(pem_to_der(TEST_KEY_PEM));
        let server_config = rustls_gw::ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(vec![cert_der], key_der.into())
            .expect("valid server cert");
        let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(server_config));

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();

        let service = hyper::service::service_fn(
            |_req: hyper::Request<hyper::body::Incoming>| async move {
                let resp = Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, "text/plain")
                    .header(header::X_FRAME_OPTIONS, "DENY")
                    .header(
                        header::CONTENT_SECURITY_POLICY,
                        "default-src 'self'; frame-ancestors 'none'",
                    )
                    .body(Body::from("secure upstream ok"))
                    .unwrap();
                Ok::<_, Infallible>(resp)
            },
        );

        tokio::spawn(async move {
            loop {
                let (stream, _) = listener.accept().await.unwrap();
                let acceptor = acceptor.clone();
                let service = service.clone();
                tokio::spawn(async move {
                    let Ok(tls_stream) = acceptor.accept(stream).await else { return };
                    let _ = hyper::server::conn::http1::Builder::new()
                        .serve_connection(hyper_util::rt::TokioIo::new(tls_stream), service)
                        .await;
                });
            }
        });
        port
    }

    #[tokio::test]
    async fn https_upstream_is_proxied_and_headers_rewritten() {
        let port = spawn_tls_upstream().await;
        let target = RuntimeTarget {
            host: "127.0.0.1".to_string(),
            port,
            internal_port: 443,
            protocol: "https".to_string(),
        };
        let req = axum::extract::Request::builder()
            .uri("/secure")
            .header(header::HOST, "nextcloud.apps.ora.local")
            .body(Body::empty())
            .unwrap();
        let resp = proxy_http(
            req,
            &target,
            "nextcloud.apps.ora.local",
            "https://nextcloud.apps.ora.local",
            "https://ora.local",
            true, // insecure upstream TLS (self-signed test cert)
            "nextcloud",
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);
        // XFO stripped, CSP frame-ancestors rewritten, body intact.
        assert!(!resp.headers().contains_key(header::X_FRAME_OPTIONS));
        let csp = resp
            .headers()
            .get(header::CONTENT_SECURITY_POLICY)
            .unwrap()
            .to_str()
            .unwrap();
        assert!(csp.contains("frame-ancestors https://ora.local"));
        assert!(!csp.contains("'none'"));
        let body = axum::body::to_bytes(resp.into_body(), 128 * 1024).await.unwrap();
        assert_eq!(body, "secure upstream ok");
    }

    #[test]
    fn upstream_scheme_reads_manifest() {
        fn app_with_config(docker: Option<serde_json::Value>) -> InstalledApp {
            InstalledApp {
                id: "tls-app".to_string(),
                name: "TLS App".to_string(),
                version: "1.0.0".to_string(),
                developer: "dev".to_string(),
                description: "".to_string(),
                icon: None,
                trust_level: "trusted".to_string(),
                enabled: true,
                autostart: false,
                status: "running".to_string(),
                error_message: None,
                last_started_at: None,
                last_stopped_at: None,
                installed_at: "now".to_string(),
                source: "zip".to_string(),
                kind: "app".to_string(),
                system: false,
                manifest: crate::local_appstore::AppManifest {
                    id: "tls-app".to_string(),
                    name: "TLS App".to_string(),
                    version: "1.0.0".to_string(),
                    developer: "dev".to_string(),
                    description: "".to_string(),
                    icon: None,
                    r#type: Some("app".to_string()),
                    permissions: vec![],
                    display: None,
                    extra: serde_json::Value::Null,
                },
                custom_pages: vec![],
                docker_config: docker,
                ports: vec![],
                is_bundle: false,
                bundle_config: None,
                permission_grants: vec![],
                denied_permissions: vec![],
                permission_audit: vec![],
                assets_base_url: None,
            }
        }
        // No scheme → http.
        assert_eq!(
            upstream_scheme(&app_with_config(Some(serde_json::json!({ "image": "x" })))),
            "http"
        );
        // Explicit https scheme → https.
        assert_eq!(
            upstream_scheme(&app_with_config(Some(serde_json::json!({ "scheme": "https" })))),
            "https"
        );
        // Case-insensitive + bundle config fallback.
        assert_eq!(
            upstream_scheme(&app_with_config(None)),
            "http"
        );
        let mut bundle_app = app_with_config(None);
        bundle_app.bundle_config = Some(serde_json::json!({ "scheme": "HTTPS" }));
        assert_eq!(upstream_scheme(&bundle_app), "https");
    }
}
