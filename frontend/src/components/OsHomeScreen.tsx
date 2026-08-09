import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowRight,
  Check,
  Clock,
  Heartbeat,
  Gear,
  House,
  MagnifyingGlass,
  Plus,
  SquaresFour,
  UploadSimple,
  WifiHigh,
  X,
  PencilSimple,
  Cpu,
  Memory,
} from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { buildLauncherItems, LauncherAppGrid, type LauncherFolder } from '@/components/LauncherAppGrid'
import { useAuth } from '@/contexts/AuthContext'
import { iconMap, usePageNavigation } from '@/contexts/PageNavigationContext'
import { createPageApps, SYSTEM_OS_APPS, type OsAppDefinition } from '@/lib/osAppRegistry'
import { useOsPermissions } from '@/hooks/useOsPermissions'
import { useOsWindows, type OsLaunchMode } from '@/contexts/OsWindowContext'
import { useLocalStorage } from '@/lib/storage'
import { loadLauncherPackages, type StoreLauncherPackage, type StoreWidgetPackage } from '@/lib/launcherPackages'
import { loadSettingsFromBackend } from '@/lib/settingsSync'
import { getPreferredLaunchMode, setPreferredLaunchMode } from '@/lib/launchModes'
import { authFetch } from '@/lib/authHelpers'
import { useConnection } from '@/contexts/ConnectionContext'
import { useInstalledApps, appGradient } from '@/hooks/useInstalledApps'
import { STORE_CATALOG } from '@/lib/storeCatalog'

type BuiltInLauncher = 'default' | 'deck' | 'canvas'

interface LauncherManifest {
  type: 'iora-launcher'
  id: string
  name: string
  base: BuiltInLauncher
  accent?: string
}

const LAUNCHER_KEY = 'iora-os-launcher'
const CUSTOM_LAUNCHERS_KEY = 'iora-os-custom-launchers'
const LAUNCHER_WIDGETS_KEY = 'iora-os-launcher-widgets'
const LAUNCHER_FOLDERS_KEY = 'iora-os-launcher-folders'

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

function AppIcon({ app, size = 'normal' }: { app: OsAppDefinition; size?: 'normal' | 'large' }) {
  const Icon = app.icon
  const iconSize = size === 'large' ? 38 : 27
  return (
    <span
      className={`ora-app-icon relative flex shrink-0 items-center justify-center overflow-hidden text-white ${size === 'large' ? 'h-20 w-20 rounded-[1.7rem]' : 'h-14 w-14 rounded-2xl'} ${
        app.iconUrl ? 'border-0 bg-transparent shadow-none' : 'border border-white/15 shadow-lg'
      }`}
      style={app.iconUrl
        ? undefined
        : { background: `linear-gradient(145deg, color-mix(in oklch, ${app.accent} 88%, white), color-mix(in oklch, ${app.accent} 72%, black))` }}
    >
      {!app.iconUrl && <span className="ora-app-icon-highlight absolute inset-0" />}
      {app.iconUrl ? (
        <img src={app.iconUrl} alt={app.fallbackName} className={`h-full w-full ${app.iconPad ? 'object-contain p-1' : 'object-cover'}`} />
      ) : Icon ? (
        <Icon size={iconSize} weight="duotone" className="relative" />
      ) : null}
    </span>
  )
}

export function OsHomeScreen() {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const { pages, setCurrentPageId } = usePageNavigation()
  const { permissions } = useOsPermissions()
  const { backend, homeAssistant } = useConnection()
  const { installedApps, activeJobs } = useInstalledApps()
  const [sysStats, setSysStats] = useState<{ cpu: number; mem: number; hostname: string } | null>(null)

  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [customLaunchers, setCustomLaunchers] = useLocalStorage<LauncherManifest[]>(CUSTOM_LAUNCHERS_KEY, [])
  const [launcherId, setLauncherId] = useLocalStorage<string>(LAUNCHER_KEY, localStorage.getItem(LAUNCHER_KEY)?.replace(/^"|"$/g, '') || 'default')
  const [widgetIds, setWidgetIds] = useLocalStorage<string[]>(LAUNCHER_WIDGETS_KEY, ['home', 'clock'])
  // System widget data (only fetched while the widget is enabled).
  useEffect(() => {
    if (!widgetIds.includes('system')) return
    let cancelled = false
    const load = async () => {
      try {
        const res = await authFetch('/api/os/control/system')
        if (!res.ok) return
        const data = await res.json() as { cpu_usage_percent?: number; memory_used_bytes?: number; memory_total_bytes?: number; hostname?: string }
        if (!cancelled) {
          setSysStats({
            cpu: Math.round(data.cpu_usage_percent || 0),
            mem: data.memory_total_bytes ? Math.round((data.memory_used_bytes || 0) / data.memory_total_bytes * 100) : 0,
            hostname: data.hostname || '',
          })
        }
      } catch { /* backend may be offline */ }
    }
    void load()
    const interval = window.setInterval(load, 15000)
    return () => { cancelled = true; window.clearInterval(interval) }
  }, [widgetIds])
  const now = useClock()

  const [folders, setFolders] = useLocalStorage<LauncherFolder[]>(LAUNCHER_FOLDERS_KEY, [])
  const [editMode, setEditMode] = useState(false)
  const [storeLaunchers, setStoreLaunchers] = useState<StoreLauncherPackage[]>([])
  const [storeWidgets, setStoreWidgets] = useState<StoreWidgetPackage[]>([])
  const [storeReachable, setStoreReachable] = useState<boolean | null>(null)
  const pointerStart = useRef<number | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)

  const availableLaunchers = useMemo(() => [...customLaunchers, ...storeLaunchers], [customLaunchers, storeLaunchers])
  const launcher = availableLaunchers.find((item) => item.id === launcherId)
  const layout: BuiltInLauncher = launcher?.base || (['default', 'deck', 'canvas'].includes(launcherId) ? launcherId as BuiltInLauncher : 'default')

  const apps = useMemo(() => {
    const pageApps = createPageApps(pages, (name) => iconMap[name as keyof typeof iconMap])
    // Installed Docker/user apps appear in the launcher once they RUN
    // (CasaOS-style lifecycle). Duplicates with page apps are skipped.
    const pageIds = new Set([...SYSTEM_OS_APPS, ...pageApps].map((app) => app.pageId))
    const extra = installedApps.filter((app) => !pageIds.has(app.pageId))
    return [...SYSTEM_OS_APPS, ...pageApps, ...extra]
      .filter((app) => !app.adminOnly || user?.isAdmin)
      .filter((app) => !app.requiredPermission || permissions[app.requiredPermission] === true)
      .sort((a, b) => a.order - b.order)
  }, [pages, permissions, user?.isAdmin, installedApps])

  const visibleApps = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return apps
    return apps.filter((app) => (app.nameKey ? t(app.nameKey, app.fallbackName) : app.fallbackName).toLocaleLowerCase().includes(normalized))
  }, [apps, query, t])

  const homeApp = apps.find((app) => app.id === 'iora-home')
  const launcherItems = useMemo(() => buildLauncherItems(visibleApps, query ? [] : folders), [folders, query, visibleApps])
  const pageSize = 24
  const appPages = useMemo(() => {
    const result: ReturnType<typeof buildLauncherItems>[] = []
    for (let index = 0; index < launcherItems.length; index += pageSize) result.push(launcherItems.slice(index, index + pageSize))
    return result.length ? result : [[]]
  }, [launcherItems])
  const activePage = Math.min(page, appPages.length - 1)

  useEffect(() => setPage(0), [query, launcherId])
  useEffect(() => {
    const applySyncedSettings = () => {
      const syncedLauncher = localStorage.getItem(LAUNCHER_KEY)?.replace(/^"|"$/g, '')
      if (syncedLauncher) setLauncherId(syncedLauncher)
      try {
        const syncedLaunchers = JSON.parse(localStorage.getItem(CUSTOM_LAUNCHERS_KEY) || '[]')
        if (Array.isArray(syncedLaunchers)) setCustomLaunchers(syncedLaunchers)
        const syncedWidgets = JSON.parse(localStorage.getItem(LAUNCHER_WIDGETS_KEY) || '[]')
        if (Array.isArray(syncedWidgets)) setWidgetIds(syncedWidgets)
        const syncedFolders = JSON.parse(localStorage.getItem(LAUNCHER_FOLDERS_KEY) || '[]')
        if (Array.isArray(syncedFolders)) setFolders(syncedFolders)
      } catch {
        // Keep the last valid local launcher configuration.
      }
    }
    const refresh = () => { void loadSettingsFromBackend() }
    window.addEventListener('iora:settings-synced', applySyncedSettings)
    window.addEventListener('focus', refresh)
    const timer = window.setInterval(refresh, 30_000)
    refresh()
    return () => {
      window.removeEventListener('iora:settings-synced', applySyncedSettings)
      window.removeEventListener('focus', refresh)
      window.clearInterval(timer)
    }
  }, [setCustomLaunchers, setFolders, setLauncherId, setWidgetIds])
  useEffect(() => {
    let cancelled = false
    const refreshPackages = () => {
      loadLauncherPackages()
        .then((packages) => {
          if (cancelled) return
          setStoreLaunchers(packages.launchers)
          setStoreWidgets(packages.widgets)
          setStoreReachable(true)
        })
        .catch(() => {
          if (!cancelled) setStoreReachable(false)
        })
    }
    refreshPackages()
    window.addEventListener('focus', refreshPackages)
    const timer = window.setInterval(refreshPackages, 30_000)
    return () => {
      cancelled = true
      window.removeEventListener('focus', refreshPackages)
      window.clearInterval(timer)
    }
  }, [])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return
      if (event.key === 'ArrowRight') setPage((value) => Math.min(value + 1, appPages.length - 1))
      if (event.key === 'ArrowLeft') setPage((value) => Math.max(value - 1, 0))
      if (event.key === 'Home' && homeApp) setCurrentPageId(homeApp.pageId)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [appPages.length, homeApp, setCurrentPageId])
  useEffect(() => {
    const openCommand = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchInput.current?.focus()
      }
    }
    window.addEventListener('keydown', openCommand)
    return () => window.removeEventListener('keydown', openCommand)
  }, [])

  const selectLauncher = (id: string) => {
    setLauncherId(id)
  }

  const toggleWidget = (id: string) => {
    const next = widgetIds.includes(id) ? widgetIds.filter((item) => item !== id) : [...widgetIds, id]
    setWidgetIds(next)
  }

  const installLauncher = async (file: File) => {
    try {
      const manifest = JSON.parse(await file.text()) as LauncherManifest
      if (manifest.type !== 'iora-launcher' || !manifest.id || !manifest.name || !['default', 'deck', 'canvas'].includes(manifest.base)) throw new Error('invalid')
      const next = [...customLaunchers.filter((item) => item.id !== manifest.id), manifest]
      setCustomLaunchers(next)
      selectLauncher(manifest.id)
    } catch {
      window.dispatchEvent(new CustomEvent('iora:toast', { detail: { message: t('os.launcher.invalidManifest') } }))
    }
  }

  const { openWindow, openSplit, setImmersive } = useOsWindows()
  const launchApp = (app: OsAppDefinition, mode: OsLaunchMode) => {
    // Explicit launch-mode picks become the app's default so the app keeps
    // running the same way next time.
    setPreferredLaunchMode(app.pageId, mode)
    if (mode === 'fullscreen') {
      setImmersive(null)
      setCurrentPageId(app.pageId)
    } else if (mode === 'immersive') {
      setImmersive(app.pageId)
      setCurrentPageId(app.pageId)
    } else if (mode === 'window') {
      // Already on the desktop (launcher) — open the floating window here.
      openWindow(app.pageId)
    } else {
      openSplit(app.pageId, mode)
    }
  }

  const openApp = (app: OsAppDefinition) => {
    // Docker apps with a web UI open embedded (iframe runner) — the
    // runner offers "open in browser" for the external tab.
    if (app.openUrl) {
      // Not running yet → start it first, then open.
      if (app.kind === 'installed' && app.runtimeStatus !== 'running') {
        void authFetch(`/api/supervisor/apps/${app.pageId}/start`, { method: 'POST' })
          .then(() => { window.setTimeout(() => setCurrentPageId(app.pageId), 2000) })
          .catch(() => setCurrentPageId(app.pageId))
        return
      }
      setCurrentPageId(app.pageId)
      return
    }
    const mode = getPreferredLaunchMode(app.pageId)
    if (mode === 'window') {
      openWindow(app.pageId)
      setCurrentPageId('launcher')
    } else if (mode === 'split-left' || mode === 'split-right') {
      openSplit(app.pageId, mode)
      setCurrentPageId('launcher')
    } else if (mode === 'immersive') {
      setImmersive(app.pageId)
      setCurrentPageId(app.pageId)
    } else {
      setCurrentPageId(app.pageId)
    }
  }
  const getName = (app: OsAppDefinition) => app.nameKey ? t(app.nameKey, app.fallbackName) : app.fallbackName
  const getDescription = (app: OsAppDefinition) => app.descriptionKey ? t(app.descriptionKey) : t('os.launcher.openApp')

  const onWheelPage = (event: React.WheelEvent) => {
    // Shift + mouse wheel switches launcher pages (Windows-style).
    if (!event.shiftKey) return
    event.preventDefault()
    if (event.deltaY > 0) setPage((value) => Math.min(value + 1, appPages.length - 1))
    else setPage((value) => Math.max(value - 1, 0))
  }

  const swipeHandlers = {
    onPointerDown: (event: React.PointerEvent) => { pointerStart.current = event.clientX },
    onPointerUp: (event: React.PointerEvent) => {
      if (pointerStart.current === null) return
      const distance = event.clientX - pointerStart.current
      if (Math.abs(distance) > 55) setPage((value) => distance < 0 ? Math.min(value + 1, appPages.length - 1) : Math.max(value - 1, 0))
      pointerStart.current = null
    },
  }

  const appGrid = <LauncherAppGrid items={appPages[activePage]} apps={apps} folders={folders} editMode={editMode} onEditModeChange={setEditMode} onFoldersChange={setFolders} onOpenApp={openApp} getAppName={getName} onLaunch={launchApp} />

  return (
    <section
      className="relative min-h-[calc(100dvh-8rem)] select-none pb-4 pt-2"
      style={launcher?.accent ? { '--accent': launcher.accent } as React.CSSProperties : undefined}
      aria-label={t('os.launcher.label')}
      onWheel={onWheelPage}
      {...swipeHandlers}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-1">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-foreground/55"><SquaresFour size={18} weight="fill" className="text-accent" /> ORA OS</div>
        <div className="flex items-center gap-2">
          {homeApp && (
            <button type="button" onClick={() => openApp(homeApp)} className="glass-card flex min-h-11 touch-manipulation items-center gap-2 rounded-full px-3 text-sm font-semibold text-foreground/80 hover:text-foreground focus-ring">
              <House size={18} weight="fill" className="text-accent" /><span className="hidden sm:inline">{t('os.launcher.openHome')}</span>
            </button>
          )}
          <button type="button" onClick={() => setSettingsOpen(true)} className="glass-card flex h-11 w-11 touch-manipulation items-center justify-center rounded-full text-foreground/70 hover:text-foreground focus-ring" aria-label={t('os.launcher.customize')}><Gear size={19} /></button>
        </div>
      </div>

      {layout === 'default' && (
        <div className="mx-auto mt-5 max-w-6xl px-1">
          <div className="ora-home-hero mb-6 text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-4xl">{t('os.greeting', { name: user?.displayName || user?.username || t('os.defaultUser') })}</h1>
            <p className="mx-auto mt-2 max-w-xl text-sm text-white/50">{t('os.subtitle')}</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <span className="ora-status-chip"><Heartbeat size={15} weight="duotone" /><i className={backend === 'connected' ? 'is-online' : 'is-offline'} />{t('os.launcher.backendStatus')}</span>
              <span className="ora-status-chip"><WifiHigh size={15} weight="duotone" /><i className={homeAssistant === 'connected' ? 'is-online' : 'is-offline'} />{t('os.launcher.homeAssistantStatus')}</span>
            </div>
          </div>
          {editMode && widgetIds.length > 0 && (
            <div className="mb-4 flex items-center gap-2 rounded-2xl border border-accent/20 bg-accent/8 px-4 py-2.5 text-xs font-medium text-foreground/70">
              <PencilSimple size={14} className="text-accent" />
              {t('os.launcher.widgetsEditHint')}
            </div>
          )}
          {widgetIds.length > 0 && <div className="mb-5 grid gap-3 sm:grid-cols-2">
            {widgetIds.includes('home') && <button type="button" onClick={() => homeApp && openApp(homeApp)} className="glass-card group relative flex min-h-32 touch-manipulation items-center gap-4 rounded-[2rem] p-5 text-left focus-ring sm:p-6">
              {homeApp && <AppIcon app={homeApp} size="large" />}
              <span className="min-w-0 flex-1"><span className="block text-xs uppercase tracking-[0.18em] text-accent">{t('os.launcher.nativeHome')}</span><span className="mt-1 block text-xl font-semibold sm:text-2xl">{t('os.apps.home.name')}</span><span className="mt-1 block text-sm text-foreground/50">{t('os.apps.home.description')}</span></span>
              <ArrowRight size={22} className="text-foreground/35 transition-transform group-hover:translate-x-1" />
              {editMode && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); toggleWidget('home') }}
                  onKeyDown={(e) => { if (e.key === 'Enter') toggleWidget('home') }}
                  className="absolute -right-2 -top-2 z-10 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-destructive text-white shadow-lg transition-transform hover:scale-110"
                  aria-label={t('common.remove')}
                >
                  <X size={12} weight="bold" />
                </span>
              )}
            </button>}
            {widgetIds.includes('clock') && <div className="glass-card relative flex min-h-32 items-center justify-between rounded-[2rem] p-5">
              <div><p className="text-4xl font-semibold tabular-nums">{now.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })}</p><p className="mt-1 text-sm text-foreground/50">{now.toLocaleDateString(i18n.language, { weekday: 'long', day: 'numeric', month: 'long' })}</p></div><Clock size={28} weight="duotone" className="text-accent" />
              {editMode && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleWidget('clock')}
                  onKeyDown={(e) => { if (e.key === 'Enter') toggleWidget('clock') }}
                  className="absolute -right-2 -top-2 z-10 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-destructive text-white shadow-lg transition-transform hover:scale-110"
                  aria-label={t('common.remove')}
                >
                  <X size={12} weight="bold" />
                </span>
              )}
            </div>}
            {widgetIds.includes('system') && (
              <div className="glass-card relative flex min-h-32 items-center justify-between rounded-[2rem] p-5 sm:col-span-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">{t('os.launcher.systemWidget')}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2">
                    <span className="flex items-center gap-2 text-sm text-foreground/75"><Cpu size={16} className="text-accent" /><strong className="tabular-nums">{sysStats?.cpu ?? '–'}%</strong>{t('os.launcher.cpu')}</span>
                    <span className="flex items-center gap-2 text-sm text-foreground/75"><Memory size={16} className="text-accent" /><strong className="tabular-nums">{sysStats?.mem ?? '–'}%</strong>{t('os.shell.memory')}</span>
                    {sysStats?.hostname && <span className="text-sm text-foreground/45">{sysStats.hostname}</span>}
                  </div>
                  <div className="mt-3 h-1.5 w-full max-w-md overflow-hidden rounded-full bg-foreground/10">
                    <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${Math.max(2, sysStats?.cpu ?? 0)}%` }} />
                  </div>
                </div>
                <Cpu size={30} weight="duotone" className="shrink-0 text-accent/70" />
                {editMode && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleWidget('system')}
                    onKeyDown={(e) => { if (e.key === 'Enter') toggleWidget('system') }}
                    className="absolute -right-2 -top-2 z-10 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-destructive text-white shadow-lg transition-transform hover:scale-110"
                    aria-label={t('common.remove')}
                  >
                    <X size={12} weight="bold" />
                  </span>
                )}
              </div>
            )}
          </div>}
          {storeWidgets.some((widget) => widgetIds.includes(widget.id)) && <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{storeWidgets.filter((widget) => widgetIds.includes(widget.id)).map((widget) => <article key={widget.id} className="glass-card min-h-40 overflow-hidden rounded-[2rem] border border-white/10"><header className="flex items-center justify-between gap-2 border-b border-foreground/8 px-4 py-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{widget.name}</p><p className="truncate text-[10px] text-foreground/40">{widget.sourceAppId} · {widget.version}</p></div><SquaresFour size={18} className="shrink-0 text-accent" /></header>{widget.componentUrl ? <iframe title={widget.name} src={widget.componentUrl} sandbox="allow-scripts allow-forms" loading="lazy" className="h-48 w-full border-0 bg-transparent" /> : <div className="flex min-h-28 items-center justify-center p-4 text-center text-xs text-foreground/45">{widget.description || t('os.launcher.widgetReady')}</div>}</article>)}</div>}
          {installedApps.length === 0 && (
            <div className="mb-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
                  <span className="h-4 w-1 rounded-full bg-accent" />
                  {t('os.launcher.discoverApps')}
                </h3>
                <button
                  type="button"
                  onClick={() => setCurrentPageId('app-store')}
                  className="text-[11px] font-semibold text-accent transition-colors hover:text-accent/80"
                >
                  {t('os.apps.appStore.name')} <ArrowRight size={11} className="inline" />
                </button>
              </div>
              <p className="mb-3 text-xs text-foreground/45">{t('os.launcher.discoverAppsHint')}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {STORE_CATALOG.map((def) => (
                  <button
                    key={def.id}
                    type="button"
                    onClick={() => setCurrentPageId('app-store')}
                    className="glass-card flex items-center gap-3 rounded-2xl p-4 text-left transition-all hover:-translate-y-0.5 hover:border-foreground/15"
                  >
                    <span className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl shadow-lg" style={{ background: appGradient(def.id) }}>
                      {def.iconUrl && <img src={def.iconUrl} alt="" className="h-full w-full object-cover" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-foreground">{def.name}</span>
                      <span className="mt-0.5 block truncate text-xs text-foreground/50">{def.description}</span>
                    </span>
                    <ArrowRight size={16} className="shrink-0 text-foreground/30" />
                  </button>
                ))}
              </div>
            </div>
          )}
          <label className="ora-command-search mx-auto mb-6 flex min-h-14 max-w-2xl items-center gap-3 rounded-2xl px-4"><MagnifyingGlass size={20} className="text-white/45" /><span className="sr-only">{t('os.search')}</span><input ref={searchInput} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && visibleApps[0]) openApp(visibleApps[0]) }} placeholder={t('os.launcher.commandPlaceholder')} className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/35" /><kbd>⌘K</kbd></label>
          {appGrid}
        </div>
      )}

      {layout === 'deck' && (
        <div className="mx-auto mt-7 grid max-w-7xl gap-5 px-1 lg:grid-cols-[0.85fr_1.15fr]">
          <div className="glass-card rounded-[2rem] p-5 sm:p-7"><p className="text-xs uppercase tracking-[0.18em] text-accent">{t('os.launcher.intelligent')}</p><h2 className="mt-2 text-2xl font-semibold sm:text-3xl">{t('os.launcher.whatToDo')}</h2><label className="mt-6 flex min-h-14 items-center gap-3 rounded-2xl border border-foreground/12 bg-foreground/5 px-4"><MagnifyingGlass size={20} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('os.launcher.commandPlaceholder')} className="w-full bg-transparent text-sm outline-none" /></label><div className="mt-5 flex flex-wrap gap-2">{apps.slice(0, 4).map((app) => <button key={app.id} type="button" onClick={() => openApp(app)} className="rounded-full border border-foreground/10 bg-foreground/5 px-3 py-2 text-xs hover:bg-foreground/10">{getName(app)}</button>)}</div></div>
          <div className="space-y-2"><p className="mb-3 px-2 text-sm font-semibold">{t('os.allApps')}</p>{visibleApps.map((app) => <button key={app.id} type="button" onClick={() => openApp(app)} className="glass-card flex min-h-20 w-full touch-manipulation items-center gap-4 rounded-2xl p-3 text-left hover:bg-foreground/10 focus-ring"><AppIcon app={app} /><span className="min-w-0 flex-1"><span className="block font-semibold">{getName(app)}</span><span className="block truncate text-xs text-foreground/45">{getDescription(app)}</span></span><ArrowRight size={18} className="text-foreground/35" /></button>)}</div>
        </div>
      )}

      {layout === 'canvas' && (
        <div className="mx-auto mt-8 max-w-7xl overflow-hidden px-1"><label className="glass-card mx-auto mb-10 flex min-h-12 max-w-sm items-center gap-3 rounded-full px-4"><MagnifyingGlass size={19} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('os.search')} className="w-full bg-transparent text-sm outline-none" /></label><div className="flex snap-x snap-mandatory gap-4 overflow-x-auto px-[10vw] pb-6 [scrollbar-width:none]">{visibleApps.map((app, index) => <button key={app.id} type="button" onClick={() => openApp(app)} className={`glass-card group min-h-72 shrink-0 snap-center rounded-[2rem] p-5 text-left focus-ring ${index === 0 ? 'w-[min(78vw,28rem)]' : 'w-[min(68vw,20rem)]'}`}><AppIcon app={app} size="large" /><span className="mt-20 block text-2xl font-semibold">{getName(app)}</span><span className="mt-2 block text-sm text-foreground/50">{getDescription(app)}</span><span className="mt-5 inline-flex items-center gap-2 text-sm text-accent">{t('os.launcher.open')}<ArrowRight size={16} /></span></button>)}</div></div>
      )}

      {layout === 'default' && appPages.length > 1 && <div className="mt-7 flex justify-center gap-2" aria-label={t('os.launcher.pages')}>{appPages.map((_, index) => <button key={index} type="button" onClick={() => setPage(index)} className={`h-2.5 rounded-full transition-all ${index === activePage ? 'w-7 bg-accent' : 'w-2.5 bg-foreground/25'}`} aria-label={t('os.launcher.page', { page: index + 1 })} />)}</div>}

      {settingsOpen && <div className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-3 z-[82] max-h-[52dvh] w-[min(23.5rem,calc(100vw-1.5rem))] overflow-y-auto rounded-2xl border border-white/10 bg-background/95 p-3 shadow-2xl backdrop-blur-xl">
        <div className="mb-3 flex items-center justify-between gap-2 px-1"><p className="text-xs font-semibold uppercase tracking-wider text-foreground/45">{t('os.launcher.sync')}</p><span className={`text-[10px] ${storeReachable ? 'text-emerald-400' : storeReachable === false ? 'text-amber-400' : 'text-foreground/40'}`}>{storeReachable ? t('os.launcher.synced') : storeReachable === false ? t('os.launcher.offline') : t('os.launcher.syncing')}</span></div>
        {storeLaunchers.length > 0 && <><p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-foreground/45">{t('os.launcher.storeLaunchers')}</p><div className="mb-4 grid grid-cols-2 gap-2">{storeLaunchers.map((item) => <button key={item.id} type="button" onClick={() => selectLauncher(item.id)} className={`min-h-16 rounded-xl border p-3 text-left ${launcherId === item.id ? 'border-accent/50 bg-accent/10' : 'border-foreground/10 bg-foreground/5'}`}><span className="block truncate text-xs font-semibold">{item.name}</span><span className="mt-1 block text-[10px] text-foreground/40">{item.sourceAppId} · {item.version}</span></button>)}</div></>}
        <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-foreground/45">{t('os.launcher.widgets')}</p>
        <div className="grid grid-cols-2 gap-2">{[{ id: 'home', label: t('os.launcher.homeWidget'), desc: t('os.launcher.homeWidgetDesc'), icon: House }, { id: 'clock', label: t('os.launcher.clockWidget'), desc: t('os.launcher.clockWidgetDesc'), icon: Clock }, { id: 'system', label: t('os.launcher.systemWidget'), desc: t('os.launcher.systemWidgetDesc'), icon: Cpu }].map((widget) => { const WidgetIcon = widget.icon; const enabled = widgetIds.includes(widget.id); return <button key={widget.id} type="button" onClick={() => toggleWidget(widget.id)} className={`flex min-h-16 items-center gap-2 rounded-xl border p-3 text-left ${enabled ? 'border-accent/50 bg-accent/10' : 'border-foreground/10 bg-foreground/5'}`}><WidgetIcon size={19} className={enabled ? 'text-accent' : 'text-foreground/50'} /><span className="min-w-0 flex-1"><span className="block text-xs font-semibold">{widget.label}</span><span className="mt-0.5 block truncate text-[10px] text-foreground/40">{widget.desc}</span></span>{enabled && <Check size={15} className="text-accent" />}</button> })}</div>
        {storeWidgets.length > 0 && <><p className="mb-2 mt-4 px-1 text-xs font-semibold uppercase tracking-wider text-foreground/45">{t('os.launcher.storeWidgets')}</p><div className="grid grid-cols-2 gap-2">{storeWidgets.map((widget) => { const enabled = widgetIds.includes(widget.id); return <button key={widget.id} type="button" onClick={() => toggleWidget(widget.id)} className={`min-h-16 rounded-xl border p-3 text-left ${enabled ? 'border-accent/50 bg-accent/10' : 'border-foreground/10 bg-foreground/5'}`}><span className="block truncate text-xs font-semibold">{widget.name}</span><span className="mt-1 flex items-center justify-between text-[10px] text-foreground/40"><span className="truncate">{widget.sourceAppId}</span>{enabled && <Check size={14} className="shrink-0 text-accent" />}</span></button> })}</div></>}
      </div>}

      {/* Install progress — compact pill above the dock so it never blocks content */}
      <AnimatePresence>
        {activeJobs.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            className="fixed bottom-[calc(max(0.9rem,env(safe-area-inset-bottom))+4.6rem)] left-1/2 z-[59] w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2"
          >
            <div className="glass-card overflow-hidden rounded-2xl border border-foreground/10 px-4 py-3 shadow-2xl shadow-black/30">
              {activeJobs.slice(0, 3).map((job) => (
                <div key={job.id} className="flex items-center gap-3 py-1">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold text-white" style={{ background: appGradient(job.appId || 'app') }}>
                    {(job.appName || job.appId || '?').charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-foreground">{job.appName || job.appId || t('os.launcher.installingApp')}</p>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-foreground/10">
                      <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${Math.max(3, Math.min(100, job.progress))}%` }} />
                    </div>
                  </div>
                  <span className="shrink-0 text-[10px] font-semibold tabular-nums text-foreground/55">{Math.round(job.progress)}%</span>
                </div>
              ))}
              {activeJobs.length > 3 && (
                <p className="pt-1 text-center text-[10px] text-foreground/40">+{activeJobs.length - 3} {t('os.launcher.moreInstalls')}</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>{settingsOpen && <><motion.button type="button" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSettingsOpen(false)} className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-sm" aria-label={t('common.close')} /><motion.aside initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} className="glass-card fixed inset-y-0 right-0 z-[81] w-[min(26rem,100vw)] overflow-y-auto border-l border-white/10 p-5 pt-[max(1.25rem,env(safe-area-inset-top))]"><div className="flex items-center justify-between"><div><p className="text-xs uppercase tracking-[0.18em] text-accent">ORA OS</p><h2 className="mt-1 text-xl font-semibold">{t('os.launcher.customize')}</h2></div><button type="button" onClick={() => setSettingsOpen(false)} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-foreground/10" aria-label={t('common.close')}><X size={20} /></button></div><p className="mt-6 text-xs font-semibold uppercase tracking-wider text-foreground/45">{t('os.launcher.choose')}</p><div className="mt-3 space-y-2">{([{ id: 'default', name: t('os.launcher.defaultName'), base: 'default' }, { id: 'deck', name: t('os.launcher.deckName'), base: 'deck' }, { id: 'canvas', name: t('os.launcher.canvasName'), base: 'canvas' }] as Array<{ id: string; name: string; base: BuiltInLauncher }>).concat(customLaunchers).map((item) => <button key={item.id} type="button" onClick={() => selectLauncher(item.id)} className={`flex min-h-14 w-full items-center gap-3 rounded-2xl border p-3 text-left ${launcherId === item.id ? 'border-accent/50 bg-accent/10' : 'border-foreground/10 bg-foreground/5'}`}><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-foreground/8">{item.base === 'default' ? <SquaresFour size={18} /> : item.base === 'deck' ? <ArrowRight size={18} /> : <House size={18} />}</span><span className="flex-1 text-sm font-semibold">{item.name}</span>{launcherId === item.id && <Check size={18} className="text-accent" />}</button>)}</div><input ref={fileInput} type="file" accept="application/json,.json" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void installLauncher(file) }} /><button type="button" onClick={() => fileInput.current?.click()} className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-foreground/20 text-sm text-foreground/65 hover:bg-foreground/5"><UploadSimple size={18} />{t('os.launcher.install')}</button><div className="mt-4 rounded-2xl bg-foreground/5 p-4 text-xs leading-relaxed text-foreground/45"><Plus size={17} className="mb-2 text-accent" />{t('os.launcher.installHint')}</div></motion.aside></>}</AnimatePresence>
    </section>
  )
}
