import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { ThermometerSimple, Flame, Snowflake, Fan, Wind } from '@phosphor-icons/react'
import type { ClimateEntity } from '@/lib/types'
import { haService } from '@/lib/homeAssistant'
import { motion } from 'framer-motion'

interface ClimateControlDialogProps {
  entity: ClimateEntity
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdate?: () => void
}

export function ClimateControlDialog({
  entity,
  open,
  onOpenChange,
  onUpdate,
}: ClimateControlDialogProps) {
  const currentTemp = entity.attributes.current_temperature || 0
  const [targetTemp, setTargetTemp] = useState(entity.attributes.temperature || 20)
  const mode = entity.state
  const name = entity.attributes.friendly_name || entity.entity_id
  const hvacAction = entity.attributes.hvac_action
  const [isUpdating, setIsUpdating] = useState(false)

  useEffect(() => {
    if (entity.attributes.temperature !== undefined) {
      setTargetTemp(entity.attributes.temperature)
    }
  }, [entity])

  const getModeIcon = (modeType: string) => {
    switch (modeType) {
      case 'heat':
        return <Flame size={24} weight="fill" />
      case 'cool':
        return <Snowflake size={24} weight="fill" />
      case 'auto':
        return <Fan size={24} weight="fill" />
      default:
        return <Wind size={24} weight="regular" />
    }
  }

  const getModeColor = (modeType: string) => {
    switch (modeType) {
      case 'heat':
        return 'from-destructive/30 to-destructive/20 text-destructive'
      case 'cool':
        return 'from-accent/30 to-accent/20 text-accent'
      case 'auto':
        return 'from-success/30 to-success/20 text-success'
      default:
        return 'bg-muted/50 text-muted-foreground'
    }
  }

  const handleTempCommit = async (values: number[]) => {
    const newTemp = values[0]
    setIsUpdating(true)
    try {
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

  const presetTemp = async (temp: number) => {
    setTargetTemp(temp)
    setIsUpdating(true)
    try {
      await haService.callService('climate', 'set_temperature', entity.entity_id, {
        temperature: temp,
      })
      onUpdate?.()
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
              className={`p-3 rounded-xl bg-gradient-to-br shadow-lg ${getModeColor(mode)}`}
              animate={{ scale: [1, 1.05, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              {getModeIcon(mode)}
            </motion.div>
            <div>
              <div className="text-foreground font-semibold">{name}</div>
              <div className="text-sm text-foreground/70 font-normal capitalize">
                {hvacAction || mode}
              </div>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="flex items-center justify-center gap-8">
            <div className="text-center space-y-1">
              <div className="flex items-baseline justify-center gap-1">
                <ThermometerSimple size={20} weight="fill" className="text-foreground/70" />
                <span className="text-3xl font-light text-foreground">{currentTemp.toFixed(1)}</span>
                <span className="text-sm text-foreground/70">°C</span>
              </div>
              <p className="text-xs text-foreground/70 uppercase tracking-wide font-medium">Aktuell</p>
            </div>

            <div className="h-16 w-px bg-border/50"></div>

            <div className="text-center space-y-1">
              <div className="flex items-baseline justify-center gap-1">
                <span className="text-3xl font-light text-foreground">{targetTemp.toFixed(1)}</span>
                <span className="text-sm text-foreground/70">°C</span>
              </div>
              <p className="text-xs text-foreground/70 uppercase tracking-wide font-medium">Ziel</p>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground/80 font-medium">Zieltemperatur</span>
              <span className="text-sm font-mono font-semibold text-foreground">
                {targetTemp.toFixed(1)}°C
              </span>
            </div>
            <Slider
              value={[targetTemp]}
              onValueChange={(values) => setTargetTemp(values[0])}
              onValueCommit={handleTempCommit}
              min={15}
              max={30}
              step={0.5}
              disabled={isUpdating}
              className="w-full"
            />
            <div className="grid grid-cols-4 gap-2">
              {[18, 20, 22, 24].map((temp) => (
                <Button
                  key={temp}
                  variant="outline"
                  size="sm"
                  onClick={() => presetTemp(temp)}
                  disabled={isUpdating}
                  className="text-xs h-8"
                >
                  {temp}°C
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <span className="text-sm text-foreground/80 font-medium">Modus</span>
            <div className="grid grid-cols-2 gap-2">
              {[
                { key: 'heat', label: 'Heizen', icon: Flame },
                { key: 'cool', label: 'Kühlen', icon: Snowflake },
                { key: 'auto', label: 'Auto', icon: Fan },
                { key: 'off', label: 'Aus', icon: Wind },
              ].map(({ key, label, icon: Icon }) => (
                <Button
                  key={key}
                  variant={mode === key ? 'default' : 'outline'}
                  size="sm"
                  className="gap-2 h-10"
                  onClick={() => handleModeChange(key)}
                  disabled={isUpdating}
                >
                  <Icon size={16} weight={mode === key ? 'fill' : 'regular'} />
                  {label}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
