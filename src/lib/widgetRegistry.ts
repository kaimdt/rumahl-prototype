import {
  Lightbulb,
  Thermometer,
  PlugsConnected,
  Gauge,
  CloudSun,
  SpeakerHigh,
  ChatText,
  Clock,
  Timer,
  CalendarBlank,
  Sparkle,
  Minus,
  TextAa,
  GridFour,
  Stack,
  ToggleLeft,
  Sliders,
  ListBullets,
  ShieldCheck,
  ArrowsDownUp,
  Fan,
  LockKey,
  GearSix,
  Play,
  CursorClick,
  Lightning,
  Textbox,
  CalendarDots,
  User,
  MapPin,
  Hourglass,
  HashStraight,
  UsersThree,
  VideoCamera,
  Robot,
  Drop,
  ShieldWarning,
} from '@phosphor-icons/react'
import type { WidgetType } from '@/lib/types'

export type WidgetSubcategory =
  | 'lights_switches'
  | 'climate_env'
  | 'media'
  | 'automation'
  | 'inputs'
  | 'security'
  | 'status_tracking'

export interface WidgetDefinition {
  type: WidgetType
  label: string
  icon: typeof Lightbulb
  category: 'entity' | 'standalone' | 'layout'
  subcategory?: WidgetSubcategory
  requiresEntity: boolean
  entityDomain?: string
  defaultSize: { w: number; h: number }
  variants?: { key: string; label: string }[]
}

export const WIDGET_DEFINITIONS: WidgetDefinition[] = [
  // Lichter & Schalter
  { type: 'light',          label: 'Licht',          icon: Lightbulb,      category: 'entity', subcategory: 'lights_switches', requiresEntity: true,  entityDomain: 'light',          defaultSize: { w: 1, h: 1 }, variants: [{ key: 'standard', label: 'Standard' }, { key: 'compact', label: 'Kompakt' }, { key: 'toggle', label: 'Nur Schalten' }] },
  { type: 'switch',         label: 'Schalter',       icon: PlugsConnected, category: 'entity', subcategory: 'lights_switches', requiresEntity: true,  entityDomain: 'switch',         defaultSize: { w: 1, h: 1 }, variants: [{ key: 'standard', label: 'Standard' }, { key: 'compact', label: 'Kompakt' }] },
  { type: 'input_boolean',  label: 'Eingabe Bool',   icon: ToggleLeft,     category: 'entity', subcategory: 'lights_switches', requiresEntity: true,  entityDomain: 'input_boolean',  defaultSize: { w: 1, h: 1 }, variants: [{ key: 'standard', label: 'Standard' }, { key: 'compact', label: 'Kompakt' }] },
  { type: 'fan',            label: 'Ventilator',     icon: Fan,            category: 'entity', subcategory: 'lights_switches', requiresEntity: true,  entityDomain: 'fan',            defaultSize: { w: 1, h: 1 }, variants: [{ key: 'standard', label: 'Standard' }, { key: 'compact', label: 'Kompakt' }] },
  { type: 'cover',          label: 'Rollladen',      icon: ArrowsDownUp,   category: 'entity', subcategory: 'lights_switches', requiresEntity: true,  entityDomain: 'cover',          defaultSize: { w: 1, h: 1 }, variants: [{ key: 'standard', label: 'Standard' }, { key: 'compact', label: 'Kompakt' }] },
  // Klima & Umwelt
  { type: 'climate',        label: 'Klima',          icon: Thermometer,    category: 'entity', subcategory: 'climate_env',     requiresEntity: true,  entityDomain: 'climate',        defaultSize: { w: 2, h: 1 }, variants: [{ key: 'standard', label: 'Standard' }, { key: 'compact', label: 'Kompakt' }] },
  { type: 'humidifier',     label: 'Luftbefeuchter', icon: Drop,           category: 'entity', subcategory: 'climate_env',     requiresEntity: true,  entityDomain: 'humidifier',     defaultSize: { w: 2, h: 1 } },
  { type: 'sensor',         label: 'Sensor',         icon: Gauge,          category: 'entity', subcategory: 'climate_env',     requiresEntity: true,  entityDomain: 'sensor',         defaultSize: { w: 1, h: 1 }, variants: [{ key: 'standard', label: 'Standard' }, { key: 'compact', label: 'Kompakt' }] },
  { type: 'binary_sensor',  label: 'Binärsensor',    icon: ShieldCheck,    category: 'entity', subcategory: 'climate_env',     requiresEntity: true,  entityDomain: 'binary_sensor',  defaultSize: { w: 1, h: 1 }, variants: [{ key: 'standard', label: 'Standard' }, { key: 'compact', label: 'Kompakt' }] },
  { type: 'weather',        label: 'Wetter',         icon: CloudSun,       category: 'entity', subcategory: 'climate_env',     requiresEntity: false, entityDomain: 'weather',        defaultSize: { w: 2, h: 1 }, variants: [{ key: 'standard', label: 'Standard' }, { key: 'compact', label: 'Kompakt' }, { key: 'detailed', label: 'Detailliert' }, { key: 'forecast', label: 'Nur Vorhersage' }] },
  // Medien
  { type: 'media_player',   label: 'Media Player',   icon: SpeakerHigh,    category: 'entity', subcategory: 'media',           requiresEntity: true,  entityDomain: 'media_player',   defaultSize: { w: 2, h: 1 } },
  { type: 'camera',         label: 'Kamera',         icon: VideoCamera,    category: 'entity', subcategory: 'media',           requiresEntity: true,  entityDomain: 'camera',         defaultSize: { w: 2, h: 2 } },
  // Automatisierung
  { type: 'automation',     label: 'Automatisierung',icon: GearSix,        category: 'entity', subcategory: 'automation',      requiresEntity: true,  entityDomain: 'automation',     defaultSize: { w: 1, h: 1 } },
  { type: 'script',         label: 'Skript',         icon: Play,           category: 'entity', subcategory: 'automation',      requiresEntity: true,  entityDomain: 'script',         defaultSize: { w: 1, h: 1 } },
  { type: 'scene_entity',   label: 'Szene',          icon: Sparkle,        category: 'entity', subcategory: 'automation',      requiresEntity: true,  entityDomain: 'scene',          defaultSize: { w: 1, h: 1 } },
  { type: 'button',         label: 'Taste',          icon: CursorClick,    category: 'entity', subcategory: 'automation',      requiresEntity: true,  entityDomain: 'button',         defaultSize: { w: 1, h: 1 } },
  // Eingaben
  { type: 'input_number',   label: 'Eingabe Zahl',   icon: Sliders,        category: 'entity', subcategory: 'inputs',          requiresEntity: true,  entityDomain: 'input_number',   defaultSize: { w: 2, h: 1 } },
  { type: 'number',         label: 'Zahl',           icon: Sliders,        category: 'entity', subcategory: 'inputs',          requiresEntity: true,  entityDomain: 'number',         defaultSize: { w: 2, h: 1 } },
  { type: 'input_select',   label: 'Eingabe Auswahl',icon: ListBullets,    category: 'entity', subcategory: 'inputs',          requiresEntity: true,  entityDomain: 'input_select',   defaultSize: { w: 2, h: 1 } },
  { type: 'select',         label: 'Auswahl',        icon: ListBullets,    category: 'entity', subcategory: 'inputs',          requiresEntity: true,  entityDomain: 'select',         defaultSize: { w: 2, h: 1 } },
  { type: 'input_text',     label: 'Eingabe Text',   icon: Textbox,        category: 'entity', subcategory: 'inputs',          requiresEntity: true,  entityDomain: 'input_text',     defaultSize: { w: 2, h: 1 } },
  { type: 'text',           label: 'Text',           icon: Textbox,        category: 'entity', subcategory: 'inputs',          requiresEntity: true,  entityDomain: 'text',           defaultSize: { w: 2, h: 1 } },
  { type: 'input_datetime', label: 'Datum/Zeit',     icon: CalendarDots,   category: 'entity', subcategory: 'inputs',          requiresEntity: true,  entityDomain: 'input_datetime', defaultSize: { w: 2, h: 1 } },
  // Sicherheit
  { type: 'lock',           label: 'Schloss',        icon: LockKey,        category: 'entity', subcategory: 'security',        requiresEntity: true,  entityDomain: 'lock',           defaultSize: { w: 1, h: 1 } },
  { type: 'alarm_control_panel', label: 'Alarmanlage', icon: ShieldWarning, category: 'entity', subcategory: 'security',       requiresEntity: true,  entityDomain: 'alarm_control_panel', defaultSize: { w: 2, h: 2 } },
  // Status & Tracking
  { type: 'person',         label: 'Person',         icon: User,           category: 'entity', subcategory: 'status_tracking', requiresEntity: true,  entityDomain: 'person',         defaultSize: { w: 1, h: 1 } },
  { type: 'device_tracker', label: 'Geräte-Tracker', icon: MapPin,         category: 'entity', subcategory: 'status_tracking', requiresEntity: true,  entityDomain: 'device_tracker', defaultSize: { w: 1, h: 1 } },
  { type: 'timer',          label: 'Timer',          icon: Hourglass,      category: 'entity', subcategory: 'status_tracking', requiresEntity: true,  entityDomain: 'timer',          defaultSize: { w: 1, h: 1 } },
  { type: 'counter',        label: 'Zähler',         icon: HashStraight,   category: 'entity', subcategory: 'status_tracking', requiresEntity: true,  entityDomain: 'counter',        defaultSize: { w: 1, h: 1 } },
  { type: 'group',          label: 'Gruppe',         icon: UsersThree,     category: 'entity', subcategory: 'status_tracking', requiresEntity: true,  entityDomain: 'group',          defaultSize: { w: 1, h: 1 } },
  { type: 'vacuum',         label: 'Staubsauger',    icon: Robot,          category: 'entity', subcategory: 'status_tracking', requiresEntity: true,  entityDomain: 'vacuum',         defaultSize: { w: 2, h: 1 } },
  // Standalone
  { type: 'greeting',       label: 'Begrüßung',      icon: ChatText,       category: 'standalone', requiresEntity: false, defaultSize: { w: 3, h: 1 } },
  { type: 'chat_card',      label: 'Chat Card',      icon: ChatText,       category: 'standalone', requiresEntity: false, defaultSize: { w: 2, h: 2 } },
  { type: 'dynamic_text',   label: 'Dynamischer Text', icon: TextAa,       category: 'standalone', requiresEntity: false, defaultSize: { w: 2, h: 1 } },
  { type: 'analog_clock',   label: 'Analoge Uhr',    icon: Clock,          category: 'standalone', requiresEntity: false, defaultSize: { w: 1, h: 2 } },
  { type: 'digital_clock',  label: 'Digitale Uhr',   icon: Timer,          category: 'standalone', requiresEntity: false, defaultSize: { w: 1, h: 1 } },
  { type: 'calendar',       label: 'Kalender',        icon: CalendarBlank,  category: 'standalone', requiresEntity: false, defaultSize: { w: 1, h: 2 } },
  { type: 'scene_selector', label: 'Szenen-Auswahl',  icon: Lightning,      category: 'standalone', requiresEntity: false, defaultSize: { w: 4, h: 1 } },
  // Layout
  { type: 'spacer',         label: 'Abstand',         icon: Minus,          category: 'layout',     requiresEntity: false, defaultSize: { w: 1, h: 1 } },
  { type: 'section_header', label: 'Überschrift',     icon: TextAa,         category: 'layout',     requiresEntity: false, defaultSize: { w: 4, h: 1 } },
  { type: 'widget_group',   label: 'Widget-Gruppe',   icon: Stack,          category: 'layout',     requiresEntity: false, defaultSize: { w: 2, h: 1 } },
  { type: 'custom',         label: 'Benutzerdefiniert', icon: GridFour,     category: 'standalone', requiresEntity: false, defaultSize: { w: 1, h: 1 } },
]

export const WIDGET_SUBCATEGORIES: Record<WidgetSubcategory, { label: string; order: number }> = {
  lights_switches:  { label: 'Lichter & Schalter', order: 0 },
  climate_env:      { label: 'Klima & Umwelt',     order: 1 },
  media:            { label: 'Medien',              order: 2 },
  automation:       { label: 'Automatisierung',     order: 3 },
  inputs:           { label: 'Eingaben',            order: 4 },
  security:         { label: 'Sicherheit',          order: 5 },
  status_tracking:  { label: 'Status & Tracking',   order: 6 },
}

export const WIDGET_CATEGORIES = {
  entity:     { label: 'Geräte',    order: 0 },
  standalone: { label: 'Allgemein', order: 1 },
  layout:     { label: 'Layout',    order: 2 },
} as const

export function getWidgetDef(type: WidgetType): WidgetDefinition | undefined {
  return WIDGET_DEFINITIONS.find(d => d.type === type)
}

export function getWidgetsByCategory(category: 'entity' | 'standalone' | 'layout'): WidgetDefinition[] {
  return WIDGET_DEFINITIONS.filter(d => d.category === category)
}

export function getWidgetsBySubcategory(subcategory: WidgetSubcategory): WidgetDefinition[] {
  return WIDGET_DEFINITIONS.filter(d => d.subcategory === subcategory)
}
