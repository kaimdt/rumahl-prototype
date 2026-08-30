import { motion, AnimatePresence } from 'motion/react'
import { X, Plus, Check } from '@phosphor-icons/react'
import { useEntityDiscovery } from '@/contexts/EntityDiscoveryContext'
import { toast } from '@/lib/toast'

export function EntityDiscoveryNotification() {
  const { newEntities, acknowledgeEntity, acknowledgeAll } = useEntityDiscovery()

  if (newEntities.length === 0) return null

  const handleAcknowledgeAll = () => {
    acknowledgeAll()
    toast.success(`${newEntities.length} neue Entität${newEntities.length > 1 ? 'en' : ''} bestätigt`)
  }

  const handleAcknowledgeSingle = (entity_id: string, friendly_name: string) => {
    acknowledgeEntity(entity_id)
    toast.success(`${friendly_name} bestätigt`)
  }

  const domainLabels: Record<string, string> = {
    light: 'Licht',
    switch: 'Schalter',
    sensor: 'Sensor',
    climate: 'Klima',
    weather: 'Wetter',
    media_player: 'Media Player',
    cover: 'Rollladen',
    lock: 'Schloss',
    camera: 'Kamera',
    binary_sensor: 'Binärer Sensor',
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -20, scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        className="fixed top-20 left-1/2 -translate-x-1/2 z-40 w-full max-w-md px-4"
      >
        <div className="glass-card rounded-2xl p-4 shadow-2xl border border-white/10 relative overflow-hidden">
          {/* Subtle ambient glow */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: 'radial-gradient(ellipse at 50% 0%, oklch(from var(--accent) l c h / 0.06) 0%, transparent 60%)' }}
          />
          
          <div className="relative flex items-start justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-accent status-dot" />
              <h3 className="font-medium text-foreground">
                {newEntities.length} neue Entität{newEntities.length > 1 ? 'en' : ''} gefunden
              </h3>
            </div>
            <button
              onClick={handleAcknowledgeAll}
              className="text-xs px-2.5 py-1.5 rounded-lg bg-accent/20 text-accent hover:bg-accent/30 transition-all duration-200 flex items-center gap-1 hover:scale-105 active:scale-95"
            >
              <Check size={14} weight="bold" />
              Alle bestätigen
            </button>
          </div>

          <div className="relative space-y-1.5 max-h-64 overflow-y-auto">
            {newEntities.slice(0, 5).map((entity, idx) => (
              <motion.div
                key={entity.entity_id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.05 }}
                className="flex items-center justify-between p-2.5 rounded-xl bg-background/30 hover:bg-background/50 transition-all duration-200"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center flex-shrink-0 border border-accent/10">
                    <Plus size={16} weight="bold" className="text-accent" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">
                      {entity.friendly_name}
                    </p>
                    <p className="text-xs text-foreground/60">
                      {domainLabels[entity.domain] || entity.domain}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => handleAcknowledgeSingle(entity.entity_id, entity.friendly_name)}
                  className="p-1.5 rounded-lg hover:bg-accent/15 text-foreground/60 hover:text-accent transition-all duration-200 flex-shrink-0 hover:scale-110 active:scale-90"
                  aria-label="Bestätigen"
                >
                  <Check size={16} weight="bold" />
                </button>
              </motion.div>
            ))}
            {newEntities.length > 5 && (
              <p className="text-xs text-foreground/60 text-center py-2">
                ... und {newEntities.length - 5} weitere
              </p>
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
