# rumahl Security Scan Report

**Datum:** 2026-06-14 02:00 UTC  
**Scan-Tool:** oryx-security-scan.sh (cargo audit + npm audit)  
**Repository:** /home/hermes/ora  

---

## 1. Executive Summary

| Bereich | Kritisch | Hoch | Mittel | Niedrig/Kein CVSS | Warnings |
|---------|----------|------|--------|-------------------|----------|
| Rust Backend (cargo audit) | **1** | – | **1** | **5** unique advisories (8 Einträge, da 2 Crates in 2 Versionen betroffen) | **10** (9 unmaintained + 1 unsound) |
| Frontend (npm audit) | – | **3** | – | – | – |
| **Gesamt** | **1** | **3** | **1** | **5** | **10** |

- **747** Rust-Dependencies gescannt
- **1 CRITICAL** Schwachstelle: `lettre` TLS-Hostname-Verification deaktiviert (CVSS 9.1)
- **3 HIGH** Schwachstellen: Frontend via `esbuild` (RCE + Arbitrary File Read)
- **1 MEDIUM**: `rsa` Marvin Attack (CVSS 5.9, kein Patch verfügbar)
- **6 weitere** Schwachstellen ohne CVSS, aber reales Risiko (rustls-webpki: Name Constraints Bypass, CRL Panic)
- **10 Wartungswarnungen**: 9 unmaintained Crates + 1 unsound

---

## 2. Detailtabelle Schwachstellen

### Rust Backend

| CVE/RUSTSEC-ID | Package | Version | Schweregrad | Beschreibung | Fix |
|---|---|---|---|---|---|
| RUSTSEC-2026-0141 | **lettre** | 0.11.21 | **CRITICAL (9.1)** | TLS-Hostname-Verification bei Boring-TLS-Backend deaktiviert → MITM ermöglicht Kompromittierung von SMTP-Credentials | `cargo update -p lettre@0.11.21 --precise 0.11.22` |
| RUSTSEC-2023-0071 / CVE-2023-49092 | **rsa** | 0.9.10 | MEDIUM (5.9) | Marvin Attack – Timing-Seitenkanal ermöglicht Key Recovery | **Kein Patch.** Migration zu constant-time Implementierung nötig |
| RUSTSEC-2024-0421 / CVE-2024-12224 | **idna** | 0.4.0 | Kein CVSS (privilege-escalation) | Punycode-Spoofing: Gleiche Domain-Keys für verschiedene Eingaben | `trust-dns-proto` → `hickory-proto` migrieren (Blockade) |
| RUSTSEC-2026-0098 | **rustls-webpki** | 0.101.7 / 0.102.8 | Kein CVSS | URI-Name-Constraints ignoriert → Zertifikatsbeschränkungen umgehbar | `>=0.103.12` nötig (blockiert durch rustls v0.21/v0.22) |
| RUSTSEC-2026-0099 | **rustls-webpki** | 0.101.7 / 0.102.8 | Kein CVSS | Wildcard-Name-Constraints bypass | `>=0.103.12` nötig |
| RUSTSEC-2026-0104 | **rustls-webpki** | 0.101.7 / 0.102.8 | Kein CVSS (DoS) | Reachable Panic bei CRL-Parsing | `>=0.103.13` nötig |
| RUSTSEC-2026-0049 | **rustls-webpki** | 0.102.8 | Kein CVSS (privilege-escalation) | CRLs werden nicht autoritativ ausgewertet – fehlerhaftes Distribution-Point-Matching | `>=0.103.10` nötig |

### Frontend

| Advisory | Package | Version | Schweregrad | Beschreibung | Fix |
|---|---|---|---|---|---|
| GHSA-gv7w-rqvm-qjhr | **esbuild** (via vite) | 0.17.0-0.28.0 | HIGH | Fehlende Binär-Integritätsprüfung → RCE über NPM_CONFIG_REGISTRY | `npm audit fix --force` → vite@8.0.16 (**breaking change**) |
| GHSA-g7r4-m6w7-qqqr | **esbuild** (via vite) | 0.17.0-0.28.0 | HIGH | Arbitrary File Read auf Windows Dev Server | s.o. |

---

## 3. Wartungswarnungen (Unmaintained Crates)

| RUSTSEC | Crate | Version | Ersatz | Betroffene Services |
|---|---|---|---|---|
| RUSTSEC-2021-0141 | **dotenv** ⚠️ | 0.15.0 | `dotenvy` | **17 Services** (rumahl-api, assist, backup, connector, control, core, domain-validator, files, gateway, home, intelligence, network-monitor, nginx, resource-manager, secrets, security, watchdog) |
| RUSTSEC-2025-0057 | **fxhash** | 0.2.1 | `rustc-hash` | Transitiv |
| RUSTSEC-2024-0384 | **instant** | 0.1.13 | `web-time` | Transitiv |
| RUSTSEC-2025-0119 | **number_prefix** | 0.4.0 | `unit-prefix` | Transitiv |
| RUSTSEC-2024-0436 | **paste** | 1.0.15 | `pastey` / `with_builtin_macros` | Transitiv |
| RUSTSEC-2024-0370 | **proc-macro-error** | 1.0.4 | `manyhow` | Transitiv (syn 1.x) |
| RUSTSEC-2025-0134 | **rustls-pemfile** | 1.0.4 / 2.2.0 | `rustls-pki-types` (PemObject) | Transitiv |
| RUSTSEC-2025-0017 | **trust-dns-proto** 🚩 | 0.23.2 | `hickory-proto` (Rebrand) | **rumahl-connector** + rumahl-domain-validator |

### Unsound

| RUSTSEC | Crate | Version | Problem | Fix |
|---|---|---|---|---|
| RUSTSEC-2026-0002 | **lru** | 0.12.5 | `IterMut` verletzt Stacked Borrows → Memory Corruption | `>=0.16.3` (via `cargo update -p lru@0.12.5 --precise 0.16.3`) |

---

## 4. Konkrete Fix-Empfehlungen

### Sofort fixbar (via cargo update / npm):

```bash
# [KRITISCH] lettre TLS-Bug – SOFORT AUSFÜHREN, 30 Sekunden
cd rumahl-os/backend && cargo update -p lettre@0.11.21 --precise 0.11.22
```

### Mittelfristig (benötigt Dependency-Upgrades in Cargo.toml):

```bash
# rustls-webpki 0.101.7 → requwest/rustls Upgrade:
#   reqwest v0.11.x → v0.12.x (nutzt rustls v0.23, das rustls-webpki 0.103.x verwendet)
#   Betrifft: rumahl-api, rumahl-appstore, rumahl-assist, rumahl-cli, rumahl-connector, 
#             rumahl-control, rumahl-core, rumahl-dev-bridge, rumahl-dev-watch, 
#             rumahl-developer-app, rumahl-gateway, rumahl-home, rumahl-installer,
#             rumahl-intelligence, rumahl-security, rumahl-shared + Abhängige

# rustls-webpki 0.102.8 → rumqttc Upgrade:
#   rumqttc v0.24.0 → v0.25+ (nutzt rustls v0.23, das rustls-webpki 0.103.x verwendet)
#   Betrifft: rumahl-home

# idna 0.4.0 / trust-dns → hickory Migration:
#   trust-dns-resolver v0.23 → hickory-resolver (neuere Versionen nutzen idna 1.x)
#   Betrifft: rumahl-connector, rumahl-domain-validator
```

### Kein Patch verfügbar:

- **rsa v0.9.10** (Marvin Attack) – Der Crate-Author arbeitet an constant-time Implementierung.
  - **Workaround**: Timing-Angriff nur bei Netzwerkzugriff relevant. Bei lokalem Einsatz (z.B. Signing-Tool auf nicht-kompromittiertem Host) geringeres Risiko.
  - **Alternative**: Prüfen, ob RSA überhaupt verwendet wird. Falls nur für Signing/Verification in `rumahl-sign`/`rumahl-verify`, ggf. auf Ed25519 migrieren.

### Frontend:

```bash
cd frontend
# Aktuell: vite@^7.2.6 → enthält esbuild mit HIGH-Schwachstellen
# Option A: Clean fix
npm audit fix --force    # → vite@8.0.16 (breaking change, Tailwind testen!)
# Option B: Minimal fix
# Prüfen ob esbuild isoliert aktualisierbar: npm update esbuild
```

### dotenv-Migration (17 Services):

```bash
# In jedem betroffenen Cargo.toml:
#   dotenv = "0.15.0" → dotenvy = "0.15"
# Import ändern:
#   use dotenv::dotenv; → use dotenvy::dotenv;
#   use dotenv::from_filename; → use dotenvy::from_filename;
```

---

## 5. Frontend-Status (npm audit)

- **Geprüft:** `/home/hermes/ora/frontend`
- **Aktuelle Versionen:** vite `^7.2.6`, @tailwindcss/vite `^4.1.11`
- **3 HIGH** vulnerabilities via `esbuild` (0.17.0–0.28.0)
- **Fix:** `npm audit fix --force` würde auf `vite@8.0.16` upgraden (Major Upgrade, Breaking Changes möglich)
- **Empfehlung:** In separatem Branch testen, ob Tailwind und alle Plugins unter vite@8 funktionieren

---

## 6. Security-Dateien & Migrations

| Datei | Status |
|---|---|
| `SECURITY.md` | ✓ Vorhanden |
| `DATABASE_SECURITY_IMPLEMENTATION.md` | ✓ Vorhanden |
| **SQL-Migrationen (32 Stück)** | ✓ Alle vorhanden (001–032) |
| → `002_add_password_hash.sql` | Passwort-Hashing |
| → `008_pin_auth_and_page_layouts.sql` | PIN-Authentifizierung |
| → `010_admin_api_keys.sql` | API-Key-Management |
| → `019_temp_db_users.sql` | Temporäre DB-User |
| → `032_refresh_tokens.sql` | Refresh-Token (neueste Migration) |

**Sicherheitsrelevante Migrations-Prinzipien eingehalten:**
- Bestehende Migrationen wurden nicht modifiziert (nur neue hinzugefügt) ✓
- Password-Hash-Spalte vorhanden ✓
- Refresh-Token-Mechanismus implementiert ✓

---

## 7. Fazit & Dringlichkeit

### 🔴 Sofort – diese Woche (kritisch):
| Maßnahme | Aufwand | Risiko |
|---|---|---|
| `lettre` auf 0.11.22 updaten | 1 Minute | Minimal (Patch-only) |
| `lru` auf 0.16.3 updaten | 1 Minute | Minimal |
| `npm audit fix --force` im Dev-Branch testen | 1 Stunde | Breaking Change möglich |

### 🟡 Mittelfristig – nächster Sprint (hoch):
| Maßnahme | Aufwand |
|---|---|
| `dotenv` → `dotenvy` in 17 Services migrieren | 1 Tag |
| `reqwest` v0.11.x → v0.12.x (löst rustls-webpki) | 2–3 Tage |
| `rumqttc` v0.24 → v0.25+ (löst rustls-webpki) | 1 Tag |
| `trust-dns-resolver` → `hickory-resolver` (löst idna) | 1 Tag |

### 🟢 Beobachten (niedrige Priorität):
| Maßnahme | Grund |
|---|---|
| `rsa` v0.9.10 Marvin Attack | Kein Patch verfügbar; lokal nur Timing-Risiko. Monitoring des Upstream-Repositories empfohlen |
| Weitere unmaintained Crates (`fxhash`, `instant`, `number_prefix`, `paste`, `proc-macro-error`) | Alle transitiv; ersetzen sobald Upstream crates aktualisieren |

**Gesamtbewertung: 1 kritische + 3 hohe Schwachstellen – Handlungsbedarf hoch.**
Der `lettre`-Bug (CRITICAL, CVSS 9.1) sollte noch heute geschlossen werden. Die Frontend-Probleme betreffen Dev-Umgebungen, sind aber für CI/CD ebenfalls kritisch.
