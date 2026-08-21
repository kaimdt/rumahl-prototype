# Mock / Stub / Fake / Dummy / Platzhalter Analyse – rumahl Monorepo

> Erstellt: 2026-05-01  
> Auflistung aller Stellen im Projekt, die keine echte Implementierung haben  
> **Ziel:** Identifikation aller Stellen, an denen echte Implementierungen nachgezogen werden müssen

---

## Inhalt

1. [Komplett als Stub markierte Microservices](#1-komplett-als-stub-markierte-microservices)
2. [Microservices mit kaputten/ersetzten Kernmodulen](#2-microservices-mit-kaputtenersetzten-kernmodulen)
3. [Microservices mit nur Health-Endpoint + `not_implemented`-Stubs](#3-microservices-mit-nur-health-endpoint--not_implemented-stubs)
4. [rumahl-home: Proxy-Stubs (leiten an nicht-existente Microservices weiter)](#4-rumahl-home-proxy-stubs)
5. [rumahl-home: Stub-App-Store-Operationen](#5-rumahl-home-stub-app-store-operationen)
6. [rumahl-home: Hardcoded Fallback-Daten](#6-rumahl-home-hardcoded-fallback-daten)
7. [Frontend: Hardcodierte Mock-Dokumentation](#7-frontend-hardcodierte-mock-dokumentation)
8. [Frontend: Hardcodierte Admin-Endpoint-Liste](#8-frontend-hardcodierte-admin-endpoint-liste)
9. [rumahl-assist: Platzhalter & TODOs](#9-rumahl-assist-platzhalter--todos)
10. [Sonstige Platzhalter in Microservices](#10-sonstige-platzhalter-in-microservices)
11. [Zusammenfassung offener Baustellen](#11-zusammenfassung-offener-baustellen)

---

## 1. Komplett als Stub markierte Microservices

Diese Services sind explizit als "stub" deklariert und geben nur Dummy-Daten zurück.

### 1.1 rumahl-resource-manager

**Datei:** `rumahl-os/backend/services/rumahl-resource-manager/src/main.rs`

```rust
// rumahl Resource Manager - minimal compiling stub.
// Original implementation preserved as src/main.rs.broken.
```

| Änderungsbedarf | Endpoint | Aktuelles Verhalten |
|----------------|----------|---------------------|
| 🔴 `list_containers()` | `GET /api/resources/containers` | Gibt leeres Array `[]` zurück |
| 🔴 `system_stats()` | `GET /api/resources/system` | Gibt `{"implementation": "stub", "container_count": 0, ...}` zurück |
| 🔴 `trigger_reallocation()` | `POST /api/resources/reallocate` | Gibt `503 SERVICE_UNAVAILABLE` zurück |
| 🔴 `allocation_history()` | `GET /api/resources/history` | Gibt leeres Array `[]` zurück |

**Aktion:** Enthält eine `.broken`-Datei mit der alten Implementierung (`main.rs.broken`). Echte Implementierung aus `main.rs.broken` wiederherstellen oder neu schreiben.

---

## 2. Microservices mit kaputten/ersetzten Kernmodulen

### 2.1 rumahl-backup

**Datei:** `rumahl-os/backend/services/rumahl-backup/src/main.rs` (70 Zeilen)

| Datei | Status |
|-------|--------|
| `main.rs` | ✅ vorhanden, aber alle Actions geben `501 NotImplemented` zurück |
| `main.rs.broken` | ⬜ Alte Version |
| `backup_engine.rs.broken` | 🔴 **kaputt** – keine funktionierende `.rs`-Datei |
| `remote_storage.rs.broken` | 🔴 **kaputt** – keine funktionierende `.rs`-Datei |
| `scheduler.rs.broken` | 🔴 **kaputt** – keine funktionierende `.rs`-Datei |

**Betroffene Endpoints (alle geben `501 NotImplemented` zurück):**

| Änderungsbedarf | Endpoint | Methode |
|----------------|----------|---------|
| 🔴 | `/api/backup/config` | GET |
| 🔴 | `/api/backup/config` | POST |
| 🔴 | `/api/backup/create` | POST |
| 🔴 | `/api/backup/list` | GET |
| 🔴 | `/api/backup/restore` | POST |
| 🔴 | `/api/backup/pre-update` | POST |

**Aktion:** Backup-Engine, Remote-Storage und Scheduler aus `.broken`-Dateien wiederherstellen oder neu implementieren.

---

## 3. Microservices mit nur Health-Endpoint + `not_implemented`-Stubs

### 3.1 rumahl-backup (siehe oben)

Alle Business-Endpoints geben `501 NotImplemented` zurück.

---

## 4. rumahl-home: Proxy-Stubs

**Datei:** `rumahl-os/backend/services/rumahl-home/src/main.rs`

Diese Endpoints leiten per HTTP-Proxy an andere Microservices weiter. Wenn der Zielservice nicht läuft, kommt `503 SERVICE_UNAVAILABLE`.

| Änderungsbedarf | Proxy | Ziel-Microservice | Default-Port | Routen |
|----------------|-------|-------------------|-------------|--------|
| 🔴 | `proxy_secrets` | rumahl-secrets | 8093 | `/api/secrets`, `/api/secrets/:id`, `/api/secrets/:id/rotate`, `/api/secrets/:id/audit` |
| 🔴 | `proxy_files` | rumahl-files | 8100 | `/api/files/`, `/api/files/upload`, `/api/files/shares`, `/api/files/quota`, `/api/files/folders`, `/api/files/:id`, `/api/files/:id/download`, `/api/files/:id/move`, `/api/files/:id/rename`, `/api/files/:id/restore`, `/api/files/:id/versions`, `/api/files/permissions`, `/api/share/:token` |
| 🔴 | `proxy_gateway` | rumahl-gateway | 8096 | `/api/gateway/email`, `/api/gateway/search`, `/api/gateway/http/get`, `/api/gateway/requests`, `/api/gateway/ai-requests` |
| 🔴 | `proxy_watchdog` | rumahl-watchdog | 8094 | `/api/watchdog/status`, `/api/watchdog/services`, `/api/watchdog/metrics`, `/api/watchdog/recovery` |
| 🔴 | `proxy_connector` | rumahl-connector | 8102 | `/api/connector/tunnels`, `/api/connector/services`, `/api/connector/pairing-tokens`, `/api/connector/blocked-ips` |
| 🔴 | `proxy_domain_validator` | rumahl-domain-validator | 8104 | `/api/domain-validator/policy/:app_id`, `/api/domain-validator/logs/:app_id`, `/api/domain-validator/validate` |
| 🔴 | `proxy_resources` | rumahl-resource-manager | 8105 | `/api/resources/containers`, `/api/resources/system`, `/api/resources/history`, `/api/resources/reallocate` |
| 🔴 | `proxy_network_monitor` | rumahl-network-monitor | 8103 | `/api/network/peers`, `/api/network/devices`, `/api/network/stats`, `/api/network/scan`, `/api/metrics`, `/api/interfaces`, `/api/mqtt/topics` |
| 🔴 | `proxy_rumahl_cloud` | rumahl-cloud | 8120 | `/api/admin/rumahl-cloud/config` |
| 🟡 | `proxy_supervisor` | rumahl-supervisor | 8097 | `/api/supervisor/system/info` (früher Stub, jetzt Proxy) |
| 🟡 | `proxy_appstore` | rumahl-appstore | 8098 | `/api/appstore/search`, `/api/appstore/apps/:app_id/settings`, `/api/appstore/permissions/grant`, `/api/appstore/settings` |
| 🟡 | `proxy_core` | rumahl-core | 8090 | `/api/core/plugins/with-stats`, `/api/core/registrations`, `/api/core/updates/check`, `/api/core/updates/history`, `/api/core/widgets` |
| 🟡 | `proxy_core_security` | rumahl-security | 8095 | `/api/core/security/events`, `/api/core/security/alerts`, `/api/core/security/resource-usage` |

**Legende:**  
🔴 = Microservice existiert, ist aber selbst ein Stub oder gibt nur leere Daten  
🟡 = Microservice existiert und hat potentiell echte Daten  
❌ = Microservice existiert nicht (Datei/Ordner fehlt)

**Aktion:** Jeden dieser Microservices auf echte Implementierung prüfen. Wenn Microservice nicht läuft → Frontend zeigt leere Tabellen/Fehler.

---

## 5. rumahl-home: Stub-App-Store-Operationen

**Datei:** `rumahl-os/backend/services/rumahl-home/src/main.rs`

Einige App-Store-Endpoints werden zwar von `proxy_appstore` weitergeleitet, aber die lokalen Fallbacks sind Dummy-Implementierungen:

| Änderungsbedarf | Funktion / Endpoint | Aktuelles Verhalten |
|----------------|--------------------|---------------------|
| 🟡 | `stub_appstore_search` (via proxy) | Sucht nur lokal – keine Remote-Store-Anbindung |
| 🟡 | `stub_appstore_unavailable` | Gibt 404/503 für settings/permissions |
| 🟡 | `stub_appstore_installed` | Listet nur lokal installierte Apps auf |

---

## 6. rumahl-home: Hardcoded Fallback-Daten

### 6.1 Embedded Fallback-Index-HTML

**Datei:** `rumahl-os/backend/services/rumahl-home/src/fallback_index.html`

Wenn kein Frontend-Build (`dist/index.html`) gefunden wird, wird diese statische HTML-Seite ausgeliefert. Enthält:
- Harten UI-Code (CSS, HTML)
- Feste Status-Anzeige (HA verbunden, Entity-Count)
- Links zu `/api/docs`, `/health`, `/api/integration/ha/configured`

**Aktion:** Keine dringende Änderung – dies ist eine bewusste Fallback-Lösung. Sollte aktualisiert werden, wenn neue Hauptfunktionen hinzukommen.

### 6.2 Hardcodierte Dashboard-Einstellungen

**Datei:** `rumahl-os/backend/services/rumahl-home/src/main.rs`  
**Funktion:** `DASHBOARD_SETTINGS` (static LazyLock)

```rust
static DASHBOARD_SETTINGS: LazyLock<RwLock<Map<String, Value>>> = LazyLock::new(|| {
    let mut m = Map::new();
    m.insert("screensaver".into(), Value::Bool(false));
    m.insert("brightness".into(), json!(100));
    m.insert("theme".into(), Value::String("auto".into()));
    m.insert("maintenance_mode".into(), Value::Bool(false));
    m.insert("maintenance_message".into(), Value::String("rumahl befindet sich im Wartungsmodus."));
    // ...
});
```

| Änderungsbedarf | Feld | Problem |
|----------------|------|---------|
| 🟢 | Alles | Wird beim Start überschrieben – kein kritisches Problem |
| 🟡 | Kein Persistenz-Mechanismus | Einstellungen leben nur im RAM, gehen bei Neustart verloren |

**Empfehlung:** Diese Einstellungen in der DB persistieren (System-Preferences).

### 6.3 In-Memory Speicher für Integration-Daten

**Datei:** `rumahl-os/backend/services/rumahl-home/src/main.rs`

Diese statischen Variablen sind In-Memory nur und gehen bei Neustart verloren:

| Variable | Typ | Problem |
|----------|-----|---------|
| `DASHBOARD_SETTINGS` | `RwLock<Map>` | Keine Persistenz |
| `COMPOSITE_SENSORS` | `RwLock<Map>` | Keine Persistenz |
| `SMART_SCENES` | `RwLock<Map>` | Keine Persistenz |
| `SCHEDULED_ACTIONS` | `RwLock<Map>` | Keine Persistenz |
| `ENTITY_WATCHDOGS` | `RwLock<Map>` | Keine Persistenz |
| `ACTIVE_EMERGENCY` | `RwLock<Option<Value>>` | Keine Persistenz |
| `NINA_WARNINGS` | `RwLock<Vec<Value>>` | Wird regelmäßig neu geladen (OK) |
| `ARS_REGIONS_CACHE` | `RwLock<Option<Vec<Value>>>` | Wird bei Start + alle 24h geladen (OK) |

**Aktion:** Kritische Daten (Scenes, Schedules, Watchdogs) in die DB migrieren.

---

## 7. Frontend: Hardcodierte Mock-Dokumentation

### 7.1 DocsPage.tsx – Statische, hartcodierte Artikel

**Datei:** `frontend/src/components/DocsPage.tsx`

Die Datei enthält **~1100 Zeilen** mit hartcodierten Dokumentations-Artikeln:

```typescript
const DOC_CATEGORIES: DocCategory[] = [
  { id: 'rumahl-overview', title: 'rumahl Plattform', ... },
  { id: 'rumahl-core', title: 'rumahl Core', ... },
  // ...
];

const DOC_ARTICLES: DocArticle[] = [
  { id: 'what-is-rumahl', title: 'Was ist rumahl?', content: '# Was ist rumahl?\n\n...' },
  { id: 'architecture', title: 'Architektur & Komponenten', ... },
  // ~30 Artikel
];
```

| Änderungsbedarf | Problem |
|----------------|---------|
| 🔴 **Dupliziert** | Es gibt `DocsPage.tsx` (Legacy, hartcodiert) UND `DocsPageNew.tsx` (lädt von `/api/documentation/`) |
| 🔴 **Veraltungsrisiko** | Änderungen in den MD-Dateien in `docs/` werden nicht automatisch übernommen |
| 🔴 **Redundanz zu embedded docs** | Gleiche Infos in `docs_embedded/` und in `public/docs/` |

**Aktion:** `DocsPage.tsx` durch `DocsPageNew.tsx` ersetzen oder die hartcodierten Artikel aus der API laden.

### 7.2 DocsPageNew.tsx – Lädt von API (besser, aber nicht überall aktiv)

**Datei:** `frontend/src/components/DocsPageNew.tsx`

Läuft Dokumentation von `/api/documentation/config` und `/api/documentation/:path`.  
Ist die empfohlene Lösung – aber Legacy `DocsPage.tsx` wird noch irgendwo verwendet.

**Aktion:** Prüfen, ob `DocsPage.tsx` noch referenziert wird → durch `DocsPageNew.tsx` ersetzen.

---

## 8. Frontend: Hardcodierte Admin-Endpoint-Liste

### 8.1 AdminPanel.tsx – Statische Endpoint-Referenzen

**Datei:** `frontend/src/components/AdminPanel.tsx` (Zeile ~9006)

```typescript
const endpoints: { label: string; path: string; description: string }[] = [
  { label: 'GraphQL', path: '/graphql', description: 'GraphQL-Playground...' },
  { label: 'GraphQL WS', path: '/graphql/ws', ... },
  { label: 'WebDAV', path: '/webdav', ... },
  { label: 'CalDAV', path: '/caldav', ... },
  { label: 'REST v2 Entities', path: '/entities', ... },
  { label: 'REST v2 Services', path: '/services', ... },
  { label: 'Batch', path: '/batch', ... },
];
```

| Änderungsbedarf | Problem |
|----------------|---------|
| 🟡 | Diese Endpoints sind nur Hardcode – könnten dynamisch aus rumahl-api-Konfiguration geladen werden |

---

## 9. rumahl-assist: Platzhalter & TODOs

### 9.1 Context-Platzhalter

**Datei:** `rumahl-os/backend/services/rumahl-assist/src/context.rs` (Zeilen 54-60)

```rust
// Get active scenes (placeholder - would need actual implementation)
// User preferences (placeholder)
// Recent activity (placeholder)
```

### 9.2 Conversation Manager – Platzhalter

**Datei:** `rumahl-os/backend/services/rumahl-assist/src/conversation_manager.rs` (Zeile 256)

```rust
// This is a placeholder - in production, we'd query the thread
```

### 9.3 LSP – Platzhalter

**Datei:** `rumahl-os/backend/services/rumahl-assist/src/lsp/mod.rs` (Zeile 614)

```rust
// For now, this is a placeholder
```

### 9.4 Prompt Engine – Platzhalter

**Datei:** `rumahl-os/backend/services/rumahl-assist/src/self_evolution/prompt_engine.rs` (Zeile 477)

```rust
// For now, return a placeholder that demonstrates the approach
```

### 9.5 Tools – Platzhalter

**Datei:** `rumahl-os/backend/services/rumahl-assist/src/self_evolution/tools.rs` (Zeile 117)

```rust
// This is a placeholder that returns the original content with diff info
```

### 9.6 Main – TODO-Implementierungen

**Datei:** `rumahl-os/backend/services/rumahl-assist/src/main.rs`

```rust
// TODO: Implement automation suggestions based on entity history (Zeile 580)
// TODO: Implement natural language automation creation (Zeile 606)
// TODO: Implement AI-generated insights (Zeile 630)
```

| Änderungsbedarf | Fundstelle | Beschreibung |
|----------------|-----------|-------------|
| 🟡 | context.rs | Scene-Erkennung, User-Preferences, Recent-Activity sind Platzhalter |
| 🟡 | conversation_manager.rs | Thread-Abfrage ist Platzhalter |
| 🟡 | prompt_engine.rs | Prompt-Evaluierung ist Platzhalter |
| 🟡 | tools.rs | Diff-Info ist Platzhalter |
| 🟡 | main.rs:580 | Automation-Suggestions nicht implementiert |
| 🟡 | main.rs:606 | NL Automation-Creation nicht implementiert |
| 🟡 | main.rs:630 | AI Insights nicht implementiert |

---

## 10. Sonstige Platzhalter in Microservices

### 10.1 rumahl-gateway – Search-API Platzhalter

**Datei:** `rumahl-os/backend/services/rumahl-gateway/src/main.rs` (Zeile 361)

```rust
// Note: This is a placeholder. In production, integrate with actual search APIs
```

| Änderungsbedarf | Beschreibung |
|----------------|-------------|
| 🟡 | Die Such-API ist ein Platzhalter – keine echte Integration mit externen Search-APIs |

### 10.2 rumahl-connector – Tunnel-Modul Platzhalter

**Datei:** `rumahl-os/backend/services/rumahl-connector/src/tunnel.rs` (Zeile 3)

```rust
//! This module is kept as a placeholder. The actual tunnel is managed
```

| Änderungsbedarf | Beschreibung |
|----------------|-------------|
| 🔴 | Tunnel ist nur ein Platzhalter – echtes Tunnel-Management fehlt |

### 10.3 rumahl-supervisor – Netzwerk-Platzhalter

**Datei:** `rumahl-os/backend/services/rumahl-supervisor/src/main.rs` (Zeile 612)

```rust
// This is a placeholder that would need to interact with system networking
```

| Änderungsbedarf | Beschreibung |
|----------------|-------------|
| 🟡 | Supervisor-Netzwerk-Interaktion ist Platzhalter |

### 10.4 rumahl-developer-app – Platzhalter-Token

**Datei:** `rumahl-os/backend/apps/system/rumahl-developer-app/src/main.rs` (Zeile 20)

```rust
const DEVELOPER_APP_TOKEN: &str = match option_env!("rumahl_DEVELOPER_APP_TOKEN") {
    Some(v) => v,
    None => "dev-token-placeholder"
};
```

| Änderungsbedarf | Beschreibung |
|----------------|-------------|
| 🟡 | Token ist `dev-token-placeholder` wenn nicht via Env-Var gesetzt – OK für Dev, aber in Production muss rumahl_DEVELOPER_APP_TOKEN gesetzt sein |

### 10.5 rumahl-security – Placeholder-Daten

**Datei:** `rumahl-os/backend/services/rumahl-security/src/main.rs` (Zeile 692)

```rust
// `available: false` so the admin UI renders a clean placeholder.
```

| Änderungsbedarf | Beschreibung |
|----------------|-------------|
| 🟡 | Security-Events/Alerts geben `available: false` zurück – bewusst, damit Frontend leeren State zeigt |

---

## 11. Zusammenfassung offener Baustellen

### 🔴 Kritisch (muss behoben werden)

| # | Bereich | Datei(en) | Problem |
|---|---------|-----------|---------|
| 1 | **rumahl-resource-manager** | `src/main.rs` | Kompletter Stub – alle 4 Endpoints |
| 2 | **rumahl-backup** | `src/main.rs` + 3 `.broken`-Dateien | Alle 6 Backup-Endpoints geben `501` – Kernmodule kaputt |
| 3 | **rumahl-connector** | `src/tunnel.rs` | Tunnel-Modul nur Platzhalter |
| 4 | **Frontend: DocsPage.tsx** vs DocsPageNew.tsx | `frontend/src/components/` | Legacy-Komponente mit hartcodierten Artikeln ist redundant |
| 5 | **In-Memory Datenverlust** | rumahl-home `main.rs` | Scenes, Schedules, Watchdogs, Settings gehen bei Neustart verloren |

### 🟡 Mittel (sollte behoben werden)

| # | Bereich | Problem |
|---|---------|---------|
| 6 | **rumahl-assist** (5 Stellen) | Context-Platzhalter, TODO-Implementierungen |
| 7 | **rumahl-gateway** | Search-API ist Platzhalter |
| 8 | **rumahl-supervisor** | Netzwerk-Interaktion ist Platzhalter |
| 9 | **rumahl-developer-app** | Platzhalter-Token (Dev only) |
| 10 | **Frontend: AdminPanel.tsx** | Hartcodierte API-Endpoint-Liste (sollte dynamisch sein) |
| 11 | **10 Proxy-Stubs** | Leiten an Microservices weiter, die oft nicht laufen → 503 |

### 🟢 Niedrig (nice-to-have)

| # | Bereich | Problem |
|---|---------|---------|
| 12 | **fallback_index.html** | Statische HTML-Seite – sollte aktualisiert werden bei neuen Hauptfunktionen |
| 13 | **rumahl-security** | `available: false` ist bewusst, aber könnte detaillierter sein |

---

## Anhang: Verwendete Suchmuster

```bash
# Stubs im Backend
grep -rn "stub" --include="*.rs" rumahl-os/

# Broken/ersetzte Dateien
find rumahl-os -name "*.broken"

# TODO/FIXME/HACK im Backend
grep -rn "TODO\|FIXME\|HACK" --include="*.rs" rumahl-os/backend/services/ | grep -v target

# Platzhalter-Kommentare
grep -rn "placeholder\|not_implemented\|unimplemented" --include="*.rs" rumahl-os/

# In-Memory statics (ohne Persistenz)
grep -rn "static.*LazyLock\|static.*RwLock" rumahl-os/backend/services/rumahl-home/src/main.rs | head -20

# Hartcodierte Daten im Frontend
grep -rn "const.*= \[$\|const DOC_\|const endpoints" frontend/src/ --include="*.tsx" --include="*.ts"
```
