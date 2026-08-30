// Theme picker section of the Settings page (lazy-loaded chunk).
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock, Info, Palette } from '@phosphor-icons/react'
import { readTimeThemeConfig, writeTimeThemeConfig, useTheme, type TimeThemeConfig } from '@/contexts/ThemeContext'
import { ThemeEditor } from '@/components/ThemeEditor'
import { getCustomThemePreview, MapThemeIcon, SettingsSection, THEME_OPTIONS, ToggleRow } from './shared'

export function ThemePickerSection() {
  const { t } = useTranslation()
  const { selectedTheme, setSelectedTheme, theme: activeTheme, availableThemes, installedThemes, sleepMode, setSleepMode } = useTheme()
  const [editorOpen, setEditorOpen] = useState(false)
  const [timeConfig, setTimeConfig] = useState<TimeThemeConfig>(() => readTimeThemeConfig())

  const updateTimeBoundary = (key: keyof TimeThemeConfig, value: number) => {
    setTimeConfig((prev) => {
      const next = { ...prev, [key]: value }
      writeTimeThemeConfig(next)
      return next
    })
  }

  // Combine builtin THEME_OPTIONS with custom installed themes
  const allThemeOptions = useMemo(() => {
    const builtin = THEME_OPTIONS
    const custom: typeof builtin = installedThemes
      .filter(t => t.enabled)
      .map(t => ({
        value: t.id,
        label: t.name,
        description: t.description || `v${t.version} by ${t.developer}`,
        icon: MapThemeIcon(t.icon),
        preview: getCustomThemePreview(t),
      }))
    return [...builtin, ...custom]
  }, [installedThemes])

  return (
    <SettingsSection icon={Palette} title={t("settings.themeMode")} description={t("settings.themeModeDesc")} accentIcon>
      {/* Large design-mode preview cards (Windows 11 style). */}
      <div className="rumahl-theme-options grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
        {allThemeOptions.map(opt => {
          const isSelected = selectedTheme === opt.value
          const label = t(`settings.themeOptions.${opt.value}.label`, { defaultValue: opt.label })
          const description = t(`settings.themeOptions.${opt.value}.description`, { defaultValue: opt.description })
          return (
            <button
              key={opt.value}
              onClick={() => setSelectedTheme(opt.value)}
              className={`rumahl-theme-option group flex flex-col gap-2.5 rounded-2xl border p-3 text-left transition-all ${
                isSelected
                  ? 'border-accent bg-accent/10 ring-1 ring-accent/30'
                  : 'border-foreground/10 bg-foreground/[0.03] hover:border-foreground/20 hover:bg-foreground/[0.05]'
              }`}
            >
              <div
                className="rumahl-theme-preview h-16 w-full rounded-xl border border-foreground/10"
                style={{ background: opt.preview }}
              />
              <div>
                <p className="text-[13px] font-medium leading-tight">{label}</p>
                <p className="mt-0.5 text-[11px] leading-tight text-foreground/45">{description}</p>
              </div>
            </button>
          )
        })}
      </div>
      <div className="mt-2 flex items-center gap-2 text-[11px] text-foreground/40">
        <Info size={12} className="shrink-0" />
        <span>Aktiv: <span className="font-medium text-foreground/60 capitalize">{activeTheme}</span> — Einstellung wird pro Benutzer gespeichert</span>
      </div>

      <ToggleRow
        label={t("settings.sleepMode")}
        description={t("settings.sleepModeDesc")}
        checked={sleepMode}
        onCheckedChange={setSleepMode}
      />

      {/* Theme Editor Button */}
      <button
        onClick={() => setEditorOpen(true)}
        className="rumahl-settings-inline-action mt-2 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-medium border border-accent/30 bg-accent/5 text-accent hover:bg-accent/10 transition-all"
      >
        <Palette size={14} weight="fill" />
        Theme-Editor öffnen
      </button>

      <ThemeEditor open={editorOpen} onOpenChange={setEditorOpen} />

      {/* Time-of-day boundaries for the auto theme */}
      {selectedTheme === 'auto' && (
        <div className="mt-4 space-y-2">
          <div className="flex items-center gap-2">
            <Clock size={14} className="text-accent" />
            <p className="text-[12px] font-medium text-foreground/60">{t("settings.timeOfDay")}</p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {([
              { key: 'dayStart' as const, label: t("settings.dayFrom"), range: [0, 12] as const },
              { key: 'eveningStart' as const, label: t("settings.eveningFrom"), range: [12, 22] as const },
              { key: 'nightStart' as const, label: t("settings.nightFrom"), range: [18, 23] as const },
            ]).map(({ key, label, range }) => (
              <label key={key} className="flex flex-col gap-1">
                <span className="text-[11px] text-foreground/45">{label}</span>
                <select
                  value={timeConfig[key]}
                  onChange={(e) => updateTimeBoundary(key, Number(e.target.value))}
                  className="rounded-lg bg-foreground/5 border border-foreground/10 px-2 py-1.5 text-xs text-foreground outline-none focus:border-accent/50"
                >
                  {Array.from({ length: range[1] - range[0] + 1 }, (_, i) => range[0] + i).map((h) => (
                    <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* UI scale (100% / 125% / 150% or auto) — rendered on the Appearance
          tab itself as its own panel (with Verhalten/Zeitplan), so it is not
          duplicated here. See SettingsPage.tsx. */}
    </SettingsSection>
  )
}
