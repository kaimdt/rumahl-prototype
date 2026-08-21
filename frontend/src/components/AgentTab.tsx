// AgentTab – GitHub Copilot-style Agent Workspace
// Features: Chat, Workspace Management, Git Operations, GitHub Token Config
// Design: Clean Copilot-inspired interface with glassmorphism

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  ChatCircle, Sparkle, Brain, Robot, PaperPlaneRight, Microphone,
  SpeakerHigh, SpeakerSlash, Plus, Trash, FolderOpen, Code,
  GitBranch, GitCommit, GitPullRequest, ArrowUp, ArrowClockwise, ArrowsClockwise,
  GithubLogo, Check, X, Stop, Play, Clock, GearSix,
  Key, LinkSimple, MagnifyingGlass, Copy, BookOpen,
  List, Sidebar, CaretRight, CaretDown, FileCode,
  Terminal, Eye, CloudArrowUp, PencilSimple, Globe,
  ArrowLeft, Warning, ShieldCheck, Info
} from '@phosphor-icons/react'
import { MessageContent } from '@/components/MessageContent'
import { adminFetch } from '@/components/AdminPanel'
import { confirmDialog } from '@/components/ui/confirmDialog'
import { toast } from 'sonner'
import { Tip } from '@/components/ui/tip'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChatMsg {
  id: string; role: string; content: string; timestamp: string
}

interface ProviderInfo {
  name: string; id: string; available: boolean
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

interface AgentTask {
  id: string; workspace_id: string; name: string; description: string
  model: string; provider: string
  status: string; progress: number
  output: TaskOutputLine[]; changes: FileDiff[]
  created_at: string; started_at?: string; completed_at?: string
  error?: string
}

interface TaskOutputLine {
  timestamp: string; level: string; message: string; stream?: string | null
}

interface GitHubAuthState {
  is_configured: boolean
  auth_type: string
  username?: string
  avatar_url?: string
  rate_limit?: { remaining: number; limit: number; reset: string }
}

// ─── Constants ────────────────────────────────────────────────────────────────

import { getAssistUrl, getBackendUrl } from '@/lib/config'
import { getAuthToken } from '@/lib/authHelpers'

const assistBase = () => getAssistUrl() || getBackendUrl() || ''

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

// ─── GitHub Token Config Component ────────────────────────────────────────────

function GitHubTokenConfig({ token, onUpdate }: { token: string; onUpdate: () => void }) {
  const [ghAuth, setGhAuth] = useState<GitHubAuthState | null>(null)
  const [loading, setLoading] = useState(true)
  const [showTokenInput, setShowTokenInput] = useState(false)
  const [patInput, setPatInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [rateLimit, setRateLimit] = useState<any>(null)

  const loadGhStatus = useCallback(async () => {
    setLoading(true)
    try {
      const data = await adminFetch('/api/assist/github/auth', token)
      setGhAuth(data as GitHubAuthState)
    } catch { setGhAuth(null) }
    setLoading(false)
  }, [token])

  useEffect(() => { loadGhStatus() }, [loadGhStatus])

  const saveToken = async () => {
    if (!patInput.trim()) { toast.error('Bitte Token eingeben'); return }
    setSaving(true)
    try {
      await adminFetch('/api/assist/github/auth', token, {
        method: 'POST',
        body: JSON.stringify({
          auth_type: 'pat',
          pat: patInput.trim(),
        }),
      })
      toast.success('GitHub Token gespeichert!')
      setShowTokenInput(false)
      setPatInput('')
      loadGhStatus()
      onUpdate()
    } catch (e) {
      toast.error(`Fehler: ${e instanceof Error ? e.message : String(e)}`)
    }
    setSaving(false)
  }

  const testConnection = async () => {
    setTesting(true)
    try {
      const data = await adminFetch('/api/assist/github/ratelimit', token)
      setRateLimit(data)
      toast.success('GitHub Verbindung OK!')
    } catch (e) {
      toast.error(`GitHub nicht erreichbar: ${e instanceof Error ? e.message : String(e)}`)
    }
    setTesting(false)
  }

  const disconnectGh = async () => {
    if (!(await confirmDialog({ title: 'GitHub trennen', message: 'GitHub Verbindung wirklich trennen?', confirmLabel: 'Trennen', danger: true }))) return
    try {
      await adminFetch('/api/assist/github/auth', token, {
        method: 'POST',
        body: JSON.stringify({
          auth_type: 'pat',
          pat: '',
        }),
      })
      toast.success('GitHub Verbindung getrennt')
      loadGhStatus()
      onUpdate()
    } catch (e) {
      toast.error(`Fehler: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-foreground/40">
        <ArrowClockwise size={12} className="animate-spin" /> Lade GitHub Status…
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {/* Current Status */}
      {ghAuth?.is_configured && ghAuth.username ? (
        <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-green-500/5 border border-green-500/15">
          <div className="flex items-center gap-2">
            <GithubLogo size={16} weight="fill" className="text-green-400" />
            <div>
              <p className="text-xs font-semibold text-green-300">Verbunden als</p>
              <p className="text-[11px] text-foreground/60">{ghAuth.username}</p>
            </div>
            {rateLimit && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-foreground/10 text-foreground/40">
                API: {rateLimit?.rate?.remaining ?? rateLimit?.remaining ?? '?'}/{rateLimit?.rate?.limit ?? rateLimit?.limit ?? '?'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={testConnection} disabled={testing}
              className="p-1.5 rounded-lg text-foreground/40 hover:text-green-400 hover:bg-green-500/10"
              title="Verbindung testen">
              {testing ? <ArrowClockwise size={12} className="animate-spin" /> : <Check size={12} />}
            </button>
            <button onClick={disconnectGh}
              className="p-1.5 rounded-lg text-foreground/40 hover:text-red-400 hover:bg-red-500/10"
              title="Trennen">
              <X size={12} />
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-foreground/[0.03] border border-foreground/10">
            <GithubLogo size={16} weight="fill" className="text-foreground/40" />
            <div>
              <p className="text-xs text-foreground/60">GitHub nicht verbunden</p>
              <p className="text-[10px] text-foreground/40">Token konfigurieren für Git-Operationen & Repository-Zugriff</p>
            </div>
          </div>

          {!showTokenInput ? (
            <button onClick={() => setShowTokenInput(true)}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-foreground/5 border border-foreground/10 text-xs text-foreground/60 hover:text-foreground hover:bg-foreground/10 transition-all">
              <Key size={12} /> GitHub Token konfigurieren
            </button>
          ) : (
            <div className="space-y-2 p-3 rounded-xl bg-foreground/[0.03] border border-foreground/10">
              <div className="flex items-center gap-2">
                <Info size={12} className="text-blue-400" />
                <p className="text-[10px] text-foreground/50">
                  Erstelle einen{' '}
                  <a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer"
                    className="text-blue-400 hover:text-blue-300 underline">Personal Access Token</a>
                  {' '}mit <code className="text-[9px] bg-foreground/10 px-1 rounded">repo</code> und <code className="text-[9px] bg-foreground/10 px-1 rounded">workflow</code> Scopes.
                </p>
              </div>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={patInput}
                  onChange={e => setPatInput(e.target.value)}
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                  className="flex-1 px-3 py-1.5 rounded-lg bg-foreground/5 border border-foreground/10 text-xs text-foreground font-mono placeholder:text-foreground/30 focus:outline-none focus:border-accent"
                  onKeyDown={e => { if (e.key === 'Enter') saveToken() }}
                />
                <button onClick={saveToken} disabled={saving || !patInput.trim()}
                  className="px-3 py-1.5 rounded-lg bg-green-500/15 text-green-300 text-xs font-semibold hover:bg-green-500/25 disabled:opacity-40 transition-all">
                  {saving ? '…' : 'Speichern'}
                </button>
                <button onClick={() => { setShowTokenInput(false); setPatInput('') }}
                  className="p-1.5 rounded-lg text-foreground/40 hover:text-foreground hover:bg-foreground/10">
                  <X size={12} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main Agent Tab Component ─────────────────────────────────────────────────

export function AgentTab({ token }: { token: string }) {
  const [activeView, setActiveView] = useState<'chat' | 'workspace'>('chat')
  const [sidebarOpen, setSidebarOpen] = useState(true)

  // Chat state
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [chatState, setChatState] = useState<'idle' | 'thinking' | 'error'>('idle')
  const [chatError, setChatError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [ttsEnabled, setTtsEnabled] = useState(false)
  const [selectedModel, setSelectedModel] = useState('gpt-4o')
  const [selectedProvider, setSelectedProvider] = useState('openai')

  // Workspace state
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [tasks, setTasks] = useState<AgentTask[]>([])
  const [selectedWorkspace, setSelectedWorkspace] = useState<string | null>(null)
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([])
  const [gitChanges, setGitChanges] = useState<FileDiff[]>([])
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Dialogs
  const [showCreateWs, setShowCreateWs] = useState(false)
  const [showNewTask, setShowNewTask] = useState(false)
  const [newWsName, setNewWsName] = useState('')
  const [newWsSource, setNewWsSource] = useState<'new' | 'clone'>('new')
  const [newWsGitUrl, setNewWsGitUrl] = useState('')
  const [newTaskDesc, setNewTaskDesc] = useState('')

  // Providers
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [activeProvider, setActiveProvider] = useState<ProviderInfo | null>(null)

  // Global model catalog (cached + auto-refreshed for local/desktop providers).
  // Loaded from /api/assist/models — replaces the per-provider model lookup
  // so the UI shows a single Copilot-style grouped picker.
  type GlobalModelGroup = {
    provider_id: string
    provider_type: string
    purpose: string
    is_live: boolean
    model_count: number
    models: Array<{ id: string; name: string; last_seen?: string; is_live?: boolean }>
  }
  const [globalModels, setGlobalModels] = useState<GlobalModelGroup[]>([])
  const [globalModelsLoading, setGlobalModelsLoading] = useState(false)

  // ─── SSE for live tasks ──────────────────────────────────────────────────
  useEffect(() => {
    const es = new EventSource(`${assistBase()}/api/assist/agent/tasks/events?token=${encodeURIComponent(getAuthToken() || '')}`)
    const updateTask = (updater: (t: AgentTask) => AgentTask) => {
      setTasks(prev => prev.map(t => t.id === (updater as any)._id ? updater(t) : t))
    }

    es.addEventListener('agent_task_output', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data)
        setTasks(prev => prev.map(t =>
          t.id === data.task_id
            ? { ...t, output: [...t.output, data.line] }
            : t
        ))
      } catch {}
    })

    es.addEventListener('agent_task_progress', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data)
        setTasks(prev => prev.map(t =>
          t.id === data.task_id ? { ...t, progress: data.progress } : t
        ))
      } catch {}
    })

    es.addEventListener('agent_task_status', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data)
        setTasks(prev => prev.map(t =>
          t.id === data.task_id ? { ...t, status: data.status } : t
        ))
      } catch {}
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
      } catch {}
    })

    es.addEventListener('agent_task_failed', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data)
        setTasks(prev => prev.map(t =>
          t.id === data.task_id ? { ...t, status: 'failed', error: data.error } : t
        ))
        toast.error(`Task fehlgeschlagen: ${data.error}`)
      } catch {}
    })

    es.onerror = () => {}
    return () => { es.close() }
  }, [])

  // ─── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    loadProviders()
    loadWorkspaces()
    loadGlobalModels()
    // Refresh global models every 30 s — fast for local/desktop, cheap for cloud
    // (backend just hits its cache).
    const t = setInterval(() => { loadGlobalModels(true) }, 30_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const loadProviders = async () => {
    try {
      const data = await adminFetch('/api/assist/providers', token)
      const pd = data as any
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
    } catch { /* offline */ }
  }

  /**
   * Load the global model catalog from /api/assist/models.
   * Backend caches all known models per provider in the DB and refreshes
   * local/desktop providers on every call. `silent=true` skips the loading
   * indicator (used by the periodic timer).
   */
  const loadGlobalModels = async (silent = false) => {
    try {
      if (!silent) setGlobalModelsLoading(true)
      const data: any = await adminFetch('/api/assist/models', token)
      if (Array.isArray(data?.providers)) {
        setGlobalModels(data.providers)
      }
    } catch { /* offline / no DB */ } finally {
      if (!silent) setGlobalModelsLoading(false)
    }
  }

  const loadWorkspaces = async () => {
    try {
      const data = await adminFetch('/api/assist/workspaces', token)
      const ws = (data as any).workspaces || []
      setWorkspaces(ws)
    } catch {}
  }

  const loadWorkspaceFiles = async (wsId: string) => {
    try {
      const data = await adminFetch(`/api/assist/workspaces/${wsId}/files?path=`, token)
      setWorkspaceFiles(data?.files || [])
    } catch { setWorkspaceFiles([]) }
  }

  const loadGitChanges = async (wsId: string) => {
    try {
      const data = await adminFetch(`/api/assist/workspaces/${wsId}/git/status`, token)
      setGitChanges(data?.changes || [])
    } catch { setGitChanges([]) }
  }

  const loadTasks = async () => {
    try {
      const data = await adminFetch('/api/assist/agent/tasks', token)
      setTasks((data as any).tasks || [])
    } catch {}
  }

  // ─── Chat ──────────────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (text?: string) => {
    const msg = text || input
    if (!msg.trim() || chatState === 'thinking') return

    const userMsg: ChatMsg = {
      id: crypto.randomUUID(), role: 'user',
      content: msg, timestamp: new Date().toISOString(),
    }
    setMessages(prev => [...prev, userMsg])
    setInput(''); setChatState('thinking'); setChatError(null)

    try {
      const response = await fetch(`${assistBase()}/api/assist/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          provider: selectedProvider,
          model: selectedModel,
          context: {},
          voice_mode: false,
        }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()

      const aiMsg: ChatMsg = {
        id: data.message_id ?? crypto.randomUUID(),
        role: 'assistant', content: data.message,
        timestamp: new Date().toISOString(),
      }
      setMessages(prev => [...prev, aiMsg])
      setChatState('idle')
    } catch (e) {
      setChatError(e instanceof Error ? e.message : 'Fehler')
      setChatState('error')
    }
  }, [input, chatState, selectedProvider, selectedModel])

  // ─── Workspace Operations ──────────────────────────────────────────────────
  const selectWorkspace = async (id: string) => {
    setSelectedWorkspace(id)
    setSelectedFilePath(null)
    setFileContent(null)
    await Promise.all([
      loadWorkspaceFiles(id),
      loadGitChanges(id),
      loadTasks(),
    ])
    setActiveView('workspace')
  }

  const createWorkspace = async () => {
    if (!newWsName.trim()) { toast.error('Bitte Namen eingeben'); return }
    try {
      const body: any = { name: newWsName, source: newWsSource }
      if (newWsSource === 'clone' && newWsGitUrl.trim()) body.git_url = newWsGitUrl
      await adminFetch('/api/assist/workspaces', token, {
        method: 'POST', body: JSON.stringify(body),
      })
      toast.success('Workspace erstellt!')
      setShowCreateWs(false); setNewWsName(''); setNewWsGitUrl('')
      loadWorkspaces()
    } catch (e) {
      toast.error(`Fehler: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const deleteWorkspace = async (id: string) => {
    if (!(await confirmDialog({ title: 'Workspace löschen', message: 'Workspace wirklich löschen?', confirmLabel: 'Löschen', danger: true }))) return
    try {
      await adminFetch(`/api/assist/workspaces/${id}`, token, { method: 'DELETE' })
      setWorkspaces(prev => prev.filter(w => w.id !== id))
      if (selectedWorkspace === id) setSelectedWorkspace(null)
      toast.success('Workspace gelöscht')
    } catch (e) { toast.error(`Fehler: ${e}`) }
  }

  // ─── Task Operations ───────────────────────────────────────────────────────
  const createTask = async () => {
    if (!selectedWorkspace) { toast.error('Bitte Workspace wählen'); return }
    if (!newTaskDesc.trim()) { toast.error('Bitte Aufgabenbeschreibung eingeben'); return }
    try {
      const data = await adminFetch('/api/assist/agent/tasks', token, {
        method: 'POST', body: JSON.stringify({
          workspace_id: selectedWorkspace,
          name: 'Agent Task',
          description: newTaskDesc,
          model: selectedModel,
          provider: selectedProvider,
        }),
      })
      toast.success('Agent Task gestartet!')
      setTasks(prev => [...prev, data.task])
      setShowNewTask(false); setNewTaskDesc('')
    } catch (e) { toast.error(`Fehler: ${e}`) }
  }

  const cancelTask = async (id: string) => {
    try {
      await adminFetch(`/api/assist/agent/tasks/${id}`, token, { method: 'DELETE' })
      setTasks(prev => prev.map(t => t.id === id ? { ...t, status: 'cancelled' } : t))
      toast.success('Task abgebrochen')
    } catch (e) { toast.error(`Fehler: ${e}`) }
  }

  // ─── Git Operations ───────────────────────────────────────────────────────
  const gitCommit = async (message: string) => {
    if (!selectedWorkspace) return
    try {
      await adminFetch(`/api/assist/workspaces/${selectedWorkspace}/git/commit`, token, {
        method: 'POST', body: JSON.stringify({ message }),
      })
      toast.success('Committed!')
      loadGitChanges(selectedWorkspace)
    } catch (e) { toast.error(`Git commit fehlgeschlagen: ${e}`) }
  }

  const gitPush = async () => {
    if (!selectedWorkspace) return
    const ws = workspaces.find(w => w.id === selectedWorkspace)
    try {
      await adminFetch(`/api/assist/workspaces/${selectedWorkspace}/git/push`, token, {
        method: 'POST', body: JSON.stringify({
          remote: 'origin', branch: ws?.git_branch || 'main',
        }),
      })
      toast.success('Gepusht!')
    } catch (e) { toast.error(`Git push fehlgeschlagen: ${e}`) }
  }

  const createPR = async () => {
    if (!selectedWorkspace) return
    const ws = workspaces.find(w => w.id === selectedWorkspace)
    const branch = ws?.git_branch || 'main'
    const prTitle = prompt('PR Titel:', `rumahl Agent: ${branch}`)
    if (!prTitle) return
    const prBody = prompt('PR Beschreibung:', 'Automated changes by rumahl Agent.')
    try {
      await adminFetch(`/api/assist/workspaces/${selectedWorkspace}/git/pr`, token, {
        method: 'POST', body: JSON.stringify({
          title: prTitle, body: prBody || '', head: branch, base: 'main',
        }),
      })
      toast.success('Pull Request erstellt!')
    } catch (e) { toast.error(`PR fehlgeschlagen: ${e}`) }
  }

  // ─── Diff Renderer ─────────────────────────────────────────────────────────
  const renderDiff = (change: FileDiff) => {
    const addedLines = change.hunks.reduce((sum, hunk) => sum + hunk.content.split('\n').filter(line => line.startsWith('+')).length, 0)
    const removedLines = change.hunks.reduce((sum, hunk) => sum + hunk.content.split('\n').filter(line => line.startsWith('-')).length, 0)

    return (
    <div key={change.file_path} className="rounded-xl bg-background/35 border border-foreground/10 overflow-hidden shadow-sm shadow-black/5">
      <div className="flex items-center gap-2 px-3 py-2 bg-foreground/[0.035] border-b border-foreground/10 text-xs">
        <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase ${
          change.status === 'added' ? 'bg-green-500/15 text-green-300' :
          change.status === 'deleted' ? 'bg-red-500/15 text-red-300' :
          'bg-blue-500/15 text-blue-300'
        }`}>{change.status}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/70">{change.file_path}</span>
        <span className="rounded-md bg-green-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-green-300">+{addedLines}</span>
        <span className="rounded-md bg-red-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-red-300">-{removedLines}</span>
      </div>
      <div className="font-mono text-[10px] leading-relaxed max-h-52 overflow-y-auto bg-black/15">
        {change.hunks.map((hunk, i) => (
          <div key={i}>
            <div className="px-3 py-1 bg-foreground/[0.025] text-foreground/35 text-[9px] border-b border-foreground/5">
              @@ -{hunk.old_start},{hunk.old_lines} +{hunk.new_start},{hunk.new_lines} @@
            </div>
            {hunk.content.split('\n').filter(l => l.trim()).slice(0, 20).map((line, j) => {
              const cls = line.startsWith('+') ? 'text-green-300 bg-green-500/10' :
                line.startsWith('-') ? 'text-red-300 bg-red-500/10' : 'text-foreground/70'
              return <div key={j} className={`px-3 py-0.5 whitespace-pre-wrap break-all ${cls}`}>{line}</div>
            })}
          </div>
        ))}
      </div>
    </div>
    )
  }

  const selectedWs = workspaces.find(w => w.id === selectedWorkspace)
  const workspaceTasks = tasks.filter(t => t.workspace_id === selectedWorkspace)
  const runningCount = tasks.filter(t => t.status === 'running').length
  // No hardcoded fallback list — only show models that the rumahl-assist
  // registry actually discovered from configured providers. Otherwise the UI
  // claims to support models that don't exist in the user's setup.
  const availableModels = activeProvider?.models || []

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-[calc(100vh-200px)] min-h-[600px] gap-3">
      {/* ─── Left Sidebar ────────────────────────────────────────────────── */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 280, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            className="shrink-0 overflow-hidden"
          >
            <div className="w-[280px] h-full glass-card rounded-2xl border border-white/10 bg-white/10 shadow-xl shadow-black/5 backdrop-blur-xl flex flex-col overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-foreground/10">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                    <Sparkle size={14} weight="fill" className="text-white" />
                  </div>
                  <span className="text-sm font-semibold text-foreground">rumahl Agent</span>
                </div>
                <button onClick={() => setSidebarOpen(false)}
                  className="p-1 rounded-lg text-foreground/40 hover:text-foreground hover:bg-foreground/10">
                  <Sidebar size={14} />
                </button>
              </div>

              {/* Mode Switcher */}
              <div className="px-3 py-2">
                <div className="flex rounded-lg bg-foreground/5 p-0.5">
                  <button onClick={() => setActiveView('chat')}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[11px] font-semibold transition-all ${
                      activeView === 'chat' ? 'bg-white/10 text-foreground' : 'text-foreground/50 hover:text-foreground'
                    }`}>
                    <ChatCircle size={13} weight={activeView === 'chat' ? 'fill' : 'regular'} />
                    Chat
                  </button>
                  <button onClick={() => setActiveView('workspace')}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[11px] font-semibold transition-all ${
                      activeView === 'workspace' ? 'bg-white/10 text-foreground' : 'text-foreground/50 hover:text-foreground'
                    }`}>
                    <FolderOpen size={13} weight={activeView === 'workspace' ? 'fill' : 'regular'} />
                    Workspace
                  </button>
                </div>
              </div>

              {/* Model Selector — Copilot-style global picker (grouped by provider) */}
              <div className="px-3 pb-2">
                <div className="flex items-center justify-between mb-1.5 px-1">
                  <p className="text-[9px] uppercase tracking-wider text-foreground/40 font-semibold">
                    Model {globalModels.length > 0 && (
                      <span className="text-foreground/30 normal-case">
                        · {globalModels.reduce((a, g) => a + g.model_count, 0)} verfügbar
                      </span>
                    )}
                  </p>
                  <button
                    onClick={() => loadGlobalModels()}
                    title="Modelle aktualisieren"
                    className="p-0.5 rounded text-foreground/40 hover:text-foreground hover:bg-foreground/5"
                    disabled={globalModelsLoading}
                  >
                    <ArrowsClockwise size={11} className={globalModelsLoading ? 'animate-spin' : ''} />
                  </button>
                </div>
                <select
                  value={`${selectedProvider}::${selectedModel}`}
                  onChange={e => {
                    const [p, m] = e.target.value.split('::')
                    setSelectedProvider(p)
                    setSelectedModel(m)
                  }}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-foreground/5 border border-foreground/10 text-[11px] text-foreground focus:outline-none focus:border-accent/50"
                  disabled={globalModels.length === 0 && availableModels.length === 0}
                >
                  {globalModels.length === 0 && availableModels.length === 0 ? (
                    <option value="">— Keine Modelle konfiguriert —</option>
                  ) : globalModels.length === 0 ? (
                    // Active provider returned models but registry is empty
                    availableModels.map(m => (
                      <option key={m.id} value={`${selectedProvider}::${m.id}`}>{m.name}</option>
                    ))
                  ) : (
                    globalModels.map(group => (
                      <optgroup
                        key={group.provider_id}
                        label={`${group.provider_type.toUpperCase()}${group.is_live ? ' (live)' : ''} — ${group.purpose}`}
                      >
                        {group.models.length === 0 ? (
                          <option disabled value="">— keine Modelle —</option>
                        ) : group.models.map(m => (
                          <option key={`${group.provider_id}-${m.id}`} value={`${group.provider_type}::${m.id}`}>
                            {m.name}
                          </option>
                        ))}
                      </optgroup>
                    ))
                  )}
                </select>
                {globalModels.length === 0 && availableModels.length === 0 && (
                  <p className="text-[10px] text-foreground/40 mt-1.5 px-1">
                    Konfiguriere einen AI-Provider im Control Center, damit Modelle hier erscheinen.
                  </p>
                )}
              </div>

              {/* GitHub Token Config */}
              <div className="px-3 pb-2">
                <p className="text-[9px] uppercase tracking-wider text-foreground/40 font-semibold mb-1.5 px-1">GitHub</p>
                <GitHubTokenConfig token={token} onUpdate={loadWorkspaces} />
              </div>

              {/* Workspace List */}
              <div className="flex-1 overflow-hidden flex flex-col px-3">
                <div className="flex items-center justify-between mb-1.5 px-1">
                  <p className="text-[9px] uppercase tracking-wider text-foreground/40 font-semibold">
                    Workspaces ({workspaces.length})
                  </p>
                  <button onClick={() => setShowCreateWs(true)}
                    className="p-1 rounded text-foreground/40 hover:text-foreground hover:bg-foreground/5">
                    <Plus size={12} />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto space-y-0.5">
                  {workspaces.map(ws => (
                    <button key={ws.id}
                      onClick={() => selectWorkspace(ws.id)}
                      className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs transition-all text-left group ${
                        selectedWorkspace === ws.id
                          ? 'bg-white/10 text-foreground border border-white/10'
                          : 'text-foreground/60 hover:text-foreground hover:bg-foreground/5 border border-transparent'
                      }`}>
                      <FolderOpen size={13} weight={selectedWorkspace === ws.id ? 'fill' : 'regular'} />
                      <div className="flex-1 min-w-0">
                        <p className="truncate font-medium">{ws.name}</p>
                        <div className="flex items-center gap-2 text-[9px] text-foreground/40">
                          <span>{ws.file_count} Dateien</span>
                          {ws.git_branch && <span>· {ws.git_branch}</span>}
                        </div>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); deleteWorkspace(ws.id) }}
                        className="p-1 rounded text-foreground/30 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Trash size={10} />
                      </button>
                    </button>
                  ))}
                  {workspaces.length === 0 && (
                    <div className="text-center py-6">
                      <FolderOpen size={24} weight="duotone" className="mx-auto text-foreground/20 mb-2" />
                      <p className="text-[11px] text-foreground/40">Keine Workspaces</p>
                      <button onClick={() => setShowCreateWs(true)}
                        className="mt-2 px-3 py-1 rounded-lg bg-white/5 text-[10px] text-foreground/60 hover:text-foreground hover:bg-white/10">
                        + Erstellen
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Task Stats */}
              {(runningCount > 0 || tasks.filter(t => t.status === 'queued').length > 0) && (
                <div className="px-3 py-2 border-t border-foreground/10">
                  <div className="flex items-center gap-2 text-xs">
                    <div className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
                    <span className="text-purple-300">{runningCount} aktiv</span>
                    {tasks.filter(t => t.status === 'queued').length > 0 && (
                      <span className="text-foreground/40">· {tasks.filter(t => t.status === 'queued').length} wartend</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Sidebar Toggle Button (collapsed) ──────────────────────────── */}
      {!sidebarOpen && (
        <button onClick={() => setSidebarOpen(true)}
          className="shrink-0 mt-2 p-2 rounded-xl glass-card border border-white/10 bg-white/10 text-foreground/40 hover:text-foreground">
          <Sidebar size={16} />
        </button>
      )}

      {/* ─── Main Content ───────────────────────────────────────────────── */}
      <div className="flex-1 glass-card rounded-2xl border border-white/10 bg-white/10 shadow-xl shadow-black/5 backdrop-blur-xl flex flex-col overflow-hidden">
        {activeView === 'chat' ? (
          <>
            {/* Chat Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-foreground/10 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                  <Brain size={16} weight="fill" className="text-white" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Agent Chat</h2>
                  <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      chatState === 'thinking' ? 'bg-purple-400 animate-pulse' :
                      chatState === 'error' ? 'bg-red-400' : 'bg-green-400'
                    }`} />
                    <span className="text-[10px] text-foreground/40">
                      {activeProvider?.name || 'OpenAI'} · {selectedModel}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Tip content={ttsEnabled ? 'Sprachausgabe deaktivieren' : 'Sprachausgabe aktivieren'}>
                  <button onClick={() => setTtsEnabled(!ttsEnabled)}
                    className={`p-2 rounded-lg text-xs ${ttsEnabled ? 'text-accent bg-accent/10' : 'text-foreground/40 hover:text-foreground'}`}>
                    {ttsEnabled ? <SpeakerHigh size={14} /> : <SpeakerSlash size={14} />}
                  </button>
                </Tip>
              </div>
            </div>

            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center py-16">
                  <motion.div
                    animate={{ scale: [1, 1.05, 1] }}
                    transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                    className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center mb-5 border border-purple-500/20"
                  >
                    <Sparkle size={28} weight="fill" className="text-purple-400" />
                  </motion.div>
                  <h3 className="text-base font-semibold text-foreground mb-1">Wie kann ich helfen?</h3>
                  <p className="text-xs text-foreground/40 max-w-md mb-5">
                    Stelle eine Frage, bitte um Code-Erklärungen oder starte einen Agent-Task für automatisierte Code-Bearbeitung.
                  </p>
                  <div className="grid grid-cols-2 gap-2 max-w-sm">
                    {[
                      { icon: Code, text: 'Erkläre diesen Code', prompt: 'Erkläre den folgenden Code und schlage Verbesserungen vor:' },
                      { icon: MagnifyingGlass, text: 'Finde Bugs', prompt: 'Analysiere den Code auf potenzielle Bugs und Sicherheitslücken:' },
                      { icon: PencilSimple, text: 'Refactoriere', prompt: 'Refactoriere den folgenden Code für bessere Lesbarkeit und Performance:' },
                      { icon: FileCode, text: 'Schreibe Tests', prompt: 'Schreibe Unit-Tests für den folgenden Code:' },
                    ].map((suggestion, i) => (
                      <button key={i}
                        onClick={() => sendMessage(suggestion.prompt)}
                        className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-foreground/[0.03] border border-foreground/10 text-xs text-foreground/60 hover:text-foreground hover:border-foreground/20 hover:bg-foreground/[0.06] transition-all text-left">
                        <suggestion.icon size={14} className="text-purple-400 shrink-0" />
                        <span className="truncate">{suggestion.text}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {messages.map(msg => (
                    <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[75%] rounded-2xl px-4 py-3 ${
                        msg.role === 'user'
                          ? 'bg-gradient-to-br from-purple-500/20 to-pink-500/20 border border-purple-500/20'
                          : 'bg-foreground/[0.04] border border-foreground/10'
                      }`}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-semibold text-foreground/60">
                            {msg.role === 'user' ? 'Du' : 'rumahl Agent'}
                          </span>
                          <span className="text-[9px] text-foreground/30">
                            {formatRelativeTime(msg.timestamp)}
                          </span>
                        </div>
                        <div className="text-sm text-foreground/85 leading-relaxed">
                          <MessageContent content={msg.content} role={msg.role} />
                        </div>
                      </div>
                    </div>
                  ))}
                  {chatState === 'thinking' && (
                    <div className="flex justify-start">
                      <div className="bg-foreground/[0.04] border border-foreground/10 rounded-2xl px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                          <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                          <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                        </div>
                      </div>
                    </div>
                  )}
                  {chatError && (
                    <div className="flex justify-center">
                      <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-2 text-xs text-red-300 flex items-center gap-2">
                        <Warning size={12} /> {chatError}
                        <button onClick={() => { setChatState('idle'); setChatError(null) }}
                          className="px-2 py-0.5 rounded bg-red-500/20 hover:bg-red-500/30 text-[10px]">
                          Neu versuchen
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Chat Input */}
            <div className="px-5 py-4 border-t border-foreground/10 bg-background/50 shrink-0">
              <div className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      sendMessage()
                    }
                  }}
                  placeholder="Frage etwas oder beschreibe eine Aufgabe…"
                  className="flex-1 px-4 py-3 rounded-2xl bg-foreground/5 border border-foreground/10 text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-purple-500/50 focus:bg-foreground/[0.08] transition-all"
                  disabled={chatState === 'thinking'}
                />
                <button
                  onClick={() => sendMessage()}
                  disabled={!input.trim() || chatState === 'thinking'}
                  className="h-11 w-11 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 text-white flex items-center justify-center shrink-0 disabled:opacity-40 disabled:cursor-not-allowed hover:shadow-lg hover:shadow-purple-500/25 transition-all active:scale-95">
                  <PaperPlaneRight size={18} weight="fill" />
                </button>
              </div>
              <p className="text-[9px] text-foreground/30 mt-2 text-center">
                rumahl Agent kann Fehler machen. Überprüfe wichtige Informationen.
              </p>
            </div>
          </>
        ) : (
          <>
            {/* Workspace View */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-foreground/10 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                {selectedWs ? (
                  <>
                    <FolderOpen size={16} weight="fill" className="text-accent shrink-0" />
                    <div className="min-w-0">
                      <h2 className="text-sm font-semibold text-foreground truncate">{selectedWs.name}</h2>
                      <div className="flex items-center gap-2 text-[10px] text-foreground/40">
                        {selectedWs.git_remote ? (
                          <span className="flex items-center gap-1">
                            <GithubLogo size={10} />
                            <span className="truncate">{selectedWs.git_remote}</span>
                          </span>
                        ) : (
                          <span>Lokales Workspace</span>
                        )}
                        {selectedWs.git_branch && (
                          <span className="flex items-center gap-1">
                            <GitBranch size={10} /> {selectedWs.git_branch}
                          </span>
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <FolderOpen size={16} weight="fill" className="text-foreground/30" />
                    <span className="text-sm text-foreground/50">Kein Workspace ausgewählt</span>
                  </>
                )}
              </div>
              {selectedWorkspace && (
                <div className="flex items-center gap-1.5">
                  {gitChanges.length > 0 && (
                    <>
                      <button onClick={() => gitCommit('rumahl Agent: Änderungen')}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold bg-green-500/10 text-green-300 hover:bg-green-500/20 transition-colors">
                        <GitCommit size={11} /> {gitChanges.length} Änderungen committen
                      </button>
                      <button onClick={gitPush}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold bg-blue-500/10 text-blue-300 hover:bg-blue-500/20 transition-colors">
                        <ArrowUp size={11} /> Push
                      </button>
                      <button onClick={createPR}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold bg-purple-500/10 text-purple-300 hover:bg-purple-500/20 transition-colors">
                        <GitPullRequest size={11} /> PR
                      </button>
                    </>
                  )}
                  <button onClick={() => setShowNewTask(true)}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-purple-300 hover:from-purple-500/30 hover:to-pink-500/30 border border-purple-500/20 transition-all">
                    <Plus size={12} /> Neuer Task
                  </button>
                </div>
              )}
            </div>

            {/* Workspace Content */}
            <div className="flex-1 overflow-hidden flex">
              {/* File Explorer */}
              {selectedWorkspace && (
                <div className="w-56 shrink-0 border-r border-foreground/10 overflow-y-auto p-3">
                  <p className="text-[9px] uppercase tracking-wider text-foreground/40 font-semibold mb-2">
                    Dateien ({workspaceFiles.length})
                  </p>
                  <div className="space-y-0.5">
                    {workspaceFiles.filter(f => !f.is_dir).map(f => (
                      <button key={f.path}
                        onClick={() => {
                          setSelectedFilePath(f.path)
                          fetch(`${assistBase()}/api/assist/workspaces/${selectedWorkspace}/files/${f.path}`, {
                            headers: { Authorization: `Bearer ${token}` }
                          })
                            .then(r => r.ok ? r.json() : null)
                            .then(d => setFileContent(d?.content || '// Kein Inhalt'))
                            .catch(() => setFileContent('// Fehler beim Laden'))
                        }}
                        className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[10px] transition-all ${
                          selectedFilePath === f.path
                            ? 'bg-white/10 text-foreground'
                            : 'text-foreground/50 hover:text-foreground hover:bg-foreground/5'
                        }`}>
                        <FileCode size={11} className="shrink-0" />
                        <span className="truncate">{f.name}</span>
                      </button>
                    ))}
                    {workspaceFiles.length === 0 && (
                      <p className="text-[10px] text-foreground/30 text-center py-4">Keine Dateien</p>
                    )}
                  </div>
                </div>
              )}

              {/* Main Content Area */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {!selectedWorkspace ? (
                  <div className="flex flex-col items-center justify-center h-full text-center py-16">
                    <FolderOpen size={48} weight="duotone" className="text-foreground/15 mb-4" />
                    <h3 className="text-sm font-semibold text-foreground mb-1">Kein Workspace ausgewählt</h3>
                    <p className="text-xs text-foreground/50 max-w-sm mb-4">
                      Wähle ein Workspace aus der Seitenleiste oder erstelle ein neues, um Agent Tasks zu starten.
                    </p>
                    <button onClick={() => setShowCreateWs(true)}
                      className="px-4 py-2 rounded-xl bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-purple-300 text-xs font-semibold hover:from-purple-500/30 hover:to-pink-500/30 border border-purple-500/20 transition-all">
                      <Plus size={12} className="inline mr-1" /> Workspace erstellen
                    </button>
                  </div>
                ) : fileContent && selectedFilePath ? (
                  /* File Content Viewer */
                  <div className="rounded-xl bg-black/30 border border-foreground/10 overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 bg-foreground/5 border-b border-foreground/10">
                      <div className="flex items-center gap-2">
                        <FileCode size={12} className="text-foreground/40" />
                        <span className="text-[11px] font-mono text-foreground/50">{selectedFilePath}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => navigator.clipboard.writeText(fileContent)}
                          className="p-1 rounded text-foreground/30 hover:text-foreground">
                          <Copy size={11} />
                        </button>
                        <button onClick={() => { setFileContent(null); setSelectedFilePath(null) }}
                          className="p-1 rounded text-foreground/30 hover:text-foreground">
                          <X size={11} />
                        </button>
                      </div>
                    </div>
                    <pre className="p-4 text-[11px] font-mono text-foreground/70 max-h-[calc(100vh-350px)] overflow-y-auto whitespace-pre-wrap break-all">
                      {fileContent}
                    </pre>
                  </div>
                ) : workspaceTasks.length > 0 ? (
                  /* Task List */
                  <div className="space-y-3">
                    {workspaceTasks.map(task => (
                      <div key={task.id} className="rounded-xl bg-foreground/[0.03] border border-foreground/10 overflow-hidden">
                        {/* Task Header */}
                        <div className="flex items-center gap-3 px-4 py-3">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                            task.status === 'running' ? 'bg-purple-500/15 animate-pulse' :
                            task.status === 'completed' ? 'bg-green-500/15' :
                            task.status === 'failed' ? 'bg-red-500/15' :
                            task.status === 'cancelled' ? 'bg-foreground/10' : 'bg-amber-500/15'
                          }`}>
                            {task.status === 'running' ? <Play size={14} weight="fill" className="text-purple-400" /> :
                             task.status === 'completed' ? <Check size={14} weight="bold" className="text-green-400" /> :
                             task.status === 'failed' ? <X size={14} weight="bold" className="text-red-400" /> :
                             task.status === 'cancelled' ? <Stop size={14} className="text-foreground/40" /> :
                             <Clock size={14} className="text-amber-400" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-xs font-semibold text-foreground truncate">{task.name}</p>
                              <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                                task.status === 'running' ? 'bg-purple-500/15 text-purple-300' :
                                task.status === 'completed' ? 'bg-green-500/15 text-green-300' :
                                task.status === 'failed' ? 'bg-red-500/15 text-red-300' :
                                'bg-foreground/10 text-foreground/40'
                              }`}>{task.status}</span>
                            </div>
                            <p className="text-[10px] text-foreground/40">{task.provider} / {task.model}</p>
                          </div>
                          {(task.status === 'running' || task.status === 'queued') && (
                            <button onClick={() => cancelTask(task.id)}
                              className="p-1.5 rounded-lg text-foreground/40 hover:text-red-400 hover:bg-red-500/10">
                              <Stop size={13} />
                            </button>
                          )}
                        </div>

                        {/* Progress */}
                        {task.status === 'running' && (
                          <div className="h-0.5 bg-foreground/5">
                            <div className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-500"
                              style={{ width: `${Math.max(5, task.progress * 100)}%` }} />
                          </div>
                        )}

                        {/* Output */}
                        {task.output.length > 0 && (
                          <div className="px-4 py-2 space-y-0.5 bg-black/20 font-mono text-[10px] max-h-44 overflow-y-auto">
                            {task.output.map((line, i) => (
                              <div key={i} className="flex gap-2">
                                <span className="text-foreground/20 shrink-0 w-14 text-right">
                                  {new Date(line.timestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                </span>
                                <span className={`${
                                  line.level === 'error' ? 'text-red-300' :
                                  line.level === 'warn' ? 'text-amber-300' :
                                  line.level === 'success' ? 'text-green-300' :
                                  line.level === 'system' ? 'text-purple-300' : 'text-foreground/60'
                                } break-words whitespace-pre-wrap`}>{line.message}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Changes */}
                        {task.changes.length > 0 && (
                          <div className="border-t border-foreground/10 px-4 py-3">
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <div className="h-6 w-6 rounded-lg bg-blue-500/10 text-blue-300 flex items-center justify-center">
                                  <GitCommit size={12} />
                                </div>
                                <div>
                                  <p className="text-[11px] font-semibold text-foreground/70">Changes</p>
                                  <p className="text-[9px] text-foreground/35">{task.changes.length} Datei(en) aktualisiert</p>
                                </div>
                              </div>
                              <span className="rounded-full border border-foreground/10 bg-foreground/[0.035] px-2 py-1 text-[9px] font-medium text-foreground/45">
                                Review bereit
                              </span>
                            </div>
                            <div className="space-y-2">{task.changes.map(c => renderDiff(c))}</div>
                          </div>
                        )}

                        {/* Error */}
                        {task.error && (
                          <div className="px-4 py-2 bg-red-500/5 border-t border-red-500/10 text-[10px] text-red-300">
                            {task.error}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  /* Empty Workspace */
                  <div className="flex flex-col items-center justify-center h-full text-center py-16">
                    <Robot size={40} weight="duotone" className="text-foreground/15 mb-4" />
                    <h3 className="text-sm font-semibold text-foreground mb-1">Bereit für Aufgaben</h3>
                    <p className="text-xs text-foreground/50 max-w-sm mb-4">
                      Starte einen Agent Task, um Code zu schreiben, zu refaktorieren oder zu analysieren.
                    </p>
                    <button onClick={() => setShowNewTask(true)}
                      className="px-4 py-2 rounded-xl bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-purple-300 text-xs font-semibold hover:from-purple-500/30 hover:to-pink-500/30 border border-purple-500/20 transition-all">
                      <Plus size={12} className="inline mr-1" /> Task starten
                    </button>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ─── Create Workspace Dialog ────────────────────────────────────── */}
      <AnimatePresence>
        {showCreateWs && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center"
            onClick={() => setShowCreateWs(false)}>
            <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10 }}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-md glass-card rounded-2xl border border-white/10 bg-card/95 p-6 space-y-4 backdrop-blur-2xl">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                  <FolderOpen size={16} weight="fill" className="text-white" />
                </div>
                <h3 className="text-sm font-semibold text-foreground">Neues Workspace</h3>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-foreground/40 block mb-1">Name</label>
                  <input value={newWsName} onChange={e => setNewWsName(e.target.value)}
                    placeholder="Mein Projekt"
                    className="w-full px-3 py-2.5 rounded-xl bg-foreground/5 border border-foreground/10 text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-accent"
                    onKeyDown={e => { if (e.key === 'Enter') createWorkspace() }}
                    autoFocus
                  />
                </div>

                <div>
                  <label className="text-[10px] uppercase tracking-wider text-foreground/40 block mb-1">Quelle</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => setNewWsSource('new')}
                      className={`px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                        newWsSource === 'new'
                          ? 'bg-white/10 text-foreground border border-white/10'
                          : 'bg-foreground/5 text-foreground/50 border border-transparent hover:border-foreground/10'
                      }`}>
                      ✨ Neu (leer)
                    </button>
                    <button onClick={() => setNewWsSource('clone')}
                      className={`flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                        newWsSource === 'clone'
                          ? 'bg-white/10 text-foreground border border-white/10'
                          : 'bg-foreground/5 text-foreground/50 border border-transparent hover:border-foreground/10'
                      }`}>
                      <GithubLogo size={14} /> Git Clone
                    </button>
                  </div>
                </div>

                {newWsSource === 'clone' && (
                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-foreground/40 block mb-1">Git URL</label>
                    <input value={newWsGitUrl} onChange={e => setNewWsGitUrl(e.target.value)}
                      placeholder="https://github.com/user/repo.git"
                      className="w-full px-3 py-2.5 rounded-xl bg-foreground/5 border border-foreground/10 text-sm text-foreground placeholder:text-foreground/30 font-mono focus:outline-none focus:border-accent"
                    />
                  </div>
                )}
              </div>

              <div className="flex gap-2 pt-2">
                <button onClick={() => setShowCreateWs(false)}
                  className="flex-1 py-2.5 rounded-xl text-xs font-semibold bg-foreground/5 text-foreground/60 hover:bg-foreground/10 transition-colors">
                  Abbrechen
                </button>
                <button onClick={createWorkspace} disabled={!newWsName.trim()}
                  className="flex-1 py-2.5 rounded-xl text-xs font-semibold bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-purple-300 hover:from-purple-500/30 hover:to-pink-500/30 border border-purple-500/20 disabled:opacity-40 transition-all">
                  Workspace erstellen
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── New Task Dialog ────────────────────────────────────────────── */}
      <AnimatePresence>
        {showNewTask && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center"
            onClick={() => setShowNewTask(false)}>
            <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10 }}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-lg glass-card rounded-2xl border border-white/10 bg-card/95 p-6 space-y-4 backdrop-blur-2xl">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                  <Robot size={16} weight="fill" className="text-white" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Neuen Agent Task starten</h3>
                  <p className="text-[10px] text-foreground/40">
                    {selectedWs?.name || 'Kein Workspace'} · {selectedProvider} / {selectedModel}
                  </p>
                </div>
              </div>

              <div>
                <label className="text-[10px] uppercase tracking-wider text-foreground/40 block mb-1">
                  Was soll der Agent tun?
                </label>
                <textarea
                  value={newTaskDesc}
                  onChange={e => setNewTaskDesc(e.target.value)}
                  rows={4}
                  placeholder="Beschreibe die Aufgabe im Detail, z.B.:&#10;&#10;Füge eine Dark-Mode-Unterstützung zum Dashboard hinzu. Erstelle die CSS-Variablen, eine Theme-Toggle-Komponente und aktualisiere alle bestehenden Komponenten."
                  className="w-full px-3 py-2.5 rounded-xl bg-foreground/5 border border-foreground/10 text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-accent resize-none"
                  autoFocus
                />
              </div>

              <div className="flex gap-2 pt-1">
                <button onClick={() => setShowNewTask(false)}
                  className="flex-1 py-2.5 rounded-xl text-xs font-semibold bg-foreground/5 text-foreground/60 hover:bg-foreground/10 transition-colors">
                  Abbrechen
                </button>
                <button onClick={createTask} disabled={!newTaskDesc.trim()}
                  className="flex-1 py-2.5 rounded-xl text-xs font-semibold bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:shadow-lg hover:shadow-purple-500/25 disabled:opacity-40 transition-all">
                  🚀 Task starten
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
