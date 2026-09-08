# Dienste & Infrastruktur

## Dienste-Tab

Die Dienste-Übersicht zeigt für jeden rumahl-Microservice den
aktuellen Health-Status. Die Statusbedeutung:

| Status | Farbe | Bedeutung |
|--------|-------|-----------|
| `Online` | Grün | Service antwortet auf `GET /health`. |
| `Eingeschränkt` | Gelb | Service antwortet, aber HTTP-Status != 2xx. |
| `Nicht aktiviert` | Grau | Connection refused — Binary ist nicht installiert oder Service ist deaktiviert. |
| `Offline` | Rot | Sollte erreichbar sein, ist es aber nicht — vermutlich abgestürzt. |

`rumahl-home` ist immer mindestens "Offline" (nie "Nicht aktiviert"),
weil dieses Endpoint genau von ihm bedient wird.

## Infrastruktur-Tab

Die Live-Visualisierung zeichnet alle Microservices als Knoten und
animiert die Datenflüsse zwischen aktiven Services. Die Anzeige basiert
ausschließlich auf echten Health-Daten (`/api/admin/control/services`,
Polling alle 10 s) — frühere "flackernde" Inactive/Warning-Zustände
(durch eine `Math.random()`-Simulation) sind entfernt.

## Häufige Bootschleifen

- **rumahl-secrets**: erwartet einen 32-Byte Hex-Master-Key. Wenn
  weder `SECRETS_MASTER_KEY` gesetzt noch
  `/etc/ora/secrets-master.key` vorhanden ist, generiert der Service
  ihn beim ersten Start automatisch und speichert ihn permanent.
- **rumahl-updater**: 404 vom Update-Server bedeutet "diese Version ist
  noch nicht im Server-Index" und ist *kein* Fehler mehr.
- **rumahl-nginx**: fehlende `apps`-Tabelle wird als "keine Routen" be-
  handelt; Verbindungsfehler zur DB führen zu Retry statt Crash-Loop.
- **rumahl-api**: `/var/lib/rumahl-api` wird beim Start automatisch ange-
  legt, falls die SQLite-Datei dort liegt.
