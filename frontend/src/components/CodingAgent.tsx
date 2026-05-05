import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Robot, Terminal, Play, X, PaperPlaneRight,
  Check, Warning, Hourglass, Sparkle,
  Shield, ShieldCheck, ShieldWarning, LockKey, UserCirclePlus,
  ListChecks, Wrench, Stop,
} from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { QuestionCard } from '@/components/QuestionCard'
import { TodoPanel, TodoItem } from '@/components/TodoPanel'
import { KanbanBoard, KanbanTask, KanbanColumn } from '@/components/KanbanBoard'
import { ProviderManagement } from '@/components/ProviderManagement'
import { getAssistUrl, getBackendUrl } from '@/lib/config'

const assistBase = () => getAssistUrl() || getBackendUrl() || ''

// ─── Types ─────────────────────────────────────────────────────────────────

interface AgentMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  timestamp: string
  toolCalls?: ToolCall[]
  questions?: QuestionDef[]
  todos?: TodoItem[]
}

interface ToolCall {
  id: string
  functionName: string
  arguments: Record<string, unknown>
  result?: string
  error?: string
  status: 'pending' | 'running' | 'completed' | 'failed'
}

interface QuestionDef {
  question: string
  header: string
  options: { label: string; description: string; preview?: string }[]
  multiSelect?: boolean
}

interface LogEntry {
  id: string
  timestamp: string
  level: 'info' | 'warn' | 'error' | 'success'
  message: string
  source?: string
}

interface AgentTask {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  description: string
  workspace_id?: string
  created_at: string
  progress?: number
}

// ─── Agent Settings ────────────────────────────────────────────────────────

interface AgentSettings {
  allowSubagents: boolean
  autoApproveWorkspace: boolean
  securityLevel: 'permissive' | 'standard' | 'strict' | 'readonly'
  sessionTimeoutMinutes: number
  maxToolCalls: number
}

const DEFAULT_SETTINGS: AgentSettings = {
  allowSubagents: true,
  autoApproveWorkspace: true,
  securityLevel: 'standard',
  sessionTimeoutMinutes: 60,
  maxToolCalls: 500,
}

const SECURITY_LABELS: Record<string, { label: string; icon: typeof Shield; color: string }> = {
  permissive: { label: 'Permissive', icon: ShieldWarning, color: 'text-yellow-400' },
  standard: { label: 'Standard', icon: Shield, color: 'text-blue-400' },
  strict: { label: 'Strict', icon: ShieldCheck, color: 'text-orange-400' },
  readonly: { label: 'Read Only', icon: LockKey, color: 'text-red-400' },
}

// ─── Component ─────────────────────────────────────────────────────────────

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

  // Agent settings
  const [settings, setSettings] = useState<AgentSettings>(() => {
    try {
      const s = localStorage.getItem('pidev-agent-settings')
      return s ? { ...DEFAULT_SETTINGS, ...JSON.parse(s) } : DEFAULT_SETTINGS
    } catch { return DEFAULT_SETTINGS }
  })

  const [agentTasks, setAgentTasks] = useState<AgentTask[]>([])
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'chat' | 'kanban' | 'providers'>('chat')

  // Kanban state
  const [kanbanTasks, setKanbanTasks] = useState<KanbanTask[]>([])

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const logEndRef = useRef<HTMLDivElement>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // ─── Scroll helpers ──────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (showLog) logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logEntries, showLog])

  // ─── Persist settings ────────────────────────────────────────────────
  useEffect(() => {
    localStorage.setItem('pidev-agent-settings', JSON.stringify(settings))
  }, [settings])

  // ─── SSE Event Stream ────────────────────────────────────────────────
  const connectEventStream = useCallback(() => {
    eventSourceRef.current?.close()
    const es = new EventSource(`${assistBase()}/api/assist/pidev/sessions/events`)
    eventSourceRef.current = es

    es.addEventListener('StatusChanged', (e: any) => {
      try {
        const data = JSON.parse(e.data)
        setSessionStatus(data.status)
        addLog('info', `Status: ${JSON.stringify(data.status)}`)
      } catch {}
    })

    es.addEventListener('SecurityAlert', (e: any) => {
      try {
        const data = JSON.parse(e.data)
        addLog('warn', `[SEC] ${data.event?.description || 'Alert'}`)
      } catch {}
    })

    es.addEventListener('ToolExecuted', (e: any) => {
      try {
        const data = JSON.parse(e.data)
        addLog('info', `[${data.tool}] ${data.args_summary}`)
      } catch {}
    })

    es.addEventListener('Output', (e: any) => {
      try {
        const data = JSON.parse(e.data)
        addLog('info', data.line || '')
      } catch {}
    })
  }, [])

  // ─── Log helper ──────────────────────────────────────────────────────
  const addLog = useCallback((level: LogEntry['level'], message: string, source?: string) => {
    setLogEntries(prev => [...prev.slice(-500), {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      level,
      message,
      source,
    }])
  }, [])

  // ─── Send message ────────────────────────────────────────────────────
  const sendMessage = async (text?: string) => {
    const msgText = text || input
    if (!msgText.trim() || isLoading) return

    const userMsg: AgentMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: msgText,
      timestamp: new Date().toISOString(),
    }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setIsLoading(true)
    setError(null)
    addLog('info', `User: ${msgText}`)

    try {
      const r = await fetch(`${assistBase()}/api/assist/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msgText,
          context: {
            mode: 'coding',
            workspace_id: workspaceId,
            settings,
          },
        }),
      })

      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()

      const assistantMsg: AgentMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.message || '',
        timestamp: new Date().toISOString(),
        toolCalls: data.tool_calls?.map((tc: any) => ({
          id: tc.id,
          functionName: tc.function_name,
          arguments: tc.arguments || {},
          result: tc.result,
          error: tc.error,
          status: tc.error ? 'failed' as const : 'completed' as const,
        })),
      }

      // Parse embedded questions/todos from message content
      const parsedQuestions = parseQuestionsFromContent(data.message || '')
      if (parsedQuestions.length > 0) {
        assistantMsg.questions = parsedQuestions
      }

      const parsedTodos = parseTodosFromContent(data.message || '')
      if (parsedTodos.length > 0) {
        assistantMsg.todos = parsedTodos
        setTodos(prev => {
          const merged = [...prev]
          for (const nt of parsedTodos) {
            const existing = merged.findIndex(t => t.id === nt.id)
            if (existing >= 0) {
              merged[existing] = { ...merged[existing], ...nt }
            } else {
              merged.push(nt)
            }
          }
          return merged
        })
        // Track active todo
        const inProgress = parsedTodos.find(t => t.status === 'in_progress')
        if (inProgress) setActiveTodoId(inProgress.id)
      }

      setMessages(prev => [...prev, assistantMsg])
      addLog('success', 'Assistant responded')
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : 'Failed'
      setError(errMsg)
      addLog('error', errMsg)
    }
    setIsLoading(false)
  }

  // ─── Handle question response ────────────────────────────────────────
  const handleQuestionResponse = async (answers: Record<number, string | string[]>) => {
    const answerText = Object.entries(answers)
      .map(([qi, a]) => `Q${parseInt(qi) + 1}: ${Array.isArray(a) ? a.join(', ') : a}`)
      .join('\n')
    addLog('info', `Answered questions:\n${answerText}`)
    await sendMessage(`My answers:\n${answerText}`)
  }

  // ─── Start agent session ─────────────────────────────────────────────
  const startSession = async () => {
    try {
      addLog('info', 'Starting agent session...')
      setSessionStatus('starting')

      const r = await fetch(`${assistBase()}/api/assist/pidev/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId || 'default',
          workspace_path: '/workspace',
          api_key: localStorage.getItem('pidev-api-key') || '',
          security_level: settings.securityLevel,
          network_enabled: true,
          session_timeout_secs: settings.sessionTimeoutMinutes * 60,
          auto_approve_workspace: settings.autoApproveWorkspace,
          max_tool_calls: settings.maxToolCalls,
        }),
      })

      if (r.ok) {
        const session = await r.json()
        setSessionId(session.id)
        setSessionStatus('running')
        addLog('success', `Session ${session.id} started`)
        connectEventStream()
      } else {
        throw new Error(`Failed to start session: ${r.status}`)
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : 'Failed'
      setError(errMsg)
      setSessionStatus('error')
      addLog('error', errMsg)
    }
  }

  const stopSession = async () => {
    if (!sessionId) return
    try {
      await fetch(`${assistBase()}/api/assist/pidev/sessions/${sessionId}`, { method: 'DELETE' })
      addLog('warn', 'Session stopped')
    } catch {}
    setSessionId(null)
    setSessionStatus('idle')
    eventSourceRef.current?.close()
  }

  // ─── Toggle settings ─────────────────────────────────────────────────
  const toggleSetting = (key: keyof AgentSettings) => {
    if (typeof settings[key] === 'boolean') {
      setSettings(prev => ({ ...prev, [key]: !prev[key] }))
    }
  }

  const cycleSecurityLevel = () => {
    const levels: AgentSettings['securityLevel'][] = ['permissive', 'standard', 'strict', 'readonly']
    const idx = levels.indexOf(settings.securityLevel)
    setSettings(prev => ({ ...prev, securityLevel: levels[(idx + 1) % levels.length] }))
  }

  // ─── Quick actions ───────────────────────────────────────────────────
  const quickActions = [
    { label: 'Analysieren', prompt: 'Analysiere die Codebasis und gib mir einen Überblick über die Architektur.' },
    { label: 'Bug fixen', prompt: 'Finde und behebe Bugs im Code.' },
    { label: 'Refactoren', prompt: 'Führe ein Refactoring durch um die Codequalität zu verbessern.' },
    { label: 'Tests', prompt: 'Schreibe Tests für die wichtigsten Funktionen.' },
    { label: 'Doku', prompt: 'Erstelle oder verbessere die Dokumentation.' },
    { label: 'Performance', prompt: 'Analysiere und optimiere die Performance.' },
  ]

  const secInfo = SECURITY_LABELS[settings.securityLevel]
  const SecIcon = secInfo.icon

  // ─── Render ──────────────────────────────────────────────────────────
  return (
    <>
      {/* FAB */}
      <motion.button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-24 z-50 w-14 h-14 rounded-full shadow-2xl flex items-center justify-center"
        style={{ background: 'linear-gradient(135deg, #10b981, #059669)', backdropFilter: 'blur(10px)' }}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        title="Pi.dev Coding Agent"
      >
        <Robot size={24} weight="fill" className="text-white" />
      </motion.button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-[900px] h-[800px] p-0 gap-0 flex flex-col bg-card/95 backdrop-blur-2xl border-foreground/10" hideCloseButton>
          {/* ── Header ──────────────────────────────────────────────────── */}
          <div className="px-4 py-3 border-b border-foreground/10 bg-gradient-to-r from-emerald-500/10 to-teal-500/5 shrink-0">
            <div className="flex items-center gap-2">
              {/* Logo + Title */}
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 flex items-center justify-center shrink-0">
                <Robot size={20} weight="fill" className="text-emerald-400" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-foreground">Pi.dev Agent</h2>
                <p className="text-[10px] text-foreground/40 truncate">
                  {sessionStatus === 'running' ?
                    <><span className="w-2 h-2 rounded-full bg-green-400 inline-block mr-1.5" /> Session aktiv</> :
                   sessionStatus === 'starting' ?
                    <><span className="w-2 h-2 rounded-full bg-amber-400 inline-block mr-1.5 animate-pulse" /> Starte...</> :
                    <><span className="w-2 h-2 rounded-full bg-foreground/20 inline-block mr-1.5" /> Inaktiv</>}
                </p>
              </div>

              <div className="flex-1" />

              {/* Tab switcher: Chat | Kanban */}
              <div className="flex rounded-full bg-foreground/5 p-0.5">
                <button
                  onClick={() => setActiveTab('chat')}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                    activeTab === 'chat' ? 'bg-emerald-500/20 text-emerald-400' : 'text-foreground/30 hover:text-foreground/60'
                  }`}
                >
                  Chat
                </button>
                <button
                  onClick={() => setActiveTab('kanban')}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                    activeTab === 'kanban' ? 'bg-emerald-500/20 text-emerald-400' : 'text-foreground/30 hover:text-foreground/60'
                  }`}
                >
                  Kanban
                </button>
                <button
                  onClick={() => setActiveTab('providers')}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                    activeTab === 'providers' ? 'bg-emerald-500/20 text-emerald-400' : 'text-foreground/30 hover:text-foreground/60'
                  }`}
                >
                  Provider
                </button>
              </div>

              {/* Session controls */}
              {sessionStatus === 'running' ? (
                <Button variant="outline" size="sm" onClick={stopSession} className="h-8 text-[11px] gap-1 border-red-500/20 text-red-400 hover:bg-red-500/10">
                  <Stop size={12} /> Stop
                </Button>
              ) : (
                <Button size="sm" onClick={startSession} className="h-8 text-[11px] gap-1 bg-gradient-to-r from-emerald-500 to-teal-500">
                  <Play size={12} /> Start
                </Button>
              )}

              {/* Security level badge */}
              <button onClick={cycleSecurityLevel} title={`Security: ${secInfo.label}`}
                className="flex items-center gap-1 px-2 py-1 rounded-full bg-foreground/5 border border-foreground/10 text-[10px] hover:bg-foreground/10 transition-all"
              >
                <SecIcon size={12} className={secInfo.color} />
                <span className="text-foreground/50">{secInfo.label}</span>
              </button>

              {/* Toggles */}
              <button onClick={() => toggleSetting('allowSubagents')}
                className={`p-1.5 rounded-lg border transition-all ${settings.allowSubagents ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-foreground/10 text-foreground/30'}`}
                title="Subagents erlauben"
              >
                <UserCirclePlus size={14} weight={settings.allowSubagents ? 'fill' : 'regular'} />
              </button>

              <button onClick={() => setShowSidebar(!showSidebar)}
                className={`p-1.5 rounded-lg border transition-all ${showSidebar ? 'border-accent/30 bg-accent/10 text-accent' : 'border-foreground/10 text-foreground/30'}`}
                title="Seitenleiste"
              >
                <ListChecks size={14} weight={showSidebar ? 'fill' : 'regular'} />
              </button>

              <button onClick={() => setShowLog(!showLog)}
                className={`p-1.5 rounded-lg border transition-all ${showLog ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-foreground/10 text-foreground/30'}`}
                title="Live Log"
              >
                <Terminal size={14} weight={showLog ? 'fill' : 'regular'} />
              </button>

              <button onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-lg border border-foreground/10 text-foreground/30 hover:text-foreground/60 transition-all"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* ── Body ────────────────────────────────────────────────────── */}
          <div className="flex-1 flex min-h-0">
            {/* Sidebar */}
            <AnimatePresence>
              {showSidebar && (
                <motion.div
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: 220, opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  className="border-r border-foreground/8 bg-foreground/[0.02] shrink-0 overflow-y-auto"
                >
                  <div className="p-3 space-y-4">
                    {/* Settings */}
                    <div>
                      <p className="text-[10px] font-medium text-foreground/30 uppercase tracking-wider mb-2">Agent</p>
                      <div className="space-y-1.5">
                        <label className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-foreground/[0.04] cursor-pointer">
                          <input type="checkbox" checked={settings.allowSubagents}
                            onChange={() => toggleSetting('allowSubagents')}
                            className="w-3.5 h-3.5 rounded accent-accent" />
                          <span className="text-[11px] text-foreground/60">Subagents</span>
                        </label>
                        <label className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-foreground/[0.04] cursor-pointer">
                          <input type="checkbox" checked={settings.autoApproveWorkspace}
                            onChange={() => toggleSetting('autoApproveWorkspace')}
                            className="w-3.5 h-3.5 rounded accent-accent" />
                          <span className="text-[11px] text-foreground/60">Auto-Approve</span>
                        </label>
                      </div>
                    </div>

                    {/* Todo Panel */}
                    <div>
                      <p className="text-[10px] font-medium text-foreground/30 uppercase tracking-wider mb-2">Tasks</p>
                      <TodoPanel todos={todos} activeTodoId={activeTodoId} />
                    </div>

                    {/* Stats */}
                    <div>
                      <p className="text-[10px] font-medium text-foreground/30 uppercase tracking-wider mb-2">Session</p>
                      <div className="text-[10px] text-foreground/40 space-y-1">
                        <p>Messages: {messages.length}</p>
                        <p>Log lines: {logEntries.length}</p>
                        <p>Tool calls: {messages.reduce((sum, m) => sum + (m.toolCalls?.length || 0), 0)}</p>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Main content area */}
            <div className="flex-1 flex flex-col min-w-0 min-h-0">
              {activeTab === 'kanban' && (
                <KanbanBoard
                  tasks={kanbanTasks}
                  onTasksChange={setKanbanTasks}
                  onCreateTask={async (task) => {
                    const newTask: KanbanTask = {
                      ...task, id: crypto.randomUUID(), createdAt: new Date().toISOString(),
                      subtasks: [], column: 'backlog', priority: task.priority || 'medium',
                      source: 'user', tags: task.tags || [],
                    }
                    setKanbanTasks(prev => [...prev, newTask])
                    addLog('info', 'Kanban: Task ' + task.title + ' erstellt')
                  }}
                  onStartTask={async (taskId) => {
                    const t = kanbanTasks.find(k => k.id === taskId)
                    if (t) { addLog('info', 'Agent startet Task: ' + t.title); sendMessage('Bearbeite: ' + t.title) }
                  }}
                  onMoveTask={(taskId, from, to) => {
                    setKanbanTasks(prev => prev.map(t =>
                      t.id === taskId ? { ...t, column: to, ...(to === 'done' ? { completedAt: new Date().toISOString() } : {}) } : t
                    ))
                  }}
                />
              )}
              {activeTab === 'providers' && <ProviderManagement />}
              {activeTab === 'chat' && (
                <>
              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                {messages.length === 0 && !isLoading && (
                  <div className="text-center py-12 text-foreground/30">
                    <Robot size={48} weight="duotone" className="mx-auto mb-3 opacity-15" />
                    <p className="text-sm font-medium mb-1">Pi.dev Coding Agent</p>
                    <p className="text-xs mb-4">
                      Ich analysiere Code, schreibe Features, fixe Bugs, und entwickle IORA weiter.
                    </p>
                    <div className="flex flex-wrap justify-center gap-1.5">
                      {quickActions.map(qa => (
                        <button key={qa.label}
                          onClick={() => { setInput(qa.prompt); setTimeout(() => sendMessage(qa.prompt), 50) }}
                          className="px-2.5 py-1 rounded-lg bg-foreground/5 border border-foreground/8 text-[11px] hover:bg-emerald-500/10 hover:border-emerald-500/20 transition-all"
                        >
                          {qa.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <AnimatePresence mode="popLayout">
                  {messages.map(msg => (
                    <motion.div key={msg.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className={`max-w-[88%] ${msg.role === 'user' ? '' : 'w-full'}`}>
                        {/* Message bubble */}
                        {msg.content && (
                          <div className={`px-4 py-2.5 rounded-2xl ${
                            msg.role === 'user'
                              ? 'bg-emerald-500/15 text-foreground border border-emerald-500/20 ml-auto w-fit max-w-[85%]'
                              : 'bg-foreground/[0.04] text-foreground/90 border border-foreground/8'
                          }`}>
                            <div className="text-[13px] leading-relaxed whitespace-pre-wrap break-words">
                              {msg.content}
                            </div>
                            <p className="text-[10px] text-foreground/25 mt-1">
                              {new Date(msg.timestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                        )}

                        {/* Tool calls */}
                        {msg.toolCalls && msg.toolCalls.length > 0 && (
                          <div className="mt-1.5 space-y-1">
                            {msg.toolCalls.map(tc => (
                              <div key={tc.id}
                                className={`px-3 py-1.5 rounded-lg border text-[11px] font-mono ${
                                  tc.status === 'failed'
                                    ? 'border-red-500/15 bg-red-500/[0.04] text-red-400'
                                    : tc.status === 'running'
                                      ? 'border-blue-500/15 bg-blue-500/[0.04] text-blue-400'
                                      : 'border-foreground/8 bg-foreground/[0.02] text-foreground/50'
                                }`}
                              >
                                <div className="flex items-center gap-1.5">
                                  <Wrench size={11} />
                                  <span className="font-medium">{tc.functionName}</span>
                                  {tc.status === 'completed' && <Check size={11} className="text-green-400 ml-auto" />}
                                  {tc.status === 'failed' && <Warning size={11} className="text-red-400 ml-auto" />}
                                </div>
                                {tc.result && (
                                  <div className="mt-1 text-[10px] text-foreground/40 line-clamp-3">{tc.result}</div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Interactive Questions */}
                        {msg.questions && msg.questions.length > 0 && (
                          <QuestionCard
                            questions={msg.questions}
                            onSubmit={handleQuestionResponse}
                          />
                        )}
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>

                {isLoading && (
                  <div className="flex items-center gap-2 text-xs text-foreground/40 px-2">
                    <Sparkle size={14} className="animate-spin text-emerald-400" />
                    Agent arbeitet…
                  </div>
                )}

                {error && (
                  <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                    className="px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2"
                  >
                    <Warning size={13} /> {error}
                    <button onClick={() => setError(null)} className="ml-auto"><X size={12} /></button>
                  </motion.div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* ── Live Log Terminal ──────────────────────────────────── */}
              <AnimatePresence>
                {showLog && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 180, opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="border-t border-foreground/10 bg-black/40 backdrop-blur-xl shrink-0 overflow-hidden"
                  >
                    <div className="flex items-center justify-between px-3 py-1.5 border-b border-foreground/5">
                      <div className="flex items-center gap-2">
                        <Terminal size={12} className="text-emerald-400" />
                        <span className="text-[10px] text-foreground/30 font-mono">Live Log ({logEntries.length})</span>
                      </div>
                      <button onClick={() => setLogEntries([])} className="text-[10px] text-foreground/20 hover:text-foreground/40">
                        Clear
                      </button>
                    </div>
                    <div className="h-[calc(100%-28px)] overflow-y-auto p-2 font-mono text-[11px] leading-relaxed">
                      {logEntries.length === 0 ? (
                        <div className="text-foreground/10 text-center py-4">Waiting for events…</div>
                      ) : (
                        logEntries.map(entry => (
                          <div key={entry.id} className="flex gap-2 hover:bg-foreground/[0.02] px-1 rounded">
                            <span className="text-foreground/15 shrink-0">
                              {new Date(entry.timestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </span>
                            <span className={
                              entry.level === 'error' ? 'text-red-400' :
                              entry.level === 'warn' ? 'text-yellow-400' :
                              entry.level === 'success' ? 'text-green-400' :
                              'text-foreground/50'
                            }>
                              {entry.message}
                            </span>
                          </div>
                        ))
                      )}
                      <div ref={logEndRef} />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ── Input ────────────────────────────────────────────────── */}
              <div className="px-4 py-3 border-t border-foreground/10 bg-background/50 shrink-0">
                <div className="flex items-center gap-2">
                  <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
                    }}
                    placeholder="Beschreibe was der Agent tun soll… (Enter zum Senden)"
                    disabled={isLoading}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-foreground/5 border border-foreground/10 text-foreground placeholder-foreground/25 text-sm focus:outline-none focus:border-emerald-500/40 transition-colors disabled:opacity-50"
                  />
                  <Button onClick={() => sendMessage()} disabled={!input.trim() || isLoading}
                    size="icon" className="h-11 w-11 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600"
                  >
                    <PaperPlaneRight size={18} weight="fill" />
                  </Button>
                </div>
              </div>
            </div>
                </>
              )}
            </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ─── Content Parsers ───────────────────────────────────────────────────────

function parseQuestionsFromContent(content: string): QuestionDef[] {
  const questions: QuestionDef[] = []
  // Look for ask_user_question JSON blocks in the content
  const jsonBlockRegex = /\{[\s\S]*?"questions"[\s\S]*?\}/g
  const matches = content.match(jsonBlockRegex)
  if (!matches) return questions

  for (const match of matches) {
    try {
      const parsed = JSON.parse(match)
      if (parsed.questions && Array.isArray(parsed.questions)) {
        for (const q of parsed.questions) {
          if (q.question && q.options) {
            questions.push({
              question: q.question,
              header: q.header || 'Frage',
              options: q.options.map((o: any) => ({
                label: o.label || '',
                description: o.description || '',
                preview: o.preview,
              })),
              multiSelect: q.multiSelect || false,
            })
          }
        }
      }
    } catch { /* not valid JSON, skip */ }
  }
  return questions
}

function parseTodosFromContent(content: string): TodoItem[] {
  const todos: TodoItem[] = []
  // Look for todo tool call results in the content
  const todoRegex = /\b(todo|task)\s*[:\-]\s*(.+)/gi
  let match
  while ((match = todoRegex.exec(content)) !== null) {
    const subject = match[2]?.trim()
    if (subject && subject.length > 2 && subject.length < 200) {
      todos.push({
        id: Date.now() + todos.length,
        subject,
        status: 'pending',
      })
    }
  }
  return todos
}
