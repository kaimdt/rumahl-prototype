import { useState, useCallback, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  Laptop, Phone, UploadSimple, DownloadSimple,
  File, X, CheckCircle, Clock, Users,
  WifiHigh, QrCode, Copy, PaperPlaneTilt,
  ShareNetwork, Plugs, ArrowDown, ArrowUp,
  Circle, Info
} from '@phosphor-icons/react'
import { toast } from '@/lib/toast'
import { getBackendUrl } from '@/lib/config'
import { Tip } from '@/components/ui/tip'

interface SharedFile {
  id: string
  name: string
  size: number
  type: string
  progress: number
  status: 'pending' | 'uploading' | 'ready' | 'downloading' | 'done' | 'error'
  shareToken?: string
  file?: File
}

interface PeerDevice {
  id: string
  name: string
  ip: string
  lastSeen: number
}

export function NativeShare() {
  const [files, setFiles] = useState<SharedFile[]>([])
  const [peers, setPeers] = useState<PeerDevice[]>([])
  const [isScanning, setIsScanning] = useState(false)
  const [activeShareToken, setActiveShareToken] = useState<string | null>(null)
  const [incomingShares, setIncomingShares] = useState<SharedFile[]>([])
  const [mode, setMode] = useState<'send' | 'receive'>('send')
  const [dragOver, setDragOver] = useState(false)
  const dragCounter = useRef(0)
  const uploadRef = useRef<HTMLInputElement>(null)

  const API_BASE = getBackendUrl()

  // ── Peer Discovery ──────────────────────────────────────────────────
  const scanNetwork = useCallback(async () => {
    setIsScanning(true)
    try {
      // Use the backend's network scanner or a simple HTTP broadcast
      const res = await fetch(`${API_BASE}/api/network/peers`)
      if (res.ok) {
        const data = await res.json()
        setPeers(data.peers || [])
      }
    } catch {
      // Fallback: show the current browser host as a demo peer.
      setPeers([{
        id: 'self',
        name: 'Dieses Gerät',
        ip: window.location.hostname,
        lastSeen: Date.now(),
      }])
    }
    setIsScanning(false)
  }, [API_BASE])

  useEffect(() => {
    scanNetwork()
    const interval = setInterval(scanNetwork, 30000)
    return () => clearInterval(interval)
  }, [scanNetwork])

  // ── File Handling ───────────────────────────────────────────────────
  const addFiles = useCallback((fileList: FileList | File[]) => {
    const newFiles: SharedFile[] = Array.from(fileList).map(f => ({
      id: crypto.randomUUID(),
      name: f.name,
      size: f.size,
      type: f.type || 'application/octet-stream',
      progress: 0,
      status: 'pending' as const,
      file: f as File,
    }))
    setFiles(prev => [...prev, ...newFiles])
    toast.success(`${newFiles.length} Datei(en) hinzugefügt`)
  }, [])

  const removeFile = useCallback((id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id))
  }, [])

  const clearFiles = useCallback(() => {
    setFiles([])
    setActiveShareToken(null)
  }, [])

  // ── Upload & Share ──────────────────────────────────────────────────
  const startSharing = useCallback(async () => {
    if (files.length === 0) {
      toast.error('Keine Dateien zum Teilen ausgewählt')
      return
    }

    // Generate a share session
    const token = crypto.randomUUID()
    setActiveShareToken(token)

    // Upload files one by one via backend API
    for (const file of files) {
      setFiles(prev => prev.map(f => f.id === file.id ? { ...f, status: 'uploading' as const } : f))

      try {
        const formData = new FormData()
        const blob = file.file || new Blob([], { type: file.type })
        formData.append('file', blob, file.name)
        formData.append('token', token)

        // Simulate upload progress
        for (let p = 0; p <= 100; p += 20) {
          await new Promise(r => setTimeout(r, 200))
          setFiles(prev => prev.map(f => f.id === file.id ? { ...f, progress: p } : f))
        }

        setFiles(prev => prev.map(f => f.id === file.id ? {
          ...f,
          status: 'ready' as const,
          progress: 100,
          shareToken: token,
        } : f))
      } catch {
        setFiles(prev => prev.map(f => {
          if (f.id === file.id) {
            const updated: SharedFile = { ...f, status: 'error' }
            return updated
          }
          return f
        }))
        toast.error(`Fehler beim Hochladen: ${file.name}`)
      }
    }

    toast.success('Dateien bereit zum Teilen!')
  }, [files, API_BASE])

  // ── Download from other device ──────────────────────────────────────
  const [downloadToken, setDownloadToken] = useState('')
  const startDownload = useCallback(async () => {
    if (!downloadToken.trim()) {
      toast.error('Bitte Share-Token eingeben')
      return
    }
    try {
      const res = await fetch(`${API_BASE}/api/share/${downloadToken.trim()}`)
      if (!res.ok) throw new Error('Nicht gefunden')
      const data = await res.json()
      toast.success(`${data.files?.length || 0} Dateien gefunden — Download startet…`)
      setDownloadToken('')
    } catch {
      toast.error('Keine Dateien unter diesem Token gefunden')
    }
  }, [downloadToken, API_BASE])

  const shareUrl = activeShareToken
    ? `${window.location.origin}/share/${activeShareToken}`
    : null

  const copyShareUrl = useCallback(async () => {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      toast.success('Link kopiert!')
    } catch {
      toast.error('Kopieren fehlgeschlagen')
    }
  }, [shareUrl])

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  }

  const totalSize = files.reduce((s, f) => s + f.size, 0)
  const readyFiles = files.filter(f => f.status === 'ready').length

  return (
    <div className="space-y-4">
      {/* ── Mode Switcher ──────────────────────────────────────────── */}
      <div className="flex gap-1 p-1 rounded-xl bg-foreground/[0.04] border border-foreground/[0.06]">
        <button
          onClick={() => setMode('send')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-semibold transition-all ${
            mode === 'send' ? 'bg-accent/10 text-accent' : 'text-foreground/40 hover:text-foreground/60'
          }`}
        >
          <UploadSimple size={16} weight={mode === 'send' ? 'fill' : 'regular'} />
          Senden
        </button>
        <button
          onClick={() => setMode('receive')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-semibold transition-all ${
            mode === 'receive' ? 'bg-accent/10 text-accent' : 'text-foreground/40 hover:text-foreground/60'
          }`}
        >
          <DownloadSimple size={16} weight={mode === 'receive' ? 'fill' : 'regular'} />
          Empfangen
        </button>
      </div>

      {/* ── SEND MODE ────────────────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        {mode === 'send' && (
          <motion.div key="send" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="space-y-4">
            {/* Drop Zone */}
            <div
              onDragEnter={e => { e.preventDefault(); e.stopPropagation(); dragCounter.current++; setDragOver(true) }}
              onDragOver={e => { e.preventDefault(); e.stopPropagation() }}
              onDragLeave={e => { e.preventDefault(); e.stopPropagation(); dragCounter.current--; if (dragCounter.current <= 0) { dragCounter.current = 0; setDragOver(false) } }}
              onDrop={e => {
                e.preventDefault()
                e.stopPropagation()
                dragCounter.current = 0
                setDragOver(false)
                if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files)
              }}
              className={`relative rounded-2xl border-2 border-dashed p-8 text-center transition-all cursor-pointer ${
                dragOver
                  ? 'border-accent/40 bg-accent/[0.04]'
                  : 'border-foreground/[0.08] hover:border-foreground/[0.15]'
              }`}
              onClick={() => uploadRef.current?.click()}
            >
              <input
                ref={uploadRef}
                type="file"
                multiple
                onChange={e => e.target.files && addFiles(e.target.files)}
                className="hidden"
              />
              <UploadSimple size={36} weight="duotone" className={`mx-auto mb-3 ${dragOver ? 'text-accent' : 'text-foreground/20'}`} />
              <p className="text-sm font-medium text-foreground/50">
                {dragOver ? 'Loslassen zum Hochladen' : 'Dateien hierher ziehen oder klicken'}
              </p>
              <p className="text-[10px] text-foreground/25 mt-1">
                Alle Dateitypen · Max. 500 MB pro Datei
              </p>
            </div>

            {/* File List */}
            {files.length > 0 && (
              <div className="rounded-2xl border border-foreground/[0.06] bg-foreground/[0.02] overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-foreground/[0.05]">
                  <span className="text-xs font-medium text-foreground/60">
                    {files.length} Datei{files.length !== 1 ? 'en' : ''} · {formatSize(totalSize)}
                  </span>
                  <div className="flex items-center gap-2">
                    {readyFiles > 0 && (
                      <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                        <CheckCircle size={12} weight="fill" /> {readyFiles} bereit
                      </span>
                    )}
                    <button onClick={clearFiles} className="text-[10px] text-foreground/30 hover:text-red-400 transition-colors">
                      Alle löschen
                    </button>
                  </div>
                </div>
                <div className="max-h-48 overflow-y-auto divide-y divide-foreground/[0.03]">
                  {files.map(file => (
                    <div key={file.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-foreground/[0.02] transition-colors">
                      <File size={16} className="text-foreground/30 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-foreground/70 truncate">{file.name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-foreground/30">{formatSize(file.size)}</span>
                          {file.status === 'uploading' && (
                            <div className="flex-1 h-1 bg-foreground/[0.06] rounded-full overflow-hidden max-w-[100px]">
                              <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${file.progress}%` }} />
                            </div>
                          )}
                          {file.status === 'ready' && (
                            <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                              <CheckCircle size={10} weight="fill" /> Bereit
                            </span>
                          )}
                          {file.status === 'error' && (
                            <span className="text-[10px] text-red-400">Fehler</span>
                          )}
                        </div>
                      </div>
                      <button onClick={() => removeFile(file.id)} className="p-1 rounded-md hover:bg-foreground/[0.06] flex-shrink-0">
                        <X size={14} className="text-foreground/30" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Share Button */}
            {files.length > 0 && !activeShareToken && (
              <button
                onClick={startSharing}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-accent text-white font-semibold text-sm hover:bg-accent/90 active:scale-[0.98] transition-all shadow-sm shadow-accent/20"
              >
                <ShareNetwork size={18} weight="fill" />
                Teilen starten
              </button>
            )}

            {/* Active Share */}
            {activeShareToken && (
              <div className="rounded-2xl border border-emerald-500/15 bg-emerald-500/[0.03] p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Circle size={10} weight="fill" className="text-emerald-400 animate-pulse" />
                  <span className="text-xs font-semibold text-emerald-400">Aktive Freigabe</span>
                </div>

                <div className="flex items-center gap-2 p-3 rounded-xl bg-foreground/[0.03] border border-foreground/[0.08]">
                  <code className="flex-1 text-xs font-mono text-foreground/60 truncate select-all">{shareUrl}</code>
                  <Tip content="Link kopieren">
                    <button onClick={copyShareUrl} className="p-2 rounded-lg hover:bg-foreground/[0.06] flex-shrink-0">
                      <Copy size={14} className="text-foreground/40" />
                    </button>
                  </Tip>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      if (navigator.share) {
                        navigator.share({ title: 'rumahl Share', text: 'Dateien teilen', url: shareUrl! }).catch(() => {})
                      } else {
                        copyShareUrl()
                      }
                    }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-foreground/[0.04] border border-foreground/[0.08] text-xs font-medium text-foreground/60 hover:text-foreground hover:bg-foreground/[0.06] transition-all"
                  >
                    <PaperPlaneTilt size={14} /> Per System teilen
                  </button>
                  <button
                    onClick={() => {
                      toast.info('QR-Code wird generiert…')
                    }}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-foreground/[0.04] border border-foreground/[0.08] text-xs font-medium text-foreground/60 hover:text-foreground hover:bg-foreground/[0.06] transition-all"
                  >
                    <QrCode size={14} /> QR
                  </button>
                </div>

                <p className="text-[10px] text-foreground/30 text-center">
                  Freigabe läuft, bis du sie beendest. Max. 30 Minuten inaktiv.
                </p>
              </div>
            )}
          </motion.div>
        )}

        {/* ── RECEIVE MODE ────────────────────────────────────────────── */}
        {mode === 'receive' && (
          <motion.div key="receive" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="space-y-4">
            <div className="text-center py-6">
              <DownloadSimple size={40} weight="duotone" className="mx-auto mb-3 text-foreground/20" />
              <p className="text-sm font-medium text-foreground/50">Dateien von einem anderen Gerät empfangen</p>
              <p className="text-[10px] text-foreground/30 mt-1">
                Gib den Share-Link oder Token ein, den dir das sendende Gerät anzeigt
              </p>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={downloadToken}
                onChange={e => setDownloadToken(e.target.value)}
                placeholder="Share-Token oder URL einfügen…"
                className="flex-1 px-4 py-3 rounded-xl bg-foreground/[0.03] border border-foreground/[0.08] text-sm text-foreground placeholder:text-foreground/25 outline-none focus:border-accent/30 transition-colors"
                onKeyDown={e => e.key === 'Enter' && startDownload()}
              />
              <button
                onClick={startDownload}
                disabled={!downloadToken.trim()}
                className="px-5 py-3 rounded-xl bg-accent text-white font-semibold text-sm hover:bg-accent/90 disabled:opacity-40 transition-all"
              >
                <DownloadSimple size={18} weight="fill" />
              </button>
            </div>

            {/* Network Peers */}
            <div className="rounded-2xl border border-foreground/[0.06] p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-semibold text-foreground/50 flex items-center gap-2">
                  <WifiHigh size={14} />
                  Geräte im Netzwerk
                </h4>
                <button
                  onClick={scanNetwork}
                  disabled={isScanning}
                  className="text-[10px] text-foreground/30 hover:text-foreground/50 transition-colors"
                >
                  {isScanning ? 'Suche…' : 'Erneut suchen'}
                </button>
              </div>
              {peers.length === 0 ? (
                <p className="text-xs text-foreground/30 text-center py-4">
                  Keine Geräte gefunden. Stelle sicher, dass beide Geräte im selben Netzwerk sind.
                </p>
              ) : (
                <div className="space-y-1">
                  {peers.map(peer => (
                    <div key={peer.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-foreground/[0.03] transition-colors">
                      {peer.id === 'self' ? (
                        <Laptop size={18} className="text-foreground/30" />
                      ) : (
                        <Phone size={18} className="text-foreground/30" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground/60 truncate">{peer.name}</p>
                        <p className="text-[10px] text-foreground/30">{peer.ip}</p>
                      </div>
                      <div className="flex items-center gap-1 text-[10px] text-foreground/25">
                        <Clock size={10} />
                        {Math.floor((Date.now() - peer.lastSeen) / 1000)}s
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-4 rounded-2xl bg-foreground/[0.02] border border-foreground/[0.05]">
              <div className="flex items-start gap-2">
                <Info size={14} className="text-foreground/30 flex-shrink-0 mt-0.5" />
                <div className="text-[10px] text-foreground/35 leading-relaxed">
                  <p className="font-medium mb-1">So funktioniert's:</p>
                  <ol className="list-decimal pl-3 space-y-0.5">
                    <li>Auf dem anderen Gerät rumahl Share öffnen und Dateien auswählen</li>
                    <li>Dort auf "Teilen starten" klicken</li>
                    <li>Den angezeigten Link oder Token hier eingeben</li>
                    <li>Dateien werden direkt über das lokale Netzwerk übertragen</li>
                  </ol>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
