import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { authFetch } from '@/lib/authHelpers'
import {
  User,
  Palette,
  GearSix,
  Layout,
  SignOut,
  CheckCircle,
  Shield,
  Moon,
  Sparkle,
  PaintBucket,
  Eye,
  Info,
  Drop,
  Cpu,
  HardDrives,
  Database,
  WifiHigh,
  ChartLine,
  ArrowsClockwise,
  NumberCircleOne,
  Trash,
  Code,
  Vibrate,
  TextAa,
  NavigationArrow,
  Key,
  Fingerprint,
  SlidersHorizontal,
  Warning,
  MapPin,
  MagnifyingGlass,
  X,
  Plus,
  Clock,
  CalendarBlank,
  BookOpen,
  ArrowSquareOut,
  PaintBrush,
  BracketsCurly,
  Globe,
  Power,
  ArrowClockwise,
  AppWindow,
} from '@phosphor-icons/react'
import { ConfigurationSettings } from '@/components/ConfigurationSettings'
import { LightEnhancementsSettings } from '@/components/LightEnhancementsSettings'
import { OverviewConfiguration } from '@/components/OverviewConfiguration'
import { CssSettingsSection } from '@/components/CssSettings'
import { OsAppNavbar } from '@/components/OsAppNavbar'
import { OsAppFrame } from '@/components/OsAppFrame'
import { useOsPermissions } from '@/hooks/useOsPermissions'
import { useVisibleInterval } from '@/hooks/useVisibleInterval'
import { useRealtime } from '@/hooks/useRealtime'
import { cachedGet } from '@/lib/apiCache'
import { useAuth } from '@/contexts/AuthContext'
import { readAccentIcons, applyAccentIcons } from '@/lib/accentIcons'
import { useLocalStorage } from '@/lib/storage'
import {
  getAutoContrastMode,
  getEffectiveAutoContrastMode,
  getDeviceTier,
  setAutoContrastMode,
  subscribeAutoContrast,
  type AutoContrastMode,
} from '@/lib/autoContrast'
import { useTheme } from '@/contexts/ThemeContext'
import { usePageNavigation } from '@/contexts/PageNavigationContext'
import { useUiScale } from '@/hooks/useUiScale'
import { ThemeSettingsPanel } from '@/components/ThemeSettingsPanel'
import { ThemeEditor } from '@/components/ThemeEditor'
import { YamlPageEditor } from '@/components/YamlPageEditor'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { AiInstructionsSettings } from '@/components/AiInstructionsSettings'
import type { ThemeMode } from '@/lib/types'
import type { ThemeDefinition } from '@/contexts/ThemeContext'

function ThemeSettingsPanelWrapper() {
  const { capabilities } = useTheme()
  const hasContent = !!(
    capabilities?.design_modes?.length ||
    capabilities?.accent_control?.presets?.length ||
    capabilities?.glass_control ||
    capabilities?.custom_settings?.length
  )
  if (!hasContent) return null
  return (
    <div className="p-4 rounded-2xl rumahl-card border-foreground/10">
      <ThemeSettingsPanel />
    </div>
  )
}
import { toast } from 'sonner'
import { Tip } from '@/components/ui/tip'
import {
  apiBase,
  createBackupCodes,
  DAY_LABELS,
  downloadBackupCodes,
  formatOtpAuthUri,
  generateBase32Secret,
  getCustomThemePreview,
  getTimeBasedCode,
  MapThemeIcon,
  SettingsSection,
  SliderRow,
  THEME_OPTIONS,
  ToggleRow,
} from './settings/shared'

// Lazy-loaded settings sections — split into separate chunks to keep the initial
// SettingsPage bundle small. Each section loads on demand when its tab is opened.
const LoginPinSection = lazy(() => import('./settings/SettingsSecurity').then((m) => ({ default: m.LoginPinSection })))
const TwoFactorPasskeySection = lazy(() => import('./settings/SettingsSecurity').then((m) => ({ default: m.TwoFactorPasskeySection })))
const ScreensaverScheduleEditor = lazy(() => import('./settings/SettingsDashboard').then((m) => ({ default: m.ScreensaverScheduleEditor })))
const AdditionalSettings = lazy(() => import('./settings/SettingsSystem').then((m) => ({ default: m.AdditionalSettings })))
const NinaSettingsSection = lazy(() => import('./settings/SettingsSystem').then((m) => ({ default: m.NinaSettingsSection })))
const FamilyProfilesSection = lazy(() => import('./settings/SettingsSystem').then((m) => ({ default: m.FamilyProfilesSection })))
const KeyboardShortcutsSection = lazy(() => import('./settings/SettingsSystem').then((m) => ({ default: m.KeyboardShortcutsSection })))
const DefaultAppsSection = lazy(() => import('./settings/SettingsSystem').then((m) => ({ default: m.DefaultAppsSection })))
const MediaHubConfigSection = lazy(() => import('./settings/SettingsSystem').then((m) => ({ default: m.MediaHubConfigSection })))
const RemoteAccessSection = lazy(() => import('./settings/SettingsSystem').then((m) => ({ default: m.RemoteAccessSection })))
const SettingsAppsSection = lazy(() => import('./SettingsAppsSection').then((m) => ({ default: m.SettingsAppsSection })))

// ─── System stats types ──────────────────────────────────────────────
interface SystemStats {
  cpu: { usage_percent: number; cores: number }
  memory: { total_bytes: number; used_bytes: number; usage_percent: number }
  uptime_seconds: number
  database: { size_bytes: number; history_rows: number }
  backend: {
    version: string
    entity_count: number
    connected_clients: number
    cache_metrics: { update_count: number; last_update_ms: number; cache_hits: number; cache_misses: number }
  }
  ha_connected: boolean
  ha_ws_connected: boolean
}

interface HAInfo {
  ha_connected: boolean
  ha_ws_connected: boolean
  entity_count: number
  ha_version: string | null
  domains: Array<{ domain: string; count: number }>
  history_entries_24h: number
}

function useSystemStats(enabled: boolean) {
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [haInfo, setHaInfo] = useState<HAInfo | null>(null)
  const [osInfo, setOsInfo] = useState<{ hostname: string; os_name: string; os_version: string; kernel_version: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const realtime = useRealtime<{ cpu_usage_percent: number; cpu_cores: number; memory_total_bytes: number; memory_used_bytes: number; memory_usage_percent: number; uptime_seconds: number }>('system_stats')

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [statsRes, haRes] = await Promise.all([
        cachedGet(`/api/system/stats`, 8000),
        cachedGet(`/api/system/ha-info`, 8000),
      ])
      if (statsRes.ok) setStats(await statsRes.json())
      if (haRes.ok) setHaInfo(await haRes.json())
    } catch {
      // silently fail
    } finally {
      setLoading(false)
    }
    // OS details (hostname, distro, kernel) — separate so a permission
    // failure never blocks the other stats.
    try {
      const osRes = await cachedGet('/api/os/control/system', 15000)
      if (osRes.ok) setOsInfo(await osRes.json())
    } catch {
      // ignore — OS info is optional
    }
  }, [])

  // Poll system stats only while the tab is visible; fast values (CPU/memory)
  // arrive in real time over the WebSocket, so a slower fallback is enough.
  useVisibleInterval(refresh, enabled ? 30000 : null)

  // Merge real-time WS values over the polled snapshot (slow fields stay polled).
  const statsView = stats && realtime
    ? {
        ...stats,
        cpu: { usage_percent: realtime.cpu_usage_percent, cores: realtime.cpu_cores },
        memory: { total_bytes: realtime.memory_total_bytes, used_bytes: realtime.memory_used_bytes, usage_percent: realtime.memory_usage_percent },
        uptime_seconds: realtime.uptime_seconds,
      }
    : stats

  return { stats: statsView, haInfo, osInfo, loading, refresh }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

// ─── Mini progress bar ───────────────────────────────────────────────
export function ProgressBar({ value, max = 100, color = 'accent' }: { value: number; max?: number; color?: string }) {
  const pct = Math.min((value / max) * 100, 100)
  const colorClass = pct > 85 ? 'bg-red-400' : pct > 65 ? 'bg-amber-400' : color === 'accent' ? 'bg-accent' : `bg-${color}-400`
  return (
    <div className="w-full h-1.5 bg-foreground/10 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${colorClass}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// Main SettingsPage
// ═══════════════════════════════════════════════════════════════════════
interface SettingsPageProps {
  // User & Auth
  user: { username?: string; displayName?: string } | null
  userName: string
  logout: () => void
  updateProfile: (data: { username?: string; displayName?: string }) => Promise<void>
  // Device lock
  deviceLockMode: boolean
  lockLoading: boolean
  updateDeviceLockMode: (v: boolean) => void
  // PIN
  pinHash: string | null
  savePin: () => void
  pinCode: string
  setPinCode: (v: string) => void
  pinConfirm: string
  setPinConfirm: (v: string) => void
  // Profile editing
  isSavingProfile: boolean
  profileUsername: string
  setProfileUsername: (v: string) => void
  profileDisplayName: string
  setProfileDisplayName: (v: string) => void
  saveUserProfile: () => void
  // Design
  aiEnabled: boolean
  setAiEnabled: (v: boolean) => void
  accentColorSettings: {
    accentColor: string
    extractedPalette: string[]
    mode: 'auto' | 'static'
    staticColor: string
    intensity: number
    setMode: (m: 'auto' | 'static') => void
    setStaticColor: (c: string) => void
    setIntensity: (v: number) => void
    selectFromPalette: (c: string) => void
    resetToAuto: () => void
  }
  // Glass
  glassSettings: {
    enabled: boolean
    setEnabled: (v: boolean) => void
    blurIntensity: number
    setBlurIntensity: (v: number) => void
    transparency: number
    setTransparency: (v: number) => void
    cardRadius: number
    setCardRadius: (v: number) => void
    borderAlpha: number
    setBorderAlpha: (v: number) => void
  }
  // Night mode
  nightModeSettings: {
    nightFilterEnabled: boolean
    setNightFilterEnabled: (v: boolean) => void
    blueLightReduction: number
    setBlueLightReduction: (v: number) => void
    autoBrightness: boolean
    setAutoBrightness: (v: boolean) => void
    overlayStrength: number
    setOverlayStrength: (v: number) => void
    colorTemperature: number
    setColorTemperature: (v: number) => void
    scheduleEnabled: boolean
    setScheduleEnabled: (v: boolean) => void
    startTime: string
    setStartTime: (v: string) => void
    endTime: string
    setEndTime: (v: string) => void
    applyAlways: boolean
    setApplyAlways: (v: boolean) => void
    isActive: boolean
    isScheduleActive: boolean
  }
  // Screensaver
  screensaverSettings: {
    enabled: boolean
    setEnabled: (v: boolean) => void
    timeout: number
    setTimeout: (v: number) => void
    schedules: import('@/components/Screensaver').ScreensaverSchedule[]
    setSchedules: (v: import('@/components/Screensaver').ScreensaverSchedule[]) => void
  }
  // Dashboard
  setShowPageDesigner: (v: boolean) => void
  entities: unknown[]
  theme: string
}

export function SettingsPage(props: SettingsPageProps) {
  const { t } = useTranslation()
  const { user: authUser } = useAuth()
  const {
    user,
    userName,
    logout,
    deviceLockMode,
    lockLoading,
    updateDeviceLockMode,
    pinHash,
    savePin,
    pinCode,
    setPinCode,
    pinConfirm,
    setPinConfirm,
    isSavingProfile,
    profileUsername,
    setProfileUsername,
    profileDisplayName,
    setProfileDisplayName,
    saveUserProfile,
    accentColorSettings,
    glassSettings,
    nightModeSettings,
    screensaverSettings,
    setShowPageDesigner,
    entities,
    theme,
  } = props

  const [settingsTab, setSettingsTab] = useState<'general' | 'appearance' | 'dashboard' | 'system' | 'apps'>('general')
  const { preset: uiScalePreset, setPreset: setUiScale } = useUiScale()
  const { selectedTheme, setSelectedTheme } = useTheme()
  // Per-user auto-lock timeout (minutes, 0 = disabled).
  const [autoLockMinutes, setAutoLockMinutes] = useLocalStorage<number>('rumahl-auto-lock-minutes', 15)
  const [kioskMode, setKioskMode] = useLocalStorage<boolean>('rumahl-kiosk-mode', false)
  // Reduce-motion (animations) toggle — persisted under the same key the OS
  // accessibility flow reads (rumahl-accessibility.reduceMotion) so this toggle
  // stays in sync with the `data-reduce-motion` attribute the whole app respects.
  const [reduceMotion, setReduceMotion] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem('rumahl-accessibility')
      const parsed = raw ? JSON.parse(raw) : null
      return parsed?.reduceMotion === true
    } catch {
      return false
    }
  })
  const onToggleReduceMotion = (value: boolean) => {
    setReduceMotion(value)
    document.documentElement.toggleAttribute('data-reduce-motion', value)
    try {
      const raw = localStorage.getItem('rumahl-accessibility')
      const parsed = raw ? JSON.parse(raw) : {}
      parsed.reduceMotion = value
      localStorage.setItem('rumahl-accessibility', JSON.stringify(parsed))
    } catch {}
  }
  // Deep links via URL sub-path (/settings/apps/rumahl-browser): the Settings
  // app is path-driven so every tab (and the per-app detail view) has its
  // own URL that survives reloads, back/forward and sharing.
  const { currentSubPath, navigateToPage } = usePageNavigation()
  const [settingsAppId, setSettingsAppId] = useState<string | null>(null)
  useEffect(() => {
    const segments = currentSubPath.split('/').filter(Boolean)
    const tab = segments[0] as typeof settingsTab | undefined
    if (tab && ['general', 'appearance', 'dashboard', 'system', 'apps'].includes(tab)) {
      setSettingsTab(tab)
    }
    setSettingsAppId(tab === 'apps' && segments[1] ? segments[1] : null)
  }, [currentSubPath])
  const changeTab = (tab: typeof settingsTab) => {
    setSettingsTab(tab)
    // Push the tab into the URL (no full page reload) so the Settings app
    // works purely on paths; the apps tab gets the selected app appended.
    navigateToPage('settings', tab === 'apps' && settingsAppId ? `apps/${settingsAppId}` : tab)
  }
  /** Deep link into a specific app detail view: /settings/apps/<id>. */
  const changeTabWithApp = (appId: string) => {
    setSettingsTab('apps')
    setSettingsAppId(appId)
    navigateToPage('settings', `apps/${appId}`)
  }
  const [accentIcons, setAccentIcons] = useState(readAccentIcons)
  const { can } = useOsPermissions()
  const [powerAction, setPowerAction] = useState<'reboot' | 'shutdown' | null>(null)
  const [powerPending, setPowerPending] = useState(false)

  const executePowerAction = async () => {
    if (!powerAction) return
    setPowerPending(true)
    try {
      const response = await authFetch(`/api/os/control/os/${powerAction}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delay_seconds: 5, reason: 'Requested from rumahl OS settings' }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setPowerAction(null)
    } catch (e) {
      window.dispatchEvent(new CustomEvent('rumahl:toast', { detail: { message: e instanceof Error ? e.message : String(e) } }))
    } finally {
      setPowerPending(false)
    }
  }
  const [yamlEditorOpen, setYamlEditorOpen] = useState(false)
  const { stats, haInfo, osInfo, loading: statsLoading, refresh: refreshStats } = useSystemStats(settingsTab === 'system')
  const settingsHeading = {
    general: { title: t('settings.general'), description: t('settings.tabGeneralDesc') },
    appearance: { title: t('settings.appearance'), description: t('settings.tabAppearanceDesc') },
    dashboard: { title: t('settings.dashboard'), description: t('settings.tabDashboardDesc') },
    system: { title: t('settings.system'), description: t('settings.tabSystemDesc') },
    apps: { title: t('settings.apps'), description: t('settings.tabAppsDesc') },
  }[settingsTab]

  return (
    <Tabs value={settingsTab} onValueChange={(v) => changeTab(v as typeof settingsTab)} className="rumahl-settings-tabs">
      <OsAppFrame
        className="rumahl-settings-app"
        navbar={(
          <OsAppNavbar
            pageId="settings"
            title={t('navigation.settings')}
            description={t('os.apps.settings.description')}
            icon={<GearSix size={18} weight="regular" />}
            trailing={
              <span className="rumahl-settings-user"><User size={12} />{userName}</span>
            }
          />
        )}
        sidebar={(
          <div className="rumahl-settings-sidebar-wrap flex h-full flex-col">
            <div className="rumahl-settings-sidebar-brand">
              <span className="rumahl-settings-sidebar-brand-icon"><GearSix size={18} weight="fill" /></span>
              <span className="rumahl-settings-sidebar-brand-label">{t('navigation.settings')}</span>
            </div>
            <TabsList className="rumahl-settings-sidebar">
          <TabsTrigger value="general" className="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-all duration-200 data-[state=active]:bg-accent/12 data-[state=active]:shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--accent)_26%,transparent)]">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground/6 text-foreground/55 transition-colors duration-200 group-data-[state=active]:bg-accent/16 group-data-[state=active]:text-accent">
              <User size={15} weight="fill" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-foreground/85 group-data-[state=active]:text-foreground">{t('settings.general')}</span>
              <span className="hidden truncate text-[10px] text-foreground/45 xl:block">{t('settings.tabGeneralDesc')}</span>
            </span>
          </TabsTrigger>
          <TabsTrigger value="appearance" className="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-all duration-200 data-[state=active]:bg-accent/12 data-[state=active]:shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--accent)_26%,transparent)]">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground/6 text-foreground/55 transition-colors duration-200 group-data-[state=active]:bg-accent/16 group-data-[state=active]:text-accent">
              <Palette size={15} weight="fill" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-foreground/85 group-data-[state=active]:text-foreground">{t('settings.appearance')}</span>
              <span className="hidden truncate text-[10px] text-foreground/45 xl:block">{t('settings.tabAppearanceDesc')}</span>
            </span>
          </TabsTrigger>
          <TabsTrigger value="dashboard" className="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-all duration-200 data-[state=active]:bg-accent/12 data-[state=active]:shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--accent)_26%,transparent)]">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground/6 text-foreground/55 transition-colors duration-200 group-data-[state=active]:bg-accent/16 group-data-[state=active]:text-accent">
              <Layout size={15} weight="fill" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-foreground/85 group-data-[state=active]:text-foreground">{t('settings.dashboard')}</span>
              <span className="hidden truncate text-[10px] text-foreground/45 xl:block">{t('settings.tabDashboardDesc')}</span>
            </span>
          </TabsTrigger>
          <TabsTrigger value="system" className="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-all duration-200 data-[state=active]:bg-accent/12 data-[state=active]:shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--accent)_26%,transparent)]">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground/6 text-foreground/55 transition-colors duration-200 group-data-[state=active]:bg-accent/16 group-data-[state=active]:text-accent">
              <GearSix size={15} weight="fill" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-foreground/85 group-data-[state=active]:text-foreground">{t('settings.system')}</span>
              <span className="hidden truncate text-[10px] text-foreground/45 xl:block">{t('settings.tabSystemDesc')}</span>
            </span>
          </TabsTrigger>
          <TabsTrigger value="apps" className="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-all duration-200 data-[state=active]:bg-accent/12 data-[state=active]:shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--accent)_26%,transparent)]">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground/6 text-foreground/55 transition-colors duration-200 group-data-[state=active]:bg-accent/16 group-data-[state=active]:text-accent">
              <AppWindow size={15} weight="fill" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-foreground/85 group-data-[state=active]:text-foreground">{t('settings.apps')}</span>
              <span className="hidden truncate text-[10px] text-foreground/45 xl:block">{t('settings.tabAppsDesc')}</span>
            </span>
          </TabsTrigger>
          </TabsList>
          </div>
        )}
      >
        <div className="rumahl-settings-content">
          {settingsTab !== 'appearance' && (
            <header className="rumahl-settings-content-header">
              <div>
                <h2>{settingsHeading.title}</h2>
                <p>{settingsHeading.description}</p>
              </div>
              <div className="rumahl-settings-top-actions">
                <button type="button" onClick={() => setCurrentPageId('settings')} aria-label={t('common.reset')} title={t('common.reset')} className="rumahl-settings-icon-btn"><ArrowClockwise size={17} /></button>
                <button type="button" onClick={() => setCurrentPageId('launcher')} aria-label={t('os.window.close')} title={t('os.window.close')} className="rumahl-settings-icon-btn"><X size={18} /></button>
              </div>
            </header>
          )}


        {/* ─── TAB: Allgemein ──────────────────────────────────────── */}
        <TabsContent value="general" className="space-y-5">

          {/* Profile */}
          <SettingsSection icon={User} title={t("settings.profile")} description={t("settings.profileDesc")} accentIcon>
            <div className="rumahl-settings-profile-summary flex items-center gap-4 p-4 rounded-xl bg-foreground/[0.04] border border-foreground/8">
              <div className="w-12 h-12 rounded-full bg-accent/15 flex items-center justify-center shrink-0">
                <User size={22} weight="fill" className="text-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{user?.displayName || user?.username || 'Benutzer'}</p>
                {user?.displayName && user?.username && (
                  <p className="text-xs text-foreground/50 truncate">@{user.username}</p>
                )}
              </div>
            </div>

            <div className="rumahl-settings-field-grid grid sm:grid-cols-2 gap-3">
              <div>
                <label className="rumahl-field-label">Benutzername</label>
                <input
                  type="text"
                  value={profileUsername}
                  onChange={(e) => setProfileUsername(e.target.value)}
                  className="rumahl-field"
                  disabled={isSavingProfile}
                />
              </div>
              <div>
                <label className="rumahl-field-label">Anzeigename</label>
                <input
                  type="text"
                  value={profileDisplayName}
                  onChange={(e) => setProfileDisplayName(e.target.value)}
                  className="rumahl-field"
                  disabled={isSavingProfile}
                />
              </div>
            </div>
            <button
              onClick={saveUserProfile}
              disabled={isSavingProfile}
              className="rumahl-settings-primary-action w-full px-4 py-2.5 rounded-xl bg-accent text-accent-foreground text-sm font-medium transition-colors hover:bg-accent/90 disabled:opacity-60"
            >
              {isSavingProfile ? 'Wird gespeichert...' : 'Profil speichern'}
            </button>
          </SettingsSection>

          {/* Security */}
          <SettingsSection icon={Shield} title={t("settings.security")} description={t("settings.securityDesc")}>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="rumahl-field-label">
                  Neue PIN (4–8 Ziffern)
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  value={pinCode}
                  onChange={(e) => setPinCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
                  className="rumahl-field"
                  placeholder="••••"
                />
              </div>
              <div>
                <label className="rumahl-field-label">
                  PIN bestätigen
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  value={pinConfirm}
                  onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, '').slice(0, 8))}
                  className="rumahl-field"
                  placeholder="••••"
                />
              </div>
            </div>
            {pinHash && (
              <div className="flex items-center gap-2 text-xs text-emerald-400">
                <CheckCircle size={14} weight="fill" />
                <span>PIN ist aktiv</span>
              </div>
            )}
            <button
              onClick={savePin}
              className="rumahl-secondary-button w-full"
            >
              PIN speichern
            </button>

            <div className="border-t border-foreground/8 pt-3">
              <ToggleRow
                label="Geräte-Modus"
                description={t("settings.deviceLockDesc")}
                checked={deviceLockMode}
                onCheckedChange={updateDeviceLockMode}
                disabled={lockLoading}
              />
              <SliderRow
                label={t("settings.autoLock")}
                value={autoLockMinutes}
                min={0}
                max={60}
                unit="min"
                onChange={setAutoLockMinutes}
              />
              <ToggleRow
                label={t("settings.kioskMode")}
                description={t("settings.kioskModeDesc")}
                checked={kioskMode}
                onCheckedChange={setKioskMode}
              />
              <ToggleRow
                label={t("settings.autoScreensaver")}
                description={t("settings.autoScreensaverDesc")}
                checked={screensaverSettings.enabled}
                onCheckedChange={screensaverSettings.setEnabled}
              />
              <ToggleRow
                label="AI & Agent deaktivieren"
                description={t("settings.aiDisableDesc")}
                checked={!props.aiEnabled}
                onCheckedChange={(v) => props.setAiEnabled(!v)}
              />
            </div>
          </SettingsSection>

          {/* Quick Login PIN */}
          <Suspense fallback={null}><LoginPinSection /></Suspense>

          {/* AI Instructions */}
          {props.aiEnabled && (
            <SettingsSection icon={Sparkle} title="AI-Persönlichkeit" description="Passe an, wie rumahl AI antworten soll" accentIcon>
              <AiInstructionsSettings />
            </SettingsSection>
          )}

          {/* 2FA / Passkey */}
          <Suspense fallback={null}><TwoFactorPasskeySection /></Suspense>

          {/* Logout */}
          <button
            onClick={logout}
            className="w-full flex items-center justify-center gap-2.5 px-4 py-3.5 rounded-2xl bg-red-500/8 hover:bg-red-500/15 text-red-400 border border-red-500/15 transition-colors"
          >
            <SignOut size={18} weight="bold" />
            <span className="text-sm font-medium">{t("settings.logout")}</span>
          </button>
        </TabsContent>

        {/* ─── TAB: Darstellung ────────────────────────────────────── */}
        <TabsContent value="appearance">
          <div className={`rumahl-settings-appearance ${deviceLockMode ? 'opacity-50 pointer-events-none select-none' : ''}`}>
            {deviceLockMode && (
              <div className="rounded-xl p-3.5 mb-4 border border-amber-500/25 bg-amber-500/8 text-xs text-foreground/70 flex items-center gap-2">
                <Shield size={14} className="text-amber-400 shrink-0" />
                Einstellungen sind durch den Geräte-Modus gesperrt.
              </div>
            )}

            {/* Top actions (reset + close) as in the reference mockup */}
            <div className="appr-top-actions" role="group" aria-label="Aktionen">
              <button type="button" onClick={() => setCurrentPageId('settings')} aria-label={t('common.reset')} title={t('common.reset')} className="appr-icon-btn">↻</button>
              <button type="button" onClick={() => setCurrentPageId('launcher')} aria-label={t('os.window.close')} title={t('os.window.close')} className="appr-icon-btn">×</button>
            </div>

            {/* Page header */}
            <header className="appr-page-header">
              <h1>{t('settings.appearance')}</h1>
              <p>{t('settings.tabAppearanceDesc')}</p>
            </header>

            {/* Design panel */}
            <section className="appr-panel" style={{ padding: '20px 22px 15px' }}>
              <h2>Design</h2>

              {/* Farbmodus */}
              <div className="appr-setting-row" style={{ marginTop: 16 }}>
                <div>
                  <h3>{t('settings.accentMode')}</h3>
                  <p>{t('settings.accentModeDesc')}</p>
                </div>
                <button type="button" className="appr-select-btn">
                  <span>Dunkel (Automatisch)</span><span aria-hidden="true">⌄</span>
                </button>
              </div>

              <div className="appr-divider" />

              {/* Akzentfarbe */}
              <div className="appr-setting-row appr-wallpaper-row">
                <div>
                  <h3>{t('settings.accentColor')}</h3>
                  <p>Wähle deine bevorzugte Akzentfarbe für Elemente und Highlights.</p>
                </div>
                <div className="appr-swatches" aria-label={t('settings.accentColor')}>
                  {accentColorSettings.extractedPalette.length > 0
                    ? accentColorSettings.extractedPalette.slice(0, 7).map((color, i) => (
                        <button
                          key={`${color}-${i}`}
                          type="button"
                          onClick={() => accentColorSettings.selectFromPalette(color)}
                          className={`appr-swatch ${accentColorSettings.accentColor === color ? 'active' : ''}`}
                          style={{ ['--sw' as string]: color }}
                          aria-label={color}
                        />
                      ))
                    : null}
                  <button type="button" className="appr-add-swatch" aria-label="Akzentfarbe hinzufügen">＋</button>
                </div>
              </div>

              <div className="appr-divider" />

              {/* Design-Modus */}
              <div className="appr-mode-section">
                <h3>{t('settings.themeMode')}</h3>
                <p>{t('settings.themeModeDesc')}</p>
                <div className="appr-mode-grid">
                  {[
                    { id: 'auto', label: 'Automatisch', sub: 'Passt sich dem System an', cls: 'preview-auto' },
                    { id: 'day-classic', label: 'Klassisch', sub: 'Zeitlos und schlicht', cls: 'preview-classic' },
                    { id: 'day', label: 'Modern', sub: 'Klare und weiche Akzente', cls: 'preview-modern' },
                    { id: 'night', label: 'Dunkel', sub: 'Tief und kontrastreich', cls: 'preview-dark' },
                    { id: 'sleep', label: 'OLED Schwarz', sub: 'Reines Schwarz', cls: 'preview-oled' },
                  ].map((mode) => {
                    const selected = selectedTheme === mode.id
                    return (
                      <button
                        key={mode.id}
                        type="button"
                        onClick={() => setSelectedTheme(mode.id)}
                        className={`appr-mode-card ${selected ? 'selected' : ''}`}
                      >
                        <span className={`appr-preview ${mode.cls}`} aria-hidden="true" />
                        <strong>{mode.label}</strong>
                        <small>{mode.sub}</small>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="appr-divider" />

              {/* Hintergrund */}
              <div className="appr-setting-row appr-wallpaper-row">
                <div>
                  <h3>{t('settings.hintergrund')}</h3>
                  <p>{t('settings.hintergrundDesc')}</p>
                </div>
                <div className="appr-wallpaper-actions">
                  <button type="button" className="appr-soft-btn" onClick={() => setCurrentPageId('settings')}>{t('settings.hintergrundAnpassen')}</button>
                  <div className="appr-wallpaper-thumb" aria-label={t('settings.hintergrund')} />
                </div>
              </div>
            </section>

            {/* Lower grid: Verhalten | Zeitplan + UI-Skalierung */}
            <div className="appr-lower-grid">
              <section className="appr-panel appr-pad appr-behavior-panel">
                <h2>{t('settings.verhalten')}</h2>

                <div className="appr-setting-row" style={{ marginTop: 16 }}>
                  <div>
                    <h3>{t('settings.transparenz')}</h3>
                    <p>Aktiviere Unschärfe und Transparenz für ein modernes Aussehen.</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={glassSettings.enabled}
                    onClick={() => glassSettings.setEnabled(!glassSettings.enabled)}
                    className={`appr-switch ${glassSettings.enabled ? 'on' : ''}`}
                    aria-label={t('settings.transparenz')}
                  />
                </div>

                <div className="appr-divider" />

                <div className="appr-setting-row">
                  <div>
                    <h3>{t('settings.animationen')}</h3>
                    <p>{t('settings.animationDesc')}</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!reduceMotion}
                    onClick={() => onToggleReduceMotion(!reduceMotion)}
                    className={`appr-switch ${!reduceMotion ? 'on' : ''}`}
                    aria-label={t('settings.animationen')}
                  />
                </div>
              </section>

              <div className="appr-right-stack">
                <section className="appr-panel appr-pad">
                  <div className="appr-setting-row">
                    <div>
                      <h2>{t('settings.zeitplan')}</h2>
                      <p style={{ marginTop: 4 }}>{t('settings.zeitplanDesc')}</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={nightModeSettings.scheduleEnabled}
                      onClick={() => nightModeSettings.setScheduleEnabled(!nightModeSettings.scheduleEnabled)}
                      className={`appr-switch ${nightModeSettings.scheduleEnabled ? 'on' : ''}`}
                      aria-label={t('settings.autoTheme')}
                    />
                  </div>

                  <div className="appr-schedule-controls">
                    <button type="button" className="appr-pill-btn">Tag (Hell)</button>
                    <button type="button" className="appr-pill-btn">06:00 <span aria-hidden="true">⌄</span></button>
                    <button type="button" className="appr-pill-btn">Nacht (Dunkel)</button>
                    <button type="button" className="appr-pill-btn">18:00 <span aria-hidden="true">⌄</span></button>
                  </div>

                  <p className="appr-hint">Das Design wechselt automatisch zur angegebenen Zeit.</p>
                </section>

                <section className="appr-panel appr-pad appr-scale-panel">
                  <h2>{t('settings.uiScale')}</h2>
                  <p>{t('settings.uiScaleDesc')}</p>
                  <div className="appr-scale-controls">
                    {([
                      { id: 'auto', label: 'Auto' },
                      { id: '100', label: '100% (Standard)' },
                      { id: '125', label: '125%' },
                      { id: '150', label: '150%' },
                    ] as const).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setUiScale(opt.id)}
                        className={`appr-scale-choice ${uiScalePreset === opt.id || (opt.id === 'auto' && uiScalePreset === 'auto') ? 'selected' : ''}`}
                      >
                        {opt.id === '100' && <span className="appr-dot" aria-hidden="true" />}
                        <span>{opt.label}</span>
                      </button>
                    ))}
                  </div>
                </section>
              </div>
            </div>

            {/* Advanced / additional appearance settings — kept as collapsible
                sections so every existing flow remains reachable. */}
            <div className="space-y-3.5 mt-4">
              <SettingsSection icon={Eye} title={t('settings.glassEffects')} description={t('settings.glassEffectsDesc')}>
                <ToggleRow
                  label={t("settings.glassEnable")}
                  description={t("settings.frostedGlassDesc")}
                  checked={glassSettings.enabled}
                  onCheckedChange={glassSettings.setEnabled}
                />
                {glassSettings.enabled && (
                  <div className="space-y-4 p-4 rounded-xl bg-foreground/[0.04] border border-foreground/8">
                    <SliderRow label={t("settings.glassBlur")} value={glassSettings.blurIntensity} min={0} max={60} unit="px" onChange={glassSettings.setBlurIntensity} />
                    <SliderRow label={t("settings.glassTransparency")} value={Math.round(glassSettings.transparency * 100)} min={50} max={150} unit="%" onChange={(v) => glassSettings.setTransparency(v / 100)} />
                    <SliderRow label={t("settings.glassCardRadius")} value={glassSettings.cardRadius} min={8} max={28} unit="px" onChange={glassSettings.setCardRadius} />
                    <SliderRow label={t("settings.glassBorderAlpha")} value={Math.round(glassSettings.borderAlpha * 100)} min={0} max={30} unit="%" onChange={(v) => glassSettings.setBorderAlpha(v / 100)} />
                  </div>
                )}
              </SettingsSection>

              <SettingsSection icon={Moon} title={t("settings.nightMode")} description={t("settings.nightModeDesc")}>
                <ToggleRow
                  label={t("settings.nightFilter")}
                  description={t("settings.nightFilterDesc")}
                  checked={nightModeSettings.nightFilterEnabled}
                  onCheckedChange={nightModeSettings.setNightFilterEnabled}
                />
                {nightModeSettings.nightFilterEnabled && (
                  <div className="space-y-4 p-4 rounded-xl bg-foreground/[0.04] border border-foreground/8">
                    <SliderRow label={t("settings.colorTemperature")} value={nightModeSettings.colorTemperature} min={1500} max={6500} unit=" K" onChange={nightModeSettings.setColorTemperature} />
                    <SliderRow label={t("settings.blueLightFilter")} value={nightModeSettings.blueLightReduction} min={0} max={100} unit="%" onChange={nightModeSettings.setBlueLightReduction} />
                    <SliderRow label={t("settings.nightOverlay")} value={nightModeSettings.overlayStrength} min={0} max={100} unit="%" onChange={nightModeSettings.setOverlayStrength} />
                    <ToggleRow label={t("settings.autoBrightness")} description={t("settings.brightnessAdjustDesc")} checked={nightModeSettings.autoBrightness} onCheckedChange={nightModeSettings.setAutoBrightness} />
                    <ToggleRow label={t("settings.nightApplyAlways")} description={t("settings.nightApplyAlwaysDesc")} checked={nightModeSettings.applyAlways} onCheckedChange={nightModeSettings.setApplyAlways} />
                    <ToggleRow label={t("settings.nightSchedule")} description={t("settings.nightScheduleDesc")} checked={nightModeSettings.scheduleEnabled} onCheckedChange={nightModeSettings.setScheduleEnabled} />
                  </div>
                )}
              </SettingsSection>

              <Suspense fallback={null}><AdditionalSettings /></Suspense>

              {authUser?.isAdmin && (
                <Suspense fallback={null}><FamilyProfilesSection /></Suspense>
              )}

              <Suspense fallback={null}><KeyboardShortcutsSection /></Suspense>

              <Suspense fallback={null}><DefaultAppsSection /></Suspense>

              <Suspense fallback={null}><MediaHubConfigSection /></Suspense>

              <Suspense fallback={null}><RemoteAccessSection /></Suspense>

              <SettingsSection icon={Globe} title="Sprache" description="Wähle deine bevorzugte Sprache für die gesamte Oberfläche" accentIcon>
                <LanguageSwitcher />
              </SettingsSection>

              <SettingsSection icon={PaintBrush} title={t('settings.accentIcons')} description={t('settings.accentIconsDesc')} accentIcon>
                <ToggleRow
                  label={t('settings.accentIcons')}
                  description={t('settings.accentIconsDesc')}
                  checked={accentIcons}
                  onCheckedChange={(value) => { setAccentIcons(value); applyAccentIcons(value) }}
                />
              </SettingsSection>

              <ThemeSettingsPanelWrapper />
            </div>
          </div>
        </TabsContent>


        {/* ─── TAB: Dashboard ──────────────────────────────────────── */}
        <TabsContent value="dashboard" className="space-y-5">
          {deviceLockMode && (
            <div className="rounded-xl p-3.5 border border-amber-500/25 bg-amber-500/8 text-xs text-foreground/70 flex items-center gap-2">
              <Shield size={14} className="text-amber-400 shrink-0" />
              Einstellungen sind durch den Geräte-Modus gesperrt.
            </div>
          )}
          <div className={deviceLockMode ? 'opacity-50 pointer-events-none select-none space-y-4' : 'space-y-4'}>

            {/* Background, Design Mode & Card Style */}
            <ConfigurationSettings settingsLocked={deviceLockMode} />

            {/* Page Designer */}
            <SettingsSection icon={Layout} title="Seiten-Designer" description="Dashboard-Seiten anpassen und organisieren" accentIcon>
              <button
                onClick={() => setShowPageDesigner(true)}
                className="rumahl-settings-tool-row w-full px-4 py-3.5 rounded-xl bg-accent/10 hover:bg-accent/18 text-accent transition-colors flex items-center justify-between group border border-accent/15"
              >
                <div className="flex items-center gap-3">
                  <Sparkle size={20} weight="fill" />
                  <div className="text-left">
                    <p className="font-medium text-sm">Seiten-Designer öffnen</p>
                    <p className="text-[11px] text-foreground/50">Widgets hinzufügen, Layout anpassen</p>
                  </div>
                </div>
                <Sparkle size={18} weight="fill" className="group-hover:rotate-12 transition-transform" />
              </button>

              <button
                onClick={() => setYamlEditorOpen(true)}
                className="rumahl-settings-tool-row w-full px-4 py-3.5 rounded-xl bg-foreground/[0.04] hover:bg-foreground/[0.08] text-foreground/70 transition-colors flex items-center justify-between group border border-foreground/10"
              >
                <div className="flex items-center gap-3">
                  <BracketsCurly size={20} weight="fill" />
                  <div className="text-left">
                    <p className="font-medium text-sm">Seite programmieren (YAML)</p>
                    <p className="text-[11px] text-foreground/50">Per Code definieren, importieren & exportieren</p>
                  </div>
                </div>
                <ArrowSquareOut size={18} className="group-hover:translate-x-0.5 transition-transform" />
              </button>
            </SettingsSection>

            {/* Dynamic Overview */}
            <OverviewConfiguration />

            {/* CSS Settings */}
            <SettingsSection icon={Code} title={t("settings.cssCustomization")} description={t("settings.cssCustomizationDesc")} accentIcon>
              <CssSettingsSection />
            </SettingsSection>

            {/* Light Enhancements */}
            <LightEnhancementsSettings settingsLocked={deviceLockMode} />
          </div>
        </TabsContent>

        {/* ─── TAB: System ─────────────────────────────────────────── */}
        <TabsContent value="system" className="space-y-5">
          {deviceLockMode && (
            <div className="rounded-xl p-3.5 border border-amber-500/25 bg-amber-500/8 text-xs text-foreground/70 flex items-center gap-2">
              <Shield size={14} className="text-amber-400 shrink-0" />
              Einstellungen sind durch den Geräte-Modus gesperrt.
            </div>
          )}
          <div className={`space-y-4 ${deviceLockMode ? 'opacity-50 pointer-events-none select-none' : ''}`}>

            {/* Backend System Stats */}
            <SettingsSection icon={Cpu} title={t("settings.backendUsage")} description={t("settings.backendUsageDesc")} accentIcon>
              {stats ? (
                <div className="space-y-3">
                  <div className="rumahl-settings-resource-grid grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* CPU */}
                    <div className="rumahl-settings-resource-row p-3.5 rounded-xl bg-foreground/[0.04] border border-foreground/8 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Cpu size={14} className="text-foreground/50" />
                          <p className="text-[11px] font-medium text-foreground/55 uppercase tracking-wider">CPU</p>
                        </div>
                        <p className="text-sm font-semibold text-foreground tabular-nums">{Math.round(stats.cpu.usage_percent)}%</p>
                      </div>
                      <ProgressBar value={stats.cpu.usage_percent} />
                      <p className="text-[10px] text-foreground/40">{stats.cpu.cores} Kerne</p>
                    </div>
                    {/* Memory */}
                    <div className="rumahl-settings-resource-row p-3.5 rounded-xl bg-foreground/[0.04] border border-foreground/8 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <HardDrives size={14} className="text-foreground/50" />
                          <p className="text-[11px] font-medium text-foreground/55 uppercase tracking-wider">RAM</p>
                        </div>
                        <p className="text-sm font-semibold text-foreground tabular-nums">{Math.round(stats.memory.usage_percent)}%</p>
                      </div>
                      <ProgressBar value={stats.memory.usage_percent} />
                      <p className="text-[10px] text-foreground/40">{formatBytes(stats.memory.used_bytes)} / {formatBytes(stats.memory.total_bytes)}</p>
                    </div>
                  </div>
                  <div className="rumahl-settings-facts grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="rumahl-settings-fact p-3 rounded-xl bg-foreground/[0.04] border border-foreground/8 text-center">
                      <p className="text-[10px] font-medium text-foreground/45 uppercase tracking-wider mb-1">Uptime</p>
                      <p className="text-xs font-semibold text-foreground">{formatUptime(stats.uptime_seconds)}</p>
                    </div>
                    <div className="rumahl-settings-fact p-3 rounded-xl bg-foreground/[0.04] border border-foreground/8 text-center">
                      <p className="text-[10px] font-medium text-foreground/45 uppercase tracking-wider mb-1">Version</p>
                      <p className="text-xs font-semibold text-foreground">v{stats.backend.version}</p>
                    </div>
                    <div className="rumahl-settings-fact p-3 rounded-xl bg-foreground/[0.04] border border-foreground/8 text-center">
                      <p className="text-[10px] font-medium text-foreground/45 uppercase tracking-wider mb-1">DB Größe</p>
                      <p className="text-xs font-semibold text-foreground">{formatBytes(stats.database.size_bytes)}</p>
                    </div>
                    <div className="rumahl-settings-fact p-3 rounded-xl bg-foreground/[0.04] border border-foreground/8 text-center">
                      <p className="text-[10px] font-medium text-foreground/45 uppercase tracking-wider mb-1">History</p>
                      <p className="text-xs font-semibold text-foreground">{stats.database.history_rows.toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="rumahl-settings-facts grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div className="rumahl-settings-fact p-3 rounded-xl bg-foreground/[0.04] border border-foreground/8 text-center">
                      <p className="text-[10px] font-medium text-foreground/45 uppercase tracking-wider mb-1">Clients</p>
                      <p className="text-xs font-semibold text-foreground">{stats.backend.connected_clients}</p>
                    </div>
                    <div className="rumahl-settings-fact p-3 rounded-xl bg-foreground/[0.04] border border-foreground/8 text-center">
                      <p className="text-[10px] font-medium text-foreground/45 uppercase tracking-wider mb-1">Cache Hits</p>
                      <p className="text-xs font-semibold text-foreground">{stats.backend.cache_metrics.cache_hits.toLocaleString()}</p>
                    </div>
                    <div className="rumahl-settings-fact p-3 rounded-xl bg-foreground/[0.04] border border-foreground/8 text-center">
                      <p className="text-[10px] font-medium text-foreground/45 uppercase tracking-wider mb-1">Updates</p>
                      <p className="text-xs font-semibold text-foreground">{stats.backend.cache_metrics.update_count.toLocaleString()}</p>
                    </div>
                  </div>
                  <button
                    onClick={refreshStats}
                    disabled={statsLoading}
                    className="rumahl-settings-inline-action flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-foreground/[0.04] hover:bg-foreground/8 border border-foreground/8 text-xs text-foreground/60 transition-colors"
                  >
                    <ArrowsClockwise size={14} className={statsLoading ? 'animate-spin' : ''} />
                    Aktualisieren
                  </button>
                </div>
              ) : (
                <div className="p-4 text-center text-xs text-foreground/40">
                  {statsLoading ? 'Lade Systemdaten...' : 'Systemdaten nicht verfügbar'}
                </div>
              )}
            </SettingsSection>

            {/* Home Assistant Info */}
            <SettingsSection icon={WifiHigh} title={t("settings.homeAssistant")} description={t("settings.homeAssistantDesc")} accentIcon>
              {haInfo ? (
                <div className="space-y-3">
                  <div className="rumahl-settings-facts grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="rumahl-settings-fact p-3 rounded-xl bg-foreground/[0.04] border border-foreground/8 text-center">
                      <p className="text-[10px] font-medium text-foreground/45 uppercase tracking-wider mb-1">Status</p>
                      <div className="flex items-center justify-center gap-1.5">
                        <div className={`w-2 h-2 rounded-full ${haInfo.ha_connected ? 'bg-emerald-400' : 'bg-red-400'}`} />
                        <p className="text-xs font-semibold text-foreground">{haInfo.ha_connected ? 'Verbunden' : 'Getrennt'}</p>
                      </div>
                    </div>
                    <div className="rumahl-settings-fact p-3 rounded-xl bg-foreground/[0.04] border border-foreground/8 text-center">
                      <p className="text-[10px] font-medium text-foreground/45 uppercase tracking-wider mb-1">WebSocket</p>
                      <div className="flex items-center justify-center gap-1.5">
                        <div className={`w-2 h-2 rounded-full ${haInfo.ha_ws_connected ? 'bg-emerald-400' : 'bg-red-400'}`} />
                        <p className="text-xs font-semibold text-foreground">{haInfo.ha_ws_connected ? 'Aktiv' : 'Inaktiv'}</p>
                      </div>
                    </div>
                    <div className="rumahl-settings-fact p-3 rounded-xl bg-foreground/[0.04] border border-foreground/8 text-center">
                      <p className="text-[10px] font-medium text-foreground/45 uppercase tracking-wider mb-1">Entitäten</p>
                      <p className="text-xs font-semibold text-foreground">{haInfo.entity_count}</p>
                    </div>
                    <div className="rumahl-settings-fact p-3 rounded-xl bg-foreground/[0.04] border border-foreground/8 text-center">
                      <p className="text-[10px] font-medium text-foreground/45 uppercase tracking-wider mb-1">History 24h</p>
                      <p className="text-xs font-semibold text-foreground">{haInfo.history_entries_24h.toLocaleString()}</p>
                    </div>
                  </div>
                  {haInfo.ha_version && (
                    <div className="rumahl-settings-info-row flex items-center gap-2 p-3 rounded-xl bg-foreground/[0.04] border border-foreground/8">
                      <Info size={14} className="text-foreground/50 shrink-0" />
                      <p className="text-xs text-foreground/60">Home Assistant Version: <span className="font-semibold text-foreground">{haInfo.ha_version}</span></p>
                    </div>
                  )}
                  {/* Domain Breakdown */}
                  {haInfo.domains.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[11px] font-medium text-foreground/55">Domänen-Übersicht</p>
                      <div className="rumahl-settings-domain-list grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto">
                        {haInfo.domains.slice(0, 15).map((d) => (
                          <div key={d.domain} className="rumahl-settings-domain-row flex items-center justify-between px-3 py-2 rounded-lg bg-foreground/[0.03] border border-foreground/6">
                            <span className="text-[11px] text-foreground/70 font-mono">{d.domain}</span>
                            <span className="text-[11px] font-semibold text-foreground tabular-nums">{d.count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-4 text-center text-xs text-foreground/40">
                  {statsLoading ? 'Lade HA-Daten...' : 'HA-Daten nicht verfügbar'}
                </div>
              )}
            </SettingsSection>

            {/* Screensaver */}
            <SettingsSection icon={Moon} title={t("settings.screensaver")} description={t("settings.screensaverDesc")}>
              <ToggleRow
                label={t("settings.screensaverEnable")}
                description={t("settings.screensaverTimeoutDesc")}
                checked={screensaverSettings.enabled}
                onCheckedChange={screensaverSettings.setEnabled}
              />
              {screensaverSettings.enabled && (
                <div className="p-4 rounded-xl bg-foreground/[0.04] border border-foreground/8">
                  <SliderRow
                    label="Inaktivitätsdauer"
                    value={screensaverSettings.timeout / 60000}
                    min={1}
                    max={30}
                    unit=" min"
                    onChange={(v) => screensaverSettings.setTimeout(v * 60000)}
                  />
                </div>
              )}

              {/* Screensaver Schedules */}
              <Suspense fallback={null}>
                <ScreensaverScheduleEditor
                  schedules={screensaverSettings.schedules}
                  setSchedules={screensaverSettings.setSchedules}
                />
              </Suspense>
            </SettingsSection>

            {/* NINA Warnungen */}
            <Suspense fallback={null}><NinaSettingsSection /></Suspense>

            {/* System Info */}
            <SettingsSection icon={Info} title={t("settings.about")} description={t("settings.aboutDesc")}>
              <div className="space-y-3">
                {/* Device specs — Windows About-style list */}
                <div className="overflow-hidden rounded-2xl border border-foreground/8 bg-foreground/[0.03] divide-y divide-foreground/6">
                  {[
                    { label: t("settings.deviceName"), value: osInfo?.hostname || '–' },
                    { label: t("settings.operatingSystem"), value: osInfo ? `${osInfo.os_name} ${osInfo.os_version}` : '–' },
                    { label: t("settings.kernel"), value: osInfo?.kernel_version || '–' },
                    { label: t("settings.processor"), value: stats ? `${stats.cpu.cores} ${t("settings.cores")} · ${Math.round(stats.cpu.usage_percent)}%` : '–' },
                    { label: t("settings.memory"), value: stats ? formatBytes(stats.memory.total_bytes) : '–' },
                    { label: t("settings.uptime"), value: stats ? formatUptime(stats.uptime_seconds) : '–' },
                    { label: t("settings.backendVersion"), value: stats?.backend?.version ? `v${stats.backend.version}` : '–' },
                  ].map((row) => (
                    <div key={row.label} className="flex items-center justify-between gap-4 px-4 py-2.5">
                      <span className="text-xs text-foreground/50">{row.label}</span>
                      <span className="min-w-0 truncate text-right text-xs font-medium text-foreground/90">{row.value}</span>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-3.5 rounded-xl bg-foreground/[0.04] border border-foreground/8">
                    <p className="text-[10px] font-medium text-foreground/45 uppercase tracking-wider mb-1">{t("settings.user")}</p>
                    <p className="text-sm font-medium text-foreground truncate">{userName}</p>
                  </div>
                  <div className="p-3.5 rounded-xl bg-foreground/[0.04] border border-foreground/8">
                    <p className="text-[10px] font-medium text-foreground/45 uppercase tracking-wider mb-1">{t("settings.theme")}</p>
                    <p className="text-sm font-medium text-foreground capitalize">{theme}</p>
                  </div>
                  <div className="p-3.5 rounded-xl bg-foreground/[0.04] border border-foreground/8">
                    <p className="text-[10px] font-medium text-foreground/45 uppercase tracking-wider mb-1">{t("settings.entities")}</p>
                    <p className="text-sm font-medium text-foreground">{(entities as unknown[]).length}</p>
                  </div>
                </div>
              </div>
            </SettingsSection>

            {/* Power: reboot & shutdown live here (hidden from the quick shell) */}
            {can('os.power') && (
              <SettingsSection icon={Power} title={t('settings.power')} description={t('settings.powerDesc')}>
                {powerAction ? (
                  <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-4">
                    <p className="text-xs font-semibold text-red-200">
                      {powerAction === 'reboot' ? t('os.shell.confirmReboot') : t('os.shell.confirmShutdown')}
                    </p>
                    <div className="mt-3 flex gap-2">
                      <button type="button" onClick={() => setPowerAction(null)} className="flex-1 rounded-xl bg-foreground/8 px-3 py-2.5 text-xs">{t('common.cancel')}</button>
                      <button type="button" disabled={powerPending} onClick={executePowerAction} className="flex-1 rounded-xl bg-red-500 px-3 py-2.5 text-xs font-semibold text-white disabled:opacity-50">{t('common.confirm')}</button>
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <button type="button" onClick={() => setPowerAction('reboot')} className="flex items-center gap-2.5 rounded-xl bg-foreground/[0.04] border border-foreground/8 px-4 py-3 text-left text-xs font-semibold text-foreground/75 transition-colors hover:bg-foreground/[0.08]">
                      <ArrowClockwise size={16} className="text-foreground/50" /> {t('os.shell.reboot')}
                    </button>
                    <button type="button" onClick={() => setPowerAction('shutdown')} className="flex items-center gap-2.5 rounded-xl bg-red-500/10 border border-red-500/15 px-4 py-3 text-left text-xs font-semibold text-red-300 transition-colors hover:bg-red-500/15">
                      <Power size={16} className="text-red-400" /> {t('os.shell.shutdown')}
                    </button>
                  </div>
                )}
              </SettingsSection>
            )}

            {/* rumahl Docs Link */}
            <SettingsSection icon={Info} title="rumahl Dokumentation" description="Anleitungen, Referenzen & Systemübersicht">
              <button
                onClick={() => {
                  window.history.pushState({}, '', '/docs')
                  window.dispatchEvent(new PopStateEvent('popstate'))
                }}
                className="w-full flex items-center gap-3 p-4 rounded-xl bg-foreground/[0.04] border border-foreground/8 hover:bg-foreground/[0.07] hover:border-accent/20 transition-all group text-left"
              >
                <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
                  <BookOpen size={20} weight="duotone" className="text-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">Dokumentation öffnen</p>
                  <p className="text-[10px] text-foreground/40 mt-0.5">rumahl Core · rumahl Home · rumahl Assist</p>
                </div>
                <ArrowSquareOut size={16} className="text-foreground/25 group-hover:text-accent/60 transition-colors shrink-0" />
              </button>
            </SettingsSection>
          </div>
        </TabsContent>

        {/* ─── TAB: Apps (Apple-style per-app settings) ─────────────── */}
        <TabsContent value="apps" className="space-y-5">
          <Suspense fallback={<div className="flex items-center justify-center py-14"><span className="h-7 w-7 animate-spin rounded-full border-2 border-foreground/20 border-t-accent" /></div>}>
            <SettingsAppsSection
              initialSelectedId={settingsAppId}
              onSelectApp={(appId) => changeTabWithApp(appId)}
            />
          </Suspense>
        </TabsContent>
        </div>

        {yamlEditorOpen && (
        <YamlPageEditor
          onClose={() => setYamlEditorOpen(false)}
          onSave={(yaml, page) => {
            console.log('YAML page saved:', page)
            toast.success(`Seite "${page.name}" gespeichert`)
            setYamlEditorOpen(false)
          }}
        />
        )}
      </OsAppFrame>
    </Tabs>
  )
}
