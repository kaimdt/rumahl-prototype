import { useState, useEffect } from 'react'
import {
  Code,
  Globe,
  User,
  BookOpen,
  CaretDown,
  CaretRight,
  File,
  Clipboard,
  Check,
} from '@phosphor-icons/react'
import { usePageNavigation } from '@/contexts/PageNavigationContext'
import { CssCodeEditor } from '@/components/CssCodeEditor'
import { toast } from 'sonner'

// ── Scope Badge ─────────────────────────────────────────────────────
function ScopeBadge({ scope }: { scope: 'global' | 'user' | 'page' }) {
  const config = {
    global: { bg: 'bg-blue-500/10 text-blue-400', icon: <Globe size={8} weight="fill" />, label: 'Alle' },
    user: { bg: 'bg-purple-500/10 text-purple-400', icon: <User size={8} weight="fill" />, label: 'User' },
    page: { bg: 'bg-amber-500/10 text-amber-400', icon: <File size={8} weight="fill" />, label: 'Seite' },
  }[scope]
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] font-semibold uppercase tracking-wider ${config.bg}`}
      title={{ global: 'Gilt für alle Benutzer', user: 'Gilt pro Benutzer', page: 'Gilt nur für diese Seite' }[scope]}>
      {config.icon}
      {config.label}
    </span>
  )
}

// ── CSS Documentation helper components ─────────────────────────────

function CssDocSection({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-xl border border-foreground/10 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-medium text-foreground hover:bg-foreground/5 transition-colors"
      >
        <span>{title}</span>
        {open ? <CaretDown size={14} weight="bold" className="text-foreground/40" /> : <CaretRight size={14} weight="bold" className="text-foreground/40" />}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-1.5 border-t border-foreground/5">
          {children}
        </div>
      )}
    </div>
  )
}

function CssDocEntry({ selector, description }: { selector: string; description: string }) {
  return (
    <div className="flex items-start gap-2 py-1">
      <code className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent font-mono shrink-0 mt-0.5">{selector}</code>
      <span className="text-[11px] text-foreground/70">{description}</span>
    </div>
  )
}

function CssExample({ title, code }: { title: string; code: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="rounded-lg bg-foreground/5 border border-foreground/8 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-foreground/5">
        <span className="text-[11px] font-medium text-foreground/70">{title}</span>
        <button
          onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
          className="flex items-center gap-1 text-[10px] text-accent hover:text-accent/80 transition-colors"
        >
          {copied ? <><Check size={10} /> Kopiert</> : <><Clipboard size={10} /> Kopieren</>}
        </button>
      </div>
      <pre className="px-3 py-2 text-[10px] font-mono text-foreground/80 whitespace-pre-wrap">{code}</pre>
    </div>
  )
}

// ── Main CSS Settings Component ─────────────────────────────────────

export function CssSettingsSection() {
  const { globalCustomCss, setGlobalCustomCss, userCustomCss, setUserCustomCss } = usePageNavigation()
  const [globalCss, setGlobalCss] = useState(globalCustomCss)
  const [userCss, setUserCss] = useState(userCustomCss)
  const [activeTab, setActiveTab] = useState<'global' | 'user' | 'docs'>('global')

  useEffect(() => {
    setGlobalCss(globalCustomCss)
  }, [globalCustomCss])

  useEffect(() => {
    setUserCss(userCustomCss)
  }, [userCustomCss])

  const handleSaveGlobal = () => {
    setGlobalCustomCss(globalCss)
    toast.success('Globales CSS gespeichert')
  }

  const handleSaveUser = () => {
    setUserCustomCss(userCss)
    toast.success('Benutzer-CSS gespeichert')
  }

  const tabs = [
    { id: 'global' as const, label: 'Global', icon: Globe },
    { id: 'user' as const, label: 'Benutzer', icon: User },
    { id: 'docs' as const, label: 'CSS Referenz', icon: BookOpen },
  ]

  return (
    <div className="space-y-4">
      {/* Sub-tab bar */}
      <div className="flex gap-1 p-1 rounded-xl bg-foreground/5">
        {tabs.map(tab => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-medium transition-all ${
                isActive
                  ? 'bg-accent/15 text-accent shadow-sm'
                  : 'text-foreground/60 hover:text-foreground hover:bg-foreground/5'
              }`}
            >
              <Icon size={13} weight={isActive ? 'fill' : 'regular'} />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* ── Global CSS ── */}
      {activeTab === 'global' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Code size={14} className="text-accent" weight="bold" />
            <span className="text-xs font-medium text-foreground">Globales CSS</span>
            <ScopeBadge scope="global" />
          </div>
          <p className="text-[11px] text-foreground/50">
            CSS-Regeln, die für alle Benutzer auf allen Seiten gelten. Wird von Benutzer- und Seiten-CSS überschrieben.
          </p>
          <CssCodeEditor
            value={globalCss}
            onChange={setGlobalCss}
            placeholder={`/* Beispiel: alle Karten abrunden */\n.glass-card {\n  border-radius: 1.5rem;\n}`}
            minHeight="200px"
          />
          <div className="flex gap-2">
            <button
              onClick={handleSaveGlobal}
              className="flex-1 px-3 py-2 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 transition-colors"
            >
              Globales CSS speichern
            </button>
            <button
              onClick={() => { setGlobalCss(''); setGlobalCustomCss(''); toast.success('Globales CSS gelöscht') }}
              className="px-3 py-2 rounded-lg bg-foreground/10 text-foreground text-xs hover:bg-foreground/15 transition-colors"
            >
              Leeren
            </button>
          </div>
        </div>
      )}

      {/* ── User CSS ── */}
      {activeTab === 'user' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Code size={14} className="text-purple-400" weight="bold" />
            <span className="text-xs font-medium text-foreground">Benutzer-CSS</span>
            <ScopeBadge scope="user" />
          </div>
          <p className="text-[11px] text-foreground/50">
            CSS-Regeln, die nur für dich gelten. Überschreibt globales CSS, wird von seitenspezifischem CSS überschrieben.
          </p>
          <CssCodeEditor
            value={userCss}
            onChange={setUserCss}
            placeholder={`/* Beispiel: eigene Akzentfarbe */\n:root {\n  --accent: #8b5cf6;\n}`}
            minHeight="200px"
          />
          <div className="flex gap-2">
            <button
              onClick={handleSaveUser}
              className="flex-1 px-3 py-2 rounded-lg bg-purple-500 text-white text-xs font-medium hover:bg-purple-500/90 transition-colors"
            >
              Benutzer-CSS speichern
            </button>
            <button
              onClick={() => { setUserCss(''); setUserCustomCss(''); toast.success('Benutzer-CSS gelöscht') }}
              className="px-3 py-2 rounded-lg bg-foreground/10 text-foreground text-xs hover:bg-foreground/15 transition-colors"
            >
              Leeren
            </button>
          </div>
        </div>
      )}

      {/* ── CSS Reference / Documentation ── */}
      {activeTab === 'docs' && (
        <div className="space-y-3">
          {/* CSS Priority info */}
          <div className="rounded-lg bg-foreground/5 border border-foreground/8 p-3">
            <h5 className="text-[11px] font-semibold text-foreground/70 uppercase tracking-wider mb-2">CSS-Priorität (niedrig → hoch)</h5>
            <ol className="text-[11px] text-foreground/60 space-y-1.5 list-decimal list-inside">
              <li className="flex items-center gap-2">
                <span className="list-item">Globales CSS</span>
                <ScopeBadge scope="global" />
              </li>
              <li className="flex items-center gap-2">
                <span className="list-item">Benutzer-CSS</span>
                <ScopeBadge scope="user" />
              </li>
              <li className="flex items-center gap-2">
                <span className="list-item">Seiten-CSS</span>
                <ScopeBadge scope="page" />
              </li>
            </ol>
          </div>

          <CssDocSection title="Karten & Container" defaultOpen>
            <CssDocEntry selector=".glass-card" description="Standard-Glasmorphismus-Karte (alle Widgets)" />
            <CssDocEntry selector=".widget-transparent" description="Widget ohne Karten-Hintergrund" />
            <CssDocEntry selector=".glass-card-solid" description="Karte mit solidem Hintergrund" />
            <CssDocEntry selector=".glass-card-flat" description="Flache Karte ohne Blur/Schatten" />
            <CssDocEntry selector=".glass-card-bordered" description="Karte nur mit Rahmen" />
            <CssDocEntry selector=".glass-card-neon" description="Karte mit Neon-Glow-Effekt" />
          </CssDocSection>

          <CssDocSection title="Layout & Seiten">
            <CssDocEntry selector=".space-y-4" description="Seiteninhalt-Wrapper mit Abständen" />
            <CssDocEntry selector="[data-page-id]" description="Container einer Seite (Attribut = Seiten-ID)" />
            <CssDocEntry selector=".page-content" description="Hauptinhalt-Container der aktuellen Seite" />
          </CssDocSection>

          <CssDocSection title="Navigation">
            <CssDocEntry selector=".navigation-menu" description="Untere Navigationsleiste" />
            <CssDocEntry selector=".nav-item" description="Einzelner Navigations-Eintrag" />
            <CssDocEntry selector=".nav-item-active" description="Aktiver Navigations-Eintrag" />
          </CssDocSection>

          <CssDocSection title="Farben (CSS Custom Properties)">
            <CssDocEntry selector="--background" description="Hintergrundfarbe der App" />
            <CssDocEntry selector="--foreground" description="Standard-Textfarbe" />
            <CssDocEntry selector="--accent" description="Akzentfarbe (Buttons, aktive Elemente)" />
            <CssDocEntry selector="--card" description="Kartenfarbe" />
            <CssDocEntry selector="--muted" description="Gedämpfte Farbe" />
            <CssDocEntry selector="--destructive" description="Fehler/Löschen-Farbe (Rot)" />
            <CssDocEntry selector="--radius" description="Standard-Rundungsradius" />
            <CssDocEntry selector="--border" description="Rahmenfarbe" />
            <CssDocEntry selector="--ring" description="Focus-Ring-Farbe" />
          </CssDocSection>

          <CssDocSection title="Widget-Typen (data-widget-type)">
            <CssDocEntry selector='[data-widget-type="toggle"]' description="Schalter-Widget" />
            <CssDocEntry selector='[data-widget-type="climate"]' description="Klima-Widget" />
            <CssDocEntry selector='[data-widget-type="light-slider"]' description="Licht-Slider" />
            <CssDocEntry selector='[data-widget-type="sensor"]' description="Sensor-Anzeige" />
            <CssDocEntry selector='[data-widget-type="weather"]' description="Wetter-Widget" />
            <CssDocEntry selector='[data-widget-type="camera"]' description="Kamera-Widget" />
            <CssDocEntry selector='[data-widget-type="media-player"]' description="Media-Player" />
            <CssDocEntry selector='[data-widget-type="scene-button"]' description="Szene-Button" />
            <CssDocEntry selector='[data-widget-type="greeting"]' description="Begrüßungs-Widget" />
            <CssDocEntry selector='[data-widget-type="clock"]' description="Uhr-Widget" />
            <CssDocEntry selector='[data-widget-type="spacer"]' description="Abstandshalter" />
            <CssDocEntry selector='[data-widget-type="page-link"]' description="Seitenlink-Widget" />
            <CssDocEntry selector='[data-widget-type="group"]' description="Widget-Gruppe" />
            <CssDocEntry selector='[data-widget-type="iframe"]' description="iFrame-Widget" />
          </CssDocSection>

          <CssDocSection title="Widget-Zustände">
            <CssDocEntry selector='[data-entity-state="on"]' description="Widget für Entität im Zustand 'on'" />
            <CssDocEntry selector='[data-entity-state="off"]' description="Widget für Entität im Zustand 'off'" />
            <CssDocEntry selector='[data-entity-state="unavailable"]' description="Widget für nicht erreichbare Entität" />
            <CssDocEntry selector=".widget-header" description="Kopfbereich eines Widgets (Titel)" />
            <CssDocEntry selector=".widget-value" description="Wertanzeige eines Sensor-Widgets" />
          </CssDocSection>

          <CssDocSection title="Typografie & Utilities">
            <CssDocEntry selector=".text-foreground" description="Standard-Textfarbe" />
            <CssDocEntry selector=".text-accent" description="Akzent-Textfarbe" />
            <CssDocEntry selector=".bg-background" description="App-Hintergrundfarbe" />
            <CssDocEntry selector=".theme-transition" description="Sanfte Übergangsanimation bei Farbwechsel" />
            <CssDocEntry selector=".truncate" description="Text mit ... abschneiden" />
            <CssDocEntry selector=".line-clamp-2" description="Text auf 2 Zeilen begrenzen" />
          </CssDocSection>

          <CssDocSection title="Screensaver & Overlays">
            <CssDocEntry selector=".screensaver" description="Bildschirmschoner-Overlay" />
            <CssDocEntry selector=".splash-screen" description="Ladebildschirm" />
            <CssDocEntry selector=".night-overlay" description="Nachtmodus-Overlay" />
          </CssDocSection>

          <CssDocSection title="Beispiele">
            <div className="space-y-2">
              <CssExample
                title="Alle Karten abrunden"
                code={`.glass-card {\n  border-radius: 2rem;\n}`}
              />
              <CssExample
                title="Akzentfarbe für Sensoren ändern"
                code={`[data-widget-type="sensor"] .text-accent {\n  color: #22c55e;\n}`}
              />
              <CssExample
                title="Navigation verstecken"
                code={`.navigation-menu {\n  display: none;\n}`}
              />
              <CssExample
                title="Karten-Schatten entfernen"
                code={`.glass-card {\n  box-shadow: none;\n}`}
              />
              <CssExample
                title="Eigene Akzentfarbe"
                code={`:root {\n  --accent: 265 80% 60%;\n}`}
              />
              <CssExample
                title="Custom Schriftart"
                code={`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap');\n\nbody {\n  font-family: 'Inter', sans-serif;\n}`}
              />
              <CssExample
                title="Seiten-spezifischer Hintergrund"
                code={`[data-page-id="home"] {\n  background: linear-gradient(135deg, #1a1a2e, #16213e);\n}`}
              />
              <CssExample
                title="Widget bei Hover vergrößern"
                code={`.glass-card:hover {\n  transform: scale(1.02);\n  transition: transform 0.2s ease;\n}`}
              />
            </div>
          </CssDocSection>
        </div>
      )}
    </div>
  )
}
