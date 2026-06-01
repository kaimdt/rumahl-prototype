// Agent Todo Panel – tracks pi.dev todo tool calls
// Shows task list with status, progress, and completion

import { motion, AnimatePresence } from 'motion/react'
import { CheckCircle, Circle, Spinner, Trash, Plus, ArrowUp, ArrowDown } from '@phosphor-icons/react'

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'deleted'

export interface TodoItem {
  id: number
  subject: string
  description?: string
  status: TodoStatus
  activeForm?: string
  metadata?: Record<string, unknown>
}

interface Props {
  todos: TodoItem[]
  activeTodoId?: number | null
}

const statusIcon = (status: TodoStatus, isActive: boolean) => {
  if (isActive) {
    return <Spinner size={14} weight="bold" className="text-accent animate-spin" />
  }
  switch (status) {
    case 'completed': return <CheckCircle size={14} weight="fill" className="text-green-400" />
    case 'deleted': return <Trash size={14} className="text-foreground/20" />
    default: return <Circle size={14} className="text-foreground/20" />
  }
}

const statusColor = (status: TodoStatus, isActive: boolean) => {
  if (isActive) return 'border-accent/30 bg-accent/[0.06]'
  switch (status) {
    case 'completed': return 'border-green-500/15 bg-green-500/[0.04]'
    case 'deleted': return 'border-foreground/5 bg-transparent opacity-40'
    default: return 'border-foreground/8 bg-foreground/[0.02]'
  }
}

export function TodoPanel({ todos, activeTodoId }: Props) {
  const visibleTodos = todos.filter(t => t.status !== 'deleted')
  const completedCount = todos.filter(t => t.status === 'completed').length
  const totalCount = todos.filter(t => t.status !== 'deleted').length
  const activeTodo = todos.find(t => t.id === activeTodoId)

  return (
    <div className="space-y-2">
      {/* Progress header */}
      {totalCount > 0 && (
        <div className="mb-3">
          <div className="flex items-center justify-between text-[10px] text-foreground/40 mb-1.5">
            <span>Fortschritt</span>
            <span>{completedCount}/{totalCount}</span>
          </div>
          <div className="h-1 rounded-full bg-foreground/8 overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-accent/60 to-accent"
              initial={{ width: 0 }}
              animate={{ width: `${totalCount > 0 ? (completedCount / totalCount) * 100 : 0}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
        </div>
      )}

      {/* Active todo indicator */}
      <AnimatePresence>
        {activeTodo && activeTodo.status === 'in_progress' && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="px-3 py-2 rounded-xl bg-accent/10 border border-accent/20 text-xs flex items-center gap-2 mb-2"
          >
            <Spinner size={14} weight="bold" className="text-accent animate-spin shrink-0" />
            <div className="min-w-0">
              <p className="text-accent font-medium truncate">{activeTodo.activeForm || activeTodo.subject}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Todo list */}
      <div className="space-y-1 max-h-[300px] overflow-y-auto">
        <AnimatePresence mode="popLayout">
          {visibleTodos.map(todo => {
            const isActive = todo.id === activeTodoId && todo.status === 'in_progress'
            return (
              <motion.div
                key={todo.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8, height: 0 }}
                className={`flex items-start gap-2.5 px-3 py-2 rounded-lg border transition-all ${statusColor(todo.status, isActive)}`}
              >
                <div className="mt-0.5 shrink-0">
                  {statusIcon(todo.status, isActive)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`text-xs ${todo.status === 'completed' ? 'text-foreground/40 line-through' : 'text-foreground/80'}`}>
                    {todo.subject}
                  </p>
                  {todo.description && todo.status !== 'completed' && (
                    <p className="text-[10px] text-foreground/30 mt-0.5 line-clamp-2">{todo.description}</p>
                  )}
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>

      {/* Empty state */}
      {visibleTodos.length === 0 && (
        <div className="text-center py-6 text-foreground/20">
          <CheckCircle size={24} weight="duotone" className="mx-auto mb-2 opacity-30" />
          <p className="text-[10px]">Keine Tasks</p>
        </div>
      )}
    </div>
  )
}
