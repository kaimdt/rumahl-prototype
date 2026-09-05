import { useSurfaceAppearance } from '@/hooks/useSurfaceAppearance'
import { useTranslation } from 'react-i18next'
import { SlidersHorizontal } from '@phosphor-icons/react'
import { useShellAppearance } from '@/hooks/useShellAppearance'
import { SettingsSection, SliderRow } from './shared'
import { ApprButton, ApprRow, ApprSelect, ApprToggle } from './appr'

export function ShellAppearanceSettings({ onEnableGlass }: { onEnableGlass: (enabled: boolean) => void }) {
  const { t } = useTranslation()
  const { settings, save, reset } = useShellAppearance()
  const { settings: surface, save: saveSurface } = useSurfaceAppearance()
  return (
    <SettingsSection icon={SlidersHorizontal} title={t('settings.shellAppearance.title')} description={t('settings.shellAppearance.description')}>
      <ApprRow label={t('settings.shellAppearance.material')}>
        <ApprSelect value={settings.material} ariaLabel={t('settings.shellAppearance.material')} onChange={(material) => { save({ ...settings, material }); if (material === 'glass') onEnableGlass(true) }}
          options={['solid', 'glass', 'transparent'].map((value) => ({ value, label: t(`settings.shellAppearance.${value}`) }))} />
      </ApprRow>
      <ApprRow label={t('settings.shellAppearance.contrast')} description={t('settings.shellAppearance.contrastHint')}>
        <ApprSelect value={settings.contrast} ariaLabel={t('settings.shellAppearance.contrast')} onChange={(contrast) => save({ ...settings, contrast })}
          options={['auto', 'light', 'dark'].map((value) => ({ value, label: t(`settings.shellAppearance.${value}`) }))} />
      </ApprRow>
      <ApprToggle label={t('settings.shellAppearance.border')} checked={settings.border} onCheckedChange={(border) => save({ ...settings, border })} />
      {settings.material === 'glass' && <SliderRow label={t('settings.shellAppearance.blur')} value={surface.style === 'glass' ? surface.blur : settings.blur} min={0} max={surface.style === 'glass' ? 60 : 40} unit="px" onChange={(blur) => surface.style === 'glass' ? saveSurface({ ...surface, blur }) : save({ ...settings, blur })} />}
      <div className="mt-4 flex justify-end"><ApprButton onClick={reset}>{t('settings.shellAppearance.reset')}</ApprButton></div>
    </SettingsSection>
  )
}
