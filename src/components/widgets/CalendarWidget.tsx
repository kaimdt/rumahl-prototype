import { useState } from 'react'
import { motion } from 'framer-motion'
import { CaretLeft, CaretRight, CalendarBlank } from '@phosphor-icons/react'

interface CalendarEvent {
  id: string
  title: string
  start: Date
  end: Date
  description?: string
}

interface CalendarWidgetProps {
  events?: CalendarEvent[]
}

export function CalendarWidget({ events = [] }: CalendarWidgetProps) {
  const [currentDate, setCurrentDate] = useState(new Date())

  const getDaysInMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  }

  const getFirstDayOfMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth(), 1).getDay()
  }

  const previousMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1))
  }

  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1))
  }

  const daysInMonth = getDaysInMonth(currentDate)
  const firstDay = getFirstDayOfMonth(currentDate)
  const today = new Date()

  const monthName = currentDate.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })
  const weekDays = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

  const isToday = (day: number) => {
    return (
      day === today.getDate() &&
      currentDate.getMonth() === today.getMonth() &&
      currentDate.getFullYear() === today.getFullYear()
    )
  }

  const hasEvent = (day: number) => {
    return events.some(event => {
      const eventDate = new Date(event.start)
      return (
        eventDate.getDate() === day &&
        eventDate.getMonth() === currentDate.getMonth() &&
        eventDate.getFullYear() === currentDate.getFullYear()
      )
    })
  }

  return (
    <motion.div
      className="glass-card rounded-2xl p-6"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.01 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <CalendarBlank size={24} weight="fill" className="text-foreground/60" />
          <h3 className="text-lg font-medium text-foreground capitalize">
            {monthName}
          </h3>
        </div>
        <div className="flex gap-2">
          <motion.button
            onClick={previousMonth}
            className="p-2 rounded-lg bg-foreground/5 hover:bg-foreground/10 transition-colors"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <CaretLeft size={16} weight="bold" />
          </motion.button>
          <motion.button
            onClick={nextMonth}
            className="p-2 rounded-lg bg-foreground/5 hover:bg-foreground/10 transition-colors"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <CaretRight size={16} weight="bold" />
          </motion.button>
        </div>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 gap-2 mb-2">
        {weekDays.map(day => (
          <div
            key={day}
            className="text-xs font-medium text-foreground/40 text-center"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-2">
        {/* Empty cells for days before month starts */}
        {[...Array(firstDay)].map((_, i) => (
          <div key={`empty-${i}`} className="aspect-square" />
        ))}

        {/* Days of the month */}
        {[...Array(daysInMonth)].map((_, i) => {
          const day = i + 1
          const isCurrentDay = isToday(day)
          const hasEventToday = hasEvent(day)

          return (
            <motion.div
              key={day}
              className={`
                aspect-square flex items-center justify-center rounded-lg text-sm
                transition-colors relative
                ${isCurrentDay
                  ? 'bg-accent text-accent-foreground font-semibold'
                  : 'text-foreground/80 hover:bg-foreground/5'
                }
              `}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
            >
              {day}
              {hasEventToday && !isCurrentDay && (
                <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-accent" />
              )}
            </motion.div>
          )
        })}
      </div>

      {/* Events list */}
      {events.length > 0 && (
        <div className="mt-4 pt-4 border-t border-foreground/10">
          <h4 className="text-xs font-medium text-foreground/60 mb-2">
            Anstehende Termine
          </h4>
          <div className="space-y-2">
            {events.slice(0, 3).map(event => (
              <div
                key={event.id}
                className="text-xs text-foreground/80 p-2 rounded bg-foreground/5"
              >
                <div className="font-medium">{event.title}</div>
                <div className="text-foreground/50">
                  {new Date(event.start).toLocaleDateString('de-DE')}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  )
}
