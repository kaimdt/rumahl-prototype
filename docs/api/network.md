# Network Monitor API

The Network Monitor API is served by `rumahl-gateway` on port 8096. It provides sandboxed external integrations including email sending, web search, HTTP requests, and network monitoring.

## Base URL

```
http://localhost:8096
```

## Health Check

```http
GET /health
```

## Email

```http
POST /api/gateway/email
Content-Type: application/json

{
  "to": "recipient@example.com",
  "subject": "rumahl Alert",
  "body": "<h1>Notification</h1><p>Front door opened at 12:00</p>",
  "html": true
}
```

Response:
```json
{
  "success": true,
  "message_id": "msg-uuid",
  "timestamp": "2026-06-01T12:00:00Z"
}
```

Email features:
- HTML sanitization (via ammonia)
- Content validation (JavaScript, SQL injection detection)
- SMTP integration via lettre
- All emails logged with request ID

## Web Search

```http
POST /api/gateway/search
Content-Type: application/json

{
  "query": "weather forecast Berlin",
  "max_results": 10
}
```

Response:
```json
{
  "results": [
    {
      "title": "Berlin Weather - 7 Day Forecast",
      "url": "https://weather.example.com/berlin",
      "snippet": "Current temperature: 22°C, partly cloudy..."
    }
  ],
  "total_results": 150,
  "query_time_ms": 250
}
```

## HTTP Requests

```http
POST /api/gateway/http/get
Content-Type: application/json

{
  "url": "https://api.example.com/data",
  "headers": {
    "Accept": "application/json"
  },
  "timeout_seconds": 30
}
```

Response:
```json
{
  "success": true,
  "status_code": 200,
  "headers": { "content-type": "application/json" },
  "body": "<sanitized-response>",
  "validated": true,
  "threat_level": 0
}
```

Security features:
- URL validation and whitelist checking
- Response content sanitization
- JavaScript, SQL injection, shell command detection
- Path traversal prevention
- Threat scoring (0-10)

## Update Verification

```http
POST /api/gateway/verify-update
Content-Type: application/json

{
  "url": "https://releases.example.com/rumahl-v2.3.0.tar.gz",
  "expected_checksum": "sha256:abc123...",
  "checksum_type": "sha256"
}
```

Response:
```json
{
  "verified": true,
  "downloaded_checksum": "sha256:abc123...",
  "expected_checksum": "sha256:abc123...",
  "file_size_bytes": 52428800,
  "download_time_ms": 3500
}
```

Prevents supply chain attacks by verifying package integrity.

## Request Logging

```http
# Get all gateway requests
GET /api/gateway/requests?limit=100

# Get requests by type
GET /api/gateway/requests?type=email

# Get requests by service
GET /api/gateway/requests?service=rumahl-assist
```

## AI Request Monitoring

```http
# Get AI-initiated requests
GET /api/gateway/ai-requests?limit=100
```

Response:
```json
{
  "requests": [
    {
      "id": "req-uuid",
      "timestamp": "2026-06-01T12:00:00Z",
      "service": "rumahl-assist",
      "type": "http_get",
      "url": "https://api.example.com/data",
      "threat_level": 0,
      "validated": true
    }
  ]
}
```

## Content Validation

The gateway validates all external content for security threats:

### Detection Rules

| Category | Patterns Detected |
|----------|-------------------|
| **JavaScript** | `<script>` tags, `javascript:` URLs, event handlers, `eval()`, `setTimeout()` |
| **SQL Injection** | UNION/SELECT patterns, comment markers, equality checks |
| **Shell Commands** | Command separators (`;`, `&`, `|`), command substitution (`$()`, backticks) |
| **Path Traversal** | `../` and `..\\` patterns |

### Threat Scoring

| Score | Level | Action |
|-------|-------|--------|
| 0 | Safe | Pass through |
| 1-3 | Low | Log, pass through |
| 4-6 | Medium | Log, sanitize, pass |
| 7-9 | High | Block, alert |
| 10 | Critical | Block, alert, lockdown |

## Rate Limiting

All endpoints are rate-limited:

```http
# Check current rate limit status
GET /api/gateway/rate-limit-status
```

Default limits:
- Email: 100/hour, 1000/day
- Search: 60/hour, 500/day
- HTTP GET: 300/hour, 5000/day

Rate limit headers in responses:
```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1717246800
```

## URL Whitelist

```http
# List whitelisted URLs/domains
GET /api/gateway/whitelist

# Add to whitelist
POST /api/gateway/whitelist
Content-Type: application/json

{
  "domain": "api.trusted-service.com",
  "description": "Trusted API service"
}

# Remove from whitelist
DELETE /api/gateway/whitelist/{entry_id}
```

## Sandbox Status

```http
GET /api/gateway/sandbox/status
```

Response:
```json
{
  "sandboxing_enabled": true,
  "active_executions": 0,
  "total_executions": 150,
  "timeouts_today": 2,
  "blocked_requests_today": 5
}
```
