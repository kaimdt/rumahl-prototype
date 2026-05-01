import { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { getBackendUrl } from '@/lib/config'
import type { DashboardPage } from '@/lib/types'

// Types
export interface User {
  id: string
  username: string
  display_name?: string
  created_at: string
  updated_at: string
}

export interface Device {
  id: string
  device_name: string
  device_type?: string
  user_agent?: string
  last_seen: string
  created_at: string
}

export interface ConfigurationProfile {
  id: string
  name: string
  profile_type: 'user' | 'device'
  owner_id: string
  is_default: boolean
  created_at: string
  updated_at: string
}

export interface ThemeSettings {
  id: string
  profile_id: string
  sleep_mode: boolean
  auto_theme: boolean
  selected_theme?: string
  created_at: string
  updated_at: string
}

export interface BackgroundConfig {
  id: string
  profile_id: string
  background_type: 'static' | 'slideshow' | 'video' | 'gradient'
  config: BackgroundConfigData
  is_active: boolean
  created_at: string
  updated_at: string
}

export type BackgroundConfigData =
  | {
      type: 'static'
      url: string
      position?: 'center' | 'top' | 'bottom' | 'left' | 'right'
      size?: 'cover' | 'contain' | 'auto'
      fixed?: boolean
      opacity?: number
      blur?: number
      brightness?: number
    }
  | {
      type: 'slideshow'
      urls: string[]
      interval: number
      position?: 'center' | 'top' | 'bottom' | 'left' | 'right'
      size?: 'cover' | 'contain' | 'auto'
      opacity?: number
      blur?: number
      brightness?: number
    }
  | {
      type: 'video'
      url: string
      loop: boolean
      opacity?: number
      blur?: number
      brightness?: number
    }
  | {
      type: 'gradient'
      colors: string[]
      angle: number
      opacity?: number
      blur?: number
      brightness?: number
    }

export interface UserPreference {
  id: string
  user_id: string
  device_id?: string
  preference_key: string
  preference_value: any
  created_at: string
  updated_at: string
}

interface ConfigurationContextType {
  // Current state
  user: User | null
  device: Device | null
  profile: ConfigurationProfile | null
  pages: DashboardPage[]
  theme: ThemeSettings | null
  background: BackgroundConfig | null
  designMode: 'user' | 'device'

  // Actions
  setUser: (user: User) => void
  setDevice: (device: Device) => void
  setDesignMode: (mode: 'user' | 'device') => void
  savePages: (pages: DashboardPage[]) => Promise<void>
  saveTheme: (theme: Partial<ThemeSettings>) => Promise<void>
  saveBackground: (background: Omit<BackgroundConfig, 'id' | 'profile_id' | 'is_active' | 'created_at' | 'updated_at'>) => Promise<void>
  savePreference: (key: string, value: any) => Promise<void>
  getPreference: (key: string) => Promise<any>

  // Loading state
  isLoading: boolean
  error: string | null
}

const ConfigurationContext = createContext<ConfigurationContextType | undefined>(undefined)

// Resolve the backend URL on every call, not once at module load. The
// GlobalConfigProvider patches the value asynchronously, and in the
// production IORA OS bundle the frontend is served from the same origin
// as the backend — so an empty string (= relative URL) is the correct
// default. NEVER fall back to `http://localhost:3001`: that file path
// is broken on every device the dashboard is opened from.
const apiBase = () => getBackendUrl() || ''

export function ConfigurationProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth()
  const [user, setUser] = useState<User | null>(null)
  const [device, setDevice] = useState<Device | null>(null)
  const [profile, setProfile] = useState<ConfigurationProfile | null>(null)
  const [pages, setPages] = useState<DashboardPage[]>([])
  const [theme, setTheme] = useState<ThemeSettings | null>(null)
  const [background, setBackground] = useState<BackgroundConfig | null>(null)
  const [designMode, setDesignMode] = useState<'user' | 'device'>('user')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Initialize device on mount
  useEffect(() => {
    initializeDevice()
  }, [])

  // Load profile when user/device or design mode changes
  useEffect(() => {
    if ((user || device) && profile) {
      loadProfileData()
    }
  }, [profile?.id])

  // Update profile when design mode changes
  useEffect(() => {
    if (user && device) {
      loadOrCreateProfile()
    }
  }, [user, device, designMode])

  const initializeDevice = async () => {
    try {
      // Get or create device ID from localStorage
      let deviceId = localStorage.getItem('ha-device-id')
      let storedDevice: Device | null = null

      if (deviceId) {
        // Try to get existing device
        const response = await fetch(`${apiBase()}/api/config/devices/${deviceId}`)
        if (response.ok) {
          storedDevice = await response.json()
          setDevice(storedDevice)
        }
      }

      // If no device found, register new one
      if (!storedDevice) {
        const response = await fetch(`${apiBase()}/api/config/devices`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            device_name: `Browser ${new Date().toISOString()}`,
            device_type: 'browser',
            user_agent: navigator.userAgent,
          }),
        })

        if (response.ok) {
          const newDevice = await response.json()
          localStorage.setItem('ha-device-id', newDevice.id)
          setDevice(newDevice)
        } else {
          throw new Error('Failed to register device')
        }
      }

      // Get or create default user
      const username = localStorage.getItem('ha-username') || 'default'
      await getOrCreateUser(username)
    } catch (err) {
      console.error('Failed to initialize device:', err)
      setError(err instanceof Error ? err.message : 'Failed to initialize device')
    } finally {
      setIsLoading(false)
    }
  }

  const getOrCreateUser = async (username: string) => {
    try {
      let response = await fetch(`${apiBase()}/api/config/users/${username}`)

      if (response.ok) {
        const existingUser = await response.json()
        setUser(existingUser)
        localStorage.setItem('ha-username', username)
      } else {
        // Create new user
        response = await fetch(`${apiBase()}/api/config/users`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username,
            display_name: username,
          }),
        })

        if (response.ok) {
          const newUser = await response.json()
          setUser(newUser)
          localStorage.setItem('ha-username', username)
        }
      }
    } catch (err) {
      console.error('Failed to get/create user:', err)
      throw err
    }
  }

  const loadOrCreateProfile = async () => {
    if (!user || !device) return

    try {
      setIsLoading(true)
      const ownerId = designMode === 'user' ? user.id : device.id

      // Try to get existing profile
      // This is a simplified approach - in production you'd have a specific endpoint
      const response = await fetch(`${apiBase()}/api/config/profiles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          name: designMode === 'user' ? `${user.username}'s Profile` : `${device.device_name} Profile`,
          profile_type: designMode,
          owner_id: ownerId,
        }),
      })

      if (response.ok) {
        const newProfile = await response.json()
        setProfile(newProfile)
      }
    } catch (err) {
      console.error('Failed to load/create profile:', err)
      setError(err instanceof Error ? err.message : 'Failed to load profile')
    } finally {
      setIsLoading(false)
    }
  }

  const loadProfileData = async () => {
    if (!profile) return

    try {
      setIsLoading(true)
      const response = await fetch(`${apiBase()}/api/config/profiles/${profile.id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })

      if (response.ok) {
        const data = await response.json()

        // Map backend page format to frontend format
        setPages(data.pages.map((p: any) => ({
          id: p.page.page_id,
          name: p.page.name,
          icon: p.page.icon,
          widgets: p.widgets.map((w: any) => ({
            id: w.id,
            type: w.widget_type,
            entity_id: w.entity_id ?? undefined,
            position: { x: w.position_x, y: w.position_y },
            size: { w: w.width, h: w.height },
            config: w.config ? JSON.parse(w.config) : undefined,
          })),
        })))

        setTheme(data.theme)
        setBackground(data.background)
      }
    } catch (err) {
      console.error('Failed to load profile data:', err)
      setError(err instanceof Error ? err.message : 'Failed to load profile data')
    } finally {
      setIsLoading(false)
    }
  }

  const savePages = useCallback(async (newPages: DashboardPage[]) => {
    if (!profile) return

    try {
      // Map frontend page format to backend format
      const pagesPayload = newPages.map((page, index) => ({
        page_id: page.id,
        name: page.name,
        icon: page.icon,
        position: index,
        widgets: page.widgets.map(widget => ({
          widget_type: widget.type,
          entity_id: widget.entity_id || null,
          position_x: widget.position?.x ?? 0,
          position_y: widget.position?.y ?? 0,
          width: widget.size?.w ?? 1,
          height: widget.size?.h ?? 1,
          config: widget.config,
        })),
      }))

      const response = await fetch(`${apiBase()}/api/config/profiles/${profile.id}/pages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(pagesPayload),
      })

      if (response.ok) {
        setPages(newPages)
      } else {
        throw new Error('Failed to save pages')
      }
    } catch (err) {
      console.error('Failed to save pages:', err)
      throw err
    }
  }, [profile, token])

  const saveTheme = useCallback(async (themeData: Partial<ThemeSettings>) => {
    if (!profile) return

    try {
      const response = await fetch(`${apiBase()}/api/config/profiles/${profile.id}/theme`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(themeData),
      })

      if (response.ok) {
        const updatedTheme = await response.json()
        setTheme(updatedTheme)
      } else {
        throw new Error('Failed to save theme')
      }
    } catch (err) {
      console.error('Failed to save theme:', err)
      throw err
    }
  }, [profile, token])

  const saveBackground = useCallback(async (
    backgroundData: Omit<BackgroundConfig, 'id' | 'profile_id' | 'is_active' | 'created_at' | 'updated_at'>
  ) => {
    if (!profile) return

    try {
      const response = await fetch(`${apiBase()}/api/config/profiles/${profile.id}/background`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(backgroundData),
      })

      if (response.ok) {
        const updatedBackground = await response.json()
        setBackground(updatedBackground)
      } else {
        throw new Error('Failed to save background')
      }
    } catch (err) {
      console.error('Failed to save background:', err)
      throw err
    }
  }, [profile, token])

  const savePreference = useCallback(async (key: string, value: any) => {
    if (!user) return

    try {
      const response = await fetch(`${apiBase()}/api/config/preferences/${user.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          preference_key: key,
          preference_value: value,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to save preference')
      }
    } catch (err) {
      console.error('Failed to save preference:', err)
      throw err
    }
  }, [user, token])

  const getPreference = useCallback(async (key: string): Promise<any> => {
    if (!user) return null

    try {
      const response = await fetch(`${apiBase()}/api/config/preferences/${user.id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })

      if (response.ok) {
        const prefs = await response.json()
        const pref = prefs.find((p: UserPreference) => p.preference_key === key)
        return pref ? JSON.parse(pref.preference_value) : null
      }
    } catch (err) {
      console.error('Failed to get preference:', err)
      return null
    }
  }, [user, token])

  // Send heartbeat every 30 seconds
  useEffect(() => {
    if (!device) return

    const interval = setInterval(async () => {
      try {
        await fetch(`${apiBase()}/api/config/devices/${device.id}/heartbeat`, {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
      } catch (err) {
        console.error('Failed to send heartbeat:', err)
      }
    }, 30000)

    return () => clearInterval(interval)
  }, [device, token])

  const contextValue = useMemo(() => ({
    user,
    device,
    profile,
    pages,
    theme,
    background,
    designMode,
    setUser,
    setDevice,
    setDesignMode,
    savePages,
    saveTheme,
    saveBackground,
    savePreference,
    getPreference,
    isLoading,
    error,
  }), [user, device, profile, pages, theme, background, designMode, savePages, saveTheme, saveBackground, savePreference, getPreference, isLoading, error])

  return (
    <ConfigurationContext.Provider value={contextValue}>
      {children}
    </ConfigurationContext.Provider>
  )
}

export function useConfiguration() {
  const context = useContext(ConfigurationContext)
  if (!context) {
    throw new Error('useConfiguration must be used within ConfigurationProvider')
  }
  return context
}
