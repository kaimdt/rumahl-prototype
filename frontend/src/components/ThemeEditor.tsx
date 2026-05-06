/**
 * ThemeEditor – Visual live theme editor with real-time preview.
 *
 * Features:
 * - Live CSS variable editing (colors, spacing, borders)
 * - Widget preview with all supported widget types
 * - Font selection with Google Fonts preview
 * - Layout controls (nav position, header style, card radius)
 * - Glass effect tuning
 * - Export/save as user overrides
 * - Before/after comparison
 *
 * Accessible from: Settings → Appearance → "Theme bearbeiten" button
 */

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, Palette, Sun, Moon, Gear, ArrowsClockwise, FloppyDisk,
  PaintBucket, TextT, Sliders, Layout, Eye, EyeSlash,
  Lightbulb, Thermometer, Power, Gauge, Cloud, SpeakerHifi,
  CaretLeft, CaretRight, Download, Upload,
} from '@phosphor-icons/react'

// ─── Types ───────────────────────────────────────────────────────────

type EditorTab = 'colors' | 'fonts' | 'layout' | 'widgets' | 'effects'

interface EditableColor {
  key: string
  label: string
  description: string
  varName: string  // CSS variable name, e.g. "background"
}

interface EditorState {
  colors: Record<string, string>
  fonts: {
    heading: string
    body: string
    mono: string
  }
  layout: {
    navPosition: string
    headerStyle: string
    cardRadius: string
    widgetGap: string
  }
  effects: {
    glassBlur: string
    glassOpacity: string
    transitionDuration: string
  }
}

// ─── Default editable colors ─────────────────────────────────────────

const EDITABLE_COLORS: EditableColor[] = [
  { key: 'background', label: 'Hintergrund', description: 'Seiten-Hintergrundfarbe', varName: 'background' },
  { key: 'foreground', label: 'Textfarbe', description: 'Standard-Textfarbe', varName: 'foreground' },
  { key: 'card', label: 'Karten', description: 'Karten-Hintergrund', varName: 'card' },
  { key: 'accent', label: 'Akzent', description: 'Haupt-Akzentfarbe', varName: 'accent' },
  { key: 'muted', label: 'Gedämpft', description: 'Sekundäre Flächen', varName: 'muted' },
  { key: 'muted-foreground', label: 'Text (gedämpft)', description: 'Sekundärer Text', varName: 'muted-foreground' },
  { key: 'border', label: 'Rahmen', description: 'Rahmenfarbe', varName: 'border' },
  { key: 'ring', label: 'Fokusring', description: 'Fokus-Indikator', varName: 'ring' },
  { key: 'success', label: 'Erfolg', description: 'Erfolgsfarbe', varName: 'success' },
  { key: 'destructive', label: 'Fehler', description: 'Fehlerfarbe', varName: 'destructive' },
]

const FONT_OPTIONS = [
  { value: "'Inter', sans-serif", label: 'Inter (Modern)' },
  { value: "'Georgia', serif", label: 'Georgia (Klassisch)' },
  { value: "'IM Fell English', serif", label: 'IM Fell English (Viktorianisch)' },
  { value: "'Cinzel Decorative', serif", label: 'Cinzel Decorative (Zier)' },
  { value: "'Playfair Display', serif", label: 'Playfair Display (Elegant)' },
  { value: "'JetBrains Mono', monospace", label: 'JetBrains Mono (Code)' },
  { value: "'Courier Prime', monospace", label: 'Courier Prime (Schreibmaschine)' },
  { value: "'Roboto', sans-serif", label: 'Roboto (Clean)' },
  { value: "'Merriweather', serif", label: 'Merriweather (Lesbar)' },
  { value: "'Montserrat', sans-serif", label: 'Montserrat (Bold)' },
]

const NAV_POSITIONS = [
  { value: 'bottom', label: 'Unten', icon: '⬇️' },
  { value: 'left', label: 'Links', icon: '⬅️' },
  { value: 'right', label: 'Rechts', icon: '➡️' },
  { value: 'top', label: 'Oben', icon: '⬆️' },
  { value: 'none', label: 'Versteckt', icon: '🚫' },
]

const HEADER_STYLES = [
  { value: 'glass', label: 'Glass', icon: '🪟' },
  { value: 'compact', label: 'Kompakt', icon: '📏' },
  { value: 'hidden', label: 'Versteckt', icon: '🙈' },
  { value: 'floating', label: 'Schwebend', icon: '🎈' },
]

// ─── Preview Widget (sample widget for live preview) ──────────────────

function PreviewWidget({ label, icon, accentColor, bgColor, fgColor, cardColor, borderColor }: {
  label: string
  icon: string
  accentColor: string
  bgColor: string
  fgColor: string
  cardColor: string
  borderColor: string
}) {
  return (
    <div style={{
      background: cardColor,
      color: fgColor,
      border: `1px solid ${borderColor}`,
      borderRadius: '12px',
      padding: '14px 16px',
      boxShadow: `0 2px 8px ${bgColor}`,
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      transition: 'all 0.3s ease',
    }}>
      <div style={{
        width: '36px', height: '36px',
        borderRadius: '10px',
        background: `${accentColor}22`,
        color: accentColor,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '16px',
      }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '13px', fontWeight: 500, fontFamily: 'inherit' }}>{label}</div>
        <div style={{ fontSize: '11px', opacity: 0.5, fontFamily: 'monospace' }}>Active</div>
      </div>
      <div style={{
        width: '8px', height: '8px',
        borderRadius: '50%',
        background: accentColor,
        boxShadow: `0 0 8px ${accentColor}66`,
      }} />
    </div>
  )
}

// ─── Color Editor ─────────────────────────────────────────────────────

function ColorEditor({
  colors, onChange, accentLocked,
}: {
  colors: Record<string, string>
  onChange: (key: string, value: string) => void
  accentLocked: boolean
}) {
  const [activeColor, setActiveColor] = useState<string | null>(null)

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-4">
        <PaintBucket size={16} className="text-accent" weight="fill" />
        <h3 className="text-sm font-semibold text-foreground">Farben</h3>
      </div>

      <div className="grid grid-cols-1 gap-2">
        {EDITABLE_COLORS.map(c => {
          const color = colors[c.varName] || '#000000'
          const isLocked = c.key === 'accent' && accentLocked
          const isActive = activeColor === c.key

          return (
            <div key={c.key}>
              <button
                onClick={() => isLocked ? null : setActiveColor(isActive ? null : c.key)}
                className={`w-full flex items-center gap-3 p-2.5 rounded-lg transition-all text-left ${
                  isActive ? 'bg-accent/10 border border-accent/30' : 'bg-foreground/[0.03] border border-transparent hover:bg-foreground/[0.06]'
                } ${isLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                disabled={isLocked}
              >
                <div className="relative w-8 h-8 rounded-lg border-2 border-foreground/10 shadow-sm shrink-0 overflow-hidden"
                  style={{ backgroundColor: color }}>
                  {/* Color indicator stripes for transparency */}
                  <div style={{
                    position: 'absolute', inset: 0,
                    background: 'linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%, #ccc), linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%, #ccc)',
                    backgroundSize: '6px 6px',
                    backgroundPosition: '0 0, 3px 3px',
                    opacity: 0.15,
                  }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground">{c.label}</p>
                  <p className="text-[10px] text-foreground/40 font-mono truncate">{color}</p>
                </div>
                {isLocked && <span className="text-[9px] text-foreground/30 bg-foreground/5 px-1.5 py-0.5 rounded">🔒 Theme</span>}
              </button>

              <AnimatePresence>
                {isActive && !isLocked && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="flex items-center gap-3 p-3 mt-1 bg-foreground/[0.03] rounded-lg border border-foreground/10">
                      <input
                        type="color"
                        value={color}
                        onChange={(e) => onChange(c.varName, e.target.value)}
                        className="w-12 h-12 rounded-lg cursor-pointer border-2 border-foreground/10 shrink-0"
                      />
                      <div className="flex-1 space-y-1.5">
                        <p className="text-[10px] text-foreground/40">{c.description}</p>
                        <input
                          type="text"
                          value={color}
                          onChange={(e) => onChange(c.varName, e.target.value)}
                          className="w-full px-2 py-1 rounded text-xs font-mono bg-foreground/[0.06] border border-foreground/10 text-foreground focus:outline-none focus:border-accent"
                        />
                        <div className="flex gap-1.5">
                          {['#1a1d2e', '#f5f5f7', '#0a0d18', '#181c2e', '#2a2d3e'].map(preset => (
                            <button
                              key={preset}
                              onClick={() => onChange(c.varName, preset)}
                              className="w-5 h-5 rounded border border-foreground/10 hover:scale-110 transition-transform"
                              style={{ backgroundColor: preset }}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Font Editor ──────────────────────────────────────────────────────

function FontEditor({
  fonts, onChange,
}: {
  fonts: EditorState['fonts']
  onChange: (key: keyof EditorState['fonts'], value: string) => void
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <TextT size={16} className="text-accent" weight="fill" />
        <h3 className="text-sm font-semibold text-foreground">Schriftarten</h3>
      </div>

      {(['heading', 'body', 'mono'] as const).map(key => (
        <div key={key} className="space-y-2">
          <label className="text-[11px] font-medium text-foreground/60 capitalize">
            {key === 'heading' ? 'Überschriften' : key === 'body' ? 'Fließtext' : 'Monospace'}
          </label>
          <select
            value={fonts[key]}
            onChange={(e) => onChange(key, e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-foreground/[0.06] border border-foreground/10 text-sm text-foreground focus:outline-none focus:border-accent"
          >
            {FONT_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <p className="text-xs px-1" style={{ fontFamily: fonts[key] }}>
            The quick brown fox jumps over the lazy dog.
          </p>
        </div>
      ))}
    </div>
  )
}

// ─── Layout Editor ────────────────────────────────────────────────────

function LayoutEditor({
  layout, onChange,
}: {
  layout: EditorState['layout']
  onChange: (key: keyof EditorState['layout'], value: string) => void
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <Layout size={16} className="text-accent" weight="fill" />
        <h3 className="text-sm font-semibold text-foreground">Layout</h3>
      </div>

      {/* Navigation Position */}
      <div className="space-y-2">
        <label className="text-[11px] font-medium text-foreground/60">Navigation</label>
        <div className="grid grid-cols-5 gap-1.5">
          {NAV_POSITIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => onChange('navPosition', opt.value)}
              className={`p-2 rounded-lg text-center text-[10px] transition-all ${
                layout.navPosition === opt.value
                  ? 'bg-accent/15 text-accent border border-accent/30 font-medium'
                  : 'bg-foreground/[0.04] text-foreground/50 border border-transparent hover:bg-foreground/[0.08]'
              }`}
            >
              <div className="text-sm mb-0.5">{opt.icon}</div>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Header Style */}
      <div className="space-y-2">
        <label className="text-[11px] font-medium text-foreground/60">Header-Stil</label>
        <div className="grid grid-cols-4 gap-1.5">
          {HEADER_STYLES.map(opt => (
            <button
              key={opt.value}
              onClick={() => onChange('headerStyle', opt.value)}
              className={`p-2 rounded-lg text-center text-[10px] transition-all ${
                layout.headerStyle === opt.value
                  ? 'bg-accent/15 text-accent border border-accent/30 font-medium'
                  : 'bg-foreground/[0.04] text-foreground/50 border border-transparent hover:bg-foreground/[0.08]'
              }`}
            >
              <div className="text-sm mb-0.5">{opt.icon}</div>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Card Radius */}
      <div className="space-y-2">
        <label className="text-[11px] font-medium text-foreground/60 flex items-center justify-between">
          <span>Karten-Rundung</span>
          <span className="text-[10px] font-mono text-accent">{layout.cardRadius}</span>
        </label>
        <input
          type="range"
          min="0"
          max="2"
          step="0.1"
          value={parseFloat(layout.cardRadius.replace('rem', '')) || 0.75}
          onChange={(e) => onChange('cardRadius', `${e.target.value}rem`)}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-foreground/10 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent"
        />
      </div>

      {/* Widget Gap */}
      <div className="space-y-2">
        <label className="text-[11px] font-medium text-foreground/60 flex items-center justify-between">
          <span>Widget-Abstand</span>
          <span className="text-[10px] font-mono text-accent">{layout.widgetGap}</span>
        </label>
        <input
          type="range"
          min="0.25"
          max="2"
          step="0.25"
          value={parseFloat(layout.widgetGap.replace('rem', '')) || 0.75}
          onChange={(e) => onChange('widgetGap', `${e.target.value}rem`)}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-foreground/10 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent"
        />
      </div>
    </div>
  )
}

// ─── Effects Editor ───────────────────────────────────────────────────

function EffectsEditor({
  effects, onChange,
}: {
  effects: EditorState['effects']
  onChange: (key: keyof EditorState['effects'], value: string) => void
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <Eye size={16} className="text-accent" weight="fill" />
        <h3 className="text-sm font-semibold text-foreground">Effekte</h3>
      </div>

      {/* Glass Blur */}
      <div className="space-y-2">
        <label className="text-[11px] font-medium text-foreground/60 flex items-center justify-between">
          <span>Glass-Blur</span>
          <span className="text-[10px] font-mono text-accent">{effects.glassBlur}</span>
        </label>
        <input
          type="range"
          min="0"
          max="80"
          step="5"
          value={parseInt(effects.glassBlur) || 40}
          onChange={(e) => onChange('glassBlur', `${e.target.value}px`)}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-foreground/10 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent"
        />
      </div>

      {/* Glass Opacity */}
      <div className="space-y-2">
        <label className="text-[11px] font-medium text-foreground/60 flex items-center justify-between">
          <span>Glass-Deckkraft</span>
          <span className="text-[10px] font-mono text-accent">{effects.glassOpacity}</span>
        </label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={parseFloat(effects.glassOpacity) || 0.35}
          onChange={(e) => onChange('glassOpacity', e.target.value)}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-foreground/10 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent"
        />
      </div>

      {/* Transition Duration */}
      <div className="space-y-2">
        <label className="text-[11px] font-medium text-foreground/60 flex items-center justify-between">
          <span>Übergangsdauer</span>
          <span className="text-[10px] font-mono text-accent">{effects.transitionDuration}</span>
        </label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.1"
          value={parseFloat(effects.transitionDuration.replace('s', '')) || 0.4}
          onChange={(e) => onChange('transitionDuration', `${e.target.value}s`)}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-foreground/10 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent"
        />
      </div>
    </div>
  )
}

// ─── Widget Variant Preview ───────────────────────────────────────────

function WidgetVariantPreview({
  widgetTemplates, onSelect,
}: {
  widgetTemplates: Array<{ widget_type: string; variants: Array<{ name: string; label?: string; icon?: string }> }>
  onSelect?: (widgetType: string, variantName: string) => void
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <Gear size={16} className="text-accent" weight="fill" />
        <h3 className="text-sm font-semibold text-foreground">Widget-Varianten</h3>
      </div>

      {widgetTemplates.length === 0 ? (
        <div className="text-center py-8 text-foreground/40">
          <Gear size={32} weight="thin" className="mx-auto mb-2" />
          <p className="text-xs">Keine Widget-Templates im Theme</p>
          <p className="text-[10px] mt-1">Füge widget_templates zum Manifest hinzu</p>
        </div>
      ) : (
        <div className="space-y-3">
          {widgetTemplates.map(wt => (
            <div key={wt.widget_type} className="p-3 rounded-lg bg-foreground/[0.03] border border-foreground/10">
              <p className="text-xs font-medium text-foreground capitalize mb-2">{wt.widget_type}</p>
              <div className="grid grid-cols-2 gap-1.5">
                {wt.variants.map(v => (
                  <button
                    key={v.name}
                    onClick={() => onSelect?.(wt.widget_type, v.name)}
                    className="flex items-center gap-1.5 p-1.5 rounded text-[10px] bg-foreground/[0.04] text-foreground/60 hover:bg-foreground/[0.08] hover:text-foreground transition-all"
                  >
                    <div className="w-4 h-4 rounded bg-accent/20 flex items-center justify-center text-[8px]">
                      {v.icon ? v.icon[0].toUpperCase() : 'W'}
                    </div>
                    {v.label || v.name}
                    {v.name === 'default' && (
                      <span className="ml-auto text-[8px] text-accent/60">default</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main ThemeEditor Component ───────────────────────────────────────

export interface ThemeEditorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ThemeEditor({ open, onOpenChange }: ThemeEditorProps) {
  const {
    selectedTheme, setSelectedTheme,
    theme, activeCssVariables,
    capabilities, widgetTemplates,
    activeDesignMode, setActiveDesignMode,
    designModes,
    accentLocked,
    themeResponse,
  } = useTheme()

  const [activeTab, setActiveTab] = useState<EditorTab>('colors')
  const [hasChanges, setHasChanges] = useState(false)
  const [showOriginal, setShowOriginal] = useState(false)

  // Editor state derived from current theme
  const initialColors = useMemo(() => {
    const colors: Record<string, string> = {}
    EDITABLE_COLORS.forEach(c => {
      const cssVar = activeCssVariables?.[c.varName]
      if (cssVar) {
        colors[c.varName] = cssVar
      } else {
        // Read from computed style
        const computed = getComputedStyle(document.documentElement).getPropertyValue(`--${c.varName}`).trim()
        colors[c.varName] = computed || '#000000'
      }
    })
    return colors
  }, [activeCssVariables])

  const [colors, setColors] = useState(initialColors)
  const [fonts, setFonts] = useState<EditorState['fonts']>({
    heading: "'Cinzel Decorative', serif",
    body: "'Inter', sans-serif",
    mono: "'JetBrains Mono', monospace",
  })
  const [layout, setLayout] = useState<EditorState['layout']>({
    navPosition: 'bottom',
    headerStyle: 'glass',
    cardRadius: '0.75rem',
    widgetGap: '0.75rem',
  })
  const [effects, setEffects] = useState<EditorState['effects']>({
    glassBlur: '40px',
    glassOpacity: '0.35',
    transitionDuration: '0.4s',
  })

  // Update colors when activeCssVariables changes
  useEffect(() => {
    setColors(initialColors)
  }, [initialColors])

  // Apply colors to preview in real-time
  useEffect(() => {
    const root = document.documentElement
    Object.entries(colors).forEach(([key, value]) => {
      root.style.setProperty(`--theme-editor-${key}`, value)
    })
    return () => {
      Object.keys(colors).forEach(key => {
        root.style.removeProperty(`--theme-editor-${key}`)
      })
    }
  }, [colors])

  const handleColorChange = useCallback((key: string, value: string) => {
    setColors(prev => ({ ...prev, [key]: value }))
    setHasChanges(true)
  }, [])

  const handleFontChange = useCallback((key: keyof EditorState['fonts'], value: string) => {
    setFonts(prev => ({ ...prev, [key]: value }))
    setHasChanges(true)
  }, [])

  const handleLayoutChange = useCallback((key: keyof EditorState['layout'], value: string) => {
    setLayout(prev => ({ ...prev, [key]: value }))
    setHasChanges(true)
  }, [])

  const handleEffectChange = useCallback((key: keyof EditorState['effects'], value: string) => {
    setEffects(prev => ({ ...prev, [key]: value }))
    setHasChanges(true)
  }, [])

  const handleReset = useCallback(() => {
    setColors(initialColors)
    setHasChanges(false)
  }, [initialColors])

  // Preview colors (use edited colors or original)
  const previewColors = showOriginal ? initialColors : colors

  const tabs: { id: EditorTab; label: string; icon: React.ReactNode }[] = [
    { id: 'colors', label: 'Farben', icon: <PaintBucket size={14} weight="fill" /> },
    { id: 'fonts', label: 'Schriften', icon: <TextT size={14} weight="fill" /> },
    { id: 'layout', label: 'Layout', icon: <Layout size={14} weight="fill" /> },
    { id: 'widgets', label: 'Widgets', icon: <Gear size={14} weight="fill" /> },
    { id: 'effects', label: 'Effekte', icon: <Eye size={14} weight="fill" /> },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[1200px] h-[85vh] max-h-[900px] p-0 gap-0 overflow-hidden">
        {/* Header Bar */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-foreground/10 shrink-0">
          <div className="flex items-center gap-3">
            <Palette size={20} className="text-accent" weight="fill" />
            <div>
              <DialogTitle className="text-sm font-semibold">Theme-Editor</DialogTitle>
              <p className="text-[10px] text-foreground/40">Live-Vorschau & Anpassung</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Show Original toggle */}
            <button
              onClick={() => setShowOriginal(!showOriginal)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-medium transition-all ${
                showOriginal
                  ? 'bg-accent/15 text-accent border border-accent/30'
                  : 'bg-foreground/[0.04] text-foreground/50 border border-transparent hover:bg-foreground/[0.08]'
              }`}
            >
              {showOriginal ? <Eye size={12} /> : <EyeSlash size={12} />}
              {showOriginal ? 'Original' : 'Vorschau'}
            </button>

            {/* Reset */}
            {hasChanges && (
              <button
                onClick={handleReset}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-medium bg-foreground/[0.04] text-foreground/50 border border-transparent hover:bg-foreground/[0.08] transition-all"
              >
                <ArrowsClockwise size={12} />
                Reset
              </button>
            )}

            {/* Save */}
            <button
              onClick={() => {/* TODO: save */}}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium bg-accent text-accent-foreground hover:bg-accent/90 transition-all shadow-sm"
            >
              <FloppyDisk size={12} />
              Speichern
            </button>

            <button
              onClick={() => onOpenChange(false)}
              className="p-1.5 rounded-lg text-foreground/40 hover:text-foreground hover:bg-foreground/[0.08] transition-all"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body: Sidebar + Preview */}
        <div className="flex flex-1 overflow-hidden">
          {/* ─── Left Sidebar Tabs ─── */}
          <div className="w-12 shrink-0 border-r border-foreground/10 bg-foreground/[0.02] flex flex-col items-center py-2 gap-1">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all ${
                  activeTab === tab.id
                    ? 'bg-accent/15 text-accent'
                    : 'text-foreground/30 hover:text-foreground/60 hover:bg-foreground/[0.06]'
                }`}
                title={tab.label}
              >
                {tab.icon}
              </button>
            ))}
          </div>

          {/* ─── Editor Panel ─── */}
          <div className="w-72 shrink-0 border-r border-foreground/10 overflow-y-auto p-4">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                transition={{ duration: 0.15 }}
              >
                {activeTab === 'colors' && (
                  <ColorEditor colors={previewColors} onChange={handleColorChange} accentLocked={accentLocked} />
                )}
                {activeTab === 'fonts' && (
                  <FontEditor fonts={fonts} onChange={handleFontChange} />
                )}
                {activeTab === 'layout' && (
                  <LayoutEditor layout={layout} onChange={handleLayoutChange} />
                )}
                {activeTab === 'widgets' && (
                  <WidgetVariantPreview widgetTemplates={widgetTemplates} onSelect={(type, variant) => {
                    console.log('Select variant:', type, variant)
                  }} />
                )}
                {activeTab === 'effects' && (
                  <EffectsEditor effects={effects} onChange={handleEffectChange} />
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* ─── Live Preview Area ─── */}
          <div className="flex-1 overflow-y-auto relative" style={{
            backgroundColor: previewColors.background || '#1a1d2e',
            color: previewColors.foreground || '#ffffff',
            transition: 'background-color 0.4s ease, color 0.4s ease',
          }}>
            {/* Preview Header */}
            <div className="sticky top-0 z-10 px-6 py-3 border-b flex items-center justify-between"
              style={{
                background: `${previewColors.card || '#1a1d2e'}cc`,
                backdropFilter: `blur(${effects.glassBlur})`,
                borderColor: `${previewColors.border || '#ffffff'}22`,
              }}>
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: previewColors.accent || '#6366f1', boxShadow: `0 0 8px ${previewColors.accent || '#6366f1'}88` }} />
                <span className="text-xs font-medium tracking-wider uppercase" style={{ fontFamily: fonts.heading }}>IORA Preview</span>
              </div>
              <span className="text-[10px] opacity-40">Theme-Editor</span>
            </div>

            {/* Preview Content – Widget Grid */}
            <div className="p-6">
              <h2 className="text-lg font-bold mb-4" style={{ fontFamily: fonts.heading, color: previewColors.accent || '#6366f1' }}>
                Live-Vorschau
              </h2>
              <p className="text-sm mb-6 opacity-60" style={{ fontFamily: fonts.body }}>
                Diese Vorschau zeigt, wie dein Theme auf echte Widgets wirkt.
                Änderungen links werden sofort sichtbar.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" style={{ gap: layout.widgetGap }}>
                {/* Light Widget Preview */}
                <PreviewWidget
                  label="Wohnzimmer Licht"
                  icon="💡"
                  accentColor={previewColors.accent || '#6366f1'}
                  bgColor={previewColors.background || '#1a1d2e'}
                  fgColor={previewColors.foreground || '#ffffff'}
                  cardColor={previewColors.card || '#1a1d2e'}
                  borderColor={previewColors.border || '#ffffff22'}
                />

                {/* Switch Widget Preview */}
                <PreviewWidget
                  label="Steckdose Küche"
                  icon="🔌"
                  accentColor={previewColors.accent || '#6366f1'}
                  bgColor={previewColors.background || '#1a1d2e'}
                  fgColor={previewColors.foreground || '#ffffff'}
                  cardColor={previewColors.card || '#1a1d2e'}
                  borderColor={previewColors.border || '#ffffff22'}
                />

                {/* Climate Widget Preview */}
                <PreviewWidget
                  label="Thermostat Bad"
                  icon="🌡️"
                  accentColor={previewColors.accent || '#6366f1'}
                  bgColor={previewColors.background || '#1a1d2e'}
                  fgColor={previewColors.foreground || '#ffffff'}
                  cardColor={previewColors.card || '#1a1d2e'}
                  borderColor={previewColors.border || '#ffffff22'}
                />

                {/* Sensor Widget Preview */}
                <PreviewWidget
                  label="Temperatur Außen"
                  icon="📊"
                  accentColor={previewColors.success || '#22c55e'}
                  bgColor={previewColors.background || '#1a1d2e'}
                  fgColor={previewColors.foreground || '#ffffff'}
                  cardColor={previewColors.card || '#1a1d2e'}
                  borderColor={previewColors.border || '#ffffff22'}
                />

                {/* Media Player Preview */}
                <PreviewWidget
                  label="Lautsprecher Wohnzimmer"
                  icon="🎵"
                  accentColor={previewColors.accent || '#6366f1'}
                  bgColor={previewColors.background || '#1a1d2e'}
                  fgColor={previewColors.foreground || '#ffffff'}
                  cardColor={previewColors.card || '#1a1d2e'}
                  borderColor={previewColors.border || '#ffffff22'}
                />

                {/* Weather Preview */}
                <PreviewWidget
                  label="Wetter Berlin"
                  icon="☁️"
                  accentColor={previewColors.ring || '#6366f1'}
                  bgColor={previewColors.background || '#1a1d2e'}
                  fgColor={previewColors.foreground || '#ffffff'}
                  cardColor={previewColors.card || '#1a1d2e'}
                  borderColor={previewColors.border || '#ffffff22'}
                />

                {/* Muted section */}
                <div className="col-span-full mt-6 mb-2">
                  <h3 className="text-xs font-semibold tracking-wider uppercase mb-3" style={{ color: `${previewColors['muted-foreground'] || '#888888'}`, fontFamily: fonts.heading }}>
                    Gedämpfte Bereiche
                  </h3>
                </div>

                {/* Muted card */}
                <div style={{
                  background: previewColors.muted || '#1e1e2e',
                  color: previewColors['muted-foreground'] || '#888888',
                  border: `1px solid ${previewColors.border || '#ffffff22'}`,
                  borderRadius: '12px',
                  padding: '14px 16px',
                  fontSize: '12px',
                  textAlign: 'center',
                  fontFamily: fonts.mono,
                }}>
                  <p className="text-xs">var(--muted)</p>
                  <p className="text-[10px] mt-1 opacity-60">Sekundäre Flächenfarbe</p>
                </div>

                {/* Destructive preview */}
                <div style={{
                  background: `${previewColors.destructive || '#ef4444'}15`,
                  color: previewColors.destructive || '#ef4444',
                  border: `1px solid ${previewColors.destructive || '#ef4444'}33`,
                  borderRadius: '12px',
                  padding: '14px 16px',
                  fontSize: '12px',
                  textAlign: 'center',
                }}>
                  <p className="text-xs font-medium">⚠ Fehlerfarbe</p>
                  <p className="text-[10px] mt-1 opacity-60">var(--destructive)</p>
                </div>

                {/* Success preview */}
                <div style={{
                  background: `${previewColors.success || '#22c55e'}15`,
                  color: previewColors.success || '#22c55e',
                  border: `1px solid ${previewColors.success || '#22c55e'}33`,
                  borderRadius: '12px',
                  padding: '14px 16px',
                  fontSize: '12px',
                  textAlign: 'center',
                }}>
                  <p className="text-xs font-medium">✓ Erfolgsfarbe</p>
                  <p className="text-[10px] mt-1 opacity-60">var(--success)</p>
                </div>
              </div>

              {/* Code Preview */}
              <div className="mt-8 p-4 rounded-lg" style={{
                background: `${previewColors.muted || '#1e1e2e'}88`,
                border: `1px solid ${previewColors.border || '#ffffff22'}`,
                fontFamily: fonts.mono,
              }}>
                <p className="text-[10px] opacity-40 mb-2 uppercase tracking-wider">CSS-Variablen (Vorschau)</p>
                <pre className="text-[10px] opacity-60 font-mono leading-relaxed whitespace-pre-wrap">
{`--background: ${previewColors.background || '...'};
--foreground: ${previewColors.foreground || '...'};
--card: ${previewColors.card || '...'};
--accent: ${previewColors.accent || '...'};
--muted: ${previewColors.muted || '...'};
--border: ${previewColors.border || '...'};
--success: ${previewColors.success || '...'};
--destructive: ${previewColors.destructive || '...'};
--radius: ${layout.cardRadius};
--glass-blur: ${effects.glassBlur};
--transition-duration: ${effects.transitionDuration};`}
                </pre>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
