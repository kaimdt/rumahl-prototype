---
title: rumahl Developers Portal
description: The developer portal, organizations, teams, app registration, verification, and phased rollouts in the rumahl ecosystem.
readTime: 8 min
updated: 2026-09-05
featured: true
category: develop
---

The **rumahl Developers Portal** is the central control center for developers, software studios, and enterprises delivering applications, extensions, or cloud services to the rumahl ecosystem. Here you manage organizations, register apps, configure OAuth clients, monitor releases, and review analytics.

## Overview: The Developer Portal

The Developer Portal is accessible through a web console and programmatically via the Developer REST API.

| Component | URL / Access | Purpose |
| --- | --- | --- |
| Developer Console | `https://developers.rumahl.com` | Web dashboard for apps, keys, team management, and releases |
| Local Instance | `http://localhost:8126/developers` | Local development console on self-hosted instances |
| Developer API | `https://api.rumahl.com/api/v1/developer` | REST interface for CI/CD automation and scripts |
| Identity Service | `https://account.rumahl.com/oauth` | rumahl Account Single Sign-On (SSO) and consent management |

> **Note:** Access to rumahl Developers requires a verified **rumahl Account** with two-factor authentication enabled (Passkeys or TOTP).

## Organizations & Team Roles

Projects inside rumahl Developers are structured around **Organizations**. An organization groups apps, API keys, webhooks, and billing settings for an engineering team.

### Role Matrix

| Role | Permissions | Use Case |
| --- | --- | --- |
| **Owner** | Full access, delete organization, transfer ownership, billing | Founders, executive leads |
| **Admin** | Invite/remove members, assign roles, manage API keys, approve releases | Team leads, DevOps leads |
| **Developer** | Create apps, upload binaries and releases, configure webhooks | Software engineers |
| **Viewer** | Read-only access to metrics, release statuses, and audit logs | Project managers, stakeholders |

### Team Management & Audit Log

Every critical operation (e.g. role updates, secret generation, store releases) is recorded immutably in the organization's **Audit Log**:

- Timestamp and IP address of the actor
- Executed action (e.g. `api_key.create`, `release.rollout_started`)
- Target object and outcome

## Registering Apps & Products

Every application in the rumahl ecosystem requires a registered record in the Developer Portal.

1. Navigate to **Apps & Products** in the portal.
2. Click **Create New App** and provide a unique reverse-domain identifier (e.g. `com.example.smarthome`).
3. Select the app architecture:
   - **Containerized App:** Standalone Docker container managed by rumahl-supervisor.
   - **Sandbox Plugin:** Lightweight plugin for the JavaScript/TypeScript runtime sandbox.
   - **Cloud Service:** External web service integrated with rumahl APIs.
4. Once created, you immediately receive:
   - **Client ID:** Public identifier for OAuth flows.
   - **Client Secret:** Confidential key for server-to-server calls.
   - **Redirect URIs:** Allowed callback URLs (HTTPS or custom schemes like `rumahl-app://callback`).

### Manifest & Permissions

In the **Permissions** tab, declare all required system scopes:

```json
{
  "app_id": "com.example.smarthome",
  "name": "SmartHome Pro",
  "version": "1.2.0",
  "requested_scopes": [
    "rumahl.devices.read",
    "rumahl.devices.control",
    "rumahl.notifications.send"
  ],
  "oauth": {
    "redirect_uris": [
      "https://smarthome.example.com/api/auth/callback"
    ]
  }
}
```

## App Review & Verification

Apps intended for distribution in the public **rumahl App Store** undergo a structured verification pipeline.

### Review Pipeline

1. **Automated Validation:**
   - Schema and manifest syntax verification
   - Static security analysis (vulnerable dependencies, hardcoded secrets)
   - Runtime sandbox constraint checks
2. **Manual Security & Policy Review:**
   - Privacy policy and data minimization compliance
   - Functional verification of requested permission scopes
   - Completeness of imprint, legal notices, and support channels
3. **Status Workflow:**
   - `draft`: App under construction
   - `in_review`: Currently being tested by the rumahl security team
   - `approved`: Approved for public Store availability
   - `rejected`: Action needed (detailed feedback provided in dashboard)

## Release Channels & Phased Rollouts

rumahl provides multi-stage release channels to deliver updates with minimal operational risk.

| Channel | Audience | Purpose |
| --- | --- | --- |
| **Alpha** | Internal testers & developers | Rapid iterations, nightly builds |
| **Beta** | Public early-adopters (opt-in) | Edge-case validation and feedback |
| **Staging** | Production-like test environments | Final qualification before production |
| **Production** | All general users | Stable release |

### Phased Rollouts

For production releases, you can gradually distribute binaries:

- **10%:** Early canary stage monitoring crash and error telemetry
- **25% & 50%:** Broader distribution across diverse hardware profiles
- **100%:** General availability across all installations

If unexpected anomalies or crashes are detected during rollout, the release can be halted instantly via UI or REST call (`POST /releases/:id/halt`).

## Developer Security Guidelines

All developers registered on the platform must adhere to fundamental security standards:

- **Mandatory 2FA / Passkeys:** Required on all accounts with write or publication permissions.
- **Client Secret Protection:** Client secrets must never be embedded in client-side code (mobile apps, SPAs). Use PKCE instead.
- **Scheduled Secret Rotation:** Rotate API keys and secrets at least every 180 days. The portal provides zero-downtime dual-key rotation windows.
