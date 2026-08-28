# rumahl Status — status.rumahl.com

Independent status page for the rumahl platform, running **without** any rumahl
infrastructure: a **Next.js** frontend (static export) + a **PHP 8.x** backend on
MySQL. Runs on plain shared hosting / customer servers.

```
statuspage/
├── frontend/          Next.js app (static export → out/)
│   ├── app/           public page, uptime history, incidents, admin
│   └── lib/           API client + types
├── backend/
│   ├── api/           PHP backend source (dev / legacy api/-mount deployment)
│   │   ├── index.php  REST API front controller
│   │   ├── cron.php   HTTP cron entry (cron.php?key=…)
│   │   ├── install.php  one-time web installer
│   │   ├── seed.php   optional: seed default components
│   │   └── src/       config, db, checks, status, incidents, alerts
│   ├── root/          ★ RECOMMENDED deployment: single-entry website root
│   │   ├── index.php  router (backend routes + static frontend serving)
│   │   ├── .htaccess  rewrite everything to the router, blocks src/
│   │   └── build.sh   generates the deployable root (src/ + frontend/)
│   └── cron/monitor.php  CLI cron entry (php cron/monitor.php)
└── README.md, UPDATE.md
```

## Deployment (recommended: root router)

The website root contains exactly **one public PHP file** (`index.php`, the
router) — fewer entry points, no `/api` mount, backend sources unreachable:

```
httpdocs/
├── index.php          ← router (all requests)
├── .htaccess          ← rewrite + src/ protection
├── src/               ← backend modules (never served directly)
├── migrations/        ← SQL migration files (loaded by db.php)
├── frontend/          ← static Next.js export (out/)
└── robots.txt, …      ← optional extra static files
```

Build + upload:

```bash
cd frontend && npm run build        # static export → frontend/out/
bash backend/root/build.sh          # → backend/root/ ready to upload
# upload the CONTENTS of backend/root/ to httpdocs/
# then on the server:
php src/upgrade.php
```

Routes handled by the router: `/api/*` (compat), `/rss`, `/feed`, `/favicon.svg`,
`/status.json`, `/cron.php`, `/upgrade.php`, `/install.php` — everything else is
served from `frontend/` (404.html fallback).

> **Legacy deployment** (old style, still supported): upload `backend/api/` as
> `httpdocs/api/` — the API keeps working under `/api/*`.

## Features (statuspage.io scope)

- **Public status page** — overall banner, component groups with live status,
  90-day uptime percentages, active incidents, scheduled maintenance
- **Uptime history** — daily availability chart (30/60/90 days), per component
- **Incidents** — create / update / resolve with a public update timeline,
  impact levels, affected components; RSS feed (`/api/feed`)
- **Scheduled maintenance** — shown on the public page with expected end time
- **Monitoring** — HTTP checks (GET/HEAD/POST/OPTIONS) with expected status,
  timeout, latency threshold; status derived from the last N checks
  (operational → degraded → partial outage → major outage)
- **Notifications** — email (`mail()`) + webhooks (Discord / Slack / generic)
  on component status changes and incident updates
- **Machine-readable API** — `/api/status.json` in statuspage.io style
- **Admin UI** — components, groups, incidents, check log, run-now, settings
  (Bearer token auth)
- **Multiple public pages** — one shared frontend/backend can route each page
  by a verified custom domain and/or `/s/<slug>/`; both modes are independently
  enabled per page in the admin UI
- **Per-page presentation** — select the monitoring services shown publicly
  and configure title, description, logo, favicon and an optional HTTPS custom
  stylesheet without deploying a separate frontend
- **Branding uploads** — logos and favicons can be entered as URLs or uploaded
  directly (SVG/PNG/JPEG/WebP, maximum 2 MB). SVG logos can keep their colors,
  generate a light/dark pair automatically, or use a separately uploaded dark
  logo. Inline CSS is available through the admin CSS editor.
- **Responsive header branding** — each page can use independent desktop and
  mobile logos (including dark variants), or replace all header artwork with
  the configured page title as text.
- **Failure diagnostics** — failed HTTP checks retain timing, network details,
  masked request/response headers and a bounded response excerpt

## Requirements

- Web server with **PHP 8.1+** (target: 8.5) with `pdo_mysql`, `curl`, `openssl`
- **MySQL / MariaDB** database (created beforehand, e.g. `rumahl_status`)
- Cron access (CLI) **or** any HTTP cron service for the monitoring loop
- Node.js 18+ only for building the frontend (not needed on the server)

## Install

### 1. Build the frontend

```bash
cd frontend
npm ci
npm run build        # → out/ (static HTML/JS)
```

Optional: `echo "NEXT_PUBLIC_API_BASE=https://status.rumahl.com/api" > .env.local`
before building (default is same-origin `/api`).

### 2. Deploy

```
docroot/                  ← upload frontend/out/* here
└── api/                  ← upload backend/api/* here (keep src/ and config)
```

On Apache the shipped `.htaccess` routes `/api/*` to `index.php`, forwards the
Authorization header (`SetEnvIf`) and denies `src/`. On nginx add:

```nginx
location /api/ {
    try_files $uri $uri/ /api/index.php?$query_string;
    fastcgi_param HTTP_AUTHORIZATION $http_authorization;  # required for admin auth
}
location ~ ^/api/(src|config\.local\.php) { deny all; }
```

### Maintenance (503) & 404

The build ships custom error pages: `404.html` (unknown routes) and
`503/index.html` (maintenance, shown at `/503/`). Point your server at them:

```apache
# Apache — serve the maintenance page with a real 503 status
ErrorDocument 503 /503/
# (optional) ErrorDocument 404 /404.html
```

```nginx
# nginx — maintenance mode:
# error_page 503 /503/index.html;
# error_page 404 /404.html;
# location = /503/index.html { internal; }
```

While in maintenance, either switch to a maintenance config or use
`RewriteRule` to send all requests to the 503 page.

### 3. Install the backend

Open `https://status.rumahl.com/api/install.php`, enter MySQL credentials,
an **admin token** (min. 12 chars) and a **cron key**. The installer creates
the schema and writes `api/src/config.local.php`. **Delete install.php**
afterwards.

Alternatively (CLI):

```bash
mysql -u <user> -p <database> < api/schema.sql
php -r 'file_put_contents("api/src/config.local.php",
  "<?php\nreturn " . var_export(["db" => ["host"=>"…","port"=>3306,"name"=>"…","user"=>"…","pass"=>"…"],
  "admin_token" => "…", "cron_key" => "…"], true) . ";\n");'
```

### 4. Seed components (optional)

```bash
php api/seed.php          # idempotent; --reset to start over
```
Adjust the endpoint URLs in `seed.php` so they are reachable **from this
server** (the rumahl services may need public URLs / VPN / firewall rules).

### 5. Cron — every minute

CLI (preferred):

```
* * * * * php /path/to/docroot/api/cron/monitor.php >> /var/log/rumahl-status.log 2>&1
```

No CLI access? Use any HTTP cron (cron-job.org, hosting panel) with:

```
https://status.rumahl.com/api/cron.php?key=YOUR_CRON_KEY
```

### 6. Admin

`https://status.rumahl.com/admin/` → sign in with the admin token.
Configure notifications under **Settings** (recipients, webhook URLs,
latency threshold, failure window).

Custom domains use a DNS TXT record named `_rumahl-status.<domain>`. The admin
UI displays its generated value after the page is saved. The backend verifies
the record automatically when that hostname is first requested.

Migration `013_status_page_component_configuration.sql` stores collapsed and
automatic expansion behavior, service visibility, display mode and history
range independently for every status page.

Migration `014_status_page_layout_configuration.sql` adds page-specific header,
navigation and fully replaceable footer configuration. Migration
`015_status_page_disabled_components.sql` controls whether disabled components
remain visible on each individual public status page. Custom CSS is edited with
a CodeMirror CSS editor with syntax highlighting, folding, completion and
automatic indentation.

The complete visual customization workflow, supported CSS hooks and practical
desktop/mobile examples are documented in [CUSTOMIZATION.md](CUSTOMIZATION.md).

Migration `016_status_page_localization.sql` adds a default language, enabled
locales and translated page content per status page. Translations can replace
the public title, description, navigation labels, footer text and the complete
footer-link collection. The public language selector uses i18next and remembers
the visitor's selection per status page.

Checks created in the monitoring center are executed by the same cron entry as
legacy component checks. Their interval, retries, timeout, request options and
threshold state are persisted in `monitor_checks`; response-time samples are
written to `monitoring_metrics` for the monitor detail chart.

### Optional failure screenshots on shared hosting

PHP/cURL captures all textual diagnostics itself. Rendering a real browser
screenshot requires a browser renderer, which typical Plesk shared hosting does
not provide. An optional HTTPS screenshot endpoint can therefore be configured:

```text
STATUSPAGE_SCREENSHOT_ENDPOINT=https://screenshots.example.com/capture
STATUSPAGE_SCREENSHOT_TOKEN=provider-token
STATUSPAGE_SCREENSHOT_TIMEOUT_MS=15000
```

On a failed HTTP check the backend POSTs `{"url":"…","full_page":true}` and
expects `{"url":"https://…"}`. The resulting link appears beside the failed
check. Sensitive headers (`Authorization`, cookies, API keys, tokens and
secrets) are stored only in partially masked form: beginning, a short middle
segment and ending remain visible for identification.

## API overview

| Route | Description |
|---|---|
| `GET /api/status` | full public status (groups, components, uptime, incidents) |
| `GET /api/status.json` | statuspage.io-style machine output |
| `GET /api/uptime?component=<id>&days=90` | daily uptime series |
| `GET /api/incidents[?page=1&per_page=25]` | incident list |
| `GET /api/incidents?id=<id>` | incident detail with update timeline |
| `GET /api/feed` | RSS feed of incidents |
| `POST /api/admin/auth/verify` | check admin token |
| `GET/POST /api/admin/settings` | page + monitoring + notification settings |
| `GET /api/admin/components` | components with groups |
| `POST /api/admin/components` | create / update / delete component |
| `POST /api/admin/groups` | create / update / delete group |
| `POST /api/admin/incidents` | create / update / resolve / delete incident |
| `POST /api/admin/checks/run` | run the monitor now |
| `GET /api/admin/checks` | recent check results |

All `/api/admin/*` routes require the admin token — sent as
`Authorization: Bearer <token>`, as `X-Auth-Token: <token>` (recommended on
hosts that strip the Authorization header for PHP-FPM, e.g. Plesk), or for
the login check also in the JSON body (`{"token": …}`).

## Local development

```bash
# backend (MySQL needed; see api/schema.sql)
cd backend && php -S 127.0.0.1:8088 dev-router.php

# frontend (proxy API: .env.local with NEXT_PUBLIC_API_BASE)
cd frontend && npm run dev
```

## Notes

- Timestamps are stored in UTC; the frontend renders local time.
- `check_results` are pruned after 14 days; `uptime_daily` keeps the full
  history (used for the charts and percentages).
- Alerts are queued in `alert_log` and delivered at the end of each monitor
  cycle — a failed `mail()` is retried on the next cycle until success.
- The status page design mirrors rumahl.com (Manrope/JetBrains Mono, dark
  theme, teal accent) but is fully independent — no rumahl backend involved.
