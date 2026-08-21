# rumahl Security Scan Report

**Datum:** 2026-06-21 02:00 UTC
**Scanner:** cargo audit (RustSec DB rev 776615b) + npm audit
**Gesamte Dependencies:** 747 Rust-Crates, ~1.200 Frontend-Dependencies

---

## 1. Executive Summary

| Kategorie | Anzahl | Details |
|---|---|---|
| **Kritische CVEs** | 1 | lettre 0.11.21 (CVSS 9.1) |
| **Mittlere CVEs** | 1 | rsa 0.9.10 (CVSS 5.9) |
| **Niedrige / undefinierte CVEs** | 8 | idna + 6x rustls-webpki (versch. Instanzen) |
| **Unmaintained Crates** | 9 | dotenv, fxhash, instant, number_prefix, paste, proc-macro-error, rustls-pemfile (2x), trust-dns-proto |
| **Unsound Crates** | 1 | lru 0.12.5 |
| **Frontend Schwachstellen** | 3 | dompurify (moderate), esbuild (low, Win), js-yaml (moderate) |
| **GEPRÜFTE Crate-Dependencies** | 747 | Kein unvollständiger Scan |
| **Security-Dateien** | 34 | SECURITY.md, DATABASE_SECURITY_IMPLEMENTATION.md, 32 Migrations |

**Gesamt: 1 kritische, 1 mittlere, 8 niedrige/unbewertete Sicherheitslücken + 10 Wartungswarnungen + 3 Frontend-Lücken.**

---

## 2. Detailtabelle Rust-Backend (Vulnerabilities)

### 2.1 Kritisch

| ID | Crate | Version | Severity | Beschreibung | Fix |
|---|---|---|---|---|---|
| RUSTSEC-2026-0141 | lettre | 0.11.21 | **CRITICAL (9.1)** | TLS-Hostname-Verifikation deaktiviert bei Nutzung des Boring-TLS-Backends. On-Path-Angreifer können SMTP-Login-Daten + Nachrichten abfangen. | `cargo update -p lettre@0.11.21 --precise 0.11.22` |

### 2.2 Mittel

| ID | Crate | Version | Severity | Beschreibung | Fix |
|---|---|---|---|---|---|
| RUSTSEC-2023-0071 | rsa | 0.9.10 | **MEDIUM (5.9)** | Marvin Attack – Timing-Seitenkanal ermöglicht private-Key-Extraktion bei beobachtbarem Netzwerk-Timing. | **Kein Fix verfügbar.** Crate ist unmaintained. Migration zu `rsa` >= neuem Maintainer oder Alternative nötig. |

### 2.3 Niedrig / Unbewertet

| ID | Crate | Version | Beschreibung | Fix |
|---|---|---|---|---|
| RUSTSEC-2024-0421 | idna | 0.4.0 | Punycode-Label ohne non-ASCII Output werden akzeptiert → Privilege Escalation bei Host-Vergleichen möglich. | `cargo update -p idna@0.4.0 --precise 1.0.3` (oder `url >= 2.5.4`) |
| RUSTSEC-2026-0098 | rustls-webpki | 0.101.7, 0.102.8 | Name-Constraints für URI-Namen wurden fälschlich akzeptiert. | Upgrade via `rustls` (transitiv) |
| RUSTSEC-2026-0099 | rustls-webpki | 0.101.7, 0.102.8 | Wildcard-Zertifikate umgingen Name-Constraints. | Upgrade via `rustls` (transitiv) |
| RUSTSEC-2026-0104 | rustls-webpki | 0.101.7, 0.102.8 | Reachable Panic in CRL-Parsing (DoS). | Upgrade via `rustls` (transitiv) |
| RUSTSEC-2026-0049 | rustls-webpki | 0.102.8 | CRLs wurden bei mehreren DistributionPoints nicht korrekt ausgewertet. | Upgrade via `rustls` (transitiv) |

---

## 3. Wartungswarnungen (Unmaintained Crates)

| Crate | Version | Empfohlene Migration |
|---|---|---|
| dotenv | 0.15.0 | → [dotenvy](https://crates.io/crates/dotenvy) |
| fxhash | 0.2.1 | → [rustc-hash](https://github.com/rust-lang/rustc-hash) |
| instant | 0.1.13 | → [web-time](https://crates.io/crates/web-time) |
| number_prefix | 0.4.0 | → [unit-prefix](https://crates.io/crates/unit-prefix) |
| paste | 1.0.15 | → [pastey](https://crates.io/crates/pastey) oder [with_builtin_macros](https://crates.io/crates/with_builtin_macros) |
| proc-macro-error | 1.0.4 | → [manyhow](https://crates.io/crates/manyhow) |
| rustls-pemfile | 1.0.4 + 2.2.0 | → Direkt `rustls-pki-types` PEM-API nutzen (seit 1.9.0) |
| trust-dns-proto | 0.23.2 | → [hickory-proto](https://crates.io/crates/hickory-proto) (Rebrand) |

### Unsound-Warnung

| Crate | Version | Problem | Fix |
|---|---|---|---|
| lru | 0.12.5 | `IterMut` verletzt Stacked Borrows → Memory Corruption möglich | `cargo update -p lru@0.12.5 --precise 0.16.3` |

---

## 4. Konkrete Fix-Empfehlung

### Ausführbare `cargo update` Befehle:

```bash
# Im rumahl-os/backend Verzeichnis ausführen:

# KRITISCH: lettre TLS-Bug (CVSS 9.1)
cargo update -p lettre --precise 0.11.22

# idna: Punycode-Bypass (CVE-2024-12224)
cargo update -p idna --precise 1.0.3

# rustls-webpki: alle 3 advisories (0.101.x und 0.102.x)
# Das Crate wird transitiv über rustls/tokio-rustls hereingezogen.
# Ein Update des rustls-Abhängigkeitsbaums ist nötig:
cargo update -p rustls-webpki

# Unsound: lru IterMut
cargo update -p lru --precise 0.16.3
```

**Wichtig:** Das `rsa`-Crate (0.9.10, Marvin Attack) hat **keinen verfügbaren Patch**. Es muss durch ein maintained Crate ersetzt oder aus dem Dependency-Tree entfernt werden. Prüfung in `Cargo.lock` und den direkten Abhängigkeiten (z.B. soziales via `cargo tree -i rsa`) ist nötig.

### Unmaintained-Crates migrieren (mittelfristig):
Nicht blockierend, aber empfohlen. Die Crates sind funktional, erhalten aber keine Sicherheitsupdates mehr. Besonders kritisch: `dotenv` (Produktion?), `trust-dns-proto` (DNS-Sicherheit), `rustls-pemfile` (TLS-Zertifikats-Parsing).

---

## 5. Frontend-Status (npm audit)

| Package | Severity | Vulns | Beschreibung | Fix |
|---|---|---|---|---|
| dompurify | moderate | 7 Varianten | XSS via IN_PLACE-Mode, Hook-Pollution, Shadow-DOM-Bypass u.a. | `npm audit fix` |
| esbuild | low | 1 | Arbitrary file read auf Windows. **Nicht relevant auf Linux.** | `npm audit fix` |
| js-yaml | moderate | 1 | Quadratic-Complexity DoS via merge key aliases | `npm audit fix` |

**Ergebnis:** 3 Vulnerabilities (1 low, 2 moderate). Alle fixbar via `npm audit fix` im `frontend/` Verzeichnis.

---

## 6. Fazit

### Dringlichkeit der Fixes

| Priorität | Maßnahme | Wirkung |
|---|---|---|
| **SOFORT** | `cargo update -p lettre --precise 0.11.22` | Behebt kritischen TLS-MITM-Angriff (CVSS 9.1) |
| **HOCH** | `cargo update -p rustls-webpki` | Behebt 6 Sicherheitslücken im Zertifikats-Parsing (Name Constraints, CRL, Panic-DoS) |
| **HOCH** | `npm audit fix` im `frontend/` | Behebt 3 Frontend-Lücken (XSS, DoS) |
| **MITTEL** | `cargo update -p idna --precise 1.0.3` | Behebt Punycode-Privilege-Escalation |
| **NIEDRIG** | `cargo update -p lru --precise 0.16.3` | Behebt unsound Memory-Corruption (theoretisch) |
| **NIEDRIG** | `cargo update -p rsa` (oder Ersatz) | Marvin Attack – **kein Patch verfügbar**, nur Migration |
| **NIEDRIG** | Unmaintained-Crates migrieren | 9 Crates ohne Maintainer – mittelfristig adressieren |

**Fazit:** Das Projekt hat 1 kritische, 1 mittlere und 8 niedrige/unbewertete Rust-Schwachstellen sowie 3 moderate/low Frontend-Lücken. Der kritische `lettre`-Bug (TLS-Bypass) sollte **sofort** gepatched werden, ebenso die `rustls-webpki`-Lücken und der Frontend-Fix. Die `rsa` Marvin Attack ist nicht direkt patchbar und erfordert eine Dependency-Prüfung. Die unmaintained Crates sind ein mittelfristiges Wartungsrisiko.

---

*Report generated by Hermes Agent cron scan on 2026-06-21*
