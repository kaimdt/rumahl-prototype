import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowClockwise, Globe, Warning } from '@phosphor-icons/react'
import { getApiBase } from '@/lib/apiBase'

export function RemoteHomeView() {
  const apiBase = getApiBase()
  const [origin, setOrigin] = useState<string>('')
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [loaded, setLoaded] = useState(false)

  const remoteUrl = useMemo(() => apiBase?.replace(/\/+$/, '') || '', [apiBase])

  useEffect(() => {
    if (!remoteUrl) return
    try {
      const url = new URL(remoteUrl)
      setOrigin(url.origin)
    } catch {
      setOrigin('')
    }
  }, [remoteUrl])

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!origin || event.origin !== origin) return
      if (!event.data || typeof event.data !== 'object') return

      const payload = event.data as { type?: string; action?: string; [key: string]: unknown }
      if (payload.type === 'desktop-request-handshake') {
        iframeRef.current?.contentWindow?.postMessage(
          {
            type: 'desktop-bridge-ready',
            payload: {
              features: ['custom-elements', 'custom-pages', 'desktop-messaging'],
              version: '1.0',
            },
          },
          origin,
        )
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [origin])

  useEffect(() => {
    const handleDesktopReload = () => {
      reload()
    }

    window.addEventListener('desktop-reload-remote-home', handleDesktopReload)
    return () => window.removeEventListener('desktop-reload-remote-home', handleDesktopReload)
  }, [remoteUrl])

  const reload = () => {
    if (iframeRef.current) {
      setLoaded(false)
      iframeRef.current.src = remoteUrl
    }
  }

  const sendReadySignal = () => {
    if (!origin || !iframeRef.current?.contentWindow) return
    iframeRef.current.contentWindow.postMessage(
      {
        type: 'desktop-bridge-ready',
        payload: {
          features: ['custom-elements', 'custom-pages', 'desktop-messaging'],
          version: '1.0',
        },
      },
      origin,
    )
  }

  return (
    <div className="absolute inset-0 overflow-hidden bg-background text-foreground">
      {!remoteUrl ? (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
          <div className="max-w-md rounded-3xl border border-foreground/10 bg-background/95 p-8 text-left shadow-xl shadow-black/5">
            <div className="flex items-center gap-3 mb-4">
              <Warning size={24} className="text-destructive" />
              <div>
                <p className="text-base font-semibold">Remote IORA Home nicht verfügbar</p>
                <p className="text-sm text-foreground/60">Bitte konfiguriere die IORA Home URL in den Einstellungen.</p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <iframe
          ref={iframeRef}
          src={remoteUrl}
          title="Remote IORA Home"
          allow="clipboard-read clipboard-write fullscreen"
          allowFullScreen
          className="absolute inset-0 min-h-full min-w-full h-full w-full border-0"
          style={{ display: 'block' }}
          onLoad={() => {
            setLoaded(true)
            sendReadySignal()
          }}
        />
      )}

      {!loaded && remoteUrl && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="rounded-3xl border border-foreground/10 bg-background/95 px-6 py-5 text-center shadow-xl shadow-black/5">
            <p className="text-sm font-medium text-foreground">Lade IORA Home…</p>
            <p className="text-xs text-foreground/60 mt-2">Wenn du localhost:3001 verwendest, stelle sicher, dass der IORA Home-Server gestartet ist.</p>
          </div>
        </div>
      )}
    </div>
  )
}
