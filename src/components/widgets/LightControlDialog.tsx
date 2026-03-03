import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Slider } from '@/components/ui/slider'
import { ColorPicker } from '@/components/ui/color-picker'
import { Lightbulb, Power, SunHorizon, X, Palette } from '@phosphor-icons/react'
import type { LightEntity } from '@/lib/types'
import { haService } from '@/lib/homeAssistant'
import { haptics } from '@/lib/haptics'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'

interface LightControlDialogProps {
  entity: LightEntity
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdate?: () => void
}

export function LightControlDialog({
  entity,
  open,
  onOpenChange,
  onUpdate,
}: LightControlDialogProps) {
  const isOn = entity.state === 'on'
  const [brightness, setBrightness] = useState(entity.attributes.brightness || 255)
  const [rgbColor, setRgbColor] = useState<[number, number, number]>(
    entity.attributes.rgb_color || [255, 200, 100]
  )
  const [colorTemp, setColorTemp] = useState(entity.attributes.color_temp || 370)
  const name = entity.attributes.friendly_name || entity.entity_id
  const [isUpdating, setIsUpdating] = useState(false)
  const [showColorWheel, setShowColorWheel] = useState(false)

  const supportsColor = entity.attributes.supported_color_modes?.includes('rgb') ||
                        entity.attributes.supported_color_modes?.includes('hs') ||
                        entity.attributes.rgb_color !== undefined

  const supportsColorTemp = entity.attributes.supported_color_modes?.includes('color_temp') ||
                            entity.attributes.color_temp !== undefined

  useEffect(() => {
    if (entity.attributes.brightness !== undefined) {
      setBrightness(entity.attributes.brightness)
    }
    if (entity.attributes.rgb_color !== undefined) {
      setRgbColor(entity.attributes.rgb_color)
    }
    if (entity.attributes.color_temp !== undefined) {
      setColorTemp(entity.attributes.color_temp)
    }
  }, [entity])

  const handleToggle = async () => {
    haptics.impact('medium')
    setIsUpdating(true)
    try {
      await haService.toggleEntity(entity.entity_id)
      toast.success(isOn ? `${name} ausgeschaltet` : `${name} eingeschaltet`)
      haptics.notification('success')
      onUpdate?.()
    } catch (error) {
      toast.error('Fehler beim Schalten')
      haptics.notification('error')
    } finally {
      setIsUpdating(false)
    }
  }

  const handleColorChange = (color: [number, number, number]) => {
    setRgbColor(color)
    haptics.selectionChanged()
  }

  const handleColorSelect = async (color: [number, number, number]) => {
    setRgbColor(color)
    haptics.impact('light')
    setIsUpdating(true)
    try {
      await haService.turnOn(entity.entity_id, {
        rgb_color: color,
        brightness: brightness
      })
      toast.success('Farbe angepasst')
      haptics.notification('success')
      onUpdate?.()
    } catch (error) {
      toast.error('Fehler beim Anpassen der Farbe')
      haptics.notification('error')
    } finally {
      setIsUpdating(false)
    }
  }

  const handleColorTempChange = async (value: number[]) => {
    const newTemp = value[0]
    setColorTemp(newTemp)
    haptics.selectionChanged()
  }

  const handleColorTempCommit = async (value: number[]) => {
    const newTemp = value[0]
    setColorTemp(newTemp)
    haptics.impact('medium')
    setIsUpdating(true)
    try {
      await haService.turnOn(entity.entity_id, {
        color_temp: newTemp,
        brightness: brightness
      })
      toast.success(`Farbtemperatur auf ${Math.round(1000000 / newTemp)}K`)
      haptics.notification('success')
      onUpdate?.()
    } catch (error) {
      toast.error('Fehler beim Anpassen der Farbtemperatur')
      haptics.notification('error')
    } finally {
      setIsUpdating(false)
    }
  }

  const handleBrightnessChange = async (value: number[]) => {
    const newBrightness = value[0]
    setBrightness(newBrightness)
    haptics.selectionChanged()
  }

  const handleBrightnessCommit = async (value: number[]) => {
    const newBrightness = value[0]
    haptics.impact('medium')
    setIsUpdating(true)
    try {
      if (newBrightness === 0) {
        await haService.turnOff(entity.entity_id)
        toast.success(`${name} ausgeschaltet`)
      } else {
        await haService.turnOn(entity.entity_id, { brightness: newBrightness })
        toast.success(`${name} auf ${Math.round((newBrightness / 255) * 100)}%`)
      }
      haptics.notification('success')
      onUpdate?.()
    } catch (error) {
      toast.error('Fehler beim Anpassen der Helligkeit')
      haptics.notification('error')
    } finally {
      setIsUpdating(false)
    }
  }

  const presetColors: Array<[number, number, number]> = [
    [255, 147, 41],   // Warm Orange
    [255, 214, 170],  // Soft Warm
    [255, 244, 229],  // Neutral White
    [255, 255, 255],  // Pure White
    [245, 246, 255],  // Cool White
    [214, 227, 255],  // Light Blue
    [173, 216, 230],  // Sky Blue
    [255, 182, 193],  // Light Pink
    [255, 105, 180],  // Hot Pink
    [255, 99, 71],    // Tomato Red
    [144, 238, 144],  // Light Green
    [50, 205, 50],    // Lime Green
  ]

  const currentColor = `rgb(${rgbColor[0]}, ${rgbColor[1]}, ${rgbColor[2]})`
  const brightnessPercent = brightness / 255

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px] glass-card border-foreground/10 p-0 gap-0 bg-card/95 backdrop-blur-2xl">
        <DialogHeader className="p-6 pb-4 border-b border-foreground/10">
          <DialogTitle className="flex items-center justify-between text-foreground">
            <div className="flex items-center gap-3">
              <motion.div
                animate={isOn ? { scale: [1, 1.05, 1] } : {}}
                transition={{ duration: 2, repeat: Infinity }}
                className="p-2 rounded-xl transition-all duration-300"
                style={{
                  backgroundColor: isOn
                    ? `color-mix(in oklch, ${currentColor} 30%, transparent)`
                    : 'oklch(from var(--muted) l c h / 0.5)',
                  color: isOn ? currentColor : 'var(--muted-foreground)',
                }}
              >
                <Lightbulb size={22} weight={isOn ? 'fill' : 'regular'} />
              </motion.div>
              <span className="text-lg font-medium">{name}</span>
            </div>
            <button
              onClick={() => onOpenChange(false)}
              className="text-foreground/60 hover:text-foreground/90 transition-colors p-1 rounded-lg hover:bg-foreground/5"
            >
              <X size={20} />
            </button>
          </DialogTitle>
        </DialogHeader>

        <div className="p-6 space-y-6">
          {/* Power Toggle */}
          <motion.div
            className="flex items-center justify-between p-4 rounded-xl bg-foreground/5 border border-foreground/10"
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
          >
            <div className="flex items-center gap-3">
              <div>
                <div className="text-sm font-medium text-foreground">
                  {isOn ? 'Eingeschaltet' : 'Ausgeschaltet'}
                </div>
                {isOn && (
                  <div className="text-xs text-foreground/50 font-mono">
                    {Math.round((brightness / 255) * 100)}%
                  </div>
                )}
              </div>
            </div>
            <motion.button
              onClick={handleToggle}
              disabled={isUpdating}
              className="p-3 rounded-full transition-colors disabled:opacity-50"
              style={{
                backgroundColor: isOn
                  ? `color-mix(in oklch, ${currentColor} 20%, transparent)`
                  : 'oklch(from var(--foreground) l c h / 0.1)',
                color: isOn ? currentColor : 'var(--foreground)',
              }}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <Power size={24} weight="bold" />
            </motion.button>
          </motion.div>

          {/* Brightness Slider */}
          {isOn && (
            <motion.div
              className="space-y-3"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold text-foreground/90 flex items-center gap-2">
                  <Lightbulb size={16} weight="fill" />
                  Helligkeit
                </label>
                <span className="text-sm text-foreground/60 font-mono px-2 py-1 rounded bg-foreground/5">
                  {Math.round((brightness / 255) * 100)}%
                </span>
              </div>
              <Slider
                value={[brightness]}
                onValueChange={handleBrightnessChange}
                onValueCommit={handleBrightnessCommit}
                min={0}
                max={255}
                step={1}
                disabled={isUpdating}
                className="w-full"
                trackGradient="linear-gradient(to right, oklch(0.3 0 0) 0%, oklch(0.95 0.02 ${Math.round((rgbColor[0] * 0.299 + rgbColor[1] * 0.587 + rgbColor[2] * 0.114) / 2.55)}deg) 100%)"
                rangeGradient={`linear-gradient(to right, oklch(0.4 0.05 ${Math.round((rgbColor[0] * 0.299 + rgbColor[1] * 0.587 + rgbColor[2] * 0.114) / 2.55)}deg) 0%, ${currentColor} 100%)`}
              />
            </motion.div>
          )}

          {/* Color Temperature Slider */}
          {isOn && supportsColorTemp && (
            <motion.div
              className="space-y-3"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.1 }}
            >
              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold text-foreground/90 flex items-center gap-2">
                  <SunHorizon size={16} weight="fill" />
                  Farbtemperatur
                </label>
                <span className="text-sm text-foreground/60 font-mono px-2 py-1 rounded bg-foreground/5">
                  {Math.round(1000000 / colorTemp)}K
                </span>
              </div>
              <Slider
                value={[colorTemp]}
                onValueChange={handleColorTempChange}
                onValueCommit={handleColorTempCommit}
                min={153}
                max={500}
                step={1}
                disabled={isUpdating}
                className="w-full"
                trackGradient="linear-gradient(to right, rgb(166, 209, 255) 0%, rgb(255, 255, 255) 50%, rgb(255, 160, 90) 100%)"
                rangeGradient="linear-gradient(to right, rgb(166, 209, 255) 0%, rgb(255, 255, 255) 50%, rgb(255, 160, 90) 100%)"
              />
              <div className="flex justify-between text-xs text-foreground/40 px-1">
                <span>Kalt (6500K)</span>
                <span>Warm (2000K)</span>
              </div>
            </motion.div>
          )}

          {/* Color Controls */}
          {isOn && supportsColor && (
            <motion.div
              className="space-y-4"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.2 }}
            >
              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold text-foreground/90 flex items-center gap-2">
                  <Palette size={16} weight="fill" />
                  Farbe
                </label>
                <motion.button
                  onClick={() => setShowColorWheel(!showColorWheel)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-foreground/10 hover:bg-foreground/15 transition-colors font-medium"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  {showColorWheel ? 'Farbrad ausblenden' : 'Farbrad anzeigen'}
                </motion.button>
              </div>

              <AnimatePresence>
                {showColorWheel && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    <ColorPicker
                      value={rgbColor}
                      onChange={handleColorChange}
                      onChangeEnd={handleColorSelect}
                      disabled={isUpdating}
                      size={220}
                    />
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Color Presets */}
              <div className="space-y-3">
                <label className="text-xs text-foreground/60 font-medium">Favoriten</label>
                <div className="grid grid-cols-6 gap-2.5">
                  {presetColors.map((color, idx) => (
                    <motion.button
                      key={idx}
                      onClick={() => handleColorSelect(color)}
                      disabled={isUpdating}
                      className="relative group disabled:opacity-50"
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                    >
                      <div
                        className="w-full aspect-square rounded-lg transition-all"
                        style={{
                          backgroundColor: `rgb(${color[0]}, ${color[1]}, ${color[2]})`,
                          boxShadow: '0 2px 8px rgba(0,0,0,0.15), inset 0 0 0 1px rgba(255,255,255,0.1)',
                        }}
                      />
                      {rgbColor[0] === color[0] && rgbColor[1] === color[1] && rgbColor[2] === color[2] && (
                        <motion.div
                          className="absolute inset-0 rounded-lg border-2 border-foreground"
                          layoutId="selected-color"
                        />
                      )}
                    </motion.button>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
