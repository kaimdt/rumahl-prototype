---
title: Architektur
description: Wie rumahl OS aufgebaut ist — Rust-Microservices, Ports, das Plattform-Prinzip und die Sicherheitsschichten.
readTime: 6 min
updated: 2026-08-20
featured: true
---

rumahl OS ist ein Rust-Workspace aus mehr als 20 Crates, organisiert als lose gekoppelte Microservices. Jeder Dienst hat eine klare Aufgabe — und eine klare Port-Zuordnung.

## Dienste und Ports

| Dienst | Dev-Port | Prod-Port | Rolle |
| --- | --- | --- | --- |
| rumahl-home | 3001 | 8126 | Haupt-API + Dashboard (Axum, SQLite) |
| rumahl-core | 8090 | 8090 | Service Discovery, Plugin-Registry |
| rumahl-control | 8091 | 8091 | Kontrollzentrum, Systemdienste |
| rumahl-assist | 8092 | 8092 | KI-Assistent (ORA) |
| rumahl-secrets | 8093 | 8093 | Verschlüsselte Geheimnis-Speicherung |
| rumahl-watchdog | 8094 | 8094 | Health-Monitoring, Failover |
| rumahl-security | 8095 | 8095 | Bedrohungserkennung, Lockdown |
| rumahl-supervisor | 8097 | 8097 | Docker-Container-Management |
| rumahl-appstore | 8098 | 8098 | App Store |

## Das Plattform-Prinzip

Die Architektur trennt konsequent:

- **Apps installieren Funktionen** — der Core liefert die Plattform
- Alles oberhalb der *Berechtigungsgrenze* ist App-Territorium
- Alles darunter gehört zum rumahl-Core und bleibt stabil, getestet und dokumentiert
- Dritte bauen Apps, **ohne zu wissen**, wie rumahl Speicher, Benutzer oder Fenster intern implementiert

```
rumahl Apps          ← installierbar, berechtigt, ersetzbar
─────────────────────────────────────────────
Window Manager / Desktop  (Shell-UX, Sitzung)
Files / Notifications / Jobs / Users          ← OS-Dienste & SDK
Permissions                                    ← Vertrauensgrenze
rumahl Runtime (Plugin-Sandbox, App-Lifecycle)
System Services (Control, Netzwerk, Backup…)  ← Microservices
Kernel / Linux
```

## Sicherheitsschichten

| Ebene | Mechanismen |
| --- | --- |
| Authentifizierung & Autorisierung | JWT, API-Keys, PIN, RBAC |
| Netzwerksicherheit | Domain-Whitelist, IP-Zugriffskontrolle, Sandbox |
| Datenschutz | AES-256-GCM-Verschlüsselung, hash-verkettete Audit-Logs |
| Bedrohungserkennung | Intrusion Detection, Auto-Lockdown, Alarme |
| Plattformsicherheit | AppArmor, Docker-Isolation, schreibgeschütztes Dateisystem |

## Das ora.*-SDK

Apps greifen über eine einheitliche SDK-Oberfläche auf die Plattform zu: `ora.notifications`, `ora.files`, `ora.storage`, `ora.clipboard`, `ora.windows`, `ora.permissions`, `ora.jobs`, `ora.secrets`, `ora.users`, `ora.devices`, `ora.home` und `ora.system.events`. Jeder Aufruf wird am API-Gateway berechtigungsgeprüft.

> **Tipp:** Die vollständige Endpunkt-Referenz findest du im Dokument API-Referenz.
