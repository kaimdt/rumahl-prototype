import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  Plus,
  PencilSimple,
  Trash,
  ArrowUp,
  ArrowDown,
  Check,
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
  Bathtub
} from '@phosphor-icons/react'
import { usePageNavigation } from '@/contexts/PageNavigationContext'
import type { DashboardPage } from '@/lib/types'
import { toast } from 'sonner'

interface PageDesignerProps {
  isOpen: boolean
  onClose: () => void
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
}

export function PageDesigner({ isOpen, onClose }: PageDesignerProps) {
  const { pages, setPages } = usePageNavigation()
  const [editingPageId, setEditingPageId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editIcon, setEditIcon] = useState<keyof typeof availableIcons>('House')

  const handleCreatePage = () => {
    const newPage: DashboardPage = {
      id: `page-${Date.now()}`,
      name: 'Neue Seite',
      icon: 'House',
      widgets: [],
    }
    setPages([...pages, newPage])
    toast.success('Neue Seite erstellt')
  }

  const handleEditPage = (page: DashboardPage) => {
    setEditingPageId(page.id)
    setEditName(page.name)
    setEditIcon(page.icon as keyof typeof availableIcons)
  }

  const handleSaveEdit = () => {
    if (!editingPageId) return

    const updatedPages = pages.map(page =>
      page.id === editingPageId
        ? { ...page, name: editName, icon: editIcon }
        : page
    )
    setPages(updatedPages)
    setEditingPageId(null)
    toast.success('Seite aktualisiert')
  }

  const handleCancelEdit = () => {
    setEditingPageId(null)
    setEditName('')
    setEditIcon('House')
  }

  const handleDeletePage = (pageId: string) => {
    const page = pages.find(p => p.id === pageId)
    if (!page) return

    // Prevent deleting home and settings pages
    if (pageId === 'home') {
      toast.error('Die Startseite kann nicht gelöscht werden')
      return
    }
    if (pageId === 'settings') {
      toast.error('Die Einstellungsseite kann nicht gelöscht werden')
      return
    }

    const updatedPages = pages.filter(p => p.id !== pageId)
    setPages(updatedPages)
    toast.success(`${page.name} gelöscht`)
  }

  const handleMovePage = (pageId: string, direction: 'up' | 'down') => {
    const currentIndex = pages.findIndex(p => p.id === pageId)
    if (currentIndex === -1) return

    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
    if (newIndex < 0 || newIndex >= pages.length) return

    const updatedPages = [...pages]
    const [movedPage] = updatedPages.splice(currentIndex, 1)
    updatedPages.splice(newIndex, 0, movedPage)
    setPages(updatedPages)
  }

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
                <h2 className="text-xl font-semibold text-foreground">Seiten-Designer</h2>
                <button
                  onClick={onClose}
                  className="p-2 rounded-lg hover:bg-white/10 text-foreground/60 hover:text-foreground transition-colors"
                >
                  <X size={24} weight="bold" />
                </button>
              </div>

              {/* Content */}
              <div className="px-6 py-4 max-h-[60vh] overflow-y-auto">
                <div className="space-y-3">
                  {pages.map((page, index) => {
                    const Icon = availableIcons[page.icon as keyof typeof availableIcons] || House
                    const isEditing = editingPageId === page.id
                    const isSystemPage = page.id === 'home' || page.id === 'settings'

                    return (
                      <motion.div
                        key={page.id}
                        layout
                        className="glass-card rounded-xl p-4 border border-white/5"
                      >
                        {isEditing ? (
                          <div className="space-y-4">
                            {/* Name Input */}
                            <div>
                              <label className="text-xs text-foreground/60 mb-1 block">Name</label>
                              <input
                                type="text"
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                className="w-full px-3 py-2 rounded-lg bg-background/50 border border-white/10 text-foreground focus:outline-none focus:ring-2 focus:ring-accent/50"
                                placeholder="Seitenname"
                              />
                            </div>

                            {/* Icon Selector */}
                            <div>
                              <label className="text-xs text-foreground/60 mb-2 block">Icon</label>
                              <div className="grid grid-cols-7 gap-2">
                                {Object.entries(availableIcons).map(([key, IconComponent]) => {
                                  const iconKey = key as keyof typeof availableIcons
                                  const isSelected = editIcon === iconKey
                                  return (
                                    <button
                                      key={key}
                                      onClick={() => setEditIcon(iconKey)}
                                      className={`p-3 rounded-lg transition-all ${
                                        isSelected
                                          ? 'bg-accent/20 text-accent ring-2 ring-accent'
                                          : 'bg-background/30 text-foreground/60 hover:bg-background/50 hover:text-foreground'
                                      }`}
                                      title={iconLabels[iconKey]}
                                    >
                                      <IconComponent size={20} weight={isSelected ? 'fill' : 'regular'} />
                                    </button>
                                  )
                                })}
                              </div>
                            </div>

                            {/* Actions */}
                            <div className="flex gap-2">
                              <button
                                onClick={handleSaveEdit}
                                className="flex-1 px-4 py-2 rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors flex items-center justify-center gap-2"
                              >
                                <Check size={16} weight="bold" />
                                Speichern
                              </button>
                              <button
                                onClick={handleCancelEdit}
                                className="px-4 py-2 rounded-lg bg-background/50 text-foreground/80 hover:bg-background/70 transition-colors"
                              >
                                Abbrechen
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                              <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
                                <Icon size={20} weight="fill" className="text-accent" />
                              </div>
                              <div>
                                <p className="font-medium text-foreground">{page.name}</p>
                                <p className="text-xs text-foreground/60">
                                  {page.widgets.length} Widget{page.widgets.length !== 1 ? 's' : ''}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-1">
                              {/* Move buttons */}
                              {!isSystemPage && (
                                <>
                                  <button
                                    onClick={() => handleMovePage(page.id, 'up')}
                                    disabled={index === 0}
                                    className="p-2 rounded-lg hover:bg-white/10 text-foreground/60 hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                    title="Nach oben"
                                  >
                                    <ArrowUp size={18} weight="bold" />
                                  </button>
                                  <button
                                    onClick={() => handleMovePage(page.id, 'down')}
                                    disabled={index === pages.length - 1}
                                    className="p-2 rounded-lg hover:bg-white/10 text-foreground/60 hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                    title="Nach unten"
                                  >
                                    <ArrowDown size={18} weight="bold" />
                                  </button>
                                </>
                              )}

                              {/* Edit button */}
                              <button
                                onClick={() => handleEditPage(page)}
                                className="p-2 rounded-lg hover:bg-white/10 text-foreground/60 hover:text-foreground transition-colors"
                                title="Bearbeiten"
                              >
                                <PencilSimple size={18} weight="bold" />
                              </button>

                              {/* Delete button */}
                              {!isSystemPage && (
                                <button
                                  onClick={() => handleDeletePage(page.id)}
                                  className="p-2 rounded-lg hover:bg-red-500/10 text-foreground/60 hover:text-red-500 transition-colors"
                                  title="Löschen"
                                >
                                  <Trash size={18} weight="bold" />
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </motion.div>
                    )
                  })}
                </div>
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-white/10 flex justify-between">
                <button
                  onClick={handleCreatePage}
                  className="px-4 py-2 rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors flex items-center gap-2"
                >
                  <Plus size={18} weight="bold" />
                  Neue Seite
                </button>
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg bg-background/50 text-foreground/80 hover:bg-background/70 transition-colors"
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
