/**
 * useThemeTemplate – Fetches and caches HTML templates from theme assets.
 *
 * Themes can provide HTML templates (via `html_templates` in their manifest)
 * that replace the default page structure. This hook handles fetching,
 * caching, and error handling for those templates.
 *
 * Usage:
 * ```tsx
 * const { template, loading, error } = useThemeTemplate('layout')
 * ```
 */

import { useState, useEffect, useRef } from 'react'
import { useTheme } from '@/contexts/ThemeContext'

/** Cache of fetched template HTML strings across the app. */
const templateCache = new Map<string, string>()

/** Pending fetch promises to avoid duplicate requests. */
const pendingFetches = new Map<string, Promise<string | null>>()

/**
 * Fetch a theme template from a URL and cache the result.
 */
async function fetchTemplate(url: string, signal?: AbortSignal): Promise<string | null> {
  // Return cached result
  if (templateCache.has(url)) {
    return templateCache.get(url)!
  }

  // Return in-flight request
  if (pendingFetches.has(url)) {
    return pendingFetches.get(url)!
  }

  const promise = (async () => {
    try {
      const response = await fetch(url, { signal })
      if (!response.ok) {
        console.warn(`[useThemeTemplate] Failed to fetch template ${url}: ${response.status}`)
        return null
      }
      const html = await response.text()
      templateCache.set(url, html)
      return html
    } catch (err) {
      if ((err as Error).name === 'AbortError') return null
      console.warn(`[useThemeTemplate] Error fetching template ${url}:`, err)
      return null
    } finally {
      pendingFetches.delete(url)
    }
  })()

  pendingFetches.set(url, promise)
  return promise
}

export interface UseThemeTemplateResult {
  /** The fetched HTML template content, or null if not loaded/available */
  template: string | null
  /** Whether the template is currently being fetched */
  loading: boolean
  /** Error message if fetch failed */
  error: string | null
}

/**
 * Hook to fetch and cache a theme HTML template.
 *
 * @param templateName - The template key as defined in theme manifest (e.g., "layout", "card", "widget-light")
 * @returns Template content, loading state, and error
 */
export function useThemeTemplate(templateName: string): UseThemeTemplateResult {
  const { themeResponse } = useTheme()
  const [template, setTemplate] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    // Reset state when template name or theme changes
    setTemplate(null)
    setError(null)

    const templateUrl = themeResponse?.html_templates?.[templateName]
    if (!templateUrl) {
      setLoading(false)
      return
    }

    setLoading(true)

    // Abort any previous fetch
    if (abortRef.current) {
      abortRef.current.abort()
    }
    abortRef.current = new AbortController()

    fetchTemplate(templateUrl, abortRef.current.signal)
      .then(html => {
        if (html !== null) {
          setTemplate(html)
          setError(null)
        } else {
          setTemplate(null)
          setError(`Template "${templateName}" could not be loaded`)
        }
      })
      .catch(err => {
        if ((err as Error).name !== 'AbortError') {
          setError((err as Error).message)
        }
      })
      .finally(() => {
        setLoading(false)
      })

    return () => {
      if (abortRef.current) {
        abortRef.current.abort()
      }
    }
  }, [templateName, themeResponse?.html_templates?.[templateName]])

  return { template, loading, error }
}

/**
 * Get all available template names from the current theme.
 */
export function useAvailableTemplates(): string[] {
  const { themeResponse } = useTheme()
  if (!themeResponse?.html_templates) return []
  return Object.keys(themeResponse.html_templates)
}

/**
 * Check if a specific template is available in the current theme.
 */
export function useHasTemplate(templateName: string): boolean {
  const { themeResponse } = useTheme()
  return !!themeResponse?.html_templates?.[templateName]
}

/**
 * Clear the template cache. Useful when switching themes or during development.
 */
export function clearTemplateCache(): void {
  templateCache.clear()
  pendingFetches.clear()
}
