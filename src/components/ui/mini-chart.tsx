import { useId, useMemo, useState, useCallback, useRef } from 'react'

interface MiniChartProps {
  data: { time: number; value: number }[]
  color?: string
  height?: number
  className?: string
  unit?: string
}

function formatTimeLabel(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
}

/** Generate time axis labels with day-change markers like HA does */
function generateTimeLabels(tMin: number, tMax: number, viewW: number, padLeft: number, usableW: number): { x: number; label: string; isBold: boolean }[] {
  const totalHours = (tMax - tMin) / (3600 * 1000)
  const tRange = tMax - tMin || 1
  const labels: { x: number; label: string; isBold: boolean }[] = []

  // Determine interval
  let intervalHours = 4
  if (totalHours > 168) intervalHours = 24
  else if (totalHours > 72) intervalHours = 12
  else if (totalHours > 36) intervalHours = 8
  else if (totalHours > 18) intervalHours = 6
  else if (totalHours <= 6) intervalHours = 2

  const intervalMs = intervalHours * 3600 * 1000
  const firstLabel = Math.ceil(tMin / intervalMs) * intervalMs

  // Find midnight boundaries within range
  const midnights: number[] = []
  const startDay = new Date(tMin)
  startDay.setHours(0, 0, 0, 0)
  let midnightTs = startDay.getTime() + 24 * 3600 * 1000 // first midnight after tMin
  while (midnightTs <= tMax) {
    midnights.push(midnightTs)
    midnightTs += 24 * 3600 * 1000
  }

  // Add time labels
  for (let t = firstLabel; t <= tMax; t += intervalMs) {
    const x = padLeft + ((t - tMin) / tRange) * usableW
    if (x >= padLeft + 15 && x <= padLeft + usableW - 15) {
      // Check if this time label is near a midnight (within half interval)
      const nearMidnight = midnights.find(m => Math.abs(t - m) < intervalMs / 2)
      if (nearMidnight) {
        // Replace with date label
        const d = new Date(nearMidnight)
        const midnightX = padLeft + ((nearMidnight - tMin) / tRange) * usableW
        if (midnightX >= padLeft + 15 && midnightX <= padLeft + usableW - 15) {
          let dateLabel: string
          if (totalHours > 120) {
            // Multi-day: show short day name
            dateLabel = d.toLocaleDateString('de-DE', { weekday: 'short' })
          } else {
            // Few days: show "5. Mär"
            dateLabel = `${d.getDate()}. ${d.toLocaleDateString('de-DE', { month: 'short' })}`
          }
          // Only add if not too close to an existing label
          const tooClose = labels.some(l => Math.abs(l.x - midnightX) < 30)
          if (!tooClose) {
            labels.push({ x: midnightX, label: dateLabel, isBold: true })
          }
        }
        // Remove this midnight from the list so we don't add it again
        const idx = midnights.indexOf(nearMidnight)
        if (idx >= 0) midnights.splice(idx, 1)
      } else {
        // Normal time label — check not too close to existing
        const tooClose = labels.some(l => Math.abs(l.x - x) < 30)
        if (!tooClose) {
          labels.push({ x, label: formatTimeLabel(t), isBold: false })
        }
      }
    }
  }

  // Add any remaining midnights that weren't near a regular label
  for (const m of midnights) {
    const mx = padLeft + ((m - tMin) / tRange) * usableW
    if (mx >= padLeft + 15 && mx <= padLeft + usableW - 15) {
      const tooClose = labels.some(l => Math.abs(l.x - mx) < 30)
      if (!tooClose) {
        const d = new Date(m)
        let dateLabel: string
        if (totalHours > 120) {
          dateLabel = d.toLocaleDateString('de-DE', { weekday: 'short' })
        } else {
          dateLabel = `${d.getDate()}. ${d.toLocaleDateString('de-DE', { month: 'short' })}`
        }
        labels.push({ x: mx, label: dateLabel, isBold: true })
      }
    }
  }

  // Sort by x position
  labels.sort((a, b) => a.x - b.x)

  return labels
}

export function MiniChart({
  data,
  color = 'oklch(0.65 0.18 250)',
  height = 150,
  className,
  unit,
}: MiniChartProps) {
  const id = useId()
  const gradientId = `chart-grad-${id.replace(/:/g, '')}`
  const svgRef = useRef<SVGSVGElement>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; value: number; time: number } | null>(null)

  const viewW = 400
  const padLeft = 0
  const padRight = 0
  const padTop = 12
  const padBottom = 28 // extra room for date labels
  const usableW = viewW - padLeft - padRight
  const usableH = height - padTop - padBottom

  const { linePath, areaPath, minVal, maxVal, timeLabels, lastPoint, tMin, tRange, valueMin, valueRange } = useMemo(() => {
    if (data.length < 2) return { linePath: '', areaPath: '', minVal: 0, maxVal: 0, timeLabels: [] as { x: number; label: string; isBold: boolean }[], lastPoint: null as { x: number; y: number } | null, tMin: 0, tRange: 1, valueMin: 0, valueRange: 1 }

    const values = data.map(d => d.value)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const range = max - min || 1

    const tMinVal = data[0].time
    const tMaxVal = data[data.length - 1].time
    const tRangeVal = tMaxVal - tMinVal || 1

    const points = data.map(d => {
      const x = padLeft + ((d.time - tMinVal) / tRangeVal) * usableW
      const y = padTop + usableH - ((d.value - min) / range) * usableH
      return { x, y }
    })

    const parts = points.map((p, i) => (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`))
    const line = parts.join(' ')
    const area = `${line} L${points[points.length - 1].x},${padTop + usableH} L${points[0].x},${padTop + usableH} Z`

    const labels = generateTimeLabels(tMinVal, tMaxVal, viewW, padLeft, usableW)

    return {
      linePath: line,
      areaPath: area,
      minVal: min,
      maxVal: max,
      timeLabels: labels,
      lastPoint: points[points.length - 1],
      tMin: tMinVal,
      tRange: tRangeVal,
      valueMin: min,
      valueRange: range,
    }
  }, [data, height, usableW, usableH, padLeft, padTop])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!svgRef.current || data.length < 2) return
    const rect = svgRef.current.getBoundingClientRect()
    const relX = (e.clientX - rect.left) / rect.width
    const svgX = relX * viewW

    let closest = data[0]
    let closestDist = Infinity
    for (const d of data) {
      const dx = padLeft + ((d.time - tMin) / tRange) * usableW
      const dist = Math.abs(dx - svgX)
      if (dist < closestDist) {
        closestDist = dist
        closest = d
      }
    }

    const px = padLeft + ((closest.time - tMin) / tRange) * usableW
    const py = padTop + usableH - ((closest.value - valueMin) / valueRange) * usableH

    setTooltip({ x: px, y: py, value: closest.value, time: closest.time })
  }, [data, tMin, tRange, viewW, usableW, usableH, padLeft, padTop, valueMin, valueRange])

  const handlePointerLeave = useCallback(() => {
    setTooltip(null)
  }, [])

  if (data.length < 2) {
    return (
      <div
        className={`flex items-center justify-center ${className || ''}`}
        style={{ height }}
      >
        <span className="text-[11px] text-foreground/30">Nicht genug Daten</span>
      </div>
    )
  }

  const formatVal = (v: number) => (v % 1 === 0 ? String(v) : v.toFixed(1))

  return (
    <div className={className}>
      <div className="flex justify-between mb-1">
        <span className="text-[10px] text-foreground/30">
          Min: {formatVal(minVal)}{unit ? ` ${unit}` : ''}
        </span>
        <span className="text-[10px] text-foreground/30">
          Max: {formatVal(maxVal)}{unit ? ` ${unit}` : ''}
        </span>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${viewW} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        className="overflow-visible touch-none"
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>

        {/* Horizontal grid lines */}
        {[0.25, 0.5, 0.75].map((frac) => (
          <line
            key={frac}
            x1={padLeft}
            y1={padTop + usableH * frac}
            x2={padLeft + usableW}
            y2={padTop + usableH * frac}
            stroke="oklch(from var(--foreground) l c h / 0.05)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {/* Vertical tick lines at labels */}
        {timeLabels.map((tl, i) => (
          <line
            key={`tick-${i}`}
            x1={tl.x}
            y1={padTop}
            x2={tl.x}
            y2={padTop + usableH}
            stroke={tl.isBold ? 'oklch(from var(--foreground) l c h / 0.12)' : 'oklch(from var(--foreground) l c h / 0.05)'}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {/* Area fill */}
        <path d={areaPath} fill={`url(#${gradientId})`} />

        {/* Line */}
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />

        {/* End dot */}
        {lastPoint && !tooltip && (
          <circle
            cx={lastPoint.x}
            cy={lastPoint.y}
            r={3}
            fill={color}
            vectorEffect="non-scaling-stroke"
          />
        )}

        {/* Tooltip */}
        {tooltip && (
          <>
            <line
              x1={tooltip.x}
              y1={padTop}
              x2={tooltip.x}
              y2={padTop + usableH}
              stroke="oklch(from var(--foreground) l c h / 0.2)"
              strokeWidth={1}
              strokeDasharray="3,3"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={tooltip.x}
              cy={tooltip.y}
              r={4}
              fill={color}
              stroke="white"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
            <rect
              x={Math.min(Math.max(tooltip.x - 50, 2), viewW - 102)}
              y={Math.max(tooltip.y - 36, 0)}
              width={100}
              height={24}
              rx={6}
              fill="oklch(from var(--foreground) l c h / 0.85)"
            />
            <text
              x={Math.min(Math.max(tooltip.x, 52), viewW - 52)}
              y={Math.max(tooltip.y - 20, 14)}
              textAnchor="middle"
              fill="oklch(from var(--background) l c h / 0.95)"
              style={{ fontSize: '10px', fontWeight: 600 }}
            >
              {formatVal(tooltip.value)}{unit ? ` ${unit}` : ''} — {formatTimeLabel(tooltip.time)}
            </text>
          </>
        )}

        {/* Time / date labels along bottom */}
        {timeLabels.map((tl, i) => (
          <text
            key={`label-${i}`}
            x={tl.x}
            y={height - 4}
            textAnchor="middle"
            fill={tl.isBold ? 'oklch(from var(--foreground) l c h / 0.55)' : 'oklch(from var(--foreground) l c h / 0.35)'}
            style={{ fontSize: tl.isBold ? '10px' : '10px', fontWeight: tl.isBold ? 700 : 400 }}
          >
            {tl.label}
          </text>
        ))}
      </svg>
    </div>
  )
}

/** State timeline bar for non-numeric entities (on/off, states) */
interface StateTimelineProps {
  data: { time: number; state: string }[]
  height?: number
  className?: string
}

function getStateColor(state: string): string {
  const lower = state.toLowerCase()
  if (lower === 'on' || lower === 'home' || lower === 'open' || lower === 'playing') return 'oklch(0.65 0.20 145)'
  if (lower === 'off' || lower === 'not_home' || lower === 'closed' || lower === 'idle' || lower === 'paused') return 'oklch(0.55 0.05 250)'
  if (lower === 'unavailable' || lower === 'unknown') return 'oklch(0.50 0.02 250)'
  let hash = 0
  for (let i = 0; i < state.length; i++) hash = state.charCodeAt(i) + ((hash << 5) - hash)
  const hue = Math.abs(hash) % 360
  return `oklch(0.65 0.15 ${hue})`
}

export { getStateColor }

export function StateTimeline({
  data,
  height = 40,
  className,
}: StateTimelineProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [tooltip, setTooltip] = useState<{ x: number; state: string; from: number; to: number } | null>(null)

  const viewW = 400

  const { segments, timeLabels } = useMemo(() => {
    if (data.length === 0) return { segments: [] as { x: number; width: number; state: string; color: string; from: number; to: number }[], timeLabels: [] as { x: number; label: string; isBold: boolean }[] }

    const tMinVal = data[0].time
    const tMaxVal = data.length > 1 ? data[data.length - 1].time : tMinVal + 24 * 3600 * 1000
    const now = Date.now()
    const tEndVal = Math.min(now, tMaxVal + 3600 * 1000)
    const tRangeVal = tEndVal - tMinVal || 1

    const segs = data.map((d, i) => {
      const x = ((d.time - tMinVal) / tRangeVal) * viewW
      const nextTime = i < data.length - 1 ? data[i + 1].time : tEndVal
      const width = ((nextTime - d.time) / tRangeVal) * viewW
      return { x, width: Math.max(width, 1), state: d.state, color: getStateColor(d.state), from: d.time, to: nextTime }
    })

    const labels = generateTimeLabels(tMinVal, tEndVal, viewW, 0, viewW)

    return { segments: segs, timeLabels: labels }
  }, [data])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!svgRef.current || segments.length === 0) return
    const rect = svgRef.current.getBoundingClientRect()
    const relX = (e.clientX - rect.left) / rect.width
    const svgX = relX * viewW

    for (const seg of segments) {
      if (svgX >= seg.x && svgX <= seg.x + seg.width) {
        setTooltip({ x: svgX, state: seg.state, from: seg.from, to: seg.to })
        return
      }
    }
    setTooltip(null)
  }, [segments, viewW])

  const handlePointerLeave = useCallback(() => {
    setTooltip(null)
  }, [])

  if (data.length === 0) {
    return (
      <div
        className={`flex items-center justify-center ${className || ''}`}
        style={{ height }}
      >
        <span className="text-[11px] text-foreground/30">Keine Daten</span>
      </div>
    )
  }

  const uniqueStates = [...new Set(data.map(d => d.state))]
  const barH = 24
  const totalH = barH + 28 // extra room for date labels

  return (
    <div className={className}>
      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2">
        {uniqueStates.map(state => (
          <div key={state} className="flex items-center gap-1.5">
            <div
              className="w-2.5 h-2.5 rounded-sm"
              style={{ backgroundColor: getStateColor(state) }}
            />
            <span className="text-[10px] text-foreground/50 capitalize">
              {state.replace(/_/g, ' ')}
            </span>
          </div>
        ))}
      </div>

      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${viewW} ${totalH}`}
          width="100%"
          height={totalH}
          preserveAspectRatio="none"
          className="overflow-visible touch-none"
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
        >
          {/* State segments */}
          {segments.map((seg, i) => (
            <rect
              key={i}
              x={seg.x}
              y={0}
              width={seg.width}
              height={barH}
              fill={seg.color}
              rx={i === 0 ? 5 : i === segments.length - 1 ? 5 : 0}
              ry={i === 0 ? 5 : i === segments.length - 1 ? 5 : 0}
              opacity={tooltip && tooltip.state !== seg.state ? 0.4 : 1}
              style={{ transition: 'opacity 0.15s ease' }}
            />
          ))}

          {/* State name labels on wide segments */}
          {segments.map((seg, i) => {
            // Only show text if segment is wide enough (~60px in viewBox units)
            if (seg.width < 40) return null
            const label = seg.state.replace(/_/g, ' ')
            // Capitalize first letter
            const displayLabel = label.charAt(0).toUpperCase() + label.slice(1)
            return (
              <text
                key={`seg-label-${i}`}
                x={seg.x + seg.width / 2}
                y={barH / 2 + 1}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="white"
                opacity={0.85}
                style={{ fontSize: '8px', fontWeight: 600, textShadow: '0 1px 2px rgba(0,0,0,0.3)' }}
              >
                {displayLabel.length > seg.width / 5 ? displayLabel.slice(0, Math.floor(seg.width / 5)) + '…' : displayLabel}
              </text>
            )
          })}

          {/* Tooltip vertical line */}
          {tooltip && (
            <line
              x1={tooltip.x}
              y1={0}
              x2={tooltip.x}
              y2={barH}
              stroke="oklch(from var(--foreground) l c h / 0.5)"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          )}

          {/* Time / date labels */}
          {timeLabels.map((tl, i) => (
            <text
              key={`label-${i}`}
              x={tl.x}
              y={totalH - 4}
              textAnchor="middle"
              fill={tl.isBold ? 'oklch(from var(--foreground) l c h / 0.55)' : 'oklch(from var(--foreground) l c h / 0.35)'}
              style={{ fontSize: '10px', fontWeight: tl.isBold ? 700 : 400 }}
            >
              {tl.label}
            </text>
          ))}
        </svg>

        {/* HTML tooltip */}
        {tooltip && (
          <div
            className="absolute pointer-events-none z-10 px-2.5 py-1.5 rounded-lg text-[10px] font-medium whitespace-nowrap"
            style={{
              left: `${(tooltip.x / viewW) * 100}%`,
              top: '-40px',
              transform: 'translateX(-50%)',
              background: 'oklch(from var(--foreground) l c h / 0.85)',
              color: 'oklch(from var(--background) l c h / 0.95)',
            }}
          >
            <span className="capitalize">{tooltip.state.replace(/_/g, ' ')}</span>
            <span className="opacity-70 ml-1.5">
              {formatTimeLabel(tooltip.from)} – {formatTimeLabel(tooltip.to)}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
