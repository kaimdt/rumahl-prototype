# Threat Detection & Response

IORA includes an integrated Intrusion Detection System (IDS) with automatic threat scoring, IP blocking, and system lockdown capabilities.

## Threat Detection Architecture

```
┌───────────────────────────────────────────────────────────────────┐
│                     Threat Detection Pipeline                       │
│                                                                     │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐ │
│  │ PostgreSQL    │    │ Auth         │    │ Network              │ │
│  │ Connections   │    │ Attempts     │    │ Traffic              │ │
│  └──────┬───────┘    └──────┬───────┘    └──────────┬───────────┘ │
│         │                   │                        │              │
│         └───────────────────┼────────────────────────┘              │
│                             ▼                                       │
│              ┌──────────────────────────────┐                      │
│              │     Threat Scoring Engine     │                      │
│              │  · Per-IP threat score       │                      │
│              │  · Pattern detection         │                      │
│              │  · Anomaly detection         │                      │
│              └──────────────┬───────────────┘                      │
│                             │                                       │
│              ┌──────────────┴───────────────┐                      │
│              ▼                              ▼                       │
│  ┌───────────────────────┐    ┌──────────────────────────┐        │
│  │  Automatic Response    │    │  Alert Generation         │        │
│  │  · IP blocking         │    │  · Security events       │        │
│  │  · Lockdown            │    │  · Admin notifications   │        │
│  │  · Rate limiting       │    │  · Audit log entries     │        │
│  └───────────────────────┘    └──────────────────────────┘        │
└───────────────────────────────────────────────────────────────────┘
```

## Threat Scoring

Each IP address accumulates a threat score from 0 to 10:

| Score | Level | Status | Action |
|-------|-------|--------|--------|
| 0 | Safe | Normal | None |
| 1-2 | Low | Monitoring | Enhanced logging |
| 3-4 | Elevated | Watching | Rate limiting increased |
| 5-6 | High | Suspicious | Additional checks required |
| 7-8 | Critical | Dangerous | **Automatic IP block** |
| 9-10 | Severe | Attack | **Immediate lockdown** |

### Detection Triggers

| Event | Threat Points | Description |
|-------|:---:|-------------|
| Unauthorized database connection | +3 | Connection from unknown IP to PostgreSQL |
| Failed authentication | +2 | Invalid username/password attempt |
| SQL injection pattern | +5 | Malicious SQL detected in queries |
| Rate limit exceeded | +1 | Too many requests in time window |
| Abnormal access pattern | +2 | Unusual query patterns or timing |
| Known malicious IP | +10 | IP on threat intelligence feed (immediate block) |
| Port scan detected | +4 | Sequential port access attempts |
| Suspicious user agent | +1 | Known attack tools in User-Agent |

### Threat Decay

Threat scores decay over time if no new threats are detected:
- Score 1-2: Decays to 0 after 1 hour
- Score 3-4: Decays to 0 after 6 hours
- Score 5-6: Decays to 3 after 24 hours
- Score 7+: Permanent until manually cleared

## Automatic IP Blocking

When an IP reaches threat level 7:

```json
{
  "action": "ip_blocked",
  "ip": "203.0.113.42",
  "threat_level": 7,
  "reason": "SQL injection pattern detected",
  "blocked_at": "2026-06-01T12:00:00Z",
  "blocked_until": "2026-06-01T18:00:00Z",
  "auto_unblock": true
}
```

Blocked IPs are:
- Added to iptables/nftables rules
- Denied at the NGINX reverse proxy
- Rejected at the API middleware level
- Logged to the encrypted audit trail

### Unblocking

```http
# Manual unblock
POST /api/security/unblock/203.0.113.42

# Auto-unblock after duration
# Default: 24 hours for first offense, permanent for repeat offenders
```

## System Lockdown

### Lockdown Levels

| Level | Name | Triggers | Effect |
|:-----:|------|----------|--------|
| 0 | Normal | No threats | All services operational |
| 1 | Warning | Score ≥ 3 for any IP | Enhanced monitoring, admin notification |
| 2 | Suspicious | Multiple IPs at score ≥ 5 | Elevated logging, IP tracking active |
| 3 | Confirmed | Score ≥ 8 for any IP | External API blocked, admin-only access |
| 4 | Critical | Multiple IPs at score ≥ 8 or known attack | Full system isolation, forensic snapshot |

### Level 4 Lockdown Effects

When Level 4 is triggered:
1. **All external API access blocked** – Only localhost/admin console accessible
2. **PostgreSQL connections frozen** – Except admin maintenance connections
3. **All app containers paused** – Prevent further compromise
4. **Forensic snapshot created** – Complete system state preserved for analysis
5. **Critical alerts dispatched** – To all configured admin channels
6. **All events logged** – To encrypted, hash-chained audit database

### Manual Lockdown

```http
POST /api/security/lockdown
Content-Type: application/json

{
  "level": 3,
  "reason": "Suspicious activity detected during maintenance window"
}
```

### Releasing Lockdown

```http
POST /api/security/release
Content-Type: application/json

{
  "reason": "Threat investigated and resolved. No compromise detected.",
  "admin_confirmation": true
}
```

Lockdown release requires admin confirmation and logs the releasing admin's identity.

## Intrusion Detection Rules

### Database Connection Monitoring

Every 5 seconds, `iora-security` queries `pg_stat_activity`:
- Tracks PID, IP, username, database, application name
- Compares against known authorized services
- Flags any connection from unknown IPs or users

### Authentication Monitoring

- Tracks failed login attempts per IP per time window
- Triggers alert after 5 failed attempts in 5 minutes
- Blocks IP after 10 failed attempts in 10 minutes

### SQL Injection Detection

The database proxy inspects all SQL queries for:
- UNION-based injection patterns
- Comment-based injection (`--`, `/* */`)
- Stacked queries (`; DROP TABLE`)
- Time-based blind SQL injection patterns

### Content Validation (Gateway)

The `iora-gateway` inspects all external content for:
- JavaScript code (`<script>`, `eval()`, event handlers)
- Shell command patterns (`;`, `|`, `$()`)
- Path traversal (`../`, `..\\`)
- Malicious URLs and redirects

## Security Events

### Event Types

| Type | Severity | Description |
|------|----------|-------------|
| `connection` | Info | Database connection established |
| `auth_failed` | Warning | Failed authentication attempt |
| `auth_success` | Info | Successful authentication |
| `intrusion` | Critical | Attack pattern detected |
| `anomaly` | Warning | Unusual behavior pattern |
| `lockdown` | Critical | System lockdown triggered |
| `lockdown_release` | High | Lockdown released |
| `ip_blocked` | High | IP automatically blocked |
| `user_rotation` | Info | Database credential rotated |
| `unauthorized_connection` | High | Unknown database connection |

### Event Retention

- All events: 90 days minimum
- Critical events: Permanent
- Lockdown events: Permanent
- Audit trail: Hash-chained, append-only, encrypted

## Alert Configuration

```http
PUT /api/security/config
Content-Type: application/json

{
  "auto_lockdown_enabled": true,
  "lockdown_threshold_critical": 5,
  "threat_level_threshold": 7,
  "alert_channels": ["dashboard", "email", "webhook"],
  "alert_webhook_url": "https://alerts.example.com/hook",
  "failed_auth_threshold": 5,
  "failed_auth_window_minutes": 5
}
```

## Best Practices

1. **Keep auto-lockdown enabled** – It's your last line of defense
2. **Configure alert channels** – Ensure you receive critical notifications
3. **Review audit logs regularly** – Look for patterns and anomalies
4. **Whitelist trusted IPs** – Reduce false positives
5. **Test lockdown procedures** – Know what happens at each level
6. **Keep threat intelligence updated** – Block known malicious IPs preemptively
7. **Monitor resource usage** – Attacks often cause abnormal resource patterns

## Related Documentation

- [Security Overview](README.md) – Security architecture
- [Network Security](network.md) – Network access control
- [Encryption](encryption.md) – Data protection standards
- [Security API](../api/security.md) – API reference for security endpoints
