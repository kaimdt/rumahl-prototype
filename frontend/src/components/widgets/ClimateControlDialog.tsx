import { useState, useEffect, useRef } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Flame, Snowflake, Fan, Wind } from '@phosphor-icons/react'
import type { ClimateEntity } from '@/lib/types'
import { haService } from '@/lib/homeAssistant'
import { motion } from 'motion/react'

import { ArcSlider } from '@/components/ui/arc-slider'
import { EntityHistoryPanel } from './EntityHistoryPanel'
import { getModalSizeClass } from '@/lib/utils'

interface ClimateControlDialogProps {
  entity: ClimateEntity
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdate?: () => void
  modalSize?: string
}

export function ClimateControlDialog({
  entity,
  open,
  onOpenChange,
  onUpdate,
  modalSize,
}: ClimateControlDialogProps) {
  const currentTemp = entity.attributes.current_temperature || 0
  const minTemp = Number(entity.attributes.min_temp ?? 7)
  const maxTemp = Number(entity.attributes.max_temp ?? 35)
  const tempStep = Number(entity.attributes.target_temp_step ?? 0.5)
  const safeTemp = Number(entity.attributes.temperature ?? 20)
  const [activeTab, setActiveTab] = useState<'controls' | 'history'>('controls')
  const [targetTemp, setTargetTemp] = useState(Math.max(minTemp, Math.min(maxTemp, safeTemp)))
  const [optimisticMode, setOptimisticMode] = useState<string | null>(null)
  const displayMode = optimisticMode ?? entity.state
  const name = entity.attributes.friendly_name || entity.entity_id
  const hvacAction = entity.attributes.hvac_action
  const lastChangeRef = useRef<Record<string, number>>({})

  useEffect(() => {
    if (entity.attributes.temperature !== undefined && Date.now() - (lastChangeRef.current.temp ?? 0) > 4000) {
      const next = Number(entity.attributes.temperature)
      setTargetTemp(Math.max(minTemp, Math.min(maxTemp, next)))
    }
  }, [entity, minTemp, maxTemp])

  useEffect(() => {
    setOptimisticMode(null)
  }, [entity.state])

  const getModeIcon = (modeType: string, size = 20) => {
    switch (modeType) {
      case 'heat':
        return <Flame size={size} weight="fill" />
      case 'cool':
        return <Snowflake size={size} weight="fill" />
      case 'auto':
        return <Fan size={size} weight="fill" />
      default:
        return <Wind size={size} weight="regular" />
    }
  }

  const getModeColorCSS = (modeType: string) => {
    switch (modeType) {
      case 'heat':
        return 'oklch(0.65 0.25 25)'
      case 'cool':
        return 'oklch(0.65 0.18 240)'
      case 'auto':
        return 'oklch(0.65 0.2 145)'
      default:
        return 'oklch(from var(--foreground) l c h / 0.4)'
    }
  }

  const getActionColor = (action: string | undefined) => {
    switch (action) {
      case 'heating':
        return 'oklch(0.65 0.25 25)'
      case 'cooling':
        return 'oklch(0.65 0.18 240)'
      case 'idle':
        return 'oklch(0.75 0.15 85)'
      case 'off':
      default:
        return 'oklch(from var(--foreground) l c h / 0.25)'
    }
  }

  const handleTempCommit = (newTemp: number) => {
    setTargetTemp(newTemp)
    lastChangeRef.current.temp = Date.now()
    haService.callServiceFireAndForget('climate', 'set_temperature', entity.entity_id, {
      temperature: newTemp,
    })
  }

  const handleModeChange = (newMode: string) => {
    setOptimisticMode(newMode)
    haService.callServiceFireAndForget('climate', 'set_hvac_mode', entity.entity_id, {
      hvac_mode: newMode,
    })
  }

  const presetTemp = (temp: number) => {
    setTargetTemp(temp)
    lastChangeRef.current.temp = Date.now()
    haService.callServiceFireAndForget('climate', 'set_temperature', entity.entity_id, {
      temperature: temp,
    })
  }

  const modeColor = getModeColorCSS(displayMode)
  const actionColor = getActionColor(hvacAction)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={`${getModalSizeClass(modalSize)} glass-card border-foreground/10 p-0 gap-0 bg-card/95 backdrop-blur-2xl overflow-y-auto overflow-x-hidden`}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{name} Klima Steuerung</DialogTitle>
        </DialogHeader>
        {/* Ambient glow */}
        {displayMode !== 'off' && (
          <div
            className="absolute -top-20 left-1/2 -translate-x-1/2 w-64 h-64 rounded-full pointer-events-none"
            style={{
              background: `radial-gradient(circle, ${actionColor}, transparent 70%)`,
              filter: 'blur(40px)',
              opacity: 0.2,
            }}
          />
        )}

        {/* Header */}
        <div className="relative flex items-center justify-between px-5 pt-5 pb-2">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="p-2 rounded-xl shrink-0"
              style={{
                backgroundColor: displayMode !== 'off'
                  ? `color-mix(in oklch, ${actionColor} 25%, transparent)`
                  : 'oklch(from var(--muted) l c h / 0.5)',
                color: displayMode !== 'off' ? actionColor : 'var(--muted-foreground)',
              }}
            >
              {getModeIcon(displayMode)}
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-foreground truncate">{name}</h2>
              <p className="text-xs text-foreground/40 capitalize">
                {hvacAction || displayMode}
              </p>
            </div>
          </div>
        </div>

        {/* Tab bar */}
        <div className="relative px-5 pb-2">
          <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid oklch(from var(--foreground) l c h / 0.1)' }}>
            <button
              onClick={() => setActiveTab('controls')}
              className="flex-1 px-3 py-1.5 text-[11px] font-medium transition-colors"
              style={{
                backgroundColor: activeTab === 'controls' ? 'oklch(from var(--foreground) l c h / 0.1)' : 'transparent',
                color: activeTab === 'controls' ? 'var(--foreground)' : 'oklch(from var(--foreground) l c h / 0.4)',
              }}
            >
              Steuerung
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className="flex-1 px-3 py-1.5 text-[11px] font-medium transition-colors"
              style={{
                backgroundColor: activeTab === 'history' ? 'oklch(from var(--foreground) l c h / 0.1)' : 'transparent',
                color: activeTab === 'history' ? 'var(--foreground)' : 'oklch(from var(--foreground) l c h / 0.4)',
              }}
            >
              Verlauf
            </button>
          </div>
        </div>

        {activeTab === 'controls' ? (
        <>
        {/* Arc Slider */}
        <div className="relative px-5 pb-0 -mt-2">
          <ArcSlider
            value={targetTemp}
            min={minTemp}
            max={maxTemp}
            step={tempStep}
            onChange={setTargetTemp}
            onChangeEnd={handleTempCommit}
            modeColor={actionColor}
            currentTemp={currentTemp}
            label="Ziel"
            size={280}
          />
        </div>

        {/* Controls */}
        <div className="relative px-5 pb-5 space-y-4 -mt-2">
          {/* Preset temperatures */}
          <div className="grid grid-cols-4 gap-2">
            {[18, 20, 22, 24].map((temp) => (
              <motion.button
                key={temp}
                onClick={() => presetTemp(temp)}
                className="py-2.5 rounded-xl text-xs font-semibold transition-colors"
                style={{
                  backgroundColor:
                    targetTemp === temp
                      ? `color-mix(in oklch, ${modeColor} 25%, transparent)`
                      : 'oklch(from var(--foreground) l c h / 0.06)',
                  color:
                    targetTemp === temp
                      ? modeColor
                      : 'oklch(from var(--foreground) l c h / 0.6)',
                  border:
                    targetTemp === temp
                      ? `1px solid color-mix(in oklch, ${modeColor} 30%, transparent)`
                      : '1px solid oklch(from var(--foreground) l c h / 0.08)',
                }}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
              >
                {temp}°C
              </motion.button>
            ))}
          </div>

          {/* Mode buttons */}
          <div>
            <span className="text-xs font-semibold text-foreground/50 mb-2.5 block">Modus</span>
            <div className="grid grid-cols-4 gap-2">
              {[
                { key: 'heat', label: 'Heizen', icon: Flame },
                { key: 'cool', label: 'Kühlen', icon: Snowflake },
                { key: 'auto', label: 'Auto', icon: Fan },
                { key: 'off', label: 'Aus', icon: Wind },
              ].map(({ key, label, icon: Icon }) => {
                const isActive = displayMode === key
                const buttonColor = getModeColorCSS(key)
                return (
                  <motion.button
                    key={key}
                    onClick={() => handleModeChange(key)}
                    className="flex flex-col items-center gap-1.5 py-2.5 rounded-xl text-[11px] font-medium transition-colors"
                    style={{
                      backgroundColor: isActive
                        ? `color-mix(in oklch, ${buttonColor} 20%, transparent)`
                        : 'oklch(from var(--foreground) l c h / 0.04)',
                      color: isActive ? buttonColor : 'oklch(from var(--foreground) l c h / 0.5)',
                      border: isActive
                        ? `1px solid color-mix(in oklch, ${buttonColor} 30%, transparent)`
                        : '1px solid oklch(from var(--foreground) l c h / 0.06)',
                    }}
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                  >
                    <Icon size={18} weight={isActive ? 'fill' : 'regular'} />
                    {label}
                  </motion.button>
                )
              })}
            </div>
          </div>
        </div>
        </>
        ) : (
        <div className="relative px-5 pb-5">
          <EntityHistoryPanel
            entityId={entity.entity_id}
            entityState={entity.state}
            color={actionColor}
            unit="°C"
          />
        </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
