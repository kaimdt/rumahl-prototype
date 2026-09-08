import { useState, useMemo } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { CaretLeft, CaretRight, CalendarBlank, Clock } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useClock } from '@/hooks/useClock'
import { DUR_SLOW, EASE_SOFT } from '@/lib/motion'

const WEEKDAYS = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su']

function isSameDay(a: Date, b: Date): boolean {
  return a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()
}

/**
 * Desktop taskbar clock (sits to the right of the app icons). Clicking it opens
 * a calendar dropdown with a large clock, full date and a month grid.
 */
export function DockClock({ className = '' }: { className?: string }) {
  const { t, i18n } = useTranslation()
  const now = useClock()
  const [open, setOpen] = useState(false)
  const [viewMonth, setViewMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })

  const monthTitle = viewMonth.toLocaleDateString(i18n.language, { month: 'long', year: 'numeric' })

  const cells = useMemo(() => {
    const first = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1)
    // JS: 0 = Sunday, 1 = Monday ... We render Monday-first.
    const mondayIndex = (first.getDay() + 6) % 7
    const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate()
    const out: (Date | null)[] = []
    for (let i = 0; i < mondayIndex; i++) out.push(null)
    for (let d = 1; d <= daysInMonth; d++) out.push(new Date(viewMonth.getFullYear(), viewMonth.getMonth(), d))
    return out
  }, [viewMonth])

  const prevMonth = () => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))
  const nextMonth = () => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))

  return (
    <>
      <button
        type="button"
        className={`rumahl-taskbar-clock ${className}`.trim()}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={t('os.shell.showDate')}
        title={t('os.shell.showDate')}
      >        <span className="rumahl-taskbar-clock-time">{now.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })}</span>
        <span className="rumahl-taskbar-clock-date">{now.toLocaleDateString(i18n.language, { day: '2-digit', month: 'short', year: 'numeric' })}</span>
      </button>

      <AnimatePresence>
        {open && (
          <>
            <button type="button" aria-label={t('common.close')} className="fixed inset-0 z-[88] cursor-default" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: DUR_SLOW, ease: EASE_SOFT }}
              className="pointer-events-auto fixed bottom-[calc(max(0.9rem,env(safe-area-inset-bottom))+2.6rem)] right-2 z-[90] w-[22rem] rounded-2xl border border-white/10 bg-[color-mix(in_oklch,var(--card)_95%,var(--background))] p-4 text-foreground shadow-2xl backdrop-blur-2xl"
              role="dialog"
              aria-label={t('os.shell.showDate')}
            >
              {/* Clock header */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-5xl font-semibold tabular-nums leading-none">{now.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })}</p>
                  <p className="mt-2 text-sm text-foreground/60">{now.toLocaleDateString(i18n.language, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
                </div>
                <Clock size={30} weight="duotone" className="shrink-0 text-accent" />
              </div>

              <div className="my-4 h-px bg-foreground/8" />

              {/* Month nav */}
              <div className="mb-2 flex items-center justify-between">
                <button type="button" onClick={prevMonth} className="flex h-7 w-7 items-center justify-center rounded-lg text-foreground/60 transition hover:bg-foreground/8 hover:text-foreground" aria-label="Vorheriger Monat"><CaretLeft size={16} /></button>
                <p className="text-sm font-semibold capitalize">{monthTitle}</p>
                <button type="button" onClick={nextMonth} className="flex h-7 w-7 items-center justify-center rounded-lg text-foreground/60 transition hover:bg-foreground/8 hover:text-foreground" aria-label="Nächster Monat"><CaretRight size={16} /></button>
              </div>

              {/* Weekday header (Monday-first) */}
              <div className="grid grid-cols-7 gap-1">
                {WEEKDAYS.map((d) => (
                  <span key={d} className="py-1 text-center text-[10px] font-semibold uppercase tracking-wide text-foreground/40">{t(`calendar.weekday.${d}`)}</span>
                ))}
              </div>

              {/* Day grid */}
              <div className="mt-1 grid grid-cols-7 gap-1">
                {cells.map((day, idx) => {
                  if (!day) return <span key={`empty-${idx}`} className="h-9" />
                  const today = isSameDay(day, now)
                  return (
                    <button
                      key={day.getDate()}
                      type="button"
                      className={`flex h-9 items-center justify-center rounded-lg text-sm tabular-nums transition ${today ? 'bg-accent text-accent-foreground font-bold' : 'text-foreground/75 hover:bg-foreground/8'}`}
                      aria-label={day.toLocaleDateString(i18n.language, { day: 'numeric', month: 'long' })}
                    >
                      {day.getDate()}
                    </button>
                  )
                })}
              </div>

              {/* Today shortcut */}
              <div className="mt-3 flex items-center justify-between border-t border-foreground/8 pt-3">
                <span className="flex items-center gap-2 text-xs text-foreground/45"><CalendarBlank size={14} /> {now.toLocaleDateString(i18n.language, { day: 'numeric', month: 'long' })}</span>
                <button type="button" onClick={() => setViewMonth(new Date(now.getFullYear(), now.getMonth(), 1))} className="rounded-lg bg-foreground/8 px-3 py-1.5 text-xs font-medium transition hover:bg-foreground/12">
                  {t('calendar.today')}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
