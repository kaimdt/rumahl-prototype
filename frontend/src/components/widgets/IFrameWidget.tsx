import { useState, useEffect, useCallback, useRef } from 'react'
import { motion } from 'motion/react'
import { Globe, ArrowsOutSimple, ArrowSquareOut, ArrowClockwise, WarningCircle } from '@phosphor-icons/react'
import { useLongPressDialog } from '@/hooks/useLongPressDialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tip } from '@/components/ui/tip'
import { toast } from 'sonner'

interface IFrameWidgetConfig {
  url?: string
  title?: string
  showHeader?: boolean
  allowFullscreen?: boolean
  variant?: 'standard' | 'borderless' | 'compact'
  cardVariant?: string
  refreshIntervalSeconds?: number
  customHeight?: number
  scrolling?: boolean
  appId?: string  // For postMessage communication with IORA
  [key: string]: unknown
}

interface IFrameWidgetProps {
  config?: IFrameWidgetConfig
}

export default function IFrameWidget({ config }: IFrameWidgetProps) {
  const url = config?.url
  const title = config?.title || 'Webseite'
  const variant = (config?.variant || config?.cardVariant || 'standard') as 'standard' | 'borderless' | 'compact'
  const showHeader = variant === 'borderless' ? false : (config?.showHeader !== false)
  const allowFullscreen = config?.allowFullscreen !== false
  const refreshInterval = config?.refreshIntervalSeconds ? config.refreshIntervalSeconds * 1000 : 0
  const scrolling = config?.scrolling !== false
  const appId = config?.appId
  const [iframeKey, setIframeKey] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const { dialogOpen, setDialogOpen, longPressHandlers } = useLongPressDialog()
  const pendingRequests = useRef<Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>>(new Map())
  const messageIdCounter = useRef(0)

  // Auto-refresh
  useEffect(() => {
    if (!refreshInterval || !url) return
    const interval = setInterval(() => setIframeKey(k => k + 1), refreshInterval)
    return () => clearInterval(interval)
  }, [refreshInterval, url])

  // ── Two-way postMessage communication with iframe ──
  useEffect(() => {
    if (!url) return

    const handleMessage = (event: MessageEvent) => {
      const msg = event.data
      if (!msg || typeof msg !== 'object') return

      // Handle iframe → IORA requests
      if (msg.type === 'request' && msg.method) {
        handleIframeRequest(msg)
      }

      // Handle responses to our messages
      if (msg.type === 'response' && msg.id) {
        const pending = pendingRequests.current.get(msg.id)
        if (pending) {
          pendingRequests.current.delete(msg.id)
          if (msg.error) {
            pending.reject(new Error(msg.error.message || msg.error))
          } else {
            pending.resolve(msg.result)
          }
        }
      }

      // Handle events from iframe
      if (msg.type === 'event' && msg.event) {
        handleIframeEvent(msg.event)
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [url])

  const handleIframeRequest = useCallback(async (msg: any) => {
    const sendResponse = (result: any, error?: string) => {
      if (msg.id && iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage({
          type: 'response',
          id: msg.id,
          result,
          error: error ? { code: -1, message: error } : undefined,
        }, '*')
      }
    }

    try {
      switch (msg.method) {
        case 'auth.requestToken':
          sendResponse({ token: 'iora-iframe-token-' + (appId || 'unknown') })
          break

        case 'ui.requestFullscreen':
          if (iframeRef.current?.requestFullscreen) {
            await iframeRef.current.requestFullscreen()
            setIsFullscreen(true)
            sendResponse({ success: true })
          } else {
            // Fallback: open dialog
            setDialogOpen(true)
            sendResponse({ success: true, note: 'fullscreen-dialog' })
          }
          break

        case 'ui.exitFullscreen':
          if (document.fullscreenElement) {
            await document.exitFullscreen()
            setIsFullscreen(false)
          }
          sendResponse({ success: true })
          break

        case 'ui.showToast':
          const [message, type = 'info'] = msg.params?.[1] ? [msg.params[1], msg.params[2] || 'info'] : msg.params || []
          if (message) {
            toast[type as keyof typeof toast]?.(message) ?? toast(message)
          }
          sendResponse({ success: true })
          break

        case 'ui.navigateTo':
          const [pageId] = msg.params || []
          if (pageId) {
            window.location.href = `/page/${pageId}`
          }
          sendResponse({ success: true })
          break

        case 'ui.openAppDetail':
          const [detailAppId] = msg.params || []
          if (detailAppId) {
            // Dispatch custom event for AppStoreTab to catch
            window.dispatchEvent(new CustomEvent('open-app-detail', { detail: { appId: detailAppId } }))
          }
          sendResponse({ success: true })
          break

        case 'entities.list':
          // Forward to IORA API
          try {
            const res = await fetch('/api/states')
            const entities = await res.json()
            sendResponse(entities)
          } catch (e) {
            sendResponse(null, 'Failed to fetch entities')
          }
          break

        case 'entities.get':
          const [entityId] = msg.params?.slice(1) || []
          if (entityId) {
            try {
              const res = await fetch(`/api/states/${entityId}`)
              const entity = await res.json()
              sendResponse(entity)
            } catch (e) {
              sendResponse(null, 'Entity not found')
            }
          }
          break

        case 'entities.callService':
          const [domain, service, entity_id, data] = msg.params?.slice(1) || []
          if (domain && service && entity_id) {
            try {
              const res = await fetch(`/api/services/${domain}/${service}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity_id, service_data: data || {} }),
              })
              const result = await res.json()
              sendResponse(result)
            } catch (e) {
              sendResponse(null, 'Service call failed')
            }
          }
          break

        case 'notifications.send':
          try {
            const notifData = msg.params?.[1] || {}
            await fetch('/api/notifications/send', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(notifData),
            })
            sendResponse({ success: true })
          } catch (e) {
            sendResponse(null, 'Notification failed')
          }
          break

        default:
          sendResponse(null, `Unknown method: ${msg.method}`)
      }
    } catch (e) {
      sendResponse(null, (e as Error).message)
    }
  }, [appId, setDialogOpen])

  const handleIframeEvent = useCallback((event: any) => {
    if (event.type === 'app.proxy.status') {
      // App proxy sent status update
      console.log('[IORA] App status from iframe:', event.data)
    }
  }, [])

  // Handle iframe load error
  const handleIframeError = useCallback(() => {
    setError('Die Seite konnte nicht geladen werden. Möglicherweise ist die App nicht gestartet oder der Server nicht erreichbar.')
  }, [])

  // Reset error on URL change
  useEffect(() => {
    setError(null)
  }, [url, iframeKey])

  if (!url) {
    return (
      <motion.div
        className="glass-card rounded-2xl p-4 sm:p-5 h-full flex flex-col items-center justify-center"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <Globe size={36} className="text-foreground/20 mb-3" />
        <p className="text-sm text-foreground/40 font-medium">Keine URL konfiguriert</p>
        <p className="text-[10px] text-foreground/25 mt-1">URL im Widget konfigurieren</p>
      </motion.div>
    )
  }

  return (
    <>
    <motion.div
      {...longPressHandlers}
      className={`${variant === 'borderless' ? '' : 'glass-card'} rounded-2xl h-full flex flex-col overflow-hidden relative`}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.005 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
    >
      {showHeader && (
        <div className={`flex items-center justify-between px-4 ${variant === 'compact' ? 'pt-2 pb-1' : 'pt-3 pb-2'}`}>
          <div className="flex items-center gap-2 min-w-0">
            <Globe size={variant === 'compact' ? 14 : 16} weight="fill" className="text-accent shrink-0" />
            <h3 className={`${variant === 'compact' ? 'text-xs' : 'text-sm'} font-semibold text-foreground truncate`}>{title}</h3>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {refreshInterval > 0 && (
              <Tip content="Aktualisieren">
                <button
                  onClick={() => setIframeKey(k => k + 1)}
                  className="p-1 rounded-md hover:bg-foreground/5 text-foreground/40 hover:text-foreground/70 transition-colors"
                >
                  <ArrowClockwise size={14} />
                </button>
              </Tip>
            )}
            {allowFullscreen && (
              <Tip content="Vollbild">
                <button
                  onClick={() => setDialogOpen(true)}
                  className="p-1 rounded-md hover:bg-foreground/5 text-foreground/40 hover:text-foreground/70 transition-colors"
                >
                  <ArrowsOutSimple size={14} />
                </button>
              </Tip>
            )}
            <Tip content="In neuem Tab öffnen">
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1 rounded-md hover:bg-foreground/5 text-foreground/40 hover:text-foreground/70 transition-colors"
              >
                <ArrowSquareOut size={14} />
              </a>
            </Tip>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 relative">
        {/* Error overlay */}
        {error && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center p-6 bg-foreground/5 backdrop-blur-sm">
            <WarningCircle size={40} className="text-red-400 mb-3" weight="fill" />
            <p className="text-sm font-semibold text-foreground mb-1">Verbindungsfehler</p>
            <p className="text-[11px] text-foreground/60 text-center max-w-sm mb-3">{error}</p>
            <div className="flex gap-2">
              <button
                onClick={() => setIframeKey(k => k + 1)}
                className="px-3 py-1.5 bg-accent text-white rounded-lg text-[11px] font-semibold hover:bg-accent/90 transition-colors"
              >
                Erneut versuchen
              </button>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 bg-foreground/5 text-foreground/70 rounded-lg text-[11px] font-semibold hover:bg-foreground/10 transition-colors"
              >
                In Tab öffnen
              </a>
            </div>
          </div>
        )}

        <iframe
          ref={iframeRef}
          key={iframeKey}
          src={url}
          className={`w-full h-full border-0 ${error ? 'opacity-30' : ''}`}
          title={title}
          loading="lazy"
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-fullscreen"
          allowFullScreen={allowFullscreen}
          scrolling={scrolling ? 'auto' : 'no'}
          onError={handleIframeError}
        />
      </div>
    </motion.div>

    {/* Fullscreen Dialog */}
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent className="sm:max-w-[95vw] max-h-[95vh] glass-card border-foreground/10 p-0 gap-0 bg-card/95 backdrop-blur-2xl overflow-hidden">
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-foreground/8">
          <div className="flex items-center gap-2 min-w-0">
            <Globe size={16} weight="fill" className="text-accent shrink-0" />
            <h3 className="text-sm font-semibold text-foreground truncate">{title}</h3>
          </div>
          <div className="flex items-center gap-1">
            <Tip content="Aktualisieren">
              <button
                onClick={() => setIframeKey(k => k + 1)}
                className="p-1.5 rounded-md hover:bg-foreground/5 text-foreground/40 hover:text-foreground/70 transition-colors"
              >
                <ArrowClockwise size={14} />
              </button>
            </Tip>
            <Tip content="In neuem Tab öffnen">
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 rounded-md hover:bg-foreground/5 text-foreground/40 hover:text-foreground/70 transition-colors"
              >
                <ArrowSquareOut size={14} />
              </a>
            </Tip>
          </div>
        </div>

        <div className="w-full" style={{ height: '80vh' }}>
          <iframe
            src={url}
            className="w-full h-full border-0"
            title={title}
            loading="lazy"
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            allowFullScreen
          />
        </div>
      </DialogContent>
    </Dialog>
    </>
  )
}
