import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  Plus,
  Trash,
  Minus,
  ArrowsOutCardinal,
  CaretDown,
  CaretUp,
  TextAlignLeft,
  TextAlignCenter,
  TextAlignRight,
  MagnifyingGlass,
  DotsSixVertical,
  MapPin,
} from '@phosphor-icons/react'
import { useDraggable } from '@dnd-kit/core'
import {
  WIDGET_CATEGORIES,
  WIDGET_SUBCATEGORIES,
  getWidgetDef,
  getWidgetsByCategory,
  getWidgetsBySubcategory,
  type WidgetSubcategory,
  type WidgetDefinition,
} from '@/lib/widgetRegistry'
import type { DashboardWidget, EntityState, WidgetType } from '@/lib/types'
import { SearchableSelect } from '@/components/ui/searchable-select'

type VisibilityMode =
  | 'always'
  | 'when_music_playing'
  | 'when_evening'
  | 'when_night'
  | 'when_entity_state'
  | 'when_entity_not_state'
  | 'when_entity_state_in'
  | 'when_entity_numeric'
  | 'when_time_between'
  | 'when_weekday'
  | 'when_recently_changed'

type NumericOperator = 'lt' | 'lte' | 'eq' | 'gte' | 'gt'

interface VisibilityConditionRule {
  mode?: VisibilityMode
  entityId?: string
  state?: string
  states?: string
  numericOperator?: NumericOperator
  numericValue?: number | string
  startTime?: string
  endTime?: string
  weekdays?: number[]
  changedWithinMinutes?: number | string
}

const VISIBILITY_MODES: Array<{ key: VisibilityMode; label: string }> = [
  { key: 'always', label: 'Immer' },
  { key: 'when_music_playing', label: 'Wenn Musik' },
  { key: 'when_evening', label: 'Abends' },
  { key: 'when_night', label: 'Nachts' },
  { key: 'when_entity_state', label: 'Entity-State' },
  { key: 'when_entity_not_state', label: 'Entity NICHT' },
  { key: 'when_entity_state_in', label: 'Entity in Liste' },
  { key: 'when_entity_numeric', label: 'Entity Vergleich' },
  { key: 'when_recently_changed', label: 'Zuletzt geaendert' },
  { key: 'when_time_between', label: 'Zeitfenster' },
  { key: 'when_weekday', label: 'Wochentage' },
]

const WEEKDAY_OPTIONS = [
  { d: 1, l: 'Mo' },
  { d: 2, l: 'Di' },
  { d: 3, l: 'Mi' },
  { d: 4, l: 'Do' },
  { d: 5, l: 'Fr' },
  { d: 6, l: 'Sa' },
  { d: 0, l: 'So' },
]

interface WidgetPaletteProps {
  selectedWidget: DashboardWidget | undefined
  availableEntities: EntityState[]
  allWidgets: DashboardWidget[]
  gridCols: number
  onAddWidget: (type: WidgetType, entityId?: string) => void
  onUpdateWidget: (widgetId: string, updates: Partial<DashboardWidget>) => void
  onResizeWidget: (widgetId: string, dimension: 'w' | 'h', delta: number) => void
  onDeleteWidget: (widgetId: string) => void
  onMoveWidget?: (widgetId: string, col: number, row: number) => void
  onOpenWidgetGroupDesigner?: (widgetId: string) => void
}

// Draggable wrapper for palette widget items
function DraggablePaletteItem({
  def,
  onAdd,
}: {
  def: WidgetDefinition
  onAdd: () => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette-${def.type}`,
    data: { origin: 'palette', widgetType: def.type },
  })

  const Icon = def.icon

  return (
    <div
      ref={setNodeRef}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-foreground/5 transition-colors group ${isDragging ? 'opacity-50' : ''}`}
    >
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing p-0.5 rounded hover:bg-foreground/10 opacity-0 group-hover:opacity-60 transition-opacity shrink-0"
        title="Zum Canvas ziehen"
      >
        <DotsSixVertical size={12} weight="bold" className="text-foreground/40" />
      </div>
      <div className="w-7 h-7 rounded-md bg-foreground/5 flex items-center justify-center shrink-0">
        <Icon size={14} weight="fill" className="text-foreground/50" />
      </div>
      <span className="text-xs font-medium text-foreground/70 flex-1">{def.label}</span>
      <button
        onClick={onAdd}
        className="p-1 rounded-md hover:bg-accent/10 text-foreground/30 hover:text-accent transition-colors opacity-0 group-hover:opacity-100"
      >
        <Plus size={14} weight="bold" />
      </button>
    </div>
  )
}

function SubcategorySection({
  subcategory,
  availableEntities,
  onAddWidget,
  searchQuery,
}: {
  subcategory: WidgetSubcategory
  availableEntities: EntityState[]
  onAddWidget: (type: WidgetType, entityId?: string) => void
  searchQuery: string
}) {
  const [expanded, setExpanded] = useState(true)
  const [addingType, setAddingType] = useState<WidgetType | null>(null)
  const [selectedEntity, setSelectedEntity] = useState('')

  const subcategoryInfo = WIDGET_SUBCATEGORIES[subcategory]
  let definitions = getWidgetsBySubcategory(subcategory)

  if (searchQuery) {
    definitions = definitions.filter(d =>
      d.label.toLowerCase().includes(searchQuery.toLowerCase())
    )
  }

  if (definitions.length === 0) return null

  const getEntitiesForType = (type: WidgetType) => {
    const def = getWidgetDef(type)
    if (!def?.entityDomain) return []
    return availableEntities.filter(e => e.entity_id.startsWith(`${def.entityDomain}.`))
  }

  const handleAdd = (type: WidgetType) => {
    const def = getWidgetDef(type)
    if (def?.requiresEntity) {
      if (addingType === type) {
        setAddingType(null)
        setSelectedEntity('')
      } else {
        setAddingType(type)
        setSelectedEntity('')
      }
    } else {
      onAddWidget(type)
    }
  }

  const handleConfirmAdd = () => {
    if (addingType && selectedEntity) {
      onAddWidget(addingType, selectedEntity)
      setAddingType(null)
      setSelectedEntity('')
    }
  }

  return (
    <div className="space-y-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full px-3 py-1.5 text-xs font-semibold text-foreground/50 hover:text-foreground/70 transition-colors"
      >
        {subcategoryInfo.label}
        {expanded ? <CaretUp size={12} /> : <CaretDown size={12} />}
      </button>
      {expanded && (
        <div className="space-y-0.5">
          {definitions.map((def) => {
            return (
              <div key={def.type}>
                <DraggablePaletteItem def={def} onAdd={() => handleAdd(def.type)} />
                {/* Inline entity picker */}
                {addingType === def.type && def.requiresEntity && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    className="px-3 pb-2 overflow-hidden"
                  >
                    <SearchableSelect
                      value={selectedEntity}
                      onValueChange={setSelectedEntity}
                      placeholder="-- Entity wählen --"
                      searchPlaceholder="Entity suchen..."
                      emptyMessage="Keine Entities gefunden."
                      options={getEntitiesForType(def.type).map(entity => ({
                        value: entity.entity_id,
                        label: (entity.attributes?.friendly_name as string) || entity.entity_id,
                        description: entity.entity_id,
                      }))}
                    />
                    <button
                      onClick={handleConfirmAdd}
                      disabled={!selectedEntity}
                      className="mt-1.5 w-full py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      Hinzufügen
                    </button>
                  </motion.div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function CategorySection({
  category,
  availableEntities,
  onAddWidget,
  searchQuery,
}: {
  category: 'entity' | 'standalone' | 'layout'
  availableEntities: EntityState[]
  onAddWidget: (type: WidgetType, entityId?: string) => void
  searchQuery: string
}) {
  const [expanded, setExpanded] = useState(true)
  const [addingType, setAddingType] = useState<WidgetType | null>(null)
  const [selectedEntity, setSelectedEntity] = useState('')

  let definitions = getWidgetsByCategory(category)
  const categoryInfo = WIDGET_CATEGORIES[category]

  if (searchQuery) {
    definitions = definitions.filter(d =>
      d.label.toLowerCase().includes(searchQuery.toLowerCase())
    )
  }

  if (definitions.length === 0) return null

  const getEntitiesForType = (type: WidgetType) => {
    const def = getWidgetDef(type)
    if (!def?.entityDomain) return []
    return availableEntities.filter(e => e.entity_id.startsWith(`${def.entityDomain}.`))
  }

  const handleAdd = (type: WidgetType) => {
    const def = getWidgetDef(type)
    if (def?.requiresEntity) {
      if (addingType === type) {
        setAddingType(null)
        setSelectedEntity('')
      } else {
        setAddingType(type)
        setSelectedEntity('')
      }
    } else {
      onAddWidget(type)
    }
  }

  const handleConfirmAdd = () => {
    if (addingType && selectedEntity) {
      onAddWidget(addingType, selectedEntity)
      setAddingType(null)
      setSelectedEntity('')
    }
  }

  return (
    <div className="space-y-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full px-3 py-1.5 text-xs font-semibold text-foreground/50 hover:text-foreground/70 transition-colors"
      >
        {categoryInfo.label}
        {expanded ? <CaretUp size={12} /> : <CaretDown size={12} />}
      </button>
      {expanded && (
        <div className="space-y-0.5">
          {definitions.map((def) => {
            return (
              <div key={def.type}>
                <DraggablePaletteItem def={def} onAdd={() => handleAdd(def.type)} />
                {/* Inline entity picker */}
                {addingType === def.type && def.requiresEntity && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    className="px-3 pb-2 overflow-hidden"
                  >
                    <SearchableSelect
                      value={selectedEntity}
                      onValueChange={setSelectedEntity}
                      placeholder="-- Entity wählen --"
                      searchPlaceholder="Entity suchen..."
                      emptyMessage="Keine Entities gefunden."
                      options={getEntitiesForType(def.type).map(entity => ({
                        value: entity.entity_id,
                        label: (entity.attributes?.friendly_name as string) || entity.entity_id,
                        description: entity.entity_id,
                      }))}
                    />
                    <button
                      onClick={handleConfirmAdd}
                      disabled={!selectedEntity}
                      className="mt-1.5 w-full py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      Hinzufügen
                    </button>
                  </motion.div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function WidgetProperties({
  widget,
  availableEntities,
  allWidgets,
  gridCols,
  onUpdateWidget,
  onResizeWidget,
  onDeleteWidget,
  onMoveWidget,
  onOpenWidgetGroupDesigner,
}: {
  widget: DashboardWidget
  availableEntities: EntityState[]
  allWidgets: DashboardWidget[]
  onUpdateWidget: (widgetId: string, updates: Partial<DashboardWidget>) => void
  onResizeWidget: (widgetId: string, dimension: 'w' | 'h', delta: number) => void
  onDeleteWidget: (widgetId: string) => void
  onMoveWidget?: (widgetId: string, col: number, row: number) => void
  onOpenWidgetGroupDesigner?: (widgetId: string) => void
}) {
  const def = getWidgetDef(widget.type)
  if (!def) return null

  const Icon = def.icon
  const isGroupWidget = widget.type === 'widget_group'

  const getEntitiesForType = () => {
    if (!def.entityDomain) return []
    return availableEntities.filter(e => e.entity_id.startsWith(`${def.entityDomain}.`))
  }

  const visibilityConditions = Array.isArray(widget.config?.visibilityConditions)
    ? widget.config?.visibilityConditions as VisibilityConditionRule[]
    : []
  const visibilityExceptions = Array.isArray(widget.config?.visibilityExceptions)
    ? widget.config?.visibilityExceptions as VisibilityConditionRule[]
    : []
  const visibilityConditionOperator = String(widget.config?.visibilityConditionOperator || 'all') === 'any' ? 'any' : 'all'
  const visibilityExceptionOperator = String(widget.config?.visibilityExceptionOperator || 'any') === 'all' ? 'all' : 'any'

  const updateVisibilityConfig = (updates: Record<string, unknown>) => {
    onUpdateWidget(widget.id, {
      config: {
        ...widget.config,
        ...updates,
      },
    })
  }

  const addRule = (key: 'visibilityConditions' | 'visibilityExceptions') => {
    const current = key === 'visibilityConditions' ? visibilityConditions : visibilityExceptions
    const next: VisibilityConditionRule[] = [...current, { mode: 'when_entity_state' }]
    updateVisibilityConfig({ [key]: next })
  }

  const updateRule = (
    key: 'visibilityConditions' | 'visibilityExceptions',
    index: number,
    updates: Partial<VisibilityConditionRule>,
  ) => {
    const current = key === 'visibilityConditions' ? visibilityConditions : visibilityExceptions
    const next = current.map((rule, idx) => (idx === index ? { ...rule, ...updates } : rule))
    updateVisibilityConfig({ [key]: next })
  }

  const removeRule = (key: 'visibilityConditions' | 'visibilityExceptions', index: number) => {
    const current = key === 'visibilityConditions' ? visibilityConditions : visibilityExceptions
    const next = current.filter((_, idx) => idx !== index)
    updateVisibilityConfig({ [key]: next })
  }

  const renderRuleEditor = (
    rule: VisibilityConditionRule,
    key: 'visibilityConditions' | 'visibilityExceptions',
    index: number,
  ) => {
    const mode = (rule.mode || 'always') as VisibilityMode

    return (
      <div key={`${key}-${index}`} className="rounded-xl border border-foreground/10 bg-foreground/[0.03] p-2.5 space-y-2">
        <div className="flex items-center gap-2">
          <select
            value={mode}
            onChange={(e) => updateRule(key, index, { mode: e.target.value as VisibilityMode })}
            className="flex-1 px-2 py-1.5 rounded-lg bg-foreground/5 border border-foreground/10 text-foreground text-xs"
          >
            {VISIBILITY_MODES.map(({ key: modeKey, label }) => (
              <option key={modeKey} value={modeKey}>{label}</option>
            ))}
          </select>
          <button
            onClick={() => removeRule(key, index)}
            className="p-1.5 rounded-md hover:bg-red-500/10 text-red-400/80 hover:text-red-400"
            title="Regel entfernen"
          >
            <Trash size={13} weight="bold" />
          </button>
        </div>

        {(['when_entity_state', 'when_entity_not_state', 'when_entity_state_in', 'when_entity_numeric', 'when_recently_changed'] as const).includes(mode) && (
          <SearchableSelect
            value={rule.entityId || ''}
            onValueChange={(value) => updateRule(key, index, { entityId: value })}
            placeholder="Entity fuer Bedingung"
            searchPlaceholder="Entity suchen..."
            emptyMessage="Keine Entities gefunden."
            options={availableEntities.map(entity => ({
              value: entity.entity_id,
              label: (entity.attributes?.friendly_name as string) || entity.entity_id,
              description: entity.entity_id,
            }))}
          />
        )}

        {(['when_entity_state', 'when_entity_not_state'] as const).includes(mode) && (
          <input
            type="text"
            value={rule.state || ''}
            onChange={(e) => updateRule(key, index, { state: e.target.value })}
            placeholder="State z.B. on, off, playing"
            className="w-full px-2.5 py-2 rounded-xl bg-foreground/5 border border-foreground/10 text-foreground text-xs"
          />
        )}

        {mode === 'when_entity_state_in' && (
          <input
            type="text"
            value={rule.states || ''}
            onChange={(e) => updateRule(key, index, { states: e.target.value })}
            placeholder="Mehrere States, z.B. on, playing, heat"
            className="w-full px-2.5 py-2 rounded-xl bg-foreground/5 border border-foreground/10 text-foreground text-xs"
          />
        )}

        {mode === 'when_entity_numeric' && (
          <div className="grid grid-cols-2 gap-2">
            <select
              value={(rule.numericOperator as string) || 'gte'}
              onChange={(e) => updateRule(key, index, { numericOperator: e.target.value as NumericOperator })}
              className="w-full px-2.5 py-2 rounded-xl bg-foreground/5 border border-foreground/10 text-foreground text-xs"
            >
              <option value="lt">&lt; kleiner</option>
              <option value="lte">&lt;= kleiner/gleich</option>
              <option value="eq">= gleich</option>
              <option value="gte">&gt;= groesser/gleich</option>
              <option value="gt">&gt; groesser</option>
            </select>
            <input
              type="number"
              value={rule.numericValue ?? ''}
              onChange={(e) => updateRule(key, index, { numericValue: e.target.value === '' ? '' : Number(e.target.value) })}
              placeholder="Schwellwert"
              className="w-full px-2.5 py-2 rounded-xl bg-foreground/5 border border-foreground/10 text-foreground text-xs"
            />
          </div>
        )}

        {mode === 'when_recently_changed' && (
          <input
            type="number"
            min={1}
            value={rule.changedWithinMinutes ?? 10}
            onChange={(e) => updateRule(key, index, { changedWithinMinutes: e.target.value === '' ? '' : Number(e.target.value) })}
            placeholder="Minuten"
            className="w-full px-2.5 py-2 rounded-xl bg-foreground/5 border border-foreground/10 text-foreground text-xs"
          />
        )}

        {mode === 'when_time_between' && (
          <div className="grid grid-cols-2 gap-2">
            <input
              type="time"
              value={rule.startTime || '18:00'}
              onChange={(e) => updateRule(key, index, { startTime: e.target.value })}
              className="w-full px-2.5 py-2 rounded-xl bg-foreground/5 border border-foreground/10 text-foreground text-xs"
            />
            <input
              type="time"
              value={rule.endTime || '06:00'}
              onChange={(e) => updateRule(key, index, { endTime: e.target.value })}
              className="w-full px-2.5 py-2 rounded-xl bg-foreground/5 border border-foreground/10 text-foreground text-xs"
            />
          </div>
        )}

        {mode === 'when_weekday' && (
          <div className="grid grid-cols-4 gap-1.5">
            {WEEKDAY_OPTIONS.map(({ d, l }) => {
              const selected = Array.isArray(rule.weekdays) ? rule.weekdays : []
              const isActive = selected.includes(d)
              return (
                <button
                  key={d}
                  onClick={() => {
                    const next = isActive ? selected.filter((value) => value !== d) : [...selected, d]
                    updateRule(key, index, { weekdays: next })
                  }}
                  className={`px-2 py-1.5 rounded-lg text-[11px] transition-colors ${isActive ? 'bg-accent/20 text-accent border border-accent/30' : 'bg-foreground/5 text-foreground/55 border border-foreground/10 hover:bg-foreground/10'}`}
                >
                  {l}
                </button>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4 p-4">
      {/* Widget type header */}
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
          <Icon size={16} weight="fill" className="text-accent" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">{def.label}</p>
          <p className="text-[10px] text-foreground/40">{widget.id}</p>
        </div>
      </div>

      {/* Entity selector */}
      {(def.requiresEntity || def.entityDomain) && (
        <div>
          <label className="text-xs text-foreground/50 mb-1.5 block">Entity</label>
          <SearchableSelect
            value={widget.entity_id || ''}
            onValueChange={(val) => onUpdateWidget(widget.id, { entity_id: val || undefined })}
            placeholder="-- Nicht zugewiesen --"
            searchPlaceholder="Entity suchen..."
            emptyMessage="Keine Entities gefunden."
            options={getEntitiesForType().map(entity => ({
              value: entity.entity_id,
              label: (entity.attributes?.friendly_name as string) || entity.entity_id,
              description: entity.entity_id,
            }))}
          />
        </div>
      )}

      {/* Card variant picker */}
      {def.variants && def.variants.length > 0 && (
        <div>
          <label className="text-xs text-foreground/50 mb-2 block">Variante</label>
          <div className="grid grid-cols-2 gap-1.5">
            {def.variants.map(({ key, label }) => {
              const current = (widget.config?.cardVariant as string) || def.variants![0].key
              const isActive = current === key
              return (
                <button
                  key={key}
                  onClick={() => onUpdateWidget(widget.id, {
                    config: { ...widget.config, cardVariant: key }
                  })}
                  className={`
                    px-2 py-1.5 rounded-lg text-[11px] font-medium transition-all
                    ${isActive
                      ? 'bg-accent/15 text-accent border border-accent/25'
                      : 'bg-foreground/5 text-foreground/50 border border-transparent hover:bg-foreground/10'
                    }
                  `}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Visibility rules */}
      <div>
        <label className="text-xs text-foreground/50 mb-2 block">Sichtbarkeit (Regeln)</label>

        <div className="rounded-xl border border-foreground/10 p-2.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-foreground/60">Anzeigen wenn</span>
            <div className="flex items-center gap-2">
              <select
                value={visibilityConditionOperator}
                onChange={(e) => updateVisibilityConfig({ visibilityConditionOperator: e.target.value })}
                className="px-2 py-1 rounded-md bg-foreground/5 border border-foreground/10 text-[11px]"
              >
                <option value="all">ALLE Bedingungen</option>
                <option value="any">MINDESTENS EINE</option>
              </select>
              <button
                onClick={() => addRule('visibilityConditions')}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-accent/15 text-accent text-[11px] font-medium"
              >
                <Plus size={11} weight="bold" /> Regel
              </button>
            </div>
          </div>

          {visibilityConditions.length === 0 ? (
            <p className="text-[11px] text-foreground/45">Keine Bedingungen: Widget ist standardmaessig sichtbar.</p>
          ) : (
            <div className="space-y-2">
              {visibilityConditions.map((rule, idx) => renderRuleEditor(rule, 'visibilityConditions', idx))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-foreground/10 p-2.5 space-y-2 mt-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-foreground/60">Ausser wenn</span>
            <div className="flex items-center gap-2">
              <select
                value={visibilityExceptionOperator}
                onChange={(e) => updateVisibilityConfig({ visibilityExceptionOperator: e.target.value })}
                className="px-2 py-1 rounded-md bg-foreground/5 border border-foreground/10 text-[11px]"
              >
                <option value="any">IRGENDEINE Ausnahme</option>
                <option value="all">ALLE Ausnahmen</option>
              </select>
              <button
                onClick={() => addRule('visibilityExceptions')}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-foreground/10 text-foreground/70 text-[11px] font-medium"
              >
                <Plus size={11} weight="bold" /> Ausnahme
              </button>
            </div>
          </div>

          {visibilityExceptions.length === 0 ? (
            <p className="text-[11px] text-foreground/45">Keine Ausnahmen definiert.</p>
          ) : (
            <div className="space-y-2">
              {visibilityExceptions.map((rule, idx) => renderRuleEditor(rule, 'visibilityExceptions', idx))}
            </div>
          )}
        </div>

        <p className="text-[10px] text-foreground/40 mt-2">
          Legacy-Felder bleiben kompatibel. Sobald Regeln gesetzt sind, werden diese priorisiert.
        </p>
      </div>

      {isGroupWidget && (
        <div>
          <label className="text-xs text-foreground/50 mb-1.5 block">Widgetgruppe Designer</label>
          <button
            onClick={() => onOpenWidgetGroupDesigner?.(widget.id)}
            className="w-full px-3 py-2 rounded-xl bg-accent/14 hover:bg-accent/22 text-accent text-xs font-semibold transition-colors"
          >
            Widgetgruppe bearbeiten
          </button>
        </div>
      )}

      {/* Label (for section_header, greeting) */}
      {(widget.type === 'section_header' || widget.type === 'greeting' || widget.type === 'dynamic_text' || widget.type === 'chat_card' || widget.type === 'widget_group') && (
        <div>
          <label className="text-xs text-foreground/50 mb-1.5 block">
            {widget.type === 'section_header'
              ? 'Ueberschrift'
              : widget.type === 'widget_group'
                ? 'Gruppenname'
              : widget.type === 'greeting'
                ? 'Benutzername'
                : widget.type === 'dynamic_text'
                  ? 'Fallback-Template'
                  : 'Fallback-Nachrichten'}
          </label>
          <input
            type="text"
            value={widget.label || ''}
            onChange={(e) => onUpdateWidget(widget.id, {
              label: e.target.value,
              config: widget.type === 'widget_group'
                ? { ...widget.config, groupName: e.target.value }
                : widget.config,
            })}
            placeholder={widget.type === 'section_header' ? 'Abschnitt' : widget.type === 'widget_group' ? 'Wohnzimmer Gruppe' : widget.type === 'greeting' ? 'Benutzer' : widget.type === 'dynamic_text' ? 'Hallo {user} - {time}' : 'Nachricht 1 | Nachricht 2'}
            className="w-full px-2.5 py-2 rounded-xl bg-foreground/5 border border-foreground/10 text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-accent/50"
          />
        </div>
      )}

      {widget.type === 'dynamic_text' && (
        <div>
          <label className="text-xs text-foreground/50 mb-1.5 block">Template</label>
          <textarea
            value={(widget.config?.template as string) || ''}
            onChange={(e) => onUpdateWidget(widget.id, {
              config: { ...widget.config, template: e.target.value }
            })}
            placeholder="Guten Morgen {user}, heute ist {weekday} um {time}."
            rows={3}
            className="w-full px-2.5 py-2 rounded-xl bg-foreground/5 border border-foreground/10 text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-accent/50"
          />
          <p className="text-[10px] text-foreground/35 mt-1">
            Tokens: {'{user}'} {'{time}'} {'{seconds}'} {'{date}'} {'{weekday}'} {'{datetime}'}
          </p>
        </div>
      )}

      {widget.type === 'chat_card' && (
        <>
          <div>
            <label className="text-xs text-foreground/50 mb-1.5 block">Titel</label>
            <input
              type="text"
              value={(widget.config?.title as string) || ''}
              onChange={(e) => onUpdateWidget(widget.id, {
                config: { ...widget.config, title: e.target.value }
              })}
              placeholder="Chat Card"
              className="w-full px-2.5 py-2 rounded-xl bg-foreground/5 border border-foreground/10 text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-accent/50"
            />
          </div>
          <div>
            <label className="text-xs text-foreground/50 mb-1.5 block">Nachrichten (eine pro Zeile)</label>
            <textarea
              value={Array.isArray(widget.config?.messages) ? (widget.config?.messages as string[]).join('\n') : ''}
              onChange={(e) => onUpdateWidget(widget.id, {
                config: {
                  ...widget.config,
                  messages: e.target.value.split('\n').map(line => line.trim()).filter(Boolean),
                }
              })}
              placeholder="Kaffeemaschine ist bereit.\nRollladen Wohnzimmer offen."
              rows={4}
              className="w-full px-2.5 py-2 rounded-xl bg-foreground/5 border border-foreground/10 text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-accent/50"
            />
          </div>
        </>
      )}

      {/* Position - Visual Grid Picker */}
      <div>
        <label className="text-xs text-foreground/50 mb-2 block flex items-center gap-1.5">
          <MapPin size={12} />
          Position
        </label>
        {(() => {
          const COLS = Math.max(1, gridCols)
          // Calculate visible rows: max occupied row + 2 extra, at least 6
          const maxOccupiedRow = allWidgets.reduce(
            (max, w) => Math.max(max, w.position.y + w.size.h), 0
          )
          const visibleRows = Math.max(6, maxOccupiedRow + 2)

          // Build occupancy map
          const occupancy: (string | null)[][] = Array.from(
            { length: visibleRows },
            () => Array(COLS).fill(null)
          )
          for (const w of allWidgets) {
            for (let dy = 0; dy < w.size.h; dy++) {
              for (let dx = 0; dx < w.size.w; dx++) {
                const r = w.position.y + dy
                const c = w.position.x + dx
                if (r < visibleRows && c < COLS) {
                  occupancy[r][c] = w.id
                }
              }
            }
          }

          return (
            <>
              <div
                className="grid gap-0.5"
                style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}
              >
                {Array.from({ length: visibleRows * COLS }, (_, i) => {
                  const col = i % COLS
                  const row = Math.floor(i / COLS)
                  const cellOwner = occupancy[row]?.[col]
                  const isCurrentWidget = cellOwner === widget.id
                  const isOccupied = cellOwner !== null && !isCurrentWidget

                  return (
                    <button
                      key={`${col}-${row}`}
                      onClick={() => !isOccupied && onMoveWidget?.(widget.id, col, row)}
                      className="aspect-square rounded transition-all text-[8px] font-medium"
                      style={{
                        backgroundColor: isCurrentWidget
                          ? 'oklch(from var(--accent) l c h / 0.25)'
                          : isOccupied
                            ? 'oklch(from var(--foreground) l c h / 0.1)'
                            : 'oklch(from var(--foreground) l c h / 0.03)',
                        border: isCurrentWidget
                          ? '1.5px solid oklch(from var(--accent) l c h / 0.5)'
                          : '1px solid oklch(from var(--foreground) l c h / 0.06)',
                        color: isCurrentWidget
                          ? 'var(--accent)'
                          : isOccupied
                            ? 'oklch(from var(--foreground) l c h / 0.25)'
                            : 'transparent',
                        cursor: isOccupied ? 'not-allowed' : 'pointer',
                        opacity: isOccupied ? 0.6 : 1,
                      }}
                      disabled={isOccupied}
                    >
                      {isCurrentWidget ? '●' : isOccupied ? '·' : ''}
                    </button>
                  )
                })}
              </div>
              <p className="text-[9px] text-foreground/30 mt-1.5 text-center">
                Spalte {widget.position.x + 1}, Zeile {widget.position.y + 1}
              </p>
            </>
          )
        })()}
      </div>

      {/* Size controls */}
      <div>
        <label className="text-xs text-foreground/50 mb-2 block flex items-center gap-1.5">
          <ArrowsOutCardinal size={12} />
          Größe
        </label>
        <div className="grid grid-cols-2 gap-3">
          {/* Width */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-foreground/40 w-10">Breite</span>
            <button
              onClick={() => onResizeWidget(widget.id, 'w', -1)}
              disabled={widget.size.w <= 1}
              className="p-1 rounded-md hover:bg-foreground/10 text-foreground/50 disabled:opacity-20"
            >
              <Minus size={12} weight="bold" />
            </button>
            <span className="text-xs font-medium text-foreground w-4 text-center">{widget.size.w}</span>
            <button
              onClick={() => onResizeWidget(widget.id, 'w', 1)}
              disabled={widget.size.w >= Math.max(1, gridCols)}
              className="p-1 rounded-md hover:bg-foreground/10 text-foreground/50 disabled:opacity-20"
            >
              <Plus size={12} weight="bold" />
            </button>
          </div>
          {/* Height */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-foreground/40 w-10">Höhe</span>
            <button
              onClick={() => onResizeWidget(widget.id, 'h', -1)}
              disabled={widget.size.h <= 1}
              className="p-1 rounded-md hover:bg-foreground/10 text-foreground/50 disabled:opacity-20"
            >
              <Minus size={12} weight="bold" />
            </button>
            <span className="text-xs font-medium text-foreground w-4 text-center">{widget.size.h}</span>
            <button
              onClick={() => onResizeWidget(widget.id, 'h', 1)}
              disabled={widget.size.h >= 4}
              className="p-1 rounded-md hover:bg-foreground/10 text-foreground/50 disabled:opacity-20"
            >
              <Plus size={12} weight="bold" />
            </button>
          </div>
        </div>
      </div>

      {/* Alignment */}
      <div>
        <label className="text-xs text-foreground/50 mb-2 block">Ausrichtung</label>
        <div className="grid grid-cols-3 gap-1.5">
          {([
            { value: 'left', icon: TextAlignLeft, label: 'Links' },
            { value: 'center', icon: TextAlignCenter, label: 'Mitte' },
            { value: 'right', icon: TextAlignRight, label: 'Rechts' },
          ] as const).map(({ value, icon: AlignIcon, label }) => {
            const current = (widget.config?.alignment as string) || 'left'
            const isActive = current === value
            return (
              <button
                key={value}
                onClick={() => onUpdateWidget(widget.id, {
                  config: { ...widget.config, alignment: value }
                })}
                className={`
                  flex flex-col items-center gap-1 px-2 py-2 rounded-lg text-[10px] font-medium transition-all
                  ${isActive
                    ? 'bg-accent/15 text-accent border border-accent/25'
                    : 'bg-foreground/5 text-foreground/50 border border-transparent hover:bg-foreground/10'
                  }
                `}
              >
                <AlignIcon size={14} weight={isActive ? 'bold' : 'regular'} />
                {label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Background toggle */}
      <div>
        <label className="text-xs text-foreground/50 mb-2 block">Hintergrund</label>
        <button
          onClick={() => onUpdateWidget(widget.id, {
            config: { ...widget.config, transparentBackground: !widget.config?.transparentBackground }
          })}
          className={`
            w-full px-3 py-2 rounded-xl text-xs font-medium transition-all flex items-center justify-between
            ${widget.config?.transparentBackground
              ? 'bg-foreground/5 text-foreground/60 border border-foreground/10'
              : 'bg-accent/10 text-accent border border-accent/20'
            }
          `}
        >
          <span>{widget.config?.transparentBackground ? 'Transparent' : 'Glass-Effekt'}</span>
          <div
            className={`relative w-8 h-4 rounded-full transition-colors ${
              widget.config?.transparentBackground ? 'bg-foreground/20' : 'bg-accent'
            }`}
          >
            <div
              className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${
                widget.config?.transparentBackground ? '' : 'translate-x-4'
              }`}
            />
          </div>
        </button>
      </div>

      {/* Delete */}
      <button
        onClick={() => onDeleteWidget(widget.id)}
        className="w-full px-3 py-2 rounded-xl text-red-400 hover:bg-red-500/10 text-xs font-medium transition-colors flex items-center justify-center gap-1.5"
      >
        <Trash size={14} weight="bold" />
        Widget löschen
      </button>
    </div>
  )
}

export function WidgetPalette({
  selectedWidget,
  availableEntities,
  allWidgets,
  gridCols,
  onAddWidget,
  onUpdateWidget,
  onResizeWidget,
  onDeleteWidget,
  onMoveWidget,
  onOpenWidgetGroupDesigner,
}: WidgetPaletteProps) {
  const [searchQuery, setSearchQuery] = useState('')

  return (
    <div className="w-56 xl:w-60 border-l border-foreground/10 flex flex-col overflow-hidden min-h-0">
      {selectedWidget ? (
        <>
          <div className="px-4 py-3 border-b border-foreground/5">
            <h3 className="text-xs font-semibold text-foreground/70">Eigenschaften</h3>
          </div>
          <div className="flex-1 overflow-y-auto">
            <WidgetProperties
              widget={selectedWidget}
              availableEntities={availableEntities}
              allWidgets={allWidgets}
              gridCols={gridCols}
              onUpdateWidget={onUpdateWidget}
              onResizeWidget={onResizeWidget}
              onDeleteWidget={onDeleteWidget}
              onMoveWidget={onMoveWidget}
              onOpenWidgetGroupDesigner={onOpenWidgetGroupDesigner}
            />
          </div>
        </>
      ) : (
        <>
          <div className="px-4 py-3 border-b border-foreground/5">
            <h3 className="text-xs font-semibold text-foreground/70 mb-2">Widgets hinzufügen</h3>
            <div className="relative">
              <MagnifyingGlass size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground/30" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Widget suchen..."
                className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-foreground/5 border border-foreground/10 text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-accent/50 placeholder:text-foreground/30"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto py-2">
            {/* Entity subcategories */}
            {Object.entries(WIDGET_SUBCATEGORIES)
              .sort(([, a], [, b]) => a.order - b.order)
              .map(([key]) => (
                <SubcategorySection
                  key={key}
                  subcategory={key as WidgetSubcategory}
                  availableEntities={availableEntities}
                  onAddWidget={onAddWidget}
                  searchQuery={searchQuery}
                />
              ))}
            {/* Standalone & Layout */}
            <CategorySection category="standalone" availableEntities={availableEntities} onAddWidget={onAddWidget} searchQuery={searchQuery} />
            <CategorySection category="layout" availableEntities={availableEntities} onAddWidget={onAddWidget} searchQuery={searchQuery} />
          </div>
        </>
      )}
    </div>
  )
}
