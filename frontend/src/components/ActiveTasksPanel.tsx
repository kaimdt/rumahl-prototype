// ActiveTasksPanel – Dashboard panel for managing IORA active tasks
// Shows all user/AI-created tasks with full pause/resume/delete/edit capabilities.

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  BellRinging,
  Clock,
  CalendarBlank,
  Repeat,
  Pause,
  Play,
  Trash,
  PencilSimple,
  Check,
  X,
  Plus,
  ArrowClockwise,
} from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'

import { getAssistUrl, getBackendUrl } from '@/lib/config'

const assistBase = () => getAssistUrl() || getBackendUrl() || ''

// ─── Types ────────────────────────────────────────────────────────────────────

interface ActiveTask {
  id: string
  name: string
  description?: string
  enabled: boolean
  task_type: string
  trigger_at?: string
  next_execution_at?: string
  recurrence_type: string
  recurrence_days: number[]
  recurrence_end_at?: string
  time_of_day?: string
  occurrence_count: number
  occurrence_limit?: number
  user_timezone: string
  input_mode: string
  origin: string
  priority: number
  created_at: string
  // Temporary pause (migration 004)
  paused_until?: string
  paused_temporarily?: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const WEEKDAY_LABELS: Record<number, string> = {
  1: 'Mo', 2: 'Di', 3: 'Mi', 4: 'Do', 5: 'Fr', 6: 'Sa', 7: 'So',
}

function recurrenceLabel(task: ActiveTask): string {
  switch (task.recurrence_type) {
    case 'once':
      return 'Einmalig'
    case 'daily':
      return 'Täglich'
    case 'weekdays':
      return 'Mo–Fr'
    case 'weekly':
      return task.recurrence_days.map((d) => WEEKDAY_LABELS[d]).join(', ') || 'Wöchentlich'
    case 'custom':
      return task.recurrence_days.map((d) => WEEKDAY_LABELS[d]).join(', ')
    default:
      return task.recurrence_type
  }
}

function formatTime(task: ActiveTask): string | undefined {
  if (task.time_of_day) {
    // time_of_day comes as "HH:MM:SS"
    return task.time_of_day.slice(0, 5) + ' Uhr'
  }
  const ts = task.next_execution_at || task.trigger_at
  if (!ts) return undefined
  return new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr'
}

function formatNextExecution(task: ActiveTask): string {
  const ts = task.next_execution_at || task.trigger_at
  if (!ts) return '—'
  const d = new Date(ts)
  const now = new Date()
  const diffMs = d.getTime() - now.getTime()
  if (diffMs < 0) return 'Abgelaufen'
  if (diffMs < 60_000) return 'Gleich'
  if (diffMs < 3_600_000)
    return `in ${Math.round(diffMs / 60_000)} Min`
  if (diffMs < 86_400_000)
    return `in ${Math.round(diffMs / 3_600_000)} Std`
  return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })
}

function inputModeIcon(mode: string): string {
  switch (mode) {
    case 'voice': return '🎤'
    case 'conversation': return '💬'
    default: return '⌨️'
  }
}

// ─── Edit dialog ──────────────────────────────────────────────────────────────

interface EditDialogProps {
  task: ActiveTask
  onSave: (id: string, name: string, description: string) => Promise<void>
  onClose: () => void
}

function EditDialog({ task, onSave, onClose }: EditDialogProps) {
  const [name, setName] = useState(task.name)
  const [description, setDescription] = useState(task.description ?? '')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(task.id, name, description)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, y: 20 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-card border border-foreground/10 rounded-2xl p-6 w-full max-w-md shadow-2xl"
      >
        <h3 className="text-sm font-semibold text-foreground mb-4">Aufgabe bearbeiten</h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-foreground/60 mb-1 block">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-foreground/5 border border-foreground/10 text-sm text-foreground focus:outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="text-xs text-foreground/60 mb-1 block">Beschreibung</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 rounded-xl bg-foreground/5 border border-foreground/10 text-sm text-foreground focus:outline-none focus:border-accent resize-none"
            />
          </div>
        </div>
        <div className="flex gap-2 mt-4 justify-end">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            <X size={14} className="mr-1" /> Abbrechen
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !name.trim()}>
            <Check size={14} className="mr-1" /> {saving ? 'Speichern…' : 'Speichern'}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ─── Task card ────────────────────────────────────────────────────────────────

interface TaskCardProps {
  task: ActiveTask
  onToggle: (id: string, enabled: boolean) => void
  onDelete: (id: string) => void
  onEdit: (task: ActiveTask) => void
}

function TaskCard({ task, onToggle, onDelete, onEdit }: TaskCardProps) {
  const timeLabel = formatTime(task)
  const nextLabel = formatNextExecution(task)
  const recLabel = recurrenceLabel(task)
  const isRecurring = task.recurrence_type !== 'once'

  // Format "resume on ..." label for temporarily paused tasks
  const pausedUntilLabel = task.paused_temporarily && task.paused_until
    ? `Weiter am ${new Date(task.paused_until).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}`
    : null

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className={`relative rounded-xl border p-4 transition-all ${
        task.enabled
          ? 'border-foreground/10 bg-foreground/5'
          : task.paused_temporarily
            ? 'border-amber-500/20 bg-amber-500/5 opacity-80'
            : 'border-foreground/5 bg-foreground/3 opacity-60'
      }`}
    >
      {/* Status dot */}
      <div
        className={`absolute top-3 right-3 w-2 h-2 rounded-full ${
          task.enabled ? 'bg-green-400' : task.paused_temporarily ? 'bg-amber-400' : 'bg-foreground/30'
        }`}
      />

      {/* Header */}
      <div className="flex items-start gap-3 pr-4">
        <div className="mt-0.5 text-accent">
          {isRecurring ? (
            <Repeat size={18} weight="duotone" />
          ) : (
            <BellRinging size={18} weight="duotone" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{task.name}</p>
          {task.description && task.description !== task.name && (
            <p className="text-xs text-foreground/50 mt-0.5 line-clamp-2">{task.description}</p>
          )}
          {pausedUntilLabel && (
            <p className="text-xs text-amber-400/80 mt-0.5 flex items-center gap-1">
              <Clock size={10} /> {pausedUntilLabel}
            </p>
          )}
        </div>
      </div>

      {/* Schedule info */}
      <div className="flex items-center gap-3 mt-3 text-xs text-foreground/60 flex-wrap">
        {timeLabel && (
          <span className="flex items-center gap-1">
            <Clock size={11} /> {timeLabel}
          </span>
        )}
        <span className="flex items-center gap-1">
          <CalendarBlank size={11} /> {recLabel}
        </span>
        {!task.paused_temporarily && (
          <span className="flex items-center gap-1">
            <BellRinging size={11} /> {nextLabel}
          </span>
        )}
        {task.occurrence_limit && (
          <span className="flex items-center gap-1">
            <Repeat size={11} /> {task.occurrence_count}/{task.occurrence_limit}×
          </span>
        )}
        <span title={`Eingabe: ${task.input_mode}`}>{inputModeIcon(task.input_mode)}</span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 mt-3 pt-2 border-t border-foreground/5">
        <button
          onClick={() => onToggle(task.id, !task.enabled)}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-foreground/70 hover:text-foreground hover:bg-foreground/10 transition-colors"
          title={task.enabled ? 'Pausieren' : 'Fortsetzen'}
        >
          {task.enabled ? <Pause size={13} weight="fill" /> : <Play size={13} weight="fill" />}
          {task.enabled ? 'Pause' : 'Weiter'}
        </button>
        <button
          onClick={() => onEdit(task)}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-foreground/70 hover:text-foreground hover:bg-foreground/10 transition-colors"
          title="Bearbeiten"
        >
          <PencilSimple size={13} /> Bearbeiten
        </button>
        <button
          onClick={() => onDelete(task.id)}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-red-400/70 hover:text-red-400 hover:bg-red-400/10 transition-colors ml-auto"
          title="Löschen"
        >
          <Trash size={13} /> Löschen
        </button>
      </div>
    </motion.div>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────

interface ActiveTasksPanelProps {
  /** Set to true when the panel is visible so it auto-refreshes */
  isVisible?: boolean
}

export function ActiveTasksPanel({ isVisible = true }: ActiveTasksPanelProps) {
  const [tasks, setTasks] = useState<ActiveTask[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingTask, setEditingTask] = useState<ActiveTask | null>(null)
  const [filter, setFilter] = useState<'all' | 'active' | 'paused'>('all')

  const fetchTasks = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${assistBase()}/api/assist/tasks/active`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setTasks(data.tasks ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler beim Laden der Aufgaben')
    } finally {
      setLoading(false)
    }
  }, [])

  // Fetch on mount and when panel becomes visible
  useEffect(() => {
    if (isVisible) {
      fetchTasks()
    }
  }, [isVisible, fetchTasks])

  // Auto-refresh every 30 s while visible
  useEffect(() => {
    if (!isVisible) return
    const id = setInterval(fetchTasks, 30_000)
    return () => clearInterval(id)
  }, [isVisible, fetchTasks])

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await fetch(`${assistBase()}/api/assist/tasks/active/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      setTasks((prev) =>
        prev.map((t) => (t.id === id ? { ...t, enabled } : t))
      )
    } catch (e) {
      console.error('Failed to toggle task:', e)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await fetch(`${assistBase()}/api/assist/tasks/active/${id}`, { method: 'DELETE' })
      setTasks((prev) => prev.filter((t) => t.id !== id))
    } catch (e) {
      console.error('Failed to delete task:', e)
    }
  }

  const handleSaveEdit = async (id: string, name: string, description: string) => {
    await fetch(`${assistBase()}/api/assist/tasks/active/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description }),
    })
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, name, description } : t))
    )
  }

  const visibleTasks = tasks.filter((t) => {
    if (filter === 'active') return t.enabled
    if (filter === 'paused') return !t.enabled
    return true
  })

  const activeCount = tasks.filter((t) => t.enabled).length
  const pausedCount = tasks.filter((t) => !t.enabled).length

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <BellRinging size={16} weight="duotone" className="text-accent" />
          <span className="text-sm font-semibold text-foreground">Aktive Aufgaben</span>
          <span className="text-xs px-1.5 py-0.5 rounded-full bg-accent/20 text-accent font-medium">
            {activeCount} aktiv
          </span>
          {pausedCount > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-foreground/10 text-foreground/60 font-medium">
              {pausedCount} pausiert
            </span>
          )}
        </div>
        <button
          onClick={fetchTasks}
          disabled={loading}
          className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-foreground/10 transition-colors text-foreground/60 hover:text-foreground"
          title="Aktualisieren"
        >
          <ArrowClockwise size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-3">
        {(['all', 'active', 'paused'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1 rounded-full transition-colors ${
              filter === f
                ? 'bg-accent text-accent-foreground'
                : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/10'
            }`}
          >
            {f === 'all' ? 'Alle' : f === 'active' ? 'Aktiv' : 'Pausiert'}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-3 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
          {error}
        </div>
      )}

      {/* Task list */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
        <AnimatePresence mode="popLayout">
          {visibleTasks.length === 0 && !loading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-center py-10 text-foreground/40"
            >
              <BellRinging size={36} weight="duotone" className="mx-auto mb-3 opacity-30" />
              {filter === 'paused' ? (
                <p className="text-xs">Keine pausierten Aufgaben</p>
              ) : (
                <>
                  <p className="text-xs">Noch keine Aufgaben.</p>
                  <p className="text-xs mt-1 opacity-70">Frage ORA: „Wecke mich unter der Woche um 6:30 Uhr"</p>
                </>
              )}
            </motion.div>
          )}
          {visibleTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onToggle={handleToggle}
              onDelete={handleDelete}
              onEdit={setEditingTask}
            />
          ))}
        </AnimatePresence>
      </div>

      {/* Edit dialog */}
      <AnimatePresence>
        {editingTask && (
          <EditDialog
            task={editingTask}
            onSave={handleSaveEdit}
            onClose={() => setEditingTask(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
