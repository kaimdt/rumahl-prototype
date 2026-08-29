import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, CursorClick, Desktop, DeviceMobile, MagicWand, X } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { RumahlMark } from '@/components/RumahlMark'
import { type ShellModePreference, useShellMode } from '@/hooks/useShellMode'

export function ShellModeSwitcher() {
  const { t } = useTranslation()
  const { preference, resolvedMode, setPreference } = useShellMode()
  const [open, setOpen] = useState(false)

  const options: Array<{ id: ShellModePreference; icon: typeof Desktop; title: string; description: string }> = [
    { id: 'auto', icon: MagicWand, title: t('os.shellMode.auto'), description: t('os.shellMode.autoDescription') },
    { id: 'desktop', icon: Desktop, title: t('os.shellMode.desktop'), description: t('os.shellMode.desktopDescription') },
    { id: 'launcher', icon: DeviceMobile, title: t('os.shellMode.launcher'), description: t('os.shellMode.launcherDescription') },
  ]

  return (
    <div className="rumahl-shell-mode-control">
      <button type="button" onClick={() => setOpen((value) => !value)} className="rumahl-shell-mode-trigger" aria-expanded={open} aria-label={t('os.shellMode.title')}>
        {resolvedMode === 'desktop' ? <Desktop size={15} /> : <DeviceMobile size={15} />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: 8, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 5, scale: 0.98 }} className="rumahl-shell-mode-popover">
            <header>
              <span><CursorClick size={15} />{t('os.shellMode.title')}</span>
              <button type="button" onClick={() => setOpen(false)} aria-label={t('common.close')}><X size={14} /></button>
            </header>
            <div className="rumahl-shell-mode-options">
              {options.map((option) => {
                const Icon = option.icon
                return (
                  <button key={option.id} type="button" onClick={() => { setPreference(option.id); setOpen(false) }} className={preference === option.id ? 'is-selected' : ''}>
                    <Icon size={18} weight="duotone" />
                    <span><strong>{option.title}</strong><small>{option.description}</small></span>
                    {preference === option.id && <Check size={15} weight="bold" />}
                  </button>
                )
              })}
            </div>
            <div className="rumahl-shell-mode-preview" aria-hidden="true">
              <RumahlMark className="h-5" />
              <div><i /><i /><i /><i /><i /><i /></div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

