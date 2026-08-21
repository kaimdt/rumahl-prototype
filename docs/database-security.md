# rumahl Database Security & Management System

## Overview

rumahl OS includes a comprehensive database security system that provides:

- **Per-Service PostgreSQL Users**: Each rumahl service gets its own database user with restricted privileges
- **Automatic Password Rotation**: Passwords are rotated every 90 days (configurable)
- **Centralized Migration Management**: Automatic database migrations on system updates
- **Security Best Practices**: Connection limits, privilege restrictions, and audit logging

## Components

### 1. rumahl-db-manager

Central tool for managing PostgreSQL users, passwords, and security.

**Installation:**
```bash
# Built as part of rumahl OS
cargo build -p rumahl-db-manager --release
```

**Commands:**
```bash
# Initialize all service databases and users
rumahl-db-manager init

# Rotate passwords (manual)
rumahl-db-manager rotate
rumahl-db-manager rotate --service rumahl-home

# Show database status
rumahl-db-manager status

# Create new service database
rumahl-db-manager create my-service

# Export connection strings
rumahl-db-manager export --format env > services.env
rumahl-db-manager export --format systemd

# Backup all databases
rumahl-db-manager backup --dir /var/backups/rumahl-db

# Check rotation schedule
rumahl-db-manager check
```

### 2. rumahl-migrate

Centralized database migration tool.

**Commands:**
```bash
# Run all pending migrations
rumahl-migrate up

# Run migrations for specific service
rumahl-migrate up --service rumahl-home

# Rollback last migration
rumahl-migrate down rumahl-home

# Show migration status
rumahl-migrate status
rumahl-migrate status --service rumahl-core

# Create new migration
rumahl-migrate create rumahl-home add_user_preferences

# Validate checksums
rumahl-migrate validate

# Mark migration as applied (skip execution)
rumahl-migrate mark rumahl-home 001_initial_schema
```

### 3. Systemd Services

**rumahl-db-init.service**
- Runs at boot before all other rumahl services
- Initializes all databases and users
- Creates credential files

**rumahl-migrations.service**
- Runs after rumahl-db-init
- Applies pending migrations automatically
- Blocks service startup until complete

**rumahl-db-rotation.service & .timer**
- Runs daily at 3 AM
- Rotates passwords for services due for rotation
- Notifies services to reload credentials

## Architecture

### Per-Service Security

Each rumahl service gets:

1. **Dedicated PostgreSQL User**
   - Format: `{service}_user` (e.g., `rumahl_home_user`)
   - Restricted privileges (NOSUPERUSER, NOREPLICATION, etc.)
   - Configurable connection limits

2. **Dedicated Database**
   - Format: `rumahl_{service}` (e.g., `rumahl_home`)
   - Owned by service user
   - Isolated from other services

3. **Secure Credentials File**
   - Location: `/etc/ora/db-credentials/{service}.env`
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
/opt/rumahl/migrations/
├── rumahl-home/
│   ├── 001_initial_schema.sql
│   ├── 002_add_users.sql
│   └── 003_add_settings.sql
├── rumahl-core/
│   ├── 001_core_schema.sql
│   └── 002_plugins_apps.sql
└── rumahl-assist/
    ├── 001_rumahl_ai_schema.sql
    └── 002_memory_tasks.sql
```

**Migration File Format:**
```sql
-- Migration: Add user preferences
-- Service: rumahl-home
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
- Database table: `_rumahl_migrations`
- Tracks: service, migration name, checksum, timestamp
- Supports: rollback, validation, repair
- Detects: modified migrations (checksum mismatch)

## Configuration

### /etc/ora/db-config.toml

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
[services.rumahl-home]
conn_limit = 30                 # Max concurrent connections
allow_ddl = true                # Can run CREATE/ALTER/DROP
allow_temp_tables = true        # Can create temporary tables

[services.rumahl-secrets]
conn_limit = 20
allow_ddl = false               # Read/write only, no schema changes
allow_temp_tables = false       # No temp tables for security
```

## Service Integration

### Using Service-Specific Credentials

All rumahl services automatically use per-service credentials via `rumahl-shared`:

```rust
use rumahl_shared::system_config;

// Automatically loads from /etc/ora/db-credentials/rumahl-home.env
let db_url = system_config::database_url_for("rumahl-home");

let pool = PgPool::connect(&db_url).await?;
```

**Priority Order:**
1. `/etc/ora/db-credentials/{service}.env` (managed by rumahl-db-manager)
2. `{SERVICE}_DB_URL` environment variable
3. `DATABASE_URL` environment variable
4. Default SQLite fallback

### Handling Password Rotation

Services automatically reload credentials when notified:

1. **rumahl-db-manager** rotates password
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
- Password rotations: `_rumahl_password_history`
- Migrations: `_rumahl_migrations`
- User changes: PostgreSQL audit log
- systemd journal: `journalctl -u rumahl-db-rotation`

## Maintenance

### Manual Password Rotation

```bash
# Rotate specific service
sudo rumahl-db-manager rotate --service rumahl-home

# Rotate all services
sudo rumahl-db-manager rotate
```

### Database Backups

```bash
# Manual backup
sudo rumahl-db-manager backup --dir /var/backups/rumahl-db

# Automated backups (via rumahl-backup service)
sudo systemctl enable --now rumahl-backup.timer
```

### Migration Repair

If migrations are modified after being applied:

```bash
# Check for mismatches
sudo rumahl-migrate validate

# Repair checksums (use with caution!)
sudo rumahl-migrate repair --yes
```

### Troubleshooting

**Check database status:**
```bash
sudo rumahl-db-manager status
```

**Check migration status:**
```bash
sudo rumahl-migrate status
```

**View rotation schedule:**
```bash
sudo rumahl-db-manager check
```

**Check service credentials:**
```bash
sudo cat /etc/ora/db-credentials/rumahl-home.env
```

**Test database connection:**
```bash
sudo -u postgres psql -d rumahl_home -U rumahl_home_user
```

**View rotation logs:**
```bash
sudo journalctl -u rumahl-db-rotation -n 50
```

## Development

### Dev VM

The rumahl Dev VM uses the same database security system:

```bash
./dev-local.sh

# Check database status in VM
ssh -i .cache/rumahl-dev-key -p 2222 root@127.0.0.1 \
    "rumahl-db-manager status"
```

**Dev Mode Differences:**
- Password rotation disabled by default (`auto_rotate = false`)
- Shorter backup retention (7 days vs 30)
- Superuser access for root user (dev convenience)

### Creating Migrations

1. **Create migration file:**
```bash
rumahl-migrate create rumahl-home add_feature_table
```

2. **Edit the generated file:**
```sql
-- /opt/rumahl/migrations/rumahl-home/004_add_feature_table.sql

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
rumahl-migrate up --dry-run

# Apply
rumahl-migrate up --service rumahl-home
```

4. **Rollback if needed:**
```bash
rumahl-migrate down rumahl-home --steps 1
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
   - Run `rumahl-db-manager check` weekly
   - Plan maintenance windows for overdue rotations

2. **Regular backups**
   - Enable `rumahl-backup.timer`
   - Test restore procedures

3. **Review audit logs**
   - Check rotation logs monthly
   - Monitor failed migrations

4. **Update rotation interval**
   - Edit `/etc/ora/db-config.toml`
   - Balance security vs. operational overhead

## Migration from Legacy System

If migrating from shared credentials:

1. **Backup existing databases:**
```bash
sudo rumahl-db-manager backup --dir /var/backups/pre-migration
```

2. **Initialize new system:**
```bash
sudo rumahl-db-manager init --force
```

3. **Update service configurations:**
   - Remove hardcoded `DATABASE_URL` from systemd units
   - Services will auto-load from `/etc/ora/db-credentials/`

4. **Restart all services:**
```bash
sudo systemctl daemon-reload
sudo systemctl restart rumahl-home rumahl-core rumahl-assist
```

5. **Verify:**
```bash
sudo rumahl-db-manager status
sudo journalctl -u rumahl-home -n 20  # Check for connection errors
```

## FAQ

**Q: What happens if a service connects during rotation?**
A: Grace period keeps old password valid for 24 hours. No downtime.

**Q: Can I extend the grace period?**
A: Yes, edit `grace_period_hours` in `/etc/ora/db-config.toml`.

**Q: What if rumahl-db-manager fails during init?**
A: Services fall back to `DATABASE_URL` env var. Check logs with `journalctl -u rumahl-db-init`.

**Q: How do I disable rotation for a service?**
A: Set `auto_rotate = false` in the service config section.

**Q: Can I use custom database names?**
A: Yes, add `database = "custom_name"` to service config.

**Q: What about Docker Compose installations?**
A: rumahl-db-manager works in Docker. Mount `/etc/ora/db-credentials` as volume.

## See Also

- [Global Config System](./global-config.md)
- [Service Architecture](./service-architecture.md)
- [Security Best Practices](./security/best-practices.md)
- [Backup & Restore](./backup-restore.md)
