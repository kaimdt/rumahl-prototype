import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { ArrowSquareOut, GearSix, Keyboard, LockKey, MagnifyingGlass, PushPin, SignOut, User } from '@phosphor-icons/react'
import { RumahlMark } from '@/components/RumahlMark'
import type { OsAppDefinition } from '@/lib/osAppRegistry'

interface Props {
  open: boolean
  apps: OsAppDefinition[]
  /** Ordered list of recently opened pageIds (most recent first). */
  recent: string[]
  onOpenApp: (app: OsAppDefinition) => void
  onOpenSettings: () => void
  onLock: () => void
  onLogout: () => void
  /** Add an app as a desktop shortcut (start menu → right-click). */
  onAddToDesktop?: (app: OsAppDefinition) => void
  onClose: () => void
}

function LauncherAppRow({ app, name, onOpen, onContextMenu }: { app: OsAppDefinition; name: string; onOpen: () => void; onContextMenu: (event: React.MouseEvent, app: OsAppDefinition) => void }) {
  const ColorIcon = app.icon
  return (
    <button
      type="button"
      onClick={onOpen}
      onContextMenu={(event) => onContextMenu(event, app)}
      data-launcher-app
      className="rumahl-start-recent-item flex w-full items-center gap-3 rounded-2xl border border-transparent px-3 py-2.5 text-left transition-colors hover:bg-foreground/6 focus-ring"
    >
      <span
        className={`rumahl-app-icon rumahl-start-icon-frame flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden text-white ${app.iconUrl ? 'has-image' : ''}`}
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
function LauncherAppTile({ app, name, onOpen, onContextMenu }: { app: OsAppDefinition; name: string; onOpen: () => void; onContextMenu: (event: React.MouseEvent, app: OsAppDefinition) => void }) {
  const ColorIcon = app.icon
  return (
    <button
      type="button"
      onClick={onOpen}
      onContextMenu={(event) => onContextMenu(event, app)}
      data-launcher-app
      className="rumahl-start-app-tile group flex min-w-0 flex-col items-center gap-1.5 rounded-2xl px-1 py-2 text-center focus-ring"
    >
      <span
        className={`rumahl-app-icon rumahl-start-icon-frame flex h-14 w-14 items-center justify-center overflow-hidden text-white transition-transform duration-200 group-hover:scale-105 ${app.iconUrl ? 'has-image' : ''}`}
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
export function DesktopLauncherOverlay({ open, apps, recent, onOpenApp, onOpenSettings, onLock, onLogout, onAddToDesktop, onClose }: Props) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; app: OsAppDefinition } | null>(null)

  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  const openAppContextMenu = (event: React.MouseEvent, app: OsAppDefinition) => {
    event.preventDefault()
    event.stopPropagation()
    setContextMenu({ x: event.clientX, y: event.clientY, app })
  }

  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement | null
      return
    }
    previousFocusRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setContextMenu(null)
    // Focus the search once the panel opens.
    const id = window.setTimeout(() => inputRef.current?.focus(), 60)
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      if (e.key === 'Escape') { onCloseRef.current(); return }
      if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
      const buttons = Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>('[data-launcher-app]') || [])
      if (!buttons.length) return
      const activeIndex = buttons.indexOf(document.activeElement as HTMLButtonElement)
      if (document.activeElement === inputRef.current && (e.key === 'ArrowDown' || e.key === 'ArrowRight')) {
        e.preventDefault()
        buttons[0].focus()
        return
      }
      if (activeIndex < 0) return
      e.preventDefault()
      if (e.key === 'Home') buttons[0].focus()
      else if (e.key === 'End') buttons[buttons.length - 1].focus()
      else {
        const direction = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1
        buttons[(activeIndex + direction + buttons.length) % buttons.length].focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(id)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

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
            onClick={() => { setContextMenu(null); onClose() }}
            aria-label={t('common.close')}
            className="fixed inset-0 z-[var(--layer-flyout-backdrop)] cursor-default bg-black/30 backdrop-blur-[2px]"
          />
          <motion.div
            ref={panelRef}
            initial={{ opacity: 0, scale: 0.97, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 8 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="rumahl-start-menu fixed inset-x-0 top-[12dvh] z-[var(--layer-flyout)] mx-auto flex w-[min(64rem,calc(100vw-2rem))] max-h-[76dvh] flex-col overflow-hidden text-foreground"
            onClick={(event) => { event.stopPropagation(); setContextMenu(null) }}
            onContextMenu={(event) => {
              if (!(event.target as HTMLElement).closest('[data-launcher-app]')) setContextMenu(null)
            }}
            role="dialog"
            aria-modal="true"
            aria-label={t('os.launcher.label')}
          >
            {/* Header: brand + search */}
            <div className="rumahl-start-menu-header flex items-center gap-3 border-b border-foreground/8 px-5 py-4">
              <span className="flex shrink-0 items-center gap-2 font-semibold tracking-[0.08em] text-foreground/85">
                <RumahlMark className="h-4 text-foreground/85" />
                rumahl OS
              </span>
              <label className="rumahl-start-search flex min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-foreground/12 bg-foreground/4 px-3.5 py-2.5 text-foreground/80 backdrop-blur focus-within:border-accent/40">
                <MagnifyingGlass size={17} className="shrink-0 text-foreground/45" />
                <input
                  aria-label={t('os.search')}
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'ArrowDown') return
                    const firstApp = panelRef.current?.querySelector<HTMLButtonElement>('[data-launcher-app]')
                    if (firstApp) { e.preventDefault(); firstApp.focus() }
                  }}
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

            <div className="rumahl-start-menu-content min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {hasRecent && (
                <>
                  <div className="mb-2 flex items-center justify-between">
                    <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground/40">{t('os.launcher.recent')}</h2>
                    <button type="button" onClick={() => setQuery('')} className="text-xs font-medium text-accent hover:text-accent/80">{t('os.launcher.clearRecent')}</button>
                  </div>
                  <div className="mb-5 grid gap-1 sm:grid-cols-2">
                    {recentApps.map((app) => (
                      <LauncherAppRow key={app.id} app={app} name={app.nameKey ? t(app.nameKey, app.fallbackName) : app.fallbackName} onOpen={() => onOpenApp(app)} onContextMenu={openAppContextMenu} />
                    ))}
                  </div>
                </>
              )}

              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground/40">{t('os.allApps')}</h2>
                {query && <span className="text-xs text-foreground/40">{visibleApps.length}</span>}
              </div>
              {visibleApps.length > 0 ? (
                <div className="rumahl-start-app-grid grid grid-cols-4 gap-2 sm:grid-cols-5 md:grid-cols-6">
                  {visibleApps.map((app) => (
                    <LauncherAppTile key={app.id} app={app} name={app.nameKey ? t(app.nameKey, app.fallbackName) : app.fallbackName} onOpen={() => onOpenApp(app)} onContextMenu={openAppContextMenu} />
                  ))}
                </div>
              ) : (
                <p role="status" className="py-10 text-center text-sm text-foreground/60">{t('common.noResults')}</p>
              )}
            </div>
            <footer className="rumahl-start-menu-footer flex items-center justify-between gap-3 border-t border-foreground/8 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2 text-[10px] text-foreground/40">
                <Keyboard size={15} className="shrink-0" />
                <span className="truncate">{t('os.run.title')}</span>
                <kbd>Ctrl Shift Enter</kbd>
                <span className="hidden sm:inline">· {t('shortcuts.taskSwitcher.label')}</span>
                <kbd className="hidden sm:inline">Ctrl Shift Space</kbd>
              </div>
              <div className="rumahl-start-session-actions flex shrink-0 items-center gap-1">
                <button type="button" onClick={onLock} title={t('os.shell.lock')}><LockKey size={16} /><span>{t('os.shell.lock')}</span></button>
                <button type="button" onClick={onLogout} title={t('os.shell.logout')}><SignOut size={16} /><span>{t('os.shell.logout')}</span></button>
                <button type="button" onClick={onOpenSettings} className="rumahl-start-footer-settings" title={t('os.apps.settings.name')}><GearSix size={16} /><span>{t('os.apps.settings.name')}</span></button>
              </div>
            </footer>
          </motion.div>
          {contextMenu && (
            <motion.div
              initial={{ opacity: 0, y: 4, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className="rumahl-start-app-context fixed z-[var(--layer-menu)] w-56 rumahl-menu"
              style={{ left: Math.min(contextMenu.x, window.innerWidth - 240), top: Math.min(contextMenu.y, window.innerHeight - 132) }}
              role="menu"
              onClick={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.preventDefault()}
            >
              <p className="truncate px-2.5 py-1.5 text-[11px] font-semibold text-foreground/45">
                {contextMenu.app.nameKey ? t(contextMenu.app.nameKey, contextMenu.app.fallbackName) : contextMenu.app.fallbackName}
              </p>
              <button type="button" role="menuitem" onClick={() => { onOpenApp(contextMenu.app); setContextMenu(null) }} className="rumahl-start-context-action">
                <ArrowSquareOut size={16} />
                {t('os.launcher.open')}
              </button>
              {onAddToDesktop && (
                <button type="button" role="menuitem" onClick={() => { onAddToDesktop(contextMenu.app); setContextMenu(null) }} className="rumahl-start-context-action">
                  <PushPin size={16} />
                  {t('os.desktopMenu.addToDesktop')}
                </button>
              )}
            </motion.div>
          )}
        </>
      )}
    </AnimatePresence>,
    document.body,
  )
}
