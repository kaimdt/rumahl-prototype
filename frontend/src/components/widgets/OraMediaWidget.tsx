import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowClockwise, FilmStrip, PlayCircle, Television } from '@phosphor-icons/react'
import { authFetch } from '@/lib/authHelpers'

/**
 * rumahl media widget — continue watching from Jellyfin (Package 6, Media Hub).
 * Shows the user's resume items and the detected media servers.
 */

interface MediaItem {
  id: string
  title: string
  series?: string
  season?: number
  episode?: number
  progress_percent?: number
  provider?: string
  image_url?: string | null
}

interface MediaHub {
  jellyfin: { reachable: boolean; name?: string | null; url?: string; configured?: boolean }
  plex: { reachable: boolean; name?: string | null; url?: string; configured?: boolean }
}

export function OraMediaWidget() {
  const { t } = useTranslation()
  const [items, setItems] = useState<MediaItem[]>([])
  const [hub, setHub] = useState<MediaHub | null>(null)
  const [configured, setConfigured] = useState(false)

  const load = useCallback(async () => {
    try {
      const [hubResponse, watchingResponse] = await Promise.all([
        authFetch('/api/media/hub'),
        authFetch('/api/media/continue-watching'),
      ])
      if (hubResponse.ok) setHub(await hubResponse.json())
      if (watchingResponse.ok) {
        const data = await watchingResponse.json()
        setItems(data.items || [])
        setConfigured(Boolean(data.configured))
      }
    } catch {
      // offline
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(load, 30_000)
    return () => window.clearInterval(timer)
  }, [load])

  const servers = [
    ...(hub?.jellyfin.reachable ? [hub.jellyfin] : []),
    ...(hub?.plex.reachable ? [hub.plex] : []),
  ]

  return (
    <div className="h-full w-full rounded-3xl border border-white/8 bg-foreground/4 p-4">
      <div className="flex items-center gap-2">
        <FilmStrip size={16} className="text-accent" />
        <span className="text-xs font-semibold uppercase tracking-wide text-foreground/60">{t('widgets.oraMedia.title')}</span>
        <button type="button" onClick={() => void load()} className="ml-auto rounded p-1 text-foreground/40 hover:text-foreground" title={t('widgets.oraMedia.refresh')}>
          <ArrowClockwise size={12} />
        </button>
      </div>

      {items.length > 0 ? (
        <div className="mt-2 space-y-2">
          {items.map((item) => {
            const label = item.series
              ? `${item.series}${item.season ? ` · S${item.season}` : ''}${item.episode ? `E${item.episode}` : ''}`
              : item.title
            const progress = item.progress_percent ?? 0
            return (
              <div key={item.id} className="rounded-xl bg-white/4 px-3 py-2">
                <div className="flex items-center gap-2">
                  {item.image_url ? (
                    <img src={item.image_url} alt="" className="size-7 shrink-0 rounded-md object-cover" />
                  ) : (
                    <PlayCircle size={14} className="shrink-0 text-accent" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-foreground/85">{item.title}</p>
                    {item.series && <p className="truncate text-[10px] text-foreground/45">{label}</p>}
                  </div>
                  {item.provider && (
                    <span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-foreground/40">
                      {item.provider === 'plex' ? 'Plex' : 'Jellyfin'}
                    </span>
                  )}
                  <span className="shrink-0 text-[10px] tabular-nums text-foreground/45">{Math.round(progress)}%</span>
                </div>
                <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-foreground/10">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(progress, 100)}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="mt-3 text-xs text-foreground/40">
          {configured ? t('widgets.oraMedia.empty') : t('widgets.oraMedia.notConfigured')}
        </p>
      )}

      {servers.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {servers.map((server) => (
            <span key={server.name || server.url} className="flex items-center gap-1.5 rounded-full bg-accent/12 px-2 py-1 text-[10px] font-semibold text-accent">
              <Television size={11} />
              {server.name || t('widgets.oraMedia.mediaServer')}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
