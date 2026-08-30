import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Copy, X } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import type { Notification } from '@/contexts/NotificationContext'

export function NotificationDetailDialog({ notification, onClose, onAction }: {
  notification: Notification | null
  onClose: () => void
  onAction: (actionId: string, href?: string) => void
}) {
  const { t, i18n } = useTranslation()
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    await navigator.clipboard.writeText([notification?.title, notification?.message].filter(Boolean).join('\n\n'))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return <AnimatePresence>{notification && <>
    <motion.button type="button" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 z-[410] bg-black/55 backdrop-blur-sm" aria-label={t('common.close')} />
    <motion.section initial={{ opacity: 0, scale: .96, y: 18 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: .97, y: 10 }} className="fixed left-1/2 top-1/2 z-[411] w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-foreground/12 bg-background/96 shadow-2xl backdrop-blur-2xl" role="dialog" aria-modal="true" aria-labelledby="rumahl-notification-detail-title">
      <header className="flex items-start justify-between gap-4 border-b border-foreground/8 px-5 py-4">
        <div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-accent">{t('notifications.detail')}</p><h2 id="rumahl-notification-detail-title" className="mt-1 break-words text-base font-semibold">{notification.title}</h2></div>
        <button type="button" onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-foreground/50 hover:bg-foreground/8 hover:text-foreground" aria-label={t('common.close')}><X size={16} /></button>
      </header>
      <div className="px-5 py-5">
        <p className="max-h-[45vh] overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6 text-foreground/75">{notification.message || notification.title}</p>
        <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t border-foreground/8 pt-4 text-xs"><dt className="text-foreground/40">{t('notifications.source')}</dt><dd>{notification.source || 'system'}</dd><dt className="text-foreground/40">{t('notifications.time')}</dt><dd>{new Date(notification.created_at).toLocaleString(i18n.language)}</dd></dl>
      </div>
      <footer className="flex flex-wrap justify-end gap-2 border-t border-foreground/8 px-5 py-3.5">
        <button type="button" onClick={() => void copy()} className="rumahl-secondary-button">{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? t('notifications.copied') : t('notifications.copy')}</button>
        {notification.actions?.map((action) => <button key={action.id} type="button" onClick={() => onAction(action.id, action.href)} className="rumahl-primary-button">{action.label}</button>)}
      </footer>
    </motion.section>
  </>}</AnimatePresence>
}
