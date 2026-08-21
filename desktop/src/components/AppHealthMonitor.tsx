// App Health Monitor – Auto-detects iframe app issues and provides recovery
import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Warning, ArrowClockwise, X, Wrench } from '@phosphor-icons/react'

interface Props {
  src: string
  appName: string
  timeoutMs?: number
  onRetry?: () => void
  children?: React.ReactNode
}

export function AppHealthMonitor({ src, appName, timeoutMs = 15000, onRetry, children }: Props) {
  const [state, setState] = useState<'loading' | 'loaded' | 'error' | 'timeout'>('loading')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()
  const retryCount = useRef(0)

  const startTimeout = useCallback(() => {
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      if (state === 'loading') {
        setState('timeout')
        setErrorMsg('App did not respond within timeout')
      }
    }, timeoutMs)
  }, [timeoutMs, state])

  useEffect(() => {
    setState('loading')
    setErrorMsg(null)
    startTimeout()
    return () => clearTimeout(timerRef.current)
  }, [src, startTimeout])

  const handleIframeLoad = () => {
    clearTimeout(timerRef.current)
    setState('loaded')
    retryCount.current = 0
  }

  const handleIframeError = () => {
    clearTimeout(timerRef.current)
    setState('error')
    setErrorMsg('App failed to load')
  }

  const handleRetry = () => {
    retryCount.current++
    setState('loading')
    setErrorMsg(null)
    startTimeout()
    onRetry?.()
    // Force iframe reload by changing key
    const iframe = document.querySelector(`[data-app-iframe="${appName}"]`) as HTMLIFrameElement
    if (iframe) iframe.src = iframe.src
  }

  return (
    <div className="app-iframe-container">
      {/* Loading overlay */}
      <AnimatePresence>
        {state === 'loading' && (
          <motion.div className="app-iframe-loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
              <p className="text-xs text-foreground/40">Lade {appName}…</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error/Timeout overlay */}
      <AnimatePresence>
        {(state === 'error' || state === 'timeout') && (
          <motion.div className="app-iframe-error" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
            <Warning size={32} weight="fill" className="text-amber-400" />
            <div>
              <p className="text-sm font-medium text-foreground">
                {state === 'timeout' ? 'App antwortet nicht' : 'App konnte nicht geladen werden'}
              </p>
              <p className="text-xs text-foreground/40 mt-1">{errorMsg || 'Unbekannter Fehler'}</p>
              {retryCount.current > 0 && (
                <p className="text-[10px] text-foreground/30 mt-0.5">{retryCount.current} Wiederholungsversuch{retryCount.current > 1 ? 'e' : ''}</p>
              )}
            </div>
            <button
              onClick={handleRetry}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent/20 text-accent text-xs hover:bg-accent/30 transition-all"
            >
              <ArrowClockwise size={14} /> Erneut versuchen
            </button>
            {retryCount.current >= 3 && (
              <p className="text-[10px] text-foreground/30">
                rumahl hat das Problem erkannt. Die App wird beim nächsten Seitenbesuch neu initialisiert.
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Iframe */}
      {src && (
        <iframe
          data-app-iframe={appName}
          src={src}
          onLoad={handleIframeLoad}
          onError={handleIframeError}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          title={appName}
          loading="lazy"
        />
      )}

      {children}
    </div>
  )
}
