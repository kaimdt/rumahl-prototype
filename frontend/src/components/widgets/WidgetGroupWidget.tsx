import { Stack } from '@phosphor-icons/react'

interface WidgetGroupWidgetProps {
  title?: string
  membersCount?: number
}

export function WidgetGroupWidget({ title, membersCount = 0 }: WidgetGroupWidgetProps) {
  const groupTitle = title?.trim() || 'Widget-Gruppe'

  return (
    <div className="glass-card rounded-2xl theme-transition p-4 sm:p-5 border border-accent/20 bg-accent/5">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-xl bg-accent/15 text-accent">
          <Stack size={18} weight="fill" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground truncate">{groupTitle}</p>
          <p className="text-xs text-foreground/50 truncate">
            Widgetgruppe - {membersCount} sichtbare Widget{membersCount === 1 ? '' : 's'}
          </p>
        </div>
      </div>
    </div>
  )
}
