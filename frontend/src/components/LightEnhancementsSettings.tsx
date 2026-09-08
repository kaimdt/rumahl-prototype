import { useEffect, useMemo, useState } from 'react'
import { Lightbulb, Plus, X } from '@phosphor-icons/react'
import { Switch } from '@/components/ui/switch'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { useEntityStore } from '@/hooks/useEntityStore'
import {
  getLightEnhancementSettings,
  setLightEnhancementSettings,
  type LightEnhancementSettings,
} from '@/lib/lightEnhancements'
import { toast } from '@/lib/toast'

interface LightEnhancementsSettingsProps {
  settingsLocked?: boolean
}

export function LightEnhancementsSettings({ settingsLocked = false }: LightEnhancementsSettingsProps) {
  const { entities: allEntities, refresh: refreshEntities } = useEntityStore()
  const [lightEnhancements, setLightEnhancements] = useState<LightEnhancementSettings>(() => getLightEnhancementSettings())
  const [selectedTwoZoneEntityId, setSelectedTwoZoneEntityId] = useState('')

  useEffect(() => {
    setLightEnhancementSettings(lightEnhancements)
  }, [lightEnhancements])

  const updateEnhancement = <K extends keyof LightEnhancementSettings>(
    key: K,
    value: LightEnhancementSettings[K]
  ) => {
    setLightEnhancements((prev) => ({ ...prev, [key]: value }))
  }

  const lightEntityOptions = useMemo(() => {
    return allEntities
      .filter((entity) => entity.entity_id.startsWith('light.'))
      .map((entity) => {
        const label = String(entity.attributes.friendly_name || entity.entity_id)
        return {
          value: entity.entity_id.toLowerCase(),
          label,
          description: entity.entity_id,
        }
      })
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [allEntities])

  useEffect(() => {
    if (!selectedTwoZoneEntityId && lightEntityOptions.length > 0) {
      setSelectedTwoZoneEntityId(lightEntityOptions[0].value)
    }
  }, [selectedTwoZoneEntityId, lightEntityOptions])

  const addTwoZoneEntity = () => {
    if (!selectedTwoZoneEntityId) return
    const alreadyIncluded = lightEnhancements.twoZoneSyncEntityIds.includes(selectedTwoZoneEntityId)
    if (alreadyIncluded) {
      toast('Lampe ist bereits in der 2-Zonen-Liste')
      return
    }

    updateEnhancement('twoZoneSyncEntityIds', [...lightEnhancements.twoZoneSyncEntityIds, selectedTwoZoneEntityId])
    toast.success('Lampe fuer 2-Zonen Sync hinzugefuegt')
  }

  const removeTwoZoneEntity = (entityId: string) => {
    updateEnhancement(
      'twoZoneSyncEntityIds',
      lightEnhancements.twoZoneSyncEntityIds.filter((id) => id !== entityId)
    )
  }

  return (
    <div className="space-y-4">
      <div className="glass-card rounded-2xl p-6 theme-transition">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
              <Lightbulb size={16} weight="fill" className="text-accent" />
              Lampen-Extras
            </h4>
            <p className="text-xs text-foreground/60 mt-1">
              Erweiterte Light-Funktionen fuer Gruppen und Modals. Diese Einstellungen gelten global fuer alle Benutzer.
            </p>
          </div>
          <button
            type="button"
            onClick={() => refreshEntities()}
            className="px-2.5 py-1.5 rounded-lg text-[11px] border border-foreground/12 bg-foreground/5 hover:bg-foreground/10 transition-colors disabled:opacity-50"
            disabled={settingsLocked}
          >
            Entities neu laden
          </button>
        </div>

        <div className="grid gap-3">
          <div className="rounded-xl border border-foreground/10 bg-gradient-to-br from-foreground/6 to-foreground/3 p-3 space-y-2.5">
            <p className="text-[11px] font-semibold text-foreground/70 uppercase tracking-wide">Anzeige & Navigation</p>

            <label className="flex items-center justify-between gap-3 rounded-lg border border-foreground/10 bg-background/30 px-3 py-2.5">
              <span className="text-xs text-foreground/75">Untermodal Navigation oben als Icons (links Pfeil, rechts X)</span>
              <Switch
                checked={lightEnhancements.showSubModalNavButtons}
                onCheckedChange={(checked) => updateEnhancement('showSubModalNavButtons', checked)}
                disabled={settingsLocked}
              />
            </label>

            <label className="flex items-center justify-between gap-3 rounded-lg border border-foreground/10 bg-background/30 px-3 py-2.5">
              <span className="text-xs text-foreground/75">RGB HEX bei Einzellichtern in Gruppen anzeigen</span>
              <Switch
                checked={lightEnhancements.showRgbHexInGroupMembers}
                onCheckedChange={(checked) => updateEnhancement('showRgbHexInGroupMembers', checked)}
                disabled={settingsLocked}
              />
            </label>

            <label className="flex items-center justify-between gap-3 rounded-lg border border-foreground/10 bg-background/30 px-3 py-2.5">
              <span className="text-xs text-foreground/75">Entity-ID im Light-Modal anzeigen</span>
              <Switch
                checked={lightEnhancements.showEntityIdInLightModal}
                onCheckedChange={(checked) => updateEnhancement('showEntityIdInLightModal', checked)}
                disabled={settingsLocked}
              />
            </label>
          </div>

          <div className="rounded-xl border border-accent/30 bg-gradient-to-br from-accent/12 to-accent/5 p-3 space-y-3">
            <label className="flex items-center justify-between gap-3 rounded-lg border border-accent/35 bg-background/35 px-3 py-2.5">
              <span className="text-xs font-medium text-foreground/85">2-Zonen Sync aktivieren (Farbtemperatur + RGB)</span>
              <Switch
                checked={lightEnhancements.enableTwoZoneSyncOnColorTemp}
                onCheckedChange={(checked) => updateEnhancement('enableTwoZoneSyncOnColorTemp', checked)}
                disabled={settingsLocked}
              />
            </label>

            <p className="text-xs text-foreground/70">
              Farbtemperatur wird zuerst gesetzt, RGB wird danach separat angenaehert. Wenn keine Lampen ausgewaehlt sind, gilt es fuer alle Lights.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
              <SearchableSelect
                value={selectedTwoZoneEntityId}
                onValueChange={setSelectedTwoZoneEntityId}
                placeholder="Lampe fuer 2-Zonen Sync waehlen"
                searchPlaceholder="Licht-Entity suchen..."
                emptyMessage="Keine Light-Entities gefunden"
                options={lightEntityOptions}
                disabled={settingsLocked || lightEntityOptions.length === 0}
              />
              <button
                type="button"
                onClick={addTwoZoneEntity}
                className="h-9 px-3 rounded-xl border border-accent/35 bg-accent/15 hover:bg-accent/22 text-xs font-medium text-accent transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                disabled={settingsLocked || !selectedTwoZoneEntityId}
              >
                <Plus size={12} weight="bold" />
                Hinzufuegen
              </button>
            </div>

            <div className="rounded-lg border border-foreground/10 bg-background/35 p-2.5">
              <p className="text-[11px] text-foreground/55 mb-2">
                Aktive 2-Zonen Lampen: {lightEnhancements.twoZoneSyncEntityIds.length}
              </p>
              {lightEnhancements.twoZoneSyncEntityIds.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {lightEnhancements.twoZoneSyncEntityIds.map((entityId) => {
                    const match = lightEntityOptions.find((option) => option.value === entityId)
                    return (
                      <div
                        key={entityId}
                        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border border-foreground/12 bg-foreground/6"
                      >
                        <span className="text-[11px] text-foreground/80">
                          {match?.label || entityId}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeTwoZoneEntity(entityId)}
                          className="text-foreground/50 hover:text-foreground/90 transition-colors"
                          disabled={settingsLocked}
                          aria-label={`Entferne ${entityId}`}
                        >
                          <X size={11} weight="bold" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-xs text-foreground/45">Noch keine Lampen ausgewaehlt.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
