import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { CaretLeft, CaretRight, DownloadSimple, Folder, Images as ImagesIcon, MagnifyingGlassMinus, MagnifyingGlassPlus, X } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { authFetch } from '@/lib/authHelpers'
import { getBackendUrl } from '@/lib/config'
import { AuthImage } from '@/components/AuthImage'
import { OsAppNavbar } from '@/components/OsAppNavbar'
import { registerFileTypeApp } from '@/lib/fileTypeRegistry'
import { readFileDragData } from '@/lib/fileDrop'
import { toast } from 'sonner'

interface ImageEntry {
  id: string
  name: string
  folderName: string
  size: number
  updatedAt: string
}

interface FolderEntry {
  id: string
  name: string
}

/**
 * OsImagesApp – a real photo-gallery app over rumahl Files: folder navigation,
 * an image grid, a lightbox with arrow-key navigation and zoom, plus "Open
 * with Bilder" for every image/* file type in the explorer.
 */

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'heic', 'avif']
for (const ext of IMAGE_EXTENSIONS) {
  registerFileTypeApp(ext, {
    appId: 'os-images',
    appName: 'Bilder',
    appIcon: '/icons/Images.png',
    open: (file) => {
      window.dispatchEvent(new CustomEvent('rumahl:open-image', { detail: file }))
      const navEvent = new CustomEvent('rumahl:navigate', { detail: { pageId: 'os-images' } })
      window.dispatchEvent(navEvent)
    },
  })
}

interface FolderContent {
  images: ImageEntry[]
  folders: FolderEntry[]
}

async function loadFolderContent(folderId: string | null, folderName: string): Promise<FolderContent> {
  const params = new URLSearchParams()
  if (folderId) params.set('folder_id', folderId)
  params.set('limit', '500')
  try {
    const res = await authFetch(`/api/files/?${params.toString()}`)
    if (!res.ok) return { images: [], folders: [] }
    const data = await res.json() as { files?: Array<{ id: string; original_name: string; mime_type: string | null; size_bytes: number; updated_at: string; is_folder: boolean }> }
    const files = data.files || []
    const images = files
      .filter((f) => !f.is_folder && f.mime_type?.startsWith('image/'))
      .map((f) => ({ id: f.id, name: f.original_name, folderName, size: f.size_bytes, updatedAt: f.updated_at }))
    const folders = files.filter((f) => f.is_folder).map((f) => ({ id: f.id, name: f.original_name }))
    return { images, folders }
  } catch {
    return { images: [], folders: [] }
  }
}

export function OsImagesApp() {
  const { t } = useTranslation()
  const [images, setImages] = useState<ImageEntry[]>([])
  const [folders, setFolders] = useState<FolderEntry[]>([])
  const [currentFolder, setCurrentFolder] = useState<{ id: string | null; name: string }>({ id: null, name: '' })
  const [path, setPath] = useState<FolderEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)
  const [zoom, setZoom] = useState(1)
  const [sortNewest, setSortNewest] = useState(true)
  const [dragOver, setDragOver] = useState(false)

  // Cross-app drag & drop: accept files dragged from the Files explorer and
  // copy them into the current folder (Package 0, Feature 6c).
  const isImageName = (name: string) => /\.(jpe?g|png|gif|webp|svg|bmp|heic|avif)$/i.test(name)

  const dropFile = async (event: React.DragEvent) => {
    event.preventDefault()
    setDragOver(false)
    const file = readFileDragData(event.dataTransfer)
    if (!file || !isImageName(file.name)) {
      toast.error(t('os.images.dropInvalid'))
      return
    }
    try {
      const res = await authFetch(`/api/files/${file.id}/copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_folder_id: currentFolder.id }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      toast.success(t('os.images.dropCopied', { name: file.name }))
      void load(currentFolder.id, currentFolder.name, path)
    } catch {
      toast.error(t('os.images.dropFailed'))
    }
  }

  const load = useCallback(async (folderId: string | null, folderName: string, trail: FolderEntry[]) => {
    setLoading(true)
    try {
      const content = await loadFolderContent(folderId, folderName)
      setImages(content.images)
      setFolders(content.folders)
      setCurrentFolder({ id: folderId, name: folderName })
      setPath(trail)
      setViewerIndex(null)
      setZoom(1)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load(null, '', []) }, [load])

  // "Open with Bilder" from the file explorer → jump straight into the viewer
  useEffect(() => {
    const handler = (event: CustomEvent) => {
      const file = event.detail as { id: string; name: string }
      if (file?.id) {
        setImages((current) => {
          if (current.some((i) => i.id === file.id)) {
            setViewerIndex(current.findIndex((i) => i.id === file.id))
            return current
          }
          const next = [{ id: file.id, name: file.name, folderName: '', size: 0, updatedAt: '' }, ...current]
          setViewerIndex(0)
          return next
        })
      }
    }
    window.addEventListener('rumahl:open-image', handler as EventListener)
    return () => window.removeEventListener('rumahl:open-image', handler as EventListener)
  }, [])

  const sortedImages = useMemo(() => {
    const list = [...images]
    if (sortNewest) list.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    else list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
    return list
  }, [images, sortNewest])

  const viewerImage = viewerIndex !== null ? sortedImages[viewerIndex] : null

  const step = useCallback((delta: number) => {
    setViewerIndex((current) => {
      if (current === null || sortedImages.length === 0) return current
      return (current + delta + sortedImages.length) % sortedImages.length
    })
    setZoom(1)
  }, [sortedImages.length])

  // Lightbox keyboard navigation
  useEffect(() => {
    if (viewerIndex === null) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setViewerIndex(null); setZoom(1) }
      else if (event.key === 'ArrowRight') step(1)
      else if (event.key === 'ArrowLeft') step(-1)
      else if (event.key === '+' || event.key === '=') setZoom((z) => Math.min(4, z + 0.25))
      else if (event.key === '-') setZoom((z) => Math.max(0.25, z - 0.25))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [viewerIndex, step])

  const downloadImage = async (image: ImageEntry) => {
    try {
      const res = await authFetch(`/api/files/${image.id}/download`)
      if (!res.ok) return
      const url = URL.createObjectURL(await res.blob())
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = image.name
      anchor.click()
      URL.revokeObjectURL(url)
    } catch { /* ignore */ }
  }

  const openFolder = (folder: FolderEntry) => {
    void load(folder.id, folder.name, [...path, folder])
  }

  const goToPathIndex = (index: number) => {
    if (index < 0) { void load(null, '', []); return }
    const target = path[index]
    void load(target.id, target.name, path.slice(0, index))
  }

  return (
    <section
      className="rumahl-images-app rumahl-app-frame mx-auto max-w-7xl overflow-hidden"
      onDragOver={(event) => {
        if (readFileDragData(event.dataTransfer)) {
          event.preventDefault()
          setDragOver(true)
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={dropFile}
    >
      <OsAppNavbar
        pageId="os-images"
        title={t('os.apps.images.name')}
        description={t('os.apps.images.description')}
        icon={<ImagesIcon size={24} weight="duotone" />}
        accent="oklch(0.62 0.15 260)"
        trailing={
          <>
            {images.length > 1 && (
              <button
                type="button"
                onClick={() => setSortNewest((v) => !v)}
                className="rumahl-secondary-button"
              >
                {sortNewest ? t('os.apps.images.sortNewest') : t('os.apps.images.sortName')}
              </button>
            )}
            <span className="rounded-full bg-foreground/5 px-3 py-1.5 text-xs text-foreground/55">{sortedImages.length} {t('os.apps.images.count')}</span>
          </>
        }
      />

      {/* Breadcrumb navigation */}
      <nav className="rumahl-breadcrumb" aria-label={t('os.apps.images.allPhotos')}>
        <button type="button" onClick={() => goToPathIndex(-1)} className={currentFolder.id === null ? 'text-accent' : ''}>
          <ImagesIcon size={16} weight="fill" />
          {t('os.apps.images.allPhotos')}
        </button>
        {path.map((crumb, index) => (
          <span key={crumb.id} className="flex items-center">
            <CaretRight size={14} />
            <button type="button" onClick={() => goToPathIndex(index)} className={index === path.length - 1 && currentFolder.id !== null ? 'text-accent' : ''}>
              {crumb.name}
            </button>
          </span>
        ))}
      </nav>

      <div className="p-4 sm:p-6">
        {loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 10 }).map((_, index) => <div key={index} className="aspect-square animate-pulse rounded-2xl bg-foreground/5" />)}
          </div>
        ) : folders.length === 0 && sortedImages.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-[1.75rem] border border-dashed border-foreground/12 py-20 text-center">
            <ImagesIcon size={40} className="text-foreground/15" weight="thin" />
            <p className="text-sm font-semibold text-foreground/60">{t('os.apps.images.empty')}</p>
            <p className="max-w-sm text-xs text-foreground/40">{t('os.apps.images.emptyHint')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {folders.map((folder) => (
              <button
                key={folder.id}
                type="button"
                onClick={() => openFolder(folder)}
                className="group flex aspect-square flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border border-foreground/8 bg-gradient-to-br from-foreground/[0.05] to-foreground/[0.02] transition-all hover:-translate-y-0.5 hover:border-accent/30"
              >
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/12 text-accent">
                  <Folder size={28} weight="duotone" />
                </span>
                <span className="w-full truncate px-3 text-center text-xs font-medium text-foreground/70">{folder.name}</span>
              </button>
            ))}
            {sortedImages.map((image, index) => (
              <button
                key={image.id}
                type="button"
                onClick={() => { setViewerIndex(index); setZoom(1) }}
                className="group relative aspect-square overflow-hidden rounded-2xl border border-foreground/8 bg-foreground/[0.03] transition-all hover:-translate-y-0.5 hover:border-foreground/15"
              >
                <AuthImage src={`${getBackendUrl()}/api/files/${image.id}/download`} alt={image.name} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-3 pb-2 pt-8 text-left">
                  <span className="block truncate text-[11px] font-medium text-white" data-tooltip={image.name}>{image.name}</span>
                  {image.folderName && <span className="block truncate text-[9px] text-white/60">{image.folderName}</span>}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Drop highlight overlay (portaled so the app frame's backdrop filter
          does not trap its fixed positioning). */}
      {createPortal(
        <AnimatePresence>
          {dragOver && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center bg-accent/10 backdrop-blur-[2px]"
            >
              <div className="rounded-2xl border-2 border-dashed border-accent/60 bg-background/80 px-8 py-6 text-center shadow-2xl backdrop-blur-xl">
                <ImagesIcon size={32} className="mx-auto mb-2 text-accent" />
                <p className="text-sm font-semibold text-foreground">{t('os.images.dropHint')}</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}

      {/* Lightbox */}
      {createPortal(
        <AnimatePresence>
          {viewerImage && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[80] flex flex-col items-center justify-center bg-black/90 p-4 backdrop-blur-md"
              onClick={() => { setViewerIndex(null); setZoom(1) }}
            >
              <div className="mb-3 flex w-full max-w-5xl items-center justify-between gap-3" onClick={(event) => event.stopPropagation()}>
                <p className="min-w-0 truncate text-sm font-medium text-white/85">{viewerImage.name} <span className="text-white/35">({viewerIndex !== null ? viewerIndex + 1 : 1}/{sortedImages.length})</span></p>
                <div className="flex shrink-0 gap-2">
                  <button type="button" onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20" data-tooltip={t('os.apps.images.zoomOut')}><MagnifyingGlassMinus size={13} className="mr-1 inline" />{t('os.apps.images.zoomOut')}</button>
                  <button type="button" onClick={() => setZoom((z) => Math.min(4, z + 0.25))} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20" data-tooltip={t('os.apps.images.zoomIn')}><MagnifyingGlassPlus size={13} className="mr-1 inline" />{t('os.apps.images.zoomIn')}</button>
                  <button type="button" onClick={() => void downloadImage(viewerImage)} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20">
                    <DownloadSimple size={13} className="mr-1 inline" />{t('os.systemApps.download')}
                  </button>
                  <button type="button" onClick={() => { setViewerIndex(null); setZoom(1) }} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20">
                    <X size={13} className="mr-1 inline" />{t('common.close')}
                  </button>
                </div>
              </div>

              <div className="relative flex max-h-[80vh] w-full max-w-5xl items-center justify-center">
                {sortedImages.length > 1 && (
                  <button
                    type="button"
                    onClick={(event) => { event.stopPropagation(); step(-1) }}
                    className="absolute left-0 z-10 flex h-12 w-12 -translate-x-1/2 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white/85 backdrop-blur-md transition-all hover:scale-105 hover:bg-black/70 sm:-translate-x-2"
                    aria-label={t('os.apps.images.previous')}
                  ><CaretLeft size={24} /></button>
                )}
                <div className="max-h-[80vh] w-full overflow-auto flex items-center justify-center" onClick={(event) => event.stopPropagation()}>
                  <div style={{ transform: `scale(${zoom})` }} className="flex max-h-[76vh] max-w-full items-center justify-center transition-transform duration-200">
                    <AuthImage
                      src={`${getBackendUrl()}/api/files/${viewerImage.id}/download`}
                      alt={viewerImage.name}
                      className="max-h-[76vh] max-w-full rounded-xl object-contain shadow-2xl"
                    />
                  </div>
                </div>
                {sortedImages.length > 1 && (
                  <button
                    type="button"
                    onClick={(event) => { event.stopPropagation(); step(1) }}
                    className="absolute right-0 z-10 flex h-12 w-12 translate-x-1/2 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white/85 backdrop-blur-md transition-all hover:scale-105 hover:bg-black/70 sm:translate-x-2"
                    aria-label={t('os.apps.images.next')}
                  ><CaretRight size={24} /></button>
                )}
              </div>

              <p className="mt-3 max-w-3xl truncate text-center text-xs text-white/45" onClick={(event) => event.stopPropagation()}>
                {viewerImage.folderName || t('os.apps.images.allPhotos')}
              </p>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </section>
  )
}
