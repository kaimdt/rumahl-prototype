export type SessionClockFont = 'rumahl' | 'system' | 'rounded' | 'serif' | 'mono'
export type SessionClockPosition = 'top' | 'center'

export interface SessionScreenSettings {
  clockScale: number
  textScale: number
  clockFont: SessionClockFont
  clockPosition: SessionClockPosition
  showDate: boolean
  showBrand: boolean
  showStatusWidget: boolean
  positions: Record<SessionScreenElement, SessionScreenPosition>
}

export type SessionScreenElement = 'clock' | 'date' | 'status' | 'brand'
export interface SessionScreenPosition { x: number; y: number }

export const DEFAULT_SESSION_SCREEN_SETTINGS: SessionScreenSettings = {
  clockScale: 100,
  textScale: 100,
  clockFont: 'rumahl',
  clockPosition: 'top',
  showDate: true,
  showBrand: true,
  showStatusWidget: true,
  positions: {
    clock: { x: 50, y: 13 },
    date: { x: 50, y: 23 },
    status: { x: 50, y: 29 },
    brand: { x: 50, y: 94 },
  },
}

export function normalizeSessionScreenSettings(value: SessionScreenSettings): SessionScreenSettings {
  return { ...DEFAULT_SESSION_SCREEN_SETTINGS, ...value, positions: { ...DEFAULT_SESSION_SCREEN_SETTINGS.positions, ...value.positions } }
}

export const SESSION_CLOCK_FONT_STACKS: Record<SessionClockFont, string> = {
  rumahl: '"Rumahl Sans", "Segoe UI Variable Display", system-ui, sans-serif',
  system: 'inherit',
  rounded: 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif',
  serif: 'ui-serif, Georgia, serif',
  mono: 'ui-monospace, "Cascadia Code", monospace',
}
