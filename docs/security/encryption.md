# Encryption

rumahl uses industry-standard encryption to protect sensitive data at rest and in transit. This document details the encryption mechanisms, key management, and best practices.

## Encryption Standards

| Data | Algorithm | Key Size | Mode |
|------|-----------|----------|------|
| Secrets (API keys, passwords) | AES | 256-bit | GCM |
| Security audit logs | AES | 256-bit | GCM |
| Transport (HTTPS) | TLS | 256-bit | 1.2 / 1.3 |
| JWT tokens | HMAC | SHA-256 | – |
| Password hashing | Argon2id | – | – |

## Secrets Storage (rumahl-secrets)

The `rumahl-secrets` service provides centralized encrypted storage for sensitive data.

### Encryption Details

- **Algorithm**: AES-256-GCM (Galois/Counter Mode)
- **Authenticated encryption**: Provides both confidentiality and integrity
- **Unique nonce**: Each secret encrypted with a unique 96-bit nonce
- **Master key**: 32 bytes (64 hex characters) derived from `SECRETS_MASTER_KEY` environment variable

### Key Derivation

```rust
// Master key is loaded from environment
let master_key = hex::decode(std::env::var("SECRETS_MASTER_KEY")?)?;
// Must be exactly 32 bytes (64 hex chars)
assert_eq!(master_key.len(), 32);
```

### Storage Format

Each secret is stored with:
```
{
  "id": "uuid",
  "name": "My API Key",
  "encrypted_value": "<base64-encoded ciphertext>",
  "nonce": "<base64-encoded 96-bit nonce>",
  "created_at": "2026-06-01T12:00:00Z",
  "expires_at": null,
  "allowed_services": ["rumahl-home", "rumahl-assist"]
}
```

### Access Control

- Secrets have an access control list specifying which services can read them
- Every access is logged to the audit trail
- Failed access attempts trigger security alerts
- Secret rotation is supported with history

### Key Management

```bash
# Generate a secure master key
openssl rand -hex 32
# Output: a1b2c3d4e5f6... (64 characters)

# Set in environment
export SECRETS_MASTER_KEY="a1b2c3d4e5f6..."
```

**Never commit the master key to version control.** Use environment variables or a secrets manager.

## Security Audit Logs (rumahl-security)

The security audit database uses encrypted, hash-chained logging.

### Hash-Chained Integrity

Each log entry contains a hash of the previous entry, creating an immutable chain:

```
Entry 1: { data: "...", prev_hash: "0000...", hash: "abc123..." }
Entry 2: { data: "...", prev_hash: "abc123...", hash: "def456..." }
Entry 3: { data: "...", prev_hash: "def456...", hash: "789ghi..." }
```

**Properties:**
- Tampering with any entry breaks the hash chain
- The chain can be verified from any point forward
- Append-only: entries cannot be deleted or modified
- Blockchain-style integrity without blockchain complexity

### Encryption

- **Algorithm**: AES-256-GCM
- **Key**: 32 bytes from `SECURITY_DB_KEY` environment variable
- **Database**: SQLite file at `/var/lib/ora/security.db`
- **Without the key**: Database file is completely unreadable

### Verification

```http
# Verify audit log integrity
GET /api/security/audit/verify

# Response
{
  "verified": true,
  "total_entries": 15000,
  "first_entry": "2026-01-01T00:00:00Z",
  "last_entry": "2026-06-01T12:00:00Z",
  "hash_chain_intact": true
}
```

## Transport Encryption (TLS)

### In Production

All external traffic should be encrypted with TLS:

```nginx
server {
    listen 443 ssl http2;
    server_name ora.example.com;

    ssl_certificate /etc/letsencrypt/live/ora.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ora.example.com/privkey.pem;

    # Modern configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers off;

    # HSTS
    add_header Strict-Transport-Security "max-age=63072000" always;
}
```

### In Development

Development uses HTTP for convenience. TLS is not required on localhost.

## Password Hashing

User passwords are hashed with Argon2id:

```rust
use argon2::Argon2;

let salt = SaltString::generate(&mut OsRng);
let argon2 = Argon2::default();
let password_hash = argon2
    .hash_password(password.as_bytes(), &salt)?
    .to_string();
```

**Argon2 parameters:**
- Memory: 19 MB (m_cost = 19456)
- Iterations: 2 (t_cost = 2)
- Parallelism: 1 (p_cost = 1)

## JWT Token Security

- **Algorithm**: HMAC-SHA256 (HS256)
- **Secret**: Configurable via `JWT_SECRET` environment variable
- **Expiry**: Configurable, default 24 hours
- **Claims**: User ID, username, admin flag, expiry timestamp

```javascript
// Token payload
{
  "sub": "user-uuid",
  "username": "admin",
  "is_admin": true,
  "iat": 1717246800,
  "exp": 1717333200
}
```

## API Key Security

- Generated as cryptographically random 32-byte hex strings
- Stored hashed (SHA-256) in the database
- Only the hash is stored, never the plaintext key
- Keys are shown once at creation and cannot be retrieved later

```bash
# Generate a secure API key
openssl rand -hex 32
```

## Encryption Best Practices

### For Developers

1. **Never hardcode secrets** – Use environment variables or rumahl-secrets
2. **Use parameterized queries** – Prevent SQL injection
3. **Validate all input** – Even from authenticated sources
4. **Rotate keys regularly** – Especially after personnel changes
5. **Use HTTPS for external APIs** – Never send data in cleartext

### For Administrators

1. **Generate strong master keys** – Use `openssl rand -hex 32`
2. **Store keys securely** – Use a password manager or hardware security module
3. **Back up keys safely** – Encrypted backups, separate from data backups
4. **Rotate keys periodically** – At least every 90 days
5. **Monitor access logs** – Watch for unusual access patterns

### Key Rotation Procedure

```bash
# 1. Generate new key
NEW_KEY=$(openssl rand -hex 32)

# 2. Re-encrypt all secrets with new key
rumahl-cli secrets rekey --old-key $OLD_KEY --new-key $NEW_KEY

# 3. Update environment variable
export SECRETS_MASTER_KEY="$NEW_KEY"

# 4. Restart rumahl-secrets service
systemctl restart rumahl-secrets

# 5. Verify
curl http://localhost:8093/health
```

## Related Documentation

- [Security Overview](README.md) – Security architecture overview
- [Threat Detection](threat-detection.md) – Intrusion detection and response
- [Best Practices](best-practices.md) – Security hardening guide
- [Database Security](../database-security.md) – PostgreSQL and SQLite security
