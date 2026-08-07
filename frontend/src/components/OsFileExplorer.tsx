import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ArrowSquareOut,
  CaretDown,
  CaretRight,
  Copy,
  DownloadSimple,
  File,
  FileImage,
  FileVideo,
  Folder,
  FolderOpen,
  GridFour,
  House,
  ListBullets,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  SortAscending,
  Trash,
  UploadSimple,
  X,
} from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { authFetch } from '@/lib/authHelpers'
import { useOsPermissions } from '@/hooks/useOsPermissions'
import { OsFileMoveCopyDialog } from './OsFileMoveCopyDialog'

interface FileEntry {
  id: string
  original_name: string
  size_bytes: number
  mime_type: string | null
  is_folder: boolean
  updated_at: string
}

interface Breadcrumb { id: string; name: string }
interface Quota { quota_bytes: number; used_bytes: number; available_bytes: number; usage_percent: number }
type ViewMode = 'grid' | 'list'
type SortMode = 'name' | 'updated' | 'size'
type Location = { folderId: string | null; breadcrumbs: Breadcrumb[] }

function formatBytes(value = 0) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1 }
  return `${size.toFixed(unit ? 1 : 0)} ${units[unit]}`
}

function fileIcon(entry: FileEntry, size: number) {
  if (entry.is_folder) return <FolderOpen size={size} weight="duotone" />
  if (entry.mime_type?.startsWith('image/')) return <FileImage size={size} weight="duotone" />
  if (entry.mime_type?.startsWith('video/')) return <FileVideo size={size} weight="duotone" />
  return <File size={size} weight="duotone" />
}

export function OsFileExplorer() {
  const { t } = useTranslation()
  const { can } = useOsPermissions()
  const [files, setFiles] = useState<FileEntry[]>([])
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([])
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  const [quota, setQuota] = useState<Quota | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [initialLoading, setInitialLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [errorKind, setErrorKind] = useState<'refresh' | 'operation'>('refresh')
  const [viewMode, setViewMode] = useState<ViewMode>(() => localStorage.getItem('iora-files-view') === 'list' ? 'list' : 'grid')
  const [sortMode, setSortMode] = useState<SortMode>('name')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [history, setHistory] = useState<Location[]>([{ folderId: null, breadcrumbs: [] }])
  const [historyIndex, setHistoryIndex] = useState(0)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [renameEntry, setRenameEntry] = useState<FileEntry | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [contextEntry, setContextEntry] = useState<FileEntry | null>(null)
  const [moveCopyEntry, setMoveCopyEntry] = useState<FileEntry | null>(null)
  const [moveCopyMode, setMoveCopyMode] = useState<'move' | 'copy' | null>(null)
  const deviceInput = useRef<HTMLInputElement>(null)
  const requestRef = useRef(0)
  const hasLoadedRef = useRef(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  const load = useCallback(async (background = false) => {
    const request = ++requestRef.current
    if (!hasLoadedRef.current) setInitialLoading(true)
    else if (background) setRefreshing(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (currentFolderId) params.set('folder_id', currentFolderId)
      if (search) params.set('search', search)
      const [filesResponse, quotaResponse] = await Promise.all([
        authFetch(`/api/files/?${params.toString()}`),
        authFetch('/api/files/quota'),
      ])
      if (!filesResponse.ok) throw new Error(`HTTP ${filesResponse.status}`)
      const data = await filesResponse.json() as { files?: FileEntry[]; folder_path?: Breadcrumb[] }
      if (request !== requestRef.current) return
      setFiles(data.files || [])
      if (!search) setBreadcrumbs(data.folder_path || [])
      if (quotaResponse.ok) setQuota(await quotaResponse.json())
      setSelected(new Set())
      hasLoadedRef.current = true
    } catch (loadError) {
      if (request !== requestRef.current) return
      setErrorKind('refresh')
      setError(loadError instanceof Error ? loadError.message : 'Unknown service error')
    } finally {
      if (request === requestRef.current) { setInitialLoading(false); setRefreshing(false) }
    }
  }, [currentFolderId, search])

  useEffect(() => { void load(false) }, [load])

  const sortedFiles = useMemo(() => [...files].sort((a, b) => {
    if (a.is_folder !== b.is_folder) return a.is_folder ? -1 : 1
    if (sortMode === 'updated') return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    if (sortMode === 'size') return b.size_bytes - a.size_bytes
    return a.original_name.localeCompare(b.original_name)
  }), [files, sortMode])

  const navigate = (folderId: string | null, path: Breadcrumb[], push = true) => {
    setCurrentFolderId(folderId)
    setBreadcrumbs(path)
    setSearchInput('')
    setSearch('')
    if (push) {
      const next = [...history.slice(0, historyIndex + 1), { folderId, breadcrumbs: path }]
      setHistory(next)
      setHistoryIndex(next.length - 1)
    }
  }

  const moveHistory = (offset: number) => {
    const nextIndex = historyIndex + offset
    const location = history[nextIndex]
    if (!location) return
    setHistoryIndex(nextIndex)
    navigate(location.folderId, location.breadcrumbs, false)
  }

  const openEntry = (entry: FileEntry) => {
    if (entry.is_folder) navigate(entry.id, [...breadcrumbs, { id: entry.id, name: entry.original_name }])
    else toggleSelection(entry.id, false)
  }

  const toggleSelection = (id: string, additive: boolean) => setSelected((current) => {
    const next = additive ? new Set(current) : new Set<string>()
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const uploadFiles = async (selectedFiles: FileList | File[]) => {
    if (!can('os.files.write')) return
    setWorking(true); setError('')
    try {
      for (const file of Array.from(selectedFiles)) {
        const body = new FormData(); body.append('file', file)
        if (currentFolderId) body.append('folder_id', currentFolderId)
        const response = await authFetch('/api/files/upload', { method: 'POST', body })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
      }
      await load(true)
    } catch (operationError) {
      setErrorKind('operation'); setError(operationError instanceof Error ? operationError.message : '')
    } finally { setWorking(false); if (deviceInput.current) deviceInput.current.value = '' }
  }

  const createFolder = async () => {
    if (!newFolderName.trim() || !can('os.files.write')) return
    setWorking(true)
    try {
      const response = await authFetch('/api/files/folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newFolderName.trim(), parent_folder_id: currentFolderId }) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setNewFolderName(''); setNewFolderOpen(false); await load(true)
    } catch (operationError) { setErrorKind('operation'); setError(operationError instanceof Error ? operationError.message : '') }
    finally { setWorking(false) }
  }

  const rename = async () => {
    if (!renameEntry || !renameValue.trim()) return
    setWorking(true)
    try {
      const response = await authFetch(`/api/files/${renameEntry.id}/rename`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ new_name: renameValue.trim() }) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setRenameEntry(null); await load(true)
    } catch (operationError) { setErrorKind('operation'); setError(operationError instanceof Error ? operationError.message : '') }
    finally { setWorking(false) }
  }

  const removeEntries = async (entries: FileEntry[]) => {
    if (!can('os.files.write') || entries.length === 0) return
    setWorking(true)
    try {
      for (const entry of entries) {
        const response = await authFetch(`/api/files/${entry.id}`, { method: 'DELETE' })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
      }
      setContextEntry(null); await load(true)
    } catch (operationError) { setErrorKind('operation'); setError(operationError instanceof Error ? operationError.message : '') }
    finally { setWorking(false) }
  }

  const download = async (entry: FileEntry) => {
    if (entry.is_folder) return
    try {
      const response = await authFetch(`/api/files/${entry.id}/download`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const url = URL.createObjectURL(await response.blob())
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = entry.original_name; anchor.click(); URL.revokeObjectURL(url)
    } catch (operationError) { setErrorKind('operation'); setError(operationError instanceof Error ? operationError.message : '') }
  }

  const selectedEntries = files.filter((entry) => selected.has(entry.id))

  const openMoveCopy = (entry: FileEntry, mode: 'move' | 'copy') => {
    setContextEntry(null)
    setMoveCopyEntry(entry)
    setMoveCopyMode(mode)
  }

  return (
    <section className="ora-app-frame ora-files-app" onClick={() => setContextEntry(null)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (event.dataTransfer.files.length) void uploadFiles(event.dataTransfer.files) }}>
      <header className="ora-app-navbar">
        <div className="flex min-w-0 items-center gap-3"><span className="ora-app-mark ora-app-mark-files"><FolderOpen size={24} weight="duotone" /></span><div><p className="text-lg font-semibold">{t('os.apps.files.name')}</p><p className="hidden text-xs text-foreground/45 sm:block">{t('os.apps.files.description')}</p></div></div>
        <div className="flex items-center gap-2">
          <button type="button" disabled={historyIndex === 0} onClick={() => moveHistory(-1)} className="ora-icon-button" aria-label={t('os.files.back')}><ArrowLeft size={18} /></button>
          <button type="button" disabled={historyIndex >= history.length - 1} onClick={() => moveHistory(1)} className="ora-icon-button" aria-label={t('os.files.forward')}><ArrowRight size={18} /></button>
        </div>
        <label className="ora-toolbar-search"><MagnifyingGlass size={17} /><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder={t('os.systemApps.searchFiles')} /></label>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => { const next = viewMode === 'grid' ? 'list' : 'grid'; setViewMode(next); localStorage.setItem('iora-files-view', next) }} className="ora-icon-button" aria-label={t('os.files.changeView')}>{viewMode === 'grid' ? <ListBullets size={19} /> : <GridFour size={19} />}</button>
          <label className="ora-select-button"><SortAscending size={17} /><select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)} aria-label={t('os.files.sort')}><option value="name">{t('os.files.sortName')}</option><option value="updated">{t('os.files.sortUpdated')}</option><option value="size">{t('os.files.sortSize')}</option></select><CaretDown size={13} /></label>
          {can('os.files.write') && <><button type="button" onClick={() => setNewFolderOpen(true)} className="ora-secondary-button"><Plus size={17} />{t('os.systemApps.newFolder')}</button><button type="button" onClick={() => deviceInput.current?.click()} className="ora-primary-button"><UploadSimple size={17} />{t('os.systemApps.upload')}</button><input ref={deviceInput} type="file" multiple className="hidden" onChange={(event) => { if (event.target.files) void uploadFiles(event.target.files) }} /></>}
        </div>
      </header>

      <div className="ora-files-layout">
        <aside className="ora-files-sidebar">
          <p className="ora-sidebar-label">ORA</p>
          <button type="button" className="ora-sidebar-item is-active" onClick={() => navigate(null, [])}><House size={18} weight="duotone" />{t('os.files.home')}</button>
          <p className="ora-sidebar-label mt-7">{t('os.files.storage')}</p>
          <div className="rounded-2xl bg-foreground/5 p-3"><div className="flex justify-between text-xs"><span>{formatBytes(quota?.used_bytes)}</span><span className="text-foreground/40">{formatBytes(quota?.quota_bytes)}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-foreground/10"><div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.min(quota?.usage_percent || 0, 100)}%` }} /></div></div>
        </aside>

        <main className="min-w-0 flex-1">
          <nav className="ora-breadcrumb" aria-label={t('os.files.breadcrumb')}><button type="button" onClick={() => navigate(null, [])}><House size={16} weight="fill" />{t('os.files.home')}</button>{breadcrumbs.map((item, index) => <span key={item.id} className="flex items-center"><CaretRight size={14} /><button type="button" onClick={() => navigate(item.id, breadcrumbs.slice(0, index + 1))}>{item.name}</button></span>)}</nav>
      {error && <div className="ora-inline-error" role="alert"><div><strong>{errorKind === 'refresh' ? t('os.files.refreshFailed') : t('common.error')}</strong><p>{t(errorKind === 'refresh' ? 'os.files.connectionError' : 'os.files.operationError', { detail: error })}</p></div><button type="button" onClick={() => void load(true)}>{t('common.tryAgain')}</button></div>}
          {selected.size > 0 && <div className="ora-selection-bar"><span>{t('os.files.selected', { count: selected.size })}</span>{selected.size === 1 && !selectedEntries[0]?.is_folder && <button type="button" onClick={() => void download(selectedEntries[0])}><DownloadSimple size={16} />{t('os.systemApps.download')}</button>}{selected.size === 1 && <button type="button" onClick={() => { setRenameEntry(selectedEntries[0]); setRenameValue(selectedEntries[0].original_name) }}><PencilSimple size={16} />{t('os.systemApps.rename')}</button>}{can('os.files.write') && selected.size === 1 && <button type="button" onClick={() => openMoveCopy(selectedEntries[0], 'move')}><ArrowSquareOut size={16} />{t('os.systemApps.moveTo')}</button>}{can('os.files.write') && selected.size === 1 && <button type="button" onClick={() => openMoveCopy(selectedEntries[0], 'copy')}><Copy size={16} />{t('os.systemApps.copyTo')}</button>}{can('os.files.write') && <button type="button" className="text-red-300" onClick={() => void removeEntries(selectedEntries)}><Trash size={16} />{t('common.delete')}</button>}<button type="button" onClick={() => setSelected(new Set())}><X size={16} /></button></div>}

          <div className="ora-files-surface" aria-busy={refreshing}>
            {refreshing && <div className="ora-refresh-indicator" />}
            {initialLoading ? <div className="ora-file-grid">{Array.from({ length: 8 }).map((_, index) => <div key={index} className="ora-file-skeleton" />)}</div> : sortedFiles.length === 0 ? <div className="flex min-h-80 flex-col items-center justify-center text-center"><Folder size={64} weight="duotone" className="text-foreground/20" /><p className="mt-4 font-medium">{t('os.systemApps.noFiles')}</p><p className="mt-1 text-sm text-foreground/40">{t('os.files.emptyHint')}</p></div> : viewMode === 'grid' ? (
              <div className="ora-file-grid">{sortedFiles.map((entry) => <button key={entry.id} type="button" onDoubleClick={() => openEntry(entry)} onClick={(event) => toggleSelection(entry.id, event.ctrlKey || event.metaKey)} onContextMenu={(event) => { event.preventDefault(); setContextEntry(entry); toggleSelection(entry.id, false) }} className={`ora-file-tile ${selected.has(entry.id) ? 'is-selected' : ''}`}><span className={entry.is_folder ? 'ora-folder-icon' : 'ora-document-icon'}>{fileIcon(entry, entry.is_folder ? 70 : 56)}</span><span className="mt-3 w-full truncate text-sm font-medium">{entry.original_name}</span><span className="mt-1 text-xs text-foreground/35">{entry.is_folder ? t('os.systemApps.folder') : formatBytes(entry.size_bytes)}</span></button>)}</div>
            ) : (
              <div className="ora-file-list"><div className="ora-file-list-head"><span>{t('os.files.name')}</span><span>{t('os.files.modified')}</span><span>{t('os.files.size')}</span></div>{sortedFiles.map((entry) => <button key={entry.id} type="button" onDoubleClick={() => openEntry(entry)} onClick={(event) => toggleSelection(entry.id, event.ctrlKey || event.metaKey)} onContextMenu={(event) => { event.preventDefault(); setContextEntry(entry); toggleSelection(entry.id, false) }} className={`ora-file-row ${selected.has(entry.id) ? 'is-selected' : ''}`}><span className="flex min-w-0 items-center gap-3"><span className={entry.is_folder ? 'text-sky-400' : 'text-foreground/55'}>{fileIcon(entry, 28)}</span><span className="truncate">{entry.original_name}</span></span><span>{new Date(entry.updated_at).toLocaleDateString()}</span><span>{entry.is_folder ? '—' : formatBytes(entry.size_bytes)}</span></button>)}</div>
            )}
          </div>
        </main>
      </div>

      {contextEntry && <div className="ora-context-menu" onClick={(event) => event.stopPropagation()}><button type="button" onClick={() => openEntry(contextEntry)}><FolderOpen size={16} />{contextEntry.is_folder ? t('os.files.open') : t('os.files.select')}</button>{!contextEntry.is_folder && <button type="button" onClick={() => void download(contextEntry)}><DownloadSimple size={16} />{t('os.systemApps.download')}</button>}<button type="button" onClick={() => { setRenameEntry(contextEntry); setRenameValue(contextEntry.original_name); setContextEntry(null) }}><PencilSimple size={16} />{t('os.systemApps.rename')}</button>{can('os.files.write') && <button type="button" onClick={() => openMoveCopy(contextEntry, 'move')}><ArrowSquareOut size={16} />{t('os.systemApps.moveTo')}</button>}{can('os.files.write') && <button type="button" onClick={() => openMoveCopy(contextEntry, 'copy')}><Copy size={16} />{t('os.systemApps.copyTo')}</button>}{can('os.files.write') && <button type="button" className="text-red-300" onClick={() => void removeEntries([contextEntry])}><Trash size={16} />{t('common.delete')}</button>}</div>}
      {working && <div className="ora-working-pill">{t('os.systemApps.processing')}</div>}
      {newFolderOpen && <Modal title={t('os.systemApps.newFolder')} onClose={() => setNewFolderOpen(false)}><input autoFocus value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void createFolder() }} placeholder={t('os.systemApps.folderName')} className="ora-modal-input" /><div className="ora-modal-actions"><button type="button" onClick={() => setNewFolderOpen(false)}>{t('common.cancel')}</button><button type="button" disabled={!newFolderName.trim() || working} onClick={() => void createFolder()} className="ora-primary-button">{t('common.create')}</button></div></Modal>}
      {moveCopyEntry && moveCopyMode && <OsFileMoveCopyDialog entry={moveCopyEntry} mode={moveCopyMode} onCancel={() => { setMoveCopyEntry(null); setMoveCopyMode(null) }} onComplete={() => { setMoveCopyEntry(null); setMoveCopyMode(null); void load(true) }} />}
      {renameEntry && <Modal title={t('os.systemApps.rename')} onClose={() => setRenameEntry(null)}><input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void rename() }} className="ora-modal-input" /><div className="ora-modal-actions"><button type="button" onClick={() => setRenameEntry(null)}>{t('common.cancel')}</button><button type="button" disabled={!renameValue.trim() || working} onClick={() => void rename()} className="ora-primary-button">{t('common.save')}</button></div></Modal>}
    </section>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 p-4 backdrop-blur-md" onClick={onClose}><div className="ora-modal-card" onClick={(event) => event.stopPropagation()}><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">{title}</h2><button type="button" onClick={onClose} className="ora-icon-button"><X size={18} /></button></div>{children}</div></div>
}
