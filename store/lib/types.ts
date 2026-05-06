// ─── Theme Types ──────────────────────────────────────────────────────

export interface StoreTheme {
  id: string
  name: string
  version: string
  developer: string
  description: string
  icon?: string
  preview_path?: string
  parent_theme?: string
  category?: string
  tags?: string[]
  rating?: number
  rating_count?: number
  downloads?: number
  screenshots?: string[]
  css_variables?: Record<string, string>
  created_at: number
  updated_at: number
}

// ─── App Types ───────────────────────────────────────────────────────

export interface StoreApp {
  id: string
  app_id: string
  name: string
  version: string
  developer: string
  description: string
  icon?: string
  preview_path?: string
  category?: string
  tags?: string[]
  rating?: number
  rating_count?: number
  downloads?: number
  permissions: string[]
  trust_level: string
  created_at: number
  updated_at: number
}

// ─── Categories ──────────────────────────────────────────────────────

export const THEME_CATEGORIES = [
  'Alle', 'Dark', 'Light', 'Steampunk', 'Nature', 'Minimal', 'Retro',
  'Cyberpunk', 'Glass', 'OLED', 'Material', 'Custom',
] as const

export const APP_CATEGORIES = [
  'Alle', 'Widgets', 'Automation', 'Monitoring', 'Media',
  'Security', 'Energy', 'Weather', 'Productivity', 'Entertainment',
] as const

// ─── Filter Types ────────────────────────────────────────────────────

export interface StoreFilters {
  search: string
  category: string
  sort: 'popular' | 'newest' | 'rating' | 'downloads'
}
