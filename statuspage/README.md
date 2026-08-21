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
│   ├── api/           PHP backend (front controller, admin API, cron, installer)
│   │   ├── index.php  REST API (see below)
│   │   ├── cron.php   HTTP cron entry (cron.php?key=…)
│   │   ├── install.php  one-time web installer
│   │   ├── seed.php   optional: seed default components
│   │   └── src/       config, db, checks, status, incidents, alerts (denied via .htaccess)
│   ├── cron/monitor.php  CLI cron entry (php cron/monitor.php)
│   ├── dev-router.php    local dev server router (php -S)
│   └── api/schema.sql    MySQL schema (ships inside the api/ folder)
└── README.md
```

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
