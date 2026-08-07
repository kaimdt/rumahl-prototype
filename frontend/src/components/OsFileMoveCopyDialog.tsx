import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, ArrowSquareOut, CaretRight, Copy, Folder, X } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { authFetch } from '@/lib/authHelpers'

interface FolderEntry {
  id: string
  original_name: string
  is_folder: boolean
}

interface Breadcrumb {
  id: string
  name: string
}

interface Props {
  entry: { id: string; original_name: string; is_folder: boolean }
  mode: 'move' | 'copy'
  onCancel: () => void
  onComplete: () => void
}

export function OsFileMoveCopyDialog({ entry, mode, onCancel, onComplete }: Props) {
  const { t } = useTranslation()
  const [folderId, setFolderId] = useState<string | null>(null)
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([])
  const [folders, setFolders] = useState<FolderEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

  const isFolderSource = entry.is_folder

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = folderId ? `?folder_id=${encodeURIComponent(folderId)}` : ''
      const response = await authFetch(`/api/files/${params}`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json() as { files?: FolderEntry[]; folder_path?: Breadcrumb[] }
      // Only folders are valid destinations
      setFolders((data.files || []).filter((item) => item.is_folder))
      setBreadcrumbs(data.folder_path || [])
    } catch {
      setError(t('os.systemApps.unavailable'))
    } finally {
      setLoading(false)
    }
  }, [folderId, t])

  useEffect(() => { void load() }, [load])

  const openFolder = (target: FolderEntry) => {
    // Moving/copying a folder into itself or one of its descendants would create a cycle
    if (isFolderSource && target.id === entry.id) return
    setFolderId(target.id)
  }

  const goBack = () => {
    const parent = breadcrumbs.length > 1 ? breadcrumbs[breadcrumbs.length - 2].id : null
    setFolderId(parent)
  }

  const submit = async () => {
    setWorking(true)
    setError('')
    try {
      const endpoint = mode === 'move' ? `/api/files/${entry.id}/move` : `/api/files/${entry.id}/copy`
      const response = await authFetch(endpoint, {
        method: mode === 'move' ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_folder_id: folderId }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      onComplete()
    } catch {
      setError(mode === 'move' ? t('os.systemApps.moveFailed') : t('os.systemApps.copyFailed'))
      setWorking(false)
    }
  }

  const currentPath = breadcrumbs.length
    ? breadcrumbs.map((crumb) => crumb.name).join(' / ')
    : t('os.systemApps.myCloud')

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="glass-card flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-3xl">
        <header className="flex items-start gap-3 border-b border-foreground/10 p-5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent/12 text-accent">
            {mode === 'move' ? <ArrowSquareOut size={22} weight="duotone" /> : <Copy size={22} weight="duotone" />}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold">{mode === 'move' ? t('os.systemApps.moveTo') : t('os.systemApps.copyTo')}</h2>
            <p className="mt-0.5 truncate text-xs text-foreground/50">{entry.original_name}</p>
          </div>
          <button type="button" onClick={onCancel} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-foreground/10" aria-label={t('common.close')}><X size={19} /></button>
        </header>

        <div className="flex items-center gap-1 overflow-x-auto border-b border-foreground/8 px-4 py-3 text-xs">
          <button type="button" onClick={() => setFolderId(null)} className="shrink-0 rounded-lg px-2 py-1 hover:bg-foreground/8">{t('os.systemApps.myCloud')}</button>
          {breadcrumbs.map((crumb) => <span key={crumb.id} className="flex shrink-0 items-center gap-1"><CaretRight size={12} className="text-foreground/30" /><button type="button" onClick={() => setFolderId(crumb.id)} className="rounded-lg px-2 py-1 hover:bg-foreground/8">{crumb.name}</button></span>)}
        </div>

        <div className="min-h-52 flex-1 overflow-y-auto p-3 sm:p-4">
          {error && <div className="mb-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>}
          {folderId && <button type="button" onClick={goBack} className="mb-2 flex min-h-11 w-full items-center gap-3 rounded-2xl px-3 text-sm text-foreground/60 hover:bg-foreground/7"><ArrowLeft size={18} />{t('os.systemApps.parentFolder')}</button>}
          {loading ? <p className="p-8 text-center text-sm text-foreground/40">{t('common.loading')}</p> : folders.length === 0 ? <p className="p-8 text-center text-sm text-foreground/40">{t('os.systemApps.noSubfolders')}</p> : (
            <div className="grid gap-2 sm:grid-cols-2">
              {folders.map((target) => {
                const blocked = isFolderSource && target.id === entry.id
                return <button key={target.id} type="button" disabled={blocked} onClick={() => openFolder(target)} title={blocked ? t('os.systemApps.sourceFolderDisabled') : undefined} className={`flex min-h-14 items-center gap-3 rounded-2xl border p-3 text-left ${blocked ? 'cursor-not-allowed border-foreground/6 bg-foreground/[0.02] opacity-45' : 'border-foreground/8 bg-foreground/[0.035] hover:bg-foreground/7'}`}>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/12 text-amber-300"><Folder size={21} weight="duotone" /></span>
                  <span className="min-w-0 flex-1"><strong className="block truncate text-sm font-medium">{target.original_name}</strong></span>
                  <CaretRight size={16} className="text-foreground/30" />
                </button>
              })}
            </div>
          )}
        </div>

        <footer className="flex flex-col gap-3 border-t border-foreground/10 p-4 sm:flex-row sm:items-center">
          <p className="min-w-0 flex-1 truncate text-xs text-foreground/48"><span className="font-medium">{t('os.systemApps.targetFolder')}:</span> {currentPath}</p>
          <div className="flex gap-2">
            <button type="button" onClick={onCancel} className="min-h-11 flex-1 rounded-xl bg-foreground/7 px-4 text-sm sm:flex-none">{t('common.cancel')}</button>
            <button type="button" disabled={working} onClick={() => void submit()} className="min-h-11 flex-1 rounded-xl bg-accent px-5 text-sm font-semibold text-white disabled:opacity-40 sm:flex-none">{working ? t('os.systemApps.processing') : mode === 'move' ? t('os.systemApps.moveHere') : t('os.systemApps.copyHere')}</button>
          </div>
        </footer>
      </div>
    </div>
  )
}
