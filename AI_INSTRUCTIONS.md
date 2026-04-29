# IORA App & Plugin Entwicklung – Anleitung für KI-Agenten

> Diese Anleitung beschreibt, wie KI-Assistenten (wie pi, Claude, ChatGPT) IORA-Apps und Plugins entwickeln können. Folgt strikt diesem Prozess für konsistente, funktionale Ergebnisse.

---

## 1. Grundlegendes Verständnis

### App vs Plugin

| Kriterium | App | Plugin |
|-----------|-----|--------|
| **Ausführung** | Docker-Container | IORA-interne Sandbox |
| **Sprachen** | Alle (JS/TS, Python, Rust, Go, ...) | JavaScript/TypeScript |
| **UI** | Eigenes Web-Interface (Iframe/Proxy) | Widget im Dashboard |
| **Persistenz** | Eigene SQLite-DB + File Storage | KV-Storage (beschränkt) |
| **Ressourcen** | Volle Container-Ressourcen | Limitierte Sandbox (max 5s, 128MB) |
| **Use Cases** | Wetter-App, Kalender, Admin-Tools | Dashboard-Widgets, Automationen |

> 📚 **Vollständige Dokumentation**: Siehe [App & Plugin System (v2.2)](docs/system/app-plugin-system.md)
> für API-Referenz, Datenbank-System, Plugin-Sandbox und SDK-Referenz.

### Datenfluss

```
Externer Dienst → Webhook → IORA Gateway → App (Docker/Sandbox)
                                                 ↓
                                     App Storage / SQLite DB / Messaging
                                                 ↓
                                    IORA API → Dashboard UI
```

---

## 2. Typischer Entwicklungs-Workflow

### Phase 1: Konzeption

1. **App-Typ bestimmen** – `"type": "app"` (Docker) oder `"type": "plugin"` (Sandbox)
2. **Manifest erstellen** – `manifest.json` mit ID, Name, Version, Permissions
3. **Schnittstellen wählen** – Storage, SQLite, Scheduler, Webhooks, Messaging
4. **Permissions definieren** – Nur das Nötigste anfordern

### Phase 2: Implementierung

```json
{
  "id": "my-weather-app",
  "name": "Weather Dashboard",
  "version": "1.0.0",
  "developer": "Dev Name",
  "description": "Zeigt Wetterdaten an",
  "type": "app",
  "permissions": [
    "NetworkAccess",
    "StorageRead",
    "StorageWrite"
  ],
  "storage": {
    "enabled": true,
    "quota": { "max_file_storage_bytes": 10485760, "max_kv_entries": 100 }
  },
  "database": {
    "backend": "sqlite",
    "sqlite": {
      "init_sql": [
        "CREATE TABLE IF NOT EXISTS weather_cache (city TEXT PRIMARY KEY, data JSONB, updated_at TEXT)"
      ]
    }
  },
  "docker": {
    "auto_build": true,
    "base_image": "node:20-alpine",
    "start_cmd": "node server.js",
    "internal_ports": [{ "port": 3000 }]
  }
}
```

### Phase 3: App-Code schreiben

```javascript
// server.js – Express-App mit IORA Storage & DB
const express = require('express');
const app = express();
app.use(express.json());

// Health-Check (Pflicht für IORA)
app.get('/health', (req, res) => res.json({ status: 'healthy' }));

// App-eigene API
app.get('/api/weather', async (req, res) => {
  const city = req.query.city || 'Berlin';
  
  // IORA Storage API (über API-Gateway)
  const cached = await fetch(`http://iora-home:3001/api/apps/my-app/storage/kv/weather_${city}`);
  // ... business logic
  
  res.json({ city, temperature: 22, condition: 'sunny' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`App running on ${PORT}`));
```

### Phase 4: Paketieren & Installieren

```bash
# App als ZIP verpacken
zip -r my-weather-app.zip manifest.json server.js package.json public/

# Über IORA CLI installieren
ora app install my-weather-app.zip

# Oder per API
curl -X POST http://localhost:8126/api/appstore/install \
  -H "Authorization: Bearer $API_KEY" \
  -F "file=@my-weather-app.zip"
```

---

## 3. Neue IORA Core-Features entwickeln

Wenn ein KI-Agent neue Funktionen zum IORA-Kern hinzufügen soll:

### Schritt 1: Typen definieren (`iora-shared`)

```rust
// shared/iora-shared/src/mein_modul.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MyNewType {
    pub id: String,
    pub value: String,
}
```

Registrieren in `shared/iora-shared/src/lib.rs`:
```rust
pub mod mein_modul;
```

### Schritt 2: Handler schreiben (`iora-home`)

```rust
// services/iora-home/src/my_handler.rs
use axum::{extract::State, Json};
// ... imports

pub async fn my_endpoint(
    State(state): State<Arc<AppState>>,
    Json(req): Json<MyRequest>,
) -> Result<Json<MyResponse>, (StatusCode, String)> {
    // ... Implementierung
}
```

### Schritt 3: Module + Routen registrieren

In `services/iora-home/src/main.rs`:
```rust
// Module-Deklaration (ca. Zeile 46)
mod my_handler;

// State-Feld in AppState (ca. Zeile 170)
pub my_handler: Arc<my_handler::MyHandlerState>,

// State-Init (ca. Zeile 680)
my_handler: Arc::new(my_handler::MyHandlerState::new()),

// Route in data_routes (ca. Zeile 1040)
.route("/api/apps/:app_id/my-feature", get(my_handler::my_endpoint))
```

### Schritt 4: Berechtigungen ergänzen

In `shared/iora-shared/src/permissions.rs`:
```rust
// Enum-Eintrag
MyNewPermission,

// description()
MyNewPermission => "Beschreibung",

// risk_level()
MyNewPermission => RiskLevel::Medium,

// is_plugin_allowed()
MyNewPermission => bool (true/false),

// requires_user_consent()
MyNewPermission => bool (true/false),
```

### Schritt 5: Migration erstellen

```sql
-- services/iora-home/migrations/023_my_new_feature.sql
CREATE TABLE IF NOT EXISTS my_new_table (
    id UUID PRIMARY KEY,
    ...
);
```

In `services/iora-home/src/db/mod.rs`:
```rust
("023_my_new_feature", include_str!("../../migrations/023_my_new_feature.sql")),
```

### Schritt 6: Manifest-Felder erweitern

In `shared/iora-shared/src/app_manifest.rs`:
```rust
// Neues Feld in AppManifest
#[serde(skip_serializing_if = "Option::is_none")]
pub my_feature: Option<MyFeatureConfig>,
```

### Schritt 7: SDK aktualisieren

In `sdks/javascript/src/client.ts`:
```typescript
myFeature = {
    doSomething: async (param: string, appId?: string): Promise<any> => {
        const id = appId || this.appId;
        return this.request('POST', `/api/apps/${id}/my-feature`, { param });
    },
};
```

### Schritt 8: Dokumentation schreiben

```markdown
# docs/development/my-feature.md
# My Feature Guide

...
```

In `docs/docs-config.json` navigations-Eintrag hinzufügen.

Dokumentation ins Frontend kopieren:
```bash
cp -r docs/* frontend/public/docs/
```

---

## 4. Checkliste für neue Features

- [ ] Typen in `iora-shared` definiert & in `lib.rs` exportiert
- [ ] Manifest-Struktur erweitert (falls nötig)
- [ ] Handler in `iora-home` geschrieben
- [ ] Module-Deklaration in `main.rs`
- [ ] State-Feld + Init in `main.rs`
- [ ] Routen in `data_routes` registriert
- [ ] Berechtigungen in `permissions.rs`
- [ ] DB-Migration in `migrations/` + registriert in `db/mod.rs`
- [ ] SDK-Methoden in `client.ts`
- [ ] SDK-Type-Definitionen in `types.ts` (falls nötig)
- [ ] Dokumentation als `.md`-Datei
- [ ] `docs-config.json` aktualisiert
- [ ] Statische Docs ins Frontend kopiert: `cp -r docs/* frontend/public/docs/`

---

## 5. Häufige Fehler vermeiden

| Fehler | Lösung |
|--------|--------|
| `AppState` fehlt neues Feld | In `main.rs` an 3 Stellen ergänzen (Struct, Init, State-Zugriff) |
| Route matched nicht | Reihenfolge in `data_routes` beachten, spezifischere Routen zuerst |
| Permission granted aber denied | Auch `is_plugin_allowed` checken |
| SQLite DB nicht verbunden | `rusqlite` mit `bundled` Feature in `Cargo.toml` |
| SDK-Import fehlschlägt | `setAppId()` vor Nutzung der app-spezifischen APIs aufrufen |
| Docs nicht erreichbar | `cp -r docs/* frontend/public/docs/` nach Doc-Änderungen ausführen |

---

## 6. Wichtige URLs (Dev-Umgebung)

| Service | URL |
|---------|-----|
| Frontend (Vite Dev) | `http://localhost:5173` |
| Backend API (iora-home) | `http://localhost:3001` |
| Swagger UI | `http://localhost:3001/api/docs` |
| Statische Docs | `http://localhost:5173/docs/` |
| App Store (iora-appstore) | `http://localhost:8098` |
| Core Service | `http://localhost:8090` |
| Health Check | `http://localhost:3001/health` |

---

## 7. Rust-Workspace-Kommandos

```bash
# Einzelnen Service bauen
cargo build -p iora-home

# Workspace bauen
cargo build

# Einzelnen Service starten
cargo run -p iora-home

# Alle Services starten (Windows)
start.bat
```
