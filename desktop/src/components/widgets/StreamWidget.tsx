import { memo, useEffect, useRef, useState, useCallback } from 'react'
import { VideoCamera, Play, Pause, Eye, WifiHigh, WifiSlash, ArrowsOut, ArrowsIn, SpeakerHigh, SpeakerSlash, SpeakerLow, FilmStrip, Circle, X, PictureInPicture } from '@phosphor-icons/react'
import { motion, AnimatePresence } from 'framer-motion'
import { Tip } from '@/components/ui/tip'

interface StreamWidgetProps {
  config?: Record<string, unknown>
  widgetSize?: { w: number; h: number }
}

type StreamInfo = {
  id: string
  name: string
  description: string
  status: 'waiting' | 'live' | 'stopped'
  source_type: 'websocket_relay' | 'external_url'
  source_url?: string
  viewer_count: number
}

export const StreamWidget = memo(function StreamWidget({ config, widgetSize }: StreamWidgetProps) {
  const [streams, setStreams] = useState<StreamInfo[]>([])
  const [selectedStreamId, setSelectedStreamId] = useState<string | null>(
    (config?.streamId as string) || null
  )
  const [isConnected, setIsConnected] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isCinemaMode, setIsCinemaMode] = useState(false)
  const [showOverlay, setShowOverlay] = useState(true)
  const [isMuted, setIsMuted] = useState(true)
  const [volume, setVolume] = useState(0.8)
  const [isPaused, setIsPaused] = useState(false)
  const [showVolumeSlider, setShowVolumeSlider] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const mediaSourceRef = useRef<MediaSource | null>(null)
  const sourceBufferRef = useRef<SourceBuffer | null>(null)
  const bufferQueueRef = useRef<ArrayBuffer[]>([])
  const containerRef = useRef<HTMLDivElement>(null)
  const overlayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wsRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wsRetryCountRef = useRef(0)

  const API_BASE = import.meta.env.VITE_BACKEND_URL || ''
  const streamsJsonRef = useRef('')

  // Fetch available streams (only update state when data actually changes)
  const fetchStreams = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/streams`)
      if (res.ok) {
        const data = await res.json()
        const incoming = data.streams || []
        const json = JSON.stringify(incoming)
        if (json !== streamsJsonRef.current) {
          streamsJsonRef.current = json
          setStreams(incoming)
        }
      }
    } catch {
      // Silently fail — will retry
    }
  }, [API_BASE])

  useEffect(() => {
    fetchStreams()
    const interval = setInterval(fetchStreams, 5000)
    return () => clearInterval(interval)
  }, [fetchStreams])

  // Auto-select stream from config or first live stream, and clear stale selections
  useEffect(() => {
    if (streams.length === 0) return
    // If current selection is still valid, keep it
    if (selectedStreamId && streams.find(s => s.id === selectedStreamId)) return
    // Auto-select: prefer live stream, fall back to first available
    const live = streams.find(s => s.status === 'live')
    setSelectedStreamId(live ? live.id : streams[0].id)
  }, [streams, selectedStreamId])

  const selectedStream = streams.find(s => s.id === selectedStreamId)
  const sourceTypeRef = useRef(selectedStream?.source_type)
  sourceTypeRef.current = selectedStream?.source_type

  // Force video.muted on mount (React muted prop is unreliable)
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = true
  }, [])

  // ─── WebSocket Live Stream Connection ─────────────────────────
  useEffect(() => {
    if (!selectedStreamId) return
    if (sourceTypeRef.current === 'external_url') return

    let cancelled = false
    let isAppending = false
    let hasStartedPlayback = false
    let isInErrorState = false
    let isReconnecting = false
    let recoveryTimer: ReturnType<typeof setTimeout> | null = null

    // Flush queued buffers — merge all pending chunks into one appendBuffer call
    function flushQueue() {
      if (isInErrorState) return
      const sb = sourceBufferRef.current
      const ms = mediaSourceRef.current
      const video = videoRef.current
      if (!sb || !ms || ms.readyState !== 'open' || bufferQueueRef.current.length === 0) return
      // Guard against appending while SourceBuffer is busy (appendBuffer OR remove in progress)
      if (isAppending || sb.updating) return
      // If the video element is in an error state, stop trying
      if (video?.error) {
        console.warn('[StreamWidget] video.error detected, stopping appends:', video.error.message)
        isInErrorState = true
        return
      }

      const chunks = bufferQueueRef.current.splice(0)
      let totalLen = 0
      for (const c of chunks) totalLen += c.byteLength
      if (totalLen === 0) return
      const merged = new Uint8Array(totalLen)
      let offset = 0
      for (const c of chunks) {
        merged.set(new Uint8Array(c), offset)
        offset += c.byteLength
      }

      isAppending = true
      try {
        sb.appendBuffer(merged)
      } catch (e) {
        isAppending = false
        console.warn('[StreamWidget] appendBuffer failed:', e)
        // Don't keep retrying — enter error state
        isInErrorState = true
      }
    }

    function cleanupMediaSource() {
      isAppending = false
      hasStartedPlayback = false
      // Detach SourceBuffer ref first to prevent further appends
      sourceBufferRef.current = null
      bufferQueueRef.current = []
      const ms = mediaSourceRef.current
      mediaSourceRef.current = null
      // Don't call endOfStream() — it causes DEMUXER_ERROR if called before
      // HAVE_METADATA. The removeAttribute('src') + load() below fully resets.
      // Clear the video source to fully reset the media pipeline
      if (videoRef.current) {
        videoRef.current.onerror = null
        videoRef.current.removeAttribute('src')
        videoRef.current.load()
      }
    }

    // Ensure playback starts — call after data is available in the buffer
    function ensurePlayback() {
      const video = videoRef.current
      if (!video || cancelled) return
      video.muted = true
      if (video.paused && !video.error) {
        video.play().catch(() => {
          // Retry a few times with increasing delay
          const retries = [200, 500, 1000]
          retries.forEach((delay) => {
            setTimeout(() => {
              if (video.paused && !cancelled && !video.error) {
                video.muted = true
                video.play().catch(() => {})
              }
            }, delay)
          })
        })
      }
    }

    function setupMediaSource() {
      cleanupMediaSource()
      const video = videoRef.current
      if (!window.MediaSource || !video) return

      video.muted = true

      // Detect video element errors (decode failures, codec mismatches)
      video.onerror = () => {
        if (isInErrorState) return // Already handling an error
        const err = video.error
        console.warn('[StreamWidget] video element error:', err?.code, err?.message)
        isInErrorState = true
        if (!cancelled) {
          setIsConnected(false)
          scheduleReconnect()
        }
      }

      const ms = new MediaSource()
      mediaSourceRef.current = ms
      video.src = URL.createObjectURL(ms)

      ms.addEventListener('sourceopen', () => {
        if (cancelled || isInErrorState) return
        // Verify this is still the active MediaSource (not a stale one from a previous cycle)
        if (mediaSourceRef.current !== ms || ms.readyState !== 'open') return
        try {
          const mimeType = MediaSource.isTypeSupported('video/webm; codecs="vp9, opus"')
            ? 'video/webm; codecs="vp9, opus"'
            : MediaSource.isTypeSupported('video/webm; codecs="vp8, opus"')
              ? 'video/webm; codecs="vp8, opus"'
              : 'video/webm'

          const sb = ms.addSourceBuffer(mimeType)
          sourceBufferRef.current = sb
          sb.mode = 'sequence'

          sb.addEventListener('updateend', () => {
            isAppending = false
            if (isInErrorState || cancelled) return
            try {
              if (video && !video.error && sb.buffered.length > 0) {
                const end = sb.buffered.end(sb.buffered.length - 1)

                // Start playback after first successful append
                if (!hasStartedPlayback) {
                  hasStartedPlayback = true
                  if (recoveryTimer) { clearTimeout(recoveryTimer); recoveryTimer = null }
                  video.currentTime = Math.max(0, end - 0.1)
                  ensurePlayback()
                }

                // Stay within 1.5s of live edge
                if (end - video.currentTime > 2) {
                  video.currentTime = end - 0.3
                }
                // Evict old data to prevent memory bloat (keep ~8s)
                const start = sb.buffered.start(0)
                if (end - start > 10 && !sb.updating) {
                  try { sb.remove(start, end - 8) } catch {}
                  return // remove triggers another updateend
                }
              }
            } catch { /* detached */ }
            flushQueue()
          })

          sb.addEventListener('error', () => {
            if (isInErrorState) return // Already handling an error
            // Enter error state immediately to stop all further appends
            isInErrorState = true
            console.warn('[StreamWidget] SourceBuffer error — will reconnect')
            if (!cancelled) {
              cleanupMediaSource()
              setIsConnected(false)
              scheduleReconnect()
            }
          })

          // Flush queued data that arrived before sourceopen
          flushQueue()

          // Recovery: if no frames render within 5s, reconnect
          if (recoveryTimer) clearTimeout(recoveryTimer)
          recoveryTimer = setTimeout(() => {
            const video = videoRef.current
            if (cancelled || isInErrorState) return
            if (video && video.readyState < 2 && !video.error) {
              console.warn('[StreamWidget] No frames decoded after 5s — reconnecting')
              isInErrorState = true
              cleanupMediaSource()
              setIsConnected(false)
              scheduleReconnect()
            }
          }, 5000)
        } catch (e) {
          console.warn('[StreamWidget] MediaSource setup failed:', e)
        }
      })
    }

    function connect() {
      if (cancelled) return

      let wsHost: string
      if (API_BASE) {
        try { wsHost = new URL(API_BASE).host } catch { wsHost = window.location.host }
      } else {
        wsHost = window.location.host
      }
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${protocol}//${wsHost}/ws/stream/watch`)
      wsRef.current = ws
      ws.binaryType = 'arraybuffer'

      ws.onopen = () => {
        wsRetryCountRef.current = 0
        ws.send(JSON.stringify({ type: 'watch', stream_id: selectedStreamId }))
      }

      ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          try {
            const msg = JSON.parse(event.data)
            if (msg.type === 'watching') {
              setIsConnected(true)
              setError(null)
              setupMediaSource()
            } else if (msg.type === 'error') {
              setError(msg.message)
              setIsConnected(false)
            } else if (msg.type === 'stream_ended') {
              setIsConnected(false)
              cleanupMediaSource()
              scheduleReconnect()
            }
          } catch { /* parse error */ }
        } else if (event.data instanceof ArrayBuffer) {
          if (isInErrorState) return
          // Detect new WebM init segment (EBML magic bytes: 1A 45 DF A3).
          // The sender's MediaRecorder restarts every ~3s, producing a brand-new
          // WebM file each time.  If we blindly merge the new init header into
          // an existing appendBuffer the demuxer chokes on the mid-stream EBML
          // element and throws PIPELINE_ERROR_DECODE.
          //
          // Fix: discard any queued data from the previous recording session and
          // call SourceBuffer.abort() to reset the WebM byte-stream parser.
          // The new init segment then becomes the first thing the parser sees,
          // and in 'sequence' mode the timestamps continue seamlessly.
          const bytes = new Uint8Array(event.data)
          const isInitSegment =
            bytes.length >= 4 &&
            bytes[0] === 0x1A && bytes[1] === 0x45 &&
            bytes[2] === 0xDF && bytes[3] === 0xA3

          if (isInitSegment) {
            // Drop everything still in the queue — it belongs to the old session
            bufferQueueRef.current = []
            const sb = sourceBufferRef.current
            if (sb && mediaSourceRef.current?.readyState === 'open') {
              try {
                sb.abort()          // resets parser; safe even while updating
              } catch { /* readyState changed between check and call */ }
              isAppending = false   // abort cancels any in-flight appendBuffer
            }
          }

          bufferQueueRef.current.push(event.data)
          flushQueue()
        }
      }

      ws.onclose = () => {
        if (!cancelled) {
          setIsConnected(false)
          scheduleReconnect()
        }
      }

      ws.onerror = () => { /* onclose fires after this */ }
    }

    function scheduleReconnect() {
      if (cancelled || isReconnecting) return
      isReconnecting = true
      // Clean up everything before reconnecting
      isInErrorState = true // Stop all appends during teardown
      if (recoveryTimer) { clearTimeout(recoveryTimer); recoveryTimer = null }
      cleanupMediaSource()
      if (wsRef.current) {
        try { wsRef.current.close() } catch {}
        wsRef.current = null
      }
      const delay = Math.min(1000 * Math.pow(2, wsRetryCountRef.current), 8000)
      wsRetryCountRef.current++
      wsRetryRef.current = setTimeout(() => {
        isReconnecting = false
        isInErrorState = false
        if (!cancelled) connect()
      }, delay)
    }

    connect()

    return () => {
      cancelled = true
      if (recoveryTimer) { clearTimeout(recoveryTimer); recoveryTimer = null }
      if (wsRetryRef.current) { clearTimeout(wsRetryRef.current); wsRetryRef.current = null }
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null }
      setIsConnected(false)
      cleanupMediaSource()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStreamId, API_BASE])

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {})
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {})
    }
  }, [])

  const toggleCinemaMode = useCallback(() => {
    setIsCinemaMode(prev => !prev)
  }, [])

  const toggleMute = useCallback(() => {
    if (videoRef.current) {
      const next = !isMuted
      videoRef.current.muted = next
      setIsMuted(next)
      if (!next) videoRef.current.volume = volume
    }
  }, [isMuted, volume])

  const handleVolumeChange = useCallback((val: number) => {
    setVolume(val)
    if (videoRef.current) {
      videoRef.current.volume = val
      if (val === 0) {
        videoRef.current.muted = true
        setIsMuted(true)
      } else if (isMuted) {
        videoRef.current.muted = false
        setIsMuted(false)
      }
    }
  }, [isMuted])

  const togglePause = useCallback(() => {
    if (!videoRef.current) return
    if (videoRef.current.paused) {
      videoRef.current.play().catch(() => {})
      setIsPaused(false)
    } else {
      videoRef.current.pause()
      setIsPaused(true)
    }
  }, [])

  const togglePiP = useCallback(async () => {
    if (!videoRef.current) return
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture()
      } else {
        await videoRef.current.requestPictureInPicture()
      }
    } catch {}
  }, [])

  const resetOverlayTimer = useCallback(() => {
    setShowOverlay(true)
    if (overlayTimeoutRef.current) clearTimeout(overlayTimeoutRef.current)
    overlayTimeoutRef.current = setTimeout(() => {
      if (isConnected && !isPaused) setShowOverlay(false)
    }, 3000)
  }, [isConnected, isPaused])

  useEffect(() => {
    return () => { if (overlayTimeoutRef.current) clearTimeout(overlayTimeoutRef.current) }
  }, [])

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  const isExpandedView = isFullscreen || isCinemaMode

  if (streams.length === 0) {
    return (
      <div className="h-full min-h-[280px] flex flex-col items-center justify-center gap-2 text-foreground/40 p-4">
        <VideoCamera size={28} weight="duotone" className="opacity-50" />
        <p className="text-xs text-center">Kein Stream verfügbar</p>
        <p className="text-[10px] text-foreground/25">Erstelle einen Stream über die API</p>
      </div>
    )
  }

  const cinemaBackdrop = isCinemaMode && !isFullscreen ? (
    <div className="fixed inset-0 bg-black/85 z-[9998] cursor-pointer" onClick={toggleCinemaMode} />
  ) : null

  return (
    <>
      {cinemaBackdrop}
      <div
        ref={containerRef}
        className={`h-full min-h-[280px] flex flex-col overflow-hidden ${
          isCinemaMode && !isFullscreen
            ? 'fixed inset-x-0 top-[5%] bottom-[5%] max-w-[90vw] mx-auto z-[9999] rounded-2xl shadow-2xl shadow-black/60 border border-white/10'
            : ''
        } ${isFullscreen ? 'bg-black' : ''}`}
        onMouseMove={resetOverlayTimer}
        onMouseEnter={resetOverlayTimer}
      >
        <div className="flex-1 relative bg-black/30 group min-h-0">
          {selectedStream?.source_type === 'external_url' && selectedStream.source_url ? (
            <video
              src={selectedStream.source_url}
              autoPlay muted playsInline controls={false}
              className="w-full h-full object-contain"
            />
          ) : (
            <>
              <video
                ref={videoRef}
                autoPlay muted playsInline
                onClick={togglePause}
                className="w-full h-full object-contain cursor-pointer absolute inset-0"
              />
              <AnimatePresence>
                {!isConnected && (
                  <motion.div
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="absolute inset-0 flex flex-col items-center justify-center gap-3"
                  >
                    <motion.div
                      animate={{ scale: [1, 1.15, 1] }}
                      transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                    >
                      <VideoCamera size={32} weight="duotone" className="text-foreground/20" />
                    </motion.div>
                    {error ? (
                      <p className="text-xs text-red-400/60">{error}</p>
                    ) : selectedStream?.status === 'waiting' ? (
                      <p className="text-xs text-foreground/30">Warte auf Stream-Quelle...</p>
                    ) : (
                      <p className="text-xs text-foreground/30">Verbinde...</p>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}

          {/* Video Overlay */}
          <AnimatePresence>
            {(showOverlay || !isConnected || isPaused) && (
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="absolute inset-0 flex flex-col justify-between pointer-events-none"
              >
                {/* Top bar */}
                <div className="bg-gradient-to-b from-black/70 via-black/30 to-transparent px-3 py-2.5 pointer-events-auto">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <VideoCamera size={14} weight="duotone" className="text-white/70 shrink-0" />
                      <span className="text-xs font-medium text-white/90 truncate">
                        {selectedStream?.name || 'Stream'}
                      </span>
                      {selectedStream?.status === 'live' && (
                        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-600/90 text-[9px] font-bold uppercase text-white">
                          <Circle size={6} weight="fill" className="animate-pulse" />
                          LIVE
                        </span>
                      )}
                      {selectedStream?.status === 'waiting' && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-medium uppercase bg-amber-500/30 text-amber-300">
                          Warten
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {selectedStream && (
                        <span className="text-[10px] text-white/50 flex items-center gap-1">
                          <Eye size={11} />
                          {selectedStream.viewer_count}
                        </span>
                      )}
                      {isConnected ? (
                        <WifiHigh size={13} className="text-emerald-400/80" />
                      ) : (
                        <WifiSlash size={13} className="text-white/30" />
                      )}
                      {isCinemaMode && !isFullscreen && (
                        <Tip content="Kinomodus beenden">
                          <button onClick={toggleCinemaMode}
                            className="p-1 rounded hover:bg-white/10 text-white/50 hover:text-white/80 transition-colors">
                            <X size={14} />
                          </button>
                        </Tip>
                      )}
                    </div>
                  </div>
                </div>

                {/* Center play/pause */}
                <AnimatePresence>
                  {isPaused && isConnected && (
                    <motion.div
                      initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 1.5, opacity: 0 }} transition={{ duration: 0.3 }}
                      className="absolute inset-0 flex items-center justify-center pointer-events-auto cursor-pointer"
                      onClick={togglePause}
                    >
                      <div className="w-16 h-16 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center border border-white/10">
                        <Play size={28} weight="fill" className="text-white ml-1" />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Bottom controls */}
                <div className="bg-gradient-to-t from-black/80 via-black/40 to-transparent px-3 py-2.5 pointer-events-auto">
                  {isConnected && (
                    <div className="w-full h-[3px] bg-white/10 rounded-full mb-2.5 overflow-hidden">
                      <motion.div className="h-full bg-red-500 rounded-full"
                        animate={{ width: isPaused ? '60%' : '100%' }} transition={{ duration: 0.3 }} />
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      {isConnected && (
                        <Tip content={isPaused ? 'Wiedergabe' : 'Pause'}>
                          <button onClick={togglePause}
                            className="p-1.5 rounded-lg hover:bg-white/10 text-white/80 hover:text-white transition-colors">
                            {isPaused ? <Play size={18} weight="fill" /> : <Pause size={18} weight="fill" />}
                          </button>
                        </Tip>
                      )}
                      <div className="flex items-center gap-1 relative"
                        onMouseEnter={() => setShowVolumeSlider(true)}
                        onMouseLeave={() => setShowVolumeSlider(false)}>
                        <Tip content={isMuted ? 'Ton an' : 'Ton aus'}>
                          <button onClick={toggleMute}
                            className="p-1.5 rounded-lg hover:bg-white/10 text-white/80 hover:text-white transition-colors">
                            {isMuted ? <SpeakerSlash size={18} /> : volume < 0.5 ? <SpeakerLow size={18} /> : <SpeakerHigh size={18} />}
                          </button>
                        </Tip>
                        <AnimatePresence>
                          {showVolumeSlider && (
                            <motion.div
                              initial={{ width: 0, opacity: 0 }} animate={{ width: 70, opacity: 1 }}
                              exit={{ width: 0, opacity: 0 }} transition={{ duration: 0.15 }}
                              className="overflow-hidden flex items-center">
                              <input type="range" min={0} max={1} step={0.05}
                                value={isMuted ? 0 : volume}
                                onChange={e => handleVolumeChange(Number(e.target.value))}
                                className="w-full h-1 accent-white cursor-pointer"
                                style={{ accentColor: 'white' }} />
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                      {isConnected && !isPaused && (
                        <span className="text-[10px] font-semibold text-red-400 uppercase tracking-wider ml-1">
                          ● LIVE
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-0.5">
                      {document.pictureInPictureEnabled && (
                        <Tip content="Bild-in-Bild">
                          <button onClick={togglePiP}
                            className="p-1.5 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors">
                            <PictureInPicture size={16} />
                          </button>
                        </Tip>
                      )}
                      <Tip content={isCinemaMode ? 'Kinomodus beenden' : 'Kinomodus'}>
                        <button onClick={toggleCinemaMode}
                          className={`p-1.5 rounded-lg hover:bg-white/10 transition-colors ${
                            isCinemaMode ? 'text-accent' : 'text-white/60 hover:text-white'
                          }`}>
                          <FilmStrip size={16} />
                        </button>
                      </Tip>
                      <Tip content={isFullscreen ? 'Vollbild beenden' : 'Vollbild'}>
                        <button onClick={toggleFullscreen}
                          className="p-1.5 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors">
                          {isFullscreen ? <ArrowsIn size={16} /> : <ArrowsOut size={16} />}
                        </button>
                      </Tip>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Stream selector */}
        {streams.length > 1 && !isExpandedView && (
          <div className="flex items-center gap-1 px-2 py-1.5 border-t border-white/5 overflow-x-auto">
            {streams.filter(s => s.status !== 'stopped').map((stream) => (
              <button
                key={stream.id}
                onClick={() => setSelectedStreamId(stream.id)}
                className={`px-2 py-1 rounded text-[10px] font-medium transition-colors whitespace-nowrap ${
                  stream.id === selectedStreamId
                    ? 'bg-white/10 text-foreground/80'
                    : 'text-foreground/40 hover:text-foreground/60 hover:bg-white/5'
                }`}
              >
                {stream.name}
                {stream.status === 'live' && (
                  <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-red-400" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  )
})

export default StreamWidget
