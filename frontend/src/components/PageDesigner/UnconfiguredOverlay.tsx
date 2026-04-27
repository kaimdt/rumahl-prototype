import { CursorClick } from '@phosphor-icons/react'

interface UnconfiguredOverlayProps {
  onConfigure: () => void
  label?: string
}

export function UnconfiguredOverlay({ onConfigure, label }: UnconfiguredOverlayProps) {
  return (
    <div
      onClick={(e) => {
        e.stopPropagation()
        onConfigure()
      }}
      className="absolute inset-0 rounded-2xl bg-background/80 backdrop-blur-sm flex flex-col items-center justify-center gap-2 cursor-pointer z-10 hover:bg-background/70 transition-colors"
    >
      <CursorClick size={24} weight="duotone" className="text-accent animate-pulse" />
      <p className="text-xs font-medium text-accent animate-pulse">
        {label || 'Klicken zum Konfigurieren'}
      </p>
    </div>
  )
}
