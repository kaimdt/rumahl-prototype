/**
 * Shared authentication helpers.
 * Single source of truth for reading the stored JWT token
 * and building Authorization headers for backend API calls.
 */

import { getApiBase } from '@/lib/apiBase'

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

/** Get the current auth token from localStorage or sessionStorage */
export function getAuthToken(): string {
  return parseStoredToken(localStorage.getItem('ha-auth-token'))
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
  const url = path.startsWith('http') ? path : `${getApiBase()}${path}`
  const token = getAuthToken()
  const headers = new Headers(init?.headers)
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  return fetch(url, { ...init, headers })
}
