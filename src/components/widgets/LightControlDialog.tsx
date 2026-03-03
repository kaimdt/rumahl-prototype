import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Slider } from '@/components/ui/slider'
import { Lightbulb, Power, SunHorizon, X } from '@phosphor-icons/react'
import type { LightEntity } from '@/lib/types'
import { haService } from '@/lib/homeAssistant'
import { haptics } from '@/lib/haptics'
import { motion } from 'framer-motion'
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
    [255, 159, 90],
    [255, 255, 255],
    [255, 230, 200],
    [200, 200, 255],
  ]

  const currentColor = `rgb(${rgbColor[0]}, ${rgbColor[1]}, ${rgbColor[2]})`
  const brightnessPercent = brightness / 255

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px] glass-card border-foreground/10 p-0 gap-0 bg-card/95">
        <DialogHeader className="p-5 pb-4 border-b border-foreground/5">
          <DialogTitle className="flex items-center justify-between text-foreground">
            <span className="text-base font-medium">{name}</span>
            <button
              onClick={() => onOpenChange(false)}
              className="text-foreground/60 hover:text-foreground/90 transition-colors"
            >
              <X size={20} />
            </button>
          </DialogTitle>
        </DialogHeader>

        <div className="p-6 space-y-6">
          {/* Power Toggle */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <motion.div
                animate={isOn ? { scale: [1, 1.05, 1] } : {}}
                transition={{ duration: 2, repeat: Infinity }}
                className={`p-2.5 rounded-xl transition-all duration-300`}
                style={{
                  backgroundColor: isOn
                    ? `color-mix(in oklch, ${`rgb(${rgbColor[0]}, ${rgbColor[1]}, ${rgbColor[2]})`} 30%, transparent)`
                    : 'oklch(from var(--muted) l c h / 0.5)',
                  color: isOn ? `rgb(${rgbColor[0]}, ${rgbColor[1]}, ${rgbColor[2]})` : 'var(--muted-foreground)',
                }}
              >
                <Lightbulb size={24} weight={isOn ? 'fill' : 'regular'} />
              </motion.div>
              <div>
                <div className="text-sm font-medium text-foreground">
                  {isOn ? 'Eingeschaltet' : 'Ausgeschaltet'}
                </div>
                {isOn && (
                  <div className="text-xs text-foreground/50">
                    {Math.round((brightness / 255) * 100)}%
                  </div>
                )}
              </div>
            </div>
            <button
              onClick={handleToggle}
              disabled={isUpdating}
              className="p-3 rounded-full bg-foreground/10 hover:bg-foreground/15 transition-colors disabled:opacity-50"
            >
              <Power size={24} className="text-foreground" weight="bold" />
            </button>
          </div>

          {/* Brightness Slider */}
          {isOn && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-foreground/80">Helligkeit</label>
                <span className="text-sm text-foreground/60 font-mono">
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
              />
            </div>
          )}

          {/* Color Temperature Slider */}
          {isOn && supportsColorTemp && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-foreground/80 flex items-center gap-2">
                  <SunHorizon size={16} weight="fill" />
                  Farbtemperatur
                </label>
                <span className="text-sm text-foreground/60 font-mono">
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
              />
              <div className="flex justify-between text-xs text-foreground/40">
                <span>Kalt</span>
                <span>Warm</span>
              </div>
            </div>
          )}

          {/* Color Presets */}
          {isOn && supportsColor && (
            <div className="space-y-3">
              <label className="text-sm font-medium text-foreground/80">Farbe</label>
              <div className="flex items-center justify-center gap-3">
                {presetColors.map((color, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleColorSelect(color)}
                    disabled={isUpdating}
                    className="relative group disabled:opacity-50"
                  >
                    <div
                      className="w-12 h-12 rounded-full transition-transform group-hover:scale-110 group-active:scale-95"
                      style={{
                        backgroundColor: `rgb(${color[0]}, ${color[1]}, ${color[2]})`,
                        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                      }}
                    />
                    {rgbColor[0] === color[0] && rgbColor[1] === color[1] && rgbColor[2] === color[2] && (
                      <div className="absolute inset-0 rounded-full border-2 border-foreground/40" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
