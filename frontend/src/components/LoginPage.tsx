import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'motion/react'
import { useAuth } from '@/contexts/AuthContext'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  User,
  Lock,
  UserPlus,
  NumberCircleOne,
  Backspace,
  ArrowLeft,
  Sparkle,
  Eye,
  EyeSlash,
} from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { DEFAULT_DASHBOARD_BACKGROUND_URL } from '@/lib/defaults'

// ── Zod schemas ──────────────────────────────────────────
const loginSchema = z.object({
  username: z.string().min(1, 'auth.usernameRequired'),
  password: z.string().min(1, 'auth.passwordRequired'),
  rememberMe: z.boolean().default(true),
})

const registerSchema = z.object({
  username: z
    .string()
    .min(2, 'auth.usernameMinLength')
    .max(32, 'auth.usernameMaxLength')
    .regex(/^[a-zA-Z0-9_]+$/, 'auth.usernameInvalidChars'),
  displayName: z.string().max(48, 'auth.displayNameMaxLength').optional(),
  password: z.string().min(8, 'auth.passwordMinLength'),
  passwordConfirm: z.string().min(1, 'auth.passwordRequired'),
}).refine((data) => data.password === data.passwordConfirm, {
  message: 'auth.passwordsDontMatch',
  path: ['passwordConfirm'],
})

type LoginFormData = z.infer<typeof loginSchema>
type RegisterFormData = z.infer<typeof registerSchema>

// ── PIN pad sub-component ────────────────────────────────
interface UserListEntry {
  id: string
  username: string
  display_name?: string
  avatar_url?: string
  has_pin: boolean
}

function PinPad({
  onSubmit,
  onBack,
  userName,
  isLoading,
}: {
  onSubmit: (pin: string) => void
  onBack: () => void
  userName: string
  isLoading: boolean
}) {
  const { t } = useTranslation()
  const [pin, setPin] = useState('')

  const addDigit = useCallback((digit: string) => {
    setPin((prev) => {
      const next = prev + digit
      if (next.length >= 6) {
        onSubmit(next)
        return ''
      }
      return next
    })
  }, [onSubmit])

  const removeDigit = useCallback(() => {
    setPin((prev) => prev.slice(0, -1))
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
          type="button"
        >
          <ArrowLeft size={18} />
        </button>
        <span className="text-sm text-white/60">
          {t('auth.pinFor')} <strong className="text-white">{userName}</strong>
        </span>
      </div>

      <div className="flex justify-center gap-2.5 py-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <motion.div
            key={i}
            animate={i < pin.length ? { scale: [1, 1.3, 1] } : {}}
            transition={{ duration: 0.2 }}
            className={cn(
              'w-3.5 h-3.5 rounded-full transition-all duration-200',
              i < pin.length
                ? 'bg-accent shadow-[0_0_8px_oklch(from_var(--accent)_l_c_h_/_0.4)]'
                : 'bg-white/12 border border-white/8'
            )}
          />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2.5 max-w-[260px] mx-auto">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <motion.button
            key={d}
            onClick={() => addDigit(d)}
            disabled={isLoading}
            whileTap={{ scale: 0.92 }}
            className="h-14 rounded-2xl bg-white/5 hover:bg-white/10 active:bg-accent/12 text-xl font-medium transition-colors disabled:opacity-50 border border-white/5 text-white"
            type="button"
          >
            {d}
          </motion.button>
        ))}
        <div />
        <motion.button
          onClick={() => addDigit('0')}
          disabled={isLoading}
          whileTap={{ scale: 0.92 }}
          className="h-14 rounded-2xl bg-white/5 hover:bg-white/10 active:bg-accent/12 text-xl font-medium transition-colors disabled:opacity-50 border border-white/5 text-white"
          type="button"
        >
          0
        </motion.button>
        <motion.button
          onClick={removeDigit}
          disabled={isLoading || pin.length === 0}
          whileTap={{ scale: 0.92 }}
          className="h-14 rounded-2xl bg-white/5 hover:bg-white/10 active:bg-destructive/12 flex items-center justify-center transition-colors disabled:opacity-30 border border-white/5"
          type="button"
        >
          <Backspace size={22} />
        </motion.button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center gap-2 py-2">
          <div className="w-4 h-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
          <p className="text-sm text-white/60">{t('auth.loggingIn')}</p>
        </div>
      )}
    </motion.div>
  )
}

// ── Mode selector ────────────────────────────────────────
type AuthMode = 'login' | 'register' | 'pin'

interface AuthModeOption {
  mode: AuthMode
  labelKey: string
  icon: React.ReactNode
}

// ── LoginPage ────────────────────────────────────────────
export function LoginPage() {
  const { t } = useTranslation()
  const { login, loginAsGuest, loginWithPin, register } = useAuth()

  const [authMode, setAuthMode] = useState<AuthMode>('login')
  const [isLoading, setIsLoading] = useState(false)
  const [guestEnabled, setGuestEnabled] = useState(false)

  // Guest mode availability (admin toggle, backend preference).
  useEffect(() => {
    fetch('/api/auth/guest-status')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setGuestEnabled(Boolean(data?.enabled)))
      .catch(() => {})
  }, [])

  const onGuestLogin = async () => {
    setIsLoading(true)
    try {
      await loginAsGuest()
      toast.success(t('auth.guestSuccess'))
    } catch (error) {
      const message = error instanceof Error ? error.message : t('auth.guestFailed')
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }

  // PIN login state
  const [users, setUsers] = useState<UserListEntry[]>([])
  const [selectedUser, setSelectedUser] = useState<UserListEntry | null>(null)
  const [usersLoaded, setUsersLoaded] = useState(false)

  // Load users for PIN mode
  useEffect(() => {
    if (authMode === 'pin' && !usersLoaded) {
      fetch('/api/auth/users')
        .then((res) => (res.ok ? res.json() : []))
        .then((data: UserListEntry[]) => {
          setUsers(data)
          setUsersLoaded(true)
        })
        .catch(() => setUsersLoaded(true))
    }
  }, [authMode, usersLoaded])

  // ── Login form (react-hook-form + zod) ─────────────────
  const loginForm = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: '', password: '', rememberMe: true },
    mode: 'onBlur',
  })

  const onLogin = async (data: LoginFormData) => {
    setIsLoading(true)
    try {
      await login(data.username, data.password, data.rememberMe)
      toast.success(t('auth.loginSuccess'))
    } catch (error) {
      const message = error instanceof Error ? error.message : t('auth.loginFailed')
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }

  // ── Register form (react-hook-form + zod) ──────────────
  const registerForm = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: { username: '', displayName: '', password: '', passwordConfirm: '' },
    mode: 'onBlur',
  })

  const onRegister = async (data: RegisterFormData) => {
    setIsLoading(true)
    try {
      await register(data.username, data.password, data.displayName || undefined)
      toast.success(t('auth.registerSuccess'))
    } catch (error) {
      const message = error instanceof Error ? error.message : t('auth.registerFailed')
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }

  // ── PIN login handler ──────────────────────────────────
  const handlePinLogin = useCallback(
    async (pin: string) => {
      if (!selectedUser) return
      setIsLoading(true)
      try {
        await loginWithPin(selectedUser.id, pin)
        toast.success(`${t('auth.welcomeBack')}, ${selectedUser.display_name || selectedUser.username}!`)
        setSelectedUser(null)
      } catch (error) {
        const message = error instanceof Error ? error.message : t('auth.wrongPin')
        toast.error(message)
      } finally {
        setIsLoading(false)
      }
    },
    [selectedUser, loginWithPin, t]
  )

  // ── UI state helpers ───────────────────────────────────
  const [showPassword, setShowPassword] = useState(false)
  const [showRegPassword, setShowRegPassword] = useState(false)
  const [showRegPasswordConfirm, setShowRegPasswordConfirm] = useState(false)

  const modeOptions: AuthModeOption[] = [
    { mode: 'login', labelKey: 'auth.login', icon: <Lock size={15} weight="bold" /> },
    { mode: 'register', labelKey: 'auth.createAccount', icon: <UserPlus size={15} weight="bold" /> },
    { mode: 'pin', labelKey: 'auth.pin', icon: <NumberCircleOne size={15} weight="bold" /> },
  ]

  return (
    <div className="min-h-screen relative overflow-hidden flex items-center justify-center">
      {/* Background */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: `url('${DEFAULT_DASHBOARD_BACKGROUND_URL}')`,
          filter: 'brightness(0.3) saturate(0.7)',
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/40 to-black/70" />

      {/* Ambient glow */}
      <div className="absolute inset-0 pointer-events-none">
        <motion.div
          className="absolute w-[600px] h-[600px] rounded-full"
          style={{
            background: 'radial-gradient(circle, oklch(0.40 0.15 250 / 0.12) 0%, transparent 70%)',
            top: '15%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
          }}
          animate={{ scale: [1, 1.12, 1], opacity: [0.4, 0.7, 0.4] }}
          transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      {/* Brand watermark */}
      <div className="absolute top-8 left-1/2 -translate-x-1/2 z-10 text-center pointer-events-none">
        <p className="text-sm font-light tracking-[0.3em] uppercase text-white/25">ORA OS</p>
      </div>

      {/* Auth card */}
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 w-full max-w-[420px] mx-4"
      >
        <div className="backdrop-blur-2xl bg-white/4 border border-white/10 rounded-3xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-accent/15 via-accent/6 to-transparent" />
            <div className="relative p-6 pb-5">
              <div className="flex flex-col items-center gap-2 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/15 ring-1 ring-accent/20">
                  <span className="text-lg font-bold text-accent">I</span>
                </div>
                <div>
                  <span className="block text-xl font-semibold text-white">ORA OS</span>
                  <span className="text-xs font-normal text-white/50">
                    {authMode === 'login'
                      ? t('auth.loginSubtitle')
                      : authMode === 'register'
                        ? t('auth.registerSubtitle')
                        : t('auth.pinSubtitle')}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-white/8" />

          <div className="p-6 pt-5">
            {/* Mode tabs */}
            <div className="flex gap-1 mb-6 rounded-2xl bg-white/5 p-1">
              {modeOptions.map((opt) => (
                <button
                  key={opt.mode}
                  onClick={() => {
                    setAuthMode(opt.mode)
                    setSelectedUser(null)
                    loginForm.clearErrors()
                    registerForm.clearErrors()
                  }}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-medium transition-all',
                    authMode === opt.mode
                      ? 'bg-accent/15 text-accent shadow-sm'
                      : 'text-white/50 hover:text-white/80 hover:bg-white/5'
                  )}
                  type="button"
                >
                  {opt.icon}
                  {t(opt.labelKey)}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <AnimatePresence mode="wait">
              {/* ── PIN Tab ─────────────────────────────── */}
              {authMode === 'pin' && (
                <motion.div
                  key="pin"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                >
                  {selectedUser ? (
                    <PinPad
                      onSubmit={handlePinLogin}
                      onBack={() => setSelectedUser(null)}
                      userName={selectedUser.display_name || selectedUser.username}
                      isLoading={isLoading}
                    />
                  ) : (
                    <div className="space-y-2">
                      {!usersLoaded ? (
                        <div className="flex items-center justify-center gap-2 py-8">
                          <div className="w-4 h-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
                          <p className="text-sm text-white/60">{t('auth.loadingUsers')}</p>
                        </div>
                      ) : users.filter((u) => u.has_pin).length === 0 ? (
                        <div className="text-center py-8 space-y-2">
                          <p className="text-sm text-white/60">{t('auth.noPinUsers')}</p>
                          <p className="text-xs text-white/40">{t('auth.noPinUsersHint')}</p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-2">
                          {users
                            .filter((u) => u.has_pin)
                            .map((u) => (
                              <button
                                key={u.id}
                                onClick={() => setSelectedUser(u)}
                                className="flex flex-col items-center gap-2.5 p-4 rounded-2xl bg-white/4 hover:bg-accent/8 active:bg-accent/12 transition-all border border-white/5 hover:border-accent/15"
                                type="button"
                              >
                                <div className="w-14 h-14 rounded-2xl bg-accent/12 ring-1 ring-accent/15 flex items-center justify-center text-accent font-bold text-lg">
                                  {(u.display_name || u.username).charAt(0).toUpperCase()}
                                </div>
                                <span className="text-sm font-medium truncate max-w-full text-white/80">
                                  {u.display_name || u.username}
                                </span>
                              </button>
                            ))}
                        </div>
                      )}
                    </div>
                  )}
                </motion.div>
              )}

              {/* ── Login Tab (react-hook-form) ─────────── */}
              {authMode === 'login' && (
                <motion.form
                  key="login"
                  onSubmit={loginForm.handleSubmit(onLogin)}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-4"
                  noValidate
                >
                  {/* Username field */}
                  <div className="space-y-2">
                    <Label htmlFor="login-username" className="text-xs font-medium text-white/60">
                      {t('auth.username')}
                    </Label>
                    <Input
                      id="login-username"
                      type="text"
                      placeholder={t('auth.usernamePlaceholder')}
                      autoComplete="username"
                      disabled={isLoading}
                      className={cn(
                        'bg-white/5 border-white/10 text-white placeholder:text-white/30',
                        loginForm.formState.errors.username && 'border-destructive/60'
                      )}
                      {...loginForm.register('username')}
                    />
                    {loginForm.formState.errors.username && (
                      <p className="text-xs text-destructive/80">
                        {t(loginForm.formState.errors.username.message as string)}
                      </p>
                    )}
                  </div>

                  {/* Password field */}
                  <div className="space-y-2">
                    <Label htmlFor="login-password" className="text-xs font-medium text-white/60">
                      {t('auth.password')}
                    </Label>
                    <div className="relative">
                      <Input
                        id="login-password"
                        type={showPassword ? 'text' : 'password'}
                        placeholder={t('auth.passwordPlaceholder')}
                        autoComplete="current-password"
                        disabled={isLoading}
                        className={cn(
                          'bg-white/5 border-white/10 text-white placeholder:text-white/30 pr-10',
                          loginForm.formState.errors.password && 'border-destructive/60'
                        )}
                        {...loginForm.register('password')}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition-colors"
                        tabIndex={-1}
                      >
                        {showPassword ? <EyeSlash size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    {loginForm.formState.errors.password && (
                      <p className="text-xs text-destructive/80">
                        {t(loginForm.formState.errors.password.message as string)}
                      </p>
                    )}
                  </div>

                  {/* Remember me */}
                  <div className="flex items-center justify-between bg-white/4 px-4 py-3 rounded-2xl border border-white/5">
                    <div>
                      <p className="text-sm font-medium text-white/80">{t('auth.rememberMe')}</p>
                      <p className="text-[11px] text-white/40">{t('auth.rememberMeHint')}</p>
                    </div>
                    <Switch
                      checked={loginForm.watch('rememberMe')}
                      onCheckedChange={(v) => loginForm.setValue('rememberMe', v)}
                      disabled={isLoading}
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
                        {t('auth.loggingIn')}
                      </span>
                    ) : (
                      t('auth.login')
                    )}
                  </Button>
                </motion.form>
              )}

              {/* Guest mode (opt-in, admin toggle) */}
              {guestEnabled && authMode === 'login' && (
                <div className="flex items-center gap-3 pt-1">
                  <span className="h-px flex-1 bg-white/10" />
                  <span className="text-[11px] uppercase tracking-wider text-white/30">{t('auth.or')}</span>
                  <span className="h-px flex-1 bg-white/10" />
                </div>
              )}
              {guestEnabled && authMode === 'login' && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void onGuestLogin()}
                  disabled={isLoading}
                  className="w-full h-11 rounded-2xl text-sm font-medium border-white/15 text-white/80 hover:text-white hover:bg-white/10"
                >
                  <UserPlus size={17} weight="duotone" />
                  {t('auth.guestLogin')}
                </Button>
              )}

              {/* ── Register Tab (react-hook-form) ──────── */}
              {authMode === 'register' && (
                <motion.form
                  key="register"
                  onSubmit={registerForm.handleSubmit(onRegister)}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-4"
                  noValidate
                >
                  {/* Username */}
                  <div className="space-y-2">
                    <Label htmlFor="reg-username" className="text-xs font-medium text-white/60">
                      {t('auth.username')}
                    </Label>
                    <Input
                      id="reg-username"
                      type="text"
                      placeholder={t('auth.usernamePlaceholder')}
                      autoComplete="username"
                      disabled={isLoading}
                      className={cn(
                        'bg-white/5 border-white/10 text-white placeholder:text-white/30',
                        registerForm.formState.errors.username && 'border-destructive/60'
                      )}
                      {...registerForm.register('username')}
                    />
                    {registerForm.formState.errors.username && (
                      <p className="text-xs text-destructive/80">
                        {t(registerForm.formState.errors.username.message as string)}
                      </p>
                    )}
                  </div>

                  {/* Display name */}
                  <div className="space-y-2">
                    <Label htmlFor="reg-display-name" className="text-xs font-medium text-white/60">
                      {t('auth.displayName')}{' '}
                      <span className="text-white/30">({t('auth.optional')})</span>
                    </Label>
                    <Input
                      id="reg-display-name"
                      type="text"
                      placeholder={t('auth.displayNamePlaceholder')}
                      autoComplete="name"
                      disabled={isLoading}
                      className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                      {...registerForm.register('displayName')}
                    />
                    {registerForm.formState.errors.displayName && (
                      <p className="text-xs text-destructive/80">
                        {t(registerForm.formState.errors.displayName.message as string)}
                      </p>
                    )}
                  </div>

                  {/* Password */}
                  <div className="space-y-2">
                    <Label htmlFor="reg-password" className="text-xs font-medium text-white/60">
                      {t('auth.password')}
                    </Label>
                    <div className="relative">
                      <Input
                        id="reg-password"
                        type={showRegPassword ? 'text' : 'password'}
                        placeholder="········"
                        autoComplete="new-password"
                        disabled={isLoading}
                        className={cn(
                          'bg-white/5 border-white/10 text-white placeholder:text-white/30 pr-10',
                          registerForm.formState.errors.password && 'border-destructive/60'
                        )}
                        {...registerForm.register('password')}
                      />
                      <button
                        type="button"
                        onClick={() => setShowRegPassword(!showRegPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition-colors"
                        tabIndex={-1}
                      >
                        {showRegPassword ? <EyeSlash size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    {registerForm.formState.errors.password && (
                      <p className="text-xs text-destructive/80">
                        {t(registerForm.formState.errors.password.message as string)}
                      </p>
                    )}
                  </div>

                  {/* Password confirm */}
                  <div className="space-y-2">
                    <Label
                      htmlFor="reg-password-confirm"
                      className="text-xs font-medium text-white/60"
                    >
                      {t('auth.confirmPassword')}
                    </Label>
                    <div className="relative">
                      <Input
                        id="reg-password-confirm"
                        type={showRegPasswordConfirm ? 'text' : 'password'}
                        placeholder="········"
                        autoComplete="new-password"
                        disabled={isLoading}
                        className={cn(
                          'bg-white/5 border-white/10 text-white placeholder:text-white/30 pr-10',
                          registerForm.formState.errors.passwordConfirm && 'border-destructive/60'
                        )}
                        {...registerForm.register('passwordConfirm')}
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setShowRegPasswordConfirm(!showRegPasswordConfirm)
                        }
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition-colors"
                        tabIndex={-1}
                      >
                        {showRegPasswordConfirm ? <EyeSlash size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    {registerForm.formState.errors.passwordConfirm && (
                      <p className="text-xs text-destructive/80">
                        {t(registerForm.formState.errors.passwordConfirm.message as string)}
                      </p>
                    )}
                  </div>

                  <Button
                    type="submit"
                    className="w-full mt-5 h-11 rounded-2xl text-sm font-medium"
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <span className="flex items-center gap-2">
                        <span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                        {t('auth.creatingAccount')}
                      </span>
                    ) : (
                      t('auth.createAccount')
                    )}
                  </Button>
                </motion.form>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center mt-6 text-[11px] text-white/20 tracking-wider font-light">
          {t('auth.pageFooter')}
        </p>
      </motion.div>
    </div>
  )
}
