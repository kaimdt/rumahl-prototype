# Security Overview

IORA implements a comprehensive, defense-in-depth security model. This section covers all security features and best practices.

## Security Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                      Security Layers                              │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ Layer 1: Authentication & Authorization                   │    │
│  │  · JWT tokens    · API keys    · PIN auth    · RBAC      │    │
│  └──────────────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ Layer 2: Network Security                                  │    │
│  │  · Domain whitelist    · IP access control    · Sandbox  │    │
│  └──────────────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ Layer 3: Data Protection                                   │    │
│  │  · AES-256-GCM encryption    · Hash-chained audit logs   │    │
│  └──────────────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ Layer 4: Threat Detection & Response                       │    │
│  │  · Intrusion detection    · Auto-lockdown    · Alerts    │    │
│  └──────────────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ Layer 5: Platform Security                                 │    │
│  │  · AppArmor    · Docker isolation    · Read-only FS      │    │
│  └──────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

## Core Security Services

| Service | Port | Role |
|---------|------|------|
| **iora-security** | 8095 | Threat detection, intrusion prevention, lockdown, PostgreSQL user management |
| **iora-secrets** | 8093 | Encrypted secrets storage (API keys, passwords, tokens) |
| **iora-watchdog** | 8094 | Health monitoring, failover, circuit breaker |
| **iora-gateway** | 8096 | Sandboxed external integrations, content validation |

## Key Security Features

### Authentication

- **JWT tokens** with configurable expiry (default 24h)
- **API keys** with granular permissions and rate limiting
- **PIN authentication** for kiosk/terminal devices
- **Role-based access control** (user, admin)

### Encryption

- **AES-256-GCM** for all stored secrets
- Unique nonce per encrypted secret
- Master key derivation from environment variable
- No secrets in logs or error messages

### Audit Logging

- **Hash-chained event logging** (blockchain-style integrity verification)
- **Append-only** – cannot be modified or deleted
- **Encrypted** with AES-256-GCM
- Stored in isolated SQLite database

### Intrusion Detection

- Threat scoring: 0-10 scale per IP address
- Automatic IP blocking at threat level ≥ 7
- Detection triggers:
  - Unauthorized database connections (+3 threat)
  - Failed authentication attempts (+2 threat)
  - SQL injection patterns (+5 threat)
  - Rate limiting violations (+1 threat)

### Auto-Lockdown

Four severity levels:
1. **Warning** – Enhanced monitoring
2. **Suspicious** – Elevated logging
3. **Confirmed** – Partial service lockdown
4. **Critical** – Full system isolation

### App & Plugin Security

- Apps run in isolated Docker containers
- Plugins run in sandboxed subprocesses (no shell, no network by default)
- Permission system with explicit user approval
- Network access controlled via domain/IP whitelists

## Security Documentation

- [Permission System](permissions.md) – Complete permission reference
- [Network Security](network.md) – Network access control and domain whitelisting
- [Encryption](encryption.md) – Encryption standards and key management
- [Threat Detection](threat-detection.md) – IDS, auto-lockdown, and response
- [Best Practices](best-practices.md) – Security hardening guide

## Reporting Security Issues

If you discover a security vulnerability in IORA, please report it responsibly:

1. **Do not** open a public GitHub issue
2. Email security details to the maintainers
3. Allow reasonable time for investigation and patching
4. Follow coordinated disclosure practices

## Security Contacts

- **GitHub Issues**: [Security-related issues](https://github.com/kaimdt/home-assistant-dashb/issues?q=label%3Asecurity)
- **Discussions**: [Security category](https://github.com/kaimdt/home-assistant-dashb/discussions/categories/security)

## Compliance

IORA's security model is designed with the following principles:
- **Least Privilege** – Apps and plugins request only needed permissions
- **Defense in Depth** – Multiple independent security layers
- **Fail-Secure** – System locks down on suspicious activity
- **Auditability** – Comprehensive, tamper-proof audit trail
- **Data Minimization** – Only essential data is collected and stored
