import { useTranslation } from 'react-i18next'
import { useTheme } from '@/contexts/ThemeContext'
import { ApprSelect } from './appr'

export function ThemeColorModeControl() {
  const { t } = useTranslation()
  const { selectedTheme, setSelectedTheme, setAutoTheme, setSleepMode, designModes, activeDesignMode, setActiveDesignMode } = useTheme()
  const builtin = ['auto', 'day', 'day-classic', 'light', 'evening', 'night', 'sleep', 'midnight'].includes(selectedTheme)
  if (!builtin) return <div className="space-y-1">
    <ApprSelect value={activeDesignMode} ariaLabel={t('settings.accentMode')} onChange={setActiveDesignMode}
      options={designModes.length ? [...(designModes.some((mode) => mode.id === activeDesignMode) ? [] : [{ value: activeDesignMode, label: t('settings.colorSupport.themeDefined') }]), ...designModes.map((mode) => ({ value: mode.id, label: mode.name }))] : [{ value: activeDesignMode, label: t('settings.colorSupport.themeDefined') }]} />
    <p className="text-xs text-muted-foreground">{t(designModes.length > 1 ? 'settings.colorSupport.customModes' : 'settings.colorSupport.fixed')}</p>
  </div>
  const value = selectedTheme === 'auto' ? 'auto' : ['day', 'light'].includes(selectedTheme) ? 'light' : 'dark'
  return <ApprSelect value={value} ariaLabel={t('settings.accentMode')} onChange={(mode) => {
    setSleepMode(false)
    if (mode === 'auto') setAutoTheme(true)
    setSelectedTheme(mode === 'light' ? 'day' : mode === 'dark' ? 'night' : 'auto')
  }} options={['auto', 'light', 'dark'].map((mode) => ({ value: mode, label: t(`settings.shellAppearance.${mode}`) }))} />
}
