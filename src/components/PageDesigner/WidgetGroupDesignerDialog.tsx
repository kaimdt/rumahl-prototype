import { useMemo, useState, useCallback, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  Minus,
  Plus,
  GridFour,
  DotsSixVertical,
  Eye,
  EyeSlash,
  CaretDown,
  CaretUp,
  Trash,
} from '@phosphor-icons/react'
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  useDroppable,
  useDraggable,
} from '@dnd-kit/core'
import { WidgetPalette } from './WidgetPalette'
import { FloatingToolbar } from './FloatingToolbar'
import { DragOverlayPreview } from './DragOverlayPreview'
import { UnconfiguredOverlay } from './UnconfiguredOverlay'
import { RenderWidget } from '@/components/CustomPageRenderer'
import { SearchableSelect } from '@/components/ui/searchable-select'
import type { DashboardWidget, EntityState, LightEntity, WeatherEntity, WidgetType } from '@/lib/types'
import { getWidgetDef } from '@/lib/widgetRegistry'

const MIN_COLS = 1
const MAX_COLS = 6
const MIN_ROWS = 4
const MAX_WIDGET_HEIGHT = 8

interface WidgetGroupDesignerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  groupWidget: DashboardWidget
  availableEntities: EntityState[]
  userName?: string
  weatherEntity?: WeatherEntity
  lightEntities?: LightEntity[]
  onUpdateGroupWidget: (widgetId: string, updates: Partial<DashboardWidget>) => void
}

// Build occupancy map for group grid
function buildOccupancyMap(widgets: DashboardWidget[], cols: number, rows: number) {
  const map: (string | null)[][] = Array.from({ length: rows }, () => Array(cols).fill(null))
  for (const w of widgets) {
    for (let dy = 0; dy < w.size.h; dy++) {
      for (let dx = 0; dx < w.size.w; dx++) {
        const row = w.position.y + dy
        const col = w.position.x + dx
        if (row < rows && col < cols) {
          map[row][col] = w.id
        }
      }
    }
  }
  return map
}

function findFirstAvailablePosition(
  widgets: DashboardWidget[],
  size: { w: number; h: number },
  cols: number,
): { x: number; y: number } {
  const maxRows = 24
  const map = buildOccupancyMap(widgets, cols, maxRows)
  for (let row = 0; row < maxRows; row++) {
    for (let col = 0; col <= cols - size.w; col++) {
      let fits = true
      for (let dy = 0; dy < size.h && fits; dy++) {
        for (let dx = 0; dx < size.w && fits; dx++) {
          if (map[row + dy]?.[col + dx] !== null) fits = false
        }
      }
      if (fits) return { x: col, y: row }
    }
  }
  return { x: 0, y: 0 }
}

// Droppable empty cell (matching PageDesigner)
function EmptyCell({ col, row, onClick }: { col: number; row: number; onClick: () => void }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `group-cell-${col}-${row}`,
    data: { type: 'cell', col, row },
  })

  return (
    <div
      ref={setNodeRef}
      onClick={(e) => { e.stopPropagation(); onClick() }}
      className={`
        rounded-xl border border-dashed transition-all cursor-pointer min-h-[64px]
        ${isOver
          ? 'border-accent/50 bg-accent/10'
          : 'border-foreground/8 hover:border-foreground/20 hover:bg-foreground/3'
        }
      `}
      style={{
        gridColumnStart: col + 1,
        gridRowStart: row + 1,
      }}
    />
  )
}

// Canvas widget with drag, resize, floating toolbar (matching PageDesigner)
function GroupCanvasWidget({
  widget,
  isSelected,
  onSelect,
  onDelete,
  onResizeWidth,
  onResizeHeight,
  onConfigure,
  onResizeTo,
  maxCols,
  maxRows,
  entities,
  userName,
  weatherEntity,
  lightEntities,
}: {
  widget: DashboardWidget
  isSelected: boolean
  onSelect: () => void
  onDelete: () => void
  onResizeWidth: (delta: number) => void
  onResizeHeight: (delta: number) => void
  onConfigure?: () => void
  onResizeTo?: (nextWidth: number, nextHeight: number) => void
  maxCols: number
  maxRows: number
  entities: EntityState[]
  userName?: string
  weatherEntity?: WeatherEntity
  lightEntities?: LightEntity[]
}) {
  const def = getWidgetDef(widget.type)
  const isUnconfigured = def?.requiresEntity && !widget.entity_id
  const resizeStateRef = useRef<{
    mode: 'right' | 'bottom' | 'corner'
    startX: number
    startY: number
    startW: number
    startH: number
    unitW: number
    unitH: number
  } | null>(null)

  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
  } = useDraggable({
    id: `group-canvas-${widget.id}`,
    data: { origin: 'canvas', widgetId: widget.id },
  })

  return (
    <div
      ref={setNodeRef}
      onClick={(e) => { e.stopPropagation(); onSelect() }}
      className={`
        relative transition-all group min-h-[64px]
        ${isSelected
          ? 'ring-2 ring-accent rounded-2xl'
          : 'hover:ring-1 hover:ring-foreground/20 rounded-2xl'
        }
        ${isDragging ? 'opacity-50' : ''}
      `}
      style={{
        gridColumnStart: widget.position.x + 1,
        gridColumnEnd: `span ${Math.min(widget.size.w, maxCols - widget.position.x)}`,
        gridRowStart: widget.position.y + 1,
        gridRowEnd: `span ${widget.size.h}`,
      }}
    >
      {/* Drag handle */}
      <div
        {...attributes}
        {...listeners}
        className="absolute top-2 left-2 z-10 p-1 rounded-md cursor-grab active:cursor-grabbing
          opacity-0 group-hover:opacity-100 transition-opacity
          bg-black/30 text-white/80 backdrop-blur-sm hover:bg-black/50"
      >
        <DotsSixVertical size={14} weight="bold" />
      </div>

      {/* Floating toolbar */}
      {isSelected && (
        <FloatingToolbar
          onConfigure={onConfigure}
          onResizeWidth={onResizeWidth}
          onResizeHeight={onResizeHeight}
          onDelete={onDelete}
          widgetSize={widget.size}
          maxWidth={Math.max(1, maxCols - widget.position.x)}
          maxHeight={maxRows}
        />
      )}

      {/* Resize handles */}
      {isSelected && (
        <>
          <button
            type="button"
            aria-label="Breite ziehen"
            className="absolute top-1/2 -right-1.5 -translate-y-1/2 h-12 w-2 rounded-full bg-accent/70 shadow-sm cursor-ew-resize"
            onPointerDown={(e) => {
              e.stopPropagation()
              const parent = e.currentTarget.parentElement
              if (!parent || !onResizeTo) return
              const rect = parent.getBoundingClientRect()
              resizeStateRef.current = {
                mode: 'right',
                startX: e.clientX, startY: e.clientY,
                startW: widget.size.w, startH: widget.size.h,
                unitW: rect.width / Math.max(1, widget.size.w),
                unitH: rect.height / Math.max(1, widget.size.h),
              }
              const onMove = (ev: PointerEvent) => {
                if (!resizeStateRef.current) return
                const dx = ev.clientX - resizeStateRef.current.startX
                const widthDelta = Math.round(dx / resizeStateRef.current.unitW)
                const maxW = Math.max(1, maxCols - widget.position.x)
                onResizeTo(Math.max(1, Math.min(maxW, resizeStateRef.current.startW + widthDelta)), widget.size.h)
              }
              const onUp = () => { resizeStateRef.current = null; window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
              window.addEventListener('pointermove', onMove)
              window.addEventListener('pointerup', onUp)
            }}
          />
          <button
            type="button"
            aria-label="Hoehe ziehen"
            className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 h-2 w-12 rounded-full bg-accent/70 shadow-sm cursor-ns-resize"
            onPointerDown={(e) => {
              e.stopPropagation()
              const parent = e.currentTarget.parentElement
              if (!parent || !onResizeTo) return
              const rect = parent.getBoundingClientRect()
              resizeStateRef.current = {
                mode: 'bottom',
                startX: e.clientX, startY: e.clientY,
                startW: widget.size.w, startH: widget.size.h,
                unitW: rect.width / Math.max(1, widget.size.w),
                unitH: rect.height / Math.max(1, widget.size.h),
              }
              const onMove = (ev: PointerEvent) => {
                if (!resizeStateRef.current) return
                const dy = ev.clientY - resizeStateRef.current.startY
                const heightDelta = Math.round(dy / resizeStateRef.current.unitH)
                onResizeTo(widget.size.w, Math.max(1, Math.min(maxRows, resizeStateRef.current.startH + heightDelta)))
              }
              const onUp = () => { resizeStateRef.current = null; window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
              window.addEventListener('pointermove', onMove)
              window.addEventListener('pointerup', onUp)
            }}
          />
          <button
            type="button"
            aria-label="Ecke ziehen"
            className="absolute -right-1.5 -bottom-1.5 h-3.5 w-3.5 rounded bg-accent shadow-sm cursor-nwse-resize"
            onPointerDown={(e) => {
              e.stopPropagation()
              const parent = e.currentTarget.parentElement
              if (!parent || !onResizeTo) return
              const rect = parent.getBoundingClientRect()
              resizeStateRef.current = {
                mode: 'corner',
                startX: e.clientX, startY: e.clientY,
                startW: widget.size.w, startH: widget.size.h,
                unitW: rect.width / Math.max(1, widget.size.w),
                unitH: rect.height / Math.max(1, widget.size.h),
              }
              const onMove = (ev: PointerEvent) => {
                if (!resizeStateRef.current) return
                const dx = ev.clientX - resizeStateRef.current.startX
                const dy = ev.clientY - resizeStateRef.current.startY
                const widthDelta = Math.round(dx / resizeStateRef.current.unitW)
                const heightDelta = Math.round(dy / resizeStateRef.current.unitH)
                const maxW = Math.max(1, maxCols - widget.position.x)
                onResizeTo(
                  Math.max(1, Math.min(maxW, resizeStateRef.current.startW + widthDelta)),
                  Math.max(1, Math.min(maxRows, resizeStateRef.current.startH + heightDelta)),
                )
              }
              const onUp = () => { resizeStateRef.current = null; window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
              window.addEventListener('pointermove', onMove)
              window.addEventListener('pointerup', onUp)
            }}
          />
        </>
      )}

      {/* WYSIWYG preview */}
      <div className={`pointer-events-none h-full ${widget.config?.transparentBackground ? 'widget-transparent' : ''}`}>
        <RenderWidget
          widget={widget}
          entities={entities}
          onUpdate={() => {}}
          userName={userName}
          weatherEntity={weatherEntity}
          lightEntities={lightEntities}
        />
      </div>

      {/* Unconfigured overlay */}
      {isUnconfigured && (
        <UnconfiguredOverlay onConfigure={() => onConfigure?.()} />
      )}

      {/* Edit overlay */}
      <div className={`
        absolute inset-0 rounded-2xl transition-all pointer-events-none
        ${isSelected ? 'bg-accent/5' : 'bg-transparent group-hover:bg-foreground/5'}
      `}>
        <div className={`
          absolute top-2 right-2 px-2 py-0.5 rounded-md text-[10px] font-medium backdrop-blur-sm transition-opacity
          ${isSelected
            ? 'bg-accent/20 text-accent opacity-100'
            : 'bg-black/30 text-white/80 opacity-0 group-hover:opacity-100'
          }
        `}>
          {def?.label || widget.type}
        </div>
        <div className={`
          absolute bottom-2 left-2 px-1.5 py-0.5 rounded text-[9px] font-mono backdrop-blur-sm transition-opacity
          ${isSelected
            ? 'bg-accent/15 text-accent/70 opacity-100'
            : 'opacity-0 group-hover:opacity-60 bg-black/20 text-white/60'
          }
        `}>
          {widget.position.x},{widget.position.y}
        </div>
      </div>
    </div>
  )
}

// ----- Visibility rule types for group-level config -----
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

// ----- Group Visibility Panel -----
function GroupVisibilityPanel({
  groupWidget,
  availableEntities,
  onUpdateGroup,
}: {
  groupWidget: DashboardWidget
  availableEntities: EntityState[]
  onUpdateGroup: (updates: Partial<DashboardWidget>) => void
}) {
  const [expanded, setExpanded] = useState(true)

  const conditions = Array.isArray(groupWidget.config?.visibilityConditions)
    ? groupWidget.config?.visibilityConditions as VisibilityConditionRule[]
    : []
  const exceptions = Array.isArray(groupWidget.config?.visibilityExceptions)
    ? groupWidget.config?.visibilityExceptions as VisibilityConditionRule[]
    : []
  const condOp = String(groupWidget.config?.visibilityConditionOperator || 'all') === 'any' ? 'any' : 'all'
  const excOp = String(groupWidget.config?.visibilityExceptionOperator || 'any') === 'all' ? 'all' : 'any'

  const updateConfig = (updates: Record<string, unknown>) => {
    onUpdateGroup({ config: { ...groupWidget.config, ...updates } })
  }

  const addRule = (key: 'visibilityConditions' | 'visibilityExceptions') => {
    const current = key === 'visibilityConditions' ? conditions : exceptions
    updateConfig({ [key]: [...current, { mode: 'when_time_between' }] })
  }

  const updateRule = (key: 'visibilityConditions' | 'visibilityExceptions', index: number, updates: Partial<VisibilityConditionRule>) => {
    const current = key === 'visibilityConditions' ? conditions : exceptions
    updateConfig({ [key]: current.map((r, i) => (i === index ? { ...r, ...updates } : r)) })
  }

  const removeRule = (key: 'visibilityConditions' | 'visibilityExceptions', index: number) => {
    const current = key === 'visibilityConditions' ? conditions : exceptions
    updateConfig({ [key]: current.filter((_, i) => i !== index) })
  }

  const renderRule = (rule: VisibilityConditionRule, key: 'visibilityConditions' | 'visibilityExceptions', index: number) => {
    const mode = (rule.mode || 'always') as VisibilityMode
    return (
      <div key={`${key}-${index}`} className="rounded-xl border border-foreground/10 bg-foreground/[0.03] p-2.5 space-y-2">
        <div className="flex items-center gap-2">
          <select
            value={mode}
            onChange={(e) => updateRule(key, index, { mode: e.target.value as VisibilityMode })}
            className="flex-1 px-2 py-1.5 rounded-lg bg-foreground/5 border border-foreground/10 text-foreground text-xs"
          >
            {VISIBILITY_MODES.map(({ key: mk, label }) => (
              <option key={mk} value={mk}>{label}</option>
            ))}
          </select>
          <button onClick={() => removeRule(key, index)} className="p-1.5 rounded-md hover:bg-red-500/10 text-red-400/80 hover:text-red-400">
            <Trash size={13} weight="bold" />
          </button>
        </div>

        {(['when_entity_state', 'when_entity_not_state', 'when_entity_state_in', 'when_entity_numeric', 'when_recently_changed'] as readonly string[]).includes(mode) && (
          <SearchableSelect
            value={rule.entityId || ''}
            onValueChange={(v) => updateRule(key, index, { entityId: v })}
            placeholder="Entity fuer Bedingung"
            searchPlaceholder="Entity suchen..."
            emptyMessage="Keine Entities."
            options={availableEntities.map(e => ({
              value: e.entity_id,
              label: (e.attributes?.friendly_name as string) || e.entity_id,
              description: e.entity_id,
            }))}
          />
        )}

        {(['when_entity_state', 'when_entity_not_state'] as readonly string[]).includes(mode) && (
          <input type="text" value={rule.state || ''} onChange={(e) => updateRule(key, index, { state: e.target.value })} placeholder="z.B. on, off, playing" className="w-full px-2.5 py-2 rounded-xl bg-foreground/5 border border-foreground/10 text-foreground text-xs" />
        )}

        {mode === 'when_entity_state_in' && (
          <input type="text" value={rule.states || ''} onChange={(e) => updateRule(key, index, { states: e.target.value })} placeholder="on, playing, heat" className="w-full px-2.5 py-2 rounded-xl bg-foreground/5 border border-foreground/10 text-foreground text-xs" />
        )}

        {mode === 'when_entity_numeric' && (
          <div className="grid grid-cols-2 gap-2">
            <select value={(rule.numericOperator as string) || 'gte'} onChange={(e) => updateRule(key, index, { numericOperator: e.target.value as NumericOperator })} className="w-full px-2.5 py-2 rounded-xl bg-foreground/5 border border-foreground/10 text-foreground text-xs">
              <option value="lt">&lt; kleiner</option>
              <option value="lte">&lt;= kleiner/gleich</option>
              <option value="eq">= gleich</option>
              <option value="gte">&gt;= groesser/gleich</option>
              <option value="gt">&gt; groesser</option>
            </select>
            <input type="number" value={rule.numericValue ?? ''} onChange={(e) => updateRule(key, index, { numericValue: e.target.value === '' ? '' : Number(e.target.value) })} placeholder="Wert" className="w-full px-2.5 py-2 rounded-xl bg-foreground/5 border border-foreground/10 text-foreground text-xs" />
          </div>
        )}

        {mode === 'when_recently_changed' && (
          <input type="number" min={1} value={rule.changedWithinMinutes ?? 10} onChange={(e) => updateRule(key, index, { changedWithinMinutes: e.target.value === '' ? '' : Number(e.target.value) })} placeholder="Minuten" className="w-full px-2.5 py-2 rounded-xl bg-foreground/5 border border-foreground/10 text-foreground text-xs" />
        )}

        {mode === 'when_time_between' && (
          <div className="grid grid-cols-2 gap-2">
            <input type="time" value={rule.startTime || '16:00'} onChange={(e) => updateRule(key, index, { startTime: e.target.value })} className="w-full px-2.5 py-2 rounded-xl bg-foreground/5 border border-foreground/10 text-foreground text-xs" />
            <input type="time" value={rule.endTime || '22:00'} onChange={(e) => updateRule(key, index, { endTime: e.target.value })} className="w-full px-2.5 py-2 rounded-xl bg-foreground/5 border border-foreground/10 text-foreground text-xs" />
          </div>
        )}

        {mode === 'when_weekday' && (
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAY_OPTIONS.map(({ d, l }) => {
              const sel = Array.isArray(rule.weekdays) ? rule.weekdays : []
              const on = sel.includes(d)
              return (
                <button key={d} onClick={() => updateRule(key, index, { weekdays: on ? sel.filter(v => v !== d) : [...sel, d] })}
                  className={`px-1 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${on ? 'bg-accent/20 text-accent border border-accent/30' : 'bg-foreground/5 text-foreground/55 border border-foreground/10 hover:bg-foreground/10'}`}
                >{l}</button>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  const hasRules = conditions.length > 0 || exceptions.length > 0

  return (
    <div className="border-b border-foreground/10">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-5 py-2.5 flex items-center justify-between hover:bg-foreground/[0.03] transition-colors"
      >
        <div className="flex items-center gap-2">
          {hasRules ? <Eye size={16} weight="bold" className="text-accent" /> : <EyeSlash size={16} className="text-foreground/30" />}
          <span className="text-xs font-semibold text-foreground/70">Gruppen-Sichtbarkeit</span>
          {hasRules && (
            <span className="px-1.5 py-0.5 rounded bg-accent/15 text-accent text-[10px] font-bold">
              {conditions.length + exceptions.length} Regel{conditions.length + exceptions.length !== 1 ? 'n' : ''}
            </span>
          )}
        </div>
        {expanded ? <CaretUp size={14} className="text-foreground/40" /> : <CaretDown size={14} className="text-foreground/40" />}
      </button>

      {expanded && (
        <div className="px-5 pb-3 space-y-3">
          <p className="text-[11px] text-foreground/45">
            Lege fest, wann diese gesamte Gruppe auf der Seite angezeigt wird.
          </p>

          {/* Conditions */}
          <div className="rounded-xl border border-foreground/10 p-2.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-foreground/60">Anzeigen wenn</span>
              <div className="flex items-center gap-2">
                <select value={condOp} onChange={(e) => updateConfig({ visibilityConditionOperator: e.target.value })} className="px-2 py-1 rounded-md bg-foreground/5 border border-foreground/10 text-[11px]">
                  <option value="all">ALLE zutreffen</option>
                  <option value="any">MINDESTENS EINE</option>
                </select>
                <button onClick={() => addRule('visibilityConditions')} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-accent/15 text-accent text-[11px] font-medium hover:bg-accent/20">
                  <Plus size={11} weight="bold" /> Regel
                </button>
              </div>
            </div>
            {conditions.length === 0 ? (
              <p className="text-[11px] text-foreground/40">Keine Bedingungen: Gruppe ist immer sichtbar.</p>
            ) : (
              <div className="space-y-2">{conditions.map((r, i) => renderRule(r, 'visibilityConditions', i))}</div>
            )}
          </div>

          {/* Exceptions */}
          <div className="rounded-xl border border-foreground/10 p-2.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-foreground/60">Ausser wenn</span>
              <div className="flex items-center gap-2">
                <select value={excOp} onChange={(e) => updateConfig({ visibilityExceptionOperator: e.target.value })} className="px-2 py-1 rounded-md bg-foreground/5 border border-foreground/10 text-[11px]">
                  <option value="any">IRGENDEINE</option>
                  <option value="all">ALLE Ausnahmen</option>
                </select>
                <button onClick={() => addRule('visibilityExceptions')} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-foreground/10 text-foreground/70 text-[11px] font-medium hover:bg-foreground/15">
                  <Plus size={11} weight="bold" /> Ausnahme
                </button>
              </div>
            </div>
            {exceptions.length === 0 ? (
              <p className="text-[11px] text-foreground/40">Keine Ausnahmen.</p>
            ) : (
              <div className="space-y-2">{exceptions.map((r, i) => renderRule(r, 'visibilityExceptions', i))}</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ----- Main Group Designer -----

export function WidgetGroupDesignerDialog({
  open,
  onOpenChange,
  groupWidget,
  availableEntities,
  userName,
  weatherEntity,
  lightEntities,
  onUpdateGroupWidget,
}: WidgetGroupDesignerDialogProps) {
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null)
  const [activeDragType, setActiveDragType] = useState<WidgetType | null>(null)
  const [activeDragWidgetId, setActiveDragWidgetId] = useState<string | null>(null)

  const groupColumns = Math.max(MIN_COLS, Math.min(MAX_COLS, Number(groupWidget.config?.groupColumns || 2)))
  const groupWidgets = useMemo(() => {
    const raw = Array.isArray(groupWidget.config?.widgets) ? groupWidget.config?.widgets as DashboardWidget[] : []
    return [...raw].sort((a, b) => {
      if (a.position.y !== b.position.y) return a.position.y - b.position.y
      return a.position.x - b.position.x
    })
  }, [groupWidget.config?.widgets])

  const selectedWidget = groupWidgets.find((widget) => widget.id === selectedWidgetId)

  // Lock body scroll
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = '' }
    }
  }, [open])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  // Grid rows
  const gridRows = useMemo(() => {
    const maxY = groupWidgets.reduce((max, w) => Math.max(max, w.position.y + w.size.h), 0)
    return Math.max(MIN_ROWS, maxY + 2)
  }, [groupWidgets])

  // Occupancy
  const occupancyMap = useMemo(() => {
    return buildOccupancyMap(groupWidgets, groupColumns, gridRows)
  }, [groupWidgets, groupColumns, gridRows])

  const updateGroupWidgets = useCallback((nextWidgets: DashboardWidget[]) => {
    onUpdateGroupWidget(groupWidget.id, {
      config: { ...groupWidget.config, widgets: nextWidgets },
    })
  }, [onUpdateGroupWidget, groupWidget.id, groupWidget.config])

  const handleAddWidget = useCallback((type: WidgetType, entityId?: string) => {
    const def = getWidgetDef(type)
    const defaultSize = def?.defaultSize || { w: 1, h: 1 }
    const position = findFirstAvailablePosition(groupWidgets, defaultSize, groupColumns)

    const newWidget: DashboardWidget = {
      id: `group-widget-${Date.now()}`,
      type,
      entity_id: entityId || undefined,
      position,
      size: { ...defaultSize },
      config: {},
    }

    updateGroupWidgets([...groupWidgets, newWidget])
    setSelectedWidgetId(newWidget.id)
  }, [groupWidgets, groupColumns, updateGroupWidgets])

  const handleAddWidgetAtCell = useCallback((type: WidgetType, col: number, row: number, entityId?: string) => {
    const def = getWidgetDef(type)
    const defaultSize = def?.defaultSize || { w: 1, h: 1 }

    const newWidget: DashboardWidget = {
      id: `group-widget-${Date.now()}`,
      type,
      entity_id: entityId || undefined,
      position: { x: col, y: row },
      size: { w: Math.min(defaultSize.w, groupColumns - col), h: defaultSize.h },
      config: {},
    }

    updateGroupWidgets([...groupWidgets, newWidget])
    setSelectedWidgetId(newWidget.id)
  }, [groupWidgets, groupColumns, updateGroupWidgets])

  const handleUpdateWidget = useCallback((widgetId: string, updates: Partial<DashboardWidget>) => {
    updateGroupWidgets(groupWidgets.map((w) =>
      w.id === widgetId ? { ...w, ...updates } : w
    ))
  }, [groupWidgets, updateGroupWidgets])

  const handleDeleteWidget = useCallback((widgetId: string) => {
    updateGroupWidgets(groupWidgets.filter((w) => w.id !== widgetId))
    if (selectedWidgetId === widgetId) setSelectedWidgetId(null)
  }, [groupWidgets, updateGroupWidgets, selectedWidgetId])

  const handleResizeWidget = useCallback((widgetId: string, dimension: 'w' | 'h', delta: number) => {
    updateGroupWidgets(groupWidgets.map((w) => {
      if (w.id !== widgetId) return w
      const nextSize = { ...w.size }
      if (dimension === 'w') {
        nextSize.w = Math.max(1, Math.min(groupColumns - w.position.x, nextSize.w + delta))
      } else {
        nextSize.h = Math.max(1, Math.min(MAX_WIDGET_HEIGHT, nextSize.h + delta))
      }
      return { ...w, size: nextSize }
    }))
  }, [groupWidgets, groupColumns, updateGroupWidgets])

  const handleResizeWidgetTo = useCallback((widgetId: string, nextW: number, nextH: number) => {
    updateGroupWidgets(groupWidgets.map((w) => {
      if (w.id !== widgetId) return w
      const maxW = Math.max(1, groupColumns - w.position.x)
      return { ...w, size: { w: Math.max(1, Math.min(maxW, nextW)), h: Math.max(1, Math.min(MAX_WIDGET_HEIGHT, nextH)) } }
    }))
  }, [groupWidgets, groupColumns, updateGroupWidgets])

  const handleMoveWidget = useCallback((widgetId: string, col: number, row: number) => {
    updateGroupWidgets(groupWidgets.map((w) => {
      if (w.id !== widgetId) return w
      return {
        ...w,
        position: { x: col, y: row },
        size: { ...w.size, w: Math.min(w.size.w, groupColumns - col) },
      }
    }))
  }, [groupWidgets, groupColumns, updateGroupWidgets])

  const handleColumnsChange = useCallback((delta: number) => {
    const next = Math.max(MIN_COLS, Math.min(MAX_COLS, groupColumns + delta))
    onUpdateGroupWidget(groupWidget.id, {
      config: {
        ...groupWidget.config,
        groupColumns: next,
        widgets: groupWidgets.map((w) => {
          const x = Math.min(w.position.x, next - 1)
          return { ...w, position: { ...w.position, x }, size: { ...w.size, w: Math.min(w.size.w, next - x) } }
        }),
      },
    })
  }, [groupColumns, groupWidget.id, groupWidget.config, groupWidgets, onUpdateGroupWidget])

  const handleUpdateGroup = useCallback((updates: Partial<DashboardWidget>) => {
    onUpdateGroupWidget(groupWidget.id, updates)
  }, [onUpdateGroupWidget, groupWidget.id])

  // DnD handlers
  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event
    if (active.data.current?.origin === 'palette') {
      setActiveDragType(active.data.current.widgetType as WidgetType)
      setActiveDragWidgetId(null)
    } else if (active.data.current?.origin === 'canvas') {
      setActiveDragWidgetId(active.data.current.widgetId as string)
      setActiveDragType(null)
    } else {
      setActiveDragType(null)
      setActiveDragWidgetId(null)
    }
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragType(null)
    setActiveDragWidgetId(null)
    const { active, over } = event
    if (!over) return

    if (over.data.current?.type === 'cell') {
      const col = over.data.current.col as number
      const row = over.data.current.row as number

      if (active.data.current?.origin === 'palette') {
        handleAddWidgetAtCell(active.data.current.widgetType as WidgetType, col, row)
        return
      }
      if (active.data.current?.origin === 'canvas') {
        handleMoveWidget(active.data.current.widgetId as string, col, row)
        return
      }
    }

    if (active.data.current?.origin === 'palette') {
      handleAddWidget(active.data.current.widgetType as WidgetType)
    }
  }

  const handleCellClick = useCallback(() => {
    setSelectedWidgetId(null)
  }, [])

  // Render grid canvas
  const renderGridCanvas = () => {
    const cells: React.ReactNode[] = []

    for (const widget of groupWidgets) {
      cells.push(
        <GroupCanvasWidget
          key={widget.id}
          widget={widget}
          isSelected={selectedWidgetId === widget.id}
          onSelect={() => setSelectedWidgetId(widget.id)}
          onDelete={() => handleDeleteWidget(widget.id)}
          onResizeWidth={(delta) => handleResizeWidget(widget.id, 'w', delta)}
          onResizeHeight={(delta) => handleResizeWidget(widget.id, 'h', delta)}
          onResizeTo={(nw, nh) => handleResizeWidgetTo(widget.id, nw, nh)}
          onConfigure={() => setSelectedWidgetId(widget.id)}
          maxCols={groupColumns}
          maxRows={Math.max(MAX_WIDGET_HEIGHT, gridRows + 2)}
          entities={availableEntities}
          userName={userName}
          weatherEntity={weatherEntity}
          lightEntities={lightEntities}
        />
      )
    }

    for (let row = 0; row < gridRows; row++) {
      for (let col = 0; col < groupColumns; col++) {
        if (occupancyMap[row]?.[col] === null) {
          cells.push(
            <EmptyCell key={`empty-${col}-${row}`} col={col} row={row} onClick={handleCellClick} />
          )
        }
      }
    }

    return cells
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 h-[100dvh] max-h-[100dvh] bg-background/95 backdrop-blur-2xl z-[60] overflow-hidden"
        >
          <div className="h-full flex flex-col overflow-hidden">
            {/* Top bar */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-foreground/10">
              <div className="flex items-center gap-3">
                <GridFour size={24} weight="fill" className="text-accent" />
                <div>
                  <h1 className="text-lg font-semibold text-foreground">
                    {String(groupWidget.label || groupWidget.config?.groupName || 'Widget-Gruppe')}
                  </h1>
                  <p className="text-xs text-foreground/40">
                    Gruppen-Designer &mdash; {groupWidgets.length} Widget{groupWidgets.length !== 1 ? 's' : ''} &mdash; {groupColumns} Spalten
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {/* Column controls */}
                <div className="flex items-center gap-1 rounded-lg bg-foreground/5 px-2.5 py-1.5">
                  <span className="text-[10px] text-foreground/50 mr-1">Spalten</span>
                  <button
                    onClick={() => handleColumnsChange(-1)}
                    disabled={groupColumns <= MIN_COLS}
                    className="p-0.5 rounded hover:bg-foreground/10 text-foreground/60 disabled:opacity-30"
                  >
                    <Minus size={12} weight="bold" />
                  </button>
                  <span className="text-xs font-medium text-foreground min-w-4 text-center">{groupColumns}</span>
                  <button
                    onClick={() => handleColumnsChange(1)}
                    disabled={groupColumns >= MAX_COLS}
                    className="p-0.5 rounded hover:bg-foreground/10 text-foreground/60 disabled:opacity-30"
                  >
                    <Plus size={12} weight="bold" />
                  </button>
                </div>

                <button
                  onClick={() => onOpenChange(false)}
                  className="p-2 rounded-lg hover:bg-foreground/10 text-foreground/60 hover:text-foreground transition-colors"
                >
                  <X size={24} weight="bold" />
                </button>
              </div>
            </div>

            {/* Group visibility panel */}
            <GroupVisibilityPanel
              groupWidget={groupWidget}
              availableEntities={availableEntities}
              onUpdateGroup={handleUpdateGroup}
            />

            {/* Main content: Canvas + Palette */}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <div className="flex-1 flex overflow-hidden min-h-0">
                {/* Center - Grid Canvas */}
                <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                  <div
                    className="flex-1 overflow-y-auto p-4 sm:p-5"
                    onClick={() => setSelectedWidgetId(null)}
                    style={{
                      background: 'linear-gradient(180deg, oklch(0.2 0.01 260 / 0.3) 0%, transparent 100%)',
                    }}
                  >
                    {groupWidgets.length === 0 && (
                      <div className="glass-card rounded-2xl p-12 text-center mb-4">
                        <GridFour size={40} weight="light" className="mx-auto text-foreground/20 mb-3" />
                        <p className="text-sm text-foreground/55">Keine Widgets in dieser Gruppe</p>
                        <p className="text-xs text-foreground/35 mt-1">Widgets rechts hinzufuegen oder per Drag &amp; Drop platzieren.</p>
                      </div>
                    )}

                    <div
                      className="grid gap-2.5"
                      style={{
                        gridTemplateColumns: `repeat(${groupColumns}, 1fr)`,
                        gridTemplateRows: `repeat(${gridRows}, minmax(64px, auto))`,
                      }}
                    >
                      {renderGridCanvas()}
                    </div>
                  </div>
                </div>

                {/* Right sidebar - Widget palette / properties */}
                <WidgetPalette
                  selectedWidget={selectedWidget}
                  availableEntities={availableEntities}
                  allWidgets={groupWidgets}
                  gridCols={groupColumns}
                  onAddWidget={handleAddWidget}
                  onUpdateWidget={handleUpdateWidget}
                  onResizeWidget={handleResizeWidget}
                  onDeleteWidget={handleDeleteWidget}
                  onMoveWidget={handleMoveWidget}
                />
              </div>

              {/* Drag overlay */}
              <DragOverlay dropAnimation={null}>
                {activeDragType ? <DragOverlayPreview widgetType={activeDragType} /> : null}
                {activeDragWidgetId ? (
                  <div className="px-4 py-2 rounded-xl bg-accent/20 text-accent text-sm font-medium backdrop-blur-sm border border-accent/30 shadow-lg">
                    Widget verschieben
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
