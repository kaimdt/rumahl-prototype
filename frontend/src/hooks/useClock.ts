import { useEffect, useState } from 'react'

/**
 * useClock — a minute-accurate clock synced to the next full minute (like the
 * macOS menu bar and iOS lock screen). Re-renders exactly at :00 seconds, so
 * the time never drifts or lags behind.
 */
export function useClock(): Date {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    let timer: number | undefined
    const schedule = () => {
      const msToNextMinute =
        (60 - new Date().getSeconds()) * 1000 - new Date().getMilliseconds()
      timer = window.setTimeout(() => {
        setNow(new Date())
        schedule()
      }, msToNextMinute)
    }
    schedule()
    return () => { if (timer != null) window.clearTimeout(timer) }
  }, [])

  return now
}
