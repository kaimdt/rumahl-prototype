import { useState, useRef, useCallback, useEffect } from 'react'
import { motion } from 'motion/react'
import { haptics } from '@/lib/haptics'

interface ColorPickerProps {
  value: [number, number, number]
  onChange: (rgb: [number, number, number]) => void
  onChangeComplete?: (rgb: [number, number, number]) => void
  disabled?: boolean
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min

  let h = 0
  if (delta !== 0) {
    if (max === r) {
      h = ((g - b) / delta) % 6
    } else if (max === g) {
      h = (b - r) / delta + 2
    } else {
      h = (r - g) / delta + 4
    }
    h = Math.round(h * 60)
    if (h < 0) h += 360
  }

  const s = max === 0 ? 0 : delta / max
  const v = max

  return [h, s * 100, v * 100]
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  s /= 100
  v /= 100

  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c

  let r = 0,
    g = 0,
    b = 0

  if (h >= 0 && h < 60) {
    r = c
    g = x
    b = 0
  } else if (h >= 60 && h < 120) {
    r = x
    g = c
    b = 0
  } else if (h >= 120 && h < 180) {
    r = 0
    g = c
    b = x
  } else if (h >= 180 && h < 240) {
    r = 0
    g = x
    b = c
  } else if (h >= 240 && h < 300) {
    r = x
    g = 0
    b = c
  } else if (h >= 300 && h < 360) {
    r = c
    g = 0
    b = x
  }

  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ]
}

export function ColorPicker({ value, onChange, onChangeComplete, disabled }: ColorPickerProps) {
  const [h, s, v] = rgbToHsv(value[0], value[1], value[2])
  const [localH, setLocalH] = useState(h)
  const [localS, setLocalS] = useState(s)
  const [localV, setLocalV] = useState(v)
  
  const hueCanvasRef = useRef<HTMLCanvasElement>(null)
  const satValCanvasRef = useRef<HTMLCanvasElement>(null)
  const isDraggingHue = useRef(false)
  const isDraggingSatVal = useRef(false)

  useEffect(() => {
    if (!isDraggingHue.current && !isDraggingSatVal.current) {
      setLocalH(h)
      setLocalS(s)
      setLocalV(v)
    }
  }, [h, s, v])

  useEffect(() => {
    drawHueBar()
  }, [])

  useEffect(() => {
    drawSatValSquare()
  }, [localH])

  const drawHueBar = () => {
    const canvas = hueCanvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const width = canvas.width
    const height = canvas.height

    for (let i = 0; i <= width; i++) {
      const hue = (i / width) * 360
      ctx.fillStyle = `hsl(${hue}, 100%, 50%)`
      ctx.fillRect(i, 0, 1, height)
    }
  }

  const drawSatValSquare = () => {
    const canvas = satValCanvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const width = canvas.width
    const height = canvas.height

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const sat = (x / width) * 100
        const val = 100 - (y / height) * 100
        const [r, g, b] = hsvToRgb(localH, sat, val)
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
        ctx.fillRect(x, y, 1, 1)
      }
    }
  }

  const handleHueInteraction = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
      if (disabled) return

      const canvas = hueCanvasRef.current
      if (!canvas) return

      const rect = canvas.getBoundingClientRect()
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
      const x = Math.max(0, Math.min(clientX - rect.left, rect.width))
      const newH = (x / rect.width) * 360

      setLocalH(newH)
      const rgb = hsvToRgb(newH, localS, localV)
      onChange(rgb)
      haptics.selection()
    },
    [disabled, localS, localV, onChange]
  )

  const handleSatValInteraction = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
      if (disabled) return

      const canvas = satValCanvasRef.current
      if (!canvas) return

      const rect = canvas.getBoundingClientRect()
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
      const x = Math.max(0, Math.min(clientX - rect.left, rect.width))
      const y = Math.max(0, Math.min(clientY - rect.top, rect.height))

      const newS = (x / rect.width) * 100
      const newV = 100 - (y / rect.height) * 100

      setLocalS(newS)
      setLocalV(newV)
      const rgb = hsvToRgb(localH, newS, newV)
      onChange(rgb)
      haptics.selection()
    },
    [disabled, localH, onChange]
  )

  const handleHueMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    isDraggingHue.current = true
    handleHueInteraction(e)
    haptics.impact('light')
  }, [handleHueInteraction])

  const handleSatValMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    isDraggingSatVal.current = true
    handleSatValInteraction(e)
    haptics.impact('light')
  }, [handleSatValInteraction])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingHue.current) {
        const canvas = hueCanvasRef.current
        if (!canvas) return
        const rect = canvas.getBoundingClientRect()
        const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width))
        const newH = (x / rect.width) * 360
        setLocalH(newH)
        const rgb = hsvToRgb(newH, localS, localV)
        onChange(rgb)
      } else if (isDraggingSatVal.current) {
        const canvas = satValCanvasRef.current
        if (!canvas) return
        const rect = canvas.getBoundingClientRect()
        const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width))
        const y = Math.max(0, Math.min(e.clientY - rect.top, rect.height))
        const newS = (x / rect.width) * 100
        const newV = 100 - (y / rect.height) * 100
        setLocalS(newS)
        setLocalV(newV)
        const rgb = hsvToRgb(localH, newS, newV)
        onChange(rgb)
      }
    }

    const handleMouseUp = () => {
      if (isDraggingHue.current || isDraggingSatVal.current) {
        haptics.impact('medium')
        onChangeComplete?.(hsvToRgb(localH, localS, localV))
      }
      isDraggingHue.current = false
      isDraggingSatVal.current = false
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [localH, localS, localV, onChange, onChangeComplete])

  const colorPresets = [
    [255, 255, 255],
    [255, 200, 150],
    [255, 150, 100],
    [255, 100, 100],
    [255, 100, 200],
    [200, 100, 255],
    [100, 150, 255],
    [100, 200, 255],
    [100, 255, 200],
    [150, 255, 100],
    [255, 255, 100],
    [255, 200, 100],
  ] as [number, number, number][]

  return (
    <div className="space-y-4">
      <div className="relative">
        <canvas
          ref={satValCanvasRef}
          width={300}
          height={200}
          className="w-full h-48 rounded-xl cursor-crosshair touch-none"
          onMouseDown={handleSatValMouseDown}
          onTouchStart={(e) => {
            isDraggingSatVal.current = true
            handleSatValInteraction(e)
            haptics.impact('light')
          }}
          onTouchMove={handleSatValInteraction}
          onTouchEnd={() => {
            isDraggingSatVal.current = false
            haptics.impact('medium')
            onChangeComplete?.(hsvToRgb(localH, localS, localV))
          }}
        />
        <motion.div
          className="absolute w-5 h-5 border-2 border-white rounded-full shadow-lg pointer-events-none"
          style={{
            left: `${localS}%`,
            top: `${100 - localV}%`,
            transform: 'translate(-50%, -50%)',
            backgroundColor: `rgb(${value[0]}, ${value[1]}, ${value[2]})`,
          }}
          animate={{
            scale: [1, 1.2, 1],
          }}
          transition={{
            duration: 0.5,
            repeat: Infinity,
          }}
        />
      </div>

      <div className="relative">
        <canvas
          ref={hueCanvasRef}
          width={300}
          height={24}
          className="w-full h-6 rounded-full cursor-pointer touch-none"
          onMouseDown={handleHueMouseDown}
          onTouchStart={(e) => {
            isDraggingHue.current = true
            handleHueInteraction(e)
            haptics.impact('light')
          }}
          onTouchMove={handleHueInteraction}
          onTouchEnd={() => {
            isDraggingHue.current = false
            haptics.impact('medium')
            onChangeComplete?.(hsvToRgb(localH, localS, localV))
          }}
        />
        <motion.div
          className="absolute w-6 h-6 border-3 border-white rounded-full shadow-lg pointer-events-none"
          style={{
            left: `${(localH / 360) * 100}%`,
            top: '50%',
            transform: 'translate(-50%, -50%)',
            backgroundColor: `hsl(${localH}, 100%, 50%)`,
          }}
        />
      </div>

      <div className="grid grid-cols-6 gap-2">
        {colorPresets.map((preset, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => {
              onChange(preset)
              onChangeComplete?.(preset)
              haptics.impact('light')
            }}
            disabled={disabled}
            className="aspect-square rounded-lg border-2 border-border hover:border-foreground/40 transition-all hover:scale-110 active:scale-95 disabled:opacity-50"
            style={{
              backgroundColor: `rgb(${preset[0]}, ${preset[1]}, ${preset[2]})`,
            }}
          />
        ))}
      </div>

      <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/30">
        <div
          className="w-12 h-12 rounded-lg border-2 border-border"
          style={{
            backgroundColor: `rgb(${value[0]}, ${value[1]}, ${value[2]})`,
          }}
        />
        <div className="flex-1 font-mono text-sm">
          <div className="text-muted-foreground">RGB</div>
          <div className="font-medium">
            {value[0]}, {value[1]}, {value[2]}
          </div>
        </div>
      </div>
    </div>
  )
}
