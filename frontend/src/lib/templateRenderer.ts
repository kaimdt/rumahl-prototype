/**
 * Template Renderer – Converts Theme HTML templates to React elements.
 *
 * Themes provide HTML files with `data-slot="name"` attributes marking
 * positions where React components should be injected.
 *
 * Example theme template (layout.html):
 * ```html
 * <div class="my-theme-layout">
 *   <nav data-slot="navigation"></nav>
 *   <main data-slot="content"></main>
 * </div>
 * ```
 *
 * Usage:
 * ```tsx
 * const html = '<div class="wrapper"><div data-slot="hello"></div></div>'
 * const result = renderTemplate(html, { hello: <span>World</span> })
 * ```
 */

import React from 'react'

/**
 * Converts a style attribute string to a React CSSProperties object.
 */
function parseStyleString(styleStr: string): React.CSSProperties {
  const style: Record<string, string> = {}
  styleStr.split(';').forEach(rule => {
    const colonIdx = rule.indexOf(':')
    if (colonIdx === -1) return
    const prop = rule.substring(0, colonIdx).trim()
    const val = rule.substring(colonIdx + 1).trim()
    if (!prop || !val) return
    // Convert kebab-case to camelCase
    const camelProp = prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
    style[camelProp] = val
  })
  return style as React.CSSProperties
}

/**
 * Converts an attribute name to a React prop name.
 */
function attrToProp(attrName: string): string {
  // Map HTML attributes to React props
  const attrMap: Record<string, string> = {
    'class': 'className',
    'for': 'htmlFor',
    'tabindex': 'tabIndex',
    'viewbox': 'viewBox',
    'stroke-width': 'strokeWidth',
    'stroke-linecap': 'strokeLinecap',
    'stroke-linejoin': 'strokeLinejoin',
    'fill-rule': 'fillRule',
    'clip-rule': 'clipRule',
    'stroke-dasharray': 'strokeDasharray',
    'stroke-dashoffset': 'strokeDashoffset',
  }
  return attrMap[attrName] || attrName
}

/**
 * Check if an element is a void element (self-closing in HTML).
 */
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
])

/**
 * Convert a DOM Node to a React element.
 * When a `data-slot` attribute is found, the corresponding slot content
 * from the `slots` map is rendered instead.
 */
function domNodeToReact(
  node: Node,
  slots: Record<string, React.ReactNode>,
  key: number | string,
): React.ReactNode {
  // Text node
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent || ''
    // Skip whitespace-only text nodes between elements
    if (text.trim() === '' && node.parentNode?.nodeType === Node.ELEMENT_NODE) {
      return null
    }
    return text
  }

  // Comment node
  if (node.nodeType === Node.COMMENT_NODE) {
    return null
  }

  // Element node
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as Element
    const tagName = el.tagName.toLowerCase()

    // Check if this element is a slot
    const slotName = el.getAttribute('data-slot')
    if (slotName) {
      const slotContent = slots[slotName]
      if (slotContent !== undefined) {
        // Wrap in fragment to maintain slot position
        return React.createElement(React.Fragment, { key }, slotContent)
      }
      // Empty slot – preserve the element as a placeholder with its classes/styles
      // but render nothing inside (or render fallback children)
      const fallbackChildren: React.ReactNode[] = []
      node.childNodes.forEach((child, i) => {
        const converted = domNodeToReact(child, slots, i)
        if (converted != null) fallbackChildren.push(converted)
      })
      return fallbackChildren.length > 0
        ? React.createElement(React.Fragment, { key }, ...fallbackChildren)
        : null
    }

    // Build React props from element attributes
    const props: Record<string, unknown> = { key }

    for (const attr of el.attributes) {
      if (attr.name === 'data-slot') continue

      if (attr.name === 'style') {
        props.style = parseStyleString(attr.value)
      } else if (attr.name.startsWith('data-')) {
        // Pass through data attributes as-is
        props[attr.name] = attr.value
      } else if (attr.name === 'class') {
        props.className = attr.value
      } else {
        const propName = attrToProp(attr.name)
        props[propName] = attr.value
      }
    }

    // Convert children
    const children: React.ReactNode[] = []
    if (!VOID_ELEMENTS.has(tagName)) {
      node.childNodes.forEach((child, i) => {
        const converted = domNodeToReact(child, slots, i)
        if (converted != null) children.push(converted)
      })
    }

    // Filter out null children
    const filteredChildren = children.filter(c => c !== null && c !== undefined && c !== false)

    if (filteredChildren.length === 0 && VOID_ELEMENTS.has(tagName)) {
      return React.createElement(tagName, props)
    }

    return React.createElement(tagName, props, ...filteredChildren)
  }

  return null
}

/**
 * Options for template rendering.
 */
export interface TemplateRenderOptions {
  /** If true, wraps the result in a div when the template has multiple root elements */
  wrapMultipleRoots?: boolean
  /** CSS class to add to the wrapper div when wrapping multiple roots */
  wrapperClassName?: string
}

/**
 * Render an HTML template string into React elements.
 *
 * The HTML is parsed and converted to React elements. Elements with
 * `data-slot="name"` are replaced with the corresponding value from
 * the `slots` map.
 *
 * @param html - The HTML template string
 * @param slots - Map of slot name → React node
 * @param options - Rendering options
 * @returns React node ready to be rendered
 */
export function renderTemplate(
  html: string,
  slots: Record<string, React.ReactNode> = {},
  options: TemplateRenderOptions = {},
): React.ReactNode {
  if (!html || html.trim().length === 0) {
    return null
  }

  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')

  // Collect root-level body children (skip empty text nodes)
  const bodyChildren: Node[] = []
  doc.body.childNodes.forEach(node => {
    if (node.nodeType === Node.TEXT_NODE && (node.textContent || '').trim() === '') {
      return
    }
    bodyChildren.push(node)
  })

  // Filter out null results
  const elements = bodyChildren
    .map((node, i) => domNodeToReact(node, slots, i))
    .filter(el => el !== null && el !== undefined && el !== false)

  if (elements.length === 0) return null

  if (elements.length === 1) {
    return elements[0]
  }

  // Multiple root elements – wrap them
  if (options.wrapMultipleRoots !== false) {
    return React.createElement(
      'div',
      { className: options.wrapperClassName || 'theme-template-wrapper' },
      ...elements,
    )
  }

  // Return as fragment
  return React.createElement(React.Fragment, null, ...elements)
}

/**
 * Extract slot names from an HTML template string.
 * Useful for discovering which slots a template expects.
 */
export function extractSlotNames(html: string): string[] {
  if (!html) return []
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  const slots = new Set<string>()
  doc.querySelectorAll('[data-slot]').forEach(el => {
    const name = el.getAttribute('data-slot')
    if (name) slots.add(name)
  })
  return Array.from(slots)
}

/**
 * Check if an HTML template has a specific slot.
 */
export function templateHasSlot(html: string, slotName: string): boolean {
  if (!html) return false
  return html.includes(`data-slot="${slotName}"`)
}
