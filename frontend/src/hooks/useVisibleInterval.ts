import { useEffect, useRef } from 'react'

/**
 * useVisibleInterval — a polling interval that pauses while the tab is hidden
 * and re-runs immediately when it becomes visible again. This keeps real-time
 * data fresh without wasting API requests in background tabs.
 */
export function useVisibleInterval(callback: () => void, intervalMs: number | null) {
  const savedCallback = useRef(callback)
  savedCallback.current = callback

  useEffect(() => {
    if (intervalMs == null) return

    let timer: number | undefined
    const stop = () => {
      if (timer != null) window.clearInterval(timer)
      timer = undefined
    }
    const start = () => {
      stop()
      savedCallback.current()
      timer = window.setInterval(() => savedCallback.current(), intervalMs)
    }

    start()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') start()
      else stop()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [intervalMs])
}
