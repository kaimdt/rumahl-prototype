import { useState, useRef, useCallback, useEffect } from 'react'
import { CaretLeft, CaretRight, DotOutline } from '@phosphor-icons/react'
import { RenderWidget } from '@/components/CustomPageRenderer'
import type { DashboardWidget, EntityState } from '@/lib/types'

interface WidgetCarouselWidgetProps {
  widget: DashboardWidget
  entities: EntityState[]
  onUpdate: () => void
}

export default function WidgetCarouselWidget({ widget, entities, onUpdate }: WidgetCarouselWidgetProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const touchStartX = useRef(0)
  const touchDelta = useRef(0)

  const childWidgets: DashboardWidget[] = Array.isArray(widget.config?.widgets)
    ? (widget.config.widgets as DashboardWidget[]).filter(
        (w) => w && typeof w === 'object' && typeof w.type === 'string'
      )
    : []

  const autoPlay = widget.config?.autoPlay as boolean | undefined
  const autoPlayInterval = Number(widget.config?.autoPlayInterval || 5000)
  const showDots = (widget.config?.showDots as boolean) !== false
  const showArrows = (widget.config?.showArrows as boolean) !== false

  const count = childWidgets.length

  const goTo = useCallback((index: number) => {
    const clamped = Math.max(0, Math.min(count - 1, index))
    setActiveIndex(clamped)
  }, [count])

  const next = useCallback(() => goTo(activeIndex >= count - 1 ? 0 : activeIndex + 1), [activeIndex, count, goTo])
  const prev = useCallback(() => goTo(activeIndex <= 0 ? count - 1 : activeIndex - 1), [activeIndex, count, goTo])

  // Auto-play
  useEffect(() => {
    if (!autoPlay || count <= 1) return
    const timer = setInterval(next, autoPlayInterval)
    return () => clearInterval(timer)
  }, [autoPlay, autoPlayInterval, count, next])

  // Touch/swipe handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
    touchDelta.current = 0
  }, [])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    touchDelta.current = e.touches[0].clientX - touchStartX.current
  }, [])

  const handleTouchEnd = useCallback(() => {
    if (Math.abs(touchDelta.current) > 50) {
      if (touchDelta.current > 0) prev()
      else next()
    }
    touchDelta.current = 0
  }, [next, prev])

  if (count === 0) {
    return (
      <div className="flex items-center justify-center h-full text-foreground/30 text-xs">
        Keine Widgets im Karussell
      </div>
    )
  }

  return (
    <div
      className="relative flex flex-col h-full overflow-hidden"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Slide area */}
      <div ref={scrollRef} className="flex-1 relative min-h-0">
        {childWidgets.map((child, i) => (
          <div
            key={child.id}
            className="absolute inset-0 transition-all duration-300 ease-in-out"
            style={{
              opacity: i === activeIndex ? 1 : 0,
              pointerEvents: i === activeIndex ? 'auto' : 'none',
              transform: `translateX(${(i - activeIndex) * 100}%)`,
            }}
          >
            <RenderWidget
              widget={child}
              entities={entities}
              onUpdate={onUpdate}
            />
          </div>
        ))}
      </div>

      {/* Navigation arrows */}
      {showArrows && count > 1 && (
        <>
          <button
            onClick={prev}
            className="absolute left-1 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center text-white/70 hover:text-white hover:bg-black/50 transition-colors z-10"
          >
            <CaretLeft size={12} weight="bold" />
          </button>
          <button
            onClick={next}
            className="absolute right-1 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center text-white/70 hover:text-white hover:bg-black/50 transition-colors z-10"
          >
            <CaretRight size={12} weight="bold" />
          </button>
        </>
      )}

      {/* Dot indicators */}
      {showDots && count > 1 && (
        <div className="flex items-center justify-center gap-1 py-1">
          {childWidgets.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              className={`w-1.5 h-1.5 rounded-full transition-all ${
                i === activeIndex
                  ? 'bg-foreground/60 w-3'
                  : 'bg-foreground/20 hover:bg-foreground/30'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  )
}
