import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Switch } from '@/components/ui/switch'
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
  CaretDown,
  Eye,
  Lightbulb,
  Monitor,
  Info,
  Drop,
  Sun,
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
  SlidersHorizontal,
  SunDim,
  CloudSun,
  MoonStars,
  Warning,
  MapPin,
  MagnifyingGlass,
  X,
  Plus,
  Clock,
  CalendarBlank,
  BookOpen,
  ArrowSquareOut,
} from '@phosphor-icons/react'
import { ConfigurationSettings } from '@/components/ConfigurationSettings'
import { LightEnhancementsSettings } from '@/components/LightEnhancementsSettings'
import { OverviewConfiguration } from '@/components/OverviewConfiguration'
import { CssSettingsSection } from '@/components/CssSettings'
import { useLocalStorage } from '@/lib/storage'
import { useTheme } from '@/contexts/ThemeContext'
import type { ThemeMode } from '@/lib/types'
import { toast } from 'sonner'
import { Tip } from '@/components/ui/tip'

const API_BASE = import.meta.env.VITE_BACKEND_URL || ''

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
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [statsRes, haRes] = await Promise.all([
        authFetch(`/api/system/stats`),
        authFetch(`/api/system/ha-info`),
      ])
      if (statsRes.ok) setStats(await statsRes.json())
      if (haRes.ok) setHaInfo(await haRes.json())
    } catch {
      // silently fail
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    refresh()
    const interval = setInterval(refresh, 10000)
    return () => clearInterval(interval)
  }, [enabled, refresh])

  return { stats, haInfo, loading, refresh }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

// ─── Mini progress bar ───────────────────────────────────────────────
function ProgressBar({ value, max = 100, color = 'accent' }: { value: number; max?: number; color?: string }) {
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

// ─── Settings section wrapper with collapsible content ───────────────────
function SettingsSection({
  icon: Icon,
  title,
  description,
  children,
  defaultOpen = true,
  accentIcon = false,
}: {
  icon: React.ElementType
  title: string
  description?: string
  children: React.ReactNode
  defaultOpen?: boolean
  accentIcon?: boolean
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <div className="glass-card rounded-2xl theme-transition overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-3 p-5 text-left hover:bg-foreground/[0.02] transition-colors"
      >
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${accentIcon ? 'bg-accent/15' : 'bg-foreground/8'}`}>
          <Icon size={18} weight="fill" className={accentIcon ? 'text-accent' : 'text-foreground/60'} />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-foreground">{title}</h4>
          {description && <p className="text-xs text-foreground/50 mt-0.5 line-clamp-1">{description}</p>}
        </div>
        <CaretDown
          size={16}
          weight="bold"
          className={`text-foreground/40 transition-transform duration-200 shrink-0 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 space-y-3">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Styled slider row ────────────────────────────────────────────────
function SliderRow({
  label,
  value,
  min,
  max,
  unit,
  onChange,
  disabled,
}: {
  label: string
  value: number
  min: number
  max: number
  unit: string
  onChange: (v: number) => void
  disabled?: boolean
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-foreground/65">{label}</span>
        <span className="text-xs font-medium text-foreground tabular-nums">{value}{unit}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        className="w-full h-1.5 bg-foreground/10 rounded-full appearance-none cursor-pointer disabled:opacity-40 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:shadow-sm [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-accent [&::-moz-range-thumb]:border-0"
      />
    </div>
  )
}

// ─── Toggle row ───────────────────────────────────────────────────────
function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string
  description?: string
  checked: boolean
  onCheckedChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-foreground/[0.04] border border-foreground/8 px-4 py-3">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-foreground/85">{label}</p>
        {description && <p className="text-[11px] text-foreground/50 mt-0.5">{description}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  )
}

// ─── Theme Picker Section ──────────────────────────────────────────────
const THEME_OPTIONS: { value: ThemeMode | 'auto'; label: string; description: string; icon: React.ElementType; preview: string }[] = [
  { value: 'auto', label: 'Automatisch', description: 'Wechselt nach Tageszeit', icon: ArrowsClockwise, preview: 'linear-gradient(135deg, #e8eaf0 0%, #1a1d2e 100%)' },
  { value: 'light', label: 'Hell', description: 'Maximale Helligkeit', icon: Sun, preview: 'linear-gradient(135deg, #f5f5f7 0%, #e8eaf0 50%, #dde0e8 100%)' },
  { value: 'day', label: 'Tag', description: 'Helles Design', icon: CloudSun, preview: 'linear-gradient(135deg, #e0e4ec 0%, #c8cdd8 50%, #b8bfcc 100%)' },
  { value: 'day-classic', label: 'Klassisch', description: 'Dunkler Hintergrund', icon: Monitor, preview: 'linear-gradient(135deg, #2a2d3e 0%, #1a1d2e 50%, #0f1118 100%)' },
  { value: 'evening', label: 'Abend', description: 'Warme Töne', icon: SunDim, preview: 'linear-gradient(135deg, #2d2f4a 0%, #1e2040 50%, #15172e 100%)' },
  { value: 'night', label: 'Nacht', description: 'Dunkles Design', icon: MoonStars, preview: 'linear-gradient(135deg, #181c2e 0%, #0f1220 50%, #0a0d18 100%)' },
  { value: 'sleep', label: 'Schlaf', description: 'OLED Schwarz', icon: Moon, preview: 'linear-gradient(135deg, #050508 0%, #000000 100%)' },
]

function ThemePickerSection() {
  const { selectedTheme, setSelectedTheme, theme: activeTheme } = useTheme()

  return (
    <SettingsSection icon={Palette} title="Design-Modus" description="Farbschema pro Benutzer wählen" accentIcon>
      <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
        {THEME_OPTIONS.map(opt => {
          const Icon = opt.icon
          const isSelected = selectedTheme === opt.value
          return (
            <button
              key={opt.value}
              onClick={() => setSelectedTheme(opt.value)}
              className={`relative flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all text-center ${
                isSelected
                  ? 'border-accent bg-accent/10 shadow-sm'
                  : 'border-foreground/8 bg-foreground/[0.03] hover:border-foreground/18 hover:bg-foreground/[0.06]'
              }`}
            >
              <div
                className="w-10 h-10 rounded-lg border border-foreground/10 shadow-sm"
                style={{ background: opt.preview }}
              />
              <Icon size={16} weight="fill" className={isSelected ? 'text-accent' : 'text-foreground/50'} />
              <p className="text-[10px] font-medium leading-tight">{opt.label}</p>
              <p className="text-[8px] text-foreground/40 leading-tight hidden sm:block">{opt.description}</p>
            </button>
          )
        })}
      </div>
      <div className="flex items-center gap-2 text-[10px] text-foreground/40 mt-1">
        <Info size={12} className="shrink-0" />
        <span>Aktiv: <span className="font-medium text-foreground/60 capitalize">{activeTheme}</span> — Einstellung wird pro Benutzer gespeichert</span>
      </div>
    </SettingsSection>
  )
}

// ─── Login PIN Section ─────────────────────────────────────────────────
function LoginPinSection() {
  const [loginPin, setLoginPin] = useState('')
  const [loginPinConfirm, setLoginPinConfirm] = useState('')
  const [hasLoginPin, setHasLoginPin] = useState(false)
  const [saving, setSaving] = useState(false)

  // Check if user has a login PIN by fetching user list
  useEffect(() => {
    let mounted = true
    const token = localStorage.getItem('ha-auth-token')
    if (!token) return
    const parsed = (() => { try { return JSON.parse(token) } catch { return token } })() as string

    fetch(`${API_BASE}/api/auth/verify`, { headers: { Authorization: `Bearer ${parsed}` } })
      .then(res => res.ok ? res.json() : null)
      .then((currentUser: { id?: string } | null) => {
        if (!currentUser?.id) return
        return fetch(`${API_BASE}/api/auth/users`).then(r => r.ok ? r.json() : []).then((users: { id: string; has_pin: boolean }[]) => {
          const me = users.find(u => u.id === currentUser.id)
          if (mounted && me) setHasLoginPin(me.has_pin)
        })
      })
      .catch(() => {})

    return () => { mounted = false }
  }, [])

  const saveLoginPin = async () => {
    if (!/^\d{4,6}$/.test(loginPin)) {
      toast.error('Login-PIN muss 4–6 Ziffern enthalten')
      return
    }
    if (loginPin !== loginPinConfirm) {
      toast.error('PIN und Bestätigung stimmen nicht überein')
      return
    }
    const token = localStorage.getItem('ha-auth-token')
    if (!token) return
    const parsed = (() => { try { return JSON.parse(token) } catch { return token } })() as string

    setSaving(true)
    try {
      const res = await fetch(`${API_BASE}/api/auth/pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${parsed}` },
        body: JSON.stringify({ pin: loginPin }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Fehler' }))
        throw new Error(err.error || 'Fehler')
      }
      setHasLoginPin(true)
      setLoginPin('')
      setLoginPinConfirm('')
      toast.success('Login-PIN gespeichert')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'PIN konnte nicht gespeichert werden')
    } finally {
      setSaving(false)
    }
  }

  const removeLoginPin = async () => {
    const token = localStorage.getItem('ha-auth-token')
    if (!token) return
    const parsed = (() => { try { return JSON.parse(token) } catch { return token } })() as string

    setSaving(true)
    try {
      const res = await fetch(`${API_BASE}/api/auth/pin`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${parsed}` },
      })
      if (!res.ok) throw new Error('Fehler')
      setHasLoginPin(false)
      toast.success('Login-PIN entfernt')
    } catch {
      toast.error('PIN konnte nicht entfernt werden')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsSection icon={NumberCircleOne} title="Schnell-Anmeldung" description="PIN für schnelles Benutzerwechseln auf geteilten Geräten">
      {hasLoginPin && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-emerald-400">
            <CheckCircle size={14} weight="fill" />
            <span>Login-PIN ist aktiv</span>
          </div>
          <button
            onClick={removeLoginPin}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/15 text-red-400 text-xs font-medium transition-colors disabled:opacity-50"
          >
            <Trash size={13} />
            Entfernen
          </button>
        </div>
      )}
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] font-medium text-foreground/55 block mb-1.5">
            {hasLoginPin ? 'Neue Login-PIN (4–6 Ziffern)' : 'Login-PIN (4–6 Ziffern)'}
          </label>
          <input
            type="password"
            inputMode="numeric"
            value={loginPin}
            onChange={(e) => setLoginPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className="w-full px-3 py-2.5 rounded-xl bg-foreground/[0.04] border border-foreground/10 text-sm text-foreground focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all"
            placeholder="••••"
          />
        </div>
        <div>
          <label className="text-[11px] font-medium text-foreground/55 block mb-1.5">
            PIN bestätigen
          </label>
          <input
            type="password"
            inputMode="numeric"
            value={loginPinConfirm}
            onChange={(e) => setLoginPinConfirm(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className="w-full px-3 py-2.5 rounded-xl bg-foreground/[0.04] border border-foreground/10 text-sm text-foreground focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all"
            placeholder="••••"
          />
        </div>
      </div>
      <button
        onClick={saveLoginPin}
        disabled={saving}
        className="w-full px-4 py-2.5 rounded-xl bg-foreground/8 hover:bg-foreground/12 text-foreground text-sm font-medium transition-colors disabled:opacity-50"
      >
        {saving ? 'Wird gespeichert...' : 'Login-PIN speichern'}
      </button>
      <p className="text-[10px] text-foreground/40 leading-relaxed">
        Mit einer Login-PIN können Sie sich auf gemeinsam genutzten Geräten (z.B. Wandtablets) schnell per PIN-Eingabe anmelden,
        ohne jedes Mal Benutzername und Passwort einzugeben.
      </p>
    </SettingsSection>
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
  accentColorSettings: {
    accentColor: string
    extractedPalette: string[]
    mode: 'auto' | 'static'
    staticColor: string
    setMode: (m: 'auto' | 'static') => void
    setStaticColor: (c: string) => void
    selectFromPalette: (c: string) => void
  }
  // Glass
  glassSettings: {
    enabled: boolean
    setEnabled: (v: boolean) => void
    blurIntensity: number
    setBlurIntensity: (v: number) => void
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

const DAY_LABELS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

function ScreensaverScheduleEditor({
  schedules,
  setSchedules,
}: {
  schedules: import('@/components/Screensaver').ScreensaverSchedule[]
  setSchedules: (v: import('@/components/Screensaver').ScreensaverSchedule[]) => void
}) {
  const addSchedule = () => {
    setSchedules([
      ...schedules,
      {
        id: crypto.randomUUID(),
        days: [1, 2, 3, 4, 5], // Mon-Fri
        startTime: '22:00',
        endTime: '06:00',
        timeout: 300000, // 5 min
        enabled: true,
      },
    ])
  }

  const updateSchedule = (id: string, patch: Partial<import('@/components/Screensaver').ScreensaverSchedule>) => {
    setSchedules(schedules.map(s => s.id === id ? { ...s, ...patch } : s))
  }

  const removeSchedule = (id: string) => {
    setSchedules(schedules.filter(s => s.id !== id))
  }

  const toggleDay = (scheduleId: string, day: number) => {
    const sched = schedules.find(s => s.id === scheduleId)
    if (!sched) return
    const days = sched.days.includes(day)
      ? sched.days.filter(d => d !== day)
      : [...sched.days, day].sort()
    updateSchedule(scheduleId, { days })
  }

  return (
    <div className="space-y-3 pt-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarBlank size={16} weight="duotone" className="text-foreground/50" />
          <span className="text-xs font-medium text-foreground/70">Zeitpläne</span>
          <span className="text-[10px] text-foreground/40">(optional)</span>
        </div>
        <button
          onClick={addSchedule}
          className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg bg-accent/15 text-accent border border-accent/20 hover:bg-accent/25 transition-colors font-medium"
        >
          <Plus size={12} weight="bold" />
          Zeitplan
        </button>
      </div>

      {schedules.length === 0 && (
        <p className="text-[11px] text-foreground/35 pl-0.5">
          Ohne Zeitpläne gelten die globalen Einstellungen oben.
        </p>
      )}

      {schedules.map((sched) => (
        <div key={sched.id} className="p-4 rounded-xl bg-foreground/[0.04] border border-foreground/8 space-y-3">
          {/* Header row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Switch checked={sched.enabled} onCheckedChange={(v) => updateSchedule(sched.id, { enabled: v })} />
              <span className="text-xs font-medium text-foreground/70">
                {sched.enabled ? 'Aktiv' : 'Inaktiv'}
              </span>
            </div>
            <button
              onClick={() => removeSchedule(sched.id)}
              className="p-1.5 rounded-lg hover:bg-red-500/10 text-foreground/30 hover:text-red-400 transition-colors"
            >
              <Trash size={14} />
            </button>
          </div>

          {/* Day selector */}
          <div className="space-y-1.5">
            <label className="text-[11px] text-foreground/50 font-medium">Tage</label>
            <div className="flex gap-1">
              {DAY_LABELS.map((label, idx) => (
                <button
                  key={idx}
                  onClick={() => toggleDay(sched.id, idx)}
                  className={`w-9 h-8 text-[11px] rounded-lg font-medium transition-all ${
                    sched.days.includes(idx)
                      ? 'bg-accent/20 text-accent border border-accent/30'
                      : 'bg-white/5 text-foreground/40 border border-white/10 hover:bg-white/10'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Time range */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[11px] text-foreground/50 font-medium flex items-center gap-1">
                <Clock size={12} /> Von
              </label>
              <input
                type="time"
                value={sched.startTime}
                onChange={(e) => updateSchedule(sched.id, { startTime: e.target.value })}
                className="w-full text-xs px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-foreground/90 focus:outline-none focus:border-accent/40"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] text-foreground/50 font-medium flex items-center gap-1">
                <Clock size={12} /> Bis
              </label>
              <input
                type="time"
                value={sched.endTime}
                onChange={(e) => updateSchedule(sched.id, { endTime: e.target.value })}
                className="w-full text-xs px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-foreground/90 focus:outline-none focus:border-accent/40"
              />
            </div>
          </div>

          {/* Timeout */}
          <div className="space-y-1.5">
            <label className="text-[11px] text-foreground/50 font-medium">
              Inaktivitätsdauer: {Math.round(sched.timeout / 60000)} min
            </label>
            <input
              type="range"
              min={1}
              max={30}
              value={Math.round(sched.timeout / 60000)}
              onChange={(e) => updateSchedule(sched.id, { timeout: Number(e.target.value) * 60000 })}
              className="w-full accent-[var(--accent)]"
            />
          </div>
        </div>
      ))}
    </div>
  )
}

export function SettingsPage(props: SettingsPageProps) {
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

  const [settingsTab, setSettingsTab] = useState<'general' | 'appearance' | 'dashboard' | 'system'>('general')
  const { stats, haInfo, loading: statsLoading, refresh: refreshStats } = useSystemStats(settingsTab === 'system')

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xl font-semibold text-foreground px-1">Einstellungen</h3>
        <div className="flex items-center gap-2 text-[11px] text-foreground/50">
          <span className="px-2.5 py-1 rounded-lg bg-foreground/5">{userName}</span>
          <span className="px-2.5 py-1 rounded-lg bg-foreground/5 capitalize">{theme}</span>
        </div>
      </div>

      <Tabs value={settingsTab} onValueChange={(v) => setSettingsTab(v as typeof settingsTab)}>
        <TabsList className="grid grid-cols-4 w-full rounded-xl bg-foreground/5 p-1 h-auto">
          <TabsTrigger value="general" className="gap-1.5 rounded-lg text-[11px] sm:text-xs px-1.5 sm:px-3 py-2.5 data-[state=active]:bg-accent/15 data-[state=active]:text-accent transition-all">
            <User size={15} weight="fill" />
            <span className="hidden sm:inline">Allgemein</span>
            <span className="sm:hidden">Profil</span>
          </TabsTrigger>
          <TabsTrigger value="appearance" className="gap-1.5 rounded-lg text-[11px] sm:text-xs px-1.5 sm:px-3 py-2.5 data-[state=active]:bg-accent/15 data-[state=active]:text-accent transition-all">
            <Palette size={15} weight="fill" />
            <span>Darstellung</span>
          </TabsTrigger>
          <TabsTrigger value="dashboard" className="gap-1.5 rounded-lg text-[11px] sm:text-xs px-1.5 sm:px-3 py-2.5 data-[state=active]:bg-accent/15 data-[state=active]:text-accent transition-all">
            <Layout size={15} weight="fill" />
            <span>Dashboard</span>
          </TabsTrigger>
          <TabsTrigger value="system" className="gap-1.5 rounded-lg text-[11px] sm:text-xs px-1.5 sm:px-3 py-2.5 data-[state=active]:bg-accent/15 data-[state=active]:text-accent transition-all">
            <GearSix size={15} weight="fill" />
            <span>System</span>
          </TabsTrigger>
        </TabsList>

        {/* ─── TAB: Allgemein ──────────────────────────────────────── */}
        <TabsContent value="general" className="space-y-4 mt-5">

          {/* Profile */}
          <SettingsSection icon={User} title="Benutzerprofil" description="Name und Anmeldedaten verwalten" accentIcon>
            <div className="flex items-center gap-4 p-4 rounded-xl bg-foreground/[0.04] border border-foreground/8">
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

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-medium text-foreground/55 block mb-1.5">Benutzername</label>
                <input
                  type="text"
                  value={profileUsername}
                  onChange={(e) => setProfileUsername(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-foreground/[0.04] border border-foreground/10 text-sm text-foreground focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all"
                  disabled={isSavingProfile}
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-foreground/55 block mb-1.5">Anzeigename</label>
                <input
                  type="text"
                  value={profileDisplayName}
                  onChange={(e) => setProfileDisplayName(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-foreground/[0.04] border border-foreground/10 text-sm text-foreground focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all"
                  disabled={isSavingProfile}
                />
              </div>
            </div>
            <button
              onClick={saveUserProfile}
              disabled={isSavingProfile}
              className="w-full px-4 py-2.5 rounded-xl bg-accent text-accent-foreground text-sm font-medium transition-colors hover:bg-accent/90 disabled:opacity-60"
            >
              {isSavingProfile ? 'Wird gespeichert...' : 'Profil speichern'}
            </button>
          </SettingsSection>

          {/* Security */}
          <SettingsSection icon={Shield} title="Sicherheit" description="PIN-Schutz und Gerätesperre">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-medium text-foreground/55 block mb-1.5">
                  Neue PIN (4–8 Ziffern)
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  value={pinCode}
                  onChange={(e) => setPinCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
                  className="w-full px-3 py-2.5 rounded-xl bg-foreground/[0.04] border border-foreground/10 text-sm text-foreground focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all"
                  placeholder="••••"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-foreground/55 block mb-1.5">
                  PIN bestätigen
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  value={pinConfirm}
                  onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, '').slice(0, 8))}
                  className="w-full px-3 py-2.5 rounded-xl bg-foreground/[0.04] border border-foreground/10 text-sm text-foreground focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all"
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
              className="w-full px-4 py-2.5 rounded-xl bg-foreground/8 hover:bg-foreground/12 text-foreground text-sm font-medium transition-colors"
            >
              PIN speichern
            </button>

            <div className="border-t border-foreground/8 pt-3">
              <ToggleRow
                label="Geräte-Modus"
                description="Sperrt Einstellungen auf diesem Gerät – PIN zum Entsperren"
                checked={deviceLockMode}
                onCheckedChange={updateDeviceLockMode}
                disabled={lockLoading}
              />
            </div>
          </SettingsSection>

          {/* Quick Login PIN */}
          <LoginPinSection />

          {/* Logout */}
          <button
            onClick={logout}
            className="w-full flex items-center justify-center gap-2.5 px-4 py-3.5 rounded-2xl bg-red-500/8 hover:bg-red-500/15 text-red-400 border border-red-500/15 transition-colors"
          >
            <SignOut size={18} weight="bold" />
            <span className="text-sm font-medium">Abmelden</span>
          </button>
        </TabsContent>

        {/* ─── TAB: Darstellung ────────────────────────────────────── */}
        <TabsContent value="appearance" className="space-y-4 mt-5">
          {deviceLockMode && (
            <div className="rounded-xl p-3.5 border border-amber-500/25 bg-amber-500/8 text-xs text-foreground/70 flex items-center gap-2">
              <Shield size={14} className="text-amber-400 shrink-0" />
              Einstellungen sind durch den Geräte-Modus gesperrt.
            </div>
          )}
          <div className={deviceLockMode ? 'opacity-50 pointer-events-none select-none space-y-4' : 'space-y-4'}>

            {/* Theme Mode */}
            <ThemePickerSection />

            {/* Accent Color */}
            <SettingsSection icon={Drop} title="Akzentfarbe" description="Automatisch aus Hintergrund oder manuell festlegen" accentIcon>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => accentColorSettings.setMode('auto')}
                  className={`p-3.5 rounded-xl border-2 transition-all text-center ${
                    accentColorSettings.mode === 'auto'
                      ? 'border-accent bg-accent/10'
                      : 'border-foreground/10 bg-foreground/[0.04] hover:border-foreground/20'
                  }`}
                >
                  <Sparkle size={22} weight="fill" className={`mx-auto mb-1.5 ${accentColorSettings.mode === 'auto' ? 'text-accent' : 'text-foreground/50'}`} />
                  <p className="text-xs font-medium">Automatisch</p>
                  <p className="text-[10px] text-foreground/40 mt-0.5">Aus dem Hintergrund</p>
                </button>
                <button
                  onClick={() => accentColorSettings.setMode('static')}
                  className={`p-3.5 rounded-xl border-2 transition-all text-center ${
                    accentColorSettings.mode === 'static'
                      ? 'border-accent bg-accent/10'
                      : 'border-foreground/10 bg-foreground/[0.04] hover:border-foreground/20'
                  }`}
                >
                  <PaintBucket size={22} weight="fill" className={`mx-auto mb-1.5 ${accentColorSettings.mode === 'static' ? 'text-accent' : 'text-foreground/50'}`} />
                  <p className="text-xs font-medium">Eigene Farbe</p>
                  <p className="text-[10px] text-foreground/40 mt-0.5">Manuell wählen</p>
                </button>
              </div>

              {/* Current accent preview */}
              <div className="flex items-center gap-3 p-3 rounded-xl bg-foreground/[0.04] border border-foreground/8">
                <div className="w-9 h-9 rounded-lg border-2 border-foreground/10 shrink-0" style={{ backgroundColor: accentColorSettings.accentColor }} />
                <div>
                  <p className="text-[11px] text-foreground/50">Aktuelle Akzentfarbe</p>
                  <p className="text-xs font-mono font-medium text-foreground">{accentColorSettings.accentColor}</p>
                </div>
              </div>

              {/* Extracted palette */}
              {accentColorSettings.extractedPalette.length > 0 && (
                <div>
                  <p className="text-[11px] text-foreground/50 mb-2">Extrahierte Farbpalette</p>
                  <div className="flex flex-wrap gap-2">
                    {accentColorSettings.extractedPalette.map((color, i) => (
                      <Tip content={color} key={`${color}-${i}`}>
                        <button
                          onClick={() => accentColorSettings.selectFromPalette(color)}
                          className={`w-9 h-9 rounded-xl transition-all border-2 ${
                            accentColorSettings.accentColor === color
                              ? 'border-white scale-110 shadow-lg ring-2 ring-accent/40'
                              : 'border-foreground/10 hover:scale-105 hover:border-foreground/25'
                          }`}
                          style={{ backgroundColor: color }}
                        />
                      </Tip>
                    ))}
                  </div>
                </div>
              )}

              {/* Static color picker */}
              {accentColorSettings.mode === 'static' && (
                <div className="flex items-center gap-4 p-3 rounded-xl bg-foreground/[0.04] border border-foreground/8">
                  <input
                    type="color"
                    value={accentColorSettings.staticColor}
                    onChange={(e) => accentColorSettings.setStaticColor(e.target.value)}
                    className="w-14 h-14 rounded-lg cursor-pointer border-2 border-foreground/10"
                  />
                  <div>
                    <p className="text-xs font-medium text-foreground">Eigene Farbe wählen</p>
                    <p className="text-xs font-mono text-foreground/60 mt-0.5">{accentColorSettings.staticColor}</p>
                  </div>
                </div>
              )}
            </SettingsSection>

            {/* Glass Effect */}
            <SettingsSection icon={Eye} title="Glaseffekt" description="Transparenz, Unschärfe und Kartenradius">
              <ToggleRow
                label="Glaseffekt aktivieren"
                description="Frosted-Glass-Optik für Karten und Menüs"
                checked={glassSettings.enabled}
                onCheckedChange={glassSettings.setEnabled}
              />
              {glassSettings.enabled && (
                <div className="space-y-4 p-4 rounded-xl bg-foreground/[0.04] border border-foreground/8">
                  <SliderRow
                    label="Unschärfe"
                    value={glassSettings.blurIntensity}
                    min={0}
                    max={60}
                    unit="px"
                    onChange={glassSettings.setBlurIntensity}
                  />
                  <SliderRow
                    label="Kartenradius"
                    value={glassSettings.cardRadius}
                    min={8}
                    max={28}
                    unit="px"
                    onChange={glassSettings.setCardRadius}
                  />
                  <SliderRow
                    label="Rahmen-Sichtbarkeit"
                    value={Math.round(glassSettings.borderAlpha * 100)}
                    min={0}
                    max={30}
                    unit="%"
                    onChange={(v) => glassSettings.setBorderAlpha(v / 100)}
                  />
                </div>
              )}
            </SettingsSection>

            {/* Night Mode */}
            <SettingsSection icon={Moon} title="Nachtmodus" description="Blaulichtfilter und Abdunkelung">
              <ToggleRow
                label="Nachtfilter"
                description="Sepia- und Abdunkelungseffekt bei Nacht-/Schlafmodus"
                checked={nightModeSettings.nightFilterEnabled}
                onCheckedChange={nightModeSettings.setNightFilterEnabled}
              />
              {nightModeSettings.nightFilterEnabled && (
                <div className="space-y-4 p-4 rounded-xl bg-foreground/[0.04] border border-foreground/8">
                  <SliderRow
                    label="Blaulichtfilter"
                    value={nightModeSettings.blueLightReduction}
                    min={0}
                    max={100}
                    unit="%"
                    onChange={nightModeSettings.setBlueLightReduction}
                  />
                  <ToggleRow
                    label="Auto-Helligkeit"
                    description="Helligkeit an Blaulichtfilter anpassen"
                    checked={nightModeSettings.autoBrightness}
                    onCheckedChange={nightModeSettings.setAutoBrightness}
                  />
                  <SliderRow
                    label="Nacht-Overlay"
                    value={nightModeSettings.overlayStrength}
                    min={0}
                    max={100}
                    unit="%"
                    onChange={nightModeSettings.setOverlayStrength}
                  />
                </div>
              )}
            </SettingsSection>

            {/* Haptic Feedback, Navigation, Typography, Animations */}
            <AdditionalSettings />
          </div>
        </TabsContent>

        {/* ─── TAB: Dashboard ──────────────────────────────────────── */}
        <TabsContent value="dashboard" className="space-y-4 mt-5">
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
                className="w-full px-4 py-3.5 rounded-xl bg-accent/10 hover:bg-accent/18 text-accent transition-colors flex items-center justify-between group border border-accent/15"
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
            </SettingsSection>

            {/* Dynamic Overview */}
            <OverviewConfiguration />

            {/* CSS Settings */}
            <SettingsSection icon={Code} title="CSS Anpassung" description="Globales und Benutzer-CSS bearbeiten, CSS-Referenz" accentIcon>
              <CssSettingsSection />
            </SettingsSection>

            {/* Light Enhancements */}
            <LightEnhancementsSettings settingsLocked={deviceLockMode} />
          </div>
        </TabsContent>

        {/* ─── TAB: System ─────────────────────────────────────────── */}
        <TabsContent value="system" className="space-y-4 mt-5">
          {deviceLockMode && (
            <div className="rounded-xl p-3.5 border border-amber-500/25 bg-amber-500/8 text-xs text-foreground/70 flex items-center gap-2">
              <Shield size={14} className="text-amber-400 shrink-0" />
              Einstellungen sind durch den Geräte-Modus gesperrt.
            </div>
          )}
          <div className={`space-y-4 ${deviceLockMode ? 'opacity-50 pointer-events-none select-none' : ''}`}>

            {/* Backend System Stats */}
            <SettingsSection icon={Cpu} title="Backend-Auslastung" description="CPU, Arbeitsspeicher und Datenbank" accentIcon>
              {stats ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* CPU */}
                    <div className="p-3.5 rounded-xl bg-foreground/[0.04] border border-foreground/8 space-y-2">
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
                    <div className="p-3.5 rounded-xl bg-foreground/[0.04] border border-foreground/8 space-y-2">
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
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-3 rounded-xl bg-foreground/[0.04] border border-foreground/8 text-center">
                      <p className="text-[10px] font-medium text-foreground/45 uppercase tracking-wider mb-1">Uptime</p>
                      <p className="text-xs font-semibold text-foreground">{formatUptime(stats.uptime_seconds)}</p>
                    </div>
                    <div className="p-3 rounded-xl bg-foreground/[0.04] border border-foreground/8 text-center">
                      <p className="text-[10px] font-medium text-foreground/45 uppercase tracking-wider mb-1">Version</p>
                      <p className="text-xs font-semibold text-foreground">v{stats.backend.version}</p>
                    </div>
                    <div className="p-3 rounded-xl bg-foreground/[0.04] border border-foreground/8 text-center">
                      <p className="text-[10px] font-medium text-foreground/45 uppercase tracking-wider mb-1">DB Größe</p>
                      <p className="text-xs font-semibold text-foreground">{formatBytes(stats.database.size_bytes)}</p>
                    </div>
                    <div className="p-3 rounded-xl bg-foreground/[0.04] border border-foreground/8 text-center">
                      <p className="text-[10px] font-medium text-foreground/45 uppercase tracking-wider mb-1">History</p>
                      <p className="text-xs font-semibold text-foreground">{stats.database.history_rows.toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div className="p-3 rounded-xl bg-foreground/[0.04] border border-foreground/8 text-center">
                      <p className="text-[10px] font-medium text-foreground/45 uppercase tracking-wider mb-1">Clients</p>
                      <p className="text-xs font-semibold text-foreground">{stats.backend.connected_clients}</p>
                    </div>
                    <div className="p-3 rounded-xl bg-foreground/[0.04] border border-foreground/8 text-center">
                      <p className="text-[10px] font-medium text-foreground/45 uppercase tracking-wider mb-1">Cache Hits</p>
                      <p className="text-xs font-semibold text-foreground">{stats.backend.cache_metrics.cache_hits.toLocaleString()}</p>
                    </div>
                    <div className="p-3 rounded-xl bg-foreground/[0.04] border border-foreground/8 text-center">
                      <p className="text-[10px] font-medium text-foreground/45 uppercase tracking-wider mb-1">Updates</p>
                      <p className="text-xs font-semibold text-foreground">{stats.backend.cache_metrics.update_count.toLocaleString()}</p>
                    </div>
                  </div>
                  <button
                    onClick={refreshStats}
                    disabled={statsLoading}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-foreground/[0.04] hover:bg-foreground/8 border border-foreground/8 text-xs text-foreground/60 transition-colors"
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
            <SettingsSection icon={WifiHigh} title="Home Assistant" description="Verbindung, Entitäten und Domänen" accentIcon>
              {haInfo ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-3 rounded-xl bg-foreground/[0.04] border border-foreground/8 text-center">
                      <p className="text-[10px] font-medium text-foreground/45 uppercase tracking-wider mb-1">Status</p>
                      <div className="flex items-center justify-center gap-1.5">
                        <div className={`w-2 h-2 rounded-full ${haInfo.ha_connected ? 'bg-emerald-400' : 'bg-red-400'}`} />
                        <p className="text-xs font-semibold text-foreground">{haInfo.ha_connected ? 'Verbunden' : 'Getrennt'}</p>
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-foreground/[0.04] border border-foreground/8 text-center">
                      <p className="text-[10px] font-medium text-foreground/45 uppercase tracking-wider mb-1">WebSocket</p>
                      <div className="flex items-center justify-center gap-1.5">
                        <div className={`w-2 h-2 rounded-full ${haInfo.ha_ws_connected ? 'bg-emerald-400' : 'bg-red-400'}`} />
                        <p className="text-xs font-semibold text-foreground">{haInfo.ha_ws_connected ? 'Aktiv' : 'Inaktiv'}</p>
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-foreground/[0.04] border border-foreground/8 text-center">
                      <p className="text-[10px] font-medium text-foreground/45 uppercase tracking-wider mb-1">Entitäten</p>
                      <p className="text-xs font-semibold text-foreground">{haInfo.entity_count}</p>
                    </div>
                    <div className="p-3 rounded-xl bg-foreground/[0.04] border border-foreground/8 text-center">
                      <p className="text-[10px] font-medium text-foreground/45 uppercase tracking-wider mb-1">History 24h</p>
                      <p className="text-xs font-semibold text-foreground">{haInfo.history_entries_24h.toLocaleString()}</p>
                    </div>
                  </div>
                  {haInfo.ha_version && (
                    <div className="flex items-center gap-2 p-3 rounded-xl bg-foreground/[0.04] border border-foreground/8">
                      <Info size={14} className="text-foreground/50 shrink-0" />
                      <p className="text-xs text-foreground/60">Home Assistant Version: <span className="font-semibold text-foreground">{haInfo.ha_version}</span></p>
                    </div>
                  )}
                  {/* Domain Breakdown */}
                  {haInfo.domains.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[11px] font-medium text-foreground/55">Domänen-Übersicht</p>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto">
                        {haInfo.domains.slice(0, 15).map((d) => (
                          <div key={d.domain} className="flex items-center justify-between px-3 py-2 rounded-lg bg-foreground/[0.03] border border-foreground/6">
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
            <SettingsSection icon={Moon} title="Bildschirmschoner" description="Uhr-Anzeige bei Inaktivität">
              <ToggleRow
                label="Bildschirmschoner aktivieren"
                description="Zeigt eine Uhr nach einer Zeit ohne Eingabe"
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
              <ScreensaverScheduleEditor
                schedules={screensaverSettings.schedules}
                setSchedules={screensaverSettings.setSchedules}
              />
            </SettingsSection>

            {/* NINA Warnungen */}
            <NinaSettingsSection />

            {/* System Info */}
            <SettingsSection icon={Info} title="System-Information" description="Gerät, Theme und Status" defaultOpen={false}>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3.5 rounded-xl bg-foreground/[0.04] border border-foreground/8">
                  <p className="text-[10px] font-medium text-foreground/45 uppercase tracking-wider mb-1">Benutzer</p>
                  <p className="text-sm font-medium text-foreground truncate">{userName}</p>
                </div>
                <div className="p-3.5 rounded-xl bg-foreground/[0.04] border border-foreground/8">
                  <p className="text-[10px] font-medium text-foreground/45 uppercase tracking-wider mb-1">Theme</p>
                  <p className="text-sm font-medium text-foreground capitalize">{theme}</p>
                </div>
                <div className="p-3.5 rounded-xl bg-foreground/[0.04] border border-foreground/8">
                  <p className="text-[10px] font-medium text-foreground/45 uppercase tracking-wider mb-1">Entitäten</p>
                  <p className="text-sm font-medium text-foreground">{(entities as unknown[]).length}</p>
                </div>
              </div>
            </SettingsSection>

            {/* IORA Docs Link */}
            <SettingsSection icon={Info} title="IORA Dokumentation" description="Anleitungen, Referenzen & Systemübersicht">
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
                  <p className="text-[10px] text-foreground/40 mt-0.5">IORA Core · IORA Home · IORA Assist</p>
                </div>
                <ArrowSquareOut size={16} className="text-foreground/25 group-hover:text-accent/60 transition-colors shrink-0" />
              </button>
            </SettingsSection>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ─── Additional Settings Component ─────────────────────────────────
function AdditionalSettings() {
  const [hapticEnabled, setHapticEnabled] = useLocalStorage('ha-haptic-feedback', true)
  const [navLabels, setNavLabels] = useLocalStorage('ha-nav-labels', true)
  const [navStyle, setNavStyle] = useLocalStorage<'pill' | 'classic' | 'minimal'>('ha-nav-style', 'pill')
  const [reducedAnimations, setReducedAnimations] = useLocalStorage('ha-animations-reduced', false)
  const [fontSize, setFontSize] = useLocalStorage<'small' | 'normal' | 'large'>('ha-font-size', 'normal')
  const [compactWidgets, setCompactWidgets] = useLocalStorage('ha-widget-compact', false)

  return (
    <>
      {/* Haptic & Interactions */}
      <SettingsSection icon={Vibrate} title="Haptik & Interaktion" description="Vibrationsrückmeldung und Touch-Feedback">
        <ToggleRow
          label="Haptisches Feedback"
          description="Vibrationsrückmeldung bei Interaktionen (Touch-Geräte)"
          checked={hapticEnabled}
          onCheckedChange={setHapticEnabled}
        />
        <ToggleRow
          label="Animationen reduzieren"
          description="Weniger Animationen und Übergänge für bessere Performance"
          checked={reducedAnimations}
          onCheckedChange={setReducedAnimations}
        />
      </SettingsSection>

      {/* Navigation */}
      <SettingsSection icon={NavigationArrow} title="Navigation" description="Darstellung der Navigationsleiste anpassen">
        <ToggleRow
          label="Beschriftungen anzeigen"
          description="Text-Labels unter den Navigations-Icons"
          checked={navLabels}
          onCheckedChange={setNavLabels}
        />
        <div className="space-y-2">
          <p className="text-[11px] font-medium text-foreground/55">Navigations-Stil</p>
          <div className="grid grid-cols-3 gap-2">
            {([
              { id: 'pill' as const, label: 'Pill', desc: 'Abgerundet' },
              { id: 'classic' as const, label: 'Klassisch', desc: 'Eckig' },
              { id: 'minimal' as const, label: 'Minimal', desc: 'Nur Icons' },
            ]).map(opt => (
              <button
                key={opt.id}
                onClick={() => setNavStyle(opt.id)}
                className={`p-2.5 rounded-xl border-2 transition-all text-center ${
                  navStyle === opt.id
                    ? 'border-accent bg-accent/10'
                    : 'border-foreground/10 bg-foreground/[0.04] hover:border-foreground/20'
                }`}
              >
                <p className="text-xs font-medium">{opt.label}</p>
                <p className="text-[10px] text-foreground/40">{opt.desc}</p>
              </button>
            ))}
          </div>
        </div>
      </SettingsSection>

      {/* Typography & Display */}
      <SettingsSection icon={TextAa} title="Anzeige & Schrift" description="Schriftgröße und Widget-Darstellung">
        <div className="space-y-2">
          <p className="text-[11px] font-medium text-foreground/55">Schriftgröße</p>
          <div className="grid grid-cols-3 gap-2">
            {([
              { id: 'small' as const, label: 'Klein', sample: 'Aa', size: 'text-xs' },
              { id: 'normal' as const, label: 'Normal', sample: 'Aa', size: 'text-sm' },
              { id: 'large' as const, label: 'Groß', sample: 'Aa', size: 'text-base' },
            ]).map(opt => (
              <button
                key={opt.id}
                onClick={() => setFontSize(opt.id)}
                className={`p-3 rounded-xl border-2 transition-all text-center ${
                  fontSize === opt.id
                    ? 'border-accent bg-accent/10'
                    : 'border-foreground/10 bg-foreground/[0.04] hover:border-foreground/20'
                }`}
              >
                <p className={`font-semibold ${opt.size} mb-0.5`}>{opt.sample}</p>
                <p className="text-[10px] text-foreground/50">{opt.label}</p>
              </button>
            ))}
          </div>
        </div>
        <ToggleRow
          label="Kompakte Widgets"
          description="Weniger Innenabstand in den Widgets für mehr Inhalt"
          checked={compactWidgets}
          onCheckedChange={setCompactWidgets}
        />
      </SettingsSection>
    </>
  )
}

// ─── NINA Warning Settings Component ───────────────────────────────
interface NinaRegion {
  ars: string
  name: string
  type?: string
}

function NinaSettingsSection() {
  const [enabled, setEnabled] = useState(false)
  const [regions, setRegions] = useState<NinaRegion[]>([])
  const [pollInterval, setPollInterval] = useState(5)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [warningCount, setWarningCount] = useState(0)
  const [allRegions, setAllRegions] = useState<NinaRegion[]>([])
  const [regionsLoading, setRegionsLoading] = useState(false)

  // Load settings
  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch('/api/nina/settings')
        if (res.ok) {
          const data = await res.json()
          setEnabled(data.enabled ?? false)
          setRegions(data.ars_regions ?? [])
          setPollInterval(data.poll_interval_minutes ?? 5)
        }
      } catch { /* ignore */ }
      // Load warning count
      try {
        const res = await authFetch('/api/nina/warnings')
        if (res.ok) {
          const data = await res.json()
          setWarningCount(data.warnings?.length ?? 0)
        }
      } catch { /* ignore */ }
      setLoading(false)
    })()
  }, [])

  // Fetch all ARS regions when search panel opens
  useEffect(() => {
    if (!showSearch || allRegions.length > 0) return
    setRegionsLoading(true)
    ;(async () => {
      try {
        const res = await authFetch('/api/nina/regions')
        if (res.ok) {
          const data = await res.json()
          setAllRegions(data.regions ?? [])
        }
      } catch { /* ignore */ }
      setRegionsLoading(false)
    })()
  }, [showSearch, allRegions.length])

  const save = useCallback(async (newEnabled: boolean, newRegions: NinaRegion[], newInterval: number) => {
    setSaving(true)
    try {
      const res = await authFetch('/api/nina/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: newEnabled,
          ars_regions: newRegions,
          poll_interval_minutes: newInterval,
        }),
      })
      if (res.ok) {
        toast.success('NINA-Einstellungen gespeichert')
      } else {
        toast.error('Fehler beim Speichern')
      }
    } catch {
      toast.error('Fehler beim Speichern')
    } finally {
      setSaving(false)
    }
  }, [])

  const toggleEnabled = useCallback((v: boolean) => {
    setEnabled(v)
    save(v, regions, pollInterval)
  }, [regions, pollInterval, save])

  const addRegion = useCallback((region: NinaRegion) => {
    if (regions.some(r => r.ars === region.ars)) return
    const next = [...regions, region]
    setRegions(next)
    setSearch('')
    setShowSearch(false)
    save(enabled, next, pollInterval)
  }, [regions, enabled, pollInterval, save])

  const removeRegion = useCallback((ars: string) => {
    const next = regions.filter(r => r.ars !== ars)
    setRegions(next)
    save(enabled, next, pollInterval)
  }, [regions, enabled, pollInterval, save])

  const updateInterval = useCallback((v: number) => {
    setPollInterval(v)
    save(enabled, regions, v)
  }, [enabled, regions, save])

  const filtered = allRegions.filter(r =>
    !regions.some(sel => sel.ars === r.ars) &&
    (!search.trim() || r.name.toLowerCase().includes(search.toLowerCase()) || r.ars.includes(search.trim()) || (r.type ?? '').toLowerCase().includes(search.toLowerCase()))
  )

  if (loading) return null

  return (
    <SettingsSection
      icon={Warning}
      title="NINA Warnungen"
      description={`Wetterwarnungen & Katastrophenschutz${warningCount > 0 ? ` (${warningCount} aktiv)` : ''}`}
      defaultOpen={false}
    >
      <ToggleRow
        label="NINA Warnungen aktivieren"
        description="Empfange Warn­meldungen direkt vom Bundesamt für Bevölkerungsschutz"
        checked={enabled}
        onCheckedChange={toggleEnabled}
        disabled={saving}
      />

      {enabled && (
        <div className="space-y-3 mt-2">
          {/* Selected regions */}
          <div>
            <p className="text-[11px] font-medium text-foreground/55 uppercase tracking-wider mb-2">
              Überwachte Regionen ({regions.length})
            </p>
            {regions.length === 0 ? (
              <p className="text-xs text-foreground/40 italic px-1">
                Keine Regionen ausgewählt — füge unten Regionen hinzu
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {regions.map(r => (
                  <div
                    key={r.ars}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/15 border border-accent/25 text-xs font-medium text-foreground/85"
                  >
                    <MapPin size={12} weight="fill" className="text-accent shrink-0" />
                    {r.name}
                    <button
                      onClick={() => removeRegion(r.ars)}
                      className="ml-1 p-0.5 rounded-full hover:bg-foreground/10 transition-colors"
                      aria-label={`${r.name} entfernen`}
                    >
                      <X size={10} weight="bold" className="text-foreground/50" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Region search */}
          <div>
            {!showSearch ? (
              <button
                onClick={() => setShowSearch(true)}
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-foreground/[0.04] border border-foreground/8 text-xs text-foreground/60 hover:bg-foreground/[0.07] transition-colors w-full"
              >
                <Plus size={14} weight="bold" />
                Region hinzufügen
              </button>
            ) : (
              <div className="space-y-1.5">
                <div className="relative">
                  <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground/40" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Stadt, Landkreis oder Bundesland suchen…"
                    className="w-full pl-8 pr-8 py-2 rounded-xl bg-foreground/[0.04] border border-foreground/8 text-sm text-foreground placeholder:text-foreground/35 outline-none focus:border-accent/40 transition-colors"
                    autoFocus
                  />
                  <button
                    onClick={() => { setShowSearch(false); setSearch('') }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-foreground/10"
                  >
                    <X size={12} className="text-foreground/40" />
                  </button>
                </div>
                {
                  <div className="max-h-64 overflow-y-auto rounded-xl bg-foreground/[0.03] border border-foreground/8 divide-y divide-foreground/5">
                    {regionsLoading ? (
                      <p className="text-xs text-foreground/40 px-3 py-2.5 text-center">
                        Regionen werden geladen…
                      </p>
                    ) : filtered.length === 0 ? (
                      <p className="text-xs text-foreground/40 px-3 py-2.5 text-center">
                        Keine Region gefunden
                      </p>
                    ) : (
                      filtered.map(r => (
                        <button
                          key={r.ars}
                          onClick={() => addRegion(r)}
                          className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-foreground/[0.05] transition-colors"
                        >
                          <MapPin size={14} className="text-foreground/40 shrink-0" />
                          <div className="flex flex-col min-w-0">
                            <span className="text-xs font-medium text-foreground/80 truncate">{r.name}</span>
                            {r.type && <span className="text-[10px] text-foreground/30">{r.type}</span>}
                          </div>
                          <span className="text-[10px] text-foreground/30 ml-auto tabular-nums shrink-0">{r.ars}</span>
                        </button>
                      ))
                    )}
                  </div>
                }
                {/* Custom ARS input */}
                <p className="text-[10px] text-foreground/35 px-1">
                  Tipp: Du kannst auch einen eigenen 12-stelligen ARS-Code eingeben
                </p>
                {search.trim().length === 12 && /^\d{12}$/.test(search.trim()) && !regions.some(r => r.ars === search.trim()) && (
                  <button
                    onClick={() => addRegion({ ars: search.trim(), name: `Region ${search.trim()}` })}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl bg-accent/10 border border-accent/20 text-xs text-foreground/70 hover:bg-accent/15 transition-colors w-full"
                  >
                    <Plus size={14} weight="bold" className="text-accent" />
                    ARS-Code "{search.trim()}" hinzufügen
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Poll interval */}
          <SliderRow
            label="Abfrageintervall"
            value={pollInterval}
            min={1}
            max={30}
            unit=" min"
            onChange={updateInterval}
            disabled={saving}
          />

          {/* Current warnings count */}
          {warningCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-orange-500/10 border border-orange-500/20">
              <Warning size={16} weight="fill" className="text-orange-500 shrink-0" />
              <span className="text-xs font-medium text-foreground/80">
                {warningCount} aktive Warnung{warningCount !== 1 ? 'en' : ''}
              </span>
            </div>
          )}
        </div>
      )}
    </SettingsSection>
  )
}
