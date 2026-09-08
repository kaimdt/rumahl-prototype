import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { ArrowClockwise, CaretRight, FilePlus, FolderPlus, Gear, LockKey, PushPin, Storefront, Trash } from '@phosphor-icons/react'

export interface DesktopMenuState {
  x: number
  y: number
  /** When a desktop icon was right-clicked, its pageId. */
  appPageId?: string
  /** When a desktop file/folder/shortcut was right-clicked, its file id. */
  fileId?: string
}

interface Props {
  menu: DesktopMenuState | null
  onClose: () => void
  onOpenApp: () => void
  onOpenSettings: () => void
  onRefresh: () => void
  /** Toggle whether the right-clicked app is a desktop shortcut. */
  onToggleDesktopApp?: (pageId: string) => void
  /** Whether the right-clicked app is currently on the desktop. */
  isRightClickedAppOnDesktop?: boolean
  /** Delete the right-clicked desktop entry (file/folder/shortcut). */
  onDelete?: (fileId: string) => void
  /** Create a new empty file on the desktop (wallpaper context menu). */
  onNewFile?: () => void
  /** Create a new folder on the desktop (wallpaper context menu). */
  onNewFolder?: () => void
}

/**
 * DesktopContextMenu – the right-click menu on the desktop wallpaper / icons.
 * Opened from DesktopWorkspace at the pointer position. A contextual "Open"
 * item appears when an app icon was right-clicked; otherwise the menu shows
 * the desktop actions (New file, New folder, Settings, App Store, Lock,
 * Refresh). Right-clicking an app icon also lets the user add/remove it as a
 * desktop shortcut.
 */
export function DesktopContextMenu({ menu, onClose, onOpenApp, onOpenSettings, onRefresh, onToggleDesktopApp, isRightClickedAppOnDesktop, onDelete, onNewFile, onNewFolder }: Props) {
  const { t } = useTranslation()
  const menuRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  useEffect(() => {
    if (!menu) return
    const id = window.requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus())
    const closeOnLeftPointer = (event: PointerEvent) => {
      if (event.button === 0 && !menuRef.current?.contains(event.target as Node)) onCloseRef.current()
    }
    document.addEventListener('pointerdown', closeOnLeftPointer, true)
    return () => {
      window.cancelAnimationFrame(id)
      document.removeEventListener('pointerdown', closeOnLeftPointer, true)
    }
  }, [menu])

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
    if (!items.length) return
    event.preventDefault()
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowDown' ? (current + 1) % items.length : (current - 1 + items.length) % items.length
    items[next]?.focus()
  }

  return (
    <AnimatePresence>
      {menu && (
        <>
          <motion.button
            type="button"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            onContextMenu={(event) => { event.preventDefault(); onClose() }}
            className="pointer-events-auto fixed inset-0 z-[var(--layer-menu-backdrop)] cursor-default"
            aria-label={t('common.close')}
          />
          <motion.div
            ref={menuRef}
            initial={{ opacity: 0, y: 6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.97 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="rumahl-desktop-context-menu pointer-events-auto fixed z-[var(--layer-menu)] w-56 overflow-hidden rumahl-menu"
            style={{ left: Math.min(menu.x, window.innerWidth - 240), top: Math.min(menu.y + 6, window.innerHeight - 380) }}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.stopPropagation()}
            onKeyDown={handleMenuKeyDown}
            role="menu"
            aria-label={t('os.desktopMenu.settings')}
          >
            <div className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground/35">rumahl OS</div>
            <div className="mx-1.5 my-1 h-px bg-foreground/8" />

            {!menu.appPageId && !menu.fileId && onNewFile && (
              <button type="button" role="menuitem" onClick={() => { onNewFile(); onClose() }} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-foreground/85 transition-colors hover:bg-foreground/8 hover:text-foreground">
                <FilePlus size={16} className="text-foreground/55" />
                {t('os.desktopMenu.newFile')}
              </button>
            )}
            {!menu.appPageId && !menu.fileId && onNewFolder && (
              <button type="button" role="menuitem" onClick={() => { onNewFolder(); onClose() }} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-foreground/85 transition-colors hover:bg-foreground/8 hover:text-foreground">
                <FolderPlus size={16} className="text-foreground/55" />
                {t('os.desktopMenu.newFolder')}
              </button>
            )}

            {menu.appPageId && (
              <>
                <button type="button" role="menuitem" onClick={onOpenApp} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-foreground/85 transition-colors hover:bg-foreground/8 hover:text-foreground">
                  <CaretRight size={16} className="text-foreground/55" />
                  {t('os.launcher.open')}
                </button>
                {onToggleDesktopApp && (
                  <button type="button" role="menuitem" onClick={() => { onToggleDesktopApp(menu.appPageId as string); onClose() }} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-foreground/85 transition-colors hover:bg-foreground/8 hover:text-foreground">
                    <PushPin size={16} className="text-foreground/55" />
                    {isRightClickedAppOnDesktop ? t('os.desktopMenu.removeFromDesktop') : t('os.desktopMenu.addToDesktop')}
                  </button>
                )}
              </>
            )}

            {/* File / folder / non-shortcut entry: contextual open + delete. */}
            {!menu.appPageId && menu.fileId && (
              <>
                <button type="button" role="menuitem" onClick={onOpenApp} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-foreground/85 transition-colors hover:bg-foreground/8 hover:text-foreground">
                  <CaretRight size={16} className="text-foreground/55" />
                  {t('os.launcher.open')}
                </button>
              </>
            )}

            {onDelete && menu.fileId && (
              <button type="button" role="menuitem" onClick={() => { onDelete(menu.fileId as string); onClose() }} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-red-300/90 transition-colors hover:bg-red-500/15">
                <Trash size={16} className="text-red-400/80" />
                {t('common.delete')}
              </button>
            )}
            {menu.fileId && <div className="mx-1.5 my-1 h-px bg-foreground/8" />}

            <button type="button" role="menuitem" onClick={onOpenSettings} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-foreground/85 transition-colors hover:bg-foreground/8 hover:text-foreground">
              <Gear size={16} className="text-foreground/55" />
              {t('os.desktopMenu.settings')}
            </button>
            <button type="button" role="menuitem" onClick={onOpenSettings} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-foreground/85 transition-colors hover:bg-foreground/8 hover:text-foreground">
              <Storefront size={16} className="text-foreground/55" />
              {t('os.desktopMenu.appStore')}
            </button>
            <div className="mx-1.5 my-1 h-px bg-foreground/8" />
            <button type="button" role="menuitem" onClick={() => { window.dispatchEvent(new Event('rumahl:lock-session')); onClose() }} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-foreground/85 transition-colors hover:bg-foreground/8 hover:text-foreground">
              <LockKey size={16} className="text-foreground/55" />
              {t('os.desktopMenu.lock')}
            </button>
            <button type="button" role="menuitem" onClick={onRefresh} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-foreground/85 transition-colors hover:bg-foreground/8 hover:text-foreground">
              <ArrowClockwise size={16} className="text-foreground/55" />
              {t('os.desktopMenu.refresh')}
            </button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
