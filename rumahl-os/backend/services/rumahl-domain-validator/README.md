# rumahl Domain Validator

The Domain Validator service enforces network access policies for rumahl apps. It validates domain and IP access requests against app-specific whitelists, supporting wildcards, CIDR notation, and user-configurable additions.

## Features

- **Domain Whitelisting** - Apps declare allowed domains in their manifests
- **Wildcard Support** - Match patterns like `*.cdn.example.com` or `api.*.example.com`
- **IP/CIDR Validation** - Support for individual IPs and subnet ranges (e.g., `192.168.1.0/24`)
- **DNS Resolution** - Automatic hostname resolution for domain validation
- **User Extensions** - Apps can allow users to add additional domains/IPs
- **Access Logging** - All validation attempts logged for security auditing
- **Real-time Updates** - Policy changes apply immediately

## Port

- **Service Port**: 8100
- **NGINX Route**: `/api/domain-validator/`

## Database Schema

### app_network_policies

Stores network access policies for each app.

```sql
CREATE TABLE app_network_policies (
    id UUID PRIMARY KEY,
    app_id VARCHAR(255) UNIQUE NOT NULL,
    allowed_domains TEXT[] NOT NULL DEFAULT '{}',
    allow_user_domains BOOLEAN NOT NULL DEFAULT false,
    allowed_local_ips TEXT[] NOT NULL DEFAULT '{}',
    allow_user_local_ips BOOLEAN NOT NULL DEFAULT false,
    allow_network_scan BOOLEAN NOT NULL DEFAULT false,
    user_added_domains TEXT[] NOT NULL DEFAULT '{}',
    user_added_ips TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL
);
```

### domain_access_logs

Logs all domain/IP access validation attempts.

```sql
CREATE TABLE domain_access_logs (
    id UUID PRIMARY KEY,
    app_id VARCHAR(255) NOT NULL,
    domain VARCHAR(255) NOT NULL,
    ip_address VARCHAR(45),
    allowed BOOLEAN NOT NULL,
    reason TEXT NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL
);
```

## API Endpoints

### POST /api/domain-validator/validate

Validate domain or IP access for an app.

**Request**:
```json
{
  "app_id": "weather-app",
  "domain": "api.weather.com",
  "ip": "52.123.45.67"
}
```

**Response**:
```json
{
  "allowed": true,
  "reason": "Domain 'api.weather.com' is in allowed list",
  "matched_pattern": "*.weather.com"
}
```

### GET /api/domain-validator/policy/:app_id

Get network policy for an app.

**Response**:
```json
{
  "app_id": "weather-app",
  "allowed_domains": ["*.weather.com", "cdn.example.com"],
  "allow_user_domains": true,
  "allowed_local_ips": ["192.168.1.0/24"],
  "allow_user_local_ips": false,
  "allow_network_scan": false,
  "user_added_domains": ["custom.api.com"],
  "user_added_ips": ["10.0.0.50"],
  "created_at": "2026-04-20T12:00:00Z",
  "updated_at": "2026-04-20T12:30:00Z"
}
```

### POST /api/domain-validator/policy/:app_id/domains

Add user-defined domain to app policy (requires `allow_user_domains: true`).

**Request**:
```json
{
  "domain": "custom-api.example.com"
}
```

**Response**:
```json
{
  "success": true,
  "message": "Domain added successfully"
}
```

### POST /api/domain-validator/policy/:app_id/ips

Add user-defined IP/CIDR to app policy (requires `allow_user_local_ips: true`).

**Request**:
```json
{
  "ip": "192.168.2.100"
}
```

**Response**:
```json
{
  "success": true,
  "message": "IP address added successfully"
}
```

### GET /api/domain-validator/logs/:app_id

Get access logs for an app.

**Query Parameters**:
- `limit` (optional): Number of logs to return (default: 100, max: 1000)
- `allowed` (optional): Filter by allowed status (true/false)

**Response**:
```json
{
  "app_id": "weather-app",
  "logs": [
    {
      "id": "uuid",
      "domain": "api.weather.com",
      "ip_address": "52.123.45.67",
      "allowed": true,
      "reason": "Domain is in allowed list",
      "timestamp": "2026-04-20T12:00:00Z"
    }
  ],
  "total": 150
}
```

## Domain/IP Matching

### Wildcard Patterns

- `*.example.com` - Matches `api.example.com`, `cdn.example.com`, but not `example.com`
- `example.*` - Matches `example.com`, `example.net`, etc.
- `api.*.example.com` - Matches `api.v1.example.com`, `api.v2.example.com`

### CIDR Notation

- `192.168.1.0/24` - Matches all IPs from 192.168.1.0 to 192.168.1.255
- `10.0.0.0/8` - Matches all IPs from 10.0.0.0 to 10.255.255.255
- `172.16.0.0/12` - Matches all IPs from 172.16.0.0 to 172.31.255.255

### DNS Resolution

When validating a domain, the service:
1. Checks if the domain matches any allowed pattern
2. Resolves the domain to IP addresses via DNS
3. Validates resolved IPs against allowed IP ranges
4. Returns allowed if either domain or IP matches

## App Manifest Configuration

Apps declare their network policies in `manifest.json`:

```json
{
  "id": "weather-app",
  "network_access": {
    "allowed_domains": [
      "*.weather.com",
      "api.openweathermap.org"
    ],
    "allow_user_domains": true,
    "allowed_local_ips": [
      "192.168.1.0/24"
    ],
    "allow_user_local_ips": false,
    "allow_network_scan": false
  }
}
```

## Integration Example

Apps should call the validation endpoint before making external requests:

```javascript
// Before making HTTP request
const response = await fetch('/api/domain-validator/validate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    app_id: 'my-app',
    domain: 'api.example.com',
    ip: '52.123.45.67'
  })
});

const result = await response.json();
if (result.allowed) {
  // Proceed with request
} else {
  console.error('Access denied:', result.reason);
}
```

## Security Considerations

1. **Default Deny** - All requests denied unless explicitly allowed
2. **Immutable Base Policy** - App-defined domains/IPs cannot be removed by users
3. **Optional User Extensions** - Apps must opt-in to user-defined additions
4. **Audit Logging** - All validation attempts logged with timestamps
5. **DNS Cache** - DNS resolutions cached for 5 minutes to prevent abuse
6. **Pattern Validation** - User-added domains validated for proper format

## Performance

- **In-memory Policy Cache** - Policies loaded into memory at startup
- **DNS Caching** - Reduces DNS lookups for frequently accessed domains
- **Async Validation** - Non-blocking domain/IP checks
- **Database Indexing** - Indexed queries for fast log retrieval

## Troubleshooting

### Domain Always Denied

Check if:
1. Domain pattern includes wildcard correctly (`*.example.com`)
2. App policy loaded (check `/api/domain-validator/policy/:app_id`)
3. DNS resolution working for the domain

### User Cannot Add Domain

Verify:
1. `allow_user_domains` is `true` in app policy
2. Domain format is valid (no spaces, proper TLD)
3. App has not exceeded user domain limits

### High Log Volume

Consider:
1. Implementing log rotation policy
2. Filtering logs by `allowed: false` for security analysis
3. Aggregating logs by time period

## Environment Variables

- `DATABASE_URL` - PostgreSQL connection string
- `RUST_LOG` - Logging level (default: `info`)
- `BIND_ADDRESS` - Service bind address (default: `127.0.0.1:8100`)

## Related Services

- **rumahl-network-monitor** - Discovers devices on local network
- **rumahl-security** - Monitors for security threats
- **rumahl-appstore** - Loads app network policies from manifests
- **rumahl-nginx** - Routes validation requests to this service

## Further Reading

- [Network Access Control Documentation](../../docs/NETWORK_ACCESS_AND_DOCUMENTATION_SUMMARY.md)
- [App Manifest Schema](../rumahl-shared/src/app_manifest.rs)
- [Security Best Practices](../../docs/security/best-practices.md)
