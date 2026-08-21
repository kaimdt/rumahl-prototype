---
title: Architecture
description: How rumahl OS is built — Rust microservices, ports, the platform principle and the security layers.
readTime: 6 min
updated: 2026-08-20
featured: true
---

rumahl OS is a Rust workspace of more than 20 crates, organised as loosely coupled microservices. Each service has a clear job — and a clear port assignment.

## Services and ports

| Service | Dev port | Prod port | Role |
| --- | --- | --- | --- |
| rumahl-home | 3001 | 8126 | Main API + dashboard (Axum, SQLite) |
| rumahl-core | 8090 | 8090 | Service discovery, plugin registry |
| rumahl-control | 8091 | 8091 | Control center, system services |
| rumahl-assist | 8092 | 8092 | AI assistant (ORA) |
| rumahl-secrets | 8093 | 8093 | Encrypted secrets storage |
| rumahl-watchdog | 8094 | 8094 | Health monitoring, failover |
| rumahl-security | 8095 | 8095 | Threat detection, lockdown |
| rumahl-supervisor | 8097 | 8097 | Docker container management |
| rumahl-appstore | 8098 | 8098 | App store |

## The platform principle

The architecture separates consistently:

- **Apps install features** — the platform ships the core
- Everything above the *permission boundary* is app territory
- Everything below belongs to the rumahl core and stays stable, tested and documented
- Third parties build apps **without knowing how rumahl implements storage, users or windows internally**

```
rumahl Apps          ← installable, permissioned, replaceable
─────────────────────────────────────────────
Window Manager / Desktop  (shell UX, session)
Files / Notifications / Jobs / Users          ← OS services & SDK
Permissions                                    ← trust boundary
rumahl Runtime (plugin sandbox, app lifecycle)
System Services (control, network, backup…)   ← microservices
Kernel / Linux
```

## Security layers

| Layer | Mechanisms |
| --- | --- |
| Authentication & authorization | JWT, API keys, PIN, RBAC |
| Network security | Domain whitelist, IP access control, sandbox |
| Data protection | AES-256-GCM encryption, hash-chained audit logs |
| Threat detection | Intrusion detection, auto-lockdown, alerts |
| Platform security | AppArmor, Docker isolation, read-only filesystem |

## The ora.* SDK

Apps access the platform through a single SDK surface: `ora.notifications`, `ora.files`, `ora.storage`, `ora.clipboard`, `ora.windows`, `ora.permissions`, `ora.jobs`, `ora.secrets`, `ora.users`, `ora.devices`, `ora.home` and `ora.system.events`. Every call is permission-checked at the API gateway.

> **Tip:** the complete endpoint reference lives in the API Reference document.
