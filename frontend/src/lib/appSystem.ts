/**
 * Canonical rumahl OS application model.
 *
 * Store, launcher, app management and the runtime runner consume these types
 * instead of maintaining their own interpretations of install/runtime state.
 */
export const APP_LIFECYCLE_STATES = [
  'available',
  'downloading',
  'installing',
  'installed',
  'starting',
  'running',
  'stopped',
  'updating',
  'uninstalling',
  'failed',
] as const

export type AppLifecycleState = (typeof APP_LIFECYCLE_STATES)[number]

export type AppRuntimeState = 'starting' | 'running' | 'stopped' | 'failed' | 'unhealthy' | 'not_found'
export type AppHealthState = 'unknown' | 'healthy' | 'degraded' | 'unhealthy' | 'unreachable'
export type AppRuntimeKind = 'native' | 'iframe' | 'external' | 'system' | 'service'
export type AppInstallSource = 'system' | 'store' | 'upload' | 'development' | 'unknown'

export interface AppPort {
  internal: number
  external: number
  protocol: string
}

export interface AppRegistryEntry {
  id: string
  name: string
  displayName: string
  description: string
  version: string
  icon?: string
  category?: string
  developer?: string
  permissions: string[]
  lifecycle: AppLifecycleState
  runtimeState: AppRuntimeState
  health: AppHealthState
  runtimeKind: AppRuntimeKind
  route: `/app/${string}`
  runtimeUrl?: string
  installSource: AppInstallSource
  dependencies: string[]
  requiredServices: string[]
  configurable: boolean
  updateAvailable: boolean
  ports: AppPort[]
}

export interface AppRuntimeTarget {
  kind: AppRuntimeKind
  url?: string
  route: `/app/${string}`
  embedded: boolean
}

const RUNNING_STATES = new Set(['running', 'healthy', 'up'])
const STARTING_STATES = new Set(['starting', 'restarting', 'created', 'installing'])
const FAILED_STATES = new Set(['failed', 'error', 'dead', 'crashed', 'unhealthy'])

export function normalizeRuntimeState(status?: string | null): AppRuntimeState {
  const normalized = status?.trim().toLowerCase()
  if (!normalized) return 'stopped'
  if (RUNNING_STATES.has(normalized)) return 'running'
  if (STARTING_STATES.has(normalized)) return 'starting'
  if (normalized === 'unhealthy') return 'unhealthy'
  if (normalized === 'not_found' || normalized === 'not-found') return 'not_found'
  if (FAILED_STATES.has(normalized)) return 'failed'
  return 'stopped'
}

export function lifecycleFromRuntime(status?: string | null): AppLifecycleState {
  const runtime = normalizeRuntimeState(status)
  if (runtime === 'running') return 'running'
  if (runtime === 'starting') return 'starting'
  if (runtime === 'failed' || runtime === 'unhealthy' || runtime === 'not_found') return 'failed'
  return 'stopped'
}

export function healthFromRuntime(status?: string | null): AppHealthState {
  const runtime = normalizeRuntimeState(status)
  if (runtime === 'running') return 'healthy'
  if (runtime === 'unhealthy') return 'unhealthy'
  if (runtime === 'failed' || runtime === 'not_found') return 'unreachable'
  return 'unknown'
}

export function appRoute(appId: string): `/app/${string}` {
  return `/app/${encodeURIComponent(appId)}`
}

/** The only place UI code decides how an app should be opened. */
export function resolveAppRuntime(entry: Pick<AppRegistryEntry, 'id' | 'route' | 'runtimeKind' | 'runtimeUrl'>): AppRuntimeTarget {
  return {
    kind: entry.runtimeKind,
    url: entry.runtimeUrl,
    route: entry.route,
    embedded: entry.runtimeKind === 'iframe' || entry.runtimeKind === 'native' || entry.runtimeKind === 'system',
  }
}
