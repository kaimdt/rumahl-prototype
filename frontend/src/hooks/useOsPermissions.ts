import { useCallback, useEffect, useState } from 'react'
import { authFetch } from '@/lib/authHelpers'

export type OsPermission =
  | 'os.files.read'
  | 'os.files.write'
  | 'os.network.read'
  | 'os.network.write'
  | 'os.system.read'
  | 'os.power'
  | 'os.updates'
  | 'os.backups'
  | 'os.services'
  | 'os.terminal'

export function useOsPermissions() {
  const [permissions, setPermissions] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const response = await authFetch('/api/os/permissions')
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      setPermissions(data.permissions || {})
    } catch {
      setPermissions({})
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return {
    permissions,
    loading,
    refresh,
    can: useCallback((permission: OsPermission) => permissions[permission] === true, [permissions]),
  }
}
