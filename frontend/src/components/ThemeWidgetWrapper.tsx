/**
 * ThemeWidgetWrapper – Simple wrapper that delegates to ThemeWidgetRenderer
 * when the active theme provides widget templates.
 *
 * This is a thin convenience wrapper that can be used inside RenderWidget
 * to wrap any widget type with minimal code changes.
 *
 * Usage in CustomPageRenderer:
 * ```tsx
 * case 'light':
 *   return entity ? (
 *     <ThemeWidgetWrapper widgetType="light" entity={entity} config={widget.config}
 *       fallback={<LightWidget entity={entity as LightEntity} ... />}
 *     />
 *   ) : <WidgetPlaceholder widget={widget} />
 * ```
 */

import React from 'react'
import { ThemeWidgetRenderer } from './ThemeWidgetRenderer'
import type { EntityState } from '@/lib/types'
import { useTheme } from '@/contexts/ThemeContext'

export interface ThemeWidgetWrapperProps {
  widgetType: string
  entity?: EntityState
  config?: Record<string, unknown>
  allEntities?: EntityState[]
  widgetSize?: { w: number; h: number }
  onUpdate?: () => void
  fallback: React.ReactNode
  className?: string
}

/**
 * Conditionally renders widget content using theme templates or the fallback.
 * Optimized: skips the template lookup if the theme has no widget_templates.
 */
export function ThemeWidgetWrapper({
  widgetType,
  entity,
  config,
  allEntities,
  widgetSize,
  onUpdate,
  fallback,
  className,
}: ThemeWidgetWrapperProps) {
  const { widgetTemplates } = useTheme()

  // Fast path: no widget templates in this theme
  if (!widgetTemplates || widgetTemplates.length === 0) {
    return <>{fallback}</>
  }

  // Check if this specific widget type has a template
  const hasTemplate = widgetTemplates.some(wt => wt.widget_type === widgetType)
  if (!hasTemplate) {
    return <>{fallback}</>
  }

  return (
    <ThemeWidgetRenderer
      widgetType={widgetType}
      entity={entity}
      config={config}
      allEntities={allEntities}
      widgetSize={widgetSize}
      onUpdate={onUpdate}
      fallback={fallback}
      className={className}
    />
  )
}
