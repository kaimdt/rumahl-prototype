---
title: OAuth 2.0 & rumahl Account
description: Single Sign-On with rumahl Account: OAuth 2.0, OpenID Connect, PKCE flow, scopes, passkeys, and consent management.
readTime: 9 min
updated: 2026-09-05
featured: true
category: develop
---

The **rumahl Account** operates as a federated Identity Provider (IdP) for all services, applications, and third-party integrations across the rumahl ecosystem. Using standardized **OAuth 2.0** and **OpenID Connect (OIDC)**, developers can implement secure authentication and delegated resource access with minimal effort.

## Single Sign-On with rumahl Account

Users authenticate once with their rumahl Account and can grant third-party applications granular permissions to access devices, smart automations, and profile data without ever revealing their credentials.

### Developer Benefits
- **Zero Credential Overhead:** Complete handover of Passkeys (FIDO2 / WebAuthn), 2FA, and recovery procedures to rumahl Account.
- **Granular Consent Screens:** Users review transparently which exact permission scopes your application is requesting.
- **Centralized Revocation:** Users can audit active sessions and revoke third-party app permissions directly from their rumahl Account security settings.

## Authorization Flows

Depending on your application architecture, select the corresponding OAuth 2.0 flow:

### 1. Authorization Code Flow with PKCE (Recommended)

For Single Page Applications (SPAs), mobile apps, and server-rendered web applications, **Authorization Code Flow with PKCE (RFC 7636)** is mandatory.

```
Client App                 rumahl Account (IdP)            Backend API
    |                               |                           |
    | 1. /oauth/authorize (PKCE)    |                           |
    |------------------------------>|                           |
    |                               |                           |
    | 2. Login & Consent Screen     |                           |
    |    (Passkey / 2FA)            |                           |
    |                               |                           |
    | 3. Redirect with Auth Code    |                           |
    |<------------------------------|                           |
    |                               |                           |
    | 4. /oauth/token (Code + Verifier)                         |
    |------------------------------>|                           |
    | 5. Access & ID Tokens         |                           |
    |<------------------------------|                           |
    |                                                           |
    | 6. API Call with Bearer Token                             |
    |---------------------------------------------------------->|
```

#### Step 1: Generate PKCE Code Verifier & Challenge

```typescript
import crypto from "crypto";

function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}
```

#### Step 2: Redirect User to rumahl Account

```
GET https://account.rumahl.com/oauth/authorize?
  client_id=YOUR_CLIENT_ID&
  response_type=code&
  redirect_uri=https%3A%2F%2Fmyapp.example.com%2Fcallback&
  scope=openid%20profile%20email%20rumahl.devices.read&
  state=xyz123SecureRandom&
  code_challenge=CHALLENGE_STRING&
  code_challenge_method=S256
```

#### Step 3: Exchange Authorization Code for Tokens

```bash
curl -X POST https://account.rumahl.com/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "code=AUTHORIZATION_CODE" \
  -d "redirect_uri=https://myapp.example.com/callback" \
  -d "code_verifier=VERIFIER_STRING"
```

### 2. Client Credentials Flow (RFC 6749)

For server-to-server daemon processes and background services without user interaction:

```bash
curl -X POST https://account.rumahl.com/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -u "YOUR_CLIENT_ID:YOUR_CLIENT_SECRET" \
  -d "grant_type=client_credentials" \
  -d "scope=developer.releases.publish"
```

## Identity & Token Endpoints

| Endpoint | Method | Description |
| --- | --- | --- |
| `/oauth/authorize` | `GET` | Interactive sign-in and authorization consent screen |
| `/oauth/token` | `POST` | Issues access, refresh, and ID tokens |
| `/oauth/userinfo` | `GET` | OIDC user profile details for authenticated user |
| `/oauth/revoke` | `POST` | Revokes an issued access or refresh token |
| `/.well-known/openid-configuration` | `GET` | Discovery document with server metadata and supported scopes |
| `/.well-known/jwks.json` | `GET` | Public signing keys (RS256) for verifying JWT tokens |

### Sample Response from `/oauth/userinfo`

```json
{
  "sub": "usr_99a8b7c6d5e4",
  "name": "Alex Meyer",
  "given_name": "Alex",
  "family_name": "Meyer",
  "email": "alex.meyer@example.com",
  "email_verified": true,
  "locale": "en-US",
  "updated_at": 1757078400
}
```

## Scopes & Permission Model

Permission scopes strictly govern what data and resources a client application can interact with:

| Scope | Type | Allowed Capabilities |
| --- | --- | --- |
| `openid` | OIDC | Returns unique user identifier (`sub`) and ID token |
| `profile` | OIDC | Read access to user's first and last name, avatar, and locale |
| `email` | OIDC | Read access to verified email address |
| `offline_access` | OAuth | Allows issuing long-lived refresh tokens |
| `rumahl.account.read` | rumahl | Account status, linked organizations, and security flags |
| `rumahl.devices.read` | Smart Home | Read room configurations, devices, and live sensor readings |
| `rumahl.devices.control` | Smart Home | Switch, dim, and adjust smart actuators and thermostats |
| `developer.apps.manage` | Developer | Create, modify, and delete apps in Developers Portal |
| `developer.releases.publish` | Developer | Upload binaries and publish releases to the store |

> **Best Practice:** Apply the principle of least privilege. Only request scopes strictly necessary for your application's current functionality.

## Passkeys, 2FA & Session Security

rumahl Account implements top-tier consumer and enterprise security:

- **Passkeys (FIDO2 / WebAuthn):** Phishing-resistant authentication using device biometric sensors (Touch ID, Face ID, Windows Hello) or hardware keys (YubiKey).
- **Two-Factor Authentication (TOTP):** Standards-compliant authenticator app support.
- **Cryptographic Session Fingerprinting:** Each session is evaluated against device trust indicators. Suspicious location changes trigger step-up verification.

## Access Revocation & Account Locking

### Token Revocation

When a user logs out of your app, invoke token revocation:

```bash
curl -X POST https://account.rumahl.com/oauth/revoke \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "token=REFRESH_TOKEN_OR_ACCESS_TOKEN" \
  -d "token_type_hint=refresh_token"
```

### Account Locking & HTTP 423 Status

If a user or developer account is placed on administrative hold or locked due to suspicious credential compromises, the API responds with **HTTP 423 Locked**:

```json
{
  "error": "account_locked",
  "error_description": "This rumahl Account is temporarily locked due to security restrictions.",
  "support_url": "https://account.rumahl.com/support/unlock"
}
```
