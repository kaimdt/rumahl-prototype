/**
 * rumahl OS App Store tab — embeds the rumahl Store (store.rumahl.com).
 *
 * The native rumahl app store has been removed; the store catalogue now lives
 * at store.rumahl.com (update-server + Next.js storefront). This tab embeds
 * it full-screen and handles install requests that the storefront posts via
 * `window.parent.postMessage({ source: 'rumahl-store', action: 'install', … })`:
 *
 *   1. fetch the app manifest from the store API
 *   2. build a store-method ZIP containing manifest.json (the backend
 *      generates the docker-compose.yml from `manifest.docker`)
 *   3. POST it to /api/appstore/install with the manifest's permissions
 *
 * Deep links from the browser store (`?install-app=<id>&return=<store-url>`)
 * start the install here and ask whether to return to the store afterwards.
 */

import { useTranslation } from 'react-i18next'
import { useState, useCallback, useEffect, useRef } from 'react'
import { ArrowSquareOut, SpinnerGap } from '@phosphor-icons/react'
import { adminFetch } from './AdminPanel'
import { toast } from 'sonner'
import { buildAppZip } from '@/lib/storeCatalog'

// Store base URL — override via VITE_STORE_URL for local development.
const STORE_URL = (
  (import.meta as any).env?.VITE_STORE_URL ||
  (typeof window !== 'undefined' && window.localStorage.getItem('rumahl-store-url')) ||
  'https://store.rumahl.com'
).replace(/\/$/, '')

export function AppStoreTab({ token }: { token: string }) {
  const { t } = useTranslation()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [installing, setInstalling] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)
  // Install handoff from the store (browser → device deep link):
  // `?install-app=<id>&version=<v>&return=<store-url>`
  const [handoff, setHandoff] = useState<{ id: string; name: string; returnUrl: string } | null>(null)

  const handleInstall = useCallback(async (payload: { type: string; id: string; name: string }) => {
    if (payload.type !== 'app') {
      toast.info(`Theme "${payload.name}": im Store verfügbar`)
      return
    }
    if (installing) return
    setInstalling(payload.id)
    try {
      // 1. Manifest vom rumahl Store holen
      const res = await fetch(`${STORE_URL}/api/apps/${payload.id}/manifest`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const manifest = await res.json()

      // 2. ZIP mit manifest.json bauen (Backend generiert docker-compose daraus)
      const zipData = buildAppZip({ 'manifest.json': JSON.stringify(manifest, null, 2) })

      // 3. Installation über das rumahl-OS-Backend starten
      const result = await adminFetch('/api/appstore/install', token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          zip_data: zipData,
          file_name: `${payload.id}.zip`,
          granted_permissions: manifest.permissions || [],
          denied_permissions: [],
        }),
      }) as { install_id?: string; error?: string }

      if (result?.error) {
        toast.error(t('apps.appStore.installFailed', { name: payload.name, error: result.error }))
      } else if (result?.install_id) {
        toast.success(t('apps.appStore.installStarted', { name: payload.name }))
        // Nach Installation den Store-Status aktualisieren
        iframeRef.current?.contentWindow?.postMessage(
          { source: 'rumahl-os', action: 'installed', payload: { id: payload.id } },
          STORE_URL,
        )
      } else {
        toast.success(t('apps.appStore.installStarted', { name: payload.name }))
      }
    } catch (e) {
      toast.error(t('apps.appStore.installFailed', { name: payload.name, error: (e as Error).message }))
    } finally {
      setInstalling(null)
    }
  }, [installing, token, t])

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.source !== 'rumahl-store') return
      switch (event.data.action) {
        case 'install':
          void handleInstall(event.data.payload)
          break
        case 'navigate':
          // Der Store kann Navigation im OS anfordern
          window.dispatchEvent(new CustomEvent('ora:navigate', { detail: event.data.payload?.path }))
          break
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [handleInstall])

  // Deep link from the store: `?install-app=<id>&return=<store-url>` — the
  // user came from the browser store and confirmed the install here.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const appId = params.get('install-app')
    if (!appId) return
    // Consume the parameters so a refresh does not re-install.
    const returnUrl = params.get('return') || STORE_URL
    params.delete('install-app')
    params.delete('version')
    params.delete('return')
    const qs = params.toString()
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`)
    // Fetch the name for the dialog, then start the install.
    fetch(`${STORE_URL}/api/apps/${encodeURIComponent(appId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((app) => setHandoff({ id: appId, name: app?.name || appId, returnUrl }))
      .catch(() => setHandoff({ id: appId, name: appId, returnUrl }))
  }, [])

  // Start the handoff install as soon as the dialog state is known.
  useEffect(() => {
    if (handoff && !installing) {
      void handleInstall({ type: 'app', id: handoff.id, name: handoff.name })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoff])

  return (
    <div className="rumahl-store-app flex h-full w-full flex-col">
      {/* Toolbar */}
      <div className="rumahl-store-toolbar flex items-center justify-between border-b border-border px-4 py-2">
        <span className="text-xs font-semibold text-fg">
          {t('os.apps.appStore.name', 'App Store')}
          <span className="ml-2 text-muted-fg font-normal">store.rumahl.com</span>
        </span>
        <div className="flex items-center gap-2">
          {installing && (
            <span className="flex items-center gap-1.5 text-xs text-muted-fg">
              <SpinnerGap size={13} className="animate-spin" />
              {t('apps.appStore.installing', 'Installiere…')}
            </span>
          )}
          <a
            href={STORE_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-fg transition hover:text-fg"
          >
            <ArrowSquareOut size={13} />
            {t('apps.appStore.openInBrowser', 'Im Browser öffnen')}
          </a>
        </div>
      </div>

      {/* Storefront iframe */}
      <div className="rumahl-store-viewport relative flex-1 min-h-0">
        <iframe
          ref={iframeRef}
          src={STORE_URL}
          title="rumahl App Store"
          className="h-full w-full border-0 bg-[#090a0f]"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          onLoad={() => setLoadError(false)}
        />
        {loadError && (
          <div className="absolute inset-0 flex items-center justify-center bg-bg">
            <p className="text-sm text-muted-fg">Store nicht erreichbar — prüfe store.rumahl.com</p>
          </div>
        )}
      </div>

      {/* Install handoff dialog (browser → device): ask whether to return */}
      {handoff && !installing && (
        <div className="fixed inset-0 z-[200] grid place-items-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl">
            <h3 className="text-base font-bold text-fg">
              {t('apps.appStore.handoffDone', 'Installation von {{name}} gestartet', { name: handoff.name })}
            </h3>
            <p className="mt-2 text-sm text-muted-fg">
              {t('apps.appStore.handoffQuestion', 'Zurück zum Store wechseln oder hier bleiben?')}
            </p>
            <div className="mt-5 flex gap-2">
              <button
                onClick={() => { window.location.href = handoff.returnUrl }}
                className="flex-1 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
              >
                {t('apps.appStore.backToStore', 'Zurück zum Store')}
              </button>
              <button
                onClick={() => setHandoff(null)}
                className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-fg transition hover:bg-muted"
              >
                {t('apps.appStore.stayHere', 'Hier bleiben')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
