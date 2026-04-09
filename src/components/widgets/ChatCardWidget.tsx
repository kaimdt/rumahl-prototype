import { ChatText, Clock } from '@phosphor-icons/react'

interface ChatCardWidgetProps {
  messages?: string[]
  title?: string
}

function normalizeMessages(messages?: string[]): string[] {
  if (!messages || messages.length === 0) {
    return [
      'Willkommen! Passe diese Chat-Card im Designer an.',
      'Nutze | oder Zeilenumbrueche fuer mehrere Nachrichten.',
      'Beispiel: Kaffeemaschine ist bereit.',
    ]
  }
  return messages.filter(Boolean).slice(0, 6)
}

export function ChatCardWidget({ messages, title }: ChatCardWidgetProps) {
  const rows = normalizeMessages(messages)

  return (
    <div className="glass-card rounded-2xl theme-transition p-4 sm:p-5 min-h-[140px]">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <ChatText size={16} weight="fill" className="text-accent" />
          <h3 className="text-sm font-semibold text-foreground">{title?.trim() || 'Chat Card'}</h3>
        </div>
        <span className="text-[10px] text-foreground/45 flex items-center gap-1">
          <Clock size={11} />
          Live
        </span>
      </div>

      <div className="space-y-2">
        {rows.map((message, index) => (
          <div
            key={`${message}-${index}`}
            className={[
              'max-w-[92%] rounded-xl px-3 py-2 text-xs leading-relaxed',
              index % 2 === 0
                ? 'bg-accent/12 text-foreground/85 border border-accent/25'
                : 'bg-foreground/6 text-foreground/75 border border-foreground/10 ml-auto',
            ].join(' ')}
          >
            {message}
          </div>
        ))}
      </div>
    </div>
  )
}
