import { ArrowSquareOut, X } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { usePageNavigation } from '@/contexts/PageNavigationContext'

/**
 * AppRuntimeView – embeds an installed Docker app's web UI as an iframe
 * (CasaOS-style "open in place") instead of opening a new browser tab.
 * The slim toolbar offers "open in browser" + back to the launcher.
 */
export function AppRuntimeView({ appId, url, name }: { appId: string; url: string; name?: string }) {
  const { t } = useTranslation()
  const { setCurrentPageId } = usePageNavigation()

  // Apps render through the IORA app proxy: the RELATIVE url keeps the
  // iframe on the same origin (first-party cookies work) and the backend
  // strips X-Frame-Options/CSP, so apps like Nextcloud that forbid framing
  // can run inside the OS.
  const isDirectPort = /^https?:\/\/(localhost|127\.0\.0\.1):\d+/.test(url)
  const frameUrl = isDirectPort ? `/api/apps/${appId}/proxy/` : url

  return (
    <div className="fixed inset-x-0 bottom-0 top-14 z-[60] flex flex-col overflow-hidden bg-background/95 backdrop-blur-xl">
      {/* Toolbar */}
      <div className="flex min-h-12 shrink-0 items-center gap-3 border-b border-foreground/8 px-4">
        <span className="h-2 w-2 shrink-0 rounded-full bg-accent shadow-[0_0_8px_var(--accent)]" aria-hidden="true" />
        <span className="min-w-0 truncate text-xs font-semibold uppercase tracking-[0.16em] text-foreground/55">
          {name || appId}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => window.open(url, '_blank')}
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
      {/* Embedded app */}
      <iframe
        src={frameUrl}
        title={name || appId}
        className="min-h-0 flex-1 border-0 bg-white"
        allow="clipboard-read; clipboard-write; fullscreen"
      />
    </div>
  )
}
