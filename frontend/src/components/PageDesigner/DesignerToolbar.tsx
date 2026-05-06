/**
 * DesignerToolbar – Enhanced canvas toolbar with alignment, zoom, and responsive preview.
 */

import {
  AlignLeft, AlignCenterHorizontal, AlignRight,
  AlignTop, AlignCenterVertical, AlignBottom,
  MagnifyingGlassMinus, MagnifyingGlassPlus, ArrowsClockwise,
  DeviceMobile, DeviceTablet, Monitor,
  BracketsCurly, Cube, Copy, Trash,
} from '@phosphor-icons/react'

interface DesignerToolbarProps {
  // Grid
  columns: number
  rows: number
  gap: number
  onColumnsChange: (delta: number) => void
  onRowsChange: (delta: number) => void
  onGapChange: (delta: number) => void
  minCols: number; maxCols: number
  minRows: number; maxRows: number
  // Zoom
  zoom: number
  onZoomChange: (zoom: number) => void
  // Responsive
  previewMode: 'desktop' | 'tablet' | 'mobile'
  onPreviewModeChange: (mode: 'desktop' | 'tablet' | 'mobile') => void
  // Alignment (when widget selected)
  hasSelection: boolean
  onAlignHorizontal: (align: 'left' | 'center' | 'right') => void
  onAlignVertical: (align: 'top' | 'center' | 'bottom') => void
  // Actions
  onYamlExport?: () => void
  onYamlImport?: () => void
  onDuplicate?: () => void
  onDelete?: () => void
  // Page name
  pageName: string
  widgetCount: number
}

export function DesignerToolbar({
  columns, rows, gap,
  onColumnsChange, onRowsChange, onGapChange,
  minCols, maxCols, minRows, maxRows,
  zoom, onZoomChange,
  previewMode, onPreviewModeChange,
  hasSelection,
  onAlignHorizontal, onAlignVertical,
  onYamlExport, onYamlImport,
  onDuplicate, onDelete,
  pageName, widgetCount,
}: DesignerToolbarProps) {
  return (
    <div className="px-3 py-2 border-b border-foreground/5 flex items-center justify-between gap-2 bg-background/30">
      {/* Left: Page info */}
      <div className="flex items-center gap-3 min-w-0">
        <h2 className="text-xs font-bold text-foreground truncate max-w-[200px]">{pageName}</h2>
        <span className="text-[9px] text-foreground/30 font-mono shrink-0">
          {widgetCount}W · {columns}×{rows} · {gap}px
        </span>
      </div>

      {/* Center: Grid controls */}
      <div className="flex items-center gap-2">
        {/* Grid group */}
        <div className="flex items-center rounded-lg bg-foreground/[0.04] border border-foreground/6 p-0.5 gap-0.5">
          <span className="text-[8px] text-foreground/30 px-1 font-medium uppercase">Grid</span>
          <button onClick={() => onColumnsChange(-1)} disabled={columns <= minCols} className="px-1.5 py-1 rounded hover:bg-foreground/8 text-foreground/40 disabled:opacity-20"><span className="text-[10px] font-bold">−</span></button>
          <span className="text-[10px] font-semibold text-foreground/60 min-w-[16px] text-center">{columns}</span>
          <button onClick={() => onColumnsChange(1)} disabled={columns >= maxCols} className="px-1.5 py-1 rounded hover:bg-foreground/8 text-foreground/40 disabled:opacity-20"><span className="text-[10px] font-bold">+</span></button>
          <span className="text-foreground/15">×</span>
          <button onClick={() => onRowsChange(-1)} disabled={rows <= minRows} className="px-1.5 py-1 rounded hover:bg-foreground/8 text-foreground/40 disabled:opacity-20"><span className="text-[10px] font-bold">−</span></button>
          <span className="text-[10px] font-semibold text-foreground/60 min-w-[16px] text-center">{rows}</span>
          <button onClick={() => onRowsChange(1)} disabled={rows >= maxRows} className="px-1.5 py-1 rounded hover:bg-foreground/8 text-foreground/40 disabled:opacity-20"><span className="text-[10px] font-bold">+</span></button>
        </div>

        {/* Gap */}
        <div className="flex items-center rounded-lg bg-foreground/[0.04] border border-foreground/6 p-0.5 gap-0.5">
          <span className="text-[8px] text-foreground/30 px-1 font-medium uppercase">Gap</span>
          <button onClick={() => onGapChange(-2)} disabled={gap <= 0} className="px-1.5 py-1 rounded hover:bg-foreground/8 text-foreground/40 disabled:opacity-20"><span className="text-[10px] font-bold">−</span></button>
          <span className="text-[10px] font-semibold text-foreground/60 min-w-[16px] text-center">{gap}</span>
          <button onClick={() => onGapChange(2)} disabled={gap >= 24} className="px-1.5 py-1 rounded hover:bg-foreground/8 text-foreground/40 disabled:opacity-20"><span className="text-[10px] font-bold">+</span></button>
        </div>

        {/* Zoom */}
        <div className="flex items-center rounded-lg bg-foreground/[0.04] border border-foreground/6 p-0.5 gap-0.5">
          <button onClick={() => onZoomChange(Math.max(50, zoom - 10))} disabled={zoom <= 50} className="px-1.5 py-1 rounded hover:bg-foreground/8 text-foreground/40 disabled:opacity-20">
            <MagnifyingGlassMinus size={11} weight="bold" />
          </button>
          <button onClick={() => onZoomChange(100)} className="text-[9px] font-medium text-foreground/40 hover:text-foreground min-w-[32px] text-center">
            {zoom}%
          </button>
          <button onClick={() => onZoomChange(Math.min(200, zoom + 10))} disabled={zoom >= 200} className="px-1.5 py-1 rounded hover:bg-foreground/8 text-foreground/40 disabled:opacity-20">
            <MagnifyingGlassPlus size={11} weight="bold" />
          </button>
        </div>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-1.5">
        {/* Alignment (only when widget selected) */}
        {hasSelection && (
          <div className="flex items-center rounded-lg bg-foreground/[0.04] border border-foreground/6 p-0.5 gap-0.5">
            <button onClick={() => onAlignHorizontal('left')} className="p-1 rounded hover:bg-foreground/8 text-foreground/40" title="Links ausrichten"><AlignLeft size={12} weight="bold" /></button>
            <button onClick={() => onAlignHorizontal('center')} className="p-1 rounded hover:bg-foreground/8 text-foreground/40" title="Zentrieren"><AlignCenterHorizontal size={12} weight="bold" /></button>
            <button onClick={() => onAlignHorizontal('right')} className="p-1 rounded hover:bg-foreground/8 text-foreground/40" title="Rechts ausrichten"><AlignRight size={12} weight="bold" /></button>
            <div className="w-px h-3 bg-foreground/10" />
            <button onClick={() => onAlignVertical('top')} className="p-1 rounded hover:bg-foreground/8 text-foreground/40" title="Oben ausrichten"><AlignTop size={12} weight="bold" /></button>
            <button onClick={() => onAlignVertical('center')} className="p-1 rounded hover:bg-foreground/8 text-foreground/40" title="Vertikal zentrieren"><AlignCenterVertical size={12} weight="bold" /></button>
            <button onClick={() => onAlignVertical('bottom')} className="p-1 rounded hover:bg-foreground/8 text-foreground/40" title="Unten ausrichten"><AlignBottom size={12} weight="bold" /></button>
          </div>
        )}

        {/* Duplicate/Delete */}
        {hasSelection && (
          <div className="flex items-center rounded-lg bg-foreground/[0.04] border border-foreground/6 p-0.5 gap-0.5">
            <button onClick={onDuplicate} className="p-1 rounded hover:bg-foreground/8 text-foreground/40" title="Duplizieren"><Copy size={12} weight="bold" /></button>
            <button onClick={onDelete} className="p-1 rounded hover:bg-red-500/10 text-red-400" title="Löschen"><Trash size={12} weight="bold" /></button>
          </div>
        )}

        {/* Responsive Preview */}
        <div className="flex items-center rounded-lg bg-foreground/[0.04] border border-foreground/6 p-0.5 gap-0.5">
          <button onClick={() => onPreviewModeChange('mobile')} className={`p-1 rounded ${previewMode === 'mobile' ? 'bg-accent/15 text-accent' : 'text-foreground/40 hover:bg-foreground/8'}`} title="Mobile Vorschau">
            <DeviceMobile size={13} weight="bold" />
          </button>
          <button onClick={() => onPreviewModeChange('tablet')} className={`p-1 rounded ${previewMode === 'tablet' ? 'bg-accent/15 text-accent' : 'text-foreground/40 hover:bg-foreground/8'}`} title="Tablet Vorschau">
            <DeviceTablet size={13} weight="bold" />
          </button>
          <button onClick={() => onPreviewModeChange('desktop')} className={`p-1 rounded ${previewMode === 'desktop' ? 'bg-accent/15 text-accent' : 'text-foreground/40 hover:bg-foreground/8'}`} title="Desktop Vorschau">
            <Monitor size={13} weight="bold" />
          </button>
        </div>

        {/* YAML */}
        <div className="flex items-center rounded-lg bg-foreground/[0.04] border border-foreground/6 p-0.5 gap-0.5">
          <button onClick={onYamlExport} className="p-1 rounded hover:bg-foreground/8 text-foreground/40" title="Als YAML exportieren">
            <BracketsCurly size={12} weight="bold" />
          </button>
        </div>
      </div>
    </div>
  )
}
