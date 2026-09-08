---
title: Developer REST API
description: Complete REST API reference for rumahl Developers: apps, releases, binaries, team members, webhooks, and API keys.
readTime: 10 min
updated: 2026-09-05
featured: true
category: develop
---

The **rumahl Developer REST API** provides developers and DevOps engineers with programmatic control over app registries, release management, binary uploads, phased rollouts, webhook web services, and team authorizations.

## API Basics & Authentication

| Environment | Base URL |
| --- | --- |
| Production | `https://api.rumahl.com/api/v1/developer` |
| Local Instance | `http://localhost:8126/api/v1/developer` |

### Authentication

Every request to the Developer API must be authenticated using either an OAuth 2.0 bearer token or an organization-scoped API key:

```bash
# Option 1: OAuth 2.0 Bearer Token
curl https://api.rumahl.com/api/v1/developer/products \
  -H "Authorization: Bearer <access_token>"

# Option 2: Developer API Key
curl https://api.rumahl.com/api/v1/developer/products \
  -H "X-API-Key: rk_live_9f8e7d6c5b4a3a2b1"
```

## Rate Limits & Error Handling

The API employs dynamic quota windows to maintain system stability. Standard rate limit headers accompany every HTTP response:

| Header | Description |
| --- | --- |
| `X-RateLimit-Limit` | Maximum allowable requests in the current time frame (e.g. `1000`) |
| `X-RateLimit-Remaining` | Number of remaining calls in the active window |
| `X-RateLimit-Reset` | Unix timestamp indicating when the quota resets |
| `Retry-After` | Wait time in seconds when HTTP 429 is encountered |

### Standard Problem Details (RFC 7807)

Errors are systematically returned conforming to the RFC 7807 specification:

```json
{
  "type": "https://api.rumahl.com/errors/invalid_manifest",
  "title": "Invalid App Manifest",
  "status": 400,
  "detail": "The required field 'version' does not follow semantic versioning standards.",
  "instance": "/api/v1/developer/products/prod_1029/releases"
}
```

## Products & App Management

### 1. Retrieve Organization Products
`GET /api/v1/developer/products`

```bash
curl -X GET https://api.rumahl.com/api/v1/developer/products \
  -H "X-API-Key: rk_live_9f8e7d6c5b4a3a2b1"
```

```json
{
  "products": [
    {
      "id": "prod_8829a",
      "app_id": "com.example.smarthome",
      "name": "SmartHome Pro",
      "status": "published",
      "current_version": "2.4.1",
      "created_at": "2026-01-15T10:00:00Z"
    }
  ]
}
```

### 2. Register New App
`POST /api/v1/developer/products`

```json
{
  "app_id": "com.example.sensorhub",
  "name": "Sensor Hub",
  "type": "container",
  "description": "Advanced multi-sensor hub for rumahl Smart Home",
  "redirect_uris": ["https://sensorhub.example.com/oauth/callback"]
}
```

## Releases & Binary Uploads

Deploying an application release consists of three lifecycle steps: creating the release record, uploading the binary bundle, and triggering the rollout.

### 1. Create Release Draft
`POST /api/v1/developer/products/:id/releases`

```json
{
  "version": "2.5.0",
  "channel": "beta",
  "changelog": "- New high-efficiency battery mode\n- Added Matter 1.4 sensor telemetry",
  "min_system_version": "2.0.0"
}
```

### 2. Upload Release Bundle
`POST /api/v1/developer/products/:id/releases/:version/upload`

Bundles must be delivered as `tar.gz` or `zip` packages. Include an explicit SHA-256 header for checksum verification:

```bash
curl -X POST https://api.rumahl.com/api/v1/developer/products/prod_8829a/releases/2.5.0/upload \
  -H "X-API-Key: rk_live_9f8e7d6c5b4a3a2b1" \
  -H "X-File-SHA256: 4f8b...321c" \
  -F "bundle=@./dist/smarthome-2.5.0.tar.gz"
```

### 3. Initiate or Update Rollout
`POST /api/v1/developer/products/:id/releases/:version/rollout`

```json
{
  "target_percentage": 25,
  "auto_promote": true,
  "crash_threshold_percent": 1.5
}
```

## Organizations & Members

Administer team members and access tiers programmatically:

| Endpoint | Method | Description |
| --- | --- | --- |
| `/api/v1/developer/organizations` | `GET` | List organizations accessible by current credentials |
| `/api/v1/developer/organizations/:id/members` | `GET` | List all members and assigned security roles |
| `/api/v1/developer/organizations/:id/invites` | `POST` | Invite new developer via email and specified role |
| `/api/v1/developer/organizations/:id/members/:userId` | `DELETE` | Remove collaborator from organization |

## API Keys & Credentials

API keys empower automated deployment pipelines and scripts:

```bash
# Generate scoped key with expiration
curl -X POST https://api.rumahl.com/api/v1/developer/keys \
  -H "Authorization: Bearer <user_access_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "label": "GitHub Actions Deployment Key",
    "scopes": ["developer.releases.publish"],
    "expires_in_days": 90
  }'
```

## Webhooks & Events

Webhooks deliver real-time notifications to your servers when significant platform lifecycle events occur:

### Supported Event Types
- `release.published`: Release deployed and made accessible to targeted users.
- `release.halted`: Rollout suspended automatically due to anomalous crash logs.
- `app.review_approved`: Store verification finalized successfully.
- `app.review_rejected`: Store submission flagged with required modifications.
- `user.consent_revoked`: End-user terminated authorization grants for your client.

### Signature Verification (HMAC-SHA256)

Every webhook payload arrives with an `X-Rumahl-Signature` header calculated with your webhook signing secret:

```
X-Rumahl-Signature: t=1757078400,v1=9b3a...78f0
```
