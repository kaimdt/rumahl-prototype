/**
 * notificationStore — a tiny module-level store that bridges OS toasts into the
 * notification (Benachrichtigungen) center. Any toast shown via `lib/toast.ts`
 * is recorded here; NotificationContext reads from it so toasts appear in the
 * notification center, not just as ephemeral popups.
 *
 * Kept dependency-free so both the toast wrapper and NotificationContext can
 * import it without cycles.
 */
export interface StoredNotification {
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
}

const STORE_KEY = 'rumahl-toast-notifications'
const MAX = 100

let items: StoredNotification[] = []
let hydrated = false
const listeners = new Set<() => void>()

function hydrate() {
  if (hydrated) return
  hydrated = true
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) items = parsed
    }
  } catch {
    /* ignore */
  }
}

function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(items.slice(0, MAX)))
  } catch {
    /* storage may be unavailable (kiosk) */
  }
}

function notify() {
  for (const fn of listeners) fn()
}

/** Add a toast-derived notification. Returns the record. */
export function pushNotification(entry: Omit<StoredNotification, 'id' | 'created_at' | 'read' | 'auto_dismiss_secs' | 'icon'> & { icon?: string }): StoredNotification {
  hydrate()
  const record: StoredNotification = {
    ...entry,
    icon: entry.icon || 'bell',
    entity_id: entry.entity_id || '',
    created_at: new Date().toISOString(),
    read: false,
    auto_dismiss_secs: 0,
    id: `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  }
  items = [record, ...items].slice(0, MAX)
  persist()
  notify()
  return record
}

/** Read all stored toasts. */
export function readNotifications(): StoredNotification[] {
  hydrate()
  return items
}

/** Mark a stored toast as read. */
export function markNotificationRead(id: string): void {
  hydrate()
  items = items.map((n) => (n.id === id ? { ...n, read: true } : n))
  persist()
  notify()
}

/** Remove a stored toast. */
export function removeNotification(id: string): void {
  hydrate()
  items = items.filter((n) => n.id !== id)
  persist()
  notify()
}

/** Clear every stored toast. */
export function clearNotifications(): void {
  hydrate()
  items = []
  persist()
  notify()
}

/** Subscribe to store changes. Returns an unsubscribe fn. */
export function subscribeNotifications(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
