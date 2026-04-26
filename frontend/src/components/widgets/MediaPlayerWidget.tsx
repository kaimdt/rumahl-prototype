import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { SpeakerHigh, Play, Pause, SkipBack, SkipForward, SpeakerSimpleSlash, ArrowsOutSimple, Stop } from '@phosphor-icons/react'
import type { MediaPlayerEntity } from '@/lib/types'
import { haService } from '@/lib/homeAssistant'
import { haptics } from '@/lib/haptics'
import { toBackendImageUrl } from '@/lib/imageUrl'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useTheme } from '@/contexts/ThemeContext'

const LIGHT_THEMES = new Set(['day', 'light'])

interface MediaPlayerWidgetProps {
  entity: MediaPlayerEntity
  onUpdate?: () => void
  widgetSize?: { w: number; h: number }
}

const ACTIVE_STATES = new Set(['playing', 'buffering'])
const PLAYING_STATES = new Set(['playing', 'buffering'])
const TICKING_STATES = new Set(['playing', 'buffering', 'on'])
function getAuthToken(): string {
  const raw = localStorage.getItem('ha-auth-token') ?? sessionStorage.getItem('ha-auth-token')
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed === 'string') return parsed
    if (parsed && typeof parsed === 'object') {
      const token = (parsed as Record<string, unknown>).token
      const accessToken = (parsed as Record<string, unknown>).access_token
      if (typeof token === 'string') return token
      if (typeof accessToken === 'string') return accessToken
    }
    return ''
  } catch {
    return raw
  }
}

function formatTime(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(safe / 60)
  const seconds = safe % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function toSafeTimestamp(raw: unknown): number {
  if (!raw) return Date.now()
  const parsed = Date.parse(String(raw))
  return Number.isFinite(parsed) ? parsed : Date.now()
}

export function MediaPlayerWidget({ entity, onUpdate, widgetSize }: MediaPlayerWidgetProps) {
  const [isUpdating, setIsUpdating] = useState(false)
  const [liveNow, setLiveNow] = useState(Date.now())
  const [detailOpen, setDetailOpen] = useState(false)
  const [resolvedCoverUrl, setResolvedCoverUrl] = useState<string | null>(null)
  const { theme: currentTheme } = useTheme()
  const isLightTheme = LIGHT_THEMES.has(currentTheme)

  const name = String(entity.attributes.friendly_name || entity.entity_id)
  const mediaTitle = String(entity.attributes.media_title || '')
  const mediaArtist = String(entity.attributes.media_artist || '')
  const mediaAlbum = String(entity.attributes.media_album_name || '')
  const state = entity.state
  const isActive = ACTIVE_STATES.has(state)
  const isPlaying = PLAYING_STATES.has(state)
  const isTicking = TICKING_STATES.has(state)
  const isMuted = Boolean(entity.attributes.is_volume_muted)
  const volume = Math.round(Math.max(0, Math.min(1, entity.attributes.volume_level ?? 0)) * 100)
  const mediaDuration = Number(entity.attributes.media_duration || 0)
  const mediaPosition = Number(entity.attributes.media_position || 0)
  const mediaPositionUpdatedAt = toSafeTimestamp(entity.attributes.media_position_updated_at)
  const coverUrl = toBackendImageUrl(entity.attributes.entity_picture)
  const [localVolume, setLocalVolume] = useState(volume)

  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false

    const resolveCover = async () => {
      if (!coverUrl) {
        setResolvedCoverUrl(null)
        return
      }

      const token = getAuthToken()
      if (!token) {
        setResolvedCoverUrl(coverUrl)
        return
      }

      try {
        const res = await fetch(coverUrl, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: 'no-store',
        })
        if (!res.ok) {
          // Keep a direct URL fallback for setups that already expose cover images publicly.
          setResolvedCoverUrl(coverUrl)
          return
        }
        const blob = await res.blob()
        objectUrl = URL.createObjectURL(blob)
        if (!cancelled) setResolvedCoverUrl(objectUrl)
      } catch {
        if (!cancelled) setResolvedCoverUrl(coverUrl)
      }
    }

    void resolveCover()

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [coverUrl])

  useEffect(() => {
    setLocalVolume(volume)
  }, [volume])

  useEffect(() => {
    if (!isTicking) return
    const timer = window.setInterval(() => setLiveNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [isTicking])

  const livePosition = useMemo(() => {
    if (!isTicking) return mediaPosition
    const elapsed = Math.max(0, (liveNow - mediaPositionUpdatedAt) / 1000)
    return Math.min(mediaDuration || Infinity, mediaPosition + elapsed)
  }, [isTicking, liveNow, mediaDuration, mediaPosition, mediaPositionUpdatedAt])

  const progressPercent = mediaDuration > 0
    ? Math.round((Math.max(0, Math.min(mediaDuration, livePosition)) / mediaDuration) * 100)
    : 0

  const subtitle = useMemo(() => {
    if (mediaTitle && mediaArtist) return `${mediaTitle} - ${mediaArtist}`
    if (mediaTitle) return mediaTitle
    return state
  }, [mediaArtist, mediaTitle, state])

  const runAction = async (action: () => Promise<void>, successLabel: string) => {
    if (isUpdating) return
    setIsUpdating(true)
    haptics.impact('medium')
    try {
      await action()
      haptics.notification('success')
      toast.success(successLabel)
      onUpdate?.()
    } catch {
      haptics.notification('error')
      toast.error('Media Player konnte nicht gesteuert werden')
    } finally {
      setIsUpdating(false)
    }
  }

  const togglePlayPause = () => runAction(
    () => haService.mediaPlayPause(entity.entity_id),
    isPlaying ? 'Wiedergabe pausiert' : 'Wiedergabe gestartet'
  )

  const handleCoverError = () => {
    // Blob URLs can fail when they expire; fall back once to the direct cover URL.
    if (resolvedCoverUrl?.startsWith('blob:') && coverUrl && coverUrl !== resolvedCoverUrl) {
      setResolvedCoverUrl(coverUrl)
    }
  }

  const beginVolumeDrag = (container: HTMLDivElement, clientX: number) => {
    if (isUpdating) return
    const rect = container.getBoundingClientRect()
    let draftPercent = localVolume
    const updateFromPointer = (x: number) => {
      const ratio = Math.max(0, Math.min(1, (x - rect.left) / rect.width))
      draftPercent = Math.round(ratio * 100)
      setLocalVolume(draftPercent)
    }

    updateFromPointer(clientX)

    const onMove = (moveEvent: PointerEvent) => updateFromPointer(moveEvent.clientX)
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      const percent = Math.max(0, Math.min(100, draftPercent))
      void runAction(() => haService.mediaSetVolume(entity.entity_id, percent / 100), `Lautstaerke ${percent}%`)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const Controls = ({ size = 'compact' }: { size?: 'compact' | 'large' }) => {
    const buttonClass = size === 'large'
      ? 'h-11 rounded-2xl text-sm'
      : 'h-9 rounded-xl text-xs'

    return (
      <div className="grid grid-cols-4 gap-2">
        <button
          onClick={() => runAction(() => haService.mediaPreviousTrack(entity.entity_id), 'Vorheriger Titel')}
          disabled={isUpdating}
          className={`${buttonClass} bg-foreground/6 hover:bg-foreground/12 text-foreground/80 font-medium transition-colors disabled:opacity-40 flex items-center justify-center`}
          title="Vorheriger Titel"
        >
          <SkipBack size={16} weight="fill" />
        </button>
        <button
          onClick={togglePlayPause}
          disabled={isUpdating}
          className={`${buttonClass} bg-accent/14 hover:bg-accent/22 text-accent font-semibold transition-colors disabled:opacity-40 flex items-center justify-center`}
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? <Pause size={16} weight="fill" /> : <Play size={16} weight="fill" />}
        </button>
        <button
          onClick={() => runAction(() => haService.mediaNextTrack(entity.entity_id), 'Naechster Titel')}
          disabled={isUpdating}
          className={`${buttonClass} bg-foreground/6 hover:bg-foreground/12 text-foreground/80 font-medium transition-colors disabled:opacity-40 flex items-center justify-center`}
          title="Naechster Titel"
        >
          <SkipForward size={16} weight="fill" />
        </button>
        <button
          onClick={() => runAction(() => haService.mediaStop(entity.entity_id), 'Wiedergabe gestoppt')}
          disabled={isUpdating}
          className={`${buttonClass} bg-foreground/6 hover:bg-foreground/12 text-foreground/80 font-medium transition-colors disabled:opacity-40 flex items-center justify-center`}
          title="Stop"
        >
          <Stop size={16} weight="fill" />
        </button>
      </div>
    )
  }

  const ProgressBar = ({ tall = false }: { tall?: boolean }) => (
    <div className="space-y-1.5">
      <div
        className={`relative ${tall ? 'h-2.5' : 'h-1.5'} rounded-full bg-foreground/15 overflow-hidden cursor-pointer`}
        onClick={(e) => {
          if (!mediaDuration || isUpdating) return
          const rect = e.currentTarget.getBoundingClientRect()
          const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
          const seekTo = ratio * mediaDuration
          void runAction(() => haService.mediaSeek(entity.entity_id, seekTo), `Position ${formatTime(seekTo)}`)
        }}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${progressPercent}%`,
            background: 'linear-gradient(90deg, var(--accent), color-mix(in oklch, var(--accent) 65%, white))',
          }}
        />
      </div>
      <div className="flex items-center justify-between text-[10px] text-foreground/45 font-mono">
        <span>{formatTime(livePosition)}</span>
        <span>{mediaDuration > 0 ? formatTime(mediaDuration) : '--:--'}</span>
      </div>
    </div>
  )

  const VolumeBar = ({ big = false }: { big?: boolean }) => (
    <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
      <div
        className={`relative ${big ? 'h-11 rounded-2xl' : 'h-9 rounded-xl'} border border-foreground/12 bg-foreground/6 overflow-hidden`}
        onPointerDown={(e) => beginVolumeDrag(e.currentTarget, e.clientX)}
      >
        <div
          className="absolute inset-y-0 left-0"
          style={{
            width: `${localVolume}%`,
            background: 'linear-gradient(90deg, color-mix(in oklch, var(--accent) 45%, transparent), var(--accent))',
          }}
        />
        <div
          className={`absolute top-1/2 -translate-y-1/2 ${big ? 'w-1.5 h-7' : 'w-1 h-6'} rounded-full bg-white/90`}
          style={{
            left: `clamp(2px, calc(${localVolume}% - 2px), calc(100% - 4px))`,
            boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
          }}
        />
        <div className={`absolute inset-0 flex items-center justify-center ${big ? 'text-xs' : 'text-[11px]'} text-foreground/72 font-medium`}>
          Lautstaerke {localVolume}%
        </div>
      </div>
      <button
        onClick={() => runAction(() => haService.mediaSetMute(entity.entity_id, !isMuted), isMuted ? 'Stumm aus' : 'Stumm an')}
        disabled={isUpdating}
        className={`${big ? 'w-11 h-11 rounded-2xl' : 'w-9 h-9 rounded-xl'} bg-foreground/6 hover:bg-foreground/12 text-foreground/75 transition-colors disabled:opacity-40 flex items-center justify-center`}
        title={isMuted ? 'Stumm aus' : 'Stumm an'}
      >
        <SpeakerSimpleSlash size={big ? 16 : 14} weight={isMuted ? 'fill' : 'regular'} />
      </button>
    </div>
  )

  return (
    <motion.div
      className="glass-card rounded-2xl theme-transition relative overflow-hidden"
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
    >
      {resolvedCoverUrl && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `url(${resolvedCoverUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            filter: isLightTheme
              ? 'blur(22px) saturate(1.2) brightness(1.15)'
              : 'blur(22px) saturate(1.3) brightness(0.7)',
            opacity: isLightTheme ? 0.35 : 0.45,
            transform: 'scale(1.14)',
          }}
        />
      )}

      <div className={`absolute inset-0 pointer-events-none bg-gradient-to-b ${isLightTheme ? 'from-white/30 via-white/15 to-white/40' : 'from-black/25 via-black/10 to-black/45'}`} />

      <div className="relative p-4 sm:p-5 space-y-3">
        <div className={`rounded-2xl backdrop-blur-md p-3 ${isLightTheme ? 'bg-white/20 border border-black/8' : 'bg-black/15 border border-white/10'}`}>
          <div className="flex items-center gap-3">
            <div
              className="p-2.5 rounded-xl transition-all duration-300"
              style={{
                backgroundColor: isActive
                  ? 'oklch(from var(--accent) l c h / 0.3)'
                  : 'oklch(from var(--muted) l c h / 0.5)',
                color: isActive ? 'var(--accent)' : 'var(--muted-foreground)',
              }}
            >
              <SpeakerHigh size={20} weight={isActive ? 'fill' : 'regular'} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-[0.16em] text-foreground/60">Now Playing</p>
              <h3 className="text-sm sm:text-base font-semibold text-foreground truncate">{mediaTitle || name}</h3>
              <p className="text-xs text-foreground/82 truncate">{mediaArtist || subtitle}</p>
              {mediaAlbum && <p className="text-[11px] text-foreground/66 truncate">{mediaAlbum}</p>}
            </div>
            {resolvedCoverUrl ? (
              <button
                onClick={() => setDetailOpen(true)}
                className="relative group"
                title="Now Playing oeffnen"
              >
                <img
                  src={resolvedCoverUrl}
                  alt={mediaTitle || name}
                  className="w-14 h-14 rounded-xl object-cover border border-foreground/15 shadow-md"
                  onError={handleCoverError}
                />
                <span className="absolute inset-0 rounded-xl bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                  <ArrowsOutSimple size={13} className="opacity-0 group-hover:opacity-100 text-white transition-opacity" />
                </span>
              </button>
            ) : (
              <span className="text-[11px] text-foreground/70">{volume}%</span>
            )}
          </div>
        </div>

        <div className="rounded-2xl bg-black/15 border border-white/10 backdrop-blur-md p-3 space-y-3">
          <ProgressBar />

          <Controls />

          <VolumeBar />
        </div>
      </div>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-3xl p-0 overflow-hidden">
          <DialogTitle className="sr-only">Now Playing</DialogTitle>
          <div className="relative">
            {resolvedCoverUrl ? (
              <div
                className="h-64 sm:h-80 w-full"
                style={{
                  backgroundImage: `url(${resolvedCoverUrl})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }}
              />
            ) : (
              <div className="h-64 sm:h-80 w-full bg-gradient-to-br from-accent/25 via-foreground/10 to-transparent" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-black/5" />
            <div className="absolute left-5 right-5 bottom-5 flex items-end gap-4">
              {resolvedCoverUrl && (
                <img
                  src={resolvedCoverUrl}
                  alt={mediaTitle || name}
                  className="hidden sm:block w-24 h-24 rounded-2xl object-cover border border-white/20 shadow-xl"
                  onError={handleCoverError}
                />
              )}
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/75">Now Playing</p>
                <h3 className="text-xl sm:text-2xl font-semibold text-white truncate">{mediaTitle || name}</h3>
                <p className="text-sm text-white/85 truncate">{mediaArtist || name}</p>
                {mediaAlbum && <p className="text-xs text-white/70 truncate">{mediaAlbum}</p>}
              </div>
            </div>
          </div>

          <div className="p-4 sm:p-6 space-y-5 bg-card/92 backdrop-blur-xl">
            <ProgressBar tall />
            <Controls size="large" />
            <VolumeBar big />

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="rounded-xl bg-foreground/6 border border-foreground/10 px-3 py-2">
                <p className="text-foreground/45">Status</p>
                <p className="font-medium capitalize">{state}</p>
              </div>
              <div className="rounded-xl bg-foreground/6 border border-foreground/10 px-3 py-2">
                <p className="text-foreground/45">Position</p>
                <p className="font-medium">{formatTime(livePosition)} / {mediaDuration > 0 ? formatTime(mediaDuration) : '--:--'}</p>
              </div>
              <div className="rounded-xl bg-foreground/6 border border-foreground/10 px-3 py-2">
                <p className="text-foreground/45">Lautstaerke</p>
                <p className="font-medium">{localVolume}%</p>
              </div>
              <div className="rounded-xl bg-foreground/6 border border-foreground/10 px-3 py-2">
                <p className="text-foreground/45">Ton</p>
                <p className="font-medium">{isMuted ? 'Stumm' : 'Aktiv'}</p>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </motion.div>
  )
}
