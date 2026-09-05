import { useTranslation } from 'react-i18next'
import { Sparkle } from '@phosphor-icons/react'
import { useTheme } from '@/contexts/ThemeContext'
import { useSurfaceAppearance } from '@/hooks/useSurfaceAppearance'
import { SettingsSection, SliderRow } from './shared'
import { ApprButton, ApprRow, ApprSelect } from './appr'

export function SurfaceAppearanceSettings({ enabled, onEnable }: { enabled: boolean; onEnable: (enabled: boolean) => void }) {
  const { t } = useTranslation()
  const { capabilities } = useTheme()
  const { settings, save, reset } = useSurfaceAppearance()
  const forcedOff = capabilities?.glass_control?.mode === 'force_off'
  return <SettingsSection icon={Sparkle} title={t('settings.surfaceStyle.title')} description={t('settings.surfaceStyle.description')}>
    <ApprRow label={t('settings.surfaceStyle.material')}>
      <ApprSelect value={settings.style} ariaLabel={t('settings.surfaceStyle.material')} onChange={(style) => { save({ ...settings, style }); if (style === 'glass' && !forcedOff) onEnable(true) }} options={['solid', 'glass'].map((value) => ({ value, label: t(`settings.surfaceStyle.${value}`) }))} />
    </ApprRow>
    {settings.style === 'glass' && <div className="mt-4 space-y-4">
      {(!enabled || forcedOff) && <p role="status" className="text-sm text-muted-foreground">{t('settings.surfaceStyle.disabled')}</p>}
      <SliderRow label={t('settings.surfaceStyle.opacity')} value={settings.opacity} min={20} max={95} unit="%" onChange={(opacity) => save({ ...settings, opacity })} />
      <SliderRow label={t('settings.surfaceStyle.blur')} value={settings.blur} min={0} max={60} unit="px" onChange={(blur) => save({ ...settings, blur })} />
      <ApprRow label={t('settings.surfaceStyle.tint')}><input type="color" value={settings.tint} aria-label={t('settings.surfaceStyle.tint')} onChange={(event) => save({ ...settings, tint: event.target.value })} className="h-10 w-16 cursor-pointer rounded-lg border border-border bg-transparent p-1" /></ApprRow>
      <SliderRow label={t('settings.surfaceStyle.tintStrength')} value={settings.tintStrength} min={0} max={40} unit="%" onChange={(tintStrength) => save({ ...settings, tintStrength })} />
    </div>}
    <div className="mt-4 flex justify-end"><ApprButton onClick={reset}>{t('settings.surfaceStyle.reset')}</ApprButton></div>
  </SettingsSection>
}
