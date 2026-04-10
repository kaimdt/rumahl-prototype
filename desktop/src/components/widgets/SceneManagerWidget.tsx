import { Palette, Play } from '@phosphor-icons/react'
import { useState } from 'react'
import { useEntityStore } from '@/hooks/useEntityStore'
import { haService } from '@/lib/homeAssistant'

export default function SceneManagerWidget({ config }: { config?: Record<string, unknown> }) {
  const { entities } = useEntityStore()
  const [lastActivated, setLastActivated] = useState<string | null>(null)
  const showEntityCount = (config?.showEntityCount ?? true) as boolean
  const groupByArea = (config?.groupByArea ?? true) as boolean

  const scenes = entities
    .filter(e => e.entity_id.startsWith('scene.'))
    .sort((a, b) => {
      const nameA = (a.attributes?.friendly_name as string) || a.entity_id
      const nameB = (b.attributes?.friendly_name as string) || b.entity_id
      return nameA.localeCompare(nameB)
    })

  const handleActivate = (entityId: string) => {
    haService.callServiceFireAndForget('scene', 'turn_on', entityId, {})
    setLastActivated(entityId)
    setTimeout(() => setLastActivated(null), 2000)
  }

  // Group scenes by area if available
  const groupedScenes = groupByArea
    ? scenes.reduce<Record<string, typeof scenes>>((acc, scene) => {
        const group = (scene.attributes?.area as string) || 'Sonstige'
        if (!acc[group]) acc[group] = []
        acc[group].push(scene)
        return acc
      }, {})
    : { 'Alle': scenes }

  const groups = Object.keys(groupedScenes).sort()

  return (
    <div className="flex flex-col gap-2 p-3 h-full">
      <div className="flex items-center gap-2 text-xs font-medium text-white/80">
        <Palette size={16} className="text-purple-400" />
        <span>Szenen-Manager</span>
        <span className="ml-auto text-[10px] text-white/40">{scenes.length} Szenen</span>
      </div>

      <div className="flex-1 overflow-auto flex flex-col gap-2">
        {groups.map(group => (
          <div key={group}>
            {groups.length > 1 && (
              <div className="text-[10px] text-white/40 uppercase tracking-wider mb-1">{group}</div>
            )}
            <div className="flex flex-col gap-0.5">
              {groupedScenes[group].map(scene => {
                const name = (scene.attributes?.friendly_name as string) || scene.entity_id.split('.')[1]?.replace(/_/g, ' ')
                const isActive = lastActivated === scene.entity_id
                const entityCount = (scene.attributes?.entity_id as string[])?.length || 0

                return (
                  <div
                    key={scene.entity_id}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-lg transition-all ${
                      isActive ? 'bg-purple-500/20 ring-1 ring-purple-400/30' : 'bg-white/5 hover:bg-white/10'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] text-white/80 truncate">{name}</div>
                      {showEntityCount && entityCount > 0 && (
                        <div className="text-[9px] text-white/30">{entityCount} Entitäten</div>
                      )}
                    </div>
                    <button
                      onClick={() => handleActivate(scene.entity_id)}
                      className={`p-1 rounded transition-colors ${
                        isActive
                          ? 'text-purple-400'
                          : 'text-white/40 hover:text-white/80 hover:bg-white/5'
                      }`}
                    >
                      <Play size={14} weight={isActive ? 'fill' : 'regular'} />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        ))}

        {scenes.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-white/40 text-xs">
            Keine Szenen konfiguriert
          </div>
        )}
      </div>
    </div>
  )
}
