import { motion, AnimatePresence } from 'framer-motion'
import { usePageNavigation, iconMap } from '@/contexts/PageNavigationContext'
import { useTheme } from '@/contexts/ThemeContext'
import { useAuth } from '@/contexts/AuthContext'
import { Moon, Sun, DotsThree, DotsNine, CaretUp, UserCircle, ShieldCheck, X, Warning, Siren, CloudWarning, Info, Bell } from '@phosphor-icons/react'
import { useState, useCallback, useRef, useEffect } from 'react'
import { UserSwitcher } from '@/components/UserSwitcher'
import { NotificationBell } from '@/components/NotificationCenter'
import { useNotifications } from '@/contexts/NotificationContext'
import { useLocalStorage } from '@/lib/storage'
import { Tip } from '@/components/ui/tip'

// ── Dynamic Island Notification ──────────────────────────────────────

const levelStyles: Record<string, { bg: string; border: string; icon: typeof Warning; iconColor: string }> = {
  emergency: { bg: 'from-red-700/95 via-red-800/95 to-rose-900/95', border: 'border-red-400/40', icon: Siren, iconColor: 'text-red-200' },
  critical: { bg: 'from-orange-600/95 via-red-600/95 to-rose-700/95', border: 'border-red-400/30', icon: Siren, iconColor: 'text-red-200' },
  warning: { bg: 'from-amber-500/95 via-orange-500/95 to-amber-600/95', border: 'border-amber-300/30', icon: Warning, iconColor: 'text-amber-100' },
  info: { bg: 'from-sky-600/95 via-blue-600/95 to-sky-700/95', border: 'border-sky-400/25', icon: CloudWarning, iconColor: 'text-sky-100' },
}

const defaultStyle = { bg: 'from-foreground/10 via-foreground/8 to-foreground/10', border: 'border-foreground/10', icon: Bell, iconColor: 'text-accent' }



export function NavigationMenu({ hidden }: { hidden?: boolean }) {
  const { currentPageId, setCurrentPageId, pages, getSubPages, openModalPage } = usePageNavigation()
  const { sleepMode, setSleepMode, theme } = useTheme()
  const { user } = useAuth()
  const { latestNotification, dismissLatestNotification } = useNotifications()

  // Dynamic Island: navbar morphs into notification display
  const showingNotification = !!latestNotification
  const notifStyle = latestNotification
    ? (levelStyles[latestNotification.level] || defaultStyle)
    : null
  const NotifIcon = notifStyle?.icon ?? Bell

  const [showAllPages, setShowAllPages] = useState(false)
  const [expandedParent, setExpandedParent] = useState<string | null>(null)
  const [showUserSwitcher, setShowUserSwitcher] = useState(false)
  const [showAppMenu, setShowAppMenu] = useState(false)
  const subMenuRef = useRef<HTMLDivElement>(null)
  const appMenuRef = useRef<HTMLDivElement>(null)
  const [navLabels] = useLocalStorage('ha-nav-labels', true)
  const [navStyle] = useLocalStorage<'pill' | 'classic' | 'minimal'>('ha-nav-style', 'pill')

  // App menu pages (shown in 9-dot grid, not in main nav bar)
  const appMenuPageIds = ['streaming', 'docs']

  // Built-in app menu entries (always visible even if not yet in pages array)
  const builtInAppEntries: Array<{ id: string; name: string; icon: string }> = [
    { id: 'streaming', name: 'Streaming', icon: 'VideoCamera' },
    { id: 'docs', name: 'Dokumentation', icon: 'BookOpen' },
  ]

  // Filter pages: show in nav, not settings, not app-menu pages, and only top-level
  const visiblePages = pages.filter(p => p.showInNav !== false && p.id !== 'settings' && !p.parentPageId && !appMenuPageIds.includes(p.id))
  // For app menu, use pages if they exist, or fall back to built-in entries
  const appMenuPages = builtInAppEntries.map(entry => {
    const existing = pages.find(p => p.id === entry.id)
    return existing || { id: entry.id, name: entry.name, icon: entry.icon, widgets: [], showInNav: true, order: 997 } as any
  })
  const settingsPage = pages.find(p => p.id === 'settings')

  // Show max 5 pages in compact mode
  const compactPageLimit = 5
  const displayPages = showAllPages ? visiblePages : visiblePages.slice(0, compactPageLimit)
  const hasMorePages = visiblePages.length > compactPageLimit

  const handlePageSelect = useCallback((id: string) => {
    const page = pages.find(p => p.id === id)
    if (page?.displayMode === 'modal') {
      openModalPage(id)
    } else {
      setCurrentPageId(id)
    }
    setShowAllPages(false)
    setExpandedParent(null)
  }, [setCurrentPageId, openModalPage, pages])

  const handleParentToggle = useCallback((parentId: string) => {
    setExpandedParent(prev => prev === parentId ? null : parentId)
  }, [])

  // Close sub-menu when clicking outside
  useEffect(() => {
    if (!expandedParent) return
    const handleClick = (e: MouseEvent) => {
      if (subMenuRef.current && !subMenuRef.current.contains(e.target as Node)) {
        setExpandedParent(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [expandedParent])

  // Close app menu when clicking outside
  useEffect(() => {
    if (!showAppMenu) return
    const handleClick = (e: MouseEvent) => {
      if (appMenuRef.current && !appMenuRef.current.contains(e.target as Node)) {
        setShowAppMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showAppMenu])

  if (hidden) return null

  // Border radius: fully round pill normally, more rounded container when notification expands
  const normalRadius = navStyle === 'classic' ? 16 : navStyle === 'minimal' ? 12 : 9999
  const notifRadius = navStyle === 'classic' ? 20 : navStyle === 'minimal' ? 16 : 28

  return (
    <>
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 28, delay: 0.2 }}
        className="fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] sm:bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-[calc(100vw-1rem)]"
        style={{
          filter: theme === 'sleep' ? 'saturate(0.2) brightness(0.55)' : 'none',
          transition: 'filter 0.6s ease',
        }}
      >
        <motion.div
          layout
          className="relative overflow-visible theme-transition"
          animate={{
            borderRadius: showingNotification ? notifRadius : normalRadius,
          }}
          style={{ boxShadow: '0 8px 40px oklch(0 0 0 / 0.25), 0 0 0 1px oklch(from var(--foreground) l c h / 0.06)' }}
          transition={{
            layout: { type: 'spring', stiffness: 300, damping: 24, bounce: 0.2 },
            borderRadius: { type: 'spring', stiffness: 300, damping: 24 },
          }}
        >
          {/* Glass card background — fades out when notification gradient takes over */}
          <motion.div
            className="absolute inset-0 glass-card overflow-hidden"
            style={{ borderRadius: 'inherit' }}
            animate={{ opacity: showingNotification ? 0 : 1 }}
            transition={{ duration: 0.3 }}
          />

          {/* Notification gradient background — covers entire navbar */}
          <AnimatePresence>
            {showingNotification && notifStyle && (
              <motion.div
                key="notif-bg"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className={`absolute inset-0 bg-gradient-to-r ${notifStyle.bg} backdrop-blur-2xl`}
                style={{ borderRadius: 'inherit' }}
              />
            )}
          </AnimatePresence>

          {/* Progress bar */}
          <AnimatePresence>
            {showingNotification && latestNotification && (
              <motion.div
                key={`progress-${latestNotification.id}`}
                className="absolute bottom-0 left-0 h-[2px] bg-white/25 z-10"
                style={{ borderRadius: 'inherit' }}
                initial={{ width: '100%' }}
                animate={{ width: '0%' }}
                exit={{ opacity: 0 }}
                transition={{ duration: 60, ease: 'linear' }}
              />
            )}
          </AnimatePresence>

          {/* Content: notification on top + nav controls always at bottom */}
          <div className="relative z-[1] flex flex-col">
            {/* ── Notification section: expands above controls ── */}
            <AnimatePresence initial={false}>
              {showingNotification && latestNotification && notifStyle && (
                <motion.div
                  key={`notif-${latestNotification.id}`}
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 24, bounce: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="px-5 pt-3.5 pb-2 flex items-center gap-3 min-w-[340px]">
                    {/* Icon */}
                    <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
                      {(latestNotification.level === 'critical' || latestNotification.level === 'emergency') ? (
                        <motion.div
                          animate={{ scale: [1, 1.18, 1] }}
                          transition={{ duration: 1, repeat: Infinity }}
                        >
                          <NotifIcon size={20} weight="fill" className={notifStyle.iconColor} />
                        </motion.div>
                      ) : (
                        <NotifIcon size={20} weight="fill" className={notifStyle.iconColor} />
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-white truncate">{latestNotification.title}</p>
                      {latestNotification.message && (
                        <p className="text-[11px] text-white/60 truncate mt-0.5">{latestNotification.message}</p>
                      )}
                    </div>

                    {/* Dismiss */}
                    <button
                      onClick={(e) => { e.stopPropagation(); dismissLatestNotification() }}
                      className="p-1.5 rounded-full text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors flex-shrink-0"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  {/* Subtle separator */}
                  <div className="mx-3 h-px bg-white/10" />
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Navigation controls: always at the bottom ── */}
            <div className="px-1.5 sm:px-2.5 py-1.5 sm:py-2">
              <div className="flex items-center gap-0.5 sm:gap-1">
            {displayPages.map((page) => {
              const Icon = iconMap[page.icon as keyof typeof iconMap]
              const isActive = currentPageId === page.id
              const subPages = getSubPages(page.id).filter(sp => sp.showInNav !== false)
              const hasSubPages = subPages.length > 0

              return (
                <div key={page.id} className="relative">
                  <motion.button
                    onClick={() => hasSubPages ? handleParentToggle(page.id) : handlePageSelect(page.id)}
                    onContextMenu={(e) => { e.preventDefault(); if (hasSubPages) handleParentToggle(page.id); else handlePageSelect(page.id) }}
                    className={`relative min-w-[44px] min-h-[44px] px-3 sm:px-3.5 py-2.5 sm:py-2 rounded-full transition-colors duration-200 focus-ring flex items-center justify-center ${
                      isActive
                        ? 'text-foreground'
                        : 'text-foreground/40 hover:text-foreground/70 active:text-foreground/60'
                    }`}
                    whileHover={{ scale: 1.06 }}
                    whileTap={{ scale: 0.92 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                  >
                    {isActive && (
                      <motion.div
                        layoutId="navActiveIndicator"
                        className="absolute inset-0 rounded-full"
                        style={{
                          background: 'oklch(from var(--accent) l c h / 0.15)',
                          boxShadow: '0 0 16px oklch(from var(--accent) l c h / 0.12)',
                        }}
                      transition={{
                        type: 'spring',
                        stiffness: 400,
                        damping: 28,
                      }}
                    />
                  )}
                  <div className="relative flex items-center gap-1.5">
                    {Icon && <Icon size={19} weight={isActive ? 'fill' : 'regular'} />}
                    {hasSubPages && <CaretUp size={10} className={`transition-transform ${expandedParent === page.id ? 'rotate-0' : 'rotate-180'} text-foreground/30`} />}
                    <AnimatePresence mode="popLayout">
                      {isActive && !hasSubPages && navLabels && (
                        <motion.span
                          initial={{ width: 0, opacity: 0 }}
                          animate={{ width: 'auto', opacity: 1 }}
                          exit={{ width: 0, opacity: 0 }}
                          transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                          className="hidden sm:inline text-xs font-medium overflow-hidden whitespace-nowrap"
                        >
                          {page.name}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </div>
                  </motion.button>

                  {/* Sub-page dropdown */}
                  <AnimatePresence>
                    {expandedParent === page.id && hasSubPages && (
                      <motion.div
                        ref={subMenuRef}
                        initial={{ opacity: 0, y: 8, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 6, scale: 0.97 }}
                        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                        className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 glass-card backdrop-blur-xl rounded-xl p-1.5 min-w-[140px] z-50"
                        style={{ boxShadow: '0 12px 40px oklch(0 0 0 / 0.35), 0 0 0 1px oklch(from var(--foreground) l c h / 0.06)' }}
                      >
                        {/* Parent page link */}
                        <button
                          onClick={() => handlePageSelect(page.id)}
                          className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-colors text-left ${
                            currentPageId === page.id ? 'bg-accent/15 text-accent' : 'text-foreground/60 hover:text-foreground hover:bg-foreground/5'
                          }`}
                        >
                          {Icon && <Icon size={15} weight={currentPageId === page.id ? 'fill' : 'regular'} />}
                          <span className="text-xs font-medium">{page.name}</span>
                        </button>
                        <div className="h-px bg-foreground/8 mx-1 my-1" />
                        {/* Sub-pages */}
                        {subPages.map(sub => {
                          const SubIcon = iconMap[sub.icon as keyof typeof iconMap]
                          return (
                            <button
                              key={sub.id}
                              onClick={() => handlePageSelect(sub.id)}
                              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-colors text-left ${
                                currentPageId === sub.id ? 'bg-accent/15 text-accent' : 'text-foreground/60 hover:text-foreground hover:bg-foreground/5'
                              }`}
                            >
                              {SubIcon && <SubIcon size={15} weight={currentPageId === sub.id ? 'fill' : 'regular'} />}
                              <span className="text-xs font-medium">{sub.name}</span>
                              {sub.displayMode === 'modal' && (
                                <span className="text-[9px] text-foreground/30 ml-auto">Modal</span>
                              )}
                            </button>
                          )
                        })}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )
            })}

            {/* More Pages Button */}
            {hasMorePages && !showAllPages && (
              <>
                <div className="w-px h-5 bg-foreground/8 mx-0.5" />
                <Tip content="Mehr Seiten">
                  <motion.button
                    onClick={() => setShowAllPages(true)}
                    className="min-w-[44px] min-h-[44px] px-3 py-2.5 sm:py-2 rounded-full text-foreground/40 hover:text-foreground/70 active:text-foreground/60 transition-colors duration-200 focus-ring flex items-center justify-center"
                    whileHover={{ scale: 1.06 }}
                    whileTap={{ scale: 0.92 }}
                  >
                    <DotsThree size={19} weight="bold" />
                  </motion.button>
                </Tip>
              </>
            )}

            {/* App Menu (9-dot grid) */}
            {appMenuPages.length > 0 && (
              <>
                <div className="w-px h-5 bg-foreground/8 mx-0.5" />
                <div className="relative" ref={appMenuRef}>
                  <Tip content="Apps & Features">
                    <motion.button
                      onClick={() => setShowAppMenu(!showAppMenu)}
                      className={`relative min-w-[44px] min-h-[44px] px-3 py-2.5 sm:py-2 rounded-full transition-colors duration-200 focus-ring flex items-center justify-center ${
                        showAppMenu || appMenuPageIds.includes(currentPageId)
                          ? 'text-accent'
                          : 'text-foreground/40 hover:text-foreground/70 active:text-foreground/60'
                      }`}
                      whileHover={{ scale: 1.06 }}
                      whileTap={{ scale: 0.92 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                    >
                    {appMenuPageIds.includes(currentPageId) && (
                      <motion.div
                        layoutId="navActiveIndicator"
                        className="absolute inset-0 rounded-full"
                        style={{
                          background: 'oklch(from var(--accent) l c h / 0.15)',
                          boxShadow: '0 0 16px oklch(from var(--accent) l c h / 0.12)',
                        }}
                        transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                      />
                    )}
                    <DotsNine size={19} weight={showAppMenu || appMenuPageIds.includes(currentPageId) ? 'fill' : 'regular'} className="relative" />
                  </motion.button>
                  </Tip>

                  {/* App Menu Popup */}
                  <AnimatePresence>
                    {showAppMenu && (
                      <motion.div
                        initial={{ opacity: 0, y: 8, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 6, scale: 0.97 }}
                        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                        className="absolute bottom-full right-0 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 mb-2 glass-card backdrop-blur-xl rounded-2xl p-3 min-w-[180px] z-50"
                        style={{ boxShadow: '0 12px 40px oklch(0 0 0 / 0.35), 0 0 0 1px oklch(from var(--foreground) l c h / 0.06)' }}
                      >
                        <p className="text-[10px] font-semibold text-foreground/30 uppercase tracking-wider px-2 mb-2">Apps & Features</p>
                        <div className="grid grid-cols-2 gap-1.5">
                          {appMenuPages.map((page, i) => {
                            const Icon = iconMap[page.icon as keyof typeof iconMap]
                            const isActive = currentPageId === page.id
                            return (
                              <motion.button
                                key={page.id}
                                onClick={() => { handlePageSelect(page.id); setShowAppMenu(false) }}
                                initial={{ opacity: 0, y: 6 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: i * 0.04 }}
                                className={`flex flex-col items-center gap-1.5 p-3 rounded-xl transition-all duration-200 ${
                                  isActive
                                    ? 'bg-accent/20 text-accent'
                                    : 'text-foreground/50 hover:text-foreground hover:bg-foreground/[0.06]'
                                }`}
                                whileHover={{ scale: 1.04 }}
                                whileTap={{ scale: 0.95 }}
                              >
                                {Icon && <Icon size={22} weight={isActive ? 'fill' : 'duotone'} />}
                                <span className="text-[10px] font-medium">{page.name}</span>
                              </motion.button>
                            )
                          })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </>
            )}

            {/* Settings Button */}
            {settingsPage && (
              <>
                <div className="w-px h-5 bg-foreground/8 mx-0.5" />
                <motion.button
                  onClick={() => handlePageSelect(settingsPage.id)}
                  className={`relative min-w-[44px] min-h-[44px] px-3 sm:px-3.5 py-2.5 sm:py-2 rounded-full transition-colors duration-200 focus-ring flex items-center justify-center ${
                    currentPageId === settingsPage.id
                      ? 'text-foreground'
                      : 'text-foreground/40 hover:text-foreground/70 active:text-foreground/60'
                  }`}
                  whileHover={{ scale: 1.06 }}
                  whileTap={{ scale: 0.92 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                >
                  {currentPageId === settingsPage.id && (
                    <motion.div
                      layoutId="navActiveIndicator"
                      className="absolute inset-0 rounded-full"
                      style={{
                        background: 'oklch(from var(--accent) l c h / 0.15)',
                        boxShadow: '0 0 16px oklch(from var(--accent) l c h / 0.12)',
                      }}
                      transition={{
                        type: 'spring',
                        stiffness: 400,
                        damping: 28,
                      }}
                    />
                  )}
                  <div className="relative flex items-center gap-2">
                    {iconMap[settingsPage.icon as keyof typeof iconMap] &&
                      (() => {
                        const SettingsIcon = iconMap[settingsPage.icon as keyof typeof iconMap]
                        return <SettingsIcon size={19} weight={currentPageId === settingsPage.id ? 'fill' : 'regular'} />
                      })()}
                    <AnimatePresence mode="popLayout">
                      {currentPageId === settingsPage.id && navLabels && (
                        <motion.span
                          initial={{ width: 0, opacity: 0 }}
                          animate={{ width: 'auto', opacity: 1 }}
                          exit={{ width: 0, opacity: 0 }}
                          transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                          className="hidden sm:inline text-xs font-medium overflow-hidden whitespace-nowrap"
                        >
                          {settingsPage.name}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.button>
              </>
            )}

            {/* Notification Bell */}
            <div className="w-px h-5 bg-foreground/8 mx-0.5" />
            <NotificationBell />

            {/* User Switch Button */}
            {user?.isAdmin && (
              <>
                <div className="w-px h-5 bg-foreground/8 mx-0.5" />
                <Tip content="Admin Panel">
                  <motion.button
                    onClick={() => handlePageSelect('admin')}
                    className={`relative min-w-[44px] min-h-[44px] px-3 py-2.5 sm:py-2 rounded-full transition-colors duration-200 focus-ring flex items-center justify-center ${
                      currentPageId === 'admin'
                        ? 'text-accent'
                        : 'text-foreground/40 hover:text-foreground/70 active:text-foreground/60'
                    }`}
                    whileHover={{ scale: 1.06 }}
                    whileTap={{ scale: 0.92 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                  >
                  {currentPageId === 'admin' && (
                    <motion.div
                      layoutId="navActiveIndicator"
                      className="absolute inset-0 rounded-full"
                      style={{
                        background: 'oklch(from var(--accent) l c h / 0.15)',
                        boxShadow: '0 0 16px oklch(from var(--accent) l c h / 0.12)',
                      }}
                      transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                    />
                  )}
                  <ShieldCheck size={19} weight={currentPageId === 'admin' ? 'fill' : 'regular'} className="relative" />
                </motion.button>
                </Tip>
              </>
            )}
            <div className="w-px h-5 bg-foreground/8 mx-0.5" />
            <motion.button
              onClick={() => setShowUserSwitcher(true)}
              className="min-w-[44px] min-h-[44px] px-3 py-2.5 sm:py-2 rounded-full text-foreground/40 hover:text-foreground/70 active:text-foreground/60 transition-colors duration-200 focus-ring flex items-center justify-center"
              whileHover={{ scale: 1.06 }}
              whileTap={{ scale: 0.92 }}
              transition={{ type: 'spring', stiffness: 500, damping: 25 }}
              title={user?.displayName || user?.username || 'Benutzer'}
            >
              {user ? (
                <div className="w-[22px] h-[22px] rounded-full bg-accent/20 flex items-center justify-center text-accent text-[10px] font-bold">
                  {(user.displayName || user.username || '?').charAt(0).toUpperCase()}
                </div>
              ) : (
                <UserCircle size={19} />
              )}
            </motion.button>

            {/* Sleep Mode Toggle */}
            <div className="w-px h-5 bg-foreground/8 mx-0.5" />
            <motion.button
              onClick={() => setSleepMode(!sleepMode)}
              className={`min-w-[44px] min-h-[44px] px-3 py-2.5 sm:py-2 rounded-full transition-all duration-300 focus-ring flex items-center justify-center ${
                sleepMode
                  ? 'text-accent'
                  : 'text-foreground/40 hover:text-foreground/70'
              }`}
              whileHover={{ scale: 1.06 }}
              whileTap={{ scale: 0.92 }}
              transition={{ type: 'spring', stiffness: 500, damping: 25 }}
            >
              <AnimatePresence mode="wait" initial={false}>
                {sleepMode ? (
                  <motion.div
                    key="moon"
                    initial={{ rotate: -90, opacity: 0 }}
                    animate={{ rotate: 0, opacity: 1 }}
                    exit={{ rotate: 90, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <Moon size={19} weight="fill" />
                  </motion.div>
                ) : (
                  <motion.div
                    key="sun"
                    initial={{ rotate: 90, opacity: 0 }}
                    animate={{ rotate: 0, opacity: 1 }}
                    exit={{ rotate: -90, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <Sun size={19} weight="regular" />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.button>
          </div>
            </div>
          </div>
        </motion.div>
      </motion.div>

      {/* Full Page Selector Overlay */}
      <AnimatePresence>
        {showAllPages && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setShowAllPages(false)}
              className="fixed inset-0 bg-black/50 backdrop-blur-md z-40"
            />
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 400, damping: 28 }}
              className="fixed bottom-20 sm:bottom-24 left-2 right-2 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 z-50 glass-card rounded-2xl p-4 sm:p-5 sm:max-w-md"
              style={{ boxShadow: '0 20px 60px oklch(0 0 0 / 0.35)' }}
            >
              <h3 className="text-sm font-semibold text-foreground mb-4 px-1">Alle Seiten</h3>
              <div className="grid grid-cols-3 sm:grid-cols-3 gap-1.5 sm:gap-2">
                {/* Top-level pages */}
                {visiblePages.map((page, i) => {
                  const Icon = iconMap[page.icon as keyof typeof iconMap]
                  const isActive = currentPageId === page.id
                  const subPages = getSubPages(page.id).filter(sp => sp.showInNav !== false)

                  return (
                    <div key={page.id} className="space-y-1">
                      <motion.button
                        onClick={() => handlePageSelect(page.id)}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.03 }}
                        className={`w-full p-3 rounded-xl transition-all duration-200 min-h-[64px] flex items-center justify-center ${
                          isActive
                            ? 'bg-accent/20 text-accent'
                            : 'text-foreground/50 hover:text-foreground hover:bg-foreground/5'
                        }`}
                        whileHover={{ scale: 1.04 }}
                        whileTap={{ scale: 0.95 }}
                      >
                        <div className="flex flex-col items-center gap-2">
                          {Icon && <Icon size={22} weight={isActive ? 'fill' : 'regular'} />}
                          <span className="text-xs font-medium text-center line-clamp-1">
                            {page.name}
                          </span>
                        </div>
                      </motion.button>
                      {/* Sub-pages listed below parent */}
                      {subPages.map(sub => {
                        const SubIcon = iconMap[sub.icon as keyof typeof iconMap]
                        const isSubActive = currentPageId === sub.id
                        return (
                          <button
                            key={sub.id}
                            onClick={() => handlePageSelect(sub.id)}
                            className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[10px] transition-colors ${
                              isSubActive ? 'bg-accent/15 text-accent' : 'text-foreground/40 hover:text-foreground/60 hover:bg-foreground/5'
                            }`}
                          >
                            {SubIcon && <SubIcon size={12} />}
                            <span className="truncate">{sub.name}</span>
                          </button>
                        )
                      })}
                    </div>
                  )
                })}
                {/* Pages hidden from nav (for discovery) */}
                {pages.filter(p => p.showInNav === false && p.id !== 'settings' && !p.parentPageId).map((page, i) => {
                  const Icon = iconMap[page.icon as keyof typeof iconMap]
                  const isActive = currentPageId === page.id
                  return (
                    <motion.button
                      key={page.id}
                      onClick={() => handlePageSelect(page.id)}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: (visiblePages.length + i) * 0.03 }}
                      className={`p-3 rounded-xl transition-all duration-200 min-h-[64px] flex items-center justify-center border border-dashed border-foreground/10 ${
                        isActive
                          ? 'bg-accent/20 text-accent'
                          : 'text-foreground/30 hover:text-foreground/50 hover:bg-foreground/5'
                      }`}
                      whileHover={{ scale: 1.04 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      <div className="flex flex-col items-center gap-2">
                        {Icon && <Icon size={22} weight={isActive ? 'fill' : 'regular'} />}
                        <span className="text-xs font-medium text-center line-clamp-1">
                          {page.name}
                        </span>
                        <span className="text-[8px] text-foreground/25 uppercase">Versteckt</span>
                      </div>
                    </motion.button>
                  )
                })}
              </div>
              <motion.button
                onClick={() => setShowAllPages(false)}
                className="mt-4 w-full py-2 text-xs text-foreground/40 hover:text-foreground/60 transition-colors"
                whileTap={{ scale: 0.98 }}
              >
                Schließen
              </motion.button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* User Switcher */}
      <AnimatePresence>
        {showUserSwitcher && (
          <UserSwitcher open={showUserSwitcher} onClose={() => setShowUserSwitcher(false)} />
        )}
      </AnimatePresence>
    </>
  )
}
