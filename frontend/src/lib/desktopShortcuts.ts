import { authFetch } from '@/lib/authHelpers'

/** Mime type for desktop app-shortcut entries. */
export const APP_SHORTCUT_MIME = 'application/x-rumahl-app-shortcut'

/** True for a desktop app-shortcut file entry. */
export function isAppShortcutEntry(entry: { mime_type?: string | null }): boolean {
  return entry.mime_type === APP_SHORTCUT_MIME
}

/** Resolve the user's personal Desktop system folder (create on first use). */
export async function resolveDesktopFolder(): Promise<string | null> {
  try {
    const res = await authFetch('/api/files/system-folder?name=Desktop')
    if (!res.ok) return null
    const data = await res.json() as { folder?: { id?: string } }
    return data?.folder?.id ?? null
  } catch {
    return null
  }
}

/** Create an app-shortcut entry in the given folder (e.g. the Desktop). */
export async function createDesktopShortcut(app: { pageId: string; name: string }, parentFolderId: string | null): Promise<boolean> {
  try {
    const res = await authFetch('/api/files/shortcuts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: app.name, app_page_id: app.pageId, parent_folder_id: parentFolderId }),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Delete a shortcut/file entry by id. */
export async function deleteFileEntry(fileId: string): Promise<boolean> {
  try {
    const res = await authFetch(`/api/files/${fileId}`, { method: 'DELETE' })
    return res.ok
  } catch {
    return false
  }
}
