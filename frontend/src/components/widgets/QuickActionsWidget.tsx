import { Rows, Play, Lightning } from '@phosphor-icons/react'
import { useEntityStore } from '@/hooks/useEntityStore'
import { haService } from '@/lib/homeAssistant'

export default function QuickActionsWidget({ config }: { config?: Record<string, unknown> }) {
  const { entities } = useEntityStore()
  const maxScenes = (config?.maxScenes as number) || 6
  const maxScripts = (config?.maxScripts as number) || 4

  // Find scenes and scripts for quick actions
  const scenes = entities
    .filter(e => e.entity_id.startsWith('scene.'))
    .slice(0, maxScenes)

  const scripts = entities
    .filter(e => e.entity_id.startsWith('script.'))
    .slice(0, maxScripts)

  const handleActivateScene = (entityId: string) => {
    haService.callServiceFireAndForget('scene', 'turn_on', entityId, {})
  }

  const handleRunScript = (entityId: string) => {
    haService.callServiceFireAndForget('script', 'turn_on', entityId, {})
  }

  return (
    <div className="flex flex-col gap-2 p-3 h-full">
      <div className="flex items-center gap-2 text-xs font-medium text-white/80">
        <Rows size={16} className="text-amber-400" />
        <span>Schnellaktionen</span>
      </div>

      <div className="flex-1 flex flex-col gap-1 overflow-auto">
        {scenes.length > 0 && (
          <>
            <div className="text-[10px] text-white/40 uppercase tracking-wider">Szenen</div>
            <div className="grid grid-cols-2 gap-1">
              {scenes.map(scene => (
                <button
                  key={scene.entity_id}
                  onClick={() => handleActivateScene(scene.entity_id)}
                  className="flex items-center gap-1.5 px-2 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-[11px] text-white/80 transition-colors text-left"
                >
                  <Lightning size={12} className="text-yellow-400 shrink-0" />
                  <span className="truncate">
                    {(scene.attributes?.friendly_name as string) || scene.entity_id.split('.')[1]?.replace(/_/g, ' ')}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {scripts.length > 0 && (
          <>
            <div className="text-[10px] text-white/40 uppercase tracking-wider mt-1">Skripte</div>
            <div className="grid grid-cols-2 gap-1">
              {scripts.map(script => (
                <button
                  key={script.entity_id}
                  onClick={() => handleRunScript(script.entity_id)}
                  className="flex items-center gap-1.5 px-2 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-[11px] text-white/80 transition-colors text-left"
                >
                  <Play size={12} className="text-green-400 shrink-0" />
                  <span className="truncate">
                    {(script.attributes?.friendly_name as string) || script.entity_id.split('.')[1]?.replace(/_/g, ' ')}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {scenes.length === 0 && scripts.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-white/40 text-xs">
            Keine Szenen oder Skripte gefunden
          </div>
        )}
      </div>
    </div>
  )
}
