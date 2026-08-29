import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDeviceCapabilities } from '@/hooks/useDeviceCapabilities'

export type ShellModePreference = 'auto' | 'desktop' | 'launcher'
export type ResolvedShellMode = 'desktop' | 'launcher'

const STORAGE_KEY = 'rumahl-shell-mode'
const CHANGE_EVENT = 'rumahl:shell-mode-changed'

// `useShellMode` is consumed by several components at once (AdminCenter,
// OsHomeScreen, AppChrome). Each registers an effect that writes the
// `data-shell-mode` attribute on <html>, and each previously removed it on
// unmount. Closing a window that hosts one consumer (e.g. AdminCenter) thus
// stripped the attribute while the others were still mounted — every
// `:root[data-shell-mode="desktop"]` rule stopped applying and the shell
// collapsed to a half-visible state.
//
// Fix: share a module-level reference count. The attribute is only written
// when a consumer mounts (and updated on every preference/mode change), and
// only removed when the LAST consumer unmounts. All consumers resolve the
// same preference + device capabilities, so they write the same value.
let shellModeConsumerCount = 0

function writeShellModeAttributes(mode: ResolvedShellMode, preference: ShellModePreference): void {
  const root = document.documentElement
  root.setAttribute('data-shell-mode', mode)
  root.setAttribute('data-shell-preference', preference)
}

function clearShellModeAttributes(): void {
  const root = document.documentElement
  root.removeAttribute('data-shell-mode')
  root.removeAttribute('data-shell-preference')
}

function readPreference(): ShellModePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'desktop' || value === 'launcher' || value === 'auto' ? value : 'auto'
  } catch {
    return 'auto'
  }
}

export function useShellMode() {
  const capabilities = useDeviceCapabilities()
  const [preference, setPreferenceState] = useState<ShellModePreference>(readPreference)

  useEffect(() => {
    const sync = () => setPreferenceState(readPreference())
    window.addEventListener(CHANGE_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const resolvedMode = useMemo<ResolvedShellMode>(() => {
    if (preference !== 'auto') return preference
    if (capabilities.isPhone || capabilities.isTablet || capabilities.isCoarsePointer) return 'launcher'
    return 'desktop'
  }, [capabilities.isCoarsePointer, capabilities.isPhone, capabilities.isTablet, preference])

  // Keep the attribute in sync while this consumer is mounted. The refcount
  // ensures the attribute survives the unmount of any single consumer (see
  // the explanation above).
  useEffect(() => {
    shellModeConsumerCount += 1
    writeShellModeAttributes(resolvedMode, preference)
    return () => {
      shellModeConsumerCount -= 1
      if (shellModeConsumerCount <= 0) {
        shellModeConsumerCount = 0
        clearShellModeAttributes()
      }
    }
  }, [preference, resolvedMode])

  const setPreference = useCallback((value: ShellModePreference) => {
    try { localStorage.setItem(STORAGE_KEY, value) } catch {}
    setPreferenceState(value)
    window.dispatchEvent(new Event(CHANGE_EVENT))
  }, [])

  return { preference, resolvedMode, setPreference, capabilities }
}

