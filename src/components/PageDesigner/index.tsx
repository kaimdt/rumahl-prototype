import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  Plus,
  Minus,
  PencilSimple,
  Trash,
  ArrowUp,
  ArrowDown,
  House,
  Lightbulb,
  Thermometer,
  PlugsConnected,
  Gauge,
  Gear,
  FloppyDisk,
  VideoCamera,
  SpeakerHigh,
  Lock,
  Garage,
  Fan,
  Bathtub,
  GridFour,
  CaretLeft,
  Star,
  Bed,
  CookingPot,
  Couch,
  Desktop,
  Tree,
  Door,
  ShieldCheck,
  Drop,
  Lightning,
  WifiHigh,
  Broadcast,
  Baby,
  Dog,
  Car,
  Sun,
  Moon,
  FireSimple,
  Swatches,
  DotsSixVertical,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  ArrowCounterClockwise,
  ArrowClockwise,
  Eye,
  EyeSlash,
  ArrowsOutSimple,
  Command,
  Copy,
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
import { usePageNavigation } from '@/contexts/PageNavigationContext'
import { RenderWidget } from '@/components/CustomPageRenderer'
import { WidgetPalette } from './WidgetPalette'
import { WidgetGroupDesignerDialog } from './WidgetGroupDesignerDialog'
import { TemplatePickerModal } from './TemplatePickerModal'
import { FloatingToolbar } from './FloatingToolbar'
import { DragOverlayPreview } from './DragOverlayPreview'
import { UnconfiguredOverlay } from './UnconfiguredOverlay'
import { getWidgetDef } from '@/lib/widgetRegistry'
import { getCardStyleClass } from '@/lib/defaults'
import type { DashboardPage, DashboardWidget, EntityState, WidgetType, LightEntity, WeatherEntity } from '@/lib/types'
import { toast } from 'sonner'

interface PageDesignerProps {
  isOpen: boolean
  onClose: () => void
  availableEntities?: EntityState[]
  userName?: string
  weatherEntity?: WeatherEntity
  lightEntities?: LightEntity[]
}

const GRID_COLS = 6
const MIN_ROWS = 6
const MIN_COLS = 2
const MAX_COLS = 8
const MAX_WIDGET_HEIGHT = 12
const MAX_UNDO_HISTORY = 30

interface PageLayoutSettings {
  cols: number
  rows: number
  gap: number
}

const availableIcons = {
  House,
  Lightbulb,
  Thermometer,
  PlugsConnected,
  Gauge,
  Gear,
  FloppyDisk,
  VideoCamera,
  SpeakerHigh,
  Lock,
  Garage,
  Fan,
  Bathtub,
  Bed,
  CookingPot,
  Couch,
  Desktop,
  Tree,
  Door,
  ShieldCheck,
  Drop,
  Lightning,
  WifiHigh,
  Broadcast,
  Baby,
  Dog,
  Car,
  Sun,
  Moon,
  FireSimple,
} as const

const iconLabels: Record<keyof typeof availableIcons, string> = {
  House: 'Haus',
  Lightbulb: 'Licht',
  Thermometer: 'Temperatur',
  PlugsConnected: 'Stecker',
  Gauge: 'Sensor',
  Gear: 'Einstellungen',
  FloppyDisk: 'Speicher',
  VideoCamera: 'Kamera',
  SpeakerHigh: 'Lautsprecher',
  Lock: 'Schloss',
  Garage: 'Garage',
  Fan: 'Lüfter',
  Bathtub: 'Bad',
  Bed: 'Schlafzimmer',
  CookingPot: 'Küche',
  Couch: 'Wohnzimmer',
  Desktop: 'Büro',
  Tree: 'Garten',
  Door: 'Eingang',
  ShieldCheck: 'Sicherheit',
  Drop: 'Wasser',
  Lightning: 'Energie',
  WifiHigh: 'Netzwerk',
  Broadcast: 'Medien',
  Baby: 'Kinderzimmer',
  Dog: 'Haustier',
  Car: 'Fahrzeug',
  Sun: 'Sonne',
  Moon: 'Mond',
  FireSimple: 'Heizung',
}

// Build an occupancy map: for each cell (row, col), which widget occupies it
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

// Find the first available position for a new widget
function findFirstAvailablePosition(
  widgets: DashboardWidget[],
  size: { w: number; h: number },
  cols: number,
  maxRows: number
): { x: number; y: number } {
  const map = buildOccupancyMap(widgets, cols, maxRows + 4)
  for (let row = 0; row < maxRows + 4; row++) {
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
  return { x: 0, y: maxRows }
}

// Droppable empty cell
function EmptyCell({ col, row, onClick }: { col: number; row: number; onClick: () => void }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `cell-${col}-${row}`,
    data: { type: 'cell', col, row },
  })

  return (
    <div
      ref={setNodeRef}
      onClick={(e) => { e.stopPropagation(); onClick() }}
      className={`
        rounded-xl border border-dashed transition-all cursor-pointer min-h-[64px]
        ${isOver
          ? 'border-accent/50 bg-accent/10 scale-[1.02]'
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

// Canvas widget placed at explicit grid position
function CanvasWidget({
  widget,
  isSelected,
  previewMode,
  onSelect,
  onDelete,
  onDuplicate,
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
  previewMode: boolean
  onSelect: () => void
  onDelete: () => void
  onDuplicate: () => void
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
    id: `canvas-${widget.id}`,
    data: { origin: 'canvas', widgetId: widget.id },
    disabled: previewMode,
  })

  if (previewMode) {
    return (
      <div
        className="min-h-[64px]"
        style={{
          gridColumnStart: widget.position.x + 1,
          gridColumnEnd: `span ${Math.min(widget.size.w, maxCols - widget.position.x)}`,
          gridRowStart: widget.position.y + 1,
          gridRowEnd: `span ${widget.size.h}`,
        }}
      >
        <div className={[
          'h-full',
          widget.config?.transparentBackground ? 'widget-transparent' : '',
          getCardStyleClass(widget.config?.cardStyle as string | undefined),
        ].filter(Boolean).join(' ')}>
          <RenderWidget
            widget={widget}
            entities={entities}
            onUpdate={() => {}}
            userName={userName}
            weatherEntity={weatherEntity}
            lightEntities={lightEntities}
          />
        </div>
      </div>
    )
  }

  return (
    <div
      ref={setNodeRef}
      onClick={(e) => {
        e.stopPropagation()
        onSelect()
      }}
      className={`
        relative transition-all group min-h-[64px]
        ${isSelected
          ? 'ring-2 ring-accent rounded-2xl z-10'
          : 'hover:ring-1 hover:ring-foreground/20 rounded-2xl'
        }
        ${isDragging ? 'opacity-40 scale-95' : ''}
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

      {/* Floating toolbar for selected widget */}
      {isSelected && (
        <FloatingToolbar
          onConfigure={onConfigure}
          onResizeWidth={onResizeWidth}
          onResizeHeight={onResizeHeight}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
          widgetSize={widget.size}
          maxWidth={Math.max(1, maxCols - widget.position.x)}
          maxHeight={maxRows}
        />
      )}

      {isSelected && (
        <>
          <button
            type="button"
            aria-label="Breite ziehen"
            className="absolute top-1/2 -right-1.5 -translate-y-1/2 h-12 w-2 rounded-full bg-accent/70 shadow-sm cursor-ew-resize hover:bg-accent transition-colors"
            onPointerDown={(e) => {
              e.stopPropagation()
              const parent = e.currentTarget.parentElement
              if (!parent || !onResizeTo) return
              const rect = parent.getBoundingClientRect()
              resizeStateRef.current = {
                mode: 'right',
                startX: e.clientX,
                startY: e.clientY,
                startW: widget.size.w,
                startH: widget.size.h,
                unitW: rect.width / Math.max(1, widget.size.w),
                unitH: rect.height / Math.max(1, widget.size.h),
              }

              const onMove = (event: PointerEvent) => {
                if (!resizeStateRef.current) return
                const dx = event.clientX - resizeStateRef.current.startX
                const maxWidth = Math.max(1, maxCols - widget.position.x)
                const nextW = Math.max(1, Math.min(maxWidth, resizeStateRef.current.startW + Math.round(dx / resizeStateRef.current.unitW)))
                onResizeTo(nextW, resizeStateRef.current.startH)
              }

              const onUp = () => {
                resizeStateRef.current = null
                window.removeEventListener('pointermove', onMove)
                window.removeEventListener('pointerup', onUp)
              }

              window.addEventListener('pointermove', onMove)
              window.addEventListener('pointerup', onUp)
            }}
          />
          <button
            type="button"
            aria-label="Höhe ziehen"
            className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 h-2 w-12 rounded-full bg-accent/70 shadow-sm cursor-ns-resize hover:bg-accent transition-colors"
            onPointerDown={(e) => {
              e.stopPropagation()
              const parent = e.currentTarget.parentElement
              if (!parent || !onResizeTo) return
              const rect = parent.getBoundingClientRect()
              resizeStateRef.current = {
                mode: 'bottom',
                startX: e.clientX,
                startY: e.clientY,
                startW: widget.size.w,
                startH: widget.size.h,
                unitW: rect.width / Math.max(1, widget.size.w),
                unitH: rect.height / Math.max(1, widget.size.h),
              }

              const onMove = (event: PointerEvent) => {
                if (!resizeStateRef.current) return
                const dy = event.clientY - resizeStateRef.current.startY
                const nextH = Math.max(1, Math.min(maxRows, resizeStateRef.current.startH + Math.round(dy / resizeStateRef.current.unitH)))
                onResizeTo(resizeStateRef.current.startW, nextH)
              }

              const onUp = () => {
                resizeStateRef.current = null
                window.removeEventListener('pointermove', onMove)
                window.removeEventListener('pointerup', onUp)
              }

              window.addEventListener('pointermove', onMove)
              window.addEventListener('pointerup', onUp)
            }}
          />
          <button
            type="button"
            aria-label="Breite und Höhe ziehen"
            className="absolute -right-1.5 -bottom-1.5 h-3.5 w-3.5 rounded bg-accent shadow-sm cursor-nwse-resize hover:bg-accent/80 transition-colors"
            onPointerDown={(e) => {
              e.stopPropagation()
              const parent = e.currentTarget.parentElement
              if (!parent || !onResizeTo) return
              const rect = parent.getBoundingClientRect()
              resizeStateRef.current = {
                mode: 'corner',
                startX: e.clientX,
                startY: e.clientY,
                startW: widget.size.w,
                startH: widget.size.h,
                unitW: rect.width / Math.max(1, widget.size.w),
                unitH: rect.height / Math.max(1, widget.size.h),
              }

              const onMove = (event: PointerEvent) => {
                if (!resizeStateRef.current) return
                const dx = event.clientX - resizeStateRef.current.startX
                const dy = event.clientY - resizeStateRef.current.startY
                const maxWidth = Math.max(1, maxCols - widget.position.x)
                const nextW = Math.max(1, Math.min(maxWidth, resizeStateRef.current.startW + Math.round(dx / resizeStateRef.current.unitW)))
                const nextH = Math.max(1, Math.min(maxRows, resizeStateRef.current.startH + Math.round(dy / resizeStateRef.current.unitH)))
                onResizeTo(nextW, nextH)
              }

              const onUp = () => {
                resizeStateRef.current = null
                window.removeEventListener('pointermove', onMove)
                window.removeEventListener('pointerup', onUp)
              }

              window.addEventListener('pointermove', onMove)
              window.addEventListener('pointerup', onUp)
            }}
          />
        </>
      )}

      {/* WYSIWYG preview (pointer-events disabled) */}
      {(() => {
        const alignment = (widget.config?.alignment as 'left' | 'center' | 'right' | undefined) || 'left'
        return (
          <div className={[
            'pointer-events-none h-full',
            widget.config?.transparentBackground ? 'widget-transparent' : '',
            getCardStyleClass(widget.config?.cardStyle as string | undefined),
          ].filter(Boolean).join(' ')}>
            <div className={[
              alignment === 'center' ? 'mx-auto' : '',
              alignment === 'right' ? 'ml-auto' : '',
              alignment === 'left' ? 'w-full' : 'w-fit max-w-full',
            ].filter(Boolean).join(' ')}>
              <RenderWidget
                widget={widget}
                entities={entities}
                onUpdate={() => {}}
                userName={userName}
                weatherEntity={weatherEntity}
                lightEntities={lightEntities}
              />
            </div>
          </div>
        )
      })()}

      {/* Unconfigured overlay */}
      {isUnconfigured && (
        <UnconfiguredOverlay
          onConfigure={() => onConfigure?.()}
        />
      )}

      {/* Edit overlay */}
      <div className={`
        absolute inset-0 rounded-2xl transition-all pointer-events-none
        ${isSelected
          ? 'bg-accent/5'
          : 'bg-transparent group-hover:bg-foreground/5'
        }
      `}>
        {/* Type badge */}
        <div className={`
          absolute top-2 right-2 px-2 py-0.5 rounded-md text-[10px] font-medium backdrop-blur-sm transition-opacity
          ${isSelected
            ? 'bg-accent/20 text-accent opacity-100'
            : 'bg-black/30 text-white/80 opacity-0 group-hover:opacity-100'
          }
        `}>
          {def?.label || widget.type}
        </div>
        {/* Position badge */}
        <div className={`
          absolute bottom-2 left-2 px-1.5 py-0.5 rounded text-[9px] font-mono backdrop-blur-sm transition-opacity
          ${isSelected
            ? 'bg-accent/15 text-accent/70 opacity-100'
            : 'opacity-0 group-hover:opacity-60 bg-black/20 text-white/60'
          }
        `}>
          {widget.position.x},{widget.position.y} &middot; {widget.size.w}&times;{widget.size.h}
        </div>
      </div>
    </div>
  )
}

// Undo/redo history hook
function useUndoHistory(pages: DashboardPage[], setPages: (pages: DashboardPage[]) => void) {
  const undoStack = useRef<DashboardPage[][]>([])
  const redoStack = useRef<DashboardPage[][]>([])
  const lastSnapshot = useRef<string>('')

  const snapshot = useCallback(() => {
    const json = JSON.stringify(pages)
    if (json !== lastSnapshot.current) {
      undoStack.current.push(JSON.parse(lastSnapshot.current || json))
      if (undoStack.current.length > MAX_UNDO_HISTORY) undoStack.current.shift()
      redoStack.current = []
      lastSnapshot.current = json
    }
  }, [pages])

  // Take initial snapshot
  useEffect(() => {
    if (!lastSnapshot.current) {
      lastSnapshot.current = JSON.stringify(pages)
    }
  }, [pages])

  const undo = useCallback(() => {
    if (undoStack.current.length === 0) return
    const prev = undoStack.current.pop()!
    redoStack.current.push(JSON.parse(lastSnapshot.current))
    lastSnapshot.current = JSON.stringify(prev)
    setPages(prev)
  }, [setPages])

  const redo = useCallback(() => {
    if (redoStack.current.length === 0) return
    const next = redoStack.current.pop()!
    undoStack.current.push(JSON.parse(lastSnapshot.current))
    lastSnapshot.current = JSON.stringify(next)
    setPages(next)
  }, [setPages])

  return { snapshot, undo, redo, canUndo: undoStack.current.length > 0, canRedo: redoStack.current.length > 0 }
}

export function PageDesigner({
  isOpen,
  onClose,
  availableEntities = [],
  userName,
  weatherEntity,
  lightEntities,
}: PageDesignerProps) {
  const { pages, setPages } = usePageNavigation()
  const { snapshot, undo, redo, canUndo, canRedo } = useUndoHistory(pages, setPages)

  // Page management
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null)
  const [editingPageId, setEditingPageId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editIcon, setEditIcon] = useState<keyof typeof availableIcons>('House')
  const [editShowInNav, setEditShowInNav] = useState(true)
  const [showTemplatePicker, setShowTemplatePicker] = useState(false)
  const [templateApplyMode, setTemplateApplyMode] = useState(false)
  const [pageLayouts, setPageLayouts] = useState<Record<string, PageLayoutSettings>>(() => {
    try {
      const raw = localStorage.getItem('ha-page-designer-layouts')
      if (!raw) return {}
      return JSON.parse(raw) as Record<string, PageLayoutSettings>
    } catch {
      return {}
    }
  })

  // Widget management
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null)
  const [activeDragType, setActiveDragType] = useState<WidgetType | null>(null)
  const [activeDragWidgetId, setActiveDragWidgetId] = useState<string | null>(null)
  const [editingGroupWidgetId, setEditingGroupWidgetId] = useState<string | null>(null)
  const [canvasZoom, setCanvasZoom] = useState(100)
  const [previewMode, setPreviewMode] = useState(false)
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false)

  const selectedPage = pages.find((p) => p.id === selectedPageId)
  const selectedWidget = selectedPage?.widgets.find((w) => w.id === selectedWidgetId)
  const editingGroupWidget = selectedPage?.widgets.find((w) => w.id === editingGroupWidgetId)
  const currentLayout = selectedPage
    ? (pageLayouts[selectedPage.id] ?? { cols: GRID_COLS, rows: MIN_ROWS, gap: 10 })
    : { cols: GRID_COLS, rows: MIN_ROWS, gap: 10 }
  const currentGridCols = Math.max(MIN_COLS, Math.min(MAX_COLS, currentLayout.cols))
  const currentGap = currentLayout.gap ?? 10

  // Lock body scroll when designer is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = '' }
    }
  }, [isOpen])

  useEffect(() => {
    localStorage.setItem('ha-page-designer-layouts', JSON.stringify(pageLayouts))
  }, [pageLayouts])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  // Calculate grid rows needed
  const gridRows = useMemo(() => {
    if (!selectedPage) return MIN_ROWS
    const maxY = selectedPage.widgets.reduce(
      (max, w) => Math.max(max, w.position.y + w.size.h),
      0
    )
    return Math.max(MIN_ROWS, currentLayout.rows, maxY + 1)
  }, [selectedPage, currentLayout.rows])

  // Build occupancy map
  const occupancyMap = useMemo(() => {
    if (!selectedPage) return []
    return buildOccupancyMap(selectedPage.widgets, currentGridCols, gridRows)
  }, [selectedPage, currentGridCols, gridRows])

  // Delete a widget
  const handleDeleteWidget = useCallback((widgetId: string) => {
    if (!selectedPageId) return
    snapshot()
    const updatedPages = pages.map((p) =>
      p.id === selectedPageId
        ? { ...p, widgets: p.widgets.filter((w) => w.id !== widgetId) }
        : p
    )
    setPages(updatedPages)
    if (selectedWidgetId === widgetId) setSelectedWidgetId(null)
    toast.success('Widget gelöscht')
  }, [selectedPageId, pages, setPages, selectedWidgetId, snapshot])

  // Duplicate a widget
  const handleDuplicateWidget = useCallback((widgetId: string) => {
    if (!selectedPageId) return
    snapshot()
    const page = pages.find((p) => p.id === selectedPageId)
    if (!page) return
    const source = page.widgets.find((w) => w.id === widgetId)
    if (!source) return

    const position = findFirstAvailablePosition(
      page.widgets,
      source.size,
      currentGridCols,
      gridRows
    )

    const newWidget: DashboardWidget = {
      ...source,
      id: `widget-${Date.now()}`,
      position,
      config: source.config ? { ...source.config } : {},
    }

    const updatedPages = pages.map((p) =>
      p.id === selectedPageId ? { ...p, widgets: [...p.widgets, newWidget] } : p
    )
    setPages(updatedPages)
    setSelectedWidgetId(newWidget.id)
    toast.success('Widget dupliziert')
  }, [selectedPageId, pages, currentGridCols, gridRows, setPages, snapshot])

  // Keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      // Ignore when typing in inputs/textareas
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      if (e.key === 'Delete' && selectedWidgetId) {
        e.preventDefault()
        handleDeleteWidget(selectedWidgetId)
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        if (selectedWidgetId) {
          setSelectedWidgetId(null)
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'd' && selectedWidgetId) {
        e.preventDefault()
        handleDuplicateWidget(selectedWidgetId)
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
        e.preventDefault()
        redo()
      }
      if (e.key === 'p' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        setPreviewMode(prev => !prev)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, selectedWidgetId, handleDuplicateWidget, handleDeleteWidget, undo, redo])

  // Page CRUD
  const handleCreatePage = () => {
    setShowTemplatePicker(true)
  }

  const handleTemplateSelect = (newPage: DashboardPage) => {
    snapshot()
    setPages([...pages, newPage])
    setSelectedPageId(newPage.id)
    setShowTemplatePicker(false)
    toast.success('Neue Seite erstellt')
  }

  const handleEditPage = (page: DashboardPage) => {
    setEditingPageId(page.id)
    setEditName(page.name)
    setEditIcon(page.icon as keyof typeof availableIcons)
    setEditShowInNav(page.showInNav !== false)
  }

  const handleSavePageEdit = () => {
    if (!editingPageId) return
    snapshot()
    const updatedPages = pages.map((page) =>
      page.id === editingPageId
        ? { ...page, name: editName, icon: editIcon, showInNav: editShowInNav }
        : page
    )
    setPages(updatedPages)
    setEditingPageId(null)
    toast.success('Seite aktualisiert')
  }

  const handleDeletePage = (pageId: string) => {
    if (pageId === 'home' || pageId === 'settings') {
      toast.error('Systemseiten können nicht gelöscht werden')
      return
    }
    snapshot()
    const updatedPages = pages.filter((p) => p.id !== pageId)
    setPages(updatedPages)
    if (selectedPageId === pageId) setSelectedPageId(null)
    toast.success('Seite gelöscht')
  }

  const handleMovePage = (pageId: string, direction: 'up' | 'down') => {
    const currentIndex = pages.findIndex((p) => p.id === pageId)
    if (currentIndex === -1) return
    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
    if (newIndex < 0 || newIndex >= pages.length) return
    snapshot()
    const updatedPages = [...pages]
    const [movedPage] = updatedPages.splice(currentIndex, 1)
    updatedPages.splice(newIndex, 0, movedPage)
    setPages(updatedPages)
  }

  const updateSelectedPageLayout = useCallback((updates: Partial<PageLayoutSettings>) => {
    if (!selectedPage) return
    setPageLayouts((prev) => {
      const current = prev[selectedPage.id] ?? { cols: GRID_COLS, rows: MIN_ROWS, gap: 10 }
      return {
        ...prev,
        [selectedPage.id]: {
          cols: Math.max(MIN_COLS, Math.min(MAX_COLS, updates.cols ?? current.cols)),
          rows: Math.max(MIN_ROWS, updates.rows ?? current.rows),
          gap: Math.max(0, Math.min(24, updates.gap ?? current.gap)),
        },
      }
    })
  }, [selectedPage])

  const adjustSelectedPageColumns = useCallback((delta: number) => {
    if (!selectedPage) return
    const nextCols = Math.max(MIN_COLS, Math.min(MAX_COLS, currentGridCols + delta))

    snapshot()
    const updatedPages = pages.map((page) => {
      if (page.id !== selectedPage.id) return page
      return {
        ...page,
        widgets: page.widgets.map((widget) => {
          const newX = Math.min(widget.position.x, nextCols - 1)
          return {
            ...widget,
            position: { ...widget.position, x: newX },
            size: { ...widget.size, w: Math.min(widget.size.w, nextCols - newX) },
          }
        }),
      }
    })

    setPages(updatedPages)
    updateSelectedPageLayout({ cols: nextCols })
  }, [selectedPage, currentGridCols, pages, setPages, updateSelectedPageLayout, snapshot])

  const adjustSelectedPageRows = useCallback((delta: number) => {
    if (!selectedPage) return
    updateSelectedPageLayout({ rows: Math.max(MIN_ROWS, currentLayout.rows + delta) })
  }, [selectedPage, currentLayout.rows, updateSelectedPageLayout])

  // Widget CRUD with free placement
  const handleAddWidget = useCallback((type: WidgetType, entityId?: string) => {
    if (!selectedPageId) return

    snapshot()
    const page = pages.find((p) => p.id === selectedPageId)
    if (!page) return

    const def = getWidgetDef(type)
    const defaultSize = def?.defaultSize || { w: 1, h: 1 }
    const position = findFirstAvailablePosition(page.widgets, defaultSize, currentGridCols, gridRows)

    const newWidget: DashboardWidget = {
      id: `widget-${Date.now()}`,
      type,
      entity_id: entityId || undefined,
      position,
      size: { ...defaultSize },
      config: {},
    }

    const updatedPages = pages.map((p) =>
      p.id === selectedPageId ? { ...p, widgets: [...p.widgets, newWidget] } : p
    )
    setPages(updatedPages)
    setSelectedWidgetId(newWidget.id)
    toast.success('Widget hinzugefügt')
  }, [selectedPageId, pages, gridRows, setPages, currentGridCols, snapshot])

  const handleAddWidgetAtCell = useCallback((type: WidgetType, col: number, row: number, entityId?: string) => {
    if (!selectedPageId) return

    snapshot()
    const def = getWidgetDef(type)
    const defaultSize = def?.defaultSize || { w: 1, h: 1 }

    const newWidget: DashboardWidget = {
      id: `widget-${Date.now()}`,
      type,
      entity_id: entityId || undefined,
      position: { x: col, y: row },
      size: { w: Math.min(defaultSize.w, currentGridCols - col), h: defaultSize.h },
      config: {},
    }

    const updatedPages = pages.map((p) =>
      p.id === selectedPageId ? { ...p, widgets: [...p.widgets, newWidget] } : p
    )
    setPages(updatedPages)
    setSelectedWidgetId(newWidget.id)
    toast.success('Widget platziert')
  }, [selectedPageId, pages, setPages, currentGridCols, snapshot])

  const handleUpdateWidget = (widgetId: string, updates: Partial<DashboardWidget>) => {
    if (!selectedPageId) return
    snapshot()
    const updatedPages = pages.map((p) =>
      p.id === selectedPageId
        ? {
            ...p,
            widgets: p.widgets.map((w) =>
              w.id === widgetId ? { ...w, ...updates } : w
            ),
          }
        : p
    )
    setPages(updatedPages)
  }

  const handleResizeWidget = (widgetId: string, dimension: 'w' | 'h', delta: number) => {
    if (!selectedPageId) return
    snapshot()
    const updatedPages = pages.map((p) =>
      p.id === selectedPageId
        ? {
            ...p,
            widgets: p.widgets.map((w) => {
              if (w.id !== widgetId) return w
              const newSize = { ...w.size }
              if (dimension === 'w') {
                newSize.w = Math.max(1, Math.min(currentGridCols - w.position.x, newSize.w + delta))
              } else {
                newSize.h = Math.max(1, Math.min(MAX_WIDGET_HEIGHT, newSize.h + delta))
              }
              return { ...w, size: newSize }
            }),
          }
        : p
    )
    setPages(updatedPages)
  }

  const handleResizeWidgetTo = useCallback((widgetId: string, nextWidth: number, nextHeight: number) => {
    if (!selectedPageId) return
    const updatedPages = pages.map((p) =>
      p.id === selectedPageId
        ? {
            ...p,
            widgets: p.widgets.map((w) => {
              if (w.id !== widgetId) return w
              const maxWidth = Math.max(1, currentGridCols - w.position.x)
              return {
                ...w,
                size: {
                  w: Math.max(1, Math.min(maxWidth, nextWidth)),
                  h: Math.max(1, Math.min(MAX_WIDGET_HEIGHT, nextHeight)),
                },
              }
            }),
          }
        : p
    )
    setPages(updatedPages)
  }, [selectedPageId, pages, setPages, currentGridCols])

  const handleMoveWidget = useCallback((widgetId: string, newCol: number, newRow: number) => {
    if (!selectedPageId) return
    snapshot()
    const updatedPages = pages.map((p) =>
      p.id === selectedPageId
        ? {
            ...p,
            widgets: p.widgets.map((w) => {
              if (w.id !== widgetId) return w
              return {
                ...w,
                position: { x: newCol, y: newRow },
                size: { ...w.size, w: Math.min(w.size.w, currentGridCols - newCol) },
              }
            }),
          }
        : p
    )
    setPages(updatedPages)
  }, [selectedPageId, pages, setPages, currentGridCols, snapshot])

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
    if (!selectedPageId) return
    const { active, over } = event

    if (!over) return

    // Handle drops onto grid cells
    if (over.data.current?.type === 'cell') {
      const col = over.data.current.col as number
      const row = over.data.current.row as number

      // Palette-to-cell drop
      if (active.data.current?.origin === 'palette') {
        const widgetType = active.data.current.widgetType as WidgetType
        handleAddWidgetAtCell(widgetType, col, row)
        return
      }

      // Canvas-widget-to-cell drop
      if (active.data.current?.origin === 'canvas') {
        const widgetId = active.data.current.widgetId as string
        handleMoveWidget(widgetId, col, row)
        return
      }
    }

    // Handle palette-to-canvas drop (no specific cell)
    if (active.data.current?.origin === 'palette') {
      const widgetType = active.data.current.widgetType as WidgetType
      handleAddWidget(widgetType)
    }
  }

  // Handle clicking an empty cell
  const handleCellClick = useCallback((_col: number, _row: number) => {
    setSelectedWidgetId(null)
  }, [])

  // Render the grid canvas
  const renderGridCanvas = () => {
    if (!selectedPage) return null

    const widgets = selectedPage.widgets
    const cells: React.ReactNode[] = []

    // Render widgets at their explicit positions
    for (const widget of widgets) {
      cells.push(
        <CanvasWidget
          key={widget.id}
          widget={widget}
          isSelected={selectedWidgetId === widget.id}
          previewMode={previewMode}
          onSelect={() => setSelectedWidgetId(widget.id)}
          onDelete={() => handleDeleteWidget(widget.id)}
          onDuplicate={() => handleDuplicateWidget(widget.id)}
          onResizeWidth={(delta) => handleResizeWidget(widget.id, 'w', delta)}
          onResizeHeight={(delta) => handleResizeWidget(widget.id, 'h', delta)}
          onResizeTo={(nextW, nextH) => handleResizeWidgetTo(widget.id, nextW, nextH)}
          onConfigure={() => setSelectedWidgetId(widget.id)}
          maxCols={currentGridCols}
          maxRows={Math.max(MAX_WIDGET_HEIGHT, gridRows + 2)}
          entities={availableEntities}
          userName={userName}
          weatherEntity={weatherEntity}
          lightEntities={lightEntities}
        />
      )
    }

    // Render empty cells for unoccupied positions (not in preview mode)
    if (!previewMode) {
      for (let row = 0; row < gridRows; row++) {
        for (let col = 0; col < currentGridCols; col++) {
          if (occupancyMap[row]?.[col] === null) {
            cells.push(
              <EmptyCell
                key={`empty-${col}-${row}`}
                col={col}
                row={row}
                onClick={() => handleCellClick(col, row)}
              />
            )
          }
        }
      }
    }

    return cells
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 h-[100dvh] max-h-[100dvh] bg-background/95 backdrop-blur-2xl z-50 overflow-hidden"
        >
          <div className="h-full flex flex-col overflow-hidden">
            {/* Top bar */}
            <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-foreground/10 bg-background/80 backdrop-blur-sm">
              <div className="flex items-center gap-3">
                <GridFour size={22} weight="fill" className="text-accent" />
                <h1 className="text-base font-semibold text-foreground hidden sm:block">Seiten-Designer</h1>
                {/* Undo/Redo */}
                <div className="flex items-center gap-0.5 ml-2">
                  <button
                    onClick={undo}
                    disabled={!canUndo}
                    className="p-1.5 rounded-lg hover:bg-foreground/10 text-foreground/50 disabled:opacity-20 transition-colors"
                    title="Rückgängig (Strg+Z)"
                  >
                    <ArrowCounterClockwise size={16} weight="bold" />
                  </button>
                  <button
                    onClick={redo}
                    disabled={!canRedo}
                    className="p-1.5 rounded-lg hover:bg-foreground/10 text-foreground/50 disabled:opacity-20 transition-colors"
                    title="Wiederherstellen (Strg+Y)"
                  >
                    <ArrowClockwise size={16} weight="bold" />
                  </button>
                </div>
                {/* Preview toggle */}
                <button
                  onClick={() => setPreviewMode(!previewMode)}
                  className={`p-1.5 rounded-lg transition-colors ${
                    previewMode
                      ? 'bg-accent/15 text-accent'
                      : 'hover:bg-foreground/10 text-foreground/50'
                  }`}
                  title={previewMode ? 'Bearbeitungsmodus (P)' : 'Vorschau-Modus (P)'}
                >
                  {previewMode ? <Eye size={16} weight="fill" /> : <EyeSlash size={16} weight="regular" />}
                </button>
              </div>
              <div className="flex items-center gap-2">
                {/* Keyboard shortcut hints */}
                <div className="hidden lg:flex items-center gap-1.5 text-[10px] text-foreground/25">
                  <kbd className="px-1 py-0.5 rounded bg-foreground/5 border border-foreground/10">Entf</kbd>
                  <kbd className="px-1 py-0.5 rounded bg-foreground/5 border border-foreground/10 ml-1">Strg+D</kbd>
                  <kbd className="px-1 py-0.5 rounded bg-foreground/5 border border-foreground/10 ml-1">Strg+Z</kbd>
                  <kbd className="px-1 py-0.5 rounded bg-foreground/5 border border-foreground/10 ml-1">P</kbd>
                  <kbd className="px-1 py-0.5 rounded bg-foreground/5 border border-foreground/10 ml-1">Esc</kbd>
                </div>
                <button
                  onClick={onClose}
                  className="p-2 rounded-lg hover:bg-foreground/10 text-foreground/60 hover:text-foreground transition-colors"
                >
                  <X size={22} weight="bold" />
                </button>
              </div>
            </div>

            {/* Main content: 3-panel layout */}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
            <div className="flex-1 flex overflow-hidden min-h-0">
              {/* Left sidebar - Page list */}
              <div className={`${leftPanelCollapsed ? 'w-12' : 'w-64 xl:w-72'} border-r border-foreground/10 flex flex-col overflow-hidden min-h-0 transition-all duration-200`}>
                {leftPanelCollapsed ? (
                  <div className="flex flex-col items-center py-3 gap-2">
                    <button
                      onClick={() => setLeftPanelCollapsed(false)}
                      className="p-1.5 rounded-lg hover:bg-foreground/10 text-foreground/50"
                      title="Seitenleiste öffnen"
                    >
                      <ArrowsOutSimple size={16} weight="bold" />
                    </button>
                    <div className="w-px h-4 bg-foreground/10" />
                    {pages.map((page) => {
                      const Icon = availableIcons[page.icon as keyof typeof availableIcons] || House
                      const isSelected = selectedPageId === page.id
                      return (
                        <button
                          key={page.id}
                          onClick={() => { setSelectedPageId(page.id); setSelectedWidgetId(null) }}
                          className={`p-1.5 rounded-lg transition-colors ${isSelected ? 'bg-accent/15 text-accent' : 'text-foreground/40 hover:text-foreground/60 hover:bg-foreground/5'}`}
                          title={page.name}
                        >
                          <Icon size={16} weight={isSelected ? 'fill' : 'regular'} />
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <>
                    <div className="px-3 py-3 border-b border-foreground/5">
                      <div className="flex items-center justify-between mb-2">
                        <h2 className="text-sm font-medium text-foreground/70">Seiten</h2>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={handleCreatePage}
                            className="p-1.5 rounded-lg hover:bg-accent/10 text-accent transition-colors"
                            title="Neue Seite"
                          >
                            <Plus size={16} weight="bold" />
                          </button>
                          <button
                            onClick={() => setLeftPanelCollapsed(true)}
                            className="p-1.5 rounded-lg hover:bg-foreground/10 text-foreground/40 transition-colors"
                            title="Seitenleiste einklappen"
                          >
                            <CaretLeft size={14} weight="bold" />
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
                      {pages.map((page, index) => {
                        const Icon = availableIcons[page.icon as keyof typeof availableIcons] || House
                        const isSelected = selectedPageId === page.id
                        const isEditing = editingPageId === page.id
                        const isHome = page.id === 'home'
                        const isSystemPage = page.id === 'settings'

                        if (isEditing) {
                          return (
                            <div key={page.id} className="rounded-xl p-3 bg-foreground/5 border border-accent/20 space-y-2.5">
                              <input
                                type="text"
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                className="w-full px-2 py-1.5 rounded-lg bg-background/50 border border-foreground/10 text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-accent/50"
                                placeholder="Seitenname"
                              />
                              <div className="grid grid-cols-7 gap-0.5">
                                {Object.entries(availableIcons).map(([key, IconComponent]) => {
                                  const iconKey = key as keyof typeof availableIcons
                                  return (
                                    <button
                                      key={key}
                                      onClick={() => setEditIcon(iconKey)}
                                      className={`p-1 rounded-md transition-all ${
                                        editIcon === iconKey
                                          ? 'bg-accent/20 text-accent'
                                          : 'text-foreground/40 hover:text-foreground/60 hover:bg-foreground/5'
                                      }`}
                                      title={iconLabels[iconKey]}
                                    >
                                      <IconComponent size={13} weight={editIcon === iconKey ? 'fill' : 'regular'} />
                                    </button>
                                  )
                                })}
                              </div>
                              {!isHome && (
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-foreground/50">In Navigation</span>
                                  <button
                                    onClick={() => setEditShowInNav(!editShowInNav)}
                                    className={`relative w-8 h-4 rounded-full transition-colors ${
                                      editShowInNav ? 'bg-accent' : 'bg-foreground/20'
                                    }`}
                                  >
                                    <div
                                      className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${
                                        editShowInNav ? 'translate-x-4' : ''
                                      }`}
                                    />
                                  </button>
                                </div>
                              )}
                              <div className="flex gap-1.5">
                                <button
                                  onClick={handleSavePageEdit}
                                  className="flex-1 px-2 py-1 rounded-md bg-accent text-white text-xs hover:bg-accent/90 transition-colors"
                                >
                                  Speichern
                                </button>
                                <button
                                  onClick={() => setEditingPageId(null)}
                                  className="px-2 py-1 rounded-md bg-foreground/5 text-foreground/60 text-xs hover:bg-foreground/10 transition-colors"
                                >
                                  Abbrechen
                                </button>
                              </div>
                            </div>
                          )
                        }

                        return (
                          <div
                            key={page.id}
                            onClick={() => {
                              setSelectedPageId(page.id)
                              setSelectedWidgetId(null)
                            }}
                            className={`
                              flex items-center gap-2.5 px-2.5 py-2 rounded-xl cursor-pointer transition-all group
                              ${isSelected
                                ? 'bg-accent/10 text-accent'
                                : 'text-foreground/60 hover:bg-foreground/5 hover:text-foreground'
                              }
                            `}
                          >
                            <Icon size={16} weight={isSelected ? 'fill' : 'regular'} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <p className="text-xs font-medium truncate">{page.name}</p>
                                {isHome && (
                                  <Star size={9} weight="fill" className="text-accent shrink-0" />
                                )}
                              </div>
                              <p className="text-[9px] opacity-50">
                                {page.widgets.length} Widget{page.widgets.length !== 1 ? 's' : ''}
                              </p>
                            </div>
                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              {!isHome && !isSystemPage && (
                                <>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleMovePage(page.id, 'up') }}
                                    disabled={index === 0}
                                    className="p-0.5 rounded hover:bg-foreground/10 disabled:opacity-20"
                                  >
                                    <ArrowUp size={11} weight="bold" />
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleMovePage(page.id, 'down') }}
                                    disabled={index === pages.length - 1}
                                    className="p-0.5 rounded hover:bg-foreground/10 disabled:opacity-20"
                                  >
                                    <ArrowDown size={11} weight="bold" />
                                  </button>
                                </>
                              )}
                              <button
                                onClick={(e) => { e.stopPropagation(); handleEditPage(page) }}
                                className="p-0.5 rounded hover:bg-foreground/10"
                              >
                                <PencilSimple size={11} weight="bold" />
                              </button>
                              {!isHome && !isSystemPage && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleDeletePage(page.id) }}
                                  className="p-0.5 rounded hover:bg-red-500/10 hover:text-red-400"
                                >
                                  <Trash size={11} weight="bold" />
                                </button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>

              {/* Center - Grid Canvas */}
              <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                {!selectedPage ? (
                  <div className="flex-1 flex items-center justify-center">
                    <div className="text-center space-y-3">
                      <CaretLeft size={48} weight="light" className="mx-auto text-foreground/15" />
                      <p className="text-foreground/40 text-sm">
                        Seite auswählen oder neue erstellen
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Canvas header with controls */}
                    <div className="px-4 sm:px-5 py-2.5 border-b border-foreground/5 flex items-center justify-between gap-2 flex-wrap">
                      <div className="min-w-0">
                        <h2 className="text-sm font-semibold text-foreground truncate">{selectedPage.name}</h2>
                        <p className="text-[10px] text-foreground/40">
                          {selectedPage.widgets.length} Widgets &middot; {currentGridCols}&times;{gridRows} &middot; Gap {currentGap}px
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {/* Columns */}
                        <div className="flex items-center gap-0.5 rounded-lg bg-foreground/5 px-1.5 py-0.5">
                          <span className="text-[9px] text-foreground/40">Sp.</span>
                          <button
                            onClick={() => adjustSelectedPageColumns(-1)}
                            disabled={currentGridCols <= MIN_COLS}
                            className="p-0.5 rounded hover:bg-foreground/10 text-foreground/60 disabled:opacity-30"
                          >
                            <Minus size={11} weight="bold" />
                          </button>
                          <span className="text-[10px] font-medium text-foreground min-w-3 text-center">{currentGridCols}</span>
                          <button
                            onClick={() => adjustSelectedPageColumns(1)}
                            disabled={currentGridCols >= MAX_COLS}
                            className="p-0.5 rounded hover:bg-foreground/10 text-foreground/60 disabled:opacity-30"
                          >
                            <Plus size={11} weight="bold" />
                          </button>
                        </div>

                        {/* Rows */}
                        <div className="flex items-center gap-0.5 rounded-lg bg-foreground/5 px-1.5 py-0.5">
                          <span className="text-[9px] text-foreground/40">Zl.</span>
                          <button
                            onClick={() => adjustSelectedPageRows(-1)}
                            disabled={currentLayout.rows <= MIN_ROWS}
                            className="p-0.5 rounded hover:bg-foreground/10 text-foreground/60 disabled:opacity-30"
                          >
                            <Minus size={11} weight="bold" />
                          </button>
                          <span className="text-[10px] font-medium text-foreground min-w-3 text-center">{currentLayout.rows}</span>
                          <button
                            onClick={() => adjustSelectedPageRows(1)}
                            className="p-0.5 rounded hover:bg-foreground/10 text-foreground/60"
                          >
                            <Plus size={11} weight="bold" />
                          </button>
                        </div>

                        {/* Gap */}
                        <div className="flex items-center gap-0.5 rounded-lg bg-foreground/5 px-1.5 py-0.5">
                          <span className="text-[9px] text-foreground/40">Gap</span>
                          <button
                            onClick={() => updateSelectedPageLayout({ gap: Math.max(0, currentGap - 2) })}
                            disabled={currentGap <= 0}
                            className="p-0.5 rounded hover:bg-foreground/10 text-foreground/60 disabled:opacity-30"
                          >
                            <Minus size={11} weight="bold" />
                          </button>
                          <span className="text-[10px] font-medium text-foreground min-w-3 text-center">{currentGap}</span>
                          <button
                            onClick={() => updateSelectedPageLayout({ gap: Math.min(24, currentGap + 2) })}
                            disabled={currentGap >= 24}
                            className="p-0.5 rounded hover:bg-foreground/10 text-foreground/60 disabled:opacity-30"
                          >
                            <Plus size={11} weight="bold" />
                          </button>
                        </div>

                        {/* Zoom */}
                        <div className="flex items-center gap-0.5 rounded-lg bg-foreground/5 px-1.5 py-0.5">
                          <button
                            onClick={() => setCanvasZoom(Math.max(50, canvasZoom - 10))}
                            disabled={canvasZoom <= 50}
                            className="p-0.5 rounded hover:bg-foreground/10 text-foreground/60 disabled:opacity-30"
                          >
                            <MagnifyingGlassMinus size={11} weight="bold" />
                          </button>
                          <button
                            onClick={() => setCanvasZoom(100)}
                            className="text-[10px] font-medium text-foreground/50 hover:text-foreground min-w-6 text-center"
                            title="Zoom zurücksetzen"
                          >
                            {canvasZoom}%
                          </button>
                          <button
                            onClick={() => setCanvasZoom(Math.min(200, canvasZoom + 10))}
                            disabled={canvasZoom >= 200}
                            className="p-0.5 rounded hover:bg-foreground/10 text-foreground/60 disabled:opacity-30"
                          >
                            <MagnifyingGlassPlus size={11} weight="bold" />
                          </button>
                        </div>

                        {/* Template */}
                        <button
                          onClick={() => setTemplateApplyMode(true)}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium
                            bg-foreground/5 text-foreground/60 hover:bg-foreground/10 hover:text-foreground transition-colors"
                          title="Vorlage anwenden"
                        >
                          <Swatches size={12} weight="bold" />
                          <span className="hidden xl:inline">Vorlage</span>
                        </button>
                      </div>
                    </div>

                    {/* WYSIWYG Grid Canvas */}
                    <div
                      className="flex-1 overflow-auto p-3 sm:p-5"
                      onClick={() => setSelectedWidgetId(null)}
                      style={{
                        background: previewMode
                          ? 'transparent'
                          : 'linear-gradient(180deg, oklch(0.2 0.01 260 / 0.3) 0%, transparent 100%)',
                      }}
                    >
                      <div
                        className="max-w-[1500px] mx-auto origin-top transition-transform"
                        style={{
                          transform: canvasZoom !== 100 ? `scale(${canvasZoom / 100})` : undefined,
                          width: canvasZoom !== 100 ? `${10000 / canvasZoom}%` : undefined,
                        }}
                      >
                        <div
                          className="grid w-full"
                          style={{
                            gridTemplateColumns: `repeat(${currentGridCols}, minmax(0, 1fr))`,
                            gridTemplateRows: `repeat(${gridRows}, minmax(64px, auto))`,
                            gap: `${currentGap}px`,
                          }}
                        >
                          {renderGridCanvas()}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Right sidebar - Widget palette / properties */}
              {selectedPage && !previewMode && (
                <WidgetPalette
                  selectedWidget={selectedWidget}
                  availableEntities={availableEntities}
                  allWidgets={selectedPage.widgets}
                  gridCols={currentGridCols}
                  onAddWidget={handleAddWidget}
                  onUpdateWidget={handleUpdateWidget}
                  onResizeWidget={handleResizeWidget}
                  onDeleteWidget={handleDeleteWidget}
                  onDuplicateWidget={handleDuplicateWidget}
                  onMoveWidget={handleMoveWidget}
                  onOpenWidgetGroupDesigner={setEditingGroupWidgetId}
                />
              )}
            </div>

            {/* Drag overlay for palette items and canvas widgets */}
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

          {/* Template picker modal */}
          <TemplatePickerModal
            open={showTemplatePicker}
            onClose={() => setShowTemplatePicker(false)}
            onSelect={handleTemplateSelect}
          />

          {/* Template apply modal */}
          <TemplatePickerModal
            open={templateApplyMode}
            onClose={() => setTemplateApplyMode(false)}
            onSelect={(newPage) => {
              if (selectedPageId) {
                snapshot()
                const updatedPages = pages.map((p) =>
                  p.id === selectedPageId ? { ...p, widgets: newPage.widgets } : p
                )
                setPages(updatedPages)
                setTemplateApplyMode(false)
                toast.success('Vorlage angewendet')
              }
            }}
          />

          {editingGroupWidget && (
            <WidgetGroupDesignerDialog
              open={!!editingGroupWidget}
              onOpenChange={(next) => {
                if (!next) setEditingGroupWidgetId(null)
              }}
              groupWidget={editingGroupWidget}
              availableEntities={availableEntities}
              userName={userName}
              weatherEntity={weatherEntity}
              lightEntities={lightEntities}
              onUpdateGroupWidget={handleUpdateWidget}
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
