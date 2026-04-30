import { storage } from '@/lib/storage'
import { authFetch } from '@/lib/authHelpers'

import { getBackendUrl } from '@/lib/config'
const API_BASE = getBackendUrl()

export interface LightEnhancementSettings {
  showSubModalNavButtons: boolean
  showRgbHexInGroupMembers: boolean
  showEntityIdInLightModal: boolean
  enableTwoZoneSyncOnColorTemp: boolean
  twoZoneSyncEntityIds: string[]
}

export const LIGHT_ENHANCEMENTS_STORAGE_KEY = 'ha-light-enhancements'

let globalLoadInFlight: Promise<void> | null = null

const DEFAULT_SETTINGS: LightEnhancementSettings = {
  showSubModalNavButtons: true,
  showRgbHexInGroupMembers: true,
  showEntityIdInLightModal: true,
  enableTwoZoneSyncOnColorTemp: true,
  twoZoneSyncEntityIds: [],
}

function normalizeEntityIdList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)
}

export function getLightEnhancementSettings(): LightEnhancementSettings {
  try {
    const parsed = storage.get<
      Partial<LightEnhancementSettings> & {
        showRgbHexForDualSegmentInGroups?: boolean
        sendRgbWithColorTempForDualSegment?: boolean
        forceDualSegmentEntities?: string[]
      }
    >(LIGHT_ENHANCEMENTS_STORAGE_KEY)
    if (!parsed) return { ...DEFAULT_SETTINGS }

    return {
      showSubModalNavButtons: parsed.showSubModalNavButtons ?? DEFAULT_SETTINGS.showSubModalNavButtons,
      showRgbHexInGroupMembers:
        parsed.showRgbHexInGroupMembers
        ?? parsed.showRgbHexForDualSegmentInGroups
        ?? DEFAULT_SETTINGS.showRgbHexInGroupMembers,
      showEntityIdInLightModal: parsed.showEntityIdInLightModal ?? DEFAULT_SETTINGS.showEntityIdInLightModal,
      enableTwoZoneSyncOnColorTemp:
        parsed.enableTwoZoneSyncOnColorTemp
        ?? parsed.sendRgbWithColorTempForDualSegment
        ?? DEFAULT_SETTINGS.enableTwoZoneSyncOnColorTemp,
      twoZoneSyncEntityIds: normalizeEntityIdList(
        parsed.twoZoneSyncEntityIds ?? parsed.forceDualSegmentEntities
      ),
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function setLightEnhancementSettings(settings: LightEnhancementSettings): void {
  const normalized = {
    ...settings,
    twoZoneSyncEntityIds: normalizeEntityIdList(settings.twoZoneSyncEntityIds),
  }
  storage.set(LIGHT_ENHANCEMENTS_STORAGE_KEY, normalized)

  // Persist globally for all users/devices.
  void authFetch(`/api/config/system/preferences`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      preference_key: LIGHT_ENHANCEMENTS_STORAGE_KEY,
      preference_value: normalized,
    }),
  }).catch(() => {
    // Keep local cache as fallback when backend is unavailable.
  })
}

export function updateLightEnhancementSettings(
  updates: Partial<LightEnhancementSettings>
): LightEnhancementSettings {
  const current = getLightEnhancementSettings()
  const next = {
    ...current,
    ...updates,
    twoZoneSyncEntityIds: updates.twoZoneSyncEntityIds
      ? normalizeEntityIdList(updates.twoZoneSyncEntityIds)
      : current.twoZoneSyncEntityIds,
  }
  setLightEnhancementSettings(next)
  return next
}

export function isTwoZoneSyncEntity(
  entityId: string,
  settings: LightEnhancementSettings = getLightEnhancementSettings()
): boolean {
  if (settings.twoZoneSyncEntityIds.length === 0) return true
  return settings.twoZoneSyncEntityIds.includes(entityId.toLowerCase())
}

export async function loadLightEnhancementSettingsFromBackend(): Promise<void> {
  if (globalLoadInFlight) return globalLoadInFlight

  globalLoadInFlight = (async () => {
    try {
      const res = await authFetch(`/api/config/system/preferences`)
      if (!res.ok) return

      const prefs = await res.json() as Array<{ preference_key: string; preference_value: unknown }>
      const pref = prefs.find((item) => item.preference_key === LIGHT_ENHANCEMENTS_STORAGE_KEY)
      if (!pref) return

      const raw = typeof pref.preference_value === 'string'
        ? pref.preference_value
        : JSON.stringify(pref.preference_value)
      storage.set(LIGHT_ENHANCEMENTS_STORAGE_KEY, JSON.parse(raw))
    } catch {
      // Keep local cache on failures.
    } finally {
      globalLoadInFlight = null
    }
  })()

  return globalLoadInFlight
}
