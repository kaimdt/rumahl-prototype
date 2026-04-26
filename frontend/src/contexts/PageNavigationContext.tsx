import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useLocalStorage } from '@/lib/storage'
import type { DashboardPage, DashboardWidget } from '@/lib/types'
import { DEFAULT_HOME_WIDGETS } from '@/lib/layoutTemplates'
import { wsOnMessage } from '@/lib/wsConnection'
import { loadSettingsFromBackend, pushAllSettingsToBackend } from '@/lib/settingsSync'
import { loadLightEnhancementSettingsFromBackend } from '@/lib/lightEnhancements'
import { parseStoredToken, authFetch } from '@/lib/authHelpers'
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
  Warehouse,
  Buildings,
  Armchair,
  Shower,
  Stairs,
  SwimmingPool,
  CloudSun,
  CloudRain,
  Snowflake,
  Wind,
  Umbrella,
  Rainbow,
  Television,
  Lamp,
  WashingMachine,
  Cat,
  Bird,
  Fish,
  PawPrint,
  Flower,
  Leaf,
  Plant,
  Bicycle,
  Airplane,
  Train,
  Bluetooth,
  Cpu,
  HardDrive,
  Robot,
  Heartbeat,
  FirstAid,
  Siren,
  Coffee,
  Wine,
  ForkKnife,
  Bell,
  Calendar,
  ChatCircle,
  Clock,
  MapPin,
  Star,
  Gift,
  Wrench,
  Eye,
  Phone,
  EnvelopeSimple,
  Alarm,
  Timer,
  Power,
  Plug,
  Toolbox,
  Palette,
  MusicNote,
  GameController,
  BookOpen,
  Heart,
  Trophy,
  Megaphone,
  ShareNetwork,
} from '@phosphor-icons/react'

export interface PageSettings {
  page_id: string
  card_style: string
  background_type: string | null
  background_config: any | null
  custom_css: string | null
  hide_header: boolean
  padding: number
}

interface PageNavigationContextType {
  currentPageId: string
  setCurrentPageId: (id: string) => void
  pages: DashboardPage[]
  setPages: (pages: DashboardPage[]) => void
  forceSavePages: (pages: DashboardPage[]) => void
  currentPage: DashboardPage | undefined
  modalPageId: string | null
  openModalPage: (id: string) => void
  closeModalPage: () => void
  getSubPages: (parentId: string) => DashboardPage[]
  profileId: string | null
  pageLayouts: Record<string, { cols: number; rows: number; gap: number }>
  savePageLayout: (pageId: string, layout: { cols: number; rows: number; gap: number }) => void
  pageSettings: Record<string, PageSettings>
  savePageSettings: (pageId: string, settings: Partial<Omit<PageSettings, 'page_id'>>) => void
  deletePageSettings: (pageId: string) => void
  globalCustomCss: string
  setGlobalCustomCss: (css: string) => void
  userCustomCss: string
  setUserCustomCss: (css: string) => void
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
  {
    id: 'docs',
    name: 'Dokumentation',
    icon: 'BookOpen',
    widgets: [],
    showInNav: true,
    order: 998,
  },
  {
    id: 'streaming',
    name: 'Streaming',
    icon: 'VideoCamera',
    widgets: [],
    showInNav: true,
    order: 997,
  },
  {
    id: 'share',
    name: 'Share',
    icon: 'ShareNetwork',
    widgets: [],
    showInNav: true,
    order: 996,
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
  Warehouse,
  Buildings,
  Armchair,
  Shower,
  Stairs,
  SwimmingPool,
  CloudSun,
  CloudRain,
  Snowflake,
  Wind,
  Umbrella,
  Rainbow,
  Television,
  Lamp,
  WashingMachine,
  Cat,
  Bird,
  Fish,
  PawPrint,
  Flower,
  Leaf,
  Plant,
  Bicycle,
  Airplane,
  Train,
  Bluetooth,
  Cpu,
  HardDrive,
  Robot,
  Heartbeat,
  FirstAid,
  Siren,
  Coffee,
  Wine,
  ForkKnife,
  Bell,
  Calendar,
  ChatCircle,
  Clock,
  MapPin,
  Star,
  Gift,
  Wrench,
  Eye,
  Phone,
  EnvelopeSimple,
  Alarm,
  Timer,
  Power,
  Plug,
  Toolbox,
  Palette,
  MusicNote,
  GameController,
  BookOpen,
  Heart,
  Trophy,
  Megaphone,
}

const builtInPages = ['lights', 'climate', 'switches', 'sensors', 'settings', 'docs', 'streaming']

function pageIdToPath(id: string, docPath?: string): string {
  if (id === 'home') return '/'
  if (id === 'admin') return '/admin'
  if (id === 'docs' && docPath) return `/docs/${docPath}`
  if (builtInPages.includes(id)) return `/${id}`
  return `/page/${id}`
}

function pathToPageId(path: string): string {
  if (path === '/' || path === '') return 'home'
  if (path.startsWith('/admin')) return 'admin'
  if (path.startsWith('/docs/') || path.startsWith('/docs')) return 'docs'
  if (path.startsWith('/page/')) return path.slice(6)
  return path.slice(1)
}

function extractDocPath(path: string): string | null {
  if (path.startsWith('/docs/')) {
    return path.slice(6) // Remove '/docs/' prefix
  }
  return null
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
    show_in_nav?: boolean | number
    display_mode?: string
    parent_page_id?: string | null
    modal_settings?: string | null
  }
  widgets: BackendPageWidget[]
}

/** Map backend page format → frontend DashboardPage[] */
function backendToFrontend(backendPages: BackendPageWithWidgets[]): DashboardPage[] {
  return backendPages.map((p) => ({
    id: p.page.page_id,
    name: p.page.name,
    icon: p.page.icon,
    showInNav: p.page.show_in_nav == null ? true : !!p.page.show_in_nav,
    order: p.page.position,
    displayMode: (p.page.display_mode as 'page' | 'modal') || 'page',
    parentPageId: p.page.parent_page_id || undefined,
    modalSettings: p.page.modal_settings ? JSON.parse(p.page.modal_settings) : undefined,
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
    show_in_nav: page.showInNav === false ? false : true,
    display_mode: page.displayMode || 'page',
    parent_page_id: page.parentPageId || null,
    modal_settings: page.modalSettings || null,
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

// parseStoredToken and authFetch imported from @/lib/authHelpers

async function resolveUsername(): Promise<string> {
  const localUsername = localStorage.getItem('ha-username')
  if (localUsername && localUsername.trim()) return localUsername.trim()

  const token = parseStoredToken(localStorage.getItem('ha-auth-token'))
    ?? parseStoredToken(sessionStorage.getItem('ha-auth-token'))

  if (token) {
    try {
      const res = await authFetch(`/api/auth/verify`)
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
  let res = await authFetch(`/api/config/users/${username}`)
  if (res.ok) {
    const u = await res.json()
    return u.id
  }
  res = await authFetch(`/api/config/users`, {
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
    const res = await authFetch(`/api/config/devices/${deviceId}`)
    if (res.ok) return deviceId
  }
  const res = await authFetch(`/api/config/devices`, {
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
  const res = await authFetch(`/api/config/profiles`, {
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
  const res = await authFetch(`/api/config/profiles/${profileId}`)
  if (!res.ok) return null
  const data = await res.json()
  if (!data.pages || data.pages.length === 0) return null
  return backendToFrontend(data.pages)
}

/** Save pages to backend profile (fire-and-forget) */
async function savePagesToBackend(profileId: string, pages: DashboardPage[]) {
  await authFetch(`/api/config/profiles/${profileId}/pages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(frontendToBackend(pages)),
  })
}

/** Ensure all default pages exist in the array (backend might not have them yet) */
function ensureDefaultPages(backendPages: DashboardPage[]): DashboardPage[] {
  const merged = [...backendPages]
  for (const dp of defaultPages) {
    if (!merged.find(p => p.id === dp.id)) {
      merged.push(dp)
    }
  }
  return merged
}

// ── Provider ──────────────────────────────────────────────────────────

export function PageNavigationProvider({ children }: { children: React.ReactNode }) {
  const [pages, setLocalPages] = useLocalStorage<DashboardPage[]>('ha-dashboard-pages', defaultPages)
  const [currentPageId, setCurrentPageIdState] = useState<string>(() =>
    pathToPageId(window.location.pathname)
  )
  const [modalPageId, setModalPageId] = useState<string | null>(null)
  const [pageLayouts, setPageLayoutsState] = useState<Record<string, { cols: number; rows: number; gap: number }>>({})
  const [pageSettingsState, setPageSettingsState] = useState<Record<string, PageSettings>>({})
  const [globalCustomCss, setGlobalCustomCssState] = useState<string>('')
  const [userCustomCss, setUserCustomCssState] = useState<string>('')

  // Backend profile id (set once on init)
  const profileIdRef = useRef<string | null>(null)
  const userIdRef = useRef<string | null>(null)
  const saveTimerRef = useRef<number | undefined>(undefined)
  // Skip saving to backend during initial load from backend
  const skipNextSaveRef = useRef(false)

  const setCurrentPageId = useCallback((id: string) => {
    // Check if the target page is a modal page
    const targetPage = pages.find(p => p.id === id)
    if (targetPage?.displayMode === 'modal') {
      setModalPageId(id)
      return
    }
    setModalPageId(null) // Close any open modal
    setCurrentPageIdState(id)
    const path = pageIdToPath(id)
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path)
    }
  }, [pages])

  const openModalPage = useCallback((id: string) => {
    setModalPageId(id)
  }, [])

  const closeModalPage = useCallback(() => {
    setModalPageId(null)
  }, [])

  const getSubPages = useCallback((parentId: string) => {
    return pages.filter(p => p.parentPageId === parentId)
  }, [pages])

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
        userIdRef.current = userId

        // Load page layouts from backend
        try {
          const layoutRes = await authFetch(`/api/config/profiles/${profileId}/layouts`)
          if (layoutRes.ok) {
            const layouts = await layoutRes.json() as Array<{ page_id: string; cols: number; rows: number; gap: number }>
            const layoutMap: Record<string, { cols: number; rows: number; gap: number }> = {}
            for (const l of layouts) {
              layoutMap[l.page_id] = { cols: l.cols, rows: l.rows, gap: l.gap }
            }
            if (!cancelled) setPageLayoutsState(layoutMap)
            // Also sync to localStorage for CustomPageRenderer fallback
            localStorage.setItem('ha-page-designer-layouts', JSON.stringify(layoutMap))
          }
        } catch {
          // Layout loading is non-critical
        }

        // Load page settings from backend
        try {
          const psRes = await authFetch(`/api/config/profiles/${profileId}/page-settings`)
          if (psRes.ok) {
            const psArr = await psRes.json() as Array<{ page_id: string; card_style: string; background_type: string | null; background_config: string | null; custom_css: string | null; hide_header: number; padding: number }>
            const psMap: Record<string, PageSettings> = {}
            for (const ps of psArr) {
              psMap[ps.page_id] = {
                page_id: ps.page_id,
                card_style: ps.card_style || 'default',
                background_type: ps.background_type || null,
                background_config: ps.background_config ? JSON.parse(ps.background_config) : null,
                custom_css: ps.custom_css || null,
                hide_header: !!ps.hide_header,
                padding: ps.padding ?? 16,
              }
            }
            if (!cancelled) setPageSettingsState(psMap)
          }
        } catch {
          // Page settings loading is non-critical
        }

        // Load global custom CSS from system preferences
        try {
          const cssRes = await authFetch(`/api/config/system/preferences`)
          if (cssRes.ok) {
            const prefs = await cssRes.json() as Array<{ preference_key: string; preference_value: string }>
            const cssPref = prefs.find(p => p.preference_key === 'global_custom_css')
            if (cssPref && !cancelled) setGlobalCustomCssState(cssPref.preference_value)
          }
        } catch {
          // Global CSS loading is non-critical
        }

        // Load per-user custom CSS from user preferences
        try {
          const userCssRes = await authFetch(`/api/config/preferences/${userId}`)
          if (userCssRes.ok) {
            const prefs = await userCssRes.json() as Array<{ preference_key: string; preference_value: string }>
            const cssPref = prefs.find(p => p.preference_key === 'user_custom_css')
            if (cssPref && !cancelled) setUserCustomCssState(cssPref.preference_value)
          }
        } catch {
          // User CSS loading is non-critical
        }

        // Try loading pages from backend
        const backendPages = await loadPagesFromBackend(profileId)
        if (cancelled) return

        if (backendPages && backendPages.length > 0) {
          // Backend has pages → use them, ensuring built-in pages exist
          const withDefaults = ensureDefaultPages(backendPages)
          // Migrate home page default widgets if needed
          const migrated = withDefaults.map(p => {
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

  // ── Immediate save (for page metadata changes like showInNav) ──────
  const forceSavePages = useCallback((newPages: DashboardPage[]) => {
    setLocalPages(newPages)
    // Clear any pending debounce
    if (saveTimerRef.current !== undefined) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = undefined
    }
    const profileId = profileIdRef.current
    if (profileId) {
      savePagesToBackend(profileId, newPages).catch(err => {
        console.warn('[PageSync] Failed to force-save pages to backend:', err)
      })
    }
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
          setLocalPages(ensureDefaultPages(backendPages))
        }
      } catch (err) {
        console.warn('[PageSync] Failed to reload pages after config_changed:', err)
      }
    })
    return unsub
  }, [setLocalPages])

  // ── Periodic sync: poll backend for changes every 30 seconds ──────
  useEffect(() => {
    const interval = setInterval(async () => {
      const profileId = profileIdRef.current
      if (!profileId) return

      try {
        const backendPages = await loadPagesFromBackend(profileId)
        if (backendPages && backendPages.length > 0) {
          const withDefaults = ensureDefaultPages(backendPages)
          // Only update if pages actually changed
          const currentJson = JSON.stringify(pages.map(p => ({ id: p.id, name: p.name, icon: p.icon, showInNav: p.showInNav, order: p.order })))
          const newJson = JSON.stringify(withDefaults.map(p => ({ id: p.id, name: p.name, icon: p.icon, showInNav: p.showInNav, order: p.order })))
          if (currentJson !== newJson) {
            console.log('[PageSync] Periodic sync detected changes, updating pages')
            skipNextSaveRef.current = true
            setLocalPages(withDefaults)
          }
        }
      } catch {
        // Periodic sync is non-critical
      }
    }, 30_000)
    return () => clearInterval(interval)
  }, [pages, setLocalPages])

  const currentPage = pages.find(p => p.id === currentPageId)

  const savePageLayout = useCallback((pageId: string, layout: { cols: number; rows: number; gap: number }) => {
    setPageLayoutsState(prev => {
      const updated = { ...prev, [pageId]: layout }
      // Sync to localStorage as fallback
      localStorage.setItem('ha-page-designer-layouts', JSON.stringify(updated))
      return updated
    })

    // Save to backend
    const profileId = profileIdRef.current
    if (profileId) {
      authFetch(`/api/config/profiles/${profileId}/layouts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page_id: pageId, cols: layout.cols, rows: layout.rows, gap: layout.gap }),
      }).catch(err => {
        console.warn('[PageSync] Failed to save page layout to backend:', err)
      })
    }
  }, [])

  const savePageSettings = useCallback((pageId: string, settings: Partial<Omit<PageSettings, 'page_id'>>) => {
    setPageSettingsState(prev => {
      const existing = prev[pageId] || { page_id: pageId, card_style: 'default', background_type: null, background_config: null, custom_css: null, hide_header: false, padding: 16 }
      return { ...prev, [pageId]: { ...existing, ...settings } }
    })

    const profileId = profileIdRef.current
    if (profileId) {
      authFetch(`/api/config/profiles/${profileId}/page-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page_id: pageId, ...settings }),
      }).catch(err => {
        console.warn('[PageSync] Failed to save page settings:', err)
      })
    }
  }, [])

  const deletePageSettings = useCallback((pageId: string) => {
    setPageSettingsState(prev => {
      const next = { ...prev }
      delete next[pageId]
      return next
    })

    const profileId = profileIdRef.current
    if (profileId) {
      authFetch(`/api/config/profiles/${profileId}/page-settings/${pageId}`, {
        method: 'DELETE',
      }).catch(err => {
        console.warn('[PageSync] Failed to delete page settings:', err)
      })
    }
  }, [])

  const setGlobalCustomCss = useCallback((css: string) => {
    setGlobalCustomCssState(css)
    // Save to system preferences
    authFetch(`/api/config/system/preferences`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preference_key: 'global_custom_css', preference_value: css }),
    }).catch(err => {
      console.warn('[PageSync] Failed to save global CSS:', err)
    })
  }, [])

  const setUserCustomCss = useCallback((css: string) => {
    setUserCustomCssState(css)
    const userId = userIdRef.current
    if (userId) {
      authFetch(`/api/config/preferences/${userId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preference_key: 'user_custom_css', preference_value: css }),
      }).catch(err => {
        console.warn('[PageSync] Failed to save user CSS:', err)
      })
    }
  }, [])

  const contextValue = useMemo(() => ({
    currentPageId,
    setCurrentPageId,
    pages,
    setPages,
    forceSavePages,
    currentPage,
    modalPageId,
    openModalPage,
    closeModalPage,
    getSubPages,
    profileId: profileIdRef.current,
    pageLayouts,
    savePageLayout,
    pageSettings: pageSettingsState,
    savePageSettings,
    deletePageSettings,
    globalCustomCss,
    setGlobalCustomCss,
    userCustomCss,
    setUserCustomCss,
  }), [currentPageId, setCurrentPageId, pages, setPages, forceSavePages, currentPage, modalPageId, openModalPage, closeModalPage, getSubPages, pageLayouts, savePageLayout, pageSettingsState, savePageSettings, deletePageSettings, globalCustomCss, setGlobalCustomCss, userCustomCss, setUserCustomCss])

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
