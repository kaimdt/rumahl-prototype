import { useCallback, useEffect, useState } from 'react'
import { Archive, ArrowClockwise, DownloadSimple, ShieldCheck } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { authFetch } from '@/lib/authHelpers'
import { OsAppNavbar } from '@/components/OsAppNavbar'

interface UpdateInfo {
  provider_id: string
  current_version: string
  latest_version: string
  channel: string
  update_available: boolean
  is_critical: boolean
  release_notes?: string
}

interface BackupInfo {
  id: string
  name: string
  backup_type: string
  created_at: string
  size_bytes: number
  status: string
}

function formatBytes(value = 0) {
  if (value < 1024) return `${value} B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`
  return `${(value / 1024 ** 3).toFixed(1)} GB`
}

export function OsMaintenanceApp({ kind }: { kind: 'updates' | 'backups' }) {
  const { t } = useTranslation()
  const [updates, setUpdates] = useState<UpdateInfo[]>([])
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState<{ action: 'install' | 'restore'; id: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await authFetch(kind === 'updates' ? '/api/core/updates/check' : '/api/os/backups/list')
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      if (kind === 'updates') setUpdates(data.updates || [])
      else setBackups(data.backups || [])
    } catch {
      setError(t('os.maintenance.unavailable'))
    } finally {
      setLoading(false)
    }
  }, [kind, t])

  useEffect(() => {
    load()
  }, [load])

  const createBackup = async () => {
    setWorking(true)
    setError('')
    try {
      const response = await authFetch('/api/os/backups/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          backup_type: 'manual',
          include_databases: true,
          include_docker_volumes: true,
          include_system_config: true,
          include_user_data: true,
          include_apps: true,
        }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      await load()
    } catch {
      setError(t('os.maintenance.backupFailed'))
    } finally {
      setWorking(false)
    }
  }

  const executeConfirmedAction = async () => {
    if (!confirm) return
    setWorking(true)
    setError('')
    try {
      const response = confirm.action === 'install'
        ? await authFetch(`/api/core/updates/${confirm.id}/install`, { method: 'POST' })
        : await authFetch('/api/os/backups/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ backup_id: confirm.id }),
          })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setConfirm(null)
      await load()
    } catch {
      setError(confirm.action === 'install' ? t('os.maintenance.updateFailed') : t('os.maintenance.restoreFailed'))
    } finally {
      setWorking(false)
    }
  }

  return (
    <section className="ora-app-frame mx-auto max-w-7xl overflow-hidden">
      <OsAppNavbar
        pageId={`os-${kind}`}
        title={t(`os.apps.${kind}.name`)}
        description={t(`os.apps.${kind}.description`)}
        icon={kind === 'updates' ? <DownloadSimple size={24} weight="duotone" /> : <Archive size={24} weight="duotone" />}
        accent={kind === 'updates' ? 'oklch(0.66 0.18 255)' : 'oklch(0.66 0.16 45)'}
        trailing={
          <button type="button" onClick={load} disabled={loading} className="ora-icon-button" title={t('common.refresh')}>
            <ArrowClockwise size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        }
      />

      <div className="p-4 pb-10 sm:p-6">
      {error && <div className="mb-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>}

      {kind === 'updates' ? (
        <div className="space-y-3">
          {updates.length === 0 && !loading && <div className="ora-card rounded-3xl p-8 text-center text-sm text-foreground/45">{t('os.maintenance.noUpdateData')}</div>}
          {updates.map((update) => (
            <article key={update.provider_id} className="ora-card rounded-3xl p-5">
              <div className="flex items-start gap-4">
                <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${update.update_available ? 'bg-accent/15 text-accent' : 'bg-emerald-500/10 text-emerald-300'}`}>
                  {update.update_available ? <DownloadSimple size={25} weight="duotone" /> : <ShieldCheck size={25} weight="duotone" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold">{update.provider_id}</h2>
                    <span className="rounded-full bg-foreground/7 px-2 py-0.5 text-[10px]">{update.channel}</span>
                    {update.is_critical && <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-300">{t('os.maintenance.critical')}</span>}
                  </div>
                  <p className="mt-1 text-xs text-foreground/45">{update.current_version} → {update.latest_version}</p>
                  {update.release_notes && <p className="mt-3 text-sm text-foreground/60">{update.release_notes}</p>}
                </div>
                {update.update_available && <button type="button" onClick={() => setConfirm({ action: 'install', id: update.provider_id })} className="rounded-xl bg-accent px-3 py-2 text-xs font-semibold text-white">{t('os.maintenance.install')}</button>}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <button type="button" onClick={createBackup} disabled={working} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">
            <Archive size={18} /> {t('os.maintenance.createBackup')}
          </button>
          <div className="ora-card overflow-hidden rounded-3xl">
            {backups.length === 0 && !loading ? <p className="p-8 text-center text-sm text-foreground/45">{t('os.maintenance.noBackups')}</p> : backups.map((backup) => (
              <div key={backup.id} className="flex items-center gap-3 border-b border-foreground/7 p-4 last:border-0">
                <Archive size={22} weight="duotone" className="text-accent" />
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{backup.name}</p><p className="text-xs text-foreground/40">{new Date(backup.created_at).toLocaleString()} · {formatBytes(backup.size_bytes)}</p></div>
                <button type="button" onClick={() => setConfirm({ action: 'restore', id: backup.id })} className="rounded-xl bg-foreground/7 px-3 py-2 text-xs hover:bg-foreground/12">{t('os.maintenance.restore')}</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {confirm && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 p-4 backdrop-blur-md" onClick={() => !working && setConfirm(null)}>
          <div className="ora-card w-full max-w-sm rounded-3xl p-6" onClick={(event) => event.stopPropagation()}>
            <h2 className="text-lg font-semibold">{confirm.action === 'install' ? t('os.maintenance.confirmUpdate') : t('os.maintenance.confirmRestore')}</h2>
            <p className="mt-2 text-sm text-foreground/50">{confirm.action === 'install' ? t('os.maintenance.confirmUpdateHint') : t('os.maintenance.confirmRestoreHint')}</p>
            <div className="mt-5 flex gap-2"><button type="button" disabled={working} onClick={() => setConfirm(null)} className="flex-1 rounded-xl bg-foreground/8 px-3 py-2 text-sm">{t('common.cancel')}</button><button type="button" disabled={working} onClick={executeConfirmedAction} className="flex-1 rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{t('common.confirm')}</button></div>
          </div>
        </div>
      )}
      </div>
    </section>
  )
}
