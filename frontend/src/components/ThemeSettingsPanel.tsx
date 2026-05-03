/**
 * ThemeSettingsPanel – Renders custom theme settings in the Appearance tab.
 *
 * When a theme provides `capabilities.custom_settings`, this component
 * renders the appropriate form controls (toggle, select, slider, color, text)
 * below the theme switcher card.
 *
 * IMPORTANT: This must NOT hide or disable the theme switcher card itself.
 */

import { useTheme } from '@/contexts/ThemeContext'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'

export function ThemeSettingsPanel() {
  const { capabilities, customSettings, updateCustomSetting } = useTheme()

  if (!capabilities?.custom_settings || capabilities.custom_settings.length === 0) {
    return null
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-6 h-6 rounded-lg bg-accent/15 flex items-center justify-center">
          <span className="text-accent text-xs font-bold">🎨</span>
        </div>
        <h3 className="text-sm font-semibold text-foreground">
          Theme-Einstellungen
        </h3>
      </div>

      <div className="space-y-3">
        {capabilities.custom_settings.map((setting) => {
          const value = customSettings[setting.id] ?? setting.default_value

          return (
            <div
              key={setting.id}
              className="flex items-center justify-between gap-4 p-3 rounded-xl bg-foreground/[0.03] border border-foreground/[0.06]"
            >
              <div className="flex-1 min-w-0">
                <Label className="text-sm font-medium text-foreground cursor-pointer">
                  {setting.name}
                </Label>
                {setting.description && (
                  <p className="text-[11px] text-foreground/40 mt-0.5">
                    {setting.description}
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
                        {opt.label}
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
  )
}
