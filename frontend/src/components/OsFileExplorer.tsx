import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import {
  ArrowLeft,
  ArrowSquareOut,
  CaretRight,
  Cloud,
  Copy,
  DownloadSimple,
  DotsThreeVertical,
  File,
  Folder,
  FolderOpen,
  HardDrive,
  MagnifyingGlass,
  PencilSimple,
  Plus,
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

interface Breadcrumb {
  id: string
  name: string
}

interface Quota {
  quota_bytes: number
  used_bytes: number
  available_bytes: number
  usage_percent: number
}

function formatBytes(value = 0) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size.toFixed(unit ? 1 : 0)} ${units[unit]}`
}

export function OsFileExplorer() {
  const { t } = useTranslation()
  const { can } = useOsPermissions()
  const [files, setFiles] = useState<FileEntry[]>([])
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([])
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  const [quota, setQuota] = useState<Quota | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [renameEntry, setRenameEntry] = useState<FileEntry | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false)
  const [menuEntry, setMenuEntry] = useState<FileEntry | null>(null)
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null)
  const [moveCopyEntry, setMoveCopyEntry] = useState<FileEntry | null>(null)
  const [moveCopyMode, setMoveCopyMode] = useState<'move' | 'copy' | null>(null)
  const deviceInput = useRef<HTMLInputElement>(null)

  // TODO(kiosk): Replace this with the future device-capability API. Kiosk devices
  // must never expose the browser file picker.
  const isKioskDevice = false

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (currentFolderId) params.set('folder_id', currentFolderId)
      if (search.trim()) params.set('search', search.trim())
      const [filesResponse, quotaResponse] = await Promise.all([
        authFetch(`/api/files/?${params.toString()}`),
        authFetch('/api/files/quota'),
      ])
      if (!filesResponse.ok) throw new Error(`HTTP ${filesResponse.status}`)
      const data = await filesResponse.json() as { files?: FileEntry[]; folder_path?: Breadcrumb[] }
      setFiles(data.files || [])
      if (!search.trim()) setBreadcrumbs(data.folder_path || [])
      setQuota(quotaResponse.ok ? await quotaResponse.json() : null)
    } catch {
      setError(t('os.systemApps.unavailable'))
    } finally {
      setLoading(false)
    }
  }, [currentFolderId, search, t])

  useEffect(() => { void load() }, [load])

  const uploadFiles = async (selected: FileList | File[]) => {
    if (!can('os.files.write')) return
    setWorking(true)
    setError('')
    try {
      for (const file of Array.from(selected)) {
        const body = new FormData()
        body.append('file', file)
        if (currentFolderId) body.append('folder_id', currentFolderId)
        const response = await authFetch('/api/files/upload', { method: 'POST', body })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
      }
      await load()
    } catch {
      setError(t('os.systemApps.uploadFailed'))
    } finally {
      setWorking(false)
      if (deviceInput.current) deviceInput.current.value = ''
    }
  }

  const createFolder = async () => {
    if (!newFolderName.trim() || !can('os.files.write')) return
    setWorking(true)
    try {
      const response = await authFetch('/api/files/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newFolderName.trim(), parent_folder_id: currentFolderId }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setNewFolderName('')
      setNewFolderOpen(false)
      await load()
    } catch {
      setError(t('os.systemApps.folderFailed'))
    } finally {
      setWorking(false)
    }
  }

  const rename = async () => {
    if (!renameEntry || !renameValue.trim()) return
    setWorking(true)
    try {
      const response = await authFetch(`/api/files/${renameEntry.id}/rename`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_name: renameValue.trim() }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setRenameEntry(null)
      await load()
    } catch {
      setError(t('os.systemApps.renameFailed'))
    } finally {
      setWorking(false)
    }
  }

  const remove = async (entry: FileEntry) => {
    if (!can('os.files.write')) return
    setWorking(true)
    try {
      const response = await authFetch(`/api/files/${entry.id}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      await load()
    } catch {
      setError(t('os.systemApps.deleteFailed'))
    } finally {
      setWorking(false)
    }
  }

  const download = async (entry: FileEntry) => {
    if (entry.is_folder) {
      setCurrentFolderId(entry.id)
      return
    }
    try {
      const response = await authFetch(`/api/files/${entry.id}/download`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const url = URL.createObjectURL(await response.blob())
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = entry.original_name
      anchor.click()
      URL.revokeObjectURL(url)
    } catch {
      setError(t('os.systemApps.downloadFailed'))
    }
  }

  const goBack = () => {
    const parent = breadcrumbs.length > 1 ? breadcrumbs[breadcrumbs.length - 2].id : null
    setCurrentFolderId(parent)
  }

  const openRowMenu = (entry: FileEntry, event: ReactMouseEvent<HTMLButtonElement>) => {
    if (menuEntry?.id === entry.id) {
      setMenuEntry(null)
      setMenuAnchor(null)
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    setMenuAnchor({ x: rect.right, y: rect.bottom })
    setMenuEntry(entry)
  }

  const closeRowMenu = () => {
    setMenuEntry(null)
    setMenuAnchor(null)
  }

  const openMoveCopy = (entry: FileEntry, mode: 'move' | 'copy') => {
    closeRowMenu()
    setMoveCopyEntry(entry)
    setMoveCopyMode(mode)
  }

  return (
    <div onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (event.dataTransfer.files.length) void uploadFiles(event.dataTransfer.files) }}>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1"><MagnifyingGlass size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground/35" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('os.systemApps.searchFiles')} className="min-h-12 w-full rounded-2xl border border-foreground/10 bg-foreground/5 pl-10 pr-4 text-sm outline-none focus:border-accent/40" /></div>
        {can('os.files.write') && <><button type="button" onClick={() => setNewFolderOpen(true)} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-foreground/8 px-4 text-sm"><Plus size={17} />{t('os.systemApps.newFolder')}</button><div className="relative"><button type="button" onClick={() => setSourceMenuOpen((value) => !value)} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-accent px-4 text-sm font-semibold text-white"><UploadSimple size={17} />{t('os.systemApps.addFiles')}</button>{sourceMenuOpen && <div className="glass-card absolute right-0 top-full z-30 mt-2 w-64 rounded-2xl p-2 shadow-2xl"><button type="button" onClick={() => { setSourceMenuOpen(false); setCurrentFolderId(null) }} className="flex w-full items-center gap-3 rounded-xl p-3 text-left hover:bg-foreground/8"><Cloud size={20} className="text-accent" /><span><span className="block text-sm font-semibold">{t('os.systemApps.fromCloud')}</span><span className="block text-[10px] text-foreground/40">{t('os.systemApps.fromCloudHint')}</span></span></button><button type="button" disabled={isKioskDevice} onClick={() => { setSourceMenuOpen(false); deviceInput.current?.click() }} className="flex w-full items-center gap-3 rounded-xl p-3 text-left hover:bg-foreground/8 disabled:cursor-not-allowed disabled:opacity-40"><HardDrive size={20} className="text-foreground/60" /><span><span className="block text-sm font-semibold">{t('os.systemApps.fromDevice')}</span><span className="block text-[10px] text-foreground/40">{isKioskDevice ? t('os.systemApps.kioskUnavailable') : t('os.systemApps.fromDeviceHint')}</span></span></button></div>}</div><input ref={deviceInput} type="file" multiple className="hidden" onChange={(event) => { if (event.target.files) void uploadFiles(event.target.files) }} /></>}
      </div>

      <div className="mb-4 flex min-h-11 items-center gap-1 overflow-x-auto rounded-2xl border border-foreground/8 bg-foreground/4 px-2">
        <button type="button" onClick={() => setCurrentFolderId(null)} className="flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold hover:bg-foreground/8"><Cloud size={16} className="text-accent" />{t('os.systemApps.myCloud')}</button>
        {breadcrumbs.map((item) => <span key={item.id} className="flex shrink-0 items-center"><CaretRight size={14} className="text-foreground/25" /><button type="button" onClick={() => setCurrentFolderId(item.id)} className="rounded-xl px-3 py-2 text-xs hover:bg-foreground/8">{item.name}</button></span>)}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3"><div className="glass-card rounded-2xl p-4"><HardDrive size={20} className="mb-2 text-accent" /><p className="text-lg font-semibold">{formatBytes(quota?.used_bytes)}</p><p className="text-xs text-foreground/40">{t('os.systemApps.usedStorage')}</p></div><div className="glass-card rounded-2xl p-4"><File size={20} className="mb-2 text-accent" /><p className="text-lg font-semibold">{files.filter((file) => !file.is_folder).length}</p><p className="text-xs text-foreground/40">{t('os.systemApps.files')}</p></div><div className="glass-card col-span-2 rounded-2xl p-4 sm:col-span-1"><Cloud size={20} className="mb-2 text-accent" /><p className="text-lg font-semibold">{formatBytes(quota?.quota_bytes)}</p><p className="text-xs text-foreground/40">{t('os.systemApps.quota')}</p></div></div>

      <div className="glass-card overflow-hidden rounded-3xl border border-white/10">
        {currentFolderId && <button type="button" onClick={goBack} className="flex w-full items-center gap-3 border-b border-foreground/7 p-4 text-left hover:bg-foreground/5"><ArrowLeft size={21} className="text-foreground/50" /><span className="text-sm font-medium">{t('os.systemApps.parentFolder')}</span></button>}
        {!loading && files.length === 0 && <div className="flex min-h-44 flex-col items-center justify-center p-8 text-center"><FolderOpen size={36} weight="duotone" className="mb-3 text-foreground/25" /><p className="text-sm text-foreground/45">{t('os.systemApps.noFiles')}</p><p className="mt-1 text-xs text-foreground/30">{t('os.systemApps.dropFiles')}</p></div>}
        {files.map((entry) => <div key={entry.id} className="group flex items-center gap-3 border-b border-foreground/7 p-3 last:border-0 hover:bg-foreground/5"><button type="button" onClick={() => void download(entry)} className="flex min-w-0 flex-1 items-center gap-3 text-left"><span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${entry.is_folder ? 'bg-amber-500/10 text-amber-400' : 'bg-accent/10 text-accent'}`}>{entry.is_folder ? <Folder size={23} weight="duotone" /> : <File size={23} weight="duotone" />}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{entry.original_name}</span><span className="block text-[11px] text-foreground/35">{entry.is_folder ? t('os.systemApps.folder') : `${entry.mime_type || t('os.systemApps.file')} · ${formatBytes(entry.size_bytes)}`}</span></span></button><div className="flex shrink-0 items-center gap-1">{!entry.is_folder && <button type="button" onClick={() => void download(entry)} className="rounded-full p-2 text-foreground/40 hover:bg-foreground/8 hover:text-foreground" aria-label={t('os.systemApps.download')}><DownloadSimple size={17} /></button>}{can('os.files.write') && <button type="button" onClick={() => { setRenameEntry(entry); setRenameValue(entry.original_name) }} className="rounded-full p-2 text-foreground/40 hover:bg-foreground/8 hover:text-foreground" aria-label={t('os.systemApps.rename')}><PencilSimple size={17} /></button>}{can('os.files.write') && <button type="button" onClick={(event) => openRowMenu(entry, event)} className="rounded-full p-2 text-foreground/40 hover:bg-foreground/8 hover:text-foreground" aria-label={t('os.systemApps.moreActions')}><DotsThreeVertical size={17} /></button>}{can('os.files.write') && <button type="button" disabled={working} onClick={() => void remove(entry)} className="rounded-full p-2 text-foreground/40 hover:bg-red-500/10 hover:text-red-300" aria-label={t('common.delete')}><Trash size={17} /></button>}</div></div>)}
      </div>

      {menuEntry && menuAnchor && <><div className="fixed inset-0 z-[85]" onClick={closeRowMenu} /><div className="fixed z-[86] w-44 overflow-hidden rounded-2xl border border-white/10 bg-background p-1.5 shadow-2xl" style={{ left: Math.max(8, menuAnchor.x - 176), top: menuAnchor.y + 6 }}><button type="button" onClick={() => openMoveCopy(menuEntry, 'move')} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-foreground/8"><ArrowSquareOut size={17} className="text-foreground/60" />{t('os.systemApps.moveTo')}</button><button type="button" onClick={() => openMoveCopy(menuEntry, 'copy')} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-foreground/8"><Copy size={17} className="text-foreground/60" />{t('os.systemApps.copyTo')}</button></div></>}

      {error && <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>}
      {working && <div className="fixed inset-x-0 bottom-4 z-[90] mx-auto w-fit rounded-full bg-accent px-4 py-2 text-xs font-semibold text-white shadow-xl">{t('os.systemApps.processing')}</div>}

      {newFolderOpen && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"><div className="glass-card w-full max-w-sm rounded-3xl p-5"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">{t('os.systemApps.newFolder')}</h2><button type="button" onClick={() => setNewFolderOpen(false)} className="rounded-full p-2 hover:bg-foreground/8"><X size={18} /></button></div><input autoFocus value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void createFolder() }} placeholder={t('os.systemApps.folderName')} className="mt-5 min-h-12 w-full rounded-2xl border border-foreground/10 bg-foreground/5 px-4 text-sm outline-none" /><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setNewFolderOpen(false)} className="rounded-xl px-4 py-2 text-sm">{t('common.cancel')}</button><button type="button" disabled={!newFolderName.trim() || working} onClick={() => void createFolder()} className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{t('common.create')}</button></div></div></div>}
      {renameEntry && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"><div className="glass-card w-full max-w-sm rounded-3xl p-5"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">{t('os.systemApps.rename')}</h2><button type="button" onClick={() => setRenameEntry(null)} className="rounded-full p-2 hover:bg-foreground/8"><X size={18} /></button></div><input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void rename() }} className="mt-5 min-h-12 w-full rounded-2xl border border-foreground/10 bg-foreground/5 px-4 text-sm outline-none" /><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setRenameEntry(null)} className="rounded-xl px-4 py-2 text-sm">{t('common.cancel')}</button><button type="button" disabled={!renameValue.trim() || working} onClick={() => void rename()} className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{t('common.save')}</button></div></div></div>}
      {moveCopyEntry && moveCopyMode && <OsFileMoveCopyDialog entry={moveCopyEntry} mode={moveCopyMode} onCancel={() => { setMoveCopyEntry(null); setMoveCopyMode(null) }} onComplete={() => { setMoveCopyEntry(null); setMoveCopyMode(null); void load() }} />}
    </div>
  )
}
