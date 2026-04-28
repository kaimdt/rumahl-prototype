# IORA Port Management and System Enhancements

This document describes the enhanced port management system, NGINX reverse proxy, and SSH management features added to IORA.

## Overview

Three major enhancements have been implemented:

1. **Enhanced Port Manager** - Improved port allocation with higher ranges, well-known port reservations, and dual-mode assignment
2. **IORA NGINX Service** - Reverse proxy for all web traffic with dynamic configuration
3. **SSH Management** - Control Center integration for SSH service and user management

---

## 1. Enhanced Port Manager

### Port Ranges

| Purpose | Range | Description |
|---------|-------|-------------|
| User Apps/Plugins | 10000-20000 | 10,000 available ports for dynamic allocation |
| IORA Services | 8080-8099 | Reserved for IORA system services |
| Well-Known Ports | Various | Auto-reserved standard service ports |

### Well-Known Ports (Auto-Reserved)

The following standard ports are automatically reserved to prevent conflicts:

- **FTP**: 20, 21
- **SSH**: 22
- **Telnet**: 23
- **SMTP**: 25, 587
- **DNS**: 53
- **DHCP**: 67, 68
- **HTTP/HTTPS**: 80, 443, 8080, 8443
- **Email**: 110 (POP3), 143 (IMAP), 465 (SMTPS), 993 (IMAPS), 995 (POP3S)
- **SNMP**: 161, 162
- **LDAP/LDAPS**: 389, 636
- **SMB**: 445
- **Syslog**: 514
- **Databases**: 1433 (MSSQL), 1521 (Oracle), 3306 (MySQL), 5432 (PostgreSQL), 27017 (MongoDB), 6379 (Redis)
- **Message Queues**: 5672 (AMQP)
- **Development**: 9000 (SonarQube)

### Port Assignment Modes

Apps can choose between two port assignment modes in their manifest:

#### Random Mode (Default)
- New port assigned on each restart
- More secure (prevents port squatting)
- Suitable for most apps
- Example: App gets port 10523 on start, 11842 on next restart

#### Fixed Mode (Opt-in)
- Persistent port assignment across restarts
- Must be explicitly specified in manifest
- Useful for apps that need stable ports (e.g., external integrations)
- Example: App always gets port 10523

### Manifest Configuration

```json
{
  "id": "my-app",
  "name": "My Application",
  "version": "1.0.0",
  "docker": {
    "internal_ports": [
      {
        "port": 3000,
        "protocol": "tcp",
        "assignment_mode": "random",
        "description": "Web server"
      },
      {
        "port": 8080,
        "protocol": "tcp",
        "assignment_mode": "fixed",
        "description": "API server (needs stable port)"
      }
    ]
  }
}
```

### API Examples

#### Allocate a Port

```rust
use iora_shared::port_manager::{PortManager, PortProtocol, PortAssignmentMode};

let manager = PortManager::new();

// Random port (default)
let assignment = manager.allocate_port(
    "my-app",
    3000,
    PortProtocol::Tcp,
    PortAssignmentMode::Random
).await?;

// Fixed port
let assignment = manager.allocate_port(
    "my-app",
    8080,
    PortProtocol::Tcp,
    PortAssignmentMode::Fixed
).await?;
```

#### Release Ports

```rust
manager.release_ports("my-app").await?;
```

#### Get Port Statistics

```rust
let stats = manager.get_stats().await;
println!("Total available: {}", stats.total_available);
println!("Allocated: {}", stats.allocated);
println!("Free: {}", stats.free);
println!("Reserved: {}", stats.reserved);
```

---

## 2. IORA NGINX Service

The NGINX service acts as a reverse proxy for all HTTP/HTTPS traffic in IORA.

### Features

- **Static Routes** - All IORA services accessible through consistent paths
- **Dynamic App Routes** - Auto-generated routes for installed apps
- **Security Headers** - X-Frame-Options, CSP, XSS Protection, etc.
- **Rate Limiting** - API (10 req/s), General (50 req/s)
- **Gzip Compression** - Automatic compression for text-based content
- **WebSocket Support** - For real-time apps
- **Auto-reload** - Configuration updates every 30 seconds
- **Health Checks** - `/nginx-health` endpoint

### Static Service Routes

| Path | Service | Port |
|------|---------|------|
| `/` | iora-home | 8080 |
| `/api/core/` | iora-core | 8090 |
| `/api/control/` | iora-control | 8091 |
| `/api/assist/` | iora-assist | 8092 |
| `/api/secrets/` | iora-secrets | 8093 |
| `/api/watchdog/` | iora-watchdog | 8094 |
| `/api/security/` | iora-security | 8095 |
| `/api/gateway/` | iora-gateway | 8096 |
| `/api/supervisor/` | iora-supervisor | 8097 |
| `/api/appstore/` | iora-appstore | 8098 |

### Dynamic App Routes

Installed apps are automatically accessible at:

```
/apps/{app-id}/
```

Example: If you install an app with ID `weather-dashboard`, it will be accessible at:

```
http://your-iora-instance/apps/weather-dashboard/
```

The NGINX service automatically:
1. Queries the database for enabled apps
2. Fetches their port assignments
3. Generates NGINX upstream configuration
4. Creates location blocks for each app
5. Reloads NGINX if configuration changed

### Configuration Management

The service runs a background loop that:
- Checks for app changes every 30 seconds
- Generates new NGINX configuration if needed
- Tests the configuration before applying
- Reverts to backup if test fails
- Reloads NGINX with zero downtime

### Manual Management

```bash
# View current NGINX configuration
cat /etc/nginx/nginx.conf

# Test configuration manually
nginx -t

# Reload NGINX manually
nginx -s reload

# Check NGINX status
systemctl status nginx
```

---

## 3. SSH Management

The Control Center now includes API endpoints for managing SSH access to the IORA OS.

### API Endpoints

#### Get SSH Status

```bash
GET /api/control/ssh/status
```

Response:
```json
{
  "enabled": true,
  "running": true,
  "port": 22,
  "timestamp": "2026-04-20T12:00:00Z"
}
```

#### Enable/Disable SSH

```bash
POST /api/control/ssh/enable
Content-Type: application/json

{
  "enabled": true
}
```

Response:
```json
{
  "success": true,
  "enabled": true,
  "message": "SSH service enabled successfully"
}
```

#### List SSH Users

```bash
GET /api/control/ssh/users
```

Response:
```json
{
  "users": [
    {
      "username": "admin",
      "uid": 1000,
      "home": "/home/admin",
      "shell": "/bin/bash",
      "has_ssh_key": true
    }
  ],
  "total": 1,
  "timestamp": "2026-04-20T12:00:00Z"
}
```

#### Create SSH User

```bash
POST /api/control/ssh/users
Content-Type: application/json

{
  "username": "newuser",
  "password": "secure-password",
  "ssh_public_key": "ssh-rsa AAAAB3NzaC1yc2E... user@host"
}
```

Response:
```json
{
  "success": true,
  "message": "User 'newuser' created successfully",
  "username": "newuser"
}
```

#### Delete SSH User

```bash
DELETE /api/control/ssh/users/:username
```

Response:
```json
{
  "success": true,
  "message": "User 'olduser' deleted successfully"
}
```

### User Management Features

- **Username Validation** - Only alphanumeric, hyphens, and underscores allowed
- **Password Authentication** - Optional password for user login
- **SSH Key Authentication** - Optional public key for passwordless login
- **Automatic Setup** - Creates `.ssh/authorized_keys` with correct permissions
- **Home Directory** - Automatically created in `/home/{username}`
- **Shell** - Default shell set to `/bin/bash`
- **Cleanup** - Deleting a user removes home directory

### Security Considerations

1. **Root Access** - The IORA Control service must run with appropriate privileges to manage users
2. **Key Permissions** - SSH keys automatically get 600 permissions, `.ssh` directory gets 700
3. **User Filtering** - Only shows real users (UID >= 1000, valid shell, /home directory)
4. **Service Management** - Uses systemctl for safe SSH service control

---

## Migration Guide

### For Existing Apps

If you have apps using the old port range (3000-4000):

1. **No immediate action required** - Existing port assignments will continue to work
2. **On next app restart** - New ports will be assigned from the 10000-20000 range
3. **Update manifests** - Add `assignment_mode` to your port configuration if you need fixed ports

### For New Apps

Use the new manifest format:

```json
{
  "docker": {
    "internal_ports": [
      {
        "port": 3000,
        "protocol": "tcp",
        "assignment_mode": "random",
        "description": "Description of this port"
      }
    ]
  }
}
```

### Database Schema Updates

The `port_assignments` table now includes:

```sql
assignment_mode VARCHAR(10) NOT NULL DEFAULT 'random'
  CHECK (assignment_mode IN ('random', 'fixed'))
```

Existing records will default to 'random' mode.

---

## Troubleshooting

### Port Allocation Issues

**Problem**: App fails to get port
**Solution**: Check available ports with:
```rust
let stats = port_manager.get_stats().await;
```

**Problem**: Port conflict detected
**Solution**: Well-known ports are now auto-reserved. Check if your app is requesting a reserved port.

### NGINX Issues

**Problem**: NGINX configuration test fails
**Solution**: Check logs in `/var/log/nginx/error.log` and restore backup:
```bash
cp /etc/nginx/nginx.conf.backup /etc/nginx/nginx.conf
nginx -t
```

**Problem**: App not accessible through NGINX
**Solution**:
1. Check app is enabled in database
2. Verify port assignment exists
3. Wait 30 seconds for auto-reload or manually reload NGINX
4. Check NGINX error logs

### SSH Management Issues

**Problem**: SSH enable/disable fails
**Solution**: Ensure iora-control service has proper permissions to run systemctl commands

**Problem**: User creation fails
**Solution**: Check that username follows validation rules (alphanumeric, hyphens, underscores only)

**Problem**: SSH key authentication not working
**Solution**: Verify file permissions:
```bash
ls -la /home/username/.ssh/
# Should show:
# drwx------ .ssh (700)
# -rw------- authorized_keys (600)
```

---

## Performance Considerations

### Port Manager

- In-memory tracking with RwLock for concurrency
- O(1) port availability checks
- O(n) for finding next available port (where n = used ports)
- ~10,000 ports available for apps

### NGINX

- Keepalive connections to upstreams (32 for IORA services, 8 for apps)
- Gzip compression reduces bandwidth
- Rate limiting prevents abuse
- Shared memory zones for efficient rate limit tracking

### SSH Management

- File-based operations (reading /etc/passwd)
- Subprocess calls to system commands (useradd, userdel, systemctl)
- Minimal performance impact as these are infrequent operations

---

## Future Enhancements

Potential future improvements:

1. **HTTPS Support** - Automatic SSL certificate management
2. **Port Reservation API** - Allow apps to request specific ports
3. **SSH Key Management UI** - Frontend for SSH key upload/management
4. **Advanced Rate Limiting** - Per-user, per-app rate limits
5. **Load Balancing** - Multi-instance app support
6. **Port Analytics** - Usage statistics and monitoring
7. **SSH Audit Logs** - Track all SSH access and user changes

---

## Related Documentation

- [App Store Guide](APP_STORE_GUIDE.md)
- [App Manifest Schema](../backend/iora-shared/src/app_manifest.rs)
- [Port Manager Source](../backend/iora-shared/src/port_manager.rs)
- [NGINX Service README](../backend/iora-nginx/README.md)
- [Control Center Source](../backend/iora-control/src/main.rs)

---

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review the source code documentation
3. Submit an issue on the IORA repository
