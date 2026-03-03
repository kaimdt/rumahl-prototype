import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  Plus,
  Trash,
  GridFour,
  ArrowsOutCardinal,
  Check,
  Lightbulb,
  Thermometer,
  PlugsConnected,
  Gauge,
  CloudSun,
  SpeakerHigh,
  ChatText,
} from '@phosphor-icons/react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { usePageNavigation } from '@/contexts/PageNavigationContext'
import type { DashboardPage, DashboardWidget, EntityState } from '@/lib/types'
import { toast } from 'sonner'

interface PageWidgetEditorProps {
  isOpen: boolean
  onClose: () => void
  pageId: string
  availableEntities: EntityState[]
}

const widgetTypeIcons = {
  light: Lightbulb,
  climate: Thermometer,
  switch: PlugsConnected,
  sensor: Gauge,
  weather: CloudSun,
  media_player: SpeakerHigh,
  greeting: ChatText,
  custom: GridFour,
}

const widgetTypeLabels: Record<string, string> = {
  light: 'Licht',
  climate: 'Klima',
  switch: 'Schalter',
  sensor: 'Sensor',
  weather: 'Wetter',
  media_player: 'Media',
  greeting: 'Begrüßung',
  custom: 'Benutzerdefiniert',
}

interface SortableWidgetProps {
  widget: DashboardWidget
  onDelete: (id: string) => void
}

function SortableWidget({ widget, onDelete }: SortableWidgetProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: widget.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const Icon = widgetTypeIcons[widget.type] || GridFour

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="glass-card rounded-xl p-4 border border-white/10 cursor-move hover:border-accent/50 transition-colors"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
            <Icon size={20} weight="fill" className="text-accent" />
          </div>
          <div>
            <p className="font-medium text-foreground text-sm">
              {widgetTypeLabels[widget.type] || widget.type}
            </p>
            <p className="text-xs text-foreground/60 truncate max-w-[200px]">
              {widget.entity_id || 'Kein Entity'}
            </p>
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onDelete(widget.id)
          }}
          className="p-2 rounded-lg hover:bg-red-500/10 text-foreground/60 hover:text-red-500 transition-colors"
          title="Löschen"
        >
          <Trash size={18} weight="bold" />
        </button>
      </div>
    </div>
  )
}

export function PageWidgetEditor({
  isOpen,
  onClose,
  pageId,
  availableEntities,
}: PageWidgetEditorProps) {
  const { pages, setPages } = usePageNavigation()
  const page = pages.find((p) => p.id === pageId)
  const [showAddWidget, setShowAddWidget] = useState(false)
  const [selectedType, setSelectedType] = useState<DashboardWidget['type']>('light')
  const [selectedEntity, setSelectedEntity] = useState<string>('')

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  if (!page) return null

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event

    if (over && active.id !== over.id) {
      const oldIndex = page.widgets.findIndex((w) => w.id === active.id)
      const newIndex = page.widgets.findIndex((w) => w.id === over.id)

      const updatedWidgets = arrayMove(page.widgets, oldIndex, newIndex)

      const updatedPages = pages.map((p) =>
        p.id === pageId ? { ...p, widgets: updatedWidgets } : p
      )
      setPages(updatedPages)
      toast.success('Widget verschoben')
    }
  }

  const handleDeleteWidget = (widgetId: string) => {
    const updatedWidgets = page.widgets.filter((w) => w.id !== widgetId)
    const updatedPages = pages.map((p) =>
      p.id === pageId ? { ...p, widgets: updatedWidgets } : p
    )
    setPages(updatedPages)
    toast.success('Widget gelöscht')
  }

  const handleAddWidget = () => {
    if (selectedType !== 'greeting' && selectedType !== 'custom' && !selectedEntity) {
      toast.error('Bitte Entity auswählen')
      return
    }

    const newWidget: DashboardWidget = {
      id: `widget-${Date.now()}`,
      type: selectedType,
      entity_id: selectedEntity || undefined,
      position: { x: 0, y: page.widgets.length },
      size: { w: 1, h: 1 },
    }

    const updatedWidgets = [...page.widgets, newWidget]
    const updatedPages = pages.map((p) =>
      p.id === pageId ? { ...p, widgets: updatedWidgets } : p
    )
    setPages(updatedPages)
    toast.success('Widget hinzugefügt')
    setShowAddWidget(false)
    setSelectedEntity('')
  }

  const getEntitiesForType = (type: DashboardWidget['type']) => {
    if (type === 'greeting' || type === 'custom') return []
    return availableEntities.filter((e) => e.entity_id.startsWith(`${type}.`))
  }

  const entitiesForSelectedType = getEntitiesForType(selectedType)

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl max-h-[80vh] z-50"
          >
            <div className="glass-card rounded-2xl shadow-2xl border border-white/10 overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
                <div>
                  <h2 className="text-xl font-semibold text-foreground">
                    Widgets bearbeiten
                  </h2>
                  <p className="text-sm text-foreground/60 mt-1">{page.name}</p>
                </div>
                <button
                  onClick={onClose}
                  className="p-2 rounded-lg hover:bg-white/10 text-foreground/60 hover:text-foreground transition-colors"
                >
                  <X size={24} weight="bold" />
                </button>
              </div>

              {/* Content */}
              <div className="px-6 py-4 max-h-[60vh] overflow-y-auto">
                {page.widgets.length === 0 ? (
                  <div className="text-center py-12">
                    <GridFour
                      size={48}
                      weight="light"
                      className="mx-auto text-foreground/30 mb-4"
                    />
                    <p className="text-foreground/60 text-sm">
                      Noch keine Widgets. Klicke auf "Widget hinzufügen" um zu starten.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-xs text-foreground/60 mb-2">
                      <ArrowsOutCardinal size={14} />
                      <span>Ziehen Sie die Widgets, um sie neu anzuordnen</span>
                    </div>
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={handleDragEnd}
                    >
                      <SortableContext
                        items={page.widgets.map((w) => w.id)}
                        strategy={rectSortingStrategy}
                      >
                        <div className="space-y-2">
                          {page.widgets.map((widget) => (
                            <SortableWidget
                              key={widget.id}
                              widget={widget}
                              onDelete={handleDeleteWidget}
                            />
                          ))}
                        </div>
                      </SortableContext>
                    </DndContext>
                  </div>
                )}

                {/* Add Widget Section */}
                {showAddWidget && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mt-4 glass-card rounded-xl p-4 border border-accent/20"
                  >
                    <h3 className="text-sm font-semibold text-foreground mb-3">
                      Neues Widget
                    </h3>

                    {/* Widget Type Selector */}
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs text-foreground/60 mb-2 block">
                          Widget-Typ
                        </label>
                        <div className="grid grid-cols-4 gap-2">
                          {Object.entries(widgetTypeIcons).map(([type, Icon]) => (
                            <button
                              key={type}
                              onClick={() => {
                                setSelectedType(type as DashboardWidget['type'])
                                setSelectedEntity('')
                              }}
                              className={`p-3 rounded-lg transition-all ${
                                selectedType === type
                                  ? 'bg-accent/20 text-accent ring-2 ring-accent'
                                  : 'bg-background/30 text-foreground/60 hover:bg-background/50 hover:text-foreground'
                              }`}
                              title={widgetTypeLabels[type]}
                            >
                              <Icon size={20} weight={selectedType === type ? 'fill' : 'regular'} />
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Entity Selector */}
                      {selectedType !== 'greeting' && selectedType !== 'custom' && (
                        <div>
                          <label className="text-xs text-foreground/60 mb-2 block">
                            Entity auswählen
                          </label>
                          <select
                            value={selectedEntity}
                            onChange={(e) => setSelectedEntity(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg bg-background/50 border border-white/10 text-foreground focus:outline-none focus:ring-2 focus:ring-accent/50 text-sm"
                          >
                            <option value="">-- Bitte wählen --</option>
                            {entitiesForSelectedType.map((entity) => (
                              <option key={entity.entity_id} value={entity.entity_id}>
                                {entity.attributes?.friendly_name || entity.entity_id}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex gap-2 pt-2">
                        <button
                          onClick={handleAddWidget}
                          className="flex-1 px-4 py-2 rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors flex items-center justify-center gap-2 text-sm"
                        >
                          <Check size={16} weight="bold" />
                          Hinzufügen
                        </button>
                        <button
                          onClick={() => setShowAddWidget(false)}
                          className="px-4 py-2 rounded-lg bg-background/50 text-foreground/80 hover:bg-background/70 transition-colors text-sm"
                        >
                          Abbrechen
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-white/10 flex justify-between">
                {!showAddWidget && (
                  <button
                    onClick={() => setShowAddWidget(true)}
                    className="px-4 py-2 rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors flex items-center gap-2"
                  >
                    <Plus size={18} weight="bold" />
                    Widget hinzufügen
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg bg-background/50 text-foreground/80 hover:bg-background/70 transition-colors ml-auto"
                >
                  Schließen
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
