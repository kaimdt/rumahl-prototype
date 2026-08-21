---
title: Security Model
description: Defense in depth — how rumahl protects your home: authentication, network security, encryption, threat detection and platform hardening.
readTime: 6 min
updated: 2026-08-20
featured: true
---

rumahl implements a comprehensive, defense-in-depth security model. Every layer has one job: making sure that a compromise at one level does not reach the next.

## The five security layers

| Layer | Mechanisms |
| --- | --- |
| 1. Authentication & authorization | JWT tokens, API keys, PIN auth, RBAC |
| 2. Network security | Domain whitelist, IP access control, sandbox |
| 3. Data protection | AES-256-GCM encryption, hash-chained audit logs |
| 4. Threat detection & response | Intrusion detection, auto-lockdown, alerts |
| 5. Platform security | AppArmor, Docker isolation, read-only filesystem |

## Core security services

| Service | Port | Role |
| --- | --- | --- |
| rumahl-security | 8095 | Threat detection, intrusion prevention, lockdown |
| rumahl-secrets | 8093 | Encrypted secrets storage (API keys, passwords, tokens) |
| rumahl-watchdog | 8094 | Health monitoring, failover, circuit breaker |

## Data protection

- **Encryption at rest:** AES-256-GCM for secrets and sensitive data
- **Audit logging:** hash-chained logs — tampering becomes visible immediately
- **Local-first:** by default, no data leaves your device at all
- **Opt-in telemetry:** diagnostics and cloud features require explicit consent

## Permissions as the trust boundary

The permission system is the heart of the security model:

- Every API call is checked against an explicit permission at the gateway
- Apps request permissions at registration **and** at runtime (allow/deny dialogs)
- Destructive operations require explicit, typed confirmation — never autonomous
- AppArmor and the runtime sandbox limit what a compromised app can do

## Platform hardening

- Buildroot LTS Linux with a read-only SquashFS root filesystem
- ZRAM for `/tmp` and `/var` — reduced wear and attack surface
- RAUC A/B updates — atomic updates with automatic rollback
- AppArmor mandatory access control for all services
- The security monitor surfaces alerts, resource usage and anomalies

> **Tip:** keep your system updated — security patches ship through the update center with a stable/beta/alpha channel choice.
