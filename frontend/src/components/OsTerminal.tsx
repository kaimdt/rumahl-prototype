import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowClockwise, CircleNotch, Terminal as TerminalIcon, X } from '@phosphor-icons/react'
import { getBackendUrl } from '@/lib/config'
import { getAuthToken } from '@/lib/authHelpers'

/**
 * OsTerminal — interactive shell for the Admin Center (Package 9).
 *
 * Connects to /api/os/terminal/ws (os.terminal permission, token via query)
 * and renders the PTY stream. The renderer is deliberately compact: ANSI
 * SGR colours are parsed into spans, cursor-based apps (vim/top) degrade to
 * scrollback — fine for admin commands (systemctl, ls, docker, logs).
 */

interface Segment { text: string; color?: string; bold?: boolean }

/** Parse one line's ANSI SGR codes into coloured segments (ANSI stripped). */
function parseAnsi(line: string): Segment[] {
  const segments: Segment[] = []
  let current: Segment = { text: '' }
  let i = 0
  const push = () => {
    if (current.text) segments.push(current)
    current = { text: '' }
  }
  while (i < line.length) {
    const ch = line[i]
    if (ch === '\u001b' && line[i + 1] === '[') {
      const end = line.indexOf('m', i)
      if (end === -1) { i = line.length; break }
      const params = line.slice(i + 2, end).split(';')
      for (const param of params) {
        const code = Number(param)
        if (code === 0) { push(); current = { text: '' } }
        else if (code === 1) current.bold = true
        else if (code >= 30 && code <= 37) current.color = ANSI_FG[code - 30]
        else if (code >= 90 && code <= 97) current.color = ANSI_FG[code - 90 + 8]
        else if (code === 39) current.color = undefined
      }
      i = end + 1
    } else {
      current.text += ch
      i++
    }
  }
  push()
  return segments
}

const ANSI_FG = [
  '#555555', '#ff5555', '#55ff55', '#ffff55', '#5555ff', '#ff55ff', '#55ffff', '#ffffff',
  '#777777', '#ff7777', '#77ff77', '#ffff77', '#7777ff', '#ff77ff', '#77ffff', '#ffffff',
]

export function OsTerminal() {
  const { t } = useTranslation()
  const [lines, setLines] = useState<Segment[][]>([])
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(true)
  const wsRef = useRef<WebSocket | null>(null)
  const currentLineRef = useRef<Segment[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLDivElement>(null)

  const [reconnectKey, setReconnectKey] = useState(0)
  const connect = useCallback(() => setReconnectKey((key) => key + 1), [])

  const pushLine = useCallback(() => {
    setLines((current) => {
      const next = [...current, currentLineRef.current]
      return next.slice(-2000)
    })
    currentLineRef.current = []
  }, [])

  const appendOutput = useCallback((chunk: string) => {
    let i = 0
    while (i < chunk.length) {
      const ch = chunk[i]
      if (ch === '\r') {
        if (chunk[i + 1] === '\n') { i += 2; pushLine(); continue }
        i++; continue
      }
      if (ch === '\n') { pushLine(); i++; continue }
      if (ch === '\u001b') {
        // CSI sequences
        if (chunk[i + 1] === '[') {
          const end = chunk.indexOf('m', i)
          if (end !== -1) { i = end + 1; continue }
          // Non-SGR CSI (clear, home, cursor moves): find the final byte
          let j = i + 2
          while (j < chunk.length && !/[A-Za-z~]/.test(chunk[j])) j++
          const cmd = chunk[j] || ''
          if (cmd === 'J' && chunk[i + 2] === '2') { setLines([]); currentLineRef.current = [] }
          if (cmd === 'H') { setLines([]); currentLineRef.current = [] }
          i = j + 1
          continue
        }
        // OSC (title etc.) — skip until BEL or ST
        const bel = chunk.indexOf('\u0007', i)
        if (bel !== -1) { i = bel + 1; continue }
        i++
        continue
      }
      if (ch === '\u0007') { i++; continue }
      currentLineRef.current.push({ text: ch })
      i++
    }
  }, [pushLine])

  useEffect(() => {
    setLines([])
    currentLineRef.current = []
    setConnecting(true)
    const base = getBackendUrl() || window.location.origin
    const wsUrl = base.replace(/^http/, 'ws')
    const token = getAuthToken()
    const socket = new WebSocket(`${wsUrl}/api/os/terminal/ws?token=${encodeURIComponent(token || '')}`)
    wsRef.current = socket

    socket.onopen = () => {
      setConnected(true)
      setConnecting(false)
      appendOutput('ORA Terminal — verbunden.\r\n')
    }
    socket.onmessage = (event) => {
      if (typeof event.data === 'string') appendOutput(event.data)
    }
    socket.onclose = () => {
      setConnected(false)
      setConnecting(false)
      appendOutput('\r\n\u001b[31mTerminal geschlossen.\u001b[0m\r\n')
    }
    socket.onerror = () => {
      setConnected(false)
      setConnecting(false)
    }
    return () => {
      socket.close()
      wsRef.current = null
    }
  }, [appendOutput, reconnectKey])

  // Autoscroll to bottom on new output
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])

  const sendInput = useCallback((text: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(text)
  }, [])

  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Enter') { event.preventDefault(); sendInput('\r') }
    else if (event.key === 'Backspace') { event.preventDefault(); sendInput('\u007f') }
    else if (event.key === 'Tab') { event.preventDefault(); sendInput('\t') }
    else if (event.key === 'ArrowUp') { event.preventDefault(); sendInput('\u001b[A') }
    else if (event.key === 'ArrowDown') { event.preventDefault(); sendInput('\u001b[B') }
    else if (event.key === 'ArrowRight') { event.preventDefault(); sendInput('\u001b[C') }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); sendInput('\u001b[D') }
    else if (event.ctrlKey && event.key === 'c') { event.preventDefault(); sendInput('\u0003') }
    else if (event.ctrlKey && event.key === 'd') { event.preventDefault(); sendInput('\u0004') }
    else if (event.ctrlKey && event.key === 'l') { event.preventDefault(); sendInput('\u000c') }
    else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      event.preventDefault()
      sendInput(event.key)
    }
  }, [sendInput])

  return (
    <div className="flex min-h-[calc(100dvh-12rem)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/50">
      {/* Title bar */}
      <div className="flex items-center gap-2 border-b border-white/8 px-3 py-2">
        <TerminalIcon size={15} className="text-foreground/60" />
        <span className="text-xs font-semibold text-foreground/70">{t('terminal.title')}</span>
        <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold ${connected ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300'}`}>
          {connected ? t('terminal.connected') : t('terminal.disconnected')}
        </span>
        {!connected && !connecting && (
          <button type="button" onClick={connect} className="rounded-lg bg-foreground/8 px-2 py-1 text-[10px] font-semibold text-foreground/70 hover:bg-foreground/12">
            <ArrowClockwise size={11} className="mr-1 inline" />{t('terminal.reconnect')}
          </button>
        )}
        {connecting && <CircleNotch size={13} className="animate-spin text-foreground/40" />}
      </div>

      {/* Output */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto p-3 font-mono text-[12px] leading-relaxed"
        onClick={() => inputRef.current?.focus()}
        onKeyDown={onKeyDown}
        tabIndex={0}
      >
        {lines.map((segments, index) => (
          <div key={index} className="whitespace-pre-wrap break-words">
            {segments.length === 0 ? '\u00a0' : segments.map((segment, segIndex) => (
              <span key={segIndex} style={segment.color ? { color: segment.color, fontWeight: segment.bold ? 700 : undefined } : { fontWeight: segment.bold ? 700 : undefined }}>
                {segment.text}
              </span>
            ))}
          </div>
        ))}
        <span className="inline-block h-[1.1em] w-2 animate-pulse bg-foreground/70 align-middle" />
      </div>

      {/* Hint */}
      <div className="border-t border-white/6 px-3 py-1.5 text-[10px] text-foreground/35">
        {t('terminal.hint')}
      </div>
    </div>
  )
}
