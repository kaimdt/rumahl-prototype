import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useIdleTimer } from 'react-idle-timer'
import { Warning, ShieldWarning, Siren, CloudWarning } from '@phosphor-icons/react'
import { useActiveWarnings, type ActiveWarning } from '@/components/NotificationCenter'
import { RumahlMark } from '@/components/RumahlMark'
import { useLocalStorage } from '@/lib/storage'
import type { ScreensaverStyle } from '@/lib/screensaverStyles'

interface ScreensaverProps {
  timeout?: number // in milliseconds, default 5 minutes
  enabled?: boolean
}

export function Screensaver({ timeout = 300000, enabled = true }: ScreensaverProps) {
  const [isActive, setIsActive] = useState(false)
  const [currentTime, setCurrentTime] = useState(new Date())
  const [screensaverStyle] = useLocalStorage<ScreensaverStyle>('rumahl-screensaver-style', 'clock')
  const [logoPosition, setLogoPosition] = useState({ x: 50, y: 50, key: 0 })
  const activeWarnings = useActiveWarnings()

  // Update time every second when screensaver is active
  useEffect(() => {
    if (!isActive) return

    const timer = setInterval(() => {
      setCurrentTime(new Date())
    }, 1000)

    return () => clearInterval(timer)
  }, [isActive])

  useEffect(() => {
    const showPreview = () => setIsActive(true)
    window.addEventListener('rumahl:screensaver-preview', showPreview)
    return () => window.removeEventListener('rumahl:screensaver-preview', showPreview)
  }, [])

  useEffect(() => {
    if (!isActive || screensaverStyle !== 'logo-pop') return
    const moveLogo = () => setLogoPosition((position) => ({ x: 12 + Math.random() * 76, y: 14 + Math.random() * 72, key: position.key + 1 }))
    moveLogo()
    const timer = window.setInterval(moveLogo, 4200)
    return () => window.clearInterval(timer)
  }, [isActive, screensaverStyle])

  const onIdle = useCallback(() => {
    if (enabled) {
      setIsActive(true)
    }
  }, [enabled])

  const onActive = useCallback(() => {
    setIsActive(false)
  }, [])

  useIdleTimer({
    timeout,
    onIdle,
    onActive,
    debounce: 500,
  })

  const hours = currentTime.getHours().toString().padStart(2, '0')
  const minutes = currentTime.getMinutes().toString().padStart(2, '0')
  const seconds = currentTime.getSeconds()
  const date = currentTime.toLocaleDateString('de-DE', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  // Seconds as a subtle progress arc (0-59 mapped to 0-360)
  const secondsDeg = (seconds / 60) * 360

  return (
    <AnimatePresence>
      {isActive && (
        <motion.div
          className="fixed inset-0 z-[9999] flex items-center justify-center cursor-pointer overflow-hidden"
          style={{ background: 'oklch(0.02 0.01 250)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
          onClick={onActive}
          onTouchStart={onActive}
          onMouseMove={onActive}
          onKeyDown={onActive}
        >
          {/* Floating ambient orbs */}
          <div className="absolute inset-0 pointer-events-none">
            <motion.div
              className="absolute w-[500px] h-[500px] rounded-full"
              style={{
                background: 'radial-gradient(circle, oklch(0.25 0.12 250 / 0.12) 0%, transparent 70%)',
                top: '15%',
                left: '30%',
              }}
              animate={{
                x: [0, 60, -30, 0],
                y: [0, -40, 30, 0],
                scale: [1, 1.15, 0.95, 1],
              }}
              transition={{
                duration: 25,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            />
            <motion.div
              className="absolute w-[400px] h-[400px] rounded-full"
              style={{
                background: 'radial-gradient(circle, oklch(0.30 0.15 210 / 0.08) 0%, transparent 70%)',
                bottom: '20%',
                right: '25%',
              }}
              animate={{
                x: [0, -50, 40, 0],
                y: [0, 30, -50, 0],
                scale: [1.1, 1, 1.2, 1.1],
              }}
              transition={{
                duration: 30,
                repeat: Infinity,
                ease: 'easeInOut',
                delay: 3,
              }}
            />
            <motion.div
              className="absolute w-[300px] h-[300px] rounded-full"
              style={{
                background: 'radial-gradient(circle, oklch(0.20 0.10 280 / 0.06) 0%, transparent 70%)',
                top: '50%',
                left: '60%',
              }}
              animate={{
                x: [0, 40, -20, 0],
                y: [0, -60, 20, 0],
              }}
              transition={{
                duration: 20,
                repeat: Infinity,
                ease: 'easeInOut',
                delay: 6,
              }}
            />
          </div>

          {screensaverStyle === 'logo-pop' && (
            <motion.div key={logoPosition.key} className="absolute -translate-x-1/2 -translate-y-1/2 select-none" style={{ left: `${logoPosition.x}%`, top: `${logoPosition.y}%` }} initial={{ opacity: 0, scale: .55, filter: 'blur(16px)' }} animate={{ opacity: [.05, .92, .92, 0], scale: [.55, 1, 1.04, .82], filter: ['blur(16px)', 'blur(0px)', 'blur(0px)', 'blur(12px)'] }} transition={{ duration: 3.8, times: [0, .2, .72, 1], ease: 'easeInOut' }}>
              <RumahlMark className="h-[clamp(2.5rem,8vw,7rem)] text-white drop-shadow-[0_22px_55px_rgb(255_255_255_/_0.16)]" />
            </motion.div>
          )}
          {screensaverStyle === 'logo-orbit' && (
            <div className="rumahl-screensaver-orbit select-none"><span /><span /><motion.div animate={{ rotateY: [0, 360], y: [-10, 10, -10] }} transition={{ rotateY: { duration: 12, repeat: Infinity, ease: 'linear' }, y: { duration: 5, repeat: Infinity, ease: 'easeInOut' } }}><RumahlMark className="h-[clamp(3rem,9vw,7.5rem)] text-white" /></motion.div></div>
          )}
          {screensaverStyle === 'ambient' && <div className="rumahl-screensaver-ambient" aria-hidden="true"><i /><i /><i /></div>}
          {screensaverStyle === 'clock' && <div className="text-center select-none relative">
            {/* Seconds ring indicator */}
            <div className="relative inline-block mb-2">
              <svg
                width="280"
                height="180"
                viewBox="0 0 280 180"
                className="absolute -top-6 left-1/2 -translate-x-1/2 pointer-events-none opacity-[0.15]"
              >
                <motion.circle
                  cx="140"
                  cy="90"
                  r="85"
                  fill="none"
                  stroke="oklch(0.65 0.20 210)"
                  strokeWidth="0.5"
                  strokeDasharray={`${(secondsDeg / 360) * 534} 534`}
                  strokeLinecap="round"
                  transform="rotate(-90 140 90)"
                  style={{ filter: 'drop-shadow(0 0 6px oklch(0.65 0.20 210 / 0.3))' }}
                />
              </svg>

              {/* Clock display */}
              <motion.div
                className="rumahl-display-clock font-extralight tabular-nums"
                style={{
                  fontSize: 'clamp(4.5rem, 18vw, 11rem)',
                  lineHeight: 1,
                  letterSpacing: '-0.02em',
                }}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              >
                <span style={{ color: 'oklch(0.92 0.005 250)' }}>
                  {hours}
                </span>
                <motion.span
                  style={{ color: 'oklch(0.50 0.02 250)' }}
                  className="mx-1"
                  animate={{ opacity: [0.3, 0.8, 0.3] }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                >
                  :
                </motion.span>
                <span style={{ color: 'oklch(0.92 0.005 250)' }}>
                  {minutes}
                </span>
              </motion.div>
            </div>

            {/* Date */}
            <motion.div
              className="mt-4 font-light tracking-wider"
              style={{
                fontSize: 'clamp(0.85rem, 2.5vw, 1.5rem)',
                color: 'oklch(0.50 0.02 250)',
              }}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 0.7, y: 0 }}
              transition={{ delay: 0.4, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            >
              {date}
            </motion.div>

            {/* Active warnings */}
            {activeWarnings.length > 0 && (
              <ScreensaverWarnings warnings={activeWarnings} />
            )}

            {/* Wake hint - appears after a delay */}
            <motion.div
              className="mt-16 text-sm tracking-[0.2em] uppercase font-light"
              style={{ color: 'oklch(0.30 0.01 250)' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.4 }}
              transition={{ delay: 3, duration: 1.5 }}
            >
              Tippen zum Aufwecken
            </motion.div>

            {/* Brand signature — rumahl mark (splash design language) */}
            <motion.div
              className="mt-10 flex justify-center"
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.16 }}
              transition={{ delay: 4, duration: 1.5 }}
            >
              <RumahlMark className="h-6" />
            </motion.div>
          </div>}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ── Screensaver Warning Display ──────────────────────────────────────

const screensaverWarningStyles = {
  info: { color: 'oklch(0.70 0.15 220)', icon: CloudWarning },
  warning: { color: 'oklch(0.75 0.16 70)', icon: Warning },
  critical: { color: 'oklch(0.65 0.20 25)', icon: ShieldWarning },
  emergency: { color: 'oklch(0.60 0.25 15)', icon: Siren },
}

function ScreensaverWarnings({ warnings }: { warnings: ActiveWarning[] }) {
  const topWarning = warnings[0]
  const style = screensaverWarningStyles[topWarning.level] || screensaverWarningStyles.warning
  const TopIcon = style.icon
  const isSevere = topWarning.level === 'critical' || topWarning.level === 'emergency'

  return (
    <motion.div
      className="mt-10 max-w-lg mx-auto"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.8, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
    >
      <div
        className="rounded-2xl px-5 py-4 backdrop-blur-sm"
        style={{
          background: `color-mix(in oklch, ${style.color} 8%, transparent)`,
          border: `1px solid color-mix(in oklch, ${style.color} 15%, transparent)`,
          boxShadow: isSevere ? `0 0 30px color-mix(in oklch, ${style.color} 10%, transparent)` : undefined,
        }}
      >
        {/* Top warning */}
        <div className="flex items-start gap-3">
          {isSevere ? (
            <motion.div
              animate={{ scale: [1, 1.12, 1] }}
              transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
              className="flex-shrink-0 mt-0.5"
            >
              <TopIcon size={20} weight="fill" style={{ color: style.color }} />
            </motion.div>
          ) : (
            <TopIcon size={20} weight="fill" style={{ color: style.color }} className="flex-shrink-0 mt-0.5" />
          )}
          <div className="min-w-0">
            <p
              className="text-sm font-medium truncate"
              style={{ color: style.color }}
            >
              {topWarning.title}
            </p>
            {topWarning.message && (
              <p
                className="text-xs mt-1 line-clamp-2 leading-relaxed"
                style={{ color: `color-mix(in oklch, ${style.color} 60%, oklch(0.5 0 0))` }}
              >
                {topWarning.message}
              </p>
            )}
          </div>
        </div>

        {/* Additional warnings count */}
        {warnings.length > 1 && (
          <div
            className="mt-3 pt-2 text-xs font-medium"
            style={{
              color: `color-mix(in oklch, ${style.color} 50%, oklch(0.4 0 0))`,
              borderTop: `1px solid color-mix(in oklch, ${style.color} 10%, transparent)`,
            }}
          >
            +{warnings.length - 1} weitere Warnung{warnings.length > 2 ? 'en' : ''}
          </div>
        )}
      </div>
    </motion.div>
  )
}

// Screensaver schedule entry
export interface ScreensaverSchedule {
  id: string
  days: number[] // 0=Sunday, 1=Monday, ..., 6=Saturday
  startTime: string // "HH:MM" e.g. "22:00"
  endTime: string // "HH:MM" e.g. "06:00"
  timeout: number // inactivity timeout in milliseconds
  enabled: boolean
}

// Check if a schedule is currently active
function isScheduleActive(schedule: ScreensaverSchedule): boolean {
  if (!schedule.enabled) return false
  const now = new Date()
  const day = now.getDay() // 0=Sun
  if (!schedule.days.includes(day)) return false

  const [startH, startM] = schedule.startTime.split(':').map(Number)
  const [endH, endM] = schedule.endTime.split(':').map(Number)
  const nowMins = now.getHours() * 60 + now.getMinutes()
  const startMins = startH * 60 + startM
  const endMins = endH * 60 + endM

  // Handle overnight spans (e.g. 22:00 → 06:00)
  if (startMins <= endMins) {
    return nowMins >= startMins && nowMins < endMins
  } else {
    return nowMins >= startMins || nowMins < endMins
  }
}

// Screensaver settings hook
export function useScreensaverSettings() {
  const [enabled, setEnabled] = useLocalStorage<boolean>('screensaver-enabled', true)
  const [timeout, setTimeout] = useLocalStorage<number>('screensaver-timeout', 300000)
  const [schedules, setSchedules] = useLocalStorage<ScreensaverSchedule[]>('screensaver-schedules', [])

  // Determine effective enabled state and timeout based on schedules
  const effective = useMemo(() => {
    if (schedules.length === 0) {
      return { enabled, timeout }
    }
    // Check if any schedule is currently active
    const activeSchedule = schedules.find(isScheduleActive)
    if (activeSchedule) {
      return { enabled: true, timeout: activeSchedule.timeout }
    }
    // If schedules exist but none active, fall back to global setting
    // (schedules only override when active)
    return { enabled, timeout }
  }, [enabled, timeout, schedules])

  return useMemo(() => ({
    enabled: effective.enabled,
    setEnabled,
    timeout: effective.timeout,
    setTimeout,
    schedules,
    setSchedules,
  }), [effective.enabled, effective.timeout, setEnabled, setTimeout, schedules, setSchedules])
}
