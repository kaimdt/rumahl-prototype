# Updating rumahl Status

Updating an existing installation **never loses data**. All schema migrations are
**additive**: they only `ADD COLUMN` with defaults — existing rows, incidents,
checks, uptime history and settings are never touched, renamed or deleted.

## Quick upgrade (recommended)

```bash
# 1. Upload the new backend files (everything under backend/api/) to the server,
#    replacing the old files. Your config (backend/api/src/config.local.php)
#    stays untouched.

# 2. Run the upgrade — creates a full MySQL dump in statuspage/backups/
#    (timestamped, kept on the server) and applies missing migrations:
php backend/api/upgrade.php

# or over HTTP (hosting panels without SSH):
#   https://status.rumahl.com/api/upgrade.php?key=YOUR_CRON_KEY

# 3. Rebuild the frontend locally and upload the new out/ folder:
cd frontend
npm ci
npm run build      # → frontend/out/  (upload this to the web root)
```

That's it. The schema self-migrates on every request anyway
(`db_ensure_schema()`), so `upgrade.php` is the *controlled* variant: it backs
up first and reports what changed.

## What the upgrade reports

```
rumahl Status Page upgrade
─────────────────────────────
App version        : 1.2.0
Schema version     : v1 → v3
Migrations applied : v2, v3
Backup             : /tmp/rumahl-status-backups/statuspage-20260626-101530.sql (php)
```

- `Migrations applied : (none — already up to date)` → your schema was current
  (the page auto-migrates on its first request, so this is normal right after
  uploading the new files — the version marker is still updated).
- `Backup : NOT created` → the backup directory was not writable or the dump
  failed; the migration itself is still safe (additive), but take a manual
  dump if you want a restore point.

## Backups

`upgrade.php` creates a full SQL dump **before** migrating, using the first
method that works:

1. `mysqldump` via the shell (when `exec()` is available on the host), or
2. a **pure-PHP dump** (works on any shared hosting, no shell required).

The dump lands in `{backup_dir}/statuspage-YYYYMMDD-HHMMSS.sql`. The default
backup directory is the **system temp dir** (`sys_get_temp_dir()`, always
inside `open_basedir`). To choose a different location, set the environment
variable `STATUSPAGE_BACKUP_DIR` or add to `backend/api/src/config.local.php`:

```php
return [
    // …existing keys…
    'backup_dir' => '/var/www/vhosts/example.com/tmp',
];
```

## Version history

| App version | Schema | Changes |
|---|---|---|
| 1.0.0 | v1 | initial release |
| 1.1.0 | v2 | RSS at `/rss`, check types (http/tcp/ping), custom headers, softfail log, auto incidents, status favicon |
| 1.2.0 | v3 | collapsible groups (default + auto-expand), per-component views (compact/bars/extended), latency chart, uptime bar tooltip with outage details, upgrade tool |

## Restoring a backup

```bash
mysql -u USER -p DATABASE < backups/statuspage-YYYYMMDD-HHMMSS.sql
```

## Manual backup (if the automatic dump fails)

```bash
mysqldump -u USER -p DATABASE > statuspage-backup.sql
# or via the hosting panel's phpMyAdmin export (structure + data, SQL format)
```

## Notes

- Never delete `backend/api/src/config.local.php` during an update — it holds
  your DB credentials and admin/cron keys.
- `schema.sql` is only the baseline for **new** installations. Existing
  databases are migrated by `db_ensure_schema()` / `upgrade.php`, so do not
  run `schema.sql` manually on an existing database.
- Downgrades are not supported.
