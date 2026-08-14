import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AppWindow,
  ArrowLeft,
  ArrowSquareOut,
  CaretRight,
  Play,
  ShieldCheck,
  Stop,
  TrashSimple,
} from '@phosphor-icons/react'
import { Switch } from '@/components/ui/switch'
import { useInstalledApps, appGradient } from '@/hooks/useInstalledApps'
import { authFetch } from '@/lib/authHelpers'
import { isAppOpenExternal, setAppOpenExternal } from '@/lib/appOpenPrefs'
import { displayModeOf, type AppDisplayConfig } from '@/lib/appGateway'
import { ToggleRow } from './settings/shared'
import { AppStatusBadge } from '@/components/app/AppStatusBadge'

/**
 * Settings → Apps — Apple-settings-style per-app pages.
 *
 * Every installed app gets its own page: lifecycle (start/stop), the
 * per-app "open outside ORA OS" switch (direct port in a browser tab
 * instead of the embedded gateway runner) and permission management
 * (granted/denied toggles, persisted via the app permissions API).
 */

interface SettingsAppInfo {
  id: string
  name: string
  version?: string
  developer?: string
  description?: string
  icon?: string
  status?: string
  enabled?: boolean
  ports?: Array<string | { external: number; internal: number; protocol: string }>
  open_url?: string | null
  display?: AppDisplayConfig | null
  system?: boolean
  kind?: string
}

interface SettingsAppDetail {
  id: string
  name: string
  version: string
  developer: string
  description: string
  icon?: string
  status: string
  enabled: boolean
  kind?: string
  permissions: string[]
  permission_grants?: Array<{ permission: string; is_active?: boolean }>
  denied_permissions?: string[]
  ports?: Array<{ internal: number; external: number; protocol: string }>
  open_url?: string | null
  is_bundle?: boolean
  display?: AppDisplayConfig | null
}

export function SettingsAppsSection({ initialSelectedId, onSelectApp }: { initialSelectedId?: string | null; onSelectApp?: (appId: string) => void } = {}) {
  const { t } = useTranslation()
  const { allApps, refresh } = useInstalledApps()
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null)

  // Keep the detail view in sync with the URL deep link (back/forward or
  // a direct /settings/apps/<id> navigation).
  useEffect(() => {
    if (initialSelectedId !== undefined) {
      setSelectedId(initialSelectedId)
    }
  }, [initialSelectedId])

  const selectApp = (appId: string) => {
    setSelectedId(appId)
    onSelectApp?.(appId)
  }

  const apps = allApps
    .filter((app) => app.kind !== 'plugin' && app.id !== 'iora-developer-app')
    .map((app) => app as unknown as SettingsAppInfo)

  if (selectedId) {
    return (
      <SettingsAppDetailPage
        appId={selectedId}
        onBack={() => { setSelectedId(null); onSelectApp?.('') }}
        onChanged={refresh}
      />
    )
  }

  return (
    <div className="space-y-5">
      <p className="text-xs leading-relaxed text-foreground/50">{t('settings.appsDesc')}</p>
      {apps.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-foreground/8 bg-foreground/[0.03] p-8 text-center">
          <AppWindow size={32} weight="duotone" className="text-foreground/25" />
          <p className="text-sm text-foreground/55">{t('settings.appsEmpty')}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-foreground/8 bg-foreground/[0.02]">
          {apps.map((app, index) => (
            <button
              key={app.id}
              type="button"
              onClick={() => selectApp(app.id)}
              className={`group flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-foreground/[0.04] ${
                index > 0 ? 'border-t border-foreground/6' : ''
              }`}
            >
              <span
                className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl text-sm font-bold text-white shadow-lg"
                style={{ background: appGradient(app.id) }}
              >
                {app.icon ? (
                  <img src={app.icon} alt="" className="h-full w-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                ) : (
                  app.name?.charAt(0)?.toUpperCase()
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground/90">{app.name || app.id}</span>
                <span className="mt-0.5 flex items-center gap-2">
                  <AppStatusBadge status={app.status} compact />
                  {isAppOpenExternal(app.id) && (
                    <span className="rounded-full bg-accent/12 px-2 py-0.5 text-[9px] font-semibold text-accent">
                      {t('settings.appExternalBadge')}
                    </span>
                  )}
                </span>
              </span>
              <CaretRight size={16} className="shrink-0 text-foreground/25 transition-transform group-hover:translate-x-0.5" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Per-app detail page (Apple-settings push) ───────────────────────────

function SettingsAppDetailPage({
  appId,
  onBack,
  onChanged,
}: {
  appId: string
  onBack: () => void
  onChanged: () => void
}) {
  const { t } = useTranslation()
  const [detail, setDetail] = useState<SettingsAppDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [granted, setGranted] = useState<Set<string>>(new Set())
  const [openExternal, setOpenExternal] = useState(() => isAppOpenExternal(appId))

  const load = async () => {
    setLoading(true)
    try {
      const res = await authFetch(`/api/apps/${appId}/detail`)
      if (!res.ok) {
        setDetail(null)
        return
      }
      const data = await res.json() as SettingsAppDetail
      setDetail(data)
      const active = new Set(
        (data.permission_grants || [])
          .filter((g) => g.is_active !== false)
          .map((g) => g.permission),
      )
      setGranted(active.size > 0 ? active : new Set((data.permissions || []).filter((p) => !(data.denied_permissions || []).includes(p))))
    } catch {
      setDetail(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [appId])

  const toast = (message: string) => window.dispatchEvent(new CustomEvent('iora:toast', { detail: { message } }))

  const runAction = async (action: 'start' | 'stop') => {
    setBusy(action)
    try {
      const res = await authFetch(`/api/supervisor/apps/${appId}/${action}`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: string; message?: string } | null
        throw new Error(data?.error || data?.message || `HTTP ${res.status}`)
      }
      toast(t(action === 'start' ? 'os.quickActions.started' : 'os.quickActions.stopped', { name: detail?.name || appId }))
      window.dispatchEvent(new Event('iora:installed-apps-refresh'))
      onChanged()
      await load()
    } catch (e) {
      toast(t('os.quickActions.actionFailed', { detail: e instanceof Error ? e.message : String(e) }))
    } finally {
      setBusy(null)
    }
  }

  const savePermissions = async () => {
    setBusy('permissions')
    try {
      const denied = (detail?.permissions || []).filter((p) => !granted.has(p))
      const res = await authFetch(`/api/apps/${appId}/permissions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ granted_permissions: [...granted], denied_permissions: denied }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: string; message?: string } | null
        throw new Error(data?.error || data?.message || `HTTP ${res.status}`)
      }
      toast(t('apps.detail.permissionsUpdated'))
    } catch (e) {
      toast(t('os.quickActions.actionFailed', { detail: e instanceof Error ? e.message : String(e) }))
    } finally {
      setBusy(null)
    }
  }

  const uninstall = async () => {
    if (!detail) return
    if (!window.confirm(t('os.quickActions.uninstallConfirm', { name: detail.name }))) return
    setBusy('uninstall')
    try {
      const res = await authFetch(`/api/appstore/apps/${appId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: string; message?: string } | null
        throw new Error(data?.error || data?.message || `HTTP ${res.status}`)
      }
      toast(t('os.quickActions.uninstalled', { name: detail.name }))
      window.dispatchEvent(new Event('iora:installed-apps-refresh'))
      onChanged()
      onBack()
    } catch (e) {
      toast(t('os.quickActions.actionFailed', { detail: e instanceof Error ? e.message : String(e) }))
    } finally {
      setBusy(null)
    }
  }

  const externalUrl = detail?.open_url
    || (detail?.ports?.[0] ? `http://localhost:${detail.ports[0].external}` : undefined)
  const running = detail?.status === 'running'
  const starting = detail?.status === 'starting'
  const embeddedMode = displayModeOf(detail?.display ?? null)

  return (
    <div className="space-y-5">
      {/* Header */}
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 rounded-full border border-foreground/10 bg-foreground/[0.04] px-3.5 py-2 text-xs font-semibold text-foreground/70 transition-colors hover:bg-foreground/[0.08] hover:text-foreground"
      >
        <ArrowLeft size={14} weight="bold" />
        {t('apps.appStore.back')}
      </button>

      {loading ? (
        <div className="flex items-center justify-center py-14">
          <span className="h-7 w-7 animate-spin rounded-full border-2 border-foreground/20 border-t-accent" />
        </div>
      ) : !detail ? (
        <div className="rounded-2xl border border-foreground/8 bg-foreground/[0.03] p-8 text-center text-sm text-foreground/55">
          {t('os.launcher.appNotFound')}
        </div>
      ) : (
        <>
          {/* App header */}
          <div className="flex items-center gap-4 rounded-2xl border border-foreground/8 bg-foreground/[0.03] p-4">
            <span
              className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl text-2xl font-bold text-white shadow-xl"
              style={{ background: appGradient(appId) }}
            >
              {detail.icon && !detail.icon.includes('default-app-icon') ? (
                <img src={detail.icon} alt="" className="h-full w-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
              ) : (
                detail.name?.charAt(0)?.toUpperCase()
              )}
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-lg font-semibold text-foreground">{detail.name}</h3>
              <p className="mt-0.5 truncate text-xs text-foreground/50">
                {detail.version} · {detail.developer || '—'}
              </p>
              <span className="mt-2 inline-flex"><AppStatusBadge status={detail.status} /></span>
            </div>
            <div className="flex shrink-0 flex-col gap-2">
              {running || starting ? (
                <button
                  type="button"
                  onClick={() => void runAction('stop')}
                  disabled={busy !== null || starting}
                  className="flex items-center justify-center gap-1.5 rounded-full border border-foreground/10 bg-foreground/5 px-4 py-2 text-xs font-semibold text-foreground/75 hover:bg-foreground/10 disabled:opacity-50"
                >
                  <Stop size={13} weight="fill" /> {t('os.quickActions.stop')}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void runAction('start')}
                  disabled={busy !== null}
                  className="flex items-center justify-center gap-1.5 rounded-full bg-accent px-4 py-2 text-xs font-semibold text-white hover:bg-accent/90 disabled:opacity-50"
                >
                  <Play size={13} weight="fill" /> {t('os.quickActions.start')}
                </button>
              )}
              {externalUrl && (
                <button
                  type="button"
                  onClick={() => window.open(externalUrl, '_blank', 'noopener,noreferrer')}
                  className="flex items-center justify-center gap-1.5 rounded-full border border-foreground/10 bg-foreground/5 px-4 py-2 text-xs font-semibold text-foreground/75 hover:bg-foreground/10"
                >
                  <ArrowSquareOut size={13} /> {t('apps.appStore.openPort')}
                </button>
              )}
            </div>
          </div>

          {detail.description && (
            <p className="text-xs leading-relaxed text-foreground/55">{detail.description}</p>
          )}

          {/* Display / embedding */}
          <div className="rounded-2xl border border-foreground/8 bg-foreground/[0.03] p-1">
            <ToggleRow
              label={t('settings.appExternalToggle')}
              description={t('settings.appExternalToggleDesc')}
              checked={openExternal}
              onCheckedChange={(value) => {
                setOpenExternal(value)
                setAppOpenExternal(appId, value)
              }}
            />
            <div className="border-t border-foreground/6 px-4 py-3">
              <p className="text-[11px] text-foreground/45">
                {t('settings.appEmbedMode')}:{' '}
                <span className="font-semibold text-foreground/70">{embeddedMode}</span>
                {openExternal && ` · ${t('settings.appExternalOverride')}`}
              </p>
            </div>
          </div>

          {/* Permissions */}
          {detail.permissions.length > 0 && (
            <div className="rounded-2xl border border-foreground/8 bg-foreground/[0.03] p-4">
              <div className="mb-3 flex items-center gap-2">
                <ShieldCheck size={16} weight="duotone" className="text-accent" />
                <h4 className="text-sm font-semibold text-foreground">{t('settings.appPermissions')}</h4>
              </div>
              <div className="space-y-1.5">
                {detail.permissions.map((permission) => {
                  const checked = granted.has(permission)
                  return (
                    <label
                      key={permission}
                      className="flex items-center justify-between gap-3 rounded-xl bg-foreground/[0.03] px-3.5 py-3 transition-colors hover:bg-foreground/[0.05]"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-mono text-xs font-medium text-foreground/85">{permission}</span>
                        <span className={`text-[10px] ${checked ? 'text-emerald-400/80' : 'text-red-400/80'}`}>
                          {checked ? t('apps.detail.permissions.granted') : t('apps.detail.permissions.denied')}
                        </span>
                      </span>
                      <Switch
                        checked={checked}
                        onCheckedChange={(value) => {
                          setGranted((current) => {
                            const next = new Set(current)
                            if (value) next.add(permission)
                            else next.delete(permission)
                            return next
                          })
                        }}
                        className="shrink-0"
                      />
                    </label>
                  )
                })}
              </div>
              <button
                type="button"
                onClick={() => void savePermissions()}
                disabled={busy !== null}
                className="mt-4 flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-accent text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-50"
              >
                {busy === 'permissions' && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />}
                {t('common.save')}
              </button>
            </div>
          )}

          {/* Danger zone */}
          {!detail.is_bundle && detail.kind !== 'system' && (
            <div className="rounded-2xl border border-red-500/20 bg-red-500/[0.06] p-4">
              <h4 className="text-sm font-semibold text-red-300">{t('settings.appDangerZone')}</h4>
              <button
                type="button"
                onClick={() => void uninstall()}
                disabled={busy !== null}
                className="mt-3 flex min-h-10 items-center justify-center gap-2 rounded-xl border border-red-400/25 bg-red-500/10 text-sm font-semibold text-red-300 hover:bg-red-500/15 disabled:opacity-50"
              >
                <TrashSimple size={15} />
                {t('os.quickActions.uninstall')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
