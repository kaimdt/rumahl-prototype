import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, ArrowRight, Check, Copy, DownloadSimple, Eye, EyeSlash, Globe, House, Key, Monitor, Palette, ShieldCheck, UserCircle, WifiHigh } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/contexts/AuthContext'
import { getBackendUrl } from '@/lib/config'

type Step = 'welcome' | 'locale' | 'owner' | 'password' | 'recovery' | 'network' | 'identity' | 'appearance' | 'accessibility' | 'privacy' | 'summary'
type Draft = {
  language: string; country: string; timezone: string; dateFormat: string; timeFormat: '12' | '24'
  username: string; firstName: string; lastName: string; displayName: string
  systemName: string; hostname: string; theme: 'light' | 'dark' | 'automatic'; accent: string
  interfaceStyle: 'soft' | 'balanced' | 'clear'; wallpaper: string
  contrast: boolean; reduceTransparency: boolean; reduceMotion: boolean; largerText: boolean
  diagnostics: boolean; updates: 'automatic' | 'notify' | 'manual'
}

const STEPS: Step[] = ['welcome', 'locale', 'owner', 'password', 'recovery', 'network', 'identity', 'appearance', 'accessibility', 'privacy', 'summary']
const ACCENTS = ['#7c6cff', '#3b82f6', '#14b8a6', '#22c55e', '#f59e0b', '#ef476f']
const apiBase = () => getBackendUrl() || ''
const initialDraft = (): Draft => ({
  language: navigator.language.startsWith('de') ? 'de' : 'en', country: navigator.language.startsWith('de') ? 'DE' : 'US',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin', dateFormat: navigator.language.startsWith('de') ? 'DD.MM.YYYY' : 'MM/DD/YYYY', timeFormat: navigator.language.startsWith('de') ? '24' : '12',
  username: '', firstName: '', lastName: '', displayName: '', systemName: '', hostname: 'home', theme: 'automatic', accent: ACCENTS[0], interfaceStyle: 'balanced', wallpaper: 'rumahl-gradient',
  contrast: false, reduceTransparency: false, reduceMotion: false, largerText: false, diagnostics: false, updates: 'automatic',
})

export function SetupWizardOverlay({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation()
  const { register } = useAuth()
  const [checking, setChecking] = useState(true)
  const [required, setRequired] = useState(false)
  const [step, setStep] = useState<Step>('welcome')
  const [draft, setDraft] = useState<Draft>(initialDraft)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const [ownerCreated, setOwnerCreated] = useState(false)
  const [recoveryKey, setRecoveryKey] = useState('')
  const [recoverySaved, setRecoverySaved] = useState(false)
  const [networkIp, setNetworkIp] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const patchDraft = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(current => ({ ...current, [key]: value }))

  useEffect(() => {
    try {
      const settings = JSON.parse(localStorage.getItem('rumahl-accessibility') || '{}') as Partial<Pick<Draft, 'contrast' | 'reduceTransparency' | 'reduceMotion' | 'largerText'>>
      document.documentElement.toggleAttribute('data-high-contrast', settings.contrast === true)
      document.documentElement.toggleAttribute('data-reduce-transparency', settings.reduceTransparency === true)
      document.documentElement.toggleAttribute('data-reduce-motion', settings.reduceMotion === true)
      document.documentElement.toggleAttribute('data-larger-text', settings.largerText === true)
    } catch { /* Ignore malformed legacy local preferences. */ }
  }, [])

  const load = useCallback(async () => {
    try {
      const healthResponse = await fetch(`${apiBase()}/health`, { signal: AbortSignal.timeout(5_000) })
      if (!healthResponse.ok) throw new Error()
      const health = await healthResponse.json()
      if (health.setup_required !== true) return
      const response = await fetch(`${apiBase()}/api/setup/status`)
      if (!response.ok) throw new Error()
      const state = await response.json()
      setRequired(state.required === true)
      if (STEPS.includes(state.current_step)) setStep(state.current_step)
      if (state.draft && typeof state.draft === 'object') setDraft(current => ({ ...current, ...state.draft }))
      setOwnerCreated(state.owner_exists === true)
      setNetworkIp(health.primary_ipv4 || '')
    } catch { setRequired(false) } finally { setChecking(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const persist = useCallback(async (nextStep: Step) => {
    await fetch(`${apiBase()}/api/setup/draft`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current_step: nextStep, draft }) })
  }, [draft])
  const go = async (direction: 1 | -1) => {
    const next = STEPS[Math.max(0, Math.min(STEPS.length - 1, STEPS.indexOf(step) + direction))]
    setError(''); setStep(next); if (next !== 'welcome') await persist(next)
  }
  const createOwner = async (event: FormEvent) => {
    event.preventDefault(); if (password.length < 8 || password !== confirmation) return
    setBusy(true); setError('')
    try {
      await register(draft.username, password, draft.displayName || draft.firstName)
      setPassword(''); setConfirmation(''); setOwnerCreated(true)
      const response = await fetch(`${apiBase()}/api/setup/recovery-key`, { method: 'POST' })
      if (!response.ok) throw new Error(t('setup.errors.recovery'))
      setRecoveryKey((await response.json()).recovery_key); setStep('recovery'); await persist('recovery')
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('setup.errors.owner')) } finally { setBusy(false) }
  }
  const finish = async () => {
    setBusy(true); setError('')
    try {
      const response = await fetch(`${apiBase()}/api/setup/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recovery_key: recoveryKey, configuration: draft }) })
      if (!response.ok) throw new Error((await response.json()).error || t('setup.errors.finish'))
      localStorage.setItem('ha-auto-theme', JSON.stringify(draft.theme === 'automatic'))
      localStorage.setItem('ha-selected-theme', JSON.stringify(draft.theme === 'automatic' ? 'auto' : draft.theme === 'dark' ? 'night' : 'light'))
      localStorage.setItem('accent-color-settings', JSON.stringify({ mode: 'static', staticColor: draft.accent, intensity: 60 }))
      localStorage.setItem('rumahl-interface-style', JSON.stringify(draft.interfaceStyle))
      localStorage.setItem('rumahl-accessibility', JSON.stringify({ contrast: draft.contrast, reduceTransparency: draft.reduceTransparency, reduceMotion: draft.reduceMotion, largerText: draft.largerText }))
      document.documentElement.style.setProperty('--accent', draft.accent)
      document.documentElement.toggleAttribute('data-high-contrast', draft.contrast)
      document.documentElement.toggleAttribute('data-reduce-transparency', draft.reduceTransparency)
      document.documentElement.toggleAttribute('data-reduce-motion', draft.reduceMotion)
      document.documentElement.toggleAttribute('data-larger-text', draft.largerText)
      setRequired(false)
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('setup.errors.finish')) } finally { setBusy(false) }
  }
  const downloadRecovery = () => {
    const url = URL.createObjectURL(new Blob([`${recoveryKey}\n`], { type: 'text/plain;charset=utf-8' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'rumahl-recovery-key.txt'; anchor.click(); URL.revokeObjectURL(url)
  }
  const canContinue = useMemo(() => {
    if (step === 'owner') return /^[a-z0-9][a-z0-9._-]{2,31}$/.test(draft.username) && !!draft.firstName && !!draft.displayName
    if (step === 'recovery') return recoverySaved
    if (step === 'identity') return !!draft.systemName && /^(?!-)[a-z0-9-]{1,63}(?<!-)$/.test(draft.hostname)
    return true
  }, [draft, recoverySaved, step])

  if (checking) return <div className="fixed inset-0 z-[400] grid place-items-center bg-background"><div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" /></div>
  if (!required) return <>{children}</>
  const field = (label: string, key: keyof Draft, placeholder?: string) => <label className="block text-left"><span className="mb-2 block text-xs font-semibold text-foreground/55">{label}</span><input value={String(draft[key])} placeholder={placeholder} onChange={event => patchDraft(key, event.target.value as never)} className="min-h-12 w-full rounded-2xl border border-foreground/10 bg-foreground/5 px-4 outline-none transition focus:border-accent/60 focus:ring-4 focus:ring-accent/10" /></label>

  return <main className="fixed inset-0 z-[400] overflow-auto bg-background text-foreground" style={{ backgroundImage: 'radial-gradient(circle at 50% 0%, color-mix(in oklch, var(--accent) 18%, transparent), transparent 48%)' }}>
    <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-5 py-6 sm:px-10">
      <header className="flex items-center justify-between"><span className="text-lg font-semibold tracking-tight">rumahl</span>{step !== 'welcome' && <span className="text-xs text-foreground/40">{STEPS.indexOf(step)} / {STEPS.length - 1}</span>}</header>
      <div className="my-auto py-10"><AnimatePresence mode="wait"><motion.section key={step} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="mx-auto w-full max-w-2xl text-center">
        {step === 'welcome' && <><House size={58} weight="duotone" className="mx-auto mb-8 text-accent" /><h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">{t('setup.welcome.title')}</h1><p className="mx-auto mt-5 max-w-md text-lg text-foreground/55">{t('setup.welcome.subtitle')}</p><p className="mt-3 text-sm text-foreground/35">{t('setup.welcome.duration')}</p></>}
        {step === 'locale' && <><Globe size={46} className="mx-auto mb-5 text-accent" /><StepTitle title={t('setup.locale.title')} subtitle={t('setup.locale.subtitle')} /><div className="grid gap-4 sm:grid-cols-2"><Choice label="Deutsch" active={draft.language === 'de'} onClick={() => { patchDraft('language', 'de'); void i18n.changeLanguage('de') }} /><Choice label="English" active={draft.language === 'en'} onClick={() => { patchDraft('language', 'en'); void i18n.changeLanguage('en') }} />{field(t('setup.locale.country'), 'country')}{field(t('setup.locale.timezone'), 'timezone')}</div></>}
        {step === 'owner' && <><UserCircle size={46} className="mx-auto mb-5 text-accent" /><StepTitle title={t('setup.owner.title')} subtitle={t('setup.owner.subtitle')} /><div className="grid gap-4 sm:grid-cols-2">{field(t('setup.owner.username'), 'username', 'kai')}{field(t('setup.owner.firstName'), 'firstName')}{field(t('setup.owner.lastName'), 'lastName')}{field(t('setup.owner.displayName'), 'displayName')}</div><p className="mt-3 text-left text-xs text-foreground/40">{t('setup.owner.usernameHint')}</p></>}
        {step === 'password' && <form onSubmit={createOwner}><Key size={46} className="mx-auto mb-5 text-accent" /><StepTitle title={t('setup.password.title')} subtitle={t('setup.password.subtitle')} /><div className="space-y-4 text-left"><PasswordField label={t('setup.password.password')} value={password} visible={showPassword} onChange={setPassword} onCaps={setCapsLock} onToggle={() => setShowPassword(v => !v)} /><PasswordField label={t('setup.password.confirm')} value={confirmation} visible={showPassword} onChange={setConfirmation} onCaps={setCapsLock} onToggle={() => setShowPassword(v => !v)} /></div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-foreground/10"><div className="h-full bg-accent transition-all" style={{ width: `${Math.min(100, password.length * 8)}%` }} /></div>{capsLock && <p className="mt-2 text-xs text-amber-400">{t('setup.password.capsLock')}</p>}{confirmation && password !== confirmation && <p className="mt-2 text-xs text-red-400">{t('setup.password.noMatch')}</p>}<button type="submit" disabled={busy || password.length < 8 || password !== confirmation} className="mt-7 min-h-12 rounded-2xl bg-accent px-8 font-semibold text-accent-foreground disabled:opacity-40">{t('setup.owner.create')}</button></form>}
        {step === 'recovery' && <><ShieldCheck size={46} className="mx-auto mb-5 text-accent" /><StepTitle title={t('setup.recovery.title')} subtitle={t('setup.recovery.subtitle')} /><div className="rounded-3xl border border-foreground/10 bg-foreground/5 p-5 font-mono text-sm break-all">{recoveryKey}</div><div className="mt-4 flex justify-center gap-3"><IconButton label={t('setup.recovery.copy')} icon={<Copy />} onClick={() => void navigator.clipboard.writeText(recoveryKey)} /><IconButton label={t('setup.recovery.download')} icon={<DownloadSimple />} onClick={downloadRecovery} /></div><label className="mt-7 flex cursor-pointer items-center justify-center gap-3 text-sm"><input type="checkbox" checked={recoverySaved} onChange={event => setRecoverySaved(event.target.checked)} className="h-5 w-5" />{t('setup.recovery.confirm')}</label></>}
        {step === 'network' && <><WifiHigh size={46} className="mx-auto mb-5 text-accent" /><StepTitle title={t('setup.network.title')} subtitle={t('setup.network.subtitle')} /><div className="rounded-3xl border border-foreground/10 bg-foreground/5 p-6 text-left"><div className="flex items-center justify-between"><div><p className="font-semibold">{t('setup.network.ethernet')}</p><p className="mt-1 text-sm text-foreground/45">{t('setup.network.dhcp')}</p></div><span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs text-emerald-400">{networkIp ? t('setup.network.connected') : t('setup.network.checking')}</span></div>{networkIp && <p className="mt-5 font-mono text-sm">{networkIp}</p>}<p className="mt-5 text-xs text-foreground/40">{t('setup.network.safety')}</p></div></>}
        {step === 'identity' && <><Monitor size={46} className="mx-auto mb-5 text-accent" /><StepTitle title={t('setup.identity.title')} subtitle={t('setup.identity.subtitle')} /><div className="space-y-4">{field(t('setup.identity.systemName'), 'systemName', t('setup.identity.systemPlaceholder'))}{field(t('setup.identity.hostname'), 'hostname', 'home')}</div><p className="mt-4 text-sm text-foreground/45">{draft.hostname || 'home'}.local</p></>}
        {step === 'appearance' && <><Palette size={46} className="mx-auto mb-5 text-accent" /><StepTitle title={t('setup.appearance.title')} subtitle={t('setup.appearance.subtitle')} /><div className="grid gap-3 sm:grid-cols-3">{(['light', 'dark', 'automatic'] as const).map(value => <Choice key={value} label={t(`setup.appearance.${value}`)} active={draft.theme === value} onClick={() => patchDraft('theme', value)} />)}</div><div className="mt-6 flex justify-center gap-3">{ACCENTS.map(color => <button key={color} aria-label={t('setup.appearance.accent')} onClick={() => patchDraft('accent', color)} className="h-10 w-10 rounded-full" style={{ backgroundColor: color, outline: draft.accent === color ? '3px solid currentColor' : 'none', outlineOffset: 3 }} />)}</div><div className="mt-7 grid gap-3 sm:grid-cols-3">{(['soft', 'balanced', 'clear'] as const).map(value => <Choice key={value} label={t(`setup.appearance.${value}`)} active={draft.interfaceStyle === value} onClick={() => patchDraft('interfaceStyle', value)} />)}</div></>}
        {step === 'accessibility' && <><Eye size={46} className="mx-auto mb-5 text-accent" /><StepTitle title={t('setup.accessibility.title')} subtitle={t('setup.accessibility.subtitle')} /><div className="space-y-3">{(['contrast', 'reduceTransparency', 'reduceMotion', 'largerText'] as const).map(key => <Toggle key={key} label={t(`setup.accessibility.${key}`)} value={draft[key]} onChange={value => patchDraft(key, value)} />)}</div></>}
        {step === 'privacy' && <><ShieldCheck size={46} className="mx-auto mb-5 text-accent" /><StepTitle title={t('setup.privacy.title')} subtitle={t('setup.privacy.subtitle')} /><Toggle label={t('setup.privacy.diagnostics')} value={draft.diagnostics} onChange={value => patchDraft('diagnostics', value)} /><p className="mb-3 mt-7 text-left text-xs font-semibold text-foreground/55">{t('setup.privacy.updates')}</p><div className="space-y-3">{(['automatic', 'notify', 'manual'] as const).map(value => <Choice key={value} label={t(`setup.privacy.${value}`)} active={draft.updates === value} onClick={() => patchDraft('updates', value)} />)}</div></>}
        {step === 'summary' && <><Check size={46} weight="bold" className="mx-auto mb-5 text-accent" /><StepTitle title={t('setup.summary.title')} subtitle={t('setup.summary.subtitle')} /><dl className="grid gap-3 rounded-3xl border border-foreground/10 bg-foreground/5 p-6 text-left sm:grid-cols-2"><Summary label={t('setup.summary.owner')} value={draft.displayName} /><Summary label={t('setup.summary.device')} value={draft.systemName} /><Summary label={t('setup.summary.network')} value={networkIp || t('setup.network.dhcp')} /><Summary label={t('setup.summary.appearance')} value={`${t(`setup.appearance.${draft.theme}`)} · ${t(`setup.appearance.${draft.interfaceStyle}`)}`} /><Summary label={t('setup.summary.updates')} value={t(`setup.privacy.${draft.updates}`)} /></dl></>}
        {error && <p className="mt-5 text-sm text-red-400">{error}</p>}
      </motion.section></AnimatePresence></div>
      {step !== 'password' && <footer className="mx-auto flex w-full max-w-2xl items-center justify-between pb-3">{step !== 'welcome' ? <button onClick={() => void go(-1)} className="flex min-h-11 items-center gap-2 rounded-2xl px-4 text-sm text-foreground/55 hover:bg-foreground/5"><ArrowLeft />{t('setup.back')}</button> : <span />}{step === 'summary' ? <button onClick={() => void finish()} disabled={busy || !ownerCreated || !recoverySaved} className="flex min-h-12 items-center gap-2 rounded-2xl bg-accent px-6 font-semibold text-accent-foreground disabled:opacity-40">{busy ? t('setup.finishing') : t('setup.finish')}<Check /></button> : <button onClick={() => void go(1)} disabled={!canContinue} className="flex min-h-12 items-center gap-2 rounded-2xl bg-accent px-6 font-semibold text-accent-foreground disabled:opacity-40">{step === 'welcome' ? t('setup.getStarted') : t('setup.continue')}<ArrowRight /></button>}</footer>}
    </div>
  </main>
}

function StepTitle({ title, subtitle }: { title: string; subtitle: string }) { return <><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1><p className="mx-auto mb-8 mt-3 max-w-lg text-foreground/50">{subtitle}</p></> }
function Choice({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) { return <button type="button" onClick={onClick} className={`min-h-14 rounded-2xl border px-4 text-left text-sm font-medium transition ${active ? 'border-accent bg-accent/12 ring-4 ring-accent/8' : 'border-foreground/10 bg-foreground/5 hover:bg-foreground/8'}`}>{label}</button> }
function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) { return <button type="button" role="switch" aria-checked={value} onClick={() => onChange(!value)} className="flex min-h-14 w-full items-center justify-between rounded-2xl border border-foreground/10 bg-foreground/5 px-4 text-left text-sm"><span>{label}</span><span className={`relative h-7 w-12 rounded-full transition ${value ? 'bg-accent' : 'bg-foreground/15'}`}><span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${value ? 'left-6' : 'left-1'}`} /></span></button> }
function PasswordField({ label, value, visible, onChange, onCaps, onToggle }: { label: string; value: string; visible: boolean; onChange: (value: string) => void; onCaps: (value: boolean) => void; onToggle: () => void }) { return <label className="block"><span className="mb-2 block text-xs font-semibold text-foreground/55">{label}</span><span className="flex min-h-12 items-center rounded-2xl border border-foreground/10 bg-foreground/5 px-4 focus-within:border-accent/60"><input type={visible ? 'text' : 'password'} value={value} onChange={event => onChange(event.target.value)} onKeyUp={event => onCaps(event.getModifierState('CapsLock'))} className="w-full bg-transparent outline-none" autoComplete="new-password" /><button type="button" onClick={onToggle} aria-label={label}>{visible ? <EyeSlash /> : <Eye />}</button></span></label> }
function IconButton({ label, icon, onClick }: { label: string; icon: ReactNode; onClick: () => void }) { return <button type="button" onClick={onClick} className="flex min-h-11 items-center gap-2 rounded-2xl border border-foreground/10 bg-foreground/5 px-4 text-sm">{icon}{label}</button> }
function Summary({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs text-foreground/40">{label}</dt><dd className="mt-1 font-medium">{value}</dd></div> }
