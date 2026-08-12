import type { DashboardWidget, WidgetType } from '@/lib/types'

export interface LayoutTemplate {
  id: string
  name: string
  description: string
  icon: string
  widgets: DashboardWidget[]
}

let templateWidgetCounter = 0
function tw(
  type: WidgetType,
  position: { x: number; y: number },
  size: { w: number; h: number },
  config?: Record<string, unknown>,
  label?: string,
): DashboardWidget {
  templateWidgetCounter++
  return {
    id: `tpl-${Date.now()}-${templateWidgetCounter}`,
    type,
    position,
    size,
    config,
    label,
  }
}

export function getTemplateWidgets(templateId: string): DashboardWidget[] {
  // Generate fresh IDs each time
  templateWidgetCounter = 0
  const now = Date.now()

  switch (templateId) {
    case 'overview':
      return [
        { id: `w-${now}-1`, type: 'greeting',       position: { x: 0, y: 0 }, size: { w: 3, h: 1 }, config: {} },
        { id: `w-${now}-2`, type: 'weather',         position: { x: 3, y: 0 }, size: { w: 1, h: 1 }, config: {} },
        { id: `w-${now}-3`, type: 'digital_clock',   position: { x: 0, y: 1 }, size: { w: 1, h: 1 }, config: { showSeconds: true, showDate: true } },
        { id: `w-${now}-4`, type: 'analog_clock',    position: { x: 1, y: 1 }, size: { w: 1, h: 1 }, config: { size: 220 } },
        { id: `w-${now}-5`, type: 'calendar',        position: { x: 2, y: 1 }, size: { w: 2, h: 1 }, config: {} },
        { id: `w-${now}-6`, type: 'scene_selector',  position: { x: 0, y: 2 }, size: { w: 4, h: 1 }, config: {} },
      ]
    case 'room':
      return [
        { id: `w-${now}-1`, type: 'section_header', position: { x: 0, y: 0 }, size: { w: 4, h: 1 }, label: 'Raum' },
        { id: `w-${now}-2`, type: 'light',          position: { x: 0, y: 1 }, size: { w: 1, h: 1 }, config: {} },
        { id: `w-${now}-3`, type: 'light',          position: { x: 1, y: 1 }, size: { w: 1, h: 1 }, config: {} },
        { id: `w-${now}-4`, type: 'climate',        position: { x: 2, y: 1 }, size: { w: 2, h: 1 }, config: {} },
        { id: `w-${now}-5`, type: 'switch',         position: { x: 0, y: 2 }, size: { w: 1, h: 1 }, config: {} },
        { id: `w-${now}-6`, type: 'switch',         position: { x: 1, y: 2 }, size: { w: 1, h: 1 }, config: {} },
        { id: `w-${now}-7`, type: 'sensor',         position: { x: 2, y: 2 }, size: { w: 1, h: 1 }, config: {} },
      ]
    case 'info':
      return [
        { id: `w-${now}-1`, type: 'weather',       position: { x: 0, y: 0 }, size: { w: 2, h: 1 }, config: {} },
        { id: `w-${now}-2`, type: 'digital_clock', position: { x: 2, y: 0 }, size: { w: 2, h: 1 }, config: { showSeconds: true, show24Hour: true, showDate: true } },
        { id: `w-${now}-3`, type: 'calendar',      position: { x: 0, y: 1 }, size: { w: 2, h: 1 }, config: {} },
        { id: `w-${now}-4`, type: 'sensor',        position: { x: 2, y: 1 }, size: { w: 1, h: 1 }, config: {} },
        { id: `w-${now}-5`, type: 'sensor',        position: { x: 3, y: 1 }, size: { w: 1, h: 1 }, config: {} },
        { id: `w-${now}-6`, type: 'greeting',      position: { x: 0, y: 2 }, size: { w: 4, h: 1 }, config: {} },
      ]
    case 'lighting':
      return [
        { id: `w-${now}-1`, type: 'scene_selector', position: { x: 0, y: 0 }, size: { w: 4, h: 1 }, config: {} },
        { id: `w-${now}-2`, type: 'light',          position: { x: 0, y: 1 }, size: { w: 1, h: 1 }, config: {} },
        { id: `w-${now}-3`, type: 'light',          position: { x: 1, y: 1 }, size: { w: 1, h: 1 }, config: {} },
        { id: `w-${now}-4`, type: 'light',          position: { x: 2, y: 1 }, size: { w: 1, h: 1 }, config: {} },
        { id: `w-${now}-5`, type: 'light',          position: { x: 3, y: 1 }, size: { w: 1, h: 1 }, config: {} },
        { id: `w-${now}-6`, type: 'light',          position: { x: 0, y: 2 }, size: { w: 1, h: 1 }, config: {} },
        { id: `w-${now}-7`, type: 'light',          position: { x: 1, y: 2 }, size: { w: 1, h: 1 }, config: {} },
        { id: `w-${now}-8`, type: 'light',          position: { x: 2, y: 2 }, size: { w: 1, h: 1 }, config: {} },
        { id: `w-${now}-9`, type: 'light',          position: { x: 3, y: 2 }, size: { w: 1, h: 1 }, config: {} },
      ]
    case 'blank':
    default:
      return []
  }
}

export const LAYOUT_TEMPLATES: LayoutTemplate[] = [
  {
    id: 'blank',
    name: 'Leer',
    description: 'Leere Seite, komplett selbst gestalten',
    icon: 'GridFour',
    widgets: [],
  },
  {
    id: 'overview',
    name: 'Übersicht',
    description: 'Begrüßung, Wetter, Uhren, Kalender & Szenen',
    icon: 'House',
    widgets: [], // populated by getTemplateWidgets
  },
  {
    id: 'room',
    name: 'Raumsteuerung',
    description: 'Lichter, Klima und Schalter für einen Raum',
    icon: 'Lightbulb',
    widgets: [],
  },
  {
    id: 'info',
    name: 'Information',
    description: 'Wetter, Uhrzeit, Kalender und Sensoren',
    icon: 'CloudSun',
    widgets: [],
  },
  {
    id: 'lighting',
    name: 'Beleuchtung',
    description: 'Szenen und Lichtsteuerung',
    icon: 'Sparkle',
    widgets: [],
  },
]

export const DEFAULT_HOME_WIDGETS: DashboardWidget[] = [
  { id: 'home-greeting',      type: 'greeting',       position: { x: 0, y: 0 }, size: { w: 2, h: 1 }, config: {} },
  { id: 'home-weather',       type: 'weather',        position: { x: 2, y: 0 }, size: { w: 1, h: 1 }, config: {} },
  { id: 'home-presence',      type: 'ora_presence',   position: { x: 3, y: 0 }, size: { w: 1, h: 1 }, config: {} },
  { id: 'home-digital-clock', type: 'digital_clock',  position: { x: 0, y: 1 }, size: { w: 1, h: 1 }, config: { showSeconds: true, showDate: true } },
  { id: 'home-analog-clock',  type: 'analog_clock',   position: { x: 1, y: 1 }, size: { w: 1, h: 1 }, config: { size: 220 } },
  { id: 'home-calendar',      type: 'calendar',       position: { x: 2, y: 1 }, size: { w: 2, h: 1 }, config: {} },
  { id: 'home-scenes',        type: 'scene_selector', position: { x: 0, y: 2 }, size: { w: 4, h: 1 }, config: {} },
  // ORA OS system section (Package 3 — Home Dashboard v2; additive to the
  // Home Assistant widgets above, which remain the smart-home core).
  { id: 'home-system-header', type: 'section_header', position: { x: 0, y: 3 }, size: { w: 4, h: 1 }, label: 'System' },
  { id: 'home-storage',       type: 'ora_storage',    position: { x: 0, y: 4 }, size: { w: 2, h: 1 }, config: {} },
  { id: 'home-system',        type: 'ora_system',     position: { x: 2, y: 4 }, size: { w: 2, h: 1 }, config: {} },
  { id: 'home-jobs',          type: 'ora_jobs',       position: { x: 0, y: 5 }, size: { w: 2, h: 2 }, config: {} },
  { id: 'home-recent-files',  type: 'ora_recent_files', position: { x: 2, y: 5 }, size: { w: 2, h: 2 }, config: {} },
]
