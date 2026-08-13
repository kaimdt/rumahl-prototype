/**
 * File-type registry: maps MIME types / extensions to icons (file_*.png)
 * and — optionally — to an app that "reserves" the type.
 *
 * When an app reserves a type, the explorer shows the app's icon for those
 * files and offers "Open with <app>" instead of the generic file icon.
 *
 * Package 0 (Feature 6): per-user **default apps** — a type category can be
 * bound to a registered app; `fileTypeAppFor` prefers that default over the
 * reserved-app fallback. The Settings → System → Default apps UI configures
 * the bindings.
 */

export interface FileTypeApp {
  /** App id (launcher pageId or openUrl-based app). */
  appId: string
  /** App display name. */
  appName: string
  /** App icon (public/icons or data URL). */
  appIcon: string
  /** Opens the file with this app (receives the download URL). */
  open: (file: { id: string; name: string }) => void
}

interface FileTypeRule {
  match: (mime: string | null, name: string) => boolean
  icon: string
  /** Optional app that reserves this type. */
  app?: FileTypeApp
}

/** Apps may register/reserve file types at runtime (e.g. a future Images app). */
const reservedApps = new Map<string, FileTypeApp>()
/** Registered apps by app id — the pool the default-app UI can pick from. */
const appsById = new Map<string, FileTypeApp>()

/** Type categories used by the default-app settings and file resolution. */
export interface FileTypeCategory {
  key: string
  labelKey: string
  match: (mime: string | null, name: string) => boolean
}

export const FILE_TYPE_CATEGORIES: FileTypeCategory[] = [
  { key: 'image', labelKey: 'defaultApps.types.image', match: (m) => Boolean(m?.startsWith('image/')) },
  {
    key: 'video', labelKey: 'defaultApps.types.video',
    match: (m, n) => Boolean(m?.startsWith('video/')) || /\.(mp4|mkv|mov|avi|webm|m4v)$/i.test(n),
  },
  {
    key: 'audio', labelKey: 'defaultApps.types.audio',
    match: (m, n) => Boolean(m?.startsWith('audio/')) || /\.(mp3|wav|flac|ogg|m4a|aac)$/i.test(n),
  },
  { key: 'pdf', labelKey: 'defaultApps.types.pdf', match: (m, n) => m === 'application/pdf' || /\.pdf$/i.test(n) },
  {
    key: 'text', labelKey: 'defaultApps.types.text',
    match: (_m, n) => /\.(txt|md|docx?|rtf|odt)$/i.test(n),
  },
  { key: 'table', labelKey: 'defaultApps.types.table', match: (_m, n) => /\.(xlsx?|csv|ods)$/i.test(n) },
  { key: 'presentation', labelKey: 'defaultApps.types.presentation', match: (_m, n) => /\.(pptx?|odp|key)$/i.test(n) },
  { key: 'archive', labelKey: 'defaultApps.types.archive', match: (_m, n) => /\.(zip|tar|gz|7z|rar)$/i.test(n) },
]

// ── Default-app persistence (per user, localStorage) ──────────────────────

const DEFAULT_APPS_KEY = 'iora-default-apps'

function readDefaults(): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(DEFAULT_APPS_KEY) || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeDefaults(defaults: Record<string, string>) {
  try {
    localStorage.setItem(DEFAULT_APPS_KEY, JSON.stringify(defaults))
  } catch {
    // storage full — non-critical
  }
}

/** Bind a type category to an app id (or null to clear the binding). */
export function setDefaultAppForType(categoryKey: string, appId: string | null) {
  const defaults = readDefaults()
  if (appId) defaults[categoryKey] = appId
  else delete defaults[categoryKey]
  writeDefaults(defaults)
}

/** The configured default app id for a category, if any. */
export function getDefaultAppForType(categoryKey: string): string | null {
  return readDefaults()[categoryKey] || null
}

/** Category key for a file (first matching category). */
export function categoryForFile(mime: string | null, name: string): FileTypeCategory | undefined {
  return FILE_TYPE_CATEGORIES.find((c) => c.match(mime, name))
}

/** Registered apps that can handle a category (for the settings dropdown). */
export function appsForCategory(category: FileTypeCategory): FileTypeApp[] {
  const apps = new Map<string, FileTypeApp>()
  for (const [ext, app] of reservedApps) {
    if (category.match(null, `sample.${ext}`)) apps.set(app.appId, app)
  }
  return [...apps.values()]
}

export function registerFileTypeApp(extension: string, app: FileTypeApp) {
  const ext = extension.toLowerCase().replace(/^\./, '')
  reservedApps.set(ext, app)
  appsById.set(app.appId, app)
}

// Statically register the built-in Bilder (Images) app so the default-app
// picker always offers it, even before the lazy OsImagesApp module loads.
// OsImagesApp re-registers the same extensions at runtime (identical payload).
{
  const imagesApp: FileTypeApp = {
    appId: 'os-images',
    appName: 'Bilder',
    appIcon: '/icons/Images.png',
    open: (file) => {
      window.dispatchEvent(new CustomEvent('iora:open-image', { detail: file }))
      window.dispatchEvent(new CustomEvent('iora:navigate', { detail: { pageId: 'os-images' } }))
    },
  }
  const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'heic', 'avif']
  for (const ext of IMAGE_EXTENSIONS) {
    reservedApps.set(ext, imagesApp)
  }
  appsById.set(imagesApp.appId, imagesApp)
}

/** Resolve the app that should open a file: configured default first, then
 * the reserved-app fallback. */
export function fileTypeAppFor(mime: string | null, name: string): FileTypeApp | undefined {
  const category = categoryForFile(mime, name)
  if (category) {
    const defaultId = getDefaultAppForType(category.key)
    if (defaultId) {
      const app = appsById.get(defaultId)
      if (app) return app
    }
  }
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return reservedApps.get(ext)
}

const RULES: FileTypeRule[] = [
  { match: (m, _n) => Boolean(m?.startsWith('image/')), icon: '/icons/file_image.png' },
  { match: (m, n) => Boolean(m?.startsWith('audio/')) || /\.(mp3|wav|flac|ogg|m4a|aac)$/i.test(n), icon: '/icons/file_audio.png' },
  { match: (m, n) => m === 'application/pdf' || /\.pdf$/i.test(n), icon: '/icons/file_pdf.png' },
  { match: (_m, n) => /\.(docx?|rtf|odt|txt)$/i.test(n), icon: '/icons/file_word.png' },
  { match: (_m, n) => /\.(xlsx?|csv|ods)$/i.test(n), icon: '/icons/file_table.png' },
  { match: (_m, n) => /\.(pptx?|odp|key)$/i.test(n), icon: '/icons/file_presentation.png' },
  { match: (_m, n) => /\.(exe|msi|sh|bin|appimage|deb|rpm)$/i.test(n), icon: '/icons/file_executeable.png' },
  { match: (_m, n) => /\.(zip|tar|gz|7z|rar)$/i.test(n), icon: '/icons/folder.png' },
]

/**
 * Resolve the icon for a file: reserved app icon wins, then the type rules,
 * then the generic file.png.
 */
export function fileTypeIcon(mime: string | null, name: string): string {
  const app = fileTypeAppFor(mime, name)
  if (app) return app.appIcon
  for (const rule of RULES) {
    if (rule.match(mime, name)) return rule.icon
  }
  return '/icons/file.png'
}
