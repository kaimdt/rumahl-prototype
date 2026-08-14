import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, ReactNode } from 'react'
import { getBackendUrl } from '@/lib/config'
import { clearAuthSession, getAuthToken, persistAuthSession, refreshAccessToken } from '@/lib/authHelpers'
import { wsReauthenticate, wsReconnect } from '@/lib/wsConnection'

interface User {
  id: string
  username: string
  displayName?: string
  role: string
  isAdmin: boolean
  /** 'standard' | 'child' — family profile kind. */
  profileType?: string
  /** Per-user restrictions (allowed_app_ids whitelist etc.). */
  restrictions?: { allowed_app_ids?: string[] }
}

interface ApiUser {
  id: string
  username: string
  display_name?: string
  role?: string
  is_admin: boolean
  profile_type?: string
  restrictions?: { allowed_app_ids?: string[] }
}

interface AuthContextType {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (username: string, password: string, rememberMe?: boolean) => Promise<void>
  loginAsGuest: () => Promise<void>
  loginWithPin: (userId: string, pin: string) => Promise<void>
  register: (username: string, password: string, displayName?: string) => Promise<void>
  updateProfile: (payload: { username?: string; displayName?: string }) => Promise<void>
  logout: () => void
  token: string | null
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

function mapApiUser(user: ApiUser): User {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role || 'user',
    isAdmin: user.is_admin ?? false,
    profileType: user.profile_type || 'standard',
    restrictions: user.restrictions || undefined,
  }
}

// ── Cookie helpers ──────────────────────────────────────────────
function setCookie(name: string, value: string, days: number) {
  const d = new Date()
  d.setTime(d.getTime() + days * 86400000)
  document.cookie = `${name}=${encodeURIComponent(value)};expires=${d.toUTCString()};path=/;SameSite=Lax`
}
function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}
function deleteCookie(name: string) {
  document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`
}

function readPersistedToken(): string | null {
  return getAuthToken() || null
}

function writePersistedToken(token: string | null, refreshToken?: string) {
  if (!token) {
    deleteCookie('iora_token')
    clearAuthSession()
    return
  }
  if (refreshToken) persistAuthSession(token, refreshToken)
  // Keep the legacy cookie in sync for embedded clients.
  setCookie('iora_token', token, 30)
}

const apiBase = () => getBackendUrl() || ''

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(() => readPersistedToken())
  const [isLoading, setIsLoading] = useState(true)
  const sessionRestoreAttempted = useRef(false)

  // Verify token on mount
  useEffect(() => {
    const verifyToken = async () => {
      if (!token) {
        setIsLoading(false)
        return
      }

      try {
        // Refresh before the first protected request. This also restores a
        // session after iora-home restarts with a newly loaded JWT secret.
        const restoredToken = sessionRestoreAttempted.current ? null : await refreshAccessToken()
        sessionRestoreAttempted.current = true
        const activeToken = restoredToken || token
        if (restoredToken) setToken(restoredToken)

        let response = await fetch(`${apiBase()}/api/auth/verify`, {
          headers: {
            'Authorization': `Bearer ${activeToken}`,
          },
        })

        if (response.status === 401 && !restoredToken) {
          const freshToken = await refreshAccessToken()
          if (freshToken) {
            setToken(freshToken)
            response = await fetch(`${apiBase()}/api/auth/verify`, {
              headers: { 'Authorization': `Bearer ${freshToken}` },
            })
          }
        }

        if (response.ok) {
          const userData = await response.json() as ApiUser & { refreshed_token?: string }
          // If the backend issued a fresh token (e.g. admin status changed), update it
          if (userData.refreshed_token) {
            const fresh = userData.refreshed_token
            writePersistedToken(fresh)
            setToken(fresh)
          } else if (!localStorage.getItem('ha-auth-token')) {
            // Session came from the cookie only (e.g. after a cache clear) —
            // mirror it into localStorage so every request helper finds it.
            writePersistedToken(activeToken)
          }
          const mapped = mapApiUser(userData)
          setUser(mapped)
          localStorage.setItem('ha-username', mapped.username)
        } else {
          // Token invalid, clear it
          writePersistedToken(null)
          setToken(null)
          setUser(null)
        }
      } catch (error) {
        console.error('Token verification failed:', error)
        writePersistedToken(null)
        setToken(null)
        setUser(null)
      } finally {
        setIsLoading(false)
      }
    }

    verifyToken()
  }, [token])

  useEffect(() => {
    const onTokenRefreshed = (event: Event) => {
      const refreshed = (event as CustomEvent<{ token?: unknown }>).detail?.token
      if (typeof refreshed === 'string') setToken(refreshed)
    }
    window.addEventListener('iora:auth-token-refreshed', onTokenRefreshed)
    return () => window.removeEventListener('iora:auth-token-refreshed', onTokenRefreshed)
  }, [])

  // Keep the one-hour access JWT fresh while the dashboard stays open. The
  // refresh token is rotated atomically and remains valid across restarts.
  useEffect(() => {
    if (!token) return
    const interval = window.setInterval(() => { void refreshAccessToken() }, 50 * 60 * 1000)
    return () => window.clearInterval(interval)
  }, [token])

  // Whenever the token changes (login, refresh, restore-from-storage),
  // re-authenticate the already-open WebSocket so the backend trusts
  // CallService commands without waiting for a reconnect.
  useEffect(() => {
    if (token) {
      // Best-effort — wsReauthenticate handles "not open yet" gracefully.
      wsReauthenticate()
    }
  }, [token])

  const login = useCallback(async (username: string, password: string, rememberMe = true) => {
    const response = await fetch(`${apiBase()}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, password, remember_me: rememberMe }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Login failed')
    }

    const data = await response.json()
    writePersistedToken(data.token, data.refresh_token)
    setToken(data.token)
    const mapped = mapApiUser(data.user as ApiUser)
    setUser(mapped)
    localStorage.setItem('ha-username', mapped.username)
    localStorage.setItem('ha-auth-user', JSON.stringify(data.user))
  }, [])

  /** Start a guest session (temporary viewer user, no credentials). */
  const loginAsGuest = useCallback(async () => {
    const response = await fetch(`${apiBase()}/api/auth/guest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Guest login failed')
    }

    const data = await response.json()
    writePersistedToken(data.token, data.refresh_token)
    setToken(data.token)
    const mapped = mapApiUser(data.user as ApiUser)
    setUser(mapped)
    localStorage.setItem('ha-username', mapped.username)
    localStorage.setItem('ha-auth-user', JSON.stringify(data.user))
  }, [])

  const loginWithPin = useCallback(async (userId: string, pin: string) => {
    const response = await fetch(`${apiBase()}/api/auth/pin-login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ user_id: userId, pin }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'PIN login failed')
    }

    const data = await response.json()
    writePersistedToken(data.token, data.refresh_token)
    setToken(data.token)
    const mapped = mapApiUser(data.user as ApiUser)
    setUser(mapped)
    localStorage.setItem('ha-username', mapped.username)
    localStorage.setItem('ha-auth-user', JSON.stringify(data.user))
  }, [])

  const register = useCallback(async (username: string, password: string, displayName?: string) => {
    const response = await fetch(`${apiBase()}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, password, display_name: displayName }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Registration failed')
    }

    const data = await response.json()
    writePersistedToken(data.token, data.refresh_token)
    setToken(data.token)
    const mapped = mapApiUser(data.user as ApiUser)
    setUser(mapped)
    localStorage.setItem('ha-username', mapped.username)
  }, [])

  const updateProfile = useCallback(async ({ username, displayName }: { username?: string; displayName?: string }) => {
    if (!user || !token) {
      throw new Error('Nicht angemeldet')
    }

    const response = await fetch(`${apiBase()}/api/config/users/by-id/${user.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        username,
        display_name: displayName,
      }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Profil konnte nicht aktualisiert werden' }))
      throw new Error(error.error || 'Profil konnte nicht aktualisiert werden')
    }

    const data = await response.json() as ApiUser
    setUser(mapApiUser(data))
    localStorage.setItem('ha-username', data.username)
  }, [user, token])

  const logout = useCallback(() => {
    writePersistedToken(null)
    setToken(null)
    setUser(null)
    localStorage.removeItem('ha-username')
    // Reset the OS session lock so a fresh login never opens straight into
    // the lock screen (the lock must not survive a logout/login cycle).
    localStorage.removeItem('iora-os-session-locked')
    localStorage.removeItem('iora-os-last-activity')
    // Drop the authenticated WS session so the server clears identity
    wsReconnect()
  }, [])

  const isAuthenticated = !!user

  // Session-expiry handling: when any authenticated request returns 401 the
  // backend session is gone. Log out cleanly (instead of every poller hammering
  // the backend and flooding the logs with "not authenticated" warnings).
  useEffect(() => {
    const onUnauthorized = () => {
      if (user) {
        console.warn('[Auth] Session rejected by backend — logging out')
        logout()
      }
    }
    window.addEventListener('iora:auth-unauthorized', onUnauthorized)
    return () => window.removeEventListener('iora:auth-unauthorized', onUnauthorized)
  }, [user, logout])

  const contextValue = useMemo(() => ({
    user,
    isAuthenticated,
    isLoading,
    login,
    loginAsGuest,
    loginWithPin,
    register,
    updateProfile,
    logout,
    token,
  }), [user, isAuthenticated, isLoading, login, loginAsGuest, loginWithPin, register, updateProfile, logout, token])

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}
