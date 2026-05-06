/**
 * WidgetStylePicker – Visual card style selector shown in widget configuration.
 * Shows live preview of each style with the current theme colors.
 */

import { useState } from 'react'
import { CARD_STYLE_PRESETS, type CardStylePreset } from '@/lib/defaults'
import { Swatches, Check } from '@phosphor-icons/react'

interface WidgetStylePickerProps {
  value?: string
  onChange: (styleId: string) => void
}

// Group styles into categories
const STYLE_GROUPS: Array<{ label: string; styles: CardStylePreset[] }> = [
  {
    label: 'Glass & Frosted',
    styles: CARD_STYLE_PRESETS.filter(s => ['default', 'frosted', 'crystal', 'dark-glass', 'ice'].includes(s.id)),
  },
  {
    label: 'Solid & Flat',
    styles: CARD_STYLE_PRESETS.filter(s => ['solid', 'flat', 'minimal', 'subtle', 'paper', 'velvet'].includes(s.id)),
  },
  {
    label: 'Outlined',
    styles: CARD_STYLE_PRESETS.filter(s => ['outline', 'bordered', 'dashed'].includes(s.id)),
  },
  {
    label: 'Glowing',
    styles: CARD_STYLE_PRESETS.filter(s => ['neon', 'soft-glow', 'pulse'].includes(s.id)),
  },
  {
    label: 'Gradient',
    styles: CARD_STYLE_PRESETS.filter(s => ['gradient', 'aurora', 'sunset', 'ocean'].includes(s.id)),
  },
  {
    label: 'Material',
    styles: CARD_STYLE_PRESETS.filter(s => ['elevated', 'metallic'].includes(s.id)),
  },
  {
    label: 'Retro',
    styles: CARD_STYLE_PRESETS.filter(s => ['retro', 'noir'].includes(s.id)),
  },
]

export function WidgetStylePicker({ value, onChange }: WidgetStylePickerProps) {
  const selectedStyle = value || 'default'

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Swatches size={14} className="text-accent" weight="fill" />
        <span className="text-[11px] font-semibold text-foreground">Card Style</span>
      </div>

      <div className="space-y-4 max-h-[400px] overflow-y-auto pr-1">
        {STYLE_GROUPS.map(group => (
          <div key={group.label}>
            <p className="text-[9px] font-medium text-foreground/30 uppercase tracking-wider mb-2">
              {group.label}
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {group.styles.map(style => {
                const isSelected = selectedStyle === style.id
                return (
                  <button
                    key={style.id}
                    onClick={() => onChange(style.id)}
                    className={`flex items-center gap-2.5 p-2.5 rounded-xl border-2 transition-all text-left ${
                      isSelected
                        ? 'border-accent bg-accent/10'
                        : 'border-foreground/10 bg-foreground/[0.03] hover:border-foreground/20'
                    }`}
                  >
                    {/* Mini preview swatch */}
                    <div
                      className={`w-10 h-8 rounded-lg shrink-0 border border-foreground/10 card-style-${style.id}`}
                      style={{ overflow: 'hidden' }}
                    >
                      <div className="glass-card w-full h-full rounded-lg" style={{ padding: 0 }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-[10px] font-semibold truncate ${isSelected ? 'text-accent' : 'text-foreground'}`}>
                        {style.label}
                      </p>
                      <p className="text-[8px] text-foreground/40 truncate">{style.description}</p>
                    </div>
                    {isSelected && <Check size={12} className="text-accent shrink-0" weight="bold" />}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
