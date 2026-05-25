import { useState, useEffect, useMemo, useRef, useCallback, Suspense, lazy } from 'react'
import '@/i18n'
import { useTranslation } from 'react-i18next'
import { getBackendUrl } from '@/lib/config'
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext'
import { ThemeIframeProvider } from '@/components/ThemeIframeProvider'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { PageNavigationProvider, usePageNavigation } from '@/contexts/PageNavigationContext'
import { ConnectionProvider, useConnection } from '@/contexts/ConnectionContext'
import { ConfigurationProvider } from '@/contexts/ConfigurationContext'
import { useConfiguration } from '@/contexts/ConfigurationContext'
import { EntityDiscoveryProvider, useEntityDiscovery } from '@/contexts/EntityDiscoveryContext'
import { DynamicOverviewProvider, useDynamicOverview, getVisibleWidgetTypes } from '@/contexts/DynamicOverviewContext'
import { useEntityStore } from '@/hooks/useEntityStore'
import { LightWidget } from '@/components/widgets/LightWidget'
import { ClimateWidget } from '@/components/widgets/ClimateWidget'
import { SwitchWidget } from '@/components/widgets/SwitchWidget'
import { SensorWidget } from '@/components/widgets/SensorWidget'
import { MediaPlayerWidget } from '@/components/widgets/MediaPlayerWidget'
import { NavigationMenu } from '@/components/NavigationMenu'
import { ThemeSplashScreen } from '@/components/ThemeSplashScreen'
import { LoginModal } from '@/components/LoginModal'
import { ConnectionStatus, BackendUnavailableOverlay } from '@/components/ConnectionStatus'
import { EntityDiscoveryNotification } from '@/components/EntityDiscoveryNotification'
// Heavy admin/editor routes: lazy-loaded to keep the initial bundle small.
// They are only rendered when the user navigates to the corresponding page.
const PageDesigner = lazy(() => import('@/components/PageDesigner').then(m => ({ default: m.PageDesigner })))
import { CustomPageRenderer } from '@/components/CustomPageRenderer'
import { SettingsPage } from '@/components/SettingsPage'
import { SimpleDashboard } from '@/components/SimpleDashboard'
// Share page for the Apps & Features app menu
const SharePage = lazy(() => import('./components/SharePage').then(m => ({ default: m.SharePage })))
import { DynamicBackground } from '@/components/DynamicBackground'
import { Screensaver, useScreensaverSettings } from '@/components/Screensaver'
const AdminPanel = lazy(() => import('@/components/AdminPanel').then(m => ({ default: m.AdminPanel })))
const AgentTab = lazy(() => import('@/components/AgentTab').then(m => ({ default: m.AgentTab })))
const DocsPage = lazy(() => import('@/components/DocsPageNew').then(m => ({ default: m.DocsPage })))
const StreamSender = lazy(() => import('@/components/StreamSender').then(m => ({ default: m.StreamSender })))
const AppSettingsPage = lazy(() => import('@/components/AppSettingsPage').then(m => ({ default: m.AppSettingsPage })))
import { GlobalConfigProvider } from '@/hooks/useGlobalConfig'
import { NotificationProvider } from '@/contexts/NotificationContext'
import { EmergencyNavbarBar, EmergencyOverlay, WarningBar, useWarningLevel } from '@/components/NotificationCenter'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PageTransitionWrapper } from '@/components/PageTransitionWrapper'
import { CurrentBackgroundProvider } from '@/contexts/CurrentBackgroundContext'
import { useAccentColor } from '@/hooks/useAccentColor'
import { useNightModeSettings } from '@/hooks/useNightModeSettings'
import { useGlassSettings } from '@/hooks/useGlassSettings'
import { useLocalStorage } from '@/lib/storage'
import type { WeatherEntity, LightEntity, ClimateEntity, SwitchEntity, SensorEntity, MediaPlayerEntity } from '@/lib/types'
import { Sparkle, ShieldCheck, Wrench } from '@phosphor-icons/react'
import { motion, AnimatePresence } from 'motion/react'
import { Toaster } from '@/components/ui/sonner'
import { DEFAULT_DASHBOARD_BACKGROUND_URL, getCardStyleClass } from '@/lib/defaults'
import { wsOnMessage } from '@/lib/wsConnection'
import { toast } from 'sonner'
import { ORAAssistant } from '@/components/ORAAssistant'
const CodingAgent = lazy(() => import('@/components/CodingAgent').then(m => ({ default: m.CodingAgent })))

// Isolated clock component – only re-renders per minute in the header
function HeaderClock() {
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | undefined
    // Sync to the next full minute, then tick every 60 s
    const msToNextMinute = (60 - new Date().getSeconds()) * 1000
    const boot = setTimeout(() => {
      setTime(new Date())
      intervalId = setInterval(() => setTime(new Date()), 60_000)
    }, msToNextMinute)
    // Also tick once per second for the first minute so we don't miss it
    const fastTick = setInterval(() => setTime(new Date()), 1000)
    return () => {
      clearTimeout(boot)
      clearInterval(fastTick)
      if (intervalId) clearInterval(intervalId)
    }
  }, [])
  return (
    <span className="text-sm font-medium tabular-nums tracking-wide">
      {time.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
    </span>
  )
}

// Premium loading skeletons for the dashboard
function DashboardSkeleton() {
  return (
    <div className="space-y-6 page-transition-enter">
      {/* Title skeleton */}
      <div className="skeleton-premium h-6 w-40 ml-1" />
      {/* Widget grid skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5 gap-3 sm:gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton-premium h-[76px] rounded-2xl" style={{ animationDelay: `${i * 0.08}s` }} />
        ))}
      </div>
    </div>
  )
}

async function hashPin(pin: string): Promise<string> {
  const encoded = new TextEncoder().encode(pin)
  const digest = await crypto.subtle.digest('SHA-256', encoded)
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

function DashboardContent() {
  const { t } = useTranslation()
  const { background, savePreference, getPreference } = useConfiguration()
  const { theme } = useTheme()
  const { user, isAuthenticated, isLoading: authLoading, logout, updateProfile, token } = useAuth()
  const { currentPageId, currentPage, modalPageId, closeModalPage, pages, setCurrentPageId } = usePageNavigation()
  const { checkForNewEntities } = useEntityDiscovery()
  const { evaluateTriggers, currentVariant } = useDynamicOverview()
  const screensaverSettings = useScreensaverSettings()
  const accentColorSettings = useAccentColor()
  const nightModeSettings = useNightModeSettings()
  const glassSettings = useGlassSettings()
  const [fontSize] = useLocalStorage<'small' | 'normal' | 'large'>('ha-font-size', 'normal')
  const [reducedAnimations] = useLocalStorage('ha-animations-reduced', false)
  const [compactWidgets] = useLocalStorage('ha-widget-compact', false)
  const [globalCardStyle] = useLocalStorage('ha-global-card-style', 'default')
  const { entities, loading, refresh } = useEntityStore()
  const warningLevel = useWarningLevel()
  const { homeAssistant: haConnectionStatus, lastHACheck } = useConnection()

  // Apply global card style class on <html> so it covers portals/modals/dialogs
  useEffect(() => {
    const root = document.documentElement
    // Remove any existing card-style-* classes
    root.classList.forEach(cls => {
      if (cls.startsWith('card-style-')) root.classList.remove(cls)
    })
    const styleClass = getCardStyleClass(globalCardStyle !== 'default' ? globalCardStyle : undefined)
    if (styleClass) root.classList.add(styleClass)
  }, [globalCardStyle])

  // Set data-page attribute for theme CSS targeting
  useEffect(() => {
    const pageType = (() => {
      if (['settings', 'admin', 'docs', 'share', 'streaming', 'ai-agent'].includes(currentPageId)) return currentPageId
      if (['home', 'lights', 'climate', 'switches', 'sensors', 'music'].includes(currentPageId)) return currentPageId
      if (currentPage?.pageSource?.kind === 'app') return 'app-page'
      return 'custom-page'
    })()
    document.documentElement.setAttribute('data-page', pageType)
    return () => {
      document.documentElement.removeAttribute('data-page')
    }
  }, [currentPageId, currentPage?.pageSource?.kind])
  const userName = useMemo(() => user?.displayName || user?.username || 'Benutzer', [user])

  // Skip splash screen when opening in a new tab or navigating directly to a page
  const [showSplash, setShowSplash] = useState(() => {
    // Check if opened in a new tab from IORA itself
    const isNewTab = typeof window !== 'undefined' && (
      window.opener !== null ||
      document.referrer.includes(window.location.hostname)
    )
    // Check if navigating directly to a specific page (not the dashboard home)
    const isDirectPage = typeof window !== 'undefined' && (
      window.location.pathname.startsWith('/app-settings/') ||
      window.location.pathname.startsWith('/streaming') ||
      window.location.pathname.startsWith('/docs')
    )
    return !isNewTab && !isDirectPage
  })
  const [showPageDesigner, setShowPageDesigner] = useState(false)
  const [maintenanceMode, setMaintenanceMode] = useState(false)
  const [maintenanceMessage, setMaintenanceMessage] = useState('')
  const [deviceLockMode, setDeviceLockMode] = useState(false)
  const [lockLoading, setLockLoading] = useState(false)
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [profileUsername, setProfileUsername] = useState('')
  const [profileDisplayName, setProfileDisplayName] = useState('')
  const [pinCode, setPinCode] = useState('')
  const [pinConfirm, setPinConfirm] = useState('')
  const [pinHash, setPinHash] = useState<string | null>(null)
  const [unlockPinInput, setUnlockPinInput] = useState('')
  const [showUnlockDialog, setShowUnlockDialog] = useState(false)
  const [aiEnabled, setAiEnabled] = useLocalStorage('ha-ai-enabled', true)
  const lastEvalRef = useRef(0)
  const hasActiveCustomBackground = Boolean(background?.is_active)

  // Whether IORA Home has Home Assistant configured and enabled.
  const [haConfigured, setHaConfigured] = useState<boolean | null>(null)
  const [haEnabled, setHaEnabled] = useState<boolean>(true)
  useEffect(() => {
    let cancelled = false
    const refreshHaStatus = () => {
      fetch(`${getBackendUrl()}/api/integration/ha/configured`)
        .then(r => (r.ok ? r.json() : null))
        .then((data: { configured?: boolean; enabled?: boolean } | null) => {
          if (cancelled || !data) return
          setHaConfigured(Boolean(data.configured))
          setHaEnabled(data.enabled !== false)
        })
        .catch(() => { if (!cancelled) setHaConfigured(false) })
    }
    refreshHaStatus()
    const onFocus = () => refreshHaStatus()
    window.addEventListener('focus', onFocus)
    return () => { cancelled = true; window.removeEventListener('focus', onFocus) }
  }, [])

  // Check if current user can bypass maintenance mode
  const canBypassMaintenance = user?.isAdmin || user?.role === 'maintenance' || user?.role === 'admin'

  // Fetch maintenance status on mount + listen for WebSocket events
  useEffect(() => {
    let mounted = true
    // Initial fetch
    fetch(`${getBackendUrl()}/api/maintenance/status`)
      .then(r => r.json())
      .then((data: { active: boolean; message: string }) => {
        if (!mounted) return
        setMaintenanceMode(data.active)
        setMaintenanceMessage(data.message || '')
      })
      .catch(() => {})
    // WebSocket listener
    const unsub = wsOnMessage((data: unknown) => {
      const msg = data as Record<string, unknown>
      if (msg.type === 'maintenance_mode') {
        setMaintenanceMode(msg.active as boolean)
        setMaintenanceMessage((msg.message as string) || '')
      }
    })
    return () => { mounted = false; unsub() }
  }, [])

  useEffect(() => {
    let mounted = true
    if (!user) return
    ;(async () => {
      try {
        const pref = await getPreference('device_lock_mode')
        if (mounted && typeof pref === 'boolean') {
          setDeviceLockMode(pref)
        }
      } catch {
        // ignore preference load errors
      }
    })()
    return () => {
      mounted = false
    }
  }, [user, getPreference])

  useEffect(() => {
    setProfileUsername(user?.username ?? '')
    setProfileDisplayName(user?.displayName ?? '')
  }, [user?.username, user?.displayName])

  useEffect(() => {
    let mounted = true
    if (!user) return
    ;(async () => {
      try {
        const pref = await getPreference('settings_pin_hash')
        if (mounted && typeof pref === 'string') {
          setPinHash(pref)
        }
      } catch {
        // ignore preference load errors
      }
    })()
    return () => {
      mounted = false
    }
  }, [user, getPreference])

  const updateDeviceLockMode = async (next: boolean) => {
    if (!next && deviceLockMode && pinHash) {
      setUnlockPinInput('')
      setShowUnlockDialog(true)
      return
    }

    setLockLoading(true)
    setDeviceLockMode(next)
    try {
      await savePreference('device_lock_mode', next)
    } catch {
      setDeviceLockMode(!next)
    } finally {
      setLockLoading(false)
    }
  }

  const saveUserProfile = async () => {
    const nextUsername = profileUsername.trim()
    if (!nextUsername) {
      toast.error('Benutzername darf nicht leer sein')
      return
    }

    setIsSavingProfile(true)
    try {
      await updateProfile({
        username: nextUsername,
        displayName: profileDisplayName.trim() || undefined,
      })
      toast.success('Benutzerprofil aktualisiert')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Profil konnte nicht gespeichert werden'
      toast.error(message)
    } finally {
      setIsSavingProfile(false)
    }
  }

  const savePin = async () => {
    if (!/^\d{4,8}$/.test(pinCode)) {
      toast.error('PIN muss 4 bis 8 Ziffern enthalten')
      return
    }
    if (pinCode !== pinConfirm) {
      toast.error('PIN und Bestaetigung stimmen nicht ueberein')
      return
    }

    try {
      const hashedPin = await hashPin(pinCode)
      await savePreference('settings_pin_hash', hashedPin)
      setPinHash(hashedPin)
      setPinCode('')
      setPinConfirm('')
      toast.success('PIN gespeichert')
    } catch {
      toast.error('PIN konnte nicht gespeichert werden')
    }
  }

  const verifyUnlockPin = async () => {
    if (!pinHash) {
      setShowUnlockDialog(false)
      return
    }

    const enteredHash = await hashPin(unlockPinInput)
    if (enteredHash !== pinHash) {
      toast.error('Falsche PIN')
      return
    }

    setLockLoading(true)
    try {
      setDeviceLockMode(false)
      await savePreference('device_lock_mode', false)
      setShowUnlockDialog(false)
      setUnlockPinInput('')
      toast.success('Einstellungen entsperrt')
    } catch {
      toast.error('Entsperren fehlgeschlagen')
    } finally {
      setLockLoading(false)
    }
  }

  // Run discovery checks and trigger evaluation when entities update (throttled to max once per 5s)
  useEffect(() => {
    if (entities.length > 0) {
      const now = Date.now()
      if (now - lastEvalRef.current > 5000) {
        lastEvalRef.current = now
        checkForNewEntities(entities)
        evaluateTriggers(entities)
      }
    }
  }, [entities])

  const weatherEntity = useMemo(() =>
    entities.find(e => e.entity_id.startsWith('weather.')) as WeatherEntity | undefined,
    [entities])
  const lightEntities = useMemo(() =>
    entities.filter(e => e.entity_id.startsWith('light.')) as LightEntity[],
    [entities])
  const climateEntities = useMemo(() =>
    entities.filter(e => e.entity_id.startsWith('climate.')) as ClimateEntity[],
    [entities])
  const switchEntities = useMemo(() =>
    entities.filter(e => e.entity_id.startsWith('switch.')) as SwitchEntity[],
    [entities])
  const sensorEntities = useMemo(() =>
    entities.filter(e => e.entity_id.startsWith('sensor.')) as SensorEntity[],
    [entities])
  const mediaPlayerEntities = useMemo(() =>
    entities.filter(e => e.entity_id.startsWith('media_player.')) as MediaPlayerEntity[],
    [entities])

  // Filter home page widgets based on DynamicOverview variant
  const homePage = currentPageId === 'home' ? currentPage : undefined
  const filteredHomePage = useMemo(() => {
    if (!homePage) return undefined
    const visibleTypes = getVisibleWidgetTypes(currentVariant.config)
    return {
      ...homePage,
      widgets: homePage.widgets.filter(w => visibleTypes.has(w.type)),
    }
  }, [homePage, currentVariant.config])

  if (showSplash) {
    return <ThemeSplashScreen onComplete={() => setShowSplash(false)} />
  }

  // Gate: show ONLY login screen when not authenticated
  if (!authLoading && !isAuthenticated) {
    return (
      <div className="min-h-screen relative overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{
            backgroundImage: `url('${DEFAULT_DASHBOARD_BACKGROUND_URL}')`,
            filter: 'brightness(0.2) saturate(0.8)',
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/30 to-black/70" />
        {/* Brand watermark */}
        <div className="absolute top-8 left-1/2 -translate-x-1/2 z-10 text-center">
          <p className="text-sm font-light tracking-[0.3em] uppercase text-white/30">IORA</p>
        </div>
        <LoginModal open onOpenChange={() => {}} />
      </div>
    )
  }

  // Still verifying token — show nothing
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'oklch(0.08 0.02 250)' }}>
        <div className="flex flex-col items-center gap-4">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
          >
            <Sparkle className="text-foreground/60" size={28} weight="fill" />
          </motion.div>
          <p className="text-xs text-foreground/40 tracking-wider font-light">{t('dashboard.authenticating')}</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <div
        className={`min-h-screen relative theme-transition overflow-x-hidden font-size-${fontSize}${reducedAnimations ? ' reduce-animations' : ''}${compactWidgets ? ' compact-widgets' : ''}`}
      >
        <Screensaver
          enabled={screensaverSettings.enabled}
          timeout={screensaverSettings.timeout}
        />
        <DynamicBackground />
        <BackendUnavailableOverlay />
        <ConnectionStatus />
        <EntityDiscoveryNotification />

        {/* Persistent warning bar for weather/safety warnings from HA entities */}
        <WarningBar />

        {/* Emergency alert bar at top */}
        <AnimatePresence>
          <EmergencyNavbarBar />
        </AnimatePresence>

        {/* Full-screen emergency overlay for extreme alerts */}
        <AnimatePresence>
          <EmergencyOverlay />
        </AnimatePresence>

        {/* Maintenance mode overlay – blocks non-admin/non-maintenance users */}
        <AnimatePresence>
          {maintenanceMode && !canBypassMaintenance && (
            <motion.div
              key="maintenance-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-xl"
            >
              <div className="text-center max-w-md px-6 space-y-6">
                <motion.div
                  animate={{ scale: [1, 1.1, 1] }}
                  transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                  className="mx-auto w-20 h-20 rounded-full bg-amber-500/15 flex items-center justify-center"
                >
                  <Wrench size={40} weight="duotone" className="text-amber-400" />
                </motion.div>
                <div className="space-y-2">
                  <h2 className="text-xl font-semibold text-white">{t('dashboard.maintenanceMode')}</h2>
                  <p className="text-sm text-white/60 leading-relaxed">
                    {maintenanceMessage || t('dashboard.maintenanceMessage')}
                  </p>
                </div>
                <p className="text-xs text-white/30">
                  {t('dashboard.maintenanceWait')}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {!hasActiveCustomBackground && (
          <div
            className="fixed inset-0 bg-cover bg-center bg-no-repeat theme-transition z-0 pointer-events-none"
            style={{
              backgroundImage: `url('${DEFAULT_DASHBOARD_BACKGROUND_URL}')`,
              backgroundAttachment: 'fixed',
              filter: theme === 'sleep'
                ? 'brightness(0.02) grayscale(1) saturate(0)'
                : theme === 'night' ? 'brightness(0.4)'
                : theme === 'evening' ? 'brightness(0.5)'
                : theme === 'light' ? 'brightness(1.15) saturate(0.9)'
                : theme === 'day' ? 'brightness(0.95) saturate(0.95)'
                : theme === 'day-classic' ? 'brightness(0.75)'
                : 'brightness(0.75)',
              opacity: theme === 'sleep' ? 0.15 : 1,
              transform: 'translateZ(0)',
              transition: 'filter var(--transition-duration) ease, opacity var(--transition-duration) ease',
            }}
          />
        )}

        <div
          className="fixed inset-0 z-10 pointer-events-none"
          style={{
            background: theme === 'sleep'
              ? 'black'
              : (theme === 'day' || theme === 'light')
              ? 'linear-gradient(to bottom, rgba(255,255,255,0.50), rgba(255,255,255,0.30), rgba(255,255,255,0.55))'
              : 'linear-gradient(to bottom, rgba(0,0,0,0.4), rgba(0,0,0,0.2), rgba(0,0,0,0.6))',
            opacity: theme === 'sleep' ? 0.92 : hasActiveCustomBackground ? 0.5 : 1,
            transition: 'opacity var(--transition-duration) ease, background var(--transition-duration) ease',
          }}
        />
        {nightModeSettings.isActive && (theme === 'night' || theme === 'sleep' || nightModeSettings.applyAlways) && (
          <div
            className="fixed inset-0 z-10 pointer-events-none"
            style={{
              background: theme === 'sleep'
                ? 'rgba(0, 0, 0, 1)'
                : 'var(--night-overlay-color, rgba(35, 22, 12, 1))',
              opacity: theme === 'sleep'
                ? 0.88 * (nightModeSettings.overlayStrength / 100)
                : (() => {
                    // Mirror the formula in useNightModeSettings.applyNightModeCss for SSR-safe value.
                    const tempBelow = Math.max(0, 6500 - nightModeSettings.colorTemperature)
                    const warmthFromTemp = Math.min(1, tempBelow / 5000)
                    const warmthFromBlue = nightModeSettings.blueLightReduction / 100
                    const warmth = Math.max(warmthFromTemp, warmthFromBlue * 0.8)
                    // Scale overlay opacity with overlay strength and warmth so a low temperature
                    // doesn't produce a strong tint when the user has overlay slider at 0.
                    return (nightModeSettings.overlayStrength / 100) * 0.55 * (0.4 + warmth * 0.6)
                  })(),
              transition: 'opacity var(--transition-duration) ease, background var(--transition-duration) ease',
            }}
          />
        )}

        <div
          className="relative z-20"
          style={{
            filter: theme === 'sleep' ? 'saturate(0.25) brightness(0.65)' : 'none',
            transition: 'filter var(--transition-duration) ease',
          }}
        >
          <header
            className="glass-header theme-transition"
            style={{
              ...(warningLevel === 'emergency' ? { background: 'linear-gradient(to right, rgba(127,29,29,0.95), rgba(153,27,27,0.95))', borderBottom: '1px solid rgba(248,113,113,0.4)' }
                : warningLevel === 'critical' ? { background: 'linear-gradient(to right, rgba(154,52,18,0.85), rgba(185,28,28,0.85))', borderBottom: '1px solid rgba(248,113,113,0.3)' }
                : warningLevel === 'warning' ? { background: 'linear-gradient(to right, rgba(180,83,9,0.75), rgba(194,65,12,0.75))', borderBottom: '1px solid rgba(251,191,36,0.3)' }
                : {}),
              transition: 'background 0.5s ease, border-bottom 0.5s ease',
            }}
          >
            <div className="max-w-[1500px] mx-auto px-3 sm:px-4 md:px-6 lg:px-8 py-3 sm:py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-accent" style={{ boxShadow: '0 0 8px oklch(from var(--accent) l c h / 0.5)' }} />
                <h1 className="text-sm font-medium tracking-[0.15em] uppercase">IORA</h1>
                <span className="text-[9px] font-medium tracking-[0.1em] uppercase text-foreground/25 hidden sm:block">
                  {currentPageId === 'settings' ? 'Home' : currentPageId === 'admin' ? 'Home' : currentPageId === 'docs' ? t('navigation.docs') : currentPageId === 'streaming' ? t('navigation.streaming') : 'Home'}
                </span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-[11px] text-foreground/40 font-light tracking-wider hidden sm:block">
                  {entities.length > 0 ? `${entities.length} ${t('dashboard.entities')}` : ''}
                </span>
                <HeaderClock />
              </div>
            </div>
          </header>

          <main className="max-w-[1500px] mx-auto px-3 sm:px-4 md:px-6 lg:px-8 pt-4 sm:pt-6 lg:pt-8 pb-28 sm:pb-32" style={{ paddingBottom: 'calc(7rem + env(safe-area-inset-bottom, 0px))' }}>
          <PageTransitionWrapper pageKey={currentPageId}>
          {(() => {
            // App Settings standalone page (opened in new tab from AppStoreTab)
            if (window.location.pathname.startsWith('/app-settings/')) {
              return <Suspense fallback={null}><AppSettingsPage /></Suspense>
            }

            const isHAOfflineForLong = haConnectionStatus === 'error' && lastHACheck && (new Date().getTime() - lastHACheck.getTime() > 10 * 60 * 1000)
            const systemPageIds = ['settings', 'admin', 'docs', 'share', 'streaming', 'ai-agent']

            const resolvePageType = (): 'dashboard' | 'app' | 'system' | 'custom' => {
              if (currentPage?.pageType) return currentPage.pageType
              if (currentPage?.pageSource?.kind === 'app') return 'app'
              if (currentPage?.pageSource?.kind === 'iora') return 'system'
              if (systemPageIds.includes(currentPageId)) return 'system'

              // Backward compatibility for already persisted app pages without metadata.
              const isLegacyAppPage = Boolean(
                currentPage?.widgets?.some((widget) => {
                  if (widget.type !== 'iframe') return false
                  const cfg = widget.config as Record<string, unknown> | undefined
                  return typeof cfg?.appId === 'string' && cfg.appId.length > 0
                })
              )
              if (isLegacyAppPage) return 'app'

              // Pages without any metadata are user/custom pages, NOT dashboard pages.
              return 'custom'
            }

            const currentPageType = resolvePageType()
            // Pages that NEVER depend on Home Assistant entities — render immediately
            const nonHAPages = ['settings', 'admin', 'docs', 'share', 'streaming', 'ai-agent']
            const isNonHAPage = nonHAPages.includes(currentPageId)

            // ── Non-HA pages: render immediately, never blocked by loading ──
            if (isNonHAPage) {
              return (
                <Suspense fallback={null}>
                  {currentPageId === 'settings' && (
                    <SettingsPage
                      user={user}
                      userName={userName}
                      logout={logout}
                      updateProfile={updateProfile}
                      deviceLockMode={deviceLockMode}
                      lockLoading={lockLoading}
                      updateDeviceLockMode={updateDeviceLockMode}
                      pinHash={pinHash}
                      savePin={savePin}
                      pinCode={pinCode}
                      setPinCode={setPinCode}
                      pinConfirm={pinConfirm}
                      setPinConfirm={setPinConfirm}
                      isSavingProfile={isSavingProfile}
                      profileUsername={profileUsername}
                      setProfileUsername={setProfileUsername}
                      profileDisplayName={profileDisplayName}
                      setProfileDisplayName={setProfileDisplayName}
                      saveUserProfile={saveUserProfile}
                      aiEnabled={aiEnabled}
                      setAiEnabled={setAiEnabled}
                      accentColorSettings={accentColorSettings}
                      glassSettings={glassSettings}
                      nightModeSettings={nightModeSettings}
                      screensaverSettings={screensaverSettings}
                      setShowPageDesigner={setShowPageDesigner}
                      entities={entities}
                      theme={theme}
                    />
                  )}
                  {currentPageId === 'admin' && user?.isAdmin && <AdminPanel />}
                  {currentPageId === 'docs' && <DocsPage />}
                  {currentPageId === 'share' && <SharePage />}
                  {currentPageId === 'streaming' && <StreamSender />}
                  {currentPageId === 'ai-agent' && (
                    <div className="pb-28">
                      <AgentTab token={token || ''} />
                    </div>
                  )}
                </Suspense>
              )
            }

            // ── 404 for pages that nobody owns ──────────────────────
            // Built-in HA entity pages always exist; everything else needs a page record.
            const builtinPageIds = ['home', 'lights', 'climate', 'switches', 'sensors', 'music']
            if (!currentPage && !builtinPageIds.includes(currentPageId)) {
              return (
                <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-foreground/60">
                  <span className="text-7xl font-bold text-foreground/10">404</span>
                  <p className="text-lg font-medium">{t('errors.notFound')}</p>
                  <p className="text-sm">
                    {t('dashboard.pageNotFoundDesc')}
                  </p>
                </div>
              )
            }

            // ── HA-dependent pages below ─────────────────────────
            const isDashboardPage = currentPageType === 'dashboard'
            const haNotAvailable = !haEnabled || haConfigured === false || (haConfigured === null && !loading) || isHAOfflineForLong
            const showSimpleDashboard = isDashboardPage && haNotAvailable

            if (loading && isDashboardPage && !showSimpleDashboard) {
              return <DashboardSkeleton />
            }

            return (
              <div className="space-y-6">
                {showSimpleDashboard && <SimpleDashboard />}

                {currentPageId === 'home' && !showSimpleDashboard && filteredHomePage && (
                  <CustomPageRenderer
                    page={filteredHomePage}
                    entities={entities}
                    onUpdate={refresh}
                    userName={userName}
                    weatherEntity={weatherEntity}
                    lightEntities={lightEntities}
                    hideTitle
                  />
                )}

              {currentPageId === 'lights' && !showSimpleDashboard && lightEntities.length > 0 && (
                <div className="space-y-3 page-transition-enter">
                  <h3 className="text-xl font-medium text-foreground px-1">{t('navigation.lights')}</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5 gap-3 sm:gap-4">
                    {lightEntities.map((light, i) => (
                      <div key={light.entity_id} className="widget-animate-in" style={{ animationDelay: `${Math.min(i * 0.03, 0.3)}s` }}>
                        <LightWidget
                          entity={light}
                          onUpdate={refresh}
                          allEntities={entities}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {currentPageId === 'climate' && !showSimpleDashboard && climateEntities.length > 0 && (
                <div className="space-y-3 page-transition-enter">
                  <h3 className="text-xl font-medium text-foreground px-1">{t('navigation.climate')}</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3 sm:gap-4">
                    {climateEntities.map((climate, i) => (
                      <div key={climate.entity_id} className="widget-animate-in" style={{ animationDelay: `${Math.min(i * 0.03, 0.3)}s` }}>
                        <ClimateWidget
                          entity={climate}
                          onUpdate={refresh}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {currentPageId === 'switches' && !showSimpleDashboard && switchEntities.length > 0 && (
                <div className="space-y-3 page-transition-enter">
                  <h3 className="text-xl font-medium text-foreground px-1">{t('navigation.switches')}</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5 gap-3 sm:gap-4">
                    {switchEntities.map((switchEntity, i) => (
                      <div key={switchEntity.entity_id} className="widget-animate-in" style={{ animationDelay: `${Math.min(i * 0.03, 0.3)}s` }}>
                        <SwitchWidget
                          entity={switchEntity}
                          onUpdate={refresh}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {currentPageId === 'sensors' && !showSimpleDashboard && sensorEntities.length > 0 && (
                <div className="space-y-3 page-transition-enter">
                  <h3 className="text-xl font-medium text-foreground px-1">{t('navigation.sensors')}</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5 gap-3 sm:gap-4">
                    {sensorEntities.map((sensor, i) => (
                      <div key={sensor.entity_id} className="widget-animate-in" style={{ animationDelay: `${Math.min(i * 0.03, 0.3)}s` }}>
                        <SensorWidget
                          entity={sensor}
                          onUpdate={refresh}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {currentPageId === 'music' && !showSimpleDashboard && (
                <div className="space-y-3 page-transition-enter">
                  <h3 className="text-xl font-medium text-foreground px-1">{t('navigation.music')}</h3>
                  {mediaPlayerEntities.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5 gap-3 sm:gap-4">
                      {mediaPlayerEntities.map((player, i) => (
                        <div key={player.entity_id} className="widget-animate-in" style={{ animationDelay: `${Math.min(i * 0.03, 0.3)}s` }}>
                          <MediaPlayerWidget
                            entity={player}
                            onUpdate={refresh}
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-4 sm:p-6 rounded-2xl glass-card text-center text-foreground/50 border border-foreground/10">
                      {t('dashboard.noMediaPlayers')}
                    </div>
                  )}
                </div>
              )}
              {/* Custom app pages — render even when HA is unavailable so app pages
                  (e.g. iframe-based apps, settings, streaming) work without HA. */}
              {!['home', 'lights', 'climate', 'switches', 'sensors', 'music', 'settings', 'admin', 'docs', 'streaming', 'share', 'ai-agent'].includes(currentPageId) && currentPage && (
                <CustomPageRenderer
                  page={currentPage}
                  entities={entities}
                  onUpdate={refresh}
                  userName={userName}
                  weatherEntity={weatherEntity}
                  lightEntities={lightEntities}
                />
              )}
              </div>
            )
          })()}
        </PageTransitionWrapper>
        </main>
        </div>
      </div>
      <Dialog open={showUnlockDialog} onOpenChange={setShowUnlockDialog}>
        <DialogContent className="sm:max-w-[420px] glass-card border-foreground/10 p-0 gap-0 bg-card/95 backdrop-blur-2xl">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-foreground/10">
            <DialogTitle className="flex items-center gap-2"><ShieldCheck size={18} /> Einstellungen entsperren</DialogTitle>
            <DialogDescription>
              Dieser Bereich ist PIN-geschuetzt. Bitte geben Sie Ihre PIN ein.
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 py-5 space-y-3">
            <label className="text-xs text-foreground/60 block">PIN</label>
            <input
              type="password"
              inputMode="numeric"
              value={unlockPinInput}
              onChange={(e) => setUnlockPinInput(e.target.value.replace(/\D/g, '').slice(0, 8))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  void verifyUnlockPin()
                }
              }}
              className="w-full px-3 py-2 rounded-lg bg-foreground/5 border border-foreground/10 text-sm text-foreground focus:outline-none focus:border-accent"
              placeholder="PIN eingeben"
            />
          </div>
          <div className="px-6 pb-6 flex gap-3">
            <button onClick={() => setShowUnlockDialog(false)} className="flex-1 px-4 py-2 rounded-xl bg-foreground/5 hover:bg-foreground/10 text-foreground transition-colors">
              Abbrechen
            </button>
            <button onClick={() => void verifyUnlockPin()} className="flex-1 px-4 py-2 rounded-xl bg-accent hover:bg-accent/90 text-accent-foreground transition-colors">
              Entsperren
            </button>
          </div>
        </DialogContent>
      </Dialog>
      {showPageDesigner && (
        <Suspense fallback={null}>
          <PageDesigner
            isOpen={showPageDesigner}
            onClose={() => setShowPageDesigner(false)}
            availableEntities={entities}
            userName={userName}
            weatherEntity={weatherEntity}
            lightEntities={lightEntities}
          />
        </Suspense>
      )}
      {/* Modal Page Overlay */}
      <AnimatePresence>
        {modalPageId && (() => {
          const modalPage = pages.find(p => p.id === modalPageId)
          if (!modalPage) return null
          const ms = modalPage.modalSettings || {}
          const size = ms.size || 'large'
          const backdropBlur = ms.backdropBlur !== false
          const closeOnClick = ms.closeOnBackdropClick !== false
          const showClose = ms.showCloseButton !== false
          const rounded = ms.rounded !== false

          const sizeClasses: Record<string, string> = {
            small: 'inset-[15%] sm:inset-[20%] lg:inset-[25%]',
            medium: 'inset-[8%] sm:inset-[12%] lg:inset-[16%]',
            large: 'inset-4 sm:inset-8 lg:inset-12',
            fullscreen: 'inset-0',
          }

          return (
            <>
              <motion.div
                key="modal-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                onClick={closeOnClick ? closeModalPage : undefined}
                className={`fixed inset-0 bg-black/60 z-[60] ${backdropBlur ? 'backdrop-blur-lg' : ''}`}
              />
              <motion.div
                key="modal-page"
                initial={{ opacity: 0, y: 40, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 24, scale: 0.98 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                className={`fixed ${sizeClasses[size]} z-[61] glass-card overflow-hidden flex flex-col ${rounded ? 'rounded-2xl' : ''}`}
                style={{ boxShadow: '0 25px 80px oklch(0 0 0 / 0.5)' }}
              >
                <div className="flex items-center justify-between px-5 py-4 border-b border-foreground/8">
                  <h2 className="text-lg font-semibold text-foreground">{modalPage.name}</h2>
                  {showClose && (
                    <button
                      onClick={closeModalPage}
                      className="w-8 h-8 rounded-full flex items-center justify-center text-foreground/50 hover:text-foreground hover:bg-foreground/10 transition-all"
                    >
                      ✕
                    </button>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto p-4 sm:p-6">
                  <CustomPageRenderer
                    page={modalPage}
                    entities={entities}
                    onUpdate={refresh}
                    userName={userName}
                    weatherEntity={weatherEntity}
                    lightEntities={lightEntities}
                  />
                </div>
              </motion.div>
            </>
          )
        })()}
      </AnimatePresence>
      <NavigationMenu hidden={showPageDesigner} />
      <ORAAssistant />
      {aiEnabled && <Suspense fallback={null}><CodingAgent /></Suspense>}
    </>
  )
}

/// ── Setup Wizard Overlay ────────────────────────────────────────────
/// Detects first-boot setup state and shows a dedicated screen with the
/// setup wizard URL. Automatically re-checks every 15 seconds and
/// hides once setup is complete.
function SetupWizardOverlay({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{
    checking: boolean
    setupComplete: boolean
    setupUrl: string | null
    setupReachable: boolean | null
  }>({ checking: true, setupComplete: true, setupUrl: null, setupReachable: null })
  const API_BASE = getBackendUrl()

  const checkSetup = useCallback(async () => {
    // Use the health endpoint to check setup status
    const healthUrl = API_BASE ? `${API_BASE}/health` : '/health'
    try {
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(5_000) })
      if (!res.ok) {
        // Backend/proxy not ready: don't block the app with the setup gate.
        setState(prev => ({ ...prev, checking: false, setupComplete: true }))
        return
      }
      const data = await res.json()
      if (data.setup_required === true) {
        setState({
          checking: false,
          setupComplete: false,
          setupUrl: data.setup_url || null,
          setupReachable: data.setup_reachable ?? false,
        })
      } else {
        setState({ checking: false, setupComplete: true, setupUrl: null, setupReachable: false })
      }
    } catch {
      // Fetch failed: let the normal backend-unavailable UI handle it.
      setState(prev => ({ ...prev, checking: false, setupComplete: true }))
    }
  }, [API_BASE])

  useEffect(() => {
    checkSetup()
    // Re-check every 15 seconds while setup is pending
    const interval = setInterval(checkSetup, 15_000)
    return () => clearInterval(interval)
  }, [checkSetup])

  // When setup is complete, render children normally
  if (!state.checking && state.setupComplete) {
    return <>{children}</>
  }

  // Show setup screen
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <div className="glass-card rounded-3xl p-8 border border-white/10">
          {/* Logo / Icon */}
          <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-accent/10 mx-auto mb-6">
            <Wrench size={32} className="text-accent" weight="fill" />
          </div>

          <h1 className="text-xl font-semibold text-center mb-2">IORA OS Ersteinrichtung</h1>
          <p className="text-sm text-foreground/60 text-center mb-6">
            Das System wurde gestartet, aber die Ersteinrichtung wurde noch nicht abgeschlossen.
            Bitte öffne den Setup-Assistenten, um die Konfiguration abzuschließen.
          </p>

          {state.checking ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <div className="animate-spin w-8 h-8 border-2 border-accent border-t-transparent rounded-full" />
              <p className="text-sm text-foreground/50">Prüfe Systemstatus…</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Setup URL (reachable) */}
              {state.setupReachable && state.setupUrl ? (
                <div className="p-4 rounded-xl bg-success/10 border border-success/20 text-center">
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
                    <span className="text-sm font-medium text-success">Setup-Assistent läuft</span>
                  </div>
                  <a
                    href={state.setupUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors"
                  >
                    <Sparkle size={16} weight="fill" />
                    Setup öffnen
                  </a>
                  <p className="text-[10px] text-foreground/40 mt-2">{state.setupUrl}</p>
                </div>
              ) : state.setupUrl ? (
                // Setup URL known but not reachable yet
                <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-2 h-2 rounded-full bg-amber-400" />
                    <span className="text-sm font-medium text-amber-400">Setup wird gestartet…</span>
                  </div>
                  <p className="text-xs text-foreground/50 mb-3">
                    Der Setup-Assistent sollte unter folgender Adresse erreichbar sein:
                  </p>
                  <code className="block text-sm text-center font-mono bg-foreground/5 rounded-lg p-2">{state.setupUrl}</code>
                  <p className="text-[10px] text-foreground/40 mt-2">
                    Automatische Prüfung alle 15 Sekunden
                  </p>
                </div>
              ) : (
                // No URL found at all
                <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-2 h-2 rounded-full bg-amber-400" />
                    <span className="text-sm font-medium text-amber-400">Warte auf Setup…</span>
                  </div>
                  <p className="text-xs text-foreground/50">
                    Der Setup-Assistent konnte noch nicht gefunden werden.
                    Bitte stelle sicher, dass das System vollständig hochgefahren ist.
                    Die Prüfung erfolgt automatisch.
                  </p>
                </div>
              )}

              <button
                onClick={checkSetup}
                className="w-full py-2 rounded-xl border border-foreground/10 text-xs text-foreground/50 hover:bg-foreground/5 transition-colors"
              >
                Jetzt prüfen
              </button>
            </div>
          )}

          <p className="text-[10px] text-foreground/30 text-center mt-6">
            IORA OS v{typeof APP_VERSION !== 'undefined' ? APP_VERSION : '?'}
          </p>
        </div>
      </div>
    </div>
  )
}

function App() {
  return (
    <GlobalConfigProvider>
    <ConnectionProvider>
      <AuthProvider>
        <ThemeProvider>
          <ThemeIframeProvider />
          <PageNavigationProvider>
            <ConfigurationProvider>
              <CurrentBackgroundProvider>
              <EntityDiscoveryProvider>
                <DynamicOverviewProvider>
                  <NotificationProvider>
                    <SetupWizardOverlay>
                      <DashboardContent />
                    </SetupWizardOverlay>
                  </NotificationProvider>
                  <Toaster />
                </DynamicOverviewProvider>
              </EntityDiscoveryProvider>
              </CurrentBackgroundProvider>
            </ConfigurationProvider>
          </PageNavigationProvider>
        </ThemeProvider>
      </AuthProvider>
    </ConnectionProvider>
    </GlobalConfigProvider>
  )
}

export default App
