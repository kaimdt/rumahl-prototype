// Theme picker section of the Settings page (lazy-loaded chunk).
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Info, Palette } from '@phosphor-icons/react'
import { useTheme } from '@/contexts/ThemeContext'
import { ThemeEditor } from '@/components/ThemeEditor'
import { getCustomThemePreview, MapThemeIcon, SettingsSection, THEME_OPTIONS } from '../SettingsPage'

export function ThemePickerSection() {
  const { t } = useTranslation()
  const { selectedTheme, setSelectedTheme, theme: activeTheme, availableThemes, installedThemes } = useTheme()
  const [editorOpen, setEditorOpen] = useState(false)

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
      <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
        {allThemeOptions.map(opt => {
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

      {/* Theme Editor Button */}
      <button
        onClick={() => setEditorOpen(true)}
        className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-medium border border-accent/30 bg-accent/5 text-accent hover:bg-accent/10 transition-all"
      >
        <Palette size={14} weight="fill" />
        Theme-Editor öffnen
      </button>

      <ThemeEditor open={editorOpen} onOpenChange={setEditorOpen} />
    </SettingsSection>
  )
}