// Additional settings + NINA warnings section of the Settings page (lazy-loaded chunk).
import { useCallback, useEffect, useMemo, useState } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { MagnifyingGlass, MapPin, NavigationArrow, Plus, TextAa, Users, Vibrate, Warning, X, Keyboard, FileCode, FilmStrip, Globe } from '@phosphor-icons/react'
import { useLocalStorage } from '@/lib/storage'
import { useAuth } from '@/contexts/AuthContext'
import { useInstalledApps } from '@/hooks/useInstalledApps'
import { SYSTEM_OS_APPS } from '@/lib/osAppRegistry'
import { SHORTCUTS, comboFromEvent, customizedIds, formatCombo, getCombo, resetCombo, setCombo, type ShortcutDefinition } from '@/lib/shortcutRegistry'
import { FILE_TYPE_CATEGORIES, appsForCategory, getDefaultAppForType, setDefaultAppForType, type FileTypeCategory } from '@/lib/fileTypeRegistry'
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
import { SettingsSection, SliderRow, ToggleRow } from './shared'

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

// ─── Family profiles (admin) ──────────────────────────────────────────────
// Child profiles restrict which apps appear in the dock, launcher and
// command palette (`allowed_app_ids` whitelist on the user's profile).

interface FamilyUserEntry {
  id: string
  username: string
  display_name?: string | null
  role: string
  is_admin: boolean
  profile_type?: string
  restrictions?: { allowed_app_ids?: string[] }
}

export function FamilyProfilesSection() {
  const { t } = useTranslation()
  const { user: currentUser } = useAuth()
  const { installedApps } = useInstalledApps()
  const [users, setUsers] = useState<FamilyUserEntry[]>([])
  const [drafts, setDrafts] = useState<Record<string, { profileType: string; allowed: Set<string> }>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [guestEnabled, setGuestEnabled] = useState(false)
  const [guestLoading, setGuestLoading] = useState(true)

  // Guest mode master switch (system setting).
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await authFetch('/api/admin/settings/security.guest_mode_enabled')
        if (res.ok) {
          const data = await res.json()
          if (alive) setGuestEnabled(data.value === true)
        }
      } catch {
        // backend unreachable
      } finally {
        if (alive) setGuestLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const toggleGuest = async (enabled: boolean) => {
    setGuestEnabled(enabled)
    try {
      const res = await authFetch('/api/admin/settings/security.guest_mode_enabled', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: enabled }),
      })
      if (!res.ok) {
        setGuestEnabled(!enabled)
        toast.error(t('settings.profileSaveFailed'))
      } else {
        toast.success(t('settings.guestModeSaved'))
      }
    } catch {
      setGuestEnabled(!enabled)
      toast.error(t('settings.profileSaveFailed'))
    }
  }

  const appOptions = useMemo(() => {
    const system = SYSTEM_OS_APPS.map((app) => ({
      id: app.id,
      name: app.nameKey ? t(app.nameKey, app.fallbackName) : app.fallbackName,
    }))
    const extra = installedApps.map((app) => ({ id: app.pageId, name: app.fallbackName }))
    const seen = new Set<string>()
    return [...system, ...extra].filter((app) => (seen.has(app.id) ? false : (seen.add(app.id), true)))
  }, [t, installedApps])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await authFetch('/api/admin/users/with-profiles')
        if (!res.ok) return
        const data = await res.json() as { users: FamilyUserEntry[] }
        if (!alive) return
        setUsers(data.users || [])
        const initial: Record<string, { profileType: string; allowed: Set<string> }> = {}
        for (const u of data.users || []) {
          initial[u.id] = {
            profileType: u.profile_type || 'standard',
            allowed: new Set(u.restrictions?.allowed_app_ids || []),
          }
        }
        setDrafts(initial)
      } catch {
        // backend unreachable
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const toggleApp = (userId: string, appId: string) => {
    setDrafts((current) => {
      const draft = current[userId]
      if (!draft) return current
      const next = new Set(draft.allowed)
      if (next.has(appId)) next.delete(appId)
      else next.add(appId)
      return { ...current, [userId]: { ...draft, allowed: next } }
    })
  }

  const saveUser = async (entry: FamilyUserEntry) => {
    const draft = drafts[entry.id]
    if (!draft) return
    setSaving(entry.id)
    try {
      const res = await authFetch(`/api/admin/users/${entry.id}/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile_type: draft.profileType,
          restrictions: draft.profileType === 'child' ? { allowed_app_ids: [...draft.allowed].sort() } : {},
        }),
      })
      if (res.ok) {
        toast.success(t('settings.profileSaved'))
      } else {
        toast.error(t('settings.profileSaveFailed'))
      }
    } catch {
      toast.error(t('settings.profileSaveFailed'))
    } finally {
      setSaving(null)
    }
  }

  const editable = users.filter((u) => !u.is_admin)

  return (
    <SettingsSection icon={Users} title={t('settings.familyProfiles')} description={t('settings.familyProfilesDesc')}>
      {/* Guest mode master switch */}
      <div className="px-5 pb-4">
        <ToggleRow
          label={t('settings.guestMode')}
          description={t('settings.guestModeDesc')}
          checked={guestEnabled}
          disabled={guestLoading}
          onCheckedChange={(value) => void toggleGuest(Boolean(value))}
        />
      </div>
      {loading ? (
        <p className="px-5 pb-5 text-sm text-foreground/45">{t('common.loading')}</p>
      ) : editable.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-foreground/45">{t('settings.familyNoUsers')}</p>
      ) : (
        <div className="space-y-3 px-5 pb-5">
          {editable.map((entry) => {
            const draft = drafts[entry.id]
            if (!draft) return null
            const isChild = draft.profileType === 'child'
            return (
              <div key={entry.id} className="rumahl-card p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground/90">
                      {entry.display_name || entry.username}
                    </p>
                    <p className="text-[11px] text-foreground/45">@{entry.username}</p>
                  </div>
                  <div className="flex items-center gap-1 rounded-xl bg-foreground/6 p-1">
                    {(['standard', 'child'] as const).map((kind) => (
                      <button
                        key={kind}
                        type="button"
                        onClick={() => setDrafts((current) => ({
                          ...current,
                          [entry.id]: { ...draft, profileType: kind },
                        }))}
                        className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                          draft.profileType === kind ? 'bg-accent text-white' : 'text-foreground/55 hover:text-foreground'
                        }`}
                      >
                        {t(`settings.profileKind.${kind}`)}
                      </button>
                    ))}
                  </div>
                </div>

                {isChild && (
                  <div className="mt-3">
                    <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-foreground/45">
                      {t('settings.profileRestrictions')}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {appOptions.map((app) => {
                        const on = draft.allowed.has(app.id)
                        return (
                          <button
                            key={app.id}
                            type="button"
                            onClick={() => toggleApp(entry.id, app.id)}
                            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                              on
                                ? 'border-accent/40 bg-accent/15 text-accent'
                                : 'border-foreground/10 bg-foreground/4 text-foreground/60 hover:border-foreground/20'
                            }`}
                          >
                            {app.name}
                          </button>
                        )
                      })}
                    </div>
                    <p className="mt-2 text-[11px] text-foreground/40">
                      {draft.allowed.size === 0 ? t('settings.profileNoRestrictions') : `${draft.allowed.size} ${t('settings.profileAllowedCount')}`}
                    </p>
                  </div>
                )}

                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    disabled={saving === entry.id}
                    onClick={() => void saveUser(entry)}
                    className="rumahl-primary-button"
                  >
                    {saving === entry.id ? t('common.saving') : t('common.save')}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </SettingsSection>
  )
}

// ─── Global keyboard shortcuts (Package 0, Feature 7) ────────────────────

export function KeyboardShortcutsSection() {
  const { t } = useTranslation()
  const [recording, setRecording] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const customized = customizedIds()

  // Record a new combo while a shortcut is in recording mode.
  useEffect(() => {
    if (!recording) return
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      const combo = comboFromEvent(event)
      if (combo) {
        setCombo(recording, combo)
        setRecording(null)
        setTick((v) => v + 1)
      } else {
        setRecording(null) // Escape cancels
        setTick((v) => v + 1)
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [recording])

  return (
    <SettingsSection icon={Keyboard} title={t('shortcuts.title')} description={t('shortcuts.desc')}>
      <div className="space-y-2 px-5 pb-5">
        {SHORTCUTS.map((shortcut: ShortcutDefinition) => {
          const combo = getCombo(shortcut.id)
          const isCustom = customized.has(shortcut.id)
          const isRecording = recording === shortcut.id
          return (
            <div key={shortcut.id} className="flex items-center justify-between gap-3 rumahl-card px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground/90">{t(shortcut.labelKey)}</p>
                <p className="text-[11px] text-foreground/45">{t(shortcut.descKey)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {isCustom && (
                  <button
                    type="button"
                    onClick={() => { resetCombo(shortcut.id); setTick((v) => v + 1) }}
                    className="rounded-lg px-2 py-1 text-[11px] font-semibold text-foreground/45 transition-colors hover:bg-foreground/10 hover:text-foreground"
                    title={t('shortcuts.reset')}
                  >
                    {t('shortcuts.reset')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setRecording(isRecording ? null : shortcut.id)}
                  className={`rounded-xl border px-3 py-1.5 font-mono text-xs font-semibold transition-colors ${
                    isRecording
                      ? 'border-accent/50 bg-accent/15 text-accent'
                      : 'border-foreground/10 bg-foreground/5 text-foreground/70 hover:border-foreground/20'
                  }`}
                >
                  {isRecording ? t('shortcuts.recording') : formatCombo(combo)}
                </button>
              </div>
            </div>
          )
        })}
        <p className="pt-1 text-[11px] text-foreground/40">{t('shortcuts.hint')}</p>
      </div>
    </SettingsSection>
  )
}

// ─── Default apps / MIME associations (Package 0, Feature 6) ──────────────

export function DefaultAppsSection() {
  const { t } = useTranslation()
  const [, forceRender] = useState(0)

  const changeDefault = (category: FileTypeCategory, value: string) => {
    setDefaultAppForType(category.key, value === 'none' ? null : value)
    forceRender((v) => v + 1)
  }

  return (
    <SettingsSection icon={FileCode} title={t('defaultApps.title')} description={t('defaultApps.desc')}>
      <div className="space-y-2 px-5 pb-5">
        {FILE_TYPE_CATEGORIES.map((category) => {
          const options = appsForCategory(category)
          const current = getDefaultAppForType(category.key)
          return (
            <div key={category.key} className="flex items-center justify-between gap-3 rumahl-card px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground/85">{t(category.labelKey)}</p>
                <p className="text-[11px] text-foreground/40">
                  {current ? t('defaultApps.opensWith') : t('defaultApps.notConfigured')}
                </p>
              </div>
              <select
                value={current || 'none'}
                onChange={(e) => changeDefault(category, e.target.value)}
                className="shrink-0 rounded-xl border border-foreground/10 bg-foreground/6 px-2.5 py-1.5 text-xs font-medium text-foreground/80 outline-none focus:border-accent/50"
              >
                <option value="none">{t('defaultApps.none')}</option>
                {options.map((app) => (
                  <option key={app.appId} value={app.appId}>
                    {t(`defaultApps.apps.${app.appId}`, app.appName)}
                  </option>
                ))}
              </select>
            </div>
          )
        })}
        <p className="pt-1 text-[11px] text-foreground/40">{t('defaultApps.hint')}</p>
      </div>
    </SettingsSection>
  )
}

// ─── Media Hub configuration (Package 6) ─────────────────────────────────

export function MediaHubConfigSection() {
  const { t } = useTranslation()
  const [form, setForm] = useState({ jellyfin_url: '', jellyfin_api_key: '', jellyfin_user_id: '', plex_url: '', plex_token: '' })
  const [hub, setHub] = useState<{ jellyfin: { reachable: boolean; name?: string | null }; plex: { reachable: boolean; name?: string | null } } | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [configResponse, hubResponse] = await Promise.all([authFetch('/api/media/config'), authFetch('/api/media/hub')])
      if (configResponse.ok) setForm(await configResponse.json())
      if (hubResponse.ok) setHub(await hubResponse.json())
    } catch {
      // offline
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const save = async () => {
    setSaving(true)
    try {
      const response = await authFetch('/api/media/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (response.ok) toast.success(t('settings.mediaSaved'))
      else toast.error(t('settings.mediaSaveFailed'))
      await load()
    } catch {
      toast.error(t('settings.mediaSaveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const set = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }))

  return (
    <SettingsSection icon={FilmStrip} title={t('settings.mediaHub')} description={t('settings.mediaHubDesc')}>
      <div className="space-y-4 px-5 pb-5">
        {/* Detection status */}
        <div className="flex flex-wrap gap-2">
          <span className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold ${hub?.jellyfin?.reachable ? 'bg-emerald-500/10 text-emerald-300' : 'bg-foreground/7 text-foreground/45'}`}>
            Jellyfin {hub?.jellyfin?.reachable ? `· ${hub.jellyfin.name || t('settings.mediaDetected')}` : t('settings.mediaNotDetected')}
          </span>
          <span className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold ${hub?.plex?.reachable ? 'bg-amber-500/10 text-amber-300' : 'bg-foreground/7 text-foreground/45'}`}>
            Plex {hub?.plex?.reachable ? `· ${hub.plex.name || t('settings.mediaDetected')}` : t('settings.mediaNotDetected')}
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rumahl-card p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-foreground/55">Jellyfin</p>
            <div className="space-y-2">
              <input value={form.jellyfin_url} onChange={(event) => set('jellyfin_url', event.target.value)} className="rumahl-field" placeholder={t('settings.mediaUrlPlaceholder')} />
              <input value={form.jellyfin_api_key} onChange={(event) => set('jellyfin_api_key', event.target.value)} className="rumahl-field" placeholder={t('settings.mediaApiKey')} type="password" autoComplete="off" />
              <input value={form.jellyfin_user_id} onChange={(event) => set('jellyfin_user_id', event.target.value)} className="rumahl-field" placeholder={t('settings.mediaUserId')} />
            </div>
          </div>
          <div className="rumahl-card p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-foreground/55">Plex</p>
            <div className="space-y-2">
              <input value={form.plex_url} onChange={(event) => set('plex_url', event.target.value)} className="rumahl-field" placeholder={t('settings.mediaUrlPlaceholder')} />
              <input value={form.plex_token} onChange={(event) => set('plex_token', event.target.value)} className="rumahl-field" placeholder={t('settings.mediaToken')} type="password" autoComplete="off" />
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <button type="button" disabled={saving || loading} onClick={() => void save()} className="rumahl-primary-button">
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </div>
    </SettingsSection>
  )
}

// ─── Remote access (Package 7) ────────────────────────────────────────────

export function RemoteAccessSection() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<{
    tailscale: { installed?: boolean; running?: boolean; online?: boolean; hostname?: string; ip?: string }
    wireguard: { installed?: boolean; interfaces?: string[] }
  } | null>(null)
  const [externalUrl, setExternalUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [savingUrl, setSavingUrl] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [statusResponse, configResponse] = await Promise.all([
        authFetch('/api/remote/status'),
        authFetch('/api/remote/config'),
      ])
      if (statusResponse.ok) setStatus(await statusResponse.json())
      if (configResponse.ok) {
        const config = await configResponse.json()
        setExternalUrl(config.external_url || '')
      }
    } catch {
      // offline
    } finally {
      setLoading(false)
    }
  }, [])

  const saveExternalUrl = async () => {
    setSavingUrl(true)
    try {
      const response = await authFetch('/api/remote/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ external_url: externalUrl.trim() }),
      })
      if (response.ok) toast.success(t('settings.remoteUrlSaved'))
      else toast.error(t('settings.remoteUrlFailed'))
    } catch {
      toast.error(t('settings.remoteUrlFailed'))
    } finally {
      setSavingUrl(false)
    }
  }

  useEffect(() => { void load() }, [load])

  return (
    <SettingsSection icon={Globe} title={t('settings.remoteAccess')} description={t('settings.remoteAccessDesc')}>
      <div className="space-y-3 px-5 pb-5">
        {/* External base URL (domain / TLS) */}
        <div className="rumahl-card p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground/90">{t('settings.remoteExternalUrl')}</p>
            <button type="button" disabled={savingUrl} onClick={() => void saveExternalUrl()} className="rumahl-primary-button">
              {savingUrl ? t('common.saving') : t('common.save')}
            </button>
          </div>
          <input
            value={externalUrl}
            onChange={(event) => setExternalUrl(event.target.value)}
            placeholder="https://ora.meinedomain.de"
            className="mt-2 w-full rounded-xl border border-foreground/10 bg-foreground/5 px-3 py-2 text-xs outline-none focus:border-accent/40"
          />
          <p className="mt-2 text-[11px] text-foreground/40">{t('settings.remoteExternalUrlHint')}</p>
        </div>

        {/* Tailscale */}
        <div className="rumahl-card p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground/90">Tailscale</p>
            {status?.tailscale?.installed ? (
              <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${status.tailscale?.online ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>
                {status.tailscale?.online ? t('settings.remoteOnline') : t('settings.remoteOffline')}
              </span>
            ) : (
              <span className="rounded-full bg-foreground/7 px-2 py-1 text-[10px] text-foreground/45">{t('settings.remoteNotInstalled')}</span>
            )}
          </div>
          {status?.tailscale?.installed && (
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-foreground/55">
              {status.tailscale?.hostname && <span>{t('settings.remoteHostname')}: <strong className="text-foreground/80">{status.tailscale.hostname}</strong></span>}
              {status.tailscale?.ip && <span>IP: <strong className="text-foreground/80">{status.tailscale.ip}</strong></span>}
            </div>
          )}
          {!status?.tailscale?.installed && <p className="mt-2 text-[11px] text-foreground/40">{t('settings.remoteTailscaleHint')}</p>}
        </div>

        {/* WireGuard */}
        <div className="rumahl-card p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground/90">WireGuard</p>
            {status?.wireguard?.installed ? (
              <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-300">{t('settings.remoteConfigured')}</span>
            ) : (
              <span className="rounded-full bg-foreground/7 px-2 py-1 text-[10px] text-foreground/45">{t('settings.remoteNotConfigured')}</span>
            )}
          </div>
          {status?.wireguard?.interfaces?.length ? (
            <p className="mt-2 text-[11px] text-foreground/45">{status.wireguard.interfaces.join(', ')}</p>
          ) : (
            <p className="mt-2 text-[11px] text-foreground/40">{t('settings.remoteWireguardHint')}</p>
          )}
        </div>

        {loading && <p className="text-xs text-foreground/40">{t('common.loading')}</p>}
      </div>
    </SettingsSection>
  )
}
