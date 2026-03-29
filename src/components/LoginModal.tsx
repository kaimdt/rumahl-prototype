import { useState } from 'react'
import { motion } from 'framer-motion'
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
import { User, Lock, UserPlus } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Switch } from '@/components/ui/switch'

interface LoginModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function LoginModal({ open, onOpenChange }: LoginModalProps) {
  const { login, register } = useAuth()
  const [isLoading, setIsLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'login' | 'register'>('login')

  // Login form state
  const [loginUsername, setLoginUsername] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(true)

  // Register form state
  const [registerUsername, setRegisterUsername] = useState('')
  const [registerPassword, setRegisterPassword] = useState('')
  const [registerPasswordConfirm, setRegisterPasswordConfirm] = useState('')
  const [registerDisplayName, setRegisterDisplayName] = useState('')

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
        className="sm:max-w-[440px] glass-card border-foreground/10 p-0 gap-0 bg-card/95 backdrop-blur-2xl"
        hideCloseButton
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader className="p-6 pb-4 border-b border-foreground/10">
          <DialogTitle className="flex items-center gap-3 text-foreground">
            <div className="p-2 rounded-xl bg-primary/10">
              <User size={22} weight="bold" className="text-primary" />
            </div>
            <span className="text-lg font-medium">Authentifizierung</span>
          </DialogTitle>
          <DialogDescription className="text-foreground/60">
            Melden Sie sich an oder erstellen Sie ein neues Konto
          </DialogDescription>
        </DialogHeader>

        <div className="p-6">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'login' | 'register')}>
            <TabsList className="w-full grid grid-cols-2 mb-6 rounded-xl bg-foreground/5 p-1 h-auto">
              <TabsTrigger value="login" className="rounded-lg data-[state=active]:bg-accent/15 data-[state=active]:text-accent">
                <Lock size={16} weight="bold" />
                Anmelden
              </TabsTrigger>
              <TabsTrigger value="register" className="rounded-lg data-[state=active]:bg-accent/15 data-[state=active]:text-accent">
                <UserPlus size={16} weight="bold" />
                Registrieren
              </TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <motion.form
                onSubmit={handleLogin}
                className="space-y-4"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
              >
                <div className="space-y-2 rounded-xl bg-foreground/5 p-3.5">
                  <Label htmlFor="login-username">Benutzername</Label>
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

                <div className="space-y-2 rounded-xl bg-foreground/5 p-3.5">
                  <Label htmlFor="login-password">Passwort</Label>
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

                <div className="flex items-center justify-between rounded-xl bg-foreground/5 px-3 py-2.5">
                  <div>
                    <p className="text-sm font-medium text-foreground">Angemeldet bleiben</p>
                    <p className="text-xs text-foreground/60">Wenn aus, endet die Anmeldung beim Schliessen des Browsers.</p>
                  </div>
                  <Switch checked={rememberMe} onCheckedChange={setRememberMe} disabled={isLoading} />
                </div>

                <Button
                  type="submit"
                  className="w-full mt-6"
                  disabled={isLoading}
                >
                  {isLoading ? 'Anmeldung läuft...' : 'Anmelden'}
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
                <div className="space-y-2 rounded-xl bg-foreground/5 p-3.5">
                  <Label htmlFor="register-username">Benutzername</Label>
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

                <div className="space-y-2 rounded-xl bg-foreground/5 p-3.5">
                  <Label htmlFor="register-display-name">
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

                <div className="space-y-2 rounded-xl bg-foreground/5 p-3.5">
                  <Label htmlFor="register-password">Passwort</Label>
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

                <div className="space-y-2 rounded-xl bg-foreground/5 p-3.5">
                  <Label htmlFor="register-password-confirm">
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
                  className="w-full mt-6"
                  disabled={isLoading}
                >
                  {isLoading ? 'Konto wird erstellt...' : 'Konto erstellen'}
                </Button>
              </motion.form>
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  )
}
