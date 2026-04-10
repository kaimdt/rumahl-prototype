import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '@/contexts/AuthContext'
import { User, ArrowLeft, Backspace, SignOut } from '@phosphor-icons/react'
import { toast } from 'sonner'

interface UserListEntry {
  id: string
  username: string
  display_name?: string
  avatar_url?: string
  has_pin: boolean
}

interface UserSwitcherProps {
  open: boolean
  onClose: () => void
}

export function UserSwitcher({ open, onClose }: UserSwitcherProps) {
  const { user, loginWithPin, logout } = useAuth()
  const [users, setUsers] = useState<UserListEntry[]>([])
  const [selectedUser, setSelectedUser] = useState<UserListEntry | null>(null)
  const [pin, setPin] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!open) {
      setSelectedUser(null)
      setPin('')
      return
    }
    fetch('/api/auth/users')
      .then(res => res.ok ? res.json() : [])
      .then((data: UserListEntry[]) => setUsers(data))
      .catch(() => {})
  }, [open])

  const handlePinSubmit = useCallback(async (fullPin: string) => {
    if (!selectedUser) return
    setIsLoading(true)
    try {
      await loginWithPin(selectedUser.id, fullPin)
      toast.success(`Willkommen, ${selectedUser.display_name || selectedUser.username}!`)
      onClose()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'PIN falsch'
      toast.error(message)
      setPin('')
    } finally {
      setIsLoading(false)
    }
  }, [selectedUser, loginWithPin, onClose])

  const addDigit = useCallback((digit: string) => {
    setPin(prev => {
      const next = prev + digit
      if (next.length >= 6) {
        handlePinSubmit(next)
        return ''
      }
      return next
    })
  }, [handlePinSubmit])

  const removeDigit = useCallback(() => {
    setPin(prev => prev.slice(0, -1))
  }, [])

  useEffect(() => {
    if (!open || !selectedUser) return
    const handler = (e: KeyboardEvent) => {
      if (isLoading) return
      if (e.key >= '0' && e.key <= '9') addDigit(e.key)
      else if (e.key === 'Backspace') removeDigit()
      else if (e.key === 'Escape') {
        e.preventDefault()
        setSelectedUser(null)
        setPin('')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, selectedUser, addDigit, removeDigit, isLoading])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !selectedUser) onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, selectedUser, onClose])

  if (!open) return null

  const otherUsers = users.filter(u => u.id !== user?.id && u.has_pin)

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60]"
      />
      <motion.div
        initial={{ opacity: 0, y: 40, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 30, scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[60] glass-card backdrop-blur-xl rounded-2xl p-4 min-w-[280px] max-w-[340px] w-full"
        style={{ boxShadow: '0 16px 60px oklch(0 0 0 / 0.4), 0 0 0 1px oklch(from var(--foreground) l c h / 0.06)' }}
      >
        <AnimatePresence mode="wait">
          {selectedUser ? (
            <motion.div
              key="pinpad"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-3"
            >
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setSelectedUser(null); setPin('') }}
                  className="p-1.5 rounded-lg hover:bg-foreground/10 transition-colors"
                  disabled={isLoading}
                >
                  <ArrowLeft size={16} />
                </button>
                <span className="text-sm text-foreground/70">
                  PIN für <strong>{selectedUser.display_name || selectedUser.username}</strong>
                </span>
              </div>

              <div className="flex justify-center gap-2 py-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className={`w-2.5 h-2.5 rounded-full transition-all duration-200 ${
                      i < pin.length ? 'bg-accent scale-110' : 'bg-foreground/15'
                    }`}
                  />
                ))}
              </div>

              <div className="grid grid-cols-3 gap-1.5 max-w-[200px] mx-auto">
                {['1','2','3','4','5','6','7','8','9'].map(d => (
                  <button
                    key={d}
                    onClick={() => addDigit(d)}
                    disabled={isLoading}
                    className="h-11 rounded-xl bg-foreground/5 hover:bg-foreground/10 active:bg-foreground/15 text-lg font-medium transition-colors disabled:opacity-50"
                  >
                    {d}
                  </button>
                ))}
                <div />
                <button
                  onClick={() => addDigit('0')}
                  disabled={isLoading}
                  className="h-11 rounded-xl bg-foreground/5 hover:bg-foreground/10 active:bg-foreground/15 text-lg font-medium transition-colors disabled:opacity-50"
                >
                  0
                </button>
                <button
                  onClick={removeDigit}
                  disabled={isLoading || pin.length === 0}
                  className="h-11 rounded-xl bg-foreground/5 hover:bg-foreground/10 active:bg-foreground/15 flex items-center justify-center transition-colors disabled:opacity-30"
                >
                  <Backspace size={18} />
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="userlist"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-3"
            >
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-foreground/50">Benutzer wechseln</p>
                <button
                  onClick={onClose}
                  className="text-xs text-foreground/40 hover:text-foreground/60 transition-colors"
                >
                  Schließen
                </button>
              </div>

              {/* Current user */}
              {user && (
                <div className="flex items-center gap-3 p-2.5 rounded-xl bg-accent/10 border border-accent/15">
                  <div className="w-9 h-9 rounded-full bg-accent/20 flex items-center justify-center text-accent font-bold text-sm">
                    {(user.displayName || user.username).charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{user.displayName || user.username}</p>
                    <p className="text-[10px] text-foreground/40">Aktiver Benutzer</p>
                  </div>
                </div>
              )}

              {/* Other users with PIN */}
              {otherUsers.length > 0 ? (
                <div className="space-y-1">
                  {otherUsers.map(u => (
                    <button
                      key={u.id}
                      onClick={() => setSelectedUser(u)}
                      className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-foreground/5 active:bg-foreground/8 transition-colors"
                    >
                      <div className="w-9 h-9 rounded-full bg-foreground/10 flex items-center justify-center font-bold text-sm text-foreground/50">
                        {u.avatar_url ? (
                          <img src={u.avatar_url} alt="" className="w-full h-full rounded-full object-cover" />
                        ) : (
                          (u.display_name || u.username).charAt(0).toUpperCase()
                        )}
                      </div>
                      <span className="text-sm truncate">{u.display_name || u.username}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-foreground/40 py-2">
                  Keine weiteren Benutzer mit PIN verfügbar.
                </p>
              )}

              <button
                onClick={() => { logout(); onClose() }}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-red-500/8 hover:bg-red-500/15 text-red-400 text-xs font-medium transition-colors"
              >
                <SignOut size={14} weight="bold" />
                Abmelden
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </>
  )
}
