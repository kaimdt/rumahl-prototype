# Admin Center Endpoint Audit

**Methodik:** statischer Abgleich ohne Dev-Server — `scripts/admin-endpoint-audit.py`
extrahiert jeden API-Pfad, den die Admin-Frontend-Dateien aufrufen
(`authFetch`/`adminFetch`/`cachedFetch`/`fetch`/`EventSource`, inkl. aufgelöster
`${CONST}`-Template-Literale) und prüft, ob der Pfad als Route im Backend
existiert — direkt in `rumahl-home` oder über einen bekannten Service-Proxy
(`rumahl-control`, `rumahl-files`, `rumahl-network-monitor`, `rumahl-secrets`,
`rumahl-appstore`, `rumahl-connector`, `rumahl-assist`, …).

## Ergebnis (Stand: aktueller Branch)

| Datei | Calls | Status |
|---|---|---|
| AdminPanel.tsx | 2 | ✅ |
| AdminPanelTabs.tsx | 8 | ✅ |
| adminTabs/ai.tsx | 21 | ✅ |
| adminTabs/core.tsx | 31 | ✅ |
| adminTabs/homeAssistant.tsx | 18 | ✅ (1 dokumentierter False-Positive) |
| adminTabs/iot.tsx | 25 | ✅ |
| adminTabs/network.tsx | 8 | ✅ |
| adminTabs/os.tsx | 14 | ✅ |
| adminTabs/services.tsx | 37 | ✅ |
| adminTabs/tools.tsx | 58 | ✅ |

**Alle ~220 aufgerufenen Admin-API-Pfade existieren als Backend-Routen.**

## Gefundener & behobener Fehler

- **`PUT /api/admin/rumahl-cloud/config`** (CloudSettingsTab in `tools.tsx`)
  — das Backend registrierte nur `get`+`post`, das Frontend sendet `PUT`
  → 405 „Method Not Allowed", die Cloud-Konfiguration konnte nicht
  gespeichert werden. **Fix:** Route um `.put(proxy_rumahl_cloud)` erweitert.

## Dokumentierte False-Positives

- `/api/admin/ha/registry/{kind}` mit `kind ∈ {entities, devices, areas}` —
  das Skript normalisiert Parameter zu `{}` und matcht nicht gegen die drei
  konkreten Routen; alle drei existieren.

## Methoden-Konsistenz (Stichprobe)

Zusätzlich geprüft wurden die expliziten `method:`-Aufrufe (96):
- `POST/PUT/DELETE` auf `rumahl-control`-Proxy, `rumahl-files`, `rumahl-secrets`,
  `rumahl-connector`-Proxies: gedeckt (Pass-through).
- `PUT /api/admin/control/mode`, `/api/themes/default`,
  `/api/admin/settings/:key`: `get+put` vorhanden.
- `DELETE /api/admin/alert`, `/api/admin/warnings/log`,
  `/api/admin/notifications`, `POST /api/admin/system/database/temp-users`:
  Methoden vorhanden.

## Grenzen

- Verifiziert wird **Existenz + Methoden-Oberfläche**, nicht:
  - Antwortformate (Handler-JSON vs. Frontend-Erwartung)
  - Laufzeitfehler (SQL, Panics, Timeouts, fehlende Dienste)
  - Auth/Permission-Checks pro Endpoint
- Diese Punkte erfordern einen laufenden Backend-Server bzw. Integrationstests.

## Vollständiger Scan (alle Frontend-Dateien)

Das Endpoint-Audit scannt automatisch **alle `.ts`/`.tsx`-Dateien** unter
`frontend/src` (Admin-Tabs, Native Apps, Widgets, Shell, Settings, Docs,
AppStore, Launcher, AI-Oberflächen …) und prüft jeden API-Pfad. Zusätzlich
werden Rocket-Macro-Routen (`#[post("/…")]`) und `*path`-Wildcard-Routen
erkannt; die Proxies zu rumahl-backup, rumahl-control, rumahl-files,
rumahl-network-monitor, rumahl-secrets, rumahl-appstore, rumahl-connector,
rumahl-assist, rumahl-watchdog, rumahl-updater und rumahl-resource-manager sind
abgebildet. **Ergebnis: alle API-Pfade der gesamten Frontend-Codebase
existieren als Backend-Routen.**

## Erweiterung: Native Apps & Widgets auditiert

Das Endpoint-Audit deckt zusätzlich alle neuen OS-Oberflächen ab:
`OsStorageApp`, `OsContainersApp`, `OsLogsApp`, `OsServicesApp`,
`OsDevicesApp`, `OsSystemApp`, `OsImagesApp`, `OsFileExplorer`,
`JobCenterPanel`, `ClipboardManager`, `PermissionRequestDialog`,
`CommandPalette`, `OsSystemShell`, `OsTerminal`, alle `Ora*`-Widgets,
Settings + Auth/Window-Kontexte. Auch hier: **alle API-Pfade existieren**.

## Antwortformat-Audit (`scripts/response-format-audit.py`)

Vergleicht die JSON-Felder, die das Frontend aus seinen TS-Interfaces
erwartet, mit den Feldern, die das Backend tatsächlich produziert
(`json!({...})`-Literale + serialisierte Struct-Felder). Geprüfte Paare:
Jobs ↔ `system_jobs`, Files/quota, Network-Devices, Device-Registry,
systemd-Services, Supervisor-Apps, Container-Resources, Media-Items,
Log-Sources.

Das Format-Audit deckt inzwischen **16 Endpoint-Paare** (zusätzlich:
JobCenter ↔ `system_jobs`, AppStore ↔ local_appstore, Maintenance ↔
update-system). **Ergebnis:** alle Frontend-Interfaces sind von den
Backend-JSON-Feldern gedeckt. Union-/Array-Felder (z. B.
`ports?: Array<string | {…}>`) und optional-Felder werden als tolerant
behandelt; Frontend-Mapping-Typen (z. B. OsImagesApp.ImageEntry) sind
dokumentiert ausgeklammert.

## Wiederholen

```bash
python3 scripts/admin-endpoint-audit.py
python3 scripts/response-format-audit.py
```
