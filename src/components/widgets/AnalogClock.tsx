import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'

interface AnalogClockProps {
  showSeconds?: boolean
  size?: number
}

export function AnalogClock({ showSeconds = true, size = 200 }: AnalogClockProps) {
  const [time, setTime] = useState(new Date())

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const hours = time.getHours() % 12
  const minutes = time.getMinutes()
  const seconds = time.getSeconds()

  const hourAngle = (hours + minutes / 60) * 30 // 360 / 12 = 30 degrees per hour
  const minuteAngle = (minutes + seconds / 60) * 6 // 360 / 60 = 6 degrees per minute
  const secondAngle = seconds * 6 // 360 / 60 = 6 degrees per second

  const radius = size / 2
  const centerX = radius
  const centerY = radius

  return (
    <motion.div
      className="glass-card rounded-2xl p-6 flex items-center justify-center"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ scale: 1.02 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Clock face */}
        <circle
          cx={centerX}
          cy={centerY}
          r={radius - 10}
          fill="oklch(from var(--card) l c h / 0.5)"
          stroke="oklch(from var(--foreground) l c h / 0.1)"
          strokeWidth="2"
        />

        {/* Hour markers */}
        {[...Array(12)].map((_, i) => {
          const angle = (i * 30 - 90) * (Math.PI / 180)
          const x1 = centerX + (radius - 25) * Math.cos(angle)
          const y1 = centerY + (radius - 25) * Math.sin(angle)
          const x2 = centerX + (radius - 15) * Math.cos(angle)
          const y2 = centerY + (radius - 15) * Math.sin(angle)

          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="oklch(from var(--foreground) l c h / 0.4)"
              strokeWidth={i % 3 === 0 ? "3" : "2"}
              strokeLinecap="round"
            />
          )
        })}

        {/* Hour hand */}
        <line
          x1={centerX}
          y1={centerY}
          x2={centerX + (radius * 0.5) * Math.sin((hourAngle * Math.PI) / 180)}
          y2={centerY - (radius * 0.5) * Math.cos((hourAngle * Math.PI) / 180)}
          stroke="oklch(from var(--foreground) l c h / 0.8)"
          strokeWidth="6"
          strokeLinecap="round"
        />

        {/* Minute hand */}
        <line
          x1={centerX}
          y1={centerY}
          x2={centerX + (radius * 0.7) * Math.sin((minuteAngle * Math.PI) / 180)}
          y2={centerY - (radius * 0.7) * Math.cos((minuteAngle * Math.PI) / 180)}
          stroke="oklch(from var(--foreground) l c h / 0.9)"
          strokeWidth="4"
          strokeLinecap="round"
        />

        {/* Second hand */}
        {showSeconds && (
          <line
            x1={centerX}
            y1={centerY}
            x2={centerX + (radius * 0.8) * Math.sin((secondAngle * Math.PI) / 180)}
            y2={centerY - (radius * 0.8) * Math.cos((secondAngle * Math.PI) / 180)}
            stroke="oklch(from var(--accent) l c h)"
            strokeWidth="2"
            strokeLinecap="round"
          />
        )}

        {/* Center dot */}
        <circle
          cx={centerX}
          cy={centerY}
          r="6"
          fill="oklch(from var(--accent) l c h)"
        />
      </svg>
    </motion.div>
  )
}
