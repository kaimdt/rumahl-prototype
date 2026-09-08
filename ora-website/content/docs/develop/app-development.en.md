---
title: App Development
description: Build apps and plugins for rumahl — the manifest, Apps vs. Plugins, the ora.* SDK and publishing to the Store.
readTime: 7 min
updated: 2026-08-20
featured: true
---

rumahl provides a secure, isolated environment for extending the platform. This document is the starting point for building apps and plugins.

## Apps vs. Plugins

| | Apps | Plugins |
| --- | --- | --- |
| Runtime | Own Docker container | rumahl runtime sandbox |
| Language | Any | JavaScript / TypeScript |
| Best for | Services, databases, web UIs | Widgets, automations, AI tools |
| Resource limits | Container-level | Strict sandbox limits |
| Managed by | rumahl-supervisor | rumahl runtime |

**Decision guide:** need a database, background processes or your own UI? Build an **App**. Want a widget, an automation or an ORA tool? Build a **Plugin**.

## The app manifest

Every app declares itself in a `manifest.json` — name, permissions and lifecycle hooks:

```json
{
  "name": "my-app",
  "version": "1.0.0",
  "permissions": ["AppStorageRead", "AppStorageWrite"],
  "lifecycle_hooks": {
    "hooks": [{ "event": "on_system_event", "filter": "security.*" }]
  }
}
```

The reference example is the **Notes app** (`apps/examples/apps/rumahl-notes`) — it demonstrates app storage, health checks and app token auth.

## The ora.* SDK surface

| Module | Purpose |
| --- | --- |
| `ora.notifications` | Send user notifications |
| `ora.files` | List, upload, move, restore files |
| `ora.storage` | App-scoped key-value storage |
| `ora.clipboard` | Clipboard history, pin, clear |
| `ora.permissions` | Runtime permission requests |
| `ora.jobs` | Create and track system jobs |
| `ora.secrets` | App-scoped credential vault |
| `ora.users` / `ora.devices` | User and device information |
| `ora.home` | Automation control |
| `ora.system.events` | Subscribe to system events |

```js
import { rumahlClient } from "rumahl-sdk";

const ora = rumahlClient({ baseUrl: "http://localhost:8126" });
ora.setAppId("my-app");

await ora.notifications.send({ title: "Backup done", message: "All good" });
const { files } = await ora.files.list({ folderId: null });
```

## Security & permissions

- Every SDK call is permission-checked at the API gateway — before your code runs
- Request permissions at runtime with `ora.permissions.request(...)` — the user sees an allow/deny dialog
- Store credentials in the secrets vault, never in the bundle or in logs
- Destructive operations require explicit user confirmation

## Publishing to the Store

1. Register as a developer in the developer dashboard
2. Submit your app — the review checks safety, privacy, content and quality
3. Answer the review; rejections are reasoned and appealable within 14 days
4. Keep your app maintained — updates and security patches are expected

> **Tip:** the full rules live in the Developer Agreement, Review Guidelines and Content Policy under /legal/app-store.


## Further Developer Resources

- **[rumahl Developers Portal](/docs/guides/rumahl-developers):** Organizations, app registration, store verification, and release channels.
- **[Developer REST API](/docs/guides/developer-api):** Complete endpoint documentation for app and release management.
- **[OAuth 2.0 & rumahl Account](/docs/guides/oauth-identity):** Secure user sign-in with Single Sign-On and PKCE.
- **[SDKs & CI/CD Integration](/docs/guides/sdks-integration):** Libraries for TypeScript and Python plus GitHub Actions templates.
