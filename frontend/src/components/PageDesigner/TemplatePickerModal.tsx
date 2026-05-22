import { motion, AnimatePresence } from 'motion/react'
import {
  X,
  House,
  Lightbulb,
  CloudSun,
  Sparkle,
  GridFour,
  Timer,
} from '@phosphor-icons/react'
import { LAYOUT_TEMPLATES, getTemplateWidgets } from '@/lib/layoutTemplates'
import type { DashboardPage } from '@/lib/types'

interface TemplatePickerModalProps {
  open: boolean
  onClose: () => void
  onSelect: (page: DashboardPage) => void
}

const templateIcons: Record<string, typeof House> = {
  House,
  Lightbulb,
  CloudSun,
  Sparkle,
  GridFour,
  Timer,
}

export function TemplatePickerModal({ open, onClose, onSelect }: TemplatePickerModalProps) {
  const handleSelectTemplate = (templateId: string) => {
    const widgets = getTemplateWidgets(templateId)
    const newPage: DashboardPage = {
      id: `page-${Date.now()}`,
      name: 'Neue Seite',
      icon: 'House',
      widgets,
      showInNav: true,
      order: 100,
    }
    onSelect(newPage)
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/40 z-[60]"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg z-[60]"
          >
            <div className="glass-card rounded-2xl shadow-2xl border border-foreground/10 overflow-hidden">
              <div className="px-5 py-4 border-b border-foreground/10 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-foreground">Neue Seite erstellen</h3>
                  <p className="text-xs text-foreground/40 mt-0.5">Vorlage auswählen</p>
                </div>
                <button
                  onClick={onClose}
                  className="p-1.5 rounded-lg hover:bg-foreground/10 text-foreground/50"
                >
                  <X size={18} weight="bold" />
                </button>
              </div>

              <div className="p-5 grid grid-cols-2 gap-3">
                {LAYOUT_TEMPLATES.map((template) => {
                  const Icon = templateIcons[template.icon] || GridFour
                  return (
                    <motion.button
                      key={template.id}
                      onClick={() => handleSelectTemplate(template.id)}
                      className="p-4 rounded-xl border border-foreground/10 bg-foreground/[0.02] hover:bg-accent/5 hover:border-accent/30 transition-all text-left group"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      <div className="w-10 h-10 rounded-xl bg-foreground/5 group-hover:bg-accent/10 flex items-center justify-center mb-3 transition-colors">
                        <Icon
                          size={20}
                          weight="fill"
                          className="text-foreground/40 group-hover:text-accent transition-colors"
                        />
                      </div>
                      <p className="text-sm font-medium text-foreground">{template.name}</p>
                      <p className="text-[11px] text-foreground/40 mt-0.5 leading-snug">
                        {template.description}
                      </p>
                    </motion.button>
                  )
                })}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
