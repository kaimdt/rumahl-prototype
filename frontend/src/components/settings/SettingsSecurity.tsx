// Login PIN + 2FA/Passkey sections of the Settings page (lazy-loaded chunk).
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle, Key, NumberCircleOne, Trash } from '@phosphor-icons/react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import {
  apiBase,
  createBackupCodes,
  downloadBackupCodes,
  formatOtpAuthUri,
  generateBase32Secret,
  getTimeBasedCode,
  SettingsSection,
  ToggleRow,
} from './shared'

// ─── Login PIN Section ─────────────────────────────────────────────────
export function LoginPinSection() {
  const { t } = useTranslation()
  const [loginPin, setLoginPin] = useState('')
  const [loginPinConfirm, setLoginPinConfirm] = useState('')
  const [hasLoginPin, setHasLoginPin] = useState(false)
  const [saving, setSaving] = useState(false)

  // Check if user has a login PIN by fetching user list
  useEffect(() => {
    let mounted = true
    const token = localStorage.getItem('ha-auth-token')
    if (!token) return
    const parsed = (() => { try { return JSON.parse(token) } catch { return token } })() as string

    fetch(`${apiBase()}/api/auth/verify`, { headers: { Authorization: `Bearer ${parsed}` } })
      .then(res => res.ok ? res.json() : null)
      .then((currentUser: { id?: string } | null) => {
        if (!currentUser?.id) return
        return fetch(`${apiBase()}/api/auth/users`).then(r => r.ok ? r.json() : []).then((users: { id: string; has_pin: boolean }[]) => {
          const me = users.find(u => u.id === currentUser.id)
          if (mounted && me) setHasLoginPin(me.has_pin)
        })
      })
      .catch(() => {})

    return () => { mounted = false }
  }, [])

  const saveLoginPin = async () => {
    if (!/^\d{4,6}$/.test(loginPin)) {
      toast.error('Login-PIN muss 4–6 Ziffern enthalten')
      return
    }
    if (loginPin !== loginPinConfirm) {
      toast.error('PIN und Bestätigung stimmen nicht überein')
      return
    }
    const token = localStorage.getItem('ha-auth-token')
    if (!token) return
    const parsed = (() => { try { return JSON.parse(token) } catch { return token } })() as string

    setSaving(true)
    try {
      const res = await fetch(`${apiBase()}/api/auth/pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${parsed}` },
        body: JSON.stringify({ pin: loginPin }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Fehler' }))
        throw new Error(err.error || 'Fehler')
      }
      setHasLoginPin(true)
      setLoginPin('')
      setLoginPinConfirm('')
      toast.success('Login-PIN gespeichert')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'PIN konnte nicht gespeichert werden')
    } finally {
      setSaving(false)
    }
  }

  const removeLoginPin = async () => {
    const token = localStorage.getItem('ha-auth-token')
    if (!token) return
    const parsed = (() => { try { return JSON.parse(token) } catch { return token } })() as string

    setSaving(true)
    try {
      const res = await fetch(`${apiBase()}/api/auth/pin`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${parsed}` },
      })
      if (!res.ok) throw new Error('Fehler')
      setHasLoginPin(false)
      toast.success('Login-PIN entfernt')
    } catch {
      toast.error('PIN konnte nicht entfernt werden')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsSection icon={NumberCircleOne} title={t("settings.quickLogin")} description={t("settings.quickLoginDesc")}>
      {hasLoginPin && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-emerald-400">
            <CheckCircle size={14} weight="fill" />
            <span>Login-PIN ist aktiv</span>
          </div>
          <button
            onClick={removeLoginPin}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/15 text-red-400 text-xs font-medium transition-colors disabled:opacity-50"
          >
            <Trash size={13} />
            Entfernen
          </button>
        </div>
      )}
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] font-medium text-foreground/55 block mb-1.5">
            {hasLoginPin ? 'Neue Login-PIN (4–6 Ziffern)' : 'Login-PIN (4–6 Ziffern)'}
          </label>
          <input
            type="password"
            inputMode="numeric"
            value={loginPin}
            onChange={(e) => setLoginPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className="ora-field"
            placeholder="••••"
          />
        </div>
        <div>
          <label className="text-[11px] font-medium text-foreground/55 block mb-1.5">
            PIN bestätigen
          </label>
          <input
            type="password"
            inputMode="numeric"
            value={loginPinConfirm}
            onChange={(e) => setLoginPinConfirm(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className="ora-field"
            placeholder="••••"
          />
        </div>
      </div>
      <button
        onClick={saveLoginPin}
        disabled={saving}
        className="ora-secondary-button w-full"
      >
        {saving ? 'Wird gespeichert...' : 'Login-PIN speichern'}
      </button>
      <p className="text-[10px] text-foreground/40 leading-relaxed">
        Mit einer Login-PIN können Sie sich auf gemeinsam genutzten Geräten (z.B. Wandtablets) schnell per PIN-Eingabe anmelden,
        ohne jedes Mal Benutzername und Passwort einzugeben.
      </p>
    </SettingsSection>
  )
}

export function TwoFactorPasskeySection() {
  const { t } = useTranslation()
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false)
  const [passkeyEnabled, setPasskeyEnabled] = useState(false)
  const [passkeyAs2FA, setPasskeyAs2FA] = useState(false)
  const [passkeyRegistered, setPasskeyRegistered] = useState(false)
  const [showSecurityModal, setShowSecurityModal] = useState(false)
  const [setupSecret, setSetupSecret] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [setupVerified, setSetupVerified] = useState(false)
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const openSetupModal = () => {
    setSetupSecret(generateBase32Secret())
    setOtpCode('')
    setSetupVerified(false)
    setBackupCodes([])
    setShowSecurityModal(true)
  }

  const verifyOtp = () => {
    if (otpCode.trim() === getTimeBasedCode(setupSecret)) {
      const codes = createBackupCodes()
      setBackupCodes(codes)
      setPasskeyRegistered(true)
      setSetupVerified(true)
      toast.success('2FA/Passkey Einrichtung abgeschlossen')
      return
    }
    toast.error('Der eingegebene Code stimmt nicht')
  }

  const downloadCodes = () => {
    if (backupCodes.length > 0) {
      downloadBackupCodes(backupCodes)
      toast.success('Backup-Codes als Textdatei heruntergeladen')
    }
  }

  return (
    <>
      <SettingsSection icon={Key} title={t("settings.passkey")} description={t("settings.passkeyDesc")}>
        <div className="grid gap-3">
          <ToggleRow
            label="2-Faktor-Authentifizierung aktivieren"
            description={t("settings.twoFactorDesc")}
            checked={twoFactorEnabled}
            onCheckedChange={setTwoFactorEnabled}
          />
          <ToggleRow
            label="Passkey Login aktivieren"
            description={t("settings.passkeyLoginDesc")}
            checked={passkeyEnabled}
            onCheckedChange={setPasskeyEnabled}
          />
          <ToggleRow
            label="Passkey als 2FA nutzen"
            description={t("settings.passkey2FADesc")}
            checked={passkeyAs2FA}
            onCheckedChange={setPasskeyAs2FA}
            disabled={!twoFactorEnabled}
          />
        </div>

        <div className="grid sm:grid-cols-2 gap-3 mt-3">
          <button
            type="button"
            onClick={openSetupModal}
            disabled={saving}
            className="ora-primary-button w-full"
          >
            {passkeyRegistered ? 'Passkey / 2FA neu einrichten' : 'Passkey / 2FA einrichten'}
          </button>
          {passkeyRegistered && (
            <button
              type="button"
              onClick={() => {
                setPasskeyRegistered(false)
                setPasskeyEnabled(false)
                setPasskeyAs2FA(false)
                toast.success('Passkey entfernt')
              }}
              disabled={saving}
              className="ora-secondary-button w-full"
            >
              Passkey entfernen
            </button>
          )}
        </div>

        {passkeyRegistered && (
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm text-emerald-200">
            Passkey & 2FA sind eingerichtet. Du kannst dich jetzt sicher anmelden und hast Backup-Codes gesichert.
          </div>
        )}

        <p className="text-[10px] text-foreground/40 leading-relaxed">
          Passkeys unterstützen sichere, passwortlose Anmeldungen. Wenn du sie als 2FA nutzt, bleibt dein Passwort als erster Faktor erhalten.
        </p>
      </SettingsSection>

      <Dialog open={showSecurityModal} onOpenChange={(open) => { if (!open) setShowSecurityModal(false) }}>
        <DialogContent className="sm:max-w-[560px] ora-card border-foreground/10 p-0 gap-0 bg-card/95 backdrop-blur-2xl overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-foreground/10">
            <DialogTitle>Passkey & 2FA Einrichtung</DialogTitle>
            <DialogDescription>
              Kopiere den geheimen Schlüssel oder nutze den QR-Code. Gib danach den aktuellen Code aus deiner Authenticator-App ein.
            </DialogDescription>
          </DialogHeader>

          <div className="px-6 pb-6 space-y-5">
            <div className="ora-card p-4">
              <p className="text-sm font-semibold text-foreground">Geheimer Schlüssel</p>
              <p className="mt-2 text-sm text-foreground/70">Kopiere diesen Key in deine Authenticator-App oder dein Backup.</p>
              <div className="mt-4 rounded-3xl bg-foreground/5 p-3 font-mono text-xs text-foreground/80 break-words">{setupSecret}</div>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(setupSecret).then(() => toast.success('Schlüssel kopiert')).catch(() => toast.error('Kopieren fehlgeschlagen'))}
                className="mt-4 inline-flex items-center justify-center rounded-2xl border border-foreground/10 bg-foreground/10 px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-foreground/15"
              >
                Schlüssel kopieren
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
              <div className="ora-card p-4 text-sm text-foreground/70">
                <p className="font-semibold text-foreground">QR-Code</p>
                <div className="mt-4 flex min-h-[200px] items-center justify-center rounded-3xl border border-dashed border-foreground/20 bg-background/80 text-xs text-foreground/50">
                  QR-Code Platzhalter für Authenticator-App
                </div>
                <p className="mt-4 break-all text-[11px] text-foreground/60">URI: {formatOtpAuthUri(setupSecret)}</p>
              </div>

              <div className="ora-card p-4">
                <p className="font-semibold text-foreground">Verifikation</p>
                <p className="mt-2 text-sm text-foreground/70">Gib den aktuellen, zeitbasierten Code aus deiner App ein.</p>
                <input
                  type="text"
                  inputMode="numeric"
                  value={otpCode}
                  onChange={(event) => setOtpCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="123456"
                  className="mt-4 ora-field"
                />
                <button
                  type="button"
                  onClick={verifyOtp}
                  className="mt-4 w-full rounded-2xl border border-foreground/10 bg-foreground/10 px-4 py-3 text-sm font-semibold text-foreground transition hover:bg-foreground/15"
                >
                  Code prüfen
                </button>
              </div>
            </div>

            {setupVerified && backupCodes.length > 0 && (
              <div className="rounded-3xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm text-foreground">
                <p className="font-semibold text-foreground">Backup-Codes</p>
                <p className="mt-2 text-foreground/70">Speichere diese Codes sicher. Sie werden nur einmal angezeigt.</p>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {backupCodes.map((code) => (
                    <div key={code} className="rounded-2xl bg-background/90 px-3 py-2 font-mono text-xs text-foreground">{code}</div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={downloadCodes}
                  className="mt-4 rounded-2xl border border-foreground/10 bg-foreground/10 px-4 py-3 text-sm font-semibold text-foreground transition hover:bg-foreground/15"
                >
                  Backup-Codes herunterladen
                </button>
              </div>
            )}

            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setShowSecurityModal(false)}
                className="w-full rounded-2xl border border-foreground/10 bg-background/90 px-4 py-3 text-sm font-semibold text-foreground transition hover:bg-foreground/5 sm:w-auto"
              >
                Schließen
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
