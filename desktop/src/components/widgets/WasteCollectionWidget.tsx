import { motion } from 'framer-motion'
import { Recycle, Trash, Leaf, Newspaper, TrashSimple, Check, X } from '@phosphor-icons/react'
import { useEntityStore } from '@/hooks/useEntityStore'
import type { EntityState } from '@/lib/types'
import { useLongPressDialog } from '@/hooks/useLongPressDialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { getModalSizeClass } from '@/lib/utils'
import { Tip } from '@/components/ui/tip'

interface WasteType {
  id: string
  label: string
  icon: typeof Trash
  activeColor: string
  bgColor: string
  keywords: string[]
}

const DEFAULT_WASTE_TYPES: WasteType[] = [
  { id: 'restmuell', label: 'Restmüll', icon: Trash, activeColor: 'text-green-400', bgColor: 'bg-green-500/20', keywords: ['restmüll', 'restmuell', 'residual', 'general waste'] },
  { id: 'gelbe_tonne', label: 'Gelbe Tonne', icon: Recycle, activeColor: 'text-indigo-400', bgColor: 'bg-indigo-500/20', keywords: ['gelbe', 'yellow', 'recycling', 'verpackung', 'packaging'] },
  { id: 'bio', label: 'Biotonne', icon: Leaf, activeColor: 'text-amber-700', bgColor: 'bg-amber-700/20', keywords: ['bio', 'organic', 'kompost', 'compost'] },
  { id: 'papier', label: 'Papiertonne', icon: Newspaper, activeColor: 'text-blue-400', bgColor: 'bg-blue-500/20', keywords: ['papier', 'paper', 'karton', 'cardboard'] },
]

function matchesWasteType(sensorValue: string, keywords: string[]): boolean {
  const lower = sensorValue.toLowerCase()
  return keywords.some(kw => lower.includes(kw.toLowerCase()))
}

function getNextCollectionText(sensorValue: string): string {
  if (!sensorValue || sensorValue === 'unavailable' || sensorValue === 'unknown') return ''
  if (sensorValue.includes('0 day') || sensorValue.toLowerCase().includes('heute') || sensorValue.toLowerCase().includes('today')) return 'Heute'
  if (sensorValue.includes('1 day') || sensorValue.toLowerCase().includes('morgen') || sensorValue.toLowerCase().includes('tomorrow')) return 'Morgen'
  return sensorValue
}

interface WasteCollectionWidgetProps {
  config?: Record<string, unknown>
}

export default function WasteCollectionWidget({ config }: WasteCollectionWidgetProps) {
  const { entities } = useEntityStore()

  // Find configured entity or auto-detect waste-related sensors
  const primaryEntityId = config?.entityId as string | undefined
  const primaryEntity = primaryEntityId
    ? entities.find(e => e.entity_id === primaryEntityId)
    : null

  // Auto-detect all waste-related sensors
  const wasteSensors = entities.filter(e => {
    const id = e.entity_id.toLowerCase()
    const name = ((e.attributes?.friendly_name as string) || '').toLowerCase()
    return (
      id.includes('waste') || id.includes('muell') || id.includes('müll') ||
      id.includes('abfall') || id.includes('tonne') || id.includes('garbage') ||
      id.includes('recycl') || id.includes('bio_tonne') || id.includes('papier') ||
      name.includes('müll') || name.includes('abfall') || name.includes('tonne') ||
      name.includes('waste') || name.includes('garbage') || name.includes('bin collection')
    )
  })

  // Use configured entity or the "all waste types" sensor
  const allWasteEntity: EntityState | undefined = primaryEntity
    || wasteSensors.find(e =>
      e.entity_id.includes('all_waste') || e.entity_id.includes('next_collection') ||
      ((e.attributes?.friendly_name as string) || '').toLowerCase().includes('all')
    )
    || wasteSensors[0]

  const allWasteState = allWasteEntity?.state || ''
  const nextCollection = getNextCollectionText(allWasteState)

  // Custom waste type config or defaults
  const configuredTypes = (config?.wasteTypes as WasteType[] | undefined) || DEFAULT_WASTE_TYPES

  // Check which waste types are active
  const wasteTypesWithStatus = configuredTypes.map(wt => {
    // Check explicit entity mapping first
    const explicitEntityId = (config as Record<string, unknown>)?.[`entity_${wt.id}`] as string | undefined
    const explicitEntity = explicitEntityId ? entities.find(e => e.entity_id === explicitEntityId) : null

    let isActive = false
    if (explicitEntity) {
      isActive = explicitEntity.state !== 'off' && explicitEntity.state !== '0' && explicitEntity.state !== 'unavailable'
    } else {
      // Match against the combined waste state
      isActive = matchesWasteType(allWasteState, wt.keywords)
    }

    return { ...wt, isActive }
  })

  const title = (config?.title as string) || 'Müllabfuhr'
  const isUrgent = allWasteState.includes('0 day') || allWasteState.toLowerCase().includes('heute') || allWasteState.toLowerCase().includes('today')
  const { dialogOpen, setDialogOpen, longPressHandlers } = useLongPressDialog()

  return (
    <>
    <motion.div {...longPressHandlers} className="glass-card glass-card-shimmer rounded-2xl theme-transition relative overflow-hidden h-full" whileTap={{ scale: 0.98 }} transition={{ type: 'spring', stiffness: 400, damping: 25 }}>
    <div className="flex flex-col gap-2.5 p-3 h-full">
      {/* Header */}
      <div className="flex items-center gap-2">
        <TrashSimple size={16} weight="fill" className={isUrgent ? 'text-amber-400 animate-pulse' : 'text-blue-400'} />
        <span className="text-xs font-medium text-foreground/80">{title}</span>
        {nextCollection && (
          <span className={`ml-auto text-[10px] font-medium px-2 py-0.5 rounded-full ${
            isUrgent ? 'bg-amber-500/20 text-amber-400' : 'bg-foreground/8 text-foreground/50'
          }`}>
            {nextCollection}
          </span>
        )}
      </div>

      {/* Secondary info */}
      {allWasteEntity && !nextCollection && (
        <p className="text-[11px] text-foreground/50 leading-snug line-clamp-2">
          {allWasteState}
        </p>
      )}

      {/* Waste type chips */}
      <div className="flex flex-wrap gap-1.5 mt-auto">
        {wasteTypesWithStatus.map(wt => {
          const Icon = wt.icon
          return (
            <Tip content={wt.label}>
              <div
                key={wt.id}
                className={`relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl transition-all ${
                  wt.isActive ? wt.bgColor : 'bg-foreground/5'
                }`}
              >
              <Icon
                size={16}
                weight={wt.isActive ? 'fill' : 'regular'}
                className={wt.isActive ? wt.activeColor : 'text-foreground/25'}
              />
              <span className={`text-[10px] font-medium ${
                wt.isActive ? wt.activeColor : 'text-foreground/30'
              }`}>
                {wt.label}
              </span>
              {/* Status badge */}
              <span className={`absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full flex items-center justify-center ${
                wt.isActive ? 'bg-green-500' : 'bg-foreground/15'
              }`}>
                {wt.isActive
                  ? <Check size={8} weight="bold" className="text-white" />
                  : <X size={8} weight="bold" className="text-foreground/30" />
                }
              </span>
            </div>
            </Tip>
          )
        })}
      </div>

      {/* Empty state */}
      {wasteSensors.length === 0 && !primaryEntity && (
        <div className="flex-1 flex flex-col items-center justify-center text-foreground/30 text-xs gap-1 py-2">
          <TrashSimple size={24} className="text-foreground/15" />
          <span>Keine Müllsensoren</span>
          <span className="text-[9px] text-foreground/20">sensor.all_waste_types konfigurieren</span>
        </div>
      )}
    </div>
    </motion.div>

    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent className={`${getModalSizeClass(config?.modalSize as string | undefined)} glass-card border-foreground/10 p-0 gap-0 bg-card/95 backdrop-blur-2xl overflow-y-auto overflow-x-hidden`}>
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {/* Header */}
        <div className="relative flex items-center gap-3 px-5 pt-5 pb-3">
          <div className="p-2 rounded-xl bg-blue-500/15">
            <TrashSimple size={20} weight="fill" className={isUrgent ? 'text-amber-400' : 'text-blue-400'} />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            {nextCollection && (
              <p className={`text-xs ${isUrgent ? 'text-amber-400 font-medium' : 'text-foreground/50'}`}>
                Nächste Abholung: {nextCollection}
              </p>
            )}
          </div>
        </div>

        {/* All waste type details */}
        <div className="px-5 pb-5 space-y-2">
          {wasteTypesWithStatus.map(wt => {
            const Icon = wt.icon
            return (
              <div
                key={wt.id}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all ${
                  wt.isActive
                    ? `${wt.bgColor} border-foreground/10`
                    : 'bg-foreground/[0.03] border-foreground/8'
                }`}
              >
                <Icon
                  size={20}
                  weight={wt.isActive ? 'fill' : 'regular'}
                  className={wt.isActive ? wt.activeColor : 'text-foreground/25'}
                />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${wt.isActive ? 'text-foreground' : 'text-foreground/50'}`}>{wt.label}</p>
                </div>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center ${
                  wt.isActive ? 'bg-green-500' : 'bg-foreground/15'
                }`}>
                  {wt.isActive
                    ? <Check size={10} weight="bold" className="text-white" />
                    : <X size={10} weight="bold" className="text-foreground/30" />
                  }
                </span>
              </div>
            )
          })}

          {/* Detected sensors */}
          {wasteSensors.length > 0 && (
            <div className="mt-3 pt-3 border-t border-foreground/8">
              <p className="text-[11px] text-foreground/40 font-medium mb-2">Erkannte Sensoren</p>
              <div className="space-y-1">
                {wasteSensors.map(s => (
                  <div key={s.entity_id} className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-foreground/[0.03]">
                    <span className="text-[11px] text-foreground/60 truncate">{(s.attributes?.friendly_name as string) || s.entity_id}</span>
                    <span className="text-[10px] text-foreground/40 font-mono ml-2 shrink-0">{s.state}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
    </>
  )
}
