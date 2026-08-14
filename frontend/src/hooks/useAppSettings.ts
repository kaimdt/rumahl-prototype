import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useConfiguration } from '@/contexts/ConfigurationContext'
import { useLocalStorage } from '@/lib/storage'
import { getBackendUrl } from '@/lib/config'
import { wsOnMessage } from '@/lib/wsConnection'
import { toast } from 'sonner'

async function hashPin(pin: string): Promise<string> {
  const encoded = new TextEncoder().encode(pin)
  const digest = await crypto.subtle.digest('SHA-256', encoded)
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * useAppSettings — the account/security/maintenance state that used to live
 * inline in DashboardContent. Extracted so the page body stays focused and
 * the settings bundle has one clear owner.
 */
export function useAppSettings() {
  const { user, updateProfile } = useAuth()
  const { getPreference, savePreference } = useConfiguration()

  const [maintenanceMode, setMaintenanceMode] = useState(false)
  const [maintenanceMessage, setMaintenanceMessage] = useState('')
  const [deviceLockMode, setDeviceLockMode] = useState(false)
  const [lockLoading, setLockLoading] = useState(false)
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [profileUsername, setProfileUsername] = useState('')
  const [profileDisplayName, setProfileDisplayName] = useState('')
  const [pinCode, setPinCode] = useState('')
  const [pinConfirm, setPinConfirm] = useState('')
  const [pinHash, setPinHash] = useState<string | null>(null)
  const [unlockPinInput, setUnlockPinInput] = useState('')
  const [showUnlockDialog, setShowUnlockDialog] = useState(false)
  const [aiEnabled, setAiEnabled] = useLocalStorage('ha-ai-enabled', true)

  // Whether IORA Home has Home Assistant configured and enabled.
  const [haConfigured, setHaConfigured] = useState<boolean | null>(null)
  const [haEnabled, setHaEnabled] = useState<boolean>(true)
  useEffect(() => {
    let cancelled = false
    const refreshHaStatus = () => {
      fetch(`${getBackendUrl()}/api/integration/ha/configured`)
        .then(r => (r.ok ? r.json() : null))
        .then((data: { configured?: boolean; enabled?: boolean } | null) => {
          if (cancelled || !data) return
          setHaConfigured(Boolean(data.configured))
          setHaEnabled(data.enabled !== false)
        })
        .catch(() => { if (!cancelled) setHaConfigured(false) })
    }
    refreshHaStatus()
    const onFocus = () => refreshHaStatus()
    window.addEventListener('focus', onFocus)
    return () => { cancelled = true; window.removeEventListener('focus', onFocus) }
  }, [])

  // Check if current user can bypass maintenance mode
  const canBypassMaintenance = user?.isAdmin || user?.role === 'maintenance' || user?.role === 'admin'

  // Fetch maintenance status on mount + listen for WebSocket events
  useEffect(() => {
    let mounted = true
    fetch(`${getBackendUrl()}/api/maintenance/status`)
      .then(r => r.json())
      .then((data: { active: boolean; message: string }) => {
        if (!mounted) return
        setMaintenanceMode(data.active)
        setMaintenanceMessage(data.message || '')
      })
      .catch(() => {})
    const unsub = wsOnMessage((data: unknown) => {
      const msg = data as Record<string, unknown>
      if (msg.type === 'maintenance_mode') {
        setMaintenanceMode(msg.active as boolean)
        setMaintenanceMessage((msg.message as string) || '')
      }
    })
    return () => { mounted = false; unsub() }
  }, [])

  useEffect(() => {
    let mounted = true
    if (!user) return
    ;(async () => {
      try {
        const pref = await getPreference('device_lock_mode')
        if (mounted && typeof pref === 'boolean') setDeviceLockMode(pref)
      } catch {
        // ignore preference load errors
      }
    })()
    return () => { mounted = false }
  }, [user, getPreference])

  useEffect(() => {
    setProfileUsername(user?.username ?? '')
    setProfileDisplayName(user?.displayName ?? '')
  }, [user?.username, user?.displayName])

  useEffect(() => {
    let mounted = true
    if (!user) return
    ;(async () => {
      try {
        const pref = await getPreference('settings_pin_hash')
        if (mounted && typeof pref === 'string') setPinHash(pref)
      } catch {
        // ignore preference load errors
      }
    })()
    return () => { mounted = false }
  }, [user, getPreference])

  const updateDeviceLockMode = useCallback(async (next: boolean) => {
    if (!next && deviceLockMode && pinHash) {
      setUnlockPinInput('')
      setShowUnlockDialog(true)
      return
    }
    setLockLoading(true)
    setDeviceLockMode(next)
    try {
      await savePreference('device_lock_mode', next)
    } catch {
      setDeviceLockMode(!next)
    } finally {
      setLockLoading(false)
    }
  }, [deviceLockMode, pinHash, savePreference])

  const saveUserProfile = useCallback(async () => {
    const nextUsername = profileUsername.trim()
    if (!nextUsername) {
      toast.error('Benutzername darf nicht leer sein')
      return
    }
    setIsSavingProfile(true)
    try {
      await updateProfile({
        username: nextUsername,
        displayName: profileDisplayName.trim() || undefined,
      })
      toast.success('Benutzerprofil aktualisiert')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Profil konnte nicht gespeichert werden'
      toast.error(message)
    } finally {
      setIsSavingProfile(false)
    }
  }, [profileUsername, profileDisplayName, updateProfile])

  const savePin = useCallback(async () => {
    if (!/^\d{4,8}$/.test(pinCode)) {
      toast.error('PIN muss 4 bis 8 Ziffern enthalten')
      return
    }
    if (pinCode !== pinConfirm) {
      toast.error('PIN und Bestaetigung stimmen nicht ueberein')
      return
    }
    try {
      const hashedPin = await hashPin(pinCode)
      await savePreference('settings_pin_hash', hashedPin)
      setPinHash(hashedPin)
      setPinCode('')
      setPinConfirm('')
      toast.success('PIN gespeichert')
    } catch {
      toast.error('PIN konnte nicht gespeichert werden')
    }
  }, [pinCode, pinConfirm, savePreference])

  const verifyUnlockPin = useCallback(async () => {
    if (!pinHash) {
      setShowUnlockDialog(false)
      return
    }
    const enteredHash = await hashPin(unlockPinInput)
    if (enteredHash !== pinHash) {
      toast.error('Falsche PIN')
      return
    }
    setLockLoading(true)
    try {
      setDeviceLockMode(false)
      await savePreference('device_lock_mode', false)
      setShowUnlockDialog(false)
      setUnlockPinInput('')
      toast.success('Einstellungen entsperrt')
    } catch {
      toast.error('Entsperren fehlgeschlagen')
    } finally {
      setLockLoading(false)
    }
  }, [pinHash, unlockPinInput, savePreference])

  return {
    maintenanceMode,
    maintenanceMessage,
    canBypassMaintenance,
    deviceLockMode,
    lockLoading,
    updateDeviceLockMode,
    isSavingProfile,
    profileUsername,
    setProfileUsername,
    profileDisplayName,
    setProfileDisplayName,
    saveUserProfile,
    pinCode,
    setPinCode,
    pinConfirm,
    setPinConfirm,
    pinHash,
    savePin,
    unlockPinInput,
    setUnlockPinInput,
    showUnlockDialog,
    setShowUnlockDialog,
    verifyUnlockPin,
    aiEnabled,
    setAiEnabled,
    haConfigured,
    haEnabled,
  }
}
