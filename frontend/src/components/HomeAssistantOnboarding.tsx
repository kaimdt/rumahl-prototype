import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowClockwise, CheckCircle, HouseLine, MagnifyingGlass, Plug, ShieldCheck } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { authFetch } from '@/lib/authHelpers'

interface Candidate {
  url: string
  reachable: boolean
  latency_ms: number
  requires_token: boolean
}

export function HomeAssistantOnboarding({ onComplete }: { onComplete?: () => void }) {
  const { t } = useTranslation()
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [discovering, setDiscovering] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [complete, setComplete] = useState<{ version?: string; location_name?: string; components?: number } | null>(null)

  const discover = async () => {
    setDiscovering(true)
    try {
      const response = await authFetch('/api/admin/ha/discover', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ suggested_url: url || null }),
      })
      if (!response.ok) throw new Error(await response.text())
      const result = await response.json() as Candidate[]
      setCandidates(result)
      const reachable = result.find((candidate) => candidate.reachable)
      if (reachable) setUrl(reachable.url)
      else toast.error(t('haOnboarding.noneFound'))
    } catch {
      toast.error(t('haOnboarding.discoveryFailed'))
    } finally {
      setDiscovering(false)
    }
  }

  const connect = async () => {
    setConnecting(true)
    try {
      const response = await authFetch('/api/admin/ha/onboard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, token }),
      })
      if (!response.ok) throw new Error(await response.text())
      const result = await response.json() as { version?: string; location_name?: string; components?: number }
      setComplete(result)
      toast.success(t('haOnboarding.connected'))
      onComplete?.()
    } catch (error) {
      toast.error(responseMessage(error, t('haOnboarding.connectFailed')))
    } finally {
      setConnecting(false)
    }
  }

  if (complete) return <div className="glass-card rounded-3xl border border-emerald-400/20 p-6 text-center"><CheckCircle size={38} weight="duotone" className="mx-auto text-emerald-400" /><h3 className="mt-3 text-lg font-semibold">{t('haOnboarding.ready')}</h3><p className="mt-1 text-sm text-foreground/55">{complete.location_name || t('haOnboarding.home')} · {complete.version || ''}</p><p className="mt-2 text-xs text-foreground/40">{t('haOnboarding.integrationsReady', { count: complete.components || 0 })}</p></div>

  return <div className="glass-card rounded-3xl border border-cyan-400/15 p-6 sm:p-8">
    <div className="flex items-start gap-4"><span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-cyan-500/15 text-cyan-300"><HouseLine size={25} weight="duotone" /></span><div><h2 className="text-xl font-semibold">{t('haOnboarding.title')}</h2><p className="mt-1 max-w-2xl text-sm text-foreground/55">{t('haOnboarding.description')}</p></div></div>
    <div className="mt-6 grid gap-3 sm:grid-cols-[1fr_auto]"><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder={t('haOnboarding.urlPlaceholder')} className="ora-modal-input" /><button type="button" onClick={() => void discover()} disabled={discovering} className="ora-secondary-button justify-center"><MagnifyingGlass size={17} />{discovering ? t('haOnboarding.discovering') : t('haOnboarding.discover')}</button></div>
    {candidates.length > 0 && <div className="mt-3 space-y-2">{candidates.map((candidate) => <button type="button" key={candidate.url} disabled={!candidate.reachable} onClick={() => setUrl(candidate.url)} className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left ${candidate.reachable ? 'border-emerald-400/20 bg-emerald-500/5 hover:bg-emerald-500/10' : 'border-foreground/7 opacity-45'}`}><Plug size={18} className={candidate.reachable ? 'text-emerald-400' : 'text-foreground/35'} /><span className="min-w-0 flex-1 truncate text-sm">{candidate.url}</span><span className="text-xs text-foreground/40">{candidate.reachable ? `${candidate.latency_ms} ms` : t('haOnboarding.unreachable')}</span></button>)}</div>}
    <div className="mt-5"><label className="mb-2 flex items-center gap-2 text-xs font-semibold text-foreground/55"><ShieldCheck size={16} />{t('haOnboarding.token')}</label><input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder={t('haOnboarding.tokenPlaceholder')} className="ora-modal-input w-full" /><p className="mt-2 text-xs text-foreground/40">{t('haOnboarding.tokenHelp')}</p></div>
    <button type="button" onClick={() => void connect()} disabled={!url.trim() || !token.trim() || connecting} className="ora-primary-button mt-5 w-full justify-center disabled:opacity-40">{connecting ? <ArrowClockwise size={17} className="animate-spin" /> : <Plug size={17} />}{connecting ? t('haOnboarding.connecting') : t('haOnboarding.connect')}</button>
  </div>
}

function responseMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback
  try { const parsed = JSON.parse(error.message) as { error?: string }; return parsed.error || error.message || fallback } catch { return error.message || fallback }
}
