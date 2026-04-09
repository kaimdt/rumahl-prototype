import { useState, useRef, useCallback, useEffect } from 'react'
import { Lightbulb, CaretRight } from '@phosphor-icons/react'
import { haService } from '@/lib/homeAssistant'
import { haptics } from '@/lib/haptics'
import { toast } from 'sonner'
import type { EntityState, LightEntity } from '@/lib/types'
import { LightControlDialog } from './LightControlDialog'
import { getLightEnhancementSettings } from '@/lib/lightEnhancements'

interface LightGroupMemberRowProps {
  entity: LightEntity
  onUpdate?: () => void
  allEntities?: EntityState[]
  onCloseParentModal?: () => void
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  const toHex = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0').toUpperCase()
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

export function LightGroupMemberRow({ entity, onUpdate, allEntities, onCloseParentModal }: LightGroupMemberRowProps) {
  const [isUpdating, setIsUpdating] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [optimisticOn, setOptimisticOn] = useState<boolean | null>(null)
  const [localBrightness, setLocalBrightness] = useState<number | null>(null)
  const commitTimer = useRef<number | undefined>(undefined)
  const lastBrightnessChangeRef = useRef(0)
  const displayIsOn = optimisticOn !== null ? optimisticOn : entity.state === 'on'
  const brightness = localBrightness !== null ? localBrightness : ((entity.attributes.brightness as number) ?? 0)
  const brightnessPercent = Math.round((brightness / 255) * 100)
  const name = (entity.attributes.friendly_name as string) || entity.entity_id.split('.').pop() || ''
  const rgbColor = entity.attributes.rgb_color as [number, number, number] | undefined
  const lightEnhancements = getLightEnhancementSettings()

  useEffect(() => {
    setOptimisticOn(null)
  }, [entity.state])

  useEffect(() => {
    if (Date.now() - lastBrightnessChangeRef.current > 4000) {
      setLocalBrightness(null)
    }
  }, [entity.attributes.brightness])

  const handleToggle = async () => {
    const wasOn = displayIsOn
    setOptimisticOn(!wasOn)
    haptics.impact('medium')
    try {
      if (wasOn) {
        await haService.turnOff(entity.entity_id)
      } else {
        await haService.turnOn(entity.entity_id)
      }
      onUpdate?.()
    } catch {
      setOptimisticOn(null)
      toast.error('Fehler beim Steuern')
    }
  }

  const handleBrightnessChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const percent = parseInt(e.target.value)
    const brightnessValue = Math.round((percent / 100) * 255)
    setLocalBrightness(brightnessValue)
    lastBrightnessChangeRef.current = Date.now()
    haptics.selectionChanged()

    if (commitTimer.current !== undefined) {
      window.clearTimeout(commitTimer.current)
    }
    commitTimer.current = window.setTimeout(async () => {
      setIsUpdating(true)
      try {
        await haService.turnOn(entity.entity_id, { brightness: brightnessValue })
        onUpdate?.()
      } catch {
        toast.error('Fehler beim Steuern')
      } finally {
        setIsUpdating(false)
      }
    }, 300)
  }, [entity.entity_id, onUpdate])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    haptics.impact('medium')
    setDialogOpen(true)
  }, [])

  const accentColor = rgbColor ? `rgb(${rgbColor.join(',')})` : 'var(--accent)'
  const showRgbHexTag =
    lightEnhancements.showRgbHexInGroupMembers &&
    !!rgbColor
  const rgbHex = rgbColor ? rgbToHex(rgbColor) : null

  return (
    <>
      <div
        className="flex items-center gap-3 py-2.5 select-none"
        onContextMenu={handleContextMenu}
      >
        {/* Color dot / icon */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            handleToggle()
          }}
          className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all"
          style={{
            backgroundColor: displayIsOn
              ? `color-mix(in oklch, ${accentColor}, transparent 80%)`
              : 'oklch(from var(--foreground) l c h / 0.12)',
            color: displayIsOn
              ? accentColor
              : 'oklch(from var(--foreground) l c h / 0.6)',
          }}
        >
          <Lightbulb size={14} weight={displayIsOn ? 'fill' : 'duotone'} />
        </button>

        {/* Name + slider */}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-foreground truncate mb-1">{name}</p>
          {showRgbHexTag && rgbHex && (
            <p className="text-[10px] font-mono truncate mb-1" style={{ color: accentColor }}>
              RGB {rgbHex}
            </p>
          )}
          <div className="relative">
            <div className="h-8 rounded-full bg-foreground/10 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-150"
                style={{
                  width: displayIsOn ? `${brightnessPercent}%` : '0%',
                  backgroundColor: accentColor,
                }}
              />
            </div>
            {displayIsOn && (
              <div
                className="absolute top-1/2 -translate-y-1/2 w-1 h-5 rounded-full bg-white pointer-events-none"
                style={{
                  left: `clamp(2px, calc(${brightnessPercent}% - 2px), calc(100% - 4px))`,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                }}
              />
            )}
            <input
              type="range"
              min={0}
              max={100}
              value={displayIsOn ? brightnessPercent : 0}
              onChange={handleBrightnessChange}
              disabled={!displayIsOn}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
            />
          </div>
        </div>

        {/* Brightness label + detail button */}
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[10px] text-foreground/40 w-8 text-right">
            {displayIsOn ? `${brightnessPercent}%` : 'Aus'}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation()
              haptics.impact('medium')
              setDialogOpen(true)
            }}
            className="p-1.5 rounded-lg hover:bg-foreground/10 transition-colors"
          >
            <CaretRight size={12} weight="bold" className="text-foreground/30" />
          </button>
        </div>
      </div>

      {/* Individual light control sub-modal */}
      <LightControlDialog
        entity={entity}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onUpdate={onUpdate}
        allEntities={allEntities}
        isSubModal
        onNavigateBack={() => setDialogOpen(false)}
        onCloseAll={() => {
          setDialogOpen(false)
          onCloseParentModal?.()
        }}
      />
    </>
  )
}
