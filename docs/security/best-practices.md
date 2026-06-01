# Security Best Practices

This guide provides security hardening recommendations for IORA administrators and developers.

## For Administrators

### 1. Secure Initial Setup

```bash
# Immediately after installation, change default credentials
passwd root  # IORA OS
# Update admin password in the Control Center UI

# Generate strong secrets
openssl rand -hex 32  # For SECRETS_MASTER_KEY
openssl rand -hex 32  # For SECURITY_DB_KEY
openssl rand -hex 32  # For JWT_SECRET
```

### 2. Network Hardening

```bash
# Configure firewall (UFW example)
ufw default deny incoming
ufw default allow outgoing
ufw allow 443/tcp    # HTTPS only
ufw allow 22/tcp     # SSH for management
ufw enable

# Never expose these ports directly:
# - 8126 (iora-home)
# - 8090 (iora-core)
# - 8092 (iora-assist)
# - 8095 (iora-security)
```

### 3. TLS Configuration

Always use TLS in production:

```nginx
server {
    listen 443 ssl http2;
    ssl_certificate /etc/letsencrypt/live/iora.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/iora.example.com/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers off;

    add_header Strict-Transport-Security "max-age=63072000" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
}
```

### 4. Regular Updates

```bash
# Docker deployment
docker compose pull
docker compose up -d

# IORA OS
rauc update /path/to/update.raucb

# Check current version
curl http://localhost:8126/health
```

### 5. Backup Strategy

```bash
# Database backup
pg_dump -U iora iora_home > backup_$(date +%Y%m%d).sql

# Encrypt backup
gpg --encrypt --recipient admin@example.com backup_20260601.sql

# Store off-site
scp backup_20260601.sql.gpg backup-server:/backups/
```

### 6. Monitor Security Events

```bash
# Check security status daily
curl http://localhost:8095/api/security/status

# Review recent threats
curl http://localhost:8095/api/security/threats

# Verify audit log integrity
curl http://localhost:8095/api/security/audit/verify
```

### 7. Credential Rotation

Rotate credentials every 90 days:
- `SECRETS_MASTER_KEY`
- `SECURITY_DB_KEY`
- `JWT_SECRET`
- API keys
- Database passwords

### 8. App Permission Review

Regularly review installed apps:
1. Control Center → Apps
2. Check each app's permissions
3. Revoke unnecessary permissions
4. Uninstall unused apps

### 9. Access Control

- Use separate API keys for each app/integration
- Set appropriate rate limits on API keys
- Use PIN auth only for trusted terminal devices
- Enable two-factor authentication when available

### 10. Logging & Monitoring

```bash
# Watch security logs
journalctl -u iora-security -f

# Watch gateway logs
journalctl -u iora-gateway -f

# Set up log aggregation (e.g., Loki, ELK)
```

## For Developers

### 1. Manifest Security

```json
{
  "permissions": [
    // ONLY request what you actually need
    "AppStorageRead",
    "NetworkAccess"
  ],
  "network_access": {
    "allowed_domains": [
      // Be specific
      "api.weatherservice.com"
    ],
    "allow_user_domains": false,
    "allow_network_scan": false
  }
}
```

### 2. API Key Handling

```javascript
// GOOD: Use environment variables or iora-secrets
const apiKey = process.env.API_KEY;

// BAD: Hardcoded API keys
const apiKey = "sk-abc123..."; // NEVER do this!

// GOOD: Use the SDK's secrets integration
const key = await client.secrets.get('external-service-api-key');
```

### 3. Input Validation

```javascript
// ALWAYS validate and sanitize user input
function processUserInput(input) {
  // Validate type
  if (typeof input !== 'string') {
    throw new Error('Invalid input type');
  }

  // Validate length
  if (input.length > 1000) {
    throw new Error('Input too long');
  }

  // Sanitize
  const sanitized = input.replace(/[<>]/g, '');

  return sanitized;
}
```

### 4. SQL Query Safety

```javascript
// GOOD: Parameterized queries
await client.appDatabase.execute(
  'SELECT * FROM todos WHERE title = ?',
  [userInput]  // Parameter binding
);

// BAD: String concatenation
await client.appDatabase.execute(
  `SELECT * FROM todos WHERE title = '${userInput}'` // SQL injection risk!
);
```

### 5. Secure Storage

```javascript
// Use app storage for non-sensitive data
await client.appStorage.setKv('user_prefs', { theme: 'dark' });

// Use iora-secrets for sensitive data
await client.secrets.create({
  name: 'External API Key',
  value: apiKey,
  allowed_services: ['my-app']
});
```

### 6. Error Handling

```javascript
// Don't expose sensitive information in errors
try {
  await client.appDatabase.execute(sql, params);
} catch (error) {
  // Log the full error internally
  console.error('Database error:', error);

  // Return a generic message to the user
  return {
    success: false,
    message: 'An error occurred while processing your request'
  };
}
```

### 7. Messaging Security

```javascript
// Use protected channels for sensitive data
const channel = await client.appMessaging.registerChannel({
  name: 'myapp:internal',
  channel_type: 'protected',  // Not public!
  allowed_subscribers: ['my-app', 'trusted-app']
});

// Validate incoming messages
client.on('message', (msg) => {
  if (msg.from !== 'trusted-app') {
    console.warn('Message from untrusted source:', msg.from);
    return;
  }
  // Process message
});
```

### 8. Dependency Management

```bash
# Keep dependencies updated
npm audit
npm update

# Use lockfiles
npm ci  # Instead of npm install in CI/CD
```

### 9. Content Security

```html
<!-- Set appropriate Content-Security-Policy -->
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'">
```

### 10. Regular Security Testing

- Run `npm audit` / `cargo audit` in CI
- Test for common vulnerabilities (OWASP Top 10)
- Verify your app works with revoked permissions
- Test error handling with invalid inputs

## Security Checklist

### Before Publishing an App

- [ ] Only essential permissions requested
- [ ] All user input validated and sanitized
- [ ] No hardcoded secrets or API keys
- [ ] Parameterized SQL queries (no string concatenation)
- [ ] Proper error handling (no sensitive data exposure)
- [ ] Dependencies up to date and audited
- [ ] Network access limited to required domains
- [ ] Content Security Policy configured
- [ ] README documents security considerations
- [ ] Tested with permissions revoked

### Before Deploying to Production

- [ ] All default passwords changed
- [ ] TLS configured and enabled
- [ ] Firewall rules in place
- [ ] Auto-lockdown enabled
- [ ] Alert channels configured
- [ ] Backup strategy implemented
- [ ] Monitoring and logging active
- [ ] Security update policy defined
- [ ] Incident response plan documented
- [ ] Admin access restricted to trusted IPs

## Incident Response

### If You Suspect a Security Breach:

1. **Isolate** – Trigger manual lockdown: POST `/api/security/lockdown` with level 4
2. **Preserve** – Do not restart services; preserve forensic evidence
3. **Investigate** – Review audit logs: GET `/api/security/audit`
4. **Identify** – Determine scope: Which services/apps were affected?
5. **Contain** – Block affected IPs, rotate compromised credentials
6. **Eradicate** – Remove the threat (patch, reinstall, reconfigure)
7. **Recover** – Restore from clean backups, verify integrity
8. **Learn** – Update security measures to prevent recurrence

## Related Documentation

- [Security Overview](README.md) – Architecture and features
- [Permission System](permissions.md) – Complete permission reference
- [Network Security](network.md) – Network hardening
- [Encryption](encryption.md) – Encryption standards
- [Threat Detection](threat-detection.md) – IDS and response
