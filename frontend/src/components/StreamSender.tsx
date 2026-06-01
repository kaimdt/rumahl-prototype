import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  VideoCamera, Microphone, MonitorPlay, Play, Stop,
  Eye, Circle, ArrowSquareOut, CaretDown, SpeakerHigh,
  Warning, CheckCircle, Gear, Broadcast, Monitor,
  Record, Camera, SlidersHorizontal, Info, Users,
  Clock, Waveform, Sparkle, ShareNetwork,
} from '@phosphor-icons/react'
import { Tip } from '@/components/ui/tip'
import { toast } from 'sonner'
import { getBackendUrl } from '@/lib/config'

type StreamMode = 'av' | 'video' | 'audio'
type VideoSourceType = 'camera' | 'screen'
type StreamState = 'idle' | 'connecting' | 'live' | 'error'

export function StreamSender() {
  const API_BASE = getBackendUrl()
  const [mode, setMode] = useState<StreamMode>('av')
  const [videoSource, setVideoSource] = useState<VideoSourceType>('camera')
  const [useMicAudio, setUseMicAudio] = useState(false)
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
  const [hasPreview, setHasPreview] = useState(false)
  const [bitrate, setBitrate] = useState(2500)

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const uptimeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const statsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const streamIdRef = useRef<string | null>(null)
  const animFrameRef = useRef<number>(0)
  const stateRef = useRef<StreamState>('idle')

  useEffect(() => { stateRef.current = state }, [state])

  // Load devices
  useEffect(() => {
    async function loadDevices() {
      try {
        const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true }).catch(() => null)
        if (tempStream) tempStream.getTracks().forEach(t => t.stop())
        const devices = await navigator.mediaDevices.enumerateDevices()
        setVideoDevices(devices.filter(d => d.kind === 'videoinput'))
        setAudioDevices(devices.filter(d => d.kind === 'audioinput'))
      } catch { /* devices may not be available */ }
    }
    loadDevices()
  }, [])

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

    try {
      let stream: MediaStream

      if (mode === 'audio') {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: selectedAudio ? { exact: selectedAudio } : undefined,
            echoCancellation: true,
            noiseSuppression: true,
          },
        })
      } else if (videoSource === 'screen') {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
        if (mode === 'av' || useMicAudio) {
          try {
            const micStream = await navigator.mediaDevices.getUserMedia({
              audio: { deviceId: selectedAudio ? { exact: selectedAudio } : undefined, echoCancellation: true, noiseSuppression: true },
            })
            const tracks = [...displayStream.getVideoTracks(), ...displayStream.getAudioTracks(), ...micStream.getAudioTracks()]
            stream = new MediaStream(tracks)
          } catch { stream = displayStream }
        } else { stream = displayStream }

        displayStream.getVideoTracks().forEach(track => {
          track.addEventListener('ended', () => {
            if (stateRef.current === 'live') stopStream()
            else {
              if (mediaStreamRef.current) { mediaStreamRef.current.getTracks().forEach(t => t.stop()); mediaStreamRef.current = null }
              if (videoRef.current) videoRef.current.srcObject = null
              setHasPreview(false)
            }
          })
        })
      } else {
        const resMap: Record<string, { w: number; h: number }> = { '480': { w: 854, h: 480 }, '720': { w: 1280, h: 720 }, '1080': { w: 1920, h: 1080 }, '1440': { w: 2560, h: 1440 }, '2160': { w: 3840, h: 2160 } }
        const res = resMap[quality] || resMap['720']
        const constraints: MediaStreamConstraints = {
          video: { deviceId: selectedVideo ? { exact: selectedVideo } : undefined, width: { ideal: res.w }, height: { ideal: res.h }, frameRate: { ideal: fps } },
        }
        if (mode !== 'video') {
          constraints.audio = { deviceId: selectedAudio ? { exact: selectedAudio } : undefined, echoCancellation: true, noiseSuppression: true }
        }
        const camStream = await navigator.mediaDevices.getUserMedia(constraints)
        if (useMicAudio && selectedAudio && mode !== 'video') {
          try {
            const micStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: selectedAudio }, echoCancellation: true, noiseSuppression: true } })
            stream = new MediaStream([...camStream.getVideoTracks(), ...micStream.getAudioTracks()])
            camStream.getAudioTracks().forEach(t => t.stop())
          } catch { stream = camStream }
        } else { stream = camStream }
      }

      mediaStreamRef.current = stream
      setHasPreview(true)
      if (videoRef.current) videoRef.current.srcObject = stream

      const audioTracks = stream.getAudioTracks()
      if (audioTracks.length > 0) {
        const ctx = new AudioContext()
        audioCtxRef.current = ctx
        const source = ctx.createMediaStreamSource(new MediaStream(audioTracks))
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 256
        source.connect(analyser)
        analyserRef.current = analyser
        updateAudioLevel()
      }
    } catch (e) {
      const msg = e instanceof DOMException && e.name === 'NotAllowedError'
        ? (videoSource === 'screen' ? 'Bildschirmfreigabe abgelehnt' : 'Kamera-/Mikrofon-Zugriff verweigert')
        : 'Medienquelle nicht verfügbar'
      setError(msg)
      setHasPreview(false)
      if (stateRef.current !== 'live') setState('error')
    }
  }, [mode, videoSource, useMicAudio, selectedVideo, selectedAudio, quality, fps])

  useEffect(() => {
    if (state === 'idle' && videoSource === 'screen') {
      if (mediaStreamRef.current) { mediaStreamRef.current.getTracks().forEach(t => t.stop()); mediaStreamRef.current = null }
      if (videoRef.current) videoRef.current.srcObject = null
      setHasPreview(false)
      return
    }
    if (state === 'idle') refreshPreview()
  }, [refreshPreview, state, videoSource])

  function updateAudioLevel() {
    if (!analyserRef.current) return
    const data = new Uint8Array(analyserRef.current.frequencyBinCount)
    analyserRef.current.getByteFrequencyData(data)
    const avg = data.reduce((a, b) => a + b, 0) / data.length
    setAudioLevel(Math.min(100, (avg / 128) * 100))
    if (mediaStreamRef.current) animFrameRef.current = requestAnimationFrame(updateAudioLevel)
  }

  const startStream = useCallback(async () => {
    try {
      setState('connecting')
      setError(null)
      if (!mediaStreamRef.current) await refreshPreview()
      if (!mediaStreamRef.current) { setState('error'); setError('Keine Medienquelle verfügbar'); return }

      const res = await fetch(`${API_BASE}/api/streams`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: streamName, description: `${videoSource === 'screen' ? 'screen' : mode} stream`, source_type: 'websocket_relay' }),
      })
      if (!res.ok) throw new Error('Stream konnte nicht erstellt werden')
      const data = await res.json()
      streamIdRef.current = data.stream.id

      let wsHost: string
      if (API_BASE) {
        try { wsHost = new URL(API_BASE).host } catch { wsHost = window.location.host }
      } else { wsHost = window.location.host }
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${proto}//${wsHost}/ws/stream/ingest`)
      ws.binaryType = 'arraybuffer'
      wsRef.current = ws

      ws.onopen = () => ws.send(JSON.stringify({ stream_id: data.stream.id, token: data.ingest_token }))
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data)
        if (msg.type === 'auth_ok') {
          setState('live')
          toast.success('Stream live!')
          startTimeRef.current = Date.now()
          uptimeIntervalRef.current = setInterval(() => setUptime(Math.floor((Date.now() - startTimeRef.current) / 1000)), 1000)
        } else if (msg.type === 'viewer_count') {
          setViewerCount(msg.count ?? 0)
        }
      }
      ws.onerror = () => { setState('error'); setError('WebSocket-Fehler'); stopStream() }
      ws.onclose = () => { if (stateRef.current === 'live') stopStream() }
    } catch (e) {
      setState('error')
      setError(e instanceof Error ? e.message : 'Unbekannter Fehler')
    }
  }, [API_BASE, mode, videoSource, streamName, refreshPreview])

  const stopStream = useCallback(() => {
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null }
    if (uptimeIntervalRef.current) { clearInterval(uptimeIntervalRef.current); uptimeIntervalRef.current = null }
    if (statsIntervalRef.current) { clearInterval(statsIntervalRef.current); statsIntervalRef.current = null }
    if (animFrameRef.current) { cancelAnimationFrame(animFrameRef.current); animFrameRef.current = 0 }
    setState('idle')
    setUptime(0)
    setViewerCount(0)
    setFrameCount(0)
    streamIdRef.current = null
  }, [])

  const startTimeRef = useRef(0)

  const formatUptime = (s: number) => {
    const m = Math.floor(s / 60)
    const ss = String(s % 60).padStart(2, '0')
    const h = Math.floor(m / 60)
    if (h > 0) return `${h}:${String(m % 60).padStart(2, '0')}:${ss}`
    return `${m}:${ss}`
  }

  const sourceLabel = videoSource === 'screen' ? 'Bildschirm' : 'Kamera'
  const modeLabel = mode === 'av' ? `${sourceLabel} + Audio` : mode === 'video' ? `Nur ${sourceLabel}` : 'Nur Audio'

  return (
    <div className="space-y-4 page-transition-enter max-w-4xl mx-auto">
      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="glass-card rounded-2xl border border-foreground/[0.06] p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-4">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 ring-1 transition-colors ${
              state === 'live' ? 'bg-red-500/15 ring-red-500/20' :
              state === 'connecting' ? 'bg-amber-500/15 ring-amber-500/20' :
              'bg-accent/10 ring-accent/10'
            }`}>
              <Broadcast size={26} weight="duotone" className={
                state === 'live' ? 'text-red-400' : state === 'connecting' ? 'text-amber-400' : 'text-accent'
              } />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Streaming</h1>
              <p className="text-sm text-foreground/50 mt-1">
                Kamera, Mikrofon oder Bildschirm live über IORA streamen
              </p>
            </div>
          </div>

          {state === 'live' && (
            <div className="flex items-center gap-3 px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/15">
              <Circle size={10} weight="fill" className="text-red-400 animate-pulse" />
              <span className="text-xs font-bold text-red-400 uppercase tracking-wider">LIVE</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Stream Controls Bar ───────────────────────────────────── */}
      <div className="glass-card rounded-2xl border border-foreground/[0.06] p-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Mode */}
          <div className="flex gap-1 p-1 rounded-xl bg-foreground/[0.04]">
            {([['av', VideoCamera], ['video', MonitorPlay], ['audio', Microphone]] as const).map(([m, Icon]) => (
              <button
                key={m}
                onClick={() => state === 'idle' && setMode(m as StreamMode)}
                disabled={state !== 'idle'}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-medium transition-all ${
                  mode === m ? 'bg-accent/15 text-accent' : 'text-foreground/40 hover:text-foreground/60'
                } disabled:opacity-40`}
              >
                <Icon size={16} weight={mode === m ? 'fill' : 'regular'} />
                <span className="hidden sm:inline">{m === 'av' ? 'AV' : m === 'video' ? 'Video' : 'Audio'}</span>
              </button>
            ))}
          </div>

          {/* Source (video only) */}
          {mode !== 'audio' && (
            <div className="flex gap-1 p-1 rounded-xl bg-foreground/[0.04]">
              <button
                onClick={() => state === 'idle' && setVideoSource('camera')}
                disabled={state !== 'idle'}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-medium transition-all ${
                  videoSource === 'camera' ? 'bg-accent/15 text-accent' : 'text-foreground/40 hover:text-foreground/60'
                } disabled:opacity-40`}
              >
                <Camera size={16} weight={videoSource === 'camera' ? 'fill' : 'regular'} />
                <span className="hidden sm:inline">Kamera</span>
              </button>
              <button
                onClick={() => state === 'idle' && setVideoSource('screen')}
                disabled={state !== 'idle'}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-medium transition-all ${
                  videoSource === 'screen' ? 'bg-accent/15 text-accent' : 'text-foreground/40 hover:text-foreground/60'
                } disabled:opacity-40`}
              >
                <Monitor size={16} weight={videoSource === 'screen' ? 'fill' : 'regular'} />
                <span className="hidden sm:inline">Bildschirm</span>
              </button>
            </div>
          )}

          {/* Start/Stop */}
          <div className="flex items-center justify-end gap-2">
            {state === 'live' && (
              <div className="hidden sm:flex items-center gap-3 mr-3 text-[11px] text-foreground/40">
                <span className="flex items-center gap-1"><Eye size={12} /> {viewerCount}</span>
                <span className="flex items-center gap-1"><Clock size={12} /> {formatUptime(uptime)}</span>
              </div>
            )}
            <button
              onClick={state === 'live' ? stopStream : startStream}
              disabled={state === 'connecting'}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${
                state === 'live'
                  ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25 border border-red-500/20'
                  : state === 'connecting'
                  ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                  : 'bg-accent text-white hover:bg-accent/90 shadow-sm shadow-accent/20'
              } disabled:opacity-50`}
            >
              {state === 'live' ? <><Stop size={16} weight="fill" /> Stop</> :
               state === 'connecting' ? <><Sparkle size={16} className="animate-spin" /> Verbinde…</> :
               <><Play size={16} weight="fill" /> Start</>}
            </button>
          </div>
        </div>

        {/* Mobile stats bar when live */}
        {state === 'live' && (
          <div className="flex sm:hidden items-center gap-4 mt-3 pt-3 border-t border-foreground/[0.06] text-[11px] text-foreground/40">
            <span className="flex items-center gap-1"><Eye size={12} /> {viewerCount} Zuschauer</span>
            <span className="flex items-center gap-1"><Clock size={12} /> {formatUptime(uptime)}</span>
          </div>
        )}
      </div>

      {/* ── Preview ───────────────────────────────────────────────── */}
      {mode !== 'audio' && (
        <div className="glass-card rounded-2xl border border-foreground/[0.06] overflow-hidden p-1">
          <div className="rounded-xl overflow-hidden bg-black/30 aspect-video relative">
            <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-contain" />
            <canvas ref={canvasRef} className="hidden" />
            {state === 'live' && (
              <div className="absolute top-3 left-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600/90 backdrop-blur-sm text-white text-[11px] font-bold shadow-lg">
                <Circle size={8} weight="fill" className="animate-pulse" />
                LIVE · {formatUptime(uptime)}
              </div>
            )}
            {videoSource === 'screen' && state === 'idle' && !hasPreview && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/50 backdrop-blur-sm">
                <Monitor size={40} weight="duotone" className="text-foreground/20" />
                <button onClick={refreshPreview} className="px-5 py-2.5 rounded-xl bg-accent/20 hover:bg-accent/30 text-accent text-sm font-medium transition-all border border-accent/20">
                  Bildschirm / Fenster auswählen
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Audio Meter ────────────────────────────────────────────── */}
      {mode !== 'video' && (
        <div className="glass-card rounded-2xl border border-foreground/[0.06] p-4">
          <div className="flex items-center gap-3">
            <Waveform size={18} weight="duotone" className="text-foreground/40" />
            <div className="flex-1 h-2 bg-foreground/[0.06] rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-accent to-emerald-400"
                animate={{ width: `${audioLevel}%` }}
                transition={{ duration: 0.05 }}
              />
            </div>
            <span className="text-[10px] text-foreground/30 w-8 text-right tabular-nums">{Math.round(audioLevel)}%</span>
          </div>
        </div>
      )}

      {/* ── Settings ───────────────────────────────────────────────── */}
      <div className="glass-card rounded-2xl border border-foreground/[0.06]">
        <button
          onClick={() => setShowSettings(!showSettings)}
          disabled={state !== 'idle'}
          className="w-full flex items-center justify-between p-4 text-sm font-medium text-foreground/60 hover:text-foreground transition-colors disabled:opacity-40"
        >
          <span className="flex items-center gap-2">
            <SlidersHorizontal size={16} />
            Stream-Einstellungen
          </span>
          <CaretDown size={14} className={`transition-transform ${showSettings ? 'rotate-180' : ''}`} />
        </button>

        <AnimatePresence>
          {showSettings && state === 'idle' && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-4 space-y-4 border-t border-foreground/[0.06] pt-4">
                {/* Stream Name */}
                <div>
                  <label className="text-[10px] font-semibold text-foreground/40 uppercase tracking-wider mb-1.5 block">Stream-Name</label>
                  <input
                    type="text"
                    value={streamName}
                    onChange={e => setStreamName(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl bg-foreground/[0.04] border border-foreground/[0.08] text-sm text-foreground placeholder:text-foreground/30 outline-none focus:border-accent/30 transition-colors"
                    placeholder="Mein Stream"
                  />
                </div>

                {/* Quality + FPS */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-semibold text-foreground/40 uppercase tracking-wider mb-1.5 block">Qualität</label>
                    <select
                      value={quality}
                      onChange={e => setQuality(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl bg-foreground/[0.04] border border-foreground/[0.08] text-sm text-foreground outline-none focus:border-accent/30 transition-colors"
                    >
                      <option value="480">480p</option>
                      <option value="720">720p (HD)</option>
                      <option value="1080">1080p (Full HD)</option>
                      <option value="1440">1440p (2K)</option>
                      <option value="2160">2160p (4K)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-foreground/40 uppercase tracking-wider mb-1.5 block">Bildrate</label>
                    <select
                      value={fps}
                      onChange={e => setFps(Number(e.target.value))}
                      className="w-full px-3 py-2.5 rounded-xl bg-foreground/[0.04] border border-foreground/[0.08] text-sm text-foreground outline-none focus:border-accent/30 transition-colors"
                    >
                      <option value={15}>15 FPS</option>
                      <option value={24}>24 FPS</option>
                      <option value={30}>30 FPS</option>
                      <option value={60}>60 FPS</option>
                    </select>
                  </div>
                </div>

                {/* Device Selection */}
                {videoDevices.length > 0 && mode !== 'audio' && (
                  <div>
                    <label className="text-[10px] font-semibold text-foreground/40 uppercase tracking-wider mb-1.5 block">Kamera</label>
                    <select
                      value={selectedVideo}
                      onChange={e => setSelectedVideo(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl bg-foreground/[0.04] border border-foreground/[0.08] text-sm text-foreground outline-none focus:border-accent/30 transition-colors"
                    >
                      <option value="">Standard</option>
                      {videoDevices.map(d => (
                        <option key={d.deviceId} value={d.deviceId}>{d.label || `Kamera ${d.deviceId.slice(0, 8)}`}</option>
                      ))}
                    </select>
                  </div>
                )}

                {audioDevices.length > 0 && mode !== 'video' && (
                  <div>
                    <label className="text-[10px] font-semibold text-foreground/40 uppercase tracking-wider mb-1.5 block">Mikrofon</label>
                    <select
                      value={selectedAudio}
                      onChange={e => setSelectedAudio(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl bg-foreground/[0.04] border border-foreground/[0.08] text-sm text-foreground outline-none focus:border-accent/30 transition-colors"
                    >
                      <option value="">Standard</option>
                      {audioDevices.map(d => (
                        <option key={d.deviceId} value={d.deviceId}>{d.label || `Mikrofon ${d.deviceId.slice(0, 8)}`}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Error Display ──────────────────────────────────────────── */}
      {error && (state === 'error' || state === 'idle') && (
        <div className="p-4 rounded-2xl bg-red-500/[0.05] border border-red-500/15 flex items-start gap-3">
          <Warning size={18} weight="fill" className="text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-400">Stream-Fehler</p>
            <p className="text-xs text-red-400/70 mt-0.5">{error}</p>
            <button
              onClick={() => { setError(null); setState('idle'); }}
              className="mt-2 text-xs text-red-400/50 hover:text-red-400 underline transition-colors"
            >
              Fehler zurücksetzen
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
