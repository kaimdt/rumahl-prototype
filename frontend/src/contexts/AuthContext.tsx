import { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react'
import { getBackendUrl } from '@/lib/config'

interface User {
  id: string
  username: string
  displayName?: string
  role: string
  isAdmin: boolean
}

interface ApiUser {
  id: string
  username: string
  display_name?: string
  role?: string
  is_admin: boolean
}

interface AuthContextType {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (username: string, password: string, rememberMe?: boolean) => Promise<void>
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
  }
}

function parseStoredToken(raw: string | null): string | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === 'string' ? parsed : null
  } catch {
    return raw
  }
}

function readPersistedToken(): string | null {
  return parseStoredToken(localStorage.getItem('ha-auth-token'))
    ?? parseStoredToken(sessionStorage.getItem('ha-auth-token'))
}

function writePersistedToken(token: string | null, rememberMe: boolean) {
  if (!token) {
    localStorage.removeItem('ha-auth-token')
    sessionStorage.removeItem('ha-auth-token')
    return
  }

  const serialized = JSON.stringify(token)
  if (rememberMe) {
    localStorage.setItem('ha-auth-token', serialized)
    sessionStorage.removeItem('ha-auth-token')
  } else {
    sessionStorage.setItem('ha-auth-token', serialized)
    localStorage.removeItem('ha-auth-token')
  }
}

const API_BASE = getBackendUrl()

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(() => readPersistedToken())
  const [isLoading, setIsLoading] = useState(true)

  // Verify token on mount
  useEffect(() => {
    const verifyToken = async () => {
      if (!token) {
        setIsLoading(false)
        return
      }

      try {
        const response = await fetch(`${API_BASE}/api/auth/verify`, {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        })

        if (response.ok) {
          const userData = await response.json() as ApiUser & { refreshed_token?: string }
          // If the backend issued a fresh token (e.g. admin status changed), update it
          if (userData.refreshed_token) {
            const fresh = userData.refreshed_token
            writePersistedToken(fresh, !!localStorage.getItem('ha-auth-token'))
            setToken(fresh)
          }
          const mapped = mapApiUser(userData)
          setUser(mapped)
          localStorage.setItem('ha-username', mapped.username)
        } else {
          // Token invalid, clear it
          writePersistedToken(null, false)
          setToken(null)
          setUser(null)
        }
      } catch (error) {
        console.error('Token verification failed:', error)
        writePersistedToken(null, false)
        setToken(null)
        setUser(null)
      } finally {
        setIsLoading(false)
      }
    }

    verifyToken()
  }, [token])

  const login = useCallback(async (username: string, password: string, rememberMe = false) => {
    setIsLoading(true)
    try {
      const response = await fetch(`${API_BASE}/api/auth/login`, {
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
      writePersistedToken(data.token, rememberMe)
      setToken(data.token)
      const mapped = mapApiUser(data.user as ApiUser)
      setUser(mapped)
      localStorage.setItem('ha-username', mapped.username)
      localStorage.setItem('ha-auth-user', JSON.stringify(data.user))
    } finally {
      setIsLoading(false)
    }
  }, [])

  const loginWithPin = useCallback(async (userId: string, pin: string) => {
    setIsLoading(true)
    try {
      const response = await fetch(`${API_BASE}/api/auth/pin-login`, {
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
      writePersistedToken(data.token, true)
      setToken(data.token)
      const mapped = mapApiUser(data.user as ApiUser)
      setUser(mapped)
      localStorage.setItem('ha-username', mapped.username)
      localStorage.setItem('ha-auth-user', JSON.stringify(data.user))
    } finally {
      setIsLoading(false)
    }
  }, [])

  const register = useCallback(async (username: string, password: string, displayName?: string) => {
    setIsLoading(true)
    try {
      const response = await fetch(`${API_BASE}/api/auth/register`, {
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
      writePersistedToken(data.token, true)
      setToken(data.token)
      const mapped = mapApiUser(data.user as ApiUser)
      setUser(mapped)
      localStorage.setItem('ha-username', mapped.username)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const updateProfile = useCallback(async ({ username, displayName }: { username?: string; displayName?: string }) => {
    if (!user || !token) {
      throw new Error('Nicht angemeldet')
    }

    const response = await fetch(`${API_BASE}/api/config/users/by-id/${user.id}`, {
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
    writePersistedToken(null, false)
    setToken(null)
    setUser(null)
    localStorage.removeItem('ha-username')
  }, [])

  const isAuthenticated = !!user

  const contextValue = useMemo(() => ({
    user,
    isAuthenticated,
    isLoading,
    login,
    loginWithPin,
    register,
    updateProfile,
    logout,
    token,
  }), [user, isAuthenticated, isLoading, login, loginWithPin, register, updateProfile, logout, token])

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
