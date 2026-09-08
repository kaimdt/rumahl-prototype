# Benachrichtigungs-Formatierer - Beispiel Plugin

Ein vollständiges Beispiel für ein rumahl Plugin, das in einer Sandbox ausgeführt wird.

## Überblick

Der Benachrichtigungs-Formatierer ist ein Rust-Plugin, das:
- Benachrichtigungen formatiert und anreichert
- In einer Sandbox mit Ressourcenlimits läuft
- On-demand ausgeführt wird (kein dauerhafter Container)
- Custom API Endpunkte bereitstellt
- Crash-sicher ist (rumahl System läuft weiter)

## Features

- ✅ **Sandbox-Execution**: Läuft isoliert mit Limits
- ✅ **On-Demand**: Wird nur bei Bedarf ausgeführt
- ✅ **Emoji-Anreicherung**: Fügt passende Emojis hinzu
- ✅ **Prioritäts-System**: Klassifiziert Benachrichtigungen
- ✅ **Validierung**: Prüft Benachrichtigungen auf Vollständigkeit
- ✅ **Schnell**: Formatiert in <100ms
- ✅ **Ressourcen-effizient**: Max 128MB RAM, 5s Execution

## Struktur

```
notification-plugin/
├── manifest.json              # Plugin-Konfiguration
├── README.md                  # Diese Datei
├── Cargo.toml                 # Rust Abhängigkeiten
├── src/
│   ├── lib.rs                 # Plugin-Implementierung
│   ├── formatter.rs           # Formatierungs-Logik
│   └── validator.rs           # Validierungs-Logik
└── tests/
    └── integration_test.rs    # Tests
```

## Installation

### 1. Plugin bauen

```bash
cd notification-plugin
cargo build --release
```

### 2. Registrierung

```bash
curl -X POST http://rumahl-core:8090/api/core/plugins/register \
  -H "Content-Type: application/json" \
  -d @manifest.json
```

Das kompilierte Plugin (`target/release/libnotification_formatter.so`) wird automatisch in die rumahl Plugin-Registry geladen.

### 3. Warten auf Genehmigung

Ein Administrator muss das Plugin im Admin Panel unter "Registrierungen" genehmigen.

### 4. Nutzung

Nach Genehmigung wird das Plugin:
- In die Sandbox geladen
- Bei Bedarf ausgeführt
- Automatisch beendet nach Execution

## Verwendung

### Benachrichtigung formatieren

```bash
curl -X POST http://rumahl-core:8090/api/gateway/notifications/format \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Türklingel",
    "message": "Jemand steht vor der Tür",
    "category": "security"
  }'
```

Antwort:
```json
{
  "title": "🔔 Türklingel",
  "message": "Jemand steht vor der Tür",
  "category": "security",
  "priority": "high",
  "emoji": "🚪",
  "formatted_text": "🔔 **Türklingel**\n\n🚪 Jemand steht vor der Tür",
  "timestamp": "2026-04-20T10:00:00Z",
  "metadata": {
    "processed_by": "notification-formatter",
    "version": "1.0.0"
  }
}
```

### Benachrichtigung validieren

```bash
curl -X POST http://rumahl-core:8090/api/gateway/notifications/validate \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test",
    "message": "Nachricht"
  }'
```

Antwort:
```json
{
  "valid": true,
  "errors": [],
  "warnings": [
    "Kategorie fehlt - empfohlen für bessere Formatierung"
  ]
}
```

## Sandbox-Konfiguration

Das Plugin läuft mit folgenden Limits:

```json
{
  "max_execution_time_ms": 5000,
  "max_memory_mb": 128,
  "allow_network": false,
  "allow_file_system": false
}
```

- **Execution Time**: Max 5 Sekunden
- **Memory**: Max 128 MB RAM
- **Network**: Kein Zugriff (isoliert)
- **File System**: Kein Zugriff (isoliert)

## API Endpunkte

### POST /api/notifications/format

Formatiert eine Benachrichtigung.

**Request Body:**
```json
{
  "title": "string",
  "message": "string",
  "category": "info|warning|error|security|automation",
  "priority": "low|normal|high|urgent"
}
```

**Response:**
```json
{
  "title": "string (mit Emoji)",
  "message": "string",
  "category": "string",
  "priority": "string",
  "emoji": "string",
  "formatted_text": "string (formatiert)",
  "timestamp": "ISO-8601",
  "metadata": {}
}
```

### POST /api/notifications/validate

Validiert eine Benachrichtigung.

**Request Body:**
```json
{
  "title": "string",
  "message": "string"
}
```

**Response:**
```json
{
  "valid": boolean,
  "errors": ["string"],
  "warnings": ["string"]
}
```

## Emoji-Zuordnung

Das Plugin fügt automatisch Emojis basierend auf Kategorie hinzu:

- **info**: ℹ️
- **warning**: ⚠️
- **error**: ❌
- **security**: 🔒
- **automation**: ⚙️
- **doorbell**: 🚪
- **motion**: 👤
- **temperature**: 🌡️
- **light**: 💡

## Prioritäts-System

Prioritäten werden automatisch klassifiziert:

- **urgent**: Sofortige Aktion erforderlich
- **high**: Wichtig, zeitnah reagieren
- **normal**: Standard-Benachrichtigung
- **low**: Informativ, keine Aktion nötig

## Deaktivieren/Aktivieren

```bash
# Deaktivieren (Plugin wird nicht mehr ausgeführt)
curl -X POST http://rumahl-core:8090/api/core/plugins/notification-formatter/disable \
  -H "Authorization: Bearer ADMIN_TOKEN"

# Aktivieren
curl -X POST http://rumahl-core:8090/api/core/plugins/notification-formatter/enable \
  -H "Authorization: Bearer ADMIN_TOKEN"
```

## Deinstallation

```bash
curl -X DELETE http://rumahl-core:8090/api/core/plugins/notification-formatter \
  -H "Authorization: Bearer ADMIN_TOKEN"
```

Dies entfernt:
- Das Plugin aus der Registry
- Alle registrierten API Endpunkte
- Die Plugin-Registrierung

## Entwicklung

### Lokales Testen

```bash
# Tests ausführen
cargo test

# Mit Ausgabe
cargo test -- --nocapture

# Einzelnen Test
cargo test test_format_notification
```

### Plugin-Trait implementieren

```rust
use rumahl_shared::plugin::{IPlugin, PluginMetadata, PluginExecutionResult};

pub struct NotificationFormatter {
    metadata: PluginMetadata,
}

#[async_trait]
impl IPlugin for NotificationFormatter {
    fn metadata(&self) -> &PluginMetadata {
        &self.metadata
    }

    async fn execute(&self, input: serde_json::Value)
        -> anyhow::Result<PluginExecutionResult>
    {
        // Ihre Logik hier
        Ok(PluginExecutionResult {
            success: true,
            duration_ms: 50,
            output: Some(result),
            error: None,
        })
    }
}
```

### Sandbox-Limits testen

```rust
#[test]
fn test_execution_time() {
    // Stellen Sie sicher, dass Execution < 5s
    let start = Instant::now();
    plugin.execute(input).await?;
    assert!(start.elapsed().as_secs() < 5);
}

#[test]
fn test_memory_usage() {
    // Stellen Sie sicher, dass Memory < 128MB
    // Verwenden Sie Tools wie valgrind oder heaptrack
}
```

## Troubleshooting

### Plugin wird nicht geladen

1. Prüfen Sie die Registrierung:
```bash
curl http://rumahl-core:8090/api/core/plugins
```

2. Prüfen Sie die Logs:
```bash
docker logs rumahl-core | grep notification-formatter
```

### Sandbox-Limit überschritten

**Symptom**: Plugin wird abgebrochen mit Timeout-Error

**Lösung**:
- Optimieren Sie Ihren Code
- Reduzieren Sie Komplexität
- Fragen Sie höheres Limit an (manifest.json)

### API antwortet nicht

- Prüfen Sie, ob Plugin genehmigt wurde
- Prüfen Sie Ihr API-Token
- Prüfen Sie API Gateway Logs

## Performance

Typische Execution-Zeiten:

- **Format**: 20-50ms
- **Validate**: 5-10ms
- **Cold Start**: 100-200ms (erstes Mal nach Laden)

## Best Practices

1. **Halten Sie Execution kurz**: Unter 1 Sekunde ideal
2. **Minimieren Sie Memory**: Verwenden Sie nur nötigen Speicher
3. **Keine Netzwerk-Aufrufe**: Plugin ist isoliert
4. **Fehlerbehandlung**: Fangen Sie alle Fehler ab
5. **Logging**: Nutzen Sie tracing für Debugging
6. **Tests schreiben**: Stellen Sie Korrektheit sicher

## Siehe auch

- [rumahl SDK Dokumentation](../../RUMAHL_SDK.md)
- [Plugin System](../../backend/rumahl-shared/src/plugin.rs)
- [Weather App Beispiel](../weather-app/)
