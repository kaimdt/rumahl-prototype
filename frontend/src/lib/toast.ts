/**
 * toast — rumahl's toast wrapper.
 *
 * Re-exports sonner's `toast` so every call site keeps working unchanged, but
 * additionally records each toast into the notification store so it also shows
 * up in the Benachrichtigungen (notification center) and survives reloads.
 */
import { toast as sonnerToast } from 'sonner'
import { pushNotification } from '@/lib/notificationStore'

type ToastFn = (message: string, options?: Record<string, unknown>) => string | number
type ToastPromise = (promise: Promise<unknown>, msgs?: Record<string, unknown>, opts?: Record<string, unknown>) => string | number

function levelFor(kind: string): 'info' | 'warning' | 'critical' {
  if (kind === 'error') return 'critical'
  if (kind === 'warning') return 'warning'
  return 'info'
}

function record(kind: string, title: string, description?: string) {
  pushNotification({
    title: title || 'rumahl OS',
    message: description || '',
    level: levelFor(kind),
    source: 'toast',
  })
}

// Wrap the terminal toast kinds so they are journaled into the notification
// center. Transient kinds (loading, dismiss, promise) are left to sonner alone.
const wrapped = Object.create(sonnerToast)
for (const kind of ['success', 'error', 'info', 'warning', 'message'] as const) {
  const fn = (sonnerToast as unknown as Record<string, ToastFn>)[kind]
  if (typeof fn === 'function') {
    ;(wrapped as unknown as Record<string, ToastFn>)[kind] = ((message: string, options?: Record<string, unknown>) => {
      const desc = typeof options?.description === 'string' ? options.description : undefined
      record(kind, message, desc)
      return fn.call(sonnerToast, message, options)
    }) as ToastFn
  }
}

export const toast = wrapped
