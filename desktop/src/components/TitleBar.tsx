/**
 * TitleBar – platform-native window chrome for rumahl Desktop.
 *
 * Adapts to the host OS:
 *   Windows 11 – acrylic backdrop, controls right, maximize shows snap menu
 *   macOS 26    – Liquid Glass, larger traffic lights left, green = tile menu
 *   Linux       – GNOME/Adwaita, controls right, matte finish
 *
 * All platforms: rounded corners via Tauri set_shadow + CSS.
 */
import { useState, useEffect, useCallback, useRef, type CSSProperties } from 'react'
import { usePlatform } from '@/hooks/usePlatform'
import { usePageNavigation } from '@/contexts/PageNavigationContext'
import { tauriApi } from '@/lib/tauri'
import { ArrowClockwise, Gear, Minus, Square, X, ArrowsOut, CornersOut, FrameCorners, House } from '@phosphor-icons/react'

// ─── Window action types ────────────────────────────────────────────────

type WindowAction = 'minimize' | 'maximize' | 'close'

// ─── Hook: window state ─────────────────────────────────────────────────

function useWindowState() {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    let unlisten: (() => void) | null = null

    import('@tauri-apps/api/window')
      .then(async ({ getCurrentWindow }) => {
        const win = getCurrentWindow()
        const max = await win.isMaximized()
        setIsMaximized(max)

        const { listen } = await import('@tauri-apps/api/event')
        const fn = await listen('tauri://window-event', (event) => {
          if (event.payload === 'resized' || event.payload === 'fullscreened') {
            win.isMaximized().then(setIsMaximized).catch(() => {})
          }
        })
        unlisten = fn
      })
      .catch(() => {})

    return () => { unlisten?.() }
  }, [])

  const handleAction = useCallback(async (action: WindowAction) => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const win = getCurrentWindow()
      switch (action) {
        case 'minimize':
          await win.minimize()
          break
        case 'maximize': {
          const m = await win.isMaximized()
          if (m) {
            await win.unmaximize()
            setIsMaximized(false)
          } else {
            await win.maximize()
            setIsMaximized(true)
          }
          break
        }
        case 'close':
          await win.hide()
          break
      }
    } catch (err) {
      console.error(`Failed to ${action} window:`, err)
    }
  }, [])

  return { isMaximized, handleAction }
}

// ─── macOS 26 Traffic Lights ────────────────────────────────────────────
//
// REMOVED: macOS now uses native decorations (decorations: true).
// The OS renders real traffic light buttons with full native behavior
// including the green button hover tile menu. No custom controls needed.

// ─── Windows 11 controls ────────────────────────────────────────────────

const WIN_BTN =
  'flex h-8 w-[46px] items-center justify-center text-foreground/60 hover:bg-foreground/8 active:bg-foreground/12 transition-colors'

function WindowsControls({
  isMaximized,
  handleAction,
  onMaximizeHover,
}: {
  isMaximized: boolean
  handleAction: (a: WindowAction) => void
  onMaximizeHover: (e: React.MouseEvent) => void
}) {
  return (
    <div className="flex items-center -mr-1" style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}>
      <button aria-label="Minimieren" onClick={() => handleAction('minimize')} className={WIN_BTN}>
        <Minus size={12} weight="bold" />
      </button>
      <button
        aria-label={isMaximized ? 'Verkleinern' : 'Maximieren'}
        onClick={() => handleAction('maximize')}
        onMouseEnter={onMaximizeHover}
        className={WIN_BTN}
      >
        {isMaximized ? (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
            <path d="M2 1h7v7H2V1Z" />
            <path d="M4 4h7v7H4V4Z" fill="currentColor" opacity="0.15" />
            <path d="M3 5v4h4" />
          </svg>
        ) : (
          <Square size={10} weight="bold" />
        )}
      </button>
      <button
        aria-label="Schließen"
        onClick={() => handleAction('close')}
        className={`${WIN_BTN} hover:bg-destructive/90 hover:text-white`}
      >
        <X size={14} weight="bold" />
      </button>
    </div>
  )
}

// ─── Linux / GNOME controls ─────────────────────────────────────────────

const GNOME_BTN =
  'flex h-7 w-7 items-center justify-center rounded-full text-foreground/50 hover:bg-foreground/10 hover:text-foreground/80 active:bg-foreground/15 transition-colors'

function GnomeControls({
  isMaximized,
  handleAction,
}: {
  isMaximized: boolean
  handleAction: (a: WindowAction) => void
}) {
  return (
    <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}>
      <button aria-label="Minimieren" onClick={() => handleAction('minimize')} className={GNOME_BTN}>
        <Minus size={12} weight="bold" />
      </button>
      <button
        aria-label={isMaximized ? 'Verkleinern' : 'Maximieren'}
        onClick={() => handleAction('maximize')}
        className={GNOME_BTN}
      >
        {isMaximized ? (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3">
            <rect x="1" y="3" width="7" height="7" />
            <path d="M4 1h7v7" />
          </svg>
        ) : (
          <Square size={10} weight="bold" />
        )}
      </button>
      <button
        aria-label="Schließen"
        onClick={() => handleAction('close')}
        className={`${GNOME_BTN} hover:bg-destructive/25 hover:text-destructive`}
      >
        <X size={13} weight="bold" />
      </button>
    </div>
  )
}

// ─── Tile menu dropdown (macOS green button / Windows maximize hover) ───

const TILE_OPTIONS = [
  { dir: 'left', label: '⬅ Linke Hälfte' },
  { dir: 'right', label: 'Rechte Hälfte ➡' },
  { dir: 'top', label: '⬆ Obere Hälfte' },
  { dir: 'bottom', label: '⬇ Untere Hälfte' },
  { dir: 'top_left', label: '↖ Oben links' },
  { dir: 'top_right', label: '↗ Oben rechts' },
  { dir: 'bottom_left', label: '↙ Unten links' },
  { dir: 'bottom_right', label: '↘ Unten rechts' },
  { dir: 'maximize', label: '⬜ Maximieren' },
  { dir: 'center', label: '⊙ Zentrieren' },
]

function TileMenu({
  isOpen,
  position,
  onSelect,
  onClose,
  platform,
}: {
  isOpen: boolean
  position: { x: number; y: number }
  onSelect: (dir: string) => void
  onClose: () => void
  platform: string
}) {
  if (!isOpen) return null

  const isMac = platform === 'macos'

  return (
    <>
      <div className="fixed inset-0 z-[99999]" onClick={onClose} />
      <div
        className={`fixed z-[99999] min-w-[200px] overflow-hidden shadow-2xl ${
          isMac
            ? 'rounded-xl border border-white/[0.12] bg-white/[0.55] dark:bg-black/[0.65] backdrop-blur-2xl backdrop-saturate-200 py-1.5'
            : 'rounded-2xl border border-white/10 bg-black/80 backdrop-blur-2xl py-2'
        }`}
        style={{ left: position.x, top: position.y }}
      >
        {TILE_OPTIONS.map((opt, i) => (
          <button
            key={opt.dir}
            onClick={() => { onSelect(opt.dir); onClose() }}
            className={`flex w-full items-center gap-2.5 px-4 py-2 text-left transition-colors ${
              isMac
                ? 'text-[12px] text-black/70 dark:text-white/70 hover:bg-black/8 dark:hover:bg-white/12 font-medium'
                : 'text-[13px] text-white/80 hover:bg-white/10 hover:text-white'
            }`}
          >
            <span className={isMac ? 'text-[15px]' : 'text-sm'}>{opt.label}</span>
          </button>
        ))}
        <div className={isMac ? 'border-t border-black/8 dark:border-white/8 my-1' : 'border-t border-white/10 my-1'} />
        <button
          onClick={() => { handleWindowDrag(); onClose() }}
          className={`flex w-full items-center gap-2.5 px-4 py-2 text-left transition-colors ${
            isMac
              ? 'text-[12px] text-black/50 dark:text-white/50 hover:bg-black/8 dark:hover:bg-white/12'
              : 'text-[13px] text-white/60 hover:bg-white/10 hover:text-white/80'
          }`}
        >
          <FrameCorners size={isMac ? 13 : 14} /> Fenster verschieben
        </button>
      </div>
    </>
  )
}

// ─── App badge ──────────────────────────────────────────────────────────

function AppBadge({ platform }: { platform: string }) {
  return (
    <div className="flex items-center gap-2.5 select-none" style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}>
      <span className={`h-2 w-2 rounded-full ${
        platform === 'linux' ? 'bg-emerald-400' : 'bg-sky-400'
      } shadow-[0_0_8px_rgba(59,130,246,0.4)]`} />
      <span className="text-xs font-semibold uppercase tracking-[0.22em] text-foreground/80">
        rumahl
      </span>
    </div>
  )
}

// ─── Action buttons ─────────────────────────────────────────────────────

function ActionButtons({ showReload }: { showReload: boolean }) {
  const { setCurrentPageId } = usePageNavigation()
  const dispatch = (type: string) => window.dispatchEvent(new CustomEvent(type))
  return (
    <div className="flex items-center gap-1.5" style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}>
      {showReload && (
        <button
          aria-label="Remote Home neu laden"
          onClick={() => dispatch('desktop-reload-remote-home')}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground/50 hover:bg-foreground/8 hover:text-foreground/80 active:bg-foreground/12 transition-colors"
        >
          <ArrowClockwise size={15} weight="bold" />
        </button>
      )}
      <button
        aria-label="rumahl Home"
        onClick={() => setCurrentPageId('home')}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground/50 hover:bg-foreground/8 hover:text-foreground/80 active:bg-foreground/12 transition-colors"
        title="rumahl Home"
      >
        <House size={15} weight="bold" />
      </button>
      <button
        aria-label="Desktop-Einstellungen"
        onClick={() => dispatch('desktop-open-settings')}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground/50 hover:bg-foreground/8 hover:text-foreground/80 active:bg-foreground/12 transition-colors"
      >
        <Gear size={15} weight="bold" />
      </button>
    </div>
  )
}

// ─── Window drag helper ─────────────────────────────────────────────────

async function handleWindowDrag() {
  try {
    await tauriApi.startWindowDrag()
  } catch {
    // Fallback
  }
}

// ─── Main TitleBar ──────────────────────────────────────────────────────

export function TitleBar() {
  const platform = usePlatform()
  const { currentPageId } = usePageNavigation()
  const { isMaximized, handleAction } = useWindowState()
  const [tileMenu, setTileMenu] = useState<{ x: number; y: number } | null>(null)
  const tileTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isSettingsPage = currentPageId === 'settings'
  const showReload = !isSettingsPage && currentPageId !== 'connection'

  // Enable window shadow (rounded corners on Windows 11) on mount
  useEffect(() => {
    tauriApi.applyWindowShadow().catch(() => {})
  }, [])

  // ── Tile menu logic ────────────────────────────────────────────

  // On macOS: show macOS-styled tile menu (mimics native constraints popover)
  // On Windows: show custom tile menu on maximize button hover
  // On Linux: no hover menu

  const showTileMenu = useCallback((e: React.MouseEvent) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect()
    setTileMenu({ x: rect.left - 180 + rect.width, y: rect.bottom + 4 })
  }, [])

  const hideTileMenu = useCallback(() => {
    setTileMenu(null)
  }, [])

  const handleTileSelect = useCallback(async (dir: string) => {
    try {
      await tauriApi.tileWindow(dir)
    } catch (err) {
      console.error('Tile failed:', err)
    }
  }, [])

  // Auto-show tile menu on hover after 400ms.
  // On macOS: native green button handles this natively.
  // On Windows: trigger native snap layout via WM_NCLBUTTONDOWN.
  const onMaximizeHover = useCallback((e: React.MouseEvent) => {
    if (platform === 'windows') {
      tileTimeoutRef.current = setTimeout(() => {
        const rect = (e.target as HTMLElement).getBoundingClientRect()
        // Position at the center of the maximize button
        const cx = rect.left + rect.width / 2
        const cy = rect.top + rect.height / 2
        tauriApi.triggerWindowsSnap(cx, cy).catch(() => {})
      }, 400)
    }
  }, [platform])

  const onMaximizeLeave = useCallback(() => {
    if (tileTimeoutRef.current) {
      clearTimeout(tileTimeoutRef.current)
      tileTimeoutRef.current = null
    }
  }, [])

  // ── Container styles ───────────────────────────────────────────

  const containerClass = (() => {
    switch (platform) {
      case 'windows':
        return 'flex items-center justify-between h-11 px-2 gap-2 bg-white/15 dark:bg-white/10 backdrop-blur-2xl border-b border-black/5 dark:border-white/10 select-none z-[9999]'
      case 'macos':
        // Native decorations handle traffic lights – minimal bar for actions only
        return 'flex items-center justify-end h-10 pr-3 gap-2 bg-transparent select-none z-[9999]'
      case 'linux':
        return 'flex items-center justify-between h-10 px-2 gap-2 bg-card border-b border-border select-none shadow-[0_1px_3px_rgba(0,0,0,0.08)] z-[9999]'
      default:
        return 'flex items-center justify-between h-12 px-3 gap-2 bg-black/40 backdrop-blur-2xl border-b border-white/10 select-none z-[9999]'
    }
  })()

  const dragRegionStyle: CSSProperties = { WebkitAppRegion: 'drag' }

  // ── Render ─────────────────────────────────────────────────────

  // Settings page: no title bar – just window controls as floating overlay
  if (isSettingsPage) {
    return (
      <div className="fixed top-0 right-0 z-[9999] flex items-center gap-1.5 px-2 py-1.5">
        {platform === 'windows' ? (
          <WindowsControls isMaximized={isMaximized} handleAction={handleAction} onMaximizeHover={onMaximizeHover} />
        ) : platform === 'linux' ? (
          <GnomeControls isMaximized={isMaximized} handleAction={handleAction} />
        ) : null}
      </div>
    )
  }

  return (
    <>
      <div data-tauri-drag-region className={containerClass} style={dragRegionStyle}>
        {platform === 'macos' ? (
          <>
            <div className="flex-1" />
            {!isSettingsPage && <ActionButtons showReload={showReload} />}
          </>
        ) : platform === 'windows' ? (
          <>
            {!isSettingsPage && <AppBadge platform={platform} />}
            <div className="flex-1" data-tauri-drag-region onMouseLeave={onMaximizeLeave} />
            {!isSettingsPage && <ActionButtons showReload={showReload} />}
            <WindowsControls isMaximized={isMaximized} handleAction={handleAction} onMaximizeHover={onMaximizeHover} />
          </>
        ) : (
          <>
            {!isSettingsPage && <AppBadge platform={platform} />}
            <div className="flex-1" data-tauri-drag-region />
            {!isSettingsPage && <ActionButtons showReload={showReload} />}
            <GnomeControls isMaximized={isMaximized} handleAction={handleAction} />
          </>
        )}
      </div>

      {/* Tile / Snap dropdown menu */}
      <TileMenu
        isOpen={tileMenu !== null}
        position={tileMenu ?? { x: 0, y: 0 }}
        onSelect={handleTileSelect}
        onClose={hideTileMenu}
        platform={platform}
      />
    </>
  )
}
