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
  CopySimple,
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
import { CARD_STYLE_PRESETS } from '@/lib/defaults'

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
  onDuplicateWidget?: (widgetId: string) => void
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
  onDuplicateWidget,
  onMoveWidget,
  onOpenWidgetGroupDesigner,
}: {
  widget: DashboardWidget
  availableEntities: EntityState[]
  allWidgets: DashboardWidget[]
  gridCols: number
  onUpdateWidget: (widgetId: string, updates: Partial<DashboardWidget>) => void
  onResizeWidget: (widgetId: string, dimension: 'w' | 'h', delta: number) => void
  onDeleteWidget: (widgetId: string) => void
  onDuplicateWidget?: (widgetId: string) => void
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

      {/* Custom display label override */}
      <div>
        <label className="text-xs text-foreground/50 mb-1.5 block">Anzeigename</label>
        <input
          type="text"
          value={(widget.config?.customLabel as string) || ''}
          onChange={(e) => onUpdateWidget(widget.id, {
            config: { ...widget.config, customLabel: e.target.value }
          })}
          placeholder={def.label}
          className="w-full px-2.5 py-2 rounded-xl bg-foreground/5 border border-foreground/10 text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-accent/50 placeholder:text-foreground/30"
        />
      </div>

      {/* Icon size selector */}
      {def.requiresEntity && (
        <div>
          <label className="text-xs text-foreground/50 mb-2 block">Icon-Größe</label>
          <div className="grid grid-cols-3 gap-1.5">
            {([
              { value: 'small', label: 'Klein' },
              { value: 'medium', label: 'Mittel' },
              { value: 'large', label: 'Groß' },
            ] as const).map(({ value, label }) => {
              const current = (widget.config?.iconSize as string) || 'medium'
              return (
                <button
                  key={value}
                  onClick={() => onUpdateWidget(widget.id, {
                    config: { ...widget.config, iconSize: value }
                  })}
                  className={`px-2 py-1.5 rounded-lg text-[11px] font-medium transition-all text-center ${
                    current === value
                      ? 'bg-accent/15 text-accent border border-accent/25'
                      : 'bg-foreground/5 text-foreground/50 border border-transparent hover:bg-foreground/10'
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>
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

      {/* Card style preset picker */}
      <div>
        <label className="text-xs text-foreground/50 mb-2 block">Kartenstil</label>
        <div className="grid grid-cols-3 gap-1.5">
          {CARD_STYLE_PRESETS.map(({ id, label, description }) => {
            const current = (widget.config?.cardStyle as string) || 'default'
            const isActive = current === id
            /* Mini-swatch styling per card style for visual hint */
            const swatchStyle: Record<string, React.CSSProperties> = {
              default:    { background: 'linear-gradient(135deg, rgba(255,255,255,0.12), rgba(255,255,255,0.04))', border: '1px solid rgba(255,255,255,0.15)' },
              subtle:     { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' },
              solid:      { background: 'rgba(40,40,50,0.85)', border: '1px solid rgba(255,255,255,0.10)' },
              outline:    { background: 'transparent', border: '1.5px solid rgba(255,255,255,0.20)' },
              neon:       { background: 'linear-gradient(135deg, rgba(var(--accent-rgb,100,200,255),0.15), transparent)', border: '1px solid rgba(var(--accent-rgb,100,200,255),0.5)', boxShadow: '0 0 6px rgba(var(--accent-rgb,100,200,255),0.3)' },
              minimal:    { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' },
              elevated:   { background: 'linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0.04))', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 4px 12px rgba(0,0,0,0.2)' },
              frosted:    { background: 'rgba(200,210,230,0.25)', border: '1px solid rgba(255,255,255,0.15)', backdropFilter: 'blur(4px)' },
              gradient:   { background: 'linear-gradient(135deg, rgba(var(--accent-rgb,100,200,255),0.18), rgba(40,40,60,0.15))', border: '1px solid rgba(var(--accent-rgb,100,200,255),0.2)' },
              flat:       { background: 'rgba(60,60,70,0.55)', border: '1px solid rgba(255,255,255,0.06)' },
              aurora:     { background: 'linear-gradient(135deg, rgba(var(--accent-rgb,100,200,255),0.15), rgba(160,120,255,0.10), rgba(100,220,200,0.08))', border: '1px solid rgba(var(--accent-rgb,100,200,255),0.2)' },
              'dark-glass': { background: 'linear-gradient(175deg, rgba(0,0,0,0.25), rgba(0,0,0,0.15))', border: '1px solid rgba(255,255,255,0.08)' },
              metallic:   { background: 'linear-gradient(170deg, rgba(255,255,255,0.14), rgba(255,255,255,0.04), rgba(255,255,255,0.10))', border: '1px solid rgba(255,255,255,0.15)' },
              'soft-glow': { background: 'linear-gradient(165deg, rgba(255,255,255,0.10), rgba(255,255,255,0.04))', border: '1px solid rgba(var(--accent-rgb,100,200,255),0.15)', boxShadow: '0 0 8px rgba(var(--accent-rgb,100,200,255),0.15)' },
              bordered:   { background: 'linear-gradient(165deg, rgba(255,255,255,0.10), rgba(255,255,255,0.04))', border: '1px solid rgba(255,255,255,0.15)', boxShadow: '0 0 0 3px rgba(255,255,255,0.06)' },
            }
            return (
              <button
                key={id}
                onClick={() => onUpdateWidget(widget.id, {
                  config: { ...widget.config, cardStyle: id }
                })}
                className={`
                  group relative flex flex-col items-center gap-1.5 px-2 py-2 rounded-xl text-[10px] font-medium transition-all
                  ${isActive
                    ? 'bg-accent/12 text-accent ring-1 ring-accent/30'
                    : 'bg-foreground/4 text-foreground/50 hover:bg-foreground/8'
                  }
                `}
                title={description}
              >
                {/* Mini swatch preview */}
                <div
                  className="w-full h-5 rounded-md shrink-0"
                  style={swatchStyle[id] || swatchStyle.default}
                />
                <span className="truncate w-full text-center leading-tight">{label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ─── Modal / Dialog width per widget ─── */}
      {def.requiresEntity && (
        <div>
          <label className="text-xs text-foreground/50 mb-2 block">Dialog-Breite</label>
          <div className="grid grid-cols-4 gap-1.5">
            {([
              { value: 'default', label: 'Normal' },
              { value: 'wide', label: 'Breit' },
              { value: 'full', label: 'Voll' },
              { value: 'auto', label: 'Auto' },
            ] as const).map(({ value, label }) => {
              const current = (widget.config?.modalSize as string) || 'default'
              return (
                <button
                  key={value}
                  onClick={() => onUpdateWidget(widget.id, {
                    config: { ...widget.config, modalSize: value }
                  })}
                  className={`px-2 py-1.5 rounded-lg text-[11px] font-medium transition-all text-center ${
                    current === value
                      ? 'bg-accent/15 text-accent border border-accent/25'
                      : 'bg-foreground/5 text-foreground/50 border border-transparent hover:bg-foreground/10'
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ─── Widget-specific config sections ─── */}

      {/* Analog Clock config */}
      {widget.type === 'analog_clock' && (
        <div className="space-y-3">
          <label className="text-xs text-foreground/50 block">Uhr-Einstellungen</label>

          {/* Face style */}
          <div>
            <span className="text-[11px] text-foreground/40 block mb-1.5">Ziffernblatt</span>
            <div className="grid grid-cols-2 gap-1.5">
              {([
                { value: 'ticks', label: 'Striche' },
                { value: 'numbers', label: 'Ziffern' },
                { value: 'minimal', label: 'Minimal' },
                { value: 'none', label: 'Leer' },
              ] as const).map(({ value, label }) => {
                const current = (widget.config?.faceStyle as string) || 'ticks'
                return (
                  <button
                    key={value}
                    onClick={() => onUpdateWidget(widget.id, {
                      config: { ...widget.config, faceStyle: value }
                    })}
                    className={`px-2 py-1.5 rounded-lg text-[11px] font-medium transition-all text-center ${
                      current === value
                        ? 'bg-accent/15 text-accent border border-accent/25'
                        : 'bg-foreground/5 text-foreground/50 border border-transparent hover:bg-foreground/10'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Seconds mode */}
          <div>
            <span className="text-[11px] text-foreground/40 block mb-1.5">Sekundenzeiger</span>
            <div className="grid grid-cols-3 gap-1.5">
              {([
                { value: 'tick', label: 'Ticken' },
                { value: 'sweep', label: 'Fließen' },
                { value: 'hidden', label: 'Aus' },
              ] as const).map(({ value, label }) => {
                const current = (widget.config?.secondsMode as string) || 'tick'
                return (
                  <button
                    key={value}
                    onClick={() => onUpdateWidget(widget.id, {
                      config: { ...widget.config, secondsMode: value, showSeconds: value !== 'hidden' }
                    })}
                    className={`px-2 py-1.5 rounded-lg text-[11px] font-medium transition-all text-center ${
                      current === value
                        ? 'bg-accent/15 text-accent border border-accent/25'
                        : 'bg-foreground/5 text-foreground/50 border border-transparent hover:bg-foreground/10'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Digital time toggle */}
          <button
            onClick={() => onUpdateWidget(widget.id, {
              config: { ...widget.config, showDigitalTime: !(widget.config?.showDigitalTime ?? true) }
            })}
            className={`w-full px-3 py-2 rounded-xl text-xs font-medium transition-all flex items-center justify-between ${
              (widget.config?.showDigitalTime ?? true)
                ? 'bg-accent/10 text-accent border border-accent/20'
                : 'bg-foreground/5 text-foreground/60 border border-foreground/10'
            }`}
          >
            <span>Digitalzeit anzeigen</span>
            <div className={`relative w-8 h-4 rounded-full transition-colors ${
              (widget.config?.showDigitalTime ?? true) ? 'bg-accent' : 'bg-foreground/20'
            }`}>
              <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${
                (widget.config?.showDigitalTime ?? true) ? 'translate-x-4' : ''
              }`} />
            </div>
          </button>
        </div>
      )}

      {/* Digital Clock config */}
      {widget.type === 'digital_clock' && (
        <div className="space-y-3">
          <label className="text-xs text-foreground/50 block">Uhr-Einstellungen</label>

          {([
            { key: 'showSeconds', label: 'Sekunden anzeigen', defaultVal: true },
            { key: 'show24Hour', label: '24-Stunden-Format', defaultVal: true },
            { key: 'showDate', label: 'Datum anzeigen', defaultVal: true },
          ] as const).map(({ key, label, defaultVal }) => (
            <button
              key={key}
              onClick={() => onUpdateWidget(widget.id, {
                config: { ...widget.config, [key]: !(widget.config?.[key] ?? defaultVal) }
              })}
              className={`w-full px-3 py-2 rounded-xl text-xs font-medium transition-all flex items-center justify-between ${
                (widget.config?.[key] ?? defaultVal)
                  ? 'bg-accent/10 text-accent border border-accent/20'
                  : 'bg-foreground/5 text-foreground/60 border border-foreground/10'
              }`}
            >
              <span>{label}</span>
              <div className={`relative w-8 h-4 rounded-full transition-colors ${
                (widget.config?.[key] ?? defaultVal) ? 'bg-accent' : 'bg-foreground/20'
              }`}>
                <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${
                  (widget.config?.[key] ?? defaultVal) ? 'translate-x-4' : ''
                }`} />
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Weather Widget config */}
      {widget.type === 'weather' && (
        <div className="space-y-3">
          <label className="text-xs text-foreground/50 block">Wetter-Einstellungen</label>
          <button
            onClick={() => onUpdateWidget(widget.id, {
              config: { ...widget.config, showForecast: !(widget.config?.showForecast ?? true) }
            })}
            className={`w-full px-3 py-2 rounded-xl text-xs font-medium transition-all flex items-center justify-between ${
              (widget.config?.showForecast ?? true)
                ? 'bg-accent/10 text-accent border border-accent/20'
                : 'bg-foreground/5 text-foreground/60 border border-foreground/10'
            }`}
          >
            <span>Vorhersage anzeigen</span>
            <div className={`relative w-8 h-4 rounded-full transition-colors ${
              (widget.config?.showForecast ?? true) ? 'bg-accent' : 'bg-foreground/20'
            }`}>
              <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${
                (widget.config?.showForecast ?? true) ? 'translate-x-4' : ''
              }`} />
            </div>
          </button>
        </div>
      )}

      {/* Sensor Widget config */}
      {widget.type === 'sensor' && (
        <div className="space-y-3">
          <label className="text-xs text-foreground/50 block">Sensor-Einstellungen</label>
          <button
            onClick={() => onUpdateWidget(widget.id, {
              config: { ...widget.config, showGraph: !(widget.config?.showGraph ?? false) }
            })}
            className={`w-full px-3 py-2 rounded-xl text-xs font-medium transition-all flex items-center justify-between ${
              (widget.config?.showGraph ?? false)
                ? 'bg-accent/10 text-accent border border-accent/20'
                : 'bg-foreground/5 text-foreground/60 border border-foreground/10'
            }`}
          >
            <span>Mini-Graph anzeigen</span>
            <div className={`relative w-8 h-4 rounded-full transition-colors ${
              (widget.config?.showGraph ?? false) ? 'bg-accent' : 'bg-foreground/20'
            }`}>
              <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${
                (widget.config?.showGraph ?? false) ? 'translate-x-4' : ''
              }`} />
            </div>
          </button>
        </div>
      )}

      {/* Greeting Widget config */}
      {widget.type === 'greeting' && (
        <div className="space-y-3">
          <label className="text-xs text-foreground/50 block">Begrüßungs-Einstellungen</label>
          <button
            onClick={() => onUpdateWidget(widget.id, {
              config: { ...widget.config, showWeather: !(widget.config?.showWeather ?? true) }
            })}
            className={`w-full px-3 py-2 rounded-xl text-xs font-medium transition-all flex items-center justify-between ${
              (widget.config?.showWeather ?? true)
                ? 'bg-accent/10 text-accent border border-accent/20'
                : 'bg-foreground/5 text-foreground/60 border border-foreground/10'
            }`}
          >
            <span>Wetter anzeigen</span>
            <div className={`relative w-8 h-4 rounded-full transition-colors ${
              (widget.config?.showWeather ?? true) ? 'bg-accent' : 'bg-foreground/20'
            }`}>
              <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${
                (widget.config?.showWeather ?? true) ? 'translate-x-4' : ''
              }`} />
            </div>
          </button>
          <button
            onClick={() => onUpdateWidget(widget.id, {
              config: { ...widget.config, showMessage: !(widget.config?.showMessage ?? true) }
            })}
            className={`w-full px-3 py-2 rounded-xl text-xs font-medium transition-all flex items-center justify-between ${
              (widget.config?.showMessage ?? true)
                ? 'bg-accent/10 text-accent border border-accent/20'
                : 'bg-foreground/5 text-foreground/60 border border-foreground/10'
            }`}
          >
            <span>Nachricht anzeigen</span>
            <div className={`relative w-8 h-4 rounded-full transition-colors ${
              (widget.config?.showMessage ?? true) ? 'bg-accent' : 'bg-foreground/20'
            }`}>
              <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${
                (widget.config?.showMessage ?? true) ? 'translate-x-4' : ''
              }`} />
            </div>
          </button>
        </div>
      )}

      {/* Light Widget config */}
      {widget.type === 'light' && (
        <div className="space-y-3">
          <label className="text-xs text-foreground/50 block">Licht-Einstellungen</label>
          {([
            { key: 'showBrightness', label: 'Helligkeit anzeigen', defaultVal: true },
            { key: 'showColorTemp', label: 'Farbtemperatur anzeigen', defaultVal: true },
            { key: 'showColorPicker', label: 'Farbauswahl anzeigen', defaultVal: true },
            { key: 'showEffects', label: 'Effekte anzeigen', defaultVal: true },
            { key: 'quickToggle', label: 'Schnell-Toggle (Tap)', defaultVal: false },
          ] as const).map(({ key, label, defaultVal }) => (
            <button
              key={key}
              onClick={() => onUpdateWidget(widget.id, {
                config: { ...widget.config, [key]: !(widget.config?.[key] ?? defaultVal) }
              })}
              className={`w-full px-3 py-2 rounded-xl text-xs font-medium transition-all flex items-center justify-between ${
                (widget.config?.[key] ?? defaultVal)
                  ? 'bg-accent/10 text-accent border border-accent/20'
                  : 'bg-foreground/5 text-foreground/60 border border-foreground/10'
              }`}
            >
              <span>{label}</span>
              <div className={`relative w-8 h-4 rounded-full transition-colors ${
                (widget.config?.[key] ?? defaultVal) ? 'bg-accent' : 'bg-foreground/20'
              }`}>
                <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${
                  (widget.config?.[key] ?? defaultVal) ? 'translate-x-4' : ''
                }`} />
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Climate Widget config */}
      {widget.type === 'climate' && (
        <div className="space-y-3">
          <label className="text-xs text-foreground/50 block">Klima-Einstellungen</label>
          {([
            { key: 'showHumidity', label: 'Luftfeuchtigkeit anzeigen', defaultVal: true },
            { key: 'showPresetModes', label: 'Voreinstellungen anzeigen', defaultVal: true },
            { key: 'showFanModes', label: 'Lüfter-Modi anzeigen', defaultVal: true },
            { key: 'showSwingModes', label: 'Schwenk-Modi anzeigen', defaultVal: false },
            { key: 'compactMode', label: 'Kompakt-Ansicht', defaultVal: false },
          ] as const).map(({ key, label, defaultVal }) => (
            <button
              key={key}
              onClick={() => onUpdateWidget(widget.id, {
                config: { ...widget.config, [key]: !(widget.config?.[key] ?? defaultVal) }
              })}
              className={`w-full px-3 py-2 rounded-xl text-xs font-medium transition-all flex items-center justify-between ${
                (widget.config?.[key] ?? defaultVal)
                  ? 'bg-accent/10 text-accent border border-accent/20'
                  : 'bg-foreground/5 text-foreground/60 border border-foreground/10'
              }`}
            >
              <span>{label}</span>
              <div className={`relative w-8 h-4 rounded-full transition-colors ${
                (widget.config?.[key] ?? defaultVal) ? 'bg-accent' : 'bg-foreground/20'
              }`}>
                <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${
                  (widget.config?.[key] ?? defaultVal) ? 'translate-x-4' : ''
                }`} />
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Media Player Widget config */}
      {widget.type === 'media_player' && (
        <div className="space-y-3">
          <label className="text-xs text-foreground/50 block">Media Player-Einstellungen</label>
          {([
            { key: 'showArtwork', label: 'Cover-Bild anzeigen', defaultVal: true },
            { key: 'showVolume', label: 'Lautstärke anzeigen', defaultVal: true },
            { key: 'showProgress', label: 'Fortschritt anzeigen', defaultVal: true },
            { key: 'showSource', label: 'Quelle anzeigen', defaultVal: false },
          ] as const).map(({ key, label, defaultVal }) => (
            <button
              key={key}
              onClick={() => onUpdateWidget(widget.id, {
                config: { ...widget.config, [key]: !(widget.config?.[key] ?? defaultVal) }
              })}
              className={`w-full px-3 py-2 rounded-xl text-xs font-medium transition-all flex items-center justify-between ${
                (widget.config?.[key] ?? defaultVal)
                  ? 'bg-accent/10 text-accent border border-accent/20'
                  : 'bg-foreground/5 text-foreground/60 border border-foreground/10'
              }`}
            >
              <span>{label}</span>
              <div className={`relative w-8 h-4 rounded-full transition-colors ${
                (widget.config?.[key] ?? defaultVal) ? 'bg-accent' : 'bg-foreground/20'
              }`}>
                <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${
                  (widget.config?.[key] ?? defaultVal) ? 'translate-x-4' : ''
                }`} />
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Cover Widget config */}
      {widget.type === 'cover' && (
        <div className="space-y-3">
          <label className="text-xs text-foreground/50 block">Abdeckung-Einstellungen</label>
          {([
            { key: 'showPosition', label: 'Position anzeigen', defaultVal: true },
            { key: 'showTilt', label: 'Neigung anzeigen', defaultVal: false },
          ] as const).map(({ key, label, defaultVal }) => (
            <button
              key={key}
              onClick={() => onUpdateWidget(widget.id, {
                config: { ...widget.config, [key]: !(widget.config?.[key] ?? defaultVal) }
              })}
              className={`w-full px-3 py-2 rounded-xl text-xs font-medium transition-all flex items-center justify-between ${
                (widget.config?.[key] ?? defaultVal)
                  ? 'bg-accent/10 text-accent border border-accent/20'
                  : 'bg-foreground/5 text-foreground/60 border border-foreground/10'
              }`}
            >
              <span>{label}</span>
              <div className={`relative w-8 h-4 rounded-full transition-colors ${
                (widget.config?.[key] ?? defaultVal) ? 'bg-accent' : 'bg-foreground/20'
              }`}>
                <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${
                  (widget.config?.[key] ?? defaultVal) ? 'translate-x-4' : ''
                }`} />
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Fan Widget config */}
      {widget.type === 'fan' && (
        <div className="space-y-3">
          <label className="text-xs text-foreground/50 block">Lüfter-Einstellungen</label>
          {([
            { key: 'showSpeed', label: 'Geschwindigkeit anzeigen', defaultVal: true },
            { key: 'showOscillation', label: 'Oszillation anzeigen', defaultVal: false },
            { key: 'showDirection', label: 'Richtung anzeigen', defaultVal: false },
          ] as const).map(({ key, label, defaultVal }) => (
            <button
              key={key}
              onClick={() => onUpdateWidget(widget.id, {
                config: { ...widget.config, [key]: !(widget.config?.[key] ?? defaultVal) }
              })}
              className={`w-full px-3 py-2 rounded-xl text-xs font-medium transition-all flex items-center justify-between ${
                (widget.config?.[key] ?? defaultVal)
                  ? 'bg-accent/10 text-accent border border-accent/20'
                  : 'bg-foreground/5 text-foreground/60 border border-foreground/10'
              }`}
            >
              <span>{label}</span>
              <div className={`relative w-8 h-4 rounded-full transition-colors ${
                (widget.config?.[key] ?? defaultVal) ? 'bg-accent' : 'bg-foreground/20'
              }`}>
                <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${
                  (widget.config?.[key] ?? defaultVal) ? 'translate-x-4' : ''
                }`} />
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Switch Widget config */}
      {widget.type === 'switch' && (
        <div className="space-y-3">
          <label className="text-xs text-foreground/50 block">Schalter-Einstellungen</label>
          {([
            { key: 'showLastChanged', label: 'Letzte Änderung anzeigen', defaultVal: false },
            { key: 'confirmToggle', label: 'Toggle bestätigen', defaultVal: false },
          ] as const).map(({ key, label, defaultVal }) => (
            <button
              key={key}
              onClick={() => onUpdateWidget(widget.id, {
                config: { ...widget.config, [key]: !(widget.config?.[key] ?? defaultVal) }
              })}
              className={`w-full px-3 py-2 rounded-xl text-xs font-medium transition-all flex items-center justify-between ${
                (widget.config?.[key] ?? defaultVal)
                  ? 'bg-accent/10 text-accent border border-accent/20'
                  : 'bg-foreground/5 text-foreground/60 border border-foreground/10'
              }`}
            >
              <span>{label}</span>
              <div className={`relative w-8 h-4 rounded-full transition-colors ${
                (widget.config?.[key] ?? defaultVal) ? 'bg-accent' : 'bg-foreground/20'
              }`}>
                <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${
                  (widget.config?.[key] ?? defaultVal) ? 'translate-x-4' : ''
                }`} />
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Camera Widget config */}
      {widget.type === 'camera' && (
        <div className="space-y-3">
          <label className="text-xs text-foreground/50 block">Kamera-Einstellungen</label>
          {([
            { key: 'showControls', label: 'Steuerung anzeigen', defaultVal: true },
            { key: 'autoRefresh', label: 'Auto-Aktualisierung', defaultVal: true },
          ] as const).map(({ key, label, defaultVal }) => (
            <button
              key={key}
              onClick={() => onUpdateWidget(widget.id, {
                config: { ...widget.config, [key]: !(widget.config?.[key] ?? defaultVal) }
              })}
              className={`w-full px-3 py-2 rounded-xl text-xs font-medium transition-all flex items-center justify-between ${
                (widget.config?.[key] ?? defaultVal)
                  ? 'bg-accent/10 text-accent border border-accent/20'
                  : 'bg-foreground/5 text-foreground/60 border border-foreground/10'
              }`}
            >
              <span>{label}</span>
              <div className={`relative w-8 h-4 rounded-full transition-colors ${
                (widget.config?.[key] ?? defaultVal) ? 'bg-accent' : 'bg-foreground/20'
              }`}>
                <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${
                  (widget.config?.[key] ?? defaultVal) ? 'translate-x-4' : ''
                }`} />
              </div>
            </button>
          ))}
          <div>
            <span className="text-[11px] text-foreground/40 block mb-1.5">Aktualisierungsintervall (Sek.)</span>
            <input
              type="number"
              min={1}
              max={300}
              value={(widget.config?.refreshInterval as number) || 10}
              onChange={(e) => onUpdateWidget(widget.id, {
                config: { ...widget.config, refreshInterval: Math.max(1, Number(e.target.value) || 10) }
              })}
              className="w-full px-2.5 py-2 rounded-xl bg-foreground/5 border border-foreground/10 text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-accent/50"
            />
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

      {/* Duplicate & Delete */}
      <div className="flex gap-2">
        {onDuplicateWidget && (
          <button
            onClick={() => onDuplicateWidget(widget.id)}
            className="flex-1 px-3 py-2 rounded-xl text-accent hover:bg-accent/10 text-xs font-medium transition-colors flex items-center justify-center gap-1.5"
          >
            <CopySimple size={14} weight="bold" />
            Duplizieren
          </button>
        )}
        <button
          onClick={() => onDeleteWidget(widget.id)}
          className="flex-1 px-3 py-2 rounded-xl text-red-400 hover:bg-red-500/10 text-xs font-medium transition-colors flex items-center justify-center gap-1.5"
        >
          <Trash size={14} weight="bold" />
          Löschen
        </button>
      </div>
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
  onDuplicateWidget,
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
              onDuplicateWidget={onDuplicateWidget}
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
