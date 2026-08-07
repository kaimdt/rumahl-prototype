// Additional settings + NINA warnings section of the Settings page (lazy-loaded chunk).
import { useCallback, useEffect, useState } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { MagnifyingGlass, MapPin, NavigationArrow, Plus, TextAa, Vibrate, Warning, X } from '@phosphor-icons/react'
import { useLocalStorage } from '@/lib/storage'
import {
  getAutoContrastMode,
  getDeviceTier,
  getEffectiveAutoContrastMode,
  setAutoContrastMode,
  subscribeAutoContrast,
  type AutoContrastMode,
} from '@/lib/autoContrast'
import { authFetch } from '@/lib/authHelpers'
import { toast } from 'sonner'
import { SettingsSection, SliderRow, ToggleRow } from '../SettingsPage'

export function AdditionalSettings() {
  const { t } = useTranslation()
  const [hapticEnabled, setHapticEnabled] = useLocalStorage('ha-haptic-feedback', true)
  const [navLabels, setNavLabels] = useLocalStorage('ha-nav-labels', true)
  const [navStyle, setNavStyle] = useLocalStorage<'pill' | 'classic' | 'minimal'>('ha-nav-style', 'pill')
  const [reducedAnimations, setReducedAnimations] = useLocalStorage('ha-animations-reduced', false)
  const [fontSize, setFontSize] = useLocalStorage<'small' | 'normal' | 'large'>('ha-font-size', 'normal')
  const [compactWidgets, setCompactWidgets] = useLocalStorage('ha-widget-compact', false)
  const [autoContrast, setAutoContrastState] = React.useState<AutoContrastMode>(() => getAutoContrastMode())
  React.useEffect(() => subscribeAutoContrast(setAutoContrastState), [])
  const deviceTier = React.useMemo(() => getDeviceTier(), [])
  const effectiveMode = getEffectiveAutoContrastMode()

  return (
    <>
      {/* Haptic & Interactions */}
      <SettingsSection icon={Vibrate} title="Haptik & Interaktion" description="Vibrationsrückmeldung und Touch-Feedback">
        <ToggleRow
          label={t("settings.hapticFeedback")}
          description="Vibrationsrückmeldung bei Interaktionen (Touch-Geräte)"
          checked={hapticEnabled}
          onCheckedChange={setHapticEnabled}
        />
        <ToggleRow
          label={t("settings.reduceAnimations")}
          description={t("settings.reduceAnimationsDesc")}
          checked={reducedAnimations}
          onCheckedChange={setReducedAnimations}
        />
      </SettingsSection>

      {/* Navigation */}
      <SettingsSection icon={NavigationArrow} title={t('settings.navigation')} description={t('settings.navigationDesc')}>
        <ToggleRow
          label="Beschriftungen anzeigen"
          description="Text-Labels unter den Navigations-Icons"
          checked={navLabels}
          onCheckedChange={setNavLabels}
        />
        <div className="space-y-2">
          <p className="text-[11px] font-medium text-foreground/55">Navigations-Stil</p>
          <div className="grid grid-cols-3 gap-2">
            {([
              { id: 'pill' as const, label: 'Pill', desc: 'Abgerundet' },
              { id: 'classic' as const, label: 'Klassisch', desc: 'Eckig' },
              { id: 'minimal' as const, label: 'Minimal', desc: 'Nur Icons' },
            ]).map(opt => (
              <button
                key={opt.id}
                onClick={() => setNavStyle(opt.id)}
                className={`p-2.5 rounded-xl border-2 transition-all text-center ${
                  navStyle === opt.id
                    ? 'border-accent bg-accent/10'
                    : 'border-foreground/10 bg-foreground/[0.04] hover:border-foreground/20'
                }`}
              >
                <p className="text-xs font-medium">{opt.label}</p>
                <p className="text-[10px] text-foreground/40">{opt.desc}</p>
              </button>
            ))}
          </div>
        </div>
      </SettingsSection>

      {/* Typography & Display */}
      <SettingsSection icon={TextAa} title={t("settings.displayFont")} description={t("settings.displayFontDesc")}>
        <div className="space-y-2">
          <p className="text-[11px] font-medium text-foreground/55">{t("settings.fontSize")}</p>
          <div className="grid grid-cols-3 gap-2">
            {([
              { id: 'small' as const, label: 'Klein', sample: 'Aa', size: 'text-xs' },
              { id: 'normal' as const, label: 'Normal', sample: 'Aa', size: 'text-sm' },
              { id: 'large' as const, label: 'Groß', sample: 'Aa', size: 'text-base' },
            ]).map(opt => (
              <button
                key={opt.id}
                onClick={() => setFontSize(opt.id)}
                className={`p-3 rounded-xl border-2 transition-all text-center ${
                  fontSize === opt.id
                    ? 'border-accent bg-accent/10'
                    : 'border-foreground/10 bg-foreground/[0.04] hover:border-foreground/20'
                }`}
              >
                <p className={`font-semibold ${opt.size} mb-0.5`}>{opt.sample}</p>
                <p className="text-[10px] text-foreground/50">{opt.label}</p>
              </button>
            ))}
          </div>
        </div>
        <ToggleRow
          label="Kompakte Widgets"
          description="Weniger Innenabstand in den Widgets für mehr Inhalt"
          checked={compactWidgets}
          onCheckedChange={setCompactWidgets}
        />
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-medium text-foreground/55">Automatischer Textkontrast</p>
            <span className="text-[10px] text-foreground/55">
              Gerät: <span className="text-foreground/85 font-mono">{deviceTier}</span>
              {autoContrast === 'auto' && (
                <> · aktiv: <span className="text-foreground/85 font-mono">{effectiveMode}</span></>
              )}
            </span>
          </div>
          <p className="text-[11px] text-foreground/50 -mt-1">
            Passt Textfarben auf Glas- und Custom-Theme-Flächen automatisch an (WCAG AA). Einstellung gilt pro Nutzer.
          </p>
          <div className="grid grid-cols-5 gap-2">
            {([
              { id: 'off' as const,      label: 'Aus',       desc: 'Keine Anpassung' },
              { id: 'light' as const,    label: 'Sparsam',   desc: 'Nur bei Theme-Wechsel' },
              { id: 'balanced' as const, label: 'Ausgewogen',desc: 'Nur sichtbarer Bereich' },
              { id: 'full' as const,     label: 'Vollst.',   desc: 'Komplett, reaktiv' },
              { id: 'auto' as const,     label: 'Auto',      desc: 'Nach Geräteleistung' },
            ]).map(opt => (
              <button
                key={opt.id}
                onClick={() => setAutoContrastMode(opt.id)}
                className={`p-2.5 rounded-xl border-2 transition-all text-center ${
                  autoContrast === opt.id
                    ? 'border-accent bg-accent/10'
                    : 'border-foreground/10 bg-foreground/[0.04] hover:border-foreground/20'
                }`}
              >
                <p className="text-xs font-medium">{opt.label}</p>
                <p className="text-[10px] text-foreground/55 leading-tight mt-0.5">{opt.desc}</p>
              </button>
            ))}
          </div>
        </div>
      </SettingsSection>
    </>
  )
}

// ─── NINA Warning Settings Component ───────────────────────────────
interface NinaRegion {
  ars: string
  name: string
  type?: string
}

export function NinaSettingsSection() {
  const [enabled, setEnabled] = useState(false)
  const [regions, setRegions] = useState<NinaRegion[]>([])
  const [pollInterval, setPollInterval] = useState(5)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [warningCount, setWarningCount] = useState(0)
  const [allRegions, setAllRegions] = useState<NinaRegion[]>([])
  const [regionsLoading, setRegionsLoading] = useState(false)

  // Load settings
  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch('/api/nina/settings')
        if (res.ok) {
          const data = await res.json()
          setEnabled(data.enabled ?? false)
          setRegions(data.ars_regions ?? [])
          setPollInterval(data.poll_interval_minutes ?? 5)
        }
      } catch { /* ignore */ }
      // Load warning count
      try {
        const res = await authFetch('/api/nina/warnings')
        if (res.ok) {
          const data = await res.json()
          setWarningCount(data.warnings?.length ?? 0)
        }
      } catch { /* ignore */ }
      setLoading(false)
    })()
  }, [])

  // Fetch all ARS regions when search panel opens
  useEffect(() => {
    if (!showSearch || allRegions.length > 0) return
    setRegionsLoading(true)
    ;(async () => {
      try {
        const res = await authFetch('/api/nina/regions')
        if (res.ok) {
          const data = await res.json()
          setAllRegions(data.regions ?? [])
        }
      } catch { /* ignore */ }
      setRegionsLoading(false)
    })()
  }, [showSearch, allRegions.length])

  const save = useCallback(async (newEnabled: boolean, newRegions: NinaRegion[], newInterval: number) => {
    setSaving(true)
    try {
      const res = await authFetch('/api/nina/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: newEnabled,
          ars_regions: newRegions,
          poll_interval_minutes: newInterval,
        }),
      })
      if (res.ok) {
        toast.success('NINA-Einstellungen gespeichert')
      } else {
        toast.error('Fehler beim Speichern')
      }
    } catch {
      toast.error('Fehler beim Speichern')
    } finally {
      setSaving(false)
    }
  }, [])

  const toggleEnabled = useCallback((v: boolean) => {
    setEnabled(v)
    save(v, regions, pollInterval)
  }, [regions, pollInterval, save])

  const addRegion = useCallback((region: NinaRegion) => {
    if (regions.some(r => r.ars === region.ars)) return
    const next = [...regions, region]
    setRegions(next)
    setSearch('')
    setShowSearch(false)
    save(enabled, next, pollInterval)
  }, [regions, enabled, pollInterval, save])

  const removeRegion = useCallback((ars: string) => {
    const next = regions.filter(r => r.ars !== ars)
    setRegions(next)
    save(enabled, next, pollInterval)
  }, [regions, enabled, pollInterval, save])

  const updateInterval = useCallback((v: number) => {
    setPollInterval(v)
    save(enabled, regions, v)
  }, [enabled, regions, save])

  const filtered = allRegions.filter(r =>
    !regions.some(sel => sel.ars === r.ars) &&
    (!search.trim() || r.name.toLowerCase().includes(search.toLowerCase()) || r.ars.includes(search.trim()) || (r.type ?? '').toLowerCase().includes(search.toLowerCase()))
  )

  if (loading) return null

  return (
    <SettingsSection
      icon={Warning}
      title="NINA Warnungen"
      description={`Wetterwarnungen & Katastrophenschutz${warningCount > 0 ? ` (${warningCount} aktiv)` : ''}`}
      defaultOpen={false}
    >
      <ToggleRow
        label="NINA Warnungen aktivieren"
        description="Empfange Warn­meldungen direkt vom Bundesamt für Bevölkerungsschutz"
        checked={enabled}
        onCheckedChange={toggleEnabled}
        disabled={saving}
      />

      {enabled && (
        <div className="space-y-3 mt-2">
          {/* Selected regions */}
          <div>
            <p className="text-[11px] font-medium text-foreground/55 uppercase tracking-wider mb-2">
              Überwachte Regionen ({regions.length})
            </p>
            {regions.length === 0 ? (
              <p className="text-xs text-foreground/40 italic px-1">
                Keine Regionen ausgewählt — füge unten Regionen hinzu
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {regions.map(r => (
                  <div
                    key={r.ars}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/15 border border-accent/25 text-xs font-medium text-foreground/85"
                  >
                    <MapPin size={12} weight="fill" className="text-accent shrink-0" />
                    {r.name}
                    <button
                      onClick={() => removeRegion(r.ars)}
                      className="ml-1 p-0.5 rounded-full hover:bg-foreground/10 transition-colors"
                      aria-label={`${r.name} entfernen`}
                    >
                      <X size={10} weight="bold" className="text-foreground/50" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Region search */}
          <div>
            {!showSearch ? (
              <button
                onClick={() => setShowSearch(true)}
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-foreground/[0.04] border border-foreground/8 text-xs text-foreground/60 hover:bg-foreground/[0.07] transition-colors w-full"
              >
                <Plus size={14} weight="bold" />
                Region hinzufügen
              </button>
            ) : (
              <div className="space-y-1.5">
                <div className="relative">
                  <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground/40" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Stadt, Landkreis oder Bundesland suchen…"
                    className="w-full pl-8 pr-8 py-2 rounded-xl bg-foreground/[0.04] border border-foreground/8 text-sm text-foreground placeholder:text-foreground/35 outline-none focus:border-accent/40 transition-colors"
                    autoFocus
                  />
                  <button
                    onClick={() => { setShowSearch(false); setSearch('') }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-foreground/10"
                  >
                    <X size={12} className="text-foreground/40" />
                  </button>
                </div>
                {
                  <div className="max-h-64 overflow-y-auto rounded-xl bg-foreground/[0.03] border border-foreground/8 divide-y divide-foreground/5">
                    {regionsLoading ? (
                      <p className="text-xs text-foreground/40 px-3 py-2.5 text-center">
                        Regionen werden geladen…
                      </p>
                    ) : filtered.length === 0 ? (
                      <p className="text-xs text-foreground/40 px-3 py-2.5 text-center">
                        Keine Region gefunden
                      </p>
                    ) : (
                      filtered.map(r => (
                        <button
                          key={r.ars}
                          onClick={() => addRegion(r)}
                          className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-foreground/[0.05] transition-colors"
                        >
                          <MapPin size={14} className="text-foreground/40 shrink-0" />
                          <div className="flex flex-col min-w-0">
                            <span className="text-xs font-medium text-foreground/80 truncate">{r.name}</span>
                            {r.type && <span className="text-[10px] text-foreground/30">{r.type}</span>}
                          </div>
                          <span className="text-[10px] text-foreground/30 ml-auto tabular-nums shrink-0">{r.ars}</span>
                        </button>
                      ))
                    )}
                  </div>
                }
                {/* Custom ARS input */}
                <p className="text-[10px] text-foreground/35 px-1">
                  Tipp: Du kannst auch einen eigenen 12-stelligen ARS-Code eingeben
                </p>
                {search.trim().length === 12 && /^\d{12}$/.test(search.trim()) && !regions.some(r => r.ars === search.trim()) && (
                  <button
                    onClick={() => addRegion({ ars: search.trim(), name: `Region ${search.trim()}` })}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl bg-accent/10 border border-accent/20 text-xs text-foreground/70 hover:bg-accent/15 transition-colors w-full"
                  >
                    <Plus size={14} weight="bold" className="text-accent" />
                    ARS-Code "{search.trim()}" hinzufügen
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Poll interval */}
          <SliderRow
            label="Abfrageintervall"
            value={pollInterval}
            min={1}
            max={30}
            unit=" min"
            onChange={updateInterval}
            disabled={saving}
          />

          {/* Current warnings count */}
          {warningCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-orange-500/10 border border-orange-500/20">
              <Warning size={16} weight="fill" className="text-orange-500 shrink-0" />
              <span className="text-xs font-medium text-foreground/80">
                {warningCount} aktive Warnung{warningCount !== 1 ? 'en' : ''}
              </span>
            </div>
          )}
        </div>
      )}
    </SettingsSection>
  )
}
