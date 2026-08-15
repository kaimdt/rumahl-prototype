import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/contexts/ThemeContext'
import { ArrowClockwise, BookOpen, Check, CheckCircle, CircleNotch, CloudArrowUp, Copy, Cpu, Desktop, DownloadSimple, Eye, EyeSlash, Gauge, Gear, Hand, HardDrive, Heartbeat, Lightning, List, ListBullets, ListChecks, MagnifyingGlass, Palette, Play, Power, Robot, ShieldCheck, ShieldWarning, Sparkle, Storefront, Swatches, ToggleLeft, ToggleRight, TrashSimple, TrendUp, UploadSimple, Users, Warning, Wrench } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { confirmDialog } from '@/components/ui/confirmDialog'
import { Tip } from '@/components/ui/tip'
import { authFetch } from '@/lib/authHelpers'
import { AdminCard, ErrorMessage, LoadingSpinner, SettingInput, StatItem, CATEGORY_DESCRIPTIONS, adminFetch, cachedFetch, ccInput, dataCache, formatUptime, getCategoryLabels, notifyError, type ServiceStatus, SettingDefDto, SettingValueDto } from '../AdminPanel'
import { IntelligenceData } from './os'
export function GlobalConfigTab({ token }: { token: string }) {
  const { t } = useTranslation()
  const categoryLabels = useMemo(() => getCategoryLabels(t), [t])
  const [items, setItems] = useState<SettingValueDto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeCategory, setActiveCategory] = useState<SettingDefDto['category']>('system')
  const [search, setSearch] = useState('')
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [pendingValues, setPendingValues] = useState<Record<string, unknown>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await adminFetch('/api/admin/settings', token) as SettingValueDto[]
      setItems(Array.isArray(data) ? data : [])
      setPendingValues({})
    } catch (e) {
      setError((e as Error).message)
    }
    setLoading(false)
  }, [token])

  useEffect(() => { load() }, [load])

  // Defensive: filter out anything that doesn't look like a definition
  // (e.g. backend returning an error envelope) so a single bad row can't
  // crash the whole page with a TypeError.
  const safe = items.filter(it => it && typeof (it as { key?: unknown }).key === 'string')
  const visible = safe.filter(it => it.visibility !== 'hidden')

  const categories = Array.from(new Set(visible.map(it => it.category))) as SettingDefDto['category'][]
  const orderedCategories: SettingDefDto['category'][] =
    (['system', 'home_assistant', 'integrations', 'appearance', 'privacy', 'developer', 'other'] as const)
      .filter(c => categories.includes(c))

  const filtered = visible.filter(it => {
    if (it.category !== activeCategory) return false
    if (!search.trim()) return true
    const q = search.trim().toLowerCase()
    return it.key.toLowerCase().includes(q)
      || it.label.toLowerCase().includes(q)
      || (it.description ?? '').toLowerCase().includes(q)
  })

  const save = async (key: string, value: unknown) => {
    setSavingKey(key)
    try {
      await adminFetch(`/api/admin/settings/${encodeURIComponent(key)}`, token, {
        method: 'PUT',
        body: JSON.stringify({ value }),
      })
      // Reload to get the canonical value (e.g. secrets get masked).
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
    setSavingKey(null)
  }

  const setLocal = (key: string, value: unknown) => {
    setPendingValues(prev => ({ ...prev, [key]: value }))
  }

  if (loading) return <LoadingSpinner />
  if (error && items.length === 0) return <ErrorMessage>{error}</ErrorMessage>

  if (orderedCategories.length === 0) {
    return (
      <div className="space-y-3">
        <AdminCard title="Globale Konfiguration" icon={Gear}>
          <p className="text-xs text-foreground/60">
            Keine Konfigurationswerte registriert. Das Settings-Registry des Backends ist leer
            oder konnte nicht geladen werden.
          </p>
        </AdminCard>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <AdminCard icon={Gear} title="Globale Konfiguration">
        <p className="text-xs text-foreground/60 leading-relaxed">
          Zentrale Konfiguration für IORA OS. Diese Seite spiegelt das klassische .env-System
          wider, ist aber schema-getrieben: jeder Eintrag hat einen Typ, eine Validierung,
          eine Beschreibung und eine Liste von Diensten, die nach einer Änderung neu starten müssen.
          Änderungen werden sofort in der Datenbank gespeichert.
        </p>
      </AdminCard>

      {/* Category tabs */}
      <div className="flex flex-wrap gap-2">
        {orderedCategories.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeCategory === cat
                ? 'bg-accent text-white'
                : 'bg-foreground/5 text-foreground/70 hover:bg-foreground/10'
            }`}
          >
            {categoryLabels[cat]}
          </button>
        ))}
      </div>

      <AdminCard>
        <div className="space-y-1.5">
          <p className="text-xs text-foreground/70 leading-relaxed">
            {CATEGORY_DESCRIPTIONS[activeCategory]}
          </p>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="In dieser Kategorie suchen…" className={`${ccInput('text-xs px-3 py-2')}`} />
        </div>
      </AdminCard>

      <div className="space-y-2">
        {filtered.length === 0 && (
          <AdminCard>
            <p className="text-xs text-foreground/60 text-center py-4">
              Keine Einträge in dieser Kategorie {search ? 'für diese Suche' : ''}.
            </p>
          </AdminCard>
        )}
        {filtered.map(item => {
          const def = item
          const stored = item.value
          const pending = pendingValues[def.key]
          const current = pending !== undefined ? pending : stored
          const dirty = pending !== undefined && JSON.stringify(pending) !== JSON.stringify(stored)
          const readOnly = def.visibility === 'read_only'

          return (
            <AdminCard key={def.key}>
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-sm font-semibold text-foreground">{def.label}</h4>
                      {def.required && (
                        <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-500/15 text-red-300">Pflicht</span>
                      )}
                      {def.wizard && (
                        <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent/15 text-accent">Wizard</span>
                      )}
                      {!item.is_set && (
                        <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-foreground/10 text-foreground/60">Standard</span>
                      )}
                      {readOnly && (
                        <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-foreground/10 text-foreground/60">Nur lesen</span>
                      )}
                    </div>
                    <code className="text-[10px] font-mono text-foreground/40">{def.key}</code>
                    {def.description && (
                      <p className="text-xs text-foreground/60 mt-1 leading-relaxed">{def.description}</p>
                    )}
                  </div>
                </div>

                <SettingInput
                  def={def}
                  value={current}
                  onChange={v => setLocal(def.key, v)}
                  disabled={readOnly}
                />

                {def.requires_restart.length > 0 && dirty && (
                  <p className="text-[10px] text-amber-400">
                    Erfordert Neustart: {def.requires_restart.join(', ')}
                  </p>
                )}

                {!readOnly && (
                  <div className="flex justify-end gap-2 pt-1">
                    {dirty && (
                      <button onClick={() => setPendingValues(prev => { const n = { ...prev }; delete n[def.key]; return n })} className="px-3 py-1.5 rounded-lg text-[11px] font-medium text-foreground/60 hover:text-foreground hover:bg-foreground/[0.04] transition-all duration-200">
                        Verwerfen
                      </button>
                    )}
                    <button disabled={!dirty || savingKey === def.key} onClick={() => save(def.key, current)} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-accent text-white hover:bg-accent/90 disabled:bg-foreground/[0.05] disabled:text-foreground/30 transition-all duration-200">
                      {savingKey === def.key ? 'Speichert…' : 'Speichern'}
                    </button>
                  </div>
                )}
              </div>
            </AdminCard>
          )
        })}
      </div>

      {error && items.length > 0 && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}
    </div>
  )
}


export function DeveloperModeTab({ token }: { token: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [devImage, setDevImage] = useState<{
    is_os_dev: boolean
    dev_token_present: boolean
    bridge_unit_installed: boolean
    developer_app_unit_installed: boolean
    build_id: string | null
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [res, devInfo] = await Promise.all([
          adminFetch('/api/admin/settings', token),
          adminFetch('/api/admin/dev-image', token).catch(() => null),
        ])
        const list = (res?.settings ?? res ?? []) as Array<{ key: string; value: unknown }>
        const entry = list.find(e => e.key === 'developer.mode')
        if (!cancelled) {
          setEnabled(entry?.value === true)
          if (devInfo) setDevImage(devInfo as typeof devImage extends infer T ? T : never)
          if (entry?.value === true) {
            localStorage.setItem('iora-developer-mode', 'true')
          } else {
            localStorage.removeItem('iora-developer-mode')
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [token])

  const apply = async (next: boolean) => {
    setSaving(true)
    setError(null)
    try {
      await adminFetch('/api/admin/settings/developer.mode', token, {
        method: 'PUT',
        body: JSON.stringify({ value: next }),
      })
      setEnabled(next)
      if (next) {
        localStorage.setItem('iora-developer-mode', 'true')
      } else {
        localStorage.removeItem('iora-developer-mode')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const isLocked = devImage?.is_os_dev === true
  const handleToggle = (next: boolean) => {
    if (isLocked) return
    if (next) {
      setConfirmOpen(true)
    } else {
      apply(false)
    }
  }

  return (
    <div className="space-y-3">
      {isLocked && (
        <AdminCard title="OS-Entwickler-Image aktiv" icon={ShieldCheck}>
          <div className="space-y-2 text-xs text-foreground/80">
            <p>
              Dieses System wurde als <strong>IORA OS Dev (internal)</strong>{' '}
              gebaut. Der Plugin- und App-Entwicklermodus ist dauerhaft
              aktiviert und kann nicht deaktiviert werden.
            </p>
            <ul className="list-disc list-inside space-y-1 text-[11px] text-foreground/60">
              {devImage?.bridge_unit_installed && <li><span className="font-mono">iora-dev-bridge.service</span> wird automatisch gestartet.</li>}
              {devImage?.developer_app_unit_installed && <li>Die <strong>IORA Developer App</strong> ist permanent unter „Installierte Apps" verfügbar.</li>}
              {devImage?.dev_token_present && <li>Ein Dev-Token liegt unter <span className="font-mono">/etc/iora/dev-token</span> (Mode 0600).</li>}
              {devImage?.build_id && <li>Build-ID: <span className="font-mono">{devImage.build_id}</span></li>}
            </ul>
          </div>
        </AdminCard>
      )}

      <AdminCard title="Plugin- und App-Entwicklermodus" icon={Wrench}>
        {loading ? (
          <p className="text-xs text-foreground/50">Lade aktuellen Status…</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4 p-4 rounded-xl bg-foreground/5 border border-foreground/10">
              <div className="flex-1">
                <div className="text-sm font-semibold text-foreground mb-1">Entwicklermodus aktivieren</div>
                <p className="text-xs text-foreground/60 leading-relaxed">
                  Schaltet die <strong>IORA Developer App</strong> frei und erlaubt das Installieren
                  unsignierter ZIP-Pakete. Gedacht für Personen, die eigene Plugins
                  oder Apps für IORA OS bauen — nicht für den normalen Betrieb.
                </p>
                <p className="text-[11px] text-foreground/40 mt-2">
                  Setting-Schlüssel: <span className="font-mono">developer.mode</span>
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={enabled === true}
                disabled={saving || enabled === null || isLocked}
                onClick={() => handleToggle(!enabled)}
                title={isLocked ? 'Auf einem OS-Entwickler-Image gesperrt' : undefined}
                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
                  enabled ? 'bg-green-500/70' : 'bg-foreground/20'
                } ${saving ? 'opacity-60 cursor-wait' : isLocked ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                    enabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {enabled && (
              <div className="text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
                Entwicklermodus ist aktiv. Die Developer App erscheint unter
                „Installierte Apps". Ggf. Browser-Tab neu laden, damit alle
                Komponenten den Status übernehmen.
              </div>
            )}
            {error && (
              <div className="text-[11px] text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                {error}
              </div>
            )}
          </div>
        )}
      </AdminCard>

      <AdminCard title="Was ändert sich beim Einschalten?" icon={Lightning}>
        <ul className="text-xs text-foreground/70 space-y-1.5 list-disc list-inside">
          <li><strong>IORA Developer App</strong> wird automatisch installiert und gestartet.</li>
          <li>ZIP-Uploads im App-Tab werden akzeptiert (auch ohne Signatur, mit Trust-Level „untrusted").</li>
          <li>Der Dev-Bridge stellt zusätzliche <span className="font-mono">/api/dev/*</span> Endpunkte bereit.</li>
          <li>Hot-Reload und Plugin-Reloading sind möglich, ohne Dienste neu zu starten.</li>
          <li>Die Sandbox-Isolation einzelner Plugins ist gelockert.</li>
        </ul>
      </AdminCard>

      {confirmOpen && (
        <DeveloperModeConfirmModal
          onCancel={() => setConfirmOpen(false)}
          onConfirm={async () => { setConfirmOpen(false); await apply(true) }}
        />
      )}
    </div>
  )
}


export function DeveloperModeConfirmModal({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void | Promise<void> }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl bg-background border border-foreground/10 shadow-2xl">
        <div className="p-5 border-b border-foreground/10">
          <h3 className="text-base font-bold text-foreground flex items-center gap-2">
            <ShieldWarning size={20} weight="fill" className="text-amber-400" />
            Entwicklermodus aktivieren?
          </h3>
        </div>
        <div className="p-5 space-y-4 text-xs text-foreground/80">
          <p>Bevor du den Plugin- und App-Entwicklermodus aktivierst, beachte die Unterschiede zum Normalbetrieb:</p>
          <div className="grid grid-cols-2 gap-3 text-[11px]">
            <div className="rounded-lg bg-foreground/5 border border-foreground/10 p-3">
              <div className="font-semibold text-foreground/90 mb-1.5">Normalmodus</div>
              <ul className="list-disc list-inside space-y-1 text-foreground/60">
                <li>Nur signierte Apps</li>
                <li>Strenge Sandbox-Isolation</li>
                <li>Developer App ausgeblendet</li>
                <li>Kleinere Angriffsfläche</li>
                <li>Empfohlen für Endgeräte</li>
              </ul>
            </div>
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3">
              <div className="font-semibold text-amber-200 mb-1.5">Entwicklermodus</div>
              <ul className="list-disc list-inside space-y-1 text-amber-200/80">
                <li>Unsignierte ZIPs erlaubt</li>
                <li>Gelockerte Plugin-Isolation</li>
                <li>Developer App + Bridge aktiv</li>
                <li>Zusätzliche <span className="font-mono">/api/dev/*</span> Endpunkte</li>
                <li>Nur für Entwicklungs-Setups</li>
              </ul>
            </div>
          </div>
          <p className="text-[11px] text-foreground/50">
            Du kannst den Modus jederzeit wieder deaktivieren — außer auf einem OS-Entwickler-Image.
          </p>
        </div>
        <div className="p-4 border-t border-foreground/10 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg bg-foreground/10 text-foreground text-xs font-semibold hover:bg-foreground/15 transition-colors"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={() => { void onConfirm() }}
            className="px-4 py-2 rounded-lg bg-amber-500 text-black text-xs font-bold hover:bg-amber-400 transition-colors"
          >
            Entwicklermodus aktivieren
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Documentation tab ──────────────────────────────────────────────────
//
// Embeds the existing /docs SPA route inside the admin panel via an
// iframe. This keeps the markdown-rendering logic in DocsPageNew as the
// single source of truth and means the admin user does not have to
// leave the panel to look something up. The iframe is constrained to the
// same origin so cookies and CSRF tokens flow naturally.

export function DocumentationTab() {
  return (
    <div className="space-y-3">
      <AdminCard title="IORA OS Dokumentation" icon={BookOpen}>
        <p className="text-xs text-foreground/60 mb-3">
          Die vollständige Dokumentation ist auch unter <code className="font-mono text-accent">/docs</code> als
          eigenständige Seite erreichbar. Hier ist sie eingebettet.
        </p>
        <div className="rounded-xl overflow-hidden border border-foreground/10 bg-foreground/[0.02]">
          <iframe
            src="/docs"
            title="IORA OS Dokumentation"
            className="w-full"
            style={{ height: '70vh', minHeight: 480, border: 'none' }}
          />
        </div>
      </AdminCard>
    </div>
  )
}


export function ServicesTab({ token }: { token: string }) {
  const [services, setServices] = useState<ServiceStatus[]>([])
  const [overview, setOverview] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [restarting, setRestarting] = useState<string | null>(null)
  const [restartFeedback, setRestartFeedback] = useState<{ name: string; ok: boolean; msg: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [svc, ov] = await Promise.all([
        adminFetch('/api/admin/control/services', token),
        cachedFetch('/api/admin/control/overview', token),
      ])
      setServices((svc as { services: ServiceStatus[] }).services ?? svc as ServiceStatus[])
      setOverview(ov as Record<string, unknown>)
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }, [token])

  useEffect(() => { load() }, [load])

  const restartService = async (name: string) => {
    if (!(await confirmDialog({ title: 'Dienst neu starten', message: `Dienst "${name}" wirklich neu starten? Während des Neustarts ist er kurz nicht erreichbar.`, confirmLabel: 'Neu starten', danger: true }))) return
    setRestarting(name)
    setRestartFeedback(null)
    try {
      await adminFetch(`/api/admin/control/services/${encodeURIComponent(name)}/restart`, token, { method: 'POST' })
      setRestartFeedback({ name, ok: true, msg: `${name} wird neu gestartet…` })
      // Re-poll a bit later so the user sees the new status.
      setTimeout(() => { dataCache.delete('/api/admin/control/services'); load() }, 2500)
    } catch (e) {
      setRestartFeedback({ name, ok: false, msg: (e as Error).message })
    } finally {
      setRestarting(null)
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const onlineCount = services.filter(s => s.status === 'online').length
  const totalCount = services.length
  const deployedCount = services.filter(s => s.status !== 'not_deployed').length

  return (
    <div className="space-y-3">
      {/* Overview Bar */}
      <AdminCard title="Übersicht" icon={Gauge}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="text-center p-3 rounded-xl bg-foreground/3">
            <div className="text-2xl font-bold text-foreground">{onlineCount}/{deployedCount}</div>
            <div className="text-[10px] text-foreground/50 mt-0.5">Dienste online ({totalCount} bekannt)</div>
          </div>
          <div className="text-center p-3 rounded-xl bg-foreground/3">
            <div className="text-2xl font-bold text-foreground">{overview?.mode as string ?? '–'}</div>
            <div className="text-[10px] text-foreground/50 mt-0.5">Betriebsmodus</div>
          </div>
          <div className="text-center p-3 rounded-xl bg-foreground/3">
            <div className="text-2xl font-bold text-foreground">{overview?.watchdog_count as number ?? 0}</div>
            <div className="text-[10px] text-foreground/50 mt-0.5">Watchdogs</div>
          </div>
          <div className="text-center p-3 rounded-xl bg-foreground/3">
            <div className="text-2xl font-bold text-foreground">{overview?.scheduled_actions as number ?? 0}</div>
            <div className="text-[10px] text-foreground/50 mt-0.5">Geplante Aktionen</div>
          </div>
        </div>
      </AdminCard>

      {/* Service Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {services.map(svc => (
          <AdminCard key={svc.name}>
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <div className={`w-2.5 h-2.5 rounded-full ${
                  svc.status === 'online' ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.5)]' :
                  svc.status === 'degraded' ? 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.5)]' :
                  svc.status === 'not_deployed' ? 'bg-foreground/30' :
                  'bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.5)]'
                }`} />
                <div>
                  <h4 className="text-sm font-semibold text-foreground">{svc.name}</h4>
                  <span className="text-[10px] text-foreground/40 font-mono">{svc.url}</span>
                </div>
              </div>
              <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-full ${
                svc.status === 'online' ? 'bg-green-500/15 text-green-300' :
                svc.status === 'degraded' ? 'bg-amber-500/15 text-amber-300' :
                svc.status === 'not_deployed' ? 'bg-foreground/10 text-foreground/50' :
                'bg-red-500/15 text-red-300'
              }`}>
                {svc.status === 'online' ? 'Online' :
                 svc.status === 'degraded' ? 'Eingeschränkt' :
                 svc.status === 'not_deployed' ? 'Nicht aktiviert' :
                 'Offline'}
              </span>
            </div>
            <div className="space-y-0">
              {svc.response_time_ms !== undefined && (
                <StatItem label="Antwortzeit" value={`${svc.response_time_ms}ms`} />
              )}
              {svc.version && <StatItem label="Version" value={svc.version} />}
              {svc.uptime && <StatItem label="Uptime" value={svc.uptime} />}
              {svc.details && Object.entries(svc.details).map(([k, v]) => (
                <StatItem key={k} label={k} value={String(v)} />
              ))}
            </div>
            <div className="mt-3 pt-2 border-t border-foreground/5 flex items-center justify-between gap-2">
              {restartFeedback?.name === svc.name ? (
                <span className={`text-[10px] truncate ${restartFeedback.ok ? 'text-green-300' : 'text-red-300'}`}>
                  {restartFeedback.msg}
                </span>
              ) : (
                <span className="text-[10px] text-foreground/30 truncate">{svc.url}</span>
              )}
              <button
                type="button"
                onClick={() => restartService(svc.name)}
                disabled={restarting === svc.name || svc.status === 'not_deployed'}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-semibold bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
                title={svc.status === 'not_deployed' ? 'Dienst nicht installiert' : `${svc.name}.service neu starten`}
              >
                <ArrowClockwise size={11} className={restarting === svc.name ? 'animate-spin' : ''} />
                {restarting === svc.name ? 'Starte…' : 'Neu starten'}
              </button>
            </div>
          </AdminCard>
        ))}
      </div>

      <div className="flex justify-end">
        <button onClick={() => { dataCache.delete('/api/admin/control/services'); dataCache.delete('/api/admin/control/overview'); load() }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-foreground/80 hover:text-accent hover:bg-accent/10 transition-all">
          <ArrowClockwise size={14} /> Aktualisieren
        </button>
      </div>
    </div>
  )
}

// ── Tasks Tab (Aufgaben-Überwachung & Warteschlange) ──────────────────────────

export interface BackgroundTask {
  id: number
  name: string
  task_type: string
  enabled: boolean
  interval_seconds?: number
  last_run_at?: string
  last_success_at?: string
  last_error?: string
  run_count: number
  error_count: number
}


export function TasksTab({ token }: { token: string }) {
  const [tasks, setTasks] = useState<BackgroundTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [triggerLoading, setTriggerLoading] = useState<number | null>(null)
  const [filter, setFilter] = useState<'all' | 'active' | 'errors'>('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await adminFetch('/api/admin/control/tasks', token)
      setTasks(Array.isArray(data) ? data : (data as { tasks: BackgroundTask[] }).tasks ?? [])
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }, [token])

  useEffect(() => { load() }, [load])

  const triggerTask = async (taskId: number) => {
    setTriggerLoading(taskId)
    try {
      await adminFetch(`/api/admin/control/tasks/${taskId}/trigger`, token, { method: 'POST' })
      await load()
    } catch (e) { notifyError(e) }
    setTriggerLoading(null)
  }

  const toggleTask = async (taskId: number) => {
    try {
      await adminFetch(`/api/admin/control/tasks/${taskId}/toggle`, token, { method: 'POST' })
      await load()
    } catch (e) { notifyError(e) }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const filtered = tasks.filter(t =>
    filter === 'all' ? true :
    filter === 'active' ? t.enabled :
    t.error_count > 0
  )

  const totalRuns = tasks.reduce((s, t) => s + t.run_count, 0)
  const totalErrors = tasks.reduce((s, t) => s + t.error_count, 0)
  const activeCount = tasks.filter(t => t.enabled).length

  return (
    <div className="space-y-3">
      {/* Stats */}
      <AdminCard title="Aufgaben-Statistik" icon={ListChecks}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="text-center p-3 rounded-xl bg-foreground/3">
            <div className="text-2xl font-bold text-foreground">{tasks.length}</div>
            <div className="text-[10px] text-foreground/50 mt-0.5">Gesamt</div>
          </div>
          <div className="text-center p-3 rounded-xl bg-foreground/3">
            <div className="text-2xl font-bold text-green-300">{activeCount}</div>
            <div className="text-[10px] text-foreground/50 mt-0.5">Aktiv</div>
          </div>
          <div className="text-center p-3 rounded-xl bg-foreground/3">
            <div className="text-2xl font-bold text-foreground">{totalRuns}</div>
            <div className="text-[10px] text-foreground/50 mt-0.5">Ausführungen</div>
          </div>
          <div className="text-center p-3 rounded-xl bg-foreground/3">
            <div className={`text-2xl font-bold ${totalErrors > 0 ? 'text-red-300' : 'text-foreground'}`}>{totalErrors}</div>
            <div className="text-[10px] text-foreground/50 mt-0.5">Fehler</div>
          </div>
        </div>
      </AdminCard>

      {/* Filter */}
      <div className="flex gap-1.5">
        {(['all', 'active', 'errors'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              filter === f ? 'bg-accent/20 text-accent' : 'text-foreground/60 hover:text-foreground hover:bg-foreground/8'
            }`}>
            {f === 'all' ? 'Alle' : f === 'active' ? 'Aktiv' : 'Fehler'}
          </button>
        ))}
      </div>

      {/* Task List */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="ora-card rounded-2xl p-8 text-center text-xs text-foreground/50">Keine Aufgaben gefunden.</div>
        ) : filtered.map(task => (
          <AdminCard key={task.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`w-2 h-2 rounded-full ${task.enabled ? 'bg-green-400' : 'bg-foreground/30'}`} />
                  <h4 className="text-sm font-semibold text-foreground truncate">{task.name}</h4>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-foreground/8 text-foreground/60">{task.task_type}</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 mt-2">
                  {task.interval_seconds && (
                    <div className="text-[10px] text-foreground/50">
                      <span className="text-foreground/30">Intervall:</span> {task.interval_seconds >= 3600 ? `${Math.round(task.interval_seconds/3600)}h` : task.interval_seconds >= 60 ? `${Math.round(task.interval_seconds/60)}m` : `${task.interval_seconds}s`}
                    </div>
                  )}
                  <div className="text-[10px] text-foreground/50">
                    <span className="text-foreground/30">Läufe:</span> {task.run_count}
                  </div>
                  {task.error_count > 0 && (
                    <div className="text-[10px] text-red-300">
                      <span className="text-red-300/60">Fehler:</span> {task.error_count}
                    </div>
                  )}
                  {task.last_run_at && (
                    <div className="text-[10px] text-foreground/50">
                      <span className="text-foreground/30">Letzter Lauf:</span> {new Date(task.last_run_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  )}
                </div>
                {task.last_error && (
                  <div className="mt-2 p-2 rounded-lg bg-red-500/8 border border-red-500/15 text-[10px] text-red-300 font-mono truncate">
                    {task.last_error}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Tip content={task.enabled ? 'Aufgabe deaktivieren' : 'Aufgabe aktivieren'}>
                  <button onClick={() => toggleTask(task.id)}
                    className={`p-2 rounded-lg transition-all ${task.enabled ? 'text-green-300 hover:bg-green-500/15' : 'text-foreground/40 hover:bg-foreground/8'}`}>
                    {task.enabled ? <ToggleRight size={18} weight="fill" /> : <ToggleLeft size={18} />}
                  </button>
                </Tip>
                <Tip content="Jetzt auslösen">
                  <button onClick={() => triggerTask(task.id)} disabled={triggerLoading === task.id}
                    className="p-2 rounded-lg text-foreground/60 hover:text-accent hover:bg-accent/10 transition-all disabled:opacity-40">
                    {triggerLoading === task.id ? <CircleNotch size={16} className="animate-spin" /> : <Play size={16} />}
                  </button>
                </Tip>
              </div>
            </div>
          </AdminCard>
        ))}
      </div>

      <div className="flex justify-end">
        <button onClick={load}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-foreground/80 hover:text-accent hover:bg-accent/10 transition-all">
          <ArrowClockwise size={14} /> Aktualisieren
        </button>
      </div>
    </div>
  )
}

// ── Control Mode Tab (Betriebsmodus) ──────────────────────────────────────────

export const MODE_CONFIG = {
  autonomous: {
    icon: Robot,
    label: 'Autonom',
    color: 'green',
    description: 'Das System führt alle Aufgaben, Watchdogs und Automationen selbstständig aus. Eingriffe sind nicht erforderlich.',
  },
  supervised: {
    icon: Eye,
    label: 'Überwacht',
    color: 'amber',
    description: 'Automationen laufen, aber kritische Aktionen erfordern eine Bestätigung. Benachrichtigungen bei wichtigen Entscheidungen.',
  },
  manual: {
    icon: Hand,
    label: 'Manuell',
    color: 'blue',
    description: 'Alle automatischen Aktionen sind pausiert. Aufgaben müssen manuell ausgelöst werden.',
  },
} as const

export type ControlMode = keyof typeof MODE_CONFIG


export function ControlModeTab({ token }: { token: string }) {
  const [currentMode, setCurrentMode] = useState<ControlMode>('autonomous')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await adminFetch('/api/admin/control/mode', token) as { mode: string }
      setCurrentMode((data.mode || 'autonomous') as ControlMode)
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }, [token])

  useEffect(() => { load() }, [load])

  const setMode = async (mode: ControlMode) => {
    if (mode === currentMode) return
    setSaving(true)
    try {
      await adminFetch('/api/admin/control/mode', token, {
        method: 'PUT',
        body: JSON.stringify({ mode }),
      })
      setCurrentMode(mode)
    } catch (e) { setError((e as Error).message) }
    setSaving(false)
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const currentConfig = MODE_CONFIG[currentMode]

  return (
    <div className="space-y-3">
      {/* Current Mode Display */}
      <AdminCard>
        <div className="flex items-center gap-4 py-2">
          <div className={`p-4 rounded-2xl ${
            currentConfig.color === 'green' ? 'bg-green-500/15' :
            currentConfig.color === 'amber' ? 'bg-amber-500/15' :
            'bg-blue-500/15'
          }`}>
            <currentConfig.icon size={32} weight="fill" className={
              currentConfig.color === 'green' ? 'text-green-300' :
              currentConfig.color === 'amber' ? 'text-amber-300' :
              'text-blue-300'
            } />
          </div>
          <div className="flex-1">
            <div className="text-xs text-foreground/40 uppercase tracking-wider mb-0.5">Aktueller Betriebsmodus</div>
            <div className={`text-xl font-bold ${
              currentConfig.color === 'green' ? 'text-green-300' :
              currentConfig.color === 'amber' ? 'text-amber-300' :
              'text-blue-300'
            }`}>{currentConfig.label}</div>
            <p className="text-xs text-foreground/60 mt-1">{currentConfig.description}</p>
          </div>
        </div>
      </AdminCard>

      {/* Mode Selector */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {(Object.entries(MODE_CONFIG) as [ControlMode, typeof MODE_CONFIG[ControlMode]][]).map(([mode, config]) => {
          const isActive = mode === currentMode
          const Icon = config.icon
          const colorClasses = config.color === 'green'
            ? { bg: 'bg-green-500/8', border: 'border-green-500/30', text: 'text-green-300', activeBg: 'bg-green-500/15' }
            : config.color === 'amber'
            ? { bg: 'bg-amber-500/8', border: 'border-amber-500/30', text: 'text-amber-300', activeBg: 'bg-amber-500/15' }
            : { bg: 'bg-blue-500/8', border: 'border-blue-500/30', text: 'text-blue-300', activeBg: 'bg-blue-500/15' }

          return (
            <button
              key={mode}
              onClick={() => setMode(mode)}
              disabled={saving}
              className={`ora-card rounded-2xl p-4 text-left transition-all border-2 ${
                isActive
                  ? `${colorClasses.activeBg} ${colorClasses.border} shadow-lg`
                  : 'border-transparent hover:border-foreground/15 hover:bg-foreground/3'
              } disabled:opacity-50`}
            >
              <div className="flex items-center gap-2.5 mb-2">
                <Icon size={20} weight={isActive ? 'fill' : 'regular'} className={isActive ? colorClasses.text : 'text-foreground/50'} />
                <span className={`text-sm font-semibold ${isActive ? colorClasses.text : 'text-foreground/80'}`}>{config.label}</span>
                {isActive && <CheckCircle size={16} weight="fill" className={colorClasses.text + ' ml-auto'} />}
              </div>
              <p className="text-[10px] text-foreground/50 leading-relaxed">{config.description}</p>
            </button>
          )
        })}
      </div>

      {/* Info */}
      <AdminCard title="Hinweise" icon={Warning}>
        <div className="space-y-2 text-xs text-foreground/60">
          <p>• <strong className="text-foreground/80">Autonom:</strong> Empfohlen für den Normalbetrieb. Watchdogs, Scheduler und Automationen arbeiten selbstständig.</p>
          <p>• <strong className="text-foreground/80">Überwacht:</strong> Ideal für Tests oder sensible Phasen. Kritische Aktionen erfordern Bestätigung.</p>
          <p>• <strong className="text-foreground/80">Manuell:</strong> Für Wartungsarbeiten oder Fehlersuche. Alle automatischen Prozesse pausiert.</p>
          <p className="text-foreground/40 mt-2">Der Modus wird sofort über WebSocket an alle verbundenen Clients propagiert.</p>
        </div>
      </AdminCard>
    </div>
  )
}

// ── Card wrapper ──────────────────────────────────────────────────


export function SystemTab({ token }: { token: string }) {
  const [stats, setStats] = useState<Record<string, unknown> | null>(null)
  const [haInfo, setHaInfo] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [maintenanceActive, setMaintenanceActive] = useState(false)
  const [maintenanceMsg, setMaintenanceMsg] = useState('')
  const [maintenanceLoading, setMaintenanceLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [s, h, m] = await Promise.all([
        cachedFetch('/api/system/stats', token),
        cachedFetch('/api/system/ha-info', token),
        adminFetch('/api/admin/maintenance', token),
      ])
      setStats(s as Record<string, unknown>)
      setHaInfo(h as Record<string, unknown>)
      const maint = m as { active: boolean; message: string }
      setMaintenanceActive(maint.active)
      setMaintenanceMsg(maint.message || '')
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }, [token])

  useEffect(() => { load() }, [load])

  const toggleMaintenance = async () => {
    setMaintenanceLoading(true)
    try {
      const result = await adminFetch('/api/admin/maintenance', token, {
        method: 'PUT',
        body: JSON.stringify({ active: !maintenanceActive, message: maintenanceMsg }),
      })
      setMaintenanceActive(result.active)
      setMaintenanceMsg(result.message || '')
    } catch (e) { notifyError(e) }
    setMaintenanceLoading(false)
  }

  const saveMaintenanceMessage = async () => {
    setMaintenanceLoading(true)
    try {
      const result = await adminFetch('/api/admin/maintenance', token, {
        method: 'PUT',
        body: JSON.stringify({ message: maintenanceMsg }),
      })
      setMaintenanceMsg(result.message || '')
    } catch (e) { notifyError(e) }
    setMaintenanceLoading(false)
  }

  useEffect(() => { load() }, [load])

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const cpu = stats?.cpu as Record<string, unknown> | undefined
  const memory = stats?.memory as Record<string, unknown> | undefined
  const backend = stats?.backend as Record<string, unknown> | undefined

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      <AdminCard title="CPU" icon={Cpu}>
        <StatItem label="Auslastung" value={`${Math.round(cpu?.usage_percent as number ?? 0)}%`} />
        <StatItem label="Kerne" value={cpu?.cores as number} />
      </AdminCard>

      <AdminCard title="Speicher" icon={HardDrive}>
        <StatItem label="Verwendet" value={`${((memory?.used_bytes as number ?? 0) / 1048576).toFixed(0)} MB`} />
        <StatItem label="Gesamt" value={`${((memory?.total_bytes as number ?? 0) / 1048576).toFixed(0)} MB`} />
        <StatItem label="Auslastung" value={`${Math.round(memory?.usage_percent as number ?? 0)}%`} />
      </AdminCard>

      <AdminCard title="Backend" icon={Gear}>
        <StatItem label="Version" value={backend?.version as string} />
        <StatItem label="Entities" value={backend?.entity_count as number} />
        <StatItem label="Clients" value={backend?.connected_clients as number} />
        <StatItem label="Uptime" value={formatUptime(stats?.uptime_seconds as number)} />
      </AdminCard>

      <AdminCard title="Home Assistant" icon={CloudArrowUp}>
        <StatItem label="Verbunden" value={stats?.ha_connected ? '✓ Ja' : '✗ Nein'} />
        <StatItem label="WebSocket" value={stats?.ha_ws_connected ? '✓ Ja' : '✗ Nein'} />
        <StatItem label="HA Version" value={(haInfo?.ha_version as string) ?? 'Unbekannt'} />
        <StatItem label="Entities" value={haInfo?.entity_count as number} />
        <StatItem label="History (24h)" value={haInfo?.history_entries_24h as number} />
      </AdminCard>

      {Array.isArray(haInfo?.domains) && (
        <AdminCard title="Entity-Domänen" icon={ListBullets} className="md:col-span-2">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {(haInfo.domains as Array<{ domain: string; count: number }>).slice(0, 18).map(d => (
              <div key={d.domain} className="flex justify-between items-center text-xs py-1 px-2 rounded bg-foreground/3">
                <span className="text-foreground/80">{d.domain}</span>
                <span className="font-medium">{d.count}</span>
              </div>
            ))}
          </div>
        </AdminCard>
      )}

      <AdminCard title="Wartungsmodus" icon={Wrench} className="col-span-full">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <div className="text-sm font-medium text-foreground flex items-center gap-2">
                {maintenanceActive ? (
                  <span className="flex items-center gap-1.5 text-amber-400"><Warning size={14} weight="fill" /> Aktiv</span>
                ) : (
                  <span className="text-foreground/60">Inaktiv</span>
                )}
              </div>
              <p className="text-xs text-foreground/50">
                Sperrt das Dashboard für alle Geräte. Nur Administratoren und Benutzer mit der Rolle „Wartung" können weiterhin zugreifen.
              </p>
            </div>
            <button
              onClick={toggleMaintenance}
              disabled={maintenanceLoading}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium transition-all ${
                maintenanceActive
                  ? 'bg-green-500/15 text-green-300 hover:bg-green-500/25 border border-green-500/30'
                  : 'bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 border border-amber-500/30'
              }`}
            >
              {maintenanceActive ? (
                <><Power size={14} /> Deaktivieren</>
              ) : (
                <><Wrench size={14} /> Aktivieren</>
              )}
            </button>
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="text-xs text-foreground/50 mb-1 block">Wartungsnachricht</label>
              <input
                value={maintenanceMsg}
                onChange={e => setMaintenanceMsg(e.target.value)}
                placeholder="Nachricht für Benutzer..."
                className="ora-field-sm w-full text-xs"
              />
            </div>
            <button
              onClick={saveMaintenanceMessage}
              disabled={maintenanceLoading}
              className="px-3 py-2 rounded-lg text-xs text-foreground/70 hover:text-accent hover:bg-accent/10 transition-all border border-foreground/10"
            >
              Speichern
            </button>
          </div>
        </div>
      </AdminCard>

      <div className="col-span-full flex justify-end">
        <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-foreground/80 hover:text-accent hover:bg-accent/10 transition-all">
          <ArrowClockwise size={14} /> Aktualisieren
        </button>
      </div>
    </div>
  )
}

// ── Users Tab ──────────────────────────────────────────────────


export function HealthIntelligenceTab({ token }: { token: string }) {
  const [data, setData] = useState<IntelligenceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [runningTask, setRunningTask] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await adminFetch('/api/intelligence/overview', token) as IntelligenceData
      setData(d)
    } catch { setData(null) }
    setLoading(false)
  }, [token])

  useEffect(() => { load() }, [load])

  const runTask = async (taskType: string) => {
    setRunningTask(taskType)
    try {
      await adminFetch(`/api/intelligence/maintenance/run/${taskType}`, token)
      toast.success(`${taskType} ausgeführt`)
      setTimeout(load, 1000)
    } catch { toast.error(`${taskType} fehlgeschlagen`) }
    setRunningTask(null)
  }

  const scoreColor = (s: number) => s >= 90 ? 'text-emerald-400' : s >= 75 ? 'text-green-400' : s >= 50 ? 'text-amber-400' : s >= 25 ? 'text-orange-400' : 'text-red-400'
  const scoreBg = (s: number) => s >= 90 ? 'bg-emerald-500/15' : s >= 75 ? 'bg-green-500/15' : s >= 50 ? 'bg-amber-500/15' : s >= 25 ? 'bg-orange-500/15' : 'bg-red-500/15'
  const trendIcon = (t: string) => t === 'improving' ? <TrendUp size={14} weight="fill" className="text-emerald-400" /> : t === 'degrading' ? <TrendUp size={14} weight="fill" className="text-amber-400 rotate-180" /> : t === 'critical' ? <TrendUp size={14} weight="fill" className="text-red-400 rotate-180" /> : <span className="text-foreground/30">—</span>
  const prioBorder = (p: number) => p <= 2 ? 'border-red-500/20 bg-red-500/[0.04]' : p <= 3 ? 'border-amber-500/20 bg-amber-500/[0.04]' : 'border-foreground/[0.06] bg-foreground/[0.02]'

  if (loading) return <LoadingSpinner />
  if (!data) return (
    <AdminCard title="Health Intelligence" icon={Heartbeat}>
      <div className="text-center py-8 space-y-3">
        <Heartbeat size={40} weight="duotone" className="mx-auto text-foreground/20" />
        <p className="text-sm text-foreground/50">Intelligence Engine nicht verfügbar</p>
        <p className="text-xs text-foreground/30">Starte <code className="px-1.5 py-0.5 rounded bg-foreground/[0.04] text-[11px]">iora-intelligence</code> für KI-gestützte Systemanalyse</p>
      </div>
    </AdminCard>
  )

  return (
    <div className="space-y-3">
      {/* Overall Score */}
      <AdminCard>
        <div className="flex items-center gap-4">
          <div className={`w-16 h-16 rounded-2xl ${scoreBg(data.overall_score)} flex items-center justify-center`}>
            <span className={`text-2xl font-bold ${scoreColor(data.overall_score)}`}>{data.overall_score}</span>
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">System Health Score</p>
            <p className={`text-xs font-medium ${scoreColor(data.overall_score)}`}>{data.overall_status}</p>
            <p className="text-[10px] text-foreground/30 mt-0.5">{data.metrics.healthy_count}/{data.metrics.service_count} Dienste gesund</p>
          </div>
        </div>
      </AdminCard>

      {/* Metrics Bar */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'CPU', value: `${data.metrics.cpu_percent.toFixed(0)}%`, warn: data.metrics.cpu_percent > 80 },
          { label: 'RAM', value: `${data.metrics.memory_percent.toFixed(0)}%`, warn: data.metrics.memory_percent > 85 },
          { label: 'Disk', value: `${data.metrics.disk_percent.toFixed(0)}%`, warn: data.metrics.disk_percent > 85 },
          { label: 'Uptime', value: `${data.metrics.uptime_hours.toFixed(0)}h`, warn: false },
        ].map(m => (
          <div key={m.label} className="text-center p-2 rounded-xl bg-foreground/[0.03]">
            <p className="text-[10px] text-foreground/40">{m.label}</p>
            <p className={`text-sm font-bold ${m.warn ? 'text-red-400' : 'text-foreground'}`}>{m.value}</p>
          </div>
        ))}
      </div>

      {/* Service Scores */}
      <AdminCard title={`Service Scores (${data.services.length})`} icon={Heartbeat}>
        <div className="space-y-1.5 max-h-80 overflow-y-auto">
          {data.services.map(svc => (
            <div key={svc.service_name} className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-foreground/[0.02] transition-colors">
              <div className={`w-10 h-10 rounded-xl ${scoreBg(svc.score)} flex items-center justify-center flex-shrink-0`}>
                <span className={`text-sm font-bold ${scoreColor(svc.score)}`}>{svc.score}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-medium text-foreground truncate">{svc.service_name}</p>
                  {trendIcon(svc.trend)}
                </div>
                <p className="text-[10px] text-foreground/40">
                  {svc.status} · {svc.uptime_percent.toFixed(1)}% uptime{svc.response_time_ms ? ` · ${svc.response_time_ms}ms` : ''}
                </p>
              </div>
              {svc.consecutive_failures > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-red-500/10 text-red-400 font-medium">{svc.consecutive_failures}× fail</span>
              )}
              {svc.predicted_failure_in && (
                <Tip content={`Voraussichtlicher Ausfall in ${svc.predicted_failure_in}`}>
                  <Warning size={14} className="text-amber-400 flex-shrink-0" />
                </Tip>
              )}
            </div>
          ))}
        </div>
      </AdminCard>

      {/* Anomalies */}
      {data.anomalies.length > 0 && (
        <AdminCard title={`Anomalien (${data.anomalies.length})`} icon={ShieldWarning}>
          <div className="space-y-2">
            {data.anomalies.map((a, i) => (
              <div key={i} className={`p-3 rounded-xl border ${a.severity === 'critical' ? 'border-red-500/20 bg-red-500/[0.04]' : 'border-amber-500/15 bg-amber-500/[0.03]'}`}>
                <div className="flex items-start gap-2">
                  <Warning size={14} weight="fill" className={`mt-0.5 flex-shrink-0 ${a.severity === 'critical' ? 'text-red-400' : 'text-amber-400'}`} />
                  <div>
                    <p className="text-xs font-medium text-foreground/80">{a.description}</p>
                    <p className="text-[10px] text-foreground/30 mt-0.5">{a.service_name} · {a.current_value} (normal: {a.baseline_value})</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </AdminCard>
      )}

      {/* Smart Suggestions */}
      {data.suggestions.length > 0 && (
        <AdminCard title={`Smart Suggestions (${data.suggestions.length})`} icon={Sparkle}>
          <div className="space-y-2">
            {data.suggestions.map((s, i) => (
              <div key={i} className={`p-3 rounded-xl border ${prioBorder(s.priority)}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-foreground/80">{s.title}</p>
                    <p className="text-[10px] text-foreground/50 mt-0.5">{s.description}</p>
                    <p className="text-[10px] text-foreground/30 mt-1 font-mono">{s.action}</p>
                  </div>
                  {s.auto_fixable && (
                    <button onClick={() => runTask(s.category)} className="px-3 py-1.5 rounded-lg bg-accent/10 text-accent text-[10px] font-semibold hover:bg-accent/20 transition-colors flex-shrink-0">
                      Auto-Fix
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </AdminCard>
      )}

      {/* Maintenance Tasks */}
      <AdminCard title="Wartung" icon={Wrench}>
        <div className="space-y-1.5">
          {data.maintenance_tasks.map(task => (
            <div key={task.task_type} className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-foreground/[0.02]">
              <div className={`w-2 h-2 rounded-full ${task.status === 'completed' ? 'bg-emerald-400' : task.status === 'running' ? 'bg-accent animate-pulse' : 'bg-foreground/20'}`} />
              <div className="flex-1">
                <p className="text-xs text-foreground/70 capitalize">{task.task_type.replace(/_/g, ' ')}</p>
                <p className="text-[10px] text-foreground/30">
                  {task.last_run ? `Letzte: ${new Date(task.last_run).toLocaleTimeString()}` : 'Nie'} · Nächste: {new Date(task.next_run).toLocaleTimeString()}
                </p>
              </div>
              {task.auto_enabled && <span className="text-[9px] px-1.5 py-0.5 rounded bg-foreground/[0.04] text-foreground/30">AUTO</span>}
              <button onClick={() => runTask(task.task_type)} disabled={runningTask === task.task_type}
                className="px-2 py-1 rounded text-[10px] text-foreground/30 hover:text-foreground/60 transition-colors disabled:opacity-30">
                {runningTask === task.task_type ? '…' : 'Jetzt'}
              </button>
            </div>
          ))}
        </div>
      </AdminCard>

      <div className="flex justify-end">
        <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-foreground/80 hover:text-accent hover:bg-accent/10 transition-all">
          <ArrowClockwise size={14} /> Aktualisieren
        </button>
      </div>
    </div>
  )
}

// ── Theme Marketplace (iframe embed) ──────────────────────────────────

export const DEFAULT_STORE_URL = 'http://localhost:3100'


export function ThemeMarketplace({ token, onInstall }: { token: string; onInstall: () => void }) {
  const [storeUrl, setStoreUrl] = useState(() => localStorage.getItem('iora-store-url') || DEFAULT_STORE_URL)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  // Listen for install messages from the store iframe
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.source !== 'iora-store') return

      if (event.data.action === 'install') {
        const { type, id, name } = event.data.payload
        if (type === 'theme') {
          installThemeFromStore(storeUrl, id, name, onInstall)
        }
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [storeUrl, onInstall])

  const installThemeFromStore = async (baseUrl: string, themeId: string, name: string, callback: () => void) => {
    try {
      toast.info(`Installiere "${name}" vom Store...`)
      const res = await fetch(`${baseUrl}/api/proxy/themes/${themeId}/download`)
      if (!res.ok) {
        // Try direct store API
        const storeApi = storeUrl.replace(/\/$/, '')
        const directRes = await fetch(`${storeApi}/api/themes/${themeId}/download`)
        if (!directRes.ok) throw new Error(`Download fehlgeschlagen`)
        const blob = await directRes.blob()
        await installFromBlob(blob, name, callback)
        return
      }
      const blob = await res.blob()
      await installFromBlob(blob, name, callback)
    } catch (e) {
      toast.error('Fehler: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  const installFromBlob = async (blob: Blob, name: string, callback: () => void) => {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binary = ''
    const chunkSize = 0x8000
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
    }
    const base64 = btoa(binary)

    const installRes = await authFetch('/api/themes/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zip_data: base64, file_name: `${name}.zip` }),
    })

    if (!installRes.ok) {
      const err = await installRes.json().catch(() => ({ message: 'Installation fehlgeschlagen' }))
      throw new Error(err.message || `HTTP ${installRes.status}`)
    }

    toast.success(`Theme "${name}" installiert!`)
    callback()
  }

  return (
    <AdminCard icon={Storefront} title="Theme-Marktplatz">
      <p className="text-xs text-foreground/50 mb-4">
        Entdecke und installiere Themes direkt aus dem IORA Store.
      </p>

      {/* Store URL config */}
      <div className="flex items-center gap-2 mb-4">
        <input
          type="text"
          value={storeUrl}
          onChange={(e) => {
            setStoreUrl(e.target.value)
            localStorage.setItem('iora-store-url', e.target.value)
          }}
          placeholder="Store URL (z.B. http://localhost:3100)"
          className="ora-field-sm flex-1 text-xs"
        />
        <button
          onClick={() => iframeRef.current?.contentWindow?.location.reload()}
          className="px-3 py-1.5 rounded-lg text-xs bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-all"
        >
          Neu laden
        </button>
      </div>

      {/* Iframe */}
      <div className="relative rounded-xl overflow-hidden border border-foreground/10 bg-background" style={{ height: '600px' }}>
        <iframe
          ref={iframeRef}
          src={storeUrl}
          className="w-full h-full"
          style={{ border: 'none' }}
          title="IORA Store"
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        />
        {/* Fallback if iframe fails */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center bg-background/80" style={{ zIndex: -1 }}>
          <div className="text-center">
            <Storefront size={32} className="mx-auto text-foreground/20 mb-2" />
            <p className="text-xs text-foreground/40">Store wird geladen...</p>
            <p className="text-[10px] text-foreground/30 mt-1">
              Stelle sicher, dass der Store unter {storeUrl} erreichbar ist
            </p>
          </div>
        </div>
      </div>

      <p className="text-[10px] text-foreground/30 mt-3 flex items-center gap-1.5">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400" />
        Store URL: <code className="text-foreground/40">{storeUrl}</code>
      </p>
    </AdminCard>
  )
}

// ── Themes Tab ────────────────────────────────────────────────────────

export function ThemesTab({ token }: { token: string }) {
  const { t: tr } = useTranslation()
  const [themes, setThemes] = useState<{ builtin: ThemeDef[]; installed: InstalledThemeDef[] } | null>(null)
  const [defaultTheme, setDefaultTheme] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [themeSearch, setThemeSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState<'all' | 'file' | 'app' | 'system'>('all')
  const { refreshThemes } = useTheme()

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [themesRes, defaultRes] = await Promise.all([
        authFetch('/api/themes'),
        authFetch('/api/themes/default'),
      ])
      if (!themesRes.ok) throw new Error(`HTTP ${themesRes.status}`)
      setThemes(await themesRes.json())
      if (defaultRes.ok) setDefaultTheme(await defaultRes.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const uninstallTheme = async (themeId: string) => {
    try {
      const r = await authFetch(`/api/themes/${themeId}`, { method: 'DELETE' })
      if (!r.ok) {
        const err = await r.json().catch(() => ({ message: 'Fehler beim Deinstallieren' }))
        toast.error(err.message || 'Fehler beim Deinstallieren')
        return
      }
      toast.success('Theme deinstalliert')
      load()
      refreshThemes()
    } catch (e) {
      toast.error('Fehler beim Deinstallieren: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  // Export theme as ZIP
  const exportTheme = async (themeId: string) => {
    try {
      // For file-based themes: download all assets as ZIP
      const res = await authFetch(`/api/themes/assets/${themeId}`)
      if (res.ok) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${themeId}.zip`
        a.click()
        URL.revokeObjectURL(url)
        toast.success(`Theme "${themeId}" exportiert`)
        return
      }
      // Fallback: download from assets
      toast.info('Theme wird als manifest.json exportiert')
    } catch (e) {
      toast.error('Export fehlgeschlagen: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  // Clone/duplicate a theme
  const cloneTheme = async (themeId: string, themeName: string) => {
    const newName = prompt('Name für das geklonte Theme:', `${themeName} (Kopie)`)
    if (!newName) return
    const newId = prompt('ID für das geklonte Theme:', `${themeId}-clone`)
    if (!newId) return

    try {
      // Fetch current theme data and re-install with new ID
      const themesRes = await authFetch('/api/themes')
      const data = await themesRes.json()
      const installed: any[] = data.installed || []
      const theme = installed.find((t: any) => t.id === themeId)
      if (!theme) { toast.error('Theme nicht gefunden'); return }

      // Build new inline theme manifest
      let cssVars: Record<string, string> = {}
      try { cssVars = JSON.parse(theme.css_variables || '{}') } catch {}

      const manifest = {
        id: newId,
        name: newName,
        version: '1.0.0',
        developer: theme.developer || 'IORA',
        description: `Klon von ${themeName}`,
        parent_theme: themeId,
        css_variables: cssVars,
      }

      const r = await authFetch('/api/themes/install-from-manifest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(manifest),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({ message: 'Klonen fehlgeschlagen' }))
        throw new Error(err.message)
      }
      toast.success(`Theme "${newName}" erstellt`)
      load()
      refreshThemes()
    } catch (e) {
      toast.error('Klonen fehlgeschlagen: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      // Quick client-side validation by reading the ZIP's manifest.json
      if (file.name.endsWith('.zip')) {
        try {
          const { extractManifestFromZip } = await import('@/lib/zip')
          const manifest = await extractManifestFromZip(file)
          const { quickValidateManifest, formatValidationIssues } = await import('@/lib/manifestValidation')
          const issues = quickValidateManifest(manifest as Record<string, unknown>)
          const errors = issues.filter(i => i.severity === 'error')
          if (errors.length > 0) {
            toast.error(formatValidationIssues(errors), { duration: 8000 })
            setUploading(false)
            e.target.value = ''
            return
          }
          const warnings = issues.filter(i => i.severity === 'warning')
          if (warnings.length > 0) {
            toast.warning(formatValidationIssues(warnings), { duration: 5000 })
          }
        } catch {
          // No manifest found or parse error – let the backend handle it
        }
      }

      const buf = await file.arrayBuffer()
      const bytes = new Uint8Array(buf)
      let binary = ''
      const chunkSize = 0x8000
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
      }
      const base64 = btoa(binary)
      const r = await authFetch('/api/themes/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zip_data: base64, file_name: file.name }),
      })
      if (!r.ok) {
        const text = await r.text().catch(() => '')
        let err: any = null
        try { err = text ? JSON.parse(text) : null } catch { err = null }
        const stage = err?.stage ? `[${err.stage}] ` : ''
        const msg = `${stage}${err?.message || err?.error || text || 'Installation fehlgeschlagen'}`
        toast.error(msg, { duration: 8000 })
        throw new Error(msg)
      }
      toast.success(`Theme „${file.name.replace(/\.zip$/i, '')}“ installiert`)
      load()
      refreshThemes()
    } catch (e) {
      if (!(e instanceof Error && e.message.includes('Manifest enthält Fehler'))) {
        toast.error('Fehler: ' + (e instanceof Error ? e.message : String(e)), { duration: 6000 })
      }
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const saveDefaultTheme = async (themeId: string) => {
    try {
      const config = { ...(defaultTheme || {}), theme_id: themeId }
      const r = await authFetch('/api/themes/default', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      if (!r.ok) throw new Error('Fehler beim Speichern')
      const data = await r.json()
      setDefaultTheme(data.config)
      toast.success('Standard-Theme aktualisiert')
    } catch (e) {
      toast.error('Fehler: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>Fehler: {error}</ErrorMessage>

  const installed = themes?.installed || []
  const builtin = themes?.builtin || []
  const enabledInstalled = installed.filter(t => t.enabled).length
  const filteredInstalled = installed.filter(t => {
    const q = themeSearch.trim().toLowerCase()
    const matchesSearch = !q || [t.name, t.id, t.description, t.developer, t.source]
      .filter(Boolean)
      .some(value => String(value).toLowerCase().includes(q))
    const matchesSource = sourceFilter === 'all'
      || (sourceFilter === 'system' ? t.system : t.source === sourceFilter)
    return matchesSearch && matchesSource
  })

  const allThemeOptions = [
    { id: 'auto', name: 'Automatisch (Tageszeit)', preview: 'linear-gradient(135deg, #e8eaf0 0%, #1a1d2e 100%)' },
    ...builtin.filter(t => t.id !== 'auto').map(t => ({ id: t.id, name: t.name, preview: getThemePreview(t.id) })),
    ...installed.filter(t => t.enabled).map(t => {
      let cssVars: Record<string, string> = {}
      try { cssVars = JSON.parse((t as any).css_variables || '{}') } catch {}
      const bg = cssVars['background'] || cssVars['bg'] || '#1a1d2e'
      const ac = cssVars['accent'] || cssVars['primary'] || '#6366f1'
      return { id: t.id, name: t.name, preview: `linear-gradient(135deg, ${bg} 0%, ${ac} 100%)` }
    }),
  ]

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="ora-card rounded-xl p-3">
          <div className="text-[10px] text-foreground/50 font-semibold uppercase">{tr('themes.overview.installed')}</div>
          <div className="text-lg font-semibold text-foreground">{installed.length}</div>
        </div>
        <div className="ora-card rounded-xl p-3">
          <div className="text-[10px] text-foreground/50 font-semibold uppercase">{tr('themes.overview.active')}</div>
          <div className="text-lg font-semibold text-success">{enabledInstalled}</div>
        </div>
        <div className="ora-card rounded-xl p-3">
          <div className="text-[10px] text-foreground/50 font-semibold uppercase">{tr('themes.overview.builtin')}</div>
          <div className="text-lg font-semibold text-accent">{builtin.length}</div>
        </div>
        <div className="ora-card rounded-xl p-3">
          <div className="text-[10px] text-foreground/50 font-semibold uppercase">{tr('common.default')}</div>
          <div className="text-sm font-semibold text-foreground truncate mt-1">{defaultTheme?.theme_id || 'auto'}</div>
        </div>
      </div>

      <div className="ora-card rounded-xl p-2 flex flex-col md:flex-row gap-2">
        <div className="relative flex-1">
          <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground/35" />
          <input
            value={themeSearch}
            onChange={(event) => setThemeSearch(event.target.value)}
            placeholder={tr('themes.overview.search')}
            className="ora-field-sm w-full pl-9 pr-3 text-xs"
          />
        </div>
        <div className="flex gap-1 overflow-x-auto">
          {(['all', 'file', 'app', 'system'] as const).map(source => (
            <button
              key={source}
              onClick={() => setSourceFilter(source)}
              className={`px-3 py-2 rounded-lg text-[10px] font-semibold transition-colors whitespace-nowrap ${sourceFilter === source ? 'bg-accent text-white' : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/10'}`}
            >
              {source === 'all' ? tr('common.all') : source === 'file' ? tr('common.manual') : source === 'app' ? tr('themes.overview.appPlugin') : tr('admin.system')}
            </button>
          ))}
        </div>
      </div>

      {/* Default Theme Section */}
      <AdminCard icon={Palette} title="Standard-Theme">
        <p className="text-xs text-foreground/50 mb-4">
          Lege das Standard-Theme für alle Benutzer ohne eigene Auswahl fest.
          Benutzer können ihr Theme in den Einstellungen überschreiben.
        </p>
        <div className="flex flex-wrap gap-2">
          {allThemeOptions.map(opt => {
            const isSelected = defaultTheme?.theme_id === opt.id || (!defaultTheme && opt.id === 'auto')
            return (
              <button
                key={opt.id}
                onClick={() => saveDefaultTheme(opt.id)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border-2 transition-all text-left ${
                  isSelected
                    ? 'border-accent bg-accent/10 shadow-sm'
                    : 'border-foreground/8 bg-foreground/[0.03] hover:border-foreground/18'
                }`}
              >
                <div className="w-8 h-8 rounded-lg shrink-0 border border-foreground/10" style={{ background: opt.preview }} />
                <div>
                  <p className={`text-xs font-medium ${isSelected ? 'text-accent' : 'text-foreground'}`}>{opt.name}</p>
                  <p className="text-[9px] text-foreground/40">{isSelected ? 'Aktiv' : 'Klicken zum Setzen'}</p>
                </div>
                {isSelected && <Check size={14} className="text-accent shrink-0" weight="bold" />}
              </button>
            )
          })}
        </div>
      </AdminCard>

      {/* Theme Upload Section */}
      <AdminCard icon={UploadSimple} title="Theme hochladen">
        <p className="text-xs text-foreground/50 mb-4">
          Lade ein Theme als ZIP-Datei hoch (manifest.json + CSS/JS/Fonts/Assets).
        </p>
        <label className={`relative flex flex-col items-center justify-center gap-2 p-8 rounded-xl border-2 border-dashed transition-all cursor-pointer ${
          uploading ? 'border-accent/50 bg-accent/5' : 'border-foreground/15 hover:border-foreground/30 bg-foreground/[0.02] hover:bg-foreground/[0.04]'
        }`}>
          <input type="file" accept=".zip" className="sr-only" onChange={handleFileUpload} disabled={uploading} />
          {uploading ? (
            <>
              <div className="animate-spin w-8 h-8 border-2 border-accent border-t-transparent rounded-full" />
              <p className="text-sm text-foreground/50">Installiere Theme…</p>
            </>
          ) : (
            <>
              <UploadSimple size={32} className="text-foreground/30" weight="thin" />
              <p className="text-sm font-medium text-foreground/60">Theme-ZIP auswählen</p>
              <p className="text-[10px] text-foreground/30">manifest.json + CSS-Dateien + Assets</p>
            </>
          )}
        </label>
      </AdminCard>

      {/* Installed themes */}
      <AdminCard icon={Palette} title="Installierte Themes">
        <p className="text-xs text-foreground/50 mb-4">Verwalte installierte Themes</p>
        {installed.length === 0 ? (
          <div className="text-center py-12">
            <Palette size={48} weight="thin" className="mx-auto text-foreground/20 mb-4" />
            <p className="text-sm text-foreground/50">Keine benutzerdefinierten Themes installiert</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {filteredInstalled.map((t) => {
              let cssVars: Record<string, string> = {}
              try { cssVars = JSON.parse((t as any).css_variables || '{}') } catch {}
              const bgColor = cssVars['background'] || cssVars['bg'] || '#1a1d2e'
              const accentColor = cssVars['accent'] || cssVars['primary'] || '#6366f1'
              const isDefault = defaultTheme?.theme_id === t.id
              return (
                <div key={t.id} className="flex items-center gap-4 p-4 rounded-xl border border-foreground/[0.06] bg-foreground/[0.02]">
                  <div className="w-12 h-12 rounded-xl shrink-0 border border-foreground/10" style={{ background: `linear-gradient(135deg, ${bgColor} 0%, ${accentColor} 100%)` }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-foreground">{t.name}</p>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-foreground/5 text-foreground/40">v{t.version}</span>
                      {t.system && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/10 text-accent">System</span>}
                      {isDefault && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-success/10 text-success">Standard</span>}
                    </div>
                    {t.description && <p className="text-xs text-foreground/50 mt-0.5 truncate">{t.description}</p>}
                    <p className="text-[10px] text-foreground/30 mt-0.5">Von {t.developer || 'Unbekannt'} · ID {t.id} · {t.source === 'file' ? 'Manuell' : 'App/Plugin'}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full ${t.enabled ? 'bg-success/10 text-success' : 'bg-foreground/5 text-foreground/40'}`}>
                      {t.enabled ? <Check size={10} /> : <EyeSlash size={10} />} {t.enabled ? 'Aktiv' : 'Inaktiv'}
                    </span>
                    <button
                      onClick={() => saveDefaultTheme(t.id)}
                      disabled={isDefault || !t.enabled}
                      className="px-2 py-1 rounded-lg text-[10px] font-semibold bg-accent/10 text-accent hover:bg-accent/20 transition-all disabled:opacity-40 disabled:hover:bg-accent/10"
                      title={t.enabled ? tr('themes.overview.setAsDefault') : tr('themes.overview.inactiveDefaultBlocked')}
                    >
                      {tr('common.default')}
                    </button>
                    {!t.system && (
                      <>
                        <button onClick={() => cloneTheme(t.id, t.name)} className="p-2 rounded-lg text-foreground/30 hover:text-accent hover:bg-accent/10 transition-all" title="Klonen"><Copy size={14} /></button>
                        <button onClick={() => exportTheme(t.id)} className="p-2 rounded-lg text-foreground/30 hover:text-accent hover:bg-accent/10 transition-all" title="Exportieren"><DownloadSimple size={14} /></button>
                        <button onClick={() => uninstallTheme(t.id)} className="p-2 rounded-lg text-foreground/30 hover:text-red-400 hover:bg-red-500/10 transition-all" title="Deinstallieren"><TrashSimple size={16} /></button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
            {filteredInstalled.length === 0 && (
              <div className="text-center py-10 text-xs text-foreground/45">
                {tr('themes.overview.noFiltered')}
              </div>
            )}
          </div>
        )}
      </AdminCard>

      {/* ─── Theme Marketplace (iframe) ─────────────────────── */}
      <AdminCard icon={Storefront} title="Theme-Marktplatz">
        <p className="text-xs text-foreground/50 mb-4">
          Durchstöbere und installiere Themes direkt aus dem IORA Store.
        </p>
        <ThemeMarketplace token={token} onInstall={() => { load(); refreshThemes() }} />
      </AdminCard>

      {/* Built-in themes */}
      <AdminCard icon={Swatches} title="Integrierte Farbschemas">
        <p className="text-xs text-foreground/50 mb-4">Die sechs Standard-Farbschemas von IORA</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {builtin.filter(t => t.id !== 'auto').sort((a: ThemeDef, b: ThemeDef) => (a.order || 50) - (b.order || 50)).map((t) => (
            <div key={t.id} className="flex flex-col items-center gap-1.5 p-3 rounded-xl border border-foreground/[0.04] bg-foreground/[0.02]">
              <div className="w-10 h-10 rounded-xl border border-foreground/10" style={{ background: getThemePreview(t.id) }} />
              <p className="text-[10px] font-medium text-foreground truncate w-full text-center">{t.name}</p>
              <p className="text-[8px] text-foreground/30">{t.id}</p>
            </div>
          ))}
        </div>
      </AdminCard>
    </div>
  )
}

// Helper for theme previews

export function getThemePreview(themeId: string): string {
  const previews: Record<string, string> = {
    auto: 'linear-gradient(135deg, #e8eaf0 0%, #1a1d2e 100%)',
    light: 'linear-gradient(135deg, #f5f5f7 0%, #e8eaf0 50%, #dde0e8 100%)',
    day: 'linear-gradient(135deg, #e0e4ec 0%, #c8cdd8 50%, #b8bfcc 100%)',
    'day-classic': 'linear-gradient(135deg, #2a2d3e 0%, #1a1d2e 50%, #0f1118 100%)',
    evening: 'linear-gradient(135deg, #2d2f4a 0%, #1e2040 50%, #15172e 100%)',
    night: 'linear-gradient(135deg, #181c2e 0%, #0f1220 50%, #0a0d18 100%)',
    sleep: 'linear-gradient(135deg, #050508 0%, #000000 100%)',
  }
  return previews[themeId] || 'linear-gradient(135deg, #1a1d2e 0%, #2a2d4e 100%)'
}

export interface ThemeDef {
  id: string; name: string; version: string; order?: number;
}
export interface InstalledThemeDef {
  id: string; name: string; version: string; developer: string;
  description: string; system: boolean; enabled: boolean;
  source: string; icon?: string;
}

// ── Presence Tab ────────────────────────────────────────────────
// Live overview of which users are currently online and on which devices
// (browser, kiosk, IORA Desktop) they are logged in. Auto-refreshes every
// 15s; the backend marks a device online when its last_seen is within
// `online_threshold_seconds` (default 120s).

export interface PresenceDeviceRef {
  device_id: string
  device_name: string
  device_type: string | null
  is_primary: boolean
  is_desktop_client: boolean
  online: boolean
  last_seen: string | null
}

export interface PresenceUser {
  id: string
  username: string
  display_name: string | null
  avatar_url: string | null
  role: string
  is_admin: boolean
  online: boolean
  device_count: number
  devices: PresenceDeviceRef[]
}

export interface PresenceDevice {
  id: string
  device_name: string
  device_type: string | null
  user_agent: string | null
  is_terminal: boolean
  terminal_name: string | null
  last_seen: string
  online: boolean
  seconds_since_seen: number
  user_ids: string[]
}

export interface PresencePayload {
  users: PresenceUser[]
  devices: PresenceDevice[]
  totals: {
    users: number
    online_users: number
    devices: number
    online_devices: number
    connected_ws_clients: number
  }
  online_threshold_seconds: number
  generated_at: string
}
