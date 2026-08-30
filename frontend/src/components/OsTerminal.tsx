import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowClockwise, CircleNotch, Copy, CornersIn, CornersOut, Terminal as TerminalIcon, Trash } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { getBackendUrl } from '@/lib/config'
import { getAuthToken } from '@/lib/authHelpers'

const MAX_SCROLLBACK = 250_000

function normalizeTerminalOutput(current: string, chunk: string) {
  if (chunk.includes('\u001b[2J') || chunk.includes('\u001bc')) current = ''
  const clean = chunk
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u0007/g, '')
  let next = current
  for (const character of clean.replace(/\r\n/g, '\n')) {
    if (character === '\b' || character === '\u007f') next = next.slice(0, -1)
    else if (character !== '\r') next += character
  }
  return next.slice(-MAX_SCROLLBACK)
}

export function OsTerminal() {
  const { t } = useTranslation()
  const [output, setOutput] = useState('')
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const [reconnectKey, setReconnectKey] = useState(0)
  const wsRef = useRef<WebSocket | null>(null)
  const outputRef = useRef<HTMLPreElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const appendOutput = useCallback((chunk: string) => {
    setOutput((current) => normalizeTerminalOutput(current, chunk))
  }, [])

  useEffect(() => {
    setOutput('')
    setConnecting(true)
    const base = getBackendUrl() || window.location.origin
    const wsUrl = base.replace(/^http/, 'ws')
    const token = getAuthToken()
    const socket = new WebSocket(`${wsUrl}/api/os/terminal/ws?token=${encodeURIComponent(token || '')}`)
    wsRef.current = socket

    socket.onopen = () => { setConnected(true); setConnecting(false); inputRef.current?.focus() }
    socket.onmessage = (event) => { if (typeof event.data === 'string') appendOutput(event.data) }
    socket.onclose = (event) => {
      setConnected(false)
      setConnecting(false)
      appendOutput(event.code === 1008 ? `\n${t('terminal.developerRequired')}\n` : `\n${t('terminal.sessionClosed')}\n`)
    }
    socket.onerror = () => { setConnected(false); setConnecting(false) }
    return () => { socket.close(); wsRef.current = null }
  }, [appendOutput, reconnectKey, t])

  useEffect(() => {
    const element = outputRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [output])

  const send = useCallback((value: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(value)
  }, [])

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const special: Record<string, string> = {
      Enter: '\r', Backspace: '\u007f', Tab: '\t', ArrowUp: '\u001b[A', ArrowDown: '\u001b[B', ArrowRight: '\u001b[C', ArrowLeft: '\u001b[D',
    }
    if (event.ctrlKey && event.key.toLowerCase() === 'c' && !event.currentTarget.value) { event.preventDefault(); send('\u0003'); return }
    if (event.ctrlKey && event.key.toLowerCase() === 'd') { event.preventDefault(); send('\u0004'); return }
    if (event.ctrlKey && event.key.toLowerCase() === 'l') { event.preventDefault(); send('\u000c'); setOutput(''); return }
    if (special[event.key]) { event.preventDefault(); send(special[event.key]); return }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); send(event.key) }
  }, [send])

  const copyOutput = async () => {
    await navigator.clipboard.writeText(output)
    toast.success(t('terminal.copied'))
  }

  return (
    <section className={`${fullscreen ? 'fixed inset-3 z-[200] shadow-2xl' : 'min-h-[calc(100dvh-12rem)]'} flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#080b0d]`}>
      <header className="flex items-center gap-2 border-b border-white/8 bg-white/[0.025] px-3 py-2.5">
        <span className="grid size-7 place-items-center rounded-lg bg-accent/12 text-accent"><TerminalIcon size={15} weight="bold" /></span>
        <div><div className="text-xs font-semibold text-foreground/85">{t('terminal.title')}</div><div className="text-[9px] text-foreground/35">{t('terminal.fullOsAccess')}</div></div>
        <span className={`ml-auto flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-semibold ${connected ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300'}`}>
          <span className={`size-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-400'}`} />{connected ? t('terminal.connected') : t('terminal.disconnected')}
        </span>
        {!connected && !connecting && <button type="button" onClick={() => setReconnectKey((key) => key + 1)} title={t('terminal.reconnect')} className="rounded-lg p-1.5 text-foreground/55 hover:bg-white/8"><ArrowClockwise size={14} /></button>}
        {connecting && <CircleNotch size={14} className="animate-spin text-foreground/40" />}
        <button type="button" onClick={copyOutput} title={t('terminal.copy')} className="rounded-lg p-1.5 text-foreground/55 hover:bg-white/8"><Copy size={14} /></button>
        <button type="button" onClick={() => setOutput('')} title={t('terminal.clear')} className="rounded-lg p-1.5 text-foreground/55 hover:bg-white/8"><Trash size={14} /></button>
        <button type="button" onClick={() => setFullscreen((value) => !value)} title={t('terminal.fullscreen')} className="rounded-lg p-1.5 text-foreground/55 hover:bg-white/8">{fullscreen ? <CornersIn size={14} /> : <CornersOut size={14} />}</button>
      </header>

      <div className="relative min-h-0 flex-1" onClick={() => inputRef.current?.focus()}>
        <pre ref={outputRef} aria-live="polite" className="absolute inset-0 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-[12px] leading-[1.55] text-[#d7e0e5] selection:bg-accent/30">{output}<span className="inline-block h-[1.1em] w-[7px] animate-pulse bg-accent align-middle" /></pre>
        <textarea ref={inputRef} aria-label={t('terminal.input')} onKeyDown={onKeyDown} onPaste={(event) => { event.preventDefault(); send(event.clipboardData.getData('text')) }}
          className="pointer-events-none absolute size-px opacity-0" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
      </div>

      <footer className="flex items-center justify-between border-t border-white/6 bg-white/[0.02] px-3 py-2 text-[10px] text-foreground/35">
        <span>{t('terminal.hint')}</span><span>{Math.round(output.length / 1024)} KB · {t('terminal.scrollback')}</span>
      </footer>
    </section>
  )
}
