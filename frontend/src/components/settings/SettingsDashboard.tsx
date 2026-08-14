// Screensaver schedule editor of the Settings page (lazy-loaded chunk).
import { CalendarBlank, Clock, Plus, Trash } from '@phosphor-icons/react'
import { Switch } from '@/components/ui/switch'
import { DAY_LABELS } from '../SettingsPage'

export function ScreensaverScheduleEditor({
  schedules,
  setSchedules,
}: {
  schedules: import('@/components/Screensaver').ScreensaverSchedule[]
  setSchedules: (v: import('@/components/Screensaver').ScreensaverSchedule[]) => void
}) {
  const addSchedule = () => {
    setSchedules([
      ...schedules,
      {
        id: crypto.randomUUID(),
        days: [1, 2, 3, 4, 5], // Mon-Fri
        startTime: '22:00',
        endTime: '06:00',
        timeout: 300000, // 5 min
        enabled: true,
      },
    ])
  }

  const updateSchedule = (id: string, patch: Partial<import('@/components/Screensaver').ScreensaverSchedule>) => {
    setSchedules(schedules.map(s => s.id === id ? { ...s, ...patch } : s))
  }

  const removeSchedule = (id: string) => {
    setSchedules(schedules.filter(s => s.id !== id))
  }

  const toggleDay = (scheduleId: string, day: number) => {
    const sched = schedules.find(s => s.id === scheduleId)
    if (!sched) return
    const days = sched.days.includes(day)
      ? sched.days.filter(d => d !== day)
      : [...sched.days, day].sort()
    updateSchedule(scheduleId, { days })
  }

  return (
    <div className="space-y-3 pt-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarBlank size={16} weight="duotone" className="text-foreground/50" />
          <span className="text-xs font-medium text-foreground/70">Zeitpläne</span>
          <span className="text-[10px] text-foreground/40">(optional)</span>
        </div>
        <button
          onClick={addSchedule}
          className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg bg-accent/15 text-accent border border-accent/20 hover:bg-accent/25 transition-colors font-medium"
        >
          <Plus size={12} weight="bold" />
          Zeitplan
        </button>
      </div>

      {schedules.length === 0 && (
        <p className="text-[11px] text-foreground/35 pl-0.5">
          Ohne Zeitpläne gelten die globalen Einstellungen oben.
        </p>
      )}

      {schedules.map((sched) => (
        <div key={sched.id} className="p-4 rounded-xl bg-foreground/[0.04] border border-foreground/8 space-y-3">
          {/* Header row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Switch checked={sched.enabled} onCheckedChange={(v) => updateSchedule(sched.id, { enabled: v })} />
              <span className="text-xs font-medium text-foreground/70">
                {sched.enabled ? 'Aktiv' : 'Inaktiv'}
              </span>
            </div>
            <button
              onClick={() => removeSchedule(sched.id)}
              className="p-1.5 rounded-lg hover:bg-red-500/10 text-foreground/30 hover:text-red-400 transition-colors"
            >
              <Trash size={14} />
            </button>
          </div>

          {/* Day selector */}
          <div className="space-y-1.5">
            <label className="text-[11px] text-foreground/50 font-medium">Tage</label>
            <div className="flex gap-1">
              {DAY_LABELS.map((label, idx) => (
                <button
                  key={idx}
                  onClick={() => toggleDay(sched.id, idx)}
                  className={`w-9 h-8 text-[11px] rounded-lg font-medium transition-all ${
                    sched.days.includes(idx)
                      ? 'bg-accent/20 text-accent border border-accent/30'
                      : 'bg-foreground/5 text-foreground/40 border border-foreground/10 hover:bg-foreground/10'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Time range */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[11px] text-foreground/50 font-medium flex items-center gap-1">
                <Clock size={12} /> Von
              </label>
              <input
                type="time"
                value={sched.startTime}
                onChange={(e) => updateSchedule(sched.id, { startTime: e.target.value })}
                className="ora-field"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] text-foreground/50 font-medium flex items-center gap-1">
                <Clock size={12} /> Bis
              </label>
              <input
                type="time"
                value={sched.endTime}
                onChange={(e) => updateSchedule(sched.id, { endTime: e.target.value })}
                className="ora-field"
              />
            </div>
          </div>

          {/* Timeout */}
          <div className="space-y-1.5">
            <label className="text-[11px] text-foreground/50 font-medium">
              Inaktivitätsdauer: {Math.round(sched.timeout / 60000)} min
            </label>
            <input
              type="range"
              min={1}
              max={30}
              value={Math.round(sched.timeout / 60000)}
              onChange={(e) => updateSchedule(sched.id, { timeout: Number(e.target.value) * 60000 })}
              className="w-full accent-[var(--accent)]"
            />
          </div>
        </div>
      ))}
    </div>
  )
}
