import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
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

export interface StaticBackgroundConfig {
  type: 'static'
  url?: string
}

export interface SlideshowBackgroundConfig {
  type: 'slideshow'
  urls?: string[]
  interval?: number
}

export interface VideoBackgroundConfig {
  type: 'video'
  url?: string
  loop?: boolean
}

export interface GradientBackgroundConfig {
  type: 'gradient'
  colors?: string[]
  angle?: number
  animated?: boolean
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
  | StaticBackgroundConfig
  | SlideshowBackgroundConfig
  | VideoBackgroundConfig
  | GradientBackgroundConfig

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

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001'

export function ConfigurationProvider({ children }: { children: ReactNode }) {
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
        const response = await fetch(`${API_BASE_URL}/api/config/devices/${deviceId}`)
        if (response.ok) {
          storedDevice = await response.json()
          setDevice(storedDevice)
        }
      }

      // If no device found, register new one
      if (!storedDevice) {
        const response = await fetch(`${API_BASE_URL}/api/config/devices`, {
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
      let response = await fetch(`${API_BASE_URL}/api/config/users/${username}`)

      if (response.ok) {
        const existingUser = await response.json()
        setUser(existingUser)
        localStorage.setItem('ha-username', username)
      } else {
        // Create new user
        response = await fetch(`${API_BASE_URL}/api/config/users`, {
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
      const response = await fetch(`${API_BASE_URL}/api/config/profiles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      const response = await fetch(`${API_BASE_URL}/api/config/profiles/${profile.id}`)

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
            entityId: w.entity_id,
            x: w.position_x,
            y: w.position_y,
            width: w.width,
            height: w.height,
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
          entity_id: widget.entityId,
          position_x: widget.x || 0,
          position_y: widget.y || 0,
          width: widget.width || 1,
          height: widget.height || 1,
          config: widget.config,
        })),
      }))

      const response = await fetch(`${API_BASE_URL}/api/config/profiles/${profile.id}/pages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
  }, [profile])

  const saveTheme = useCallback(async (themeData: Partial<ThemeSettings>) => {
    if (!profile) return

    try {
      const response = await fetch(`${API_BASE_URL}/api/config/profiles/${profile.id}/theme`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
  }, [profile])

  const saveBackground = useCallback(async (
    backgroundData: Omit<BackgroundConfig, 'id' | 'profile_id' | 'is_active' | 'created_at' | 'updated_at'>
  ) => {
    if (!profile) return

    try {
      const response = await fetch(`${API_BASE_URL}/api/config/profiles/${profile.id}/background`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
  }, [profile])

  const savePreference = useCallback(async (key: string, value: any) => {
    if (!user) return

    try {
      const response = await fetch(`${API_BASE_URL}/api/config/preferences/${user.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
  }, [user])

  const getPreference = useCallback(async (key: string): Promise<any> => {
    if (!user) return null

    try {
      const response = await fetch(`${API_BASE_URL}/api/config/preferences/${user.id}`)

      if (response.ok) {
        const prefs = await response.json()
        const pref = prefs.find((p: UserPreference) => p.preference_key === key)
        return pref ? JSON.parse(pref.preference_value) : null
      }
    } catch (err) {
      console.error('Failed to get preference:', err)
      return null
    }
  }, [user])

  // Send heartbeat every 30 seconds
  useEffect(() => {
    if (!device) return

    const interval = setInterval(async () => {
      try {
        await fetch(`${API_BASE_URL}/api/config/devices/${device.id}/heartbeat`, {
          method: 'POST',
        })
      } catch (err) {
        console.error('Failed to send heartbeat:', err)
      }
    }, 30000)

    return () => clearInterval(interval)
  }, [device])

  return (
    <ConfigurationContext.Provider
      value={{
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
      }}
    >
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
