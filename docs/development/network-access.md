# Network Access Control

Control which domains and IP addresses your app can access. This is enforced at the rumahl gateway and proxy level.

## Configuration

Declare network access in your manifest:

```json
{
  "network_access": {
    "allowed_domains": ["api.example.com", "*.cdn.example.com"],
    "allow_user_domains": true,
    "blocked_domains": [],
    "allowed_local_ips": ["192.168.1.100", "10.0.0.0/24"],
    "allow_user_local_ips": true,
    "allow_network_scan": false
  }
}
```

## Domain Configuration

### Exact Match

```json
{
  "allowed_domains": ["api.weather.com"]
}
```
Matches: `api.weather.com` only.
Does NOT match: `www.weather.com`, `cdn.weather.com`.

### Wildcard Subdomains

```json
{
  "allowed_domains": ["*.example.com"]
}
```
Matches: `api.example.com`, `cdn.example.com`, `a.b.example.com`.
Does NOT match: `example.com`.

### Multiple Patterns

```json
{
  "allowed_domains": [
    "api.weather.com",
    "*.openweathermap.org",
    "maps.googleapis.com"
  ]
}
```

## IP Configuration

### Single IP

```json
{
  "allowed_local_ips": ["192.168.1.100"]
}
```

### CIDR Subnet

```json
{
  "allowed_local_ips": [
    "10.0.0.0/24",      // 10.0.0.0 – 10.0.0.255
    "192.168.0.0/16",   // 192.168.0.0 – 192.168.255.255
    "172.16.0.0/12"     // 172.16.0.0 – 172.31.255.255
  ]
}
```

## User-Configurable Access

### Allow User Domains

When `allow_user_domains: true`, users can add their own domains in the app settings:

```json
{
  "network_access": {
    "allowed_domains": ["api.example.com"],
    "allow_user_domains": true
  }
}
```

Users see an input field in the app settings to add domains:
```
User-Added Domains:
  + api.alternative-service.com
  + cdn.my-org.com
```

### Allow User IPs

When `allow_user_local_ips: true`, users can add local IPs:

```json
{
  "network_access": {
    "allowed_local_ips": ["192.168.1.1"],
    "allow_user_local_ips": true
  }
}
```

## Network Scanning

`allow_network_scan` enables the app to scan the local network:

```json
{
  "network_access": {
    "allow_network_scan": true
  }
}
```

⚠️ **High-risk permission.** Only enable if your app genuinely needs to discover devices on the network.

## Domain Validation

The Domain Validator service enforces these policies:

```
App makes outbound request
  │
  ▼
Domain Validator checks:
  1. Is the domain in allowed_domains?
  2. Is the domain in user-added domains?
  3. Is the domain in blocked_domains?
  │
  ├─ Allowed → Request proceeds
  └─ Blocked → Request denied (403 Forbidden)
```

### Blocking Domains

Explicitly block domains even if they match a wildcard:

```json
{
  "network_access": {
    "allowed_domains": ["*.example.com"],
    "blocked_domains": ["ads.example.com", "tracking.example.com"]
  }
}
```

## Localhost Access

By default, apps cannot access localhost. To allow localhost access, add it explicitly:

```json
{
  "network_access": {
    "allowed_local_ips": ["127.0.0.1", "::1"]
  }
}
```

Use with caution – this allows the app to access rumahl services directly.

## Container Networking

### Default (Bridge)

Apps on the default bridge network can only reach the internet through the gateway.

### Bundle Networks

Bundle services get their own isolated network:

```json
{
  "bundle": {
    "network": {
      "driver": "bridge",
      "subnet": "172.28.0.0/24",
      "internal": false
    }
  }
}
```

Internal communication between bundle services does not require network permissions.

## Best Practices

1. **Be specific** – Use exact domains instead of wildcards when possible
2. **Use HTTPS** – Always use `https://` for external APIs
3. **Limit local IP access** – Only whitelist IPs your app actually needs
4. **Don't allow network scanning** – Unless absolutely necessary
5. **Block known trackers** – Use `blocked_domains` for analytics/tracking domains
6. **Test with restricted access** – Verify your app handles blocked requests gracefully

## Error Handling

Your app should handle network access denial:

```javascript
try {
  const response = await fetch('https://api.example.com/data');
  return await response.json();
} catch (error) {
  if (error.status === 403) {
    console.error('Network access denied. Check domain whitelist.');
    // Show user-friendly message
    return { error: 'Cannot access external service. Check app permissions.' };
  }
  throw error;
}
```

## Related Documentation

- [App Development Guide](app-development.md) – Full app creation guide
- [Security: Network Security](../security/network.md) – Network security architecture
- [Port Management Guide](../guides/port-management.md) – Port configuration
- [Docker Configuration Guide](../guides/docker-config.md) – Container networking
