import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Slider } from '@/components/ui/slider'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Lightbulb, Lightning, Power, Palette, Thermometer } from '@phosphor-icons/react'
import type { LightEntity } from '@/lib/types'
import { haService } from '@/lib/homeAssistant'
import { haptics } from '@/lib/haptics'
import { ColorPicker } from '@/components/ColorPicker'
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
  const [colorTemp, setColorTemp] = useState(entity.attributes.color_temp || 370)
  const [rgbColor, setRgbColor] = useState<[number, number, number]>(
    entity.attributes.rgb_color || [255, 255, 255]
  )
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
    if (entity.attributes.color_temp !== undefined) {
      setColorTemp(entity.attributes.color_temp)
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

  const handleBrightnessChange = (values: number[]) => {
    setBrightness(values[0])
    haptics.selectionChanged()
  }

  const handleBrightnessCommit = async (values: number[]) => {
    const newBrightness = values[0]
    haptics.impact('light')
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

  const handleColorTempChange = (values: number[]) => {
    setColorTemp(values[0])
    haptics.selectionChanged()
  }

  const handleColorTempCommit = async (values: number[]) => {
    const newColorTemp = values[0]
    haptics.impact('light')
    setIsUpdating(true)
    try {
      await haService.turnOn(entity.entity_id, { 
        color_temp: newColorTemp,
        brightness: brightness 
      })
      toast.success('Farbtemperatur angepasst')
      haptics.notification('success')
      onUpdate?.()
    } catch (error) {
      toast.error('Fehler beim Anpassen der Farbtemperatur')
      haptics.notification('error')
    } finally {
      setIsUpdating(false)
    }
  }

  const handleColorChange = (rgb: [number, number, number]) => {
    setRgbColor(rgb)
  }

  const handleColorCommit = async (rgb: [number, number, number]) => {
    setIsUpdating(true)
    try {
      await haService.turnOn(entity.entity_id, { 
        rgb_color: rgb,
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

  const presetBrightness = async (value: number) => {
    setBrightness(value)
    haptics.impact('light')
    setIsUpdating(true)
    try {
      await haService.turnOn(entity.entity_id, { brightness: value })
      toast.success(`${name} auf ${Math.round((value / 255) * 100)}%`)
      haptics.notification('success')
      onUpdate?.()
    } catch (error) {
      toast.error('Fehler')
      haptics.notification('error')
    } finally {
      setIsUpdating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md glass-card border-foreground/10">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 text-foreground">
            <motion.div
              className={`p-3 rounded-xl ${
                isOn
                  ? 'bg-gradient-to-br from-success/30 to-success/20 text-success'
                  : 'bg-muted/50 text-muted-foreground'
              }`}
              animate={isOn ? { scale: [1, 1.05, 1] } : {}}
              transition={{ duration: 2, repeat: Infinity }}
            >
              <Lightbulb size={24} weight={isOn ? 'fill' : 'regular'} />
            </motion.div>
            <div>
              <div className="text-foreground font-semibold">{name}</div>
              <div className="text-sm text-foreground/70 font-normal font-mono">
                {isOn ? `${Math.round((brightness / 255) * 100)}%` : 'Aus'}
              </div>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-foreground/80 font-medium">Zustand</span>
            <Button
              onClick={handleToggle}
              disabled={isUpdating}
              variant={isOn ? 'default' : 'outline'}
              className="gap-2 glass-card border-foreground/15"
            >
              <Power size={16} weight="bold" />
              {isOn ? 'Aus' : 'An'}
            </Button>
          </div>

          {isOn && (
            <>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-foreground/80 font-medium flex items-center gap-2">
                    <Lightning size={16} weight="fill" />
                    Helligkeit
                  </span>
                  <span className="text-sm font-mono font-semibold text-foreground">
                    {Math.round((brightness / 255) * 100)}%
                  </span>
                </div>
                <div className="space-y-2">
                  <Slider
                    value={[brightness]}
                    onValueChange={handleBrightnessChange}
                    onValueCommit={handleBrightnessCommit}
                    max={255}
                    step={1}
                    disabled={isUpdating}
                    className="w-full"
                  />
                  <div className="flex justify-between text-[10px] text-muted-foreground font-medium px-1">
                    <span>0%</span>
                    <span>100%</span>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {[25, 50, 75, 100].map((percent) => (
                    <Button
                      key={percent}
                      variant="outline"
                      size="sm"
                      onClick={() => presetBrightness(Math.round((percent / 100) * 255))}
                      disabled={isUpdating}
                      className="text-xs h-8 glass-card border-foreground/15"
                    >
                      {percent}%
                    </Button>
                  ))}
                </div>
              </div>

              {(supportsColor || supportsColorTemp) && (
                <Tabs defaultValue={supportsColor ? "color" : "temp"} className="w-full">
                  <TabsList className="grid w-full grid-cols-2 glass-card border border-foreground/10 p-1">
                    {supportsColor && (
                      <TabsTrigger 
                        value="color" 
                        className="gap-2 data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:font-semibold"
                      >
                        <Palette size={16} weight="fill" />
                        Farbe
                      </TabsTrigger>
                    )}
                    {supportsColorTemp && (
                      <TabsTrigger 
                        value="temp" 
                        className="gap-2 data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:font-semibold"
                      >
                        <Thermometer size={16} weight="fill" />
                        Temperatur
                      </TabsTrigger>
                    )}
                  </TabsList>

                  {supportsColor && (
                    <TabsContent value="color" className="space-y-4 mt-4">
                      <ColorPicker
                        value={rgbColor}
                        onChange={handleColorChange}
                        onChangeComplete={handleColorCommit}
                        disabled={isUpdating}
                      />
                    </TabsContent>
                  )}

                  {supportsColorTemp && (
                    <TabsContent value="temp" className="space-y-3 mt-4">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-foreground/80 font-medium">
                          Farbtemperatur
                        </span>
                        <span className="text-sm font-mono font-semibold text-foreground">
                          {colorTemp}K
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
                      <div className="flex justify-between text-xs text-foreground/70 font-medium">
                        <span>Warm</span>
                        <span>Kalt</span>
                      </div>
                    </TabsContent>
                  )}
                </Tabs>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
