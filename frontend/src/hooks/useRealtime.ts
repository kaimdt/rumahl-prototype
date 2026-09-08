import { useEffect, useState } from 'react'
import { wsOnMessage } from '@/lib/wsConnection'

/**
 * useRealtime — subscribe to a WebSocket event type (e.g. `system_stats`).
 *
 * The backend broadcasts `{ type, data }` events over the shared `/ws` socket;
 * this hook returns the latest `data` for the given type so components can
 * show real-time values without polling.
 */
export function useRealtime<T>(eventType: string): T | null {
  const [data, setData] = useState<T | null>(null)

  useEffect(() => {
    const unsubscribe = wsOnMessage((msg) => {
      const m = msg as { type?: string; data?: T }
      if (m && m.type === eventType && m.data != null) setData(m.data)
    })
    return unsubscribe
  }, [eventType])

  return data
}
