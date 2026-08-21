# Wetter-Dienst (Weather Service) - Beispiel App

Ein vollständiges Beispiel für eine rumahl App, die als Docker Container läuft.

## Überblick

Der Wetter-Dienst ist eine Node.js-Anwendung, die:
- Wetterdaten von einer externen API abruft
- Daten lokal cached für bessere Performance
- REST API Endpunkte bereitstellt
- Ein Dashboard-Widget anbietet
- Automatisch containerisiert wird

## Features

- ✅ **Automatische Containerisierung**: Kein manuelles Dockerfile nötig
- ✅ **REST API**: Aktuelle Wetterdaten und 7-Tage Vorhersage
- ✅ **Caching**: Reduziert externe API-Aufrufe
- ✅ **Health Checks**: Überwacht Service-Status
- ✅ **Dashboard Widget**: Zeigt Wetter direkt im rumahl Dashboard
- ✅ **Crash-Sicher**: Bei Absturz bleibt rumahl System funktionsfähig

## Struktur

```
weather-app/
├── manifest.json          # App-Konfiguration und Metadaten
├── README.md              # Diese Datei
├── package.json           # Node.js Abhängigkeiten
├── server.js              # Hauptserver-Logik
├── weather-api.js         # Wetter-API Integration
├── cache.js               # Cache-Verwaltung
└── widget/
    └── WeatherWidget.tsx  # React Dashboard Widget
```

## Installation

### 1. Registrierung

```bash
curl -X POST http://rumahl-supervisor:8097/api/supervisor/apps/register \
  -H "Content-Type: application/json" \
  -d @manifest.json
```

### 2. Warten auf Genehmigung

Ein Administrator muss die App im Admin Panel unter "Registrierungen" genehmigen.

### 3. Installation

Nach Genehmigung wird die App automatisch:
- Als Docker Container gebaut (basierend auf `manifest.json`)
- Gestartet
- Bei rumahl registriert

## Verwendung

### API Endpoints

#### Aktuelle Wetterdaten

```bash
curl http://rumahl-core:8090/api/gateway/weather/current \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Antwort:
```json
{
  "temperature": 18.5,
  "condition": "Teilweise bewölkt",
  "humidity": 65,
  "wind_speed": 12.3,
  "location": "Berlin",
  "timestamp": "2026-04-20T10:00:00Z"
}
```

#### 7-Tage Vorhersage

```bash
curl http://rumahl-core:8090/api/gateway/weather/forecast \
  -H "Authorization: Bearer YOUR_TOKEN"
```

#### Health Check

```bash
curl http://weather-service:3000/api/weather/health
```

## Automatische Containerisierung

Die App wird automatisch containerisiert basierend auf der `docker`-Konfiguration in `manifest.json`:

```json
{
  "docker": {
    "auto_build": true,
    "base_image": "node:18-alpine",
    "working_dir": "/app",
    "install_cmd": "npm install",
    "start_cmd": "node server.js",
    "ports": ["3000:3000"],
    "environment": {
      "NODE_ENV": "production"
    }
  }
}
```

rumahl erstellt automatisch ein Dockerfile:

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY . .
RUN npm install
EXPOSE 3000
CMD ["node", "server.js"]
```

## Manuelles Docker Image (Alternative)

Falls Sie ein eigenes Docker Image verwenden möchten:

1. Ändern Sie `manifest.json`:
```json
{
  "docker": {
    "auto_build": false,
    "image": "ghcr.io/your-org/weather-app:1.0.0"
  }
}
```

2. Bauen und pushen Sie Ihr Image:
```bash
docker build -t ghcr.io/your-org/weather-app:1.0.0 .
docker push ghcr.io/your-org/weather-app:1.0.0
```

## Konfiguration

### Umgebungsvariablen

- `PORT`: Server-Port (Standard: 3000)
- `WEATHER_API_KEY`: API-Schlüssel für externe Wetter-API
- `CACHE_TTL`: Cache-Gültigkeitsdauer in Sekunden (Standard: 300)
- `NODE_ENV`: Umgebung (production/development)

### Volumes

- `weather-cache:/app/cache`: Persistenter Cache-Speicher

## Deaktivieren/Aktivieren

```bash
# Deaktivieren (stoppt Container)
curl -X POST http://rumahl-supervisor:8097/api/supervisor/apps/weather-service/disable \
  -H "Authorization: Bearer ADMIN_TOKEN"

# Aktivieren (startet Container)
curl -X POST http://rumahl-supervisor:8097/api/supervisor/apps/weather-service/enable \
  -H "Authorization: Bearer ADMIN_TOKEN"
```

## Deinstallation

```bash
curl -X DELETE http://rumahl-supervisor:8097/api/supervisor/apps/weather-service \
  -H "Authorization: Bearer ADMIN_TOKEN"
```

Dies entfernt:
- Den Docker Container
- Alle registrierten API Endpunkte
- Das Dashboard Widget
- Die App-Registrierung

## Entwicklung

### Lokales Testen

```bash
# Abhängigkeiten installieren
npm install

# Umgebungsvariablen setzen
export WEATHER_API_KEY=your_api_key
export PORT=3000

# Server starten
node server.js
```

### Mit Docker testen

```bash
# Image bauen
docker build -t weather-app .

# Container starten
docker run -p 3000:3000 \
  -e WEATHER_API_KEY=your_key \
  weather-app
```

## Troubleshooting

### Container startet nicht

1. Logs prüfen:
```bash
docker logs weather-service
```

2. Health Check prüfen:
```bash
curl http://weather-service:3000/api/weather/health
```

### API antwortet nicht

- Prüfen Sie, ob die App im Admin Panel genehmigt wurde
- Prüfen Sie Ihr API-Token
- Prüfen Sie die API Gateway Logs

### Widget wird nicht angezeigt

- Widget wird nur angezeigt, wenn der Container läuft
- Bei Absturz zeigt rumahl eine "nicht verfügbar" Nachricht
- Prüfen Sie den Container-Status im Admin Panel

## Best Practices

1. **Implementieren Sie Health Checks**: Zeigt rumahl den Service-Status
2. **Verwenden Sie Caching**: Reduziert Last auf externe APIs
3. **Behandeln Sie Timeouts**: API Gateway timeout ist 30 Sekunden
4. **Loggen Sie angemessen**: Hilft bei Fehlersuche
5. **Testen Sie Crash-Recovery**: App sollte nach Neustart funktionieren

## Siehe auch

- [rumahl SDK Dokumentation](../../RUMAHL_SDK.md)
- [App & Plugin Isolation](../../APP_PLUGIN_ISOLATION.md)
- [Notification Plugin Beispiel](../notification-plugin/)
