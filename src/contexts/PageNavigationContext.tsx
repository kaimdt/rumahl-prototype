import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useLocalStorage } from '@/lib/storage'
import type { DashboardPage, DashboardWidget } from '@/lib/types'
import { DEFAULT_HOME_WIDGETS } from '@/lib/layoutTemplates'
import { wsOnMessage } from '@/lib/wsConnection'
import { loadSettingsFromBackend, pushAllSettingsToBackend } from '@/lib/settingsSync'
import { loadLightEnhancementSettingsFromBackend } from '@/lib/lightEnhancements'
import {
  House,
  Lightbulb,
  Thermometer,
  PlugsConnected,
  Gauge,
  Gear,
  FloppyDisk,
  VideoCamera,
  SpeakerHigh,
  Lock,
  Garage,
  Fan,
  Bathtub,
  Bed,
  CookingPot,
  Couch,
  Desktop,
  Tree,
  Door,
  ShieldCheck,
  Drop,
  Lightning,
  WifiHigh,
  Broadcast,
  Baby,
  Dog,
  Car,
  Sun,
  Moon,
  FireSimple,
} from '@phosphor-icons/react'

interface PageNavigationContextType {
  currentPageId: string
  setCurrentPageId: (id: string) => void
  pages: DashboardPage[]
  setPages: (pages: DashboardPage[]) => void
  currentPage: DashboardPage | undefined
}

const PageNavigationContext = createContext<PageNavigationContextType | undefined>(undefined)

const defaultPages: DashboardPage[] = [
  {
    id: 'home',
    name: 'Übersicht',
    icon: 'House',
    widgets: [],
    showInNav: true,
    order: 0,
  },
  {
    id: 'settings',
    name: 'Einstellungen',
    icon: 'Gear',
    widgets: [],
    showInNav: true,
    order: 999,
  },
]

export const iconMap = {
  House,
  Lightbulb,
  Thermometer,
  PlugsConnected,
  Gauge,
  Gear,
  FloppyDisk,
  VideoCamera,
  SpeakerHigh,
  Lock,
  Garage,
  Fan,
  Bathtub,
  Bed,
  CookingPot,
  Couch,
  Desktop,
  Tree,
  Door,
  ShieldCheck,
  Drop,
  Lightning,
  WifiHigh,
  Broadcast,
  Baby,
  Dog,
  Car,
  Sun,
  Moon,
  FireSimple,
}

const builtInPages = ['lights', 'climate', 'switches', 'sensors', 'settings']

function pageIdToPath(id: string): string {
  if (id === 'home') return '/'
  if (builtInPages.includes(id)) return `/${id}`
  return `/page/${id}`
}

function pathToPageId(path: string): string {
  if (path === '/' || path === '') return 'home'
  if (path.startsWith('/page/')) return path.slice(6)
  return path.slice(1)
}

// ── Backend sync helpers ──────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_BACKEND_URL || ''

interface BackendPageWidget {
  id: string
  widget_type: string
  entity_id: string | null
  position_x: number
  position_y: number
  width: number
  height: number
  config: string | null
}

interface BackendPageWithWidgets {
  page: {
    page_id: string
    name: string
    icon: string
    position: number
  }
  widgets: BackendPageWidget[]
}

/** Map backend page format → frontend DashboardPage[] */
function backendToFrontend(backendPages: BackendPageWithWidgets[]): DashboardPage[] {
  return backendPages.map((p) => ({
    id: p.page.page_id,
    name: p.page.name,
    icon: p.page.icon,
    showInNav: true,
    order: p.page.position,
    widgets: p.widgets.map((w): DashboardWidget => ({
      id: w.id,
      type: w.widget_type as DashboardWidget['type'],
      entity_id: w.entity_id ?? undefined,
      position: { x: w.position_x, y: w.position_y },
      size: { w: w.width, h: w.height },
      config: w.config ? JSON.parse(w.config) : undefined,
    })),
  }))
}

/** Map frontend DashboardPage[] → backend save payload */
function frontendToBackend(pages: DashboardPage[]) {
  return pages.map((page, index) => ({
    page_id: page.id,
    name: page.name,
    icon: page.icon,
    position: page.order ?? index,
    widgets: page.widgets.map(widget => ({
      widget_type: widget.type,
      entity_id: widget.entity_id || null,
      position_x: widget.position?.x ?? 0,
      position_y: widget.position?.y ?? 0,
      width: widget.size?.w ?? 1,
      height: widget.size?.h ?? 1,
      config: widget.config ?? null,
    })),
  }))
}

function parseStoredToken(raw: string | null): string | null {
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

async function resolveUsername(): Promise<string> {
  const localUsername = localStorage.getItem('ha-username')
  if (localUsername && localUsername.trim()) return localUsername.trim()

  const token = parseStoredToken(localStorage.getItem('ha-auth-token'))
    ?? parseStoredToken(sessionStorage.getItem('ha-auth-token'))

  if (token) {
    try {
      const res = await fetch(`${API_BASE}/api/auth/verify`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const user = await res.json() as { username?: string }
        if (user.username && user.username.trim()) {
          const resolved = user.username.trim()
          localStorage.setItem('ha-username', resolved)
          return resolved
        }
      }
    } catch {
      // Fall back to default below.
    }
  }

  return 'default'
}

/** Ensure a backend user exists and return its id */
async function ensureUser(): Promise<string> {
  const username = await resolveUsername()
  let res = await fetch(`${API_BASE}/api/config/users/${username}`)
  if (res.ok) {
    const u = await res.json()
    return u.id
  }
  res = await fetch(`${API_BASE}/api/config/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, display_name: username }),
  })
  if (res.ok) {
    const u = await res.json()
    localStorage.setItem('ha-username', username)
    return u.id
  }
  throw new Error('Failed to ensure user')
}

/** Ensure a backend device exists and return its id */
async function ensureDevice(): Promise<string> {
  let deviceId = localStorage.getItem('ha-device-id')
  if (deviceId) {
    const res = await fetch(`${API_BASE}/api/config/devices/${deviceId}`)
    if (res.ok) return deviceId
  }
  const res = await fetch(`${API_BASE}/api/config/devices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      device_name: `Browser ${new Date().toISOString()}`,
      device_type: 'browser',
      user_agent: navigator.userAgent,
    }),
  })
  if (res.ok) {
    const d = await res.json()
    localStorage.setItem('ha-device-id', d.id)
    return d.id
  }
  throw new Error('Failed to ensure device')
}

/** Get or create a profile and return its id */
async function ensureProfile(userId: string): Promise<string> {
  const res = await fetch(`${API_BASE}/api/config/profiles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `User Profile`,
      profile_type: 'user',
      owner_id: userId,
    }),
  })
  if (res.ok) {
    const p = await res.json()
    return p.id
  }
  throw new Error('Failed to ensure profile')
}

/** Load pages from backend profile */
async function loadPagesFromBackend(profileId: string): Promise<DashboardPage[] | null> {
  const res = await fetch(`${API_BASE}/api/config/profiles/${profileId}`)
  if (!res.ok) return null
  const data = await res.json()
  if (!data.pages || data.pages.length === 0) return null
  return backendToFrontend(data.pages)
}

/** Save pages to backend profile (fire-and-forget) */
async function savePagesToBackend(profileId: string, pages: DashboardPage[]) {
  await fetch(`${API_BASE}/api/config/profiles/${profileId}/pages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(frontendToBackend(pages)),
  })
}

// ── Provider ──────────────────────────────────────────────────────────

export function PageNavigationProvider({ children }: { children: React.ReactNode }) {
  const [pages, setLocalPages] = useLocalStorage<DashboardPage[]>('ha-dashboard-pages', defaultPages)
  const [currentPageId, setCurrentPageIdState] = useState<string>(() =>
    pathToPageId(window.location.pathname)
  )

  // Backend profile id (set once on init)
  const profileIdRef = useRef<string | null>(null)
  const saveTimerRef = useRef<number | undefined>(undefined)
  // Skip saving to backend during initial load from backend
  const skipNextSaveRef = useRef(false)

  const setCurrentPageId = useCallback((id: string) => {
    setCurrentPageIdState(id)
    const path = pageIdToPath(id)
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path)
    }
  }, [])

  // Handle browser back/forward navigation
  useEffect(() => {
    const handlePopState = () => {
      setCurrentPageIdState(pathToPageId(window.location.pathname))
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  // ── Backend sync: init ────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false

    async function initSync() {
      try {
        const userId = await ensureUser()
        await ensureDevice()
        const profileId = await ensureProfile(userId)
        if (cancelled) return

        profileIdRef.current = profileId

        // Try loading pages from backend
        const backendPages = await loadPagesFromBackend(profileId)
        if (cancelled) return

        if (backendPages && backendPages.length > 0) {
          // Backend has pages → use them (overrides localStorage)
          // Migrate home page default widgets if needed
          const migrated = backendPages.map(p => {
            if (p.id === 'home' && p.widgets.length === 0) {
              return { ...p, widgets: DEFAULT_HOME_WIDGETS }
            }
            return p
          })
          skipNextSaveRef.current = true
          setLocalPages(migrated)
          console.log('[PageSync] Loaded', migrated.length, 'pages from backend')

          // Also load synced settings (theme, overview, etc.) from backend
          await loadSettingsFromBackend()
          await loadLightEnhancementSettingsFromBackend()
        } else {
          // Backend is empty → push current localStorage pages to backend
          console.log('[PageSync] Backend empty, pushing', pages.length, 'pages from localStorage')
          await savePagesToBackend(profileId, pages)

          // Also push current settings to backend for the first time
          await pushAllSettingsToBackend()
          await loadLightEnhancementSettingsFromBackend()
        }
      } catch (err) {
        console.warn('[PageSync] Backend sync init failed, using localStorage:', err)
      }
    }

    initSync()
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Migrate home page: populate with default widgets if empty ──────
  useEffect(() => {
    const homePage = pages.find(p => p.id === 'home')
    if (homePage && homePage.widgets.length === 0) {
      setLocalPages(pages.map(p => p.id === 'home' ? { ...p, widgets: DEFAULT_HOME_WIDGETS } : p))
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- run once on mount

  // ── Debounced save to backend on page changes ─────────────────────
  const setPages = useCallback((newPages: DashboardPage[]) => {
    setLocalPages(newPages)

    // Debounce backend save (don't flood on rapid edits)
    if (saveTimerRef.current !== undefined) {
      window.clearTimeout(saveTimerRef.current)
    }
    saveTimerRef.current = window.setTimeout(() => {
      if (skipNextSaveRef.current) {
        skipNextSaveRef.current = false
        return
      }
      const profileId = profileIdRef.current
      if (profileId) {
        savePagesToBackend(profileId, newPages).catch(err => {
          console.warn('[PageSync] Failed to save pages to backend:', err)
        })
      }
    }, 1000)
  }, [setLocalPages])

  // ── Listen for config_changed WebSocket events (cross-device sync) ─
  useEffect(() => {
    const unsub = wsOnMessage(async (data: unknown) => {
      const msg = data as { type?: string; changes?: Array<{ table_name?: string }> }
      if (msg.type !== 'config_changed') return

      const hasPageChange = msg.changes?.some(c => c.table_name === 'pages')
      if (!hasPageChange) return

      const profileId = profileIdRef.current
      if (!profileId) return

      console.log('[PageSync] Received config_changed, reloading pages from backend')
      try {
        const backendPages = await loadPagesFromBackend(profileId)
        if (backendPages && backendPages.length > 0) {
          skipNextSaveRef.current = true
          setLocalPages(backendPages)
        }
      } catch (err) {
        console.warn('[PageSync] Failed to reload pages after config_changed:', err)
      }
    })
    return unsub
  }, [setLocalPages])

  const currentPage = pages.find(p => p.id === currentPageId)

  const contextValue = useMemo(() => ({
    currentPageId,
    setCurrentPageId,
    pages,
    setPages,
    currentPage,
  }), [currentPageId, setCurrentPageId, pages, setPages, currentPage])

  return (
    <PageNavigationContext.Provider value={contextValue}>
      {children}
    </PageNavigationContext.Provider>
  )
}

export function usePageNavigation() {
  const context = useContext(PageNavigationContext)
  if (!context) throw new Error('usePageNavigation must be used within PageNavigationProvider')
  return context
}
