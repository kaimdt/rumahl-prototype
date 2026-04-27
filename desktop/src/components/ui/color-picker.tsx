import { useRef, useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'

interface ColorPickerProps {
  value: [number, number, number] // RGB
  onChange: (color: [number, number, number]) => void
  onChangeEnd?: (color: [number, number, number]) => void
  disabled?: boolean
  size?: number
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  const toHex = (val: number) => clampByte(val).toString(16).padStart(2, '0').toUpperCase()
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function parseHexToRgb(raw: string): [number, number, number] | null {
  const normalized = raw.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(normalized)) return null

  const expanded = normalized.length === 3
    ? normalized.split('').map(char => `${char}${char}`).join('')
    : normalized

  const parsed = parseInt(expanded, 16)
  if (Number.isNaN(parsed)) return null

  return [
    (parsed >> 16) & 255,
    (parsed >> 8) & 255,
    parsed & 255,
  ]
}

// Convert RGB to HSV
function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r = r / 255
  g = g / 255
  b = b / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  const s = max === 0 ? 0 : d / max
  const v = max

  let h = 0
  if (max !== min) {
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0)
        break
      case g:
        h = (b - r) / d + 2
        break
      case b:
        h = (r - g) / d + 4
        break
    }
    h /= 6
  }

  return [h * 360, s * 100, v * 100]
}

// Convert HSV to RGB
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  h = h / 360
  s = s / 100
  v = v / 100

  const i = Math.floor(h * 6)
  const f = h * 6 - i
  const p = v * (1 - s)
  const q = v * (1 - f * s)
  const t = v * (1 - (1 - f) * s)

  let r = 0,
    g = 0,
    b = 0
  switch (i % 6) {
    case 0:
      r = v
      g = t
      b = p
      break
    case 1:
      r = q
      g = v
      b = p
      break
    case 2:
      r = p
      g = v
      b = t
      break
    case 3:
      r = p
      g = q
      b = v
      break
    case 4:
      r = t
      g = p
      b = v
      break
    case 5:
      r = v
      g = p
      b = q
      break
  }

  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]
}

export function ColorPicker({
  value,
  onChange,
  onChangeEnd,
  disabled = false,
  size = 200,
}: ColorPickerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const isDraggingRef = useRef(false)

  const [h, s, v] = rgbToHsv(value[0], value[1], value[2])
  const [hue, setHue] = useState(h)
  const [saturation, setSaturation] = useState(s)
  const [brightness, setBrightness] = useState(v)
  const [hexValue, setHexValue] = useState(rgbToHex(value))

  // Update internal state when value prop changes
  useEffect(() => {
    const [newH, newS, newV] = rgbToHsv(value[0], value[1], value[2])
    setHue(newH)
    setSaturation(newS)
    setBrightness(newV)
    setHexValue(rgbToHex(value))
  }, [value])

  // Draw color wheel
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return

    const centerX = size / 2
    const centerY = size / 2
    const radius = size / 2 - 10

    // Clear canvas
    ctx.clearRect(0, 0, size, size)

    // Draw color wheel
    for (let angle = 0; angle < 360; angle += 1) {
      const startAngle = (angle - 90) * (Math.PI / 180)
      const endAngle = (angle + 1 - 90) * (Math.PI / 180)

      for (let r = 0; r <= radius; r += 1) {
        const sat = (r / radius) * 100
        const [red, green, blue] = hsvToRgb(angle, sat, brightness)

        ctx.beginPath()
        ctx.strokeStyle = `rgb(${red}, ${green}, ${blue})`
        ctx.lineWidth = 2
        ctx.arc(centerX, centerY, r, startAngle, endAngle)
        ctx.stroke()
      }
    }
  }, [size, brightness])

  const updateColorFromPosition = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current
      if (!canvas) return

      const rect = canvas.getBoundingClientRect()
      const x = clientX - rect.left
      const y = clientY - rect.top

      const centerX = size / 2
      const centerY = size / 2
      const dx = x - centerX
      const dy = y - centerY
      const distance = Math.sqrt(dx * dx + dy * dy)
      const radius = size / 2 - 10

      // Calculate angle
      let angle = Math.atan2(dy, dx) * (180 / Math.PI) + 90
      if (angle < 0) angle += 360

      // Calculate saturation
      const sat = Math.min((distance / radius) * 100, 100)

      setHue(angle)
      setSaturation(sat)

      const rgb = hsvToRgb(angle, sat, brightness)
      onChange(rgb)
    },
    [size, brightness, onChange]
  )

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled) return
      e.preventDefault()
      setIsDragging(true)
      isDraggingRef.current = true
      updateColorFromPosition(e.clientX, e.clientY)
    },
    [disabled, updateColorFromPosition]
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDraggingRef.current || disabled) return
      e.preventDefault()
      updateColorFromPosition(e.clientX, e.clientY)
    },
    [disabled, updateColorFromPosition]
  )

  const handlePointerUp = useCallback(() => {
    if (isDraggingRef.current) {
      setIsDragging(false)
      isDraggingRef.current = false
      const rgb = hsvToRgb(hue, saturation, brightness)
      onChangeEnd?.(rgb)
    }
  }, [hue, saturation, brightness, onChangeEnd])

  const handleBrightnessChange = useCallback((nextBrightness: number) => {
    setBrightness(nextBrightness)
    const rgb = hsvToRgb(hue, saturation, nextBrightness)
    onChange(rgb)
  }, [hue, saturation, onChange])

  const handleHexCommit = useCallback(() => {
    const parsed = parseHexToRgb(hexValue)
    if (!parsed) {
      setHexValue(rgbToHex(value))
      return
    }

    onChange(parsed)
    onChangeEnd?.(parsed)
  }, [hexValue, onChange, onChangeEnd, value])

  // Calculate position of color indicator
  const radius = size / 2 - 10
  const angle = (hue - 90) * (Math.PI / 180)
  const distance = (saturation / 100) * radius
  const indicatorX = size / 2 + distance * Math.cos(angle)
  const indicatorY = size / 2 + distance * Math.sin(angle)

  return (
    <div className="space-y-4">
      <div
        ref={containerRef}
        className="relative mx-auto"
        style={{ width: size, height: size }}
      >
        <canvas
          ref={canvasRef}
          width={size}
          height={size}
          className="rounded-full cursor-crosshair select-none touch-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          style={{
            opacity: disabled ? 0.5 : 1,
            pointerEvents: disabled ? 'none' : 'auto',
          }}
        />
        <motion.div
          className="absolute w-6 h-6 rounded-full border-3 border-white shadow-lg pointer-events-none"
          style={{
            left: indicatorX - 12,
            top: indicatorY - 12,
            backgroundColor: `rgb(${value[0]}, ${value[1]}, ${value[2]})`,
            boxShadow: '0 2px 8px rgba(0,0,0,0.3), inset 0 0 0 1px rgba(0,0,0,0.1)',
          }}
          animate={{
            scale: isDragging ? 1.2 : 1,
          }}
          transition={{
            type: 'spring',
            stiffness: 400,
            damping: 25,
          }}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-[11px] text-foreground/45">
          <span>Helligkeit</span>
          <span className="font-mono tabular-nums">{Math.round(brightness)}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={brightness}
          onChange={(e) => handleBrightnessChange(Number(e.target.value))}
          onPointerUp={() => onChangeEnd?.(hsvToRgb(hue, saturation, brightness))}
          disabled={disabled}
          className="w-full accent-[var(--accent)] disabled:opacity-50"
        />
      </div>

      <div
        className="rounded-xl p-3"
        style={{ background: 'oklch(from var(--foreground) l c h / 0.04)' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-lg border border-foreground/10 shrink-0"
            style={{ backgroundColor: `rgb(${value[0]}, ${value[1]}, ${value[2]})` }}
          />
          <div className="flex-1 min-w-0">
            <label className="text-[10px] text-foreground/45 block mb-1">HEX</label>
            <input
              type="text"
              value={hexValue}
              onChange={(e) => setHexValue(e.target.value)}
              onBlur={handleHexCommit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleHexCommit()
                }
              }}
              disabled={disabled}
              spellCheck={false}
              className="w-full rounded-lg px-2.5 py-1.5 text-xs font-mono text-foreground/80 border-none outline-none disabled:opacity-50"
              style={{ background: 'oklch(from var(--foreground) l c h / 0.08)' }}
              placeholder="#FFFFFF"
            />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-1.5 mt-2 text-[10px] text-foreground/45 font-mono tabular-nums">
          <div className="rounded-md px-2 py-1" style={{ background: 'oklch(from var(--foreground) l c h / 0.06)' }}>R: {value[0]}</div>
          <div className="rounded-md px-2 py-1" style={{ background: 'oklch(from var(--foreground) l c h / 0.06)' }}>G: {value[1]}</div>
          <div className="rounded-md px-2 py-1" style={{ background: 'oklch(from var(--foreground) l c h / 0.06)' }}>B: {value[2]}</div>
        </div>
      </div>
    </div>
  )
}
