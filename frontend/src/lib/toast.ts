/**
 * toast — rumahl's toast wrapper.
 *
 * Re-exports sonner's `toast` so every call site keeps working unchanged, but
 * additionally records each toast into the notification store so it also shows
 * up in the Benachrichtigungen (notification center) and survives reloads.
 */
import { toast as sonnerToast } from 'sonner'
import { pushNotification, type NotificationAction, type StoredNotification } from '@/lib/notificationStore'

type ToastFn = (message: string, options?: Record<string, unknown>) => string | number
type ToastPromise = (promise: Promise<unknown>, msgs?: Record<string, unknown>, opts?: Record<string, unknown>) => string | number

function levelFor(kind: string): 'info' | 'warning' | 'critical' {
  if (kind === 'error') return 'critical'
  if (kind === 'warning') return 'warning'
  return 'info'
}

function record(kind: string, title: string, options?: Record<string, unknown>): StoredNotification {
  const duration = typeof options?.duration === 'number' ? options.duration : 0
  return pushNotification({
    title: title || 'rumahl OS',
    message: typeof options?.description === 'string' ? options.description : '',
    level: levelFor(kind),
    source: 'toast',
    entity_id: '',
    persistent: options?.persistent === true || options?.duration === Infinity,
    auto_dismiss_secs: duration > 0 && Number.isFinite(duration) ? Math.round(duration / 1000) : 0,
    actions: Array.isArray(options?.actions) ? options.actions as NotificationAction[] : undefined,
  })
}

function openNotification(notification: StoredNotification) {
  window.dispatchEvent(new CustomEvent('rumahl:notification-open', { detail: notification }))
}

// Wrap the terminal toast kinds so they are journaled into the notification
// center. Transient kinds (loading, dismiss, promise) are left to sonner alone.
const wrapped = Object.create(sonnerToast)
for (const kind of ['success', 'error', 'info', 'warning', 'message'] as const) {
  const fn = (sonnerToast as unknown as Record<string, ToastFn>)[kind]
  if (typeof fn === 'function') {
    ;(wrapped as unknown as Record<string, ToastFn>)[kind] = ((message: string, options?: Record<string, unknown>) => {
      const notification = record(kind, message, options)
      const originalClick = options?.onClick
      return fn.call(sonnerToast, message, {
        ...options,
        duration: options?.persistent === true ? Infinity : options?.duration,
        onClick: (event: MouseEvent) => {
          if (typeof originalClick === 'function') originalClick(event)
          openNotification(notification)
        },
      })
    }) as ToastFn
  }
}

export interface SystemNotificationOptions {
  title?: string
  message: string
  type?: 'success' | 'error' | 'info' | 'warning'
  description?: string
  duration?: number
  persistent?: boolean
  actions?: NotificationAction[]
}

/** Unified sender API for apps and DOM bridges. */
export function notifySystem(options: SystemNotificationOptions): string | number {
  const kind = options.type || 'info'
  const fn = (wrapped as unknown as Record<string, ToastFn>)[kind] || wrapped.info
  return fn(options.title || options.message, {
    description: options.description || (options.title ? options.message : undefined),
    duration: options.duration,
    persistent: options.persistent,
    actions: options.actions,
  })
}

export const toast = wrapped
