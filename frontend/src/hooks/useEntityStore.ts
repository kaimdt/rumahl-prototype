import { useState, useEffect } from 'react'
import type { EntityState } from '@/lib/types'
import { haService } from '@/lib/homeAssistant'
import { wsOnOpen, wsOnMessage, wsOnClose } from '@/lib/wsConnection'

interface EntityStore {
  entities: EntityState[]
  getEntity: (entityId: string) => EntityState | undefined
  loading: boolean
  wsConnected: boolean
  refresh: () => Promise<void>
}

// ── Global singleton state ──────────────────────────────────────────
// All useEntityStore() consumers share one entity map and one array
// reference. The array is only rebuilt when an entity actually changes
// (different last_updated), preventing unnecessary React re-renders.

let globalEntities: EntityState[] = []
let globalMap = new Map<string, EntityState>()
let globalLoading = true
let globalWsConnected = false
const listeners = new Set<() => void>()

function notify() {
  for (const fn of listeners) fn()
}

function setGlobalEntities(newMap: Map<string, EntityState>) {
  globalMap = newMap
  globalEntities = Array.from(newMap.values())
  globalLoading = false
  notify()
}

function mergeGlobalUpdates(changedStates: EntityState[]) {
  if (changedStates.length === 0) return
  let actuallyChanged = false
  for (const entity of changedStates) {
    const existing = globalMap.get(entity.entity_id)
    if (!existing || existing.last_updated !== entity.last_updated) {
      globalMap.set(entity.entity_id, entity)
      actuallyChanged = true
    }
  }
  if (actuallyChanged) {
    globalEntities = Array.from(globalMap.values())
  }
  globalLoading = false
  notify()
}

// ── Fallback HTTP polling ───────────────────────────────────────────
let fallbackInterval: number | undefined

function stopFallbackPolling() {
  if (fallbackInterval) {
    window.clearInterval(fallbackInterval)
    fallbackInterval = undefined
  }
}

async function fetchEntities() {
  try {
    const states = await haService.getStates()
    const map = new Map<string, EntityState>()
    for (const entity of states) {
      map.set(entity.entity_id, entity)
    }
    setGlobalEntities(map)
  } catch (error) {
    console.error('Failed to fetch entities:', error)
    globalLoading = false
    notify()
  }
}

function startFallbackPolling() {
  if (fallbackInterval) return
  console.log('[EntityStore] Starting fallback HTTP polling (10s)')
  fallbackInterval = window.setInterval(fetchEntities, 10000)
}

// ── Wire up WebSocket events (runs once at module load) ─────────────

wsOnOpen(() => {
  globalWsConnected = true
  stopFallbackPolling()
  notify()
})

wsOnMessage((data: unknown) => {
  const message = data as Record<string, unknown>
  if (message.type === 'state_update' && Array.isArray(message.changed)) {
    mergeGlobalUpdates(message.changed as EntityState[])
  } else if (message.type === 'state_changed' && Array.isArray(message.states)) {
    const map = new Map<string, EntityState>()
    for (const entity of message.states as EntityState[]) {
      map.set(entity.entity_id, entity)
    }
    setGlobalEntities(map)
  }
})

wsOnClose(() => {
  globalWsConnected = false
  notify()
  startFallbackPolling()
})

// ── React hook ──────────────────────────────────────────────────────
export function useEntityStore(): EntityStore {
  const [, forceUpdate] = useState(0)

  useEffect(() => {
    const listener = () => forceUpdate(c => c + 1)
    listeners.add(listener)

    return () => {
      listeners.delete(listener)
    }
  }, [])

  return {
    entities: globalEntities,
    // ⚡ Bolt Optimization: Expose O(1) Map lookup to prevent O(N) Array.find() scans during renders
    getEntity: (entityId: string) => globalMap.get(entityId),
    loading: globalLoading,
    wsConnected: globalWsConnected,
    refresh: fetchEntities,
  }
}
