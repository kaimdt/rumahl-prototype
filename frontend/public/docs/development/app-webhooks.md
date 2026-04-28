# Webhooks Guide

Apps in IORA can register webhook endpoints that external services can call. The IORA system handles URL generation, request validation, retry logic, and delivery logging.

## Overview

External services can send HTTP requests to your app's webhook URL, and IORA forwards them to your app's internal endpoint. This enables:

- **GitHub webhooks** – react to push events, PRs, etc.
- **IFTTT / Zapier integrations** – receive data from hundreds of services
- **Custom integrations** – any service that supports webhooks

Each webhook gets a unique public URL:

```
POST /api/webhooks/apps/{app_id}/{webhook_id}
```

## Declaring Default Webhooks in the Manifest

```json
{
  "id": "my-app",
  "name": "My App",
  "version": "1.0.0",
  "type": "app",
  "webhooks": {
    "default_webhooks": [
      {
        "id": "github-push",
        "name": "GitHub Push Hook",
        "description": "Receives GitHub push events",
        "method": "POST",
        "target_url": "http://localhost:3000/api/github-hook",
        "verify_signature": true,
        "enabled": true,
        "max_retries": 5,
        "timeout_seconds": 30,
        "rate_limit_per_minute": 60
      }
    ]
  }
}
```

## Required Permissions

| Permission | Description |
|------------|-------------|
| `WebhookCreate` | Create webhook endpoints |
| `WebhookRead` | View webhook configuration |
| `WebhookUpdate` | Update webhook endpoints |
| `WebhookDelete` | Delete webhook endpoints |
| `WebhookManage` | Manage all webhooks (admin) |

## API Reference

### Webhook Management

```typescript
// List all webhooks
GET /api/apps/:app_id/webhooks

// Create a webhook
POST /api/apps/:app_id/webhooks
{
  "name": "GitHub Push",
  "description": "Receives push events from GitHub",
  "method": "POST",
  "target_url": "http://localhost:3000/hooks/github",
  "verify_signature": true,
  "enabled": true,
  "max_retries": 3,
  "timeout_seconds": 30,
  "rate_limit_per_minute": 60
}

// Response
{
  "success": true,
  "webhook_id": "550e8400-e29b-41d4-a716-446655440000",
  "public_url": "/api/webhooks/apps/my-app/550e8400-e29b-41d4-a716-446655440000"
}

// Get webhook details
GET /api/apps/:app_id/webhooks/:hook_id

// Update a webhook
PUT /api/apps/:app_id/webhooks/:hook_id
{
  "enabled": false,
  "target_url": "http://localhost:3000/hooks/new-endpoint"
}

// Delete a webhook
DELETE /api/apps/:app_id/webhooks/:hook_id
```

### Testing & Monitoring

```typescript
// Test a webhook (returns configuration for external setup)
POST /api/apps/:app_id/webhooks/:hook_id/test

// Get delivery logs
GET /api/apps/:app_id/webhooks/:hook_id/logs

// Get webhook statistics
GET /api/apps/:app_id/webhooks/:hook_id/stats

// Response (stats)
{
  "total_received": 152,
  "successful_deliveries": 148,
  "failed_deliveries": 4,
  "total_retries": 7,
  "average_duration_ms": 245.3,
  "last_delivery": {
    "id": "...",
    "webhook_id": "...",
    "attempt": 1,
    "response": {
      "status_code": 200,
      "headers": {},
      "body": {"ok": true}
    },
    "duration_ms": 123,
    "delivered_at": "2026-04-28T12:00:00Z"
  }
}
```

## SDK Usage

```typescript
import IoraClient from '@iora/sdk';

const client = new IoraClient('http://localhost:8126', 'your-api-key');
client.setAppId('my-app');

// Create a webhook for GitHub
const result = await client.appWebhooks.create({
  name: 'GitHub Push',
  target_url: 'http://localhost:3000/api/github',
  verify_signature: true,
  max_retries: 3
});

const publicUrl = `https://my-iora.local${result.public_url}`;
console.log('Send webhook to:', publicUrl);

// Get stats
const stats = await client.appWebhooks.getStats(result.webhook_id);
console.log('Successful deliveries:', stats.successful_deliveries);

// View delivery logs
const logs = await client.appWebhooks.getLogs(result.webhook_id);
```

## Setting up External Webhooks

### GitHub

1. Create a webhook in IORA (note the secret)
2. Go to your GitHub repo → Settings → Webhooks → Add webhook
3. Set Payload URL: `https://your-iora/api/webhooks/apps/my-app/{webhook_id}`
4. Set Content type: `application/json`
5. Set Secret: (the secret from your IORA webhook)
6. Choose events and save

### IFTTT

1. Create a webhook in IORA
2. In IFTTT, create an Applet with Webhook as the trigger
3. Set the webhook URL to your IORA webhook URL
4. Configure the payload format as needed

## HMAC Signature Verification

When `verify_signature` is enabled, incoming webhook requests are verified using HMAC-SHA256:

- **Header**: `X-IORA-Signature-256`
- **Format**: `sha256=<hex-encoded-signature>`

The signature is computed over the raw request body using the webhook's secret key.

## Best Practices

1. **Always use signature verification** – prevents unauthorized requests
2. **Set rate limits** – protects your app from abuse
3. **Use HTTPS** – ensures encryption in transit
4. **Monitor delivery logs** – check for failed deliveries
5. **Set reasonable timeouts** – adjust based on your app's response time
6. **Handle retries gracefully** – your endpoint should be idempotent
