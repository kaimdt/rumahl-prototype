import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowDown,
  ArrowUp,
  CheckCircle,
  Clock,
  FlowArrow,
  Lightning,
  ListBullets,
  Play,
  Plus,
  Power,
  Trash,
  WarningCircle,
  X,
} from '@phosphor-icons/react'
import { toast } from 'sonner'
import { automationApi, type AutomationExecution, type AutomationFlow, type AutomationNode, type AutomationNodeKind, type SaveAutomationFlow } from '@/lib/automationApi'
import { OsWindowActions } from '@/components/OsWindowActions'

const KIND_ORDER: AutomationNodeKind[] = ['trigger', 'condition', 'action']

function makeNode(kind: AutomationNodeKind, index: number): AutomationNode {
  const adapter = kind === 'trigger' ? 'manual' : kind === 'condition' ? 'compare' : 'home_assistant_service'
  const config = kind === 'condition'
    ? { path: '', operator: 'equals', value: '' }
    : kind === 'action'
      ? { service: '', entity_id: '', data: {} }
      : {}
  return { id: crypto.randomUUID(), kind, adapter, config, position: { x: index * 280, y: 120 } }
}

function edgesFor(nodes: AutomationNode[]) {
  return nodes.slice(0, -1).map((node, index) => ({
    id: `edge-${node.id}-${nodes[index + 1].id}`,
    source: node.id,
    target: nodes[index + 1].id,
  }))
}

function emptyDraft(t: (key: string) => string): SaveAutomationFlow {
  const nodes = [makeNode('trigger', 0), makeNode('action', 1)]
  return { name: t('automationEditor.untitled'), description: '', enabled: true, nodes, edges: edgesFor(nodes), cooldown_seconds: 0 }
}

export function AutomationEditorApp() {
  const { t } = useTranslation()
  const [flows, setFlows] = useState<AutomationFlow[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<SaveAutomationFlow>(() => emptyDraft(t))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [executions, setExecutions] = useState<AutomationExecution[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)

  const selected = useMemo(() => flows.find((flow) => flow.id === selectedId), [flows, selectedId])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await automationApi.list()
      setFlows(result)
      if (!selectedId && result[0]) setSelectedId(result[0].id)
    } catch {
      toast.error(t('automationEditor.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [selectedId, t])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!selected) return
    setDraft({
      name: selected.name,
      description: selected.description,
      enabled: selected.enabled,
      nodes: selected.nodes,
      edges: selected.edges,
      cooldown_seconds: selected.cooldown_seconds,
    })
  }, [selected])

  const setNodes = (nodes: AutomationNode[]) => setDraft((current) => ({ ...current, nodes, edges: edgesFor(nodes) }))
  const canRemoveNode = (node: AutomationNode) => (
    node.kind === 'condition' || draft.nodes.filter((entry) => entry.kind === node.kind).length > 1
  )
  const updateNode = (id: string, patch: Partial<AutomationNode>) => setNodes(draft.nodes.map((node) => node.id === id ? { ...node, ...patch } : node))
  const updateConfig = (node: AutomationNode, key: string, value: unknown) => updateNode(node.id, { config: { ...node.config, [key]: value } })

  const addNode = (kind: AutomationNodeKind) => {
    const next = [...draft.nodes, makeNode(kind, draft.nodes.length)]
    next.sort((left, right) => KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind))
    setNodes(next)
  }

  const moveNode = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= draft.nodes.length || draft.nodes[index].kind !== draft.nodes[target].kind) return
    const next = [...draft.nodes]
    ;[next[index], next[target]] = [next[target], next[index]]
    setNodes(next)
  }

  const save = async () => {
    setSaving(true)
    try {
      const saved = selectedId ? await automationApi.update(selectedId, draft) : await automationApi.create(draft)
      setFlows((current) => [saved, ...current.filter((flow) => flow.id !== saved.id)])
      setSelectedId(saved.id)
      toast.success(t('automationEditor.saved'))
    } catch {
      toast.error(t('automationEditor.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!selectedId || !window.confirm(t('automationEditor.deleteConfirm'))) return
    try {
      await automationApi.remove(selectedId)
      const remaining = flows.filter((flow) => flow.id !== selectedId)
      setFlows(remaining)
      setSelectedId(remaining[0]?.id ?? null)
      if (!remaining[0]) setDraft(emptyDraft(t))
      toast.success(t('automationEditor.deleted'))
    } catch {
      toast.error(t('automationEditor.deleteFailed'))
    }
  }

  const run = async () => {
    if (!selectedId) {
      toast.error(t('automationEditor.saveBeforeRun'))
      return
    }
    try {
      await automationApi.run(selectedId)
      toast.success(t('automationEditor.runStarted'))
      await load()
    } catch {
      toast.error(t('automationEditor.runFailed'))
    }
  }

  const showHistory = async () => {
    if (!selectedId) return
    try {
      setExecutions(await automationApi.executions(selectedId))
      setHistoryOpen(true)
    } catch {
      toast.error(t('automationEditor.historyFailed'))
    }
  }

  const newFlow = () => {
    setSelectedId(null)
    setDraft(emptyDraft(t))
  }

  return (
    <section className="ora-app-frame flex h-full min-h-[620px] flex-col overflow-hidden bg-background/75">
      <header className="flex flex-wrap items-center gap-3 border-b border-foreground/8 px-5 py-4">
        <div className="flex min-w-56 flex-1 items-center gap-3">
          <span className="grid size-11 place-items-center rounded-2xl bg-violet-500/15 text-violet-300"><FlowArrow size={24} weight="duotone" /></span>
          <div><h1 className="text-lg font-semibold">{t('automationEditor.title')}</h1><p className="text-xs text-foreground/45">{t('automationEditor.subtitle')}</p></div>
        </div>
        <button type="button" onClick={newFlow} className="ora-secondary-button"><Plus size={17} />{t('automationEditor.new')}</button>
        <button type="button" onClick={() => void showHistory()} disabled={!selectedId} className="ora-secondary-button disabled:opacity-40"><ListBullets size={17} />{t('automationEditor.history')}</button>
        <button type="button" onClick={() => void run()} className="ora-secondary-button"><Play size={17} />{t('automationEditor.run')}</button>
        <button type="button" onClick={() => void save()} disabled={saving} className="ora-primary-button">{saving ? t('automationEditor.saving') : t('automationEditor.save')}</button>
        <OsWindowActions pageId="automations" />
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="overflow-y-auto border-r border-foreground/8 p-3">
          <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground/35">{t('automationEditor.flows')}</p>
          {loading && <p className="p-3 text-sm text-foreground/45">{t('common.loading')}</p>}
          {!loading && flows.length === 0 && <p className="rounded-2xl border border-dashed border-foreground/10 p-4 text-sm text-foreground/40">{t('automationEditor.empty')}</p>}
          <div className="space-y-1">
            {flows.map((flow) => <button key={flow.id} type="button" onClick={() => setSelectedId(flow.id)} className={`w-full rounded-2xl p-3 text-left transition ${flow.id === selectedId ? 'bg-violet-500/15 text-violet-100' : 'hover:bg-foreground/5'}`}>
              <span className="flex items-center gap-2 text-sm font-medium"><span className={`size-2 rounded-full ${flow.enabled ? 'bg-emerald-400' : 'bg-foreground/25'}`} />{flow.name}</span>
              <span className="mt-1 block text-xs text-foreground/40">{t('automationEditor.runCount', { count: flow.trigger_count })}</span>
            </button>)}
          </div>
        </aside>

        <main className="min-w-0 overflow-y-auto p-4 sm:p-6">
          <div className="mx-auto max-w-5xl space-y-5">
            <div className="glass-card grid gap-4 rounded-3xl p-5 sm:grid-cols-[1fr_180px]">
              <div className="space-y-3"><input aria-label={t('automationEditor.name')} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className="w-full bg-transparent text-2xl font-semibold outline-none placeholder:text-foreground/25" placeholder={t('automationEditor.name')} /><input aria-label={t('automationEditor.description')} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} className="w-full bg-transparent text-sm text-foreground/55 outline-none placeholder:text-foreground/25" placeholder={t('automationEditor.description')} /></div>
              <div className="flex items-center justify-end gap-4"><label className="flex items-center gap-2 text-sm"><Power size={17} /><span>{t('automationEditor.enabled')}</span><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} className="accent-violet-500" /></label><label className="flex items-center gap-2 text-sm"><Clock size={17} /><input type="number" min={0} value={draft.cooldown_seconds} onChange={(event) => setDraft({ ...draft, cooldown_seconds: Math.max(0, Number(event.target.value)) })} className="w-16 rounded-xl border border-foreground/10 bg-foreground/5 px-2 py-1.5" /><span>{t('automationEditor.seconds')}</span></label></div>
            </div>

            <div className="flex flex-wrap gap-2">
              {KIND_ORDER.map((kind) => <button key={kind} type="button" onClick={() => addNode(kind)} className="ora-secondary-button"><Plus size={15} />{t(`automationEditor.add.${kind}`)}</button>)}
            </div>

            <div className="relative space-y-4">
              {draft.nodes.map((node, index) => <div key={node.id} className={`glass-card relative rounded-3xl border p-5 ${node.kind === 'trigger' ? 'border-cyan-400/20' : node.kind === 'condition' ? 'border-amber-400/20' : 'border-violet-400/20'}`}>
                {index > 0 && <span className="absolute -top-5 left-10 h-5 w-px bg-foreground/20" />}
                <div className="flex items-start gap-3">
                  <span className={`grid size-10 shrink-0 place-items-center rounded-2xl ${node.kind === 'trigger' ? 'bg-cyan-500/15 text-cyan-300' : node.kind === 'condition' ? 'bg-amber-500/15 text-amber-300' : 'bg-violet-500/15 text-violet-300'}`}>{node.kind === 'trigger' ? <Lightning size={20} /> : node.kind === 'condition' ? <FlowArrow size={20} /> : <Play size={20} />}</span>
                  <div className="min-w-0 flex-1"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground/40">{t(`automationEditor.kind.${node.kind}`)}</p><h2 className="mt-1 font-semibold">{t(`automationEditor.adapter.${node.adapter}`)}</h2></div>
                  <button type="button" aria-label={t('automationEditor.moveUp')} disabled={index === 0 || draft.nodes[index - 1]?.kind !== node.kind} onClick={() => moveNode(index, -1)} className="rounded-lg p-2 hover:bg-foreground/7 disabled:opacity-20"><ArrowUp size={16} /></button>
                  <button type="button" aria-label={t('automationEditor.moveDown')} disabled={index === draft.nodes.length - 1 || draft.nodes[index + 1]?.kind !== node.kind} onClick={() => moveNode(index, 1)} className="rounded-lg p-2 hover:bg-foreground/7 disabled:opacity-20"><ArrowDown size={16} /></button>
                  <button type="button" aria-label={t('common.delete')} disabled={!canRemoveNode(node)} onClick={() => setNodes(draft.nodes.filter((entry) => entry.id !== node.id))} className="rounded-lg p-2 text-red-300 hover:bg-red-500/10 disabled:opacity-20"><Trash size={16} /></button>
                </div>
                {node.kind === 'condition' && <div className="mt-4 grid gap-3 sm:grid-cols-3"><input value={String(node.config.path ?? '')} onChange={(event) => updateConfig(node, 'path', event.target.value)} placeholder={t('automationEditor.field.path')} className="ora-modal-input" /><select value={String(node.config.operator ?? 'equals')} onChange={(event) => updateConfig(node, 'operator', event.target.value)} className="ora-modal-input"><option value="equals">{t('automationEditor.operator.equals')}</option><option value="not_equals">{t('automationEditor.operator.notEquals')}</option><option value="truthy">{t('automationEditor.operator.truthy')}</option></select><input value={String(node.config.value ?? '')} onChange={(event) => updateConfig(node, 'value', event.target.value)} placeholder={t('automationEditor.field.value')} className="ora-modal-input" /></div>}
                {node.kind === 'action' && <div className="mt-4 space-y-3"><select value={node.adapter} onChange={(event) => updateNode(node.id, { adapter: event.target.value, config: event.target.value === 'notification' ? { title: '', message: '', level: 'info' } : { service: '', entity_id: '', data: {} } })} className="ora-modal-input"><option value="home_assistant_service">{t('automationEditor.adapter.home_assistant_service')}</option><option value="notification">{t('automationEditor.adapter.notification')}</option></select>{node.adapter === 'notification' ? <div className="grid gap-3 sm:grid-cols-2"><input value={String(node.config.title ?? '')} onChange={(event) => updateConfig(node, 'title', event.target.value)} placeholder={t('automationEditor.field.notificationTitle')} className="ora-modal-input" /><select value={String(node.config.level ?? 'info')} onChange={(event) => updateConfig(node, 'level', event.target.value)} className="ora-modal-input"><option value="info">{t('automationEditor.level.info')}</option><option value="warning">{t('automationEditor.level.warning')}</option><option value="critical">{t('automationEditor.level.critical')}</option></select><textarea value={String(node.config.message ?? '')} onChange={(event) => updateConfig(node, 'message', event.target.value)} placeholder={t('automationEditor.field.message')} className="ora-modal-input sm:col-span-2" /></div> : <div className="grid gap-3 sm:grid-cols-2"><input value={String(node.config.service ?? '')} onChange={(event) => updateConfig(node, 'service', event.target.value)} placeholder={t('automationEditor.field.service')} className="ora-modal-input" /><input value={String(node.config.entity_id ?? '')} onChange={(event) => updateConfig(node, 'entity_id', event.target.value)} placeholder={t('automationEditor.field.entity')} className="ora-modal-input" /></div>}</div>}
              </div>)}
            </div>

            {selectedId && <button type="button" onClick={() => void remove()} className="flex items-center gap-2 text-sm text-red-300 hover:text-red-200"><Trash size={16} />{t('automationEditor.delete')}</button>}
          </div>
        </main>
      </div>

      {historyOpen && <div className="fixed inset-0 z-[100] grid place-items-center bg-black/55 p-4" onMouseDown={() => setHistoryOpen(false)}><div className="glass-card max-h-[70vh] w-full max-w-2xl overflow-hidden rounded-3xl" onMouseDown={(event) => event.stopPropagation()}><header className="flex items-center justify-between border-b border-foreground/8 p-5"><h2 className="text-lg font-semibold">{t('automationEditor.history')}</h2><button type="button" onClick={() => setHistoryOpen(false)} className="rounded-xl p-2 hover:bg-foreground/8"><X size={18} /></button></header><div className="max-h-[55vh] overflow-y-auto p-4">{executions.length === 0 ? <p className="p-6 text-center text-sm text-foreground/40">{t('automationEditor.noHistory')}</p> : executions.map((execution) => <div key={execution.id} className="mb-2 flex items-center gap-3 rounded-2xl bg-foreground/4 p-3">{execution.success ? <CheckCircle size={20} className="text-emerald-400" /> : <WarningCircle size={20} className="text-red-400" />}<div className="min-w-0 flex-1"><p className="text-sm font-medium">{execution.success ? t('automationEditor.success') : t('automationEditor.failed')}</p><p className="truncate text-xs text-foreground/40">{execution.error || execution.triggered_by}</p></div><time className="text-xs text-foreground/35">{new Date(execution.executed_at).toLocaleString()}</time></div>)}</div></div></div>}
    </section>
  )
}
