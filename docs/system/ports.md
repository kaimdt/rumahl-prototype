# IORA OS – Port Reference

## IORA System Services (8080–8099)

| Port | Service | Beschreibung |
|------|---------|-------------|
| **80** | iora-nginx | HTTP Reverse Proxy (leitet an alle Services weiter) |
| **443** | iora-nginx | HTTPS Reverse Proxy |
| **8080** | iora-home (alt) | Ehemaliger Port, jetzt 8126 |
| **8090** | iora-core | Service-Discovery, Plugin-Registry, Heartbeat |
| **8092** | iora-assist | ORA AI Assistant (Chat, Agenten, AI-Features) |
| **8093** | iora-secrets | Secret-Management (API-Keys, Passwörter) |
| **8094** | iora-watchdog | Service-Überwachung & Health-Checks |
| **8095** | iora-security | Security-Monitoring, Intrusion Detection |
| **8096** | iora-gateway | API-Gateway (externer Zugriff) |
| **8097** | iora-supervisor | Docker-Container-Management |
| **8098** | iora-appstore | App Store (PostgreSQL) |

## Extended Services (8100–8199)

| Port | Service | Beschreibung |
|------|---------|-------------|
| **8100** | iora-domain-validator | Domain-Whitelist-Prüfung |
| **8101** | iora-api | API Gateway (MCP, GraphQL, MQTT) |
| **8102** | iora-connector | Cloud-Relay für Remote-Zugriff |
| **8103** | iora-network-monitor | Netzwerk-Scanner (ARP, Geräteerkennung) |
| **8105** | iora-resource-manager | Ressourcen-Überwachung (CPU, RAM, Disk) |
| **8126** | iora-home | **Haupt-API** – Dashboard, Widgets, WebSocket |

## Andere Services

| Port | Service | Beschreibung |
|------|---------|-------------|
| **8099** | iora-intelligence | Business Intelligence & Analytics |
| **80** | iora-nginx (Config-Mgr) | NGINX Config Generator (verwaltet Reverse Proxy) |

## User Apps & Plugins (10000–20000)

Apps und Plugins bekommen dynamisch Ports aus diesem Bereich zugewiesen:
- **10000–20000**: Dynamische Port-Vergabe durch Port-Manager
- Kein fester Port – wird bei Installation im Manifest registriert

## Infrastruktur (System-Dienste)

| Port | Service | 
|------|---------|
| **22** | SSH |
| **53** | DNS |
| **5432** | PostgreSQL |
| **6379** | Redis (optional) |

## Entwicklung (Lokal)

| Port | Service |
|------|---------|
| **3001** | iora-home (Dev-Modus) |
| **5173** | Frontend Vite Dev Server |
| **8101** | iora-dev-bridge (IDE-Integration) |
