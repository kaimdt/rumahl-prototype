import { useState, useEffect, useCallback, useRef, createContext, useContext, ReactNode } from 'react'
import { getBackendUrl, getAssistUrl, setBackendUrl, setAssistUrl } from '@/lib/config'
import { getAuthToken } from '@/lib/authHelpers'

// ── Types ──────────────────────────────────────────────────────────────

/** A single setting entry as returned by the backend settings API. */
export interface GlobalSetting {
  key: string
  value: unknown
  label: string
  description?: string
  category: string
  type: string
  required: boolean
  /** true when the value was auto-detected by the system, not manually set */
  auto_detected?: boolean
  /** true when this setting was set via .env migration on first boot */
  from_env_bootstrap?: boolean
  visibility?: string
  wizard?: boolean
  requires_restart?: string[]
  options?: string[]
  tags?: string[]
  is_set: boolean
}

interface GlobalConfigContextType {
  backend_url: string
  assist_url: string
  loaded: boolean
  allSettings: GlobalSetting[]
  refresh: () => Promise<void>
  getSetting: (key: string) => Promise<unknown>
  setSetting: (key: string, value: unknown) => Promise<void>
}

const BOOTSTRAP_BACKEND = getBackendUrl()
const BOOTSTRAP_ASSIST = getAssistUrl()

const GlobalConfigContext = createContext<GlobalConfigContextType>({
  backend_url: BOOTSTRAP_BACKEND,
  assist_url: BOOTSTRAP_ASSIST,
  loaded: false,
  allSettings: [],
  refresh: async () => {},
  getSetting: async () => null,
  setSetting: async () => {},
})

/**
 * GlobalConfigProvider
 *
 * Bootstraps on mount by fetching the complete settings registry from the
 * backend. The backend auto-detects its own URLs, database config, ports,
 * etc. and fills them into the settings table automatically — the user
 * never sees raw .env keys.
 *
 * After fetching, this provider synchronizes the `lib/config.ts` module
 * so that non-React code (wsConnection, authFetch, etc.) also uses the
 * correct URLs.
 */
export function GlobalConfigProvider({ children }: { children: ReactNode }) {
  const [backendUrlState, setBackendUrlState] = useState(BOOTSTRAP_BACKEND)
  const [assistUrlState, setAssistUrlState] = useState(BOOTSTRAP_ASSIST)
  const [allSettings, setAllSettings] = useState<GlobalSetting[]>([])
  const [loaded, setLoaded] = useState(false)

  // Read token at call time so that loadConfig works even when
  // the user authenticates after GlobalConfigProvider mounts.
  const loadConfigRef = useRef<(() => Promise<void>) | null>(null)

  const loadConfig = useCallback(async () => {
    const base = getBackendUrl() || ''
    const token = getAuthToken()
    try {
      const res = await fetch(`${base}/api/admin/settings`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (res.ok) {
        const items = (await res.json()) as GlobalSetting[]
        setAllSettings(Array.isArray(items) ? items : [])

        // Synchronise critical URLs into the shared config module
        for (const item of items) {
          if (item.key === 'backend.url' && typeof item.value === 'string' && item.value) {
            setBackendUrl(item.value)
            setBackendUrlState(item.value)
          }
          if (item.key === 'backend.assist_url' && typeof item.value === 'string' && item.value) {
            setAssistUrl(item.value)
            setAssistUrlState(item.value)
          }
        }
      }
    } catch {
      // Backend may not be running — use bootstrap defaults
    }
    setLoaded(true)
  }, [])

  loadConfigRef.current = loadConfig

  useEffect(() => {
    loadConfigRef.current?.()
  }, []) // run once on mount

  // Re-trigger loadConfig when the auth token appears in storage
  // (e.g. user logs in after GlobalConfigProvider already mounted).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'ha-auth-token' && e.newValue) {
        loadConfigRef.current?.()
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const getSetting = useCallback(async (key: string): Promise<unknown> => {
    try {
      const token = getAuthToken()
      const res = await fetch(`${backendUrlState}/api/admin/settings/${encodeURIComponent(key)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (res.ok) {
        const data = await res.json() as { value: unknown }
        return data.value
      }
    } catch { /* ignore */ }
    return null
  }, [backendUrlState])

  const setSetting = useCallback(async (key: string, value: unknown) => {
    try {
      const token = getAuthToken()
      await fetch(`${backendUrlState}/api/admin/settings/${encodeURIComponent(key)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ value }),
      })
    } catch { /* ignore */ }
  }, [backendUrlState])

  return (
    <GlobalConfigContext.Provider value={{
      backend_url: backendUrlState,
      assist_url: assistUrlState,
      loaded,
      allSettings,
      refresh: loadConfig,
      getSetting,
      setSetting,
    }}>
      {children}
    </GlobalConfigContext.Provider>
  )
}

export function useGlobalConfig() {
  return useContext(GlobalConfigContext)
}

/** React hook: live backend URL, updated after GlobalConfig loads. */
export function useBackendUrl(): string {
  const { backend_url } = useContext(GlobalConfigContext)
  return backend_url
}

/** React hook: live assist URL, updated after GlobalConfig loads. */
export function useAssistUrl(): string {
  const { assist_url } = useContext(GlobalConfigContext)
  return assist_url
}
