# App Embedding Gateway

Installed ORA apps run inside the ORA desktop as iframes — on their **own
origin**, served by the **App Embedding Gateway**. The gateway is a
transparent reverse proxy for apps ORA controls. It is **not**
server-side rendering and **not** the ORA Browser: the app content is fully
rendered and executed by the user's browser. It also never makes arbitrary
external websites iframe-capable.

## Origins

| Surface | Origin |
| --- | --- |
| ORA Desktop | `https://ora.local` |
| App runtime (iframe) | `https://<app-id>.apps.ora.local/` |
| Example: Nextcloud | `https://nextcloud.apps.ora.local/` |
| Example: Files | `https://files.apps.ora.local/` |

The desktop route `/app/<id>` (e.g. `https://ora.local/app/nextcloud`)
remains the launcher/bookmark route. The actual app HTTP traffic flows
through the app subdomain, never through a path prefix on the desktop
origin — many apps rely on absolute URLs (`/static/app.js`), WebSockets and
redirects, which only work reliably on their own origin with `/` as root.

## How it works

1. The browser loads `https://<app-id>.apps.ora.local/…` (Host header).
2. iora-home's gateway middleware resolves the app id from the subdomain.
3. The gateway looks up the app in the **live app lifecycle** (docker
   compose status + published ports) — there is **no static port/route
   table**. Starting, stopping or restarting an app with a changed runtime
   target needs no reconfiguration.
4. If the app is `RUNNING`, the request is proxied (all HTTP methods,
   streaming bodies, WebSocket upgrades).
5. If not, a structured app-state page (`STARTING` / `RUNNING` / `STOPPING`
   / `STOPPED` / `FAILED` / `UNHEALTHY`) is served instead of a raw proxy
   error; the desktop App Runner shows its own state UI and can trigger a
   start via the lifecycle manager.

## iframe compatibility

The gateway controls iframe-blocking headers on proxied responses:

- `X-Frame-Options` is **removed**.
- `Content-Security-Policy` is **not** stripped: every directive is kept,
  only `frame-ancestors` is controlled — it is replaced (or added) with
  the ORA desktop origin, e.g. `frame-ancestors https://ora.local`.
  Multiple CSP headers are rewritten and deduplicated so they never
  conflict.
- Internal `Location` redirects (container IP/port, `localhost`) are
  rewritten to the public app origin so redirects stay inside the app.

## Security isolation

- Apps are **never same-origin** with the desktop (separate subdomains), so
  a compromised app cannot access the desktop DOM, cookies,
  localStorage/sessionStorage or ORA-internal objects.
- ORA auth is Bearer-JWT based; the legacy `iora_token` cookie is
  host-only (`SameSite=Lax`, no `Domain`) and is **not** sent to app
  subdomains. App cookies stay host-scoped to the app subdomain.
- The gateway never injects desktop credentials into upstream requests.
- Apps that open in `external` mode are not embedded at all.

## App Manifest

The manifest controls embedding via a `display` section:

```json
{
  "display": {
    "mode": "embedded",
    "isolation": "strict",
    "permissions": ["clipboard-write", "fullscreen"]
  }
}
```

- `mode`: `embedded` (default — inside the ORA App Runner iframe) or
  `external` (new browser context).
- `isolation`: `relaxed` (default) or `strict` (adds a restrictive iframe
  `sandbox` policy: scripts/forms/popups/downloads/same-origin allowed,
  privileged/escape capabilities denied). An explicit `sandbox: [...]`
  list overrides the default.
- `permissions`: mapped 1:1 to the iframe `allow` attribute. Privileged
  APIs (camera, microphone, geolocation, clipboard, …) are **never**
  granted unless explicitly listed.

## WebSockets

HTTP upgrades are tunneled transparently — the client's handshake headers
(including `Sec-WebSocket-Key`) are forwarded upstream, the 101 response is
relayed and the raw streams are spliced. Apps need no special
implementation for `wss://<app-id>.apps.ora.local/socket`.

## HTTPS upstreams

Apps that serve TLS inside their container are supported: set
`docker.scheme: "https"` (or `bundle.scheme`) in the manifest. The gateway
then reaches the app over TLS (SNI = the public app hostname, connection to
the published port). Since LAN-internal apps often use self-signed
certificates, set `IORA_GATEWAY_INSECURE_UPSTREAM_TLS=1` to accept them
(opt-in, never the default).

## Per-app settings (Einstellungen → Apps)

Like Apple's Settings, every installed app gets its own page under
**Settings → Apps**:

- lifecycle: start / stop, status badge, open the web UI
- **„App außerhalb von ORA OS aufrufen“** — per-app switch that opens the
  app directly via its published port in a browser tab instead of the
  embedded gateway runner (a user override on top of the manifest
  `display.mode`)
- permissions: granted/denied toggles persisted via the app permissions API
- uninstall (danger zone)

## ORA ↔ App communication (postMessage bridge)

Apps cannot touch the desktop DOM. The bridge is a controlled
`window.postMessage()` channel with **origin + appId validation** on both
sides. Reserved message types:

- `app.ready`, `app.requestStart`, `app.requestFullscreen`,
  `app.openFile`, `app.setTitle`, `app.setBadge`
- `ora.themeChanged`, `ora.lifecycleChanged`

## Runtime info endpoint

`GET /api/apps/:app_id/runtime` returns the canonical state, public runtime
URL and display metadata used by the App Runner — never internal
ports/addresses.

## Development notes

- On loopback hosts (localhost/127.0.0.1 — e.g. the Vite dev server) the
  subdomain cannot resolve, so the App Runner falls back to the legacy
  same-origin proxy route for local development.
- `IORA_APPS_HOST_SUFFIX` (default `.apps.ora.local`) and
  `IORA_DESKTOP_ORIGIN` override the host suffix / desktop origin used for
  `frame-ancestors` and redirect rewriting.
- `IORA_GATEWAY_INSECURE_UPSTREAM_TLS=1` accepts self-signed certificates
  on HTTPS upstreams (LAN-internal apps).
- The nginx template no longer adds a global `X-Frame-Options` header and
  no longer generates per-app `/apps/<id>/` proxy locations — the gateway
  handles apps centrally; `*.apps.ora.local` is routed to iora-home by the
  default server block.
