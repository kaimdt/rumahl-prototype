import { useEffect, useRef, useState } from 'react'

interface TooltipState {
  text: string
  x: number
  y: number
}

/**
 * OsTooltipProvider — the OS-wide custom tooltip system.
 *
 * Every element that carries a `data-tooltip="…"` OR a native `title="…"`
 * attribute gets OUR styled tooltip (`.rumahl-tooltip`) instead of the browser's
 * native one. Native titles are intercepted centrally so no call-site needs to
 * change: on hover we read the `title`, suppress the browser tooltip by clearing
 * the attribute (the original text is cached and restored on leave), and render
 * our themed bubble. This keeps the OS illusion intact and works in kiosk mode.
 *
 * Rendered inside the theme wrapper so the CSS variables resolve.
 */
export function OsTooltipProvider() {
  const [tip, setTip] = useState<TooltipState | null>(null)
  const tipRef = useRef(tip)
  tipRef.current = tip

  // Track the element whose native title we temporarily cleared, so we can
  // restore it on leave. Restoring is important: a cleared title would
  // otherwise be lost for accessibility/SEO and future hovers.
  const suppressedRef = useRef<{ el: HTMLElement; title: string } | null>(null)

  useEffect(() => {
    let timer: number | null = null
    let current: HTMLElement | null = null

    // Temporarily strip the native title so the browser never paints its own
    // tooltip; cache the original to restore it on leave.
    const suppressNativeTitle = (el: HTMLElement) => {
      if (!el.hasAttribute('title')) return
      suppressedRef.current = { el, title: el.getAttribute('title') || '' }
      el.setAttribute('title', '')
    }
    const restoreNativeTitle = () => {
      const s = suppressedRef.current
      if (s) {
        s.el.setAttribute('title', s.title)
        suppressedRef.current = null
      }
    }

    const onMove = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (!target || typeof target.closest !== 'function') return
      // data-tooltip wins; otherwise fall back to a native title.
      const el = target.closest('[data-tooltip], [title]') as HTMLElement | null
      if (el !== current) {
        current = el
        restoreNativeTitle()
        if (timer !== null) window.clearTimeout(timer)
        if (el) {
          const text = el.getAttribute('data-tooltip') || el.getAttribute('title') || ''
          if (el.hasAttribute('title')) suppressNativeTitle(el)
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
      restoreNativeTitle()
      setTip(null)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseleave', onLeave)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseleave', onLeave)
      if (timer !== null) window.clearTimeout(timer)
      restoreNativeTitle()
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
