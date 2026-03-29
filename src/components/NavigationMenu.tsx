import { motion, AnimatePresence } from 'framer-motion'
import { usePageNavigation, iconMap } from '@/contexts/PageNavigationContext'
import { useTheme } from '@/contexts/ThemeContext'
import { Moon, Sun, DotsThree } from '@phosphor-icons/react'
import { useState } from 'react'

export function NavigationMenu({ hidden }: { hidden?: boolean }) {
  const { currentPageId, setCurrentPageId, pages } = usePageNavigation()
  const { sleepMode, setSleepMode } = useTheme()
  const [showAllPages, setShowAllPages] = useState(false)

  // Filter pages that should be shown in nav (and show settings separately)
  const visiblePages = pages.filter(p => p.showInNav !== false && p.id !== 'settings')
  const settingsPage = pages.find(p => p.id === 'settings')

  // Show max 5 pages in compact mode
  const compactPageLimit = 5
  const displayPages = showAllPages ? visiblePages : visiblePages.slice(0, compactPageLimit)
  const hasMorePages = visiblePages.length > compactPageLimit

  if (hidden) return null

  return (
    <>
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50"
      >
        <div className="glass-card rounded-full px-3 py-2.5 theme-transition">
          <div className="flex items-center gap-1.5">
            {displayPages.map((page) => {
              const Icon = iconMap[page.icon as keyof typeof iconMap]
              const isActive = currentPageId === page.id

              return (
                <motion.button
                  key={page.id}
                  onClick={() => setCurrentPageId(page.id)}
                  className={`relative px-3 py-2 rounded-full transition-all duration-300 ${
                    isActive
                      ? 'text-foreground'
                      : 'text-foreground/50 hover:text-foreground/80'
                  }`}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <AnimatePresence mode="wait">
                    {isActive && (
                      <motion.div
                        layoutId="activeBackground"
                        className="absolute inset-0 bg-accent/20 rounded-full"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{
                          type: 'spring',
                          stiffness: 500,
                          damping: 30,
                        }}
                      />
                    )}
                  </AnimatePresence>
                  <div className="relative flex items-center gap-2">
                    {Icon && <Icon size={20} weight={isActive ? 'fill' : 'regular'} />}
                    {isActive && (
                      <motion.span
                        initial={{ width: 0, opacity: 0 }}
                        animate={{ width: 'auto', opacity: 1 }}
                        exit={{ width: 0, opacity: 0 }}
                        className="text-xs font-medium overflow-hidden whitespace-nowrap"
                      >
                        {page.name}
                      </motion.span>
                    )}
                  </div>
                </motion.button>
              )
            })}

            {/* More Pages Button */}
            {hasMorePages && !showAllPages && (
              <>
                <div className="w-px h-6 bg-foreground/10 mx-1" />
                <motion.button
                  onClick={() => setShowAllPages(true)}
                  className="px-3 py-2 rounded-full text-foreground/50 hover:text-foreground/80 transition-all duration-300"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  title="Mehr Seiten"
                >
                  <DotsThree size={20} weight="bold" />
                </motion.button>
              </>
            )}

            {/* Settings Button */}
            {settingsPage && (
              <>
                <div className="w-px h-6 bg-foreground/10 mx-1" />
                <motion.button
                  onClick={() => setCurrentPageId(settingsPage.id)}
                  className={`relative px-3 py-2 rounded-full transition-all duration-300 ${
                    currentPageId === settingsPage.id
                      ? 'text-foreground'
                      : 'text-foreground/50 hover:text-foreground/80'
                  }`}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <AnimatePresence mode="wait">
                    {currentPageId === settingsPage.id && (
                      <motion.div
                        layoutId="activeBackground"
                        className="absolute inset-0 bg-accent/20 rounded-full"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{
                          type: 'spring',
                          stiffness: 500,
                          damping: 30,
                        }}
                      />
                    )}
                  </AnimatePresence>
                  <div className="relative flex items-center gap-2">
                    {iconMap[settingsPage.icon as keyof typeof iconMap] &&
                      (() => {
                        const SettingsIcon = iconMap[settingsPage.icon as keyof typeof iconMap]
                        return <SettingsIcon size={20} weight={currentPageId === settingsPage.id ? 'fill' : 'regular'} />
                      })()}
                    {currentPageId === settingsPage.id && (
                      <motion.span
                        initial={{ width: 0, opacity: 0 }}
                        animate={{ width: 'auto', opacity: 1 }}
                        exit={{ width: 0, opacity: 0 }}
                        className="text-xs font-medium overflow-hidden whitespace-nowrap"
                      >
                        {settingsPage.name}
                      </motion.span>
                    )}
                  </div>
                </motion.button>
              </>
            )}

            {/* Sleep Mode Toggle */}
            <div className="w-px h-6 bg-foreground/10 mx-1" />
            <motion.button
              onClick={() => setSleepMode(!sleepMode)}
              className={`px-3 py-2 rounded-full transition-all duration-300 ${
                sleepMode
                  ? 'text-accent bg-accent/20'
                  : 'text-foreground/50 hover:text-foreground/80'
              }`}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              {sleepMode ? <Moon size={20} weight="fill" /> : <Sun size={20} weight="regular" />}
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
              onClick={() => setShowAllPages(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
            />
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 glass-card rounded-2xl p-4 max-w-md"
            >
              <h3 className="text-sm font-semibold text-foreground mb-3 px-2">Alle Seiten</h3>
              <div className="grid grid-cols-3 gap-2">
                {visiblePages.map(page => {
                  const Icon = iconMap[page.icon as keyof typeof iconMap]
                  const isActive = currentPageId === page.id

                  return (
                    <motion.button
                      key={page.id}
                      onClick={() => {
                        setCurrentPageId(page.id)
                        setShowAllPages(false)
                      }}
                      className={`p-3 rounded-xl transition-all ${
                        isActive
                          ? 'bg-accent/20 text-accent'
                          : 'text-foreground/60 hover:text-foreground hover:bg-foreground/5'
                      }`}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      <div className="flex flex-col items-center gap-2">
                        {Icon && <Icon size={24} weight={isActive ? 'fill' : 'regular'} />}
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
                className="mt-3 w-full py-2 text-xs text-foreground/50 hover:text-foreground transition-colors"
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
