/**
 * IORA Home version check and cache invalidation.
 *
 * The desktop client caches configuration and layout data from the IORA Home
 * server in localStorage. To detect when the server has been updated, the
 * client polls the /api/version endpoint (which is explicitly never cached).
 * When the reported version differs from the stored one every locally cached
 * IORA Home file is cleared so fresh data is fetched on the next page load.
 *
 * API requests (entity states, service calls, …) must never be cached –
 * call them with { cache: 'no-store' } and rely on this module only for
 * static/configuration data invalidation.
 */

import { getApiBase } from '@/lib/apiBase'

/** Default interval between version polls (5 minutes). */
export const VERSION_POLL_INTERVAL_MS = 5 * 60 * 1000

const STORED_VERSION_KEY = 'iora-home-server-version'

/** Cache keys that belong to IORA Home static/configuration data. */
const IORA_CACHE_PREFIXES = [
  'iora-pages',
  'iora-widgets',
  'iora-layout',
  'iora-theme',
  'iora-settings',
  'iora-config',
  'iora-background',
  'dashboard-',
  'page-config-',
  'widget-config-',
  'ha-dashboard-',
  'iora-accent',
  'iora-glass',
  'iora-night',
  'dynamic-overview',
]

/**
 * Fetch the current version from the iora-home backend.
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
 * Clear all localStorage keys that belong to cached IORA Home files.
 * API responses (entity states, etc.) are never cached, so only
 * static configuration data is purged here.
 */
function clearIoraCache(): void {
  const keys = Object.keys(localStorage)
  let cleared = 0
  for (const key of keys) {
    const isIoraCache = IORA_CACHE_PREFIXES.some(prefix => key.startsWith(prefix))
    if (isIoraCache) {
      localStorage.removeItem(key)
      cleared++
    }
  }
  if (cleared > 0) {
    console.info(`[versionCheck] Cache invalidated – cleared ${cleared} IORA Home cached entries`)
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
    clearIoraCache()
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
