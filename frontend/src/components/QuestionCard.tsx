// Interactive Question Card – renders pi.dev ask_user_question tool calls
// Shows structured questions with options, multi-select, and preview support

import { useState } from 'react'
import { motion } from 'motion/react'
import { Question, CheckSquare, Square } from '@phosphor-icons/react'

interface QuestionOption {
  label: string
  description: string
  preview?: string
}

interface QuestionDef {
  question: string
  header: string
  options: QuestionOption[]
  multiSelect?: boolean
}

interface Props {
  questions: QuestionDef[]
  onSubmit: (answers: Record<number, string | string[]>) => void
  onDismiss?: () => void
  isAnswered?: boolean
  existingAnswers?: Record<number, string | string[]>
}

export function QuestionCard({ questions, onSubmit, onDismiss, isAnswered, existingAnswers }: Props) {
  const [answers, setAnswers] = useState<Record<number, string | string[]>>(
    existingAnswers || {}
  )
  const [focusedQuestion, setFocusedQuestion] = useState(0)

  const handleSingleSelect = (qIndex: number, value: string) => {
    setAnswers(prev => ({ ...prev, [qIndex]: value }))
  }

  const handleMultiSelect = (qIndex: number, value: string) => {
    setAnswers(prev => {
      const current = (prev[qIndex] as string[]) || []
      const next = current.includes(value)
        ? current.filter(v => v !== value)
        : [...current, value]
      return { ...prev, [qIndex]: next }
    })
  }

  const allAnswered = questions.every((q, i) => {
    const a = answers[i]
    if (q.multiSelect) {
      return Array.isArray(a) && a.length > 0
    }
    return typeof a === 'string' && a.length > 0
  })

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className="my-3 rounded-2xl border border-amber-500/20 bg-amber-500/[0.04] overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-amber-500/10 bg-amber-500/[0.06]">
        <Question size={16} weight="fill" className="text-amber-400" />
        <span className="text-xs font-medium text-amber-300">
          {questions.length === 1 ? 'Rückfrage' : `${questions.length} Rückfragen`}
        </span>
        {isAnswered && (
          <span className="ml-auto text-[10px] text-amber-400/60">Beantwortet</span>
        )}
      </div>

      {/* Questions */}
      <div className="divide-y divide-amber-500/[0.06]">
        {questions.map((q, qi) => {
          const answer = answers[qi]
          const hasPreview = q.options.some(o => o.preview)

          return (
            <div key={qi} className="p-4">
              {/* Question header chip */}
              <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 mb-2">
                <span className="text-[10px] font-medium text-amber-400 uppercase tracking-wider">
                  {q.header}
                </span>
              </div>

              {/* Question text */}
              <p className="text-sm text-foreground/90 mb-3">{q.question}</p>

              {/* Options */}
              <div className={`space-y-2 ${hasPreview ? 'flex gap-3' : ''}`}>
                <div className={hasPreview ? 'flex-1 space-y-2' : 'space-y-2'}>
                  {q.options.map((opt, oi) => {
                    const isSelected = q.multiSelect
                      ? (Array.isArray(answer) && answer.includes(opt.label))
                      : answer === opt.label

                    return (
                      <button
                        key={oi}
                        onClick={() => {
                          if (isAnswered) return
                          if (q.multiSelect) {
                            handleMultiSelect(qi, opt.label)
                          } else {
                            handleSingleSelect(qi, opt.label)
                            setFocusedQuestion(qi)
                          }
                        }}
                        disabled={isAnswered}
                        className={`w-full text-left p-3 rounded-xl border transition-all ${
                          isSelected
                            ? 'border-accent/40 bg-accent/10 shadow-[0_0_10px_var(--accent)_/_0.1]'
                            : 'border-foreground/8 bg-foreground/[0.02] hover:border-foreground/15'
                        } ${isAnswered ? 'cursor-default' : 'cursor-pointer'}`}
                      >
                        <div className="flex items-start gap-2.5">
                          {q.multiSelect ? (
                            isSelected
                              ? <CheckSquare size={16} weight="fill" className="text-accent mt-0.5 shrink-0" />
                              : <Square size={16} className="text-foreground/20 mt-0.5 shrink-0" />
                          ) : (
                            <div className={`w-4 h-4 rounded-full border-2 mt-0.5 shrink-0 flex items-center justify-center ${
                              isSelected ? 'border-accent bg-accent' : 'border-foreground/20'
                            }`}>
                              {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                            </div>
                          )}
                          <div>
                            <p className="text-xs font-medium text-foreground">{opt.label}</p>
                            <p className="text-[10px] text-foreground/40 mt-0.5">{opt.description}</p>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>

                {/* Preview panel for the focused option */}
                {hasPreview && focusedQuestion === qi && (
                  <div className="flex-1 hidden sm:block">
                    {q.options.map((opt, oi) => {
                      const isSelected = q.multiSelect
                        ? (Array.isArray(answer) && answer.includes(opt.label))
                        : answer === opt.label
                      if (!isSelected || !opt.preview) return null

                      return (
                        <motion.div
                          key={oi}
                          initial={{ opacity: 0, x: 10 }}
                          animate={{ opacity: 1, x: 0 }}
                          className="rounded-xl border border-foreground/10 bg-foreground/[0.03] p-3"
                        >
                          <pre className="text-[10px] text-foreground/60 whitespace-pre-wrap font-mono leading-relaxed">
                            {opt.preview}
                          </pre>
                        </motion.div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Actions */}
      {!isAnswered && (
        <div className="flex items-center gap-2 px-4 py-3 border-t border-amber-500/10 bg-amber-500/[0.04]">
          <button
            onClick={() => onSubmit(answers)}
            disabled={!allAnswered}
            className="flex-1 py-2 rounded-xl bg-accent/20 hover:bg-accent/30 text-accent text-xs font-medium transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Antworten
          </button>
          {onDismiss && (
            <button
              onClick={onDismiss}
              className="px-4 py-2 rounded-xl bg-foreground/5 hover:bg-foreground/10 text-foreground/50 text-xs transition-all"
            >
              Überspringen
            </button>
          )}
        </div>
      )}
    </motion.div>
  )
}
