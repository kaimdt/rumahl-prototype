/**
 * rumahl Home version check and cache invalidation.
 *
 * The desktop client caches configuration and layout data from the rumahl Home
 * server in localStorage. To detect when the server has been updated, the
 * client polls the /api/version endpoint (which is explicitly never cached).
 * When the reported version differs from the stored one every locally cached
 * rumahl Home file is cleared so fresh data is fetched on the next page load.
 *
 * API requests (entity states, service calls, …) must never be cached –
 * call them with { cache: 'no-store' } and rely on this module only for
 * static/configuration data invalidation.
 */

import { getApiBase } from '@/lib/apiBase'

/** Default interval between version polls (5 minutes). */
export const VERSION_POLL_INTERVAL_MS = 5 * 60 * 1000

const STORED_VERSION_KEY = 'rumahl-home-server-version'

/** Cache keys that belong to rumahl Home static/configuration data. */
const rumahl_CACHE_PREFIXES = [
  'rumahl-pages',
  'rumahl-widgets',
  'rumahl-layout',
  'rumahl-theme',
  'rumahl-settings',
  'rumahl-config',
  'rumahl-background',
  'dashboard-',
  'page-config-',
  'widget-config-',
  'ha-dashboard-',
  'rumahl-accent',
  'rumahl-glass',
  'rumahl-night',
  'dynamic-overview',
]

/**
 * Fetch the current version from the rumahl-home backend.
 * The response is explicitly never cached (Cache-Control: no-store is set
 * server-side, and we pass cache: 'no-store' client-side as well).
 */
async function fetchRemoteVersion(baseUrl: string): Promise<string | null> {
  try {
    const response = await fetch(`${baseUrl}/api/version`, {
      cache: 'no-store',
    })
    if (!response.ok) return null
    const data = await response.json()
    return typeof data.version === 'string' ? data.version : null
  } catch {
    return null
  }
}

/**
 * Clear all localStorage keys that belong to cached rumahl Home files.
 * API responses (entity states, etc.) are never cached, so only
 * static configuration data is purged here.
 */
function clearrumahlCache(): void {
  const keys = Object.keys(localStorage)
  let cleared = 0
  for (const key of keys) {
    const isrumahlCache = rumahl_CACHE_PREFIXES.some(prefix => key.startsWith(prefix))
    if (isrumahlCache) {
      localStorage.removeItem(key)
      cleared++
    }
  }
  if (cleared > 0) {
    console.info(`[versionCheck] Cache invalidated – cleared ${cleared} rumahl Home cached entries`)
  }
}

/**
 * Check the remote version and invalidate the local cache when it has changed.
 *
 * @returns The current remote version, or null when the server is unreachable.
 */
export async function checkAndInvalidateCache(): Promise<string | null> {
  const baseUrl = getApiBase()
  if (!baseUrl) return null

  const remoteVersion = await fetchRemoteVersion(baseUrl)
  if (!remoteVersion) return null

  const storedVersion = localStorage.getItem(STORED_VERSION_KEY)

  if (storedVersion !== remoteVersion) {
    console.info(
      `[versionCheck] Version changed: ${storedVersion ?? 'none'} → ${remoteVersion}. Clearing cache.`
    )
    clearrumahlCache()
    localStorage.setItem(STORED_VERSION_KEY, remoteVersion)
  }

  return remoteVersion
}

/**
 * Start a background poller that periodically checks for version changes.
 * When a new version is detected the cache is cleared automatically.
 *
 * @param intervalMs  Polling interval in milliseconds (default: 5 minutes).
 * @returns A cleanup function that stops the poller.
 */
export function startVersionPoller(intervalMs = 5 * 60 * 1000): () => void {
  const id = window.setInterval(() => {
    checkAndInvalidateCache().catch(() => {/* silently ignore network errors */})
  }, intervalMs)

  return () => window.clearInterval(id)
}
