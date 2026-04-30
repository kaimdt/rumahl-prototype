import { useState, useEffect, useCallback } from 'react'
import {
  Check,
  UploadSimple,
  Code,
  Globe,
  File,
  BookOpen,
  CaretDown,
  CaretRight,
  User,
  Monitor,
} from '@phosphor-icons/react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { usePageNavigation, type PageSettings } from '@/contexts/PageNavigationContext'
import { CARD_STYLE_PRESETS, DEFAULT_BACKGROUND_PRESETS } from '@/lib/defaults'
import { toast } from 'sonner'
import { getBackendUrl } from '@/lib/config'

const API_BASE = getBackendUrl()

function getAuthToken(): string {
  const raw = localStorage.getItem('ha-auth-token') ?? sessionStorage.getItem('ha-auth-token')
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === 'string' ? parsed : ''
  } catch {
    return raw
  }
}

interface PageSettingsDialogProps {
  open: boolean
  onClose: () => void
  pageId: string
  pageName: string
}

type SettingsTab = 'page' | 'global' | 'docs'

export function PageSettingsDialog({ open, onClose, pageId, pageName }: PageSettingsDialogProps) {
  const { pageSettings, savePageSettings, deletePageSettings, globalCustomCss, setGlobalCustomCss, userCustomCss, setUserCustomCss } = usePageNavigation()
  const existing = pageSettings[pageId]
  const [activeTab, setActiveTab] = useState<SettingsTab>('page')

  const [cardStyle, setCardStyle] = useState(existing?.card_style || 'default')
  const [backgroundType, setBackgroundType] = useState<string | null>(existing?.background_type || null)
  const [backgroundUrl, setBackgroundUrl] = useState('')
  const [hideHeader, setHideHeader] = useState(existing?.hide_header || false)
  const [padding, setPadding] = useState(existing?.padding ?? 16)
  const [customCss, setCustomCss] = useState(existing?.custom_css || '')
  const [globalCss, setGlobalCss] = useState(globalCustomCss)
  const [userCss, setUserCss] = useState(userCustomCss)
  const [isUploading, setIsUploading] = useState(false)

  // Reset state when dialog opens or pageId changes
  useEffect(() => {
    if (open) {
      const s = pageSettings[pageId]
      setCardStyle(s?.card_style || 'default')
      setBackgroundType(s?.background_type || null)
      setBackgroundUrl(
        s?.background_config?.type === 'static' ? s.background_config.url || '' : ''
      )
      setHideHeader(s?.hide_header || false)
      setPadding(s?.padding ?? 16)
      setCustomCss(s?.custom_css || '')
      setGlobalCss(globalCustomCss)
      setUserCss(userCustomCss)
    }
  }, [open, pageId, pageSettings, globalCustomCss, userCustomCss])

  const handleUpload = useCallback(async (file: globalThis.File) => {
    const token = getAuthToken()
    if (!token) {
      toast.error('Nicht authentifiziert')
      return
    }
    setIsUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`${API_BASE}/api/uploads/background`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })
      if (res.ok) {
        const data = await res.json()
        setBackgroundUrl(data.url || data.file_name || '')
        toast.success('Bild hochgeladen')
      } else {
        toast.error('Upload fehlgeschlagen')
      }
    } catch {
      toast.error('Upload-Fehler')
    } finally {
      setIsUploading(false)
    }
  }, [])

  const handleSave = () => {
    const bgConfig = backgroundType === 'static' && backgroundUrl
      ? { type: 'static', url: backgroundUrl, position: 'center', size: 'cover', opacity: 100, blur: 0, brightness: 100 }
      : null

    savePageSettings(pageId, {
      card_style: cardStyle,
      background_type: backgroundType,
      background_config: bgConfig,
      custom_css: customCss || null,
      hide_header: hideHeader,
      padding,
    })
    toast.success('Seiteneinstellungen gespeichert')
    onClose()
  }

  const handleSaveGlobal = () => {
    setGlobalCustomCss(globalCss)
    toast.success('Globales CSS gespeichert')
  }

  const handleSaveUserCss = () => {
    setUserCustomCss(userCss)
    toast.success('Benutzer-CSS gespeichert')
  }

  const handleReset = () => {
    deletePageSettings(pageId)
    toast.success('Seiteneinstellungen zurückgesetzt')
    onClose()
  }

  const ScopeBadge = ({ scope }: { scope: 'global' | 'user' | 'page' }) => {
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

  const tabs: { id: SettingsTab; label: string; icon: typeof File }[] = [
    { id: 'page', label: 'Seite', icon: File },
    { id: 'global', label: 'Global CSS', icon: Globe },
    { id: 'docs', label: 'CSS Referenz', icon: BookOpen },
  ]

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base text-foreground">Seiteneinstellungen</DialogTitle>
          <DialogDescription className="text-xs text-foreground/60">
            Einstellungen für „{pageName}" und globale CSS-Regeln.
          </DialogDescription>
        </DialogHeader>

        {/* Tab bar */}
        <div className="flex gap-1 p-1 rounded-xl bg-foreground/5 mb-1">
          {tabs.map(tab => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-accent/15 text-accent shadow-sm'
                    : 'text-foreground/60 hover:text-foreground hover:bg-foreground/5'
                }`}
              >
                <Icon size={14} weight={isActive ? 'fill' : 'regular'} />
                {tab.label}
              </button>
            )
          })}
        </div>

        {/* ── Page Settings Tab ── */}
        {activeTab === 'page' && (
          <div className="space-y-5">
            {/* Card Style Override */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <h4 className="text-sm font-medium text-foreground">Kartenstil</h4>
                <ScopeBadge scope="page" />
              </div>
              <p className="text-xs text-foreground/60 mb-3">
                Standard: Globaler Stil. Wähle einen anderen Stil nur für diese Seite.
              </p>
              <div className="grid grid-cols-3 gap-1.5 max-h-[200px] overflow-y-auto pr-1">
                {CARD_STYLE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => setCardStyle(preset.id)}
                    className={`
                      relative p-2.5 rounded-lg border transition-all text-left
                      ${cardStyle === preset.id
                        ? 'border-accent bg-accent/10'
                        : 'border-foreground/10 bg-foreground/5 hover:border-foreground/20'
                      }
                    `}
                  >
                    <p className="text-[11px] font-medium truncate text-foreground">{preset.label}</p>
                    {cardStyle === preset.id && (
                      <Check size={12} weight="bold" className="absolute top-1.5 right-1.5 text-accent" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Background Override */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <h4 className="text-sm font-medium text-foreground">Hintergrund (Seitenspezifisch)</h4>
                <ScopeBadge scope="page" />
              </div>
              <p className="text-xs text-foreground/60 mb-3">
                Leer lassen für den globalen Hintergrund.
              </p>

              <div className="flex gap-2 mb-3">
                {[
                  { type: null, label: 'Global' },
                  { type: 'static', label: 'Bild' },
                  { type: 'none', label: 'Kein Hintergrund' },
                ].map(({ type, label }) => (
                  <button
                    key={label}
                    onClick={() => setBackgroundType(type)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      backgroundType === type
                        ? 'bg-accent/15 text-accent border border-accent/30'
                        : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/10 border border-transparent'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {backgroundType === 'static' && (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={backgroundUrl}
                    onChange={(e) => setBackgroundUrl(e.target.value)}
                    placeholder="Bild-URL oder hochladen..."
                    className="w-full px-3 py-2 rounded-lg bg-foreground/5 border border-foreground/10 text-sm text-foreground placeholder-foreground/30 focus:outline-none focus:ring-1 focus:ring-accent/50"
                  />
                  <div className="grid grid-cols-4 gap-1.5">
                    {DEFAULT_BACKGROUND_PRESETS.slice(0, 4).map((preset, i) => (
                      <button
                        key={i}
                        onClick={() => setBackgroundUrl(preset.url)}
                        className={`aspect-video rounded-lg overflow-hidden border-2 transition-all ${
                          backgroundUrl === preset.url ? 'border-accent' : 'border-foreground/10 hover:border-foreground/20'
                        }`}
                      >
                        <img
                          src={preset.url}
                          alt={preset.name}
                          className="w-full h-full object-cover"
                        />
                      </button>
                    ))}
                  </div>
                  <label className="flex items-center gap-2 px-3 py-2 rounded-lg bg-foreground/5 hover:bg-foreground/10 cursor-pointer transition-colors border border-foreground/10">
                    <UploadSimple size={16} className="text-foreground/60" />
                    <span className="text-xs text-foreground/60">
                      {isUploading ? 'Wird hochgeladen...' : 'Bild hochladen'}
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) handleUpload(file)
                      }}
                    />
                  </label>
                </div>
              )}
            </div>

            {/* Hide Header */}
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-medium text-foreground">Seitentitel ausblenden</h4>
                  <ScopeBadge scope="page" />
                </div>
                <p className="text-xs text-foreground/60">Blendet den Titel der Seite aus.</p>
              </div>
              <button
                onClick={() => setHideHeader(!hideHeader)}
                className={`relative w-10 h-5 rounded-full transition-colors ${
                  hideHeader ? 'bg-accent' : 'bg-foreground/20'
                }`}
              >
                <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform shadow-sm ${
                  hideHeader ? 'translate-x-5' : ''
                }`} />
              </button>
            </div>

            {/* Padding */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-medium text-foreground">Innenabstand</h4>
                    <ScopeBadge scope="page" />
                  </div>
                  <p className="text-xs text-foreground/60">Abstand zwischen Inhalt und Seitenrand.</p>
                </div>
                <span className="text-xs font-mono text-foreground/70">{padding}px</span>
              </div>
              <input
                type="range"
                min={0}
                max={48}
                step={4}
                value={padding}
                onChange={(e) => setPadding(Number(e.target.value))}
                className="w-full accent-accent"
              />
            </div>

            {/* Per-page Custom CSS */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <h4 className="text-sm font-medium text-foreground">
                  <Code size={14} className="inline mr-1.5 text-accent" weight="bold" />
                  Eigenes CSS (nur diese Seite)
                </h4>
                <ScopeBadge scope="page" />
              </div>
              <p className="text-xs text-foreground/60 mb-2">
                Zusätzliches CSS, das nur auf dieser Seite angewendet wird. Überschreibt globales CSS.
              </p>
              <textarea
                value={customCss}
                onChange={(e) => setCustomCss(e.target.value)}
                placeholder=".glass-card { border-radius: 1rem; }"
                rows={4}
                className="w-full px-3 py-2 rounded-lg bg-foreground/5 border border-foreground/10 text-xs font-mono text-foreground placeholder-foreground/30 focus:outline-none focus:ring-1 focus:ring-accent/50 resize-y"
              />
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-2 border-t border-foreground/10">
              <button
                onClick={handleSave}
                className="flex-1 px-4 py-2.5 rounded-xl bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors"
              >
                Speichern
              </button>
              <button
                onClick={handleReset}
                className="px-4 py-2.5 rounded-xl bg-foreground/10 text-foreground text-sm hover:bg-foreground/15 transition-colors"
              >
                Zurücksetzen
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl bg-foreground/10 text-foreground text-sm hover:bg-foreground/15 transition-colors"
              >
                Abbrechen
              </button>
            </div>
          </div>
        )}

        {/* ── Global CSS Tab ── */}
        {activeTab === 'global' && (
          <div className="space-y-5">
            {/* Global CSS (all users) */}
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h4 className="text-sm font-medium text-foreground">
                  <Globe size={14} className="inline mr-1.5 text-accent" weight="fill" />
                  Globales CSS
                </h4>
                <ScopeBadge scope="global" />
              </div>
              <p className="text-xs text-foreground/60 mb-3">
                CSS-Regeln, die für alle Benutzer auf allen Seiten gelten.
              </p>
              <textarea
                value={globalCss}
                onChange={(e) => setGlobalCss(e.target.value)}
                placeholder={`/* Beispiel: alle Karten abrunden */\n.glass-card {\n  border-radius: 1.5rem;\n  border: 1px solid rgba(255,255,255,0.1);\n}`}
                rows={6}
                className="w-full px-3 py-2 rounded-lg bg-foreground/5 border border-foreground/10 text-xs font-mono text-foreground placeholder-foreground/30 focus:outline-none focus:ring-1 focus:ring-accent/50 resize-y"
              />
              <div className="flex gap-2 mt-2">
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

            {/* Per-user CSS */}
            <div className="border-t border-foreground/10 pt-4">
              <div className="flex items-center gap-2 mb-1">
                <h4 className="text-sm font-medium text-foreground">
                  <User size={14} className="inline mr-1.5 text-purple-400" weight="fill" />
                  Benutzer-CSS
                </h4>
                <ScopeBadge scope="user" />
              </div>
              <p className="text-xs text-foreground/60 mb-3">
                CSS-Regeln, die nur für dich gelten. Überschreibt globales CSS, wird von seitenspezifischem CSS überschrieben.
              </p>
              <textarea
                value={userCss}
                onChange={(e) => setUserCss(e.target.value)}
                placeholder={`/* Beispiel: eigene Akzentfarbe */\n:root {\n  --accent: #8b5cf6;\n}`}
                rows={6}
                className="w-full px-3 py-2 rounded-lg bg-foreground/5 border border-foreground/10 text-xs font-mono text-foreground placeholder-foreground/30 focus:outline-none focus:ring-1 focus:ring-accent/50 resize-y"
              />
              <div className="flex gap-2 mt-2">
                <button
                  onClick={handleSaveUserCss}
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

            {/* CSS priority info */}
            <div className="rounded-lg bg-foreground/5 border border-foreground/8 p-3">
              <h5 className="text-[11px] font-semibold text-foreground/70 uppercase tracking-wider mb-2">CSS-Priorität</h5>
              <ol className="text-[11px] text-foreground/60 space-y-1 list-decimal list-inside">
                <li>Seitenspezifisches CSS <span className="text-foreground/40">(höchste Priorität)</span></li>
                <li>Benutzer-CSS <span className="text-foreground/40">(nur für dich)</span></li>
                <li>Globales CSS <span className="text-foreground/40">(alle Benutzer)</span></li>
              </ol>
            </div>
          </div>
        )}

        {/* ── CSS Reference / Documentation Tab ── */}
        {activeTab === 'docs' && (
          <div className="space-y-4 text-foreground">
            <p className="text-xs text-foreground/60">
              Referenz der verfügbaren CSS-Klassen und Selektoren für das Dashboard-Styling.
            </p>

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

            <CssDocSection title="Typografie & Utilities">
              <CssDocEntry selector=".text-foreground" description="Standard-Textfarbe" />
              <CssDocEntry selector=".text-accent" description="Akzent-Textfarbe" />
              <CssDocEntry selector=".bg-background" description="App-Hintergrundfarbe" />
              <CssDocEntry selector=".theme-transition" description="Sanfte Übergangsanimation bei Farbwechsel" />
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
                  title="Custom Schriftart"
                  code={`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap');\n\nbody {\n  font-family: 'Inter', sans-serif;\n}`}
                />
              </div>
            </CssDocSection>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── CSS Documentation helper components ──

function CssDocSection({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-xl border border-foreground/10 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-medium text-foreground hover:bg-foreground/5 transition-colors"
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
          className="text-[10px] text-accent hover:text-accent/80 transition-colors"
        >
          {copied ? '✓ Kopiert' : 'Kopieren'}
        </button>
      </div>
      <pre className="px-3 py-2 text-[10px] font-mono text-foreground/80 whitespace-pre-wrap">{code}</pre>
    </div>
  )
}
