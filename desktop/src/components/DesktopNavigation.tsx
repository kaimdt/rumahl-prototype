import { motion } from 'framer-motion'
import { Gear, Robot, House, Moon, Sun, Globe, Terminal, Shield } from '@phosphor-icons/react'
import { useState } from 'react'

export type NavId = "ai" | "iora-home" | "connection" | "settings"

interface Props {
  active: NavId
  onChange: (id: NavId) => void
  sleepMode: boolean
  onSleepModeToggle: () => void
  user?: { username: string; display_name?: string } | null
  onUserClick?: () => void
  onSystemLogToggle?: () => void
  onSystemControlToggle?: () => void
}

const TABS = [
  { id: "ai" as NavId, label: "KI", Icon: Robot },
  { id: "iora-home" as NavId, label: "IORA Home", Icon: House },
  { id: "connection" as NavId, label: "Verbindung", Icon: Globe },
  { id: "settings" as NavId, label: "Einstellungen", Icon: Gear },
]

export function DesktopNavigation({ active, onChange, sleepMode, onSleepModeToggle, user, onUserClick, onSystemLogToggle, onSystemControlToggle }: Props) {
  return (
    <motion.div
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 28, delay: 0.2 }}
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50"
    >
      <motion.div
        className="relative overflow-visible"
        style={{
          boxShadow: '0 8px 40px oklch(0 0 0 / 0.25), 0 0 0 1px oklch(from var(--foreground) l c h / 0.06)',
          borderRadius: 9999
        }}
      >
        <div className="absolute inset-0 glass-card" style={{ borderRadius: 'inherit' }} />

        <div className="relative z-[1] px-2.5 py-2">
          <div className="flex items-center gap-1">
            {TABS.map((tab) => {
              const isActive = active === tab.id
              return (
                <motion.button
                  key={tab.id}
                  onClick={() => onChange(tab.id)}
                  className={`relative min-w-[44px] min-h-[44px] px-3.5 py-2 rounded-full transition-colors duration-200 flex items-center justify-center ${
                    isActive
                      ? 'text-foreground'
                      : 'text-foreground/40 hover:text-foreground/70'
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
                    <tab.Icon size={19} weight={isActive ? 'fill' : 'regular'} />
                  </div>
                </motion.button>
              )
            })}

            <div className="w-px h-5 bg-foreground/8 mx-0.5" />

            {/* User button */}
            {user && (
              <>
                <motion.button
                  onClick={onUserClick}
                  className="min-w-[44px] min-h-[44px] px-3 py-2 rounded-full text-foreground/40 hover:text-foreground/70 transition-colors duration-200 flex items-center justify-center"
                  whileHover={{ scale: 1.06 }}
                  whileTap={{ scale: 0.92 }}
                  title={user.display_name || user.username}
                >
                  <div className="w-[22px] h-[22px] rounded-full bg-accent/20 flex items-center justify-center text-accent text-[10px] font-bold">
                    {(user.display_name || user.username || '?').charAt(0).toUpperCase()}
                  </div>
                </motion.button>
                <div className="w-px h-5 bg-foreground/8 mx-0.5" />
              </>
            )}

            {/* System Log toggle */}
            {onSystemLogToggle && (
              <motion.button
                onClick={onSystemLogToggle}
                className="min-w-[44px] min-h-[44px] px-3 py-2 rounded-full text-foreground/40 hover:text-emerald-400 transition-colors duration-200 flex items-center justify-center"
                whileHover={{ scale: 1.06 }}
                whileTap={{ scale: 0.92 }}
                title="System Live Log"
              >
                <Terminal size={19} weight="regular" />
              </motion.button>
            )}

            <div className="w-px h-5 bg-foreground/8 mx-0.5" />

            {/* Sleep mode toggle */}
            <motion.button
              onClick={onSleepModeToggle}
              className={`min-w-[44px] min-h-[44px] px-3 py-2 rounded-full transition-all duration-300 flex items-center justify-center ${
                sleepMode
                  ? 'text-accent'
                  : 'text-foreground/40 hover:text-foreground/70'
              }`}
              whileHover={{ scale: 1.06 }}
              whileTap={{ scale: 0.92 }}
              transition={{ type: 'spring', stiffness: 500, damping: 25 }}
            >
              {sleepMode ? (
                <motion.div
                  key="moon"
                  initial={{ rotate: -90, opacity: 0 }}
                  animate={{ rotate: 0, opacity: 1 }}
                  transition={{ duration: 0.2 }}
                >
                  <Moon size={19} weight="fill" />
                </motion.div>
              ) : (
                <motion.div
                  key="sun"
                  initial={{ rotate: 90, opacity: 0 }}
                  animate={{ rotate: 0, opacity: 1 }}
                  transition={{ duration: 0.2 }}
                >
                  <Sun size={19} weight="regular" />
                </motion.div>
              )}
            </motion.button>

            <div className="w-px h-5 bg-foreground/8 mx-0.5" />

            {/* System Log toggle */}
            {onSystemLogToggle && (
              <motion.button
                onClick={onSystemLogToggle}
                className="min-w-[44px] min-h-[44px] px-3 py-2 rounded-full text-foreground/40 hover:text-emerald-400 transition-colors duration-200 flex items-center justify-center"
                whileHover={{ scale: 1.06 }}
                whileTap={{ scale: 0.92 }}
                title="System Live Log"
              >
                <Terminal size={19} weight="regular" />
              </motion.button>
            )}

            {/* System Guard toggle */}
            {onSystemControlToggle && (
              <motion.button
                onClick={onSystemControlToggle}
                className="min-w-[44px] min-h-[44px] px-3 py-2 rounded-full text-foreground/40 hover:text-amber-400 transition-colors duration-200 flex items-center justify-center"
                whileHover={{ scale: 1.06 }}
                whileTap={{ scale: 0.92 }}
                title="System Guard"
              >
                <Shield size={19} weight="regular" />
              </motion.button>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
