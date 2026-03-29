import { useState, useEffect, useMemo, useRef } from 'react'
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { PageNavigationProvider, usePageNavigation } from '@/contexts/PageNavigationContext'
import { ConnectionProvider } from '@/contexts/ConnectionContext'
import { ConfigurationProvider } from '@/contexts/ConfigurationContext'
import { useConfiguration } from '@/contexts/ConfigurationContext'
import { EntityDiscoveryProvider, useEntityDiscovery } from '@/contexts/EntityDiscoveryContext'
import { DynamicOverviewProvider, useDynamicOverview, getVisibleWidgetTypes } from '@/contexts/DynamicOverviewContext'
import { useEntityStore } from '@/hooks/useEntityStore'
import { LightWidget } from '@/components/widgets/LightWidget'
import { ClimateWidget } from '@/components/widgets/ClimateWidget'
import { SwitchWidget } from '@/components/widgets/SwitchWidget'
import { SensorWidget } from '@/components/widgets/SensorWidget'
import { NavigationMenu } from '@/components/NavigationMenu'
import { SplashScreen } from '@/components/SplashScreen'
import { LoginModal } from '@/components/LoginModal'
import { ConnectionStatus, BackendUnavailableOverlay } from '@/components/ConnectionStatus'
import { EntityDiscoveryNotification } from '@/components/EntityDiscoveryNotification'
import { PageDesigner } from '@/components/PageDesigner'
import { CustomPageRenderer } from '@/components/CustomPageRenderer'
import { ConfigurationSettings } from '@/components/ConfigurationSettings'
import { LightEnhancementsSettings } from '@/components/LightEnhancementsSettings'
import { OverviewConfiguration } from '@/components/OverviewConfiguration'
import { DynamicBackground } from '@/components/DynamicBackground'
import { Screensaver, useScreensaverSettings } from '@/components/Screensaver'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAccentColor } from '@/hooks/useAccentColor'
import { useNightModeSettings } from '@/hooks/useNightModeSettings'
import { useGlassSettings } from '@/hooks/useGlassSettings'
import type { WeatherEntity, LightEntity, ClimateEntity, SwitchEntity, SensorEntity } from '@/lib/types'
import { Sparkle, Palette, Moon, PaintBucket, SignOut, User, GearSix, CheckCircle, ShieldCheck, House } from '@phosphor-icons/react'
import { Toaster } from '@/components/ui/sonner'
import { DEFAULT_DASHBOARD_BACKGROUND_URL } from '@/lib/defaults'
import { toast } from 'sonner'

// Isolated clock component -- re-renders every second without affecting the rest of the dashboard
function HeaderClock() {
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])
  return (
    <span className="text-sm font-medium">
      {time.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
    </span>
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
  const { background, savePreference, getPreference } = useConfiguration()
  const { theme } = useTheme()
  const { user, isAuthenticated, isLoading: authLoading, logout, updateProfile } = useAuth()
  const { currentPageId, currentPage } = usePageNavigation()
  const { checkForNewEntities } = useEntityDiscovery()
  const { evaluateTriggers, currentVariant } = useDynamicOverview()
  const screensaverSettings = useScreensaverSettings()
  const accentColorSettings = useAccentColor()
  const nightModeSettings = useNightModeSettings()
  const glassSettings = useGlassSettings()
  const { entities, loading, refresh } = useEntityStore()
  const userName = useMemo(() => user?.displayName || user?.username || 'Benutzer', [user])
  const [showSplash, setShowSplash] = useState(true)
  const [showPageDesigner, setShowPageDesigner] = useState(false)
  const [settingsTab, setSettingsTab] = useState<'home' | 'user' | 'design' | 'system'>('home')
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
  const lastEvalRef = useRef(0)
  const hasActiveCustomBackground = Boolean(background?.is_active)

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
    return <SplashScreen onComplete={() => setShowSplash(false)} />
  }

  // Gate: show ONLY login screen when not authenticated
  if (!authLoading && !isAuthenticated) {
    return (
      <div className="min-h-screen relative overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{
            backgroundImage: `url('${DEFAULT_DASHBOARD_BACKGROUND_URL}')`,
            filter: 'brightness(0.3)',
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/20 to-black/60" />
        <LoginModal open onOpenChange={() => {}} />
      </div>
    )
  }

  // Still verifying token — show nothing
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <Sparkle className="text-foreground animate-pulse" size={32} weight="fill" />
      </div>
    )
  }

  return (
    <>
      <div
        className="min-h-screen relative theme-transition overflow-x-hidden"
      >
        <Screensaver
          enabled={screensaverSettings.enabled}
          timeout={screensaverSettings.timeout}
        />
        <DynamicBackground />
        <BackendUnavailableOverlay />
        <ConnectionStatus />
        <EntityDiscoveryNotification />

        {!hasActiveCustomBackground && (
          <div
            className="fixed inset-0 bg-cover bg-center bg-no-repeat theme-transition z-0 pointer-events-none"
            style={{
              backgroundImage: `url('${DEFAULT_DASHBOARD_BACKGROUND_URL}')`,
              backgroundAttachment: 'fixed',
              filter: theme === 'sleep' ? 'brightness(0.05) grayscale(0.8)' : theme === 'night' ? 'brightness(0.4)' : theme === 'evening' ? 'brightness(0.5)' : 'brightness(0.75)',
              transform: 'translateZ(0)',
            }}
          />
        )}

        <div className="absolute inset-0 z-10 pointer-events-none bg-gradient-to-b from-black/40 via-black/20 to-black/60"></div>
        {(theme === 'night' || theme === 'sleep') && nightModeSettings.nightFilterEnabled && (
          <div
            className="absolute inset-0 z-10 pointer-events-none"
            style={{
              background: theme === 'sleep' ? 'rgba(8, 8, 14, 1)' : 'rgba(35, 22, 12, 1)',
              opacity: (theme === 'sleep' ? 0.65 : 0.45) * (nightModeSettings.overlayStrength / 100),
              transition: 'opacity var(--transition-duration) ease',
            }}
          />
        )}

        <div className="relative z-20">
          <header className="glass-header theme-transition">
            <div className="max-w-[1500px] mx-auto px-3 sm:px-4 md:px-6 lg:px-8 py-3 sm:py-4 flex items-center justify-between">
              <h1 className="text-sm font-medium tracking-wide">MDT HOME</h1>
              <HeaderClock />
            </div>
          </header>

          <main className="max-w-[1500px] mx-auto px-3 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-6 lg:py-8">
          {loading ? (
            <div className="flex items-center justify-center py-32">
              <div className="text-center space-y-4">
                <Sparkle className="mx-auto text-foreground animate-pulse" size={32} weight="fill" />
                <p className="text-sm text-foreground/80">Dashboard wird geladen...</p>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {currentPageId === 'home' && filteredHomePage && (
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

              {currentPageId === 'lights' && lightEntities.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xl font-medium text-foreground px-1">Beleuchtung</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5 gap-3 sm:gap-4">
                    {lightEntities.map((light) => (
                      <LightWidget
                        key={light.entity_id}
                        entity={light}
                        onUpdate={refresh}
                        allEntities={entities}
                      />
                    ))}
                  </div>
                </div>
              )}

              {currentPageId === 'climate' && climateEntities.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xl font-medium text-foreground px-1">Klima</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3 sm:gap-4">
                    {climateEntities.map((climate) => (
                      <ClimateWidget
                        key={climate.entity_id}
                        entity={climate}
                        onUpdate={refresh}
                      />
                    ))}
                  </div>
                </div>
              )}

              {currentPageId === 'switches' && switchEntities.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xl font-medium text-foreground px-1">Schalter</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5 gap-3 sm:gap-4">
                    {switchEntities.map((switchEntity) => (
                      <SwitchWidget
                        key={switchEntity.entity_id}
                        entity={switchEntity}
                        onUpdate={refresh}
                      />
                    ))}
                  </div>
                </div>
              )}

              {currentPageId === 'sensors' && sensorEntities.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xl font-medium text-foreground px-1">Sensoren</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5 gap-3 sm:gap-4">
                    {sensorEntities.map((sensor) => (
                      <SensorWidget
                        key={sensor.entity_id}
                        entity={sensor}
                        onUpdate={refresh}
                      />
                    ))}
                  </div>
                </div>
              )}

              {currentPageId === 'settings' && (
                <div className="space-y-6">
                  <h3 className="text-xl font-medium text-foreground px-1">Einstellungen</h3>

                  <Tabs value={settingsTab} onValueChange={(v) => setSettingsTab(v as 'home' | 'user' | 'design' | 'system')}>
                    <TabsList className="grid grid-cols-4 w-full rounded-xl bg-foreground/5 p-1 h-auto">
                      <TabsTrigger value="home" className="gap-2 rounded-lg data-[state=active]:bg-accent/15 data-[state=active]:text-accent"><House size={14} /> Home</TabsTrigger>
                      <TabsTrigger value="user" className="gap-2 rounded-lg data-[state=active]:bg-accent/15 data-[state=active]:text-accent"><User size={14} /> Benutzer</TabsTrigger>
                      <TabsTrigger value="design" className="gap-2 rounded-lg data-[state=active]:bg-accent/15 data-[state=active]:text-accent"><Palette size={14} /> Design</TabsTrigger>
                      <TabsTrigger value="system" className="gap-2 rounded-lg data-[state=active]:bg-accent/15 data-[state=active]:text-accent"><GearSix size={14} /> System</TabsTrigger>
                    </TabsList>

                    <TabsContent value="home" className="space-y-4 mt-4">
                      {deviceLockMode && (
                        <div className="rounded-xl p-3 border border-amber-500/30 bg-amber-500/10 text-xs text-foreground/80">
                          Einstellungen sind durch Geraete-Modus gesperrt. Entsperren im Tab "Benutzer".
                        </div>
                      )}
                      <div className={deviceLockMode ? 'opacity-60 pointer-events-none select-none' : ''}>
                        <LightEnhancementsSettings settingsLocked={deviceLockMode} />
                      </div>
                    </TabsContent>

                    <TabsContent value="user" className="space-y-4 mt-4">
                      <div className="glass-card rounded-2xl p-6 theme-transition">
                        <h4 className="text-sm font-medium text-foreground mb-4">Benutzerprofil</h4>
                        <div className="space-y-4">
                          <div className="p-4 rounded-xl bg-foreground/5">
                            <div className="flex items-center gap-4">
                              <div className="w-12 h-12 rounded-full bg-accent/20 flex items-center justify-center">
                                <User size={24} weight="fill" className="text-accent" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-sm truncate">{user?.displayName || user?.username || 'Benutzer'}</p>
                                {user?.displayName && user?.username && (
                                  <p className="text-xs text-foreground/60 truncate">@{user.username}</p>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="p-4 rounded-xl bg-foreground/5 space-y-3">
                            <p className="font-medium text-sm">Benutzer bearbeiten</p>
                            <div className="grid sm:grid-cols-2 gap-3">
                              <div>
                                <label className="text-xs text-foreground/60 block mb-1">Benutzername</label>
                                <input
                                  type="text"
                                  value={profileUsername}
                                  onChange={(e) => setProfileUsername(e.target.value)}
                                  className="w-full px-3 py-2 rounded-lg bg-card/60 border border-foreground/10 text-sm text-foreground focus:outline-none focus:border-accent"
                                  disabled={isSavingProfile}
                                />
                              </div>
                              <div>
                                <label className="text-xs text-foreground/60 block mb-1">Anzeigename</label>
                                <input
                                  type="text"
                                  value={profileDisplayName}
                                  onChange={(e) => setProfileDisplayName(e.target.value)}
                                  className="w-full px-3 py-2 rounded-lg bg-card/60 border border-foreground/10 text-sm text-foreground focus:outline-none focus:border-accent"
                                  disabled={isSavingProfile}
                                />
                              </div>
                            </div>
                            <button
                              onClick={saveUserProfile}
                              disabled={isSavingProfile}
                              className="w-full px-4 py-2.5 rounded-xl bg-accent hover:bg-accent/90 text-accent-foreground text-sm font-medium transition-colors disabled:opacity-60"
                            >
                              {isSavingProfile ? 'Speichern...' : 'Profil speichern'}
                            </button>
                          </div>

                          <div className="p-4 rounded-xl bg-foreground/5 space-y-3">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="font-medium text-sm">PIN fuer Einstellungen</p>
                                <p className="text-xs text-foreground/60">Sichert das Entsperren des Geraete-Modus ab.</p>
                              </div>
                              {pinHash && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 text-emerald-400 px-2 py-1 text-[11px]">
                                  <CheckCircle size={12} weight="fill" /> Aktiv
                                </span>
                              )}
                            </div>
                            <div className="grid sm:grid-cols-2 gap-3">
                              <div>
                                <label className="text-xs text-foreground/60 block mb-1">Neue PIN (4-8 Ziffern)</label>
                                <input
                                  type="password"
                                  inputMode="numeric"
                                  value={pinCode}
                                  onChange={(e) => setPinCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
                                  className="w-full px-3 py-2 rounded-lg bg-card/60 border border-foreground/10 text-sm text-foreground focus:outline-none focus:border-accent"
                                  placeholder="1234"
                                />
                              </div>
                              <div>
                                <label className="text-xs text-foreground/60 block mb-1">PIN bestaetigen</label>
                                <input
                                  type="password"
                                  inputMode="numeric"
                                  value={pinConfirm}
                                  onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, '').slice(0, 8))}
                                  className="w-full px-3 py-2 rounded-lg bg-card/60 border border-foreground/10 text-sm text-foreground focus:outline-none focus:border-accent"
                                  placeholder="1234"
                                />
                              </div>
                            </div>
                            <button
                              onClick={savePin}
                              className="w-full px-4 py-2.5 rounded-xl bg-foreground/10 hover:bg-foreground/15 text-foreground text-sm font-medium transition-colors"
                            >
                              PIN speichern
                            </button>
                          </div>

                          <div className="p-4 rounded-xl bg-foreground/5 flex items-center justify-between gap-3">
                            <div>
                              <p className="font-medium text-sm">Geraete-Modus (Einstellungen sperren)</p>
                              <p className="text-xs text-foreground/60">Sperrt Anpassungen auf Design- und System-Tab fuer dieses Konto. Beim Entsperren kann optional eine PIN verlangt werden.</p>
                            </div>
                            <Switch checked={deviceLockMode} onCheckedChange={updateDeviceLockMode} disabled={lockLoading} />
                          </div>

                          <button
                            onClick={logout}
                            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-destructive/10 hover:bg-destructive/20 text-destructive transition-colors"
                          >
                            <SignOut size={18} weight="bold" />
                            <span className="text-sm font-medium">Abmelden</span>
                          </button>
                        </div>
                      </div>
                    </TabsContent>

                    <TabsContent value="design" className="space-y-4 mt-4">
                      {deviceLockMode && (
                        <div className="rounded-xl p-3 border border-amber-500/30 bg-amber-500/10 text-xs text-foreground/80">
                          Einstellungen sind durch Geraete-Modus gesperrt. Entsperren im Tab "Benutzer".
                        </div>
                      )}
                      <div className={deviceLockMode ? 'opacity-60 pointer-events-none select-none' : ''}>
                        <ConfigurationSettings settingsLocked={deviceLockMode} />
                        <OverviewConfiguration />

                        <div className="glass-card rounded-2xl p-6 theme-transition mt-6">
                          <h4 className="text-sm font-medium text-foreground mb-4">Akzentfarbe</h4>
                          <p className="text-xs text-foreground/60 mb-4">
                            Waehlen Sie, ob die Akzentfarbe automatisch aus dem Hintergrundbild extrahiert oder statisch festgelegt werden soll.
                          </p>

                          <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                              <button
                                onClick={() => accentColorSettings.setMode('auto')}
                                className={`
                                  p-3 rounded-xl border-2 transition-all
                                  ${accentColorSettings.mode === 'auto'
                                    ? 'border-accent bg-accent/10'
                                    : 'border-foreground/10 bg-foreground/5 hover:border-foreground/20'
                                  }
                                `}
                              >
                                <Sparkle size={24} weight="fill" className={accentColorSettings.mode === 'auto' ? 'text-accent' : 'text-foreground/60'} />
                                <p className="text-xs mt-2 font-medium">Automatisch</p>
                              </button>

                              <button
                                onClick={() => accentColorSettings.setMode('static')}
                                className={`
                                  p-3 rounded-xl border-2 transition-all
                                  ${accentColorSettings.mode === 'static'
                                    ? 'border-accent bg-accent/10'
                                    : 'border-foreground/10 bg-foreground/5 hover:border-foreground/20'
                                  }
                                `}
                              >
                                <PaintBucket size={24} weight="fill" className={accentColorSettings.mode === 'static' ? 'text-accent' : 'text-foreground/60'} />
                                <p className="text-xs mt-2 font-medium">Statisch</p>
                              </button>
                            </div>

                            {accentColorSettings.mode === 'static' && (
                              <div className="p-4 rounded-xl bg-foreground/5">
                                <label className="text-sm font-medium text-foreground block mb-3">Farbe auswaehlen</label>
                                <div className="flex items-center gap-4">
                                  <input type="color" value={accentColorSettings.staticColor} onChange={(e) => accentColorSettings.setStaticColor(e.target.value)} className="w-16 h-16 rounded-lg cursor-pointer border-2 border-foreground/10" />
                                  <div className="flex-1">
                                    <p className="text-sm font-mono text-foreground">{accentColorSettings.staticColor}</p>
                                  </div>
                                </div>
                              </div>
                            )}

                            <div className="p-4 rounded-xl bg-foreground/5">
                              <p className="text-xs text-foreground/60 mb-2">Aktuelle Akzentfarbe</p>
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-lg border-2 border-foreground/10" style={{ backgroundColor: accentColorSettings.accentColor }} />
                                <p className="text-sm font-mono text-foreground">{accentColorSettings.accentColor}</p>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </TabsContent>

                    <TabsContent value="system" className="space-y-4 mt-4">
                      {deviceLockMode && (
                        <div className="rounded-xl p-3 border border-amber-500/30 bg-amber-500/10 text-xs text-foreground/80">
                          Einstellungen sind durch Geraete-Modus gesperrt. Entsperren im Tab "Benutzer".
                        </div>
                      )}
                      <div className={`space-y-4 ${deviceLockMode ? 'opacity-60 pointer-events-none select-none' : ''}`}>
                        <div className="glass-card rounded-2xl p-6 theme-transition">
                          <h4 className="text-sm font-medium text-foreground mb-4">Bildschirmschoner</h4>
                          <div className="space-y-4">
                            <div className="flex items-center justify-between p-4 rounded-xl bg-foreground/5">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-lg bg-accent/20 flex items-center justify-center">
                                  <Moon size={20} weight="fill" className="text-accent" />
                                </div>
                                <div>
                                  <p className="font-medium text-sm">Bildschirmschoner aktivieren</p>
                                  <p className="text-xs text-foreground/60">Zeigt nur die Uhrzeit bei Inaktivitaet</p>
                                </div>
                              </div>
                              <Switch checked={screensaverSettings.enabled} onCheckedChange={screensaverSettings.setEnabled} />
                            </div>

                            {screensaverSettings.enabled && (
                              <div className="p-4 rounded-xl bg-foreground/5">
                                <label className="text-sm font-medium text-foreground block mb-3">Inaktivitaetsdauer (Minuten)</label>
                                <div className="flex items-center gap-4">
                                  <input type="range" min="1" max="30" value={screensaverSettings.timeout / 60000} onChange={(e) => screensaverSettings.setTimeout(Number(e.target.value) * 60000)} className="flex-1 h-2 bg-foreground/10 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-accent [&::-moz-range-thumb]:border-0" />
                                  <span className="text-sm font-medium text-foreground min-w-[3rem] text-right">{screensaverSettings.timeout / 60000} min</span>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="glass-card rounded-2xl p-6 theme-transition">
                          <h4 className="text-sm font-medium text-foreground mb-4">Glaseffekt</h4>
                          <div className="space-y-4">
                            <div className="flex items-center justify-between p-4 rounded-xl bg-foreground/5">
                              <div>
                                <p className="font-medium text-sm">Glaseffekt aktivieren</p>
                                <p className="text-xs text-foreground/60">Deaktiviert alle Frosted-Glass Layer global</p>
                              </div>
                              <Switch checked={glassSettings.enabled} onCheckedChange={glassSettings.setEnabled} />
                            </div>
                            <div className="p-4 rounded-xl bg-foreground/5 space-y-3">
                              <label className="text-sm font-medium text-foreground block">Unschaerfe-Intensitaet</label>
                              <div className="flex items-center gap-4">
                                <input type="range" min="0" max="60" value={glassSettings.blurIntensity} onChange={(e) => glassSettings.setBlurIntensity(Number(e.target.value))} disabled={!glassSettings.enabled} className="flex-1 h-2 bg-foreground/10 rounded-lg appearance-none cursor-pointer disabled:opacity-50 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-accent [&::-moz-range-thumb]:border-0" />
                                <span className="text-sm font-medium text-foreground min-w-[3rem] text-right">{glassSettings.blurIntensity}px</span>
                              </div>
                            </div>
                            <div className="p-4 rounded-xl bg-foreground/5 space-y-3">
                              <label className="text-sm font-medium text-foreground block">Card-Radius</label>
                              <div className="flex items-center gap-4">
                                <input type="range" min="8" max="28" value={glassSettings.cardRadius} onChange={(e) => glassSettings.setCardRadius(Number(e.target.value))} disabled={!glassSettings.enabled} className="flex-1 h-2 bg-foreground/10 rounded-lg appearance-none cursor-pointer disabled:opacity-50 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-accent [&::-moz-range-thumb]:border-0" />
                                <span className="text-sm font-medium text-foreground min-w-[3rem] text-right">{glassSettings.cardRadius}px</span>
                              </div>
                            </div>
                            <div className="p-4 rounded-xl bg-foreground/5 space-y-3">
                              <label className="text-sm font-medium text-foreground block">Rahmen-Sichtbarkeit</label>
                              <div className="flex items-center gap-4">
                                <input type="range" min="0" max="30" value={Math.round(glassSettings.borderAlpha * 100)} onChange={(e) => glassSettings.setBorderAlpha(Number(e.target.value) / 100)} disabled={!glassSettings.enabled} className="flex-1 h-2 bg-foreground/10 rounded-lg appearance-none cursor-pointer disabled:opacity-50 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-accent [&::-moz-range-thumb]:border-0" />
                                <span className="text-sm font-medium text-foreground min-w-[3rem] text-right">{Math.round(glassSettings.borderAlpha * 100)}%</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="glass-card rounded-2xl p-6 theme-transition">
                          <h4 className="text-sm font-medium text-foreground mb-4">Nachtmodus</h4>
                          <div className="space-y-4">
                            <div className="flex items-center justify-between p-4 rounded-xl bg-foreground/5">
                              <div>
                                <p className="font-medium text-sm">Nachtfilter</p>
                                <p className="text-xs text-foreground/60">Sepia- und Abdunkelungseffekt</p>
                              </div>
                              <Switch checked={nightModeSettings.nightFilterEnabled} onCheckedChange={nightModeSettings.setNightFilterEnabled} />
                            </div>

                            {nightModeSettings.nightFilterEnabled && (
                              <>
                                <div className="p-4 rounded-xl bg-foreground/5">
                                  <label className="text-sm font-medium text-foreground block mb-3">Blaulichtfilter-Intensitaet</label>
                                  <div className="flex items-center gap-4">
                                    <input
                                      type="range"
                                      min="0"
                                      max="100"
                                      value={nightModeSettings.blueLightReduction}
                                      onChange={(e) => nightModeSettings.setBlueLightReduction(Number(e.target.value))}
                                      className="flex-1 h-2 bg-foreground/10 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-accent [&::-moz-range-thumb]:border-0"
                                    />
                                    <span className="text-sm font-medium text-foreground min-w-[3rem] text-right">{nightModeSettings.blueLightReduction}%</span>
                                  </div>
                                </div>

                                <div className="flex items-center justify-between p-4 rounded-xl bg-foreground/5">
                                  <div>
                                    <p className="font-medium text-sm">Automatische Helligkeit</p>
                                    <p className="text-xs text-foreground/60">Helligkeit basierend auf Blaulichtfilter anpassen</p>
                                  </div>
                                  <Switch checked={nightModeSettings.autoBrightness} onCheckedChange={nightModeSettings.setAutoBrightness} />
                                </div>

                                <div className="p-4 rounded-xl bg-foreground/5">
                                  <label className="text-sm font-medium text-foreground block mb-3">Nacht-Overlay (Lesbarkeit)</label>
                                  <div className="flex items-center gap-4">
                                    <input
                                      type="range"
                                      min="0"
                                      max="100"
                                      value={nightModeSettings.overlayStrength}
                                      onChange={(e) => nightModeSettings.setOverlayStrength(Number(e.target.value))}
                                      className="flex-1 h-2 bg-foreground/10 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-accent [&::-moz-range-thumb]:border-0"
                                    />
                                    <span className="text-sm font-medium text-foreground min-w-[3rem] text-right">{nightModeSettings.overlayStrength}%</span>
                                  </div>
                                </div>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="glass-card rounded-2xl p-6 theme-transition">
                          <h4 className="text-sm font-medium text-foreground mb-4">Dashboard-Anpassung</h4>
                          <button onClick={() => setShowPageDesigner(true)} className="w-full px-4 py-3 rounded-xl bg-accent/10 hover:bg-accent/20 text-accent transition-colors flex items-center justify-between group">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-lg bg-accent/20 flex items-center justify-center">
                                <Palette size={20} weight="fill" />
                              </div>
                              <div className="text-left">
                                <p className="font-medium">Seiten-Designer</p>
                                <p className="text-xs text-foreground/60">Dashboard-Seiten anpassen und organisieren</p>
                              </div>
                            </div>
                            <Sparkle size={20} weight="fill" className="group-hover:rotate-12 transition-transform" />
                          </button>
                        </div>

                        <div className="glass-card rounded-2xl p-6 theme-transition">
                          <h4 className="text-sm font-medium text-foreground mb-4">System-Information</h4>
                          <div className="space-y-4">
                            <div>
                              <h5 className="text-sm font-medium text-foreground mb-2">Benutzername</h5>
                              <p className="text-foreground/60 text-sm">{userName}</p>
                            </div>
                            <div>
                              <h5 className="text-sm font-medium text-foreground mb-2">Theme</h5>
                              <p className="text-foreground/60 text-sm capitalize">{theme}</p>
                            </div>
                            <div>
                              <h5 className="text-sm font-medium text-foreground mb-2">Entitaeten</h5>
                              <p className="text-foreground/60 text-sm">{entities.length} Entitaeten geladen</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </TabsContent>
                  </Tabs>
                </div>
              )}
              {/* TODO: Music Player Page */}
              {currentPageId === 'music' && (
                <div className="space-y-3 w-full h-full flex flex-col z-1000 bg-card p-4 theme-transition absolute top-0 left-0">
                  <h3 className="text-xl font-medium text-foreground px-1">Musiksteuerung</h3>
                </div>
              )}
              {!['home', 'lights', 'climate', 'switches', 'sensors', 'settings'].includes(currentPageId) && currentPage && (
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
          )}
        </main>
        </div>
      </div>
      <Dialog open={showUnlockDialog} onOpenChange={setShowUnlockDialog}>
        <DialogContent className="sm:max-w-[420px] glass-card border-foreground/10 p-0 gap-0 bg-card/95 backdrop-blur-2xl" hideCloseButton>
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
      <PageDesigner
        isOpen={showPageDesigner}
        onClose={() => setShowPageDesigner(false)}
        availableEntities={entities}
        userName={userName}
        weatherEntity={weatherEntity}
        lightEntities={lightEntities}
      />
      <NavigationMenu hidden={showPageDesigner} />
    </>
  )
}

function App() {
  return (
    <ConnectionProvider>
      <AuthProvider>
        <ThemeProvider>
          <PageNavigationProvider>
            <ConfigurationProvider>
              <EntityDiscoveryProvider>
                <DynamicOverviewProvider>
                  <DashboardContent />
                  <Toaster />
                </DynamicOverviewProvider>
              </EntityDiscoveryProvider>
            </ConfigurationProvider>
          </PageNavigationProvider>
        </ThemeProvider>
      </AuthProvider>
    </ConnectionProvider>
  )
}

export default App
