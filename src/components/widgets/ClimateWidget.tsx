import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { ClimateEntity } from '@/lib/types'
import { haService } from '@/lib/homeAssistant'
import { ThermometerSimple, Flame, Snowflake, Fan, Wind } from '@phosphor-icons/react'
import { useState } from 'react'

interface ClimateWidgetProps {
  entity: ClimateEntity
  onUpdate?: () => void
}

export function ClimateWidget({ entity, onUpdate }: ClimateWidgetProps) {
  const [isUpdating, setIsUpdating] = useState(false)
  const currentTemp = entity.attributes.current_temperature || 0
  const targetTemp = entity.attributes.temperature || 20
  const mode = entity.state
  const name = entity.attributes.friendly_name || entity.entity_id
  const hvacAction = entity.attributes.hvac_action

  const getModeIcon = () => {
    switch (mode) {
      case 'heat':
        return <Flame size={20} weight="fill" className="text-destructive" />
      case 'cool':
        return <Snowflake size={20} weight="fill" className="text-accent" />
      case 'auto':
        return <Fan size={20} weight="fill" className="text-success" />
      default:
        return <Wind size={20} weight="regular" className="text-muted-foreground" />
    }
  }

  const getModeColor = () => {
    switch (mode) {
      case 'heat':
        return 'from-destructive/30 to-destructive/20 shadow-destructive/20 text-destructive'
      case 'cool':
        return 'from-accent/30 to-accent/20 shadow-accent/20 text-accent'
      case 'auto':
        return 'from-success/30 to-success/20 shadow-success/20 text-success'
      default:
        return 'bg-muted/50 text-muted-foreground'
    }
  }

  const handleTempChange = async (delta: number) => {
    setIsUpdating(true)
    try {
      const newTemp = Math.round((targetTemp + delta) * 2) / 2
      await haService.callService('climate', 'set_temperature', entity.entity_id, {
        temperature: newTemp,
      })
      onUpdate?.()
    } finally {
      setIsUpdating(false)
    }
  }

  const handleModeChange = async (newMode: string) => {
    setIsUpdating(true)
    try {
      await haService.callService('climate', 'set_hvac_mode', entity.entity_id, {
        hvac_mode: newMode,
      })
      onUpdate?.()
    } finally {
      setIsUpdating(false)
    }
  }

  return (
    <Card className="glass-card p-4 sm:p-5 rounded-2xl theme-transition hover:scale-[1.02] transition-all duration-200">
      <div className="space-y-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className={`p-2.5 rounded-xl transition-all duration-300 bg-gradient-to-br shadow-lg ${getModeColor()}`}>
              {getModeIcon()}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-medium text-sm truncate">{name}</h3>
              <p className="text-xs text-muted-foreground capitalize">
                {hvacAction || mode}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex-1 space-y-2">
            <div className="flex items-baseline gap-1">
              <ThermometerSimple size={16} weight="fill" className="text-muted-foreground" />
              <span className="text-2xl font-light">{currentTemp.toFixed(1)}</span>
              <span className="text-xs text-muted-foreground">°C</span>
            </div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Aktuell</p>
          </div>

          <div className="h-12 w-px bg-border"></div>

          <div className="flex-1 flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-lg"
              onClick={() => handleTempChange(-0.5)}
              disabled={isUpdating}
            >
              <span className="text-base">−</span>
            </Button>
            <div className="flex-1 text-center">
              <div className="text-2xl font-light">{targetTemp.toFixed(1)}</div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Ziel</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-lg"
              onClick={() => handleTempChange(0.5)}
              disabled={isUpdating}
            >
              <span className="text-base">+</span>
            </Button>
          </div>
        </div>

        <div className="flex gap-2">
          {['heat', 'cool', 'auto', 'off'].map((modeOption) => (
            <Button
              key={modeOption}
              variant={mode === modeOption ? 'default' : 'ghost'}
              size="sm"
              className="flex-1 h-8 text-xs capitalize rounded-lg"
              onClick={() => handleModeChange(modeOption)}
              disabled={isUpdating}
            >
              {modeOption === 'heat' && <Flame size={14} weight="fill" className="mr-1" />}
              {modeOption === 'cool' && <Snowflake size={14} weight="fill" className="mr-1" />}
              {modeOption === 'auto' && <Fan size={14} weight="fill" className="mr-1" />}
              {modeOption === 'off' && <Wind size={14} weight="regular" className="mr-1" />}
              {modeOption === 'heat' ? 'Heizen' : modeOption === 'cool' ? 'Kühlen' : modeOption === 'auto' ? 'Auto' : 'Aus'}
            </Button>
          ))}
        </div>
      </div>
    </Card>
  )
}
