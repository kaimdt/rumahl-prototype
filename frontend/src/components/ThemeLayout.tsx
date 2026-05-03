/**
 * ThemeLayout – Renders page structure using theme HTML templates.
 *
 * Themes can provide a `layout` HTML template that defines the entire
 * page structure. The template uses `data-slot="name"` attributes to
 * mark where React components should be mounted.
 *
 * Standard slot names:
 * - `header`     – Header bar (clock, status, title)
 * - `navigation` – Main navigation component
 * - `content`    – Main content area (page widgets, settings, etc.)
 * - `sidebar`    – Optional sidebar
 * - `status-bar` – Status/emergency bar
 * - `toast`      – Toast notification area
 * - `assistant`  – AI Assistant widget
 * - `background` – Background layer
 *
 * If no theme template is available, the default built-in layout is used
 * (which renders children directly with the existing App.tsx structure).
 */

import React, { useMemo } from 'react'
import { useThemeTemplate } from '@/hooks/useThemeTemplate'
import { renderTemplate, extractSlotNames } from '@/lib/templateRenderer'

export interface ThemeLayoutSlots {
  /** Header content: clock, status indicators, title */
  header?: React.ReactNode
  /** Main navigation component */
  navigation?: React.ReactNode
  /** Main content area */
  content?: React.ReactNode
  /** Optional sidebar panel */
  sidebar?: React.ReactNode
  /** Status/notification/emergency bar */
  statusBar?: React.ReactNode
  /** Toast/sonner notifications */
  toast?: React.ReactNode
  /** AI assistant component */
  assistant?: React.ReactNode
  /** Background layer (dynamic background, overlay) */
  background?: React.ReactNode
  /** Any custom slot name defined by the theme */
  [customSlot: string]: React.ReactNode | undefined
}

export interface ThemeLayoutProps {
  /** Slot content to render */
  slots: ThemeLayoutSlots
  /** Children rendered when no theme template is available (default layout) */
  children?: React.ReactNode
  /** CSS class added to the wrapper */
  className?: string
}

/**
 * Renders content using the theme's layout template, or falls back to
 * the default built-in layout (renders children directly).
 */
export function ThemeLayout({ slots, children, className }: ThemeLayoutProps) {
  const { template, loading } = useThemeTemplate('layout')

  const rendered = useMemo(() => {
    if (loading) {
      // Still loading template – show nothing while loading
      return null
    }

    if (template) {
      // Theme provides a layout template – render it with slots
      return renderTemplate(template, slots, {
        wrapMultipleRoots: true,
        wrapperClassName: className || 'theme-layout-wrapper',
      })
    }

    // No theme template – fall back to default layout (children)
    return null
  }, [template, loading, slots, className])

  // If we have a theme layout, render it
  if (rendered !== null) {
    return <>{rendered}</>
  }

  // No theme layout – fall back to default (children)
  return <>{children}</>
}

/**
 * Information about the current theme's layout template.
 */
export interface ThemeLayoutInfo {
  /** Whether a custom layout template is active */
  hasCustomLayout: boolean
  /** Whether the template is still loading */
  isLoading: boolean
  /** Available slot names in the template */
  slots: string[]
}

/**
 * Hook to get information about the active theme layout.
 * Components can use this to adapt their behavior (e.g., navigation
 * knows it's rendered via slot and can adjust styling).
 */
export function useThemeLayoutInfo(): ThemeLayoutInfo {
  const { template, loading } = useThemeTemplate('layout')

  const slots = useMemo(() => {
    if (!template) return []
    return extractSlotNames(template)
  }, [template])

  return {
    hasCustomLayout: !!template && !loading,
    isLoading: loading,
    slots,
  }
}
