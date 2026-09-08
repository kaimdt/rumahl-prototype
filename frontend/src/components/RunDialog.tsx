import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, Browsers, X } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { iconMap, usePageNavigation } from '@/contexts/PageNavigationContext'
import { useAuth } from '@/contexts/AuthContext'
import { useInstalledApps } from '@/hooks/useInstalledApps'
import { useOsPermissions } from '@/hooks/useOsPermissions'
import { createPageApps, SYSTEM_OS_APPS } from '@/lib/osAppRegistry'
import { isAppAllowed } from '@/lib/userRestrictions'

export function RunDialog() {
  const { t } = useTranslation()
  const { pages, setCurrentPageId } = usePageNavigation()
  const { user } = useAuth()
  const { installedApps } = useInstalledApps()
  const { can } = useOsPermissions()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const apps = useMemo(() => {
    const pageApps = createPageApps(pages, (name) => iconMap[name as keyof typeof iconMap])
    const known = new Set([...SYSTEM_OS_APPS, ...pageApps].map((app) => app.pageId))
    return [...SYSTEM_OS_APPS, ...pageApps, ...installedApps.filter((app) => !known.has(app.pageId))]
      .filter((app) => !app.adminOnly || user?.isAdmin)
      .filter((app) => !app.requiredPermission || can(app.requiredPermission))
      .filter((app) => isAppAllowed(user, app.id))
  }, [can, installedApps, pages, user])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const nativeRun = event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'r'
      const portableRun = event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && event.key === 'Enter'
      if (nativeRun || portableRun) {
        event.preventDefault()
        event.stopPropagation()
        setOpen(true)
        setError(false)
        window.setTimeout(() => inputRef.current?.focus(), 30)
      }
      if (event.key === 'Escape' && open) setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [open])

  const run = () => {
    const command = value.trim()
    if (!command) return
    const normalized = command.toLocaleLowerCase()
    if (/^https?:\/\//i.test(command) || /^www\./i.test(command)) {
      window.open(/^www\./i.test(command) ? `https://${command}` : command, '_blank', 'noopener,noreferrer')
      setOpen(false); setValue(''); return
    }
    const aliases: Record<string, string> = { explorer: 'os-files', files: 'os-files', settings: 'settings', control: 'admin', admin: 'admin', home: 'launcher' }
    const targetPageId = aliases[normalized]
    const app = apps.find((entry) => entry.pageId === targetPageId || entry.pageId.toLocaleLowerCase() === normalized || entry.id.toLocaleLowerCase() === normalized || (entry.nameKey ? t(entry.nameKey, entry.fallbackName) : entry.fallbackName).toLocaleLowerCase() === normalized)
    if (app || targetPageId) {
      setCurrentPageId(app?.pageId || targetPageId)
      setOpen(false); setValue(''); return
    }
    setError(true)
  }

  return <AnimatePresence>{open && <>
    <motion.button type="button" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} className="fixed inset-0 z-[205] bg-black/35 backdrop-blur-[2px]" aria-label={t('common.close')} />
    <motion.section initial={{ opacity: 0, y: 18, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: .98 }} className="fixed bottom-[calc(var(--desktop-taskbar-height,3rem)+1.25rem)] left-1/2 z-[206] w-[min(31rem,calc(100vw-2rem))] -translate-x-1/2 rounded-2xl border border-foreground/12 bg-background/96 p-4 text-foreground shadow-2xl backdrop-blur-2xl" role="dialog" aria-modal="true" aria-labelledby="rumahl-run-title">
      <header className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2.5"><span className="grid h-9 w-9 place-items-center rounded-xl bg-accent/12 text-accent"><Browsers size={19} weight="duotone" /></span><div><div className="flex items-center gap-2"><h2 id="rumahl-run-title" className="text-sm font-semibold">{t('os.run.title')}</h2><kbd className="rounded-md border border-foreground/10 bg-foreground/5 px-1.5 py-0.5 text-[9px] text-foreground/45">Ctrl Shift Enter</kbd></div><p className="text-[11px] text-foreground/45">{t('os.run.hint')}</p></div></div><button type="button" onClick={() => setOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg text-foreground/45 hover:bg-foreground/8 hover:text-foreground"><X size={15} /></button></header>
      <div className="flex items-center gap-2"><input ref={inputRef} value={value} onChange={(event) => { setValue(event.target.value); setError(false) }} onKeyDown={(event) => { if (event.key === 'Enter') run() }} placeholder={t('os.run.placeholder')} className="min-w-0 flex-1 rounded-xl border border-foreground/12 bg-foreground/5 px-3.5 py-2.5 text-sm outline-none focus:border-accent/55" /><button type="button" onClick={run} disabled={!value.trim()} className="rumahl-primary-button h-10 px-4"><ArrowRight size={16} />{t('os.run.run')}</button></div>
      {error && <p className="mt-2 text-xs text-red-400">{t('os.run.notFound', { command: value.trim() })}</p>}
    </motion.section>
  </>}</AnimatePresence>
}
