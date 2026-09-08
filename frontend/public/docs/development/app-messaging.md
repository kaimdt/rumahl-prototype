# Inter-App Messaging Guide

Apps in rumahl can communicate with each other through a publish/subscribe messaging system. This enables loose coupling between apps while maintaining isolation.

## Overview

Three communication patterns are available:

- **Pub/Sub** – One-to-many broadcast on named channels
- **Direct Messages** – App-to-app direct messaging
- **System Events** – System events that apps can listen to

### Channel Types

| Type | Description |
|------|-------------|
| `public` | Any app with `MessagingSubscribe` can subscribe |
| `protected` | Only apps on the allowlist can subscribe |
| `system` | Reserved for rumahl core system events |

## Declaring Channels in the Manifest

```json
{
  "id": "my-app",
  "name": "My App",
  "version": "1.0.0",
  "type": "app",
  "messaging": {
    "channels": [
      {
        "name": "myapp:alerts",
        "channel_type": "public",
        "description": "Alert messages from My App",
        "allowed_publishers": [],
        "allowed_subscribers": [],
        "retention_seconds": 3600,
        "max_message_size_bytes": 102400
      },
      {
        "name": "myapp:internal",
        "channel_type": "protected",
        "description": "Internal app messages",
        "allowed_publishers": ["my-app"],
        "allowed_subscribers": ["my-app", "authorized-app"],
        "retention_seconds": 86400,
        "max_message_size_bytes": 102400
      }
    ],
    "default_subscriptions": [
      "system:events",
      "system:entities"
    ]
  }
}
```

## Required Permissions

| Permission | Description |
|------------|-------------|
| `MessagingPublish` | Publish messages to channels |
| `MessagingSubscribe` | Subscribe to channels |
| `MessagingWildcard` | Subscribe to ANY channel (dangerous) |
| `MessagingDirect` | Send direct messages to other apps |

## API Reference

### Channel Management

```typescript
// List available channels
GET /api/apps/messaging/channels

// Register a new channel
POST /api/apps/messaging/channels
{
  "name": "myapp:status",
  "channel_type": "public",
  "description": "Status updates from My App",
  "retention_seconds": 3600
}
```

### Publishing & Subscribing

```typescript
// Publish a message to a channel
POST /api/apps/messaging/publish
{
  "channel": "myapp:alerts",
  "payload": {
    "level": "warning",
    "message": "CPU temperature high: 85°C"
  },
  "priority": "high",
  "ttl_seconds": 300
}

// Subscribe to a channel
POST /api/apps/:app_id/messaging/subscribe
{
  "channel": "myapp:alerts",
  "filter": "$.level == 'critical'",
  "webhook_url": "http://rumahl.local:3000/webhook/alerts"
}

// List subscriptions
GET /api/apps/:app_id/messaging/subscriptions

// Unsubscribe
DELETE /api/apps/:app_id/messaging/subscriptions/:sub_id
```

### Direct Messages

```typescript
// Send a direct message
POST /api/apps/:app_id/messaging/direct
{
  "to": "other-app",
  "payload": {
    "type": "request",
    "action": "get_data",
    "params": {}
  }
}

// Get inbox (received direct messages)
GET /api/apps/:app_id/messaging/inbox

// Mark message as read
POST /api/apps/:app_id/messaging/inbox/:msg_id/read
```

### Real-Time Stream

```typescript
// SSE stream of all messages
GET /api/apps/messaging/events
// Server-Sent Events endpoint for real-time message streaming
```

## SDK Usage

```typescript
import rumahlClient from '@rumahl/sdk';

const client = new rumahlClient('http://rumahl.local:8126', 'your-api-key');
client.setAppId('my-app');

// Register a channel
await client.appMessaging.registerChannel({
  name: 'myapp:events',
  channel_type: 'public',
  description: 'Events from My App'
});

// Publish a message
await client.appMessaging.publish(
  'myapp:events',
  { event: 'user_login', user: 'admin' },
  'normal'
);

// Subscribe to another app's channel
const sub = await client.appMessaging.subscribe(
  'other-app:notifications',
  undefined,
  'http://rumahl.local:3000/hooks/notifications'
);

// Send a direct message
await client.appMessaging.sendDirect(
  'other-app',
  { type: 'greeting', text: 'Hello from My App!' }
);

// Check inbox
const inbox = await client.appMessaging.getInbox();
for (const msg of inbox) {
  if (!msg.read) {
    console.log('Message from:', msg.from, msg.payload);
    await client.appMessaging.markRead(msg.id);
  }
}
```

## Message Priorities

| Priority | Description |
|----------|-------------|
| `low` | Background information, no action needed |
| `normal` | Regular messages (default) |
| `high` | Important, should be processed soon |
| `critical` | Requires immediate attention |

## Message Filtering

Subscriptions can include a JSON path filter. Only messages matching the filter are delivered:

```
// Subscribe only to critical alerts
{
  "channel": "myapp:alerts",
  "filter": "$.level == 'critical'"
}

// Subscribe to temperature readings above 50
{
  "channel": "sensors:temperature",
  "filter": "$.value > 50"
}
```

## Best Practices

1. **Name channels with prefixes** – use `appname:channel` to avoid name collisions
2. **Use appropriate channel types** – use `protected` for sensitive data
3. **Set message TTL** – old messages are automatically cleaned up
4. **Use webhook subscriptions** – for async message delivery to your app
5. **Handle priorities** – process critical messages immediately
6. **Keep payloads small** – large payloads impact performance
7. **Use filters** – reduce unnecessary message delivery
