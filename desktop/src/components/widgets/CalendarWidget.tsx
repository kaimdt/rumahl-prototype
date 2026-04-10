import { useState, useEffect, useCallback, useMemo } from 'react'
import { motion } from 'framer-motion'
import { CaretLeft, CaretRight, CalendarBlank, Clock, MapPin, Circle, CalendarDots } from '@phosphor-icons/react'
import { authFetch } from '@/lib/authHelpers'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useLongPressDialog } from '@/hooks/useLongPressDialog'

interface CalendarEvent {
  summary: string
  start: { dateTime?: string; date?: string }
  end: { dateTime?: string; date?: string }
  description?: string
  location?: string
  uid?: string
  recurrence_id?: string
}

interface HACalendar {
  entity_id: string
  name: string
}

interface CalendarWidgetConfig {
  calendars?: string[]
  title?: string
  variant?: 'calendar' | 'agenda' | 'minimal'
  cardVariant?: string
  [key: string]: unknown
}

interface CalendarWidgetProps {
  config?: CalendarWidgetConfig
}

const CALENDAR_COLORS = [
  'oklch(0.65 0.22 250)',
  'oklch(0.65 0.22 150)',
  'oklch(0.65 0.22 25)',
  'oklch(0.65 0.22 310)',
  'oklch(0.65 0.22 60)',
  'oklch(0.65 0.22 195)',
  'oklch(0.65 0.22 340)',
]

function getEventDate(event: CalendarEvent): Date {
  return new Date(event.start.dateTime || event.start.date || '')
}
function getEventEnd(event: CalendarEvent): Date {
  return new Date(event.end.dateTime || event.end.date || '')
}
function isAllDay(event: CalendarEvent): boolean {
  return !event.start.dateTime && !!event.start.date
}
function formatTime(date: Date): string {
  return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
}
function formatDate(date: Date): string {
  return date.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' })
}
function eventKey(event: CalendarEvent, idx: number): string {
  return `${event.uid || event.summary}-${event.start.dateTime || event.start.date}-${idx}`
}
function isTodayDate(date: Date): boolean {
  const t = new Date()
  return date.getDate() === t.getDate() && date.getMonth() === t.getMonth() && date.getFullYear() === t.getFullYear()
}
function isTmrw(date: Date): boolean {
  const t = new Date(); t.setDate(t.getDate() + 1)
  return date.getDate() === t.getDate() && date.getMonth() === t.getMonth() && date.getFullYear() === t.getFullYear()
}
function groupLabel(date: Date): string {
  if (isTodayDate(date)) return 'Heute'
  if (isTmrw(date)) return 'Morgen'
  return date.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })
}

export function CalendarWidget({ config }: CalendarWidgetProps) {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [availableCalendars, setAvailableCalendars] = useState<HACalendar[]>([])
  const [events, setEvents] = useState<Map<string, CalendarEvent[]>>(new Map())
  const [selectedDay, setSelectedDay] = useState<number | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null)
  const [loading, setLoading] = useState(false)

  const variant = (config?.variant || config?.cardVariant || 'calendar') as 'calendar' | 'agenda' | 'minimal'
  const calendarEntityIds = config?.calendars || []

  useEffect(() => {
    authFetch('/api/calendars')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.calendars) {
          setAvailableCalendars((data.calendars as any[]).map(c => ({
            entity_id: c.entity_id,
            name: c.name || c.entity_id.replace('calendar.', '').replace(/_/g, ' '),
          })))
        }
      })
      .catch(() => {})
  }, [])

  const activeCalendars = useMemo(() => {
    if (calendarEntityIds.length > 0) return availableCalendars.filter(c => calendarEntityIds.includes(c.entity_id))
    return availableCalendars
  }, [availableCalendars, calendarEntityIds])

  const fetchEvents = useCallback(async () => {
    if (activeCalendars.length === 0) return
    setLoading(true)
    const start = variant === 'agenda' ? new Date() : new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
    const end = variant === 'agenda' ? (() => { const d = new Date(); d.setDate(d.getDate() + 30); return d })() : new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0, 23, 59, 59)
    const eventsMap = new Map<string, CalendarEvent[]>()
    await Promise.all(activeCalendars.map(async cal => {
      try {
        const r = await authFetch(`/api/calendars/${encodeURIComponent(cal.entity_id)}/events?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`)
        if (r.ok) { const data = await r.json(); if (data?.events) eventsMap.set(cal.entity_id, data.events) }
      } catch { /* ignore */ }
    }))
    setEvents(eventsMap)
    setLoading(false)
  }, [activeCalendars, currentDate, variant])

  useEffect(() => { fetchEvents() }, [fetchEvents])

  const dayEvents = useMemo(() => {
    const map = new Map<number, { event: CalendarEvent; calIdx: number }[]>()
    let calIdx = 0
    for (const [, calEvents] of events) {
      for (const evt of calEvents) {
        const s = getEventDate(evt), e = getEventEnd(evt), d = new Date(s)
        while (d <= e && d.getMonth() === currentDate.getMonth() && d.getFullYear() === currentDate.getFullYear()) {
          const day = d.getDate()
          const arr = map.get(day) || []
          if (!arr.some(x => x.event.summary === evt.summary && getEventDate(x.event).getTime() === s.getTime())) arr.push({ event: evt, calIdx })
          map.set(day, arr)
          d.setDate(d.getDate() + 1)
        }
      }
      calIdx++
    }
    return map
  }, [events, currentDate])

  const upcomingEvents = useMemo(() => {
    const now = new Date(); now.setHours(0, 0, 0, 0)
    const all: { event: CalendarEvent; calIdx: number; calName: string }[] = []
    let calIdx = 0
    for (const [calId, calEvents] of events) {
      const cal = activeCalendars.find(c => c.entity_id === calId)
      for (const evt of calEvents) { if (getEventDate(evt) >= now || getEventEnd(evt) >= now) all.push({ event: evt, calIdx, calName: cal?.name || '' }) }
      calIdx++
    }
    return all.sort((a, b) => getEventDate(a.event).getTime() - getEventDate(b.event).getTime())
  }, [events, activeCalendars])

  const groupedEvents = useMemo(() => {
    const groups: { dateKey: string; label: string; items: typeof upcomingEvents }[] = []
    for (const entry of upcomingEvents) {
      const d = getEventDate(entry.event), key = d.toDateString()
      let group = groups.find(g => g.dateKey === key)
      if (!group) { group = { dateKey: key, label: groupLabel(d), items: [] }; groups.push(group) }
      group.items.push(entry)
    }
    return groups
  }, [upcomingEvents])

  const getDaysInMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  const getFirstDayOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1).getDay()
  const previousMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1))
  const nextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1))
  const goToToday = () => setCurrentDate(new Date())
  const daysInMonth = getDaysInMonth(currentDate)
  const firstDay = getFirstDayOfMonth(currentDate)
  const today = new Date()
  const monthName = currentDate.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })
  const weekDays = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
  const mondayFirstDay = firstDay === 0 ? 6 : firstDay - 1
  const isTodayDay = (day: number) => day === today.getDate() && currentDate.getMonth() === today.getMonth() && currentDate.getFullYear() === today.getFullYear()
  const handleDayClick = (day: number) => { const de = dayEvents.get(day); if (de && de.length > 0) { setSelectedDay(day); setDetailOpen(true) } }
  const selectedDayEvents = selectedDay ? dayEvents.get(selectedDay) || [] : []
  const { dialogOpen: calendarOverviewOpen, setDialogOpen: setCalendarOverviewOpen, longPressHandlers } = useLongPressDialog()
  const [modalSelectedDay, setModalSelectedDay] = useState<number | null>(null)
  const modalDayEvents = modalSelectedDay ? dayEvents.get(modalSelectedDay) || [] : []

  // Full calendar overview modal (shared across all variants)
  const calendarOverviewModal = (
    <Dialog open={calendarOverviewOpen} onOpenChange={(open) => { setCalendarOverviewOpen(open); if (!open) setModalSelectedDay(null) }}>
      <DialogContent className="sm:max-w-[560px] glass-card border-foreground/10 p-0 gap-0 bg-card/95 backdrop-blur-2xl overflow-hidden">
        <DialogTitle className="px-5 pt-5 pb-3 border-b border-foreground/8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CalendarBlank size={20} weight="fill" className="text-accent" />
              <span className="text-sm font-semibold text-foreground capitalize">{monthName}</span>
            </div>
            <div className="flex items-center gap-1">
              <motion.button onClick={goToToday} className="px-2 py-1 rounded-lg bg-foreground/5 hover:bg-foreground/10 transition-colors text-[10px] font-medium text-foreground/60" whileTap={{ scale: 0.95 }}>Heute</motion.button>
              <motion.button onClick={() => { previousMonth(); setModalSelectedDay(null) }} className="p-1.5 rounded-lg bg-foreground/5 hover:bg-foreground/10 transition-colors" whileTap={{ scale: 0.9 }}><CaretLeft size={14} weight="bold" className="text-foreground/60" /></motion.button>
              <motion.button onClick={() => { nextMonth(); setModalSelectedDay(null) }} className="p-1.5 rounded-lg bg-foreground/5 hover:bg-foreground/10 transition-colors" whileTap={{ scale: 0.9 }}><CaretRight size={14} weight="bold" className="text-foreground/60" /></motion.button>
            </div>
          </div>
        </DialogTitle>
        <div className="p-5">
          {activeCalendars.length > 1 && (
            <div className="flex flex-wrap gap-2 mb-3">{activeCalendars.map((cal, i) => <span key={cal.entity_id} className="flex items-center gap-1 text-[10px] text-foreground/60"><Circle size={8} weight="fill" style={{ color: CALENDAR_COLORS[i % CALENDAR_COLORS.length] }} />{cal.name}</span>)}</div>
          )}
          <div className="grid grid-cols-7 gap-1 mb-1">{weekDays.map(d => <div key={d} className="text-[10px] font-medium text-foreground/35 text-center py-1">{d}</div>)}</div>
          <div className="grid grid-cols-7 gap-1">
            {[...Array(mondayFirstDay)].map((_, i) => <div key={`e-${i}`} className="aspect-square" />)}
            {[...Array(daysInMonth)].map((_, i) => {
              const day = i + 1, isCurrentDay = isTodayDay(day), de = dayEvents.get(day) || [], hasEvents = de.length > 0, isModalSelected = modalSelectedDay === day
              return (
                <motion.button key={day} onClick={() => { if (hasEvents) { setModalSelectedDay(isModalSelected ? null : day) } }} className={`aspect-square flex flex-col items-center justify-center rounded-lg text-xs relative transition-colors ${isModalSelected ? 'bg-accent/20 text-accent ring-1 ring-accent/40 font-bold' : isCurrentDay ? 'bg-accent text-accent-foreground font-bold' : hasEvents ? 'text-foreground hover:bg-foreground/8 cursor-pointer font-medium' : 'text-foreground/60 hover:bg-foreground/5'}`} whileHover={hasEvents ? { scale: 1.1 } : undefined} whileTap={hasEvents ? { scale: 0.95 } : undefined}>
                  {day}
                  {hasEvents && <div className="flex gap-[2px] absolute bottom-[2px]">{de.slice(0, 3).map((entry, idx) => <div key={idx} className="w-[4px] h-[4px] rounded-full" style={{ backgroundColor: isCurrentDay && !isModalSelected ? 'currentColor' : CALENDAR_COLORS[entry.calIdx % CALENDAR_COLORS.length] }} />)}</div>}
                </motion.button>
              )
            })}
          </div>

          {/* Inline day events inside modal */}
          {modalSelectedDay !== null && modalDayEvents.length > 0 && (
            <div className="mt-4 pt-4 border-t border-foreground/8">
              <p className="text-[10px] font-medium text-foreground/40 uppercase tracking-wider mb-2">{modalSelectedDay}. {currentDate.toLocaleDateString('de-DE', { month: 'long' })}</p>
              <div className="space-y-1.5 max-h-[25vh] overflow-y-auto">
                {modalDayEvents.map((entry, idx) => (
                  <button key={eventKey(entry.event, idx)} onClick={() => { setCalendarOverviewOpen(false); setModalSelectedDay(null); setSelectedEvent(entry.event) }} className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-xl bg-foreground/[0.04] hover:bg-foreground/[0.08] border border-foreground/6 transition-colors cursor-pointer">
                    <div className="w-[3px] h-8 rounded-full shrink-0" style={{ backgroundColor: CALENDAR_COLORS[entry.calIdx % CALENDAR_COLORS.length] }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-foreground font-medium truncate">{entry.event.summary}</p>
                      <p className="text-[10px] text-foreground/45">{formatDate(getEventDate(entry.event))}{!isAllDay(entry.event) && ` · ${formatTime(getEventDate(entry.event))}`}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Upcoming events (shown when no day is selected) */}
          {modalSelectedDay === null && upcomingEvents.length > 0 && (
            <div className="mt-4 pt-4 border-t border-foreground/8">
              <p className="text-[10px] font-medium text-foreground/40 uppercase tracking-wider mb-2">Nächste Termine</p>
              <div className="space-y-1.5 max-h-[30vh] overflow-y-auto">
                {upcomingEvents.slice(0, 10).map((entry, idx) => (
                  <button key={eventKey(entry.event, idx)} onClick={() => { setCalendarOverviewOpen(false); setModalSelectedDay(null); setSelectedEvent(entry.event) }} className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-xl bg-foreground/[0.04] hover:bg-foreground/[0.08] border border-foreground/6 transition-colors cursor-pointer">
                    <div className="w-[3px] h-8 rounded-full shrink-0" style={{ backgroundColor: CALENDAR_COLORS[entry.calIdx % CALENDAR_COLORS.length] }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-foreground font-medium truncate">{entry.event.summary}</p>
                      <p className="text-[10px] text-foreground/45">{formatDate(getEventDate(entry.event))}{!isAllDay(entry.event) && ` · ${formatTime(getEventDate(entry.event))}`}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )

  // ── Minimal: only calendar grid, no events ──
  if (variant === 'minimal') {
    return (
      <>
      <motion.div {...longPressHandlers} className="glass-card rounded-2xl p-4 sm:p-5" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} whileHover={{ scale: 1.005 }} whileTap={{ scale: 0.98 }} transition={{ type: 'spring', stiffness: 400, damping: 25 }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <CalendarBlank size={20} weight="fill" className="text-accent" />
            <h3 className="text-sm font-semibold text-foreground capitalize">{config?.title || monthName}</h3>
          </div>
          <div className="flex items-center gap-1">
            <motion.button onClick={goToToday} className="px-2 py-1 rounded-lg bg-foreground/5 hover:bg-foreground/10 transition-colors text-[10px] font-medium text-foreground/60" whileTap={{ scale: 0.95 }}>Heute</motion.button>
            <motion.button onClick={previousMonth} className="p-1.5 rounded-lg bg-foreground/5 hover:bg-foreground/10 transition-colors" whileTap={{ scale: 0.9 }}><CaretLeft size={14} weight="bold" className="text-foreground/60" /></motion.button>
            <motion.button onClick={nextMonth} className="p-1.5 rounded-lg bg-foreground/5 hover:bg-foreground/10 transition-colors" whileTap={{ scale: 0.9 }}><CaretRight size={14} weight="bold" className="text-foreground/60" /></motion.button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1 mb-1">{weekDays.map(d => <div key={d} className="text-[10px] font-medium text-foreground/35 text-center py-1">{d}</div>)}</div>
        <div className="grid grid-cols-7 gap-1">
          {[...Array(mondayFirstDay)].map((_, i) => <div key={`e-${i}`} className="aspect-square" />)}
          {[...Array(daysInMonth)].map((_, i) => { const day = i + 1; return (<div key={day} className={`aspect-square flex items-center justify-center rounded-lg text-xs ${isTodayDay(day) ? 'bg-accent text-accent-foreground font-bold' : 'text-foreground/60'}`}>{day}</div>) })}
        </div>
      </motion.div>
      {calendarOverviewModal}
      </>
    )
  }

  // ── Agenda: grouped event list ──
  if (variant === 'agenda') {
    return (
      <>
        <motion.div {...longPressHandlers} className="glass-card rounded-2xl p-4 sm:p-5" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} whileHover={{ scale: 1.005 }} whileTap={{ scale: 0.98 }} transition={{ type: 'spring', stiffness: 400, damping: 25 }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <CalendarDots size={20} weight="fill" className="text-accent" />
              <h3 className="text-sm font-semibold text-foreground">{config?.title || 'Termine'}</h3>
              {loading && <div className="w-3 h-3 rounded-full border-2 border-accent/40 border-t-accent animate-spin" />}
            </div>
            {activeCalendars.length > 1 && (
              <div className="flex items-center gap-1">{activeCalendars.map((cal, i) => <span key={cal.entity_id} className="flex items-center gap-1 text-[10px] text-foreground/50"><Circle size={6} weight="fill" style={{ color: CALENDAR_COLORS[i % CALENDAR_COLORS.length] }} /></span>)}</div>
            )}
          </div>
          <div className="space-y-3 max-h-[400px] overflow-y-auto overscroll-contain">
            {groupedEvents.length === 0 ? (
              <p className="text-xs text-foreground/40 text-center py-6">Keine anstehenden Termine</p>
            ) : groupedEvents.map(group => (
              <div key={group.dateKey}>
                <p className="text-[10px] font-semibold text-foreground/50 uppercase tracking-wider mb-1.5 px-1">{group.label}</p>
                <div className="space-y-1">
                  {group.items.map((entry, idx) => (
                    <button key={eventKey(entry.event, idx)} onClick={() => { setSelectedEvent(entry.event); setDetailOpen(true) }} className="w-full text-left px-3 py-2.5 rounded-xl bg-foreground/[0.04] hover:bg-foreground/[0.08] border border-foreground/6 transition-colors">
                      <div className="flex items-center gap-2.5">
                        <div className="w-[3px] h-9 rounded-full shrink-0" style={{ backgroundColor: CALENDAR_COLORS[entry.calIdx % CALENDAR_COLORS.length] }} />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-foreground truncate">{entry.event.summary}</p>
                          <p className="text-[10px] text-foreground/50 mt-0.5">{isAllDay(entry.event) ? 'Ganztägig' : `${formatTime(getEventDate(entry.event))} – ${formatTime(getEventEnd(entry.event))}`}{entry.event.location && ` · ${entry.event.location}`}</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </motion.div>
        {calendarOverviewModal}
        <EventDetailDialog event={selectedEvent} open={!!selectedEvent} onClose={() => { setSelectedEvent(null); setDetailOpen(false) }} />
      </>
    )
  }

  // ── Default: calendar grid with upcoming events ──
  return (
    <>
      <motion.div {...longPressHandlers} className="glass-card rounded-2xl p-4 sm:p-5" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} whileHover={{ scale: 1.005 }} whileTap={{ scale: 0.98 }} transition={{ type: 'spring', stiffness: 400, damping: 25 }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <CalendarBlank size={20} weight="fill" className="text-accent" />
            <h3 className="text-sm font-semibold text-foreground capitalize">{config?.title || monthName}</h3>
            {loading && <div className="w-3 h-3 rounded-full border-2 border-accent/40 border-t-accent animate-spin" />}
          </div>
          <div className="flex items-center gap-1">
            <motion.button onClick={goToToday} className="px-2 py-1 rounded-lg bg-foreground/5 hover:bg-foreground/10 transition-colors text-[10px] font-medium text-foreground/60" whileTap={{ scale: 0.95 }}>Heute</motion.button>
            <motion.button onClick={previousMonth} className="p-1.5 rounded-lg bg-foreground/5 hover:bg-foreground/10 transition-colors" whileTap={{ scale: 0.9 }}><CaretLeft size={14} weight="bold" className="text-foreground/60" /></motion.button>
            <motion.button onClick={nextMonth} className="p-1.5 rounded-lg bg-foreground/5 hover:bg-foreground/10 transition-colors" whileTap={{ scale: 0.9 }}><CaretRight size={14} weight="bold" className="text-foreground/60" /></motion.button>
          </div>
        </div>
        {activeCalendars.length > 1 && (
          <div className="flex flex-wrap gap-2 mb-2">{activeCalendars.map((cal, i) => <span key={cal.entity_id} className="flex items-center gap-1 text-[10px] text-foreground/60"><Circle size={8} weight="fill" style={{ color: CALENDAR_COLORS[i % CALENDAR_COLORS.length] }} />{cal.name}</span>)}</div>
        )}
        <div className="grid grid-cols-7 gap-1 mb-1">{weekDays.map(d => <div key={d} className="text-[10px] font-medium text-foreground/35 text-center py-1">{d}</div>)}</div>
        <div className="grid grid-cols-7 gap-1">
          {[...Array(mondayFirstDay)].map((_, i) => <div key={`e-${i}`} className="aspect-square" />)}
          {[...Array(daysInMonth)].map((_, i) => {
            const day = i + 1, isCurrentDay = isTodayDay(day), de = dayEvents.get(day) || [], hasEvents = de.length > 0
            return (
              <motion.button key={day} onClick={() => handleDayClick(day)} className={`aspect-square flex flex-col items-center justify-center rounded-lg text-xs relative transition-colors ${isCurrentDay ? 'bg-accent text-accent-foreground font-bold' : hasEvents ? 'text-foreground hover:bg-foreground/8 cursor-pointer font-medium' : 'text-foreground/60 hover:bg-foreground/5'}`} whileHover={hasEvents ? { scale: 1.1 } : undefined} whileTap={hasEvents ? { scale: 0.95 } : undefined}>
                {day}
                {hasEvents && <div className="flex gap-[2px] absolute bottom-[2px]">{de.slice(0, 3).map((entry, idx) => <div key={idx} className="w-[4px] h-[4px] rounded-full" style={{ backgroundColor: isCurrentDay ? 'currentColor' : CALENDAR_COLORS[entry.calIdx % CALENDAR_COLORS.length] }} />)}</div>}
              </motion.button>
            )
          })}
        </div>
        {upcomingEvents.length > 0 && (
          <div className="mt-3 pt-3 border-t border-foreground/8">
            <p className="text-[10px] font-medium text-foreground/40 uppercase tracking-wider mb-1.5">Nächste Termine</p>
            <div className="space-y-1">
              {upcomingEvents.slice(0, 3).map((entry, idx) => (
                <button key={eventKey(entry.event, idx)} onClick={() => { setSelectedEvent(entry.event); setDetailOpen(true) }} className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-foreground/5 transition-colors">
                  <div className="w-[3px] h-5 rounded-full shrink-0" style={{ backgroundColor: CALENDAR_COLORS[entry.calIdx % CALENDAR_COLORS.length] }} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] text-foreground truncate font-medium">{entry.event.summary}</p>
                    <p className="text-[10px] text-foreground/45">{formatDate(getEventDate(entry.event))}{!isAllDay(entry.event) && ` · ${formatTime(getEventDate(entry.event))}`}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </motion.div>
      <Dialog open={detailOpen && selectedDay !== null && !selectedEvent} onOpenChange={(open) => { if (!open) { setDetailOpen(false); setSelectedDay(null) } }}>
        <DialogContent className="sm:max-w-[440px] glass-card border-foreground/10 p-0 gap-0 bg-card/95 backdrop-blur-2xl">
          <DialogTitle className="px-5 pt-5 pb-3 border-b border-foreground/8 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CalendarBlank size={18} weight="fill" className="text-accent" />
              <span className="text-sm font-semibold">{selectedDay && new Date(currentDate.getFullYear(), currentDate.getMonth(), selectedDay).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
            </div>
          </DialogTitle>
          <div className="p-5 space-y-2 max-h-[60vh] overflow-y-auto">
            {selectedDayEvents.length === 0 ? <p className="text-xs text-foreground/40 text-center py-4">Keine Termine</p> : selectedDayEvents.map((entry, idx) => (
              <button key={eventKey(entry.event, idx)} onClick={() => { setSelectedEvent(entry.event); setSelectedDay(null) }} className="w-full text-left p-3 rounded-xl bg-foreground/[0.04] hover:bg-foreground/[0.08] border border-foreground/6 transition-colors">
                <div className="flex items-center gap-2.5">
                  <div className="w-[3px] h-10 rounded-full shrink-0" style={{ backgroundColor: CALENDAR_COLORS[entry.calIdx % CALENDAR_COLORS.length] }} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-foreground">{entry.event.summary}</p>
                    <div className="flex items-center gap-1.5 mt-0.5"><Clock size={10} className="text-foreground/40 shrink-0" /><p className="text-[10px] text-foreground/50">{isAllDay(entry.event) ? 'Ganztägig' : `${formatTime(getEventDate(entry.event))} – ${formatTime(getEventEnd(entry.event))}`}</p></div>
                    {entry.event.location && <div className="flex items-center gap-1.5 mt-0.5"><MapPin size={10} className="text-foreground/40 shrink-0" /><p className="text-[10px] text-foreground/50 truncate">{entry.event.location}</p></div>}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      {calendarOverviewModal}
      <EventDetailDialog event={selectedEvent} open={!!selectedEvent} onClose={() => { setSelectedEvent(null); setDetailOpen(false) }} />
    </>
  )
}

function EventDetailDialog({ event, open, onClose }: { event: CalendarEvent | null; open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-[480px] glass-card border-foreground/10 p-0 gap-0 bg-card/95 backdrop-blur-2xl">
        <DialogTitle className="px-5 pt-5 pb-3 border-b border-foreground/8">
          <div className="flex items-center gap-2"><CalendarBlank size={18} weight="fill" className="text-accent" /><span className="text-sm font-semibold text-foreground">{event?.summary}</span></div>
        </DialogTitle>
        {event && (
          <div className="p-5 space-y-4">
            <div className="flex items-center gap-2.5"><Clock size={16} className="text-foreground/50 shrink-0" /><div><p className="text-xs text-foreground/80 font-medium">{formatDate(getEventDate(event))}{!isAllDay(event) && ` · ${formatTime(getEventDate(event))} – ${formatTime(getEventEnd(event))}`}{isAllDay(event) && ' · Ganztägig'}</p>{getEventDate(event).toDateString() !== getEventEnd(event).toDateString() && <p className="text-[10px] text-foreground/50 mt-0.5">bis {formatDate(getEventEnd(event))}{!isAllDay(event) && ` · ${formatTime(getEventEnd(event))}`}</p>}</div></div>
            {event.location && <div className="flex items-center gap-2.5"><MapPin size={16} className="text-foreground/50 shrink-0" /><p className="text-xs text-foreground/80">{event.location}</p></div>}
            {event.description && <div className="p-3 rounded-xl bg-foreground/[0.04] border border-foreground/6"><p className="text-xs text-foreground/70 whitespace-pre-wrap leading-relaxed">{event.description}</p></div>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
