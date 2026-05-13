/// <reference types="vite/client" />

// ─── Tauri / platform-specific declarations ────────────────────────────

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown
  }
}

declare namespace React {
  interface CSSProperties {
    WebkitAppRegion?: 'drag' | 'no-drag'
  }
}

interface ImportMetaEnv {
  readonly VITE_BACKEND_URL?: string
  readonly MODE: string
  readonly DEV: boolean
  readonly PROD: boolean
  readonly SSR: boolean
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
