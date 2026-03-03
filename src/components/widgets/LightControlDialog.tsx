import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Lightbulb, Power, SunHorizon, Circle } from '@phosphor-icons/react'
import type { LightEntity } from '@/lib/types'
import { haService } from '@/lib/homeAssistant'
import { haptics } from '@/lib/haptics'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { X } from '@phosphor-icons/react'

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
  const [isDragging, setIsDragging] = useState(false)
  const [rgbColor, setRgbColor] = useState<[number, number, number]>(
    entity.attributes.rgb_color || [255, 200, 100]
  )
  const name = entity.attributes.friendly_name || entity.entity_id
  const [isUpdating, setIsUpdating] = useState(false)
  const sliderRef = useRef<HTMLDivElement>(null)

  const supportsColor = entity.attributes.supported_color_modes?.includes('rgb') || 
                        entity.attributes.supported_color_modes?.includes('hs') ||
                        entity.attributes.rgb_color !== undefined

  useEffect(() => {
    if (entity.attributes.brightness !== undefined) {
      setBrightness(entity.attributes.brightness)
    }
    if (entity.attributes.rgb_color !== undefined) {
      setRgbColor(entity.attributes.rgb_color)
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

  const calculateBrightnessFromY = useCallback((clientY: number) => {
    if (!sliderRef.current) return null
    const rect = sliderRef.current.getBoundingClientRect()
    const y = clientY - rect.top
    const percentage = Math.max(0, Math.min(1, 1 - (y / rect.height)))
    return Math.round(percentage * 255)
  }, [])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!isOn) return
    e.preventDefault()
    setIsDragging(true)
    haptics.impact('light')
    
    const newBrightness = calculateBrightnessFromY(e.clientY)
    if (newBrightness !== null) {
      setBrightness(newBrightness)
    }

    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
  }, [isOn, calculateBrightnessFromY])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging || !isOn) return
    
    const newBrightness = calculateBrightnessFromY(e.clientY)
    if (newBrightness !== null) {
      setBrightness(newBrightness)
      haptics.selectionChanged()
    }
  }, [isDragging, isOn, calculateBrightnessFromY])

  const handlePointerUp = useCallback(async () => {
    if (!isDragging) return
    setIsDragging(false)
    
    haptics.impact('medium')
    setIsUpdating(true)
    try {
      if (brightness === 0) {
        await haService.turnOff(entity.entity_id)
        toast.success(`${name} ausgeschaltet`)
      } else {
        await haService.turnOn(entity.entity_id, { brightness })
        toast.success(`${name} auf ${Math.round((brightness / 255) * 100)}%`)
      }
      haptics.notification('success')
      onUpdate?.()
    } catch (error) {
      toast.error('Fehler beim Anpassen der Helligkeit')
      haptics.notification('error')
    } finally {
      setIsUpdating(false)
    }
  }, [isDragging, brightness, entity.entity_id, name, onUpdate])

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
      <DialogContent className="sm:max-w-[340px] glass-card border-foreground/10 p-0 gap-0 bg-card/95">
        <DialogHeader className="p-4 pb-3 border-b border-foreground/5">
          <DialogTitle className="flex items-center justify-between text-foreground">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-foreground/30" />
              <div className="w-2 h-2 rounded-full bg-foreground/30" />
              <div className="w-2 h-2 rounded-full bg-foreground/30" />
            </div>
            <span className="text-sm font-medium">{name}</span>
            <button
              onClick={() => onOpenChange(false)}
              className="text-foreground/60 hover:text-foreground/90 transition-colors"
            >
              <X size={20} />
            </button>
          </DialogTitle>
        </DialogHeader>

        <div className="p-6 space-y-6">
          <div className="flex flex-col items-center gap-4">
            <motion.div
              animate={isOn ? { scale: [1, 1.05, 1] } : {}}
              transition={{ duration: 2, repeat: Infinity }}
              className="text-center"
            >
              <div className="text-xl font-semibold text-foreground mb-1">
                {isOn ? 'On' : 'Off'}
              </div>
              <div className="text-xs text-foreground/50">
                {isOn ? '1 hour ago' : 'Not active'}
              </div>
            </motion.div>

            <div 
              ref={sliderRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              className={`relative w-32 h-64 rounded-3xl overflow-hidden ${
                isOn ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
              }`}
              style={{
                background: isOn 
                  ? `linear-gradient(to bottom, ${currentColor}, #FFFFFF)`
                  : 'linear-gradient(to bottom, #999, #FFFFFF)',
                touchAction: 'none',
              }}
            >
              <motion.div
                className="absolute inset-0 rounded-3xl"
                style={{
                  background: 'rgba(0, 0, 0, 0.3)',
                }}
                animate={{
                  clipPath: `inset(${(1 - brightnessPercent) * 100}% 0 0 0)`,
                }}
                transition={{ duration: 0.1 }}
              />
              
              {isOn && (
                <motion.div
                  className="absolute left-1/2 w-6 h-6 rounded-full bg-white shadow-lg -translate-x-1/2"
                  style={{
                    top: `${(1 - brightnessPercent) * 100}%`,
                    marginTop: '-12px',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                  }}
                  transition={{ duration: 0.1 }}
                />
              )}
            </div>

            <div className="flex items-center justify-center gap-4">
              <button 
                className="p-2.5 rounded-full bg-foreground/8 hover:bg-foreground/12 transition-colors disabled:opacity-50"
                disabled={isUpdating || !isOn}
              >
                <Lightbulb size={20} className="text-foreground/60" weight="fill" />
              </button>
              <button 
                onClick={handleToggle}
                disabled={isUpdating}
                className="p-3 rounded-full bg-foreground/10 hover:bg-foreground/15 transition-colors"
              >
                <Power size={24} className="text-foreground" weight="bold" />
              </button>
              <button 
                className="p-2.5 rounded-full bg-foreground/8 hover:bg-foreground/12 transition-colors disabled:opacity-50"
                disabled={isUpdating || !isOn}
              >
                <SunHorizon size={20} className="text-foreground/60" weight="fill" />
              </button>
            </div>
          </div>

          {supportsColor && (
            <div className="flex items-center justify-center gap-3 pt-2">
              {presetColors.map((color, idx) => (
                <button
                  key={idx}
                  onClick={() => handleColorSelect(color)}
                  disabled={isUpdating || !isOn}
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
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
