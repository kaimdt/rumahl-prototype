import { motion, AnimatePresence } from 'framer-motion'
import { usePageNavigation, iconMap } from '@/contexts/PageNavigationContext'
import { useTheme } from '@/contexts/ThemeContext'
import { Moon, Sun } from '@phosphor-icons/react'

export function NavigationMenu() {
  const { currentPageId, setCurrentPageId, pages } = usePageNavigation()
  const { sleepMode, setSleepMode } = useTheme()

  return (
    <motion.div
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50"
    >
      <div className="glass-card rounded-full px-3 py-2.5 theme-transition">
        <div className="flex items-center gap-1.5">
          {pages.map((page, index) => {
            const Icon = iconMap[page.icon as keyof typeof iconMap]
            const isActive = currentPageId === page.id
            const isSetting = page.id === 'settings'

            if (isSetting) {
              return (
                <div key={page.id} className="flex items-center gap-1.5">
                  <div className="w-px h-6 bg-foreground/10 mx-1" />
                  <motion.button
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
                      <Icon size={20} weight={isActive ? 'fill' : 'regular'} />
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
                </div>
              )
            }

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
                  <Icon size={20} weight={isActive ? 'fill' : 'regular'} />
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
  )
}
