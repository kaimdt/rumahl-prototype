import { useRef, useCallback, useState } from 'react'

interface ArcSliderProps {
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  onChangeEnd?: (value: number) => void
  disabled?: boolean
  size?: number
  strokeWidth?: number
  modeColor?: string
  currentTemp?: number
  label?: string
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180
  return {
    x: cx + r * Math.cos(rad),
    y: cy - r * Math.sin(rad),
  }
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, r, startAngle)
  const end = polarToCartesian(cx, cy, r, endAngle)
  const sweepAngle = startAngle - endAngle
  const largeArc = sweepAngle > 180 ? 1 : 0
  // sweep=1 draws the arc through the top (∩ shape) for our angle configuration
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`
}

function normalizeAngle(angle: number): number {
  let a = angle % 360
  if (a < 0) a += 360
  return a
}

function circularDistance(a: number, b: number): number {
  const diff = Math.abs(a - b)
  return Math.min(diff, 360 - diff)
}

export function ArcSlider({
  value,
  min,
  max,
  step,
  onChange,
  onChangeEnd,
  disabled = false,
  size = 280,
  strokeWidth = 28,
  modeColor = 'var(--accent)',
  currentTemp,
  label,
}: ArcSliderProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const isDraggingRef = useRef(false)
  const [isDragging, setIsDragging] = useState(false)

  const padding = 8
  const cx = size / 2
  const cy = size / 2 + padding
  const r = size / 2 - strokeWidth / 2 - padding

  const startAngle = 160 // slightly past left for aesthetic arc
  const endAngle = 20   // slightly past right

  const valueToAngle = useCallback((val: number) => {
    const clampedVal = Math.max(min, Math.min(max, val))
    const fraction = (clampedVal - min) / (max - min)
    return startAngle - fraction * (startAngle - endAngle)
  }, [min, max, startAngle, endAngle])

  const angleToValue = useCallback((angle: number) => {
    const clamped = Math.max(endAngle, Math.min(startAngle, angle))
    const fraction = (startAngle - clamped) / (startAngle - endAngle)
    const raw = min + fraction * (max - min)
    return Math.round(raw / step) * step
  }, [min, max, step, startAngle, endAngle])

  const getAngleFromEvent = useCallback((clientX: number, clientY: number) => {
    if (!svgRef.current) return startAngle
    const rect = svgRef.current.getBoundingClientRect()
    const svgX = clientX - rect.left
    const svgY = clientY - rect.top
    const dx = svgX - cx
    const dy = cy - svgY // flip Y axis
    const rawAngle = Math.atan2(dy, dx) * (180 / Math.PI)
    const angle = normalizeAngle(rawAngle)

    // Valid arc section runs across the top from 160° to 20° (normalized: 20..160).
    if (angle >= endAngle && angle <= startAngle) {
      return angle
    }

    // Outside arc: snap to nearest endpoint to avoid random jumps near the lower dead-zone.
    const distToEnd = circularDistance(angle, endAngle)
    const distToStart = circularDistance(angle, startAngle)
    return distToEnd < distToStart ? endAngle : startAngle
  }, [cx, cy, startAngle, endAngle])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (disabled) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    isDraggingRef.current = true
    setIsDragging(true)
    const angle = getAngleFromEvent(e.clientX, e.clientY)
    const newValue = angleToValue(angle)
    onChange(newValue)
  }, [disabled, getAngleFromEvent, angleToValue, onChange])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current) return
    const angle = getAngleFromEvent(e.clientX, e.clientY)
    const newValue = angleToValue(angle)
    onChange(newValue)
  }, [getAngleFromEvent, angleToValue, onChange])

  const finishDrag = useCallback((pointerId: number | null, clientX: number, clientY: number, target: EventTarget | null) => {
    if (!isDraggingRef.current) return
    isDraggingRef.current = false
    setIsDragging(false)
    if (pointerId !== null && target instanceof Element) {
      try {
        target.releasePointerCapture(pointerId)
      } catch {
        // Ignore when capture is already released.
      }
    }
    const angle = getAngleFromEvent(clientX, clientY)
    const newValue = angleToValue(angle)
    onChangeEnd?.(newValue)
  }, [getAngleFromEvent, angleToValue, onChangeEnd])

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    finishDrag(e.pointerId, e.clientX, e.clientY, e.currentTarget)
  }, [finishDrag])

  const handlePointerCancel = useCallback((e: React.PointerEvent) => {
    finishDrag(e.pointerId, e.clientX, e.clientY, e.currentTarget)
  }, [finishDrag])

  const displayValue = Math.max(min, Math.min(max, value))
  const currentAngle = valueToAngle(displayValue)
  const thumbPos = polarToCartesian(cx, cy, r, currentAngle)

  // Build arc paths
  const trackPath = describeArc(cx, cy, r, startAngle, endAngle)
  const activePath = describeArc(cx, cy, r, startAngle, currentAngle)

  // Tick marks for min and max
  const minPos = polarToCartesian(cx, cy, r + strokeWidth / 2 + 12, startAngle)
  const maxPos = polarToCartesian(cx, cy, r + strokeWidth / 2 + 12, endAngle)

  const svgHeight = size / 2 + padding + strokeWidth + 20

  return (
    <div className="flex flex-col items-center">
      <svg
        ref={svgRef}
        width={size}
        height={svgHeight}
        viewBox={`0 0 ${size} ${svgHeight}`}
        className="touch-none select-none"
        style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={handlePointerCancel}
      >
        {/* Background track */}
        <path
          d={trackPath}
          fill="none"
          stroke="oklch(from var(--foreground) l c h / 0.08)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />

        {/* Active arc */}
        <path
          d={activePath}
          fill="none"
          stroke={modeColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 8px ${modeColor})` }}
        />

        {/* Glow behind active arc */}
        <path
          d={activePath}
          fill="none"
          stroke={modeColor}
          strokeWidth={strokeWidth + 10}
          strokeLinecap="round"
          opacity={0.15}
          style={{ filter: 'blur(6px)' }}
        />

        {/* Thumb */}
        <circle
          cx={thumbPos.x}
          cy={thumbPos.y}
          r={isDragging ? 18 : 15}
          fill="white"
          stroke={modeColor}
          strokeWidth={3}
          style={{
            filter: `drop-shadow(0 2px 6px rgba(0,0,0,0.3))`,
            transition: isDragging ? 'none' : 'cx 0.3s ease, cy 0.3s ease, r 0.2s ease',
          }}
        />

        {/* Center temperature display */}
        <text
          x={cx}
          y={cy - 14}
          textAnchor="middle"
          className="fill-foreground"
          style={{ fontSize: '36px', fontWeight: 300 }}
        >
          {displayValue.toFixed(1)}°
        </text>

        {label && (
          <text
            x={cx}
            y={cy + 10}
            textAnchor="middle"
            className="fill-foreground/40"
            style={{ fontSize: '11px', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}
          >
            {label}
          </text>
        )}

        {currentTemp !== undefined && (
          <text
            x={cx}
            y={cy + 30}
            textAnchor="middle"
            className="fill-foreground/50"
            style={{ fontSize: '13px', fontWeight: 400 }}
          >
            Aktuell {currentTemp.toFixed(1)}°C
          </text>
        )}

        {/* Min/max labels */}
        <text
          x={minPos.x}
          y={minPos.y + 4}
          textAnchor="middle"
          className="fill-foreground/25"
          style={{ fontSize: '10px' }}
        >
          {min}°
        </text>
        <text
          x={maxPos.x}
          y={maxPos.y + 4}
          textAnchor="middle"
          className="fill-foreground/25"
          style={{ fontSize: '10px' }}
        >
          {max}°
        </text>
      </svg>
    </div>
  )
}
