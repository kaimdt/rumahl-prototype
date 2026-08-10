import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowSquareOut, CaretRight, Play, X } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { usePageNavigation } from '@/contexts/PageNavigationContext'
import { authFetch } from '@/lib/authHelpers'
import {
  APP_LIFECYCLE,
  appRuntimeUrl,
  displayModeOf,
  iframeAllowFor,
  iframeSandboxFor,
  isLoopbackHostname,
  type AppLifecycleState,
  type AppRuntimeInfo,
} from '@/lib/appGateway'
import { isAppOpenExternal } from '@/lib/appOpenPrefs'

/**
 * AppRuntimeView – ORA Desktop App Runner.
 *
 * Embeds an installed app's web UI on its OWN origin
 * (`https://<app-id>.apps.ora.local/`) served by the App Embedding
 * Gateway. The runner only ever deals with:
 *
 *   appId · display mode · public runtime URL · permissions · lifecycle state
 *
 * It never sees internal ports or container addresses. While the app is
 * not RUNNING it shows a structured state page (STARTING / STOPPED /
 * FAILED / …) with an optional start action instead of a raw proxy error.
 *
 * Communication with the app (and the gateway state page) goes through a
 * validated `postMessage` bridge: every message must come from the app's
 * own origin and carry a matching appId.
 */
export function AppRuntimeView({ appId, name }: { appId: string; name?: string }) {
  const { t } = useTranslation()
  const { setCurrentPageId } = usePageNavigation()

  const [info, setInfo] = useState<AppRuntimeInfo | null>(null)
  const [frameSrc, setFrameSrc] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [appTitle, setAppTitle] = useState<string | null>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const lastStateRef = useRef<AppLifecycleState | null>(null)

  // Public runtime URL: the gateway's canonical URL wins. It is rejected
  // only when it points at a loopback host the browser cannot resolve as a
  // subdomain (misconfigured dev setup) — then the locally derived
  // subdomain (non-loopback desktops) or the legacy same-origin proxy
  // (loopback desktops) is used instead.
  const localUrl = appRuntimeUrl(appId)
  let runtimeUrl: string | null = null
  if (info?.runtime_url) {
    try {
      const parsed = new URL(info.runtime_url)
      if (!isLoopbackHostname(parsed.hostname)) runtimeUrl = info.runtime_url
    } catch {
      // Malformed URL from the backend — fall through to the fallbacks.
    }
  }
  runtimeUrl = runtimeUrl ?? localUrl
  const frameUrl = runtimeUrl ?? info?.proxy_url ?? `/api/apps/${appId}/proxy/`

  const display = info?.display ?? null
  const mode = displayModeOf(display)
  const state = info?.state ?? APP_LIFECYCLE.STARTING
  const frameOrigin = useRef<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await authFetch(`/api/apps/${appId}/runtime`)
      if (!res.ok) {
        setInfo({
          app_id: appId,
          state: APP_LIFECYCLE.NOT_FOUND,
          display: null,
          runtime_url: null,
          external_url: null,
          ws_supported: false,
          startable: false,
        })
        return
      }
      setInfo((await res.json()) as AppRuntimeInfo)
    } catch {
      // Backend unreachable — keep the last known state.
    }
  }, [appId])

  // Poll lifecycle state (lightweight). The iframe src is ONLY swapped when
  // the app transitions INTO running — no aggressive iframe reloading.
  useEffect(() => {
    void load()
    const interval = window.setInterval(() => void load(), 3000)
    return () => window.clearInterval(interval)
  }, [load])

  // State → iframe transition: the frame is only (re)mounted when the app
  // transitions INTO running. While STARTING/STOPPED/FAILED the state page
  // is shown instead — the iframe is never reloaded on a polling tick.
  useEffect(() => {
    if (!info) return
    const previous = lastStateRef.current
    lastStateRef.current = info.state
    if (info.state === APP_LIFECYCLE.RUNNING && previous !== APP_LIFECYCLE.RUNNING && frameUrl) {
      setFrameSrc(frameUrl)
    }
  }, [info?.state, frameUrl, appId])

  // Track the iframe origin for postMessage validation.
  useEffect(() => {
    if (!frameSrc) return
    try {
      frameOrigin.current = new URL(frameSrc, window.location.origin).origin
    } catch {
      frameOrigin.current = window.location.origin
    }
  }, [frameSrc])

  const startApp = useCallback(async () => {
    setBusy(true)
    try {
      const res = await authFetch(`/api/supervisor/apps/${appId}/start`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: string; message?: string } | null
        throw new Error(data?.error || data?.message || `HTTP ${res.status}`)
      }
      window.dispatchEvent(new Event('iora:installed-apps-refresh'))
      await load()
    } catch (e) {
      window.dispatchEvent(new CustomEvent('iora:toast', {
        detail: { message: t('os.quickActions.actionFailed', { detail: e instanceof Error ? e.message : String(e) }) },
      }))
    } finally {
      setBusy(false)
    }
  }, [appId, load, t])

  // ── postMessage bridge (origin + appId validated) ─────────────────────
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data
      if (!data || typeof data !== 'object') return
      if (data.source && data.source !== 'ora-app') return
      const expectedOrigins = [frameOrigin.current, window.location.origin].filter(Boolean)
      if (expectedOrigins.length > 0 && !expectedOrigins.includes(event.origin)) return
      if (data.appId && data.appId !== appId) return
      switch (data.type) {
        case 'app.requestStart':
          if (state !== APP_LIFECYCLE.RUNNING) void startApp()
          break
        case 'app.requestFullscreen':
          if (iframeRef.current?.requestFullscreen) void iframeRef.current.requestFullscreen()
          break
        case 'app.setTitle':
          if (typeof data.title === 'string' && data.title.length > 0) setAppTitle(data.title)
          break
        default:
          break
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [appId, startApp, state])

  // Push lifecycle updates into the frame (gateway state page + apps).
  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe?.contentWindow || !frameOrigin.current || !frameSrc) return
    try {
      iframe.contentWindow.postMessage(
        { type: 'ora.lifecycleChanged', appId, state },
        frameOrigin.current,
      )
    } catch {
      // Frame not ready / cross-origin blocked — ignore.
    }
  }, [state, appId, frameSrc])

  const displayName = appTitle ?? name ?? appId
  const openExternal = () => {
    const url = info?.external_url ?? runtimeUrl ?? frameUrl
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
  }

  const statusBadge = (() => {
    switch (state) {
      case APP_LIFECYCLE.RUNNING: return <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
      case APP_LIFECYCLE.STARTING: return <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
      case APP_LIFECYCLE.FAILED: case APP_LIFECYCLE.UNHEALTHY: return <span className="h-2 w-2 rounded-full bg-red-400" />
      default: return <span className="h-2 w-2 rounded-full bg-foreground/30" />
    }
  })()

  const stateLabel = (() => {
    switch (state) {
      case APP_LIFECYCLE.RUNNING: return 'RUNNING'
      case APP_LIFECYCLE.STARTING: return 'STARTING'
      case APP_LIFECYCLE.STOPPING: return 'STOPPING'
      case APP_LIFECYCLE.STOPPED: return 'STOPPED'
      case APP_LIFECYCLE.FAILED: return 'FAILED'
      case APP_LIFECYCLE.UNHEALTHY: return 'UNHEALTHY'
      default: return 'NOT_FOUND'
    }
  })()

  // External display mode: manifest `external` OR the per-app user override
  // "App außerhalb von ORA OS aufrufen" — open outside the runner.
  const external = (mode === 'external' || isAppOpenExternal(appId)) && info?.state === APP_LIFECYCLE.RUNNING

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background/95">
      {/* Toolbar */}
      <div className="flex min-h-12 shrink-0 items-center gap-3 border-b border-foreground/8 px-4">
        {statusBadge}
        <span className="min-w-0 truncate text-xs font-semibold uppercase tracking-[0.16em] text-foreground/55">
          {displayName}
        </span>
        <span className="rounded-full border border-foreground/10 bg-foreground/5 px-2 py-0.5 text-[9px] font-bold tracking-widest text-foreground/45">
          {stateLabel}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={openExternal}
          className="flex items-center gap-1.5 rounded-full border border-foreground/10 bg-foreground/5 px-3.5 py-1.5 text-[11px] font-semibold text-foreground/70 transition-colors hover:bg-foreground/10 hover:text-foreground"
        >
          <ArrowSquareOut size={13} weight="bold" />
          {t('apps.appStore.openPort')}
        </button>
        <button
          type="button"
          onClick={() => setCurrentPageId('launcher')}
          className="flex h-8 w-8 items-center justify-center rounded-full text-foreground/50 transition-colors hover:bg-foreground/10 hover:text-foreground"
          aria-label={t('common.close')}
          title={t('common.close')}
        >
          <X size={16} weight="bold" />
        </button>
      </div>

      {/* Body */}
      {external ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
          <p className="text-sm text-foreground/60">{t('os.launcher.appExternalHint')}</p>
          <button
            type="button"
            onClick={openExternal}
            className="flex items-center gap-2 rounded-full bg-accent px-6 py-3 text-sm font-semibold text-white shadow-lg transition-transform hover:scale-105"
          >
            {t('os.launcher.appExternalOpen')}
            <CaretRight size={16} weight="bold" />
          </button>
        </div>
      ) : frameSrc && state === APP_LIFECYCLE.RUNNING ? (
        <iframe
          key={frameSrc}
          ref={iframeRef}
          src={frameSrc}
          title={displayName}
          className="min-h-0 flex-1 border-0 bg-white"
          allow={iframeAllowFor(display)}
          sandbox={iframeSandboxFor(display)}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          {state === APP_LIFECYCLE.STARTING || state === APP_LIFECYCLE.STOPPING || !info ? (
            <>
              <span className="h-8 w-8 animate-spin rounded-full border-2 border-foreground/20 border-t-accent" />
              <p className="text-sm text-foreground/80">
                {state === APP_LIFECYCLE.STOPPING
                  ? t('os.launcher.appStopping')
                  : t('os.launcher.appStarting')}
              </p>
            </>
          ) : (
            <>
              <span
                className={`flex h-16 w-16 items-center justify-center rounded-3xl text-2xl font-bold shadow-xl ${
                  state === APP_LIFECYCLE.FAILED || state === APP_LIFECYCLE.UNHEALTHY
                    ? 'bg-red-500/15 text-red-300'
                    : 'bg-foreground/8 text-foreground/50'
                }`}
              >
                {(name || appId).charAt(0).toUpperCase()}
              </span>
              <p className="text-sm font-semibold text-foreground">{displayName}</p>
              <p className="max-w-sm text-xs leading-relaxed text-foreground/75">
                {state === APP_LIFECYCLE.FAILED && t('os.launcher.appFailed')}
                {state === APP_LIFECYCLE.UNHEALTHY && t('os.launcher.appUnhealthy')}
                {state === APP_LIFECYCLE.STOPPED && t('os.launcher.appStopped')}
                {state === APP_LIFECYCLE.NOT_FOUND && t('os.launcher.appNotFound')}
              </p>
              {info?.startable && (
                <button
                  type="button"
                  onClick={() => void startApp()}
                  disabled={busy}
                  className="mt-2 flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition-transform hover:scale-105 disabled:opacity-50"
                >
                  {busy ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  ) : (
                    <Play size={15} weight="fill" />
                  )}
                  {t('os.launcher.appStart')}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
