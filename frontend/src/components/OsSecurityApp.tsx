import { useCallback, useEffect, useState } from 'react'
import { ArrowClockwise, Bug, HardDrive, ShieldCheck, ShieldWarning, Warning } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { authFetch } from '@/lib/authHelpers'
import { OsAppNavbar } from '@/components/OsAppNavbar'

interface Overview { health: 'healthy' | 'degraded' | 'compromised'; health_reasons: string[]; enabled_policies: number; active_scans: number; quarantine_items: number; helper: { ok?: boolean; data?: Record<string, boolean> } }
interface Provider { id: string; enabled: boolean; priority: number; mode: string }
interface Policy { id: string; name: string; threat_type: string; minimum_severity: string; actions: string[]; enabled: boolean }

export function OsSecurityApp() {
  const { t } = useTranslation()
  const [overview, setOverview] = useState<Overview | null>(null)
  const [providers, setProviders] = useState<Provider[]>([])
  const [policies, setPolicies] = useState<Policy[]>([])
  const [target, setTarget] = useState('/opt/iora')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const [summary, scannerData, policyData] = await Promise.all([
        authFetch('/api/core/security/center/overview'),
        authFetch('/api/core/security/center/providers'),
        authFetch('/api/core/security/center/policies'),
      ])
      if (!summary.ok || !scannerData.ok || !policyData.ok) throw new Error(t('os.securityCenter.loadFailed'))
      setOverview(await summary.json())
      setProviders((await scannerData.json()).providers || [])
      setPolicies((await policyData.json()).policies || [])
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('os.securityCenter.loadFailed')) }
  }, [t])

  useEffect(() => { void load() }, [load])

  const runScan = async () => {
    setBusy(true); setError('')
    try {
      const response = await authFetch('/api/core/security/center/scans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: target }) })
      if (!response.ok) throw new Error(t('os.securityCenter.scanFailed'))
      await load()
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('os.securityCenter.scanFailed')) }
    finally { setBusy(false) }
  }

  const toggleProvider = async (provider: Provider) => {
    setBusy(true)
    try {
      const response = await authFetch('/api/core/security/center/providers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...provider, provider_id: provider.id, enabled: !provider.enabled }) })
      if (!response.ok) throw new Error(t('os.securityCenter.updateFailed'))
      await load()
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('os.securityCenter.updateFailed')) }
    finally { setBusy(false) }
  }

  return <section className="ora-app-frame mx-auto max-w-7xl overflow-hidden">
    <OsAppNavbar pageId="os-security" title={t('os.apps.security.name')} description={t('os.apps.security.description')} icon={<ShieldCheck size={24} weight="duotone" />} accent="oklch(0.68 0.17 155)" trailing={<button onClick={() => void load()} className="ora-icon-button" aria-label={t('common.refresh')} title={t('common.refresh')}><ArrowClockwise size={18}/></button>} />
    <div className="p-4 pb-10 sm:p-6">
    {error && <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300"><Warning size={18}/>{error}</div>}
    {overview?.health === 'compromised' && <div role="alert" className="mb-4 rounded-2xl border-2 border-red-500 bg-red-500/20 p-5 text-red-100"><div className="flex items-center gap-2 text-lg font-bold"><ShieldWarning size={24}/>{t('os.securityCenter.compromisedTitle')}</div><p className="mt-2 text-sm">{t('os.securityCenter.compromisedDescription')}</p><div className="mt-3 flex flex-wrap gap-2">{overview.health_reasons.map(reason => <span key={reason} className="rounded-lg bg-red-950/50 px-2 py-1 text-xs font-semibold">{t(`os.securityCenter.reasons.${reason}`)}</span>)}</div></div>}
    {overview?.health === 'degraded' && <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">{overview.health_reasons.map(reason => t(`os.securityCenter.reasons.${reason}`)).join(' · ')}</div>}
    <div className="grid gap-3 sm:grid-cols-3">
      {[[ShieldWarning, t('os.securityCenter.protection'), t(`os.securityCenter.health.${overview?.health ?? 'compromised'}`)], [ShieldCheck, t('os.securityCenter.policies'), String(overview?.enabled_policies ?? 0)], [HardDrive, t('os.securityCenter.quarantine'), String(overview?.quarantine_items ?? 0)]].map(([Icon, label, value]) => <div key={String(label)} className="ora-card rounded-2xl p-4"><Icon size={22} className="mb-3 text-accent"/><div className="text-xs text-foreground/50">{label as string}</div><div className="mt-1 text-xl font-semibold">{value as string}</div></div>)}
    </div>
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <div className="ora-card rounded-2xl p-4"><h2 className="mb-3 flex items-center gap-2 font-semibold"><Bug size={20}/>{t('os.securityCenter.scanners')}</h2><div className="space-y-2">{providers.map(provider => <div key={provider.id} className="flex items-center justify-between rounded-xl border border-foreground/10 p-3"><div><div className="font-medium">{provider.id}</div><div className="text-xs text-foreground/45">{t('os.securityCenter.priority', { value: provider.priority })} · {provider.mode}</div></div><button disabled={busy} onClick={() => void toggleProvider(provider)} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${provider.enabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-foreground/10 text-foreground/50'}`}>{provider.enabled ? t('common.enabled') : t('common.disabled')}</button></div>)}</div><div className="mt-4 flex gap-2"><input value={target} onChange={event => setTarget(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-foreground/10 bg-foreground/5 px-3 py-2 text-sm"/><button disabled={busy} onClick={() => void runScan()} className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50">{t('os.securityCenter.scanNow')}</button></div></div>
      <div className="ora-card rounded-2xl p-4"><h2 className="mb-3 flex items-center gap-2 font-semibold"><ShieldWarning size={20}/>{t('os.securityCenter.responsePolicies')}</h2><div className="space-y-2">{policies.map(policy => <div key={policy.id} className="rounded-xl border border-foreground/10 p-3"><div className="flex justify-between gap-2"><span className="font-medium">{policy.name}</span><span className="text-xs uppercase text-foreground/45">{policy.minimum_severity}</span></div><div className="mt-1 text-xs text-foreground/50">{policy.threat_type} · {policy.actions.join(', ')}</div></div>)}</div></div>
    </div>
  </div>
  </section>
}
