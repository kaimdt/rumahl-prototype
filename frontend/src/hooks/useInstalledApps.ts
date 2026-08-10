import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Globe } from '@phosphor-icons/react'
import { authFetch } from '@/lib/authHelpers'
import { getBackendUrl } from '@/lib/config'
import type { OsAppDefinition } from '@/lib/osAppRegistry'
import { STORE_CATALOG } from '@/lib/storeCatalog'
import { appRuntimeUrl, type AppDisplayConfig } from '@/lib/appGateway'

/**
 * Installed Docker/user apps + in-flight install jobs for the launcher.
 *
 * Mirrors the CasaOS app lifecycle: an app only counts as "installed" once
 * its container is actually RUNNING. Installing apps (jobs in progress)
 * are exposed separately so the launcher can show a progress tile.
 */

export interface InstalledOsApp extends OsAppDefinition {
  /** Web UI URL opened on click (Docker apps). */
  openUrl?: string
  /** Remote icon URL from the app manifest (Docker apps). */
  iconUrl?: string
  /** Runtime status from the supervisor ("running" | "stopped" | …). */
  runtimeStatus?: string
  /** Whether the app backend entry exists (installed via store/zip). */
  backendId?: string
  /** Display / embedding metadata from the manifest (App Gateway). */
  display?: AppDisplayConfig | null
  /** Public runtime URL on the app subdomain (App Embedding Gateway).
   * Null on loopback hosts (dev) where the subdomain cannot resolve. */
  gatewayUrl?: string | null
}

export interface InstallJobInfo {
  id: string
  appId: string
  appName: string
  status: 'pending' | 'extracting' | 'validating' | 'installing' | 'finished' | 'failed' | string
  progress: number
  message?: string
  error?: string | null
}

interface SupervisorApp {
  id: string
  name: string
  version: string
  description?: string
  icon?: string
  status?: string
  enabled?: boolean
  /** Backend sends ports as "external:internal/protocol" strings. */
  ports?: Array<string | { external: number; internal: number; protocol: string }>
  open_url?: string | null
  developer?: string
  /** "app" / "plugin" / "system" — used by the UI to filter. */
  kind?: string
  /** App Embedding Gateway display metadata (manifest `display`). */
  display?: AppDisplayConfig | null
}

/** Parse the first external host port from either port shape. */
export function firstExternalPort(ports: SupervisorApp['ports']): number | undefined {
  const entry = ports?.[0]
  if (typeof entry === 'string') {
    const m = entry.match(/^(\d+):/)
    return m ? Number(m[1]) : undefined
  }
  if (entry && typeof entry === 'object' && 'external' in entry) {
    return Number(entry.external)
  }
  return undefined
}

/** Map backend icon *names* (e.g. "cloud") to inline SVG data URLs, so apps
 * without a real icon URL still get a proper icon instead of a broken <img>. */
const ICON_NAME_TO_DATA: Record<string, string> = {
  cloud: 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0082C9"/><path d="M46 40a8 8 0 0 0-1-15.9 12 12 0 0 0-22.9-2.6A9.5 9.5 0 0 0 20 40h22a6 6 0 0 0 4-1.5" fill="white"/></svg>'),
  browser: 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#FF7139"/><circle cx="32" cy="32" r="15" fill="none" stroke="white" stroke-width="5"/><ellipse cx="32" cy="32" rx="7" ry="15" fill="none" stroke="white" stroke-width="5"/><path d="M17 32h30" stroke="white" stroke-width="5"/></svg>'),
}

/** Resolve an icon to a usable URL: real URL, known icon name, or undefined. */
export function resolveAppIcon(icon?: string): string | undefined {
  if (!icon) return undefined
  if (/^(https?:|data:)/.test(icon)) return icon
  return ICON_NAME_TO_DATA[icon.toLowerCase()]
}

/** Deterministic gradient for apps without an icon URL. */
export function appGradient(id: string): string {
  let hash = 0
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) % 360
  const h1 = hash
  const h2 = (hash + 55) % 360
  return `linear-gradient(145deg, oklch(0.68 0.17 ${h1}), oklch(0.52 0.15 ${h2}))`
}

/** Build the web-UI URL for a Docker app (host port from the supervisor,
 * falling back to the store-catalog port hint). */
export function appOpenUrl(app: SupervisorApp): string | undefined {
  if (app.open_url) return app.open_url
  const catalogPort = STORE_CATALOG.find((def) => def.id === app.id)?.openPort
  const port = firstExternalPort(app.ports) ?? catalogPort
  if (!port) return undefined
  // Use the hostname that served the dashboard. A fixed loopback address only
  // works on the IORA host itself and makes Docker apps unreachable from every
  // phone, tablet, or remote browser.
  const configuredBase = getBackendUrl() || window.location.origin
  try {
    const base = new URL(configuredBase, window.location.origin)
    const protocol = base.protocol === 'https:' ? 'https:' : 'http:'
    return `${protocol}//${base.hostname}:${port}`
  } catch {
    return `http://${window.location.hostname}:${port}`
  }
}

/** IDs currently confirmed by the supervisor. Navigation uses this to emit
 * canonical `/app/<id>` URLs without treating ordinary dashboard pages as apps. */
export const installedAppIds = new Set<string>()

/**
 * Module-level mirror of the latest installed-app list. The window manager's
 * deep-link renderer (`/app/<id>` after a browser reload) reads this without
 * having a mounted launcher — the hook below fills it on every refresh.
 */
export const installedAppsCache: InstalledOsApp[] = []

export function useInstalledApps() {
  const [apps, setApps] = useState<SupervisorApp[]>([])
  const [jobs, setJobs] = useState<InstallJobInfo[]>([])
  const [loading, setLoading] = useState(true)
  const mountedRef = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const [appsRes, jobsRes] = await Promise.all([
        authFetch('/api/supervisor/apps'),
        authFetch('/api/appstore/jobs'),
      ])
      if (appsRes.ok) {
        const data = await appsRes.json() as { apps?: SupervisorApp[] }
        const nextApps = data.apps || []
        installedAppIds.clear()
        nextApps.forEach((app) => installedAppIds.add(app.id))
        setApps(nextApps)
        window.dispatchEvent(new Event('iora:installed-apps-updated'))
      }
      if (jobsRes.ok) {
        const data = await jobsRes.json() as { jobs?: InstallJobInfo[] }
        setJobs(data.jobs || [])
      }
    } catch {
      // backend unreachable — keep last state
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    void refresh()
    // Fast poll while installs are running, slow otherwise.
    const interval = window.setInterval(() => { void refresh() }, 5000)
    // Launcher context-menu actions (start/stop/restart/uninstall) request a
    // refresh so the grid reflects the new runtime state immediately.
    const onRefreshRequest = () => { void refresh() }
    window.addEventListener('iora:installed-apps-refresh', onRefreshRequest)
    return () => {
      mountedRef.current = false
      window.clearInterval(interval)
      window.removeEventListener('iora:installed-apps-refresh', onRefreshRequest)
    }
  }, [refresh])

  // Running jobs (CasaOS-style progress tiles). The backend reports finished
  // jobs as "succeeded" — treat every terminal state as inactive.
  const TERMINAL_JOB_STATUSES = new Set(['finished', 'succeeded', 'failed', 'cancelled'])
  const activeJobs = useMemo(
    () => jobs.filter((job) => !TERMINAL_JOB_STATUSES.has(job.status)),
    [jobs],
  )

  // Installed = any enabled app (launcher shows them all, with a status
  // indicator when not running).
  const installedApps: InstalledOsApp[] = useMemo(() => {
    const list = apps
      .filter((app) => app.enabled)
      .map((app, index) => {
        const url = appOpenUrl(app)
        if (url) appRuntimeUrls.set(app.id, url)
        return {
          id: `inst-${app.id}`,
          pageId: app.id,
          fallbackName: app.name,
          icon: Globe, // replaced by the remote iconUrl when available
          kind: 'installed' as OsAppDefinition['kind'],
          accent: appGradient(app.id),
          order: 200 + index,
          openUrl: url,
          iconUrl: resolveAppIcon(app.icon),
          runtimeStatus: app.status,
          backendId: app.id,
          display: app.display ?? null,
          gatewayUrl: appRuntimeUrl(app.id),
        }
      })
    installedAppsCache.length = 0
    installedAppsCache.push(...list)
    return list
  }, [apps])

  return {
    installedApps,
    activeJobs,
    allApps: apps,
    loading,
    refresh,
  }
}

/** Module-level registry: pageId → web UI URL for the embedded iframe runner. */
export const appRuntimeUrls = new Map<string, string>()

/** Open a Docker app's web UI. */
export function openInstalledApp(url: string | undefined) {
  if (!url) return
  window.open(url, '_blank')
}

/** Base URL helper for external links. */
export function appHost(): string {
  return getBackendUrl() || ''
}
