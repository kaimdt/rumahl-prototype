---
title: Sicherheitsmodell
description: Defense in Depth — wie rumahl dein Zuhause schützt: Authentifizierung, Netzwerksicherheit, Verschlüsselung, Bedrohungserkennung und Plattform-Härtung.
readTime: 6 min
updated: 2026-08-20
featured: true
---

rumahl implementiert ein umfassendes Sicherheitsmodell nach dem Defense-in-Depth-Prinzip. Jede Ebene hat eine Aufgabe: sicherzustellen, dass eine Kompromittierung auf einer Ebene nicht die nächste erreicht.

## Die fünf Sicherheitsebenen

| Ebene | Mechanismen |
| --- | --- |
| 1. Authentifizierung & Autorisierung | JWT-Tokens, API-Keys, PIN-Auth, RBAC |
| 2. Netzwerksicherheit | Domain-Whitelist, IP-Zugriffskontrolle, Sandbox |
| 3. Datenschutz | AES-256-GCM-Verschlüsselung, hash-verkettete Audit-Logs |
| 4. Bedrohungserkennung & Reaktion | Intrusion Detection, Auto-Lockdown, Alarme |
| 5. Plattformsicherheit | AppArmor, Docker-Isolation, schreibgeschütztes Dateisystem |

## Zentrale Sicherheitsdienste

| Dienst | Port | Rolle |
| --- | --- | --- |
| rumahl-security | 8095 | Bedrohungserkennung, Intrusion Prevention, Lockdown |
| rumahl-secrets | 8093 | Verschlüsselte Geheimnis-Speicherung (API-Keys, Passwörter, Tokens) |
| rumahl-watchdog | 8094 | Health-Monitoring, Failover, Circuit Breaker |

## Datenschutz

- **Verschlüsselung im Ruhezustand:** AES-256-GCM für Geheimnisse und sensible Daten
- **Audit-Logging:** hash-verkettete Logs — Manipulation wird sofort sichtbar
- **Local-First:** standardmäßig verlässt keine Daten dein Gerät
- **Opt-in-Telemetrie:** Diagnose- und Cloud-Funktionen erfordern ausdrückliche Einwilligung

## Berechtigungen als Vertrauensgrenze

Das Berechtigungssystem ist das Herzstück des Sicherheitsmodells:

- Jeder API-Aufruf wird am Gateway gegen eine explizite Berechtigung geprüft
- Apps fragen Berechtigungen bei der Registrierung **und** zur Laufzeit an (Erlauben/Ablehnen-Dialoge)
- Destruktive Operationen erfordern explizite, typisierte Bestätigung — niemals autonom
- AppArmor und die Runtime-Sandbox begrenzen, was eine kompromittierte App tun kann

## Plattform-Härtung

- Buildroot-LTS-Linux mit schreibgeschütztem SquashFS-Root-Dateisystem
- ZRAM für `/tmp` und `/var` — weniger Verschleiß und Angriffsfläche
- RAUC-A/B-Updates — atomare Updates mit automatischem Rollback
- AppArmor-Zugriffskontrolle für alle Dienste
- Der Sicherheitsmonitor zeigt Alarme, Ressourcenverbrauch und Anomalien

> **Tipp:** Halte dein System aktuell — Sicherheitspatches kommen über das Update-Center mit Wahl zwischen Stable-, Beta- und Alpha-Kanal.
