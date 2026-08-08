/**
 * Shared authentication helpers.
 */

import { getBackendUrl } from '@/lib/config'

const apiBase = () => getBackendUrl() || ''

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
  return readAuthCookie()
    ?? parseStoredToken(localStorage.getItem('ha-auth-token'))
    ?? parseStoredToken(sessionStorage.getItem('ha-auth-token'))
    ?? ''
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
  const response = await fetch(url, { ...init, headers })
  // A 401 with a token present means the session expired/invalidated. Notify
  // the AuthContext so it can log the user out cleanly instead of letting
  // every poller hammer the backend and flood the logs with rejections.
  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent('iora:auth-unauthorized', { detail: { url } }))
  }
  return response
}
