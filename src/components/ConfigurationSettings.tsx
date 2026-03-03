import { useState } from 'react'
import { motion } from 'framer-motion'
import { useConfiguration } from '@/contexts/ConfigurationContext'
import {
  Monitor,
  User,
  Image,
  VideoCamera,
  PaintBrush,
  CaretRight,
  Check,
} from '@phosphor-icons/react'

export function ConfigurationSettings() {
  const { designMode, setDesignMode, user, device, saveBackground, background } = useConfiguration()
  const [showBackgroundEditor, setShowBackgroundEditor] = useState(false)

  return (
    <div className="space-y-6">
      {/* Design Mode Selection */}
      <div className="glass-card rounded-2xl p-6 theme-transition">
        <h4 className="text-sm font-medium text-foreground mb-4">Design-Modus</h4>
        <p className="text-xs text-foreground/60 mb-4">
          Wählen Sie, ob Ihre Anpassungen benutzerspezifisch (auf allen Geräten) oder gerätespezifisch (nur auf diesem Gerät) gespeichert werden sollen.
        </p>

        <div className="grid grid-cols-2 gap-3">
          {/* User Mode */}
          <motion.button
            onClick={() => setDesignMode('user')}
            className={`
              relative p-4 rounded-xl border-2 transition-all
              ${designMode === 'user'
                ? 'border-accent bg-accent/10'
                : 'border-foreground/10 bg-foreground/5 hover:border-foreground/20'
              }
            `}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
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
                <p className="text-xs text-foreground/60">Alle Geräte</p>
              </div>
              {designMode === 'user' && (
                <div className="absolute top-2 right-2">
                  <Check size={20} weight="bold" className="text-accent" />
                </div>
              )}
            </div>
          </motion.button>

          {/* Device Mode */}
          <motion.button
            onClick={() => setDesignMode('device')}
            className={`
              relative p-4 rounded-xl border-2 transition-all
              ${designMode === 'device'
                ? 'border-accent bg-accent/10'
                : 'border-foreground/10 bg-foreground/5 hover:border-foreground/20'
              }
            `}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <div className="flex flex-col items-center gap-3">
              <div className={`
                w-12 h-12 rounded-lg flex items-center justify-center
                ${designMode === 'device' ? 'bg-accent/20' : 'bg-foreground/10'}
              `}>
                <Monitor size={24} weight="fill" className={designMode === 'device' ? 'text-accent' : 'text-foreground/60'} />
              </div>
              <div className="text-center">
                <p className="font-medium text-sm">Geräte-Design</p>
                <p className="text-xs text-foreground/60">Nur dieses Gerät</p>
              </div>
              {designMode === 'device' && (
                <div className="absolute top-2 right-2">
                  <Check size={20} weight="bold" className="text-accent" />
                </div>
              )}
            </div>
          </motion.button>
        </div>

        {/* Current Profile Info */}
        <div className="mt-4 pt-4 border-t border-foreground/10">
          <div className="text-xs text-foreground/60 space-y-1">
            <p>Benutzer: <span className="text-foreground font-medium">{user?.username || 'Nicht angemeldet'}</span></p>
            <p>Gerät: <span className="text-foreground font-medium">{device?.device_name || 'Unbekannt'}</span></p>
          </div>
        </div>
      </div>

      {/* Background Configuration */}
      <div className="glass-card rounded-2xl p-6 theme-transition">
        <h4 className="text-sm font-medium text-foreground mb-4">Hintergrund</h4>
        <p className="text-xs text-foreground/60 mb-4">
          Passen Sie den Hintergrund Ihres Dashboards an. Wählen Sie zwischen statischen Bildern, Diashows oder Videos.
        </p>

        <motion.button
          onClick={() => setShowBackgroundEditor(true)}
          className="w-full px-4 py-3 rounded-xl bg-foreground/5 hover:bg-foreground/10 transition-colors flex items-center justify-between group"
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
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

      {/* Background Editor Modal */}
      {showBackgroundEditor && (
        <BackgroundEditor onClose={() => setShowBackgroundEditor(false)} />
      )}
    </div>
  )
}

function BackgroundEditor({ onClose }: { onClose: () => void }) {
  const { saveBackground, background } = useConfiguration()
  const [backgroundType, setBackgroundType] = useState<'static' | 'slideshow' | 'video' | 'gradient'>(
    background?.background_type || 'static'
  )
  const [staticUrl, setStaticUrl] = useState('')
  const [slideshowUrls, setSlideshowUrls] = useState<string[]>([])
  const [slideshowInterval, setSlideshowInterval] = useState(5)
  const [videoUrl, setVideoUrl] = useState('')
  const [videoLoop, setVideoLoop] = useState(true)
  const [gradientColors, setGradientColors] = useState(['#667eea', '#764ba2'])
  const [gradientAngle, setGradientAngle] = useState(135)

  const handleSave = async () => {
    try {
      let config: any

      switch (backgroundType) {
        case 'static':
          config = { type: 'static', url: staticUrl }
          break
        case 'slideshow':
          config = { type: 'slideshow', urls: slideshowUrls, interval: slideshowInterval }
          break
        case 'video':
          config = { type: 'video', url: videoUrl, loop: videoLoop }
          break
        case 'gradient':
          config = { type: 'gradient', colors: gradientColors, angle: gradientAngle }
          break
      }

      await saveBackground({ background_type: backgroundType, config })
      onClose()
    } catch (error) {
      console.error('Failed to save background:', error)
    }
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="glass-card rounded-2xl p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto"
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-xl font-medium text-foreground mb-6">Hintergrund konfigurieren</h3>

        {/* Background Type Selection */}
        <div className="grid grid-cols-4 gap-3 mb-6">
          {[
            { type: 'static' as const, icon: Image, label: 'Statisch' },
            { type: 'slideshow' as const, icon: Image, label: 'Diashow' },
            { type: 'video' as const, icon: VideoCamera, label: 'Video' },
            { type: 'gradient' as const, icon: PaintBrush, label: 'Gradient' },
          ].map(({ type, icon: Icon, label }) => (
            <button
              key={type}
              onClick={() => setBackgroundType(type)}
              className={`
                p-3 rounded-xl border-2 transition-all
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

        {/* Configuration Fields */}
        <div className="space-y-4 mb-6">
          {backgroundType === 'static' && (
            <div>
              <label className="text-sm font-medium text-foreground block mb-2">Bild-URL</label>
              <input
                type="text"
                value={staticUrl}
                onChange={(e) => setStaticUrl(e.target.value)}
                placeholder="https://example.com/image.jpg"
                className="w-full px-4 py-2 rounded-lg bg-foreground/5 border border-foreground/10 text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-accent"
              />
            </div>
          )}

          {backgroundType === 'slideshow' && (
            <>
              <div>
                <label className="text-sm font-medium text-foreground block mb-2">Intervall (Sekunden)</label>
                <input
                  type="number"
                  value={slideshowInterval}
                  onChange={(e) => setSlideshowInterval(Number(e.target.value))}
                  min="1"
                  className="w-full px-4 py-2 rounded-lg bg-foreground/5 border border-foreground/10 text-foreground focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground block mb-2">Bild-URLs (eine pro Zeile)</label>
                <textarea
                  value={slideshowUrls.join('\n')}
                  onChange={(e) => setSlideshowUrls(e.target.value.split('\n').filter(url => url.trim()))}
                  placeholder="https://example.com/image1.jpg&#10;https://example.com/image2.jpg"
                  rows={4}
                  className="w-full px-4 py-2 rounded-lg bg-foreground/5 border border-foreground/10 text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-accent"
                />
              </div>
            </>
          )}

          {backgroundType === 'video' && (
            <>
              <div>
                <label className="text-sm font-medium text-foreground block mb-2">Video-URL</label>
                <input
                  type="text"
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  placeholder="https://example.com/video.mp4"
                  className="w-full px-4 py-2 rounded-lg bg-foreground/5 border border-foreground/10 text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-accent"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="video-loop"
                  checked={videoLoop}
                  onChange={(e) => setVideoLoop(e.target.checked)}
                  className="w-4 h-4 rounded accent-accent"
                />
                <label htmlFor="video-loop" className="text-sm text-foreground">Video wiederholen</label>
              </div>
            </>
          )}

          {backgroundType === 'gradient' && (
            <>
              <div>
                <label className="text-sm font-medium text-foreground block mb-2">Winkel</label>
                <input
                  type="range"
                  value={gradientAngle}
                  onChange={(e) => setGradientAngle(Number(e.target.value))}
                  min="0"
                  max="360"
                  className="w-full"
                />
                <p className="text-xs text-foreground/60 mt-1">{gradientAngle}°</p>
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
                    />
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-xl bg-foreground/5 hover:bg-foreground/10 text-foreground transition-colors"
          >
            Abbrechen
          </button>
          <button
            onClick={handleSave}
            className="flex-1 px-4 py-2 rounded-xl bg-accent hover:bg-accent/90 text-accent-foreground transition-colors"
          >
            Speichern
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
