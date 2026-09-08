# rumahl OS – Port Reference

## rumahl System Services (8080–8099)

| Port | Service | Beschreibung |
|------|---------|-------------|
| **80** | rumahl-nginx | HTTP Reverse Proxy (leitet an alle Services weiter) |
| **443** | rumahl-nginx | HTTPS Reverse Proxy |
| **8080** | rumahl-home (alt) | Ehemaliger Port, jetzt 8126 |
| **8090** | rumahl-core | Service-Discovery, Plugin-Registry, Heartbeat |
| **8092** | rumahl-assist | rumahl AI Assistant (Chat, Agenten, AI-Features) |
| **8093** | rumahl-secrets | Secret-Management (API-Keys, Passwörter) |
| **8094** | rumahl-watchdog | Service-Überwachung & Health-Checks |
| **8095** | rumahl-security | Security-Monitoring, Intrusion Detection |
| **8096** | rumahl-gateway | API-Gateway (externer Zugriff) |
| **8097** | rumahl-supervisor | Docker-Container-Management |
| **8098** | rumahl-appstore | App Store (PostgreSQL) |

## Extended Services (8100–8199)

| Port | Service | Beschreibung |
|------|---------|-------------|
| **8100** | rumahl-domain-validator | Domain-Whitelist-Prüfung |
| **8101** | rumahl-api | API Gateway (MCP, GraphQL, MQTT) |
| **8102** | rumahl-connector | Cloud-Relay für Remote-Zugriff |
| **8103** | rumahl-network-monitor | Netzwerk-Scanner (ARP, Geräteerkennung) |
| **8105** | rumahl-resource-manager | Ressourcen-Überwachung (CPU, RAM, Disk) |
| **8126** | rumahl-home | **Haupt-API** – Dashboard, Widgets, WebSocket |

## Andere Services

| Port | Service | Beschreibung |
|------|---------|-------------|
| **8099** | rumahl-intelligence | Business Intelligence & Analytics |
| **80** | rumahl-nginx (Config-Mgr) | NGINX Config Generator (verwaltet Reverse Proxy) |

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
| **3001** | rumahl-home (Dev-Modus) |
| **5173** | Frontend Vite Dev Server |
| **8101** | rumahl-dev-bridge (IDE-Integration) |
