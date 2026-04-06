import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  VideoCamera,
  Microphone,
  MonitorPlay,
  Play,
  Stop,
  Eye,
  Circle,
  ArrowSquareOut,
  CaretDown,
  SpeakerHigh,
  Warning,
  CheckCircle,
  Gear,
  Broadcast,
} from '@phosphor-icons/react'

type StreamMode = 'av' | 'video' | 'audio'
type StreamState = 'idle' | 'connecting' | 'live' | 'error'

interface StreamInfo {
  id: string
  name: string
  status: string
  viewer_count: number
}

export function StreamSender() {
  const API_BASE = import.meta.env.VITE_BACKEND_URL || ''
  const [mode, setMode] = useState<StreamMode>('av')
  const [state, setState] = useState<StreamState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([])
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedVideo, setSelectedVideo] = useState('')
  const [selectedAudio, setSelectedAudio] = useState('')
  const [quality, setQuality] = useState('720')
  const [fps, setFps] = useState(24)
  const [streamName, setStreamName] = useState('Mein Stream')
  const [frameCount, setFrameCount] = useState(0)
  const [viewerCount, setViewerCount] = useState(0)
  const [uptime, setUptime] = useState(0)
  const [audioLevel, setAudioLevel] = useState(0)
  const [showSettings, setShowSettings] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const uptimeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const statusPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const statsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const videoRecorderRef = useRef<MediaRecorder | null>(null)
  const audioRecorderRef = useRef<MediaRecorder | null>(null)
  const recorderRestartRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const streamIdRef = useRef<string | null>(null)
  const startTimeRef = useRef<number>(0)
  const frameCountRef = useRef(0)
  const animFrameRef = useRef<number>(0)
  const stateRef = useRef<StreamState>('idle')
  const snapshotIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Keep ref in sync
  useEffect(() => { stateRef.current = state }, [state])

  // Load devices
  useEffect(() => {
    async function loadDevices() {
      try {
        // Request permission to get labels
        const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true }).catch(() => null)
        if (tempStream) tempStream.getTracks().forEach(t => t.stop())

        const devices = await navigator.mediaDevices.enumerateDevices()
        setVideoDevices(devices.filter(d => d.kind === 'videoinput'))
        setAudioDevices(devices.filter(d => d.kind === 'audioinput'))
      } catch {
        // Silently handle - devices may not be available
      }
    }
    loadDevices()
  }, [])

  // Preview media stream
  const refreshPreview = useCallback(async () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop())
      mediaStreamRef.current = null
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close()
      audioCtxRef.current = null
      analyserRef.current = null
    }

    const constraints: MediaStreamConstraints = {}
    if (mode !== 'audio') {
      const resMap: Record<string, { w: number; h: number }> = { '480': { w: 854, h: 480 }, '720': { w: 1280, h: 720 }, '1080': { w: 1920, h: 1080 }, '1440': { w: 2560, h: 1440 }, '2160': { w: 3840, h: 2160 } }
      const res = resMap[quality] || resMap['720']
      constraints.video = {
        deviceId: selectedVideo ? { exact: selectedVideo } : undefined,
        width: { ideal: res.w },
        height: { ideal: res.h },
        frameRate: { ideal: fps },
      }
    }
    if (mode !== 'video') {
      constraints.audio = {
        deviceId: selectedAudio ? { exact: selectedAudio } : undefined,
        echoCancellation: true,
        noiseSuppression: true,
      }
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      mediaStreamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream

      // Audio meter
      if (mode !== 'video' && stream.getAudioTracks().length > 0) {
        const ctx = new AudioContext()
        audioCtxRef.current = ctx
        const source = ctx.createMediaStreamSource(stream)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 256
        source.connect(analyser)
        analyserRef.current = analyser
        updateAudioLevel()
      }
    } catch {
      setError('Kamera/Mikrofon-Zugriff verweigert')
    }
  }, [mode, selectedVideo, selectedAudio, quality, fps])

  useEffect(() => {
    if (state === 'idle') refreshPreview()
  }, [refreshPreview, state])

  function updateAudioLevel() {
    if (!analyserRef.current) return
    const data = new Uint8Array(analyserRef.current.frequencyBinCount)
    analyserRef.current.getByteFrequencyData(data)
    const avg = data.reduce((a, b) => a + b, 0) / data.length
    setAudioLevel(Math.min(100, (avg / 128) * 100))
    if (mediaStreamRef.current) {
      animFrameRef.current = requestAnimationFrame(updateAudioLevel)
    }
  }

  // Start stream
  const startStream = useCallback(async () => {
    try {
      setState('connecting')
      setError(null)

      if (!mediaStreamRef.current) await refreshPreview()
      if (!mediaStreamRef.current) {
        setState('error')
        setError('Keine Medienquelle verfügbar')
        return
      }

      // Create stream via API
      const res = await fetch(`${API_BASE}/api/streams`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: streamName, description: `${mode} stream`, source_type: 'websocket_relay' }),
      })
      if (!res.ok) throw new Error('Stream konnte nicht erstellt werden')
      const data = await res.json()
      const streamId = data.stream.id
      const token = data.ingest_token
      streamIdRef.current = streamId

      // Connect WebSocket
      let wsHost: string
      if (API_BASE) {
        try { wsHost = new URL(API_BASE).host } catch { wsHost = window.location.host }
      } else {
        wsHost = window.location.host
      }
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${proto}//${wsHost}/ws/stream/ingest`)
      ws.binaryType = 'arraybuffer'
      wsRef.current = ws

      ws.onopen = () => {
        ws.send(JSON.stringify({ stream_id: streamId, token }))
      }

      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data)
        if (msg.type === 'auth_ok') {
          setState('live')
          startCapture()
          startTimeRef.current = Date.now()
          frameCountRef.current = 0

          // Uptime counter
          uptimeIntervalRef.current = setInterval(() => {
            setUptime(Math.floor((Date.now() - startTimeRef.current) / 1000))
          }, 1000)

          // Viewer count polling
          statusPollRef.current = setInterval(async () => {
            try {
              const r = await fetch(`${API_BASE}/api/streams/${streamId}`)
              if (r.ok) {
                const d = await r.json()
                setViewerCount(d.stream?.viewer_count || 0)
              }
            } catch { /* ignore */ }
          }, 3000)
        } else if (msg.type === 'auth_failed') {
          setState('error')
          setError('Authentifizierung fehlgeschlagen')
          ws.close()
        }
      }

      ws.onerror = () => {
        setState('error')
        setError('WebSocket-Verbindung fehlgeschlagen')
      }
      ws.onclose = () => {
        // Use ref to avoid stale closure over state
        if (stateRef.current === 'live') stopStream()
      }
    } catch (e) {
      setState('error')
      setError(e instanceof Error ? e.message : 'Unbekannter Fehler')
    }
  }, [mode, streamName, refreshPreview])

  function startCapture() {
    if (!mediaStreamRef.current) return
    const ws = wsRef.current
    if (!ws) return

    // Determine what tracks to record
    const hasVideo = mode !== 'audio' && mediaStreamRef.current.getVideoTracks().length > 0
    const hasAudio = mode !== 'video' && mediaStreamRef.current.getAudioTracks().length > 0

    if (hasVideo) {
      // Use MediaRecorder for smooth video (+ audio if mode is 'av')
      const tracks: MediaStreamTrack[] = [...mediaStreamRef.current.getVideoTracks()]
      if (hasAudio && mode === 'av') {
        tracks.push(...mediaStreamRef.current.getAudioTracks())
      }
      const recordStream = new MediaStream(tracks)

      // Pick best supported codec
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
        ? 'video/webm;codecs=vp9,opus'
        : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
          ? 'video/webm;codecs=vp8,opus'
          : 'video/webm'

      const bitrateMap: Record<string, number> = { '480': 1000000, '720': 2500000, '1080': 5000000, '1440': 10000000, '2160': 20000000 }
      const recorder = new MediaRecorder(recordStream, {
        mimeType,
        videoBitsPerSecond: bitrateMap[quality] || 2500000,
        audioBitsPerSecond: 128000,
      })

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0 && wsRef.current?.readyState === WebSocket.OPEN) {
          // Backpressure: skip if WS send buffer is too full
          if (wsRef.current.bufferedAmount < 524288) {
            e.data.arrayBuffer().then(buf => {
              wsRef.current?.send(buf)
              frameCountRef.current++
            })
          }
        }
      }

      // Emit chunks every 100ms for smooth low-latency streaming
      recorder.start(100)
      videoRecorderRef.current = recorder

      // Restart MediaRecorder every 3s to force a fresh keyframe + init segment.
      // This ensures new viewers can always start decoding from a recent keyframe
      // instead of getting stale init data that causes decode errors.
      recorderRestartRef.current = setInterval(() => {
        const mr = videoRecorderRef.current
        if (mr && mr.state === 'recording') {
          try {
            mr.stop()
            mr.start(100)
          } catch { /* recorder was already stopped */ }
        }
      }, 3000)

      // Update frame count display periodically
      statsIntervalRef.current = setInterval(() => {
        setFrameCount(frameCountRef.current)
      }, 500)
    }

    // Audio-only mode: record audio separately
    if (mode === 'audio' && hasAudio) {
      const audioStream = new MediaStream(mediaStreamRef.current.getAudioTracks())
      const audioMime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'
      const recorder = new MediaRecorder(audioStream, {
        mimeType: audioMime,
        audioBitsPerSecond: 128000,
      })
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0 && wsRef.current?.readyState === WebSocket.OPEN && wsRef.current.bufferedAmount < 65536) {
          e.data.arrayBuffer().then(buf => {
            wsRef.current?.send(buf)
            frameCountRef.current++
          })
        }
      }
      recorder.start(250)
      audioRecorderRef.current = recorder

      statsIntervalRef.current = setInterval(() => {
        setFrameCount(frameCountRef.current)
      }, 500)
    }

    // Periodic snapshot capture for feed view (every 2 seconds)
    if (hasVideo && streamIdRef.current) {
      const captureStreamId = streamIdRef.current
      snapshotIntervalRef.current = setInterval(() => {
        const video = videoRef.current
        const canvas = canvasRef.current
        if (!video || !canvas || video.videoWidth === 0) return
        canvas.width = Math.min(video.videoWidth, 640)
        canvas.height = Math.round(canvas.width * (video.videoHeight / video.videoWidth))
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        canvas.toBlob(blob => {
          if (blob) {
            fetch(`${API_BASE}/api/streams/${captureStreamId}/snapshot`, {
              method: 'POST',
              body: blob,
            }).catch(() => {})
          }
        }, 'image/jpeg', 0.7)
      }, 2000)
    }
  }

  const stopStream = useCallback(async () => {
    if (uptimeIntervalRef.current) { clearInterval(uptimeIntervalRef.current); uptimeIntervalRef.current = null }
    if (statusPollRef.current) { clearInterval(statusPollRef.current); statusPollRef.current = null }
    if (statsIntervalRef.current) { clearInterval(statsIntervalRef.current); statsIntervalRef.current = null }
    if (snapshotIntervalRef.current) { clearInterval(snapshotIntervalRef.current); snapshotIntervalRef.current = null }
    if (recorderRestartRef.current) { clearInterval(recorderRestartRef.current); recorderRestartRef.current = null }
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    if (videoRecorderRef.current) { try { videoRecorderRef.current.stop() } catch {} videoRecorderRef.current = null }
    if (audioRecorderRef.current) { try { audioRecorderRef.current.stop() } catch {} audioRecorderRef.current = null }
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null }

    if (streamIdRef.current) {
      try { await fetch(`${API_BASE}/api/streams/${streamIdRef.current}`, { method: 'DELETE' }) } catch {}
      streamIdRef.current = null
    }

    setState('idle')
    setFrameCount(0)
    setViewerCount(0)
    setUptime(0)
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mediaStreamRef.current) mediaStreamRef.current.getTracks().forEach(t => t.stop())
      if (audioCtxRef.current) audioCtxRef.current.close()
      if (uptimeIntervalRef.current) clearInterval(uptimeIntervalRef.current)
      if (statusPollRef.current) clearInterval(statusPollRef.current)
      if (statsIntervalRef.current) clearInterval(statsIntervalRef.current)
      if (recorderRestartRef.current) clearInterval(recorderRestartRef.current)
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
      if (videoRecorderRef.current) try { videoRecorderRef.current.stop() } catch {}
      if (audioRecorderRef.current) try { audioRecorderRef.current.stop() } catch {}
      if (wsRef.current) wsRef.current.close()
      // Don't delete stream on unmount - it might still be in use
    }
  }, [])

  const formatUptime = (s: number) => {
    const m = Math.floor(s / 60)
    const ss = String(s % 60).padStart(2, '0')
    const h = Math.floor(m / 60)
    if (h > 0) return `${h}:${String(m % 60).padStart(2, '0')}:${ss}`
    return `${m}:${ss}`
  }

  const modeLabel = mode === 'av' ? 'Video + Audio' : mode === 'video' ? 'Nur Video' : 'Nur Audio'

  return (
    <div className="glass-card rounded-2xl p-5 sm:p-6 page-transition-enter">
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-xl font-semibold text-foreground flex items-center gap-2">
              <Broadcast size={22} weight="duotone" className="text-accent" />
              Stream Sender
            </h3>
            <p className="text-xs text-foreground/40 mt-1">Kamera & Mikrofon direkt über IORA streamen</p>
          </div>
          <button
            onClick={() => window.open('/api/streams/sender', '_blank')}
            className="flex items-center gap-1.5 text-[10px] text-foreground/40 hover:text-foreground/60 transition-colors"
            title="Standalone Sender-Seite öffnen (z.B. für OBS)"
          >
            <ArrowSquareOut size={14} />
            Standalone
          </button>
        </div>

        {/* Status Bar */}
        <div className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl border ${
          state === 'live' ? 'bg-emerald-500/10 border-emerald-500/20' :
          state === 'error' ? 'bg-red-500/10 border-red-500/20' :
          state === 'connecting' ? 'bg-amber-500/10 border-amber-500/20' :
          'bg-foreground/[0.04] border-foreground/8'
        }`}>
          <div className={`w-2 h-2 rounded-full ${
            state === 'live' ? 'bg-emerald-400 animate-pulse' :
            state === 'error' ? 'bg-red-400' :
            state === 'connecting' ? 'bg-amber-400 animate-pulse' :
            'bg-foreground/30'
          }`} />
          <span className={`text-xs font-medium ${
            state === 'live' ? 'text-emerald-400' :
            state === 'error' ? 'text-red-400' :
            state === 'connecting' ? 'text-amber-400' :
            'text-foreground/50'
          }`}>
            {state === 'live' ? `LIVE — ${modeLabel}` :
             state === 'error' ? (error || 'Fehler') :
             state === 'connecting' ? 'Verbinde...' :
             'Bereit'}
          </span>
          {state === 'live' && (
            <div className="flex items-center gap-3 ml-auto text-[10px] text-foreground/40">
              <span>{frameCount} Frames</span>
              <span className="flex items-center gap-1"><Eye size={12} /> {viewerCount}</span>
              <span>{formatUptime(uptime)}</span>
            </div>
          )}
        </div>

        {/* Mode Selection */}
        <div className="grid grid-cols-3 gap-2">
          {([['av', 'Video + Audio', MonitorPlay], ['video', 'Nur Video', VideoCamera], ['audio', 'Nur Audio', Microphone]] as const).map(([m, label, Icon]) => (
            <button
              key={m}
              onClick={() => state === 'idle' && setMode(m as StreamMode)}
              disabled={state !== 'idle'}
              className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all ${
                mode === m ? 'border-accent/40 bg-accent/10 text-accent' : 'border-foreground/8 bg-foreground/[0.03] text-foreground/50 hover:bg-foreground/[0.06]'
              } disabled:opacity-50`}
            >
              <Icon size={20} weight={mode === m ? 'duotone' : 'regular'} />
              <span className="text-[10px] font-medium">{label}</span>
            </button>
          ))}
        </div>

        {/* Preview */}
        {mode !== 'audio' && (
          <div className="rounded-xl overflow-hidden bg-black/40 border border-foreground/8 aspect-video relative">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="w-full h-full object-contain"
            />
            <canvas ref={canvasRef} className="hidden" />
            {state === 'live' && (
              <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2 py-1 rounded-md bg-red-600/90 text-white text-[10px] font-bold">
                <Circle size={8} weight="fill" className="animate-pulse" />
                LIVE
              </div>
            )}
          </div>
        )}

        {/* Audio Meter */}
        {mode !== 'video' && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <SpeakerHigh size={14} className="text-foreground/40" />
              <span className="text-[10px] text-foreground/40">Audio-Pegel</span>
            </div>
            <div className="h-1.5 bg-foreground/10 rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-accent"
                animate={{ width: `${audioLevel}%` }}
                transition={{ duration: 0.05 }}
              />
            </div>
          </div>
        )}

        {/* Settings (collapsible) */}
        <button
          onClick={() => setShowSettings(!showSettings)}
          disabled={state !== 'idle'}
          className="flex items-center gap-2 text-xs text-foreground/50 hover:text-foreground/70 transition-colors disabled:opacity-50"
        >
          <Gear size={14} />
          Einstellungen
          <CaretDown size={12} className={`transition-transform ${showSettings ? 'rotate-180' : ''}`} />
        </button>

        <AnimatePresence>
          {showSettings && state === 'idle' && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden space-y-3"
            >
              {/* Stream Name */}
              <div>
                <label className="text-[11px] text-foreground/50 block mb-1">Stream-Name</label>
                <input
                  type="text"
                  value={streamName}
                  onChange={e => setStreamName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-foreground/[0.04] border border-foreground/10 text-sm text-foreground focus:outline-none focus:border-accent/40 transition-all"
                />
              </div>

              {/* Video Device */}
              {mode !== 'audio' && videoDevices.length > 0 && (
                <div>
                  <label className="text-[11px] text-foreground/50 block mb-1">Kamera</label>
                  <select
                    value={selectedVideo}
                    onChange={e => setSelectedVideo(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-foreground/[0.04] border border-foreground/10 text-sm text-foreground focus:outline-none focus:border-accent/40 transition-all"
                  >
                    {videoDevices.map((d, i) => (
                      <option key={d.deviceId} value={d.deviceId}>{d.label || `Kamera ${i + 1}`}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Audio Device */}
              {mode !== 'video' && audioDevices.length > 0 && (
                <div>
                  <label className="text-[11px] text-foreground/50 block mb-1">Mikrofon</label>
                  <select
                    value={selectedAudio}
                    onChange={e => setSelectedAudio(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-foreground/[0.04] border border-foreground/10 text-sm text-foreground focus:outline-none focus:border-accent/40 transition-all"
                  >
                    {audioDevices.map((d, i) => (
                      <option key={d.deviceId} value={d.deviceId}>{d.label || `Mikrofon ${i + 1}`}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Quality & FPS */}
              {mode !== 'audio' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-foreground/50 block mb-1">Qualität</label>
                    <select
                      value={quality}
                      onChange={e => setQuality(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-foreground/[0.04] border border-foreground/10 text-sm text-foreground focus:outline-none focus:border-accent/40 transition-all"
                    >
                      <option value="480">480p</option>
                      <option value="720">720p</option>
                      <option value="1080">1080p</option>
                      <option value="1440">1440p (2K)</option>
                      <option value="2160">2160p (4K)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] text-foreground/50 block mb-1">FPS</label>
                    <select
                      value={fps}
                      onChange={e => setFps(Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-lg bg-foreground/[0.04] border border-foreground/10 text-sm text-foreground focus:outline-none focus:border-accent/40 transition-all"
                    >
                      <option value={15}>15</option>
                      <option value={24}>24</option>
                      <option value={30}>30</option>
                      <option value={48}>48</option>
                      <option value={60}>60</option>
                    </select>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Start/Stop Button */}
        {state === 'idle' || state === 'error' ? (
          <button
            onClick={startStream}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-accent text-white font-semibold text-sm hover:brightness-110 transition-all"
          >
            <Play size={18} weight="fill" />
            Stream starten
          </button>
        ) : state === 'connecting' ? (
          <button disabled className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-foreground/10 text-foreground/40 font-semibold text-sm">
            <div className="w-4 h-4 border-2 border-foreground/20 border-t-accent rounded-full animate-spin" />
            Verbinde...
          </button>
        ) : (
          <button
            onClick={stopStream}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-red-600 text-white font-semibold text-sm hover:bg-red-700 transition-all"
          >
            <Stop size={18} weight="fill" />
            Stream beenden
          </button>
        )}
      </div>
    </div>
  )
}

export default StreamSender
