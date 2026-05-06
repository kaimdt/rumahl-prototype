// AI Kanban Board – Visual project management for coding tasks
import { useState, useCallback } from 'react'
import { motion, AnimatePresence, Reorder } from 'framer-motion'
import {
  Kanban, Plus, Robot, User, Fire, Warning, Circle, CheckCircle,
  DotsSixVertical, Bug, Code, TestTube, FileText, GitBranch, Sparkle,
} from '@phosphor-icons/react'

export type KanbanColumn = 'backlog' | 'todo' | 'in_progress' | 'review' | 'done'

export interface KanbanTask {
  id: string; title: string; description?: string; column: KanbanColumn
  priority: 'low' | 'medium' | 'high' | 'critical'
  agentType?: string; parentTaskId?: string; subtasks: KanbanTask[]
  tags: string[]; source: 'user' | 'system'; createdAt: string
  startedAt?: string; completedAt?: string; assignee?: string; estimatedHours?: number
}

interface Props {
  tasks: KanbanTask[]
  onTasksChange: (tasks: KanbanTask[]) => void
  onCreateTask?: (task: Omit<KanbanTask, 'id' | 'createdAt' | 'subtasks'>) => void
  onStartTask?: (taskId: string) => void
  onMoveTask?: (taskId: string, from: KanbanColumn, to: KanbanColumn) => void
  compact?: boolean
}

const COLUMNS: { id: KanbanColumn; label: string; color: string; bg: string }[] = [
  { id: 'backlog', label: 'Backlog', color: 'text-foreground/30', bg: 'bg-foreground/[0.02]' },
  { id: 'todo', label: 'To Do', color: 'text-blue-400', bg: 'bg-blue-500/[0.04]' },
  { id: 'in_progress', label: 'In Progress', color: 'text-amber-400', bg: 'bg-amber-500/[0.04]' },
  { id: 'review', label: 'Review', color: 'text-purple-400', bg: 'bg-purple-500/[0.04]' },
  { id: 'done', label: 'Done', color: 'text-green-400', bg: 'bg-green-500/[0.04]' },
]

const PRIORITY: Record<string, { icon: typeof Fire; color: string; label: string }> = {
  critical: { icon: Fire, color: 'text-red-400', label: 'Kritisch' },
  high: { icon: Fire, color: 'text-orange-400', label: 'Hoch' },
  medium: { icon: Warning, color: 'text-yellow-400', label: 'Mittel' },
  low: { icon: Circle, color: 'text-foreground/30', label: 'Niedrig' },
}

const TAG_ICONS: Record<string, typeof Bug> = {
  bug: Bug, feature: Sparkle, refactor: Code, test: TestTube, docs: FileText, git: GitBranch,
}

export function KanbanBoard({ tasks, onTasksChange, onCreateTask, onStartTask, onMoveTask, compact }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newPrio, setNewPrio] = useState<KanbanTask['priority']>('medium')
  const [newTag, setNewTag] = useState('feature')
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  const getColTasks = (col: KanbanColumn) => tasks.filter(t => t.column === col && !t.parentTaskId)
  const topLevel = tasks.filter(t => !t.parentTaskId)

  const moveTask = useCallback((taskId: string, to: KanbanColumn) => {
    const task = tasks.find(t => t.id === taskId)
    if (!task || task.column === to) return
    const from = task.column
    onMoveTask?.(taskId, from, to)
    onTasksChange(tasks.map(t => t.id === taskId ? {
      ...t, column: to,
      ...(to === 'in_progress' ? { startedAt: new Date().toISOString() } : {}),
      ...(to === 'done' ? { completedAt: new Date().toISOString() } : {}),
    } : t))
  }, [tasks, onTasksChange, onMoveTask])

  const handleCreate = () => {
    if (!newTitle.trim()) return
    onCreateTask?.({ title: newTitle, column: 'backlog', priority: newPrio, source: 'user', tags: [newTag] })
    setNewTitle(''); setShowForm(false)
  }

  // Drag handlers
  const onDragStart = (e: any, taskId: string) => {
    e.dataTransfer.setData('taskId', taskId)
    e.dataTransfer.effectAllowed = 'move'
  }

  const onDragOverCol = (e: React.DragEvent, colId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverId(colId)
  }

  const onDropCol = (e: React.DragEvent, colId: KanbanColumn) => {
    e.preventDefault()
    setDragOverId(null)
    const taskId = e.dataTransfer.getData('taskId')
    if (taskId) moveTask(taskId, colId)
  }

  const stats = { total: topLevel.length, done: tasks.filter(t => t.column === 'done').length, active: tasks.filter(t => t.column === 'in_progress').length }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-2 py-2 shrink-0">
        <Kanban size={16} weight="fill" className="text-accent" />
        <span className="text-[11px] font-semibold text-foreground/60 uppercase tracking-wider">Kanban</span>
        <div className="flex items-center gap-2 ml-auto text-[10px] text-foreground/30">
          <span>{stats.total} Tasks</span>
          <span className="text-amber-400">{stats.active} aktiv</span>
          <span className="text-green-400">{stats.done} done</span>
        </div>
        <button onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-accent/10 border border-accent/20 text-accent text-[10px] hover:bg-accent/20 transition-all"
        ><Plus size={10} weight="bold" /> Task</button>
      </div>

      {/* New task form */}
      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden px-2 mb-1">
            <div className="p-2.5 rounded-xl border border-accent/20 bg-accent/[0.04] space-y-1.5">
              <input type="text" value={newTitle} onChange={e => setNewTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
                placeholder="Task-Titel…" autoFocus
                className="w-full px-2.5 py-1.5 rounded-lg bg-foreground/5 border border-foreground/10 text-[11px] text-foreground focus:outline-none focus:border-accent/40"
              />
              <div className="flex items-center gap-1.5">
                <select value={newPrio} onChange={e => setNewPrio(e.target.value as any)}
                  className="px-2 py-1 rounded-md bg-foreground/5 border border-foreground/10 text-[10px] text-foreground/60"
                ><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select>
                <select value={newTag} onChange={e => setNewTag(e.target.value)}
                  className="px-2 py-1 rounded-md bg-foreground/5 border border-foreground/10 text-[10px] text-foreground/60"
                ><option value="feature">Feature</option><option value="bug">Bug</option><option value="refactor">Refactor</option><option value="test">Test</option><option value="docs">Docs</option></select>
                <button onClick={handleCreate} className="ml-auto px-2.5 py-1 rounded-md bg-accent/20 text-accent text-[10px] hover:bg-accent/30">Erstellen</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Columns */}
      <div className="flex-1 flex gap-1.5 overflow-x-auto px-1 pb-1 min-h-0">
        {COLUMNS.map(col => {
          const colTasks = getColTasks(col.id)
          const isOver = dragOverId === col.id
          return (
            <div key={col.id}
              onDragOver={e => onDragOverCol(e, col.id)}
              onDragLeave={() => setDragOverId(null)}
              onDrop={e => onDropCol(e, col.id)}
              className={`flex-1 min-w-[140px] flex flex-col rounded-xl border transition-all ${isOver ? 'border-accent/50 bg-accent/[0.08]' : `border-foreground/8 ${col.bg}`}`}
            >
              <div className="flex items-center gap-1 px-2 py-1.5 border-b border-foreground/5 shrink-0">
                <Circle size={10} weight="fill" className={col.color} />
                <span className="text-[10px] font-medium text-foreground/50">{col.label}</span>
                <span className="ml-auto text-[9px] text-foreground/20">{colTasks.length}</span>
              </div>

              <div className="flex-1 overflow-y-auto p-1 space-y-1">
                <AnimatePresence mode="popLayout">
                  {colTasks.map(task => {
                    const p = PRIORITY[task.priority]; const PIcon = p.icon
                    const TIcon = TAG_ICONS[task.tags?.[0]] || FileText
                    return (
                      <motion.div key={task.id} layout
                        initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
                        draggable
                        onDragStart={e => onDragStart(e, task.id)}
                        className="group p-2 rounded-lg border border-foreground/8 bg-card/60 backdrop-blur-sm cursor-grab active:cursor-grabbing hover:border-foreground/15"
                      >
                        <div className="flex items-center gap-1 mb-0.5">
                          <DotsSixVertical size={9} className="text-foreground/10 group-hover:text-foreground/25" />
                          <PIcon size={9} weight="fill" className={p.color} />
                          <span className="text-[9px] text-foreground/20">{p.label}</span>
                          <div className="flex-1" />
                          {task.source === 'system' && <Robot size={9} className="text-foreground/15" />}
                          {task.source === 'user' && <User size={9} className="text-foreground/15" />}
                        </div>
                        <p className="text-[11px] font-medium text-foreground/80 leading-snug">{task.title}</p>
                        {task.description && <p className="text-[9px] text-foreground/30 mt-0.5 line-clamp-2">{task.description}</p>}
                        <div className="flex items-center gap-1 mt-1.5">
                          <span className="flex items-center gap-0.5 px-1 py-0.5 rounded bg-foreground/[0.04] text-[8px] text-foreground/25"><TIcon size={8} />{task.tags?.[0]}</span>
                          {task.subtasks?.length > 0 && <span className="text-[8px] text-foreground/20">{task.subtasks.length} sub</span>}
                        </div>
                      </motion.div>
                    )
                  })}
                </AnimatePresence>
                {colTasks.length === 0 && (
                  <div className="flex items-center justify-center h-full min-h-[50px]">
                    <span className="text-[9px] text-foreground/10">
                      {col.id === 'done' ? 'Complete' : 'Drop here'}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex items-center gap-3 px-2 py-1 border-t border-foreground/5 text-[9px] text-foreground/15 shrink-0">
        <span className="flex items-center gap-1"><Robot size={9} /> {tasks.filter(t => t.source === 'system').length} system</span>
        <span className="flex items-center gap-1"><User size={9} /> {tasks.filter(t => t.source === 'user').length} user</span>
        <span className="ml-auto">Drag & Drop</span>
      </div>
    </div>
  )
}
