import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Globe } from '@phosphor-icons/react'
import { authFetch } from '@/lib/authHelpers'
import { getBackendUrl } from '@/lib/config'
import type { OsAppDefinition } from '@/lib/osAppRegistry'
import { STORE_CATALOG } from '@/lib/storeCatalog'

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
  // QEMU host forwards bind to 127.0.0.1 (IPv4) — "localhost" can resolve
  // to ::1 first and the iframe gets "connection refused".
  const host = '127.0.0.1'
  return `http://${host}:${port}`
}

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
        setApps(data.apps || [])
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
    return () => {
      mountedRef.current = false
      window.clearInterval(interval)
    }
  }, [refresh])

  // Running jobs (CasaOS-style progress tiles).
  const activeJobs = useMemo(
    () => jobs.filter((job) => job.status !== 'finished' && job.status !== 'failed'),
    [jobs],
  )

  // Installed = container actually running.
  const runningApps = useMemo(
    () => apps.filter((app) => app.status === 'running'),
    [apps],
  )

  const installedApps: InstalledOsApp[] = useMemo(() => {
    return runningApps.map((app, index) => {
      const url = appOpenUrl(app)
      if (url) appRuntimeUrls.set(app.id, url)
      return {
        id: `inst-${app.id}`,
        pageId: app.id,
        fallbackName: app.name,
        icon: Globe, // replaced by the remote iconUrl when available
        kind: 'installed',
        accent: appGradient(app.id),
        order: 200 + index,
        openUrl: url,
        iconUrl: app.icon,
        runtimeStatus: app.status,
        backendId: app.id,
      }
    })
  }, [runningApps])

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
