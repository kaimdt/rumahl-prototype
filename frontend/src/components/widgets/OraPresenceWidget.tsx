import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { House, MapPin, User, Users } from '@phosphor-icons/react'
import { useEntityStore } from '@/hooks/useEntityStore'
import { toBackendImageUrl } from '@/lib/imageUrl'

/**
 * ORA presence widget — who is home (Home Dashboard v2, Package 3).
 *
 * Aggregates Home Assistant `person` / `device_tracker` entities into a
 * single "Presence" dashboard card. HA remains the source of truth for
 * smart-home state; this widget just surfaces it.
 */

interface PresencePerson {
  entityId: string
  name: string
  state: string
  picture?: string
}

export function OraPresenceWidget({ config }: { config?: Record<string, unknown> }) {
  const { t } = useTranslation()
  const { entities } = useEntityStore()

  const people = useMemo<PresencePerson[]>(() => {
    const list = (entities || [])
      .filter((entity) => entity.entity_id.startsWith('person.') || entity.entity_id.startsWith('device_tracker.'))
      .map((entity) => ({
        entityId: entity.entity_id,
        name: (entity.attributes.friendly_name as string) || entity.entity_id.split('.').pop() || entity.entity_id,
        state: entity.state,
        picture: toBackendImageUrl(entity.attributes.entity_picture as string | undefined) || undefined,
      }))
    // Prefer person.* over device_tracker.* duplicates by name.
    const seen = new Set<string>()
    const unique: PresencePerson[] = []
    for (const person of [...list.filter((p) => p.entityId.startsWith('person.')), ...list.filter((p) => !p.entityId.startsWith('person.'))]) {
      if (seen.has(person.name)) continue
      seen.add(person.name)
      unique.push(person)
    }
    return unique.slice(0, 6)
  }, [entities])

  const homeCount = people.filter((person) => person.state === 'home').length
  const limit = ((config?.limit as number) || 6) > 0 ? (config?.limit as number) || 6 : 6

  return (
    <div className="glass-card h-full w-full rounded-3xl border border-white/8 bg-foreground/4 p-4">
      <div className="flex items-center gap-2">
        <Users size={16} className="text-accent" />
        <span className="text-xs font-semibold uppercase tracking-wide text-foreground/60">{t('widgets.oraPresence.title')}</span>
        {people.length > 0 && (
          <span className="ml-auto rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-bold text-accent">
            {homeCount}/{people.length} {t('widgets.oraPresence.home')}
          </span>
        )}
      </div>
      <div className="mt-2 space-y-1.5">
        {people.slice(0, limit).map((person) => {
          const isHome = person.state === 'home'
          return (
            <div key={person.entityId} className="flex items-center gap-2">
              {person.picture ? (
                <img src={person.picture} alt="" className="size-6 shrink-0 rounded-full border border-white/10 object-cover" />
              ) : (
                <span className={`grid size-6 shrink-0 place-items-center rounded-full ${isHome ? 'bg-accent/20 text-accent' : 'bg-foreground/8 text-foreground/40'}`}>
                  <User size={12} weight={isHome ? 'fill' : 'regular'} />
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-xs text-foreground/80">{person.name}</span>
              <span className={`flex shrink-0 items-center gap-1 text-[10px] ${isHome ? 'text-accent' : 'text-foreground/40'}`}>
                {isHome ? <House size={11} weight="fill" /> : <MapPin size={11} />}
                {isHome ? t('widgets.oraPresence.atHome') : person.state === 'not_home' ? t('widgets.oraPresence.away') : person.state}
              </span>
            </div>
          )
        })}
        {people.length === 0 && <p className="py-3 text-center text-xs text-foreground/40">{t('widgets.oraPresence.empty')}</p>}
      </div>
    </div>
  )
}
