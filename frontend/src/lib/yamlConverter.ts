/**
 * YAML Converter – Bidirectional JSON ↔ YAML for IORA Pages & Widgets.
 *
 * Converts the internal DashboardPage/DashboardWidget JSON format to
 * human-readable YAML and back. Used for:
 *  - Exporting drag-and-drop pages as YAML
 *  - Importing YAML pages into the designer
 *  - Storing custom widget definitions in YAML
 *  - Translation/i18n support via YAML locale files
 *
 * YAML Schema for Pages:
 * ```yaml
 * id: wohnzimmer
 * name: Wohnzimmer
 * icon: House
 * pageType: dashboard
 * showInNav: true
 * order: 0
 * layout:
 *   columns: 6
 *   gap: 12
 * widgets:
 *   - id: w1
 *     type: light
 *     entity: light.wohnzimmer
 *     position: [0, 0]
 *     size: [2, 1]
 *     config:
 *       cardVariant: default
 * ```
 */

import type { DashboardPage, DashboardWidget, WidgetType } from '@/lib/types'

// ─── Types ──────────────────────────────────────────────────────────

export interface YamlWidgetDef {
  id: string
  type: string
  entity?: string
  position: [number, number]
  size: [number, number]
  label?: string
  config?: Record<string, unknown>
}

export interface YamlPageDef {
  id: string
  name: string
  icon: string
  pageType?: string
  showInNav?: boolean
  order?: number
  description?: string
  layout?: {
    columns?: number
    gap?: number
    background?: string
  }
  widgets: YamlWidgetDef[]
  css?: string
  i18n?: Record<string, Record<string, string>>
}

// ─── JSON → YAML Converter ──────────────────────────────────────────

/**
 * Convert an internal DashboardPage to YAML string.
 */
export function pageToYaml(page: DashboardPage): string {
  const lines: string[] = []
  const push = (indent: number, text: string) => lines.push('  '.repeat(indent) + text)

  push(0, `id: ${page.id}`)
  push(0, `name: ${quoteIfNeeded(page.name)}`)
  push(0, `icon: ${page.icon}`)
  if (page.pageType && page.pageType !== 'dashboard') push(0, `pageType: ${page.pageType}`)
  if (page.showInNav !== undefined) push(0, `showInNav: ${page.showInNav}`)
  if (page.order !== undefined) push(0, `order: ${page.order}`)

  lines.push('')
  push(0, 'widgets:')
  for (const w of page.widgets) {
    push(1, `- id: ${w.id}`)
    push(2, `type: ${w.type}`)
    if (w.entity_id) push(2, `entity: ${w.entity_id}`)
    if (w.label) push(2, `label: ${quoteIfNeeded(w.label)}`)
    push(2, `position: [${w.position.x}, ${w.position.y}]`)
    push(2, `size: [${w.size.w}, ${w.size.h}]`)
    if (w.config && Object.keys(w.config).length > 0) {
      push(2, 'config:')
      for (const [k, v] of Object.entries(w.config)) {
        push(3, `${k}: ${yamlValue(v)}`)
      }
    }
  }

  return lines.join('\n')
}

/**
 * Convert YAML string to a DashboardPage.
 */
export function yamlToPage(yaml: string, existingId?: string): { page: DashboardPage | null; errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []

  try {
    const page: DashboardPage = {
      id: existingId || generateId(),
      name: 'New Page',
      icon: 'House',
      widgets: [],
    }

    const lines = yaml.split('\n')
    let currentWidget: Partial<DashboardWidget> | null = null
    let inConfig = false

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue

      const indent = line.search(/\S/)
      const colonIdx = trimmed.indexOf(':')
      if (colonIdx === -1) continue

      const key = trimmed.substring(0, colonIdx).trim()
      const value = trimmed.substring(colonIdx + 1).trim()

      // Top-level fields (indent 0)
      if (indent === 0) {
        inConfig = false
        if (key === '-' && value.startsWith('id:')) {
          // New widget entry
          if (currentWidget?.type) {
            finalizeWidget(currentWidget, page.widgets, errors, i)
          }
          currentWidget = { id: value.substring(3).trim(), position: { x: 0, y: 0 }, size: { w: 2, h: 1 } } as Partial<DashboardWidget>
          continue
        }

        switch (key) {
          case 'id': page.id = unquote(value); break
          case 'name': page.name = unquote(value); break
          case 'icon': page.icon = unquote(value); break
          case 'pageType': page.pageType = unquote(value) as DashboardPage['pageType']; break
          case 'showInNav': page.showInNav = value === 'true'; break
          case 'order': page.order = parseInt(value) || 0; break
          case 'description': /* stored as metadata */ break
          case 'widgets': /* just a section header */ break
          case 'layout': /* layout section */ break
          case 'css': /* custom CSS follows as block */ break
        }
        continue
      }

      // Widget fields (indent 2+)
      if (currentWidget) {
        if (key === 'config') {
          inConfig = true
          currentWidget.config = {}
          continue
        }

        if (inConfig && indent >= 6) {
          currentWidget.config = currentWidget.config || {}
          ;(currentWidget.config as Record<string, unknown>)[key] = parseYamlValue(value)
          continue
        }

        if (indent === 2) {
          inConfig = false
          switch (key) {
            case 'id': currentWidget.id = unquote(value); break
            case 'type': (currentWidget as any).type = unquote(value); break
            case 'entity': currentWidget.entity_id = unquote(value) || undefined; break
            case 'label': currentWidget.label = unquote(value); break
            case 'position':
              const pos = parsePosition(value)
              if (pos) { currentWidget.position = { x: pos[0], y: pos[1] } }
              else errors.push(`Zeile ${i + 1}: Ungültige position "${value}"`)
              break
            case 'size':
              const sz = parseSize(value)
              if (sz) { currentWidget.size = { w: sz[0], h: sz[1] } }
              else errors.push(`Zeile ${i + 1}: Ungültige size "${value}"`)
              break
          }
        }
        continue
      }
    }

    // Add last widget
    if (currentWidget?.type) {
      finalizeWidget(currentWidget, page.widgets, errors, lines.length)
    }

    if (page.widgets.length === 0) {
      warnings.push('Die Seite hat keine Widgets.')
    }

    return { page, errors, warnings }
  } catch (e) {
    return { page: null, errors: [(e as Error).message], warnings: [] }
  }
}

// ─── YAML Custom Widget Definition ───────────────────────────────────

export interface YamlCustomWidget {
  id: string
  name: string
  description?: string
  icon?: string
  category?: string
  props?: YamlWidgetProp[]
  template: string
  css?: string
  js?: string
  /** Data sources this widget can bind to */
  bindings?: YamlWidgetBinding[]
  /** Supported config options */
  config_schema?: YamlConfigField[]
}

export interface YamlWidgetProp {
  name: string
  type: 'string' | 'number' | 'boolean' | 'color' | 'select' | 'entity'
  label: string
  default?: unknown
  required?: boolean
  options?: string[]
  description?: string
}

export interface YamlWidgetBinding {
  source: 'entity' | 'template' | 'static'
  key: string
  target: string  // CSS selector or {placeholder} in template
  transform?: string  // e.g. "round(1)", "uppercase"
}

export interface YamlConfigField {
  key: string
  type: 'string' | 'number' | 'boolean' | 'color' | 'select' | 'slider'
  label: string
  default?: unknown
  options?: string[]
  min?: number
  max?: number
}

/**
 * Parse a YAML custom widget definition.
 */
export function parseCustomWidgetYaml(yaml: string): { widget: YamlCustomWidget | null; errors: string[] } {
  const errors: string[] = []
  try {
    const widget: Partial<YamlCustomWidget> = {
      props: [],
      bindings: [],
      config_schema: [],
    }
    const lines = yaml.split('\n')
    let inSection: 'props' | 'bindings' | 'config_schema' | 'template' | 'css' | 'js' | null = null
    let sectionContent = ''

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue

      const colonIdx = trimmed.indexOf(':')
      if (colonIdx === -1) continue

      const key = trimmed.substring(0, colonIdx).trim()
      const value = trimmed.substring(colonIdx + 1).trim()

      if (['template', 'css', 'js'].includes(key) && (value === '|' || value === '>-')) {
        inSection = key as unknown as typeof inSection
        sectionContent = ''
        continue
      }

      if (inSection === 'template' && line.startsWith('  ')) {
        sectionContent += line.trimStart() + '\n'
        // Check if next line is still part of the section
        if (i + 1 < lines.length && !lines[i + 1].startsWith('  ')) {
          widget.template = sectionContent.trim()
          inSection = null
        }
        continue
      }
      if (inSection === 'css' && line.startsWith('  ')) {
        sectionContent += line.trimStart() + '\n'
        if (i + 1 >= lines.length || !lines[i + 1].startsWith('  ')) {
          widget.css = sectionContent.trim()
          inSection = null
        }
        continue
      }
      if (inSection === 'js' && line.startsWith('  ')) {
        sectionContent += line.trimStart() + '\n'
        if (i + 1 >= lines.length || !lines[i + 1].startsWith('  ')) {
          widget.js = sectionContent.trim()
          inSection = null
        }
        continue
      }

      inSection = null

      switch (key) {
        case 'id': widget.id = unquote(value); break
        case 'name': widget.name = unquote(value); break
        case 'description': widget.description = unquote(value); break
        case 'icon': widget.icon = unquote(value); break
        case 'category': widget.category = unquote(value); break
        case 'props': /* section header */ break
        case 'bindings': /* section header */ break
        case 'config_schema': /* section header */ break
      }
    }

    if (!widget.id) errors.push('Widget ID fehlt')
    if (!widget.name) errors.push('Widget Name fehlt')
    if (!widget.template) errors.push('Widget Template fehlt')

    return { widget: widget as YamlCustomWidget | null, errors }
  } catch (e) {
    return { widget: null, errors: [(e as Error).message] }
  }
}

// ─── YAML Translation/i18n ───────────────────────────────────────────

export interface YamlTranslation {
  locale: string
  translations: Record<string, string>
}

/**
 * Extract translatable strings from a YAML page definition.
 */
export function extractTranslatableStrings(yaml: string): string[] {
  const strings: string[] = []
  const lines = yaml.split('\n')
  for (const line of lines) {
    const match = line.match(/^(name|label|description):\s*["']?(.+?)["']?$/)
    if (match) {
      strings.push(match[2])
    }
  }
  return [...new Set(strings)]
}

/**
 * Apply translations to a YAML page string.
 */
export function applyTranslations(yaml: string, translations: Record<string, string>): string {
  let result = yaml
  for (const [key, value] of Object.entries(translations)) {
    result = result.replace(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value)
  }
  return result
}

// ─── Helpers ─────────────────────────────────────────────────────────

function quoteIfNeeded(str: string): string {
  if (/[:{}\[\],&*?|<>"'`!@#%^()]/.test(str) || str.includes(' ') || str.length === 0) {
    return `"${str.replace(/"/g, '\\"')}"`
  }
  return str
}

function unquote(str: string): string {
  if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
    return str.slice(1, -1)
  }
  return str
}

function yamlValue(val: unknown): string {
  if (val === null || val === undefined) return 'null'
  if (typeof val === 'boolean') return val ? 'true' : 'false'
  if (typeof val === 'number') return String(val)
  return quoteIfNeeded(String(val))
}

function parseYamlValue(val: string): unknown {
  if (val === 'true') return true
  if (val === 'false') return false
  if (val === 'null' || val === '~') return null
  if (/^-?\d+$/.test(val)) return parseInt(val)
  if (/^-?\d+\.\d+$/.test(val)) return parseFloat(val)
  return unquote(val)
}

function parsePosition(val: string): [number, number] | null {
  const cleaned = val.replace(/[\[\]]/g, '').trim()
  const parts = cleaned.split(',').map(s => parseInt(s.trim()))
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) return [parts[0], parts[1]]
  return null
}

function parseSize(val: string): [number, number] | null {
  return parsePosition(val)
}

function generateId(): string {
  return 'page_' + Math.random().toString(36).substring(2, 10)
}

function finalizeWidget(
  w: Partial<DashboardWidget>,
  widgets: DashboardWidget[],
  errors: string[],
  line: number,
) {
  if (!w.id) w.id = `w${widgets.length + 1}`
  if (!w.type) {
    errors.push(`Widget "${w.id}" hat keinen type.`)
    ;(w as any).type = 'spacer'
  }
  widgets.push({
    id: w.id!,
    type: (w as any).type as WidgetType || 'spacer',
    entity_id: w.entity_id,
    position: w.position || { x: 0, y: 0 },
    size: w.size || { w: 2, h: 1 },
    config: w.config || {},
    label: w.label,
  })
}
