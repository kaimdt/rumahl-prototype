# Security API

The Security API is served by `rumahl-security` on port 8095. It provides security monitoring, threat detection, intrusion prevention, and system lockdown management.

## Base URL

```
http://localhost:8095
```

## Health Check

```http
GET /health
```

## System Lockdown Status

```http
GET /api/security/status
```

Response:
```json
{
  "lockdown_level": 0,
  "lockdown_level_name": "Normal",
  "threat_level": 2,
  "active_threats": 0,
  "blocked_ips": 3,
  "events_today": 145,
  "auto_lockdown_enabled": true
}
```

Lockdown levels:
| Level | Name | Description |
|-------|------|-------------|
| 0 | Normal | No threats detected |
| 1 | Warning | Enhanced monitoring active |
| 2 | Suspicious | Elevated logging, IP tracking |
| 3 | Confirmed | Partial service lockdown |
| 4 | Critical | Full system isolation |

## Database Connections

```http
# Active PostgreSQL connections
GET /api/security/connections
```

Response:
```json
{
  "connections": [
    {
      "pid": 12345,
      "username": "rumahl_home",
      "database": "rumahl_home",
      "client_addr": "172.18.0.3",
      "application_name": "rumahl-home",
      "state": "active",
      "query_start": "2026-06-01T12:00:00Z"
    }
  ],
  "total": 8,
  "unauthorized": 0
}
```

## Security Events

```http
# Get security event log
GET /api/security/events?limit=100&offset=0

# Filter by type
GET /api/security/events?type=intrusion

# Filter by severity
GET /api/security/events?severity=critical
```

Event types:
- `connection` – Database connection events
- `auth` – Authentication attempts
- `intrusion` – Detected attack attempts
- `anomaly` – Unusual behavior patterns
- `lockdown` – System lockdown events
- `user_rotation` – Credential rotation events
- `unauthorized_connection` – Unknown DB connections

```json
{
  "events": [
    {
      "id": "evt-uuid",
      "timestamp": "2026-06-01T12:00:00Z",
      "type": "connection",
      "severity": "info",
      "source_ip": "172.18.0.3",
      "message": "New database connection from rumahl-home",
      "hash": "sha256-chain-hash"
    }
  ],
  "integrity_verified": true
}
```

## Threat Intelligence

```http
# Get threat feed
GET /api/security/threats

# Get threat details for IP
GET /api/security/threats/{ip_address}
```

Response:
```json
{
  "threats": [
    {
      "ip": "192.168.1.100",
      "threat_level": 7,
      "blocked": true,
      "detections": [
        { "type": "unauthorized_connection", "count": 3 },
        { "type": "failed_auth", "count": 12 }
      ],
      "first_seen": "2026-05-30T08:00:00Z",
      "last_seen": "2026-06-01T12:00:00Z"
    }
  ]
}
```

## Security Alerts

```http
# Get pending alerts
GET /api/security/alerts

# Acknowledge alert
POST /api/security/alerts/{alert_id}/acknowledge

# Dismiss alert
POST /api/security/alerts/{alert_id}/dismiss
```

Alert response:
```json
{
  "alerts": [
    {
      "id": "alert-uuid",
      "timestamp": "2026-06-01T11:30:00Z",
      "level": "critical",
      "title": "Unauthorized Database Access Attempt",
      "message": "IP 10.0.0.50 attempted to connect to PostgreSQL without authorization",
      "acknowledged": false,
      "auto_actions": ["ip_blocked", "event_logged"]
    }
  ]
}
```

## IP Management

```http
# List whitelisted IPs
GET /api/security/whitelist

# Add IP to whitelist
POST /api/security/whitelist
Content-Type: application/json

{
  "ip": "192.168.1.0/24",
  "description": "Home network",
  "permanent": false,
  "expires_in_hours": 720
}

# Remove from whitelist
DELETE /api/security/whitelist/{entry_id}

# Block an IP
POST /api/security/block/{ip}
Content-Type: application/json

{
  "reason": "Multiple failed authentication attempts",
  "duration_hours": 24
}

# Unblock an IP
POST /api/security/unblock/{ip}
```

## Lockdown Management

```http
# Trigger manual lockdown
POST /api/security/lockdown
Content-Type: application/json

{
  "level": 3,
  "reason": "Suspicious activity detected manually"
}

# Release lockdown
POST /api/security/release
Content-Type: application/json

{
  "reason": "Threat resolved, returning to normal operation"
}
```

When lockdown triggers:
- All external API access is blocked
- Only admin console remains accessible
- PostgreSQL connections frozen (except admin)
- Forensic snapshot created
- Critical alerts sent to all administrators

## PostgreSQL User Management

```http
# Create PostgreSQL user
POST /api/security/users
Content-Type: application/json

{
  "service": "rumahl-home",
  "database": "rumahl_home",
  "permissions": ["read", "write"]
}

# Rotate credentials
POST /api/security/users/{user_id}/rotate

# Delete user
DELETE /api/security/users/{user_id}
```

User creation response:
```json
{
  "username": "rumahl_home_a1b2c3d4",
  "password": "64-char-hex-password",
  "database": "rumahl_home",
  "permissions": ["read", "write"],
  "expires_at": "2026-06-30T12:00:00Z"
}
```

## Audit Log

```http
# Get audit trail
GET /api/security/audit?limit=200

# Get audit for specific resource
GET /api/security/audit?resource=postgres_users

# Get audit for time range
GET /api/security/audit?from=2026-06-01T00:00:00Z&to=2026-06-01T23:59:59Z
```

All audit entries are:
- Encrypted with AES-256-GCM
- Hash-chained (blockchain-style integrity)
- Append-only (cannot be modified or deleted)
- Stored in isolated SQLite database

## Configuration

```http
# Get security configuration
GET /api/security/config

# Update security configuration
PUT /api/security/config
Content-Type: application/json

{
  "auto_lockdown_enabled": true,
  "lockdown_threshold_critical": 5,
  "threat_level_threshold": 7,
  "credential_rotation_days": 30,
  "connection_monitoring_interval_seconds": 5
}
```
