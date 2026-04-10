import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { useConfiguration } from '@/contexts/ConfigurationContext'
import type { BackgroundConfigData } from '@/contexts/ConfigurationContext'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Monitor,
  User,
  Image,
  VideoCamera,
  PaintBrush,
  CaretRight,
  Check,
  UploadSimple,
  Globe,
} from '@phosphor-icons/react'
import { CARD_STYLE_PRESETS, DEFAULT_BACKGROUND_PRESETS, DEFAULT_DASHBOARD_BACKGROUND_URL, getCardStyleClass } from '@/lib/defaults'
import { useLocalStorage } from '@/lib/storage'
import { toast } from 'sonner'

interface ConfigurationSettingsProps {
  settingsLocked?: boolean
}

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

export function ConfigurationSettings({ settingsLocked = false }: ConfigurationSettingsProps) {
  const { designMode, setDesignMode, user, device, background, savePreference, getPreference } = useConfiguration()
  const [showBackgroundEditor, setShowBackgroundEditor] = useState(false)
  const [globalCardStyle, setGlobalCardStyle] = useLocalStorage('ha-global-card-style', 'default')

  // Load global card style from backend on mount (populate localStorage)
  useEffect(() => {
    getPreference('global_card_style').then((val) => {
      if (val && val !== globalCardStyle) setGlobalCardStyle(val)
    }).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getPreference])

  const handleCardStyleChange = (styleId: string) => {
    setGlobalCardStyle(styleId)
    savePreference('global_card_style', styleId)
  }

  const ScopeBadge = ({ scope }: { scope: 'global' | 'user' | 'device' }) => {
    const config = {
      global: { bg: 'bg-blue-500/10 text-blue-400', icon: <Globe size={8} weight="fill" />, label: 'Alle' },
      user: { bg: 'bg-purple-500/10 text-purple-400', icon: <User size={8} weight="fill" />, label: 'User' },
      device: { bg: 'bg-orange-500/10 text-orange-400', icon: <Monitor size={8} weight="fill" />, label: 'Gerät' },
    }[scope]
    return (
      <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] font-semibold uppercase tracking-wider ${config.bg}`}
        title={{ global: 'Gilt für alle Benutzer', user: 'Gilt pro Benutzer', device: 'Gilt nur für dieses Gerät' }[scope]}>
        {config.icon}
        {config.label}
      </span>
    )
  }

  return (
    <div className="space-y-6">
      <div className="glass-card rounded-2xl p-5 theme-transition">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h4 className="text-base font-semibold text-foreground">Oberflaeche & Design</h4>
            <p className="text-xs text-foreground/60 mt-1">
              Strukturierte Einstellungen fuer Profil, Hintergrund und Darstellung.
            </p>
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <div className="px-2.5 py-1.5 rounded-lg bg-foreground/5 text-foreground/70">
              Modus: <span className="font-semibold capitalize">{designMode}</span>
            </div>
            <div className="px-2.5 py-1.5 rounded-lg bg-foreground/5 text-foreground/70">
              Hintergrund: <span className="font-semibold">{background?.background_type || 'default'}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="glass-card rounded-2xl p-6 theme-transition">
        <h4 className="text-sm font-medium text-foreground mb-4">Design-Modus</h4>
        <p className="text-xs text-foreground/60 mb-4">
          Waehlen Sie, ob Ihre Anpassungen benutzerspezifisch (auf allen Geraeten) oder geraetespezifisch (nur auf diesem Geraet) gespeichert werden sollen.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <motion.button
            onClick={() => setDesignMode('user')}
            disabled={settingsLocked}
            className={`
              relative p-4 rounded-xl border-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed
              ${designMode === 'user'
                ? 'border-accent bg-accent/10'
                : 'border-foreground/10 bg-foreground/5 hover:border-foreground/20'
              }
            `}
            whileHover={{ scale: settingsLocked ? 1 : 1.02 }}
            whileTap={{ scale: settingsLocked ? 1 : 0.98 }}
          >
            <div className="flex flex-col items-center gap-3">
              <div className={`
                w-12 h-12 rounded-lg flex items-center justify-center
                ${designMode === 'user' ? 'bg-accent/20' : 'bg-foreground/10'}
              `}>
                <User size={24} weight="fill" className={designMode === 'user' ? 'text-accent' : 'text-foreground/60'} />
              </div>
              <div className="text-center">
                <p className="font-medium text-sm">Benutzer-Design</p>
                <p className="text-xs text-foreground/60">Alle Geraete</p>
              </div>
              {designMode === 'user' && (
                <div className="absolute top-2 right-2">
                  <Check size={20} weight="bold" className="text-accent" />
                </div>
              )}
            </div>
          </motion.button>

          <motion.button
            onClick={() => setDesignMode('device')}
            disabled={settingsLocked}
            className={`
              relative p-4 rounded-xl border-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed
              ${designMode === 'device'
                ? 'border-accent bg-accent/10'
                : 'border-foreground/10 bg-foreground/5 hover:border-foreground/20'
              }
            `}
            whileHover={{ scale: settingsLocked ? 1 : 1.02 }}
            whileTap={{ scale: settingsLocked ? 1 : 0.98 }}
          >
            <div className="flex flex-col items-center gap-3">
              <div className={`
                w-12 h-12 rounded-lg flex items-center justify-center
                ${designMode === 'device' ? 'bg-accent/20' : 'bg-foreground/10'}
              `}>
                <Monitor size={24} weight="fill" className={designMode === 'device' ? 'text-accent' : 'text-foreground/60'} />
              </div>
              <div className="text-center">
                <p className="font-medium text-sm">Geraete-Design</p>
                <p className="text-xs text-foreground/60">Nur dieses Geraet</p>
              </div>
              {designMode === 'device' && (
                <div className="absolute top-2 right-2">
                  <Check size={20} weight="bold" className="text-accent" />
                </div>
              )}
            </div>
          </motion.button>
        </div>

        <div className="mt-4 pt-4 border-t border-foreground/10">
          <div className="text-xs text-foreground/60 space-y-1">
            <p>Benutzer: <span className="text-foreground font-medium">{user?.username || 'Nicht angemeldet'}</span></p>
            <p>Geraet: <span className="text-foreground font-medium">{device?.device_name || 'Unbekannt'}</span></p>
          </div>
        </div>
      </div>

      <div className="glass-card rounded-2xl p-6 theme-transition">
        <div className="flex items-center gap-2 mb-2">
          <h4 className="text-sm font-medium text-foreground">Hintergrund</h4>
          <ScopeBadge scope={designMode === 'device' ? 'device' : 'user'} />
        </div>
        <p className="text-xs text-foreground/60 mb-4">
          Mehr Kontrolle ueber Position, Fixierung, Transparenz, Blur und Helligkeit.
        </p>

        <div className="grid grid-cols-2 gap-2 mb-4 text-[11px]">
          <div className="rounded-lg p-2.5 bg-foreground/5 text-foreground/70">
            Typ: <span className="font-semibold">{background?.background_type || 'default'}</span>
          </div>
          <div className="rounded-lg p-2.5 bg-foreground/5 text-foreground/70">
            Aktiv: <span className="font-semibold">{background?.is_active ? 'Ja' : 'Nein'}</span>
          </div>
        </div>

        <motion.button
          onClick={() => setShowBackgroundEditor(true)}
          disabled={settingsLocked}
          className="w-full px-4 py-3 rounded-xl bg-foreground/5 hover:bg-foreground/10 transition-colors flex items-center justify-between group disabled:opacity-50 disabled:cursor-not-allowed"
          whileHover={{ scale: settingsLocked ? 1 : 1.01 }}
          whileTap={{ scale: settingsLocked ? 1 : 0.99 }}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent/20 flex items-center justify-center">
              <PaintBrush size={20} weight="fill" className="text-accent" />
            </div>
            <div className="text-left">
              <p className="font-medium text-sm">Hintergrund anpassen</p>
              <p className="text-xs text-foreground/60">
                {background ? `Aktuell: ${background.background_type}` : 'Kein Hintergrund konfiguriert'}
              </p>
            </div>
          </div>
          <CaretRight size={20} className="text-foreground/40 group-hover:translate-x-1 transition-transform" />
        </motion.button>
      </div>

      {/* Global Card Style */}
      <div className="glass-card rounded-2xl p-6 theme-transition">
        <div className="flex items-center gap-2 mb-2">
          <h4 className="text-sm font-medium text-foreground">Kartenstil (Global)</h4>
          <ScopeBadge scope={designMode === 'device' ? 'device' : 'user'} />
        </div>
        <p className="text-xs text-foreground/60 mb-4">
          Standard-Kartenstil fuer alle Widgets. Kann pro Seite ueberschrieben werden.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[420px] overflow-y-auto pr-1">
          {CARD_STYLE_PRESETS.map((preset) => (
            <motion.button
              key={preset.id}
              onClick={() => !settingsLocked && handleCardStyleChange(preset.id)}
              disabled={settingsLocked}
              className={`
                relative rounded-xl border-2 transition-all text-left disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden
                ${globalCardStyle === preset.id
                  ? 'border-accent bg-accent/10'
                  : 'border-foreground/10 bg-foreground/5 hover:border-foreground/20'
                }
              `}
              whileHover={{ scale: settingsLocked ? 1 : 1.02 }}
              whileTap={{ scale: settingsLocked ? 1 : 0.98 }}
            >
              {/* Preview card */}
              <div className={`px-3 pt-3 pb-2 ${getCardStyleClass(preset.id)}`}>
                <div
                  className="glass-card rounded-xl p-3 space-y-1.5"
                  style={{ minHeight: 56 }}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-lg bg-accent/20 flex items-center justify-center shrink-0">
                      <div className="w-3 h-3 rounded-full bg-accent" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="h-2 w-2/3 rounded bg-foreground/20" />
                      <div className="h-1.5 w-1/2 rounded bg-foreground/10 mt-1" />
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <div className="h-1.5 flex-1 rounded bg-foreground/8" />
                    <div className="h-1.5 w-1/4 rounded bg-accent/30" />
                  </div>
                </div>
              </div>
              <div className="px-3 pb-2.5">
                <p className="text-xs font-medium truncate">{preset.label}</p>
                <p className="text-[10px] text-foreground/50 mt-0.5 line-clamp-1">{preset.description}</p>
              </div>
              {globalCardStyle === preset.id && (
                <div className="absolute top-1.5 right-1.5">
                  <Check size={14} weight="bold" className="text-accent" />
                </div>
              )}
            </motion.button>
          ))}
        </div>
      </div>

      <BackgroundEditor open={showBackgroundEditor} onClose={() => setShowBackgroundEditor(false)} settingsLocked={settingsLocked} />
    </div>
  )
}

function BackgroundEditor({ open, onClose, settingsLocked }: { open: boolean; onClose: () => void; settingsLocked: boolean }) {
  const { saveBackground, background } = useConfiguration()
  const existingConfig = (typeof background?.config === 'string'
    ? JSON.parse(background.config)
    : background?.config) as BackgroundConfigData | undefined

  const [backgroundType, setBackgroundType] = useState<'static' | 'slideshow' | 'video' | 'gradient'>(
    background?.background_type || 'static'
  )
  const [staticUrl, setStaticUrl] = useState(existingConfig?.type === 'static' ? existingConfig.url : '')
  const [slideshowUrls, setSlideshowUrls] = useState<string[]>(existingConfig?.type === 'slideshow' ? existingConfig.urls : [])
  const [slideshowInterval, setSlideshowInterval] = useState(existingConfig?.type === 'slideshow' ? existingConfig.interval : 5)
  const [videoUrl, setVideoUrl] = useState(existingConfig?.type === 'video' ? existingConfig.url : '')
  const [videoLoop, setVideoLoop] = useState(existingConfig?.type === 'video' ? existingConfig.loop : true)
  const [gradientColors, setGradientColors] = useState(existingConfig?.type === 'gradient' ? existingConfig.colors : ['#667eea', '#764ba2'])
  const [gradientAngle, setGradientAngle] = useState(existingConfig?.type === 'gradient' ? existingConfig.angle : 135)
  const [position, setPosition] = useState(
    existingConfig?.type === 'static' || existingConfig?.type === 'slideshow'
      ? existingConfig.position || 'center'
      : 'center'
  )
  const [size, setSize] = useState(
    existingConfig?.type === 'static' || existingConfig?.type === 'slideshow'
      ? existingConfig.size || 'cover'
      : 'cover'
  )
  const [fixedPosition, setFixedPosition] = useState(
    existingConfig?.type === 'static' ? existingConfig.fixed !== false : true
  )
  const [opacity, setOpacity] = useState(existingConfig?.opacity ?? 100)
  const [blur, setBlur] = useState(existingConfig?.blur ?? 0)
  const [brightness, setBrightness] = useState(existingConfig?.brightness ?? 100)
  const [uploading, setUploading] = useState(false)

  const canSave = useMemo(() => {
    if (backgroundType === 'static') return staticUrl.trim().length > 0
    if (backgroundType === 'slideshow') return slideshowUrls.length > 0
    if (backgroundType === 'video') return videoUrl.trim().length > 0
    return true
  }, [backgroundType, staticUrl, slideshowUrls, videoUrl])

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>, mode: 'static' | 'slideshow') => {
    const file = event.target.files?.[0]
    if (!file) return

    const token = getAuthToken()
    if (!token) {
      toast.error('Bitte zuerst anmelden, damit Upload funktioniert.')
      return
    }

    const form = new FormData()
    form.append('file', file)

    setUploading(true)
    try {
      const response = await fetch('/api/uploads/background', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: form,
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: 'Upload fehlgeschlagen' })) as { error?: string }
        throw new Error(payload.error || 'Upload fehlgeschlagen')
      }

      const payload = await response.json() as { url: string }
      if (mode === 'static') {
        setStaticUrl(payload.url)
      } else {
        setSlideshowUrls(prev => [...prev, payload.url])
      }
      toast.success('Bild erfolgreich hochgeladen')
    } catch (error) {
      console.error('Upload error:', error)
      toast.error(error instanceof Error ? error.message : 'Upload fehlgeschlagen')
    } finally {
      setUploading(false)
      event.target.value = ''
    }
  }

  const handleSave = async () => {
    if (settingsLocked) return

    try {
      const visualConfig = {
        opacity,
        blur,
        brightness,
      }

      let config: BackgroundConfigData

      switch (backgroundType) {
        case 'static':
          config = {
            type: 'static',
            url: staticUrl,
            position,
            size,
            fixed: fixedPosition,
            ...visualConfig,
          }
          break
        case 'slideshow':
          config = {
            type: 'slideshow',
            urls: slideshowUrls,
            interval: slideshowInterval,
            position,
            size,
            ...visualConfig,
          }
          break
        case 'video':
          config = { type: 'video', url: videoUrl, loop: videoLoop, ...visualConfig }
          break
        case 'gradient':
          config = { type: 'gradient', colors: gradientColors, angle: gradientAngle, ...visualConfig }
          break
      }

      await saveBackground({ background_type: backgroundType, config })
      toast.success('Hintergrund gespeichert')
      onClose()
    } catch (error) {
      console.error('Failed to save background:', error)
      toast.error('Hintergrund konnte nicht gespeichert werden')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-[760px] glass-card border-foreground/10 p-0 gap-0 bg-card/95 backdrop-blur-2xl">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-foreground/10">
          <DialogTitle>Hintergrund konfigurieren</DialogTitle>
          <DialogDescription>
            Das Modal ist zentriert. Sie koennen Bilder direkt hochladen statt URL einzutragen.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-4 gap-3">
            {[
              { type: 'static' as const, icon: Image, label: 'Statisch' },
              { type: 'slideshow' as const, icon: Image, label: 'Diashow' },
              { type: 'video' as const, icon: VideoCamera, label: 'Video' },
              { type: 'gradient' as const, icon: PaintBrush, label: 'Gradient' },
            ].map(({ type, icon: Icon, label }) => (
              <button
                key={type}
                onClick={() => setBackgroundType(type)}
                disabled={settingsLocked}
                className={`
                  p-3 rounded-xl border-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed
                  ${backgroundType === type
                    ? 'border-accent bg-accent/10'
                    : 'border-foreground/10 bg-foreground/5 hover:border-foreground/20'
                  }
                `}
              >
                <Icon size={24} className={backgroundType === type ? 'text-accent' : 'text-foreground/60'} />
                <p className="text-xs mt-2">{label}</p>
              </button>
            ))}
          </div>

          <div className="space-y-4">
            <div className="rounded-xl p-3 bg-foreground/5">
              <p className="text-xs font-semibold text-foreground/70 mb-2">Darstellung</p>
              <div className="grid sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-foreground/60 block mb-1">Deckkraft</label>
                  <input type="range" min="0" max="100" value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="w-full" disabled={settingsLocked} />
                </div>
                <div>
                  <label className="text-xs text-foreground/60 block mb-1">Blur</label>
                  <input type="range" min="0" max="20" value={blur} onChange={(e) => setBlur(Number(e.target.value))} className="w-full" disabled={settingsLocked} />
                </div>
                <div>
                  <label className="text-xs text-foreground/60 block mb-1">Helligkeit</label>
                  <input type="range" min="40" max="140" value={brightness} onChange={(e) => setBrightness(Number(e.target.value))} className="w-full" disabled={settingsLocked} />
                </div>
              </div>
            </div>

            {(backgroundType === 'static' || backgroundType === 'slideshow') && (
              <div className="rounded-xl p-3 bg-foreground/5">
                <p className="text-xs font-semibold text-foreground/70 mb-2">Ausrichtung</p>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-foreground/60 block mb-1">Position</label>
                    <select value={position} onChange={(e) => setPosition(e.target.value as 'center' | 'top' | 'bottom' | 'left' | 'right')} className="w-full px-3 py-2 rounded-lg bg-foreground/5 border border-foreground/10 text-sm text-foreground" disabled={settingsLocked}>
                      <option value="center">Center</option>
                      <option value="top">Top</option>
                      <option value="bottom">Bottom</option>
                      <option value="left">Left</option>
                      <option value="right">Right</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-foreground/60 block mb-1">Skalierung</label>
                    <select value={size} onChange={(e) => setSize(e.target.value as 'cover' | 'contain' | 'auto')} className="w-full px-3 py-2 rounded-lg bg-foreground/5 border border-foreground/10 text-sm text-foreground" disabled={settingsLocked}>
                      <option value="cover">Cover</option>
                      <option value="contain">Contain</option>
                      <option value="auto">Auto</option>
                    </select>
                  </div>
                </div>
                {backgroundType === 'static' && (
                  <label className="mt-3 flex items-center gap-2 text-xs text-foreground/70">
                    <input type="checkbox" checked={fixedPosition} onChange={(e) => setFixedPosition(e.target.checked)} className="w-4 h-4 rounded accent-accent" disabled={settingsLocked} />
                    Statisch fixieren (bleibt an gleicher Position beim Scrollen)
                  </label>
                )}
              </div>
            )}

            {backgroundType === 'static' && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground block">Bild</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={staticUrl}
                    onChange={(e) => setStaticUrl(e.target.value)}
                    placeholder="Upload waehlen oder URL eintragen"
                    className="flex-1 px-4 py-2 rounded-lg bg-foreground/5 border border-foreground/10 text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-accent"
                    disabled={settingsLocked}
                  />
                  <label className="px-3 py-2 rounded-lg bg-accent/15 text-accent border border-accent/25 cursor-pointer text-sm inline-flex items-center gap-1.5">
                    <UploadSimple size={14} />
                    Upload
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => handleUpload(e, 'static')} disabled={settingsLocked || uploading} />
                  </label>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setBackgroundType('static')
                    setStaticUrl(DEFAULT_DASHBOARD_BACKGROUND_URL)
                    setPosition('center')
                    setSize('cover')
                    setFixedPosition(true)
                    setOpacity(100)
                    setBlur(0)
                    setBrightness(100)
                  }}
                  disabled={settingsLocked}
                  className="w-full px-3 py-2 rounded-lg bg-foreground/5 hover:bg-foreground/10 border border-foreground/10 text-xs text-foreground/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Standard-Hintergrund verwenden (fest beim Scrollen)
                </button>

                <div className="rounded-xl p-3 bg-foreground/5">
                  <p className="text-xs font-semibold text-foreground/70 mb-2">Default Galerie</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    {DEFAULT_BACKGROUND_PRESETS.map((preset) => {
                      const isSelected = staticUrl === preset.url
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => {
                            setBackgroundType('static')
                            setStaticUrl(preset.url)
                            setPosition('center')
                            setSize('cover')
                            setFixedPosition(true)
                            setOpacity(100)
                            setBlur(0)
                            setBrightness(100)
                          }}
                          disabled={settingsLocked}
                          className={`text-left rounded-lg overflow-hidden border transition-colors disabled:opacity-50 ${isSelected ? 'border-accent' : 'border-foreground/10 hover:border-foreground/25'}`}
                        >
                          <div className="h-20 w-full bg-cover bg-center" style={{ backgroundImage: `url('${preset.url}')` }} />
                          <div className={`px-2 py-1.5 text-[11px] ${isSelected ? 'bg-accent/15 text-accent' : 'bg-card/60 text-foreground/80'}`}>
                            {preset.name}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}

            {backgroundType === 'slideshow' && (
              <>
                <div>
                  <label className="text-sm font-medium text-foreground block mb-2">Intervall (Sekunden)</label>
                  <input type="number" value={slideshowInterval} onChange={(e) => setSlideshowInterval(Number(e.target.value))} min="1" className="w-full px-4 py-2 rounded-lg bg-foreground/5 border border-foreground/10 text-foreground focus:outline-none focus:border-accent" disabled={settingsLocked} />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-foreground">Bilder</label>
                    <label className="px-3 py-1.5 rounded-lg bg-accent/15 text-accent border border-accent/25 cursor-pointer text-xs inline-flex items-center gap-1.5">
                      <UploadSimple size={13} />
                      Bild hochladen
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => handleUpload(e, 'slideshow')} disabled={settingsLocked || uploading} />
                    </label>
                  </div>
                  <textarea
                    value={slideshowUrls.join('\n')}
                    onChange={(e) => setSlideshowUrls(e.target.value.split('\n').filter(url => url.trim()))}
                    placeholder="Eine URL pro Zeile"
                    rows={4}
                    className="w-full px-4 py-2 rounded-lg bg-foreground/5 border border-foreground/10 text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-accent"
                    disabled={settingsLocked}
                  />
                </div>
              </>
            )}

            {backgroundType === 'video' && (
              <>
                <div>
                  <label className="text-sm font-medium text-foreground block mb-2">Video-URL</label>
                  <input type="text" value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://example.com/video.mp4" className="w-full px-4 py-2 rounded-lg bg-foreground/5 border border-foreground/10 text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-accent" disabled={settingsLocked} />
                </div>
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="video-loop" checked={videoLoop} onChange={(e) => setVideoLoop(e.target.checked)} className="w-4 h-4 rounded accent-accent" disabled={settingsLocked} />
                  <label htmlFor="video-loop" className="text-sm text-foreground">Video wiederholen</label>
                </div>
              </>
            )}

            {backgroundType === 'gradient' && (
              <>
                <div>
                  <label className="text-sm font-medium text-foreground block mb-2">Winkel</label>
                  <input type="range" value={gradientAngle} onChange={(e) => setGradientAngle(Number(e.target.value))} min="0" max="360" className="w-full" disabled={settingsLocked} />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground block mb-2">Farben</label>
                  <div className="flex gap-2">
                    {gradientColors.map((color, i) => (
                      <input
                        key={i}
                        type="color"
                        value={color}
                        onChange={(e) => {
                          const newColors = [...gradientColors]
                          newColors[i] = e.target.value
                          setGradientColors(newColors)
                        }}
                        className="w-12 h-12 rounded-lg cursor-pointer"
                        disabled={settingsLocked}
                      />
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="px-6 pb-6 flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2 rounded-xl bg-foreground/5 hover:bg-foreground/10 text-foreground transition-colors">
            Abbrechen
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave || settingsLocked || uploading}
            className="flex-1 px-4 py-2 rounded-xl bg-accent hover:bg-accent/90 text-accent-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploading ? 'Upload laeuft...' : 'Speichern'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
