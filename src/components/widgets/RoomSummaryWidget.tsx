import { House, Lightbulb, Thermometer, Lock, Drop } from '@phosphor-icons/react'
import { useEntityStore } from '@/hooks/useEntityStore'

interface RoomSummaryWidgetProps {
  config?: {
    roomName?: string
    entityIds?: string[]
  }
}

const DOMAIN_ICONS: Record<string, { icon: typeof Lightbulb; color: string }> = {
  light: { icon: Lightbulb, color: 'text-yellow-400' },
  climate: { icon: Thermometer, color: 'text-blue-400' },
  lock: { icon: Lock, color: 'text-red-400' },
  humidifier: { icon: Drop, color: 'text-cyan-400' },
}

function getStateColor(state: string) {
  switch (state) {
    case 'on': return 'text-green-400'
    case 'off': return 'text-white/30'
    case 'locked': return 'text-green-400'
    case 'unlocked': return 'text-red-400'
    case 'unavailable': return 'text-red-500/50'
    default: return 'text-white/60'
  }
}

export default function RoomSummaryWidget({ config }: RoomSummaryWidgetProps) {
  const { entities, entityMap } = useEntityStore()

  const roomName = config?.roomName || 'Raum'
  
  // Filter entities by room/area or by explicit entity IDs
  const roomEntities = config?.entityIds
    ? config.entityIds.map(id => entityMap.get(id)).filter(Boolean) as typeof entities
    : entities.filter(e => {
        const area = ((e.attributes?.area_id || e.attributes?.area || '') as string)
        return area.toLowerCase().includes(roomName.toLowerCase())
      })

  // Group by domain
  const grouped = roomEntities.reduce<Record<string, typeof roomEntities>>((acc, entity) => {
    const domain = entity.entity_id.split('.')[0]
    if (!acc[domain]) acc[domain] = []
    acc[domain].push(entity)
    return acc
  }, {})

  const domains = Object.keys(grouped).sort()
  const onCount = roomEntities.filter(e => e.state === 'on').length
  const totalCount = roomEntities.length

  return (
    <div className="flex flex-col gap-2 p-3 h-full">
      <div className="flex items-center gap-2 text-xs font-medium text-white/80">
        <House size={16} className="text-teal-400" />
        <span>{roomName}</span>
        <span className="ml-auto text-[10px] text-white/40">
          {onCount}/{totalCount} aktiv
        </span>
      </div>

      <div className="flex-1 overflow-auto flex flex-col gap-1.5">
        {domains.map(domain => {
          const domainEntities = grouped[domain]
          const DomainIcon = DOMAIN_ICONS[domain]?.icon
          const iconColor = DOMAIN_ICONS[domain]?.color || 'text-white/40'

          return (
            <div key={domain} className="bg-white/5 rounded-lg p-2">
              <div className="flex items-center gap-1.5 mb-1">
                {DomainIcon && <DomainIcon size={12} className={iconColor} />}
                <span className="text-[10px] text-white/40 uppercase tracking-wider">{domain}</span>
                <span className="text-[10px] text-white/30 ml-auto">
                  {domainEntities.filter(e => e.state === 'on').length}/{domainEntities.length}
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {domainEntities.map(entity => (
                  <div
                    key={entity.entity_id}
                    className="flex items-center gap-1 px-1.5 py-0.5 bg-white/5 rounded text-[10px]"
                  >
                    <div className={`w-1.5 h-1.5 rounded-full ${getStateColor(entity.state)} bg-current`} />
                    <span className="text-white/60 truncate max-w-[80px]">
                      {(entity.attributes?.friendly_name as string) || entity.entity_id.split('.')[1]?.replace(/_/g, ' ')}
                    </span>
                    {entity.state !== 'on' && entity.state !== 'off' && (
                      <span className="text-white/30">{entity.state}{(entity.attributes?.unit_of_measurement as string) || ''}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        })}

        {roomEntities.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-white/40 text-xs">
            Keine Entitäten für diesen Raum
          </div>
        )}
      </div>
    </div>
  )
}
