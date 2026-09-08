# rumahl Backup Service

Comprehensive backup and restore functionality for rumahl OS.

## Features

### ✅ Complete System Backups
- **Databases**: All PostgreSQL databases (rumahl_home, rumahl_core, rumahl_security, rumahl_secrets, etc.)
- **Docker Volumes**: All rumahl-managed Docker volumes
- **System Configuration**: /etc/ora/, docker-compose.yml, environment files
- **User Data**: /var/lib/ora/ directory with all user files
- **Apps**: Installed app data from /var/lib/ora/apps/

### ⏰ Time-Based Scheduling
- Cron-based scheduled backups (e.g., daily at 2 AM)
- Configurable retention policy (keep backups for N days)
- Automatic cleanup of old backups

### 🔄 Pre-Update Backups
- Automatic backup creation before RAUC updates
- Configurable retention count (keep last N pre-update backups)
- Integrated with rumahl-updater service

### ☁️ Remote Storage Backends
- **FTP/FTPS**: Traditional FTP servers
- **WebDAV**: Compatible with Nextcloud, ownCloud, and standard WebDAV servers
- **S3-Compatible**: Amazon S3, MinIO, DigitalOcean Spaces, etc.

### 🎛️ User-Configurable Content
Users can choose what to include in backups:
- Enable/disable database backups
- Enable/disable Docker volume backups
- Enable/disable system configuration backups
- Enable/disable user data backups
- Enable/disable app data backups

## Architecture

```
┌─────────────────┐
│  rumahl-updater   │──────┐
└─────────────────┘      │
                         │ Pre-update backup
                         ▼
                ┌──────────────────┐
                │  rumahl-backup     │
                │  (Port 8100)     │
                └──────────────────┘
                         │
         ┌───────────────┼───────────────┐
         │               │               │
         ▼               ▼               ▼
┌─────────────┐  ┌──────────────┐  ┌──────────┐
│  PostgreSQL │  │ Docker Vols  │  │  Remote  │
│  Databases  │  │   & Files    │  │  Storage │
└─────────────┘  └──────────────┘  └──────────┘
```

## API Endpoints

### Configuration

#### GET `/api/backup/config`
Get current backup configuration.

**Response:**
```json
{
  "enabled": true,
  "include_databases": true,
  "include_docker_volumes": true,
  "include_system_config": true,
  "include_user_data": true,
  "include_apps": true,
  "schedule_enabled": true,
  "schedule_cron": "0 2 * * *",
  "schedule_retention_days": 7,
  "pre_update_enabled": true,
  "pre_update_retention_count": 3,
  "remote_storage_enabled": true,
  "remote_storage_backend": "webdav",
  "remote_storage_config": {
    "type": "webdav",
    "url": "https://cloud.example.com/remote.php/dav",
    "username": "user",
    "password": "***",
    "path": "/backups/ora"
  }
}
```

#### POST `/api/backup/config`
Update backup configuration.

**Request Body:**
```json
{
  "schedule_enabled": true,
  "schedule_cron": "0 3 * * *",
  "remote_storage_enabled": true,
  "remote_storage_backend": "s3",
  "remote_storage_config": {
    "type": "s3",
    "region": "us-east-1",
    "bucket": "my-rumahl-backups",
    "access_key": "AKIAIOSFODNN7EXAMPLE",
    "secret_key": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    "path": "rumahl-backups"
  }
}
```

### Backup Operations

#### POST `/api/backup/create`
Create a new backup.

**Request Body:**
```json
{
  "name": "Manual Backup 2026-04-22",
  "backup_type": "manual",
  "include_databases": true,
  "include_docker_volumes": true,
  "include_system_config": true,
  "include_user_data": true,
  "include_apps": true,
  "upload_to_remote": true
}
```

**Response:**
```json
{
  "backup_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "creating",
  "message": "Backup creation started"
}
```

#### GET `/api/backup/list`
List all backups.

**Response:**
```json
{
  "backups": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "Manual Backup 2026-04-22",
      "backup_type": "manual",
      "created_at": "2026-04-22T14:30:00Z",
      "size_mb": 1250.5,
      "status": "completed",
      "has_remote_copy": true,
      "content_summary": {
        "databases": true,
        "docker_volumes": true,
        "system_config": true,
        "user_data": true,
        "apps": true
      }
    }
  ],
  "total": 15,
  "total_size_bytes": 20971520000
}
```

#### GET `/api/backup/{backup_id}`
Get backup details.

**Response:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Manual Backup 2026-04-22",
  "backup_type": "manual",
  "created_at": "2026-04-22T14:30:00Z",
  "size_bytes": 1311744000,
  "local_path": "/var/lib/ora/backups/backup_550e8400_20260422_143000.tar.gz",
  "remote_path": "/backups/ora/backup_550e8400_20260422_143000.tar.gz",
  "remote_backend": "webdav",
  "status": "uploaded",
  "content_manifest": {
    "databases": true,
    "docker_volumes": true,
    "system_config": true,
    "user_data": true,
    "apps": true
  }
}
```

#### POST `/api/backup/restore`
Restore from a backup.

**Request Body:**
```json
{
  "backup_id": "550e8400-e29b-41d4-a716-446655440000",
  "restore_databases": true,
  "restore_docker_volumes": true,
  "restore_system_config": true,
  "restore_user_data": true,
  "restore_apps": true
}
```

**Response:**
```json
{
  "message": "Restore started",
  "backup_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

#### DELETE `/api/backup/{backup_id}`
Delete a backup.

**Response:**
```json
{
  "message": "Backup deleted"
}
```

#### POST `/api/backup/pre-update`
Create pre-update backup (called automatically by rumahl-updater).

**Response:**
```json
{
  "backup_id": "660e8400-e29b-41d4-a716-446655440000",
  "status": "creating",
  "message": "Pre-update backup started"
}
```

## Configuration Examples

### Daily Backups with 7-Day Retention

```bash
curl -X POST http://localhost:8100/api/backup/config \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "schedule_enabled": true,
    "schedule_cron": "0 2 * * *",
    "schedule_retention_days": 7,
    "include_databases": true,
    "include_docker_volumes": true,
    "include_system_config": true,
    "include_user_data": true,
    "include_apps": true
  }'
```

### WebDAV Remote Storage (Nextcloud)

```bash
curl -X POST http://localhost:8100/api/backup/config \
  -H "Content-Type: application/json" \
  -d '{
    "remote_storage_enabled": true,
    "remote_storage_backend": "webdav",
    "remote_storage_config": {
      "type": "webdav",
      "url": "https://cloud.example.com/remote.php/dav/files/username",
      "username": "username",
      "password": "app-password",
      "path": "backups/ora"
    }
  }'
```

### S3-Compatible Storage (MinIO)

```bash
curl -X POST http://localhost:8100/api/backup/config \
  -H "Content-Type: application/json" \
  -d '{
    "remote_storage_enabled": true,
    "remote_storage_backend": "s3",
    "remote_storage_config": {
      "type": "s3",
      "endpoint": "https://minio.example.com",
      "region": "us-east-1",
      "bucket": "rumahl-backups",
      "access_key": "minioadmin",
      "secret_key": "minioadmin",
      "path": "backups"
    }
  }'
```

### FTP Storage

```bash
curl -X POST http://localhost:8100/api/backup/config \
  -H "Content-Type: application/json" \
  -d '{
    "remote_storage_enabled": true,
    "remote_storage_backend": "ftp",
    "remote_storage_config": {
      "type": "ftp",
      "host": "ftp.example.com",
      "port": 21,
      "username": "ftpuser",
      "password": "ftppass",
      "path": "/backups/ora",
      "use_tls": false
    }
  }'
```

## Cron Schedule Syntax

The `schedule_cron` field uses standard cron syntax:

```
┌───────────── minute (0 - 59)
│ ┌───────────── hour (0 - 23)
│ │ ┌───────────── day of month (1 - 31)
│ │ │ ┌───────────── month (1 - 12)
│ │ │ │ ┌───────────── day of week (0 - 6) (Sunday = 0)
│ │ │ │ │
* * * * *
```

**Examples:**
- `0 2 * * *` - Daily at 2:00 AM
- `0 */6 * * *` - Every 6 hours
- `0 3 * * 0` - Weekly on Sunday at 3:00 AM
- `0 4 1 * *` - Monthly on the 1st at 4:00 AM
- `0 0 * * 1-5` - Weekdays at midnight

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8100` | HTTP server port |
| `DATABASE_URL` | `postgres://ora:changeme@postgres:5432/rumahl_backup` | PostgreSQL connection string |
| `POSTGRES_HOST` | `postgres` | PostgreSQL host for pg_dump |
| `POSTGRES_USER` | `ora` | PostgreSQL username |
| `POSTGRES_PASSWORD` | `changeme` | PostgreSQL password |
| `BACKUP_DIR` | `/var/lib/ora/backups` | Local backup storage directory |
| `RUST_LOG` | `info` | Log level (error, warn, info, debug, trace) |
| `RUMAHL_OS` | `false` | Set to `true` on rumahl OS for enhanced features |

## Backup File Format

Backups are stored as compressed tar.gz archives with the following structure:

```
backup_550e8400_20260422_143000.tar.gz
├── databases/
│   ├── rumahl_home.sql
│   ├── rumahl_core.sql
│   ├── rumahl_security.sql
│   └── rumahl_secrets.sql
├── volumes/
│   ├── postgres_data.tar
│   ├── security_data.tar
│   └── gateway_data.tar
├── config/
│   ├── manifest.json
│   ├── rumahl-version
│   ├── docker-compose.yml
│   └── .env
├── userdata/
│   └── (contents of /var/lib/ora/)
└── apps/
    └── (contents of /var/lib/ora/apps/)
```

## Security Considerations

### Access Control
- The backup service requires access to the Docker socket (`/var/run/docker.sock`)
- On rumahl OS, this is protected by AppArmor profiles
- On Docker Compose, ensure proper host firewall rules

### Credentials Storage
- Remote storage credentials are stored encrypted in the database
- Use environment variables for sensitive PostgreSQL credentials
- Consider using secrets management for production deployments

### Network Security
- The backup service listens on port 8100 (not exposed externally by default)
- Remote storage uploads use HTTPS/TLS where available
- FTP connections can be secured with FTPS

## Troubleshooting

### Backup Creation Fails

```bash
# Check backup service logs
docker logs rumahl-backup

# Check available disk space
df -h /var/lib/ora/backups

# Verify PostgreSQL connectivity
docker exec rumahl-backup pg_dump --version
```

### Remote Upload Fails

```bash
# Test WebDAV connectivity
curl -u username:password \
  -X PROPFIND \
  https://cloud.example.com/remote.php/dav/files/username/

# Test S3 connectivity
aws s3 ls s3://bucket-name --endpoint-url=https://s3.example.com

# Check backup service logs for detailed error
docker logs rumahl-backup | grep -i error
```

### Restore Issues

```bash
# Verify backup integrity
tar -tzf /var/lib/ora/backups/backup_*.tar.gz | head

# Check available disk space
df -h /var/lib/ora

# Stop services before restore to avoid conflicts
docker compose stop
```

## Performance Considerations

### Backup Duration
- Small system (~5GB): 2-5 minutes
- Medium system (~20GB): 10-20 minutes
- Large system (~100GB): 1-2 hours

### Storage Requirements
- Compressed backups are typically 30-50% of original size
- Plan for 3-7 days of retention = 3-7x backup size
- Remote storage should match or exceed local capacity

### Network Bandwidth
- Remote uploads depend on connection speed
- Use `schedule_cron` during low-traffic periods
- Consider local retention + periodic remote sync

## Integration with rumahl Services

### rumahl-updater Integration
The backup service automatically integrates with rumahl-updater:
1. Update check finds new version
2. rumahl-updater calls `/api/backup/pre-update`
3. Backup completes (or times out after 10 minutes)
4. RAUC update proceeds
5. System reboots to new version
6. Old backups cleaned up based on retention policy

### rumahl-supervisor Integration (rumahl OS)
On rumahl OS, the supervisor can trigger backups:
- Before major configuration changes
- Before app installations
- On user request via Control Panel

### rumahl-home Integration
Future versions will include:
- Backup/restore UI in dashboard
- Backup status widgets
- One-click restore functionality
- Remote storage configuration wizard

## Development

### Building

```bash
cd backend/rumahl-backup
cargo build --release
```

### Testing

```bash
# Unit tests
cargo test

# Integration test with local PostgreSQL
DATABASE_URL=postgres://user:pass@localhost/test cargo test

# Manual API testing
curl http://localhost:8100/health
```

### Database Migrations

Migrations are in `migrations/` and run automatically on startup.

To create a new migration:
```bash
cd backend/rumahl-backup
sqlx migrate add migration_name
```

## License

Part of the rumahl OS project. See main repository LICENSE file.

## Support

- Documentation: https://docs.ora.io/backup
- Issues: https://github.com/your-org/ora/issues
- Community: https://community.ora.io
