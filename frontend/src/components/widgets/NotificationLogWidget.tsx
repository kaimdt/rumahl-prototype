import { Bell, Info, Warning, WarningCircle } from '@phosphor-icons/react'
import { useState, useEffect, useRef } from 'react'
import { getBackendUrl } from '@/lib/config'

interface Notification {
  id: string
  message: string
  level: 'info' | 'warning' | 'error'
  timestamp: number
  source?: string
}

const LEVEL_STYLES = {
  info: { icon: Info, color: 'text-blue-400', bg: 'bg-blue-400/10' },
  warning: { icon: Warning, color: 'text-amber-400', bg: 'bg-amber-400/10' },
  error: { icon: WarningCircle, color: 'text-red-400', bg: 'bg-red-400/10' },
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'gerade eben'
  if (diff < 3600_000) return `vor ${Math.floor(diff / 60_000)}m`
  if (diff < 86400_000) return `vor ${Math.floor(diff / 3600_000)}h`
  return `vor ${Math.floor(diff / 86400_000)}d`
}

export default function NotificationLogWidget({ config }: { config?: Record<string, unknown> }) {
  const maxEntries = typeof config?.maxEntries === 'number' ? config.maxEntries : 50
  const [notifications, setNotifications] = useState<Notification[]>([])
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    // Listen for error messages from WebSocket
    const API_BASE = getBackendUrl()
    let wsHost: string
    if (API_BASE) {
      try { wsHost = new URL(API_BASE).host } catch { wsHost = `${window.location.hostname}:3001` }
    } else {
      wsHost = `${window.location.hostname}:3001`
    }
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${wsHost}/ws`

    try {
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'error' || data.type === 'notification') {
            const notif: Notification = {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              message: data.message || data.error || JSON.stringify(data),
              level: (data.type === 'error' ? 'error' : data.level || 'info') as Notification['level'],
              timestamp: Date.now(),
              source: data.source || 'system',
            }
            setNotifications(prev => [notif, ...prev].slice(0, maxEntries))
          }
        } catch {
          // Ignore non-JSON messages
        }
      }

      ws.onerror = () => {
        setNotifications(prev => [({
          id: `err-${Date.now()}`,
          message: 'WebSocket-Verbindungsfehler',
          level: 'error' as const,
          timestamp: Date.now(),
          source: 'websocket',
        }), ...prev].slice(0, maxEntries))
      }
    } catch {
      // WebSocket not available
    }

    return () => {
      wsRef.current?.close()
    }
  }, [])

  const clearAll = () => setNotifications([])

  return (
    <div className="flex flex-col gap-2 p-3 h-full">
      <div className="flex items-center gap-2 text-xs font-medium text-white/80">
        <Bell size={16} className="text-orange-400" />
        <span>Benachrichtigungen</span>
        {notifications.length > 0 && (
          <>
            <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-orange-400/20 text-orange-400">
              {notifications.length}
            </span>
            <button
              onClick={clearAll}
              className="text-[10px] text-white/30 hover:text-white/60 transition-colors"
            >
              Löschen
            </button>
          </>
        )}
      </div>

      <div className="flex-1 overflow-auto flex flex-col gap-1">
        {notifications.map(notif => {
          const style = LEVEL_STYLES[notif.level]
          const Icon = style.icon

          return (
            <div
              key={notif.id}
              className={`flex items-start gap-2 px-2 py-1.5 rounded-lg ${style.bg}`}
            >
              <Icon size={14} className={`${style.color} shrink-0 mt-0.5`} />
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-white/80 break-words">{notif.message}</div>
                <div className="flex items-center gap-2 mt-0.5">
                  {notif.source && (
                    <span className="text-[9px] text-white/30">{notif.source}</span>
                  )}
                  <span className="text-[9px] text-white/20">{timeAgo(notif.timestamp)}</span>
                </div>
              </div>
            </div>
          )
        })}

        {notifications.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center text-white/40 text-xs gap-1">
            <Bell size={24} className="text-white/20" />
            <span>Keine Benachrichtigungen</span>
          </div>
        )}
      </div>
    </div>
  )
}
