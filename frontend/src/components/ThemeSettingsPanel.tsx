/**
 * ThemeSettingsPanel – Complete theme settings panel.
 *
 * Renders ALL theme capabilities below the theme picker:
 *   - Design modes (manual switching between time-based modes)
 *   - Accent presets (color picker for theme-defined accents)
 *   - Glass effect controls
 *   - Custom settings (toggles, sliders, selects, colors, text)
 */
import { useTheme } from '@/contexts/ThemeContext'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { useTranslation } from 'react-i18next'
import { Palette, Sun, MoonStars, Fire, DropHalf, PaintBrush, Gear } from '@phosphor-icons/react'

export function ThemeSettingsPanel() {
  const {
    capabilities,
    customSettings,
    updateCustomSetting,
    themeResponse,
    designModes,
    activeDesignMode,
    setActiveDesignMode,
    accentLocked,
    glassLocked,
  } = useTheme()
  const { t } = useTranslation()
  const themeNamespace = themeResponse?.theme_id ? `theme-${themeResponse.theme_id}` : undefined

  const hasContent = !!(
    capabilities?.design_modes?.length ||
    capabilities?.accent_control?.presets?.length ||
    capabilities?.glass_control ||
    capabilities?.custom_settings?.length
  )
  if (!hasContent) return null

  const ModeIcon = ({ id }: { id: string }) => {
    const icons: Record<string, React.ComponentType<{ size: number }>> = { Sun, Fire, MoonStars }
    const idx = capabilities?.design_modes?.findIndex(m => m.id === id) ?? 0
    const Icon = icons[Object.keys(icons)[idx % 3]] || Palette
    return <Icon size={16} />
  }

  return (
    <div className="space-y-6">
      {/* ── Design Modes ──────────────────────────────────── */}
      {capabilities?.design_modes && capabilities.design_modes.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Sun size={16} className="text-accent" weight="fill" />
            <h3 className="text-sm font-semibold text-foreground">Design-Modi</h3>
            {capabilities.auto_behavior?.mode === 'time' && (
              <span className="text-[10px] text-foreground/40 ml-auto">Auto-Wechsel nach Tageszeit</span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {capabilities.design_modes.map((mode) => {
              const isActive = activeDesignMode === mode.id
              return (
                <button
                  key={mode.id}
                  onClick={() => setActiveDesignMode(mode.id)}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all text-center ${
                    isActive
                      ? 'border-accent bg-accent/10 shadow-sm'
                      : 'border-foreground/[0.08] bg-foreground/[0.03] hover:border-foreground/[0.18]'
                  }`}
                >
                  <ModeIcon id={mode.id} />
                  <span className="text-[11px] font-medium leading-tight">{mode.name}</span>
                  {mode.time_start && (
                    <span className="text-[9px] text-foreground/40">
                      {mode.time_start}–{mode.time_end}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Accent Presets ────────────────────────────────── */}
      {capabilities?.accent_control?.presets && capabilities.accent_control.presets.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <PaintBrush size={16} className="text-accent" weight="fill" />
            <h3 className="text-sm font-semibold text-foreground">Akzentfarbe</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {capabilities.accent_control.presets.map((preset) => {
              const isActive = !accentLocked || document.documentElement.style.getPropertyValue('--accent') === preset.color
              return (
                <button
                  key={preset.name}
                  onClick={() => {
                    document.documentElement.style.setProperty('--accent', preset.color)
                    document.documentElement.style.setProperty('--ring', preset.color)
                    // Keep rgba(var(--accent-rgb)) consumers (widget glows) in sync
                    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(preset.color)
                    if (m) {
                      document.documentElement.style.setProperty('--accent-rgb', `${parseInt(m[1], 16)} ${parseInt(m[2], 16)} ${parseInt(m[3], 16)}`)
                    }
                    document.documentElement.setAttribute('data-accent-locked', 'true')
                    updateCustomSetting('__accent', preset.color)
                  }}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                    isActive
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-foreground/[0.1] text-foreground/60 hover:border-foreground/[0.2]'
                  }`}
                >
                  <span
                    className="w-3.5 h-3.5 rounded-full border border-foreground/[0.15]"
                    style={{ backgroundColor: preset.color }}
                  />
                  {preset.name}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Glass Control ─────────────────────────────────── */}
      {capabilities?.glass_control && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <DropHalf size={16} className="text-accent" weight="fill" />
            <h3 className="text-sm font-semibold text-foreground">Glas-Effekt</h3>
          </div>
          <div className="flex items-center justify-between p-3 rounded-xl bg-foreground/[0.03] border border-foreground/[0.06]">
            <Label className="text-sm text-foreground">
              {glassLocked ? 'Theme-gesteuert' : 'Benutzerdefiniert'}
            </Label>
            {capabilities.glass_control.mode === 'force_values' && (
              <span className="text-[11px] text-foreground/40">
                Blur: {capabilities.glass_control.blur || '24px'} · Opacity: {capabilities.glass_control.opacity || '0.7'}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Custom Settings ───────────────────────────────── */}
      {capabilities?.custom_settings && capabilities.custom_settings.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Gear size={16} className="text-accent" weight="fill" />
            <h3 className="text-sm font-semibold text-foreground">Feineinstellungen</h3>
          </div>
          <div className="space-y-3">
            {capabilities.custom_settings.map((setting) => {
              const value = customSettings[setting.id] ?? setting.default_value
              const settingName = setting.name_key && themeNamespace
                ? t(setting.name_key, { ns: themeNamespace })
                : setting.name
              const settingDescription = setting.description_key && themeNamespace
                ? t(setting.description_key, { ns: themeNamespace })
                : setting.description

              return (
                <div
                  key={setting.id}
                  className="flex items-center justify-between gap-4 p-3 rounded-xl bg-foreground/[0.03] border border-foreground/[0.06]"
                >
                  <div className="flex-1 min-w-0">
                    <Label className="text-sm font-medium text-foreground cursor-pointer">
                      {settingName}
                    </Label>
                    {settingDescription && (
                      <p className="text-[11px] text-foreground/40 mt-0.5">
                        {settingDescription}
                      </p>
                    )}
                  </div>

                  <div className="flex-shrink-0">
                    {setting.setting_type === 'toggle' && (
                      <Switch
                        checked={Boolean(value)}
                        onCheckedChange={(checked) => updateCustomSetting(setting.id, checked)}
                      />
                    )}

                    {setting.setting_type === 'select' && setting.options && (
                      <select
                        value={String(value)}
                        onChange={(e) => updateCustomSetting(setting.id, e.target.value)}
                        className="px-3 py-1.5 rounded-lg bg-foreground/[0.06] border border-foreground/[0.1] text-sm text-foreground focus:outline-none focus:border-accent"
                      >
                        {setting.options.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label_key && themeNamespace ? t(opt.label_key, { ns: themeNamespace }) : opt.label}
                          </option>
                        ))}
                      </select>
                    )}

                    {setting.setting_type === 'slider' && (
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min={setting.min ?? 0}
                          max={setting.max ?? 100}
                          step={setting.step ?? 1}
                          value={Number(value)}
                          onChange={(e) => updateCustomSetting(setting.id, Number(e.target.value))}
                          className="w-24 h-1.5 accent-accent"
                        />
                        <span className="text-xs text-foreground/50 w-8 tabular-nums">
                          {String(value)}
                        </span>
                      </div>
                    )}

                    {setting.setting_type === 'color' && (
                      <div className="relative">
                        <input
                          type="color"
                          value={String(value)}
                          onChange={(e) => updateCustomSetting(setting.id, e.target.value)}
                          className="w-8 h-8 rounded-lg border border-foreground/[0.1] cursor-pointer"
                          style={{ backgroundColor: String(value) }}
                        />
                      </div>
                    )}

                    {setting.setting_type === 'text' && (
                      <input
                        type="text"
                        value={String(value)}
                        onChange={(e) => updateCustomSetting(setting.id, e.target.value)}
                        className="w-32 px-2 py-1.5 rounded-lg bg-foreground/[0.06] border border-foreground/[0.1] text-sm text-foreground focus:outline-none focus:border-accent"
                      />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
