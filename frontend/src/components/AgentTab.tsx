// AgentTab – Vollständiger Agent-Arbeitsbereich mit Chat + Agent Tasks
// GitHub-Agent-Tab-Stil: Chat-Modus und Agent-Task-Modus mit Live-Output,
// parallelen Tasks, Workspace-Management und Git-Integration

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChatCircle, BellRinging, Clock, Check, X, ArrowClockwise, Sparkle,
  Brain, MagicWand, Robot, Hand, Microphone, SpeakerHigh, SpeakerSlash,
  PaperPlaneRight, Globe, MagnifyingGlass, ListBullets, Trash, Plus,
  Warning, Sidebar, CaretRight, Code, GitMerge, GitBranch, GitCommit,
  ArrowUp, Copy, FolderOpen, FileCode, Play, Stop, DotsThree,
  GithubLogo, GitFork, Eye, Terminal, Scroll, TreeStructure,
  SquaresFour, Square, Cube, FileArrowDown, PencilSimple,
  CloudArrowUp, GitPullRequest, GearSix, SelectionPlus, ArrowLeft,
} from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { MessageContent } from '@/components/MessageContent'
import { adminFetch } from '@/components/AdminPanel'
import { ActiveTasksPanel } from '@/components/ActiveTasksPanel'
import { toast } from 'sonner'
import { Tip } from '@/components/ui/tip'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChatMsg {
  id: string; role: string; content: string; timestamp: string
  instantTaskId?: string; instantTaskType?: string
  instantTaskStatus?: 'pending' | 'completed' | 'failed' | 'deferred'
  instantTaskResult?: string
}

interface ChatResponse {
  message: string; provider: string; message_id: string
  model?: string; tokens_used?: number
  instant_task_id?: string | null; instant_task_type?: string | null
}

interface ProviderInfo {
  name: string; id: string; available: boolean
  capabilities?: Record<string, boolean>
  models?: { id: string; name: string }[]
  selected_model?: string
}

interface Workspace {
  id: string; name: string; path: string; source: string
  git_remote?: string | null; git_branch?: string | null
  created_at: string; updated_at: string
  file_count: number; total_size_bytes: number; status: string
}

interface WorkspaceFile {
  path: string; name: string; is_dir: boolean
  size_bytes: number; modified_at: string
}

interface FileDiff {
  file_path: string; status: string
  hunks: { old_start: number; old_lines: number; new_start: number; new_lines: number; content: string }[]
}

interface TaskConfig {
  thinking_enabled: boolean
  temperature: number
  context_level: string
  auto_apply: boolean
  confirm_each_file: boolean
  max_context_files: number
  mode: string
  custom_instructions?: string
  /// Pipeline mode: false = direct, true = two-stage (cloud planner → local executor)
  pipeline_enabled?: boolean
  pipeline_cloud_provider?: string
  pipeline_cloud_model?: string
  pipeline_executor_provider?: string
  pipeline_executor_model?: string
}

const DEFAULT_TASK_CONFIG: TaskConfig = {
  thinking_enabled: true,
  temperature: 0.3,
  context_level: 'changed',
  auto_apply: false,
  confirm_each_file: true,
  max_context_files: 30,
  mode: 'balanced',
  custom_instructions: '',
  pipeline_enabled: false,
  pipeline_cloud_provider: 'anthropic',
  pipeline_cloud_model: 'claude-sonnet-4-20250514',
  pipeline_executor_provider: 'deepseek',
  pipeline_executor_model: 'deepseek-coder',
}

interface AgentTask {
  id: string; workspace_id: string; name: string; description: string
  model: string; provider: string
  status: string; progress: number
  output: TaskOutputLine[]; changes: FileDiff[]
  created_at: string; started_at?: string; completed_at?: string
  error?: string
  config?: TaskConfig
}

interface TaskOutputLine {
  timestamp: string; level: string; message: string; stream?: string | null
}

type AgentMode = 'chat' | 'tasks'
type RightPanel = 'tasks' | 'files' | 'none'

const ASSIST_URL = import.meta.env.VITE_IORA_ASSIST_URL || 'http://localhost:8092'
const WS_URL = ASSIST_URL.replace(/^http/, 'ws')

function formatRelativeTime(ts: string): string {
  const d = new Date(ts); const now = new Date(); const diffMs = now.getTime() - d.getTime()
  if (diffMs < 60_000) return 'gerade eben'
  if (diffMs < 3_600_000) return `vor ${Math.round(diffMs / 60_000)} Min`
  if (diffMs < 86_400_000) return `vor ${Math.round(diffMs / 3_600_000)} Std`
  return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s
}

// ─── Main Agent Tab ───────────────────────────────────────────────────────────

export function AgentTab({ token }: { token: string }) {
  const [mode, setMode] = useState<AgentMode>('chat')
  const [rightPanel, setRightPanel] = useState<RightPanel>('none')

  // Chat state
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [chatState, setChatState] = useState<'idle' | 'thinking' | 'error'>('idle')
  const [chatError, setChatError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [ttsEnabled, setTtsEnabled] = useState(true)
  const synthRef = useRef<SpeechSynthesis | null>(null)
  const recognitionRef = useRef<any>(null)
  const [isSpeechSupported, setIsSpeechSupported] = useState(false)

  // Agent Tasks state
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [tasks, setTasks] = useState<AgentTask[]>([])
  const [selectedWorkspace, setSelectedWorkspace] = useState<string | null>(null)
  const [selectedTask, setSelectedTask] = useState<string | null>(null)
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([])
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [gitChanges, setGitChanges] = useState<FileDiff[]>([])
  const [loading, setLoading] = useState(false)
  const eventSourceRef = useRef<EventSource | null>(null)

  // Create workspace dialog
  const [showCreateWs, setShowCreateWs] = useState(false)
  const [newWsName, setNewWsName] = useState('')
  const [newWsSource, setNewWsSource] = useState<'new' | 'clone' | 'import'>('new')
  const [newWsGitUrl, setNewWsGitUrl] = useState('')

  // Steering config state
  const [taskConfig, setTaskConfig] = useState<TaskConfig>(DEFAULT_TASK_CONFIG)
  const [showSteering, setShowSteering] = useState(false)

  // Create task dialog
  const [showCreateTask, setShowCreateTask] = useState(false)
  const [newTaskName, setNewTaskName] = useState('')
  const [newTaskDesc, setNewTaskDesc] = useState('')
  const [newTaskModel, setNewTaskModel] = useState('gpt-4o')
  const [newTaskProvider, setNewTaskProvider] = useState('openai')

  // Providers
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [activeProvider, setActiveProvider] = useState<ProviderInfo | null>(null)

  // ─── SSE for live tasks ──────────────────────────────────────────────────
  useEffect(() => {
    // Subscribe to SSE for live task events
    const es = new EventSource(`${ASSIST_URL}/api/assist/agent/tasks/events`)
    
    es.addEventListener('agent_task_output', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data)
        setTasks(prev => prev.map(t =>
          t.id === data.task_id
            ? { ...t, output: [...t.output, data.line] }
            : t
        ))
      } catch { /* ignore */ }
    })

    es.addEventListener('agent_task_progress', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data)
        setTasks(prev => prev.map(t =>
          t.id === data.task_id ? { ...t, progress: data.progress } : t
        ))
      } catch { /* ignore */ }
    })

    es.addEventListener('agent_task_status', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data)
        setTasks(prev => prev.map(t =>
          t.id === data.task_id ? { ...t, status: data.status } : t
        ))
      } catch { /* ignore */ }
    })

    es.addEventListener('agent_task_completed', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data)
        setTasks(prev => prev.map(t =>
          t.id === data.task_id
            ? { ...t, status: 'completed', progress: 1.0, changes: data.changes || [] }
            : t
        ))
        toast.success('Agent Task abgeschlossen!')
        // Refresh changes
        const task = tasks.find(t => t.id === data.task_id)
        if (task) loadGitChanges(task.workspace_id)
      } catch { /* ignore */ }
    })

    es.addEventListener('agent_task_failed', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data)
        setTasks(prev => prev.map(t =>
          t.id === data.task_id ? { ...t, status: 'failed', error: data.error } : t
        ))
        toast.error(`Task fehlgeschlagen: ${data.error}`)
      } catch { /* ignore */ }
    })

    es.onerror = () => { /* reconnect handled by browser */ }

    eventSourceRef.current = es
    return () => { es.close() }
  }, [])

  // ─── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if ('speechSynthesis' in window) synthRef.current = window.speechSynthesis
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    setIsSpeechSupported(!!SpeechRecognition)
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition()
      recognitionRef.current.continuous = false
      recognitionRef.current.interimResults = false
      recognitionRef.current.lang = 'de-DE'
    }
    loadAll()
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ─── Data Loading ──────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [wsData, tasksData, provData] = await Promise.all([
        adminFetch('/api/assist/workspaces', token).catch(() => null),
        adminFetch('/api/assist/agent/tasks', token).catch(() => null),
        adminFetch('/api/assist/providers', token).catch(() => null),
      ])
      
      if (wsData) setWorkspaces((wsData as any).workspaces || [])
      if (tasksData) setTasks((tasksData as any).tasks || [])
      
      if (provData) {
        const pd = provData as any
        setActiveProvider(pd.current || null)
        const avail = pd.available_providers || []
        const configured = pd.configured_providers || []
        const merged = [...avail]
        for (const cfg of configured) {
          if (!merged.find((m: any) => m.id === cfg.provider_id)) {
            merged.push({
              name: cfg.name || cfg.provider_type,
              id: cfg.provider_id || cfg.provider_type,
              available: cfg.available,
              models: cfg.models,
              selected_model: cfg.selected_model,
            })
          }
        }
        setProviders(merged)
      }
    } catch (e) { console.error('Load error:', e) }
    setLoading(false)
  }, [token])

  const loadGitChanges = useCallback(async (wsId: string) => {
    try {
      const data = await adminFetch(`/api/assist/workspaces/${wsId}/git/status`, token)
      setGitChanges(data?.changes || [])
    } catch { setGitChanges([]) }
  }, [token])

  const loadWorkspaceFiles = useCallback(async (wsId: string) => {
    try {
      const data = await adminFetch(`/api/assist/workspaces/${wsId}/files?path=`, token)
      setWorkspaceFiles(data?.files || [])
    } catch { setWorkspaceFiles([]) }
  }, [token])

  // ─── Chat ──────────────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || chatState === 'thinking') return

    const userMsg: ChatMsg = {
      id: crypto.randomUUID(), role: 'user',
      content: text, timestamp: new Date().toISOString(),
    }
    setMessages(prev => [...prev, userMsg])
    setInput(''); setChatState('thinking'); setChatError(null)

    try {
      const response = await fetch(`${ASSIST_URL}/api/assist/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, context: {}, voice_mode: false }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data: ChatResponse = await response.json()

      const aiMsg: ChatMsg = {
        id: data.message_id ?? crypto.randomUUID(),
        role: 'assistant', content: data.message,
        timestamp: new Date().toISOString(),
        ...(data.instant_task_id ? {
          instantTaskId: data.instant_task_id,
          instantTaskType: data.instant_task_type ?? 'search',
          instantTaskStatus: 'pending' as const,
        } : {}),
      }
      setMessages(prev => [...prev, aiMsg])
      setChatState('idle')
    } catch (e) {
      setChatError(e instanceof Error ? e.message : 'Fehler')
      setChatState('error')
      setTimeout(() => { setChatState('idle'); setChatError(null) }, 3000)
    }
  }, [chatState])

  const handleVoiceInput = useCallback(() => {
    if (!recognitionRef.current) { toast.error('Spracherkennung nicht unterstützt'); return }
    recognitionRef.current.onresult = (event: any) => sendMessage(event.results[0][0].transcript)
    recognitionRef.current.onerror = () => setChatState('idle')
    try { recognitionRef.current.start() } catch {}
  }, [sendMessage])

  // ─── Workspace Operations ──────────────────────────────────────────────────
  const createWorkspace = useCallback(async () => {
    if (!newWsName.trim()) { toast.error('Bitte Namen eingeben'); return }
    try {
      const body: any = { name: newWsName, source: newWsSource }
      if (newWsSource === 'clone' && newWsGitUrl.trim()) body.git_url = newWsGitUrl
      const data = await adminFetch('/api/assist/workspaces', token, {
        method: 'POST', body: JSON.stringify(body),
      })
      toast.success('Workspace erstellt!')
      setWorkspaces(prev => [...prev, data.workspace])
      setShowCreateWs(false); setNewWsName(''); setNewWsGitUrl('')
    } catch (e) {
      toast.error(`Fehler: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [newWsName, newWsSource, newWsGitUrl, token])

  const deleteWorkspace = useCallback(async (id: string) => {
    if (!confirm('Workspace wirklich löschen? Alle Dateien werden entfernt.')) return
    try {
      await adminFetch(`/api/assist/workspaces/${id}`, token, { method: 'DELETE' })
      setWorkspaces(prev => prev.filter(w => w.id !== id))
      if (selectedWorkspace === id) { setSelectedWorkspace(null); setSelectedTask(null) }
      toast.success('Workspace gelöscht')
    } catch (e) { toast.error(`Fehler: ${e}`) }
  }, [token, selectedWorkspace])

  // ─── Task Operations ───────────────────────────────────────────────────────
  const createTask = useCallback(async () => {
    if (!selectedWorkspace) { toast.error('Bitte Workspace wählen'); return }
    if (!newTaskDesc.trim()) { toast.error('Bitte Aufgabenbeschreibung eingeben'); return }
    try {
      const data = await adminFetch('/api/assist/agent/tasks', token, {
        method: 'POST', body: JSON.stringify({
          workspace_id: selectedWorkspace,
          name: newTaskName || 'Agent Task',
          description: newTaskDesc,
          model: newTaskModel,
          provider: newTaskProvider,
          config: {
            thinking_enabled: taskConfig.thinking_enabled,
            temperature: taskConfig.temperature,
            context_level: taskConfig.context_level,
            auto_apply: taskConfig.auto_apply,
            confirm_each_file: taskConfig.confirm_each_file,
            max_context_files: taskConfig.max_context_files,
            mode: taskConfig.mode,
            custom_instructions: taskConfig.custom_instructions?.trim() || null,
            pipeline_enabled: taskConfig.pipeline_enabled,
            pipeline_cloud_provider: taskConfig.pipeline_cloud_provider,
            pipeline_cloud_model: taskConfig.pipeline_cloud_model,
            pipeline_executor_provider: taskConfig.pipeline_executor_provider,
            pipeline_executor_model: taskConfig.pipeline_executor_model,
          },
        }),
      })
      toast.success(`Agent Task gestartet! (Modus: ${taskConfig.mode})`)
      setTasks(prev => [...prev, data.task])
      setShowCreateTask(false); setNewTaskName(''); setNewTaskDesc('')
      setShowSteering(false)
    } catch (e) { toast.error(`Fehler: ${e}`) }
  }, [selectedWorkspace, newTaskName, newTaskDesc, newTaskModel, newTaskProvider, taskConfig, token])

  const cancelTask = useCallback(async (id: string) => {
    try {
      await adminFetch(`/api/assist/agent/tasks/${id}`, token, { method: 'DELETE' })
      setTasks(prev => prev.map(t => t.id === id ? { ...t, status: 'cancelled' } : t))
      toast.success('Task abgebrochen')
    } catch (e) { toast.error(`Fehler: ${e}`) }
  }, [token])

  // Select workspace and load its data
  const selectWorkspace = useCallback(async (id: string) => {
    setSelectedWorkspace(id)
    setSelectedTask(null)
    setFileContent(null)
    setSelectedFilePath(null)
    await Promise.all([
      loadWorkspaceFiles(id),
      loadGitChanges(id),
    ])
  }, [loadWorkspaceFiles, loadGitChanges])

  // ─── Git Operations ───────────────────────────────────────────────────────
  const gitCommit = useCallback(async (message: string) => {
    if (!selectedWorkspace) return
    try {
      const data = await adminFetch(`/api/assist/workspaces/${selectedWorkspace}/git/commit`, token, {
        method: 'POST', body: JSON.stringify({ message }),
      })
      toast.success('Committed!')
      loadGitChanges(selectedWorkspace)
    } catch (e) { toast.error(`Git commit fehlgeschlagen: ${e}`) }
  }, [selectedWorkspace, token, loadGitChanges])

  const gitPush = useCallback(async () => {
    if (!selectedWorkspace) return
    const ws = workspaces.find(w => w.id === selectedWorkspace)
    try {
      const data = await adminFetch(`/api/assist/workspaces/${selectedWorkspace}/git/push`, token, {
        method: 'POST', body: JSON.stringify({
          remote: 'origin', branch: ws?.git_branch || 'main',
        }),
      })
      toast.success('Gepusht!')
    } catch (e) { toast.error(`Git push fehlgeschlagen: ${e}`) }
  }, [selectedWorkspace, workspaces, token])

  const createBranch = useCallback(async (name: string) => {
    if (!selectedWorkspace || !name.trim()) return
    try {
      await adminFetch(`/api/assist/workspaces/${selectedWorkspace}/git/branch`, token, {
        method: 'POST', body: JSON.stringify({ name, base: 'main' }),
      })
      toast.success(`Branch '${name}' erstellt!`)
      loadAll()
    } catch (e) { toast.error(`Branch-Erstellung fehlgeschlagen: ${e}`) }
  }, [selectedWorkspace, token, loadAll])

  const createPR = useCallback(async () => {
    if (!selectedWorkspace) return
    const ws = workspaces.find(w => w.id === selectedWorkspace)
    const branch = ws?.git_branch || 'main'
    const prTitle = prompt('PR Titel:', `ORA Agent: ${branch}`)
    if (!prTitle) return
    const prBody = prompt('PR Beschreibung:', 'Automated changes by ORA Agent.')
    try {
      const data = await adminFetch(`/api/assist/workspaces/${selectedWorkspace}/git/pr`, token, {
        method: 'POST', body: JSON.stringify({
          title: prTitle, body: prBody || '', head: branch, base: 'main',
        }),
      })
      toast.success('Pull Request erstellt!')
    } catch (e) { toast.error(`PR fehlgeschlagen: ${e}`) }
  }, [selectedWorkspace, workspaces, token])

  // ─── Diff helper ───────────────────────────────────────────────────────────
  const renderDiff = (change: FileDiff) => {
    const lineClass = (line: string) => {
      if (line.startsWith('+')) return 'text-green-300 bg-green-500/10'
      if (line.startsWith('-')) return 'text-red-300 bg-red-500/10'
      if (line.startsWith('@@')) return 'text-purple-300 bg-purple-500/10 font-bold'
      return 'text-foreground/70'
    }
    return (
      <div key={change.file_path} className="rounded-xl bg-foreground/[0.03] border border-foreground/10 overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 bg-foreground/5 border-b border-foreground/10 text-xs font-mono">
          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
            change.status === 'added' ? 'bg-green-500/15 text-green-300' :
            change.status === 'deleted' ? 'bg-red-500/15 text-red-300' :
            'bg-blue-500/15 text-blue-300'
          }`}>{change.status}</span>
          <span className="text-foreground/70">{change.file_path}</span>
          <span className="ml-auto text-[9px] text-foreground/40">{change.hunks.length} Hunk(s)</span>
        </div>
        {change.hunks.map((hunk, i) => (
          <div key={i} className="font-mono text-[11px] leading-relaxed">
            <div className="px-3 py-1 bg-purple-500/5 text-purple-300/60 text-[10px]">
              @@ -{hunk.old_start},{hunk.old_lines} +{hunk.new_start},{hunk.new_lines} @@
            </div>
            {hunk.content.split('\n').filter(l => l.trim()).map((line, j) => (
              <div key={j} className={`px-3 py-0.5 ${lineClass(line)}`}>
                <span className="inline-block w-4 text-[9px] text-foreground/30 select-none">
                  {line.startsWith('+') ? '+' : line.startsWith('-') ? '-' : ' '}
                </span>
                {line.slice(1) || line}
              </div>
            ))}
          </div>
        ))}
      </div>
    )
  }

  const selectedWs = workspaces.find(w => w.id === selectedWorkspace)
  const workspaceTasks = tasks.filter(t => t.workspace_id === selectedWorkspace)
  const runningCount = tasks.filter(t => t.status === 'running').length
  const queuedCount = tasks.filter(t => t.status === 'queued').length

  return (
    <div className="flex h-[calc(100vh-200px)] min-h-[650px] gap-3">
      {/* ─── Left Sidebar ────────────────────────────────────────────────── */}
      <div className="w-64 shrink-0 glass-card rounded-3xl border border-white/10 bg-white/10 p-4 shadow-xl shadow-black/5 backdrop-blur-xl flex flex-col gap-3 overflow-hidden">
        {/* Mode Switcher */}
        <div className="flex rounded-xl bg-foreground/5 p-0.5">
          <button
            onClick={() => setMode('chat')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all ${
              mode === 'chat' ? 'bg-accent/20 text-accent' : 'text-foreground/50 hover:text-foreground'
            }`}
          >
            <ChatCircle size={14} weight={mode === 'chat' ? 'fill' : 'regular'} />
            Chat
          </button>
          <button
            onClick={() => setMode('tasks')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all ${
              mode === 'tasks' ? 'bg-accent/20 text-accent' : 'text-foreground/50 hover:text-foreground'
            }`}
          >
            <Robot size={14} weight={mode === 'tasks' ? 'fill' : 'regular'} />
            Tasks
            {(runningCount > 0 || queuedCount > 0) && (
              <span className="text-[9px] bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded-full">
                {runningCount + queuedCount}
              </span>
            )}
          </button>
        </div>

        {mode === 'tasks' ? (
          <>
            {/* Workspace Selector */}
            <div className="space-y-1.5 flex-1 overflow-hidden flex flex-col">
              <div className="flex items-center justify-between">
                <p className="text-[10px] uppercase tracking-wider text-foreground/40 font-semibold">Workspaces</p>
                <button onClick={() => setShowCreateWs(true)}
                  className="p-1 rounded text-foreground/40 hover:text-foreground hover:bg-foreground/5">
                  <Plus size={13} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto space-y-1">
                {workspaces.map(ws => (
                  <button
                    key={ws.id}
                    onClick={() => selectWorkspace(ws.id)}
                    className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-xs transition-all text-left ${
                      selectedWorkspace === ws.id
                        ? 'bg-accent/20 text-accent border border-accent/20'
                        : 'text-foreground/60 hover:text-foreground hover:bg-foreground/5 border border-transparent'
                    }`}
                  >
                    <FolderOpen size={14} weight={selectedWorkspace === ws.id ? 'fill' : 'regular'} />
                    <div className="flex-1 min-w-0">
                      <p className="truncate font-medium">{ws.name}</p>
                      <p className="text-[9px] text-foreground/40">{ws.file_count} Dateien</p>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteWorkspace(ws.id) }}
                      className="p-1 rounded text-foreground/30 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100"
                    >
                      <Trash size={10} />
                    </button>
                  </button>
                ))}
                {workspaces.length === 0 && (
                  <p className="text-[11px] text-foreground/50 text-center py-4">Keine Workspaces</p>
                )}
              </div>
            </div>

            {/* Task Stats */}
            <div className="grid grid-cols-3 gap-1 pt-2 border-t border-foreground/10">
              <div className="text-center p-1.5 rounded-lg bg-foreground/[0.04]">
                <p className="text-sm font-bold text-foreground">{runningCount}</p>
                <p className="text-[8px] text-foreground/40 uppercase">Aktiv</p>
              </div>
              <div className="text-center p-1.5 rounded-lg bg-foreground/[0.04]">
                <p className="text-sm font-bold text-foreground">{queuedCount}</p>
                <p className="text-[8px] text-foreground/40 uppercase">Wartend</p>
              </div>
              <div className="text-center p-1.5 rounded-lg bg-foreground/[0.04]">
                <p className="text-sm font-bold text-foreground">{tasks.filter(t => t.status === 'completed').length}</p>
                <p className="text-[8px] text-foreground/40 uppercase">Fertig</p>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <p className="text-[10px] uppercase tracking-wider text-foreground/40 font-semibold mb-2">Provider</p>
            {providers.map(p => (
              <button
                key={p.id}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs mb-0.5 ${
                  p.id === activeProvider?.id
                    ? 'bg-accent/20 text-accent' : 'text-foreground/60 hover:text-foreground hover:bg-foreground/5'
                } ${!p.available ? 'opacity-40' : ''}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${p.available ? 'bg-green-400' : 'bg-red-400'}`} />
                <span className="truncate">{p.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ─── Main Area ──────────────────────────────────────────────────── */}
      <div className="flex-1 glass-card rounded-3xl border border-white/10 bg-white/10 shadow-xl shadow-black/5 backdrop-blur-xl flex flex-col overflow-hidden">
        {mode === 'chat' ? (
          <>
            {/* Chat Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-foreground/10">
              <div className="flex items-center gap-2">
                <Sparkle size={16} weight="fill" className="text-accent" />
                <h2 className="text-sm font-semibold text-foreground">Agent Chat</h2>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                  chatState === 'thinking' ? 'bg-purple-500/15 text-purple-300 animate-pulse' : 'bg-foreground/10 text-foreground/50'
                }`}>
                  {chatState === 'thinking' ? 'Denkt…' : chatState === 'error' ? 'Fehler' : 'Bereit'}
                </span>
              </div>
              <button
                onClick={() => setTtsEnabled(!ttsEnabled)}
                className={`p-2 rounded-lg text-xs ${ttsEnabled ? 'text-accent bg-accent/10' : 'text-foreground/40'}`}
              >
                {ttsEnabled ? <SpeakerHigh size={15} /> : <SpeakerSlash size={15} />}
              </button>
            </div>
            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center py-16">
                  <Brain size={40} weight="duotone" className="text-accent/50 mb-4" />
                  <p className="text-sm font-semibold text-foreground mb-1">ORA Agent Chat</p>
                  <p className="text-xs text-foreground/50 max-w-xs">Stelle eine Frage oder wechsle zu Tasks für KI-gestützte Code-Bearbeitung.</p>
                </div>
              ) : (
                messages.map(msg => (
                  <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl ${
                      msg.role === 'user'
                        ? 'bg-accent/20 border border-accent/20'
                        : 'bg-foreground/5 border border-foreground/10'
                    }`}>
                      <MessageContent content={msg.content} role={msg.role} />
                      <p className="text-[10px] text-foreground/40 mt-1">{formatRelativeTime(msg.timestamp)}</p>
                    </div>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>
            {/* Chat Input */}
            <div className="px-5 py-4 border-t border-foreground/10 bg-background/50">
              <div className="flex items-center gap-2">
                <button onClick={handleVoiceInput}
                  className="h-11 w-11 rounded-full bg-foreground/5 border border-foreground/10 flex items-center justify-center text-foreground/50 hover:text-foreground shrink-0">
                  <Microphone size={18} />
                </button>
                <input value={input} onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input) } }}
                  placeholder="Nachricht…"
                  className="flex-1 px-4 py-2.5 rounded-2xl bg-foreground/5 border border-foreground/10 text-sm text-foreground placeholder-foreground/40 focus:outline-none focus:border-accent"
                />
                <button onClick={() => sendMessage(input)} disabled={!input.trim() || chatState === 'thinking'}
                  className="h-11 w-11 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 text-white flex items-center justify-center shrink-0 disabled:opacity-50">
                  <PaperPlaneRight size={18} weight="fill" />
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Agent Tasks View */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-foreground/10">
              <div className="flex items-center gap-2">
                <Robot size={16} weight="fill" className="text-accent" />
                <h2 className="text-sm font-semibold text-foreground">
                  {selectedWs ? selectedWs.name : 'Agent Tasks'}
                </h2>
                {selectedWs?.git_remote && (
                  <a href={selectedWs.git_remote} target="_blank" rel="noopener noreferrer"
                    className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1">
                    <GithubLogo size={10} /> {selectedWs.git_branch || 'main'}
                  </a>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <Tip content="Git Changes Panel">
                  <button onClick={() => setRightPanel(rightPanel === 'files' ? 'none' : 'files')}
                    className={`p-2 rounded-lg ${rightPanel === 'files' ? 'text-accent bg-accent/10' : 'text-foreground/40 hover:text-foreground'}`}>
                    <Code size={15} />
                  </button>
                </Tip>
                <button onClick={() => setShowCreateTask(true)} disabled={!selectedWorkspace}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-40">
                  <Plus size={12} /> Task
                </button>
              </div>
            </div>

            {/* Task + Output Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {!selectedWorkspace ? (
                <div className="flex flex-col items-center justify-center h-full text-center py-16">
                  <FolderOpen size={40} weight="duotone" className="text-foreground/20 mb-4" />
                  <p className="text-sm text-foreground/60 mb-2">Wähle ein Workspace aus</p>
                  <button onClick={() => setShowCreateWs(true)}
                    className="px-4 py-2 rounded-xl bg-accent/20 text-accent text-xs font-semibold hover:bg-accent/30">
                    Workspace erstellen
                  </button>
                </div>
              ) : workspaceTasks.length === 0 ? (
                <div className="text-center py-12">
                  <Robot size={32} weight="duotone" className="mx-auto text-foreground/20 mb-3" />
                  <p className="text-sm text-foreground/60 mb-2">Keine Tasks in diesem Workspace</p>
                  <button onClick={() => setShowCreateTask(true)}
                    className="px-4 py-2 rounded-xl bg-accent/20 text-accent text-xs font-semibold hover:bg-accent/30">
                    Ersten Task starten
                  </button>
                </div>
              ) : (
                workspaceTasks.map(task => (
                  <div key={task.id} className="rounded-2xl bg-foreground/[0.03] border border-foreground/10 overflow-hidden">
                    {/* Task Header */}
                    <div className="flex items-center gap-2 px-4 py-3 bg-foreground/5 border-b border-foreground/10">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                        task.status === 'running' ? 'bg-purple-500/15 animate-pulse' :
                        task.status === 'completed' ? 'bg-green-500/15' :
                        task.status === 'failed' ? 'bg-red-500/15' :
                        task.status === 'cancelled' ? 'bg-foreground/10' :
                        'bg-amber-500/15'
                      }`}>
                        {task.status === 'running' ? <Play size={14} weight="fill" className="text-purple-400" /> :
                         task.status === 'completed' ? <Check size={14} weight="bold" className="text-green-400" /> :
                         task.status === 'failed' ? <X size={14} weight="bold" className="text-red-400" /> :
                         task.status === 'cancelled' ? <Stop size={14} className="text-foreground/40" /> :
                         <Clock size={14} className="text-amber-400" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-foreground truncate">{task.name}</p>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
                            task.status === 'running' ? 'bg-purple-500/15 text-purple-300' :
                            task.status === 'completed' ? 'bg-green-500/15 text-green-300' :
                            task.status === 'failed' ? 'bg-red-500/15 text-red-300' :
                            task.status === 'cancelled' ? 'bg-foreground/10 text-foreground/40' :
                            'bg-amber-500/15 text-amber-300'
                          }`}>{task.status}</span>
                        </div>
                        <p className="text-[10px] text-foreground/50 flex items-center gap-2">
                          <span>{task.provider} / {task.model}</span>
                          {task.started_at && <span>· {formatRelativeTime(task.started_at)}</span>}
                        </p>
                      </div>
                      {(task.status === 'running' || task.status === 'queued') && (
                        <button onClick={() => cancelTask(task.id)}
                          className="p-1.5 rounded-lg text-foreground/40 hover:text-red-400 hover:bg-red-500/10">
                          <Stop size={14} />
                        </button>
                      )}
                    </div>

                    {/* Progress Bar */}
                    {task.status === 'running' && (
                      <div className="h-1 bg-foreground/5">
                        <div className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-500"
                          style={{ width: `${Math.max(5, task.progress * 100)}%` }} />
                      </div>
                    )}

                    {/* Task Output */}
                    <div className="px-4 py-3 space-y-1 max-h-60 overflow-y-auto bg-black/20 font-mono text-[11px]">
                      {task.output.length === 0 ? (
                        <p className="text-foreground/40 italic">Warte auf Ausgabe…</p>
                      ) : task.output.map((line, i) => (
                        <div key={i} className={`flex items-start gap-2 ${
                          line.level === 'error' ? 'text-red-300' :
                          line.level === 'warn' ? 'text-amber-300' :
                          line.level === 'success' ? 'text-green-300' :
                          line.level === 'system' ? 'text-purple-300' :
                          'text-foreground/70'
                        }`}>
                          <span className="text-[9px] text-foreground/30 shrink-0 w-16">
                            {new Date(line.timestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </span>
                          <span className="break-words whitespace-pre-wrap">{line.message}</span>
                        </div>
                      ))}
                    </div>

                    {/* Changes */}
                    {task.changes.length > 0 && (
                      <div className="border-t border-foreground/10 px-4 py-3 space-y-2">
                        <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                          <GitBranch size={12} /> {task.changes.length} Änderung(en)
                        </p>
                        <div className="space-y-1.5 max-h-72 overflow-y-auto">
                          {task.changes.map(c => renderDiff(c))}
                        </div>
                      </div>
                    )}

                    {/* Error */}
                    {task.error && (
                      <div className="px-4 py-2 bg-red-500/5 border-t border-red-500/10 text-xs text-red-300">
                        ❌ {task.error}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>

      {/* ─── Right Panel: Git Changes / Files ─────────────────────────────── */}
      <AnimatePresence>
        {rightPanel === 'files' && selectedWorkspace && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 380, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            className="overflow-hidden shrink-0"
          >
            <div className="w-[380px] h-full glass-card rounded-3xl border border-white/10 bg-white/10 shadow-xl shadow-black/5 backdrop-blur-xl flex flex-col overflow-hidden">
              {/* Panel Header with tabs */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-foreground/10">
                <div className="flex gap-1">
                  {(['files', 'changes'] as const).map(tab => (
                    <button key={tab}
                      onClick={() => setRightPanel(tab === 'files' ? 'files' : 'files')}
                      className={`px-3 py-1 rounded-lg text-[10px] font-semibold ${
                        true ? 'bg-accent/20 text-accent' : 'text-foreground/40'
                      }`}
                    >
                      {tab === 'files' ? 'Dateien' : 'Änderungen'}
                    </button>
                  ))}
                </div>
                <button onClick={() => setRightPanel('none')}
                  className="p-1 rounded text-foreground/40 hover:text-foreground">
                  <X size={14} />
                </button>
              </div>

              {/* Git Operations Bar */}
              <div className="px-4 py-2 border-b border-foreground/10 flex flex-wrap gap-1">
                <button onClick={() => gitCommit('ORA Agent: automatische Änderungen')}
                  disabled={gitChanges.length === 0}
                  className="px-2 py-1 rounded text-[9px] font-semibold bg-green-500/15 text-green-300 hover:bg-green-500/25 disabled:opacity-30">
                  <GitCommit size={10} className="inline mr-0.5" /> Commit
                </button>
                <button onClick={gitPush}
                  className="px-2 py-1 rounded text-[9px] font-semibold bg-blue-500/15 text-blue-300 hover:bg-blue-500/25">
                  <ArrowUp size={10} className="inline mr-0.5" /> Push
                </button>
                <button onClick={createPR}
                  className="px-2 py-1 rounded text-[9px] font-semibold bg-purple-500/15 text-purple-300 hover:bg-purple-500/25">
                  <GitPullRequest size={10} className="inline mr-0.5" /> PR
                </button>
                <button onClick={() => {
                  const msg = prompt('Stash message (optional):')
                  fetch(`${ASSIST_URL}/api/assist/workspaces/${selectedWorkspace}/git/stash`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ message: msg || null })
                  }).then(r => r.json()).then(d => {
                    if (d.success) { toast.success('Gestasht!'); loadGitChanges(selectedWorkspace) }
                    else toast.error(d.error)
                  }).catch(() => toast.error('Stash fehlgeschlagen'))
                }}
                  className="px-2 py-1 rounded text-[9px] font-semibold bg-amber-500/15 text-amber-300 hover:bg-amber-500/25">
                  📦 Stash
                </button>
                <button onClick={() => {
                  const target = prompt('Reset target (z.B. HEAD~1):', 'HEAD')
                  if (!target) return
                  const mode = confirm('Hard reset? OK = hard, Abbrechen = soft') ? 'hard' : 'soft'
                  fetch(`${ASSIST_URL}/api/assist/workspaces/${selectedWorkspace}/git/reset`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ mode, target })
                  }).then(r => r.json()).then(d => {
                    if (d.success) { toast.success(`Reset (${mode}) durchgeführt!`); loadGitChanges(selectedWorkspace) }
                    else toast.error(d.error)
                  }).catch(() => toast.error('Reset fehlgeschlagen'))
                }}
                  className="px-2 py-1 rounded text-[9px] font-semibold bg-red-500/15 text-red-300 hover:bg-red-500/25">
                  ↩️ Reset
                </button>
                <button onClick={() => {
                  fetch(`${ASSIST_URL}/api/assist/workspaces/${selectedWorkspace}/git/fetch`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ remote: 'origin' })
                  }).then(r => r.json()).then(d => {
                    if (d.success) toast.success('Fetch erfolgreich!')
                    else toast.error(d.error)
                  }).catch(() => toast.error('Fetch fehlgeschlagen'))
                }}
                  className="px-2 py-1 rounded text-[9px] font-semibold bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25">
                  🔄 Fetch
                </button>
                <button onClick={() => loadGitChanges(selectedWorkspace)}
                  className="px-2 py-1 rounded text-[9px] font-semibold bg-foreground/10 text-foreground/40 hover:text-foreground">
                  <ArrowClockwise size={10} />
                </button>
              </div>

              {/* Git Changes Section */}
              <div className="px-4 py-2 border-b border-foreground/10">
                <p className="text-[10px] font-semibold text-foreground/60 mb-1.5 flex items-center gap-1">
                  <Code size={11} /> {gitChanges.length} Änderung(en)
                  {gitChanges.length > 0 && (
                    <span className="text-[8px] text-foreground/40 ml-auto">
                      +{gitChanges.filter(c => c.status === 'added').length} ~{gitChanges.filter(c => c.status === 'modified').length} -{gitChanges.filter(c => c.status === 'deleted').length}
                    </span>
                  )}
                </p>
                <div className="space-y-0.5 max-h-40 overflow-y-auto">
                  {gitChanges.length === 0 ? (
                    <p className="text-[9px] text-foreground/30 text-center py-2">Keine Änderungen</p>
                  ) : gitChanges.map(c => (
                    <div key={c.file_path} className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-foreground/5 text-[10px]">
                      <span className={`w-1 h-1 rounded-full ${
                        c.status === 'added' ? 'bg-green-400' :
                        c.status === 'deleted' ? 'bg-red-400' : 'bg-blue-400'
                      }`} />
                      <span className="text-foreground/60 truncate flex-1">{c.file_path}</span>
                      <span className="text-[8px] text-foreground/30">{c.hunks.length} Blöcke</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Files Section */}
              <div className="flex-1 overflow-y-auto px-4 py-3">
                <p className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
                  <FolderOpen size={12} /> Dateien ({workspaceFiles.length})
                </p>
                <div className="space-y-0.5">
                  {workspaceFiles.filter(f => !f.is_dir).map(f => (
                    <button key={f.path}
                      onClick={() => {
                        setSelectedFilePath(f.path)
                        fetch(`${ASSIST_URL}/api/assist/workspaces/${selectedWorkspace}/files/${f.path}`, {
                          headers: { Authorization: `Bearer ${token}` }
                        })
                          .then(r => r.ok ? r.json() : null)
                          .then(d => setFileContent(d?.content || '// Kein Inhalt'))
                          .catch(() => setFileContent('// Fehler beim Laden'))
                      }}
                      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] transition-all ${
                        selectedFilePath === f.path
                          ? 'bg-accent/15 text-accent'
                          : 'text-foreground/60 hover:text-foreground hover:bg-foreground/5'
                      }`}
                    >
                      <FileCode size={13} />
                      <span className="truncate">{f.name}</span>
                      <span className="ml-auto text-[9px] text-foreground/30">{formatBytes(f.size_bytes)}</span>
                    </button>
                  ))}
                </div>
                {fileContent && selectedFilePath && (
                  <div className="mt-3 rounded-xl bg-black/30 border border-foreground/10 overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-1.5 bg-foreground/5 border-b border-foreground/10">
                      <span className="text-[10px] font-mono text-foreground/50">{selectedFilePath}</span>
                      <button onClick={() => setFileContent(null)}
                        className="p-0.5 rounded text-foreground/30 hover:text-foreground">
                        <X size={10} />
                      </button>
                    </div>
                    <pre className="p-3 text-[11px] font-mono text-foreground/80 max-h-48 overflow-y-auto whitespace-pre-wrap break-all">
                      {fileContent}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Create Workspace Dialog ────────────────────────────────────── */}
      <AnimatePresence>
        {showCreateWs && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center"
            onClick={() => setShowCreateWs(false)}>
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-md glass-card rounded-3xl border border-white/10 bg-card/95 p-6 space-y-4 backdrop-blur-2xl">
              <h3 className="text-sm font-semibold text-foreground">Neues Workspace</h3>

              <div>
                <label className="text-[10px] uppercase tracking-wider text-foreground/40">Name</label>
                <input value={newWsName} onChange={e => setNewWsName(e.target.value)}
                  className="w-full mt-1 px-3 py-2 rounded-xl bg-foreground/5 border border-foreground/10 text-sm text-foreground" />
              </div>

              <div>
                <label className="text-[10px] uppercase tracking-wider text-foreground/40">Quelle</label>
                <div className="flex gap-2 mt-1">
                  {(['new', 'clone', 'import'] as const).map(s => (
                    <button key={s} onClick={() => setNewWsSource(s)}
                      className={`flex-1 py-2 rounded-xl text-xs font-semibold ${
                        newWsSource === s
                          ? 'bg-accent/20 text-accent border border-accent/20'
                          : 'bg-foreground/5 text-foreground/60 border border-transparent'
                      }`}>
                      {s === 'new' ? 'Neu' : s === 'clone' ? 'Clone' : 'Import'}
                    </button>
                  ))}
                </div>
              </div>

              {newWsSource === 'clone' && (
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-foreground/40">Git URL</label>
                  <input value={newWsGitUrl} onChange={e => setNewWsGitUrl(e.target.value)}
                    placeholder="https://github.com/..."
                    className="w-full mt-1 px-3 py-2 rounded-xl bg-foreground/5 border border-foreground/10 text-sm text-foreground" />
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button onClick={() => setShowCreateWs(false)}
                  className="flex-1 py-2 rounded-xl text-xs font-semibold bg-foreground/5 text-foreground/60 hover:bg-foreground/10">
                  Abbrechen
                </button>
                <button onClick={createWorkspace}
                  className="flex-1 py-2 rounded-xl text-xs font-semibold bg-accent/20 text-accent hover:bg-accent/30">
                  Erstellen
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Create Task Dialog (mit Steering-Controls & Providern) ────── */}
      <AnimatePresence>
        {showCreateTask && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center"
            onClick={() => setShowCreateTask(false)}>
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-lg max-h-[90vh] overflow-y-auto glass-card rounded-3xl border border-white/10 bg-card/95 p-6 space-y-4 backdrop-blur-2xl">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">Neuen Agent Task starten</h3>
                <button onClick={() => setShowSteering(!showSteering)}
                  className={`p-1.5 rounded-lg text-xs transition-colors ${showSteering ? 'text-accent bg-accent/10' : 'text-foreground/40 hover:text-foreground'}`}>
                  <GearSix size={15} />
                </button>
              </div>

              <div>
                <label className="text-[10px] uppercase tracking-wider text-foreground/40">Task Name</label>
                <input value={newTaskName} onChange={e => setNewTaskName(e.target.value)}
                  placeholder="Feature: Dark Mode"
                  className="w-full mt-1 px-3 py-2 rounded-xl bg-foreground/5 border border-foreground/10 text-sm text-foreground" />
              </div>

              <div>
                <label className="text-[10px] uppercase tracking-wider text-foreground/40">Beschreibung</label>
                <textarea value={newTaskDesc} onChange={e => setNewTaskDesc(e.target.value)}
                  rows={3} placeholder="Was soll der Agent tun?"
                  className="w-full mt-1 px-3 py-2 rounded-xl bg-foreground/5 border border-foreground/10 text-sm text-foreground" />
              </div>

              {/* Provider & Model */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-foreground/40">Provider</label>
                  <select value={newTaskProvider} onChange={e => setNewTaskProvider(e.target.value)}
                    className="w-full mt-1 px-3 py-2 rounded-xl bg-foreground/5 border border-foreground/10 text-sm text-foreground">
                    <optgroup label="☁️ Cloud">
                      <option value="openai">OpenAI</option>
                      <option value="anthropic">Anthropic</option>
                      <option value="google">Google Gemini</option>
                      <option value="azure">Azure OpenAI</option>
                    </optgroup>
                    <optgroup label="🔧 Desktop / Local">
                      <option value="desktop">IORA Desktop (LM Studio)</option>
                      <option value="lmstudio">LM Studio (OpenAI-API)</option>
                      <option value="pidev">pi.dev</option>
                      <option value="local">Local (Ollama)</option>
                    </optgroup>
                    <optgroup label="⏳ Lokal (Momentan nicht verfügbar)">
                      <option value="llamacpp" disabled>llama.cpp</option>
                      <option value="gpt4all" disabled>GPT4All</option>
                      <option value="whisper" disabled>Whisper.cpp</option>
                    </optgroup>
                    {providers.filter(p => p.available && !['openai','anthropic','desktop','local','pidev','google','azure','lmstudio','llamacpp','gpt4all'].includes(p.id)).map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-foreground/40">Model</label>
                  <select value={newTaskModel} onChange={e => setNewTaskModel(e.target.value)}
                    className="w-full mt-1 px-3 py-2 rounded-xl bg-foreground/5 border border-foreground/10 text-sm text-foreground">
                    <optgroup label="OpenAI">
                      <option value="gpt-4o">GPT-4o</option>
                      <option value="gpt-4o-mini">GPT-4o Mini</option>
                      <option value="o3-mini">o3-mini</option>
                    </optgroup>
                    <optgroup label="Anthropic">
                      <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
                      <option value="claude-3-5-sonnet">Claude 3.5 Sonnet</option>
                      <option value="claude-3-5-haiku">Claude 3.5 Haiku</option>
                    </optgroup>
                    <optgroup label="pi.dev">
                      <option value="pi-dev">pi.dev Agent</option>
                      <option value="pi-dev-code">pi.dev Code</option>
                    </optgroup>
                    <optgroup label="LM Studio / Local">
                      <option value="llama3.1-8b">Llama 3.1 8B</option>
                      <option value="llama3.1-70b">Llama 3.1 70B</option>
                      <option value="codellama-34b">CodeLlama 34B</option>
                      <option value="deepseek-coder">DeepSeek Coder</option>
                      <option value="qwen2.5-coder">Qwen 2.5 Coder</option>
                      <option value="mistral">Mistral</option>
                    </optgroup>
                  </select>
                </div>
              </div>

              {/* ─── Steering Panel ────────────────────────────────────── */}
              <AnimatePresence>
                {showSteering && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }} className="overflow-hidden rounded-xl bg-foreground/[0.03] border border-foreground/10">
                    <div className="p-4 space-y-4">
                      <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                        <GearSix size={13} /> Steering & Konfiguration
                      </p>

                      {/* Mode Selector */}
                      <div>
                        <label className="text-[10px] uppercase tracking-wider text-foreground/40">Modus</label>
                        <div className="grid grid-cols-4 gap-1.5 mt-1">
                          {['fast','balanced','detailed','creative'].map(m => (
                            <button key={m} onClick={() => setTaskConfig(prev => ({ ...prev, mode: m }))}
                              className={`py-2 rounded-lg text-[10px] font-semibold transition-all capitalize ${
                                taskConfig.mode === m
                                  ? 'bg-accent/20 text-accent border border-accent/20'
                                  : 'bg-foreground/5 text-foreground/50 border border-transparent hover:border-foreground/20'
                              }`}>
                              {m === 'fast' ? '⚡ Schnell' : m === 'balanced' ? '⚖️ Ausgewogen' : m === 'detailed' ? '🔍 Detail' : '🎨 Kreativ'}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Thinking Toggle */}
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-medium text-foreground">🧠 Thinking</p>
                          <p className="text-[10px] text-foreground/50">Chain-of-Thought Reasoning</p>
                        </div>
                        <button onClick={() => setTaskConfig(prev => ({ ...prev, thinking_enabled: !prev.thinking_enabled }))}
                          className={`w-10 h-5 rounded-full transition-colors relative ${taskConfig.thinking_enabled ? 'bg-accent' : 'bg-foreground/20'}`}>
                          <div className={`w-3.5 h-3.5 rounded-full bg-white absolute top-0.5 transition-all ${taskConfig.thinking_enabled ? 'left-5.5' : 'left-0.5'}`} />
                        </button>
                      </div>

                      {/* Temperature */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-xs font-medium text-foreground">🌡️ Temperature</p>
                          <span className="text-[10px] text-foreground/50">{taskConfig.temperature.toFixed(1)}</span>
                        </div>
                        <input type="range" min="0" max="1" step="0.1" value={taskConfig.temperature}
                          onChange={e => setTaskConfig(prev => ({ ...prev, temperature: parseFloat(e.target.value) }))}
                          className="w-full accent-accent" />
                        <div className="flex justify-between text-[9px] text-foreground/30 mt-0.5">
                          <span>Präzise</span><span>Kreativ</span>
                        </div>
                      </div>

                      {/* Context Level */}
                      <div>
                        <label className="text-[10px] uppercase tracking-wider text-foreground/40">Code-Kontext</label>
                        <div className="grid grid-cols-3 gap-1.5 mt-1">
                          {[
                            { id: 'none', label: 'Keiner' },
                            { id: 'changed', label: 'Geändert' },
                            { id: 'all', label: 'Gesamtes Projekt' },
                          ].map(c => (
                            <button key={c.id} onClick={() => setTaskConfig(prev => ({ ...prev, context_level: c.id }))}
                              className={`py-2 rounded-lg text-[10px] font-semibold transition-all ${
                                taskConfig.context_level === c.id
                                  ? 'bg-accent/20 text-accent border border-accent/20'
                                  : 'bg-foreground/5 text-foreground/50 border border-transparent'
                              }`}>
                              {c.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* ─── Pipeline Mode ───────────────────────────────── */}
                      <div className="rounded-xl bg-blue-500/5 border border-blue-500/20 p-3 space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-xs font-medium text-foreground flex items-center gap-1.5">
                              🔄 Pipeline-Modus
                              <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-purple-500/15 text-purple-300">Für Monorepos</span>
                            </p>
                            <p className="text-[10px] text-foreground/50">Cloud AI plant → Lokaler Agent führt aus → Zusammenführen</p>
                          </div>
                          <button onClick={() => setTaskConfig(prev => ({ ...prev, pipeline_enabled: !prev.pipeline_enabled }))}
                            className={`w-10 h-5 rounded-full transition-colors relative ${taskConfig.pipeline_enabled ? 'bg-purple-500' : 'bg-foreground/20'}`}>
                            <div className={`w-3.5 h-3.5 rounded-full bg-white absolute top-0.5 transition-all ${taskConfig.pipeline_enabled ? 'left-5.5' : 'left-0.5'}`} />
                          </button>
                        </div>

                        <AnimatePresence>
                          {taskConfig.pipeline_enabled && (
                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }} className="overflow-hidden space-y-3">
                              
                              {/* Cloud Planner */}
                              <div>
                                <label className="text-[9px] uppercase tracking-wider text-foreground/40 mb-1 block">☁️ Cloud Planner AI</label>
                                <div className="grid grid-cols-2 gap-2">
                                  <select value={taskConfig.pipeline_cloud_provider}
                                    onChange={e => setTaskConfig(prev => ({ ...prev, pipeline_cloud_provider: e.target.value }))}
                                    className="px-2 py-1.5 rounded-lg bg-foreground/5 border border-foreground/10 text-[10px] text-foreground">
                                    <option value="anthropic">Anthropic Claude</option>
                                    <option value="openai">OpenAI</option>
                                    <option value="deepseek">DeepSeek</option>
                                    <option value="google">Google Gemini</option>
                                  </select>
                                  <select value={taskConfig.pipeline_cloud_model}
                                    onChange={e => setTaskConfig(prev => ({ ...prev, pipeline_cloud_model: e.target.value }))}
                                    className="px-2 py-1.5 rounded-lg bg-foreground/5 border border-foreground/10 text-[10px] text-foreground">
                                    <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
                                    <option value="claude-3-5-sonnet">Claude 3.5 Sonnet</option>
                                    <option value="gpt-4o">GPT-4o</option>
                                    <option value="deepseek-chat">DeepSeek Chat</option>
                                  </select>
                                </div>
                              </div>

                              {/* Local Executor */}
                              <div>
                                <label className="text-[9px] uppercase tracking-wider text-foreground/40 mb-1 block">⚙️ Executor AI (lokal/Desktop)</label>
                                <div className="grid grid-cols-2 gap-2">
                                  <select value={taskConfig.pipeline_executor_provider}
                                    onChange={e => setTaskConfig(prev => ({ ...prev, pipeline_executor_provider: e.target.value }))}
                                    className="px-2 py-1.5 rounded-lg bg-foreground/5 border border-foreground/10 text-[10px] text-foreground">
                                    <option value="deepseek">DeepSeek</option>
                                    <option value="desktop">IORA Desktop</option>
                                    <option value="local">Ollama</option>
                                    <option value="pidev">pi.dev</option>
                                    <option value="lmstudio">LM Studio</option>
                                  </select>
                                  <select value={taskConfig.pipeline_executor_model}
                                    onChange={e => setTaskConfig(prev => ({ ...prev, pipeline_executor_model: e.target.value }))}
                                    className="px-2 py-1.5 rounded-lg bg-foreground/5 border border-foreground/10 text-[10px] text-foreground">
                                    <option value="deepseek-coder">DeepSeek Coder</option>
                                    <option value="deepseek-chat">DeepSeek Chat</option>
                                    <option value="codellama-34b">CodeLlama 34B</option>
                                    <option value="qwen2.5-coder">Qwen 2.5 Coder</option>
                                  </select>
                                </div>
                              </div>

                              <p className="text-[9px] text-foreground/40 leading-relaxed">
                                🔄 Der Cloud AI erstellt einen Plan und ein Skeleton. Der Executor führt die Änderungen aus.
                                Danach werden die Änderungen zurückgespielt und validiert.
                              </p>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>

                      {/* Auto-Apply Toggle */}
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-medium text-foreground">⚡ Auto-Apply</p>
                          <p className="text-[10px] text-foreground/50">Änderungen automatisch anwenden</p>
                        </div>
                        <button onClick={() => setTaskConfig(prev => ({ ...prev, auto_apply: !prev.auto_apply }))}
                          className={`w-10 h-5 rounded-full transition-colors relative ${taskConfig.auto_apply ? 'bg-accent' : 'bg-foreground/20'}`}>
                          <div className={`w-3.5 h-3.5 rounded-full bg-white absolute top-0.5 transition-all ${taskConfig.auto_apply ? 'left-5.5' : 'left-0.5'}`} />
                        </button>
                      </div>

                      {/* Max Context Files */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-xs font-medium text-foreground">📄 Max Dateien im Kontext</p>
                          <span className="text-[10px] text-foreground/50">{taskConfig.max_context_files}</span>
                        </div>
                        <input type="range" min="5" max="100" step="5" value={taskConfig.max_context_files}
                          onChange={e => setTaskConfig(prev => ({ ...prev, max_context_files: parseInt(e.target.value) }))}
                          className="w-full accent-accent" />
                      </div>

                      {/* Custom Instructions */}
                      <div>
                        <label className="text-[10px] uppercase tracking-wider text-foreground/40">Custom Instructions</label>
                        <textarea value={taskConfig.custom_instructions} onChange={e => setTaskConfig(prev => ({ ...prev, custom_instructions: e.target.value }))}
                          rows={2} placeholder="Z.B.: Nutze TypeScript, füge JSDoc-Kommentare hinzu"
                          className="w-full mt-1 px-3 py-2 rounded-xl bg-foreground/5 border border-foreground/10 text-xs text-foreground" />
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="flex gap-2 pt-2">
                <button onClick={() => setShowCreateTask(false)}
                  className="flex-1 py-2 rounded-xl text-xs font-semibold bg-foreground/5 text-foreground/60 hover:bg-foreground/10">
                  Abbrechen
                </button>
                <button onClick={createTask}
                  disabled={!newTaskDesc.trim()}
                  className="flex-1 py-2 rounded-xl text-xs font-semibold bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-40">
                  🚀 Task mit {taskConfig.mode === 'fast' ? '⚡' : taskConfig.mode === 'detailed' ? '🔍' : taskConfig.mode === 'creative' ? '🎨' : '⚖️'} {taskConfig.mode} starten
                </button>
              </div>

              <p className="text-[10px] text-foreground/40 text-center">
                Workspace: <strong>{selectedWs?.name || '–'}</strong>
                {selectedWs?.git_remote && ` · ${selectedWs.git_branch || 'main'}`}
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
