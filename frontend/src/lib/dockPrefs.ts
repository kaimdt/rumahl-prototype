// Dock pin preferences shared between the OS dock and the launcher quick actions.
const DOCK_PINS_KEY = 'rumahl-os-dock-pins'
const DOCK_PINS_EVENT = 'rumahl:dock-pins-changed'

export const DEFAULT_DOCK_PINS = ['rumahl-home', 'rumahl-files', 'rumahl-app-store', 'rumahl-settings']

export const DOCK_PINS_EVENT_NAME = DOCK_PINS_EVENT

export function readDockPins(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(DOCK_PINS_KEY) || '[]')
    const list = Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []
    return list.length ? list : DEFAULT_DOCK_PINS
  } catch {
    return DEFAULT_DOCK_PINS
  }
}

export function writeDockPins(ids: string[]) {
  localStorage.setItem(DOCK_PINS_KEY, JSON.stringify(ids))
  window.dispatchEvent(new Event(DOCK_PINS_EVENT))
}

/** Pins or unpins an app id; returns true when it is now pinned. */
export function toggleDockPin(id: string): boolean {
  const current = readDockPins()
  const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
  writeDockPins(next)
  return next.includes(id)
}

export function isDockPinned(id: string): boolean {
  return readDockPins().includes(id)
}
