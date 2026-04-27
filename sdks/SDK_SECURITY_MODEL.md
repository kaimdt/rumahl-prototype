# IORA SDK Security Model

## Overview

This document describes the comprehensive security model for IORA Apps and Plugins, ensuring safe integration while preventing privilege escalation and unauthorized access.

## Token-Based Permission System

### Time-Limited Access Tokens

Apps and Plugins **do not** have direct API keys. Instead, they must request time-limited tokens from IORA:

```rust
// Request token with specific permissions
let token_request = TokenRequest {
    app_id: "com.example.myapp",
    permissions: vec![Permission::FileShareRead, Permission::ReadEntities],
    duration_seconds: 3600, // 1 hour
};

let token = client.request_token(token_request).await?;
// Token is valid for 1 hour, then must be renewed
```

### Token Lifecycle

1. **Request**: App/Plugin requests token with specific permissions
2. **Validation**: IORA validates the request against manifest permissions
3. **Grant**: IORA issues time-limited token (JWT) with claims
4. **Usage**: App/Plugin uses token for API calls
5. **Renewal**: Before expiration, App/Plugin can renew token
6. **Revocation**: User or IORA can revoke tokens at any time

### Token Structure (JWT)

```json
{
  "sub": "app_id or plugin_id",
  "type": "app" | "plugin",
  "permissions": ["ReadEntities", "FileShareRead"],
  "iat": 1234567890,
  "exp": 1234571490,
  "jti": "unique_token_id",
  "cannot_escalate": true
}
```

## Permission Restrictions

### Apps vs Plugins

| Feature | Plugins | Apps |
|---------|---------|------|
| Token Duration | Max 15 minutes | Max 24 hours |
| Token Self-Renewal | ❌ No | ✅ Yes |
| Create Admin Users | ❌ No | ❌ No |
| Create Regular Users | ❌ No | ⚠️ Yes (Dangerous) |
| Self-Token Generation | ❌ No | ❌ No |
| Host System Access | ❌ No | ⚠️ Yes (with consent) |
| External Code Execution | ❌ No | ⚠️ Yes (Developer Mode) |

### Critical Restrictions

1. **No Self-Escalation**: Apps/Plugins cannot create new tokens beyond their granted permissions
2. **No Admin Creation**: Only system administrators can create admin users
3. **No Token Forgery**: Tokens are cryptographically signed by IORA with rotating keys
4. **No Permission Bypass**: All API calls validate tokens against permission claims

### User Creation Permission

The `CreateUser` permission is marked as **DANGEROUS** and requires explicit user consent:

```rust
Permission::CreateUser => {
    risk_level: RiskLevel::High,
    category: PermissionCategory::AppOnlyWithConsent,
    restrictions: vec![
        "Can only create regular users (role: user)",
        "Cannot create admins or modify roles",
        "Limited to 10 users per day per app",
        "Requires email verification for created users"
    ]
}
```

## Runtime Integrity Monitoring

### App/Plugin Integrity Checks

IORA actively monitors running Apps and Plugins for manipulation:

```rust
// Integrity monitoring system
pub struct IntegrityMonitor {
    // Track original checksums
    checksums: HashMap<String, String>,
    // Monitor file modifications
    file_watchers: Vec<FileWatcher>,
    // Memory protection
    memory_guards: Vec<MemoryGuard>,
}
```

### Monitored Threats

1. **Code Injection**: Detect runtime code modifications
2. **Library Tampering**: Verify loaded libraries match manifest
3. **Memory Manipulation**: Monitor suspicious memory access patterns
4. **Unauthorized File Access**: Track file I/O outside permissions
5. **Network Anomalies**: Detect connections not declared in manifest

### Integrity Violation Response

```rust
match integrity_monitor.check_app(app_id).await? {
    IntegrityStatus::Intact => { /* Continue */ },
    IntegrityStatus::Suspicious(details) => {
        log::warn!("Suspicious activity detected: {}", details);
        notify_admin(app_id, &details).await?;
    },
    IntegrityStatus::Compromised(details) => {
        log::error!("App compromised: {}", details);
        // Immediate actions:
        terminate_app(app_id).await?;
        revoke_all_tokens(app_id).await?;
        quarantine_app(app_id).await?;
        notify_admin_urgent(app_id, &details).await?;
    }
}
```

## External Code Execution Prevention

### Default Behavior (Production Mode)

**External code loading is BLOCKED** by default:

- ❌ Loading code from URLs (HTTP/HTTPS)
- ❌ Dynamic imports from external sources
- ❌ `eval()` or similar dynamic execution
- ❌ Loading unsigned/unverified modules
- ❌ Runtime code generation from external data

### Developer Mode Exception

When **Developer Mode** is enabled in IORA Control Center:

1. User must explicitly enable in Settings → Advanced → Developer Mode
2. Warning displayed about security implications
3. Apps/Plugins can opt-in via manifest: `"allow_external_code": true`
4. Additional consent required during installation
5. Clear indicator shown in UI that app uses external code

```json
// manifest.json for apps in developer mode
{
  "id": "com.example.dev-app",
  "developer_mode_features": {
    "allow_external_code": true,
    "external_code_sources": [
      "https://cdn.example.com/scripts/*"
    ],
    "justification": "Required for loading user-provided plugins"
  }
}
```

### IORA Inspection Layer

IORA injects monitoring code into Apps/Plugins to intercept:

```rust
// Injected monitoring layer
pub struct CodeExecutionMonitor {
    // Track all code loads
    loaded_modules: Vec<ModuleInfo>,
    // Verify signatures
    signature_validator: SignatureValidator,
    // Sandbox external code
    sandbox: ExternalCodeSandbox,
}

impl CodeExecutionMonitor {
    pub async fn intercept_load(&self, source: &str) -> Result<(), SecurityViolation> {
        if source.starts_with("http") || source.starts_with("https") {
            // External source detected
            if !self.developer_mode_enabled {
                return Err(SecurityViolation::ExternalCodeBlocked(source.to_string()));
            }

            // Verify against whitelist in manifest
            if !self.is_whitelisted(source) {
                return Err(SecurityViolation::UnauthorizedSource(source.to_string()));
            }

            // Load in isolated sandbox
            self.sandbox.execute_external(source).await?;
        }
        Ok(())
    }
}
```

## API Access Security

### Token Validation Middleware

Every API call goes through validation:

```rust
async fn validate_token(token: &str) -> Result<TokenClaims, SecurityError> {
    // 1. Verify signature
    let claims = verify_jwt_signature(token)?;

    // 2. Check expiration
    if claims.exp < Utc::now().timestamp() {
        return Err(SecurityError::TokenExpired);
    }

    // 3. Check revocation list
    if is_token_revoked(&claims.jti).await? {
        return Err(SecurityError::TokenRevoked);
    }

    // 4. Verify cannot escalate
    if !claims.cannot_escalate {
        return Err(SecurityError::InvalidToken);
    }

    Ok(claims)
}

async fn check_permission(claims: &TokenClaims, required: Permission) -> Result<(), SecurityError> {
    if !claims.permissions.contains(&required) {
        return Err(SecurityError::InsufficientPermissions {
            required,
            granted: claims.permissions.clone(),
        });
    }
    Ok(())
}
```

### Rate Limiting

Token-based rate limiting prevents abuse:

```rust
pub struct RateLimiter {
    // Per-token limits
    limits: HashMap<String, TokenLimits>,
}

struct TokenLimits {
    requests_per_minute: u32,
    requests_per_hour: u32,
    requests_per_day: u32,
}

impl RateLimiter {
    async fn check_limit(&self, token_id: &str) -> Result<(), RateLimitError> {
        let usage = self.get_usage(token_id).await?;
        let limits = self.get_limits(token_id).await?;

        if usage.last_minute >= limits.requests_per_minute {
            return Err(RateLimitError::MinuteExceeded);
        }
        if usage.last_hour >= limits.requests_per_hour {
            return Err(RateLimitError::HourExceeded);
        }
        if usage.last_day >= limits.requests_per_day {
            return Err(RateLimitError::DayExceeded);
        }

        Ok(())
    }
}
```

## Security Audit Log

All security-relevant events are logged:

```rust
pub enum SecurityEvent {
    TokenRequested { app_id: String, permissions: Vec<Permission> },
    TokenGranted { app_id: String, token_id: String, duration: u64 },
    TokenRenewed { app_id: String, token_id: String },
    TokenRevoked { app_id: String, token_id: String, reason: String },
    PermissionDenied { app_id: String, permission: Permission, reason: String },
    IntegrityViolation { app_id: String, details: String },
    ExternalCodeBlocked { app_id: String, source: String },
    RateLimitExceeded { app_id: String, limit_type: String },
    UnauthorizedAccess { app_id: String, resource: String },
}

impl SecurityAuditLog {
    pub async fn log_event(&self, event: SecurityEvent) {
        // Store in database
        self.db.insert_audit_log(event.clone()).await;

        // Alert on critical events
        if event.is_critical() {
            self.alert_admin(event).await;
        }

        // Forward to SIEM if configured
        if let Some(siem) = &self.siem_client {
            siem.send_event(event).await;
        }
    }
}
```

## Host System Access

Apps with host system permissions run with additional restrictions:

### Container Security

```yaml
# Docker security profile for apps with host access
services:
  app-with-host-access:
    security_opt:
      - no-new-privileges:true
      - apparmor=iora-app-host-access
    cap_drop:
      - ALL
    cap_add:
      - CHOWN  # Only if FileSystemWrite granted
      - NET_BIND_SERVICE  # Only if NetworkInbound granted
    read_only: true
    tmpfs:
      - /tmp:rw,noexec,nosuid,size=100m
    volumes:
      - /host/allowed/path:/data:ro  # Read-only by default
```

### AppArmor Profile

```
# /etc/apparmor.d/iora-app-host-access
profile iora-app-host-access flags=(attach_disconnected,mediate_deleted) {
  # Deny most operations by default
  deny /** w,
  deny /** x,

  # Allow specific operations based on permissions
  /data/** r,  # Only if FileShareRead granted
  /data/write/** rw,  # Only if FileShareWrite granted

  # Network restrictions
  deny network raw,
  network inet stream,  # Only if NetworkOutbound
  deny network inet6,

  # Process restrictions
  deny ptrace,
  deny signal,
  deny mount,

  # Capability restrictions
  deny capability sys_admin,
  deny capability sys_module,
  deny capability sys_rawio,
}
```

## SDK Implementation

### Token Management in SDK

```rust
// Rust SDK
impl IoraClient {
    pub async fn request_token(&self, permissions: Vec<Permission>) -> Result<AccessToken> {
        let request = TokenRequest {
            app_id: env::var("IORA_APP_ID")?,
            permissions,
            duration_seconds: 3600,
        };

        let response = self.http_client
            .post(&format!("{}/api/tokens/request", self.base_url))
            .json(&request)
            .send()
            .await?;

        let token: AccessToken = response.json().await?;

        // Store token securely
        self.token_store.save(token.clone()).await?;

        // Schedule renewal before expiration
        self.schedule_renewal(&token).await?;

        Ok(token)
    }

    async fn schedule_renewal(&self, token: &AccessToken) {
        let renewal_time = token.expires_at - Duration::minutes(5);
        tokio::spawn(async move {
            sleep_until(renewal_time).await;
            self.renew_token(token.id).await;
        });
    }
}
```

### Python SDK

```python
class IoraClient:
    async def request_token(self, permissions: List[Permission]) -> AccessToken:
        request = {
            "app_id": os.getenv("IORA_APP_ID"),
            "permissions": [p.value for p in permissions],
            "duration_seconds": 3600
        }

        response = await self.http_client.post(
            f"{self.base_url}/api/tokens/request",
            json=request
        )

        token = AccessToken(**response.json())

        # Store token securely
        await self.token_store.save(token)

        # Schedule renewal
        await self.schedule_renewal(token)

        return token
```

## Best Practices for App/Plugin Developers

### 1. Request Minimal Permissions
```rust
// Bad: Requesting unnecessary permissions
let permissions = vec![
    Permission::FileShareRead,
    Permission::FileShareWrite,
    Permission::SystemControl,  // Not needed!
    Permission::DatabaseWrite,  // Not needed!
];

// Good: Only what's needed
let permissions = vec![
    Permission::FileShareRead,
];
```

### 2. Handle Token Expiration Gracefully
```rust
match client.files().list(None).await {
    Err(IoraError::TokenExpired) => {
        // Automatically renew
        client.renew_token().await?;
        // Retry operation
        client.files().list(None).await?
    },
    result => result?,
}
```

### 3. Never Store Tokens Insecurely
```rust
// Bad: Plain text storage
fs::write("token.txt", &token)?;

// Good: Encrypted storage
let encrypted = encrypt_token(&token, &app_secret)?;
secure_storage.save("token", encrypted).await?;
```

### 4. Respect Rate Limits
```rust
impl ApiClient {
    async fn call_with_backoff<T>(&self, operation: impl Fn() -> Future<Result<T>>) -> Result<T> {
        let mut retries = 0;
        loop {
            match operation().await {
                Err(IoraError::RateLimitExceeded { retry_after }) => {
                    if retries >= 3 {
                        return Err(IoraError::MaxRetriesExceeded);
                    }
                    sleep(Duration::seconds(retry_after)).await;
                    retries += 1;
                },
                result => return result,
            }
        }
    }
}
```

## Summary

The IORA security model provides:

✅ **Token-based access** - No permanent API keys, time-limited tokens only
✅ **Permission isolation** - Apps cannot escalate privileges
✅ **Admin protection** - No API can create admin users
✅ **Runtime monitoring** - Active detection of tampering
✅ **External code control** - Blocked by default, opt-in with Developer Mode
✅ **Audit logging** - Complete security event tracking
✅ **Rate limiting** - Prevent abuse and DoS
✅ **Container isolation** - Docker + AppArmor for host access
✅ **Cryptographic verification** - Signed tokens, integrity checks

This model ensures Apps and Plugins can integrate deeply with IORA while maintaining security boundaries and preventing malicious behavior.
