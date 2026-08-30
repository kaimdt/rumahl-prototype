import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, CaretRight, Check, File, Folder, FloppyDisk, X } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { authFetch } from '@/lib/authHelpers'

interface FileEntry {
  id: string
  original_name: string
  mime_type: string
  size_bytes: number
  is_folder: boolean
}

interface Breadcrumb {
  id: string
  name: string
}

export interface AppFileOpenResult {
  id: string
  name: string
  mimeType: string
  size: number
  dataBase64: string
}

export interface AppFileSaveRequest {
  name: string
  mimeType?: string
  dataBase64: string
}

interface Props {
  appName: string
  mode: 'open' | 'save'
  saveRequest?: AppFileSaveRequest
  /** MIME filter, e.g. "image/*" — shows a type toggle (All / Matching). */
  accept?: string
  /** Allow selecting several files (checkbox mode). */
  multiple?: boolean
  onCancel: () => void
  onComplete: (result: AppFileOpenResult | AppFileOpenResult[] | { id: string; name: string }) => void
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

function base64ToBytes(value: string) {
  const binary = atob(value.includes(',') ? value.slice(value.indexOf(',') + 1) : value)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

export function OsAppFilePickerDialog({ appName, mode, saveRequest, accept, multiple, onCancel, onComplete }: Props) {
  const { t } = useTranslation()
  const [files, setFiles] = useState<FileEntry[]>([])
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([])
  const [folderId, setFolderId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<FileEntry>>(new Set())
  const [typeFilter, setTypeFilter] = useState<'all' | 'accepted'>('all')
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = folderId ? `?folder_id=${encodeURIComponent(folderId)}` : ''
      const response = await authFetch(`/api/files/${params}`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json() as { files?: FileEntry[]; folder_path?: Breadcrumb[] }
      setFiles(data.files || [])
      setBreadcrumbs(data.folder_path || [])
      setSelected(new Set())
    } catch {
      setError(t('os.filePicker.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [folderId, t])

  useEffect(() => { void load() }, [load])

  const matchesAccept = (entry: FileEntry) => {
    if (!accept || typeFilter === 'all' || entry.is_folder) return true
    const mime = entry.mime_type || ''
    if (accept.endsWith('/*')) return mime.startsWith(accept.slice(0, -1))
    return mime === accept
  }

  const visibleFiles = files.filter(matchesAccept)

  const toggleSelect = (entry: FileEntry) => {
    if (mode !== 'open' || entry.is_folder) return
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(entry)) next.delete(entry)
      else {
        if (!multiple) next.clear()
        next.add(entry)
      }
      return next
    })
  }

  const openFolder = (entry: FileEntry) => {
    if (!entry.is_folder) return
    setFolderId(entry.id)
  }

  const goBack = () => {
    const parent = breadcrumbs.length > 1 ? breadcrumbs[breadcrumbs.length - 2].id : null
    setFolderId(parent)
  }

  const completeOpen = async () => {
    if (selected.size === 0) return
    setWorking(true)
    setError('')
    try {
      const entries = Array.from(selected).filter((entry) => !entry.is_folder)
      const results: AppFileOpenResult[] = []
      for (const entry of entries) {
        const response = await authFetch(`/api/files/${entry.id}/download`)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const bytes = new Uint8Array(await response.arrayBuffer())
        results.push({
          id: entry.id,
          name: entry.original_name,
          mimeType: entry.mime_type || 'application/octet-stream',
          size: entry.size_bytes,
          dataBase64: bytesToBase64(bytes),
        })
      }
      onComplete(multiple ? results : results[0])
    } catch {
      setError(t('os.filePicker.openFailed'))
      setWorking(false)
    }
  }

  const completeSave = async () => {
    if (!saveRequest) return
    setWorking(true)
    setError('')
    try {
      const bytes = base64ToBytes(saveRequest.dataBase64)
      const body = new FormData()
      body.append('file', new Blob([bytes], { type: saveRequest.mimeType || 'application/octet-stream' }), saveRequest.name)
      if (folderId) body.append('folder_id', folderId)
      const response = await authFetch('/api/files/upload', { method: 'POST', body })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const saved = await response.json() as { id: string; original_name?: string }
      onComplete({ id: saved.id, name: saved.original_name || saveRequest.name })
    } catch {
      setError(t('os.filePicker.saveFailed'))
      setWorking(false)
    }
  }

  return (
    <div className="rumahl-file-dialog-backdrop fixed inset-0 z-[140] flex items-center justify-center bg-black/65 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="rumahl-file-picker-title">
      <div className="rumahl-file-dialog flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-4xl border border-white/10 bg-background shadow-2xl sm:rounded-4xl">
        <header className="rumahl-file-dialog-header flex items-start gap-3 border-b border-foreground/10 p-4 sm:p-5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent/12 text-accent">
            {mode === 'open' ? <File size={22} weight="duotone" /> : <FloppyDisk size={22} weight="duotone" />}
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="rumahl-file-picker-title" className="truncate text-lg font-semibold">{mode === 'open' ? t('os.filePicker.openTitle') : t('os.filePicker.saveTitle')}</h2>
            <p className="mt-1 text-xs text-foreground/50">{t('os.filePicker.requestedBy', { app: appName })}</p>
          </div>
          <button type="button" onClick={onCancel} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-foreground/10" aria-label={t('common.close')}><X size={19} /></button>
        </header>

        <div className="flex items-center gap-1 overflow-x-auto border-b border-foreground/8 px-4 py-3 text-xs">
          <button type="button" onClick={() => setFolderId(null)} className="shrink-0 rounded-lg px-2 py-1 hover:bg-foreground/8">{t('os.systemApps.myCloud')}</button>
          {breadcrumbs.map(crumb => <span key={crumb.id} className="flex shrink-0 items-center gap-1"><CaretRight size={12} className="text-foreground/30" /><button type="button" onClick={() => setFolderId(crumb.id)} className="rounded-lg px-2 py-1 hover:bg-foreground/8">{crumb.name}</button></span>)}
        </div>

        <div className="rumahl-file-dialog-content min-h-52 flex-1 overflow-y-auto p-3 sm:p-4">
          {error && <div className="mb-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>}
          {folderId && <button type="button" onClick={goBack} className="mb-2 flex min-h-11 w-full items-center gap-3 rounded-2xl px-3 text-sm text-foreground/60 hover:bg-foreground/7"><ArrowLeft size={18} />{t('os.systemApps.parentFolder')}</button>}
          {loading ? <p className="p-8 text-center text-sm text-foreground/40">{t('common.loading')}</p> : (
            <>
              {accept && (
                <div className="mb-2 flex gap-1.5">
                  {(['all', 'accepted'] as const).map((filter) => (
                    <button key={filter} type="button" onClick={() => setTypeFilter(filter)} className={`rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors ${typeFilter === filter ? 'bg-accent text-white' : 'bg-foreground/6 text-foreground/60 hover:bg-foreground/10'}`}>
                      {filter === 'all' ? t('os.filePicker.allTypes') : t('os.filePicker.acceptedTypes')}
                    </button>
                  ))}
                </div>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                {visibleFiles.map(entry => {
                  const active = selected.has(entry)
                  return <button key={entry.id} type="button" onDoubleClick={() => openFolder(entry)} onClick={() => entry.is_folder ? openFolder(entry) : toggleSelect(entry)} className={`flex min-h-16 items-center gap-3 rounded-2xl border p-3 text-left ${active ? 'border-accent/60 bg-accent/12' : 'border-foreground/8 bg-foreground/[0.035] hover:bg-foreground/7'}`}>
                    <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/12 text-amber-300">{entry.is_folder ? <Folder size={21} weight="duotone" /> : <File size={21} weight="duotone" />}</span>
                    <span className="min-w-0 flex-1"><strong className="block truncate text-sm font-medium">{entry.original_name}</strong><span className="text-[10px] text-foreground/38">{entry.is_folder ? t('os.filePicker.folder') : entry.mime_type}</span></span>
                    {mode === 'open' && !entry.is_folder && (
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${active ? 'border-accent bg-accent text-white' : 'border-foreground/25 text-transparent'}`}><Check size={12} weight="bold" /></span>
                    )}
                    {entry.is_folder && <CaretRight size={16} className="text-foreground/30" />}
                  </button>
                })}
                {visibleFiles.length === 0 && <p className="rumahl-file-empty-state col-span-full p-8 text-center text-sm text-foreground/40">{t('os.filePicker.empty')}</p>}
              </div>
            </>
          )}
        </div>

        <footer className="rumahl-file-dialog-footer flex flex-col gap-3 border-t border-foreground/10 p-4 sm:flex-row sm:items-center">
          <p className="min-w-0 flex-1 truncate text-xs text-foreground/48">{mode === 'save' ? t('os.filePicker.saveAs', { name: saveRequest?.name }) : selected.size > 0 ? (multiple ? t('os.filePicker.selected', { count: selected.size }) : Array.from(selected)[0]?.original_name) : t('os.filePicker.selectFile')}</p>
          <div className="flex gap-2">
            <button type="button" onClick={onCancel} className="min-h-11 flex-1 rounded-xl bg-foreground/7 px-4 text-sm sm:flex-none">{t('common.cancel')}</button>
            <button
              type="button"
              disabled={working || (mode === 'open' && selected.size === 0)}
              onClick={() => void (mode === 'open' ? completeOpen() : completeSave())}
              className="min-h-11 flex-1 rounded-xl bg-accent px-5 text-sm font-semibold text-white disabled:opacity-40 sm:flex-none"
            >
              {working ? t('os.systemApps.processing') : mode === 'open' ? (multiple && selected.size > 0 ? t('os.filePicker.select', { count: selected.size }) : t('os.filePicker.open')) : t('os.filePicker.save')}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
