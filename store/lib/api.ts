import type { StoreTheme, StoreApp } from './types'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8099'

// ─── Theme API ────────────────────────────────────────────────────────

export async function fetchThemes(params?: {
  search?: string
  category?: string
  sort?: string
  limit?: number
  offset?: number
}): Promise<{ themes: StoreTheme[]; total: number }> {
  const searchParams = new URLSearchParams()
  if (params?.search) searchParams.set('q', params.search)
  if (params?.category && params.category !== 'Alle') searchParams.set('category', params.category)
  if (params?.sort) searchParams.set('sort', params.sort)
  if (params?.limit) searchParams.set('limit', String(params.limit))
  if (params?.offset) searchParams.set('offset', String(params.offset))

  const res = await fetch(`${API_BASE}/api/themes?${searchParams}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function fetchTheme(id: string): Promise<StoreTheme> {
  const res = await fetch(`${API_BASE}/api/themes/${id}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export function getThemeDownloadUrl(id: string): string {
  return `${API_BASE}/api/themes/${id}/download`
}

export function getThemePreviewUrl(id: string): string {
  return `${API_BASE}/api/themes/${id}/preview`
}

// ─── App API ──────────────────────────────────────────────────────────

export async function fetchApps(params?: {
  search?: string
  category?: string
  sort?: string
  limit?: number
  offset?: number
}): Promise<{ apps: StoreApp[]; total: number }> {
  const searchParams = new URLSearchParams()
  if (params?.search) searchParams.set('q', params.search)
  if (params?.category && params.category !== 'Alle') searchParams.set('category', params.category)
  if (params?.sort) searchParams.set('sort', params.sort)
  if (params?.limit) searchParams.set('limit', String(params.limit))
  if (params?.offset) searchParams.set('offset', String(params.offset))

  const res = await fetch(`${API_BASE}/api/apps?${searchParams}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function fetchApp(id: string): Promise<StoreApp> {
  const res = await fetch(`${API_BASE}/api/apps/${id}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// ─── Install via iframe postMessage ───────────────────────────────────

/**
 * Send an installation request to the parent IORA window.
 * Used when the store is embedded as an iframe in IORA.
 */
export function requestInstall(type: 'theme' | 'app', id: string, name: string) {
  if (window.parent !== window) {
    // We're in an iframe – post message to IORA
    window.parent.postMessage({
      source: 'iora-store',
      action: 'install',
      payload: { type, id, name },
    }, '*')
    return true
  }
  return false
}

/**
 * Listen for messages from the store iframe in IORA.
 * Place this in the parent IORA app's AdminPanel.
 */
export function listenForStoreMessages(
  handlers: {
    onInstall?: (type: 'theme' | 'app', id: string, name: string) => void
    onNavigate?: (path: string) => void
  }
) {
  const handler = (event: MessageEvent) => {
    if (event.data?.source !== 'iora-store') return

    switch (event.data.action) {
      case 'install':
        handlers.onInstall?.(
          event.data.payload.type,
          event.data.payload.id,
          event.data.payload.name,
        )
        break
      case 'navigate':
        handlers.onNavigate?.(event.data.payload.path)
        break
    }
  }

  window.addEventListener('message', handler)
  return () => window.removeEventListener('message', handler)
}
