import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { MagnifyingGlass, User } from '@phosphor-icons/react'
import { RumahlMark } from '@/components/RumahlMark'
import type { OsAppDefinition } from '@/lib/osAppRegistry'

interface Props {
  open: boolean
  apps: OsAppDefinition[]
  /** Ordered list of recently opened pageIds (most recent first). */
  recent: string[]
  onOpenApp: (app: OsAppDefinition) => void
  onOpenSettings: () => void
  onClose: () => void
}

function LauncherAppRow({ app, name, onOpen }: { app: OsAppDefinition; name: string; onOpen: () => void }) {
  const ColorIcon = app.icon
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-2xl border border-transparent px-3 py-2.5 text-left transition-colors hover:bg-foreground/6 focus-ring"
    >
      <span
        className={`rumahl-app-icon flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden text-white ${app.iconUrl ? 'border-0 bg-transparent shadow-none' : ''}`}
        style={app.iconUrl ? undefined : { '--app-accent': app.accent } as React.CSSProperties}
      >
        {app.iconUrl ? <img src={app.iconUrl} alt={name} className="h-full w-full object-contain p-0.5" /> : <ColorIcon size={26} weight="duotone" />}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-foreground/90">{name}</span>
        <span className="block truncate text-xs text-foreground/45">{app.descriptionKey ? null : app.fallbackName}</span>
      </span>
    </button>
  )
}

/** Small colorful grid tile for the "All Apps" grid (mirrors the launcher). */
function LauncherAppTile({ app, name, onOpen }: { app: OsAppDefinition; name: string; onOpen: () => void }) {
  const ColorIcon = app.icon
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex min-w-0 flex-col items-center gap-1.5 rounded-2xl px-1 py-2 text-center focus-ring"
    >
      <span
        className={`rumahl-app-icon flex h-14 w-14 items-center justify-center overflow-hidden text-white transition-transform duration-200 group-hover:scale-105 ${app.iconUrl ? 'border-0 bg-transparent shadow-none' : ''}`}
        style={app.iconUrl ? undefined : { '--app-accent': app.accent } as React.CSSProperties}
      >
        {app.iconUrl ? <img src={app.iconUrl} alt={name} className="h-full w-full object-contain" /> : <ColorIcon size={28} weight="duotone" />}
      </span>
      <span className="w-full truncate text-[11px] font-medium text-foreground/75">{name}</span>
    </button>
  )
}

/**
 * DesktopLauncherOverlay — the iOS/Android-style app launcher shown as a
 * centered panel over the desktop (opened from the taskbar start button).
 * Contains a search field, a "Recent" row and an "All Apps" grid, matching the
 * referenced design. Closes on Escape / backdrop click.
 */
export function DesktopLauncherOverlay({ open, apps, recent, onOpenApp, onOpenSettings, onClose }: Props) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    // Focus the search once the panel opens.
    const id = window.setTimeout(() => inputRef.current?.focus(), 60)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { window.clearTimeout(id); window.removeEventListener('keydown', onKey) }
  }, [open, onClose])

  const visibleApps = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return apps
    return apps.filter((app) => (app.nameKey ? t(app.nameKey, app.fallbackName) : app.fallbackName).toLocaleLowerCase().includes(normalized))
  }, [apps, query, t])

  // Resolve the recent pageIds back to apps.
  const recentApps = useMemo(() => {
    const byPage = new Map(apps.map((app) => [app.pageId, app]))
    return recent.map((id) => byPage.get(id)).filter((app): app is OsAppDefinition => Boolean(app)).slice(0, 6)
  }, [apps, recent])

  const hasRecent = recentApps.length > 0 && !query

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            aria-label={t('common.close')}
            className="fixed inset-0 z-[90] cursor-default bg-black/30 backdrop-blur-[2px]"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 8 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-x-0 top-[12dvh] z-[91] mx-auto flex w-[min(64rem,calc(100vw-2rem))] max-h-[76dvh] flex-col overflow-hidden rounded-3xl border border-foreground/12 bg-background/92 text-foreground shadow-2xl backdrop-blur-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={t('os.launcher.label')}
          >
            {/* Header: brand + search */}
            <div className="flex items-center gap-3 border-b border-foreground/8 px-5 py-4">
              <span className="flex shrink-0 items-center gap-2 font-semibold tracking-[0.08em] text-foreground/85">
                <RumahlMark className="h-4 text-foreground/85" />
                rumahl OS
              </span>
              <label className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-foreground/12 bg-foreground/4 px-3.5 py-2.5 text-foreground/80 backdrop-blur focus-within:border-accent/40">
                <MagnifyingGlass size={17} className="shrink-0 text-foreground/45" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('os.launcher.commandPlaceholder')}
                  className="w-full bg-transparent text-sm outline-none placeholder:text-foreground/35"
                />
              </label>
              <button
                type="button"
                onClick={onOpenSettings}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-foreground/55 transition-colors hover:bg-foreground/6 hover:text-foreground"
                aria-label={t('os.apps.settings.name')}
                title={t('os.apps.settings.name')}
              >
                <User size={18} weight="duotone" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {hasRecent && (
                <>
                  <div className="mb-2 flex items-center justify-between">
                    <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground/40">{t('os.launcher.recent')}</h2>
                    <button type="button" onClick={() => setQuery('')} className="text-xs font-medium text-accent hover:text-accent/80">{t('os.launcher.clearRecent')}</button>
                  </div>
                  <div className="mb-6 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                    {recentApps.map((app) => (
                      <LauncherAppRow key={app.id} app={app} name={app.nameKey ? t(app.nameKey, app.fallbackName) : app.fallbackName} onOpen={() => onOpenApp(app)} />
                    ))}
                  </div>
                </>
              )}

              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground/40">{t('os.allApps')}</h2>
                {query && <span className="text-xs text-foreground/40">{visibleApps.length}</span>}
              </div>
              {visibleApps.length > 0 ? (
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8">
                  {visibleApps.map((app) => (
                    <LauncherAppTile key={app.id} app={app} name={app.nameKey ? t(app.nameKey, app.fallbackName) : app.fallbackName} onOpen={() => onOpenApp(app)} />
                  ))}
                </div>
              ) : (
                <p className="py-10 text-center text-sm text-foreground/40">{t('os.search')}</p>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  )
}
