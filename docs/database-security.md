# IORA Database Security & Management System

## Overview

IORA OS includes a comprehensive database security system that provides:

- **Per-Service PostgreSQL Users**: Each IORA service gets its own database user with restricted privileges
- **Automatic Password Rotation**: Passwords are rotated every 90 days (configurable)
- **Centralized Migration Management**: Automatic database migrations on system updates
- **Security Best Practices**: Connection limits, privilege restrictions, and audit logging

## Components

### 1. iora-db-manager

Central tool for managing PostgreSQL users, passwords, and security.

**Installation:**
```bash
# Built as part of IORA OS
cargo build -p iora-db-manager --release
```

**Commands:**
```bash
# Initialize all service databases and users
iora-db-manager init

# Rotate passwords (manual)
iora-db-manager rotate
iora-db-manager rotate --service iora-home

# Show database status
iora-db-manager status

# Create new service database
iora-db-manager create my-service

# Export connection strings
iora-db-manager export --format env > services.env
iora-db-manager export --format systemd

# Backup all databases
iora-db-manager backup --dir /var/backups/iora-db

# Check rotation schedule
iora-db-manager check
```

### 2. iora-migrate

Centralized database migration tool.

**Commands:**
```bash
# Run all pending migrations
iora-migrate up

# Run migrations for specific service
iora-migrate up --service iora-home

# Rollback last migration
iora-migrate down iora-home

# Show migration status
iora-migrate status
iora-migrate status --service iora-core

# Create new migration
iora-migrate create iora-home add_user_preferences

# Validate checksums
iora-migrate validate

# Mark migration as applied (skip execution)
iora-migrate mark iora-home 001_initial_schema
```

### 3. Systemd Services

**iora-db-init.service**
- Runs at boot before all other IORA services
- Initializes all databases and users
- Creates credential files

**iora-migrations.service**
- Runs after iora-db-init
- Applies pending migrations automatically
- Blocks service startup until complete

**iora-db-rotation.service & .timer**
- Runs daily at 3 AM
- Rotates passwords for services due for rotation
- Notifies services to reload credentials

## Architecture

### Per-Service Security

Each IORA service gets:

1. **Dedicated PostgreSQL User**
   - Format: `{service}_user` (e.g., `iora_home_user`)
   - Restricted privileges (NOSUPERUSER, NOREPLICATION, etc.)
   - Configurable connection limits

2. **Dedicated Database**
   - Format: `iora_{service}` (e.g., `iora_home`)
   - Owned by service user
   - Isolated from other services

3. **Secure Credentials File**
   - Location: `/etc/iora/db-credentials/{service}.env`
   - Permissions: 0600 (root only)
   - Format: `DATABASE_URL=postgres://user:password@localhost:5432/database`

### Password Rotation

**Rotation Schedule:**
- Default: 90 days
- Grace period: 24 hours (old password remains valid)
- Automatic or manual trigger

**Rotation Process:**
1. Generate new strong password (32+ characters)
2. Update PostgreSQL user password
3. Write new credentials file
4. Notify service via systemd reload
5. Archive old password (grace period)
6. Clean up expired passwords

**Password Requirements:**
- Minimum 32 characters
- Mix of uppercase, lowercase, digits, special characters
- Cryptographically secure random generation
- SHA256 checksums for tracking

### Migration System

**Migration File Structure:**
```
/opt/iora/migrations/
├── iora-home/
│   ├── 001_initial_schema.sql
│   ├── 002_add_users.sql
│   └── 003_add_settings.sql
├── iora-core/
│   ├── 001_core_schema.sql
│   └── 002_plugins_apps.sql
└── iora-assist/
    ├── 001_ora_ai_schema.sql
    └── 002_memory_tasks.sql
```

**Migration File Format:**
```sql
-- Migration: Add user preferences
-- Service: iora-home
-- Created: 2025-01-15 10:30:00 UTC

-- UP Migration
CREATE TABLE IF NOT EXISTS user_preferences (
    user_id UUID PRIMARY KEY,
    theme VARCHAR(50) DEFAULT 'system',
    language VARCHAR(10) DEFAULT 'en',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- DOWN Migration (Rollback)
-- -- DOWN --
DROP TABLE IF EXISTS user_preferences;
```

**Migration Tracking:**
- Database table: `_iora_migrations`
- Tracks: service, migration name, checksum, timestamp
- Supports: rollback, validation, repair
- Detects: modified migrations (checksum mismatch)

## Configuration

### /etc/iora/db-config.toml

```toml
[global]
default_conn_limit = 20
enable_rls = true
recommend_pooling = true
backup_retention_days = 30

[rotation]
interval_days = 90              # Rotate every 90 days
min_password_length = 32        # Minimum password length
grace_period_hours = 24         # Old password valid for 24h
auto_rotate = true              # Enable automatic rotation

# Per-Service Configuration
[services.iora-home]
conn_limit = 30                 # Max concurrent connections
allow_ddl = true                # Can run CREATE/ALTER/DROP
allow_temp_tables = true        # Can create temporary tables

[services.iora-secrets]
conn_limit = 20
allow_ddl = false               # Read/write only, no schema changes
allow_temp_tables = false       # No temp tables for security
```

## Service Integration

### Using Service-Specific Credentials

All IORA services automatically use per-service credentials via `iora-shared`:

```rust
use iora_shared::system_config;

// Automatically loads from /etc/iora/db-credentials/iora-home.env
let db_url = system_config::database_url_for("iora-home");

let pool = PgPool::connect(&db_url).await?;
```

**Priority Order:**
1. `/etc/iora/db-credentials/{service}.env` (managed by iora-db-manager)
2. `{SERVICE}_DB_URL` environment variable
3. `DATABASE_URL` environment variable
4. Default SQLite fallback

### Handling Password Rotation

Services automatically reload credentials when notified:

1. **iora-db-manager** rotates password
2. Writes new credential file
3. Sends `systemctl reload-or-restart {service}`
4. Service reconnects with new credentials

**Grace Period:**
- Old password valid for 24 hours
- Allows gradual rollout across services
- Zero-downtime rotation

## Security Features

### User Privileges

**Restricted Services** (allow_ddl = false):
- `GRANT CONNECT ON DATABASE`
- `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES`
- `GRANT USAGE ON SCHEMA public`
- NO: CREATE TABLE, ALTER TABLE, DROP TABLE
- NO: SUPERUSER, REPLICATION, BYPASSRLS

**Migration Services** (allow_ddl = true):
- All above permissions
- `CREATE TABLE`, `ALTER TABLE`, `DROP TABLE`
- Can run schema migrations
- Still: NOSUPERUSER, NOREPLICATION

### Connection Limits

Each service has configurable connection limits:
- Prevents resource exhaustion
- Enforces connection pooling
- Typical limits: 15-30 connections

### Audit Logging

All database operations logged:
- Password rotations: `_iora_password_history`
- Migrations: `_iora_migrations`
- User changes: PostgreSQL audit log
- systemd journal: `journalctl -u iora-db-rotation`

## Maintenance

### Manual Password Rotation

```bash
# Rotate specific service
sudo iora-db-manager rotate --service iora-home

# Rotate all services
sudo iora-db-manager rotate
```

### Database Backups

```bash
# Manual backup
sudo iora-db-manager backup --dir /var/backups/iora-db

# Automated backups (via iora-backup service)
sudo systemctl enable --now iora-backup.timer
```

### Migration Repair

If migrations are modified after being applied:

```bash
# Check for mismatches
sudo iora-migrate validate

# Repair checksums (use with caution!)
sudo iora-migrate repair --yes
```

### Troubleshooting

**Check database status:**
```bash
sudo iora-db-manager status
```

**Check migration status:**
```bash
sudo iora-migrate status
```

**View rotation schedule:**
```bash
sudo iora-db-manager check
```

**Check service credentials:**
```bash
sudo cat /etc/iora/db-credentials/iora-home.env
```

**Test database connection:**
```bash
sudo -u postgres psql -d iora_home -U iora_home_user
```

**View rotation logs:**
```bash
sudo journalctl -u iora-db-rotation -n 50
```

## Development

### Dev VM

The IORA Dev VM uses the same database security system:

```bash
./dev-local.sh

# Check database status in VM
ssh -i .cache/iora-dev-key -p 2222 root@127.0.0.1 \
    "iora-db-manager status"
```

**Dev Mode Differences:**
- Password rotation disabled by default (`auto_rotate = false`)
- Shorter backup retention (7 days vs 30)
- Superuser access for root user (dev convenience)

### Creating Migrations

1. **Create migration file:**
```bash
iora-migrate create iora-home add_feature_table
```

2. **Edit the generated file:**
```sql
-- /opt/iora/migrations/iora-home/004_add_feature_table.sql

-- UP Migration
CREATE TABLE features (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    enabled BOOLEAN DEFAULT false
);

-- DOWN Migration
-- -- DOWN --
DROP TABLE features;
```

3. **Test migration:**
```bash
# Dry run
iora-migrate up --dry-run

# Apply
iora-migrate up --service iora-home
```

4. **Rollback if needed:**
```bash
iora-migrate down iora-home --steps 1
```

## Best Practices

### For Service Developers

1. **Always use `system_config::database_url_for()`**
   - Never hardcode credentials
   - Automatic credential file loading

2. **Handle connection errors gracefully**
   - Retry logic for password rotation
   - Exponential backoff

3. **Use connection pooling**
   - Respect connection limits
   - Typical: 10-20 connections per service

4. **Test with limited privileges**
   - Ensure code works without SUPERUSER
   - Test DDL restrictions

### For Administrators

1. **Monitor rotation schedule**
   - Run `iora-db-manager check` weekly
   - Plan maintenance windows for overdue rotations

2. **Regular backups**
   - Enable `iora-backup.timer`
   - Test restore procedures

3. **Review audit logs**
   - Check rotation logs monthly
   - Monitor failed migrations

4. **Update rotation interval**
   - Edit `/etc/iora/db-config.toml`
   - Balance security vs. operational overhead

## Migration from Legacy System

If migrating from shared credentials:

1. **Backup existing databases:**
```bash
sudo iora-db-manager backup --dir /var/backups/pre-migration
```

2. **Initialize new system:**
```bash
sudo iora-db-manager init --force
```

3. **Update service configurations:**
   - Remove hardcoded `DATABASE_URL` from systemd units
   - Services will auto-load from `/etc/iora/db-credentials/`

4. **Restart all services:**
```bash
sudo systemctl daemon-reload
sudo systemctl restart iora-home iora-core iora-assist
```

5. **Verify:**
```bash
sudo iora-db-manager status
sudo journalctl -u iora-home -n 20  # Check for connection errors
```

## FAQ

**Q: What happens if a service connects during rotation?**
A: Grace period keeps old password valid for 24 hours. No downtime.

**Q: Can I extend the grace period?**
A: Yes, edit `grace_period_hours` in `/etc/iora/db-config.toml`.

**Q: What if iora-db-manager fails during init?**
A: Services fall back to `DATABASE_URL` env var. Check logs with `journalctl -u iora-db-init`.

**Q: How do I disable rotation for a service?**
A: Set `auto_rotate = false` in the service config section.

**Q: Can I use custom database names?**
A: Yes, add `database = "custom_name"` to service config.

**Q: What about Docker Compose installations?**
A: iora-db-manager works in Docker. Mount `/etc/iora/db-credentials` as volume.

## See Also

- [Global Config System](./global-config.md)
- [Service Architecture](./service-architecture.md)
- [Security Best Practices](./security/best-practices.md)
- [Backup & Restore](./backup-restore.md)
