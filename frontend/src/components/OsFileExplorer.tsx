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
 Rows, FilePlus, Info, Check } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { authFetch, getAuthToken } from '@/lib/authHelpers'
import { getBackendUrl } from '@/lib/config'
import { OsWindowActions } from '@/components/OsWindowActions'
import { useOsPermissions } from '@/hooks/useOsPermissions'
import { createPortal } from 'react-dom'
import { closeAllContextMenus, useCloseOnOtherMenu } from '@/lib/contextMenus'
import { OsFileMoveCopyDialog } from './OsFileMoveCopyDialog'
import { fileTypeIcon, fileTypeAppFor } from '@/lib/fileTypeRegistry'
import { AuthImage } from '@/components/AuthImage'

interface FileEntry {
  id: string
  original_name: string
  size_bytes: number
  mime_type: string | null
  is_folder: boolean
  updated_at: string
  deleted_at?: string | null
}

interface Breadcrumb { id: string; name: string }
interface Quota { quota_bytes: number; used_bytes: number; available_bytes: number; usage_percent: number }
type ViewMode = 'grid' | 'list' | 'table'

/** Lazy folder-tree node (sidebar). */
interface TreeNode {
  id: string
  name: string
  expanded: boolean
  loaded: boolean
  children: TreeNode[]
}
type SortMode = 'name' | 'updated' | 'size'
type Location = { folderId: string | null; breadcrumbs: Breadcrumb[] }

function formatBytes(value = 0) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1 }
  return `${size.toFixed(unit ? 1 : 0)} ${units[unit]}`
}

/** Real file-explorer icons: type-based file_*.png, folder icons for folders,
 * and a reserved app icon when an app owns the file type. */
/** System folders shown in the sidebar (created on first use, Windows-style). */
const SYSTEM_FOLDERS = ['Dokumente', 'Downloads', 'Photos', 'Videos']

/** Folder names owned by apps → app icon badge (bottom-right of the folder tile). */
const APP_FOLDER_BADGES: Record<string, string> = {
  bilder: '/icons/Images.png',
  nextcloud: 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0082C9"/><path d="M46 40a8 8 0 0 0-1-15.9 12 12 0 0 0-22.9-2.6A9.5 9.5 0 0 0 20 40h22a6 6 0 0 0 4-1.5" fill="white"/></svg>'),
  webbrowser: 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#FF7139"/><circle cx="32" cy="32" r="15" fill="none" stroke="white" stroke-width="5"/><ellipse cx="32" cy="32" rx="7" ry="15" fill="none" stroke="white" stroke-width="5"/><path d="M17 32h30" stroke="white" stroke-width="5"/></svg>'),
}

function fileIcon(entry: FileEntry, size: number) {
  if (entry.is_folder) {
    const badge = APP_FOLDER_BADGES[entry.original_name.toLowerCase()]
    return (
      <span className="relative inline-block shrink-0">
        <img src="/icons/folder.png" alt="" width={size} height={size} className="object-contain" draggable={false} />
        {badge && (
          <span className="absolute -bottom-1 -right-1 flex h-[42%] w-[42%] items-center justify-center overflow-hidden rounded-md bg-background shadow-md ring-1 ring-foreground/10">
            <img src={badge} alt="" className="h-full w-full object-contain p-0.5" draggable={false} />
          </span>
        )}
      </span>
    )
  }
  const src = fileTypeIcon(entry.mime_type, entry.original_name)
  return <img src={src} alt="" width={size} height={size} className="object-contain" draggable={false} />
}

/** Recursive folder-tree item for the sidebar (lazy-loaded children). */
function TreeItem({
  node,
  depth,
  activeId,
  onSelect,
  onToggle,
  onExpand,
}: {
  node: TreeNode
  depth: number
  activeId: string | null
  onSelect: (id: string) => void
  onToggle: () => void
  onExpand: (id: string) => void
}) {
  return (
    <div>
      <div
        role="treeitem"
        aria-expanded={node.expanded}
        className={`group flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs transition-colors ${
          activeId === node.id ? 'bg-accent/12 text-accent' : 'text-foreground/65 hover:bg-foreground/10 hover:text-foreground'
        }`}
        style={{ paddingLeft: `${0.5 + depth * 1.1}rem` }}
        onClick={() => onSelect(node.id)}
      >
        <button
          type="button"
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-foreground/40 hover:text-foreground"
          onClick={(event) => { event.stopPropagation(); onToggle() }}
          aria-label="expand"
        >
          {node.expanded ? <CaretDown size={12} /> : <CaretRight size={12} />}
        </button>
        <img src="/icons/folder.png" alt="" width={16} height={16} className="shrink-0 object-contain" draggable={false} />
        <span className="truncate">{node.name}</span>
      </div>
      {node.expanded && (
        <div className="relative">
          <div className="absolute bottom-1 left-[1.05rem] top-1 w-px bg-foreground/8" aria-hidden="true" />
          {node.children.map((child) => (
            <TreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              activeId={activeId}
              onSelect={onSelect}
              onToggle={() => onExpand(child.id)}
              onExpand={onExpand}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** Picker-mode contract: turns the full explorer into a file-selection dialog
 * (Windows-style) — the very same UI, just with a selection footer. */
export interface FilePickerConfig {
  accept?: string
  multiple?: boolean
  title?: string
  onCancel: () => void
  onComplete: (files: Array<{ id: string; name: string; mimeType: string; size: number; dataBase64: string; path?: string }>) => void
}

export function OsFileExplorer({ pickerMode }: { pickerMode?: FilePickerConfig | null }) {
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
  const [uploadProgress, setUploadProgress] = useState<{ fileName: string; percent: number } | null>(null)
  const [error, setError] = useState('')
  const [errorKind, setErrorKind] = useState<'refresh' | 'operation'>('refresh')
  const [viewMode, setViewMode] = useState<ViewMode>(() => localStorage.getItem('iora-files-view') === 'list' ? 'list' : 'grid')
  const [sortMode, setSortMode] = useState<SortMode>('name')
  const [previewEntry, setPreviewEntry] = useState<FileEntry | null>(null)
  const [trashMode, setTrashMode] = useState(false)
  const [netMode, setNetMode] = useState(false)
  const [activeSystemFolder, setActiveSystemFolder] = useState<string | null>(null)
  const [mounts, setMounts] = useState<Array<{ id: string; ip: string; share: string; name: string; mounted: boolean }>>([])
  const [mountFiles, setMountFiles] = useState<Record<string, Array<{ name: string; is_folder: boolean; size_bytes: number }>>>({})
  const [openMount, setOpenMount] = useState<string | null>(null)
  const [scanOpen, setScanOpen] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanResults, setScanResults] = useState<Array<{ ip: string; shares: Array<{ name: string; comment: string }> }>>([])
  const [connecting, setConnecting] = useState<string | null>(null)
  const [networkHosts, setNetworkHosts] = useState<Array<{ ip: string; shares: Array<{ name: string; comment: string }> }>>([])
  const [scanningNetwork, setScanningNetwork] = useState(false)

  const scanNetwork = async () => {
    setScanningNetwork(true)
    try {
      const res = await authFetch('/api/files/network/shares')
      if (res.ok) setNetworkHosts((await res.json() as { hosts: typeof networkHosts }).hosts)
    } catch { /* offline */ }
    setScanningNetwork(false)
  }

  // ── Network drive management (real SMB mounts) ──
  const loadMounts = async () => {
    try {
      const res = await authFetch('/api/files/network/mounts')
      if (res.ok) setMounts((await res.json() as { mounts: typeof mounts }).mounts)
    } catch { /* offline */ }
  }

  const connectShare = async (ip: string, share: string) => {
    const key = `${ip}/${share}`
    if (connecting) return
    setConnecting(key)
    try {
      const res = await authFetch('/api/files/network/mounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip, share }),
      })
      if (res.ok) {
        await loadMounts()
        setNetMode(true)
        setScanOpen(false)
      } else {
        const payload = await res.json().catch(() => null) as { error?: string } | null
        setError(payload?.error || `HTTP ${res.status}`)
      }
    } catch { /* offline */ }
    setConnecting(null)
  }

  const disconnectMount = async (id: string) => {
    try {
      await authFetch(`/api/files/network/mounts/${id}`, { method: 'DELETE' })
      setMountFiles((current) => { const next = { ...current }; delete next[id]; return next })
      setOpenMount((current) => current === id ? null : current)
      await loadMounts()
    } catch { /* offline */ }
  }

  const openMountDir = async (id: string) => {
    setOpenMount(id)
    try {
      const res = await authFetch(`/api/files/network/mounts/${id}/files`)
      if (res.ok) {
        const data = await res.json() as { files: typeof mountFiles[string] }
        setMountFiles((current) => ({ ...current, [id]: data.files }))
      }
    } catch { /* offline */ }
  }

  const downloadMountFile = async (id: string, name: string) => {
    try {
      const res = await authFetch(`/api/files/network/mounts/${id}/download?path=${encodeURIComponent(name)}`)
      if (!res.ok) return
      const url = URL.createObjectURL(await res.blob())
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = name
      anchor.click()
      URL.revokeObjectURL(url)
    } catch { /* offline */ }
  }

  const startScan = async () => {
    setScanOpen(true)
    setScanning(true)
    setScanResults([])
    try {
      const res = await authFetch('/api/files/network/shares')
      if (res.ok) setScanResults((await res.json() as { hosts: typeof scanResults }).hosts)
    } catch { /* offline */ }
    setScanning(false)
  }
  const [newFileDraft, setNewFileDraft] = useState(false)
  const [newFileName, setNewFileName] = useState('')
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dropHighlight, setDropHighlight] = useState(false)

  // ── Folder tree (lazy) ──
  const [tree, setTree] = useState<TreeNode[]>([])

  const loadTree = useCallback(async () => {
    try {
      const res = await authFetch('/api/files/?folder_id=&limit=500')
      if (!res.ok) return
      const data = await res.json() as { files?: FileEntry[] }
      const folders = (data.files || []).filter((f) => f.is_folder).map((f) => ({ id: f.id, name: f.original_name, expanded: false, loaded: false, children: [] as TreeNode[] }))
      setTree(folders)
    } catch { /* tree is optional */ }
  }, [])

  const expandTreeNode = async (nodeId: string) => {
    setTree((current) => current.map((n) => n.id === nodeId ? { ...n, expanded: !n.expanded, loaded: n.loaded || n.expanded } : n))
    // Lazy-load children if this folder was never expanded before.
    const node = treeRef.current.find((n) => n.id === nodeId)
    if (node && !node.loaded) {
      try {
        const res = await authFetch(`/api/files/?folder_id=${nodeId}&limit=500`)
        if (!res.ok) return
        const data = await res.json() as { files?: FileEntry[] }
        const kids = (data.files || []).filter((f) => f.is_folder).map((f) => ({ id: f.id, name: f.original_name, expanded: false, loaded: false, children: [] as TreeNode[] }))
        setTree((current) => current.map((n) => n.id === nodeId ? { ...n, loaded: true, children: kids } : n))
      } catch { /* ignore */ }
    }
  }
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [history, setHistory] = useState<Location[]>([{ folderId: null, breadcrumbs: [] }])
  const [historyIndex, setHistoryIndex] = useState(0)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [renameEntry, setRenameEntry] = useState<FileEntry | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [contextEntry, setContextEntry] = useState<FileEntry | null>(null)
  const [contextPos, setContextPos] = useState<{ x: number; y: number } | null>(null)
  useCloseOnOtherMenu(() => { setContextEntry(null); setContextPos(null) })
  const [moveCopyEntry, setMoveCopyEntry] = useState<FileEntry | null>(null)
  const [moveCopyMode, setMoveCopyMode] = useState<'move' | 'copy' | null>(null)
  const deviceInput = useRef<HTMLInputElement>(null)
  const requestRef = useRef(0)
  const treeRef = useRef<TreeNode[]>([])
  useEffect(() => { treeRef.current = tree }, [tree])
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
      if (trashMode) {
        params.set('include_deleted', 'true')
        params.set('limit', '500')
      } else {
        if (currentFolderId) params.set('folder_id', currentFolderId)
        if (search) params.set('search', search)
      }
      const [filesResponse, quotaResponse] = await Promise.all([
        authFetch(`/api/files/?${params.toString()}`),
        authFetch('/api/files/quota'),
      ])
      if (!filesResponse.ok) {
        // 404/502/503 = the files microservice is missing or stale → give the
        // user a concrete hint instead of a bare status code.
        const status = filesResponse.status
        if (status === 404 || status === 502 || status === 503) {
          throw new Error(t('os.files.serviceRestart', { detail: `HTTP ${status}` }))
        }
        throw new Error(`HTTP ${status}`)
      }
      const data = await filesResponse.json() as { files?: FileEntry[]; folder_path?: Breadcrumb[] }
      if (request !== requestRef.current) return
      const listed = data.files || []
      setFiles(trashMode ? listed.filter((f) => f.deleted_at) : listed)
      if (!trashMode && !search) setBreadcrumbs(data.folder_path || [])
      if (trashMode) setBreadcrumbs([])
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
  }, [currentFolderId, search, trashMode, t])

  useEffect(() => { void load(false) }, [load])
  useEffect(() => { void loadTree() }, [loadTree])

  const sortedFiles = useMemo(() => [...files].sort((a, b) => {
    if (a.is_folder !== b.is_folder) return a.is_folder ? -1 : 1
    if (sortMode === 'updated') return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    if (sortMode === 'size') return b.size_bytes - a.size_bytes
    return a.original_name.localeCompare(b.original_name)
  }), [files, sortMode])

  const navigate = (folderId: string | null, path: Breadcrumb[], push = true) => {
    setTrashMode(false)
    setNetMode(false)
    if (folderId === null) setActiveSystemFolder(null)
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
    else if (pickerMode && !entry.is_folder) {
      // Windows-style: double-click picks the file right away (single mode).
      setSelected(new Set([entry.id]))
      if (!pickerMode.multiple) void completePick()
    } else {
      openFile(entry)
    }
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
        setUploadProgress({ fileName: file.name, percent: 0 })
        // XHR so we can report upload progress (fetch has no progress events).
        await new Promise<void>((resolve, reject) => {
          const body = new FormData(); body.append('file', file)
          if (currentFolderId) body.append('folder_id', currentFolderId)
          const xhr = new XMLHttpRequest()
          xhr.open('POST', `${getBackendUrl()}/api/files/upload`)
          const token = getAuthToken()
          if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              setUploadProgress({ fileName: file.name, percent: Math.round((event.loaded / event.total) * 100) })
            }
          }
          xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`HTTP ${xhr.status}`)))
          xhr.onerror = () => reject(new Error('Upload fehlgeschlagen'))
          xhr.send(body)
        })
      }
      setUploadProgress(null)
      await load(true)
    } catch (operationError) {
      setErrorKind('operation'); setError(operationError instanceof Error ? operationError.message : '')
    } finally { setWorking(false); setUploadProgress(null); if (deviceInput.current) deviceInput.current.value = '' }
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

  /** Restore a soft-deleted file/folder from the trash. */
  const restoreEntry = async (entry: FileEntry) => {
    try {
      const response = await authFetch(`/api/files/${entry.id}/restore`, { method: 'POST' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      await load(true)
    } catch (operationError) {
      setErrorKind('operation'); setError(operationError instanceof Error ? operationError.message : '')
    }
  }

  /** Open (and create on first use) a system folder like Documents/Photos. */
  const openSystemFolder = async (name: string) => {
    setActiveSystemFolder(name)
    setTrashMode(false)
    setNetMode(false)
    try {
      const res = await authFetch('/api/files/?limit=500')
      if (!res.ok) return
      const data = await res.json() as { files?: FileEntry[] }
      const existing = (data.files || []).find((f) => f.is_folder && f.original_name.toLowerCase() === name.toLowerCase())
      if (existing) {
        navigate(existing.id, [{ id: existing.id, name: existing.original_name }])
        return
      }
      if (can('os.files.write')) {
        const create = await authFetch('/api/files/folders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, parent_folder_id: null }),
        })
        if (create.ok) {
          const created = await create.json() as { id?: string; original_name?: string }
          if (created.id) navigate(created.id, [{ id: created.id, name: created.original_name || name }])
        }
      }
    } catch { /* offline */ }
  }

  /** Move a file/folder into another folder (internal drag & drop). */
  const moveEntry = async (fileId: string, targetFolderId: string | null) => {
    if (!can('os.files.write')) return
    try {
      const response = await authFetch(`/api/files/${fileId}/move`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_folder_id: targetFolderId }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      await load(true)
    } catch (operationError) {
      setErrorKind('operation'); setError(operationError instanceof Error ? operationError.message : '')
    }
  }

  /** Create an empty text file via an empty upload. */
  const createFile = async () => {
    const name = newFileName.trim()
    if (!name || !can('os.files.write')) return
    setWorking(true)
    try {
      const blob = new Blob([''], { type: 'text/plain' })
      const file = new window.File([blob], name, { type: 'text/plain' })
      await uploadFiles([file])
      setNewFileName(''); setNewFileDraft(false)
    } finally { setWorking(false) }
  }

  /** Open a file: image preview for images, download otherwise. */
  const openFile = (entry: FileEntry) => {
    if (entry.mime_type?.startsWith('image/')) {
      setPreviewEntry(entry)
    } else {
      void download(entry)
    }
  }

  const completePick = async () => {
    if (!pickerMode || selected.size === 0) return
    const entries = Array.from(selected)
      .map((id) => files.find((entry) => entry.id === id))
      .filter((entry): entry is FileEntry => Boolean(entry && !entry.is_folder))
    const results: Array<{ id: string; name: string; mimeType: string; size: number; dataBase64: string; path?: string }> = []
    for (const entry of entries) {
      try {
        const res = await authFetch(`/api/files/${entry.id}/download`)
        if (!res.ok) continue
        const bytes = new Uint8Array(await res.arrayBuffer())
        let binary = ''
        const chunk = 0x8000
        for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
        results.push({
          id: entry.id,
          name: entry.original_name,
          mimeType: entry.mime_type || 'application/octet-stream',
          size: entry.size_bytes,
          dataBase64: btoa(binary),
          path: [...breadcrumbs.map((b) => b.name), entry.original_name].join('/'),
        })
      } catch { /* skip broken file */ }
    }
    if (results.length > 0) pickerMode.onComplete(pickerMode.multiple ? results : [results[0]])
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
    <div className={pickerMode ? 'picker-overlay fixed inset-0 z-[150] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm sm:p-8' : ''}>
    <section className={`ora-files-app ${pickerMode ? 'flex h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-[1.5rem] border border-white/10 bg-background/95 shadow-2xl backdrop-blur-xl' : 'ora-app-frame'}`} onClick={() => setContextEntry(null)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (event.target === event.currentTarget && event.dataTransfer.files.length) void uploadFiles(event.dataTransfer.files) }}>
      <header className="ora-app-navbar">
        <div className="flex min-w-0 items-center gap-3"><span className="ora-app-mark ora-app-mark-files"><FolderOpen size={24} weight="duotone" /></span><div><p className="text-lg font-semibold">{t('os.apps.files.name')}</p><p className="hidden text-xs text-foreground/45 sm:block">{t('os.apps.files.description')}</p></div></div>
        <div className="flex items-center gap-2">
          <button type="button" disabled={historyIndex === 0} onClick={() => moveHistory(-1)} className="ora-icon-button" aria-label={t('os.files.back')}><ArrowLeft size={18} /></button>
          <button type="button" disabled={historyIndex >= history.length - 1} onClick={() => moveHistory(1)} className="ora-icon-button" aria-label={t('os.files.forward')}><ArrowRight size={18} /></button>
        </div>
        <label className="ora-toolbar-search"><MagnifyingGlass size={17} /><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder={t('os.systemApps.searchFiles')} /></label>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => { const order: ViewMode[] = ['grid', 'list', 'table']; const next = order[(order.indexOf(viewMode) + 1) % order.length]; setViewMode(next); localStorage.setItem('iora-files-view', next) }} className="ora-icon-button" aria-label={t('os.files.changeView')} title={t('os.files.changeView')}>{viewMode === 'grid' ? <ListBullets size={19} /> : viewMode === 'list' ? <Rows size={19} /> : <GridFour size={19} />}</button>
          <label className="ora-select-button"><SortAscending size={17} /><select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)} aria-label={t('os.files.sort')}><option value="name">{t('os.files.sortName')}</option><option value="updated">{t('os.files.sortUpdated')}</option><option value="size">{t('os.files.sortSize')}</option></select><CaretDown size={13} /></label>
          {can('os.files.write') && <><button type="button" onClick={() => { setNewFileDraft(true); setNewFileName('Neue Datei.txt'); setSelected(new Set()) }} className="ora-secondary-button"><FilePlus size={17} />{t('os.files.newFile')}</button><button type="button" onClick={() => setNewFolderOpen(true)} className="ora-secondary-button"><Plus size={17} />{t('os.systemApps.newFolder')}</button><button type="button" onClick={() => deviceInput.current?.click()} className="ora-primary-button"><UploadSimple size={17} />{t('os.systemApps.upload')}</button><input ref={deviceInput} type="file" multiple className="hidden" onChange={(event) => { if (event.target.files) void uploadFiles(event.target.files) }} /></>}
          <span className="mx-0.5 h-6 w-px bg-foreground/10" aria-hidden="true" />
          <OsWindowActions pageId="os-files" />
        </div>
      </header>

      <div className="ora-files-layout">
        <aside className="ora-files-sidebar">
          <p className="ora-sidebar-label">ORA</p>
          <button type="button" className={`ora-sidebar-item ${currentFolderId === null ? 'is-active' : ''}`} onClick={() => navigate(null, [])}><House size={18} weight="duotone" />{t('os.files.home')}</button>
          {SYSTEM_FOLDERS.map((folder) => (
            <button
              key={folder}
              type="button"
              onClick={() => void openSystemFolder(folder)}
              className={`ora-sidebar-item ${activeSystemFolder === folder ? 'is-active' : ''}`}
            >
              <img src="/icons/folder.png" alt="" width={18} height={18} className="object-contain" draggable={false} />
              {folder}
            </button>
          ))}
          {tree.length > 0 && (
            <>
              <p className="ora-sidebar-label mt-6">{t('os.files.folders')}</p>
              <div className="mt-1 space-y-0.5">
                {tree.map((node) => (
                  <TreeItem
                    key={node.id}
                    node={node}
                    depth={0}
                    activeId={currentFolderId}
                    onSelect={(id) => navigate(id, [...breadcrumbs, { id, name: node.name }])}
                    onToggle={() => void expandTreeNode(node.id)}
                    onExpand={(id) => void expandTreeNode(id)}
                  />
                ))}
              </div>
            </>
          )}
          <button type="button" className={`ora-sidebar-item ${trashMode ? 'is-active' : ''}`} onClick={() => { setTrashMode(true); setSelected(new Set()); setSearchInput(''); setSearch('') }}><img src="/icons/paperbin.png" alt="" width={18} height={18} className="object-contain" draggable={false} />{t('os.files.trash')}</button>
          <p className="ora-sidebar-label mt-7">{t('os.files.network')}</p>
          <button type="button" onClick={() => setNetMode(true)} className={`ora-sidebar-item ${netMode ? 'is-active' : ''}`}>
            <img src="/icons/nas.png" alt="" width={18} height={18} className="object-contain" draggable={false} />
            {t('os.files.networkDrives')}
          </button>
          {networkHosts.map((host) => (
            <div key={host.ip} className="mt-1 rounded-xl bg-foreground/[0.03] p-2">
              <p className="flex items-center gap-1.5 px-1 text-[11px] font-semibold text-foreground/70">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                {host.ip}
              </p>
              <div className="mt-1.5 space-y-1">
                {host.shares.map((share) => (
                  <div key={share.name} className="flex items-center gap-1.5 rounded-lg px-1 py-1 text-[11px] text-foreground/55">
                    <img src="/icons/folder.png" alt="" width={14} height={14} className="object-contain" draggable={false} />
                    <span className="truncate">{share.name}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <p className="ora-sidebar-label mt-7">{t('os.files.storage')}</p>
          <div className="rounded-2xl bg-foreground/5 p-3"><div className="flex justify-between text-xs"><span>{formatBytes(quota?.used_bytes)}</span><span className="text-foreground/40">{formatBytes(quota?.quota_bytes)}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-foreground/10"><div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.min(quota?.usage_percent || 0, 100)}%` }} /></div></div>
        </aside>

        <main className="min-w-0 flex-1">
          <nav className="ora-breadcrumb" aria-label={t('os.files.breadcrumb')}><button type="button" onClick={() => navigate(null, [])}><House size={16} weight="fill" />{t('os.files.home')}</button>{breadcrumbs.map((item, index) => <span key={item.id} className="flex items-center"><CaretRight size={14} /><button type="button" onClick={() => navigate(item.id, breadcrumbs.slice(0, index + 1))}>{item.name}</button></span>)}</nav>
      {uploadProgress && (
        <div className="mx-4 mt-3 flex items-center gap-3 rounded-2xl border border-foreground/8 bg-foreground/[0.04] px-4 py-3">
          <UploadSimple size={16} className="shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-foreground/80">{uploadProgress.fileName}</p>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-foreground/10">
              <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${uploadProgress.percent}%` }} />
            </div>
          </div>
          <span className="shrink-0 text-xs font-semibold tabular-nums text-foreground/60">{uploadProgress.percent}%</span>
        </div>
      )}
      {error && <div className="ora-inline-error" role="alert"><div><strong>{errorKind === 'refresh' ? t('os.files.refreshFailed') : t('common.error')}</strong><p>{t(errorKind === 'refresh' ? 'os.files.connectionError' : 'os.files.operationError', { detail: error })}</p></div><button type="button" onClick={() => void load(true)}>{t('common.tryAgain')}</button></div>}
          <div className={`ora-selection-bar ${selected.size === 0 ? 'invisible' : ''}`}><span>{t('os.files.selected', { count: selected.size })}</span>{selected.size === 1 && !selectedEntries[0]?.is_folder && <button type="button" onClick={() => void download(selectedEntries[0])}><DownloadSimple size={16} />{t('os.systemApps.download')}</button>}{selected.size === 1 && <button type="button" onClick={() => { setRenameEntry(selectedEntries[0]); setRenameValue(selectedEntries[0].original_name) }}><PencilSimple size={16} />{t('os.systemApps.rename')}</button>}{can('os.files.write') && selected.size === 1 && <button type="button" onClick={() => openMoveCopy(selectedEntries[0], 'move')}><ArrowSquareOut size={16} />{t('os.systemApps.moveTo')}</button>}{can('os.files.write') && selected.size === 1 && <button type="button" onClick={() => openMoveCopy(selectedEntries[0], 'copy')}><Copy size={16} />{t('os.systemApps.copyTo')}</button>}{can('os.files.write') && <button type="button" className="text-red-300" onClick={() => void removeEntries(selectedEntries)}><Trash size={16} />{t('common.delete')}</button>}<button type="button" onClick={() => setSelected(new Set())}><X size={16} /></button></div>

          <div
            className={`ora-files-surface ${dropHighlight ? 'border-accent/60 ring-2 ring-accent/25' : ''}`}
            aria-busy={refreshing}
            onDragOver={(event) => { event.preventDefault(); setDropHighlight(true) }}
            onDragLeave={(event) => { if (event.currentTarget === event.target) setDropHighlight(false) }}
            onDrop={(event) => { event.preventDefault(); event.stopPropagation(); setDropHighlight(false); if (event.dataTransfer.files.length) void uploadFiles(event.dataTransfer.files) }}
          >
            {refreshing && <div className="ora-refresh-indicator" />}
            {netMode ? (
              <div className="p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <img src="/icons/nas.png" alt="" width={22} height={22} className="object-contain" draggable={false} />
                    <p className="text-sm font-semibold text-foreground">{t('os.files.networkDrives')}</p>
                  </div>
                  <button type="button" onClick={() => void startScan()} className="ora-secondary-button">
                    <MagnifyingGlass size={15} />{t('os.files.scanNetwork')}
                  </button>
                </div>
                {mounts.length === 0 ? (
                  <div className="flex min-h-72 flex-col items-center justify-center text-center">
                    <img src="/icons/nas.png" alt="" width={64} height={64} className="object-contain opacity-40" draggable={false} />
                    <p className="mt-4 text-sm font-medium text-foreground/50">{t('os.files.noDrives')}</p>
                    <button type="button" onClick={() => void startScan()} className="mt-3 rounded-full bg-accent/12 px-4 py-2 text-xs font-semibold text-accent hover:bg-accent/20">
                      {t('os.files.scanNetwork')}
                    </button>
                  </div>
                ) : (
                  <div className="grid gap-2">
                    {mounts.map((mount) => (
                      <div key={mount.id} className="rounded-2xl border border-foreground/8 bg-foreground/[0.03]">
                        <div className="flex items-center gap-3 px-4 py-3">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${mount.mounted ? 'bg-emerald-400' : 'bg-foreground/25'}`} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-semibold text-foreground">{mount.name}</p>
                            <p className="truncate text-[11px] text-foreground/45">{mount.ip} · {mount.share}</p>
                          </div>
                          <div className="flex shrink-0 gap-1.5">
                            {mount.mounted && (
                              <button type="button" onClick={() => void openMountDir(mount.id)} className="rounded-lg bg-accent/12 px-3 py-1.5 text-[11px] font-semibold text-accent hover:bg-accent/20">
                                {t('os.files.open')}
                              </button>
                            )}
                            <button type="button" onClick={() => void disconnectMount(mount.id)} className="rounded-lg bg-red-500/10 px-3 py-1.5 text-[11px] font-semibold text-red-300 hover:bg-red-500/15">
                              {t('os.files.disconnect')}
                            </button>
                          </div>
                        </div>
                        {openMount === mount.id && mountFiles[mount.id] && (
                          <div className="border-t border-foreground/8 p-2">
                            {mountFiles[mount.id].length === 0 ? (
                              <p className="px-2 py-4 text-center text-xs text-foreground/40">{t('os.files.empty')}</p>
                            ) : (
                              mountFiles[mount.id].map((file) => (
                                <div key={file.name} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs text-foreground/75 hover:bg-foreground/5">
                                  <img src={file.is_folder ? '/icons/folder.png' : '/icons/file.png'} alt="" width={18} height={18} className="object-contain" draggable={false} />
                                  <span className="min-w-0 flex-1 truncate">{file.name}</span>
                                  {!file.is_folder && (
                                    <button type="button" onClick={() => void downloadMountFile(mount.id, file.name)} className="rounded-md px-2 py-1 text-foreground/50 hover:bg-foreground/10 hover:text-foreground">
                                      <DownloadSimple size={14} />
                                    </button>
                                  )}
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : trashMode ? (
              <div className="p-4">
                <div className="mb-3 flex items-center gap-2 rounded-2xl border border-foreground/8 bg-foreground/[0.03] px-4 py-3">
                  <img src="/icons/paperbin.png" alt="" width={20} height={20} className="object-contain" draggable={false} />
                  <p className="text-xs text-foreground/60">{t('os.files.trashHint')}</p>
                </div>
                {sortedFiles.length === 0 ? (
                  <div className="flex min-h-72 flex-col items-center justify-center text-center">
                    <img src="/icons/paperbin.png" alt="" width={64} height={64} className="object-contain opacity-40" draggable={false} />
                    <p className="mt-4 text-sm font-medium text-foreground/50">{t('os.files.trashEmpty')}</p>
                  </div>
                ) : (
                  <div className="ora-file-list">
                    <div className="ora-file-list-head"><span>{t('os.files.name')}</span><span>{t('os.files.modified')}</span><span>{t('os.files.size')}</span><span /></div>
                    {sortedFiles.map((entry) => (
                      <div key={entry.id} className={`ora-file-row ${selected.has(entry.id) ? 'is-selected' : ''}`}>
                        <span className="flex min-w-0 items-center gap-3" onClick={(event) => toggleSelection(entry.id, event.ctrlKey || event.metaKey)}>
                          <span className="shrink-0 opacity-60">{fileIcon(entry, 26)}</span>
                          <span className="truncate">{entry.original_name}</span>
                        </span>
                        <span>{new Date(entry.updated_at).toLocaleDateString()}</span>
                        <span>{entry.is_folder ? '—' : formatBytes(entry.size_bytes)}</span>
                        <span className="flex justify-end gap-1.5">
                          <button type="button" onClick={() => void restoreEntry(entry)} className="rounded-lg bg-accent/12 px-3 py-1.5 text-[11px] font-semibold text-accent hover:bg-accent/20">
                            {t('os.files.restore')}
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : initialLoading ? <div className="ora-file-grid">{Array.from({ length: 8 }).map((_, index) => <div key={index} className="ora-file-skeleton" />)}</div> : sortedFiles.length === 0 ? <div className="flex min-h-80 flex-col items-center justify-center text-center"><img src="/icons/empty_folder.png" alt="" width={72} height={72} className="object-contain opacity-70" draggable={false} /><p className="mt-4 font-medium">{t('os.systemApps.noFiles')}</p><p className="mt-1 text-sm text-foreground/40">{t('os.files.emptyHint')}</p></div> : viewMode === 'grid' ? (
              <div className="ora-file-grid">{
                newFileDraft && (
                  <div className="ora-file-tile relative border border-accent/50 bg-accent/8">
                    <span className="ora-document-icon"><img src="/icons/file.png" alt="" width={56} height={56} className="object-contain" draggable={false} /></span>
                    <input
                      autoFocus
                      value={newFileName}
                      onChange={(event) => setNewFileName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void createFile()
                        if (event.key === 'Escape') setNewFileDraft(false)
                      }}
                      onBlur={() => { if (newFileName.trim()) void createFile(); else setNewFileDraft(false) }}
                      className="mt-3 w-full truncate rounded-md border border-accent/50 bg-background px-2 py-1 text-center text-sm font-medium text-foreground outline-none"
                    />
                  </div>
                )}
                {sortedFiles.map((entry) => <div key={entry.id} role="button" tabIndex={0} draggable onDragStart={() => setDraggedId(entry.id)} onDragOver={(event) => { if (entry.is_folder) event.preventDefault() }} onDrop={(event) => { event.preventDefault(); if (entry.is_folder && draggedId && draggedId !== entry.id) void moveEntry(draggedId, entry.id); setDraggedId(null) }} onDoubleClick={() => openEntry(entry)} onClick={(event) => toggleSelection(entry.id, event.ctrlKey || event.metaKey)} onContextMenu={(event) => { event.preventDefault(); closeAllContextMenus(); setContextEntry(entry); setContextPos({ x: event.clientX, y: event.clientY }); toggleSelection(entry.id, false) }} className={`ora-file-tile relative cursor-pointer ${selected.has(entry.id) ? 'is-selected' : ''} ${draggedId === entry.id ? 'opacity-40' : ''}`}><span className={entry.is_folder ? 'ora-folder-icon' : 'ora-document-icon'}>{fileIcon(entry, entry.is_folder ? 70 : 56)}</span>{selected.size > 0 && selected.has(entry.id) && <span className="absolute left-1.5 top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-white shadow-lg"><Check size={12} weight="bold" /></span>}{renameEntry?.id === entry.id ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void rename()
                      if (event.key === 'Escape') setRenameEntry(null)
                    }}
                    onBlur={() => { if (renameValue.trim() && renameValue !== renameEntry?.original_name) void rename(); else setRenameEntry(null) }}
                    className="mt-3 w-full truncate rounded-md border border-accent/50 bg-background px-2 py-1 text-center text-sm font-medium text-foreground outline-none"
                  />
                ) : (
                  <span className="mt-3 w-full truncate text-center text-sm font-medium">{entry.original_name}</span>
                )}<span className="mt-1 text-xs text-foreground/35">{entry.is_folder ? t('os.systemApps.folder') : formatBytes(entry.size_bytes)}</span></div>)}</div>
            ) : viewMode === 'list' ? (
              <div className="ora-file-list"><div className="ora-file-list-head"><span>{t('os.files.name')}</span><span>{t('os.files.modified')}</span><span>{t('os.files.size')}</span></div>{sortedFiles.map((entry) => <button key={entry.id} type="button" draggable onDragStart={() => setDraggedId(entry.id)} onDragOver={(event) => { if (entry.is_folder) event.preventDefault() }} onDrop={(event) => { event.preventDefault(); if (entry.is_folder && draggedId && draggedId !== entry.id) void moveEntry(draggedId, entry.id); setDraggedId(null) }} onDoubleClick={() => openEntry(entry)} onClick={(event) => toggleSelection(entry.id, event.ctrlKey || event.metaKey)} onContextMenu={(event) => { event.preventDefault(); closeAllContextMenus(); setContextEntry(entry); setContextPos({ x: event.clientX, y: event.clientY }); toggleSelection(entry.id, false) }} className={`ora-file-row relative ${selected.has(entry.id) ? 'is-selected' : ''} ${draggedId === entry.id ? 'opacity-40' : ''}`}><span className="flex min-w-0 items-center gap-3">{selected.size > 0 && <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${selected.has(entry.id) ? 'bg-accent text-white' : 'bg-foreground/10 text-transparent'}`}><Check size={10} weight="bold" /></span>}<span className={entry.is_folder ? 'text-sky-400' : 'text-foreground/55'}>{fileIcon(entry, 28)}</span>{renameEntry?.id === entry.id ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(event) => setRenameValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void rename()
                        if (event.key === 'Escape') setRenameEntry(null)
                      }}
                      onBlur={() => { if (renameValue.trim() && renameValue !== renameEntry?.original_name) void rename(); else setRenameEntry(null) }}
                      className="min-w-0 truncate rounded-md border border-accent/50 bg-background px-2 py-0.5 text-sm text-foreground outline-none"
                    />
                  ) : (
                    <span className="truncate">{entry.original_name}</span>
                  )}</span><span>{new Date(entry.updated_at).toLocaleDateString()}</span><span>{entry.is_folder ? '—' : formatBytes(entry.size_bytes)}</span></button>)}</div>
            ) : (
              <div className="ora-file-list">
                <div className="ora-file-table-head"><span>{t('os.files.name')}</span><span>{t('os.files.type')}</span><span>{t('os.files.size')}</span><span>{t('os.files.modified')}</span></div>
                {sortedFiles.map((entry) => <button key={entry.id} type="button" draggable onDragStart={() => setDraggedId(entry.id)} onDragOver={(event) => { if (entry.is_folder) event.preventDefault() }} onDrop={(event) => { event.preventDefault(); if (entry.is_folder && draggedId && draggedId !== entry.id) void moveEntry(draggedId, entry.id); setDraggedId(null) }} onDoubleClick={() => openEntry(entry)} onClick={(event) => toggleSelection(entry.id, event.ctrlKey || event.metaKey)} onContextMenu={(event) => { event.preventDefault(); closeAllContextMenus(); setContextEntry(entry); setContextPos({ x: event.clientX, y: event.clientY }); toggleSelection(entry.id, false) }} className={`ora-file-row ora-file-table-row ${selected.has(entry.id) ? 'is-selected' : ''} ${draggedId === entry.id ? 'opacity-40' : ''}`}><span className="flex min-w-0 items-center gap-2.5"><span className="shrink-0">{fileIcon(entry, 22)}</span><span className="truncate">{entry.original_name}</span></span><span className="truncate">{entry.is_folder ? t('os.systemApps.folder') : (entry.mime_type || t('os.files.typeFile'))}</span><span>{entry.is_folder ? '—' : formatBytes(entry.size_bytes)}</span><span>{new Date(entry.updated_at).toLocaleString()}</span></button>)}
              </div>
            )}
          </div>
        </main>
      </div>

      {scanOpen && (
        <Modal title={t('os.files.scanNetwork')} onClose={() => setScanOpen(false)}>
          <p className="text-xs text-foreground/55">{t('os.files.scanHint')}</p>
          {scanning ? (
            <div className="mt-4 flex flex-col items-center gap-3 py-8">
              <span className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              <p className="text-xs text-foreground/50">{t('os.files.scanning')}</p>
            </div>
          ) : scanResults.length === 0 ? (
            <div className="mt-4 py-6 text-center">
              <p className="text-sm text-foreground/60">{t('os.files.noDevicesFound')}</p>
              <button type="button" onClick={() => void startScan()} className="mt-3 rounded-full bg-accent/12 px-4 py-2 text-xs font-semibold text-accent hover:bg-accent/20">
                {t('os.files.scanNetwork')}
              </button>
            </div>
          ) : (
            <div className="mt-4 max-h-72 space-y-2 overflow-y-auto">
              {scanResults.map((host) => (
                <div key={host.ip} className="rounded-xl border border-foreground/8 bg-foreground/[0.03] p-3">
                  <p className="flex items-center gap-2 text-xs font-semibold text-foreground/80">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    {host.ip}
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {host.shares.map((share) => {
                      const key = `${host.ip}/${share.name}`
                      return (
                        <div key={key} className="flex items-center gap-2">
                          <img src="/icons/folder.png" alt="" width={16} height={16} className="object-contain" draggable={false} />
                          <span className="min-w-0 flex-1 truncate text-xs text-foreground/65">{share.name}</span>
                          <button
                            type="button"
                            disabled={connecting === key}
                            onClick={() => void connectShare(host.ip, share.name)}
                            className="rounded-lg bg-accent/12 px-3 py-1 text-[11px] font-semibold text-accent hover:bg-accent/20 disabled:opacity-50"
                          >
                            {connecting === key ? t('os.systemApps.processing') : t('os.files.connect')}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
      {createPortal(
      contextEntry && (() => {
        const app = contextEntry.is_folder ? undefined : fileTypeAppFor(contextEntry.mime_type, contextEntry.original_name)
        const pos = contextPos || { x: window.innerWidth - 220, y: 160 }
        return (
        <div
          className="ora-context-menu"
          style={{ left: Math.min(pos.x, window.innerWidth - 230), top: Math.min(pos.y, window.innerHeight - 320), right: 'auto' }}
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" onClick={() => { const e = contextEntry; setContextEntry(null); openEntry(e) }}><FolderOpen size={16} />{contextEntry.is_folder ? t('os.files.open') : (contextEntry.mime_type?.startsWith('image/') ? t('os.files.preview') : t('os.files.open'))}</button>
          {app && <button type="button" onClick={() => { const e = contextEntry; setContextEntry(null); app.open({ id: e.id, name: e.original_name }) }}><img src={app.appIcon} alt="" width={16} height={16} className="object-contain" draggable={false} />{t('os.files.openWith', { app: app.appName })}</button>}
          {!contextEntry.is_folder && <button type="button" onClick={() => { const e = contextEntry; setContextEntry(null); void download(e) }}><DownloadSimple size={16} />{t('os.systemApps.download')}</button>}
          <button type="button" onClick={() => { setSelected(new Set([contextEntry.id])); setContextEntry(null) }}><Info size={16} />{t('os.files.details')}</button><button type="button" onClick={() => { setRenameEntry(contextEntry); setRenameValue(contextEntry.original_name); setContextEntry(null) }}><PencilSimple size={16} />{t('os.systemApps.rename')}</button>{can('os.files.write') && <button type="button" onClick={() => openMoveCopy(contextEntry, 'move')}><ArrowSquareOut size={16} />{t('os.systemApps.moveTo')}</button>}{can('os.files.write') && <button type="button" onClick={() => openMoveCopy(contextEntry, 'copy')}><Copy size={16} />{t('os.systemApps.copyTo')}</button>}{can('os.files.write') && <button type="button" className="text-red-300" onClick={() => void removeEntries([contextEntry])}><Trash size={16} />{t('common.delete')}</button>}
        </div>
        )
      })(),
      document.body
      )}
      {createPortal(
      selected.size === 1 && selectedEntries[0] && (
        <div className="fixed inset-y-0 right-0 z-[70] flex w-72 flex-col border-l border-foreground/10 bg-background/95 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center justify-between border-b border-foreground/8 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-foreground/50">{t('os.files.details')}</p>
            <button type="button" onClick={() => setSelected(new Set())} className="ora-icon-button" aria-label={t('common.close')}><X size={16} /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              {fileIcon(selectedEntries[0], 64)}
              <p className="w-full truncate text-sm font-semibold">{selectedEntries[0].original_name}</p>
            </div>
            <div className="space-y-2 text-xs">
              {[
                { label: t('os.files.type'), value: selectedEntries[0].is_folder ? t('os.systemApps.folder') : (selectedEntries[0].mime_type || t('os.files.typeFile')) },
                { label: t('os.files.size'), value: selectedEntries[0].is_folder ? '—' : formatBytes(selectedEntries[0].size_bytes) },
                { label: t('os.files.modified'), value: new Date(selectedEntries[0].updated_at).toLocaleString() },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-2 rounded-xl bg-foreground/[0.04] px-3 py-2">
                  <span className="text-foreground/45">{row.label}</span>
                  <span className="truncate font-medium text-foreground/85">{row.value}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 space-y-2">
              <button type="button" onClick={() => openEntry(selectedEntries[0])} className="w-full rounded-xl bg-foreground/6 px-3 py-2.5 text-xs font-semibold hover:bg-foreground/10">
                {selectedEntries[0].is_folder ? t('os.files.open') : (selectedEntries[0].mime_type?.startsWith('image/') ? t('os.files.preview') : t('os.files.open'))}
              </button>
              {!selectedEntries[0].is_folder && <button type="button" onClick={() => void download(selectedEntries[0])} className="w-full rounded-xl bg-foreground/6 px-3 py-2.5 text-xs font-semibold hover:bg-foreground/10">{t('os.systemApps.download')}</button>}
              {can('os.files.write') && <button type="button" onClick={() => void removeEntries(selectedEntries)} className="w-full rounded-xl bg-red-500/10 px-3 py-2.5 text-xs font-semibold text-red-300 hover:bg-red-500/15">{t('common.delete')}</button>}
            </div>
          </div>
        </div>
      ),
      document.body
      )}
      {createPortal(
      previewEntry && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-6 backdrop-blur-md" onClick={() => setPreviewEntry(null)}>
          <div className="relative max-h-full max-w-full" onClick={(event) => event.stopPropagation()}>
            <AuthImage src={`${getBackendUrl()}/api/files/${previewEntry.id}/download`} alt={previewEntry.original_name} className="max-h-[80vh] max-w-full rounded-xl object-contain shadow-2xl" />
            <div className="mt-3 flex items-center justify-between">
              <p className="truncate text-xs font-medium text-white/70">{previewEntry.original_name}</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => void download(previewEntry)} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20">{t('os.systemApps.download')}</button>
                <button type="button" onClick={() => setPreviewEntry(null)} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20">{t('common.close')}</button>
              </div>
            </div>
          </div>
        </div>
      ),
      document.body
      )}
      {working && <div className="ora-working-pill">{t('os.systemApps.processing')}</div>}
      {newFolderOpen && <Modal title={t('os.systemApps.newFolder')} onClose={() => setNewFolderOpen(false)}><input autoFocus value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void createFolder() }} placeholder={t('os.systemApps.folderName')} className="ora-modal-input" /><div className="ora-modal-actions"><button type="button" onClick={() => setNewFolderOpen(false)}>{t('common.cancel')}</button><button type="button" disabled={!newFolderName.trim() || working} onClick={() => void createFolder()} className="ora-primary-button">{t('common.create')}</button></div></Modal>}
      {moveCopyEntry && moveCopyMode && <OsFileMoveCopyDialog entry={moveCopyEntry} mode={moveCopyMode} onCancel={() => { setMoveCopyEntry(null); setMoveCopyMode(null) }} onComplete={() => { setMoveCopyEntry(null); setMoveCopyMode(null); void load(true) }} />}
      {renameEntry && <Modal title={t('os.systemApps.rename')} onClose={() => setRenameEntry(null)}><input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void rename() }} className="ora-modal-input" /><div className="ora-modal-actions"><button type="button" onClick={() => setRenameEntry(null)}>{t('common.cancel')}</button><button type="button" disabled={!renameValue.trim() || working} onClick={() => void rename()} className="ora-primary-button">{t('common.save')}</button></div></Modal>}
    </section>

    {pickerMode && (
      <footer className="flex shrink-0 items-center gap-3 border-t border-foreground/10 bg-background/95 px-4 py-3">
        <p className="min-w-0 flex-1 truncate text-xs text-foreground/55">
          {pickerMode.title ? t('os.filePicker.requestedBy', { app: pickerMode.title }) : ''} · {selected.size > 0 ? t('os.files.selected', { count: selected.size }) : t('os.files.selectFile')}
        </p>
        <button type="button" onClick={pickerMode.onCancel} className="min-h-11 rounded-xl bg-foreground/7 px-5 text-sm">{t('common.cancel')}</button>
        <button
          type="button"
          disabled={selected.size === 0}
          onClick={() => void completePick()}
          className="min-h-11 rounded-xl bg-accent px-5 text-sm font-semibold text-white disabled:opacity-40"
        >
          {selected.size > 0 ? t('os.files.selectCount', { count: selected.size }) : t('os.filePicker.open')}
        </button>
      </footer>
    )}
    </div>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 p-4 backdrop-blur-md" onClick={onClose}>
      <div className="ora-modal-card text-foreground" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">{title}</h2><button type="button" onClick={onClose} className="ora-icon-button"><X size={18} /></button></div>
        {children}
      </div>
    </div>,
    document.body,
  )
}
