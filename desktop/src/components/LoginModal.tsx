import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '@/contexts/AuthContext'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { User, Lock, UserPlus, NumberCircleOne, Backspace, ArrowLeft, ShieldCheck } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Switch } from '@/components/ui/switch'

interface UserListEntry {
  id: string
  username: string
  display_name?: string
  avatar_url?: string
  has_pin: boolean
}

interface LoginModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function PinPad({ onSubmit, onBack, userName, isLoading }: {
  onSubmit: (pin: string) => void
  onBack: () => void
  userName: string
  isLoading: boolean
}) {
  const [pin, setPin] = useState('')

  const addDigit = useCallback((digit: string) => {
    setPin(prev => {
      const next = prev + digit
      if (next.length >= 6) {
        onSubmit(next)
        return ''
      }
      return next
    })
  }, [onSubmit])

  const removeDigit = useCallback(() => {
    setPin(prev => prev.slice(0, -1))
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isLoading) return
      if (e.key >= '0' && e.key <= '9') addDigit(e.key)
      else if (e.key === 'Backspace') removeDigit()
      else if (e.key === 'Escape') onBack()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [addDigit, removeDigit, onBack, isLoading])

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="space-y-5"
    >
      <div className="flex items-center gap-2.5 mb-2">
        <button
          onClick={onBack}
          className="p-2 rounded-xl hover:bg-foreground/8 active:bg-foreground/12 transition-colors"
          disabled={isLoading}
        >
          <ArrowLeft size={18} />
        </button>
        <span className="text-sm text-foreground/70">PIN für <strong className="text-foreground">{userName}</strong></span>
      </div>

      <div className="flex justify-center gap-2.5 py-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <motion.div
            key={i}
            animate={i < pin.length ? { scale: [1, 1.3, 1] } : {}}
            transition={{ duration: 0.2 }}
            className={`w-3.5 h-3.5 rounded-full transition-all duration-200 ${
              i < pin.length ? 'bg-accent shadow-[0_0_8px_oklch(from_var(--accent)_l_c_h_/_0.4)]' : 'bg-foreground/12 border border-foreground/8'
            }`}
          />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2.5 max-w-[260px] mx-auto">
        {['1','2','3','4','5','6','7','8','9'].map(d => (
          <motion.button
            key={d}
            onClick={() => addDigit(d)}
            disabled={isLoading}
            whileTap={{ scale: 0.92 }}
            className="h-14 rounded-2xl bg-foreground/5 hover:bg-foreground/10 active:bg-accent/12 text-xl font-medium transition-colors disabled:opacity-50 border border-foreground/5"
          >
            {d}
          </motion.button>
        ))}
        <div />
        <motion.button
          onClick={() => addDigit('0')}
          disabled={isLoading}
          whileTap={{ scale: 0.92 }}
          className="h-14 rounded-2xl bg-foreground/5 hover:bg-foreground/10 active:bg-accent/12 text-xl font-medium transition-colors disabled:opacity-50 border border-foreground/5"
        >
          0
        </motion.button>
        <motion.button
          onClick={removeDigit}
          disabled={isLoading || pin.length === 0}
          whileTap={{ scale: 0.92 }}
          className="h-14 rounded-2xl bg-foreground/5 hover:bg-foreground/10 active:bg-destructive/12 flex items-center justify-center transition-colors disabled:opacity-30 border border-foreground/5"
        >
          <Backspace size={22} />
        </motion.button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center gap-2 py-2">
          <div className="w-4 h-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
          <p className="text-sm text-foreground/60">Anmeldung...</p>
        </div>
      )}
    </motion.div>
  )
}

export function LoginModal({ open, onOpenChange }: LoginModalProps) {
  const { login, loginWithPin, register } = useAuth()
  const [isLoading, setIsLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'login' | 'register' | 'pin'>('login')

  // PIN login state
  const [users, setUsers] = useState<UserListEntry[]>([])
  const [selectedUser, setSelectedUser] = useState<UserListEntry | null>(null)
  const [usersLoaded, setUsersLoaded] = useState(false)

  // Login form state
  const [loginUsername, setLoginUsername] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(true)

  // Register form state
  const [registerUsername, setRegisterUsername] = useState('')
  const [registerPassword, setRegisterPassword] = useState('')
  const [registerPasswordConfirm, setRegisterPasswordConfirm] = useState('')
  const [registerDisplayName, setRegisterDisplayName] = useState('')

  // Load users when PIN tab is selected
  useEffect(() => {
    if (activeTab === 'pin' && !usersLoaded) {
      fetch('/api/auth/users')
        .then(res => res.ok ? res.json() : [])
        .then((data: UserListEntry[]) => {
          setUsers(data)
          setUsersLoaded(true)
        })
        .catch(() => setUsersLoaded(true))
    }
  }, [activeTab, usersLoaded])

  const handlePinLogin = useCallback(async (pin: string) => {
    if (!selectedUser) return
    setIsLoading(true)
    try {
      await loginWithPin(selectedUser.id, pin)
      toast.success(`Willkommen, ${selectedUser.display_name || selectedUser.username}!`)
      onOpenChange(false)
      setSelectedUser(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'PIN falsch'
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }, [selectedUser, loginWithPin, onOpenChange])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!loginUsername.trim() || !loginPassword) {
      toast.error('Bitte Benutzername und Passwort eingeben')
      return
    }

    setIsLoading(true)
    try {
      await login(loginUsername.trim(), loginPassword, rememberMe)
      toast.success('Erfolgreich angemeldet')
      onOpenChange(false)
      // Reset form
      setLoginUsername('')
      setLoginPassword('')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Anmeldung fehlgeschlagen'
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!registerUsername.trim() || !registerPassword) {
      toast.error('Bitte Benutzername und Passwort eingeben')
      return
    }

    if (registerPassword !== registerPasswordConfirm) {
      toast.error('Passwörter stimmen nicht überein')
      return
    }

    if (registerPassword.length < 8) {
      toast.error('Passwort muss mindestens 8 Zeichen lang sein')
      return
    }

    setIsLoading(true)
    try {
      await register(
        registerUsername.trim(),
        registerPassword,
        registerDisplayName.trim() || undefined
      )
      toast.success('Konto erstellt und angemeldet')
      onOpenChange(false)
      // Reset form
      setRegisterUsername('')
      setRegisterPassword('')
      setRegisterPasswordConfirm('')
      setRegisterDisplayName('')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Registrierung fehlgeschlagen'
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="sm:max-w-[460px] border-foreground/10 p-0 gap-0 overflow-hidden"
        hideCloseButton
        hideExpandButton
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        {/* Accent gradient header */}
        <div className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-accent/20 via-accent/8 to-transparent" />
          <DialogHeader className="relative p-6 pb-5">
            <DialogTitle className="flex items-center gap-3.5 text-foreground">
              <div className="p-2.5 rounded-2xl bg-accent/15 ring-1 ring-accent/20">
                <ShieldCheck size={24} weight="duotone" className="text-accent" />
              </div>
              <div>
                <span className="text-lg font-semibold block">Willkommen</span>
                <span className="text-xs font-normal text-foreground/50">Melden Sie sich an oder erstellen Sie ein Konto</span>
              </div>
            </DialogTitle>
            <DialogDescription className="sr-only">
              Melden Sie sich an oder erstellen Sie ein neues Konto
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="border-t border-foreground/8" />

        <div className="p-6 pt-5">
          <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v as 'login' | 'register' | 'pin'); setSelectedUser(null) }}>
            <TabsList className="w-full grid grid-cols-3 mb-6 rounded-2xl bg-foreground/5 p-1 h-auto gap-1">
              <TabsTrigger value="pin" className="rounded-xl py-2.5 text-xs font-medium data-[state=active]:bg-accent/15 data-[state=active]:text-accent data-[state=active]:shadow-sm transition-all">
                <NumberCircleOne size={15} weight="bold" className="mr-1" />
                PIN
              </TabsTrigger>
              <TabsTrigger value="login" className="rounded-xl py-2.5 text-xs font-medium data-[state=active]:bg-accent/15 data-[state=active]:text-accent data-[state=active]:shadow-sm transition-all">
                <Lock size={15} weight="bold" className="mr-1" />
                Anmelden
              </TabsTrigger>
              <TabsTrigger value="register" className="rounded-xl py-2.5 text-xs font-medium data-[state=active]:bg-accent/15 data-[state=active]:text-accent data-[state=active]:shadow-sm transition-all">
                <UserPlus size={15} weight="bold" className="mr-1" />
                Neu
              </TabsTrigger>
            </TabsList>

            <TabsContent value="pin">
              <AnimatePresence mode="wait">
                {selectedUser ? (
                  <PinPad
                    key="pinpad"
                    onSubmit={handlePinLogin}
                    onBack={() => setSelectedUser(null)}
                    userName={selectedUser.display_name || selectedUser.username}
                    isLoading={isLoading}
                  />
                ) : (
                  <motion.div
                    key="userlist"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="space-y-2"
                  >
                    {!usersLoaded ? (
                      <p className="text-center text-sm text-foreground/60 py-8">Benutzer werden geladen...</p>
                    ) : users.filter(u => u.has_pin).length === 0 ? (
                      <div className="text-center py-8 space-y-2">
                        <p className="text-sm text-foreground/60">Kein Benutzer hat eine PIN eingerichtet.</p>
                        <p className="text-xs text-foreground/40">PINs können in den Profileinstellungen konfiguriert werden.</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        {users.filter(u => u.has_pin).map(u => (
                          <button
                            key={u.id}
                            onClick={() => setSelectedUser(u)}
                            className="flex flex-col items-center gap-2.5 p-4 rounded-2xl bg-foreground/4 hover:bg-accent/8 active:bg-accent/12 transition-all border border-foreground/5 hover:border-accent/15"
                          >
                            <div className="w-14 h-14 rounded-2xl bg-accent/12 ring-1 ring-accent/15 flex items-center justify-center text-accent font-bold text-lg">
                              {u.avatar_url ? (
                                <img src={u.avatar_url} alt="" className="w-full h-full rounded-full object-cover" />
                              ) : (
                                (u.display_name || u.username).charAt(0).toUpperCase()
                              )}
                            </div>
                            <span className="text-sm font-medium truncate max-w-full">
                              {u.display_name || u.username}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </TabsContent>

            <TabsContent value="login">
              <motion.form
                onSubmit={handleLogin}
                className="space-y-4"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
              >
                <div className="space-y-2 rounded-2xl bg-foreground/4 p-4 border border-foreground/5">
                  <Label htmlFor="login-username" className="text-xs font-medium text-foreground/60">Benutzername</Label>
                  <Input
                    id="login-username"
                    type="text"
                    placeholder="Ihr Benutzername"
                    value={loginUsername}
                    onChange={(e) => setLoginUsername(e.target.value)}
                    disabled={isLoading}
                    autoComplete="username"
                    required
                  />
                </div>

                <div className="space-y-2 rounded-2xl bg-foreground/4 p-4 border border-foreground/5">
                  <Label htmlFor="login-password" className="text-xs font-medium text-foreground/60">Passwort</Label>
                  <Input
                    id="login-password"
                    type="password"
                    placeholder="Ihr Passwort"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    disabled={isLoading}
                    autoComplete="current-password"
                    required
                  />
                </div>

                <div className="flex items-center justify-between rounded-2xl bg-foreground/4 px-4 py-3 border border-foreground/5">
                  <div>
                    <p className="text-sm font-medium text-foreground">Angemeldet bleiben</p>
                    <p className="text-[11px] text-foreground/50">Sitzung bleibt über Browserschließung hinaus aktiv</p>
                  </div>
                  <Switch checked={rememberMe} onCheckedChange={setRememberMe} disabled={isLoading} />
                </div>

                <Button
                  type="submit"
                  className="w-full mt-5 h-11 rounded-2xl text-sm font-medium"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                      Anmeldung...
                    </span>
                  ) : 'Anmelden'}
                </Button>
              </motion.form>
            </TabsContent>

            <TabsContent value="register">
              <motion.form
                onSubmit={handleRegister}
                className="space-y-4"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
              >
                <div className="space-y-2 rounded-2xl bg-foreground/4 p-4 border border-foreground/5">
                  <Label htmlFor="register-username" className="text-xs font-medium text-foreground/60">Benutzername</Label>
                  <Input
                    id="register-username"
                    type="text"
                    placeholder="Wählen Sie einen Benutzernamen"
                    value={registerUsername}
                    onChange={(e) => setRegisterUsername(e.target.value)}
                    disabled={isLoading}
                    autoComplete="username"
                    required
                  />
                </div>

                <div className="space-y-2 rounded-2xl bg-foreground/4 p-4 border border-foreground/5">
                  <Label htmlFor="register-display-name" className="text-xs font-medium text-foreground/60">
                    Anzeigename (optional)
                  </Label>
                  <Input
                    id="register-display-name"
                    type="text"
                    placeholder="Ihr Anzeigename"
                    value={registerDisplayName}
                    onChange={(e) => setRegisterDisplayName(e.target.value)}
                    disabled={isLoading}
                    autoComplete="name"
                  />
                </div>

                <div className="space-y-2 rounded-2xl bg-foreground/4 p-4 border border-foreground/5">
                  <Label htmlFor="register-password" className="text-xs font-medium text-foreground/60">Passwort</Label>
                  <Input
                    id="register-password"
                    type="password"
                    placeholder="Mindestens 8 Zeichen"
                    value={registerPassword}
                    onChange={(e) => setRegisterPassword(e.target.value)}
                    disabled={isLoading}
                    autoComplete="new-password"
                    required
                  />
                </div>

                <div className="space-y-2 rounded-2xl bg-foreground/4 p-4 border border-foreground/5">
                  <Label htmlFor="register-password-confirm" className="text-xs font-medium text-foreground/60">
                    Passwort bestätigen
                  </Label>
                  <Input
                    id="register-password-confirm"
                    type="password"
                    placeholder="Passwort wiederholen"
                    value={registerPasswordConfirm}
                    onChange={(e) => setRegisterPasswordConfirm(e.target.value)}
                    disabled={isLoading}
                    autoComplete="new-password"
                    required
                  />
                </div>

                <Button
                  type="submit"
                  className="w-full mt-5 h-11 rounded-2xl text-sm font-medium"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                      Konto wird erstellt...
                    </span>
                  ) : 'Konto erstellen'}
                </Button>
              </motion.form>
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  )
}
