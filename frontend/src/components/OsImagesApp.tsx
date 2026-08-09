import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { DownloadSimple, Images as ImagesIcon, X } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { authFetch } from '@/lib/authHelpers'
import { getBackendUrl } from '@/lib/config'
import { AuthImage } from '@/components/AuthImage'
import { registerFileTypeApp } from '@/lib/fileTypeRegistry'

interface ImageEntry {
  id: string
  name: string
  folderName: string
  size: number
  updatedAt: string
}

/**
 * OsImagesApp – a real gallery over IORA Files. Shows every image stored in
 * the cloud (root + subfolders), opens a full-size viewer, and reserves the
 * image/* file types: "Open with Bilder" opens a file straight here.
 */

// Reserve image file types for this app (explorer shows the app icon + open-with).
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'heic', 'avif']
for (const ext of IMAGE_EXTENSIONS) {
  registerFileTypeApp(ext, {
    appId: 'os-images',
    appName: 'Bilder',
    appIcon: '/icons/Images.png',
    open: (file) => {
      window.dispatchEvent(new CustomEvent('iora:open-image', { detail: file }))
      window.dispatchEvent(new PopStateEvent('popstate'))
      // navigate via the page navigation when possible
      const navEvent = new CustomEvent('iora:navigate', { detail: { pageId: 'os-images' } })
      window.dispatchEvent(navEvent)
    },
  })
}

async function loadFolderImages(folderId: string | null, folderName: string): Promise<ImageEntry[]> {
  const params = new URLSearchParams()
  if (folderId) params.set('folder_id', folderId)
  params.set('limit', '500')
  try {
    const res = await authFetch(`/api/files/?${params.toString()}`)
    if (!res.ok) return []
    const data = await res.json() as { files?: Array<{ id: string; original_name: string; mime_type: string | null; size_bytes: number; updated_at: string; is_folder: boolean }> }
    const files = data.files || []
    const images = files
      .filter((f) => !f.is_folder && f.mime_type?.startsWith('image/'))
      .map((f) => ({ id: f.id, name: f.original_name, folderName, size: f.size_bytes, updatedAt: f.updated_at }))
    return images
  } catch {
    return []
  }
}

export function OsImagesApp() {
  const { t } = useTranslation()
  const [images, setImages] = useState<ImageEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [viewer, setViewer] = useState<ImageEntry | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const root = await loadFolderImages(null, t('os.apps.images.name'))
      const all = [...root]
      // One level of subfolders for a richer gallery.
      const rootRes = await authFetch('/api/files/?limit=500')
      if (rootRes.ok) {
        const rootData = await rootRes.json() as { files?: Array<{ id: string; original_name: string; is_folder: boolean }> }
        const folders = (rootData.files || []).filter((f) => f.is_folder).slice(0, 20)
        const nested = await Promise.all(folders.map((folder) => loadFolderImages(folder.id, folder.original_name)))
        for (const group of nested) all.push(...group)
      }
      setImages(all)
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { void load() }, [load])

  // "Open with Bilder" from the file explorer
  useEffect(() => {
    const handler = (event: CustomEvent) => {
      const file = event.detail as { id: string; name: string }
      if (file?.id) {
        setViewer({ id: file.id, name: file.name, folderName: '', size: 0, updatedAt: '' })
        setImages((current) => current.some((i) => i.id === file.id) ? current : [{ id: file.id, name: file.name, folderName: '', size: 0, updatedAt: '' }, ...current])
      }
    }
    window.addEventListener('iora:open-image', handler as EventListener)
    return () => window.removeEventListener('iora:open-image', handler as EventListener)
  }, [])

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

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <div className="mb-6 flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl">
          <img src="/icons/Images.png" alt="" width={44} height={44} className="object-contain" draggable={false} />
        </span>
        <div>
          <h1 className="text-xl font-bold text-foreground">{t('os.apps.images.name')}</h1>
          <p className="text-xs text-foreground/50">{t('os.apps.images.description')}</p>
        </div>
        <div className="ml-auto rounded-full bg-foreground/5 px-3 py-1.5 text-xs text-foreground/55">{images.length} {t('os.apps.images.count')}</div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 10 }).map((_, index) => <div key={index} className="aspect-square animate-pulse rounded-2xl bg-foreground/5" />)}
        </div>
      ) : images.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[1.75rem] border border-dashed border-foreground/12 py-20 text-center">
          <ImagesIcon size={40} className="text-foreground/15" weight="thin" />
          <p className="text-sm font-semibold text-foreground/60">{t('os.apps.images.empty')}</p>
          <p className="max-w-sm text-xs text-foreground/40">{t('os.apps.images.emptyHint')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {images.map((image) => (
            <button
              key={image.id}
              type="button"
              onClick={() => setViewer(image)}
              className="group relative aspect-square overflow-hidden rounded-2xl border border-foreground/8 bg-foreground/[0.03] transition-all hover:-translate-y-0.5 hover:border-foreground/15"
            >
              <AuthImage src={`${getBackendUrl()}/api/files/${image.id}/download`} alt={image.name} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-3 pb-2 pt-8 text-left">
                <span className="block truncate text-[11px] font-medium text-white">{image.name}</span>
                {image.folderName && <span className="block truncate text-[9px] text-white/60">{image.folderName}</span>}
              </span>
            </button>
          ))}
        </div>
      )}

      <AnimatePresence>
        {viewer && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[80] flex flex-col items-center justify-center bg-black/85 p-4 backdrop-blur-md"
            onClick={() => setViewer(null)}
          >
            <div className="mb-3 flex w-full max-w-4xl items-center justify-between gap-3" onClick={(event) => event.stopPropagation()}>
              <p className="min-w-0 truncate text-sm font-medium text-white/85">{viewer.name}</p>
              <div className="flex shrink-0 gap-2">
                <button type="button" onClick={() => void downloadImage(viewer)} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20">
                  <DownloadSimple size={13} className="mr-1 inline" />{t('os.systemApps.download')}
                </button>
                <button type="button" onClick={() => setViewer(null)} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20">
                  <X size={13} className="mr-1 inline" />{t('common.close')}
                </button>
              </div>
            </div>
            <AuthImage src={`${getBackendUrl()}/api/files/${viewer.id}/download`} alt={viewer.name} className="max-h-[80vh] max-w-full rounded-xl object-contain shadow-2xl" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
