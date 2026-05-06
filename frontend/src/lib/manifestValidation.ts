/**
 * Manifest validation utilities for ZIP upload components.
 *
 * Validates manifest.json content before submitting to the API.
 * Shows clear, German-language error messages for all three types
 * (Themes, Apps, Plugins).
 */

import { authFetch } from '@/lib/authHelpers'

// ─── Types ────────────────────────────────────────────────────────────

export interface ValidationIssue {
  severity: 'error' | 'warning'
  field: string
  message: string
  suggestion?: string
}

export interface ValidationResult {
  valid: boolean
  manifest_type: string
  manifest_id?: string
  manifest_name?: string
  issues: ValidationIssue[]
}

// ─── API Validation ───────────────────────────────────────────────────

/**
 * Send a manifest JSON to the backend for validation.
 * Returns detailed errors and suggestions.
 */
export async function validateManifest(
  manifest: Record<string, unknown>,
): Promise<ValidationResult> {
  const res = await authFetch('/api/themes/validate-manifest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(manifest),
  })

  if (!res.ok) {
    // API returned a validation error response
    const data = await res.json().catch(() => null)
    if (data) return data as ValidationResult
    return {
      valid: false,
      manifest_type: 'unknown',
      issues: [{
        severity: 'error',
        field: 'manifest',
        message: `Server-Fehler: HTTP ${res.status}`,
      }],
    }
  }

  return res.json()
}

// ─── Client-side Quick Validation ─────────────────────────────────────

/**
 * Quick client-side validation before sending to API.
 * Catches the most common issues immediately.
 */
export function quickValidateManifest(manifest: Record<string, unknown>): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  // Check if it's valid JSON object
  if (!manifest || typeof manifest !== 'object') {
    issues.push({
      severity: 'error',
      field: 'manifest',
      message: 'Die manifest.json ist kein gültiges JSON-Objekt.',
      suggestion: 'Stelle sicher, dass die Datei mit { beginnt und mit } endet.',
    })
    return issues
  }

  // Check for wrapped theme (has "theme" key)
  const isWrappedTheme = 'theme' in manifest && typeof manifest.theme === 'object'

  // Resolve actual manifest data
  const m = isWrappedTheme ? (manifest.theme as Record<string, unknown>) : manifest

  // Required fields for all types
  if (!m.id || typeof m.id !== 'string') {
    issues.push({
      severity: 'error',
      field: 'id',
      message: 'Die ID fehlt oder ist ungültig.',
      suggestion: 'Füge "id": "meine-app" hinzu (nur Kleinbuchstaben und Bindestriche).',
    })
  } else if ((m.id as string).includes(' ')) {
    issues.push({
      severity: 'error',
      field: 'id',
      message: `Die ID "${m.id}" enthält Leerzeichen.`,
      suggestion: `Verwende "${(m.id as string).replace(/\s+/g, '-')}".`,
    })
  }

  if (!m.name || typeof m.name !== 'string') {
    issues.push({
      severity: 'error',
      field: 'name',
      message: 'Der Name fehlt.',
      suggestion: 'Füge "name": "Meine App" hinzu.',
    })
  }

  if (!m.version || typeof m.version !== 'string') {
    issues.push({
      severity: 'error',
      field: 'version',
      message: 'Die Version fehlt.',
      suggestion: 'Füge "version": "1.0.0" hinzu.',
    })
  }

  // Theme-specific checks
  const isTheme = m.css_variables || (isWrappedTheme && (manifest.theme as Record<string, unknown>)?.css_variables)

  if (isTheme) {
    const vars = (m.css_variables || (isWrappedTheme ? (manifest.theme as Record<string, unknown>)?.css_variables : {})) as Record<string, unknown>
    if (!vars || Object.keys(vars).length === 0) {
      issues.push({
        severity: 'error',
        field: 'css_variables',
        message: 'Ein Theme muss CSS-Variablen definieren.',
        suggestion: 'Füge "css_variables": { "background": "#000", "foreground": "#fff", ... } hinzu.',
      })
    } else {
      const required = ['background', 'foreground', 'card', 'accent', 'border']
      const missing = required.filter(k => !(k in vars))
      if (missing.length > 0) {
        issues.push({
          severity: 'warning',
          field: 'css_variables',
          message: `Mindest-Farbwerte fehlen: ${missing.map(k => `--${k}`).join(', ')}`,
          suggestion: `Füge fehlende Variablen hinzu, z.B. "${missing[0]}": "#xxx".`,
        })
      }
    }
  }

  // App/Plugin-specific checks
  if (m.type === 'plugin' && !m.plugin_type) {
    issues.push({
      severity: 'warning',
      field: 'plugin_type',
      message: 'Plugin-Typ fehlt (z.B. "widget", "theme", "automation").',
      suggestion: 'Füge "plugin_type": "widget" hinzu.',
    })
  }

  return issues
}

// ─── UI Helpers ───────────────────────────────────────────────────────

/**
 * Format validation issues for display in toast or alert.
 */
export function formatValidationIssues(issues: ValidationIssue[]): string {
  if (issues.length === 0) return 'Keine Probleme gefunden.'

  const errors = issues.filter(i => i.severity === 'error')
  const warnings = issues.filter(i => i.severity === 'warning')

  const lines: string[] = []

  if (errors.length > 0) {
    lines.push(`❌ ${errors.length} Fehler gefunden:`)
    errors.forEach(e => {
      lines.push(`  • ${e.field}: ${e.message}`)
      if (e.suggestion) lines.push(`    → ${e.suggestion}`)
    })
  }

  if (warnings.length > 0) {
    if (errors.length > 0) lines.push('')
    lines.push(`⚠️ ${warnings.length} Warnungen:`)
    warnings.forEach(w => {
      lines.push(`  • ${w.field}: ${w.message}`)
    })
  }

  return lines.join('\n')
}
