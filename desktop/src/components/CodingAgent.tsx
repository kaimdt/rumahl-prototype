import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Robot, Terminal, Play, X, PaperPlaneRight, Check, Warning, Hourglass,
  Sparkle, Shield, ShieldCheck, ShieldWarning, LockKey,
  UserCirclePlus, ListChecks, Wrench, Stop,
} from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { QuestionCard } from '@/components/QuestionCard'
import { TodoPanel, TodoItem } from '@/components/TodoPanel'
import { KanbanBoard, KanbanTask, KanbanColumn } from '@/components/KanbanBoard'
import { ProviderManagement } from '@/components/ProviderManagement'
import { getAssistUrl, getBackendUrl } from '@/lib/config'

const assistBase = () => getAssistUrl() || getBackendUrl() || ''

interface AgentMessage {
  id: string; role: 'user' | 'assistant' | 'system' | 'tool'
  content: string; timestamp: string
  toolCalls?: ToolCall[]; questions?: QuestionDef[]; todos?: TodoItem[]
}
interface ToolCall {
  id: string; functionName: string; arguments: Record<string, unknown>
  result?: string; error?: string; status: 'pending' | 'running' | 'completed' | 'failed'
}
interface QuestionDef {
  question: string; header: string; multiSelect?: boolean
  options: { label: string; description: string; preview?: string }[]
}
interface LogEntry {
  id: string; timestamp: string; level: 'info' | 'warn' | 'error' | 'success'; message: string
}
interface AgentSettings {
  allowSubagents: boolean; autoApproveWorkspace: boolean
  securityLevel: 'permissive' | 'standard' | 'strict' | 'readonly'
  sessionTimeoutMinutes: number; maxToolCalls: number
}

const DEFAULT_SETTINGS: AgentSettings = { allowSubagents: true, autoApproveWorkspace: true, securityLevel: 'standard', sessionTimeoutMinutes: 60, maxToolCalls: 500 }
const SECURITY_LABELS: Record<string, { label: string; icon: typeof Shield; color: string }> = {
  permissive: { label: 'Permissive', icon: ShieldWarning, color: 'text-yellow-400' },
  standard: { label: 'Standard', icon: Shield, color: 'text-blue-400' },
  strict: { label: 'Strict', icon: ShieldCheck, color: 'text-orange-400' },
  readonly: { label: 'Read Only', icon: LockKey, color: 'text-red-400' },
}

export function CodingAgent() {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [logEntries, setLogEntries] = useState<LogEntry[]>([])
  const [todos, setTodos] = useState<TodoItem[]>([])
  const [activeTodoId, setActiveTodoId] = useState<number | null>(null)
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessionStatus, setSessionStatus] = useState<string>('idle')
  const [showLog, setShowLog] = useState(false)
  const [showSidebar, setShowSidebar] = useState(true)
  const [settings, setSettings] = useState<AgentSettings>(() => {
    try { const s = localStorage.getItem('pidev-agent-settings'); return s ? { ...DEFAULT_SETTINGS, ...JSON.parse(s) } : DEFAULT_SETTINGS }
    catch { return DEFAULT_SETTINGS }
  })
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'chat' | 'kanban' | 'providers'>('chat')
  const [kanbanTasks, setKanbanTasks] = useState<KanbanTask[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const logEndRef = useRef<HTMLDivElement>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
  useEffect(() => { if (showLog) logEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [logEntries, showLog])
  useEffect(() => { localStorage.setItem('pidev-agent-settings', JSON.stringify(settings)) }, [settings])

  const connectEventStream = useCallback(() => {
    eventSourceRef.current?.close()
    const es = new EventSource(`${assistBase()}/api/assist/pidev/sessions/events`)
    eventSourceRef.current = es
    es.addEventListener('StatusChanged', (e: any) => { try { setSessionStatus(JSON.parse(e.data).status) } catch {} })
    es.addEventListener('Output', (e: any) => { try { addLog('info', JSON.parse(e.data).line || '') } catch {} })
  }, [])

  const addLog = useCallback((level: LogEntry['level'], message: string) => {
    setLogEntries(prev => [...prev.slice(-500), { id: crypto.randomUUID(), timestamp: new Date().toISOString(), level, message }])
  }, [])

  const sendMessage = async (text?: string) => {
    const msgText = text || input
    if (!msgText.trim() || isLoading) return
    const userMsg: AgentMessage = { id: crypto.randomUUID(), role: 'user', content: msgText, timestamp: new Date().toISOString() }
    setMessages(prev => [...prev, userMsg]); setInput(''); setIsLoading(true); setError(null)
    try {
      const r = await fetch(`${assistBase()}/api/assist/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msgText, context: { mode: 'coding', workspace_id: workspaceId, settings } }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      const assistantMsg: AgentMessage = {
        id: crypto.randomUUID(), role: 'assistant', content: data.message || '', timestamp: new Date().toISOString(),
        toolCalls: data.tool_calls?.map((tc: any) => ({ id: tc.id, functionName: tc.function_name, arguments: tc.arguments || {}, result: tc.result, error: tc.error, status: tc.error ? 'failed' as const : 'completed' as const })),
      }
      setMessages(prev => [...prev, assistantMsg])
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed') }
    setIsLoading(false)
  }

  const handleQuestionResponse = async (answers: Record<number, string | string[]>) => {
    const answerText = Object.entries(answers).map(([qi, a]) => `Q${parseInt(qi) + 1}: ${Array.isArray(a) ? a.join(', ') : a}`).join('\n')
    await sendMessage(`My answers:\n${answerText}`)
  }

  const startSession = async () => {
    try {
      setSessionStatus('starting')
      const r = await fetch(`${assistBase()}/api/assist/pidev/sessions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId || 'default', workspace_path: '/workspace', api_key: localStorage.getItem('pidev-api-key') || '', security_level: settings.securityLevel, network_enabled: true, session_timeout_secs: settings.sessionTimeoutMinutes * 60, auto_approve_workspace: settings.autoApproveWorkspace, max_tool_calls: settings.maxToolCalls }),
      })
      if (r.ok) { const s = await r.json(); setSessionId(s.id); setSessionStatus('running'); connectEventStream() }
    } catch (e) { setSessionStatus('error') }
  }

  const stopSession = async () => {
    if (!sessionId) return
    try { await fetch(`${assistBase()}/api/assist/pidev/sessions/${sessionId}`, { method: 'DELETE' }) } catch {}
    setSessionId(null); setSessionStatus('idle'); eventSourceRef.current?.close()
  }

  const toggleSetting = (key: keyof AgentSettings) => {
    if (typeof settings[key] === 'boolean') setSettings(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const cycleSecurityLevel = () => {
    const levels: AgentSettings['securityLevel'][] = ['permissive', 'standard', 'strict', 'readonly']
    const idx = levels.indexOf(settings.securityLevel)
    setSettings(prev => ({ ...prev, securityLevel: levels[(idx + 1) % levels.length] }))
  }

  const secInfo = SECURITY_LABELS[settings.securityLevel]; const SecIcon = secInfo.icon

  return (<>
    <motion.button onClick={() => setIsOpen(true)}
      className="fixed bottom-6 right-24 z-50 w-14 h-14 rounded-full shadow-2xl flex items-center justify-center"
      style={{ background: 'linear-gradient(135deg, #10b981, #059669)', backdropFilter: 'blur(10px)' }}
      whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95 }} title="Pi.dev Coding Agent"
    ><Robot size={24} weight="fill" className="text-white" /></motion.button>

    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-[900px] h-[800px] p-0 gap-0 flex flex-col bg-card/95 backdrop-blur-2xl border-foreground/10" hideCloseButton>
        <div className="px-4 py-3 border-b border-foreground/10 bg-gradient-to-r from-emerald-500/10 to-teal-500/5 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 flex items-center justify-center shrink-0"><Robot size={20} weight="fill" className="text-emerald-400" /></div>
            <div className="min-w-0"><h2 className="text-sm font-semibold text-foreground">Pi.dev Agent</h2><p className="text-[10px] text-foreground/40">{sessionStatus === 'running' ? <><span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block mr-1" /> Aktiv</> : sessionStatus === 'starting' ? <><span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block mr-1 animate-pulse" /> Starte...</> : <><span className="w-1.5 h-1.5 rounded-full bg-foreground/20 inline-block mr-1" /> Inaktiv</>}</p></div>
            <div className="flex-1" />

            <div className="flex rounded-full bg-foreground/5 p-0.5">
              <button onClick={() => setActiveTab('chat')} className={`px-2.5 py-1 rounded-full text-[10px] font-medium ${activeTab === 'chat' ? 'bg-emerald-500/20 text-emerald-400' : 'text-foreground/30'}`}>Chat</button>
              <button onClick={() => setActiveTab('kanban')} className={`px-2.5 py-1 rounded-full text-[10px] font-medium ${activeTab === 'kanban' ? 'bg-emerald-500/20 text-emerald-400' : 'text-foreground/30'}`}>Kanban</button>
              <button onClick={() => setActiveTab('providers')} className={`px-2.5 py-1 rounded-full text-[10px] font-medium ${activeTab === 'providers' ? 'bg-emerald-500/20 text-emerald-400' : 'text-foreground/30'}`}>Provider</button>
            </div>

            {sessionStatus === 'running' ? <Button variant="outline" size="sm" onClick={stopSession} className="h-8 text-[11px] gap-1 border-red-500/20 text-red-400 hover:bg-red-500/10"><Stop size={12} /> Stop</Button>
            : <Button size="sm" onClick={startSession} className="h-8 text-[11px] gap-1 bg-gradient-to-r from-emerald-500 to-teal-500"><Play size={12} /> Start</Button>}
            <button onClick={cycleSecurityLevel} className="flex items-center gap-1 px-2 py-1 rounded-full bg-foreground/5 border border-foreground/10 text-[10px]"><SecIcon size={12} className={secInfo.color} /><span className="text-foreground/50">{secInfo.label}</span></button>
            <button onClick={() => toggleSetting('allowSubagents')} className={`p-1.5 rounded-lg border ${settings.allowSubagents ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-foreground/10 text-foreground/30'}`}><UserCirclePlus size={14} /></button>
            <button onClick={() => setShowSidebar(!showSidebar)} className={`p-1.5 rounded-lg border ${showSidebar ? 'border-accent/30 bg-accent/10 text-accent' : 'border-foreground/10 text-foreground/30'}`}><ListChecks size={14} /></button>
            <button onClick={() => setShowLog(!showLog)} className={`p-1.5 rounded-lg border ${showLog ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-foreground/10 text-foreground/30'}`}><Terminal size={14} /></button>
            <button onClick={() => setIsOpen(false)} className="p-1.5 rounded-lg border border-foreground/10 text-foreground/30"><X size={14} /></button>
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          <AnimatePresence>{showSidebar && <motion.div initial={{ width: 0 }} animate={{ width: 200 }} exit={{ width: 0 }} className="border-r border-foreground/8 bg-foreground/[0.02] shrink-0 overflow-y-auto p-3 space-y-4">
            <div><p className="text-[10px] text-foreground/30 uppercase mb-2">Agent</p>
              <label className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer"><input type="checkbox" checked={settings.allowSubagents} onChange={() => toggleSetting('allowSubagents')} className="w-3.5 h-3.5 rounded accent-accent" /><span className="text-[11px] text-foreground/60">Subagents</span></label>
              <label className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer"><input type="checkbox" checked={settings.autoApproveWorkspace} onChange={() => toggleSetting('autoApproveWorkspace')} className="w-3.5 h-3.5 rounded accent-accent" /><span className="text-[11px] text-foreground/60">Auto-Approve</span></label>
            </div>
            <div><p className="text-[10px] text-foreground/30 uppercase mb-2">Tasks</p><TodoPanel todos={todos} activeTodoId={activeTodoId} /></div>
            <div className="text-[10px] text-foreground/40"><p>Messages: {messages.length}</p><p>Log lines: {logEntries.length}</p></div>
          </motion.div>}</AnimatePresence>

          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            {activeTab === 'kanban' && <KanbanBoard tasks={kanbanTasks} onTasksChange={setKanbanTasks} compact />}
            {activeTab === 'providers' && <ProviderManagement />}
            {activeTab === 'chat' && <div className="flex-1 flex flex-col min-w-0">
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {messages.length === 0 && <div className="text-center py-12 text-foreground/30"><Robot size={48} weight="duotone" className="mx-auto mb-3 opacity-15" /><p className="text-sm">Pi.dev Coding Agent</p><p className="text-xs mt-1">Analysiert Code, schreibt Features, fixt Bugs.</p></div>}
              <AnimatePresence mode="popLayout">{messages.map(msg => <motion.div key={msg.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[88%] ${msg.role === 'user' ? '' : 'w-full'}`}>
                  {msg.content && <div className={`px-4 py-2.5 rounded-2xl ${msg.role === 'user' ? 'bg-emerald-500/15 border-emerald-500/20 ml-auto w-fit max-w-[85%]' : 'bg-foreground/[0.04] border-foreground/8'} border text-foreground/90`}><div className="text-[13px] leading-relaxed whitespace-pre-wrap">{msg.content}</div><p className="text-[10px] text-foreground/25 mt-1">{new Date(msg.timestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</p></div>}
                  {msg.toolCalls?.map(tc => <div key={tc.id} className={`mt-1 px-3 py-1.5 rounded-lg border text-[11px] font-mono ${tc.status === 'failed' ? 'border-red-500/15 bg-red-500/[0.04] text-red-400' : 'border-foreground/8 bg-foreground/[0.02] text-foreground/50'}`}><div className="flex items-center gap-1.5"><Wrench size={11} /><span className="font-medium">{tc.functionName}</span>{tc.status === 'completed' && <Check size={11} className="text-green-400 ml-auto" />}{tc.status === 'failed' && <Warning size={11} className="text-red-400 ml-auto" />}</div></div>)}
                  {msg.questions && <QuestionCard questions={msg.questions} onSubmit={handleQuestionResponse} />}
                </div>
              </motion.div>)}</AnimatePresence>
              {isLoading && <div className="flex items-center gap-2 text-xs text-foreground/40"><Sparkle size={14} className="animate-spin text-emerald-400" /> Agent arbeitet…</div>}
              {error && <div className="px-3 py-2 rounded-xl bg-red-500/10 border-red-500/20 text-red-400 text-xs flex items-center gap-2"><Warning size={13} /> {error}<button onClick={() => setError(null)} className="ml-auto"><X size={12} /></button></div>}
              <div ref={messagesEndRef} />
            </div>

            <AnimatePresence>{showLog && <motion.div initial={{ height: 0 }} animate={{ height: 150 }} exit={{ height: 0 }} className="border-t border-foreground/10 bg-black/40 backdrop-blur-xl shrink-0 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-foreground/5"><Terminal size={12} className="text-emerald-400" /><span className="text-[10px] text-foreground/30 font-mono">Live Log ({logEntries.length})</span><button onClick={() => setLogEntries([])} className="text-[10px] text-foreground/20 hover:text-foreground/40">Clear</button></div>
              <div className="h-[calc(100%-28px)] overflow-y-auto p-2 font-mono text-[11px]">{logEntries.length === 0 ? <div className="text-foreground/10 text-center py-4">Waiting…</div> : logEntries.map(e => <div key={e.id} className="flex gap-2 px-1 rounded"><span className="text-foreground/15 shrink-0">{new Date(e.timestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span><span className={e.level === 'error' ? 'text-red-400' : e.level === 'warn' ? 'text-yellow-400' : e.level === 'success' ? 'text-green-400' : 'text-foreground/50'}>{e.message}</span></div>)}<div ref={logEndRef} /></div>
            </motion.div>}</AnimatePresence>

            <div className="px-4 py-3 border-t border-foreground/10 bg-background/50 shrink-0">
              <div className="flex items-center gap-2">
                <input type="text" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }} placeholder="Beschreibe was der Agent tun soll…" disabled={isLoading} className="flex-1 px-4 py-2.5 rounded-xl bg-foreground/5 border border-foreground/10 text-foreground placeholder-foreground/25 text-sm focus:outline-none focus:border-emerald-500/40 transition-colors disabled:opacity-50" />
                <Button onClick={() => sendMessage()} disabled={!input.trim() || isLoading} size="icon" className="h-11 w-11 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500"><PaperPlaneRight size={18} weight="fill" /></Button>
              </div>
            </div>
          </div>
          </div>
          }
        </div>
      </DialogContent>
    </Dialog>
  </>)
}
