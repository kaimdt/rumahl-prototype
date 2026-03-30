import { motion, AnimatePresence } from 'framer-motion'
import { usePageNavigation, iconMap } from '@/contexts/PageNavigationContext'
import { useTheme } from '@/contexts/ThemeContext'
import { Moon, Sun, DotsThree } from '@phosphor-icons/react'
import { useState, useCallback } from 'react'

export function NavigationMenu({ hidden }: { hidden?: boolean }) {
  const { currentPageId, setCurrentPageId, pages } = usePageNavigation()
  const { sleepMode, setSleepMode, theme } = useTheme()
  const [showAllPages, setShowAllPages] = useState(false)

  // Filter pages that should be shown in nav (and show settings separately)
  const visiblePages = pages.filter(p => p.showInNav !== false && p.id !== 'settings')
  const settingsPage = pages.find(p => p.id === 'settings')

  // Show max 5 pages in compact mode
  const compactPageLimit = 5
  const displayPages = showAllPages ? visiblePages : visiblePages.slice(0, compactPageLimit)
  const hasMorePages = visiblePages.length > compactPageLimit

  const handlePageSelect = useCallback((id: string) => {
    setCurrentPageId(id)
    setShowAllPages(false)
  }, [setCurrentPageId])

  if (hidden) return null

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
        <div className="glass-card rounded-full px-1.5 sm:px-2.5 py-1.5 sm:py-2 theme-transition" style={{ boxShadow: '0 8px 40px oklch(0 0 0 / 0.25), 0 0 0 1px oklch(from var(--foreground) l c h / 0.06)' }}>
          <div className="flex items-center gap-0.5 sm:gap-1">
            {displayPages.map((page) => {
              const Icon = iconMap[page.icon as keyof typeof iconMap]
              const isActive = currentPageId === page.id

              return (
                <motion.button
                  key={page.id}
                  onClick={() => handlePageSelect(page.id)}
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
                  <div className="relative flex items-center gap-2">
                    {Icon && <Icon size={19} weight={isActive ? 'fill' : 'regular'} />}
                    <AnimatePresence mode="popLayout">
                      {isActive && (
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
              )
            })}

            {/* More Pages Button */}
            {hasMorePages && !showAllPages && (
              <>
                <div className="w-px h-5 bg-foreground/8 mx-0.5" />
                <motion.button
                  onClick={() => setShowAllPages(true)}
                  className="min-w-[44px] min-h-[44px] px-3 py-2.5 sm:py-2 rounded-full text-foreground/40 hover:text-foreground/70 active:text-foreground/60 transition-colors duration-200 focus-ring flex items-center justify-center"
                  whileHover={{ scale: 1.06 }}
                  whileTap={{ scale: 0.92 }}
                  title="Mehr Seiten"
                >
                  <DotsThree size={19} weight="bold" />
                </motion.button>
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
                      {currentPageId === settingsPage.id && (
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
                {visiblePages.map((page, i) => {
                  const Icon = iconMap[page.icon as keyof typeof iconMap]
                  const isActive = currentPageId === page.id

                  return (
                    <motion.button
                      key={page.id}
                      onClick={() => handlePageSelect(page.id)}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.03 }}
                      className={`p-3 rounded-xl transition-all duration-200 min-h-[64px] flex items-center justify-center ${
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
    </>
  )
}
