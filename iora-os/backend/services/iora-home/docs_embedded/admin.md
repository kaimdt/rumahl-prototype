# Admin Panel

Das Admin Panel ist die zentrale Verwaltungsoberfläche für IORA OS.
Es ist in mehrere Gruppen gegliedert:

## System & Kontrolle

- **Dienste** — Live-Status aller IORA-Microservices.
  Drei Zustände: `Online` (grün), `Eingeschränkt` (gelb),
  `Nicht aktiviert` (grau, Service nicht installiert) und
  `Offline` (rot, Service installiert aber nicht erreichbar).
- **Globale Konfiguration** — schemagesteuerte Einstellungsoberfläche,
  spiegelt das `.env`-System inklusive Beschreibung, Validierung und
  "Neustart erforderlich"-Hinweisen.
- **Aufgaben / Betriebsmodus / System / Netzwerk / Infrastruktur** —
  klassische Systemansichten.

## Apps & Plugins

App-Store, Plugin-Verwaltung, Registrierungs-Genehmigung,
Sicherheits-Monitor, Updates und Widgets.

## Home Assistant

HA-Konfiguration, Verbindungsstatus, Entitäten, Szenen, Automationen,
Logbuch und Kalender.

## Geräte & Netzwerk

MQTT, Zigbee, Z-Wave, Matter, Bluetooth, HomeKit.

## Tools & Infrastruktur

API-Keys, Webhooks, Scheduler, Analytics, Backups, Cloud-Connector,
Logs, Datenbank, Warnungen, System-Meldungen.

## Benutzer

Benutzer-, Rollen- und PIN-Verwaltung.
