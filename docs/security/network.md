# Network Security

IORA implements multiple layers of network security to protect the system and its apps from unauthorized access and threats.

## Network Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        External Network                           │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │              NGINX Reverse Proxy (Port 80/443)                ││
│  │  · TLS termination    · Rate limiting    · Request filtering ││
│  └───────────────────────────────┬──────────────────────────────┘│
│                                   │                                │
│  ┌────────────────────────────────┴─────────────────────────────┐│
│  │                   IORA Internal Network                        ││
│  │                                                                 ││
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐ ││
│  │  │iora-home │  │iora-core │  │iora-     │  │App           │ ││
│  │  │  :8126   │  │  :8090   │  │gateway   │  │Containers    │ ││
│  │  │          │  │          │  │  :8096   │  │              │ ││
│  │  └──────────┘  └──────────┘  └────┬─────┘  └──────┬───────┘ ││
│  │                                    │               │          ││
│  │                           ┌────────┴───────────────┴──────┐  ││
│  │                           │  Domain Validator Service      │  ││
│  │                           │  · Domain whitelist            │  ││
│  │                           │  · IP access control           │  ││
│  │                           │  · Network policy enforcement  │  ││
│  │                           └────────────────────────────────┘  ││
│  └───────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
```

## App Network Access Control

### Domain Whitelisting

Apps declare their network access requirements in the manifest:

```json
{
  "network_access": {
    "allowed_domains": [
      "api.example.com",
      "*.cdn.example.com"
    ],
    "allow_user_domains": true,
    "blocked_domains": []
  }
}
```

**Domain patterns:**
- `api.example.com` – Exact match
- `*.cdn.example.com` – Wildcard subdomains
- `example.com` – Exact domain only (not subdomains)

### IP Access Control

```json
{
  "network_access": {
    "allowed_local_ips": [
      "192.168.1.100",
      "10.0.0.0/24",
      "172.16.0.0/16"
    ],
    "allow_user_local_ips": true,
    "allow_network_scan": false
  }
}
```

**IP formats:**
- `192.168.1.100` – Single IP
- `10.0.0.0/24` – CIDR subnet (10.0.0.0 – 10.0.0.255)
- `172.16.0.0/16` – CIDR subnet (172.16.0.0 – 172.16.255.255)

### User-Configurable Access

When `allow_user_domains` or `allow_user_local_ips` is `true`, users can add their own domains/IPs in the app settings UI.

## Domain Validator Service

The Domain Validator enforces network access policies:

### Features
- Domain whitelist enforcement per app
- IP range access control
- DNS resolution validation
- Caching of validation results
- Automatic blocking of known malicious domains

### API

```http
# Validate domain access for an app
POST /api/security/validate-domain
Content-Type: application/json

{
  "app_id": "my-app",
  "domain": "api.example.com"
}

# Response
{
  "allowed": true,
  "reason": "Domain is in whitelist"
}
```

## Network Isolation

### Docker Network Isolation

Apps run in isolated Docker networks:
- Each app/bundle gets its own bridge network
- Inter-app communication only through the messaging system
- No direct container-to-container access without explicit configuration

### Plugin Network Isolation

Plugins run with network access **disabled by default**:
```json
{
  "sandbox": {
    "allow_network": false   // Default: no network access
  }
}
```

When enabled, plugins can only access the domains/IPs explicitly whitelisted.

## Reverse Proxy Security

The NGINX reverse proxy provides:

- **TLS/SSL termination** with modern cipher suites
- **Rate limiting** per IP and per endpoint
- **Request size limits** to prevent DoS
- **Header sanitization** to prevent injection
- **CORS configuration** for browser security

Example NGINX configuration:
```nginx
server {
    listen 443 ssl;
    server_name iora.example.com;

    ssl_certificate /etc/ssl/iora.crt;
    ssl_certificate_key /etc/ssl/iora.key;
    ssl_protocols TLSv1.2 TLSv1.3;

    location / {
        proxy_pass http://iora-home:8126;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=30r/s;
    limit_req zone=api burst=50 nodelay;
}
```

## Port Management

IORA manages 10,000+ ports with intelligent assignment:

| Port Range | Purpose |
|------------|---------|
| 8080-8099 | System services |
| 10000-19999 | App containers (random assignment) |
| 50000-50999 | Reserved for special services |

### Port Assignment Modes

```json
{
  "internal_ports": [
    {
      "port": 3000,
      "assignment_mode": "random"    // New port on each restart
    },
    {
      "port": 8080,
      "assignment_mode": "fixed"     // Same port across restarts
    }
  ]
}
```

**Random** – More secure, prevents port scanning predictability
**Fixed** – Stable for external integrations that need a constant port

## Firewall Recommendations

For production deployments, configure your firewall:

```bash
# Allow only necessary ports
ufw allow 443/tcp    # HTTPS (NGINX)
ufw allow 22/tcp     # SSH (management)
ufw deny 8126/tcp    # Block direct iora-home access
ufw deny 8090/tcp    # Block direct iora-core access

# Enable firewall
ufw enable
```

## Security Best Practices

1. **Never expose IORA services directly** – Always use the NGINX reverse proxy
2. **Use TLS everywhere** – Encrypt all external traffic
3. **Enable rate limiting** – Prevent brute force and DoS attacks
4. **Restrict app network access** – Only whitelist domains the app actually needs
5. **Use random port assignment** – For apps that don't need stable ports
6. **Monitor network traffic** – Use `iora-security` alerts for unusual patterns
7. **Keep services updated** – Apply security patches promptly

## Related Documentation

- [Permission System](permissions.md) – Network-related permissions
- [Threat Detection](threat-detection.md) – Automatic threat response
- [Port Reference](../system/ports.md) – Complete port map
- [Network Monitor API](../api/network.md) – Gateway and validation APIs
