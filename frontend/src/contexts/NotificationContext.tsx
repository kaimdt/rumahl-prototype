import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, ReactNode } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { wsOnMessage } from '@/lib/wsConnection'
import { readNotifications, subscribeNotifications, markNotificationRead, removeNotification, clearNotifications as clearStoredNotifications, type StoredNotification } from '@/lib/notificationStore'
import { notifySystem, type SystemNotificationOptions } from '@/lib/toast'
import { NotificationDetailDialog } from '@/components/NotificationDetailDialog'

export interface Notification {
  id: string
  title: string
  message: string
  level: 'info' | 'warning' | 'critical' | 'emergency'
  source: string
  icon: string
  entity_id: string
  created_at: string
  read: boolean
  auto_dismiss_secs: number
  persistent?: boolean
  actions?: Array<{ id: string; label: string; href?: string }>
}

export interface EmergencyAlert {
  id: string
  title: string
  message: string
  level: 'warning' | 'critical' | 'emergency'
  source: string
  color: string
  icon: string
  created_at: string
}

interface NotificationContextType {
  notifications: Notification[]
  unreadCount: number
  emergencyAlert: EmergencyAlert | null
  latestNotification: Notification | null
  markAsRead: (id: string) => Promise<void>
  dismissNotification: (id: string) => Promise<void>
  dismissEmergencyAlert: () => void
  dismissLatestNotification: () => void
  clearAll: () => Promise<void>
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined)

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { token, isAuthenticated } = useAuth()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [emergencyAlert, setEmergencyAlert] = useState<EmergencyAlert | null>(null)
  const [latestNotification, setLatestNotification] = useState<Notification | null>(null)
  const [detailNotification, setDetailNotification] = useState<Notification | null>(null)
  const latestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Merge OS toasts (journaled in the notification store) into the notification
  // center. Toasts become first-class notifications and survive reloads.
  useEffect(() => {
    const merge = () => {
      const stored = readNotifications()
      if (stored.length === 0) return
      setNotifications((prev) => {
        const known = new Set(prev.map((n) => n.id))
        const newOnes = stored
          .filter((n) => !known.has(n.id))
          .map((n) => ({ ...n, icon: n.icon || 'bell' } as Notification))
        return [...newOnes, ...prev]
      })
    }
    merge()
    const unsub = subscribeNotifications(merge)
    return unsub
  }, [])

  // Fetch initial state
  useEffect(() => {
    if (!isAuthenticated || !token) return
    let mounted = true

    const headers = {
      'Authorization': `Bearer ${token}`,
      'X-Action-Intent': 'read',
    }

    Promise.all([
      fetch('/api/notifications', { headers }).then(r => r.ok ? r.json() : []),
      fetch('/api/alert/active', { headers }).then(r => r.ok ? r.json() : { active: false }),
    ]).then(([notifs, alertData]) => {
      if (!mounted) return
      setNotifications((current) => {
        const incoming = notifs as Notification[]
        const incomingIds = new Set(incoming.map((notification) => notification.id))
        return [...incoming, ...current.filter((notification) => !incomingIds.has(notification.id))]
      })
      if (alertData.active && alertData.alert) {
        setEmergencyAlert(alertData.alert as EmergencyAlert)
      }
    }).catch(() => {})

    return () => { mounted = false }
  }, [isAuthenticated, token])

  // WebSocket listeners
  useEffect(() => {
    const unsub = wsOnMessage((data: unknown) => {
      const msg = data as Record<string, unknown>

      if (msg.type === 'notification') {
        const action = msg.action as string
        if (action === 'new' && msg.notification) {
          const notif = msg.notification as Notification
          setNotifications(prev => [...prev, notif])
          showLatest(notif)
        } else if (action === 'dismissed' && msg.id) {
          setNotifications(prev => prev.filter(n => n.id !== msg.id))
        } else if (action === 'clear_all') {
          setNotifications([])
        }
      }

      if (msg.type === 'emergency_alert') {
        const action = msg.action as string
        if (action === 'set' && msg.alert) {
          setEmergencyAlert(msg.alert as EmergencyAlert)
        } else if (action === 'dismiss') {
          setEmergencyAlert(null)
        }
      }

      // Watchdog events become notifications in the frontend
      if (msg.type === 'watchdog_triggered') {
        const count = msg.count as number
        const syntheticNotif: Notification = {
          id: `watchdog-${Date.now()}`,
          title: 'Watchdog ausgelöst',
          message: `${count} Watchdog-Regel${count > 1 ? 'n' : ''} ausgelöst`,
          level: 'warning',
          source: 'watchdog',
          icon: 'warning',
          entity_id: '',
          created_at: new Date().toISOString(),
          read: false,
          auto_dismiss_secs: 300,
        }
        setNotifications(prev => [...prev, syntheticNotif])
      }

      // Warning entity updates → create synthetic notifications for newly active warnings
      if (msg.type === 'warning_entity_update') {
        const active = msg.active as boolean
        const entityId = msg.entity_id as string
        if (active) {
          const level = (msg.level || 'warning') as Notification['level']
          const syntheticNotif: Notification = {
            id: `warning-${entityId}-${Date.now()}`,
            title: (msg.title as string) || 'Warnung',
            message: (msg.message as string) || '',
            level,
            source: 'weather',
            icon: 'warning',
            entity_id: entityId,
            created_at: (msg.timestamp as string) || new Date().toISOString(),
            read: false,
            auto_dismiss_secs: 0,
          }
          // Only add if no existing notification for this entity
          setNotifications(prev => {
            const existing = prev.find(n => n.entity_id === entityId && n.id.startsWith('warning-'))
            if (existing) {
              // Update existing
              return prev.map(n => n.id === existing.id ? { ...syntheticNotif, id: existing.id, read: existing.read } : n)
            }
            return [...prev, syntheticNotif]
          })
          showLatest(syntheticNotif)
        } else {
          // Warning cleared — remove synthetic notification
          setNotifications(prev => prev.filter(n => !(n.entity_id === entityId && n.id.startsWith('warning-'))))
        }
      }
    })

    return unsub
  }, [])

  const markAsRead = useCallback(async (id: string) => {
    markNotificationRead(id)
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
    if (!token) return
    try {
      await fetch(`/api/notifications/${id}/read`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'X-Action-Intent': 'write' },
      })
    } catch { /* optimistic update already applied */ }
  }, [token])

  useEffect(() => {
    const openDetail = (event: Event) => {
      const notification = (event as CustomEvent<Notification>).detail
      if (notification) {
        setDetailNotification(notification)
        void markAsRead(notification.id)
      }
    }
    const showToast = (event: Event) => {
      const detail = (event as CustomEvent<SystemNotificationOptions | { message: string }>).detail
      if (!detail?.message) return
      notifySystem({ ...detail, message: detail.message })
    }
    window.addEventListener('rumahl:notification-open', openDetail)
    window.addEventListener('rumahl:toast', showToast)
    return () => {
      window.removeEventListener('rumahl:notification-open', openDetail)
      window.removeEventListener('rumahl:toast', showToast)
    }
  }, [markAsRead])

  const dismissNotification = useCallback(async (id: string) => {
    removeNotification(id)
    if (!token) return
    setNotifications(prev => prev.filter(n => n.id !== id))
    try {
      await fetch(`/api/notifications/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}`, 'X-Action-Intent': 'write' },
      })
    } catch { /* optimistic update already applied */ }
  }, [token])

  const dismissEmergencyAlert = useCallback(() => {
    setEmergencyAlert(null)
  }, [])

  const dismissLatestNotification = useCallback(() => {
    if (latestTimerRef.current) {
      clearTimeout(latestTimerRef.current)
      latestTimerRef.current = null
    }
    setLatestNotification(null)
  }, [])

  const showLatest = useCallback((notif: Notification) => {
    setLatestNotification(notif)
    if (latestTimerRef.current) clearTimeout(latestTimerRef.current)
    // Auto-collapse the Dynamic Island after 60 seconds for all levels
    latestTimerRef.current = setTimeout(() => setLatestNotification(null), 60000)
  }, [])

  const clearAll = useCallback(async () => {
    clearStoredNotifications()
    if (!token) return
    setNotifications([])
    try {
      await fetch('/api/notifications', {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}`, 'X-Action-Intent': 'write' },
      })
    } catch { /* optimistic update already applied */ }
  }, [token])

  const unreadCount = useMemo(() =>
    notifications.filter(n => !n.read).length,
    [notifications]
  )

  const value = useMemo(() => ({
    notifications,
    unreadCount,
    emergencyAlert,
    latestNotification,
    markAsRead,
    dismissNotification,
    dismissEmergencyAlert,
    dismissLatestNotification,
    clearAll,
  }), [notifications, unreadCount, emergencyAlert, latestNotification, markAsRead, dismissNotification, dismissEmergencyAlert, dismissLatestNotification, clearAll])

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <NotificationDetailDialog
        notification={detailNotification}
        onClose={() => setDetailNotification(null)}
        onAction={(actionId, href) => {
          window.dispatchEvent(new CustomEvent('rumahl:notification-action', { detail: { actionId, notification: detailNotification } }))
          if (href) window.open(href, '_blank', 'noopener,noreferrer')
          setDetailNotification(null)
        }}
      />
    </NotificationContext.Provider>
  )
}

export function useNotifications() {
  const ctx = useContext(NotificationContext)
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider')
  return ctx
}
