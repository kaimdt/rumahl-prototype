/**
 * WidgetPaletteV2 – Modern sidebar widget palette with search & categories
 * Replaces the old WidgetPalette with a cleaner, more intuitive design.
 */

import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { MagnifyingGlass, CaretDown, CaretRight, Plus, DotsSixVertical, Lightbulb, PuzzlePiece, Ruler } from '@phosphor-icons/react'
import { useDraggable } from '@dnd-kit/core'
import { getWidgetDef, WIDGET_CATEGORIES, WIDGET_DEFINITIONS, type WidgetDefinition } from '@/lib/widgetRegistry'

// Convert categories object to array for iteration
const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  entity: <Lightbulb size={12} weight="fill" />,
  standalone: <PuzzlePiece size={12} weight="fill" />,
  layout: <Ruler size={12} weight="fill" />,
}

const CATEGORY_LIST = Object.entries(WIDGET_CATEGORIES).map(([id, info]) => ({
  id,
  label: info.label,
  order: info.order,
  icon: CATEGORY_ICONS[id] || <PuzzlePiece size={12} />,
  defaultExpanded: id === 'entity',
}))

// Get widgets for a category
function getWidgetsForCategory(catId: string): WidgetDefinition[] {
  return WIDGET_DEFINITIONS.filter(d => d.category === catId)
}
import type { WidgetType } from '@/lib/types'

// ─── Draggable Widget Item ──────────────────────────────────────────

function PaletteItem({ type, label, icon, description }: {
  type: WidgetType
  label: string
  icon: React.ElementType
  description?: string
}) {
  const Icon = icon
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `palette-${type}`,
    data: { origin: 'palette', widgetType: type },
  })

  const style = transform ? {
    transform: `translate(${transform.x}px, ${transform.y}px)`,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 100 : 1,
  } : undefined

  return (
    <motion.div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={style}
      whileHover={{ scale: 1.02, x: 2 }}
      whileTap={{ scale: 0.97 }}
      className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-grab active:cursor-grabbing hover:bg-foreground/[0.06] transition-all group"
    >
      <div className="w-8 h-8 rounded-lg bg-foreground/[0.06] flex items-center justify-center text-sm shrink-0 group-hover:bg-accent/15 transition-colors">
        <Icon />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-medium text-foreground truncate">{label}</p>
        {description && <p className="text-[9px] text-foreground/40 truncate">{description}</p>}
      </div>
      <DotsSixVertical size={12} className="text-foreground/20 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
      <Plus size={12} className="text-accent/60 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
    </motion.div>
  )
}

// ─── Main Palette ──────────────────────────────────────────────────

export function WidgetPaletteV2() {
  const [search, setSearch] = useState('')
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(CATEGORY_LIST.filter(c => c.defaultExpanded !== false).map(c => c.id))
  )

  const toggleCategory = (id: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Filter widgets by search
  const filteredWidgets = useMemo(() => {
    if (!search.trim()) return null // show all by category

    const q = search.toLowerCase()
    const results: Array<{ type: WidgetType; label: string; icon: typeof Lightbulb; description?: string; category: string }> = []

    for (const [catId, cat] of Object.entries(WIDGET_CATEGORIES)) {
      const widgets = getWidgetsForCategory(catId)
      for (const w of widgets) {
        if (
          w.label.toLowerCase().includes(q) ||
          w.type.toLowerCase().includes(q) ||
          (w.description && w.description.toLowerCase().includes(q))
        ) {
          results.push({
            type: w.type as WidgetType,
            label: w.label,
            icon: w.icon,
            description: w.description,
            category: cat.label,
          })
        }
      }
    }
    return results
  }, [search])

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-3 py-3 border-b border-foreground/5 shrink-0">
        <h2 className="text-[11px] font-bold text-foreground uppercase tracking-wider mb-2.5">Widgets</h2>
        <div className="relative">
          <MagnifyingGlass size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground/30" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Suchen..."
            className="w-full pl-7 pr-3 py-1.5 rounded-lg text-[10px] bg-foreground/[0.04] border border-foreground/8 text-foreground placeholder:text-foreground/25 focus:outline-none focus:border-accent/30 transition-all"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {filteredWidgets ? (
          // Search results – flat list
          <div className="py-2">
            {filteredWidgets.length === 0 ? (
              <p className="text-[10px] text-foreground/40 text-center py-8">Keine Widgets gefunden</p>
            ) : (
              <>
                <p className="text-[9px] text-foreground/30 px-3 mb-1">
                  {filteredWidgets.length} Ergebnis{filteredWidgets.length !== 1 ? 'se' : ''}
                </p>
                {filteredWidgets.map(w => (
                  <PaletteItem key={w.type} type={w.type} label={w.label} icon={w.icon} description={w.description} />
                ))}
              </>
            )}
          </div>
        ) : (
          // Category view
          <div className="py-1">
            {CATEGORY_LIST.map(cat => {
              const widgets = getWidgetsForCategory(cat.id)
              if (widgets.length === 0) return null
              const isExpanded = expandedCategories.has(cat.id)

              return (
                <div key={cat.id}>
                  <button
                    onClick={() => toggleCategory(cat.id)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] font-semibold text-foreground/50 uppercase tracking-wider hover:text-foreground/70 transition-colors"
                  >
                    {isExpanded ? <CaretDown size={10} /> : <CaretRight size={10} />}
                    <span className="text-foreground/40">{cat.icon}</span> {cat.label}
                    <span className="text-foreground/25 ml-auto">{widgets.length}</span>
                  </button>
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="overflow-hidden"
                      >
                        {widgets.map(w => {
                          const def = getWidgetDef(w.type)
                          return (
                            <PaletteItem
                              key={w.type}
                              type={w.type as WidgetType}
                              label={w.label}
                              icon={w.icon}
                              description={def?.description}
                            />
                          )
                        })}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Footer stats */}
      <div className="px-3 py-2 border-t border-foreground/5 shrink-0">
        <p className="text-[9px] text-foreground/25 text-center">
          {CATEGORY_LIST.reduce((sum, c) => sum + getWidgetsForCategory(c.id).length, 0)} Widgets verfügbar
        </p>
      </div>
    </div>
  )
}
