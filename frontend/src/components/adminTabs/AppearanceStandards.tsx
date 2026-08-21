import { useCallback, useEffect, useState } from 'react'
import { Drop, Palette } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { authFetch } from '@/lib/authHelpers'
import { AdminCard } from '../AdminPanel'
import { toast } from 'sonner'

interface AccentDefaults { mode: 'auto' | 'static'; staticColor: string; intensity: number }
interface GlassDefaults { enabled: boolean; blurIntensity: number; transparency: number; cardRadius: number; borderAlpha: number }
interface TimeDefaults { dayStart: number; eveningStart: number; nightStart: number }

const DEFAULTS = {
  theme: 'auto',
  autoTheme: true,
  accent: { mode: 'auto', staticColor: '#3b82f6', intensity: 60 } as AccentDefaults,
  glass: { enabled: true, blurIntensity: 40, transparency: 1, cardRadius: 12, borderAlpha: 0.12 } as GlassDefaults,
  time: { dayStart: 6, eveningStart: 18, nightStart: 21 } as TimeDefaults,
}

/**
 * AppearanceStandardsTab — global (admin-set) defaults stored in
 * system_preferences. Users who haven't customized a key fall back to these.
 */
export function AppearanceStandardsTab() {
  const { t } = useTranslation()
  const [theme, setTheme] = useState(DEFAULTS.theme)
  const [autoTheme, setAutoTheme] = useState(DEFAULTS.autoTheme)
  const [accent, setAccent] = useState(DEFAULTS.accent)
  const [glass, setGlass] = useState(DEFAULTS.glass)
  const [time, setTime] = useState(DEFAULTS.time)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await authFetch('/api/config/system/preferences')
      if (!res.ok) return
      const prefs = (await res.json()) as Array<{ preference_key: string; preference_value: unknown }>
      const map: Record<string, unknown> = {}
      for (const p of prefs) map[p.preference_key] = p.preference_value
      if (typeof map['defaults.theme'] === 'string') setTheme(map['defaults.theme'] as string)
      if (typeof map['defaults.auto_theme'] === 'boolean') setAutoTheme(map['defaults.auto_theme'] as boolean)
      if (map['defaults.accent'] && typeof map['defaults.accent'] === 'object') setAccent({ ...DEFAULTS.accent, ...(map['defaults.accent'] as object) })
      if (map['defaults.glass'] && typeof map['defaults.glass'] === 'object') setGlass({ ...DEFAULTS.glass, ...(map['defaults.glass'] as object) })
      if (map['defaults.time_boundaries'] && typeof map['defaults.time_boundaries'] === 'object') setTime({ ...DEFAULTS.time, ...(map['defaults.time_boundaries'] as object) })
    } catch {
      // backend unreachable
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const save = async () => {
    setSaving(true)
    try {
      const entries: Array<[string, unknown]> = [
        ['defaults.theme', theme],
        ['defaults.auto_theme', autoTheme],
        ['defaults.accent', accent],
        ['defaults.glass', glass],
        ['defaults.time_boundaries', time],
      ]
      await Promise.all(entries.map(([preference_key, preference_value]) =>
        authFetch('/api/config/system/preferences', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ preference_key, preference_value }),
        }),
      ))
      toast.success(t('appearanceStandards.saved'))
    } catch {
      toast.error(t('appearanceStandards.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const field = 'rumahl-field-sm'

  return (
    <div className="space-y-4">
      <AdminCard icon={Palette} title={t('admin.appearanceStandards')} description={t('admin.appearanceStandardsDesc')}>
        {loading ? (
          <p className="text-sm text-foreground/45">{t('appearanceStandards.loading')}</p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-foreground/55">
                <span className="mb-1 block">{t('appearanceStandards.defaultTheme')}</span>
                <select value={theme} onChange={(e) => setTheme(e.target.value)} className={field}>
                  {['auto', 'day', 'day-classic', 'light', 'evening', 'night', 'sleep'].map((id) => (
                    <option key={id} value={id}>{id}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-end gap-2 pb-2 text-xs text-foreground/70">
                <input type="checkbox" checked={autoTheme} onChange={(e) => setAutoTheme(e.target.checked)} />
                {t('appearanceStandards.autoThemeDefault')}
              </label>
            </div>

            <div>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-foreground/70"><Drop size={14} className="text-accent" /> {t('appearanceStandards.accentDefaults')}</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="text-xs text-foreground/55">
                  <span className="mb-1 block">{t('appearanceStandards.mode')}</span>
                  <select value={accent.mode} onChange={(e) => setAccent((v) => ({ ...v, mode: e.target.value as 'auto' | 'static' }))} className={field}>
                    <option value="auto">{t('appearanceStandards.modeAuto')}</option>
                    <option value="static">{t('appearanceStandards.modeStatic')}</option>
                  </select>
                </label>
                <label className="text-xs text-foreground/55">
                  <span className="mb-1 block">{t('appearanceStandards.intensity')}: {accent.intensity}%</span>
                  <input type="range" min={0} max={100} value={accent.intensity} onChange={(e) => setAccent((v) => ({ ...v, intensity: Number(e.target.value) }))} className="w-full" />
                </label>
                {accent.mode === 'static' && (
                  <label className="text-xs text-foreground/55">
                    <span className="mb-1 block">{t('appearanceStandards.color')}</span>
                    <input type="color" value={accent.staticColor} onChange={(e) => setAccent((v) => ({ ...v, staticColor: e.target.value }))} className="h-9 w-full rounded-md border border-foreground/10" />
                  </label>
                )}
              </div>
            </div>

            <div>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-foreground/70"><Drop size={14} className="text-accent" /> {t('appearanceStandards.glassDefaults')}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs text-foreground/55">
                  <span className="mb-1 block">{t('appearanceStandards.blur')}: {glass.blurIntensity}px</span>
                  <input type="range" min={0} max={60} value={glass.blurIntensity} onChange={(e) => setGlass((v) => ({ ...v, blurIntensity: Number(e.target.value) }))} className="w-full" />
                </label>
                <label className="text-xs text-foreground/55">
                  <span className="mb-1 block">{t('appearanceStandards.transparency')}: {Math.round(glass.transparency * 100)}%</span>
                  <input type="range" min={50} max={150} value={Math.round(glass.transparency * 100)} onChange={(e) => setGlass((v) => ({ ...v, transparency: Number(e.target.value) / 100 }))} className="w-full" />
                </label>
              </div>
            </div>

            <div>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-foreground/70"><Drop size={14} className="text-accent" /> {t('appearanceStandards.timeDefaults')}</p>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { key: 'dayStart' as const, label: t('appearanceStandards.dayFrom'), range: [0, 12] as const },
                  { key: 'eveningStart' as const, label: t('appearanceStandards.eveningFrom'), range: [12, 22] as const },
                  { key: 'nightStart' as const, label: t('appearanceStandards.nightFrom'), range: [18, 23] as const },
                ]).map(({ key, label, range }) => (
                  <label key={key} className="text-xs text-foreground/55">
                    <span className="mb-1 block">{label}</span>
                    <select value={time[key]} onChange={(e) => setTime((v) => ({ ...v, [key]: Number(e.target.value) }))} className={field}>
                      {Array.from({ length: range[1] - range[0] + 1 }, (_, i) => range[0] + i).map((h) => (
                        <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex justify-end">
              <button type="button" disabled={saving} onClick={() => void save()} className="rumahl-primary-button-sm">
                {saving ? t('appearanceStandards.saving') : t('appearanceStandards.save')}
              </button>
            </div>
          </div>
        )}
      </AdminCard>
    </div>
  )
}
