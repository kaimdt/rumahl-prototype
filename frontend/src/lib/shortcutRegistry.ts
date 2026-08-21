/**
 * Global keyboard shortcut registry (Package 0, Feature 7).
 *
 * Central place where every OS shortcut is defined, configurable per user
 * and translatable. Components read the effective combo via `getCombo(id)`
 * instead of hardcoding keys; the Settings → Keyboard UI lists all
 * shortcuts and lets users re-record or reset them.
 *
 * Combo syntax: `Mod+Shift+V`, `Alt+ArrowLeft`, `Ctrl+Space`, `Alt+Tab`.
 * `Mod` matches Ctrl (Windows/Linux) or Meta (macOS).
 */

export interface ShortcutDefinition {
  id: string
  /** i18n key for the human-readable label (shortcuts.*.label). */
  labelKey: string
  /** i18n key for the description (shortcuts.*.desc). */
  descKey: string
  /** Canonical default combo, e.g. "Mod+K". */
  defaultCombo: string
}

export const SHORTCUTS: ShortcutDefinition[] = [
  { id: 'spotlight', labelKey: 'shortcuts.spotlight.label', descKey: 'shortcuts.spotlight.desc', defaultCombo: 'Mod+Space' },
  { id: 'clipboard', labelKey: 'shortcuts.clipboard.label', descKey: 'shortcuts.clipboard.desc', defaultCombo: 'Mod+Shift+V' },
  { id: 'task-switcher', labelKey: 'shortcuts.taskSwitcher.label', descKey: 'shortcuts.taskSwitcher.desc', defaultCombo: 'Alt+Tab' },
  { id: 'snap-left', labelKey: 'shortcuts.snapLeft.label', descKey: 'shortcuts.snapLeft.desc', defaultCombo: 'Alt+ArrowLeft' },
  { id: 'snap-right', labelKey: 'shortcuts.snapRight.label', descKey: 'shortcuts.snapRight.desc', defaultCombo: 'Alt+ArrowRight' },
  { id: 'snap-maximize', labelKey: 'shortcuts.snapMaximize.label', descKey: 'shortcuts.snapMaximize.desc', defaultCombo: 'Alt+ArrowUp' },
  { id: 'snap-restore', labelKey: 'shortcuts.snapRestore.label', descKey: 'shortcuts.snapRestore.desc', defaultCombo: 'Alt+ArrowDown' },
  { id: 'lock', labelKey: 'shortcuts.lock.label', descKey: 'shortcuts.lock.desc', defaultCombo: 'Mod+Shift+L' },
  { id: 'sleep', labelKey: 'shortcuts.sleep.label', descKey: 'shortcuts.sleep.desc', defaultCombo: 'Mod+Shift+S' },
]

const STORAGE_KEY = 'rumahl-keyboard-shortcuts'

function readOverrides(): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeOverrides(overrides: Record<string, string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides))
  } catch {
    // storage full — non-critical
  }
}

/** Effective combo for a shortcut id (user override or default). */
export function getCombo(id: string): string {
  const def = SHORTCUTS.find((s) => s.id === id)
  if (!def) return ''
  return readOverrides()[id] || def.defaultCombo
}

/** Persist a custom combo for a shortcut. */
export function setCombo(id: string, combo: string) {
  const overrides = readOverrides()
  overrides[id] = combo
  writeOverrides(overrides)
}

/** Restore a shortcut to its default combo. */
export function resetCombo(id: string) {
  const overrides = readOverrides()
  delete overrides[id]
  writeOverrides(overrides)
}

/** All shortcut ids whose combo is currently customized. */
export function customizedIds(): Set<string> {
  return new Set(Object.keys(readOverrides()))
}

interface ParsedCombo {
  mod: boolean
  alt: boolean
  shift: boolean
  key: string
}

function parseCombo(combo: string): ParsedCombo | null {
  const parts = combo.split('+').map((p) => p.trim())
  const parsed: ParsedCombo = { mod: false, alt: false, shift: false, key: '' }
  for (const part of parts) {
    if (part === 'Mod' || part === 'Ctrl' || part === 'Meta') parsed.mod = true
    else if (part === 'Alt') parsed.alt = true
    else if (part === 'Shift') parsed.shift = true
    else if (!parsed.key) parsed.key = part
    else return null
  }
  if (!parsed.key) return null
  return parsed
}

function eventKey(event: KeyboardEvent): string {
  if (event.key === ' ') return 'Space'
  if (event.key.startsWith('Arrow')) return event.key
  if (event.key === 'Escape') return 'Escape'
  return event.key.length === 1 ? event.key.toUpperCase() : event.key
}

/** Whether a keydown event matches a combo string. */
export function comboMatches(combo: string, event: KeyboardEvent): boolean {
  const parsed = parseCombo(combo)
  if (!parsed) return false
  const modPressed = event.ctrlKey || event.metaKey
  if (parsed.mod !== modPressed) return false
  if (parsed.alt !== event.altKey) return false
  if (parsed.shift !== event.shiftKey) return false
  return eventKey(event) === parsed.key
}

/** Human-readable combo for the UI (e.g. "Ctrl+Shift+V" / "⌘+⇧+V"). */
export function formatCombo(combo: string): string {
  const parts = combo.split('+').map((p) => p.trim())
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '')
  const map: Record<string, string> = {
    Mod: isMac ? '⌘' : 'Ctrl',
    Ctrl: isMac ? '⌘' : 'Ctrl',
    Meta: isMac ? '⌘' : 'Meta',
    Alt: isMac ? '⌥' : 'Alt',
    Shift: isMac ? '⇧' : 'Shift',
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    ArrowDown: '↓',
    Space: 'Space',
    Escape: 'Esc',
  }
  return parts.map((p) => map[p] || p).join(isMac ? '' : '+')
}

/**
 * Build a canonical combo string from a keydown event (for the recorder UI).
 * Returns null for plain keys without a modifier (too easy to trigger
 * accidentally) and for Escape (which cancels recording).
 */
export function comboFromEvent(event: KeyboardEvent): string | null {
  if (event.key === 'Escape') return null
  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) parts.push('Mod')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  const key = event.key === ' ' ? 'Space'
    : event.key.startsWith('Arrow') ? event.key
      : event.key.length === 1 ? event.key.toUpperCase()
        : event.key
  if (key === 'Escape' || key === 'Tab' || key === 'F1') return null
  parts.push(key)
  if (parts.length < 2) return null
  return parts.join('+')
}
