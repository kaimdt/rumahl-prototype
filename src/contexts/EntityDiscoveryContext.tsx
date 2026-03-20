import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useLocalStorage } from '@/lib/storage'
import type { EntityState } from '@/lib/types'

interface DiscoveredEntity {
  entity_id: string
  domain: string
  friendly_name: string
  discovered_at: string
}

interface EntityDiscoveryContextType {
  newEntities: DiscoveredEntity[]
  acknowledgeEntity: (entity_id: string) => void
  acknowledgeAll: () => void
  checkForNewEntities: (entities: EntityState[]) => void
}

const EntityDiscoveryContext = createContext<EntityDiscoveryContextType | undefined>(undefined)

export function EntityDiscoveryProvider({ children }: { children: React.ReactNode }) {
  const [knownEntityIds, setKnownEntityIds] = useLocalStorage<string[]>('ha-known-entities', [])
  const [newEntities, setNewEntities] = useState<DiscoveredEntity[]>([])

  const checkForNewEntities = useCallback((entities: EntityState[]) => {
    const currentEntityIds = entities.map(e => e.entity_id)
    const knownSet = new Set(knownEntityIds)

    // Find entities that are not in the known list
    const discovered: DiscoveredEntity[] = entities
      .filter(entity => !knownSet.has(entity.entity_id))
      .map(entity => ({
        entity_id: entity.entity_id,
        domain: entity.entity_id.split('.')[0],
        friendly_name: (entity.attributes.friendly_name as string) || entity.entity_id,
        discovered_at: new Date().toISOString(),
      }))

    if (discovered.length > 0) {
      setNewEntities(prev => {
        // Merge with existing new entities, avoiding duplicates
        const existingIds = new Set(prev.map(e => e.entity_id))
        const uniqueNew = discovered.filter(e => !existingIds.has(e.entity_id))
        return [...prev, ...uniqueNew]
      })
    }

    // Update known entities if we have current entities
    if (currentEntityIds.length > 0 && knownEntityIds.length === 0) {
      // First time initialization - mark all as known
      setKnownEntityIds(currentEntityIds)
    }
  }, [knownEntityIds, setKnownEntityIds])

  const acknowledgeEntity = useCallback((entity_id: string) => {
    setNewEntities(prev => prev.filter(e => e.entity_id !== entity_id))
    setKnownEntityIds(prev => [...prev, entity_id])
  }, [setKnownEntityIds])

  const acknowledgeAll = useCallback(() => {
    const entityIds = newEntities.map(e => e.entity_id)
    setKnownEntityIds(prev => [...prev, ...entityIds])
    setNewEntities([])
  }, [newEntities, setKnownEntityIds])

  return (
    <EntityDiscoveryContext.Provider
      value={{
        newEntities,
        acknowledgeEntity,
        acknowledgeAll,
        checkForNewEntities,
      }}
    >
      {children}
    </EntityDiscoveryContext.Provider>
  )
}

export function useEntityDiscovery() {
  const context = useContext(EntityDiscoveryContext)
  if (!context) throw new Error('useEntityDiscovery must be used within EntityDiscoveryProvider')
  return context
}
