/**
 * Smart value formatting for HA entity states.
 * Detects ISO date strings and formats them human-readable in local timezone.
 */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

/** Format an ISO date string to human-readable German locale */
export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso

  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86400000)

  let dayPart: string
  if (diffDays === 0) dayPart = 'Heute'
  else if (diffDays === 1) dayPart = 'Morgen'
  else if (diffDays === -1) dayPart = 'Gestern'
  else {
    dayPart = d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' })
  }

  const timePart = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  return `${dayPart}, ${timePart}`
}

/** Check if a string looks like an ISO datetime */
export function isIsoDateTime(value: string): boolean {
  return ISO_DATE_RE.test(value)
}

/**
 * Format a sensor value for display.
 * - ISO dates → human-readable
 * - Long strings → truncated with tooltip
 * - Numbers → formatted
 */
export function formatSensorValue(value: string, unit?: string): string {
  if (!value || value === 'unavailable' || value === 'unknown') return value

  // ISO date detection
  if (isIsoDateTime(value)) {
    return formatDateTime(value)
  }

  // Numeric with unit
  if (unit) {
    const num = parseFloat(value)
    if (!isNaN(num)) {
      return `${num.toLocaleString('de-DE', { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ''}`
    }
  }

  return value
}
