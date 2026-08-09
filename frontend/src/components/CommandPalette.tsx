import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, MagnifyingGlass, Moon, Storefront, LockKey, Gear, House } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { usePageNavigation, iconMap } from '@/contexts/PageNavigationContext'
import { useTheme } from '@/contexts/ThemeContext'
import { SYSTEM_OS_APPS, createPageApps } from '@/lib/osAppRegistry'
import { useInstalledApps, appGradient } from '@/hooks/useInstalledApps'
import { useAuth } from '@/contexts/AuthContext'

/**
 * CommandPalette – Umbrel-style ⌘K launcher.
 * Search & jump to apps, pages, the store and system actions.
 */
export function CommandPalette() {
  const { t } = useTranslation()
  const { pages, setCurrentPageId, currentPageId } = usePageNavigation()
  const { setSleepMode, sleepMode, setSelectedTheme } = useTheme()
  const { user } = useAuth()
  const { installedApps } = useInstalledApps()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen((value) => !value)
        setQuery('')
        setSelected(0)
      }
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open) {
      // Focus the input on the next frame so the animation doesn't steal it.
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const pageApps = useMemo(
    () => createPageApps(pages, (name) => iconMap[name as keyof typeof iconMap]),
    [pages],
  )

  type Command = { id: string; label: string; icon?: React.ReactNode; action: () => void; group: string }

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = []
    // Launcher + system apps
    for (const app of [...SYSTEM_OS_APPS, ...pageApps]) {
      if (app.adminOnly && !user?.isAdmin) continue
      const Icon = app.icon
      list.push({
        id: `app-${app.id}`,
        label: app.nameKey ? t(app.nameKey, app.fallbackName) : app.fallbackName,
        icon: <Icon size={16} />,
        group: t('cmd.apps'),
        action: () => { setCurrentPageId(app.pageId); setOpen(false) },
      })
    }
    // Installed Docker apps (open embedded)
    for (const app of installedApps) {
      const Icon = app.icon
      list.push({
        id: `inst-${app.id}`,
        label: app.fallbackName,
        icon: app.iconUrl
          ? <img src={app.iconUrl} alt="" className="h-4 w-4 rounded" />
          : <Icon size={16} />,
        group: t('cmd.apps'),
        action: () => { setCurrentPageId(app.pageId); setOpen(false) },
      })
    }
    // Actions
    list.push({
      id: 'act-store',
      label: t('os.apps.appStore.name'),
      icon: <Storefront size={16} />,
      group: t('cmd.actions'),
      action: () => { setCurrentPageId('app-store'); setOpen(false) },
    })
    list.push({
      id: 'act-settings',
      label: t('navigation.settings'),
      icon: <Gear size={16} />,
      group: t('cmd.actions'),
      action: () => { setCurrentPageId('settings'); setOpen(false) },
    })
    list.push({
      id: 'act-home',
      label: t('cmd.goHome'),
      icon: <House size={16} />,
      group: t('cmd.actions'),
      action: () => { setCurrentPageId('launcher'); setOpen(false) },
    })
    list.push({
      id: 'act-sleep',
      label: sleepMode ? t('cmd.sleepOff') : t('cmd.sleepOn'),
      icon: <Moon size={16} />,
      group: t('cmd.actions'),
      action: () => { setSleepMode(!sleepMode); setOpen(false) },
    })
    list.push({
      id: 'act-lock',
      label: t('cmd.lock'),
      icon: <LockKey size={16} />,
      group: t('cmd.actions'),
      action: () => { window.dispatchEvent(new Event('iora:lock-session')); setOpen(false) },
    })
    list.push({
      id: 'act-theme-night',
      label: t('cmd.themeNight'),
      icon: <Moon size={16} />,
      group: t('cmd.actions'),
      action: () => { void setSelectedTheme('night'); setOpen(false) },
    })
    return list
  }, [pageApps, installedApps, user?.isAdmin, t, sleepMode, setSleepMode, setCurrentPageId, setSelectedTheme])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    return commands.filter((c) => c.label.toLowerCase().includes(q))
  }, [commands, query])

  useEffect(() => setSelected(0), [query])

  const run = (command: Command) => command.action()

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[90] flex items-start justify-center bg-black/60 px-4 pt-[12vh] backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -6 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-neutral-900/95 shadow-2xl shadow-black/50 backdrop-blur-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Search input */}
            <div className="flex items-center gap-3 border-b border-white/5 px-4 py-3.5">
              <MagnifyingGlass size={18} className="shrink-0 text-neutral-500" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((s) => Math.min(s + 1, filtered.length - 1)) }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)) }
                  if (e.key === 'Enter' && filtered[selected]) run(filtered[selected])
                }}
                placeholder={t('cmd.placeholder')}
                className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-neutral-600"
              />
              <kbd className="shrink-0 rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-neutral-500">ESC</kbd>
            </div>

            {/* Results */}
            <div className="max-h-[46vh] overflow-y-auto p-2">
              {filtered.length === 0 ? (
                <p className="px-3 py-8 text-center text-xs text-neutral-600">{t('cmd.noResults')}</p>
              ) : (
                (() => {
                  let lastGroup = ''
                  return filtered.map((command, index) => {
                    const showGroup = command.group !== lastGroup
                    lastGroup = command.group
                    return (
                      <div key={command.id}>
                        {showGroup && (
                          <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
                            {command.group}
                          </p>
                        )}
                        <button
                          type="button"
                          onClick={() => run(command)}
                          onMouseEnter={() => setSelected(index)}
                          className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
                            index === selected ? 'bg-white/10 text-white' : 'text-neutral-300'
                          }`}
                        >
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-neutral-400">
                            {command.icon}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{command.label}</span>
                          {index === selected && <ArrowRight size={14} className="shrink-0 text-neutral-500" />}
                        </button>
                      </div>
                    )
                  })
                })()
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
