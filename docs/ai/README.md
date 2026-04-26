# ORA AI - Intelligent Assistant for IORA

ORA AI ist ein KI-gesteuerter Assistent für das IORA Smart Home System, der sowohl in IORA Home (Web) als auch in IORA Desktop verfügbar ist.

## ✨ Features

### ✅ Implementiert

- **Internet-Suche**: Durchsuche das Internet mit DuckDuckGo (ohne API-Key)
- **Web-Scraping**: Extrahiere Inhalte von Webseiten mit Headless Chrome
- **Chat-Interface**: Vollständige Chat-Oberfläche mit Nachrichtenverlauf
- **Desktop-Integration**: Öffne URLs und Apps direkt vom Desktop
- **Animationen**: Zustandsbasierte Animationen (idle, listening, thinking, speaking, error)
- **Responsive Design**: Glass-morphic Design für moderne UI
- **Multi-Platform**: Web (IORA Home) und Desktop (Tauri v2)

### 🚧 In Entwicklung

- **Wake-Word-Erkennung**: "ORA" oder "IORA" erkennen und automatisch aktivieren
- **Spracheingabe**: Web Speech API (Web) und native APIs (Desktop)
- **Sprachausgabe**: Text-to-Speech für AI-Antworten
- **Bildschirm-Erfassung**: Screenshots und Bildschirmverständnis
- **Vision AI**: Verstehe was auf dem Bildschirm passiert
- **Erweiterte Visualisierungen**: Charts, Bilder, Videos in Chat-Antworten

## 🏗️ Architektur

```
┌─────────────────────────────────────────────────────────────┐
│                         IORA System                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────────┐           ┌──────────────────┐      │
│  │  IORA Home (Web) │           │ IORA Desktop App │      │
│  │                  │           │    (Tauri v2)    │      │
│  │  - FAB Button    │           │  - Overlay Window│      │
│  │  - Chat Dialog   │           │  - Transparent   │      │
│  │  - Animations    │           │  - Top-center    │      │
│  └────────┬─────────┘           └────────┬─────────┘      │
│           │                              │                 │
│           └──────────────┬───────────────┘                 │
│                          │                                 │
│                          ▼                                 │
│              ┌───────────────────────┐                     │
│              │  IORA Assist Backend  │                     │
│              │   (Port 8092)         │                     │
│              │                       │                     │
│              │  - Chat API           │                     │
│              │  - Tool Executor      │                     │
│              │  - Headless Chrome    │                     │
│              └───────────┬───────────┘                     │
│                          │                                 │
│           ┌──────────────┼──────────────┐                 │
│           ▼              ▼              ▼                  │
│    ┌──────────┐   ┌──────────┐  ┌──────────┐            │
│    │ Internet │   │   Web    │  │Screenshot│            │
│    │  Search  │   │ Scraping │  │  Capture │            │
│    └──────────┘   └──────────┘  └──────────┘            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 🚀 Installation & Setup

### 1. Backend (iora-assist)

```bash
cd backend/iora-assist
cargo build --release

# Starten
cargo run --release
# oder
./target/release/iora-assist
```

Der Backend läuft auf `http://localhost:8092`

### 2. IORA Home (Web)

```bash
# Im Hauptverzeichnis
npm install
npm run dev
```

Die Web-Oberfläche läuft auf `http://localhost:5173`

### 3. IORA Desktop (Tauri)

```bash
cd desktop
npm install
npm run tauri dev
```

## 📡 API Endpoints

### Chat
```http
POST /api/assist/chat
Content-Type: application/json

{
  "message": "Wie ist das Wetter?",
  "context": null
}
```

### Internet-Suche
```http
POST /api/assist/tools/search
Content-Type: application/json

{
  "query": "IORA Smart Home",
  "max_results": 5
}
```

### Web-Scraping
```http
POST /api/assist/tools/scrape
Content-Type: application/json

{
  "url": "https://example.com"
}
```

### Screenshot
```http
POST /api/assist/tools/screenshot
Content-Type: application/json

{
  "url": "https://example.com",
  "width": 1920,
  "height": 1080
}
```

## 🎨 UI-Komponenten

### IORA Home (Web)
- **Floating Action Button**: Unten rechts, immer sichtbar
- **Chat Dialog**: Volle Chat-Oberfläche mit Animationen
- **Gradient Animations**: Farben ändern sich je nach AI-Zustand

### IORA Desktop (Tauri)
- **Transparentes Overlay**: Oben mittig am Bildschirm
- **Frameless Window**: Ohne Fensterrahmen, immer im Vordergrund
- **Desktop-Integration**: Öffne Apps und URLs direkt

## 🛠️ Entwicklung

### Tauri Commands

```rust
// Chat senden
invoke('ora_send_chat', { message: 'Hello', context: null })

// Internet suchen
invoke('ora_search_internet', { query: 'IORA', maxResults: 5 })

// Overlay zeigen
invoke('ora_show_overlay')

// Overlay verstecken
invoke('ora_hide_overlay')

// Overlay umschalten
invoke('ora_toggle_overlay')

// Desktop-Aktion ausführen
invoke('ora_execute_desktop_action', {
  actionType: 'open_url',
  params: { url: 'https://example.com' }
})
```

### TypeScript/React (Web)

```tsx
import { ORAAssistant } from '@/components/ORAAssistant'

function App() {
  return (
    <>
      {/* Deine App */}
      <ORAAssistant />
    </>
  )
}
```

## 🎯 AI-Zustände

| Zustand | Farbe | Animation | Bedeutung |
|---------|-------|-----------|-----------|
| `idle` | Grau | Statisch | Bereit für Eingabe |
| `listening` | Blau | Pulsierend | Hört Spracheingabe |
| `thinking` | Lila/Pink | Rotierend | Verarbeitet Anfrage |
| `speaking` | Grün | Pulsierend | Gibt Antwort |
| `error` | Rot/Orange | - | Fehler aufgetreten |

## 📝 Umgebungsvariablen

```bash
# Backend URL (Standard: http://localhost:8092)
IORA_ASSIST_URL=http://localhost:8092

# Optional: API Keys für AI Provider
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

## 🧪 Testing

```bash
# Backend testen
cd backend/iora-assist
cargo test

# Frontend testen
npm test

# Desktop testen
cd desktop
npm run tauri build
```

## 🐛 Bekannte Probleme

1. **Linux Build**: Benötigt GTK/GLib Systemabhängigkeiten für Tauri
2. **Spracheingabe**: Web Speech API noch nicht implementiert
3. **Screenshot**: Platzhalter-Funktionalität, noch nicht implementiert
4. **Wake-Word**: Erkennung noch nicht implementiert

## 📚 Dokumentation

- [ORA_AI_PROGRESS.md](./ORA_AI_PROGRESS.md) - Detaillierter Implementierungsfortschritt
- [ARCHITECTURE.md](./ARCHITECTURE.md) - Gesamtarchitektur von IORA

## 🤝 Beitragen

Contributions sind willkommen! Bitte öffne ein Issue oder Pull Request.

## 📄 Lizenz

Siehe [LICENSE](./LICENSE)

---

**Hinweis**: ORA AI befindet sich noch in aktiver Entwicklung. Einige Features sind noch nicht vollständig implementiert.
