import { GearSix, Trash, Plus, Minus, ArrowsHorizontal, ArrowsVertical } from '@phosphor-icons/react'

interface FloatingToolbarProps {
  onConfigure?: () => void
  onResizeWidth?: (delta: number) => void
  onResizeHeight?: (delta: number) => void
  onDelete: () => void
  widgetSize: { w: number; h: number }
  maxWidth?: number
  maxHeight?: number
}

export function FloatingToolbar({
  onConfigure,
  onResizeWidth,
  onResizeHeight,
  onDelete,
  widgetSize,
  maxWidth = 6,
  maxHeight = 12,
}: FloatingToolbarProps) {
  return (
    <div className="absolute -top-10 left-1/2 -translate-x-1/2 flex items-center gap-0.5 px-1.5 py-1 rounded-lg bg-background/95 backdrop-blur-sm border border-foreground/10 shadow-lg z-20">
      {/* Resize width */}
      <ArrowsHorizontal size={10} weight="bold" className="text-foreground/30 mx-0.5" />
      <button
        onClick={(e) => { e.stopPropagation(); onResizeWidth?.(-1) }}
        disabled={widgetSize.w <= 1}
        className="p-1 rounded hover:bg-foreground/10 text-foreground/50 disabled:opacity-20"
        title="Schmaler"
      >
        <Minus size={12} weight="bold" />
      </button>
      <span className="text-[10px] text-foreground/40 w-8 text-center">{widgetSize.w}&times;{widgetSize.h}</span>
      <button
        onClick={(e) => { e.stopPropagation(); onResizeWidth?.(1) }}
        disabled={widgetSize.w >= maxWidth}
        className="p-1 rounded hover:bg-foreground/10 text-foreground/50 disabled:opacity-20"
        title="Breiter"
      >
        <Plus size={12} weight="bold" />
      </button>

      <div className="w-px h-4 bg-foreground/10 mx-0.5" />

      {/* Resize height */}
      <ArrowsVertical size={10} weight="bold" className="text-foreground/30 mx-0.5" />
      <button
        onClick={(e) => { e.stopPropagation(); onResizeHeight?.(-1) }}
        disabled={widgetSize.h <= 1}
        className="p-1 rounded hover:bg-foreground/10 text-foreground/50 disabled:opacity-20"
        title="Kleiner"
      >
        <Minus size={12} weight="bold" />
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onResizeHeight?.(1) }}
        disabled={widgetSize.h >= maxHeight}
        className="p-1 rounded hover:bg-foreground/10 text-foreground/50 disabled:opacity-20"
        title="Größer"
      >
        <Plus size={12} weight="bold" />
      </button>

      <div className="w-px h-4 bg-foreground/10 mx-0.5" />

      {/* Configure */}
      {onConfigure && (
        <button
          onClick={(e) => { e.stopPropagation(); onConfigure() }}
          className="p-1 rounded hover:bg-accent/10 text-foreground/50 hover:text-accent"
          title="Konfigurieren"
        >
          <GearSix size={12} weight="bold" />
        </button>
      )}

      {/* Delete */}
      <button
        onClick={(e) => { e.stopPropagation(); onDelete() }}
        className="p-1 rounded hover:bg-red-500/10 text-foreground/50 hover:text-red-400"
        title="Löschen"
      >
        <Trash size={12} weight="bold" />
      </button>
    </div>
  )
}
