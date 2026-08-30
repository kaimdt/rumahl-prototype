import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useDynamicOverview } from '@/contexts/DynamicOverviewContext'
import type { OverviewVariant } from '@/contexts/DynamicOverviewContext'
import { Switch } from '@/components/ui/switch'
import {
  Eye,
  EyeSlash,
  Check,
  X,
  Plus,
  Trash,
  Clock,
  Moon,
  Sun,
  CloudSun,
  CalendarBlank,
  Sparkle,
  Gauge,
} from '@phosphor-icons/react'
import { toast } from '@/lib/toast'

export function OverviewConfiguration() {
  const { enabled, setEnabled, variants, currentVariant, setActiveVariantId, activeVariantId } =
    useDynamicOverview()

  const [selectedVariant, setSelectedVariant] = useState<OverviewVariant | null>(null)

  const getVariantIcon = (variantId: string) => {
    switch (variantId) {
      case 'morning':
        return Sun
      case 'afternoon':
        return CloudSun
      case 'evening':
        return Moon
      case 'night':
        return Moon
      default:
        return Eye
    }
  }

  const handleSelectVariant = (variant: OverviewVariant) => {
    setActiveVariantId(variant.id)
    toast.success(`Übersicht gewechselt zu "${variant.name}"`)
  }

  return (
    <div className="glass-card rounded-2xl p-6 theme-transition">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h4 className="text-sm font-medium text-foreground">Dynamische Übersicht</h4>
          <p className="text-xs text-foreground/60 mt-1">
            Passe die Startseite zeitbasiert oder durch Trigger an
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} />
      </div>

      {enabled && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="space-y-4 mt-4"
        >
          {/* Current Active Variant */}
          <div className="p-4 rounded-xl bg-accent/10 border border-accent/20">
            <div className="flex items-center gap-3 mb-2">
              <Check size={20} weight="bold" className="text-accent" />
              <span className="text-sm font-medium text-foreground">
                Aktive Ansicht: {currentVariant.name}
              </span>
            </div>
            {currentVariant.description && (
              <p className="text-xs text-foreground/60 ml-8">{currentVariant.description}</p>
            )}
          </div>

          {/* Variant Selector */}
          <div>
            <h5 className="text-xs font-medium text-foreground/60 mb-3">Verfügbare Ansichten</h5>
            <div className="grid grid-cols-2 gap-3">
              {variants.map((variant) => {
                const Icon = getVariantIcon(variant.id)
                const isActive = activeVariantId === variant.id

                return (
                  <button
                    key={variant.id}
                    onClick={() => handleSelectVariant(variant)}
                    className={`p-3 rounded-xl border-2 transition-all text-left ${
                      isActive
                        ? 'border-accent bg-accent/10'
                        : 'border-foreground/10 bg-foreground/5 hover:border-foreground/20'
                    }`}
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                          isActive ? 'bg-accent/20' : 'bg-foreground/10'
                        }`}
                      >
                        <Icon
                          size={16}
                          weight="fill"
                          className={isActive ? 'text-accent' : 'text-foreground/60'}
                        />
                      </div>
                      <span className="text-sm font-medium text-foreground">{variant.name}</span>
                    </div>
                    {variant.description && (
                      <p className="text-xs text-foreground/60 line-clamp-2">
                        {variant.description}
                      </p>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Variant Configuration Preview */}
          <div>
            <h5 className="text-xs font-medium text-foreground/60 mb-3">
              Konfiguration: {currentVariant.name}
            </h5>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries({
                showGreeting: { label: 'Begrüßung', icon: Sparkle },
                showWeather: { label: 'Wetter', icon: CloudSun },
                showClock: { label: 'Uhr', icon: Clock },
                showCalendar: { label: 'Kalender', icon: CalendarBlank },
                showScenes: { label: 'Szenen', icon: Sun },
                showSensors: { label: 'Sensoren', icon: Gauge },
              }).map(([key, { label, icon: ItemIcon }]) => {
                const isEnabled =
                  currentVariant.config[key as keyof typeof currentVariant.config] !== false

                return (
                  <div
                    key={key}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg ${
                      isEnabled ? 'bg-accent/10 text-accent' : 'bg-foreground/5 text-foreground/40'
                    }`}
                  >
                    {isEnabled ? (
                      <Eye size={14} weight="fill" />
                    ) : (
                      <EyeSlash size={14} weight="fill" />
                    )}
                    <ItemIcon size={14} weight={isEnabled ? 'fill' : 'regular'} />
                    <span className="text-xs font-medium">{label}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Info Box */}
          <div className="p-3 rounded-lg bg-accent/10 border border-accent/20">
            <p className="text-xs text-foreground/80">
              <strong>Automatische Umschaltung:</strong> Die Übersicht wechselt automatisch basierend auf der Uhrzeit und konfigurierten Triggern.
              Du kannst jederzeit manuell eine andere Ansicht auswählen.
            </p>
          </div>
        </motion.div>
      )}
    </div>
  )
}
