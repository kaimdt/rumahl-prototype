import { useTranslation } from 'react-i18next'
import i18n from '@/i18n'
import { useLocalStorage } from '@/lib/storage'
import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Microphone, X, PaperPlaneRight, Sparkle, Globe, ImageSquare, SpeakerHigh, SpeakerSlash, BellRinging, Chat, Check, Warning, MagnifyingGlass, Robot, Code, Wrench, Bug, Books, House, Cpu, Gear, ArrowSquareOut, Camera, Plugs, Spinner } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { MessageContent } from '@/components/MessageContent'
import { ActiveTasksPanel } from '@/components/ActiveTasksPanel'

interface AIChatMessage {
  role: string
  content: string
  timestamp: string
  // If present, an instant task is resolving in background for this message
  instantTaskId?: string
  instantTaskType?: string
  instantTaskStatus?: 'pending' | 'completed' | 'failed' | 'deferred'
  instantTaskResult?: string
}

interface AIChatResponse {
  message: string
  provider: string
  message_id: string
  task_action?: {
    action: string
    task_id?: string
    resume_at?: string
    question?: string
    requires_confirmation: boolean
  } | null
  instant_task_id?: string | null
  instant_task_type?: string | null
}

// A pending action waiting for the user to confirm or decline
interface PendingTaskAction {
  action: string
  task_id: string
  resume_at?: string
  question: string
}

type ORAState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error'
type DialogTab = 'chat' | 'tasks' | 'extensions'

import { getAssistUrl, getBackendUrl } from '@/lib/config'

const assistBase = () => getAssistUrl() || getBackendUrl() || ''

// ─── Agent presets ──────────────────────────────────────────────────────────
//
// Each agent is a saved system-prompt persona. The selected agent's
// `systemPrompt` is merged with the user's free-form `aiInstructions` and
// sent as the `instructions` field of every /api/assist/chat call.
type AgentId = 'general' | 'code' | 'devops' | 'debug' | 'research' | 'home'

interface AgentPreset {
  id: AgentId
  icon: React.ComponentType<{ size?: number; weight?: 'regular' | 'fill' | 'duotone' | 'bold' }>
  color: string
  systemPrompt: string
}

const AGENT_PRESETS: AgentPreset[] = [
  { id: 'general',  icon: Sparkle, color: 'from-purple-500/30 to-pink-500/30',  systemPrompt: 'You are ORA, the IORA smart-home assistant. Be concise, friendly and accurate.' },
  { id: 'code',     icon: Code,    color: 'from-blue-500/30 to-cyan-500/30',    systemPrompt: 'You are a senior software engineer. Write, refactor and review code with precision. Prefer minimal diffs and clear explanations.' },
  { id: 'devops',   icon: Wrench,  color: 'from-amber-500/30 to-orange-500/30', systemPrompt: 'You are a DevOps specialist. Help with Docker, CI/CD, Kubernetes, deployments, monitoring and reliability.' },
  { id: 'debug',    icon: Bug,     color: 'from-red-500/30 to-rose-500/30',     systemPrompt: 'You are a debugging expert. Analyse stack traces, find root causes and suggest performance improvements.' },
  { id: 'research', icon: Books,   color: 'from-emerald-500/30 to-teal-500/30', systemPrompt: 'You are a research assistant. Gather information, summarise findings and cite sources where possible.' },
  { id: 'home',     icon: House,   color: 'from-violet-500/30 to-fuchsia-500/30', systemPrompt: 'You are a Smart-Home specialist for IORA. Help with devices, automations, scenes and Home-Assistant integration.' },
]

const AGENT_BY_ID = Object.fromEntries(AGENT_PRESETS.map(a => [a.id, a])) as Record<AgentId, AgentPreset>

interface AssistHealth {
  ai_available: boolean
  ai_provider?: string
  status?: string
  service?: string
  degraded_reasons?: string[]
}

interface ProviderModelInfo {
  id: string
  name?: string
  provider?: string
}

interface ProvidersResponse {
  current?: {
    name?: string
    id?: string
    available?: boolean
    models?: ProviderModelInfo[]
  }
}

// ─── Instant Task type badge labels ──────────────────────────────────────────

const INSTANT_TASK_LABELS: Record<string, string> = {
  search:  i18n.t('ai.search'),
  weather: i18n.t('ai.weather'),
  news:    i18n.t('ai.news'),
  music:   i18n.t('ai.music'),
  generic: i18n.t('ai.search'),
}

// ─── Extensions panel ───────────────────────────────────────────────────────
//
// Wraps the built-in iora-assist tools (Internet Search, Web Scrape,
// Screenshot) into a small UI so the user can invoke them directly from the
// chat dialog without going through the LLM.
type ExtensionId = 'search' | 'scrape' | 'screenshot'

interface ExtensionDef {
  id: ExtensionId
  icon: typeof MagnifyingGlass
  endpoint: string
  /** Input field placeholder i18n key */
  placeholderKey: string
}

const BUILTIN_EXTENSIONS: ExtensionDef[] = [
  { id: 'search',     icon: MagnifyingGlass, endpoint: '/api/assist/tools/search',     placeholderKey: 'ai.extQueryPlaceholder' },
  { id: 'scrape',     icon: Globe,           endpoint: '/api/assist/tools/scrape',     placeholderKey: 'ai.extUrlPlaceholder' },
  { id: 'screenshot', icon: Camera,          endpoint: '/api/assist/tools/screenshot', placeholderKey: 'ai.extUrlPlaceholder' },
]

function ExtensionsPanel() {
  const { t } = useTranslation()
  const [activeExt, setActiveExt] = useState<ExtensionId>('search')
  const [extInput, setExtInput] = useState('')
  const [extResult, setExtResult] = useState<string | null>(null)
  const [extError, setExtError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  const current = BUILTIN_EXTENSIONS.find(e => e.id === activeExt) ?? BUILTIN_EXTENSIONS[0]

  const run = useCallback(async () => {
    const value = extInput.trim()
    if (!value) return
    setRunning(true)
    setExtError(null)
    setExtResult(null)
    try {
      const body =
        current.id === 'search'
          ? { params: { query: value, limit: 5 } }
          : { params: { url: value } }
      const res = await fetch(`${assistBase()}${current.endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const text = await res.text()
      let parsed: unknown = text
      try { parsed = JSON.parse(text) } catch {}
      if (!res.ok) {
        setExtError(typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2))
      } else {
        setExtResult(typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2))
      }
    } catch (err) {
      setExtError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }, [extInput, current])

  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-center gap-1.5">
        <Plugs size={14} className="text-foreground/60" />
        <p className="text-[11px] uppercase tracking-wide text-foreground/60">{t('ai.extensions')}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {BUILTIN_EXTENSIONS.map(ext => {
          const Icon = ext.icon
          const active = ext.id === activeExt
          return (
            <button
              key={ext.id}
              onClick={() => { setActiveExt(ext.id); setExtResult(null); setExtError(null) }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-all ${
                active
                  ? 'bg-accent/15 border-accent/40 text-foreground'
                  : 'bg-foreground/5 border-foreground/10 text-foreground/70 hover:bg-foreground/10'
              }`}
            >
              <Icon size={13} />
              <span className="text-xs">{t(`ai.ext_${ext.id}`)}</span>
            </button>
          )
        })}
      </div>

      <p className="text-foreground/60 leading-snug">{t(`ai.ext_${current.id}_desc`)}</p>

      <div className="flex items-center gap-2">
        <input
          value={extInput}
          onChange={e => setExtInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !running) run() }}
          placeholder={t(current.placeholderKey)}
          className="flex-1 px-3 py-2 rounded-lg bg-foreground/5 border border-foreground/10 text-foreground placeholder:text-foreground/40 focus:outline-none focus:ring-1 focus:ring-accent/40 text-xs"
        />
        <button
          onClick={run}
          disabled={running || !extInput.trim()}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent text-accent-foreground text-xs disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent/90 transition-colors"
        >
          {running ? <Spinner size={13} className="animate-spin" /> : <PaperPlaneRight size={13} weight="bold" />}
          <span>{t('ai.extRun')}</span>
        </button>
      </div>

      {extError && (
        <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/25 text-red-200">
          <p className="font-semibold mb-1">{t('ai.extError')}</p>
          <pre className="whitespace-pre-wrap break-words text-[11px] leading-snug">{extError}</pre>
        </div>
      )}

      {extResult && (
        <div className="px-3 py-2 rounded-lg bg-foreground/5 border border-foreground/10 max-h-[60vh] overflow-y-auto">
          <p className="font-semibold mb-1 text-foreground/70">{t('ai.extResult')}</p>
          <pre className="whitespace-pre-wrap break-words text-[11px] leading-snug text-foreground/85">{extResult}</pre>
        </div>
      )}

      <div className="pt-1 text-[10px] text-foreground/40">
        {t('ai.extHint')}
      </div>
    </div>
  )
}

export function ORAAssistant() {
  const { t, i18n } = useTranslation()
  const [aiInstructions] = useLocalStorage('iora-ai-instructions', '')
  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<DialogTab>('chat')
  const [state, setState] = useState<ORAState>('idle')
  const [messages, setMessages] = useState<AIChatMessage[]>([])
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSpeechSupported, setIsSpeechSupported] = useState(false)
  // Toast shown when a task was automatically created
  const [taskCreatedToast, setTaskCreatedToast] = useState<string | null>(null)
  // Pending task action awaiting user confirmation
  const [pendingTaskAction, setPendingTaskAction] = useState<PendingTaskAction | null>(null)
  const [isTTSEnabled, setIsTTSEnabled] = useState(true)
  // Whether the last user interaction was via voice (microphone)
  const [voiceLastUsed, setVoiceLastUsed] = useState(false)
  // Label shown in the voice-task slow-path banner ("Suche läuft…")
  const [voiceTaskBanner, setVoiceTaskBanner] = useState<string | null>(null)
  // Selected agent preset (persists across sessions)
  const [agentId, setAgentId] = useLocalStorage<AgentId>('iora-ai-agent', 'general')
  // Selected model id ('' = automatic = let backend decide)
  const [modelId, setModelId] = useLocalStorage<string>('iora-ai-model', '')
  // Health + provider snapshot, refreshed every time the dialog opens
  const [assistHealth, setAssistHealth] = useState<AssistHealth | null>(null)
  const [healthLoading, setHealthLoading] = useState(false)
  const [availableModels, setAvailableModels] = useState<ProviderModelInfo[]>([])
  const currentAgent = AGENT_BY_ID[agentId] ?? AGENT_BY_ID.general

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const recognitionRef = useRef<any>(null)
  const synthRef = useRef<SpeechSynthesis | null>(null)
  // Active SSE connections keyed by instant task id
  const instantTaskSources = useRef<Map<string, EventSource>>(new Map())

  // ─── Voice instant-task multitask state (refs avoid stale-closure issues in SSE callbacks) ──
  /** How many ms to silently wait before switching to slow-path and starting conversation. */
  const FAST_PATH_MS = 4000
  /** Tracks the active voice instant task – used from SSE callbacks. */
  const voiceInstantTask = useRef<{
    taskId: string
    msgTimestamp: string
    holdingMsg: string
    taskType: string
    phase: 'fast-wait' | 'slow-talking'
  } | null>(null)
  /** The fast-path setTimeout handle. */
  const fastPathTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Sync refs so SSE callbacks always read the latest values without re-subscription
  const isTTSEnabledRef = useRef(isTTSEnabled)
  useEffect(() => { isTTSEnabledRef.current = isTTSEnabled }, [isTTSEnabled])
  const voiceLastUsedRef = useRef(voiceLastUsed)
  useEffect(() => { voiceLastUsedRef.current = voiceLastUsed }, [voiceLastUsed])

  // ─── Text-to-Speech ────────────────────────────────────────────────────────
  /**
   * Speak `text` via the browser's speech synthesis engine.
   * `onDone` is called once the utterance finishes (or errors).
   */
  const speak = useCallback((text: string, onDone?: () => void) => {
    if (!isTTSEnabledRef.current || !synthRef.current) {
      onDone?.()
      return
    }
    synthRef.current.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'de-DE'
    utterance.rate = 1.0
    utterance.pitch = 1.0
    utterance.onstart = () => setState('speaking')
    utterance.onend = () => { setState('idle'); onDone?.() }
    utterance.onerror = (e) => {
      console.error('TTS error:', e)
      setState('idle')
      onDone?.()
    }
    synthRef.current.speak(utterance)
  }, [])

  // ─── Voice conversation helpers ────────────────────────────────────────────
  /**
   * Start a new round of speech recognition for voice-mode conversation.
   * Used during the slow-path so the user can keep chatting while the instant task runs.
   * This function references `sendMessage` via a forward-declared ref to avoid circular deps.
   */
  const sendMessageRef = useRef<((text: string, opts?: { fromVoice?: boolean }) => Promise<void>) | null>(null)

  const startVoiceConversation = useCallback(() => {
    if (!recognitionRef.current || !isSpeechSupported) return
    try { recognitionRef.current.abort() } catch { /* already stopped */ }

    setState('listening')
    recognitionRef.current.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript
      setState('idle')
      sendMessageRef.current?.(transcript, { fromVoice: true })
    }
    recognitionRef.current.onerror = () => setState('idle')
    recognitionRef.current.onend = () => {
      // Auto-restart mic only while still in slow-talking phase
      if (voiceInstantTask.current?.phase === 'slow-talking') {
        setTimeout(() => {
          if (voiceInstantTask.current?.phase === 'slow-talking') {
            startVoiceConversation()
          }
        }, 600)
      } else {
        setState(s => s === 'listening' ? 'idle' : s)
      }
    }
    try { recognitionRef.current.start() } catch { /* already started */ }
  }, [isSpeechSupported])

  /**
   * Clear all voice instant-task state – called when a result arrives or on cleanup.
   */
  const clearVoiceInstantTask = useCallback(() => {
    if (fastPathTimerRef.current) {
      clearTimeout(fastPathTimerRef.current)
      fastPathTimerRef.current = null
    }
    voiceInstantTask.current = null
    setVoiceTaskBanner(null)
  }, [])

  /**
   * Activate the slow path: speak the holding sentence, then re-enable the microphone
   * so the user can continue the conversation while the task finishes.
   */
  const activateSlowPath = useCallback(() => {
    const task = voiceInstantTask.current
    if (!task) return
    task.phase = 'slow-talking'
    setVoiceTaskBanner(INSTANT_TASK_LABELS[task.taskType] ?? t('ai.search'))

    // Speak the AI's holding sentence, then start listening for conversation
    speak(task.holdingMsg, () => {
      if (voiceInstantTask.current?.phase === 'slow-talking') {
        startVoiceConversation()
      }
    })
  }, [speak, startVoiceConversation])

  // ─── Instant task SSE subscription ────────────────────────────────────────
  const subscribeToInstantTask = useCallback((taskId: string, msgTimestamp: string) => {
    if (instantTaskSources.current.has(taskId)) return

    const url = `${assistBase()}/api/assist/tasks/instant/${taskId}/stream`
    const es = new EventSource(url)

    es.addEventListener('instant_task_result', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data)
        const eventType: string = data.event_type ?? 'completed'

        // ── Progress: taking longer ──────────────────────────────────────────
        if (eventType === 'taking_longer') {
          // In voice fast-wait phase: activate slow path immediately (server confirmed it's slow)
          const viTask = voiceInstantTask.current
          if (viTask?.taskId === taskId && viTask.phase === 'fast-wait') {
            // Cancel the local 4s timer – the server already told us it's slow
            if (fastPathTimerRef.current) {
              clearTimeout(fastPathTimerRef.current)
              fastPathTimerRef.current = null
            }
            activateSlowPath()
          }
          // Keep SSE open – more events will follow
          return
        }

        // ── Progress: deferred (>1 min threshold exceeded) ──────────────────
        if (eventType === 'deferred') {
          // Update message bubble to "deferred" state
          setMessages(prev =>
            prev.map(m =>
              m.timestamp === msgTimestamp
                ? { ...m, instantTaskStatus: 'deferred', instantTaskResult: t('ai.deferredResult') }
                : m
            )
          )

          // Persist task id in sessionStorage so on next dialog open we can recover it
          try {
            sessionStorage.setItem('ora_deferred_task', JSON.stringify({ taskId, msgTimestamp, ts: Date.now() }))
          } catch { /* storage unavailable */ }

          // Voice: announce deferral context-aware
          const viTask = voiceInstantTask.current
          if (viTask?.taskId === taskId && isTTSEnabledRef.current) {
            const inConversation = viTask.phase === 'slow-talking'
            const announcement = inConversation
              ? t('ai.deferredAnnounceSlow')
              : t('ai.deferredAnnounce')
            try { recognitionRef.current?.abort() } catch { /* ok */ }
            synthRef.current?.cancel()
            speak(announcement)
          }
          clearVoiceInstantTask()
          setVoiceTaskBanner(null)

          // Close SSE – result will arrive via notification queue
          es.close()
          instantTaskSources.current.delete(taskId)
          return
        }

        // ── Final result (completed / failed) ────────────────────────────────
        const resultText: string = data.result_text ?? data.error ?? 'Keine Antwort erhalten.'
        const status: 'completed' | 'failed' = data.status === 'completed' ? 'completed' : 'failed'

        // Update the chat message bubble
        setMessages(prev =>
          prev.map(m =>
            m.timestamp === msgTimestamp
              ? { ...m, instantTaskStatus: status, instantTaskResult: resultText }
              : m
          )
        )

        // Clear deferred sessionStorage entry if we got the final result live
        try { sessionStorage.removeItem('ora_deferred_task') } catch { /* ok */ }

        // ── Voice-mode result delivery ─────────────────────────────────────
        const viTask = voiceInstantTask.current
        const wasVoiceFast = viTask?.taskId === taskId && viTask.phase === 'fast-wait'
        const wasVoiceSlow = viTask?.taskId === taskId && viTask.phase === 'slow-talking'

        if (viTask?.taskId === taskId) {
          clearVoiceInstantTask()
        } else {
          if (fastPathTimerRef.current) clearTimeout(fastPathTimerRef.current)
        }

        if (status === 'completed' && isTTSEnabledRef.current) {
          if (wasVoiceFast) {
            try { recognitionRef.current?.abort() } catch { /* ok */ }
            speak(resultText)
          } else if (wasVoiceSlow) {
            try { recognitionRef.current?.abort() } catch { /* ok */ }
            synthRef.current?.cancel()
            speak(`Ich hab's gefunden! ${resultText}`, () => {
              if (voiceLastUsedRef.current) {
                setTimeout(startVoiceConversation, 800)
              }
            })
          } else {
            speak(resultText)
          }
        }
      } catch { /* parse error – ignore */ }
      es.close()
      instantTaskSources.current.delete(taskId)
    })

    es.onerror = () => {
      setMessages(prev =>
        prev.map(m =>
          m.timestamp === msgTimestamp && m.instantTaskStatus === 'pending'
            ? { ...m, instantTaskStatus: 'failed', instantTaskResult: 'Suche fehlgeschlagen.' }
            : m
        )
      )
      const viTask = voiceInstantTask.current
      if (viTask?.taskId === taskId) clearVoiceInstantTask()
      es.close()
      instantTaskSources.current.delete(taskId)
    }

    instantTaskSources.current.set(taskId, es)
  }, [speak, startVoiceConversation, clearVoiceInstantTask, activateSlowPath])

  // Clean up SSE connections when dialog closes
  useEffect(() => {
    if (!isOpen) {
      instantTaskSources.current.forEach(es => es.close())
      instantTaskSources.current.clear()
      clearVoiceInstantTask()
      return
    }

    // Dialog just opened: check if we have a deferred task result waiting in the DB.
    const raw = (() => { try { return sessionStorage.getItem('ora_deferred_task') } catch { return null } })()
    if (!raw) return
    try {
      const saved: { taskId: string; msgTimestamp: string; ts: number } = JSON.parse(raw)
      // Only recover tasks deferred within the last 30 minutes
      if (Date.now() - saved.ts > 30 * 60 * 1000) {
        sessionStorage.removeItem('ora_deferred_task')
        return
      }
      // Poll the REST endpoint for the task result
      fetch(`${assistBase()}/api/assist/tasks/instant/${saved.taskId}`)
        .then(r => r.ok ? r.json() : null)
        .then((task: { status?: string; result_text?: string; error_message?: string } | null) => {
          if (!task) return
          if (task.status === 'completed' || task.status === 'failed') {
            sessionStorage.removeItem('ora_deferred_task')
            const resultText = task.result_text ?? task.error_message ?? t('ai.noAnswer')
            const status = task.status === 'completed' ? 'completed' : 'failed'
            // Inject as a notification-style message into the chat
            setMessages(prev => [
              ...prev,
              {
                role: 'assistant' as const,
                content: status === 'completed'
                  ? t('ai.instantResult', { text: resultText })
                  : t('ai.instantFailed'),
                timestamp: new Date().toISOString(),
              }
            ])
          }
        })
        .catch(() => { /* network error – ignore */ })
    } catch { /* bad stored value */ }
  }, [isOpen, clearVoiceInstantTask])

  // Check for Web Speech API support
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    setIsSpeechSupported(!!SpeechRecognition)

    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition()
      recognitionRef.current.continuous = false
      recognitionRef.current.interimResults = false
      recognitionRef.current.lang = 'de-DE'
    }

    if ('speechSynthesis' in window) {
      synthRef.current = window.speechSynthesis
    }
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ─── Probe iora-assist health + load models when the dialog opens ───────
  //
  // We refresh on every open (not just mount) so the banner reflects the
  // current state when the user re-opens after configuring a provider.
  const refreshAssistStatus = useCallback(async () => {
    setHealthLoading(true)
    try {
      const [hRes, pRes] = await Promise.all([
        fetch(`${assistBase()}/api/assist/health`).catch(() => null),
        fetch(`${assistBase()}/api/assist/providers`).catch(() => null),
      ])
      if (hRes && hRes.ok) {
        setAssistHealth(await hRes.json())
      } else {
        setAssistHealth({ ai_available: false, status: 'unreachable' })
      }
      if (pRes && pRes.ok) {
        const data: ProvidersResponse = await pRes.json()
        setAvailableModels(data.current?.models ?? [])
      } else {
        setAvailableModels([])
      }
    } catch {
      setAssistHealth({ ai_available: false, status: 'unreachable' })
      setAvailableModels([])
    } finally {
      setHealthLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isOpen) return
    refreshAssistStatus()
  }, [isOpen, refreshAssistStatus])

  /** Open the Admin panel to configure the AI provider. */
  const openAdminAssistTab = useCallback(() => {
    setIsOpen(false)
    try {
      window.dispatchEvent(new CustomEvent('iora:open-admin', { detail: { tab: 'assist' } }))
    } catch { /* noop */ }
  }, [])

  /** Merge the active agent's system prompt with the user's free-form instructions. */
  const buildInstructions = useCallback((): string | undefined => {
    const parts: string[] = []
    if (currentAgent?.systemPrompt) parts.push(currentAgent.systemPrompt)
    if (aiInstructions && aiInstructions.trim()) parts.push(aiInstructions.trim())
    return parts.length > 0 ? parts.join('\n\n') : undefined
  }, [currentAgent, aiInstructions])

  const sendMessage = async (text: string, opts?: { fromVoice?: boolean }) => {
    if (!text.trim()) return

    const fromVoice = opts?.fromVoice ?? false
    if (fromVoice) setVoiceLastUsed(true)

    const userMessage: AIChatMessage = {
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setState('thinking')
    setError(null)
    // Clear any pending confirmation when user sends a new message
    setPendingTaskAction(null)

    try {
      const response = await fetch(`${assistBase()}/api/assist/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          context: null,
          voice_mode: fromVoice,
          language: i18n.language,
          instructions: buildInstructions(),
          agent_id: agentId,
          model: modelId || undefined,
        }),
      })

      if (!response.ok) {
        // Try to surface the upstream proxy error (iora-home -> iora-assist)
        // Example body: { error: "...", available: false, upstream: "..." }
        let upstream: { error?: string; available?: boolean; upstream?: string } | null = null
        try { upstream = await response.json() } catch { /* not JSON */ }
        // 503 = AI provider not configured / unreachable -> show banner instead of generic message
        if (response.status === 503 || upstream?.available === false) {
          await refreshAssistStatus()
          throw new Error(t('ai.sendFailedUnavailable'))
        }
        const upstreamMsg = upstream?.error || upstream?.upstream
        throw new Error(upstreamMsg ? `${upstreamMsg}` : `HTTP ${response.status}`)
      }

      const data: AIChatResponse = await response.json()

      // Build the AI message – mark it as pending instant task if one was created
      const msgTimestamp = new Date().toISOString()
      const aiMessage: AIChatMessage = {
        role: 'assistant',
        content: data.message,
        timestamp: msgTimestamp,
        ...(data.instant_task_id
          ? {
              instantTaskId: data.instant_task_id,
              instantTaskType: data.instant_task_type ?? 'search',
              instantTaskStatus: 'pending' as const,
            }
          : {}),
      }

      const updatedMessages = [...messages, userMessage, aiMessage]
      setMessages(updatedMessages)
      setState('speaking')

      // Handle instant task response
      if (data.instant_task_id) {
        subscribeToInstantTask(data.instant_task_id, msgTimestamp)

        if (fromVoice) {
          // ── Voice fast-path: wait silently for FAST_PATH_MS before speaking holding message
          voiceInstantTask.current = {
            taskId: data.instant_task_id,
            msgTimestamp,
            holdingMsg: data.message,
            taskType: data.instant_task_type ?? 'search',
            phase: 'fast-wait',
          }
          setState('thinking') // show "thinking" while silently waiting

          fastPathTimerRef.current = setTimeout(() => {
            // Still waiting → switch to slow path
            if (voiceInstantTask.current?.taskId === data.instant_task_id) {
              activateSlowPath()
            }
          }, FAST_PATH_MS)
        } else {
          // Text mode: just leave the spinner bubble, no TTS on holding message
          setState('idle')
        }
      } else if (isTTSEnabled) {
        speak(data.message)
      } else {
        setTimeout(() => setState('idle'), 2000)
      }

      // Handle structured task action from AI response
      if (data.task_action) {
        const ta = data.task_action
        if (ta.requires_confirmation && ta.task_id && ta.question) {
          setPendingTaskAction({
            action: ta.action,
            task_id: ta.task_id,
            resume_at: ta.resume_at,
            question: ta.question,
          })
        } else if (!ta.requires_confirmation && ta.task_id) {
          const toastKey = ta.action === 'pause_until' ? 'ai.taskPaused'
            : ta.action === 'delete' ? 'ai.taskDeleted'
            : 'ai.taskUpdated'
          setTaskCreatedToast(t(toastKey))
          setTimeout(() => setTaskCreatedToast(null), 4000)
        }
      } else if (!data.instant_task_id) {
        // Fall back to multi-message task detection for new task creation
        const payload = updatedMessages.slice(-8).map(m => ({ role: m.role, content: m.content }))
        fetch(`${assistBase()}/api/assist/tasks/detect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: payload, input_mode: 'conversation' }),
        })
          .then(r => r.ok ? r.json() : null)
          .then(d => {
            if (d?.success && d?.task_id) {
              setTaskCreatedToast(t('ai.taskCreatedConfirm'))
              setTimeout(() => setTaskCreatedToast(null), 4000)
            }
          })
          .catch(() => { /* silent */ })
      }
    } catch (e) {
      console.error('Failed to send message:', e)
      setError(e instanceof Error ? e.message : t('ai.sendFailed'))
      setState('error')
      setTimeout(() => {
        setState('idle')
        setError(null)
      }, 3000)
    }
  }

  // Keep the sendMessageRef in sync so startVoiceConversation can call it
  useEffect(() => { sendMessageRef.current = sendMessage })

  const handleTaskConfirmation = async (confirmed: boolean) => {
    if (!pendingTaskAction) return
    const { action, task_id, resume_at } = pendingTaskAction
    setPendingTaskAction(null)

    try {
      const res = await fetch(`${assistBase()}/api/assist/tasks/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed, action, task_id, resume_at }),
      })
      if (res.ok && confirmed) {
        const toastKey = action === 'pause_until' ? 'ai.taskPaused'
          : action === 'delete' ? 'ai.taskDeleted'
          : 'ai.taskUpdated'
        setTaskCreatedToast(t(toastKey))
        setTimeout(() => setTaskCreatedToast(null), 4000)
      }
    } catch (e) {
      console.error('Confirmation failed:', e)
    }
  }

  const handleVoiceInput = () => {
    if (!recognitionRef.current || !isSpeechSupported) {
      setError(t('ai.speechNotSupported'))
      setState('error')
      setTimeout(() => {
        setState('idle')
        setError(null)
      }, 3000)
      return
    }

    setVoiceLastUsed(true)
    setState('listening')

    recognitionRef.current.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript
      setState('idle')
      // Dispatch immediately with fromVoice=true so the TTS/instant-task flow activates
      sendMessage(transcript, { fromVoice: true })
    }

    recognitionRef.current.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error)
      setError(`Sprachfehler: ${event.error}`)
      setState('error')
      setTimeout(() => {
        setState('idle')
        setError(null)
      }, 3000)
    }

    recognitionRef.current.onend = () => {
      if (state === 'listening') {
        setState('idle')
      }
    }

    try {
      recognitionRef.current.start()
    } catch (e) {
      console.error('Failed to start recognition:', e)
      setError('Konnte Spracherkennung nicht starten')
      setState('error')
      setTimeout(() => {
        setState('idle')
        setError(null)
      }, 3000)
    }
  }

  const handleSearchInternet = async (query: string) => {
    try {
      setState('thinking')
      const response = await fetch(`${assistBase()}/api/assist/tools/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, max_results: 5 }),
      })

      if (response.ok) {
        const results = await response.json()
        console.log('Search results:', results)
      }
      setState('idle')
    } catch (e) {
      console.error('Search failed:', e)
      setError(e instanceof Error ? e.message : 'Suche fehlgeschlagen')
      setState('error')
      setTimeout(() => {
        setState('idle')
        setError(null)
      }, 3000)
    }
  }

  const getStateColor = () => {
    switch (state) {
      case 'listening': return 'from-blue-500/40 to-cyan-500/40'
      case 'thinking': return 'from-purple-500/40 to-pink-500/40'
      case 'speaking': return 'from-green-500/40 to-emerald-500/40'
      case 'error': return 'from-red-500/40 to-orange-500/40'
      default: return 'from-gray-500/30 to-gray-600/30'
    }
  }

  const getStateIcon = () => {
    switch (state) {
      case 'listening': return <Microphone size={20} weight="fill" className="animate-pulse" />
      case 'thinking': return <Sparkle size={20} weight="fill" className="animate-spin" />
      case 'speaking': return <Sparkle size={20} weight="fill" className="animate-pulse" />
      default: return <Sparkle size={20} weight="duotone" />
    }
  }

  return (
    <>
      {/* Floating Action Button */}
      <motion.button
        onClick={() => setIsOpen(true)}
        className={`fixed bottom-6 right-6 z-50 w-16 h-16 rounded-full shadow-2xl flex items-center justify-center transition-all ${
          state !== 'idle' ? 'scale-110' : ''
        }`}
        style={{
          background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.9), rgba(236, 72, 153, 0.9))',
          backdropFilter: 'blur(10px)',
        }}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        animate={{
          boxShadow: state !== 'idle'
            ? '0 0 40px rgba(139, 92, 246, 0.6)'
            : '0 10px 30px rgba(0, 0, 0, 0.3)',
        }}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={state}
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            exit={{ scale: 0, rotate: 180 }}
            transition={{ duration: 0.3 }}
            className="text-white"
          >
            {getStateIcon()}
          </motion.div>
        </AnimatePresence>
      </motion.button>

      {/* Chat Dialog */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-[550px] h-[700px] p-0 gap-0 flex flex-col bg-card/95 backdrop-blur-2xl border-foreground/10 overflow-hidden">
          <VisuallyHidden><DialogTitle>ORA AI Assistant</DialogTitle></VisuallyHidden>
          {/* Header */}
          <div
            className="relative px-6 py-4 border-b border-foreground/10"
            style={{
              background: `linear-gradient(135deg, ${getStateColor().replace('/40', '/20')})`,
            }}
          >
            <motion.div
              className={`absolute inset-0 bg-gradient-to-br ${getStateColor()} opacity-50 pointer-events-none`}
              animate={{
                scale: state === 'thinking' ? [1, 1.2, 1] : 1,
                rotate: state === 'thinking' ? [0, 360] : 0,
              }}
              transition={{
                duration: 3,
                repeat: state === 'thinking' ? Infinity : 0,
                ease: 'linear',
              }}
            />
            <div className="relative flex items-center justify-between">
              <div className="flex items-center gap-3">
                <motion.div
                  animate={{
                    scale: state !== 'idle' ? [1, 1.2, 1] : 1,
                  }}
                  transition={{
                    duration: 1.5,
                    repeat: state !== 'idle' ? Infinity : 0,
                    ease: 'easeInOut',
                  }}
                  className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500/30 to-pink-500/30 flex items-center justify-center"
                >
                  {getStateIcon()}
                </motion.div>
                <div>
                  <h2 className="text-sm font-semibold text-foreground">ORA AI</h2>
                  <p className="text-xs text-foreground/50">
                    {state === 'listening' && (voiceTaskBanner ? t('ai.statusListeningSearching') : t('ai.listening'))}
                    {state === 'thinking' && (voiceTaskBanner ? t('ai.statusSearchingFor', { topic: voiceTaskBanner }) : t('ai.thinking'))}
                    {state === 'speaking' && t('ai.statusResponding')}
                    {state === 'error' && t('ai.statusError')}
                    {state === 'idle' && (voiceTaskBanner ? t('ai.statusSearchingFor', { topic: voiceTaskBanner }) : t('ai.statusReady'))}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Tab switcher */}
                <div className="flex items-center rounded-full bg-foreground/10 p-0.5">
                  <button
                    onClick={() => setActiveTab('chat')}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs transition-all ${
                      activeTab === 'chat'
                        ? 'bg-accent text-accent-foreground'
                        : 'text-foreground/60 hover:text-foreground'
                    }`}
                    title={t('ai.chat')}
                  >
                    <Chat size={12} />
                    <span>{t('ai.chat')}</span>
                  </button>
                  <button
                    onClick={() => setActiveTab('tasks')}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs transition-all ${
                      activeTab === 'tasks'
                        ? 'bg-accent text-accent-foreground'
                        : 'text-foreground/60 hover:text-foreground'
                    }`}
                    title={t('ai.tasks')}
                  >
                    <BellRinging size={12} />
                    <span>{t('ai.tasks')}</span>
                  </button>
                  <button
                    onClick={() => setActiveTab('extensions')}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs transition-all ${
                      activeTab === 'extensions'
                        ? 'bg-accent text-accent-foreground'
                        : 'text-foreground/60 hover:text-foreground'
                    }`}
                    title={t('ai.extensions')}
                  >
                    <Plugs size={12} />
                    <span>{t('ai.extensions')}</span>
                  </button>
                </div>
                {/* TTS Toggle */}
                <button
                  onClick={() => setIsTTSEnabled(!isTTSEnabled)}
                  className="w-8 h-8 rounded-full bg-foreground/10 hover:bg-foreground/20 transition-colors flex items-center justify-center text-foreground/70 hover:text-foreground"
                  title={isTTSEnabled ? t('ai.ttsDisable') : t('ai.ttsEnable')}
                >
                  {isTTSEnabled ? <SpeakerHigh size={16} /> : <SpeakerSlash size={16} />}
                </button>
                {/* Close button */}
                <button
                  onClick={() => setIsOpen(false)}
                  className="w-8 h-8 rounded-full bg-foreground/10 hover:bg-foreground/20 transition-colors flex items-center justify-center text-foreground/70 hover:text-foreground"
                  title={t('ai.close')}
                  aria-label={t('ai.close')}
                >
                  <X size={18} weight="bold" />
                </button>
              </div>
            </div>
          </div>

          {/* Task-created toast notification */}
          <AnimatePresence>
            {taskCreatedToast && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="mx-4 mb-0 px-4 py-2 rounded-xl bg-green-500/10 border border-green-500/20 text-green-400 text-xs flex items-center gap-2"
              >
                <BellRinging size={13} weight="fill" />
                {taskCreatedToast}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Voice slow-path banner: shown while ORA searches and user can keep talking */}
          <AnimatePresence>
            {voiceTaskBanner && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="mx-4 mb-0 px-4 py-2 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-300 text-xs flex items-center gap-2"
              >
                <MagnifyingGlass size={13} weight="bold" className="animate-pulse shrink-0" />
                <span>
                  {t('ai.searching')}: <strong>{voiceTaskBanner}</strong> — {t('ai.keepSpeaking')}
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Confirmation banner – shown when AI is unsure and needs user approval */}
          <AnimatePresence>
            {pendingTaskAction && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="mx-4 mb-0 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs"
              >
                <div className="flex items-start gap-2 mb-2">
                  <Warning size={14} weight="fill" className="text-amber-400 mt-0.5 shrink-0" />
                  <p className="text-amber-200 leading-snug">{pendingTaskAction.question}</p>
                </div>
                <div className="flex items-center gap-2 ml-5">
                  <button
                    onClick={() => handleTaskConfirmation(true)}
                    className="flex items-center gap-1 px-3 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-xs font-medium transition-colors"
                  >
                    <Check size={11} weight="bold" />
                    {pendingTaskAction?.action === 'delete' ? t('common.yesDelete')
                      : pendingTaskAction?.action === 'resume' ? t('common.yesEnable')
                      : t('common.yesDisable')}
                  </button>
                  <button
                    onClick={() => handleTaskConfirmation(false)}
                    className="flex items-center gap-1 px-3 py-1 rounded-lg bg-foreground/10 hover:bg-foreground/15 text-foreground/60 text-xs transition-colors"
                  >
                    <X size={11} weight="bold" /> {t('common.no')}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Tab content */}
          <AnimatePresence mode="wait">
            {activeTab === 'tasks' ? (
              <motion.div
                key="tasks"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
                className="flex-1 overflow-hidden px-4 py-4"
              >
                <ActiveTasksPanel isVisible={activeTab === 'tasks'} />
              </motion.div>
            ) : activeTab === 'extensions' ? (
              <motion.div
                key="extensions"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
                className="flex-1 overflow-y-auto px-4 py-4"
              >
                <ExtensionsPanel />
              </motion.div>
            ) : (
              <motion.div
                key="chat"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.2 }}
                className="flex-1 flex flex-col overflow-hidden"
              >

          {/* Availability banner */}
          {!healthLoading && assistHealth && !assistHealth.ai_available && (
            <div className="mx-4 mt-3 mb-1 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/25 text-xs space-y-2">
              <div className="flex items-start gap-2">
                <Warning size={14} weight="fill" className="text-red-400 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="font-semibold text-red-200">{t('ai.unavailableTitle')}</p>
                  <p className="text-red-200/80 leading-snug mt-0.5">{t('ai.unavailableHint')}</p>
                </div>
              </div>
              <button
                onClick={openAdminAssistTab}
                className="ml-6 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-200 transition-colors"
              >
                <Gear size={11} weight="bold" />
                <span>{t('ai.openAdmin')}</span>
                <ArrowSquareOut size={10} weight="bold" />
              </button>
            </div>
          )}

          {/* Agent preset chip row */}
          <div className="px-4 pt-3 pb-2 flex items-center gap-1.5 overflow-x-auto no-scrollbar border-b border-foreground/5">
            <Robot size={14} weight="duotone" className="text-foreground/40 shrink-0" />
            {AGENT_PRESETS.map(a => {
              const Icon = a.icon
              const active = a.id === agentId
              return (
                <button
                  key={a.id}
                  onClick={() => setAgentId(a.id)}
                  title={t(`ai.agentDescriptions.${a.id}`)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] whitespace-nowrap transition-all shrink-0 ${
                    active
                      ? `bg-gradient-to-br ${a.color} text-foreground border border-foreground/20`
                      : 'bg-foreground/5 hover:bg-foreground/10 text-foreground/60 border border-transparent'
                  }`}
                >
                  <Icon size={11} weight={active ? 'fill' : 'regular'} />
                  <span>{t(`ai.agents.${a.id}`)}</span>
                </button>
              )
            })}
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
            <AnimatePresence mode="popLayout">
              {messages.map((msg, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.3 }}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] px-4 py-2 rounded-2xl ${
                      msg.role === 'user'
                        ? 'bg-blue-500/20 text-foreground border border-blue-500/20'
                        : 'bg-foreground/5 text-foreground/90 border border-foreground/10'
                    }`}
                  >
                    <MessageContent content={msg.content} role={msg.role} />

                    {/* Instant Task result area */}
                    {msg.instantTaskId && (
                      <div className="mt-2 pt-2 border-t border-foreground/10">
                        {msg.instantTaskStatus === 'pending' && (
                          <div className="flex items-center gap-1.5 text-xs text-foreground/50">
                            <MagnifyingGlass size={12} className="animate-pulse" />
                            <span>
                              {t('ai.taskRunningSuffix', { label: INSTANT_TASK_LABELS[msg.instantTaskType ?? 'search'] ?? t('ai.search') })}
                            </span>
                          </div>
                        )}
                        {msg.instantTaskStatus === 'completed' && msg.instantTaskResult && (
                          <motion.div
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="text-sm text-foreground/90 leading-relaxed"
                          >
                            <div className="flex items-center gap-1 text-[10px] text-accent mb-1">
                              <Check size={10} weight="bold" />
                              {INSTANT_TASK_LABELS[msg.instantTaskType ?? 'search'] ?? t('ai.resultLabel')}
                            </div>
                            <MessageContent content={msg.instantTaskResult} role="assistant" />
                          </motion.div>
                        )}
                        {msg.instantTaskStatus === 'failed' && (
                          <p className="text-xs text-red-400/80 flex items-center gap-1">
                            <Warning size={11} weight="fill" />
                            {msg.instantTaskResult ?? t('ai.instantFailed')}
                          </p>
                        )}
                        {msg.instantTaskStatus === 'deferred' && (
                          <motion.p
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="text-xs text-purple-400/80 flex items-center gap-1"
                          >
                            <BellRinging size={11} weight="fill" />
                            {t('ai.deferredHint')}
                          </motion.p>
                        )}
                      </div>
                    )}

                    <p className="text-[10px] text-foreground/40 mt-1">
                      {new Date(msg.timestamp).toLocaleTimeString('de-DE', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            {messages.length === 0 && (
              <div className="text-center py-12 text-foreground/50 text-sm">
                <Sparkle size={48} weight="duotone" className="mx-auto mb-4 opacity-30" />
                <p className="font-medium mb-2">Hallo! Ich bin ORA, dein AI-Assistent</p>
                <p className="text-xs">Stelle mir eine Frage oder bitte mich um Hilfe</p>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Error display */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="mx-6 mb-3 px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-xs"
              >
                {error}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Input area */}
          <div className="px-6 py-4 border-t border-foreground/10 bg-background/50">
            <div className="flex items-center gap-2">
              {/* Voice input button */}
              <Button
                variant="outline"
                size="icon"
                onClick={handleVoiceInput}
                disabled={state === 'thinking' || state === 'speaking'}
                className={`h-11 w-11 rounded-full ${
                  state === 'listening'
                    ? 'bg-blue-500/20 border-blue-500/40 text-blue-500'
                    : ''
                }`}
              >
                <Microphone size={20} weight={state === 'listening' ? 'fill' : 'regular'} />
              </Button>

              {/* Text input */}
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    sendMessage(input)
                  }
                }}
                placeholder={t('ai.messageToOra')}
                disabled={state === 'thinking' || state === 'speaking'}
                className="flex-1 px-4 py-2.5 rounded-2xl bg-foreground/5 border border-foreground/10 text-foreground placeholder-foreground/40 text-sm focus:outline-none focus:border-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              />

              {/* Send button */}
              <Button
                onClick={() => sendMessage(input)}
                disabled={!input.trim() || state === 'thinking' || state === 'speaking'}
                className="h-11 w-11 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
                size="icon"
              >
                <PaperPlaneRight size={18} weight="fill" />
              </Button>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2 mt-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleSearchInternet(input || 'latest news')}
                disabled={state === 'thinking'}
                className="h-8 text-xs"
              >
                <Globe size={14} className="mr-1.5" />
                <span>Internet suchen</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled
                title={t('ai.attachmentDisabled')}
                className="h-8 text-xs opacity-50"
              >
                <ImageSquare size={14} className="mr-1.5" />
                <span>Screenshot</span>
              </Button>

              {/* Model selector */}
              {availableModels.length > 0 && (
                <div className="ml-auto flex items-center gap-1 text-[10px] text-foreground/50">
                  <Cpu size={11} weight="duotone" />
                  <select
                    value={modelId}
                    onChange={(e) => setModelId(e.target.value)}
                    className="bg-foreground/5 border border-foreground/10 rounded-md px-1.5 py-0.5 text-[10px] text-foreground/80 focus:outline-none focus:border-accent max-w-[140px]"
                    title={t('ai.model')}
                  >
                    <option value="">{t('ai.modelDefault')}</option>
                    {availableModels.map(m => (
                      <option key={m.id} value={m.id}>{m.name ?? m.id}</option>
                    ))}
                  </select>
                </div>
              )}
              {availableModels.length === 0 && assistHealth?.ai_available && (
                <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-emerald-400/80">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  {t('ai.providerOnline')}
                </span>
              )}
            </div>
          </div>
          {/* End of chat tab inner flex */}
          </motion.div>
        )}
        </AnimatePresence>
        </DialogContent>
      </Dialog>
    </>
  )
}
