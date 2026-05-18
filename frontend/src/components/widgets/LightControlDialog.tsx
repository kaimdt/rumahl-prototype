import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ColorPicker } from '@/components/ui/color-picker'
import { Lightbulb, Power, SunHorizon, Palette, Sun, Sparkle, Plus, Snowflake, Flame, Rainbow, ArrowLeft, X, Timer, Thermometer } from '@phosphor-icons/react'
import type { EntityState, LightEntity } from '@/lib/types'
import { haService } from '@/lib/homeAssistant'
import { haptics } from '@/lib/haptics'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import { LightGroupMemberRow } from './LightGroupMemberRow'
import { EntityHistoryPanel } from './EntityHistoryPanel'
import { getModalSizeClass } from '@/lib/utils'
import { getLightEnhancementSettings, isTwoZoneSyncEntity } from '@/lib/lightEnhancements'

// --- Color favorites helpers (per entity_id, localStorage) ---

function getFavorites(entityId: string): [number, number, number][] {
  try {
    const raw = localStorage.getItem(`ha-light-favorites-${entityId}`)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveFavorite(entityId: string, color: [number, number, number]) {
  const existing = getFavorites(entityId)
  const isDupe = existing.some(c =>
    Math.abs(c[0] - color[0]) < 5 && Math.abs(c[1] - color[1]) < 5 && Math.abs(c[2] - color[2]) < 5
  )
  if (!isDupe) {
    const updated = [...existing, color].slice(-12)
    localStorage.setItem(`ha-light-favorites-${entityId}`, JSON.stringify(updated))
  }
}

function removeFavorite(entityId: string, index: number) {
  const existing = getFavorites(entityId)
  existing.splice(index, 1)
  localStorage.setItem(`ha-light-favorites-${entityId}`, JSON.stringify(existing))
}

// --- Types ---

interface LightControlDialogProps {
  entity: LightEntity
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdate?: () => void
  allEntities?: EntityState[]
  isSubModal?: boolean
  onNavigateBack?: () => void
  onCloseAll?: () => void
  modalSize?: string
}

const safeRgb = (color: [number, number, number] | null | undefined): [number, number, number] =>
  color ?? [255, 200, 100]

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function miredToKelvin(mired: number): number | null {
  if (!Number.isFinite(mired) || mired <= 0) return null
  return Math.round(1000000 / mired)
}

function kelvinToMired(kelvin: number): number | null {
  if (!Number.isFinite(kelvin) || kelvin <= 0) return null
  return Math.round(1000000 / kelvin)
}

function kelvinToRgb(kelvinInput: number): [number, number, number] {
  const kelvin = clamp(kelvinInput, 1000, 40000) / 100
  let red: number
  let green: number
  let blue: number

  if (kelvin <= 66) {
    red = 255
    green = 99.4708025861 * Math.log(kelvin) - 161.1195681661
    blue = kelvin <= 19 ? 0 : 138.5177312231 * Math.log(kelvin - 10) - 305.0447927307
  } else {
    red = 329.698727446 * Math.pow(kelvin - 60, -0.1332047592)
    green = 288.1221695283 * Math.pow(kelvin - 60, -0.0755148492)
    blue = 255
  }

  return [
    Math.round(clamp(red, 0, 255)),
    Math.round(clamp(green, 0, 255)),
    Math.round(clamp(blue, 0, 255)),
  ]
}

function approximateRgbFromMired(
  mired: number,
  minMired: number,
  maxMired: number
): [number, number, number] {
  const range = Math.max(1, maxMired - minMired)
  const normalized = clamp((mired - minMired) / range, 0, 1)
  // Slight gamma to make warm-end colors stronger.
  const t = Math.pow(normalized, 0.85)
  const cold: [number, number, number] = [166, 209, 255]
  const warm: [number, number, number] = [255, 145, 56]
  return [
    Math.round(cold[0] + (warm[0] - cold[0]) * t),
    Math.round(cold[1] + (warm[1] - cold[1]) * t),
    Math.round(cold[2] + (warm[2] - cold[2]) * t),
  ]
}

// --- BrightnessColumn ---

function BrightnessColumn({
  brightness,
  color,
  isOn,
  onChange,
  onCommit,
  entityId,
}: {
  brightness: number
  color: string
  isOn: boolean
  onChange: (value: number) => void
  onCommit: (value: number) => void
  entityId: string
}) {
  const columnRef = useRef<HTMLDivElement>(null)
  const isDraggingRef = useRef(false)
  const lastLiveSendRef = useRef(0)
  const liveSendTimerRef = useRef<number | undefined>(undefined)
  const percent = Math.round((brightness / 255) * 100)

  const calcBrightness = useCallback((clientY: number) => {
    if (!columnRef.current) return brightness
    const rect = columnRef.current.getBoundingClientRect()
    const margin = 8
    const y = clientY - rect.top - margin
    const usableHeight = rect.height - margin * 2
    const ratio = 1 - Math.max(0, Math.min(1, y / usableHeight))
    return Math.round(ratio * 255)
  }, [brightness])

  // Throttled live send to HA during drag
  const sendLive = useCallback((value: number) => {
    const now = Date.now()
    const THROTTLE_MS = 500
    if (liveSendTimerRef.current) {
      window.clearTimeout(liveSendTimerRef.current)
    }
    if (now - lastLiveSendRef.current >= THROTTLE_MS) {
      lastLiveSendRef.current = now
      haService.turnOnFireAndForget(entityId, { brightness: Math.max(1, value) })
    } else {
      liveSendTimerRef.current = window.setTimeout(() => {
        lastLiveSendRef.current = Date.now()
        haService.turnOnFireAndForget(entityId, { brightness: Math.max(1, value) })
      }, THROTTLE_MS - (now - lastLiveSendRef.current))
    }
  }, [entityId])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    isDraggingRef.current = true
    const val = calcBrightness(e.clientY)
    onChange(val)
    haptics.impact('light')
  }, [calcBrightness, onChange])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current) return
    const val = calcBrightness(e.clientY)
    onChange(val)
    sendLive(val)
    haptics.selectionChanged()
  }, [calcBrightness, onChange, sendLive])

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current) return
    isDraggingRef.current = false
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (liveSendTimerRef.current) {
      window.clearTimeout(liveSendTimerRef.current)
      liveSendTimerRef.current = undefined
    }
    const val = calcBrightness(e.clientY)
    onCommit(val)
    haptics.impact('medium')
  }, [calcBrightness, onCommit])

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        ref={columnRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className="relative w-20 h-52 rounded-[28px] overflow-hidden cursor-pointer touch-none select-none"
        style={{
          background: 'oklch(from var(--foreground) l c h / 0.06)',
          border: '1px solid oklch(from var(--foreground) l c h / 0.1)',
        }}
      >
        {/* Fill */}
        <motion.div
          className="absolute bottom-0 left-0 right-0 rounded-[28px]"
          initial={false}
          animate={{ height: `${percent}%` }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          style={{
            background: isOn
              ? `linear-gradient(to top, ${color}, color-mix(in oklch, ${color} 60%, white))`
              : 'oklch(from var(--foreground) l c h / 0.15)',
          }}
        />

        {/* Glow */}
        {isOn && (
          <motion.div
            className="absolute bottom-0 left-0 right-0 pointer-events-none"
            initial={false}
            animate={{ height: `${Math.min(percent + 10, 100)}%`, opacity: 0.5 }}
            transition={{ type: 'spring', stiffness: 200, damping: 25 }}
            style={{
              background: `radial-gradient(ellipse at bottom, ${color}, transparent 70%)`,
              filter: 'blur(8px)',
            }}
          />
        )}

        {/* Thumb indicator */}
        <motion.div
          className="absolute left-0 right-0 flex justify-center pointer-events-none"
          initial={false}
          animate={{ bottom: `${percent}%` }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        >
          <div
            className="w-12 h-1.5 rounded-full bg-white/90"
            style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.3)', transform: 'translateY(50%)' }}
          />
        </motion.div>

        {/* Percentage */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className="text-2xl font-bold drop-shadow-sm"
            style={{
              color: percent > 45 ? 'rgba(0,0,0,0.7)' : 'oklch(from var(--foreground) l c h / 0.8)',
            }}
          >
            {percent}%
          </span>
        </div>
      </div>

      <span className="text-xs text-foreground/50 font-medium">Helligkeit</span>
    </div>
  )
}

// --- ColorTempStrip ---

function ColorTempStrip({
  value,
  minMired,
  maxMired,
  fallbackKelvin,
  onChange,
  onCommit,
}: {
  value: number
  minMired: number
  maxMired: number
  fallbackKelvin?: number
  onChange: (val: number) => void
  onCommit: (val: number) => void
}) {
  const stripRef = useRef<HTMLDivElement>(null)
  const isDraggingRef = useRef(false)

  const calcTemp = useCallback((clientX: number) => {
    if (!stripRef.current) return value
    const rect = stripRef.current.getBoundingClientRect()
    const x = clientX - rect.left
    const ratio = Math.max(0, Math.min(1, x / rect.width))
    return Math.round(minMired + ratio * (maxMired - minMired))
  }, [value, minMired, maxMired])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    isDraggingRef.current = true
    onChange(calcTemp(e.clientX))
    haptics.impact('light')
  }, [calcTemp, onChange])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current) return
    onChange(calcTemp(e.clientX))
  }, [calcTemp, onChange])

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current) return
    isDraggingRef.current = false
    e.currentTarget.releasePointerCapture(e.pointerId)
    onCommit(calcTemp(e.clientX))
    haptics.impact('medium')
  }, [calcTemp, onCommit])

  // iOS can fire pointercancel instead of pointerup during scrolling gestures
  const handlePointerCancel = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current) return
    isDraggingRef.current = false
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
    onCommit(value)
  }, [onCommit, value])

  const safeValue = clamp(value, minMired, maxMired)
  const range = Math.max(1, maxMired - minMired)
  const sliderPercent = ((safeValue - minMired) / range) * 100
  const kelvin = miredToKelvin(safeValue) ?? fallbackKelvin

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold text-foreground/70 flex items-center gap-1.5">
          <SunHorizon size={14} weight="fill" />
          Farbtemperatur
        </label>
        <span className="text-xs text-foreground/50 font-mono tabular-nums">
          {kelvin ? `${kelvin}K` : '--'}
        </span>
      </div>
      <div
        ref={stripRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        className="relative h-10 rounded-2xl cursor-pointer touch-none select-none"
        style={{
          background: 'linear-gradient(to right, rgb(166, 209, 255) 0%, rgb(255, 255, 255) 40%, rgb(255, 200, 130) 70%, rgb(255, 150, 60) 100%)',
          border: '1px solid oklch(from var(--foreground) l c h / 0.1)',
        }}
      >
        <motion.div
          className="absolute top-1/2 -translate-y-1/2 w-1 h-5 rounded-full bg-white pointer-events-none"
          initial={false}
          animate={{ left: `clamp(2px, calc(${sliderPercent}% - 2px), calc(100% - 4px))` }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-foreground/30 px-1">
        <span>Kalt</span>
        <span>Warm</span>
      </div>
    </div>
  )
}

// --- ChannelSlider (horizontal brightness slider for RGBWW channels) ---

function ChannelSlider({
  label,
  icon,
  value,
  color,
  onChange,
  onCommit,
}: {
  label: string
  icon: React.ReactNode
  value: number
  color: string
  onChange: (val: number) => void
  onCommit: (val: number) => void
}) {
  const stripRef = useRef<HTMLDivElement>(null)
  const isDraggingRef = useRef(false)
  const percent = Math.round((value / 255) * 100)

  const calcValue = useCallback((clientX: number) => {
    if (!stripRef.current) return value
    const rect = stripRef.current.getBoundingClientRect()
    const x = clientX - rect.left
    const ratio = Math.max(0, Math.min(1, x / rect.width))
    return Math.round(ratio * 255)
  }, [value])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    isDraggingRef.current = true
    onChange(calcValue(e.clientX))
    haptics.impact('light')
  }, [calcValue, onChange])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current) return
    onChange(calcValue(e.clientX))
  }, [calcValue, onChange])

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current) return
    isDraggingRef.current = false
    e.currentTarget.releasePointerCapture(e.pointerId)
    onCommit(calcValue(e.clientX))
    haptics.impact('medium')
  }, [calcValue, onCommit])

  const handleChannelPointerCancel = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current) return
    isDraggingRef.current = false
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
    onCommit(value)
  }, [onCommit, value])

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold text-foreground/70 flex items-center gap-1.5">
          {icon}
          {label}
        </label>
        <span className="text-xs text-foreground/50 font-mono tabular-nums">
          {percent}%
        </span>
      </div>
      <div
        ref={stripRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handleChannelPointerCancel}
        className="relative h-8 rounded-2xl cursor-pointer touch-none select-none overflow-hidden"
        style={{
          background: 'oklch(from var(--foreground) l c h / 0.06)',
          border: '1px solid oklch(from var(--foreground) l c h / 0.1)',
        }}
      >
        {/* Fill */}
        <motion.div
          className="absolute top-0 left-0 bottom-0 rounded-2xl"
          initial={false}
          animate={{ width: `${percent}%` }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          style={{
            background: `linear-gradient(to right, color-mix(in oklch, ${color} 40%, transparent), ${color})`,
          }}
        />
        <motion.div
          className="absolute top-1/2 -translate-y-1/2 w-1 h-5 rounded-full bg-white pointer-events-none"
          initial={false}
          animate={{ left: `clamp(2px, ${percent}%, calc(100% - 2px))` }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }}
        />
      </div>
    </div>
  )
}

// --- Main dialog ---

export function LightControlDialog({
  entity,
  open,
  onOpenChange,
  onUpdate,
  allEntities,
  isSubModal = false,
  onNavigateBack,
  onCloseAll,
  modalSize,
}: LightControlDialogProps) {
  const [optimisticOn, setOptimisticOn] = useState<boolean | null>(null)
  const [activeTab, setActiveTab] = useState<'controls' | 'history'>('controls')
  const isOn = optimisticOn !== null ? optimisticOn : entity.state === 'on'
  const [brightness, setBrightness] = useState(entity.attributes.brightness || 255)
  const [rgbColor, setRgbColor] = useState<[number, number, number]>(
    safeRgb(entity.attributes.rgb_color)
  )
  const name = entity.attributes.friendly_name || entity.entity_id
  const [colorMode, setColorMode] = useState<'favoriten' | 'vorlagen' | 'farbrad'>('vorlagen')
  const [favorites, setFavorites] = useState<[number, number, number][]>(() => getFavorites(entity.entity_id))
  const [groupEntitySnapshot, setGroupEntitySnapshot] = useState<EntityState[] | null>(null)
  const lightEnhancements = getLightEnhancementSettings()
  const lastChangeRef = useRef<Record<string, number>>({})

  const rawChildIds = (entity.attributes.entity_id ?? entity.attributes.entities ?? entity.attributes.members) as string[] | string | undefined
  const childIds = Array.isArray(rawChildIds)
    ? rawChildIds.map((id) => String(id).trim()).filter(Boolean)
    : typeof rawChildIds === 'string'
      ? rawChildIds.split(',').map((id) => id.trim()).filter(Boolean)
      : undefined
  const isGroup = Array.isArray(childIds) && childIds.length > 0
  const availableEntities = groupEntitySnapshot ?? allEntities ?? []
  // Bolt: Memoize O(N) map construction to prevent expensive allocations during 60fps slider drag re-renders
  const entitiesById = useMemo(() => new Map(
    availableEntities.map((e) => [e.entity_id.trim().toLowerCase(), e])
  ), [availableEntities])
  const childEntities = isGroup
    ? childIds
        .map((id) => entitiesById.get(id.trim().toLowerCase()))
        .filter((child): child is LightEntity => child != null && child.entity_id.startsWith('light.'))
    : []
  const missingChildCount = isGroup ? Math.max(0, childIds.length - childEntities.length) : 0

  // Capability filtering based on supported_color_modes
  const supportedModes = entity.attributes.supported_color_modes || []
  const activeColorMode = String(entity.attributes.color_mode || '').toLowerCase()
  const supportsColor =
    supportedModes.some((m) => ['rgb', 'hs', 'xy', 'rgbw', 'rgbww'].includes(m))
    || ['rgb', 'hs', 'xy', 'rgbw', 'rgbww'].includes(activeColorMode)
    || entity.attributes.rgb_color !== undefined
    || entity.attributes.rgbw_color !== undefined
    || entity.attributes.rgbww_color !== undefined
    || entity.attributes.hs_color !== undefined
    || entity.attributes.xy_color !== undefined
  const supportsColorTemp = supportedModes.includes('color_temp')
  const supportsBrightness = supportedModes.some(m => m !== 'onoff')
  const supportsRgbww = supportedModes.includes('rgbww')
  const supportsRgbw = supportedModes.includes('rgbw')
  const isTwoZoneSyncEnabledForEntity = isTwoZoneSyncEntity(entity.entity_id, lightEnhancements)
  const hasWhiteChannels = supportsRgbww || supportsRgbw
  const minMired = entity.attributes.min_mireds ?? 153
  const maxMired = entity.attributes.max_mireds ?? 500
  const safeMinMired = Math.min(minMired, maxMired)
  const safeMaxMired = Math.max(minMired, maxMired)
  const defaultColorTemp = clamp(
    entity.attributes.color_temp
    ?? (entity.attributes.color_temp_kelvin ? (kelvinToMired(entity.attributes.color_temp_kelvin) ?? Math.round((safeMinMired + safeMaxMired) / 2)) : Math.round((safeMinMired + safeMaxMired) / 2)),
    safeMinMired,
    safeMaxMired
  )
  const [colorTemp, setColorTemp] = useState(defaultColorTemp)

  // RGBWW / RGBW channel state
  const [coldWhite, setColdWhite] = useState(() => entity.attributes.rgbww_color?.[3] ?? 0)
  const [warmWhite, setWarmWhite] = useState(() => entity.attributes.rgbww_color?.[4] ?? 0)
  const [whiteChannel, setWhiteChannel] = useState(() => entity.attributes.rgbw_color?.[3] ?? 0)
  const [colorBrightness, setColorBrightness] = useState(() => {
    if (supportsRgbww && entity.attributes.rgbww_color) {
      const [r, g, b] = entity.attributes.rgbww_color
      return Math.max(r, g, b)
    }
    if (supportsRgbw && entity.attributes.rgbw_color) {
      const [r, g, b] = entity.attributes.rgbw_color
      return Math.max(r, g, b)
    }
    return 255
  })

  // Transition time state (seconds)
  const [transitionTime, setTransitionTime] = useState<number>(0)

  useEffect(() => {
    setOptimisticOn(null)
  }, [entity.state])

  useEffect(() => {
    setColorTemp(defaultColorTemp)
  }, [entity.entity_id, defaultColorTemp])

  useEffect(() => {
    const now = Date.now()
    if (entity.attributes.brightness !== undefined && now - (lastChangeRef.current.brightness ?? 0) > 4000) {
      setBrightness(entity.attributes.brightness)
    }
    if (entity.attributes.rgb_color != null && now - (lastChangeRef.current.rgb ?? 0) > 4000) {
      setRgbColor(safeRgb(entity.attributes.rgb_color))
    }
    if (now - (lastChangeRef.current.colorTemp ?? 0) > 4000) {
      if (entity.attributes.color_temp !== undefined) {
        setColorTemp(clamp(entity.attributes.color_temp, safeMinMired, safeMaxMired))
      } else if (entity.attributes.color_temp_kelvin !== undefined) {
        const mired = kelvinToMired(entity.attributes.color_temp_kelvin)
        if (mired !== null) {
          setColorTemp(clamp(mired, safeMinMired, safeMaxMired))
        }
      }
    }
    if (now - (lastChangeRef.current.rgbww ?? 0) > 4000) {
      if (entity.attributes.rgbww_color) {
        const [r, g, b, cw, ww] = entity.attributes.rgbww_color
        setColdWhite(cw)
        setWarmWhite(ww)
        setColorBrightness(Math.max(r, g, b))
      }
      if (entity.attributes.rgbw_color) {
        const [r, g, b, w] = entity.attributes.rgbw_color
        setWhiteChannel(w)
        setColorBrightness(Math.max(r, g, b))
      }
    }
  }, [entity, safeMinMired, safeMaxMired])

  // Refresh favorites when dialog opens or entity changes
  useEffect(() => {
    if (open) {
      setFavorites(getFavorites(entity.entity_id))
    }
  }, [open, entity.entity_id])

  // If group members are missing from live store, refresh a full snapshot once.
  useEffect(() => {
    if (!open || !isGroup || missingChildCount === 0 || groupEntitySnapshot) return

    let active = true
    void haService
      .getStates()
      .then((states) => {
        if (active) setGroupEntitySnapshot(states)
      })
      .catch(() => {
        // Keep existing entity pool if refresh fails.
      })

    return () => {
      active = false
    }
  }, [open, isGroup, missingChildCount, groupEntitySnapshot])

  useEffect(() => {
    if (!open) {
      setGroupEntitySnapshot(null)
    }
  }, [open, entity.entity_id])

  const rgb = safeRgb(rgbColor)
  const currentColor = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`

  const handleToggle = () => {
    haptics.impact('medium')
    setOptimisticOn(!isOn)
    haService.toggleEntityFireAndForget(entity.entity_id)
    haptics.notification('success')
  }

  const handleBrightnessChange = (value: number) => {
    lastChangeRef.current.brightness = Date.now()
    setBrightness(value)
  }

  const handleBrightnessCommit = (value: number) => {
    lastChangeRef.current.brightness = Date.now()
    const finalValue = Math.max(1, value)
    haService.turnOnFireAndForget(entity.entity_id, { brightness: finalValue, ...(transitionTime > 0 ? { transition: transitionTime } : {}) })
    haptics.notification('success')
  }

  const handleQuickBrightness = (percent: number) => {
    const val = Math.max(1, Math.round((percent / 100) * 255))
    lastChangeRef.current.brightness = Date.now()
    setBrightness(val)
    if (!isOn) setOptimisticOn(true)
    haptics.impact('medium')
    haService.turnOnFireAndForget(entity.entity_id, { brightness: val, ...(transitionTime > 0 ? { transition: transitionTime } : {}) })
    haptics.notification('success')
  }

  const handleColorTempChange = (val: number) => {
    lastChangeRef.current.colorTemp = Date.now()
    setColorTemp(clamp(val, safeMinMired, safeMaxMired))
  }

  const handleColorTempCommit = async (val: number) => {
    const clamped = clamp(val, safeMinMired, safeMaxMired)
    setColorTemp(clamped)
    lastChangeRef.current.colorTemp = Date.now()

    const kelvin = miredToKelvin(clamped)
    const twoZoneActive = lightEnhancements.enableTwoZoneSyncOnColorTemp && isTwoZoneSyncEnabledForEntity && supportsColor

    try {
      if (twoZoneActive && supportsRgbww) {
        // RGBWW + 2-zone: send single rgbww_color combining RGB approximation + CW/WW.
        // This avoids sending color_temp then rgb_color which fight each other.
        const approxByRange = approximateRgbFromMired(clamped, safeMinMired, safeMaxMired)
        const approxByKelvin = kelvin ? kelvinToRgb(kelvin) : approxByRange
        const convertedRgb: [number, number, number] = [
          Math.round((approxByRange[0] * 0.7) + (approxByKelvin[0] * 0.3)),
          Math.round((approxByRange[1] * 0.7) + (approxByKelvin[1] * 0.3)),
          Math.round((approxByRange[2] * 0.7) + (approxByKelvin[2] * 0.3)),
        ]
        const miredRange = Math.max(1, safeMaxMired - safeMinMired)
        const ratio = clamp((clamped - safeMinMired) / miredRange, 0, 1)
        const computedCW = Math.round(255 * (1 - ratio))
        const computedWW = Math.round(255 * ratio)

        lastChangeRef.current.rgb = Date.now()
        lastChangeRef.current.rgbww = Date.now()
        setRgbColor(convertedRgb)
        setColdWhite(computedCW)
        setWarmWhite(computedWW)
        await haService.callService('light', 'turn_on', entity.entity_id, {
          rgbww_color: [convertedRgb[0], convertedRgb[1], convertedRgb[2], computedCW, computedWW],
        })
      } else if (twoZoneActive && supportsRgbw) {
        // RGBW + 2-zone: send single rgbw_color.
        const approxByRange = approximateRgbFromMired(clamped, safeMinMired, safeMaxMired)
        const approxByKelvin = kelvin ? kelvinToRgb(kelvin) : approxByRange
        const convertedRgb: [number, number, number] = [
          Math.round((approxByRange[0] * 0.7) + (approxByKelvin[0] * 0.3)),
          Math.round((approxByRange[1] * 0.7) + (approxByKelvin[1] * 0.3)),
          Math.round((approxByRange[2] * 0.7) + (approxByKelvin[2] * 0.3)),
        ]
        const miredRange = Math.max(1, safeMaxMired - safeMinMired)
        const ratio = clamp((clamped - safeMinMired) / miredRange, 0, 1)
        const computedW = Math.round(255 * (0.5 + 0.5 * (1 - Math.abs(ratio - 0.5) * 2)))

        lastChangeRef.current.rgb = Date.now()
        lastChangeRef.current.rgbww = Date.now()
        setRgbColor(convertedRgb)
        setWhiteChannel(computedW)
        await haService.callService('light', 'turn_on', entity.entity_id, {
          rgbw_color: [convertedRgb[0], convertedRgb[1], convertedRgb[2], computedW],
        })
      } else if (twoZoneActive) {
        // 2-zone sync on a standard RGB+CT light (not RGBWW/RGBW):
        // Send color_temp_kelvin first, wait 1.5s for HA to apply it,
        // then send rgb_color. Without the delay HA ignores the first call.
        const approxByRange = approximateRgbFromMired(clamped, safeMinMired, safeMaxMired)
        const approxByKelvin = kelvin ? kelvinToRgb(kelvin) : approxByRange
        const convertedRgb: [number, number, number] = [
          Math.round((approxByRange[0] * 0.7) + (approxByKelvin[0] * 0.3)),
          Math.round((approxByRange[1] * 0.7) + (approxByKelvin[1] * 0.3)),
          Math.round((approxByRange[2] * 0.7) + (approxByKelvin[2] * 0.3)),
        ]

        lastChangeRef.current.rgb = Date.now()
        setRgbColor(convertedRgb)
        await haService.callService('light', 'turn_on', entity.entity_id, {
          color_temp_kelvin: kelvin,
        })
        await new Promise(resolve => setTimeout(resolve, 1500))
        await haService.callService('light', 'turn_on', entity.entity_id, {
          rgb_color: convertedRgb,
        })
      } else {
        // Standard path (no 2-zone sync):
        // Send only color_temp_kelvin. HA rejects calls containing BOTH
        // color_temp (mireds) and color_temp_kelvin with 400 Bad Request.
        await haService.callService('light', 'turn_on', entity.entity_id, {
          color_temp_kelvin: kelvin,
        })
      }

      haptics.notification('success')
    } catch {
      toast.error('Farbtemperatur konnte nicht gesetzt werden')
      haptics.notification('error')
    }
  }

  const handleColorChange = (color: [number, number, number]) => {
    setRgbColor(color)
    haptics.selectionChanged()
  }

  const handleColorSelect = (color: [number, number, number]) => {
    setRgbColor(color)
    lastChangeRef.current.rgb = Date.now()
    haptics.impact('light')
    haService.turnOnFireAndForget(entity.entity_id, { rgb_color: color, ...(transitionTime > 0 ? { transition: transitionTime } : {}) })
    haptics.notification('success')
  }

  // --- RGBWW / RGBW channel handlers ---

  const buildRgbwwColor = (
    rgbBrightness: number,
    cw: number,
    ww: number,
  ): [number, number, number, number, number] => {
    // Scale rgb_color by colorBrightness ratio
    const maxRgb = Math.max(rgb[0], rgb[1], rgb[2]) || 1
    const scale = rgbBrightness / maxRgb
    return [
      Math.round(Math.min(255, rgb[0] * scale)),
      Math.round(Math.min(255, rgb[1] * scale)),
      Math.round(Math.min(255, rgb[2] * scale)),
      cw,
      ww,
    ]
  }

  const buildRgbwColor = (
    rgbBrightness: number,
    w: number,
  ): [number, number, number, number] => {
    const maxRgb = Math.max(rgb[0], rgb[1], rgb[2]) || 1
    const scale = rgbBrightness / maxRgb
    return [
      Math.round(Math.min(255, rgb[0] * scale)),
      Math.round(Math.min(255, rgb[1] * scale)),
      Math.round(Math.min(255, rgb[2] * scale)),
      w,
    ]
  }

  const commitRgbwwChannels = (
    rgbBright: number,
    cw: number,
    ww: number,
  ) => {
    lastChangeRef.current.rgbww = Date.now()
    haService.turnOnFireAndForget(entity.entity_id, {
      rgbww_color: buildRgbwwColor(rgbBright, cw, ww),
    })
    haptics.notification('success')
  }

  const commitRgbwChannels = (
    rgbBright: number,
    w: number,
  ) => {
    lastChangeRef.current.rgbww = Date.now()
    haService.turnOnFireAndForget(entity.entity_id, {
      rgbw_color: buildRgbwColor(rgbBright, w),
    })
    haptics.notification('success')
  }

  const handleSaveFavorite = () => {
    saveFavorite(entity.entity_id, [...rgb] as [number, number, number])
    setFavorites(getFavorites(entity.entity_id))
    haptics.notification('success')
    toast.success('Farbe gespeichert')
  }

  const handleRemoveFavorite = (index: number) => {
    removeFavorite(entity.entity_id, index)
    setFavorites(getFavorites(entity.entity_id))
    haptics.impact('medium')
    toast('Favorit entfernt')
  }

  const handleEffectSelect = (effectName: string) => {
    haptics.impact('light')
    haService.turnOnFireAndForget(entity.entity_id, { effect: effectName })
    haptics.notification('success')
  }

  const handleEffectClear = () => {
    haptics.impact('light')
    haService.turnOnFireAndForget(entity.entity_id, { effect: '' })
    haptics.notification('success')
  }

  const presetColors: Array<{ color: [number, number, number]; label: string }> = [
    { color: [255, 147, 41], label: 'Warm' },
    { color: [255, 214, 170], label: 'Sanft' },
    { color: [255, 244, 229], label: 'Neutral' },
    { color: [255, 255, 255], label: 'Weiß' },
    { color: [214, 227, 255], label: 'Kühl' },
    { color: [166, 209, 255], label: 'Himmel' },
    { color: [255, 182, 193], label: 'Rosa' },
    { color: [255, 105, 180], label: 'Pink' },
    { color: [255, 99, 71], label: 'Rot' },
    { color: [144, 238, 144], label: 'Grün' },
    { color: [50, 205, 50], label: 'Lime' },
    { color: [138, 43, 226], label: 'Lila' },
  ]

  const effectList = entity.attributes.effect_list
  const currentEffect = entity.attributes.effect
  const hasEffects = effectList && effectList.length > 0
  const handleBack = onNavigateBack ?? (() => onOpenChange(false))
  const handleCloseAll = onCloseAll ?? (() => onOpenChange(false))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={`${getModalSizeClass(modalSize)} glass-card border-foreground/10 p-0 gap-0 bg-card/95 backdrop-blur-2xl overflow-y-auto overflow-x-hidden`}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{name} Lichtsteuerung</DialogTitle>
        </DialogHeader>
        {/* Ambient glow */}
        {isOn && (
          <div
            className="absolute -top-20 left-1/2 -translate-x-1/2 w-64 h-64 rounded-full pointer-events-none"
            style={{
              background: `radial-gradient(circle, ${currentColor}, transparent 70%)`,
              filter: 'blur(40px)',
              opacity: 0.25,
            }}
          />
        )}

        {isSubModal && lightEnhancements.showSubModalNavButtons && (
          <div className="relative px-5 pt-4 pb-1 flex items-center justify-between">
            <button
              onClick={handleBack}
              className="w-8 h-8 rounded-full bg-foreground/8 hover:bg-foreground/14 text-foreground/75 transition-colors flex items-center justify-center"
              aria-label="Zurueck"
            >
              <ArrowLeft size={14} weight="bold" />
            </button>
            <button
              onClick={handleCloseAll}
              className="w-8 h-8 rounded-full bg-foreground/8 hover:bg-foreground/14 text-foreground/75 transition-colors flex items-center justify-center"
              aria-label="Schliessen"
            >
              <X size={14} weight="bold" />
            </button>
          </div>
        )}

        {/* Header */}
        <div className={`relative flex items-center justify-between pl-5 pr-14 sm:pr-24 ${isSubModal && lightEnhancements.showSubModalNavButtons ? 'pt-2' : 'pt-5'} pb-3`}>
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="p-2 rounded-xl shrink-0 transition-all duration-300"
              style={{
                backgroundColor: isOn
                  ? `color-mix(in oklch, ${currentColor} 25%, transparent)`
                  : 'oklch(from var(--muted) l c h / 0.5)',
                color: isOn ? currentColor : 'var(--muted-foreground)',
              }}
            >
              <Lightbulb size={20} weight={isOn ? 'fill' : 'regular'} />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-foreground truncate">{name}</h2>
              <p className="text-xs text-foreground/40">
                {isOn
                  ? supportsBrightness
                    ? `Eingeschaltet - ${Math.round((brightness / 255) * 100)}%`
                    : 'Eingeschaltet'
                  : 'Ausgeschaltet'}
              </p>
            </div>
          </div>
          <motion.button
            onClick={handleToggle}
            className="p-2.5 rounded-full transition-colors shrink-0"
            style={{
              backgroundColor: isOn
                ? `color-mix(in oklch, ${currentColor} 20%, transparent)`
                : 'oklch(from var(--foreground) l c h / 0.08)',
              color: isOn ? currentColor : 'var(--foreground)',
            }}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
          >
            <Power size={20} weight="bold" />
          </motion.button>
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
        <div className="relative px-5 pb-5 space-y-5">
          {/* Brightness section - only show when supports brightness */}
          {supportsBrightness ? (
            <div className="flex items-start gap-5">
              <BrightnessColumn
                brightness={brightness}
                color={currentColor}
                isOn={isOn}
                onChange={handleBrightnessChange}
                onCommit={handleBrightnessCommit}
                entityId={entity.entity_id}
              />

              {/* Quick presets + info */}
              <div className="flex-1 space-y-4 pt-1">
                <div>
                  <label className="text-xs font-semibold text-foreground/70 flex items-center gap-1.5 mb-2.5">
                    <Sun size={14} weight="fill" />
                    Schnellwahl
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {[25, 50, 75, 100].map((p) => (
                      <motion.button
                        key={p}
                        onClick={() => handleQuickBrightness(p)}
                        className="py-2.5 rounded-xl text-xs font-semibold transition-colors"
                        style={{
                          backgroundColor:
                            Math.round((brightness / 255) * 100) === p
                              ? `color-mix(in oklch, ${currentColor} 25%, transparent)`
                              : 'oklch(from var(--foreground) l c h / 0.06)',
                          color:
                            Math.round((brightness / 255) * 100) === p
                              ? currentColor
                              : 'oklch(from var(--foreground) l c h / 0.6)',
                          border:
                            Math.round((brightness / 255) * 100) === p
                              ? `1px solid color-mix(in oklch, ${currentColor} 30%, transparent)`
                              : '1px solid oklch(from var(--foreground) l c h / 0.08)',
                        }}
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.97 }}
                      >
                        {p}%
                      </motion.button>
                    ))}
                  </div>
                </div>

                {/* Entity info */}
                <div className="rounded-xl p-3" style={{ background: 'oklch(from var(--foreground) l c h / 0.04)' }}>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-foreground/40">Status</span>
                      <span className="text-foreground/60 font-medium">{isOn ? 'An' : 'Aus'}</span>
                    </div>
                    {lightEnhancements.showEntityIdInLightModal && (
                      <div className="flex justify-between text-[11px]">
                        <span className="text-foreground/40">Entity-ID</span>
                        <span className="text-foreground/60 font-medium font-mono text-[10px] truncate max-w-[70%] text-right">
                          {entity.entity_id}
                        </span>
                      </div>
                    )}
                    {entity.attributes.color_mode && (
                      <div className="flex justify-between text-[11px]">
                        <span className="text-foreground/40">Modus</span>
                        <span className="text-foreground/60 font-medium capitalize">{entity.attributes.color_mode}</span>
                      </div>
                    )}
                    {isOn && supportsColorTemp && entity.attributes.color_temp_kelvin && (
                      <div className="flex justify-between text-[11px]">
                        <span className="text-foreground/40">Farbtemperatur</span>
                        <span className="text-foreground/60 font-medium">{entity.attributes.color_temp_kelvin} K</span>
                      </div>
                    )}
                    {isOn && supportsColor && (
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-foreground/40">Farbe</span>
                        <div
                          className="w-4 h-4 rounded-full border border-foreground/10"
                          style={{ backgroundColor: currentColor }}
                        />
                      </div>
                    )}
                    {entity.attributes.supported_color_modes && entity.attributes.supported_color_modes.length > 0 && (
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-foreground/40">Farbmodi</span>
                        <div className="flex flex-wrap justify-end gap-1">
                          {entity.attributes.supported_color_modes.map(mode => (
                            <span
                              key={mode}
                              className="px-1.5 py-0.5 rounded text-[9px] font-medium uppercase"
                              style={{
                                backgroundColor: entity.attributes.color_mode === mode
                                  ? `color-mix(in oklch, ${currentColor} 20%, transparent)`
                                  : 'oklch(from var(--foreground) l c h / 0.06)',
                                color: entity.attributes.color_mode === mode
                                  ? currentColor
                                  : 'oklch(from var(--foreground) l c h / 0.4)',
                              }}
                            >
                              {mode}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {entity.last_changed && (
                      <div className="flex justify-between text-[11px]">
                        <span className="text-foreground/40">Letzte Änderung</span>
                        <span className="text-foreground/60 font-medium">
                          {new Date(entity.last_changed).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* On/off only - show minimal entity info */
            <div className="rounded-xl p-3" style={{ background: 'oklch(from var(--foreground) l c h / 0.04)' }}>
              <div className="space-y-1.5">
                <div className="flex justify-between text-[11px]">
                  <span className="text-foreground/40">Status</span>
                  <span className="text-foreground/60 font-medium">{isOn ? 'An' : 'Aus'}</span>
                </div>
                {lightEnhancements.showEntityIdInLightModal && (
                  <div className="flex justify-between text-[11px]">
                    <span className="text-foreground/40">Entity-ID</span>
                    <span className="text-foreground/60 font-medium font-mono text-[10px] truncate max-w-[70%] text-right">
                      {entity.entity_id}
                    </span>
                  </div>
                )}
                {entity.attributes.color_mode && (
                  <div className="flex justify-between text-[11px]">
                    <span className="text-foreground/40">Modus</span>
                    <span className="text-foreground/60 font-medium capitalize">{entity.attributes.color_mode}</span>
                  </div>
                )}
                {entity.last_changed && (
                  <div className="flex justify-between text-[11px]">
                    <span className="text-foreground/40">Letzte Änderung</span>
                    <span className="text-foreground/60 font-medium">
                      {new Date(entity.last_changed).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Group members */}
          {isGroup && childEntities.length > 0 && (
            <div className="px-6 py-4 border-t border-foreground/5">
              <h4 className="text-xs font-semibold text-foreground/50 mb-2">Einzelne Lichter</h4>
              <div className="divide-y divide-foreground/5">
                {childEntities.map(child => (
                  <LightGroupMemberRow
                    key={child.entity_id}
                    entity={child}
                    onUpdate={onUpdate}
                    allEntities={allEntities}
                    onCloseParentModal={() => onOpenChange(false)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Color temperature */}
          {supportsColorTemp && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              <ColorTempStrip
                value={colorTemp}
                minMired={safeMinMired}
                maxMired={safeMaxMired}
                fallbackKelvin={entity.attributes.color_temp_kelvin}
                onChange={handleColorTempChange}
                onCommit={handleColorTempCommit}
              />
            </motion.div>
          )}

          {supportsColor && (
            <motion.div
              className="space-y-3"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
            >
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-foreground/70 flex items-center gap-1.5">
                  <Palette size={14} weight="fill" />
                  Farbe
                </label>
                <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid oklch(from var(--foreground) l c h / 0.1)' }}>
                  <button
                    onClick={() => setColorMode('favoriten')}
                    className="px-3 py-1 text-[11px] font-medium transition-colors"
                    style={{
                      backgroundColor: colorMode === 'favoriten' ? 'oklch(from var(--foreground) l c h / 0.1)' : 'transparent',
                      color: colorMode === 'favoriten' ? 'var(--foreground)' : 'oklch(from var(--foreground) l c h / 0.4)',
                    }}
                  >
                    Favoriten
                  </button>
                  <button
                    onClick={() => setColorMode('vorlagen')}
                    className="px-3 py-1 text-[11px] font-medium transition-colors"
                    style={{
                      backgroundColor: colorMode === 'vorlagen' ? 'oklch(from var(--foreground) l c h / 0.1)' : 'transparent',
                      color: colorMode === 'vorlagen' ? 'var(--foreground)' : 'oklch(from var(--foreground) l c h / 0.4)',
                    }}
                  >
                    Vorlagen
                  </button>
                  <button
                    onClick={() => setColorMode('farbrad')}
                    className="px-3 py-1 text-[11px] font-medium transition-colors"
                    style={{
                      backgroundColor: colorMode === 'farbrad' ? 'oklch(from var(--foreground) l c h / 0.1)' : 'transparent',
                      color: colorMode === 'farbrad' ? 'var(--foreground)' : 'oklch(from var(--foreground) l c h / 0.4)',
                    }}
                  >
                    Farbrad
                  </button>
                </div>
              </div>

              <AnimatePresence mode="wait">
                {colorMode === 'favoriten' ? (
                  <motion.div
                    key="favoriten"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    transition={{ duration: 0.2 }}
                  >
                    {favorites.length > 0 ? (
                      <div className="grid grid-cols-6 gap-2">
                        {favorites.map((fav, idx) => {
                          const isSelected =
                            Math.abs(rgb[0] - fav[0]) < 5 &&
                            Math.abs(rgb[1] - fav[1]) < 5 &&
                            Math.abs(rgb[2] - fav[2]) < 5
                          return (
                            <motion.button
                              key={idx}
                              onClick={() => handleColorSelect(fav)}
                              onContextMenu={(e) => {
                                e.preventDefault()
                                handleRemoveFavorite(idx)
                              }}
                              className="flex flex-col items-center gap-1"
                              whileHover={{ scale: 1.1 }}
                              whileTap={{ scale: 0.9 }}
                              title="Rechtsklick zum Entfernen"
                            >
                              <div
                                className="w-9 h-9 rounded-xl transition-all"
                                style={{
                                  backgroundColor: `rgb(${fav[0]}, ${fav[1]}, ${fav[2]})`,
                                  boxShadow: isSelected
                                    ? `0 0 0 2px var(--background), 0 0 0 4px rgb(${fav[0]}, ${fav[1]}, ${fav[2]})`
                                    : '0 2px 6px rgba(0,0,0,0.1), inset 0 0 0 1px rgba(255,255,255,0.15)',
                                }}
                              />
                            </motion.button>
                          )
                        })}
                        {/* Add button */}
                        {favorites.length < 12 && (
                          <motion.button
                            onClick={handleSaveFavorite}
                            className="flex flex-col items-center gap-1"
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.9 }}
                            title="Aktuelle Farbe speichern"
                          >
                            <div
                              className="w-9 h-9 rounded-xl flex items-center justify-center transition-all"
                              style={{
                                backgroundColor: 'oklch(from var(--foreground) l c h / 0.06)',
                                border: '1px dashed oklch(from var(--foreground) l c h / 0.2)',
                              }}
                            >
                              <Plus size={16} weight="bold" className="text-foreground/40" />
                            </div>
                          </motion.button>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-3 py-4">
                        <span className="text-xs text-foreground/40">Keine Favoriten</span>
                        <motion.button
                          onClick={handleSaveFavorite}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                          style={{
                            backgroundColor: `color-mix(in oklch, ${currentColor} 15%, transparent)`,
                            color: currentColor,
                            border: `1px solid color-mix(in oklch, ${currentColor} 25%, transparent)`,
                          }}
                          whileHover={{ scale: 1.03 }}
                          whileTap={{ scale: 0.97 }}
                        >
                          <Plus size={14} weight="bold" />
                          Aktuelle Farbe speichern
                        </motion.button>
                      </div>
                    )}
                  </motion.div>
                ) : colorMode === 'vorlagen' ? (
                  <motion.div
                    key="vorlagen"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    transition={{ duration: 0.2 }}
                    className="grid grid-cols-6 gap-2"
                  >
                    {presetColors.map((preset, idx) => {
                      const isSelected =
                        rgb[0] === preset.color[0] &&
                        rgb[1] === preset.color[1] &&
                        rgb[2] === preset.color[2]
                      return (
                        <motion.button
                          key={idx}
                          onClick={() => handleColorSelect(preset.color)}
                          className="flex flex-col items-center gap-1"
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.9 }}
                        >
                          <div
                            className="w-9 h-9 rounded-xl transition-all"
                            style={{
                              backgroundColor: `rgb(${preset.color[0]}, ${preset.color[1]}, ${preset.color[2]})`,
                              boxShadow: isSelected
                                ? `0 0 0 2px var(--background), 0 0 0 4px ${`rgb(${preset.color[0]}, ${preset.color[1]}, ${preset.color[2]})`}`
                                : '0 2px 6px rgba(0,0,0,0.1), inset 0 0 0 1px rgba(255,255,255,0.15)',
                            }}
                          />
                          <span className="text-[9px] text-foreground/40 font-medium leading-none">
                            {preset.label}
                          </span>
                        </motion.button>
                      )
                    })}
                  </motion.div>
                ) : (
                  <motion.div
                    key="farbrad"
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-2.5"
                  >
                    <div
                      className="rounded-2xl p-3"
                      style={{
                        background: 'linear-gradient(180deg, oklch(from var(--foreground) l c h / 0.06), oklch(from var(--foreground) l c h / 0.03))',
                        border: '1px solid oklch(from var(--foreground) l c h / 0.09)',
                      }}
                    >
                      <ColorPicker
                        value={rgb}
                        onChange={handleColorChange}
                        onChangeEnd={handleColorSelect}
                        size={220}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-foreground/45">Tip: HEX eingeben oder auf das Farbrad tippen.</span>
                      <button
                        onClick={handleSaveFavorite}
                        className="px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 shadow-sm"
                        style={{
                          background: `linear-gradient(135deg, color-mix(in oklch, ${currentColor} 22%, transparent), color-mix(in oklch, ${currentColor} 12%, transparent))`,
                          color: currentColor,
                          border: `1px solid color-mix(in oklch, ${currentColor} 34%, transparent)`,
                          boxShadow: `0 4px 14px color-mix(in oklch, ${currentColor} 18%, transparent)`,
                        }}
                      >
                        <Sun size={12} weight="fill" />
                        Favorit speichern
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          {/* RGBWW / RGBW channel controls */}
          {hasWhiteChannels && (
            <motion.div
              className="space-y-3"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.18 }}
            >
              <label className="text-xs font-semibold text-foreground/70 flex items-center gap-1.5">
                <Sun size={14} weight="fill" />
                Kanalsteuerung
              </label>

              <div className="space-y-2.5">
                {/* Color brightness */}
                <ChannelSlider
                  label="Farbhelligkeit"
                  icon={<Rainbow size={13} weight="fill" />}
                  value={colorBrightness}
                  color={currentColor}
                  onChange={setColorBrightness}
                  onCommit={(val) => {
                    if (supportsRgbww) commitRgbwwChannels(val, coldWhite, warmWhite)
                    else commitRgbwChannels(val, whiteChannel)
                  }}
                />

                {supportsRgbww ? (
                  <>
                    {/* Cold White */}
                    <ChannelSlider
                      label="Kaltweiß"
                      icon={<Snowflake size={13} weight="fill" />}
                      value={coldWhite}
                      color="rgb(200, 220, 255)"
                      onChange={setColdWhite}
                      onCommit={(val) => commitRgbwwChannels(colorBrightness, val, warmWhite)}
                    />

                    {/* Warm White */}
                    <ChannelSlider
                      label="Warmweiß"
                      icon={<Flame size={13} weight="fill" />}
                      value={warmWhite}
                      color="rgb(255, 180, 80)"
                      onChange={setWarmWhite}
                      onCommit={(val) => commitRgbwwChannels(colorBrightness, coldWhite, val)}
                    />
                  </>
                ) : (
                  /* RGBW - single white channel */
                  <ChannelSlider
                    label="Weiß"
                    icon={<Sun size={13} weight="fill" />}
                    value={whiteChannel}
                    color="rgb(255, 250, 230)"
                    onChange={setWhiteChannel}
                    onCommit={(val) => commitRgbwChannels(colorBrightness, val)}
                  />
                )}
              </div>
            </motion.div>
          )}

          {/* Effects section */}
          {hasEffects && (
            <motion.div
              className="space-y-3"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <label className="text-xs font-semibold text-foreground/70 flex items-center gap-1.5">
                <Sparkle size={14} weight="fill" />
                Effekte
              </label>
              <div className="grid grid-cols-3 gap-2">
                {/* No effect button */}
                <motion.button
                  onClick={handleEffectClear}
                  className="flex flex-col items-center gap-1.5 py-2.5 rounded-xl text-[11px] font-medium transition-colors"
                  style={{
                    backgroundColor: !currentEffect || currentEffect === ''
                      ? `color-mix(in oklch, ${currentColor} 20%, transparent)`
                      : 'oklch(from var(--foreground) l c h / 0.04)',
                    color: !currentEffect || currentEffect === ''
                      ? currentColor
                      : 'oklch(from var(--foreground) l c h / 0.5)',
                    border: !currentEffect || currentEffect === ''
                      ? `1px solid color-mix(in oklch, ${currentColor} 30%, transparent)`
                      : '1px solid oklch(from var(--foreground) l c h / 0.06)',
                  }}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                >
                  Kein Effekt
                </motion.button>
                {effectList!.map((effect) => {
                  const isActive = currentEffect === effect
                  return (
                    <motion.button
                      key={effect}
                      onClick={() => handleEffectSelect(effect)}
                      className="flex flex-col items-center gap-1.5 py-2.5 rounded-xl text-[11px] font-medium transition-colors truncate px-1"
                      style={{
                        backgroundColor: isActive
                          ? `color-mix(in oklch, ${currentColor} 20%, transparent)`
                          : 'oklch(from var(--foreground) l c h / 0.04)',
                        color: isActive
                          ? currentColor
                          : 'oklch(from var(--foreground) l c h / 0.5)',
                        border: isActive
                          ? `1px solid color-mix(in oklch, ${currentColor} 30%, transparent)`
                          : '1px solid oklch(from var(--foreground) l c h / 0.06)',
                      }}
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.97 }}
                      title={effect}
                    >
                      <span className="truncate w-full text-center">{effect}</span>
                    </motion.button>
                  )
                })}
              </div>
            </motion.div>
          )}

          {/* Transition time control */}
          {supportsBrightness && (
            <motion.div
              className="space-y-3"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
            >
              <label className="text-xs font-semibold text-foreground/70 flex items-center gap-1.5">
                <Timer size={14} weight="fill" />
                Übergangszeit
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={30}
                  step={0.5}
                  value={transitionTime}
                  onChange={(e) => setTransitionTime(parseFloat(e.target.value))}
                  className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer"
                  style={{
                    background: transitionTime > 0
                      ? `linear-gradient(to right, ${currentColor} ${(transitionTime / 30) * 100}%, oklch(from var(--foreground) l c h / 0.1) ${(transitionTime / 30) * 100}%)`
                      : 'oklch(from var(--foreground) l c h / 0.1)',
                    accentColor: currentColor,
                  }}
                />
                <span
                  className="text-xs font-medium min-w-[3rem] text-right tabular-nums"
                  style={{ color: transitionTime > 0 ? currentColor : 'oklch(from var(--foreground) l c h / 0.4)' }}
                >
                  {transitionTime > 0 ? `${transitionTime}s` : 'Sofort'}
                </span>
              </div>
            </motion.div>
          )}
        </div>
        ) : (
        <div className="relative px-5 pb-5">
          <EntityHistoryPanel
            entityId={entity.entity_id}
            entityState={entity.state}
            color={isOn ? currentColor : undefined}
          />
        </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
