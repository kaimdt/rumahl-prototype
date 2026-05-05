// HelpTip – Reusable info/help button with tooltip for UI explanations
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Info, Question, X } from '@phosphor-icons/react'

interface Props {
  /** Tooltip content (supports markdown-like formatting) */
  content: string
  /** Title shown in the tooltip header */
  title?: string
  /** Icon variant: 'info' | 'question' */
  variant?: 'info' | 'question'
  /** Position relative to the trigger */
  position?: 'top' | 'bottom' | 'left' | 'right'
  /** Smaller icon size */
  small?: boolean
  /** Custom className for the trigger button */
  className?: string
  /** If true, shows a popover instead of tooltip (click to open/close) */
  popover?: boolean
}

export function HelpTip({ content, title, variant = 'info', small, className, popover }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const Icon = variant === 'question' ? Question : Info
  const size = small ? 12 : 14

  if (popover) {
    return (
      <span className="relative inline-flex">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={`inline-flex items-center justify-center rounded-full transition-all ${
            isOpen ? 'bg-accent/20 text-accent' : 'text-foreground/25 hover:text-foreground/50 hover:bg-foreground/5'
          } ${className || ''}`}
          style={{ width: small ? 18 : 22, height: small ? 18 : 22 }}
          title={title || 'Mehr Informationen'}
        >
          <Icon size={size} weight={isOpen ? 'fill' : 'regular'} />
        </button>
        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.95 }}
              className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 p-3 rounded-xl bg-card/98 backdrop-blur-2xl border border-foreground/10 shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-start justify-between mb-1.5">
                {title && <p className="text-[11px] font-semibold text-foreground">{title}</p>}
                <button onClick={() => setIsOpen(false)} className="text-foreground/30 hover:text-foreground/60 ml-auto">
                  <X size={12} />
                </button>
              </div>
              <div className="text-[11px] text-foreground/60 leading-relaxed whitespace-pre-wrap">
                {content}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {/* Backdrop click to close */}
        {isOpen && <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />}
      </span>
    )
  }

  // Simple hover tooltip
  return (
    <span className="relative inline-flex group">
      <span
        className={`inline-flex items-center justify-center rounded-full text-foreground/25 group-hover:text-foreground/50 group-hover:bg-foreground/5 transition-all cursor-help ${className || ''}`}
        style={{ width: small ? 16 : 20, height: small ? 16 : 20 }}
        title={content}
      >
        <Icon size={size} weight="regular" />
      </span>
      {/* Tooltip on hover */}
      <span className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-3 py-2 rounded-xl bg-card/98 backdrop-blur-2xl border border-foreground/10 shadow-xl text-[10px] text-foreground/60 leading-relaxed whitespace-pre-wrap max-w-[280px] opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        {title && <span className="font-semibold text-foreground/80 block mb-0.5">{title}</span>}
        {content}
      </span>
    </span>
  )
}
