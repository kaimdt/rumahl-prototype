/**
 * IORA Central Configuration Module
 *
 * In IORA OS there are NO .env files. All configuration lives in the
 * Global Config system (settings table in the database, accessible via
 * GET/PUT /api/admin/settings).
 *
 * This module provides a simple getter/setter pattern that works everywhere:
 * - React components (via useBackendUrl / useAssistUrl hooks)
 * - Non-React code (via getBackendUrl / getAssistUrl functions)
 * - Initial bootstrap (falls back to Vite env vars for dev convenience)
 *
 * The GlobalConfigProvider calls setBackendUrl/setAssistUrl after fetching
 * the live config from the backend on app startup.
 */

// ── Bootstrap: Vite env vars are ONLY for local development ──────────
// In production (IORA OS), the frontend is served from the same origin
// as the backend, so relative URLs work and these will be empty strings.

const DEV_BACKEND_URL = import.meta.env.VITE_BACKEND_URL || ''
const DEV_ASSIST_URL = import.meta.env.VITE_IORA_ASSIST_URL || 'http://localhost:8092'

let _backendUrl = DEV_BACKEND_URL
let _assistUrl = DEV_ASSIST_URL

/** Returns the current backend URL. Safe to call from anywhere. */
export function getBackendUrl(): string {
  return _backendUrl
}

/** Returns the current assist/AI URL. Safe to call from anywhere. */
export function getAssistUrl(): string {
  return _assistUrl
}

/** Called by GlobalConfigProvider after fetching live config. */
export function setBackendUrl(url: string): void {
  if (url && url !== _backendUrl) {
    _backendUrl = url
  }
}

/** Called by GlobalConfigProvider after fetching live config. */
export function setAssistUrl(url: string): void {
  if (url && url !== _assistUrl) {
    _assistUrl = url
  }
}
