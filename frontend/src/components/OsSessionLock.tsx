import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Fingerprint, LockKey, Password, UserCircle } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/contexts/AuthContext'
import { useClock } from '@/hooks/useClock'
import { useLocalStorage, storage } from '@/lib/storage'
import { DUR_SLOW, EASE_SOFT } from '@/lib/motion'

const LOCKED_KEY = 'rumahl-os-session-locked'
const LAST_ACTIVITY_KEY = 'rumahl-os-last-activity'

export function OsSessionLock() {
  const { t, i18n } = useTranslation()
  const { user, login, loginWithPin } = useAuth()
  const [locked, setLocked] = useState(() => localStorage.getItem(LOCKED_KEY) === 'true')
  const [credential, setCredential] = useState('')
  const [mode, setMode] = useState<'password' | 'pin'>('password')
  const [error, setError] = useState('')
  const [unlocking, setUnlocking] = useState(false)
  const activityWriteRef = useRef(0)
  const now = useClock()
  // Per-user auto-lock timeout in minutes (0 = disabled).
  const [autoLockMinutes] = useLocalStorage<number>('rumahl-auto-lock-minutes', 15)
  const autoLockMs = autoLockMinutes * 60 * 1000

  const lock = useCallback(() => {
    storage.set(LOCKED_KEY, true)
    setCredential('')
    setError('')
    setLocked(true)
  }, [])

  useEffect(() => {
    const handleLock = () => lock()
    window.addEventListener('rumahl:lock-session', handleLock)
    return () => window.removeEventListener('rumahl:lock-session', handleLock)
  }, [lock])

  useEffect(() => {
    if (locked) return
    const recordActivity = () => {
      const now = Date.now()
      if (now - activityWriteRef.current < 30_000) return
      activityWriteRef.current = now
      localStorage.setItem(LAST_ACTIVITY_KEY, String(now))
    }
    const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart']
    events.forEach((event) => window.addEventListener(event, recordActivity, { passive: true }))
    recordActivity()
    const interval = window.setInterval(() => {
      const lastActivity = Number(localStorage.getItem(LAST_ACTIVITY_KEY) || Date.now())
      if (autoLockMinutes > 0 && Date.now() - lastActivity >= autoLockMs) lock()
    }, 15_000)
    return () => {
      events.forEach((event) => window.removeEventListener(event, recordActivity))
      window.clearInterval(interval)
    }
  }, [lock, locked, autoLockMinutes, autoLockMs])

  const unlock = async (event: FormEvent) => {
    event.preventDefault()
    if (!user || !credential) return
    setUnlocking(true)
    setError('')
    try {
      if (mode === 'pin') {
        await loginWithPin(user.id, credential)
      } else {
        await login(user.username, credential, true)
      }
      localStorage.removeItem(LOCKED_KEY)
      storage.set(LOCKED_KEY, false)
      localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()))
      setCredential('')
      setLocked(false)
    } catch {
      setError(t('os.lock.invalidCredential'))
    } finally {
      setUnlocking(false)
    }
  }

  if (!locked || !user) return null

  return (
    <motion.div
      className="fixed inset-0 z-[300] flex flex-col items-center justify-center overflow-hidden bg-background p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,color-mix(in_oklch,var(--accent)_22%,transparent),transparent_60%)]" />

      {/* Lock-screen clock (macOS/iOS style) */}
      <motion.div
        className="relative mb-12 text-center"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: DUR_SLOW, ease: EASE_SOFT }}
      >
        <p className="text-6xl font-semibold tabular-nums tracking-tight text-foreground sm:text-8xl">
          {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
        <p className="mt-2 text-base font-medium text-foreground/60 sm:text-lg">
          {now.toLocaleDateString(i18n.language, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </motion.div>

      <motion.form
        onSubmit={unlock}
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: 0.2, duration: DUR_SLOW, ease: EASE_SOFT }}
        className="glass-card relative w-full max-w-sm rounded-4xl border border-white/15 p-6 text-center shadow-2xl sm:p-8"
      >
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-white/15 bg-foreground/8 ring-2 ring-accent/20">
          <UserCircle size={42} weight="duotone" className="text-foreground/75" />
        </div>
        <h1 className="text-xl font-semibold text-foreground">{user.displayName || user.username}</h1>
        <p className="mt-1 text-sm text-foreground/45">{t('os.lock.sessionLocked')}</p>

        <label className="rumahl-auth-input mt-6 min-h-12">
          {mode === 'pin' ? <Fingerprint size={20} /> : <Password size={20} />}
          <span className="sr-only">{mode === 'pin' ? t('os.lock.pin') : t('os.lock.password')}</span>
          <input
            autoFocus
            value={credential}
            onChange={(event) => setCredential(event.target.value)}
            type="password"
            inputMode={mode === 'pin' ? 'numeric' : undefined}
            autoComplete={mode === 'pin' ? 'one-time-code' : 'current-password'}
            placeholder={mode === 'pin' ? t('os.lock.pin') : t('os.lock.password')}
            className="min-h-12 w-full bg-transparent text-sm outline-none placeholder:text-foreground/30"
          />
        </label>
        {error && <p className="mt-3 text-xs text-red-300">{error}</p>}
        <button type="submit" disabled={!credential || unlocking} className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-accent px-4 text-sm font-semibold text-accent-foreground transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50">
          <LockKey size={17} weight="bold" />
          {unlocking ? t('os.lock.unlocking') : t('os.lock.unlock')}
        </button>
        <button
          type="button"
          onClick={() => {
            setMode((value) => value === 'password' ? 'pin' : 'password')
            setCredential('')
            setError('')
          }}
          className="mt-4 text-xs text-foreground/45 hover:text-foreground"
        >
          {mode === 'password' ? t('os.lock.usePin') : t('os.lock.usePassword')}
        </button>
      </motion.form>
    </motion.div>
  )
}
