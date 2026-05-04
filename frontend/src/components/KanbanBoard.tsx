// AI Kanban Board – Visual project management for coding tasks
// Columns: Backlog → To Do → In Progress → Review → Done
// Supports user-created tasks and system auto-subtasks from agent breakdowns

import { useState, useCallback, useRef, useEffect } from 'react'
import { motion, AnimatePresence, Reorder } from 'framer-motion'
import {
  Kanban, Plus, X, Robot, User, ArrowRight, ArrowLeft,
  Fire, Warning, Circle, CheckCircle, Clock, Trash, DotsSixVertical,
  GitBranch, FileText, Code, Bug, TestTube, Sparkle,
} from '@phosphor-icons/react'

// ─── Types ─────────────────────────────────────────────────────────────────

export type KanbanColumn = 'backlog' | 'todo' | 'in_progress' | 'review' | 'done'

export interface KanbanTask {
  id: string
  title: string
  description?: string
  column: KanbanColumn
  priority: 'low' | 'medium' | 'high' | 'critical'
  agentType?: 'pi-dev' | 'manual' | 'subagent'
  parentTaskId?: string
  subtasks: KanbanTask[]
  tags: string[]
  source: 'user' | 'system'
  createdAt: string
  startedAt?: string
  completedAt?: string
  assignee?: string
  estimatedHours?: number
}

interface Props {
  tasks: KanbanTask[]
  onTasksChange: (tasks: KanbanTask[]) => void
  onCreateTask?: (task: Omit<KanbanTask, 'id' | 'createdAt' | 'subtasks'>) => void
  onStartTask?: (taskId: string) => void
  onMoveTask?: (taskId: string, from: KanbanColumn, to: KanbanColumn) => void
  compact?: boolean
}

// ─── Column definitions ────────────────────────────────────────────────────

const COLUMNS: { id: KanbanColumn; label: string; icon: typeof Circle; color: string; bgColor: string }[] = [
  { id: 'backlog', label: 'Backlog', icon: Circle, color: 'text-foreground/30', bgColor: 'bg-foreground/[0.02]' },
  { id: 'todo', label: 'To Do', icon: Circle, color: 'text-blue-400', bgColor: 'bg-blue-500/[0.04]' },
  { id: 'in_progress', label: 'In Progress', icon: Clock, color: 'text-amber-400', bgColor: 'bg-amber-500/[0.04]' },
  { id: 'review', label: 'Review', icon: CheckCircle, color: 'text-purple-400', bgColor: 'bg-purple-500/[0.04]' },
  { id: 'done', label: 'Done', icon: CheckCircle, color: 'text-green-400', bgColor: 'bg-green-500/[0.04]' },
]

const PRIORITY_CONFIG: Record<string, { icon: typeof Fire; color: string; label: string }> = {
  critical: { icon: Fire, color: 'text-red-400', label: 'Kritisch' },
  high: { icon: Fire, color: 'text-orange-400', label: 'Hoch' },
  medium: { icon: Warning, color: 'text-yellow-400', label: 'Mittel' },
  low: { icon: Circle, color: 'text-foreground/30', label: 'Niedrig' },
}

const TAG_ICONS: Record<string, typeof Bug> = {
  bug: Bug, feature: Sparkle, refactor: Code, test: TestTube, docs: FileText, git: GitBranch,
}

// ─── Component ─────────────────────────────────────────────────────────────

export function KanbanBoard({ tasks, onTasksChange, onCreateTask, onStartTask, onMoveTask, compact }: Props) {
  const [showNewTask, setShowNewTask] = useState(false)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskPriority, setNewTaskPriority] = useState<KanbanTask['priority']>('medium')
  const [newTaskTag, setNewTaskTag] = useState('feature')
  const [draggedTask, setDraggedTask] = useState<string | null>(null)
  const [dragOverColumn, setDragOverColumn] = useState<KanbanColumn | null>(null)

  const getColumnTasks = (col: KanbanColumn) =>
    tasks.filter(t => t.column === col && !t.parentTaskId) // Only top-level tasks

  const handleCreateTask = () => {
    if (!newTaskTitle.trim()) return
    onCreateTask?.({
      title: newTaskTitle,
      column: 'backlog',
      priority: newTaskPriority,
      source: 'user',
      tags: [newTaskTag],
    })
    setNewTaskTitle('')
    setShowNewTask(false)
  }

  const handleMoveTask = (taskId: string, toColumn: KanbanColumn) => {
    onMoveTask?.(taskId, tasks.find(t => t.id === taskId)?.column || 'backlog', toColumn)

    // Start agent if moved to in_progress
    if (toColumn === 'in_progress') {
      onStartTask?.(taskId)
    }
  }

  // ─── Drag & Drop ─────────────────────────────────────────────────────
  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    setDraggedTask(taskId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', taskId)
  }

  const handleDragOver = (e: React.DragEvent, column: KanbanColumn) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverColumn(column)
  }

  const handleDragLeave = () => {
    setDragOverColumn(null)
  }

  const handleDrop = (e: React.DragEvent, column: KanbanColumn) => {
    e.preventDefault()
    const taskId = e.dataTransfer.getData('text/plain') || draggedTask
    if (taskId) {
      const task = tasks.find(t => t.id === taskId)
      if (task && task.column !== column) {
        handleMoveTask(taskId, column)
      }
    }
    setDraggedTask(null)
    setDragOverColumn(null)
  }

  // ─── Stats ────────────────────────────────────────────────────────────
  const stats = {
    total: tasks.filter(t => !t.parentTaskId).length,
    done: tasks.filter(t => t.column === 'done').length,
    inProgress: tasks.filter(t => t.column === 'in_progress').length,
  }

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-2 py-2 shrink-0">
        <Kanban size={18} weight="fill" className="text-accent" />
        <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">AI Kanban</h3>
        <div className="flex items-center gap-2 ml-auto text-[10px] text-foreground/30">
          <span>{stats.total} Tasks</span>
          <span className="text-amber-400">{stats.inProgress} aktiv</span>
          <span className="text-green-400">{stats.done} erledigt</span>
        </div>
        <button
          onClick={() => setShowNewTask(!showNewTask)}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-accent/10 border border-accent/20 text-accent text-[11px] hover:bg-accent/20 transition-all"
        >
          <Plus size={12} weight="bold" /> Task
        </button>
      </div>

      {/* ── New Task Form ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {showNewTask && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden px-2"
          >
            <div className="p-3 mb-2 rounded-xl border border-accent/20 bg-accent/[0.04] space-y-2">
              <input
                type="text"
                value={newTaskTitle}
                onChange={e => setNewTaskTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreateTask() }}
                placeholder="Task-Titel…"
                autoFocus
                className="w-full px-3 py-1.5 rounded-lg bg-foreground/5 border border-foreground/10 text-xs text-foreground placeholder-foreground/25 focus:outline-none focus:border-accent/40"
              />
              <div className="flex items-center gap-2">
                <select
                  value={newTaskPriority}
                  onChange={e => setNewTaskPriority(e.target.value as KanbanTask['priority'])}
                  className="px-2 py-1 rounded-lg bg-foreground/5 border border-foreground/10 text-[11px] text-foreground/70"
                >
                  <option value="low">Niedrig</option>
                  <option value="medium">Mittel</option>
                  <option value="high">Hoch</option>
                  <option value="critical">Kritisch</option>
                </select>
                <select
                  value={newTaskTag}
                  onChange={e => setNewTaskTag(e.target.value)}
                  className="px-2 py-1 rounded-lg bg-foreground/5 border border-foreground/10 text-[11px] text-foreground/70"
                >
                  <option value="feature">Feature</option>
                  <option value="bug">Bug</option>
                  <option value="refactor">Refactor</option>
                  <option value="test">Test</option>
                  <option value="docs">Docs</option>
                </select>
                <button onClick={handleCreateTask}
                  className="ml-auto px-3 py-1 rounded-lg bg-accent/20 text-accent text-[11px] hover:bg-accent/30">
                  Erstellen
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Kanban Columns ─────────────────────────────────────────────── */}
      <div className="flex-1 flex gap-2 overflow-x-auto px-2 pb-2 min-h-0">
        {COLUMNS.map(col => {
          const colTasks = getColumnTasks(col.id)
          const isOver = dragOverColumn === col.id
          const Icon = col.icon

          return (
            <div
              key={col.id}
              onDragOver={(e) => handleDragOver(e, col.id)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, col.id)}
              className={`flex-1 min-w-[160px] flex flex-col rounded-xl border transition-all ${
                isOver
                  ? 'border-accent/40 bg-accent/[0.06] shadow-[0_0_15px_var(--accent)_/_0.1]'
                  : `border-foreground/8 ${col.bgColor}`
              }`}
            >
              {/* Column header */}
              <div className="flex items-center gap-1.5 px-2.5 py-2 border-b border-foreground/5 shrink-0">
                <Icon size={14} weight="fill" className={col.color} />
                <span className="text-[11px] font-medium text-foreground/60">{col.label}</span>
                <span className="ml-auto text-[10px] text-foreground/20">{colTasks.length}</span>
              </div>

              {/* Column tasks */}
              <div className="flex-1 overflow-y-auto p-1.5 space-y-1.5">
                <AnimatePresence mode="popLayout">
                  {colTasks.map(task => {
                    const prioCfg = PRIORITY_CONFIG[task.priority]
                    const PrioIcon = prioCfg.icon
                    const TagIcon = TAG_ICONS[task.tags[0]] || FileText
                    const subtaskCount = task.subtasks?.length || 0

                    return (
                      <motion.div
                        key={task.id}
                        layout
                        initial={{ opacity: 0, y: 4, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        draggable
                        onDragStart={(e) => handleDragStart(e, task.id)}
                        className="group relative p-2.5 rounded-lg border border-foreground/8 bg-card/60 backdrop-blur-sm cursor-grab active:cursor-grabbing hover:border-foreground/15 transition-all"
                      >
                        {/* Drag handle + priority */}
                        <div className="flex items-center gap-1.5 mb-1">
                          <DotsSixVertical size={10} className="text-foreground/15 group-hover:text-foreground/30" />
                          <PrioIcon size={10} weight="fill" className={prioCfg.color} />
                          <span className="text-[10px] text-foreground/25">{prioCfg.label}</span>
                          <div className="flex-1" />
                          {task.source === 'system' && (
                            <Robot size={10} className="text-foreground/20" title="Vom System erstellt" />
                          )}
                          {task.source === 'user' && (
                            <User size={10} className="text-foreground/20" title="Vom User erstellt" />
                          )}
                        </div>

                        {/* Title */}
                        <p className="text-[11px] font-medium text-foreground/80 leading-snug">{task.title}</p>

                        {/* Description preview */}
                        {task.description && (
                          <p className="text-[10px] text-foreground/30 mt-0.5 line-clamp-2">{task.description}</p>
                        )}

                        {/* Tags + meta */}
                        <div className="flex items-center gap-1.5 mt-2">
                          <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-foreground/[0.04] text-[9px] text-foreground/30">
                            <TagIcon size={9} />
                            {task.tags[0]}
                          </span>
                          {subtaskCount > 0 && (
                            <span className="text-[9px] text-foreground/20">
                              {subtaskCount} Subtask{subtaskCount !== 1 ? 's' : ''}
                            </span>
                          )}
                          {task.estimatedHours && (
                            <span className="ml-auto text-[9px] text-foreground/20">
                              ~{task.estimatedHours}h
                            </span>
                          )}
                        </div>

                        {/* Quick actions on hover */}
                        <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5">
                          {col.id === 'todo' && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleMoveTask(task.id, 'in_progress') }}
                              className="p-1 rounded bg-accent/20 text-accent hover:bg-accent/30"
                              title="Starten"
                            >
                              <ArrowRight size={10} weight="bold" />
                            </button>
                          )}
                        </div>
                      </motion.div>
                    )
                  })}
                </AnimatePresence>

                {/* Empty state */}
                {colTasks.length === 0 && (
                  <div className="flex items-center justify-center h-full min-h-[60px]">
                    <p className="text-[10px] text-foreground/10 text-center">
                      {col.id === 'backlog' ? 'Ideen & Backlog' :
                       col.id === 'todo' ? 'Bereit zum Start' :
                       col.id === 'in_progress' ? 'Agent arbeitet…' :
                       col.id === 'review' ? 'Zum Reviewen' :
                       'Erledigt 🎉'}
                    </p>
                  </div>
                )}
              </div>

              {/* Quick-add button at bottom of column */}
              <button
                onClick={() => {
                  setNewTaskTitle('')
                  setShowNewTask(true)
                }}
                className="flex items-center justify-center gap-1 py-1.5 text-[10px] text-foreground/15 hover:text-foreground/30 transition-colors border-t border-foreground/5"
              >
                <Plus size={10} /> Task
              </button>
            </div>
          )
        })}
      </div>

      {/* ── Footer stats ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 px-3 py-1.5 border-t border-foreground/5 text-[10px] text-foreground/20 shrink-0">
        <span className="flex items-center gap-1"><Robot size={10} /> {tasks.filter(t => t.source === 'system').length} System</span>
        <span className="flex items-center gap-1"><User size={10} /> {tasks.filter(t => t.source === 'user').length} User</span>
        <span className="ml-auto">Drag & Drop zum Verschieben</span>
      </div>
    </div>
  )
}
