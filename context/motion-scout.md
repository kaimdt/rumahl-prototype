# Code Context: Motion & Animation Scout

## 1. All Files Using framer-motion Imports

87 files across `frontend/src/` import from `framer-motion`. Below is the full inventory:

### Core App & Navigation
| File | Import |
|------|--------|
| `App.tsx` (line 50) | `{ motion, AnimatePresence }` |
| `components/SplashScreen.tsx` (line 1) | `{ motion, AnimatePresence }` |
| `components/NavigationMenu.tsx` (line 1) | `{ motion, AnimatePresence }` |
| `components/LoginModal.tsx` (line 3) | `{ motion, AnimatePresence }` |
| `components/DynamicBackground.tsx` (line 2) | `{ motion, AnimatePresence }` |
| `components/ConnectionStatus.tsx` (line 1) | `{ motion, AnimatePresence }` |

### Widgets (30+ files)
All widget components use `motion.div` wrappers for tap/scale press feedback. Key ones:

| File | Import |
|------|--------|
| `components/widgets/ClimateWidget.tsx` (line 3) | `{ motion }` |
| `components/widgets/WeatherWidget.tsx` (line 3) | `{ motion }` |
| `components/widgets/LightWidget.tsx` (line 3) | `{ motion }` |
| `components/widgets/SwitchWidget.tsx` (line 3) | `{ motion }` |
| `components/widgets/FanWidget.tsx` (line 3) | `{ motion }` |
| `components/widgets/MediaPlayerWidget.tsx` (line 2) | `{ motion }` |
| `components/widgets/CoverWidget.tsx` (line 3) | `{ motion }` |
| `components/widgets/SensorWidget.tsx` (line 3) | `{ motion }` |
| `components/widgets/PersonWidget.tsx` (line 2) | `{ motion }` |
| `components/widgets/WasteCollectionWidget.tsx` (line 1) | `{ motion }` |
| `components/widgets/LockWidget.tsx` (line 3) | `{ motion }` |
| `components/widgets/AlarmWidget.tsx` (line 2) | `{ motion }` |
| `components/widgets/VacuumWidget.tsx` (line 3) | `{ motion }` |
| `components/widgets/CameraWidget.tsx` (line 1) | `{ motion }` |
| `components/widgets/GreetingWidget.tsx` (line 1) | `{ motion }` |
| `components/widgets/TimerWidget.tsx` (line 2) | `{ motion }` |
| `components/widgets/CounterWidget.tsx` (line 2) | `{ motion }` |
| `components/widgets/ButtonWidget.tsx` (line 2) | `{ motion }` |
| `components/widgets/ScriptWidget.tsx` (line 2) | `{ motion }` |
| `components/widgets/SceneEntityWidget.tsx` (line 2) | `{ motion }` |
| `components/widgets/AutomationWidget.tsx` (line 2) | `{ motion }` |
| `components/widgets/DigitalClock.tsx` (line 2) | `{ motion }` |
| `components/widgets/AnalogClock.tsx` (line 2) | `{ motion }` |
| `components/widgets/CalendarWidget.tsx` (line 2) | `{ motion }` |
| `components/widgets/MapWidget.tsx` (line 2) | `{ motion, AnimatePresence }` |
| `components/widgets/NinaWarningWidget.tsx` (line 2) | `{ motion }` |
| `components/widgets/BinarySensorWidget.tsx` (line 1) | `{ motion }` |
| `components/widgets/StreamWidget.tsx` (line 3) | `{ motion, AnimatePresence }` |
| `components/widgets/HumidifierWidget.tsx` (line 2) | `{ motion }` |
| `components/widgets/IFrameWidget.tsx` (line 2) | `{ motion }` |

### Dialogs & Modals
| File | Import |
|------|--------|
| `components/widgets/ClimateControlDialog.tsx` (line 11) | `{ motion }` |
| `components/widgets/FanControlDialog.tsx` (line 12) | `{ motion }` |
| `components/widgets/CoverControlDialog.tsx` (line 12) | `{ motion }` |
| `components/widgets/LightControlDialog.tsx` (line 13) | `{ motion, AnimatePresence }` |
| `components/widgets/SwitchControlDialog.tsx` (line 12) | `{ motion }` |
| `components/widgets/SensorDetailDialog.tsx` (line 10) | `{ motion }` |
| `components/widgets/WeatherDetailDialog.tsx` (line 11) | `{ motion }` |
| `components/widgets/GenericEntityDialog.tsx` (line 8) | `{ motion }` |

### Feature Pages & Panels
| File | Import |
|------|--------|
| `components/SettingsPage.tsx` (line 3) | `{ motion, AnimatePresence }` |
| `components/AdminPanel.tsx` (line 5) | `{ motion, AnimatePresence }` |
| `components/ConfigurationSettings.tsx` (line 2) | `{ motion }` |
| `components/AppSettingsPage.tsx` (line 2) | `{ motion, AnimatePresence }` |
| `components/DocsPageNew.tsx` (line 2) | `{ motion, AnimatePresence }` |
| `components/ThemeEditor.tsx` (line 20) | `{ motion, AnimatePresence }` |
| `components/PageWidgetEditor.tsx` (line 2) | `{ motion, AnimatePresence }` |
| `components/Screensaver.tsx` (line 2) | `{ motion, AnimatePresence }` |
| `components/AppHealthMonitor.tsx` (line 3) | `{ motion, AnimatePresence }` |
| `components/ActiveTasksPanel.tsx` (line 5) | `{ motion, AnimatePresence }` |
| `components/TodoPanel.tsx` (line 4) | `{ motion, AnimatePresence }` |
| `components/NotificationCenter.tsx` (line 3) | `{ motion, AnimatePresence }` |
| `components/QuestionCard.tsx` (line 5) | `{ motion }` |
| `components/ORAAssistant.tsx` (line 5) | `{ motion, AnimatePresence }` |
| `components/KanbanBoard.tsx` (line 3) | `{ motion, AnimatePresence, Reorder }` |
| `components/SharePage.tsx` (line 2) | `{ motion, AnimatePresence }` |
| `components/NativeShare.tsx` (line 2) | `{ motion, AnimatePresence }` |
| `components/StreamSender.tsx` (line 2) | `{ motion, AnimatePresence }` |
| `components/UserSwitcher.tsx` (line 2) | `{ motion, AnimatePresence }` |
| `components/InfrastructureVisualization.tsx` (line 2) | `{ motion }` |
| `components/CustomPageRenderer.tsx` (line 3) | `{ motion }` |
| `components/CodingAgent.tsx` (line 2) | `{ motion, AnimatePresence }` |
| `components/AgentTab.tsx` (line 6) | `{ motion, AnimatePresence }` |
| `components/MessagingSettings.tsx` (line 3) | `{ motion }` |
| `components/ProviderManagement.tsx` (line 3) | `{ motion, AnimatePresence }` |
| `components/OverviewConfiguration.tsx` (line 2) | `{ motion, AnimatePresence }` |
| `components/YamlPageEditor.tsx` (line 31) | `{ motion, AnimatePresence }` |
| `components/EntityDiscoveryNotification.tsx` (line 1) | `{ motion, AnimatePresence }` |
| `components/scenes/SceneSelector.tsx` (line 3) | `{ motion, AnimatePresence }` |

### UI Primitives
| File | Import |
|------|--------|
| `components/ui/help-tip.tsx` (line 3) | `{ motion, AnimatePresence }` |
| `components/ui/color-picker.tsx` (line 2) | `{ motion }` |
| `components/ColorPicker.tsx` (line 2) | `{ motion }` |

### Page Designer
| File | Import |
|------|--------|
| `components/PageDesigner/WidgetPaletteV2.tsx` (line 7) | `{ motion, AnimatePresence }` |
| `components/PageDesigner/WidgetPalette.tsx` (line 2) | `{ motion }` |
| `components/PageDesigner/WidgetGroupDesignerDialog.tsx` (line 2) | `{ motion, AnimatePresence }` |
| `components/PageDesigner/TemplatePickerModal.tsx` (line 1) | `{ motion, AnimatePresence }` |
| `components/PageDesigner/index.tsx` (line 2) | `{ motion, AnimatePresence }` |

### Plugins
| File | Import |
|------|--------|
| `lib/plugins/examples/weather-widget.tsx` (line 2) | `{ motion }` |

---

## 2. CSS Animation Classes

### 2a. Core Animation Keyframes (`index.css`)

| Keyframe | File:Line | Purpose |
|----------|-----------|---------|
| `@keyframes widget-enter` | `index.css:752` | Widget entrance — opacity 0→1, translateY 8px→0, scale 0.98→1 |
| `@keyframes page-enter` | `index.css:854` | Page transition — opacity 0→1, translateY 12px→0 |
| `@keyframes skeleton-shimmer` | `index.css:812` | Loading skeleton bg-position sweep |
| `@keyframes glow-breathe` | `index.css:895` | Active entity aura — opacity pulse 0.4↔0.7 |
| `@keyframes shimmer-sweep` | `index.css:920` | Glass card shimmer sweep — translateX sweep |
| `@keyframes status-pulse` | `index.css:975` | Status dot pulse — scale 1→1.6 with fade |
| `@keyframes value-flash` | `index.css:1021` | Value change flash — scale 1.05→1, opacity 0.6→1 |
| `@keyframes breathe-ring` | `index.css:1061` | Connection breathing ring — scale 1→1.3, opacity 0.15→0.05 |
| `@keyframes card-pulse` | `index.css:1331` | Pulsed card glow — box-shadow breathing |
| `@keyframes connection-pulse` | `index.css:1951` | Connection indicator ripple — box-shadow 0→8px |

### 2b. Animation Utility Classes

| Class | File:Line | Uses |
|-------|-----------|------|
| `.theme-transition` | `index.css:445` | Background-color, color, border-color transitions (uses `--transition-duration` var, default 0.4s) |
| `.widget-animate-in` | `index.css:763` | Applies `widget-enter` animation, 0.4s cubic-bezier(0.16, 1, 0.3, 1) |
| `.widget-animate-in:nth-child(1-10)` | `index.css:767-776` | Staggered delays 0.02s–0.20s for cascading widget entrance |
| `.page-transition-enter` | `index.css:865` | Applies `page-enter` animation, 0.35s cubic-bezier(0.16, 1, 0.3, 1) |
| `.reduce-animations` / `.reduce-animations *` | `index.css:1558-1562` | Force 0.01ms animation/transition duration — disables ALL animations |
| `.glass-card-interactive` | `index.css:781-790` | Hover transform + box-shadow transitions |
| `.glass-card-shimmer` | `index.css:931-951` | Hover-triggered shimmer sweep pseudo-element |

### 2c. Page Transition Usage in Components

- **`App.tsx`** (lines 87, 711, 728, 744, 760, 776): `page-transition-enter` on section wrappers
- **`App.tsx`** (lines 715, 732, 748, 764, 781): `widget-animate-in` with custom `animationDelay` on each widget
- **`App.tsx`** (line 449): `theme-transition` on root div, conditional `reduce-animations` class
- **`App.tsx`** (lines 508, 560): `theme-transition` on background overlay and glass-header
- **`components/SharePage.tsx`** (line 51): `page-transition-enter`
- **`components/SimpleDashboard.tsx`** (line 21): `page-transition-enter`
- **`components/AppSettingsPage.tsx`** (line 202): `page-transition-enter`
- **`components/StreamSender.tsx`** (line 246): `page-transition-enter`
- **`components/DocsPageNew.tsx`** (line 202): `page-transition-enter`
- **`contexts/ThemeContext.tsx`** (line 905): `theme-transition` on theme wrapper div
- **Nearly all widgets**: `theme-transition` on `glass-card` wrappers

---

## 3. SplashScreen Component

### Location: `components/SplashScreen.tsx`

### Props
```typescript
interface SplashScreenProps {
  onComplete: () => void
  duration?: number  // default: 2200ms
}
```

### Behavior
- Displays a full-screen animated splash with:
  - **Orbital rings logo** — rotating ring animation (20s linear rotation) with breathing scale/opacity on inner/outer rings, an orbiting dot, and pulse core
  - **"rumahl" brand text** — spring-animated scale entrance (stiffness: 200, damping: 20)
  - **Eased progress bar** — width animated from 0%→100% using ease-out increments
  - **Status messages** — cycling through 4 German status messages via `AnimatePresence mode="wait"`
- Exit animation: opacity→0, scale→1.02 over 0.5s with cubic-bezier(0.16, 1, 0.3, 1)
- Calls `onComplete()` after 500ms delay once progress reaches 100%

### Usage: `App.tsx` (lines 155–165, 404–405)
```typescript
// Skip splash in new tabs or direct page navigation
const [showSplash, setShowSplash] = useState(() => {
  const isNewTab = window.opener !== null || document.referrer.includes(window.location.hostname)
  const isDirectPage = window.location.pathname.startsWith('/app-settings/') || ...
  return !isNewTab && !isDirectPage
})

// Render gate — splash blocks entire app until complete
if (showSplash) {
  return <SplashScreen onComplete={() => setShowSplash(false)} />
}
```

---

## 4. ThemeContext.tsx — ThemeCssResponse & Capability Types

### Location: `contexts/ThemeContext.tsx`

### ThemeCssResponse (line 159)
```typescript
export interface ThemeCssResponse {
  theme_id: string
  source: string
  css_variables: Record<string, string>
  additional_css?: string
  css_url?: string
  css_urls: string[]           // File-based: CSS file URLs via <link>
  js_urls: string[]            // File-based: JS file URLs via <script>
  assets_base_url?: string
  fonts: ThemeFont[]
  icon_font?: ThemeIconConfig
  html_templates: Record<string, string>  // name → URL
  capabilities?: ThemeCapabilities
  widget_templates?: WidgetTemplate[]
}
```

### ThemeCapabilities (line 152)
```typescript
export interface ThemeCapabilities {
  design_modes?: ThemeDesignMode[]    // Time-based design modes (day/evening/night)
  auto_behavior?: ThemeAutoBehavior   // Auto-switching behavior (time/sun/custom/disabled)
  accent_control?: ThemeAccentControl // Accent color control (user/force/presets)
  glass_control?: ThemeGlassControl   // Glass effect control
  custom_settings?: ThemeSetting[]    // Arbitrary theme settings (toggle/select/slider/color/text)
}
```

### ThemeDesignMode (line 70)
```typescript
export interface ThemeDesignMode {
  id: string
  name: string
  icon?: string
  time_start?: string     // "HH:MM"
  time_end?: string       // "HH:MM" (supports overnight ranges)
  css_variables: Record<string, string>
}
```

### ThemeAutoBehavior (line 84)
```typescript
export interface ThemeAutoBehavior {
  mode: 'time' | 'sun' | 'custom' | 'disabled'
  time_ranges: Record<string, TimeRange>
  default_mode?: string
}
```

### ThemeAccentControl (line 97)
```typescript
export interface ThemeAccentControl {
  mode: 'user' | 'force' | 'presets'
  forced_color?: string
  presets?: AccentPreset[]
}
```

### ThemeGlassControl (line 104)
```typescript
export interface ThemeGlassControl {
  mode: 'user' | 'force_on' | 'force_off' | 'force_values'
  blur?: string       // e.g. "40px"
  opacity?: string     // e.g. "0.35"
}
```

### ThemeSetting (line 116)
```typescript
export interface ThemeSetting {
  id: string
  name: string
  name_key?: string              // i18n key
  description?: string
  description_key?: string       // i18n key
  setting_type: 'toggle' | 'select' | 'slider' | 'color' | 'text'
  default_value: unknown
  options?: ThemeSettingOption[]
  min?: number
  max?: number
  step?: number
  css_variable?: string
}
```

### ThemeContextType (line 181) — key animation-related fields:
- `capabilities: ThemeCapabilities | null`
- `accentLocked: boolean` — from `capabilities.accent_control.mode === 'force'`
- `forcedAccent: string | null` — from `capabilities.accent_control.forced_color`
- `glassLocked: boolean` — from `capabilities.glass_control.mode !== 'user'`
- `forcedGlass: { blur?: string; opacity?: string } | null` — from `capabilities.glass_control`

---

## 5. ThemeEditor — Animation-Related Fields

### Location: `components/ThemeEditor.tsx`

### EditorState (line 46)
```typescript
interface EditorState {
  colors: Record<string, string>
  fonts: { heading: string; body: string; mono: string }
  layout: { navPosition: string; headerStyle: string; cardRadius: string; widgetGap: string }
  effects: {
    glassBlur: string         // default: '40px'
    glassOpacity: string      // default: '0.35'
    transitionDuration: string // default: '0.4s'
  }
}
```

### Animation-relevant UI in ThemeEditor:
- **Effects Tab**: Sliders for `glassBlur`, `glassOpacity`, and `transitionDuration` (range 0–1s, step 0.1s)
  - Lines 435–447: Transition duration slider
- **CSS Variables Output** (line 886):
  ```
  --transition-duration: ${effects.transitionDuration};
  ```
- **Transition usage** throughout editor UI: `transition-all`, `transition-transform`, `transition: 'background-color 0.4s ease, color 0.4s ease'` (line 724)
- **motion.div** for tab/content transitions (lines 692–716): scale/opacity with `duration: 0.15`
- **No explicit "animation type" field** — only `transitionDuration` for CSS transitions

---

## 6. package.json — framer-motion Version

`frontend/package.json` line 68:
```json
"framer-motion": "^12.6.2"
```

### Resolved/Locked Version (`package-lock.json`):
- **framer-motion**: `12.23.25` (resolved from `^12.6.2`)
- **motion-dom**: `12.23.23` (dependency)
- **motion-utils**: `12.23.6` (dependency)

### Bundle configuration (`vite.config.ts` line 41):
```typescript
'vendor-motion': ['framer-motion'],
```
Framer-motion is extracted into its own vendor chunk for code splitting.

---

## 7. Animation Library References

### framer-motion
- **87 files** import from `framer-motion` (see section 1)
- Extracted into dedicated `vendor-motion` chunk via Vite config
- Used for: widget tap feedback (`whileTap: { scale: 0.98 }`), page transitions (`AnimatePresence`), modal animations, loading spinners, navigation indicators, splash screen, Kanban reorder

### tw-animate-css
- `package.json`: `"tw-animate-css": "^1.2.4"` (resolved: `1.4.0`)
- `index.css` line 2: `@import "tw-animate-css";`
- This provides Tailwind v4 `animate-in`, `animate-out`, `fade-in-*`, `zoom-in-*`, `slide-in-from-*` classes
- Used extensively in Radix UI primitives:
  - `components/ui/dropdown-menu.tsx` — `data-[state=open]:animate-in`, `data-[state=closed]:animate-out`, `fade-out-0`, `fade-in-0`, `zoom-out-95`, `zoom-in-95`, `slide-in-from-top-2`, etc.
  - `components/ui/select.tsx` — same pattern
  - `components/ui/sheet.tsx` — `slide-in-from-right`, `slide-out-to-right`, etc.
  - `components/ui/dialog.tsx` — `animate-in`, `fade-in-0`
  - `components/ui/drawer.tsx` — same pattern
  - `components/ui/tooltip.tsx` — `animate-in`, `fade-in-0`, `zoom-in-95`
  - `components/ui/context-menu.tsx` — same pattern
  - `components/ui/navigation-menu.tsx` — `data-[motion^=from-]:animate-in`, `data-[motion^=to-]:animate-out`

### motion.dev / @motionone
- **NO references found** — zero hits for `motion.dev`, `@motionone`, `motion-one` anywhere in the frontend

### Other animation-related dependencies
- **`@dnd-kit/core`** (`^6.3.1`) + **`@dnd-kit/sortable`** (`^10.0.0`) — drag-and-drop (no framer-motion dependency)
- **`embla-carousel-react`** (`^8.5.2`) — carousel (no framer-motion dependency)
- **No GSAP, anime.js, react-spring, or other animation libraries**

---

## Architecture Summary

The animation architecture has **three layers**:

1. **CSS Keyframes** (`index.css`): 10 `@keyframes` for page transitions, widget entrances, shimmer effects, glow pulses, and status indicators. Two utility classes (`page-transition-enter`, `widget-animate-in`) drive main layout animations via CSS only — no JavaScript.

2. **Tailwind tw-animate-css**: Provides declarative `animate-in`/`animate-out` classes used by Radix UI primitives (dropdowns, sheets, dialogs, tooltips, etc.) for open/close transitions.

3. **framer-motion** (`^12.6.2` / resolved `12.23.25`): Used in 87 component files for interactive animations (tap feedback, layout animations, `AnimatePresence` for mount/unmount transitions, `Reorder` for Kanban drag-and-drop). The library is code-split into its own vendor chunk.

The `--transition-duration` CSS variable (default `0.4s`) is set by the backend theme system and editable in ThemeEditor. It governs the `.theme-transition` class used across all glass cards and headers for smooth color/border transitions.

The global `.reduce-animations` class (toggled via `reducedAnimations` state in App.tsx) forces all animation and transition durations to `0.01ms`, providing an accessibility-focused animation disable.

---

## Start Here

Open `App.tsx` first — it's the root where `SplashScreen` is gated, `theme-transition` and `reduce-animations` classes are applied to the root div, `page-transition-enter` and `widget-animate-in` classes are used for page content, and `motion/AnimatePresence` drives modal/page overlays.

For the theme/animation bridge, open `contexts/ThemeContext.tsx` to understand how `--transition-duration` and capability-driven animation controls flow from backend to CSS.
