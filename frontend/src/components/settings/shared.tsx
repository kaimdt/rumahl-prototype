// Shared UI helpers & utilities used by the Settings page and its lazy-loaded
// section chunks (settings/*, SettingsAppsSection).
//
// Extracted from SettingsPage.tsx to break the circular lazy-import cycle:
//   SettingsPage ──lazy──▶ settings/* ──static import──▶ SettingsPage
// That cycle made Vite HMR invalidate the whole graph on every save, which
// surfaced as "Failed to fetch dynamically imported module" in the browser.
//
// IMPORTANT: this module must never import from SettingsPage (or any settings
// section), otherwise the cycle would be re-introduced.
import * as React from 'react'
import {
  ArrowsClockwise,
  CloudSun,
  CircleHalfTilt,
  Eye,
  Lightbulb,
  Monitor,
  Moon,
  MoonStars,
  PaintBrush,
  Palette,
  Sparkle,
  Sun,
  SunDim,
} from '@phosphor-icons/react'
import { Switch } from '@/components/ui/switch'
import { getBackendUrl } from '@/lib/config'
import type { InstalledTheme } from '@/contexts/ThemeContext'

/** Map icon name string to Phosphor icon component */
export function MapThemeIcon(iconName?: string | null): React.ElementType {
  const iconMap: Record<string, React.ElementType> = {
    Sun, Moon, Monitor, CloudSun, SunDim, MoonStars, CircleHalfTilt,
    ArrowsClockwise, Palette, PaintBrush, Sparkle, Eye,
    Lightbulb, Star: Sparkle,
  }
  return iconName && iconMap[iconName] ? iconMap[iconName] : PaintBrush
}

/** Generate a preview gradient for custom themes */
export function getCustomThemePreview(theme: InstalledTheme): string {
  // Try to parse CSS variables for a preview color
  if (theme.css_variables) {
    try {
      const vars = JSON.parse(theme.css_variables)
      const bg = vars['background'] || vars['bg'] || vars['base']
      const accent = vars['accent'] || vars['primary']
      if (bg && accent) {
        // Extract OKLCH values for gradient
        return `linear-gradient(135deg, ${bg} 0%, ${accent} 100%)`
      }
      if (bg) return `linear-gradient(135deg, ${bg} 0%, rgba(0,0,0,0.6) 100%)`
    } catch {}
  }
  return 'linear-gradient(135deg, #1a1d2e 0%, #2a2d4e 100%)'
}

export const apiBase = () => getBackendUrl() || ''

export function generateBase32Secret(length = 20) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const bytes = typeof crypto !== 'undefined' && 'getRandomValues' in crypto
    ? crypto.getRandomValues(new Uint8Array(length))
    : Array.from({ length }, () => Math.floor(Math.random() * 256))
  return Array.from(bytes)
    .map((byte) => alphabet[byte % alphabet.length])
    .join('')
}

export function formatOtpAuthUri(secret: string) {
  const issuer = encodeURIComponent('rumahl Home')
  const label = encodeURIComponent('rumahl Home')
  return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`
}

export function getTimeBasedCode(secret: string) {
  const timeWindow = Math.floor(Date.now() / 30000)
  let hash = 0
  for (let i = 0; i < secret.length; i += 1) {
    hash = ((hash << 5) - hash + secret.charCodeAt(i) + ((timeWindow >> ((i % 4) * 8)) & 0xff)) >>> 0
  }
  return String(1000000 + (hash % 900000)).slice(-6)
}

export function createBackupCodes(count = 10) {
  return Array.from({ length: count }, () => Math.random().toString(36).slice(2, 10).toUpperCase())
}

export function downloadBackupCodes(codes: string[]) {
  const blob = new Blob([codes.join('\n')], { type: 'text/plain;charset=utf-8' })
  const href = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = href
  link.download = 'rumahl-backup-codes.txt'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(href)
}

// ─── Settings section wrapper with collapsible content ───────────────────
export function SettingsSection({
  icon: Icon,
  title,
  description,
  children,
  accentIcon = false,
}: {
  icon: React.ElementType
  title: string
  description?: string
  children: React.ReactNode
  defaultOpen?: boolean
  accentIcon?: boolean
}) {
  return (
    <section className="appr-panel rumahl-settings-section-card">
      <header className="rumahl-settings-section-heading">
        <div className={`rumahl-settings-section-icon ${accentIcon ? 'text-accent' : ''}`}>
          <Icon size={15} weight={accentIcon ? 'fill' : 'regular'} />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-foreground">{title}</h4>
          {description && <p className="mt-0.5 line-clamp-1 text-xs leading-relaxed text-ui-secondary">{description}</p>}
        </div>
      </header>
      <div className="rumahl-settings-section-content space-y-3">
        {children}
      </div>
    </section>
  )
}

// ─── Styled slider row ────────────────────────────────────────────────
export function SliderRow({
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
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))
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
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        style={{
          background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${pct}%, var(--state-active) ${pct}%, oklch(from var(--foreground) l c h / 0.10) 100%)`,
        }}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer disabled:opacity-40 transition-shadow focus:outline-none focus:ring-2 focus:ring-accent/30 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:shadow-[0_0_0_3px_oklch(from_var(--accent)_l_c_h/0.18)] [&::-webkit-slider-thumb]:hover:scale-110 [&::-webkit-slider-thumb]:transition-transform [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-accent [&::-moz-range-thumb]:border-0"
      />
    </div>
  )
}

// ─── Toggle row ───────────────────────────────────────────────────────
export function ToggleRow({
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
    <div className="rumahl-settings-control-row flex items-center justify-between gap-4 px-4 py-3.5 transition-colors">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-foreground/90">{label}</p>
        {description && <p className="text-[11px] leading-relaxed text-foreground/50 mt-0.5">{description}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} className="shrink-0" />
    </div>
  )
}

// ─── Theme Picker Section ──────────────────────────────────────────────
export const THEME_OPTIONS: { value: string; label: string; description: string; icon: React.ElementType; preview: string }[] = [
  { value: 'auto', label: 'Automatisch', description: 'Wechselt nach Tageszeit', icon: ArrowsClockwise, preview: 'linear-gradient(135deg, #e8eaf0 0%, #1a1d2e 100%)' },
  { value: 'light', label: 'Hell', description: 'Maximale Helligkeit', icon: Sun, preview: 'linear-gradient(135deg, #f5f5f7 0%, #e8eaf0 50%, #dde0e8 100%)' },
  { value: 'day', label: 'Tag', description: 'Helles Design', icon: CloudSun, preview: 'linear-gradient(135deg, #e0e4ec 0%, #c8cdd8 50%, #b8bfcc 100%)' },
  { value: 'day-classic', label: 'Klassisch', description: 'Dunkler Hintergrund', icon: Monitor, preview: 'linear-gradient(135deg, #2a2d3e 0%, #1a1d2e 50%, #0f1118 100%)' },
  { value: 'evening', label: 'Abend', description: 'Warme Töne', icon: SunDim, preview: 'linear-gradient(135deg, #2d2f4a 0%, #1e2040 50%, #15172e 100%)' },
  { value: 'night', label: 'Nacht', description: 'Dunkles Design', icon: MoonStars, preview: 'linear-gradient(135deg, #181c2e 0%, #0f1220 50%, #0a0d18 100%)' },
  { value: 'sleep', label: 'Schlaf', description: 'OLED Schwarz', icon: Moon, preview: 'linear-gradient(135deg, #050508 0%, #000000 100%)' },
  { value: 'midnight', label: 'rumahl Midnight UI', description: 'Pure black with white accents', icon: CircleHalfTilt, preview: 'linear-gradient(135deg, #242424 0%, #080808 42%, #000000 100%)' },
]

export const DAY_LABELS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
