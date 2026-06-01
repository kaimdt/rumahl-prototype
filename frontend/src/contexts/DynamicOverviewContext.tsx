import { useEntityStore } from "@/hooks/useEntityStore"
import { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react'
import { useLocalStorage } from '@/lib/storage'
import type { EntityState, WidgetType } from '@/lib/types'

/**
 * Trigger types for dynamic overview changes
 */
export type TriggerType = 'time' | 'entity_state' | 'manual'

/**
 * Time-based trigger configuration
 */
export interface TimeTrigger {
  type: 'time'
  hour: number
  minute: number
  days?: number[] // 0=Sunday, 1=Monday, etc. If not specified, applies to all days
}

/**
 * Entity state trigger configuration
 */
export interface EntityStateTrigger {
  type: 'entity_state'
  entity_id: string
  state?: string // If not specified, triggers on any state change
  condition?: 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'contains'
  value?: string | number
}

/**
 * Manual trigger (user-initiated)
 */
export interface ManualTrigger {
  type: 'manual'
  name: string
}

export type OverviewTrigger = TimeTrigger | EntityStateTrigger | ManualTrigger

/**
 * Overview variant with its trigger conditions
 */
export interface OverviewVariant {
  id: string
  name: string
  description?: string
  triggers: OverviewTrigger[]
  priority: number // Higher priority = checked first (0 = lowest)
  config: {
    showGreeting?: boolean
    showWeather?: boolean
    showClock?: boolean
    showCalendar?: boolean
    showScenes?: boolean
    showSensors?: boolean
    customWidgets?: string[] // Widget IDs to display
    backgroundColor?: string
    backgroundImage?: string
  }
}

/**
 * Default overview variant (fallback)
 */
const defaultVariant: OverviewVariant = {
  id: 'default',
  name: 'Standard',
  description: 'Standard Übersichtsansicht',
  triggers: [{ type: 'manual', name: 'Standard' }],
  priority: 0,
  config: {
    showGreeting: true,
    showWeather: true,
    showClock: true,
    showCalendar: true,
    showScenes: true,
    showSensors: true,
  },
}

/**
 * Predefined time-based variants
 */
const predefinedVariants: OverviewVariant[] = [
  {
    id: 'morning',
    name: 'Morgen',
    description: 'Morgenansicht (6:00 - 12:00)',
    triggers: [
      { type: 'time', hour: 6, minute: 0 },
    ],
    priority: 10,
    config: {
      showGreeting: true,
      showWeather: true,
      showClock: true,
      showCalendar: true,
      showScenes: false,
      showSensors: true,
    },
  },
  {
    id: 'afternoon',
    name: 'Nachmittag',
    description: 'Nachmittagsansicht (12:00 - 18:00)',
    triggers: [
      { type: 'time', hour: 12, minute: 0 },
    ],
    priority: 10,
    config: {
      showGreeting: true,
      showWeather: true,
      showClock: false,
      showCalendar: true,
      showScenes: true,
      showSensors: false,
    },
  },
  {
    id: 'evening',
    name: 'Abend',
    description: 'Abendansicht (18:00 - 22:00)',
    triggers: [
      { type: 'time', hour: 18, minute: 0 },
    ],
    priority: 10,
    config: {
      showGreeting: true,
      showWeather: false,
      showClock: false,
      showCalendar: false,
      showScenes: true,
      showSensors: true,
    },
  },
  {
    id: 'night',
    name: 'Nacht',
    description: 'Nachtansicht (22:00 - 6:00)',
    triggers: [
      { type: 'time', hour: 22, minute: 0 },
    ],
    priority: 10,
    config: {
      showGreeting: false,
      showWeather: false,
      showClock: true,
      showCalendar: false,
      showScenes: true,
      showSensors: false,
    },
  },
]

interface DynamicOverviewContextType {
  variants: OverviewVariant[]
  setVariants: (variants: OverviewVariant[]) => void
  currentVariant: OverviewVariant
  activeVariantId: string
  setActiveVariantId: (id: string) => void
  addVariant: (variant: OverviewVariant) => void
  updateVariant: (id: string, variant: Partial<OverviewVariant>) => void
  deleteVariant: (id: string) => void
  evaluateTriggers: (entities: EntityState[]) => void
  enabled: boolean
  setEnabled: (enabled: boolean) => void
}

const DynamicOverviewContext = createContext<DynamicOverviewContextType | undefined>(undefined)

export function DynamicOverviewProvider({ children }: { children: ReactNode }) {
  const { getEntity } = useEntityStore()
  const [variants, setVariants] = useLocalStorage<OverviewVariant[]>(
    'ha-overview-variants',
    [defaultVariant, ...predefinedVariants]
  )
  const [activeVariantId, setActiveVariantId] = useLocalStorage<string>(
    'ha-active-overview-variant',
    'default'
  )
  const [enabled, setEnabled] = useLocalStorage<boolean>('ha-dynamic-overview-enabled', false)

  const currentVariant = variants.find((v) => v.id === activeVariantId) || defaultVariant

  const addVariant = useCallback((variant: OverviewVariant) => {
    setVariants([...variants, variant])
  }, [variants, setVariants])

  const updateVariant = useCallback((id: string, updates: Partial<OverviewVariant>) => {
    setVariants(
      variants.map((v) => (v.id === id ? { ...v, ...updates } : v))
    )
  }, [variants, setVariants])

  const deleteVariant = useCallback((id: string) => {
    if (id === 'default') return // Cannot delete default variant
    setVariants(variants.filter((v) => v.id !== id))
    if (activeVariantId === id) {
      setActiveVariantId('default')
    }
  }, [variants, setVariants, activeVariantId, setActiveVariantId])

  const checkTimeTrigger = (trigger: TimeTrigger): boolean => {
    const now = new Date()
    const currentHour = now.getHours()
    const currentMinute = now.getMinutes()
    const currentDay = now.getDay()

    // Check day of week if specified
    if (trigger.days && !trigger.days.includes(currentDay)) {
      return false
    }

    // Time trigger matches if current time is >= trigger time
    // and < next trigger time (handled by priority)
    const triggerTimeInMinutes = trigger.hour * 60 + trigger.minute
    const currentTimeInMinutes = currentHour * 60 + currentMinute

    return currentTimeInMinutes >= triggerTimeInMinutes
  }

  const checkEntityStateTrigger = (
    trigger: EntityStateTrigger
  ): boolean => {
    const entity = getEntity(trigger.entity_id)
    if (!entity) return false

    // If no specific state is specified, any entity existence triggers it
    if (!trigger.state && !trigger.value) return true

    // Check state match
    if (trigger.state) {
      if (!trigger.condition || trigger.condition === 'equals') {
        return entity.state === trigger.state
      }
      if (trigger.condition === 'not_equals') {
        return entity.state !== trigger.state
      }
      if (trigger.condition === 'contains') {
        return entity.state.includes(trigger.state)
      }
    }

    // Check value condition
    if (trigger.value !== undefined) {
      const entityValue = parseFloat(entity.state)
      const triggerValue = typeof trigger.value === 'number'
        ? trigger.value
        : parseFloat(trigger.value)

      if (isNaN(entityValue) || isNaN(triggerValue)) return false

      switch (trigger.condition) {
        case 'greater_than':
          return entityValue > triggerValue
        case 'less_than':
          return entityValue < triggerValue
        case 'equals':
          return entityValue === triggerValue
        case 'not_equals':
          return entityValue !== triggerValue
        default:
          return false
      }
    }

    return false
  }

  const evaluateTriggers = useCallback((entities: EntityState[]) => {
    if (!enabled) return

    // Sort variants by priority (descending)
    const sortedVariants = [...variants].sort((a, b) => b.priority - a.priority)

    // Find the first variant where all triggers match
    for (const variant of sortedVariants) {
      let allTriggersMatch = true

      for (const trigger of variant.triggers) {
        let triggerMatches = false

        if (trigger.type === 'time') {
          triggerMatches = checkTimeTrigger(trigger)
        } else if (trigger.type === 'entity_state') {
          triggerMatches = checkEntityStateTrigger(trigger)
        } else if (trigger.type === 'manual') {
          // Manual triggers never auto-activate
          triggerMatches = false
        }

        if (!triggerMatches) {
          allTriggersMatch = false
          break
        }
      }

      if (allTriggersMatch) {
        if (activeVariantId !== variant.id) {
          setActiveVariantId(variant.id)
          console.log(`Dynamic Overview: Switched to variant "${variant.name}"`)
        }
        return
      }
    }

    // If no variant matched, use default
    if (activeVariantId !== 'default') {
      setActiveVariantId('default')
    }
  }, [enabled, variants, activeVariantId, setActiveVariantId])

  const contextValue = useMemo(() => ({
    variants,
    setVariants,
    currentVariant,
    activeVariantId,
    setActiveVariantId,
    addVariant,
    updateVariant,
    deleteVariant,
    evaluateTriggers,
    enabled,
    setEnabled,
  }), [variants, setVariants, currentVariant, activeVariantId, setActiveVariantId, addVariant, updateVariant, deleteVariant, evaluateTriggers, enabled, setEnabled])

  return (
    <DynamicOverviewContext.Provider value={contextValue}>
      {children}
    </DynamicOverviewContext.Provider>
  )
}

export function useDynamicOverview() {
  const context = useContext(DynamicOverviewContext)
  if (!context) {
    throw new Error('useDynamicOverview must be used within DynamicOverviewProvider')
  }
  return context
}

export function getVisibleWidgetTypes(config: OverviewVariant['config']): Set<WidgetType> {
  const visible = new Set<WidgetType>([
    // Entity widgets always visible
    'light', 'climate', 'switch', 'media_player',
    // HA Helpers always visible
    'input_boolean', 'input_number', 'input_select', 'binary_sensor', 'cover',
    // New entity widgets always visible
    'fan', 'lock', 'automation', 'script', 'button', 'scene_entity',
    'number', 'select', 'input_text', 'text', 'input_datetime',
    'person', 'device_tracker', 'timer', 'counter', 'group', 'camera',
    'vacuum', 'humidifier', 'alarm_control_panel',
    // Layout elements always visible
    'spacer', 'section_header', 'custom', 'page_link',
    // Composite / special widgets
    'chat_card', 'dynamic_text', 'widget_group',
    // Premium widgets
    'entity_history', 'energy_monitor', 'entity_statistics',
    'quick_actions', 'system_monitor', 'scene_manager',
    'room_summary', 'notification_log', 'water_usage',
    'statistics_chart',
  ] as WidgetType[])

  if (config.showGreeting !== false) visible.add('greeting')
  if (config.showWeather !== false) visible.add('weather')
  if (config.showClock !== false) {
    visible.add('analog_clock')
    visible.add('digital_clock')
  }
  if (config.showCalendar !== false) visible.add('calendar')
  if (config.showScenes !== false) visible.add('scene_selector')
  if (config.showSensors !== false) visible.add('sensor')

  return visible
}
