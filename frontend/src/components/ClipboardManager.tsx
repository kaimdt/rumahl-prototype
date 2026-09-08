import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Check,
  ClipboardText,
  MagnifyingGlass,
  Star,
  Trash,
  X,
} from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { authFetch } from '@/lib/authHelpers'

/**
 * Clipboard manager – personal clipboard history per user, shared across
 * devices through the `/api/clipboard` store. Copy/cut events are captured
 * system-wide (passwords and oversized payloads are skipped); the panel
 * (Ctrl+Shift+V) lists, pins, searches and re-copies entries.
 */

interface ClipboardEntry {
  id: string
  content: string
  content_type: string
  source: string
  created_by: string
  pinned: boolean
  created_at: string
}

const MAX_CONTENT_LEN = 65_536

/**
 * Captures copy/cut events and pushes the text to the clipboard store.
 * Mount once at the shell level so history works everywhere. Skips password
 * inputs and oversized payloads; deduplicates rapid re-posts of the same
 * content.
 */
export function useClipboardCapture() {
  const lastRef = useRef<{ content: string; at: number } | null>(null)

  useEffect(() => {
    const onCopy = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData('text/plain')?.trim()
      if (!text) return
      const target = event.target as HTMLElement | null
      if (target instanceof HTMLInputElement && target.type === 'password') return
      if (target instanceof HTMLTextAreaElement && target.dataset.clipboardSkip !== undefined) return
      if (text.length > MAX_CONTENT_LEN) return
      const now = Date.now()
      if (lastRef.current && lastRef.current.content === text && now - lastRef.current.at < 800) return
      lastRef.current = { content: text, at: now }
      void authFetch('/api/clipboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text, source: 'web' }),
      }).catch(() => {
        // backend unreachable — clipboard capture is best-effort
      })
    }
    window.addEventListener('copy', onCopy)
    window.addEventListener('cut', onCopy)
    return () => {
      window.removeEventListener('copy', onCopy)
      window.removeEventListener('cut', onCopy)
    }
  }, [])
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  return date.toLocaleString(undefined, sameDay
    ? { hour: '2-digit', minute: '2-digit' }
    : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function ClipboardManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const [entries, setEntries] = useState<ClipboardEntry[]>([])
  const [query, setQuery] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await authFetch('/api/clipboard?limit=100')
      if (!res.ok) {
        if (res.status === 401) setEntries([])
        return
      }
      const data = await res.json() as { entries?: ClipboardEntry[] }
      setEntries(Array.isArray(data?.entries) ? data.entries : [])
    } catch {
      // backend unreachable — keep last list
    }
  }, [])

  // Poll while open, stop when closed.
  useEffect(() => {
    if (!open) return
    void refresh()
    const id = window.setInterval(refresh, 5000)
    return () => window.clearInterval(id)
  }, [open, refresh])

  const copyEntry = useCallback(async (entry: ClipboardEntry) => {
    try {
      await navigator.clipboard.writeText(entry.content)
      setCopiedId(entry.id)
      window.setTimeout(() => setCopiedId(null), 1200)
    } catch {
      // clipboard permission denied — fall back to no-op
    }
  }, [])

  const togglePin = useCallback(async (entry: ClipboardEntry) => {
    try {
      const res = await authFetch(`/api/clipboard/${entry.id}/pin`, { method: 'POST' })
      if (!res.ok) return
      setEntries((current) => current.map((e) =>
        e.id === entry.id ? { ...e, pinned: !e.pinned } : e,
      ))
    } catch {
      // keep state
    }
  }, [])

  const removeEntry = useCallback(async (id: string) => {
    try {
      await authFetch(`/api/clipboard/${id}`, { method: 'DELETE' })
      setEntries((current) => current.filter((e) => e.id !== id))
    } catch {
      // keep entry if removal failed
    }
  }, [])

  const clearAll = useCallback(async () => {
    try {
      const res = await authFetch('/api/clipboard', { method: 'DELETE' })
      if (!res.ok) return
      setEntries([])
    } catch {
      // keep list
    }
  }, [])

  const filtered = useMemoFilter(entries, query)
  const hasEntries = entries.length > 0

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            aria-label={t('common.close')}
            className="fixed inset-0 z-[56] bg-black/20 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            initial={{ opacity: 0, y: -14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            className="glass-card fixed right-3 top-[calc(max(0.75rem,env(safe-area-inset-top))+3.5rem)] z-[65] flex max-h-[min(32rem,calc(100vh-8rem))] w-[min(24rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-3xl border border-white/15 shadow-2xl sm:right-6 sm:top-[4.5rem]"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <ClipboardText size={16} className="text-foreground/60" />
                  {t('clipboard.title')}
                </p>
                <p className="text-[11px] text-foreground/45">{t('clipboard.hint')}</p>
              </div>
              <div className="flex items-center gap-1">
                {hasEntries && (
                  <button
                    type="button"
                    onClick={clearAll}
                    className="rounded-full p-2 text-foreground/50 transition-colors hover:bg-foreground/10 hover:text-foreground"
                    title={t('clipboard.clear')}
                  >
                    <Trash size={15} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-full p-2 text-foreground/50 transition-colors hover:bg-foreground/10 hover:text-foreground"
                  title={t('common.close')}
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            {/* Search */}
            {hasEntries && (
              <div className="flex items-center gap-2 border-b border-white/5 px-4 py-2">
                <MagnifyingGlass size={14} className="shrink-0 text-foreground/40" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('clipboard.search')}
                  className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-foreground/40"
                />
                {query && (
                  <button type="button" onClick={() => setQuery('')} className="rounded p-0.5 text-foreground/40 hover:text-foreground">
                    <X size={12} />
                  </button>
                )}
              </div>
            )}

            {/* Entry list */}
            <div className="flex-1 space-y-1.5 overflow-y-auto p-3">
              {!hasEntries && (
                <div className="flex flex-col items-center gap-2 py-10 text-center">
                  <ClipboardText size={28} className="text-foreground/25" />
                  <p className="text-xs text-foreground/55">{t('clipboard.empty')}</p>
                  <p className="px-6 text-[11px] text-foreground/35">{t('clipboard.emptyHint')}</p>
                </div>
              )}

              {filtered.length === 0 && hasEntries && (
                <p className="py-8 text-center text-xs text-foreground/45">{t('clipboard.noMatch')}</p>
              )}

              {filtered.map((entry) => (
                <div
                  key={entry.id}
                  className="group rounded-2xl border border-white/8 bg-foreground/5 transition-colors hover:bg-foreground/10"
                >
                  <button
                    type="button"
                    onClick={() => void copyEntry(entry)}
                    className="block w-full px-3 pt-2.5 text-left"
                    title={t('clipboard.copy')}
                  >
                    <p className="line-clamp-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground/85">
                      {entry.content}
                    </p>
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="text-[10px] uppercase tracking-wide text-foreground/35">
                        {formatTimestamp(entry.created_at)}
                      </span>
                      {copiedId === entry.id && (
                        <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-400">
                          <Check size={11} weight="bold" />
                          {t('clipboard.copied')}
                        </span>
                      )}
                    </div>
                  </button>
                  <div className="flex items-center justify-end gap-1 border-t border-white/5 px-2 py-1">
                    <button
                      type="button"
                      onClick={() => void togglePin(entry)}
                      className={`rounded-lg p-1.5 transition-colors hover:bg-foreground/10 ${
                        entry.pinned ? 'text-amber-400' : 'text-foreground/35 hover:text-foreground/70'
                      }`}
                      title={entry.pinned ? t('clipboard.unpin') : t('clipboard.pin')}
                    >
                      <Star size={13} weight={entry.pinned ? 'fill' : 'regular'} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeEntry(entry.id)}
                      className="rounded-lg p-1.5 text-foreground/35 transition-colors hover:bg-red-500/20 hover:text-red-300"
                      title={t('clipboard.delete')}
                    >
                      <Trash size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}

function useMemoFilter(entries: ClipboardEntry[], query: string): ClipboardEntry[] {
  const [filtered, setFiltered] = useState<ClipboardEntry[]>(entries)
  useEffect(() => {
    const q = query.trim().toLowerCase()
    if (!q) {
      setFiltered(entries)
      return
    }
    setFiltered(entries.filter((e) => e.content.toLowerCase().includes(q)))
  }, [entries, query])
  return filtered
}
