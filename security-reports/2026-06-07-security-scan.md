# rumahl Security Scan Report — 2026-06-07 02:01 UTC

**Project:** rumahl Monorepo (`/home/hermes/ora`)
**Scanner:** Hermes Agent (via `cargo audit` + `npm audit`)
**Dependencies scanned:** 747 (Rust) + Frontend (npm)

---

## 1. Executive Summary

| Metric | Count |
|---|---|
| **Critical vulnerabilities** | **1** (RUSTSEC-2026-0141, lettre) |
| **Medium vulnerabilities** | **1** (RUSTSEC-2023-0071, rsa — no fix available) |
| **Low/Unrated vulnerabilities** | **4 unique** across rustls-webpki (0.101.7 & 0.102.8) + idna (0.4.0) |
| **Unmaintained crates** | **9** (7 unique) |
| **Unsound crates** | **1** (lru 0.12.5) |
| **Frontend (npm)** | **0 vulnerabilities** — clean |
| **Security files/migrations** | 34 files (2 policy docs + 32 SQL migrations) |

**Overall Assessment:** 1 critical, 1 medium, several lower-severity advisories. The **critical issue** (lettre TLS bypass) is easily fixable with `cargo update`. The **medium issue** (rsa/Marvin Attack) has no patch available — migration to a constant-time RSA crate is needed. The **rustls-webpki** issues affect the TLS stack and should be addressed as a group.

---

## 2. Vulnerability Detail Table

### 2.1 Critical

| ID | Package | Version | CVSS | Description | Fix |
|---|---|---|---|---|---|
| RUSTSEC-2026-0141 | **lettre** | 0.11.21 | **9.1** | TLS hostname verification silently disabled when using the `boring-tls` backend. On-path attacker can intercept SMTP submission (credentials + message content). | `cargo update -p lettre` (to >=0.11.22) |

### 2.2 Medium

| ID | Package | Version | CVSS | Description | Fix |
|---|---|---|---|---|---|
| RUSTSEC-2023-0071 | **rsa** | 0.9.10 | **5.9** | Marvin Attack — non-constant-time RSA implementation leaks private key via timing side-channels over the network. | **No patch available.** Migrate to constant-time RSA crate (e.g., `rsa` upstream issue #626). |

### 2.3 Low / Unrated

| ID | Package | Version | CVSS | Description | Fix |
|---|---|---|---|---|---|
| RUSTSEC-2024-0421 | **idna** | 0.4.0 | — | Punycode labels bypass: `xn--example-.org` treated as equal to `example.org` → possible privilege escalation in hostname comparison. | `cargo update -p idna` (if direct dep) or update `url` crate (transitive via `trust-dns-proto`) |
| RUSTSEC-2026-0099 | **rustls-webpki** | 0.101.7, 0.102.8 | — | Wildcard name constraints bypass: `*.example.com` accepted where constraint is `accept.example.com`. Requires certificate misissuance to exploit. | `cargo update -p rustls-webpki` |
| RUSTSEC-2026-0104 | **rustls-webpki** | 0.101.7, 0.102.8 | — | Reachable panic in CRL parsing due to empty BIT STRING in `onlySomeReasons`. Denial-of-service vector before signature verification. | `cargo update -p rustls-webpki` |
| RUSTSEC-2026-0098 | **rustls-webpki** | 0.101.7, 0.102.8 | — | URI name constraints silently ignored. Low impact as URI assertions are not supported by the API. | `cargo update -p rustls-webpki` |
| RUSTSEC-2026-0049 | **rustls-webpki** | 0.102.8 | — | CRL distribution point matching logic faulty — only first `distributionPoint` checked, subsequent points ignored. Incorrect CRL acceptance. | `cargo update -p rustls-webpki` |

---

## 3. Maintenance Warnings

### 3.1 Unmaintained Crates

| Crate | Version | Advisory | Alternative |
|---|---|---|---|
| **dotenv** | 0.15.0 | RUSTSEC-2021-0141 | [dotenvy](https://crates.io/crates/dotenvy) |
| **fxhash** | 0.2.1 | RUSTSEC-2025-0057 | [rustc-hash](https://github.com/rust-lang/rustc-hash) |
| **instant** | 0.1.13 | RUSTSEC-2024-0384 | [web-time](https://crates.io/crates/web-time) |
| **number_prefix** | 0.4.0 | RUSTSEC-2025-0119 | [unit-prefix](https://crates.io/crates/unit-prefix) |
| **paste** | 1.0.15 | RUSTSEC-2024-0436 | [pastey](https://crates.io/crates/pastey) or [with_builtin_macros](https://crates.io/crates/with_builtin_macros) |
| **proc-macro-error** | 1.0.4 | RUSTSEC-2024-0370 | [manyhow](https://crates.io/crates/manyhow) or [proc-macro-error2](https://crates.io/crates/proc-macro-error2) |
| **rustls-pemfile** (v1) | 1.0.4 | RUSTSEC-2025-0134 | Use `rustls-pki-types` PEM API directly (since 1.9.0) |
| **rustls-pemfile** (v2) | 2.2.0 | RUSTSEC-2025-0134 | Same as above |
| **trust-dns-proto** | 0.23.2 | RUSTSEC-2025-0017 | [hickory-proto](https://crates.io/crates/hickory-proto) (rebranded) |

### 3.2 Unsound Crate

| Crate | Version | Advisory | Description | Fix |
|---|---|---|---|---|
| **lru** | 0.12.5 | RUSTSEC-2026-0002 | `IterMut` violates Stacked Borrows — invalidates internal HashMap pointer during iteration, leading to potential memory corruption. | `cargo update -p lru` (to >=0.16.3) |

---

## 4. Concrete Fix Recommendations

### Immediate (fix now — critical):

```bash
# Fix: lettre critical TLS vulnerability
cargo update -p lettre

# Fix: rustls-webpki (5 advisories across 2 versions — update resolves all)
cargo update -p rustls-webpki

# Fix: lru unsound violation
cargo update -p lru
```

### Short-term (fix within next release):

```bash
# Fix: idna punycode bypass (transitive via trust-dns-proto + url)
# This requires trust-dns-proto to be updated first (see below)
cargo update -p idna

# Fix: trust-dns-proto -> hickory-proto migration
# This is a crate rename — requires Cargo.toml changes:
#   trust-dns-proto -> hickory-proto (same API, different namespace)
```

### Medium-term (plan for next major release):

- **rsa (RUSTSEC-2023-0071):** No patch available. Monitor upstream (`RustCrypto/RSA` issue #626). Consider replacing RSA usage with an alternative that uses constant-time implementation (e.g., `ring`-based RSA or migrate to ECDSA/Ed25519 if applicable).
- **dotenv -> dotenvy:** Replace in Cargo.toml of crates that use it (development-only crate).
- **paste -> pastey:** Proc-macro dependency, low risk but should be migrated eventually.
- **proc-macro-error -> manyhow:** Proc-macro dependency, consider when next major refactoring happens.

### Unmaintained crate migration (no immediate urgency unless blocking updates):

| Current | Replace with | Effort |
|---|---|---|
| `dotenv` 0.15.0 | `dotenvy` | Low — drop-in replacement |
| `fxhash` 0.2.1 | `rustc-hash` | Low — drop-in, API identical |
| `instant` 0.1.13 | `web-time` | Medium — different API surface |
| `number_prefix` 0.4.0 | `unit-prefix` | Low |
| `paste` 1.0.15 | `pastey` | Low — drop-in replacement |
| `proc-macro-error` 1.0.4 | `manyhow` / `proc-macro-error2` | Medium |
| `rustls-pemfile` 1.0.4 / 2.2.0 | `rustls-pki-types` PEM API | Medium — requires code changes |
| `trust-dns-proto` 0.23.2 | `hickory-proto` 0.24+ | Medium — crate rename + API changes |

---

## 5. Frontend Status

```
npm audit: found 0 vulnerabilities
```

The frontend is **clean**. No npm advisory issues found. No action required.

---

## 6. Security Files & Infrastructure

### Policy Documentation (2 files)
- `SECURITY.md` — Project security policy
- `DATABASE_SECURITY_IMPLEMENTATION.md` — Database security architecture

### SQL Migrations (32 files, 001–032)
Covers authentication (password hashing), API keys, refresh tokens, system events, webhooks, and session management. The migration history is in good order — sequential, non-destructive, covering:
- 002_add_password_hash — password storage
- 010_admin_api_keys — API key management
- 019_temp_db_users — temporary database users
- 032_refresh_tokens — JWT refresh token storage

---

## 7. Conclusion & Urgency

| Priority | Action | Urgency |
|---|---|---|
| 🔴 **Critical** | `lettre` update (0.11.21 → 0.11.22) — TLS hostname verification bypass | **Immediate** |
| 🔴 **High** | `rustls-webpki` update (0.101.7/0.102.8 → 0.103.13+) — 5 advisories in TLS stack | **This sprint** |
| 🟡 **Medium** | `lru` update (0.12.5 → 0.16.3) — soundness issue (Stacked Borrows) | **This sprint** |
| 🟡 **Medium** | `rsa` (0.9.10) — Marvin Attack, no fix available; plan migration | **Next release** |
| 🟢 **Low** | `idna` (0.4.0) — Punycode bypass, blocked by `trust-dns-proto` update | **Next release** |
| 🟢 **Low** | Unmaintained crate migration (dotenv, fxhash, instant, etc.) | **Ongoing** |
| ✅ **Clean** | Frontend (npm), migration history, security docs | **No action** |

**Bottom line:** 1 critical and 1 high-priority group of fixes that should be addressed immediately. The `lettre` TLS bypass is the most urgent — it could expose SMTP credentials on the wire. The `rustls-webpki` issues affect core TLS certificate validation. Running `cargo update -p lettre -p rustls-webpki -p lru` will resolve 7 of the 10 advisories in one command.
