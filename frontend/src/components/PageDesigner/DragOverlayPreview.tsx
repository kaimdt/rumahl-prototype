import { getWidgetDef } from '@/lib/widgetRegistry'
import type { WidgetType } from '@/lib/types'

interface DragOverlayPreviewProps {
  widgetType: WidgetType
}

export function DragOverlayPreview({ widgetType }: DragOverlayPreviewProps) {
  const def = getWidgetDef(widgetType)
  if (!def) return null
  const Icon = def.icon

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-background/90 backdrop-blur-sm border border-accent/30 shadow-lg">
      <div className="w-7 h-7 rounded-md bg-accent/10 flex items-center justify-center">
        <Icon size={14} weight="fill" className="text-accent" />
      </div>
      <span className="text-xs font-medium text-foreground">{def.label}</span>
    </div>
  )
}
