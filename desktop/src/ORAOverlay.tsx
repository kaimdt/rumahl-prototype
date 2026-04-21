import { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { motion, AnimatePresence } from 'framer-motion'
import { Microphone, X, PaperPlaneRight, Sparkle, Globe, ImageSquare, SpeakerHigh, SpeakerSlash } from '@phosphor-icons/react'

interface AIChatMessage {
  role: string
  content: string
  timestamp: string
}

interface AIChatResponse {
  message: string
  provider: string
  message_id: string
}

type ORAState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error'

export function ORAOverlay() {
  const [state, setState] = useState<ORAState>('idle')
  const [messages, setMessages] = useState<AIChatMessage[]>([])
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSpeechSupported, setIsSpeechSupported] = useState(false)
  const [isTTSEnabled, setIsTTSEnabled] = useState(true)
  const [screenshotData, setScreenshotData] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const recognitionRef = useRef<any>(null)
  const synthRef = useRef<SpeechSynthesis | null>(null)

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

  // Text-to-Speech function
  const speak = (text: string) => {
    if (!isTTSEnabled || !synthRef.current) return

    // Cancel any ongoing speech
    synthRef.current.cancel()

    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'de-DE'
    utterance.rate = 1.0
    utterance.pitch = 1.0

    utterance.onstart = () => setState('speaking')
    utterance.onend = () => setState('idle')
    utterance.onerror = (e) => {
      console.error('TTS error:', e)
      setState('idle')
    }

    synthRef.current.speak(utterance)
  }

  const handleClose = async () => {
    try {
      await invoke('ora_hide_overlay')
    } catch (e) {
      console.error('Failed to close overlay:', e)
    }
  }

  const sendMessage = async (text: string) => {
    if (!text.trim()) return

    const userMessage: AIChatMessage = {
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setState('thinking')
    setError(null)

    try {
      const response = await invoke<AIChatResponse>('ora_send_chat', {
        message: text,
        context: null,
      })

      const aiMessage: AIChatMessage = {
        role: 'assistant',
        content: response.message,
        timestamp: new Date().toISOString(),
      }

      setMessages(prev => [...prev, aiMessage])
      setState('speaking')

      // Speak the AI response if TTS is enabled
      if (isTTSEnabled) {
        speak(response.message)
      } else {
        // Return to idle after animation if TTS is disabled
        setTimeout(() => setState('idle'), 2000)
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

    setState('listening')

    recognitionRef.current.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript
      setInput(transcript)
      setState('idle')
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
      await invoke('ora_search_internet', {
        query,
        maxResults: 5,
      })
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

  const handleCaptureScreenshot = async () => {
    try {
      setState('thinking')
      const result = await invoke<{ image_base64: string; timestamp: string }>('ora_capture_screenshot')
      setScreenshotData(result.image_base64)

      // Add system message about screenshot
      const screenshotMessage: AIChatMessage = {
        role: 'system',
        content: 'Screenshot aufgenommen und bereit zur Analyse',
        timestamp: result.timestamp,
      }
      setMessages(prev => [...prev, screenshotMessage])
      setState('idle')
    } catch (e) {
      console.error('Screenshot failed:', e)
      setError(e instanceof Error ? e.message : 'Screenshot fehlgeschlagen')
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
      case 'listening': return <Microphone size={24} weight="fill" className="animate-pulse" />
      case 'thinking': return <Sparkle size={24} weight="fill" className="animate-spin" />
      case 'speaking': return <Sparkle size={24} weight="fill" className="animate-pulse" />
      default: return <Sparkle size={24} weight="duotone" />
    }
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-transparent flex items-start justify-center pt-0">
      {/* Main overlay container with glass effect */}
      <motion.div
        initial={{ opacity: 0, y: -100 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -100 }}
        transition={{ type: 'spring', stiffness: 260, damping: 20 }}
        className="w-full h-auto max-h-[600px] relative rounded-b-3xl overflow-hidden shadow-2xl"
        style={{
          background: 'rgba(15, 15, 20, 0.75)',
          backdropFilter: 'blur(40px)',
          WebkitBackdropFilter: 'blur(40px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderTop: 'none',
        }}
      >
        {/* Animated gradient background */}
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

        {/* Header with status indicator and close button */}
        <div className="relative z-10 flex items-center justify-between px-6 py-4 border-b border-white/10">
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
              <h2 className="text-sm font-semibold text-white">ORA AI</h2>
              <p className="text-xs text-white/50">
                {state === 'listening' && 'Höre zu...'}
                {state === 'thinking' && 'Denke nach...'}
                {state === 'speaking' && 'Antworte...'}
                {state === 'error' && 'Fehler'}
                {state === 'idle' && 'Bereit'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* TTS Toggle */}
            <button
              onClick={() => setIsTTSEnabled(!isTTSEnabled)}
              className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 transition-colors flex items-center justify-center text-white/70 hover:text-white"
              title={isTTSEnabled ? 'Sprachausgabe deaktivieren' : 'Sprachausgabe aktivieren'}
            >
              {isTTSEnabled ? <SpeakerHigh size={16} className="text-white" /> : <SpeakerSlash size={16} className="text-white" />}
            </button>
            {/* Close button */}
            <button
              onClick={handleClose}
              className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 transition-colors flex items-center justify-center text-white/70 hover:text-white"
            >
              <X size={18} weight="bold" />
            </button>
          </div>
        </div>

        {/* Messages container */}
        <div className="relative z-10 overflow-y-auto max-h-[400px] px-6 py-4 space-y-3">
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
                      ? 'bg-blue-500/30 text-white'
                      : 'bg-white/10 text-white/90'
                  }`}
                >
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                  <p className="text-[10px] text-white/40 mt-1">
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
            <div className="text-center py-8 text-white/50 text-sm">
              <Sparkle size={32} weight="duotone" className="mx-auto mb-3 opacity-30" />
              <p>Sage "ORA" oder "IORA" um zu beginnen</p>
              <p className="text-xs mt-1">Oder tippe deine Nachricht unten ein</p>
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
              className="relative z-10 mx-6 mb-3 px-4 py-2 rounded-xl bg-red-500/20 border border-red-500/30 text-red-200 text-xs"
            >
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Screenshot preview */}
        <AnimatePresence>
          {screenshotData && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="relative z-10 mx-6 mb-3"
            >
              <div className="relative rounded-xl overflow-hidden border border-white/20 bg-white/5">
                <img
                  src={`data:image/png;base64,${screenshotData}`}
                  alt="Screenshot"
                  className="w-full h-auto"
                />
                <button
                  onClick={() => setScreenshotData(null)}
                  className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/60 hover:bg-black/80 transition-colors flex items-center justify-center text-white"
                >
                  <X size={14} weight="bold" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Input area */}
        <div className="relative z-10 px-6 py-4 border-t border-white/10">
          <div className="flex items-center gap-2">
            {/* Voice input button */}
            <button
              onClick={handleVoiceInput}
              disabled={state === 'thinking' || state === 'speaking'}
              className={`w-11 h-11 rounded-full flex items-center justify-center transition-all ${
                state === 'listening'
                  ? 'bg-blue-500/40 text-white'
                  : 'bg-white/10 hover:bg-white/20 text-white/70 hover:text-white'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              <Microphone size={20} weight={state === 'listening' ? 'fill' : 'regular'} />
            </button>

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
              className="flex-1 px-4 py-2.5 rounded-2xl bg-white/10 border border-white/20 text-white placeholder-white/40 text-sm focus:outline-none focus:border-white/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            />

            {/* Send button */}
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || state === 'thinking' || state === 'speaking'}
              className="w-11 h-11 rounded-full bg-gradient-to-br from-purple-500/40 to-pink-500/40 hover:from-purple-500/50 hover:to-pink-500/50 flex items-center justify-center transition-all disabled:opacity-50 disabled:cursor-not-allowed text-white"
            >
              <PaperPlaneRight size={18} weight="fill" />
            </button>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={() => handleSearchInternet(input || 'latest news')}
              disabled={state === 'thinking'}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-white/60 hover:text-white text-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Globe size={14} />
              <span>Internet suchen</span>
            </button>
            <button
              onClick={handleCaptureScreenshot}
              disabled={state === 'thinking'}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-white/60 hover:text-white text-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ImageSquare size={14} />
              <span>Screenshot</span>
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
