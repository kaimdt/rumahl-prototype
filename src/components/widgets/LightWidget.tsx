import { Card } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import type { LightEntity } from '@/lib/types'
import { haService } from '@/lib/homeAssistant'
import { Lightbulb, Lightning } from '@phosphor-icons/react'
import { useState } from 'react'

interface LightWidgetProps {
  entity: LightEntity
  onUpdate?: () => void
}

export function LightWidget({ entity, onUpdate }: LightWidgetProps) {
  const [isUpdating, setIsUpdating] = useState(false)
  const isOn = entity.state === 'on'
  const brightness = entity.attributes.brightness || 0
  const name = entity.attributes.friendly_name || entity.entity_id

  const handleToggle = async () => {
    setIsUpdating(true)
    try {
      await haService.toggleEntity(entity.entity_id)
      onUpdate?.()
    } finally {
      setIsUpdating(false)
    }
  }

  const handleBrightnessChange = async (values: number[]) => {
    const newBrightness = values[0]
    setIsUpdating(true)
    try {
      if (newBrightness === 0) {
        await haService.turnOff(entity.entity_id)
      } else {
        await haService.turnOn(entity.entity_id, { brightness: newBrightness })
      }
      onUpdate?.()
    } finally {
      setIsUpdating(false)
    }
  }

  return (
    <Card className="glass-card p-4 sm:p-5 rounded-2xl theme-transition hover:scale-[1.02] transition-all duration-200 group">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className={`p-2.5 rounded-xl transition-all duration-300 ${
              isOn 
                ? 'bg-gradient-to-br from-success/30 to-success/20 shadow-lg shadow-success/20 text-success' 
                : 'bg-muted/50 text-muted-foreground'
            }`}>
              {isOn ? (
                <Lightbulb size={20} weight="fill" className="animate-pulse" />
              ) : (
                <Lightbulb size={20} weight="regular" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-medium text-sm truncate">{name}</h3>
              <p className="text-xs text-muted-foreground font-mono">
                {isOn ? `${Math.round((brightness / 255) * 100)}%` : 'Aus'}
              </p>
            </div>
          </div>
          <Switch 
            checked={isOn} 
            onCheckedChange={handleToggle}
            disabled={isUpdating}
            className="ml-2"
          />
        </div>
        
        {entity.attributes.supported_features && isOn && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground flex items-center gap-1">
                <Lightning size={12} weight="fill" />
                Helligkeit
              </span>
              <span className="font-mono font-medium">{Math.round((brightness / 255) * 100)}%</span>
            </div>
            <Slider
              value={[brightness]}
              onValueChange={handleBrightnessChange}
              max={255}
              step={1}
              disabled={isUpdating}
              className="w-full"
            />
          </div>
        )}
      </div>
    </Card>
  )
}
