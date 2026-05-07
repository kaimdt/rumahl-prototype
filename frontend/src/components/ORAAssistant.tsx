import { useTranslation } from 'react-i18next'
import i18n from '@/i18n'
import { useLocalStorage } from '@/lib/storage'
import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Microphone, X, PaperPlaneRight, Sparkle, Globe, ImageSquare, SpeakerHigh, SpeakerSlash, BellRinging, Chat, Check, Warning, MagnifyingGlass } from '@phosphor-icons/react'
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
type DialogTab = 'chat' | 'tasks'

import { getAssistUrl, getBackendUrl } from '@/lib/config'

const assistBase = () => getAssistUrl() || getBackendUrl() || ''

// ─── Instant Task type badge labels ──────────────────────────────────────────

const INSTANT_TASK_LABELS: Record<string, string> = {
  search:  i18n.t('ai.search'),
  weather: i18n.t('ai.weather'),
  news:    i18n.t('ai.news'),
  music:   i18n.t('ai.music'),
  generic: i18n.t('ai.search'),
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
                ? { ...m, instantTaskStatus: 'deferred', instantTaskResult: 'Die Antwort dauert etwas länger – du bekommst eine Benachrichtigung.' }
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
              ? 'Das dauert noch etwas länger. Ich melde mich gleich, wenn ich das Ergebnis habe.'
              : 'Das dauert etwas länger. Ich melde mich sobald ich fertig bin.'
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
        body: JSON.stringify({ message: text, context: null, voice_mode: fromVoice, language: i18n.language, instructions: aiInstructions || undefined }),
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
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
          setTaskCreatedToast(`Aufgabe ${ta.action === 'pause_until' ? 'pausiert' : ta.action === 'delete' ? 'gelöscht' : 'aktualisiert'} ✓`)
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
              setTaskCreatedToast('Aufgabe wurde erstellt ✓')
              setTimeout(() => setTaskCreatedToast(null), 4000)
            }
          })
          .catch(() => { /* silent */ })
      }
    } catch (e) {
      console.error('Failed to send message:', e)
      setError(e instanceof Error ? e.message : 'Nachricht konnte nicht gesendet werden')
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
        setTaskCreatedToast(`Aufgabe ${action === 'pause_until' ? 'pausiert' : action === 'delete' ? 'gelöscht' : 'aktualisiert'} ✓`)
        setTimeout(() => setTaskCreatedToast(null), 4000)
      }
    } catch (e) {
      console.error('Confirmation failed:', e)
    }
  }

  const handleVoiceInput = () => {
    if (!recognitionRef.current || !isSpeechSupported) {
      setError('Spracherkennung wird nicht unterstützt')
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
                    {state === 'listening' && (voiceTaskBanner ? 'Höre zu… (sucht noch)' : 'Höre zu...')}
                    {state === 'thinking' && (voiceTaskBanner ? `Sucht: ${voiceTaskBanner}…` : 'Denke nach...')}
                    {state === 'speaking' && 'Antworte...'}
                    {state === 'error' && 'Fehler'}
                    {state === 'idle' && (voiceTaskBanner ? `Sucht: ${voiceTaskBanner}…` : 'Bereit')}
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
                    title="Chat"
                  >
                    <Chat size={12} />
                    <span>Chat</span>
                  </button>
                  <button
                    onClick={() => setActiveTab('tasks')}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs transition-all ${
                      activeTab === 'tasks'
                        ? 'bg-accent text-accent-foreground'
                        : 'text-foreground/60 hover:text-foreground'
                    }`}
                    title="Aufgaben"
                  >
                    <BellRinging size={12} />
                    <span>Aufgaben</span>
                  </button>
                </div>
                {/* TTS Toggle */}
                <button
                  onClick={() => setIsTTSEnabled(!isTTSEnabled)}
                  className="w-8 h-8 rounded-full bg-foreground/10 hover:bg-foreground/20 transition-colors flex items-center justify-center text-foreground/70 hover:text-foreground"
                  title={isTTSEnabled ? 'Sprachausgabe deaktivieren' : 'Sprachausgabe aktivieren'}
                >
                  {isTTSEnabled ? <SpeakerHigh size={16} /> : <SpeakerSlash size={16} />}
                </button>
                {/* Close button */}
                <button
                  onClick={() => setIsOpen(false)}
                  className="w-8 h-8 rounded-full bg-foreground/10 hover:bg-foreground/20 transition-colors flex items-center justify-center text-foreground/70 hover:text-foreground"
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
                    <X size={11} weight="bold" /> Nein
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
            ) : (
              <motion.div
                key="chat"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.2 }}
                className="flex-1 flex flex-col overflow-hidden"
              >

          {/* Messages container */}
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
                              {INSTANT_TASK_LABELS[msg.instantTaskType ?? 'search'] ?? t('ai.search')} läuft…
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
                              {INSTANT_TASK_LABELS[msg.instantTaskType ?? 'search'] ?? 'Ergebnis'}
                            </div>
                            <MessageContent content={msg.instantTaskResult} role="assistant" />
                          </motion.div>
                        )}
                        {msg.instantTaskStatus === 'failed' && (
                          <p className="text-xs text-red-400/80 flex items-center gap-1">
                            <Warning size={11} weight="fill" />
                            {msg.instantTaskResult ?? 'Suche fehlgeschlagen.'}
                          </p>
                        )}
                        {msg.instantTaskStatus === 'deferred' && (
                          <motion.p
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="text-xs text-purple-400/80 flex items-center gap-1"
                          >
                            <BellRinging size={11} weight="fill" />
                            Dauert etwas länger – du bekommst eine Meldung, sobald die Antwort da ist.
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
                placeholder="Nachricht an ORA..."
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
                className="h-8 text-xs opacity-50"
              >
                <ImageSquare size={14} className="mr-1.5" />
                <span>Screenshot</span>
              </Button>
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
