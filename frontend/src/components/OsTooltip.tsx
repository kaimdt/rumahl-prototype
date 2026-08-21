import { useEffect, useRef, useState } from 'react'

interface TooltipState {
  text: string
  x: number
  y: number
}

/**
 * OsTooltipProvider — the OS-wide custom tooltip system. Any element with a
 * `data-tooltip="…"` attribute gets our styled tooltip instead of the native
 * browser title. Rendered inside the theme wrapper so CSS variables resolve.
 */
export function OsTooltipProvider() {
  const [tip, setTip] = useState<TooltipState | null>(null)
  const tipRef = useRef(tip)
  tipRef.current = tip

  useEffect(() => {
    let timer: number | null = null
    let current: HTMLElement | null = null

    const onMove = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      const el = target?.closest?.('[data-tooltip]') as HTMLElement | null
      if (el !== current) {
        current = el
        if (timer !== null) window.clearTimeout(timer)
        if (el) {
          const text = el.getAttribute('data-tooltip') || ''
          timer = window.setTimeout(() => {
            setTip({ text, x: event.clientX, y: event.clientY })
          }, 380)
        } else {
          setTip(null)
        }
      } else if (tipRef.current) {
        setTip((t) => (t ? { ...t, x: event.clientX, y: event.clientY } : t))
      }
    }

    const onLeave = () => {
      if (timer !== null) window.clearTimeout(timer)
      current = null
      setTip(null)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseleave', onLeave)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseleave', onLeave)
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [])

  if (!tip) return null
  const left = Math.min(tip.x + 14, window.innerWidth - 220)
  const top = Math.min(tip.y + 18, window.innerHeight - 46)
  return (
    <div className="rumahl-tooltip" style={{ left, top }} role="tooltip">
      {tip.text}
    </div>
  )
}
