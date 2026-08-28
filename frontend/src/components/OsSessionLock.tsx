import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, Fingerprint, Password, UserCircle, Users } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/contexts/AuthContext'
import { useClock } from '@/hooks/useClock'
import { useLocalStorage, storage } from '@/lib/storage'
import { getBackendUrl } from '@/lib/config'
import { DUR_SLOW, EASE_SOFT } from '@/lib/motion'

const LOCKED_KEY = 'rumahl-os-session-locked'
const LAST_ACTIVITY_KEY = 'rumahl-os-last-activity'

type LockUser = { id: string; username: string; display_name?: string; avatar_url?: string; has_pin: boolean }

export function OsSessionLock() {
  const { t, i18n } = useTranslation()
  const { user, login, loginWithPin } = useAuth()
  const [locked, setLocked] = useState(() => localStorage.getItem(LOCKED_KEY) === 'true')
  const [users, setUsers] = useState<LockUser[]>([])
  const [selected, setSelected] = useState<LockUser | null>(null)
  const [credential, setCredential] = useState('')
  const [mode, setMode] = useState<'password' | 'pin'>('password')
  const [error, setError] = useState('')
  const [unlocking, setUnlocking] = useState(false)
  const activityWriteRef = useRef(0)
  const now = useClock()
  const [autoLockMinutes] = useLocalStorage<number>('rumahl-auto-lock-minutes', 15)
  const autoLockMs = autoLockMinutes * 60 * 1000

  const lock = useCallback(() => {
    storage.set(LOCKED_KEY, true); setCredential(''); setError(''); setLocked(true)
  }, [])

  useEffect(() => {
    const handleLock = () => lock()
    window.addEventListener('rumahl:lock-session', handleLock)
    return () => window.removeEventListener('rumahl:lock-session', handleLock)
  }, [lock])

  useEffect(() => {
    if (!locked) return
    fetch(`${getBackendUrl() || ''}/api/auth/users`)
      .then(response => response.ok ? response.json() : Promise.reject())
      .then((entries: LockUser[]) => {
        setUsers(entries)
        const current = entries.find(entry => entry.id === user?.id) || entries[0] || null
        setSelected(current); setMode(current?.has_pin ? 'pin' : 'password')
      })
      .catch(() => {
        if (user) setSelected({ id: user.id, username: user.username, display_name: user.displayName, has_pin: false })
      })
  }, [locked, user])

  useEffect(() => {
    if (locked) return
    const recordActivity = () => {
      const timestamp = Date.now()
      if (timestamp - activityWriteRef.current < 30_000) return
      activityWriteRef.current = timestamp; localStorage.setItem(LAST_ACTIVITY_KEY, String(timestamp))
    }
    const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart']
    events.forEach(event => window.addEventListener(event, recordActivity, { passive: true }))
    recordActivity()
    const interval = window.setInterval(() => {
      const lastActivity = Number(localStorage.getItem(LAST_ACTIVITY_KEY) || Date.now())
      if (autoLockMinutes > 0 && Date.now() - lastActivity >= autoLockMs) lock()
    }, 15_000)
    return () => { events.forEach(event => window.removeEventListener(event, recordActivity)); window.clearInterval(interval) }
  }, [lock, locked, autoLockMinutes, autoLockMs])

  const chooseUser = (entry: LockUser) => {
    setSelected(entry); setMode(entry.has_pin ? 'pin' : 'password'); setCredential(''); setError('')
  }

  const unlock = async (event: FormEvent) => {
    event.preventDefault(); if (!selected || !credential) return
    setUnlocking(true); setError('')
    try {
      if (mode === 'pin') await loginWithPin(selected.id, credential)
      else await login(selected.username, credential, true)
      localStorage.removeItem(LOCKED_KEY); storage.set(LOCKED_KEY, false)
      localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now())); setCredential(''); setLocked(false)
    } catch { setError(t('os.lock.invalidCredential')) } finally { setUnlocking(false) }
  }

  if (!locked || !user) return null

  return <motion.main className="fixed inset-0 z-[300] flex flex-col overflow-hidden bg-background text-foreground" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_5%,color-mix(in_oklch,var(--accent)_28%,transparent),transparent_58%)]" />
    <header className="relative px-6 pt-8 text-center sm:pt-12">
      <motion.p className="text-6xl font-semibold tabular-nums tracking-tight sm:text-8xl" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</motion.p>
      <p className="mt-2 text-base font-medium text-foreground/55 sm:text-lg">{now.toLocaleDateString(i18n.language, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
    </header>
    <section className="relative my-auto flex flex-col items-center px-5 py-8">
      <AnimatePresence mode="wait">
        {selected && <motion.div key={selected.id} initial={{ opacity: 0, scale: .96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: .96 }} transition={{ duration: DUR_SLOW, ease: EASE_SOFT }} className="flex w-full max-w-sm flex-col items-center">
          <Avatar entry={selected} large />
          <h1 className="mt-4 text-2xl font-semibold">{selected.display_name || selected.username}</h1>
          <p className="mt-1 text-sm text-foreground/40">{selected.username}</p>
          <form onSubmit={unlock} className="mt-6 w-full">
            <label className="mx-auto flex min-h-12 max-w-xs items-center gap-3 rounded-full border border-white/15 bg-black/15 px-5 shadow-xl backdrop-blur-2xl focus-within:border-accent/60">
              {mode === 'pin' ? <Fingerprint size={20} /> : <Password size={20} />}
              <span className="sr-only">{mode === 'pin' ? t('os.lock.pin') : t('os.lock.password')}</span>
              <input autoFocus value={credential} onChange={event => setCredential(event.target.value)} type="password" inputMode={mode === 'pin' ? 'numeric' : undefined} autoComplete="current-password" placeholder={mode === 'pin' ? t('os.lock.pin') : t('os.lock.password')} className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-foreground/30" />
              <button type="submit" disabled={!credential || unlocking} aria-label={t('os.lock.unlock')} className="grid h-8 w-8 place-items-center rounded-full bg-foreground/90 text-background disabled:opacity-35"><ArrowRight weight="bold" /></button>
            </label>
            {error && <p className="mt-3 text-center text-xs text-red-300">{error}</p>}
          </form>
          {selected.has_pin && <button type="button" onClick={() => { setMode(value => value === 'password' ? 'pin' : 'password'); setCredential(''); setError('') }} className="mt-4 text-xs text-foreground/45 hover:text-foreground">{mode === 'password' ? t('os.lock.usePin') : t('os.lock.usePassword')}</button>}
        </motion.div>}
      </AnimatePresence>
      {users.length > 1 && <div className="mt-10 w-full max-w-2xl"><p className="mb-4 flex items-center justify-center gap-2 text-xs font-medium text-foreground/40"><Users />{t('os.lock.chooseUser')}</p><div className="flex justify-center gap-4 overflow-x-auto pb-2">{users.map(entry => <button key={entry.id} onClick={() => chooseUser(entry)} aria-pressed={selected?.id === entry.id} className={`flex min-w-20 flex-col items-center rounded-2xl p-2 transition ${selected?.id === entry.id ? 'bg-foreground/10' : 'hover:bg-foreground/5'}`}><Avatar entry={entry} /><span className="mt-2 max-w-24 truncate text-xs">{entry.display_name || entry.username}</span></button>)}</div></div>}
    </section>
  </motion.main>
}

function Avatar({ entry, large = false }: { entry: LockUser; large?: boolean }) {
  const size = large ? 'h-24 w-24' : 'h-14 w-14'
  if (entry.avatar_url) return <img src={entry.avatar_url} alt="" className={`${size} rounded-full border border-white/20 object-cover shadow-2xl`} />
  return <span className={`${size} grid place-items-center rounded-full border border-white/15 bg-foreground/8 shadow-2xl ring-2 ring-accent/15`}><UserCircle size={large ? 66 : 40} weight="duotone" className="text-foreground/75" /></span>
}
