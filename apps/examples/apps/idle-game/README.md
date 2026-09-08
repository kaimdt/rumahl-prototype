# rumahl Forge – Idle Village 🏘️

Ein entspanntes 2D Pixel-Art Idle-Game im **SNES 16-Bit Stil** für die rumahl-Plattform. 
Baue ein gemütliches mittelalterliches Fantasy-Dorf auf – mit roten Dächern, einem Teich 
voller Fische, Farm-Plots, Steinbrunnen und herumlaufenden Dorfbewohnern.

## 🎨 Visueller Stil

- **SNES 16-Bit Pixel Art** – 2.5D Top-Down Perspektive
- **Gemütliches Fantasy-Dorf** mit gesättigter Farbpalette
- **Tile-basiertes Terrain**: Gras, Erdwege, Wasser, Steinplätze
- **Abgerundete Laubbäume** mit Pixel-Clustern
- **Fischteich** mit animierten Fischen und Seerosen
- **Rote-Dach-Gebäude** mit Fachwerk-Wänden, Fenstern & Schornsteinen
- **Steinbrunnen** mit Wasserspiel in der Dorfmitte
- **Farm-Plots** mit Möhren, Salat, Beeren & Weizen
- **Pergament-UI** oben links mit Ressourcen-Stats
- **8 NPC-Dorfbewohner** mit Hüten & Laufanimation
- **Pixel-Partikel** bei Klicks

## 🎮 Spielprinzip

1. 👆 **Klicke** aufs Dorf → sammle erste Ressourcen
2. 🏗️ **Kaufe Gebäude** in der Shop-Leiste unten
3. 👀 **Schau zu** wie dein Dorf wächst & NPCs herumlaufen
4. ⬆️ **Upgrade Gebäude** für mehr Produktion
5. 🌟 **Prestige**: Setze alles zurück für permanente Boni
6. 🏆 **19 Erfolge** freischalten

## 🏗️ Gebäude & Produktion

| Gebäude | Emoji | Ressource | Zone auf der Map |
|---------|-------|-----------|-----------------|
| Farm | 🌾 | Nahrung | Links unten (Farmland) |
| Holzfäller | 🪓 | Holz | Links oben (Waldrand) |
| Steinbruch | ⛏️ | Stein | Rechts unten |
| Marktplatz | 🏪 | Gold | Dorfmitte |
| Akademie | 📚 | Wissen | Rechts oben |

Gebäude erscheinen **visuell auf der Map** in ihrer jeweiligen Zone. 
Mehr Gebäude = größeres, dichteres Dorf!

## 🐛 Bug-Fix

Der Kauf-Button war zuvor ausgegraut trotz genügend Ressourcen. 
**Jetzt fixed**: Die Shop-Leiste wird bei jedem Poll-Tick auf Erschwinglichkeit geprüft.

## 📦 Installation

```bash
cd apps/examples/idle-game
npm install
zip -r rumahl-forge.zip manifest.json package.json server.js public/
ora app install rumahl-forge.zip
```

## 🚀 Lokal testen

```bash
cd apps/examples/idle-game
npm install && node server.js
# → http://localhost:3000
```

## 📁 Struktur

```
idle-game/
├── manifest.json       # rumahl App-Konfiguration
├── package.json        # Express Dependency
├── server.js           # Game-Engine + REST API
├── public/
│   ├── index.html      # Canvas + Pergament-Overlay
│   ├── styles.css      # Pixel-Art Styling
│   └── game.js         # SNES 16-Bit Renderer + NPCs + Partikel
├── .gitignore
└── README.md
```
