import { Card } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import type { LightEntity } from '@/lib/types'
import { haService } from '@/lib/homeAssistant'
import { Lightbulb } from '@phosphor-icons/react'
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
    <Card className="glass-card p-4 border-0 theme-transition">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg transition-colors ${
              isOn ? 'bg-success/20 text-success' : 'bg-muted text-muted-foreground'
            }`}>
              <Lightbulb size={24} weight={isOn ? 'fill' : 'regular'} />
            </div>
            <div>
              <h3 className="font-medium">{name}</h3>
              <p className="text-xs text-muted-foreground">
                {isOn ? `${Math.round((brightness / 255) * 100)}%` : 'Aus'}
              </p>
            </div>
          </div>
          <Switch 
            checked={isOn} 
            onCheckedChange={handleToggle}
            disabled={isUpdating}
          />
        </div>
        
        {entity.attributes.supported_features && isOn && (
          <Slider
            value={[brightness]}
            onValueChange={handleBrightnessChange}
            max={255}
            step={1}
            disabled={isUpdating}
            className="w-full"
          />
        )}
      </div>
    </Card>
  )
}
