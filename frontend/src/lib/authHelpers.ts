/**
 * Shared authentication helpers.
 */

import { getBackendUrl } from '@/lib/config'

const apiBase = () => getBackendUrl() || ''
const AUTH_SESSION_STORAGE_KEY = 'iora-auth-session'

function readStoredSession(): { token: string; refreshToken: string } | null {
  // Prefer localStorage; fall back to sessionStorage (some browsers block
  // localStorage in privacy/partitioned contexts).
  for (const storage of [localStorage, sessionStorage]) {
    try {
      const raw = storage.getItem(AUTH_SESSION_STORAGE_KEY)
      if (!raw) continue
      const session = JSON.parse(raw) as { token?: unknown; refreshToken?: unknown }
      if (typeof session.token === 'string' && typeof session.refreshToken === 'string') {
        return { token: session.token, refreshToken: session.refreshToken }
      }
    } catch { /* try next storage */ }
  }
  return null
}

/** Persist an access/refresh token pair so a browser or service restart can restore the session. */
export function persistAuthSession(token: string, refreshToken: string): void {
  const payload = JSON.stringify({ token, refreshToken })
  // Write to both storages so a session survives even when one is blocked.
  try { localStorage.setItem(AUTH_SESSION_STORAGE_KEY, payload) } catch { /* ignore */ }
  try { sessionStorage.setItem(AUTH_SESSION_STORAGE_KEY, payload) } catch { /* ignore */ }
  try { localStorage.setItem('ha-auth-token', JSON.stringify(token)) } catch { /* ignore */ }
}

/** Clear every persisted credential used by the dashboard. */
export function clearAuthSession(): void {
  try { localStorage.removeItem(AUTH_SESSION_STORAGE_KEY) } catch { /* ignore */ }
  try { localStorage.removeItem('ha-auth-token') } catch { /* ignore */ }
  try { sessionStorage.removeItem(AUTH_SESSION_STORAGE_KEY) } catch { /* ignore */ }
  try { sessionStorage.removeItem('ha-auth-token') } catch { /* ignore */ }
}

/** Parse a stored token string (may be JSON-wrapped or plain) */
export function parseStoredToken(raw: string | null): string | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed === 'string') return parsed
    if (parsed && typeof parsed === 'object') {
      const token = (parsed as Record<string, unknown>).token
      const accessToken = (parsed as Record<string, unknown>).access_token
      if (typeof token === 'string') return token
      if (typeof accessToken === 'string') return accessToken
    }
  } catch {
    return raw
  }
  return null
}

/** Read the auth cookie (primary storage — survives cache clears). */
function readAuthCookie(): string | null {
  try {
    const match = document.cookie.match(/(?:^|;\s*)iora_token=([^;]+)/)
    return match ? decodeURIComponent(match[1]) : null
  } catch {
    return null
  }
}

/**
 * Get the current auth token.
 *
 * Order matches AuthContext.readPersistedToken(): cookie first (primary,
 * survives cache clears), then localStorage / sessionStorage. Without the
 * cookie fallback a user who is logged in via cookie but has an empty
 * localStorage would silently send ALL authenticated requests without a
 * token → backend 401 flood.
 */
export function getAuthToken(): string {
  return readStoredSession()?.token
    ?? readAuthCookie()
    ?? parseStoredToken(localStorage.getItem('ha-auth-token'))
    ?? parseStoredToken(sessionStorage.getItem('ha-auth-token'))
    ?? ''
}

/**
 * Build a direct Files download URL for media used by native browser elements
 * such as CSS backgrounds. The stored configuration keeps only the stable API
 * path; the current short-lived access token is appended at render time.
 */
export function getAuthenticatedFileUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const requestPath = normalizedPath.startsWith('/user/')
    ? `/api/files${normalizedPath}`
    : normalizedPath
  const token = getAuthToken()
  const separator = requestPath.includes('?') ? '&' : '?'
  return `${apiBase()}${requestPath}${token ? `${separator}token=${encodeURIComponent(token)}` : ''}`
}

/** Decode the current username from the access token (JWT claims). */
export function currentUsername(): string | null {
  const token = getAuthToken()
  if (!token) return null
  try {
    const payload = token.split('.')[1]
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((payload.length % 4) || 0)
    const claims = JSON.parse(atob(padded)) as { username?: string; preferred_username?: string }
    return claims.username || claims.preferred_username || null
  } catch {
    return null
  }
}

/**
 * Intelligent IORA path resolver: turns every IORA path form into a working
 * browser URL. The stored value stays untouched — only the render URL changes.
 *
 *  - `http(s)://`, `blob:`, `data:`  → returned unchanged
 *  - `/user/{owner}/{…path}`        → `/api/files/user/{owner}/{…path}` + token
 *  - `/api/files/…`                 → + token (query-token is accepted by the backend)
 *  - relative paths (`Photos/x.jpg` or `Dokumente/x.txt`) → resolved against the
 *    current user's root
 *  - everything else (`/icons/…`, `/assets/…`, `/api/…`) → unchanged
 */
export function resolveIoraUrl(input: string): string {
  const raw = String(input ?? '').trim()
  if (!raw) return raw
  if (/^(https?:|blob:|data:)/i.test(raw)) return raw
  if (raw.startsWith('/user/')) return getAuthenticatedFileUrl(raw)
  if (raw.startsWith('/api/files')) return getAuthenticatedFileUrl(raw)
  if (!raw.startsWith('/')) {
    const username = currentUsername()
    if (username) {
      const encoded = raw.split('/').map((part) => encodeURIComponent(part)).join('/')
      return getAuthenticatedFileUrl(`/user/${encodeURIComponent(username)}/${encoded}`)
    }
  }
  return raw
}

/**
 * Async version of `resolveIoraUrl` — for absolute paths the backend decides
 * whether the path is an IORA path (found in the user's file tree) or a web
 * path. This resolves ambiguities like a user-created root folder `/icons`
 * vs. the web namespace `/icons/`. Host filesystem paths (`/var/lib/iora/…`,
 * `/opt/iora/…`) are served through the guarded `system-path` endpoint.
 */
export async function resolveIoraUrlAsync(input: string): Promise<string> {
  const raw = String(input ?? '').trim()
  if (!raw) return raw
  if (/^(https?:|blob:|data:)/i.test(raw)) return raw
  if (raw.startsWith('/api/')) return raw
  if (raw.startsWith('/user/')) return getAuthenticatedFileUrl(raw)
  if (!raw.startsWith('/')) {
    const username = currentUsername()
    if (username) {
      const encoded = raw.split('/').map((part) => encodeURIComponent(part)).join('/')
      return getAuthenticatedFileUrl(`/user/${encodeURIComponent(username)}/${encoded}`)
    }
    return raw
  }
  try {
    const res = await authFetch(`/api/files/resolve-path?path=${encodeURIComponent(raw)}`)
    if (res.ok) {
      const data = await res.json() as { found?: boolean; file_id?: string; is_folder?: boolean }
      // Folders cannot be loaded as media — a path pointing at an IORA folder
      // falls through to the web-path handling so web resources keep working.
      if (data.found && data.file_id && !data.is_folder) return getAuthenticatedFileUrl(`/api/files/${data.file_id}/download`)
    }
  } catch { /* backend unreachable → treat as web path */ }
  if (/^\/(opt\/iora|var\/lib\/iora|home\/iora\/iora|tmp)(\/|$)/.test(raw)) {
    const token = getAuthToken()
    return `${apiBase()}/api/files/system-path?path=${encodeURIComponent(raw)}${token ? `&token=${encodeURIComponent(token)}` : ''}`
  }
  return raw
}

let refreshInFlight: Promise<string | null> | null = null

/**
 * Rotate the durable refresh token into a new access token. Concurrent callers
 * share one request so an expired access token cannot cause a refresh storm.
 */
export function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight

  const session = readStoredSession()
  if (!session) return Promise.resolve(null)

  refreshInFlight = fetch(`${apiBase()}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: session.refreshToken }),
  })
    .then(async (response) => {
      if (!response.ok) return null
      const data = await response.json() as { access_token?: unknown; refresh_token?: unknown }
      if (typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string') return null
      persistAuthSession(data.access_token, data.refresh_token)
      window.dispatchEvent(new CustomEvent('iora:auth-token-refreshed', { detail: { token: data.access_token } }))
      return data.access_token
    })
    .catch(() => null)
    .finally(() => {
      refreshInFlight = null
    })

  return refreshInFlight
}

/** Build headers with Authorization if a token is available */
export function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getAuthToken()
  const headers: Record<string, string> = { ...extra }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  return headers
}

/**
 * Authenticated fetch wrapper.
 * Automatically adds the Authorization header if a token exists.
 */
export async function authFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = path.startsWith('http') ? path : `${apiBase()}${path}`
  const token = getAuthToken()
  const headers = new Headers(init?.headers)
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  // Without a token the request would only produce a backend-side 401 flood
  // ("Authenticated access rejected" in the logs) on the login screen and
  // during boot — fail fast locally instead of hitting the network.
  if (!token) {
    return new Response(JSON.stringify({ error: 'not authenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  let response = await fetch(url, { ...init, headers })
  // A short-lived access JWT may have expired while the durable session is
  // still valid. Refresh once and replay the original request transparently.
  let refreshed = false
  if (response.status === 401) {
    const freshToken = await refreshAccessToken()
    if (freshToken) {
      refreshed = true
      headers.set('Authorization', `Bearer ${freshToken}`)
      response = await fetch(url, { ...init, headers })
    }
  }
  // Only when the refresh could NOT restore the session is the session
  // genuinely dead - notify the AuthContext to log out. A plain 401 (e.g.
  // permission-denied, missing feature, or an endpoint-specific rejection)
  // must never kill the session: previously ANY 401 fired this event, which
  // turned a single bad endpoint into a login loop.
  if (response.status === 401 && !refreshed) {
    window.dispatchEvent(new CustomEvent('iora:auth-unauthorized', { detail: { url } }))
  } else if (response.status === 401) {
    console.warn(`[authFetch] ${url} returned 401 even after a successful refresh (endpoint/permission issue - session kept)`)
  }
  return response
}
