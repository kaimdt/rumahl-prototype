import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, Fingerprint, Password, UserCircle, Users } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/contexts/AuthContext'
import { useClock } from '@/hooks/useClock'
import { useLocalStorage, storage } from '@/lib/storage'
import { getBackendUrl } from '@/lib/config'
import { DUR_SLOW, EASE_SOFT } from '@/lib/motion'
import { RumahlMark } from '@/components/RumahlMark'
import { LOCK_SCREEN_STYLES, type LockScreenStyle } from '@/lib/lockScreenStyles'
import { DEFAULT_SESSION_SCREEN_SETTINGS, normalizeSessionScreenSettings, SESSION_CLOCK_FONT_STACKS, type SessionScreenSettings } from '@/lib/sessionScreenSettings'
import rumahlWordmarkUrl from '../../../default_assets/logo/ramahl_logo_black.svg'
import rumahlIconUrl from '../../../default_assets/logo/ramahl_icon.svg'
import monsteraUrl from '../../../default_assets/images/backgrounds/MidnightMonstera.jpg'

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
  const [leaving, setLeaving] = useState(false)
  const activityWriteRef = useRef(0)
  const now = useClock()
  const [autoLockMinutes] = useLocalStorage<number>('rumahl-auto-lock-minutes', 15)
  const [lockStyle, setLockStyle] = useLocalStorage<LockScreenStyle>('rumahl-lock-screen-style', 'midnight')
  const [customBackground] = useLocalStorage<string>('rumahl-lock-screen-custom-image', '')
  const [storedSessionScreen] = useLocalStorage<SessionScreenSettings>('rumahl-session-screen-settings', DEFAULT_SESSION_SCREEN_SETTINGS)
  const sessionScreen = normalizeSessionScreenSettings(storedSessionScreen)
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
      setLeaving(true)
      await new Promise((resolve) => window.setTimeout(resolve, 420))
      localStorage.removeItem(LOCKED_KEY); storage.set(LOCKED_KEY, false)
      localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now())); setCredential(''); setLocked(false)
    } catch { setError(t('os.lock.invalidCredential')) } finally { setUnlocking(false) }
  }

  if (!locked || !user) return null

  const cycleStyle = () => setLockStyle(LOCK_SCREEN_STYLES[(LOCK_SCREEN_STYLES.indexOf(lockStyle) + 1) % LOCK_SCREEN_STYLES.length])

  return <motion.main data-lock-style={lockStyle} data-clock-position={sessionScreen.clockPosition} data-clock-font={sessionScreen.clockFont} className="rumahl-lock-screen fixed inset-0 z-[300] flex flex-col overflow-hidden bg-background text-foreground" style={{ '--session-clock-scale': sessionScreen.clockScale / 100, '--session-text-scale': sessionScreen.textScale / 100, '--session-clock-font': SESSION_CLOCK_FONT_STACKS[sessionScreen.clockFont] } as React.CSSProperties} initial={{ opacity: 0, scale: 1.02 }} animate={leaving ? { opacity: 0, scale: 1.045, filter: 'blur(12px)' } : { opacity: 1, scale: 1, filter: 'blur(0px)' }} transition={{ duration: leaving ? .42 : .5, ease: EASE_SOFT }}>
    <LockArtwork style={lockStyle} wordmarkUrl={rumahlWordmarkUrl} iconUrl={rumahlIconUrl} monsteraUrl={monsteraUrl} customBackground={customBackground} />
    <header className="contents">
      <p className="rumahl-session-clock rumahl-session-positioned z-10 font-semibold tabular-nums tracking-tight" style={{ left: `${sessionScreen.positions.clock.x}%`, top: `${sessionScreen.positions.clock.y}%` }}>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
      {sessionScreen.showDate && <p className="rumahl-session-date rumahl-session-positioned z-10 font-medium text-foreground/55" style={{ left: `${sessionScreen.positions.date.x}%`, top: `${sessionScreen.positions.date.y}%` }}>{now.toLocaleDateString(i18n.language, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>}
      {sessionScreen.showStatusWidget && <span className="rumahl-session-status-widget rumahl-session-positioned z-10" style={{ left: `${sessionScreen.positions.status.x}%`, top: `${sessionScreen.positions.status.y}%` }}><Fingerprint size={13} />{t('os.lock.sessionLocked')}</span>}
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
    {/* Brand signature — rumahl mark in the splash design language */}
    <footer className="relative flex items-center justify-center gap-3 pb-6">
      <button type="button" onClick={cycleStyle} className="rounded-full border border-foreground/10 bg-background/20 px-3 py-1.5 text-[10px] font-medium text-foreground/40 backdrop-blur-xl transition-colors hover:bg-foreground/8 hover:text-foreground" title={t('os.lock.changeStyle')}>{t(`os.lock.styles.${lockStyle}`)}</button>
      {sessionScreen.showBrand && <RumahlMark className="rumahl-session-positioned h-5 text-foreground/20" style={{ left: `${sessionScreen.positions.brand.x}%`, top: `${sessionScreen.positions.brand.y}%` }} />}
    </footer>
  </motion.main>
}

function LockArtwork({ style, wordmarkUrl, iconUrl, monsteraUrl, customBackground }: { style: LockScreenStyle; wordmarkUrl: string; iconUrl: string; monsteraUrl: string; customBackground: string }) {
  if (style === 'custom' && customBackground) return <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `linear-gradient(rgb(0 0 0 / .2), rgb(0 0 0 / .58)), url(${customBackground})` }} aria-hidden="true" />
  if (style === 'monstera') return <><div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${monsteraUrl})` }} /><div className="absolute inset-0 bg-black/55 backdrop-saturate-75" /><img src={wordmarkUrl} alt="" className="absolute bottom-10 left-10 w-40 opacity-25 invert" /></>
  if (style === 'halo') return <><div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,color-mix(in_oklch,var(--accent)_32%,transparent),transparent_34%),linear-gradient(145deg,#050509,#11121b)]" /><img src={wordmarkUrl} alt="" className="absolute left-1/2 top-1/2 w-[min(72vw,52rem)] -translate-x-1/2 -translate-y-1/2 opacity-[0.07] invert" /></>
  if (style === 'minimal') return <><div className="absolute inset-0 bg-black" /><img src={wordmarkUrl} alt="" className="absolute left-1/2 top-[18%] w-44 -translate-x-1/2 opacity-80 invert" /></>
  if (style === 'orbit-3d') return <div className="rumahl-lock-orbit absolute inset-0 grid place-items-center overflow-hidden bg-[#050508]" aria-hidden="true"><svg viewBox="0 0 800 800" className="h-[min(88vw,760px)] w-[min(88vw,760px)]"><defs><radialGradient id="orbitCore"><stop offset="0" stopColor="white" stopOpacity=".95"/><stop offset=".28" stopColor="var(--accent)" stopOpacity=".9"/><stop offset="1" stopColor="#07070c" stopOpacity="0"/></radialGradient><linearGradient id="orbitRing" x1="0" y1="0" x2="1" y2="1"><stop stopColor="white" stopOpacity=".9"/><stop offset=".42" stopColor="var(--accent)" stopOpacity=".8"/><stop offset="1" stopColor="#312d6d" stopOpacity=".08"/></linearGradient><filter id="orbitGlow"><feGaussianBlur stdDeviation="12" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><ellipse className="rumahl-lock-orbit-ring rumahl-lock-orbit-ring-a" cx="400" cy="400" rx="255" ry="92" fill="none" stroke="url(#orbitRing)" strokeWidth="4" opacity=".7" transform="rotate(-18 400 400)"/><ellipse className="rumahl-lock-orbit-ring rumahl-lock-orbit-ring-b" cx="400" cy="400" rx="220" ry="64" fill="none" stroke="url(#orbitRing)" strokeWidth="2" opacity=".38" transform="rotate(42 400 400)"/><circle cx="400" cy="400" r="145" fill="url(#orbitCore)" filter="url(#orbitGlow)" opacity=".85"/><g transform="translate(310 310)"><g className="rumahl-lock-orbit-logo"><rect width="180" height="180" rx="42" fill="#fff" opacity=".96"/><image href={iconUrl} width="180" height="180"/></g></g><circle className="rumahl-lock-orbit-node" cx="650" cy="320" r="10" fill="white" filter="url(#orbitGlow)"/></svg></div>
  return <><div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_5%,color-mix(in_oklch,var(--accent)_28%,transparent),transparent_58%)]" /><img src={wordmarkUrl} alt="" className="absolute bottom-10 left-1/2 w-36 -translate-x-1/2 opacity-[0.06] invert" /></>
}

function Avatar({ entry, large = false }: { entry: LockUser; large?: boolean }) {
  const size = large ? 'h-24 w-24' : 'h-14 w-14'
  if (entry.avatar_url) return <img src={entry.avatar_url} alt="" className={`${size} rounded-full border border-white/20 object-cover shadow-2xl`} />
  return <span className={`${size} grid place-items-center rounded-full border border-white/15 bg-foreground/8 shadow-2xl ring-2 ring-accent/15`}><UserCircle size={large ? 66 : 40} weight="duotone" className="text-foreground/75" /></span>
}
