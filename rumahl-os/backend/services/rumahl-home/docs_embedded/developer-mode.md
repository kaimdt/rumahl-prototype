# Developer Mode

Der Developer Mode aktiviert verschiedene Debug- und
Diagnose-Funktionen, die im Normalbetrieb absichtlich versteckt sind:

- Erweiterte Konsolen-Logs (`DEBUG`-Level statt `INFO`).
- Sichtbarmachung interner React-Render-Zähler im UI.
- Direkter Zugriff auf rohe `/api/admin/...`-JSON-Antworten via
  einer "Debug Drawer" Schaltfläche.
- Erweiterte Tooltips mit Komponenten-Pfaden.
- Anzeige von SSE/WS-Frames in Echtzeit im Realtime-Tab.

## Aktivierung

Im Admin Panel:

1. **Globale Konfiguration** öffnen.
2. Kategorie **Entwickler** wählen.
3. Schalter **Developer Mode** aktivieren.
4. Browser-Tab neu laden (eine entsprechende Hinweismeldung erscheint).

Alternativ kann auf dem Übersichts-Tab des Admin-Panels eine
Schnellumschaltung verwendet werden, ohne durch alle Kategorien
zu navigieren.

## Sicherheit

Der Developer Mode ist *nur* für Admin-Benutzer sichtbar und greift
nicht auf privilegierte Backend-APIs zu, die nicht ohnehin schon im
normalen Betrieb verwendet werden — er ändert ausschließlich, **wie
viel** das Frontend anzeigt, nicht **was** es darf.
