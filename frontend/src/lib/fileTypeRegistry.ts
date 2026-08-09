/**
 * File-type registry: maps MIME types / extensions to icons (file_*.png)
 * and — optionally — to an app that "reserves" the type.
 *
 * When an app reserves a type, the explorer shows the app's icon for those
 * files and offers "Open with <app>" instead of the generic file icon.
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

export function registerFileTypeApp(extension: string, app: FileTypeApp) {
  reservedApps.set(extension.toLowerCase().replace(/^\./, ''), app)
}

export function fileTypeAppFor(mime: string | null, name: string): FileTypeApp | undefined {
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
