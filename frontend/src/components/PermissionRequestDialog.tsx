import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ShieldCheck } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { authFetch } from '@/lib/authHelpers'
import { useAuth } from '@/contexts/AuthContext'
import { useOsPermissions } from '@/hooks/useOsPermissions'

/**
 * PermissionRequestDialog – Android/iOS-style runtime permission prompt.
 *
 * Components (apps, plugins, system surfaces) create requests via
 * `POST /api/os/permissions/request`; the shell polls pending requests and
 * shows them one at a time (oldest first). Allow/Deny persists the answer;
 * allowing writes the grant into `user_os_permissions` so the requesting
 * surface can proceed immediately.
 */

interface PermissionRequest {
  id: string
  user_id: string
  permission: string
  requester: string
  scope: string
  reason: string
  status: string
  created_at: string
  responded_at?: string | null
  responded_by?: string | null
}

export function PermissionRequestDialog() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { refresh } = useOsPermissions()
  const [pending, setPending] = useState<PermissionRequest | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)

  const loadNext = useCallback(async () => {
    if (busyRef.current) return
    try {
      const res = await authFetch('/api/os/permissions/requests?status=pending')
      if (!res.ok) return
      const data = await res.json() as { requests?: PermissionRequest[] }
      const next = (data.requests || [])
        .slice()
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0] ?? null
      setPending(next)
    } catch {
      // backend unreachable — keep current dialog
    }
  }, [])

  // Poll while signed in (admins already hold every permission).
  useEffect(() => {
    if (!user || user.isAdmin) return
    void loadNext()
    const id = window.setInterval(loadNext, 5000)
    return () => window.clearInterval(id)
  }, [user, loadNext])

  const respond = useCallback(async (approved: boolean) => {
    if (!pending || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      const res = await authFetch(`/api/os/permissions/requests/${pending.id}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved }),
      })
      if (res.ok) {
        setPending(null)
        void refresh()
      }
    } catch {
      // keep the dialog on network failure
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [pending, refresh])

  const label = pending ? t(`permissions.catalog.${pending.permission}`, pending.permission) : ''
  const description = pending ? t(`permissions.catalog.${pending.permission}Desc`, '') : ''

  return (
    <AnimatePresence>
      {pending && (
        <motion.div
          className="fixed inset-0 z-[95] flex items-center justify-center bg-black/55 px-4 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 6 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-sm overflow-hidden rounded-3xl border border-white/12 bg-neutral-900/95 shadow-2xl shadow-black/60 backdrop-blur-2xl"
          >
            {/* App icon / shield */}
            <div className="flex flex-col items-center px-6 pb-2 pt-8 text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-[1.4rem] bg-gradient-to-br from-sky-500/30 to-indigo-500/30 text-sky-300 shadow-inner">
                <ShieldCheck size={30} weight="duotone" />
              </span>
              <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/45">
                {t('permissions.requestTitle')}
              </p>
              <h2 className="mt-1 text-lg font-semibold leading-snug text-white">
                {pending.requester === 'system' || pending.requester === ''
                  ? t('permissions.system')
                  : pending.requester}
                {t('permissions.wantsAccess')}
                <span className="text-accent"> {label}</span>
              </h2>
              {description && (
                <p className="mt-1 text-xs text-foreground/50">{description}</p>
              )}
              {pending.reason && (
                <p className="mt-3 rounded-xl bg-white/5 px-3 py-2 text-xs italic text-foreground/60">
                  “{pending.reason}”
                </p>
              )}
              <p className="mt-3 text-[11px] text-foreground/35">
                {t('permissions.grantHint')}
              </p>
            </div>

            {/* Actions */}
            <div className="flex gap-2 px-5 pb-5 pt-4">
              <button
                type="button"
                disabled={busy}
                onClick={() => void respond(false)}
                className="flex-1 rounded-2xl bg-white/8 px-4 py-3 text-sm font-semibold text-foreground/80 transition-colors hover:bg-white/12 disabled:opacity-50"
              >
                {t('permissions.deny')}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void respond(true)}
                className="flex-1 rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-accent/25 transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {t('permissions.allow')}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
