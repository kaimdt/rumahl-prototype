import { useCallback, useEffect, useState } from 'react'
import { ShieldCheck } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { authFetch } from '@/lib/authHelpers'

const PERMISSIONS = [
  'os.files.read',
  'os.files.write',
  'os.network.read',
  'os.network.write',
  'os.system.read',
  'os.power',
  'os.updates',
  'os.backups',
  'os.services',
  'os.terminal',
] as const

export function OsPermissionEditor({ userId, isAdmin }: { userId: string; isAdmin: boolean }) {
  const { t } = useTranslation()
  const [permissions, setPermissions] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await authFetch(`/api/admin/users/${userId}/os-permissions`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      setPermissions(data.permissions || {})
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    load()
  }, [load])

  const save = async () => {
    setSaving(true)
    try {
      const response = await authFetch(`/api/admin/users/${userId}/os-permissions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(permissions),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border border-foreground/10 bg-foreground/3 p-3">
      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck size={15} className="text-accent" />
        <span className="text-xs font-semibold">{t('os.permissions.title')}</span>
        {isAdmin && <span className="ml-auto text-[10px] text-foreground/40">{t('os.permissions.adminFullAccess')}</span>}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {PERMISSIONS.map((permission) => (
          <label key={permission} className="flex items-center gap-2 rounded-lg bg-foreground/5 px-3 py-2 text-xs">
            <input
              type="checkbox"
              checked={isAdmin || permissions[permission] === true}
              disabled={isAdmin || loading}
              onChange={(event) => setPermissions((current) => ({ ...current, [permission]: event.target.checked }))}
              className="accent-accent"
            />
            <span>{t(`os.permissions.items.${permission}`)}</span>
          </label>
        ))}
      </div>
      {!isAdmin && (
        <div className="mt-3 flex justify-end">
          <button type="button" onClick={save} disabled={loading || saving} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      )}
    </div>
  )
}
