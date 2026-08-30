/**
 * YAML Page Editor – Write rumahl pages as YAML configuration.
 *
 * Generates the same page structure as the drag-and-drop Page Designer
 * but in a text-based YAML format. Live preview available.
 *
 * YAML Schema:
 * ```yaml
 * name: My Page
 * icon: House
 * layout:
 *   columns: 6
 *   gap: 12
 *   background: '#0f1118'
 * widgets:
 *   - type: light
 *     entity: light.wohnzimmer
 *     position: [0, 0]
 *     size: [2, 1]
 *     config:
 *       cardVariant: default
 *       transparentBackground: false
 *   - type: clock
 *     position: [2, 0]
 *     size: [2, 1]
 * ```
 */

import { useTranslation } from 'react-i18next'
import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  Code, Eye, ArrowsClockwise, CheckCircle, Warning,
  Download, Upload, Copy, X, FloppyDisk, FileText,
  BracketsCurly, Play, Pause,
} from '@phosphor-icons/react'
import { toast } from '@/lib/toast'

// ─── Types ──────────────────────────────────────────────────────────

interface YamlWidget {
  type: string
  entity?: string
  position: [number, number]
  size: [number, number]
  config?: Record<string, unknown>
  label?: string
}

interface YamlPage {
  name: string
  icon?: string
  description?: string
  layout?: {
    columns?: number
    gap?: number
    background?: string
    maxWidth?: number
  }
  widgets: YamlWidget[]
  css?: string
}

// ─── YAML Parser (lightweight, no external lib) ─────────────────────

function parseYamlPage(yaml: string): { page: YamlPage | null; errors: string[] } {
  const errors: string[] = []

  try {
    const page: YamlPage = { name: 'New Page', widgets: [] }
    const lines = yaml.split('\n')
    let currentWidget: Partial<YamlWidget> | null = null
    let inWidgets = false
    let inConfig = false
    let indentLevel = 0

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue

      const indent = line.search(/\S/)
      const keyValue = trimmed.split(':').map(s => s.trim())
      if (keyValue.length < 2) {
        if (trimmed.startsWith('- ') && inWidgets) {
          // New widget entry
          if (currentWidget && currentWidget.type) {
            page.widgets.push(currentWidget as YamlWidget)
          }
          currentWidget = { position: [0, 0], size: [2, 1] }
          inConfig = false
          const widgetLine = trimmed.substring(2)
          const [wKey, ...wVal] = widgetLine.split(':').map(s => s.trim())
          if (wKey === 'type') currentWidget.type = wVal.join(':')
          continue
        }
        continue
      }

      const key = keyValue[0]
      const value = keyValue.slice(1).join(':').trim()

      if (indent === 0) {
        // Top-level fields
        inWidgets = false
        currentWidget = null
        inConfig = false
        switch (key) {
          case 'name': page.name = value; break
          case 'icon': page.icon = value; break
          case 'description': page.description = value; break
          case 'css': page.css = (page.css || '') + value + '\n'; break
          case 'widgets': inWidgets = true; break
          case 'layout':
            page.layout = page.layout || {}
            break
          default:
            if (!inWidgets) errors.push(`Zeile ${i + 1}: Unbekanntes Feld "${key}"`)
        }
        continue
      }

      if (indent <= 2 && page.layout !== undefined && !inWidgets) {
        // Layout fields
        switch (key) {
          case 'columns': page.layout!.columns = parseInt(value); break
          case 'gap': page.layout!.gap = parseInt(value); break
          case 'background': page.layout!.background = value; break
          case 'maxWidth': page.layout!.maxWidth = parseInt(value); break
        }
        continue
      }

      if (inWidgets && currentWidget) {
        if (key === 'config' || key === 'config:') {
          inConfig = true
          currentWidget.config = {}
          continue
        }

        if (inConfig) {
          currentWidget.config = currentWidget.config || {}
          const parsed = parseYamlValue(value)
          currentWidget.config[key] = parsed
          continue
        }

        switch (key) {
          case 'type': currentWidget.type = value; break
          case 'entity': currentWidget.entity = value || undefined; break
          case 'label': currentWidget.label = value; break
          case 'position':
            const pos = parseArray(value)
            if (pos.length >= 2) currentWidget.position = [pos[0], pos[1]]
            break
          case 'size':
            const sz = parseArray(value)
            if (sz.length >= 2) currentWidget.size = [sz[0], sz[1]]
            break
        }
      }
    }

    // Add last widget
    if (currentWidget?.type) {
      page.widgets.push(currentWidget as YamlWidget)
    }

    return { page, errors }
  } catch (e) {
    return { page: null, errors: [(e as Error).message] }
  }
}

function parseArray(val: string): number[] {
  const cleaned = val.replace(/[\[\]]/g, '').trim()
  return cleaned.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n))
}

function parseYamlValue(val: string): unknown {
  if (val === 'true') return true
  if (val === 'false') return false
  if (val === 'null' || val === '~') return null
  if (/^\d+$/.test(val)) return parseInt(val)
  if (/^\d+\.\d+$/.test(val)) return parseFloat(val)
  // Remove quotes
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    return val.slice(1, -1)
  }
  return val
}

function pageToYaml(page: YamlPage): string {
  const lines: string[] = []
  lines.push(`name: ${page.name}`)
  if (page.icon) lines.push(`icon: ${page.icon}`)
  if (page.description) lines.push(`description: ${page.description}`)
  lines.push('')

  if (page.layout) {
    lines.push('layout:')
    if (page.layout.columns) lines.push(`  columns: ${page.layout.columns}`)
    if (page.layout.gap) lines.push(`  gap: ${page.layout.gap}`)
    if (page.layout.background) lines.push(`  background: "${page.layout.background}"`)
    if (page.layout.maxWidth) lines.push(`  maxWidth: ${page.layout.maxWidth}`)
    lines.push('')
  }

  lines.push('widgets:')
  for (const w of page.widgets) {
    lines.push(`  - type: ${w.type}`)
    if (w.entity) lines.push(`    entity: ${w.entity}`)
    if (w.label) lines.push(`    label: ${w.label}`)
    lines.push(`    position: [${w.position[0]}, ${w.position[1]}]`)
    lines.push(`    size: [${w.size[0]}, ${w.size[1]}]`)
    if (w.config && Object.keys(w.config).length > 0) {
      lines.push('    config:')
      for (const [k, v] of Object.entries(w.config)) {
        if (typeof v === 'boolean' || typeof v === 'number') lines.push(`      ${k}: ${v}`)
        else lines.push(`      ${k}: "${v}"`)
      }
    }
  }

  if (page.css) {
    lines.push('')
    lines.push('css: |')
    page.css.split('\n').forEach(l => lines.push(`  ${l}`))
  }

  return lines.join('\n')
}

// ─── YAML Editor Component ─────────────────────────────────────────

interface YamlPageEditorProps {
  initialYaml?: string
  onSave?: (yaml: string, page: YamlPage) => void
  onClose?: () => void
  embedded?: boolean
}

export function YamlPageEditor({ initialYaml, onSave, onClose, embedded }: YamlPageEditorProps) {
  const { t } = useTranslation()
  const defaultYaml = initialYaml || `name: Neue Seite
icon: House
description: Meine custom Seite

layout:
  columns: 6
  gap: 12

widgets:
  - type: greeting
    position: [0, 0]
    size: [3, 1]
  - type: clock
    position: [3, 0]
    size: [3, 1]
  - type: light
    entity: light.wohnzimmer
    position: [0, 1]
    size: [2, 1]
    config:
      cardVariant: default
`
  const [yaml, setYaml] = useState(defaultYaml)
  const [showPreview, setShowPreview] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const editorRef = useRef<HTMLTextAreaElement>(null)

  const parsed = useMemo(() => parseYamlPage(yaml), [yaml])

  const handleValidate = useCallback(() => {
    const result = parseYamlPage(yaml)
    setErrors(result.errors)
    setWarnings([])

    // Additional warnings
    const warns: string[] = []
    if (result.page && result.page.widgets.length === 0) {
      warns.push('Die Seite hat keine Widgets.')
    }
    for (let i = 0; i < (result.page?.widgets.length || 0); i++) {
      const w = result.page!.widgets[i]
      if (!w.entity && ['light', 'switch', 'climate', 'sensor', 'media_player', 'cover', 'fan', 'lock', 'vacuum', 'camera'].includes(w.type)) {
        warns.push(`Widget #${i + 1} (${w.type}): Keine entity_id angegeben.`)
      }
    }
    setWarnings(warns)
  }, [yaml])

  useEffect(() => { handleValidate() }, [yaml, handleValidate])

  const handleSave = () => {
    if (parsed.page && parsed.errors.length === 0) {
      onSave?.(yaml, parsed.page)
      toast.success('Seite gespeichert')
    } else {
      toast.error('Bitte erst alle Fehler beheben')
    }
  }

  const handleExport = () => {
    const blob = new Blob([yaml], { type: 'text/yaml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${parsed.page?.name?.replace(/\s+/g, '-').toLowerCase() || 'page'}.yaml`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('YAML exportiert')
  }

  const handleImport = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.yaml,.yml'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        setYaml(reader.result as string)
        toast.success('YAML importiert')
      }
      reader.readAsText(file)
    }
    input.click()
  }

  const handleTabKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      const textarea = e.currentTarget
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const newValue = yaml.substring(0, start) + '  ' + yaml.substring(end)
      setYaml(newValue)
      // Set cursor position after state update
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2
      })
    }
  }

  return (
    <div className={embedded ? '' : 'fixed inset-0 z-50 bg-bg/95 backdrop-blur-xl'}>
      {!embedded && (
        <div className="glass-header flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-3">
            <BracketsCurly size={18} className="text-accent" weight="fill" />
            <h2 className="text-sm font-bold text-fg">YAML Page Editor</h2>
            {parsed.page && <span className="text-[10px] text-muted-fg">{parsed.page.name}</span>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleImport} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-fg hover:text-fg hover:bg-muted transition-all">
              <Upload size={12} /> Import
            </button>
            <button onClick={handleExport} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-fg hover:text-fg hover:bg-muted transition-all">
              <Download size={12} /> Export
            </button>
            <button onClick={() => setShowPreview(!showPreview)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${showPreview ? 'bg-accent/15 text-accent' : 'text-muted-fg hover:text-fg hover:bg-muted'}`}>
              {showPreview ? <Pause size={12} /> : <Eye size={12} />}
              {showPreview ? 'Editor' : 'Vorschau'}
            </button>
            <button onClick={handleSave} className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-accent text-white hover:bg-accent-hover transition-all shadow-sm">
              <FloppyDisk size={12} /> Speichern
            </button>
            {onClose && (
              <button onClick={onClose} className="p-1.5 rounded-lg text-muted-fg hover:text-fg hover:bg-muted transition-all">
                <X size={16} />
              </button>
            )}
          </div>
        </div>
      )}

      <div className={`flex ${embedded ? 'flex-col' : 'h-[calc(100vh-3.5rem)]'}`}>
        {/* Editor Panel */}
        <AnimatePresence mode="wait">
          {!showPreview ? (
            <motion.div
              key="editor"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex-1 flex flex-col"
            >
              <div className="relative flex-1">
                {/* Line numbers gutter */}
                <textarea
                  ref={editorRef}
                  value={yaml}
                  onChange={(e) => setYaml(e.target.value)}
                  onKeyDown={handleTabKey}
                  spellCheck={false}
                  className="w-full h-full resize-none bg-transparent text-fg font-mono text-sm p-4 pl-14 leading-relaxed focus:outline-none"
                  placeholder="name: Meine Seite..."
                  style={{
                    fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                    tabSize: 2,
                    lineHeight: 1.7,
                  }}
                />
                {/* Line numbers overlay */}
                <div className="absolute left-0 top-0 bottom-0 w-10 bg-muted/50 pointer-events-none flex flex-col items-end pr-2 pt-4 text-[10px] text-muted-fg/50 font-mono select-none leading-[1.7]"
                  style={{ lineHeight: '1.7rem' }}>
                  {yaml.split('\n').map((_, i) => (
                    <div key={i}>{i + 1}</div>
                  ))}
                </div>
              </div>

              {/* Status bar */}
              <div className="h-8 border-t border-border flex items-center justify-between px-4 text-[10px]">
                <div className="flex items-center gap-3">
                  <span className="text-muted-fg">{yaml.split('\n').length} Zeilen</span>
                  <span className="text-muted-fg">{parsed.page?.widgets.length || 0} Widgets</span>
                </div>
                <div className="flex items-center gap-2">
                  {errors.length > 0 && (
                    <span className="flex items-center gap-1 text-destructive">
                      <Warning size={10} weight="fill" /> {errors.length} Fehler
                    </span>
                  )}
                  {warnings.length > 0 && (
                    <span className="flex items-center gap-1 text-star">
                      <Warning size={10} /> {warnings.length} Warnungen
                    </span>
                  )}
                  {errors.length === 0 && <span className="flex items-center gap-1 text-success"><CheckCircle size={10} weight="fill" /> Valide</span>}
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="preview"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex-1 overflow-y-auto p-6"
            >
              <YamlPreview page={parsed.page} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Error/Warning Panel */}
        {(errors.length > 0 || warnings.length > 0) && (
          <div className="w-72 border-l border-border overflow-y-auto p-4 shrink-0">
            <h3 className="text-xs font-bold text-fg mb-3 flex items-center gap-1.5">
              <Code size={12} className="text-accent" /> Validierung
            </h3>
            {errors.map((err, i) => (
              <div key={`e${i}`} className="flex items-start gap-1.5 mb-2 text-[10px] text-destructive">
                <X size={12} className="shrink-0 mt-0.5" />
                <span>{err}</span>
              </div>
            ))}
            {warnings.map((warn, i) => (
              <div key={`w${i}`} className="flex items-start gap-1.5 mb-2 text-[10px] text-star">
                <Warning size={12} className="shrink-0 mt-0.5" />
                <span>{warn}</span>
              </div>
            ))}
            {errors.length === 0 && warnings.length === 0 && (
              <div className="text-[10px] text-success flex items-center gap-1">
                <CheckCircle size={10} weight="fill" /> Keine Probleme
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── YAML Preview Renderer ──────────────────────────────────────────

function YamlPreview({ page }: { page: YamlPage | null }) {
  if (!page) {
    return <div className="text-center py-20 text-muted-fg text-sm">Ungültiges YAML</div>
  }

  const cols = page.layout?.columns || 6
  const gap = page.layout?.gap || 12

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-fg">{page.name}</h1>
        {page.description && <p className="text-xs text-muted-fg mt-1">{page.description}</p>}
      </div>

      <div
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gap: `${gap}px`,
          maxWidth: page.layout?.maxWidth ? `${page.layout.maxWidth}px` : undefined,
          background: page.layout?.background || 'transparent',
          borderRadius: '1rem',
          padding: page.layout?.background ? '1rem' : undefined,
        }}
      >
        {page.widgets.map((widget, i) => (
          <div
            key={i}
            className="glass-card p-4 flex flex-col items-center justify-center text-center min-h-[80px]"
            style={{
              gridColumn: `span ${widget.size[0]}`,
              gridRow: `span ${widget.size[1]}`,
            }}
          >
            <div className="text-2xl mb-1">{getWidgetIcon(widget.type)}</div>
            <div className="text-xs font-semibold text-fg capitalize">{widget.type}</div>
            {widget.entity && <div className="text-[10px] text-muted-fg mt-0.5 font-mono">{widget.entity}</div>}
            {widget.label && <div className="text-[10px] text-muted-fg mt-0.5">{widget.label}</div>}
            <div className="text-[9px] text-muted-fg/40 mt-1">{widget.size[0]}×{widget.size[1]}</div>
          </div>
        ))}
      </div>

      {page.css && (
        <div className="mt-6 glass-card p-4">
          <h3 className="text-xs font-bold text-fg mb-2">Custom CSS</h3>
          <pre className="text-[10px] text-muted-fg font-mono whitespace-pre-wrap">{page.css}</pre>
        </div>
      )}
    </div>
  )
}

function getWidgetIcon(type: string): string {
  const icons: Record<string, string> = {
    light: 'L', switch: 'S', climate: 'C', sensor: 'Se',
    weather: 'W', greeting: 'G', clock: 'T', calendar: 'Ca',
    media_player: 'M', camera: 'Cm', cover: 'Co', fan: 'F',
    lock: 'Lk', vacuum: 'V', button: 'B', scene: 'Sc',
    iframe: 'If', map: 'Mp', spacer: 'Sp', group: 'Gr',
  }
  return icons[type] || '?'
}
