# Globale Konfiguration

Die globale Konfiguration ersetzt die historische Verteilung der
Einstellungen über `.env`-Dateien und lokale `localStorage`-Schlüssel
durch ein zentrales, schemagesteuertes Settings-Register.

## Kategorien

- **System** — Sprache, Region, Telemetrie, Logging.
- **Home Assistant** — Basis-URL und Long-Lived-Token.
- **Integrationen** — Drittanbieter-Bridges (MQTT, Matter, Zigbee, ...).
- **Darstellung** — Theme, Akzentfarbe, Animationen.
- **Privatsphäre** — Standort-Sync, Statistik-Sammlung.
- **Entwickler** — Debug-Logs, Verbose-WebSocket, experimentelle
  Features wie der Developer Mode.
- **Sonstiges** — alles, was nicht in eine andere Kategorie passt.

## Bedienung

1. Eintrag suchen (Volltextsuche oben).
2. Wert ändern — der Eintrag wird als "geändert" markiert.
3. **Speichern** drückt nur diesen Eintrag, **Verwerfen** stellt den
   ursprünglichen Wert wieder her.
4. Bei Einträgen mit `Neustart erforderlich`-Hinweis bitte den
   betroffenen Service in *Dienste* neu starten.
