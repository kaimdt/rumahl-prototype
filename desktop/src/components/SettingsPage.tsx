import { useEffect, useState, useCallback, type ElementType, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { usePageNavigation } from '@/contexts/PageNavigationContext'
import { Switch } from '@/components/ui/switch'
import { tauriApi } from '@/lib/tauri'
import { getApiBase, setApiBase } from '@/lib/apiBase'
import type { AppConfig, SystemMetrics } from '@/lib/tauri'
import { useTheme } from '@/contexts/ThemeContext'
import { usePlatform } from '@/hooks/usePlatform'
import {
  Palette,
  BellRinging,
  Cpu,
  HardDrives,
  Database,
  BatteryHigh,
  Robot,
  Lightning,
  IdentificationCard,
  Globe,
  Desktop,
  Screencast,
  Sparkle,
  WifiHigh,
  SealCheck,
  House,
  AppleLogo,
  WindowsLogo,
  LinuxLogo,
} from '@phosphor-icons/react'
import { toast } from 'sonner'
import type { ThemeMode } from '@/lib/types'
import { NetworkSettings } from './NetworkSettings'

// ═══════════════════════════════════════════════════════════════════════════
// IORA OS Control Center Design Primitives
// Theme-aware, consistent — mirrors AdminPanel cc-pattern.
// ═══════════════════════════════════════════════════════════════════════════

const ccInput = (extra = '') =>
  `w-full rounded-xl border border-foreground/[0.08] bg-foreground/[0.04] px-4 py-2.5 text-sm text-foreground placeholder:text-foreground/30 outline-none transition-all duration-200 hover:border-foreground/[0.15] focus:border-accent/60 focus:ring-2 focus:ring-accent/10 focus:bg-foreground/[0.06] ${extra}`

const ccSelect = (extra = '') =>
  `${ccInput()} appearance-none cursor-pointer pr-10 ${extra}`

const ccBtnPrimary = (extra = '') =>
  `inline-flex items-center justify-center gap-1.5 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-accent/20 transition-all duration-200 hover:bg-accent/90 hover:shadow-md hover:shadow-accent/25 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed ${extra}`

const ccBtnSecondary = (extra = '') =>
  `inline-flex items-center justify-center gap-1.5 rounded-xl border border-foreground/[0.08] bg-foreground/[0.04] px-5 py-2.5 text-sm font-semibold text-foreground/80 transition-all duration-200 hover:border-foreground/[0.15] hover:bg-foreground/[0.08] active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed ${extra}`

const ccCard = (extra = '') =>
  `glass-card rounded-2xl p-5 ${extra}`

const ccBadge = (extra = '') =>
  `inline-flex items-center gap-1 rounded-lg border border-foreground/[0.06] bg-foreground/[0.04] px-2.5 py-1 text-[11px] font-medium text-foreground/60 ${extra}`

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

type SettingsCategory = 'appearance' | 'ai' | 'system' | 'network' | 'device'

interface SettingsPageProps {
  theme: string
  [key: string]: unknown
}

// ═══════════════════════════════════════════════════════════════════════════
// Animated Counter (for system metrics)
// ═══════════════════════════════════════════════════════════════════════════

function AnimatedValue({ value, suffix = '' }: { value: string; suffix?: string }) {
  return (
    <motion.span
      key={value}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="tabular-nums"
    >
      {value}{suffix}
    </motion.span>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Sidebar
// ═══════════════════════════════════════════════════════════════════════════

function SettingsSidebar({
  active,
  onChange,
  platform,
  onHomeClick,
  showHome,
}: {
  active: SettingsCategory
  onChange: (cat: SettingsCategory) => void
  platform: string
  onHomeClick: () => void
  showHome: boolean
}) {
  const platformName = platform === 'macos' ? 'macOS' : platform === 'windows' ? 'Windows' : 'Linux'
  const PlatformIcon = platform === 'macos' ? AppleLogo : platform === 'windows' ? WindowsLogo : LinuxLogo

  const categories: { id: SettingsCategory; icon: ElementType; label: string }[] = [
    { id: 'appearance', icon: Palette, label: 'Erscheinungsbild' },
    { id: 'ai', icon: Robot, label: 'AI & Assist' },
    { id: 'system', icon: Desktop, label: 'System' },
    { id: 'network', icon: Globe, label: 'Netzwerk' },
    { id: 'device', icon: Cpu, label: 'Gerät' },
  ]

  return (
    <div className="flex flex-col w-[232px] shrink-0 border-r border-foreground/[0.06] bg-background/40 backdrop-blur-2xl pt-6 pb-4">
      {/* Header */}
      <div className="px-5 mb-6">
        <p className="text-[10px] uppercase tracking-[0.22em] text-foreground/30 mb-1 font-medium">IORA Desktop</p>
        <h2 className="text-base font-semibold text-foreground/90 tracking-tight">Einstellungen</h2>
      </div>

      {/* Category list */}
      <nav className="flex-1 space-y-0.5 px-3">
        {categories.map((cat) => {
          const isActive = active === cat.id
          return (
            <motion.button
              key={cat.id}
              type="button"
              onClick={() => onChange(cat.id)}
              className={`relative flex items-center gap-3 w-full px-4 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200 ${
                isActive
                  ? 'text-foreground bg-accent/10 shadow-[inset_0_0_0_1px_var(--accent)/0.12]'
                  : 'text-foreground/45 hover:text-foreground/75 hover:bg-foreground/[0.04]'
              }`}
              whileTap={{ scale: 0.97 }}
            >
              <cat.icon size={19} weight={isActive ? 'fill' : 'regular'} />
              <span>{cat.label}</span>
            </motion.button>
          )
        })}
      </nav>

      {/* Bottom section */}
      <div className="px-3 space-y-2">
        {/* Back to IORA Home */}
        {showHome && (
          <motion.button
            type="button"
            onClick={onHomeClick}
            className="flex items-center gap-3 w-full px-4 py-2.5 rounded-xl text-[13px] font-medium text-accent/70 hover:text-accent hover:bg-accent/[0.06] transition-all duration-200"
            whileTap={{ scale: 0.97 }}
          >
            <House size={19} weight="duotone" />
            <span>IORA Home</span>
          </motion.button>
        )}

        {/* Platform badge */}
        <div className="px-4 pt-3 border-t border-foreground/[0.05]">
          <div className="flex items-center gap-2 text-[11px] text-foreground/35">
            <PlatformIcon size={13} weight="fill" />
            <span>{platformName}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Shared Components
// ═══════════════════════════════════════════════════════════════════════════

function SectionHeader({
  icon: Icon,
  title,
  description,
}: {
  icon: ElementType
  title: string
  description?: string
}) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent">
        <Icon size={16} weight="duotone" />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description && <p className="text-xs text-foreground/40 mt-0.5">{description}</p>}
      </div>
    </div>
  )
}

function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string
  description: string
  checked: boolean
  onCheckedChange: (next: boolean) => void
  disabled?: boolean
}) {
  return (
    <div
      className={`flex items-center justify-between gap-4 rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] px-4 py-3 transition-all duration-200 hover:border-foreground/[0.10] ${
        disabled ? 'opacity-40 pointer-events-none' : ''
      }`}
    >
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-foreground/85">{label}</p>
        <p className="text-[11px] text-foreground/40 mt-0.5 leading-relaxed">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  )
}

function SliderRow({
  label,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  unit: string
  onChange: (next: number) => void
}) {
  const pct = ((value - min) / (max - min)) * 100

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-foreground/60">{label}</span>
        <span className="text-[13px] font-semibold text-foreground tabular-nums">
          {value}{unit}
        </span>
      </div>
      <div className="relative">
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-foreground/[0.08] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-[18px] [&::-webkit-slider-thumb]:h-[18px] [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:shadow-sm [&::-webkit-slider-thumb]:shadow-accent/25 [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:duration-150 [&::-webkit-slider-thumb]:hover:scale-110 [&::-webkit-slider-thumb]:active:scale-95"
        />
        <div
          className="absolute top-0 left-0 h-1.5 rounded-full bg-accent/30 pointer-events-none transition-all duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function TextInput({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  hint,
}: {
  label: string
  value: string
  onChange: (next: string) => void
  placeholder?: string
  type?: string
  hint?: string
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-medium text-foreground/50 uppercase tracking-wider">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={ccInput()}
      />
      {hint && <p className="text-[10px] text-foreground/25 mt-1">{hint}</p>}
    </div>
  )
}

function MonoCode({ children }: { children: ReactNode }) {
  return (
    <code className="block select-all overflow-x-auto rounded-xl border border-foreground/[0.06] bg-foreground/[0.03] px-4 py-2.5 text-xs text-foreground/45 font-mono leading-relaxed">
      {children}
    </code>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Theme Picker
// ═══════════════════════════════════════════════════════════════════════════

function ThemePicker() {
  const { selectedTheme, setSelectedTheme } = useTheme()

  const options: { value: ThemeMode | 'auto'; label: string }[] = [
    { value: 'auto', label: 'Automatisch' },
    { value: 'light', label: 'Hell' },
    { value: 'day', label: 'Tag' },
    { value: 'night', label: 'Nacht' },
    { value: 'sleep', label: 'Schlaf' },
  ]

  return (
    <div className="grid grid-cols-5 gap-2">
      {options.map((option) => {
        const isActive = selectedTheme === option.value
        return (
          <motion.button
            key={option.value}
            type="button"
            onClick={() => setSelectedTheme(option.value)}
            className={`rounded-xl border px-3 py-2.5 text-[12px] font-medium transition-all duration-200 ${
              isActive
                ? 'border-accent/40 bg-accent/10 text-accent shadow-[inset_0_0_0_1px_var(--accent)/0.12]'
                : 'border-foreground/[0.08] bg-foreground/[0.03] text-foreground/55 hover:border-foreground/[0.15] hover:bg-foreground/[0.05] hover:text-foreground/75'
            }`}
            whileTap={{ scale: 0.96 }}
          >
            {option.label}
          </motion.button>
        )
      })}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// System Metric Mini Card
// ═══════════════════════════════════════════════════════════════════════════

function MetricCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: ElementType
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] p-4 transition-all duration-200 hover:border-foreground/[0.10]">
      <div className="flex items-center gap-2 text-foreground/35 mb-2">
        <Icon size={14} weight="duotone" />
        <span className="text-[11px] font-medium uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-xl font-semibold text-foreground tabular-nums">
        <AnimatedValue value={value} />
      </p>
      {sub && <p className="text-[10px] text-foreground/30 mt-0.5">{sub}</p>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Loading Spinner
// ═══════════════════════════════════════════════════════════════════════════

function LoadingSpinner({ label = 'Wird geladen...' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 py-6">
      <motion.div
        className="h-5 w-5 rounded-full border-2 border-accent/20 border-t-accent"
        animate={{ rotate: 360 }}
        transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
      />
      <p className="text-sm text-foreground/30">{label}</p>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Category Content Renderers
// ═══════════════════════════════════════════════════════════════════════════

function AppearancePane({
  tauriConfig,
  updateConfig,
}: {
  tauriConfig: AppConfig
  updateConfig: (patch: Partial<AppConfig>) => void
}) {
  const { setCurrentPageId } = usePageNavigation()

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="space-y-4"
    >
      <div className="mb-5">
        <p className="text-[10px] uppercase tracking-[0.22em] text-foreground/25 mb-1 font-medium">Erscheinungsbild</p>
        <h2 className="text-xl font-semibold text-foreground tracking-tight">Design & Benachrichtigungen</h2>
      </div>

      {/* Theme */}
      <div className={ccCard()}>
        <SectionHeader icon={Palette} title="Theme" description="Farbschema für die Desktop-App" />
        <ThemePicker />
      </div>

      {/* Glass Effect */}
      <div className={ccCard()}>
        <SectionHeader icon={Palette} title="Glas-Effekt" description="Transparente Oberflächenoptik" />
        <ToggleRow
          label="Glas-Design aktiviert"
          description="Sorgt für einen weicheren, moderneren Look"
          checked={true}
          onCheckedChange={() => toast('Die Titelleiste verwendet bereits Glas-Optik.')}
        />
        <p className="text-[10px] text-foreground/25 mt-3">Diese Einstellung ist fixiert und Teil der IORA OS Designsprache.</p>
      </div>

      {/* Notifications */}
      <div className={ccCard()}>
        <SectionHeader icon={BellRinging} title="Benachrichtigungen" description="Desktop-Benachrichtigungen und Sound" />
        <div className="space-y-2.5">
          <ToggleRow
            label="Benachrichtigungen aktiv"
            description="Systemmeldungen aus der Desktop-App anzeigen"
            checked={tauriConfig.notifications_enabled ?? true}
            onCheckedChange={(value) => updateConfig({ notifications_enabled: value })}
          />
          <ToggleRow
            label="Töne aktivieren"
            description="Akustische Hinweise bei Ereignissen"
            checked={tauriConfig.notification_sound ?? false}
            onCheckedChange={(value) => updateConfig({ notification_sound: value })}
          />
        </div>
      </div>

    </motion.div>
  )
}

function AiPane({
  tauriConfig,
  updateConfig,
  models,
  modelsLoading,
  connectionStatus,
  loadModels,
  testLmConnection,
}: {
  tauriConfig: AppConfig
  updateConfig: (patch: Partial<AppConfig>) => void
  models: import('@/lib/tauri').Model[]
  modelsLoading: boolean
  connectionStatus: 'idle' | 'testing' | 'ok' | 'error'
  loadModels: () => void
  testLmConnection: () => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="space-y-4"
    >
      <div className="mb-5">
        <p className="text-[10px] uppercase tracking-[0.22em] text-foreground/25 mb-1 font-medium">AI & Assist</p>
        <h2 className="text-xl font-semibold text-foreground tracking-tight">Künstliche Intelligenz</h2>
      </div>

      {/* LM Studio */}
      <div className={ccCard()}>
        <SectionHeader icon={Robot} title="Local AI (LM Studio)" description="Lokale Modelle dem Netzwerk bereitstellen" />
        <div className="space-y-4">
          <div className="rounded-xl border border-accent/[0.12] bg-accent/[0.04] px-4 py-3">
            <p className="text-[12px] text-accent/80 leading-relaxed">
              Wenn LM Studio auf diesem PC läuft, stellt IORA Desktop die Modelle automatisch dem gesamten IORA-Netzwerk bereit.
            </p>
          </div>

          <TextInput
            label="LM Studio Server URL"
            value={tauriConfig.lm_studio_url}
            onChange={(v) => updateConfig({ lm_studio_url: v })}
            placeholder="http://localhost:1234"
            type="url"
          />

          <TextInput
            label="API Key (optional)"
            value={tauriConfig.lm_studio_api_key}
            onChange={(v) => updateConfig({ lm_studio_api_key: v })}
            placeholder="Leer lassen, wenn nicht benötigt"
            type="password"
          />

          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-foreground/50 uppercase tracking-wider">Aktives Modell</label>
            <div className="flex gap-2">
              <select
                value={tauriConfig.selected_model}
                onChange={(e) => updateConfig({ selected_model: e.target.value })}
                disabled={modelsLoading}
                className={ccSelect('flex-1')}
              >
                <option value="">– Modell auswählen –</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>{m.id}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={loadModels}
                disabled={modelsLoading}
                className={ccBtnSecondary('px-3')}
              >
                {modelsLoading ? (
                  <motion.span animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
                    <Cpu size={15} />
                  </motion.span>
                ) : (
                  <span className="text-base leading-none">&#x21BB;</span>
                )}
              </button>
            </div>
            {models.length === 0 && !modelsLoading && (
              <p className="text-[10px] text-foreground/25 mt-1">Modelle von LM Studio laden</p>
            )}
            {models.length > 0 && (
              <p className="text-[11px] text-accent/70 mt-1 font-medium">
                {models.length} Modell{models.length > 1 ? 'e' : ''} gefunden
              </p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button type="button" onClick={testLmConnection} disabled={connectionStatus === 'testing'} className={ccBtnSecondary()}>
              {connectionStatus === 'testing' ? 'Teste...' : 'Verbindung testen'}
            </button>
            {connectionStatus === 'ok' && (
              <span className="inline-flex items-center gap-1.5 text-[12px] text-emerald-400 font-medium">
                <SealCheck size={14} weight="fill" /> Verbunden
              </span>
            )}
            {connectionStatus === 'error' && (
              <span className="text-[12px] text-red-400/80 font-medium">Nicht erreichbar</span>
            )}
          </div>
        </div>
      </div>

      {/* IORA Assist Backend */}
      <div className={ccCard()}>
        <SectionHeader icon={Lightning} title="IORA Assist Backend" description="Verbindung zum zentralen Assist Server" />
        <TextInput
          label="IORA Assist URL"
          value={tauriConfig.iora_backend_url}
          onChange={(v) => updateConfig({ iora_backend_url: v })}
          placeholder="http://localhost:8092"
          type="url"
        />
      </div>

      {/* ORA AI */}
      <div className={ccCard()}>
        <SectionHeader icon={Sparkle} title="ORA AI Einstellungen" description="Privatsphäre und Systemsteuerung" />
        <div className="space-y-2.5">
          <ToggleRow
            label="Privatsphäre-Modus"
            description="Deaktiviert ORA AI vollständig für diesen Client"
            checked={tauriConfig.ora_privacy_mode}
            onCheckedChange={(value) => updateConfig({ ora_privacy_mode: value })}
          />
          <ToggleRow
            label="Systemsteuerung erlauben"
            description="Erlaubt der AI, dein System zu steuern (Tastatur, Maus, Programme)"
            checked={tauriConfig.ora_allow_control}
            onCheckedChange={(value) => updateConfig({ ora_allow_control: value })}
            disabled={tauriConfig.ora_privacy_mode}
          />
          <ToggleRow
            label="Autopilot Modus"
            description="Erlaubt der AI selbstständige Systemsteuerungen ohne Bestätigung"
            checked={tauriConfig.ora_autopilot}
            onCheckedChange={(value) => updateConfig({ ora_autopilot: value })}
            disabled={tauriConfig.ora_privacy_mode}
          />
        </div>
      </div>
    </motion.div>
  )
}

function SystemPane({
  tauriConfig,
  updateConfig,
}: {
  tauriConfig: AppConfig
  updateConfig: (patch: Partial<AppConfig>) => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="space-y-4"
    >
      <div className="mb-5">
        <p className="text-[10px] uppercase tracking-[0.22em] text-foreground/25 mb-1 font-medium">System</p>
        <h2 className="text-xl font-semibold text-foreground tracking-tight">Fenster & Verhalten</h2>
      </div>

      {/* Window & Display */}
      <div className={ccCard()}>
        <SectionHeader icon={Desktop} title="Fenster & Anzeige" description="Helligkeit, Kiosk-Modus, Fensterverhalten" />
        <div className="space-y-5">
          <SliderRow
            label="Display-Helligkeit"
            value={tauriConfig.display_brightness}
            min={0}
            max={100}
            unit="%"
            onChange={(value) => updateConfig({ display_brightness: value })}
          />
          <ToggleRow
            label="Immer im Vordergrund"
            description="Das Fenster bleibt über anderen Anwendungen"
            checked={tauriConfig.always_on_top}
            onCheckedChange={(value) => updateConfig({ always_on_top: value })}
          />
          <ToggleRow
            label="Kiosk-Modus"
            description="Vollbild ohne Menüleiste für Wandtablets"
            checked={tauriConfig.kiosk_mode}
            onCheckedChange={(value) => updateConfig({ kiosk_mode: value })}
          />
        </div>
      </div>

      {/* Screensaver */}
      <div className={ccCard()}>
        <SectionHeader icon={Screencast} title="Bildschirmschoner" description="Automatisches Dimmen bei Inaktivität" />
        <div className="space-y-5">
          <ToggleRow
            label="Bildschirmschoner aktiv"
            description="Display automatisch dimmen"
            checked={tauriConfig.screen_saver_enabled}
            onCheckedChange={(value) => updateConfig({ screen_saver_enabled: value })}
          />
          {tauriConfig.screen_saver_enabled && (
            <SliderRow
              label="Timeout"
              value={Math.round(tauriConfig.screen_saver_timeout_secs / 60)}
              min={1}
              max={30}
              unit=" min"
              onChange={(value) => updateConfig({ screen_saver_timeout_secs: value * 60 })}
            />
          )}
        </div>
      </div>

      {/* Advanced */}
      <div className={ccCard()}>
        <SectionHeader icon={Desktop} title="Erweiterte Funktionen" description="Diagnose und Hintergrundbetrieb" />
        <div className="space-y-2.5">
          <ToggleRow
            label="Diagnosedaten senden"
            description="Hilft bei der Fehlerbehebung und Optimierung"
            checked={tauriConfig.send_diagnostics}
            onCheckedChange={(value) => updateConfig({ send_diagnostics: value })}
          />
          <ToggleRow
            label="Im Hintergrund starten"
            description="Minimiert starten, ohne sofort sichtbar zu sein"
            checked={tauriConfig.autostart_minimized}
            onCheckedChange={(value) => updateConfig({ autostart_minimized: value })}
          />
          <ToggleRow
            label="Im Hintergrund verstecken"
            description="Startet die App ohne Taskleisten-Symbol"
            checked={tauriConfig.autostart_hidden}
            onCheckedChange={(value) => updateConfig({ autostart_hidden: value })}
          />
          <ToggleRow
            label="Automatisch starten"
            description="Die Desktop-App beim Systemstart öffnen"
            checked={tauriConfig.autostart_enabled}
            onCheckedChange={(value) => updateConfig({ autostart_enabled: value })}
          />
        </div>
      </div>
    </motion.div>
  )
}

function NetworkPane({
  tauriConfig,
  updateConfig,
}: {
  tauriConfig: AppConfig
  updateConfig: (patch: Partial<AppConfig>) => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="space-y-4"
    >
      <div className="mb-5">
        <p className="text-[10px] uppercase tracking-[0.22em] text-foreground/25 mb-1 font-medium">Netzwerk</p>
        <h2 className="text-xl font-semibold text-foreground tracking-tight">Verbindungen & Integration</h2>
      </div>

      {/* Remote Home */}
      <div className={ccCard()}>
        <SectionHeader icon={Globe} title="Remote Home URL" description="Ziele auf die entfernte IORA Home-Instanz" />
        <TextInput
          label="Remote Home URL"
          value={tauriConfig.iora_home_url}
          onChange={(v) => updateConfig({ iora_home_url: v })}
          placeholder="https://localhost:3001"
          type="url"
        />
      </div>

      {/* HA Integration */}
      <div className={ccCard()}>
        <SectionHeader icon={Globe} title="Home Assistant Integration" description="System-Metriken an HA senden" />
        <div className="space-y-5">
          <ToggleRow
            label="Home Assistant Integration"
            description="Systemdaten dieses Geräts an Home Assistant melden"
            checked={tauriConfig.ha_enabled}
            onCheckedChange={(value) => updateConfig({ ha_enabled: value })}
          />
          {tauriConfig.ha_enabled && (
            <SliderRow
              label="Metriken-Update-Intervall"
              value={tauriConfig.ha_update_interval_secs}
              min={30}
              max={300}
              unit="s"
              onChange={(value) => updateConfig({ ha_update_interval_secs: value })}
            />
          )}
        </div>
      </div>

      {/* Proxy */}
      <div className={ccCard()}>
        <SectionHeader icon={WifiHigh} title="Netzwerk & Proxy" description="Proxy konfigurieren und Verbindung überwachen" />
        <div className="space-y-5">
          <ToggleRow
            label="Proxy automatisch starten"
            description="Den lokalen Proxy mit der Desktop-App starten"
            checked={tauriConfig.auto_start_proxy}
            onCheckedChange={(value) => updateConfig({ auto_start_proxy: value })}
          />
          <SliderRow
            label="Proxy-Port"
            value={tauriConfig.proxy_port}
            min={1024}
            max={65535}
            unit=""
            onChange={(value) => updateConfig({ proxy_port: value })}
          />
          <SliderRow
            label="Health-Check Interval"
            value={tauriConfig.health_poll_interval_secs}
            min={10}
            max={300}
            unit="s"
            onChange={(value) => updateConfig({ health_poll_interval_secs: value })}
          />
        </div>
      </div>

      {/* Network Profiles */}
      <div className={ccCard()}>
        <SectionHeader icon={WifiHigh} title="Netzwerkprofile" description="Verschiedene IORA Home URLs verwalten" />
        <NetworkSettings />
      </div>
    </motion.div>
  )
}

function DevicePane({
  tauriConfig,
  updateConfig,
  deviceMetrics,
}: {
  tauriConfig: AppConfig
  updateConfig: (patch: Partial<AppConfig>) => void
  deviceMetrics: SystemMetrics | null
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="space-y-4"
    >
      <div className="mb-5">
        <p className="text-[10px] uppercase tracking-[0.22em] text-foreground/25 mb-1 font-medium">Gerät</p>
        <h2 className="text-xl font-semibold text-foreground tracking-tight">Identität & Status</h2>
      </div>

      {/* Identity */}
      <div className={ccCard()}>
        <SectionHeader icon={IdentificationCard} title="Geräte-Identität" description="Name und ID im IORA-Netzwerk" />
        <div className="space-y-4">
          <TextInput
            label="Client-Name"
            value={tauriConfig.client_name}
            onChange={(v) => updateConfig({ client_name: v })}
            placeholder="z.B. Wohnzimmer-PC"
            hint="Anzeigename in IORA Assist (bei mehreren Clients)"
          />
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-foreground/50 uppercase tracking-wider">Client-ID</label>
            <MonoCode>{tauriConfig.client_id}</MonoCode>
          </div>
        </div>
      </div>

      {/* System Overview */}
      <div className={ccCard()}>
        <SectionHeader icon={Cpu} title="Systemübersicht" description="Live-Status und Rechnerdaten" />
        {deviceMetrics ? (
          <div className="grid grid-cols-2 gap-3">
            <MetricCard
              icon={Cpu}
              label="CPU"
              value={`${deviceMetrics.cpu_usage.toFixed(1)}%`}
              sub="Auslastung"
            />
            <MetricCard
              icon={HardDrives}
              label="RAM"
              value={`${deviceMetrics.memory_used_gb.toFixed(1)} / ${deviceMetrics.memory_total_gb.toFixed(1)} GB`}
              sub="Speicher"
            />
            <MetricCard
              icon={Database}
              label="Festplatte"
              value={`${deviceMetrics.disk_used_gb.toFixed(0)} / ${deviceMetrics.disk_total_gb.toFixed(0)} GB`}
            />
            <MetricCard
              icon={BatteryHigh}
              label="Akku"
              value={deviceMetrics.battery_percent != null ? `${deviceMetrics.battery_percent.toFixed(0)}%` : 'n/a'}
              sub={deviceMetrics.battery_state ?? 'Unbekannt'}
            />
          </div>
        ) : (
          <LoadingSpinner label="Systeminformationen werden geladen..." />
        )}
      </div>
    </motion.div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Settings Page
// ═══════════════════════════════════════════════════════════════════════════

export function SettingsPage({ theme: _theme }: SettingsPageProps) {
  const platform = usePlatform()
  const [category, setCategory] = useState<SettingsCategory>('appearance')
  const [tauriConfig, setTauriConfig] = useState<AppConfig | null>(null)
  const [initialConfig, setInitialConfig] = useState<AppConfig | null>(null)
  const [deviceMetrics, setDeviceMetrics] = useState<SystemMetrics | null>(null)
  const [loadingConfig, setLoadingConfig] = useState(true)
  const [saving, setSaving] = useState(false)
  const [models, setModels] = useState<import('@/lib/tauri').Model[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle')
  const { setCurrentPageId } = usePageNavigation()

  // ── Load config ─────────────────────────────────────────────────────

  const loadDesktopConfig = useCallback(async () => {
    try {
      setLoadingConfig(true)
      const config = await tauriApi.getConfig()
      setTauriConfig(config)
      setInitialConfig(config)
    } catch {
      toast.error('Desktop-Konfiguration konnte nicht geladen werden.')
    } finally {
      setLoadingConfig(false)
    }
  }, [])

  useEffect(() => {
    void loadDesktopConfig()
  }, [loadDesktopConfig])

  // ── Device metrics polling ──────────────────────────────────────────

  useEffect(() => {
    if (category === 'device') {
      void tauriApi.getSystemMetrics().then(setDeviceMetrics).catch(() => {})
    }
  }, [category])

  useEffect(() => {
    if (category !== 'device') return
    const interval = window.setInterval(() => {
      void tauriApi.getSystemMetrics().then(setDeviceMetrics).catch(() => {})
    }, 5000)
    return () => window.clearInterval(interval)
  }, [category])

  // ── Save ────────────────────────────────────────────────────────────

  const saveDesktopConfig = useCallback(async () => {
    if (!tauriConfig) return
    try {
      setSaving(true)
      await tauriApi.saveConfig(tauriConfig)

      if (initialConfig && initialConfig.iora_home_url !== tauriConfig.iora_home_url) {
        setApiBase(tauriConfig.iora_home_url)
      }
      if (initialConfig && initialConfig.autostart_enabled !== tauriConfig.autostart_enabled) {
        await tauriApi.setAutostart(tauriConfig.autostart_enabled)
      }
      if (
        initialConfig &&
        (initialConfig.autostart_minimized !== tauriConfig.autostart_minimized ||
          initialConfig.autostart_hidden !== tauriConfig.autostart_hidden)
      ) {
        await tauriApi.setAutostartOptions(tauriConfig.autostart_minimized, tauriConfig.autostart_hidden)
      }
      if (
        initialConfig &&
        (initialConfig.always_on_top !== tauriConfig.always_on_top ||
          initialConfig.kiosk_mode !== tauriConfig.kiosk_mode)
      ) {
        await tauriApi.applyWindowSettings(tauriConfig.always_on_top, tauriConfig.kiosk_mode)
      }

      setInitialConfig(tauriConfig)
      toast.success('Einstellungen gespeichert.')
    } catch {
      toast.error('Speichern fehlgeschlagen.')
    } finally {
      setSaving(false)
    }
  }, [tauriConfig, initialConfig])

  const updateConfig = (patch: Partial<AppConfig>) => {
    if (!tauriConfig) return
    setTauriConfig({ ...tauriConfig, ...patch })
  }

  // ── LM Studio helpers ───────────────────────────────────────────────

  const loadModels = useCallback(async () => {
    try {
      setModelsLoading(true)
      const list = await tauriApi.listModels()
      setModels(list)
    } catch {
      toast.error('Modelle konnten nicht geladen werden.')
      setModels([])
    } finally {
      setModelsLoading(false)
    }
  }, [])

  const testLmConnection = useCallback(async () => {
    setConnectionStatus('testing')
    try {
      const result = await tauriApi.testConnection()
      setConnectionStatus(result.connected ? 'ok' : 'error')
      if (result.connected) {
        toast.success('LM Studio verbunden!')
      } else {
        toast.error(result.error ?? 'Verbindung fehlgeschlagen')
      }
    } catch {
      setConnectionStatus('error')
      toast.error('Verbindungstest fehlgeschlagen')
    }
  }, [])

  // ── Loading / error state ───────────────────────────────────────────

  if (loadingConfig) {
    return (
      <div className="flex items-center justify-center py-20">
        <LoadingSpinner label="Einstellungen werden geladen..." />
      </div>
    )
  }

  if (!tauriConfig) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-foreground/40">Konfiguration nicht verfügbar.</p>
      </div>
    )
  }

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
      className="h-screen flex flex-col overflow-hidden bg-background/70 backdrop-blur-2xl"
      data-platform={platform}
    >
      {/* Transparent drag region – window dragging */}
      <div data-tauri-drag-region className="h-10 shrink-0" />

      {/* Sidebar + Content */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Sidebar – fixed position, doesn't scroll with content */}
        <SettingsSidebar active={category} onChange={setCategory} platform={platform} onHomeClick={() => setCurrentPageId('home')} showHome={!!getApiBase()} />

        {/* Content area – scrolls independently */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-6 py-6 pb-28 space-y-5">
            <AnimatePresence mode="wait">
              <motion.div key={category}>
                {category === 'appearance' && (
                  <AppearancePane tauriConfig={tauriConfig} updateConfig={updateConfig} />
                )}
                {category === 'ai' && (
                  <AiPane
                    tauriConfig={tauriConfig}
                    updateConfig={updateConfig}
                    models={models}
                    modelsLoading={modelsLoading}
                    connectionStatus={connectionStatus}
                    loadModels={loadModels}
                    testLmConnection={testLmConnection}
                  />
                )}
                {category === 'system' && (
                  <SystemPane tauriConfig={tauriConfig} updateConfig={updateConfig} />
                )}
                {category === 'network' && (
                  <NetworkPane tauriConfig={tauriConfig} updateConfig={updateConfig} />
                )}
                {category === 'device' && (
                  <DevicePane tauriConfig={tauriConfig} updateConfig={updateConfig} deviceMetrics={deviceMetrics} />
                )}
              </motion.div>
            </AnimatePresence>

            {/* Save button */}
            <div className="flex justify-end pt-1">
              <motion.button
                type="button"
                onClick={saveDesktopConfig}
                disabled={saving}
                className={ccBtnPrimary()}
                whileTap={{ scale: 0.97 }}
              >
                {saving ? (
                  <>
                    <motion.span
                      animate={{ rotate: 360 }}
                      transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
                      className="inline-block"
                    >
                      <Cpu size={14} />
                    </motion.span>
                    Speichern...
                  </>
                ) : (
                  'Änderungen speichern'
                )}
              </motion.button>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
