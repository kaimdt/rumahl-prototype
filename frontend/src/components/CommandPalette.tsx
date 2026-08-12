import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowRight,
  MagnifyingGlass,
  Moon,
  Storefront,
  LockKey,
  Gear,
  House,
  FolderOpen,
  File,
  WifiHigh,
  WifiSlash,
  CircleNotch,
} from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { usePageNavigation, iconMap } from '@/contexts/PageNavigationContext'
import { useTheme } from '@/contexts/ThemeContext'
import { SYSTEM_OS_APPS, createPageApps } from '@/lib/osAppRegistry'
import { isAppAllowed } from '@/lib/userRestrictions'
import { useInstalledApps } from '@/hooks/useInstalledApps'
import { useAuth } from '@/contexts/AuthContext'
import { useOsPermissions } from '@/hooks/useOsPermissions'
import { authFetch } from '@/lib/authHelpers'

/**
 * CommandPalette – Spotlight-style ⌘K / Ctrl+Space launcher.
 * Search & jump to apps, files, devices, settings, the store and system
 * actions. Apps/actions are local; files/devices are debounced remote
 * sources gated by the user's OS permissions.
 */
export function CommandPalette() {
  const { t } = useTranslation()
  const { pages, setCurrentPageId, navigateToPage } = usePageNavigation()
  const { setSleepMode, sleepMode, setSelectedTheme } = useTheme()
  const { user } = useAuth()
  const { installedApps } = useInstalledApps()
  const { can } = useOsPermissions()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // ── Remote search state (files, devices) ────────────────────────────────
  const [remoteResults, setRemoteResults] = useState<{ files: Command[]; devices: Command[] }>({
    files: [],
    devices: [],
  })
  const [remoteLoading, setRemoteLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

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
    // Spotlight trigger from the OS shell shortcut registry (Mod+Space).
    const onSpotlight = () => {
      setOpen((value) => !value)
      setQuery('')
      setSelected(0)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('iora:spotlight-toggle', onSpotlight)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('iora:spotlight-toggle', onSpotlight)
    }
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

  type Command = { id: string; label: string; sublabel?: string; icon?: React.ReactNode; action: () => void; group: string }

  // ── Local commands: apps ────────────────────────────────────────────────
  const appCommands = useMemo<Command[]>(() => {
    const list: Command[] = []
    for (const app of [...SYSTEM_OS_APPS, ...pageApps]) {
      if (app.adminOnly && !user?.isAdmin) continue
      if (!isAppAllowed(user, app.id)) continue
      const Icon = app.icon
      list.push({
        id: `app-${app.id}`,
        label: app.nameKey ? t(app.nameKey, app.fallbackName) : app.fallbackName,
        icon: <Icon size={16} />,
        group: t('cmd.apps'),
        action: () => { setCurrentPageId(app.pageId); setOpen(false) },
      })
    }
    // Installed Docker apps (open embedded) — status shown as sublabel so
    // containers are searchable by runtime state too.
    for (const app of installedApps) {
      if (!isAppAllowed(user, app.pageId)) continue
      const Icon = app.icon
      const status = app.runtimeStatus
      list.push({
        id: `inst-${app.id}`,
        label: app.fallbackName,
        sublabel: status ? t(`os.apps.apps.lifecycle.${status}`, status) : undefined,
        icon: app.iconUrl
          ? <img src={app.iconUrl} alt="" className="h-4 w-4 rounded" />
          : <Icon size={16} />,
        group: t('cmd.apps'),
        action: () => { setCurrentPageId(app.pageId); setOpen(false) },
      })
    }
    return list
  }, [pageApps, installedApps, user?.isAdmin, t, setCurrentPageId])

  // ── Local commands: settings (deep links into Settings tabs) ───────────
  const settingsCommands = useMemo<Command[]>(() => {
    const tabs: Array<[string, string]> = [
      ['general', t('settings.general')],
      ['appearance', t('settings.appearance')],
      ['dashboard', t('settings.dashboard')],
      ['system', t('settings.system')],
      ['apps', t('settings.apps')],
    ]
    return tabs.map(([tab, label]) => ({
      id: `set-${tab}`,
      label,
      icon: <Gear size={16} />,
      group: t('cmd.settings'),
      action: () => { navigateToPage('settings', tab); setOpen(false) },
    }))
  }, [t, navigateToPage])

  // ── Local commands: actions ─────────────────────────────────────────────
  const actionCommands = useMemo<Command[]>(() => {
    const list: Command[] = []
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
  }, [t, sleepMode, setSleepMode, setCurrentPageId, setSelectedTheme])

  // ── Debounced remote search: files + devices ────────────────────────────
  useEffect(() => {
    const q = query.trim().toLowerCase()
    abortRef.current?.abort()
    if (q.length < 2) {
      setRemoteResults({ files: [], devices: [] })
      setRemoteLoading(false)
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    const timer = window.setTimeout(async () => {
      setRemoteLoading(true)
      try {
        const [filesOutcome, devicesOutcome] = await Promise.allSettled([
          can('os.files.read')
            ? authFetch('/api/files/?limit=500', { signal: controller.signal })
                .then((res) => (res.ok ? res.json() : null))
            : Promise.resolve(null),
          can('os.network.read')
            ? authFetch('/api/network/devices', { signal: controller.signal })
                .then((res) => (res.ok ? res.json() : null))
            : Promise.resolve(null),
        ])

        const filesData = filesOutcome.status === 'fulfilled' ? filesOutcome.value : null
        const devicesData = devicesOutcome.status === 'fulfilled' ? devicesOutcome.value : null

        const files: Command[] = (filesData?.files || [])
          .filter((f: FileEntry) => f.original_name.toLowerCase().includes(q))
          .slice(0, 8)
          .map((f: FileEntry) => ({
            id: `file-${f.id}`,
            label: f.original_name,
            sublabel: f.is_folder ? t('cmd.folder') : (f.mime_type || (f.size_bytes > 0 ? formatBytes(f.size_bytes) : undefined)),
            icon: f.is_folder ? <FolderOpen size={16} /> : <File size={16} />,
            group: t('cmd.files'),
            // Folders deep-link straight into the targeted folder (Feature 6b).
            action: () => {
              if (f.is_folder) navigateToPage('os-files', `folder/${f.id}`)
              else setCurrentPageId('os-files')
              setOpen(false)
            },
          }))

        const devices: Command[] = (Array.isArray(devicesData) ? devicesData : [])
          .filter((d: NetworkDevice) => (d.hostname || d.ip_address || d.vendor || '').toLowerCase().includes(q))
          .slice(0, 8)
          .map((d: NetworkDevice) => ({
            id: `dev-${d.id}`,
            label: d.hostname || d.ip_address,
            sublabel: `${d.ip_address} · ${d.is_active ? t('cmd.online') : t('cmd.offline')}`,
            icon: d.is_active ? <WifiHigh size={16} /> : <WifiSlash size={16} />,
            group: t('cmd.devices'),
            action: () => { setCurrentPageId('os-network'); setOpen(false) },
          }))

        if (!controller.signal.aborted) {
          setRemoteResults({ files, devices })
        }
      } catch {
        // backend unreachable or request aborted — keep results empty
        if (!controller.signal.aborted) {
          setRemoteResults({ files: [], devices: [] })
        }
      } finally {
        if (!controller.signal.aborted) setRemoteLoading(false)
      }
    }, 250)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [query, can, t, setCurrentPageId, navigateToPage])

  // ── Result assembly: apps → files → devices → settings → actions ───────
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matches = (label: string) => !q || label.toLowerCase().includes(q)
    return [
      ...appCommands.filter((c) => matches(c.label)),
      ...remoteResults.files,
      ...remoteResults.devices,
      ...settingsCommands.filter((c) => matches(c.label)),
      ...actionCommands.filter((c) => matches(c.label)),
    ]
  }, [query, appCommands, remoteResults, settingsCommands, actionCommands])

  useEffect(() => setSelected(0), [query, remoteResults])

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
              {remoteLoading && <CircleNotch size={14} className="shrink-0 animate-spin text-neutral-500" />}
              <kbd className="shrink-0 rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-neutral-500">ESC</kbd>
            </div>

            {/* Results */}
            <div className="max-h-[46vh] overflow-y-auto p-2">
              {filtered.length === 0 ? (
                <p className="px-3 py-8 text-center text-xs text-neutral-600">
                  {remoteLoading ? t('cmd.searching') : t('cmd.noResults')}
                </p>
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
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{command.label}</span>
                            {command.sublabel && (
                              <span className="block truncate text-[11px] text-neutral-500">{command.sublabel}</span>
                            )}
                          </span>
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

// ─── Remote result types ─────────────────────────────────────────────────────

interface FileEntry {
  id: string
  original_name: string
  size_bytes: number
  mime_type: string | null
  is_folder: boolean
  updated_at: string
  deleted_at?: string | null
}

interface NetworkDevice {
  id: string
  ip_address: string
  mac_address?: string | null
  hostname?: string | null
  vendor?: string | null
  device_type?: string | null
  first_seen: string
  last_seen: string
  is_active: boolean
}

function formatBytes(bytes: number): string {
  if (!bytes) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** index
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`
}
