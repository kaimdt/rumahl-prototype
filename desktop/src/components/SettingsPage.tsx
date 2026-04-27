import { useEffect, useState, useCallback, type ElementType, type ReactNode } from 'react'
import { usePageNavigation } from '@/contexts/PageNavigationContext'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { tauriApi } from '@/lib/tauri'
import { getApiBase, setApiBase } from '@/lib/apiBase'
import type { AppConfig, SystemMetrics } from '@/lib/tauri'
import { useTheme } from '@/contexts/ThemeContext'
import { Palette, Eye, Globe, Desktop, Screencast, BellRinging, Info, Cpu, HardDrives, Database, BatteryHigh, ThermometerSimple, WifiHigh, Sparkle, Robot, Lightning, IdentificationCard, SealCheck } from '@phosphor-icons/react'
import { toast } from 'sonner'
import type { ThemeMode } from '@/lib/types'

/**
 * @ai-info This is the ONLY active page in IORA Desktop.
 * Everything else in /desktop/src/components/ is legacy IORA Home code.
 * This page shows local Desktop/Tauri settings (no auth needed).
 *
 * DashboardContent passes many legacy props that this component does
 * not use. We accept them via [key: string]: unknown to avoid TS errors.
 */
interface SettingsPageProps {
  theme: string
  /** Accept any additional legacy props from DashboardContent without TS errors */
  [key: string]: unknown
}

function SettingsSection({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: ElementType
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <div className="glass-card rounded-3xl border border-white/10 bg-white/10 p-5 shadow-xl shadow-black/5 backdrop-blur-xl">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="text-xs text-foreground/60 mt-1">{description}</p>
        </div>
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 text-foreground/80 shadow-inner">
          <Icon size={18} />
        </span>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  )
}

function SliderRow({
  label,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  unit: string
  onChange: (next: number) => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm text-foreground/70">
        <span>{label}</span>
        <span className="font-semibold text-foreground">{value}{unit}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full h-2 rounded-full accent-accent"
      />
    </div>
  )
}

function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string
  description: string
  checked: boolean
  onCheckedChange: (next: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className={`flex items-center justify-between gap-4 rounded-3xl border border-white/10 bg-white/5 p-4${disabled ? ' opacity-50' : ''}`}>
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-foreground/60 mt-1">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  )
}

function ThemePickerSection() {
  const { selectedTheme, setSelectedTheme } = useTheme()

  const options: { value: ThemeMode | 'auto'; label: string }[] = [
    { value: 'auto', label: 'Automatisch' },
    { value: 'light', label: 'Hell' },
    { value: 'day', label: 'Tag' },
    { value: 'night', label: 'Nacht' },
    { value: 'sleep', label: 'Schlaf' },
  ]

  return (
    <div className="grid grid-cols-2 gap-3">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => setSelectedTheme(option.value)}
          className={`rounded-3xl border px-4 py-3 text-left text-sm transition-all ${
            selectedTheme === option.value
              ? 'border-accent bg-accent/10 text-accent'
              : 'border-white/10 bg-white/5 text-foreground hover:border-white/20 hover:bg-white/10'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function SettingsPage({ theme }: SettingsPageProps) {
  const [settingsTab, setSettingsTab] = useState<'general' | 'desktop'>('general')
  const [tauriConfig, setTauriConfig] = useState<AppConfig | null>(null)
  const [initialConfig, setInitialConfig] = useState<AppConfig | null>(null)
  const [deviceMetrics, setDeviceMetrics] = useState<SystemMetrics | null>(null)
  const [loadingConfig, setLoadingConfig] = useState(true)
  const [saving, setSaving] = useState(false)
  const [models, setModels] = useState<import('@/lib/tauri').Model[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle')
  const { setCurrentPageId } = usePageNavigation()
  const remoteHomeUrl = getApiBase()

  const loadDesktopConfig = useCallback(async () => {
    try {
      setLoadingConfig(true)
      const config = await tauriApi.getConfig()
      setTauriConfig(config)
      setInitialConfig(config)
    } catch {
      toast.error('Desktop-Konfiguration konnte nicht geladen werden.')
    } finally {
      setLoadingConfig(false)
    }
  }, [])

  useEffect(() => {
    void loadDesktopConfig()
  }, [loadDesktopConfig])

  useEffect(() => {
    if (settingsTab === 'desktop') {
      void tauriApi.getSystemMetrics().then(setDeviceMetrics).catch(() => {})
    }
  }, [settingsTab])

  useEffect(() => {
    if (settingsTab !== 'desktop') return
    const interval = window.setInterval(() => {
      void tauriApi.getSystemMetrics().then(setDeviceMetrics).catch(() => {})
    }, 5000)
    return () => window.clearInterval(interval)
  }, [settingsTab])

  const saveDesktopConfig = useCallback(async () => {
    if (!tauriConfig) return
    try {
      setSaving(true)
      await tauriApi.saveConfig(tauriConfig)

      if (initialConfig && initialConfig.iora_home_url !== tauriConfig.iora_home_url) {
        setApiBase(tauriConfig.iora_home_url)
      }

      if (initialConfig && initialConfig.autostart_enabled !== tauriConfig.autostart_enabled) {
        await tauriApi.setAutostart(tauriConfig.autostart_enabled)
      }

      if (
        initialConfig &&
        (initialConfig.autostart_minimized !== tauriConfig.autostart_minimized ||
          initialConfig.autostart_hidden !== tauriConfig.autostart_hidden)
      ) {
        await tauriApi.setAutostartOptions(
          tauriConfig.autostart_minimized,
          tauriConfig.autostart_hidden,
        )
      }

      if (
        initialConfig &&
        (initialConfig.always_on_top !== tauriConfig.always_on_top ||
          initialConfig.kiosk_mode !== tauriConfig.kiosk_mode)
      ) {
        await tauriApi.applyWindowSettings(
          tauriConfig.always_on_top,
          tauriConfig.kiosk_mode,
        )
      }

      setInitialConfig(tauriConfig)
      toast.success('Desktop-Einstellungen gespeichert.')
    } catch {
      toast.error('Speichern fehlgeschlagen.')
    } finally {
      setSaving(false)
    }
  }, [tauriConfig, initialConfig])

  const updateConfig = (patch: Partial<AppConfig>) => {
    if (!tauriConfig) return
    setTauriConfig({ ...tauriConfig, ...patch })
  }

  const loadModels = useCallback(async () => {
    try {
      setModelsLoading(true)
      const list = await tauriApi.listModels()
      setModels(list)
    } catch {
      toast.error('Modelle konnten nicht geladen werden. Ist LM Studio gestartet?')
      setModels([])
    } finally {
      setModelsLoading(false)
    }
  }, [])

  const testLmConnection = useCallback(async () => {
    setConnectionStatus('testing')
    try {
      const result = await tauriApi.testConnection()
      setConnectionStatus(result.connected ? 'ok' : 'error')
      if (result.connected) {
        toast.success('LM Studio verbunden!')
      } else {
        toast.error(result.error ?? 'Verbindung fehlgeschlagen')
      }
    } catch {
      setConnectionStatus('error')
      toast.error('Verbindungstest fehlgeschlagen')
    }
  }, [])

  return (
    <div className="space-y-6 px-4 py-5">
      <div className="rounded-[2.5rem] border border-white/10 bg-white/10 p-6 shadow-[0_24px_110px_rgba(15,23,42,0.12)] backdrop-blur-3xl">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-foreground/50">IORA Desktop</p>
            <h1 className="mt-2 text-3xl font-semibold text-foreground">Desktop-Einstellungen</h1>
            <p className="mt-2 max-w-2xl text-sm text-foreground/60">Nur die Desktop-App-Einstellungen werden hier angepasst. IORA Home System- und Dashboard-Optionen sind entfernt.</p>
            {getApiBase() && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCurrentPageId('home')}
                  className="rounded-3xl border border-accent/20 bg-accent/10 px-4 py-2 text-sm font-semibold text-accent transition hover:bg-accent/15"
                >
                  Zurück zu IORA Home
                </button>
                <span className="text-xs text-foreground/50">Vereinfachte Einstellungen mit direktem Remote-Home-Zugang.</span>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-2xl bg-foreground/5 px-3 py-2 text-xs uppercase tracking-[0.22em] text-foreground/80">Theme: {theme}</span>
            <span className="rounded-2xl bg-slate-900/10 px-3 py-2 text-xs uppercase tracking-[0.22em] text-slate-200">Desktop only</span>
          </div>
        </div>
      </div>

      <Tabs value={settingsTab} onValueChange={(value) => setSettingsTab(value as 'general' | 'desktop')}>
        <TabsList className="grid grid-cols-2 gap-2 rounded-3xl border border-white/10 bg-white/5 p-1">
          <TabsTrigger value="general" className="rounded-3xl py-3 text-sm data-[state=active]:bg-accent/15 data-[state=active]:text-accent transition-all">
            Allgemein
          </TabsTrigger>
          <TabsTrigger value="desktop" className="rounded-3xl py-3 text-sm data-[state=active]:bg-accent/15 data-[state=active]:text-accent transition-all">
            Desktop
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4 mt-4">
          <SettingsSection icon={Palette} title="Design" description="App-Farben und Oberflächen auswählen">
            <ThemePickerSection />
          </SettingsSection>

          <SettingsSection icon={Eye} title="Glas-Effekt" description="Titelleiste und Karten mit transparenter Optik">
            <ToggleRow
              label="Glas-Design aktiviert"
              description="Sorgt für einen weicheren, moderneren Look"
              checked={true}
              onCheckedChange={() => toast('Die Titelleiste verwendet bereits Glas-Optik.')}
            />
            <p className="text-xs text-foreground/50">Diese Einstellung ist aktuell fest und spiegelt die Desktop-App-Stilrichtung wider.</p>
          </SettingsSection>

          <SettingsSection icon={BellRinging} title="Benachrichtigungen" description="Desktop-Benachrichtigungen und Sound-Optionen">
            <ToggleRow
              label="Benachrichtigungen aktiv"
              description="Systemmeldungen aus der Desktop-App anzeigen"
              checked={tauriConfig?.notifications_enabled ?? true}
              onCheckedChange={(value) => updateConfig({ notifications_enabled: value })}
            />
            <ToggleRow
              label="Töne aktivieren"
              description="Akustische Hinweise bei Ereignissen"
              checked={tauriConfig?.notification_sound ?? false}
              onCheckedChange={(value) => updateConfig({ notification_sound: value })}
            />
          </SettingsSection>
        </TabsContent>

        <TabsContent value="desktop" className="space-y-4 mt-4">
          {/* ── Local AI / LM Studio ── */}
          <SettingsSection icon={Robot} title="Local AI (LM Studio)" description="Stelle deine lokalen AI-Modelle dem IORA-Netzwerk zur Verfügung">
            {tauriConfig ? (
              <div className="space-y-4">
                <div className="rounded-2xl bg-accent/10 border border-accent/20 p-3">
                  <p className="text-xs text-accent font-medium">💡 Wenn LM Studio auf diesem PC läuft, stellt IORA Desktop die Modelle automatisch dem gesamten IORA-Netzwerk bereit.</p>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground/60">LM Studio Server URL</label>
                  <input
                    type="url"
                    value={tauriConfig.lm_studio_url}
                    onChange={(e) => updateConfig({ lm_studio_url: e.target.value })}
                    placeholder="http://localhost:1234"
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-foreground outline-none transition focus:border-accent/60 focus:ring-2 focus:ring-accent/10"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground/60">API Key (optional)</label>
                  <input
                    type="password"
                    value={tauriConfig.lm_studio_api_key}
                    onChange={(e) => updateConfig({ lm_studio_api_key: e.target.value })}
                    placeholder="Leer lassen, wenn nicht benötigt"
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-foreground outline-none transition focus:border-accent/60 focus:ring-2 focus:ring-accent/10"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground/60">Aktives Modell</label>
                  <div className="flex gap-2">
                    <select
                      value={tauriConfig.selected_model}
                      onChange={(e) => updateConfig({ selected_model: e.target.value })}
                      disabled={modelsLoading}
                      className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-foreground outline-none transition focus:border-accent/60 disabled:opacity-50"
                    >
                      <option value="">– Modell auswählen –</option>
                      {models.map((m) => (
                        <option key={m.id} value={m.id}>{m.id}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={loadModels}
                      disabled={modelsLoading}
                      className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-foreground transition hover:bg-white/10 disabled:opacity-50"
                    >
                      {modelsLoading ? '…' : '↺'}
                    </button>
                  </div>
                  {models.length === 0 && !modelsLoading && (
                    <p className="text-[11px] text-foreground/40 mt-1">Klicke ↺ um Modelle von LM Studio zu laden</p>
                  )}
                  {models.length > 0 && (
                    <p className="text-[11px] text-accent/80 mt-1">✓ {models.length} Modell{models.length > 1 ? 'e' : ''} gefunden</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={testLmConnection}
                    disabled={connectionStatus === 'testing'}
                    className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-foreground transition hover:bg-white/10 disabled:opacity-50"
                  >
                    {connectionStatus === 'testing' ? 'Teste…' : 'Verbindung testen'}
                  </button>
                  {connectionStatus === 'ok' && (
                    <span className="flex items-center gap-1 text-xs text-green-400"><SealCheck size={14} weight="fill" /> Verbunden</span>
                  )}
                  {connectionStatus === 'error' && (
                    <span className="text-xs text-red-400">✗ Nicht erreichbar</span>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-3xl bg-white/5 p-4 text-sm text-foreground/60">Wird geladen...</div>
            )}
          </SettingsSection>

          {/* ── IORA Assist Backend ── */}
          <SettingsSection icon={Lightning} title="IORA Assist Backend" description="Verbindung zum zentralen IORA Assist Server">
            {tauriConfig ? (
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground/60">IORA Assist URL</label>
                  <input
                    type="url"
                    value={tauriConfig.iora_backend_url}
                    onChange={(e) => updateConfig({ iora_backend_url: e.target.value })}
                    placeholder="http://localhost:8092"
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-foreground outline-none transition focus:border-accent/60 focus:ring-2 focus:ring-accent/10"
                  />
                </div>
              </div>
            ) : (
              <div className="rounded-3xl bg-white/5 p-4 text-sm text-foreground/60">Wird geladen...</div>
            )}
          </SettingsSection>

          {/* ── Client Identity ── */}
          <SettingsSection icon={IdentificationCard} title="Geräte-Identität" description="Name und ID dieses Clients im IORA-Netzwerk">
            {tauriConfig ? (
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground/60">Client-Name</label>
                  <input
                    type="text"
                    value={tauriConfig.client_name}
                    onChange={(e) => updateConfig({ client_name: e.target.value })}
                    placeholder="z.B. Wohnzimmer-PC"
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-foreground outline-none transition focus:border-accent/60 focus:ring-2 focus:ring-accent/10"
                  />
                  <p className="text-[11px] text-foreground/40">Anzeigename in IORA Assist (bei mehreren Clients)</p>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground/60">Client-ID</label>
                  <code className="block select-all overflow-x-auto rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs text-foreground/50">
                    {tauriConfig.client_id}
                  </code>
                </div>
              </div>
            ) : (
              <div className="rounded-3xl bg-white/5 p-4 text-sm text-foreground/60">Wird geladen...</div>
            )}
          </SettingsSection>

          {/* ── HA Integration ── */}
          <SettingsSection icon={Globe} title="Home Assistant Integration" description="System-Metriken an HA senden">
            {tauriConfig ? (
              <div className="space-y-4">
                <ToggleRow
                  label="Home Assistant Integration"
                  description="Systemdaten dieses Geräts an Home Assistant melden"
                  checked={tauriConfig.ha_enabled}
                  onCheckedChange={(value) => updateConfig({ ha_enabled: value })}
                />
                {tauriConfig.ha_enabled && (
                  <SliderRow
                    label="Metriken-Update-Intervall"
                    value={tauriConfig.ha_update_interval_secs}
                    min={30}
                    max={300}
                    unit="s"
                    onChange={(value) => updateConfig({ ha_update_interval_secs: value })}
                  />
                )}
              </div>
            ) : (
              <div className="rounded-3xl bg-white/5 p-4 text-sm text-foreground/60">Wird geladen...</div>
            )}
          </SettingsSection>

          <SettingsSection icon={Globe} title="Remote Home URL" description="Ziele auf die entfernte IORA Home-Instanz">
            {tauriConfig ? (
              <div className="space-y-4">
                <label className="block text-sm font-medium text-foreground">Remote Home URL</label>
                <input
                  type="url"
                  value={tauriConfig.iora_home_url}
                  onChange={(event) => updateConfig({ iora_home_url: event.target.value })}
                  placeholder="https://localhost:3001"
                  className="w-full rounded-3xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-foreground outline-none transition focus:border-accent/60 focus:ring-2 focus:ring-accent/10"
                />
                <ToggleRow
                  label="Automatisch starten"
                  description="Die Desktop-App beim Systemstart öffnen"
                  checked={tauriConfig.autostart_enabled}
                  onCheckedChange={(value) => updateConfig({ autostart_enabled: value })}
                />
              </div>
            ) : (
              <div className="rounded-3xl bg-white/5 p-4 text-sm text-foreground/60">Desktop-Einstellungen werden geladen...</div>
            )}
          </SettingsSection>

          <SettingsSection icon={WifiHigh} title="Netzwerk & Proxy" description="Proxy aktivieren und Backend-Verbindung überwachen">
            {tauriConfig ? (
              <div className="space-y-4">
                <ToggleRow
                  label="Proxy automatisch starten"
                  description="Den lokalen Proxy mit der Desktop-App starten"
                  checked={tauriConfig.auto_start_proxy}
                  onCheckedChange={(value) => updateConfig({ auto_start_proxy: value })}
                />
                <SliderRow
                  label="Proxy-Port"
                  value={tauriConfig.proxy_port}
                  min={1024}
                  max={65535}
                  unit=""
                  onChange={(value) => updateConfig({ proxy_port: value })}
                />
                <SliderRow
                  label="Health-Check Interval"
                  value={tauriConfig.health_poll_interval_secs}
                  min={10}
                  max={300}
                  unit="s"
                  onChange={(value) => updateConfig({ health_poll_interval_secs: value })}
                />
              </div>
            ) : (
              <div className="rounded-3xl bg-white/5 p-4 text-sm text-foreground/60">Desktop-Einstellungen werden geladen...</div>
            )}
          </SettingsSection>

          <SettingsSection icon={Sparkle} title="ORA AI Assistent" description="Verwalte Privatsphäre und Systemsteuerung der AI">
            {tauriConfig ? (
              <div className="space-y-4">
                <ToggleRow
                  label="Privatsphäre-Modus"
                  description="Deaktiviert ORA AI vollständig für diesen Client"
                  checked={tauriConfig.ora_privacy_mode}
                  onCheckedChange={(value) => updateConfig({ ora_privacy_mode: value })}
                />
                <ToggleRow
                  label="Systemsteuerung erlauben"
                  description="Erlaubt der AI auf Befehl, dein System zu steuern (Tastatur, Maus, Programme)"
                  checked={tauriConfig.ora_allow_control}
                  onCheckedChange={(value) => updateConfig({ ora_allow_control: value })}
                  disabled={tauriConfig.ora_privacy_mode}
                />
                <ToggleRow
                  label="Autopilot Modus"
                  description="Erlaubt der AI, selbstständig Systemsteuerungen durchzuführen ohne vorherige Bestätigung"
                  checked={tauriConfig.ora_autopilot}
                  onCheckedChange={(value) => updateConfig({ ora_autopilot: value })}
                  disabled={tauriConfig.ora_privacy_mode}
                />
              </div>
            ) : (
              <div className="text-sm text-foreground/50">Lade AI-Einstellungen...</div>
            )}
          </SettingsSection>

          <SettingsSection icon={BellRinging} title="Erweiterte Desktop-Funktionen" description="Diagnose und Hintergrundbetrieb">
            {tauriConfig ? (
              <div className="space-y-4">
                <ToggleRow
                  label="Diagnosedaten senden"
                  description="Hilft bei der Fehlerbehebung und Optimierung"
                  checked={tauriConfig.send_diagnostics}
                  onCheckedChange={(value) => updateConfig({ send_diagnostics: value })}
                />
                <ToggleRow
                  label="Im Hintergrund starten"
                  description="Minimiert starten, ohne sofort sichtbar zu sein"
                  checked={tauriConfig.autostart_minimized}
                  onCheckedChange={(value) => updateConfig({ autostart_minimized: value })}
                />
                <ToggleRow
                  label="Im Hintergrund verstecken"
                  description="Startet die App ohne Taskleisten-Symbol"
                  checked={tauriConfig.autostart_hidden}
                  onCheckedChange={(value) => updateConfig({ autostart_hidden: value })}
                />
              </div>
            ) : (
              <div className="rounded-3xl bg-white/5 p-4 text-sm text-foreground/60">Desktop-Einstellungen werden geladen...</div>
            )}
          </SettingsSection>

          <SettingsSection icon={Desktop} title="Fenster & Anzeige" description="Steuere Helligkeit, Kiosk-Modus und Fensterverhalten">
            {tauriConfig ? (
              <div className="space-y-4">
                <SliderRow
                  label="Display-Helligkeit"
                  value={tauriConfig.display_brightness}
                  min={0}
                  max={100}
                  unit="%"
                  onChange={(value) => updateConfig({ display_brightness: value })}
                />
                <ToggleRow
                  label="Immer im Vordergrund"
                  description="Das Fenster bleibt über anderen Anwendungen"
                  checked={tauriConfig.always_on_top}
                  onCheckedChange={(value) => updateConfig({ always_on_top: value })}
                />
                <ToggleRow
                  label="Kiosk-Modus"
                  description="Vollbild ohne Menüleiste für Wandtablets"
                  checked={tauriConfig.kiosk_mode}
                  onCheckedChange={(value) => updateConfig({ kiosk_mode: value })}
                />
              </div>
            ) : (
              <div className="rounded-3xl bg-white/5 p-4 text-sm text-foreground/60">Desktop-Einstellungen werden geladen...</div>
            )}
          </SettingsSection>

          <SettingsSection icon={Screencast} title="Bildschirmschoner" description="Automatisches Dimmen bei Inaktivität">
            {tauriConfig ? (
              <div className="space-y-4">
                <ToggleRow
                  label="Bildschirmschoner aktiv"
                  description="Display automatisch dimmen"
                  checked={tauriConfig.screen_saver_enabled}
                  onCheckedChange={(value) => updateConfig({ screen_saver_enabled: value })}
                />
                {tauriConfig.screen_saver_enabled && (
                  <SliderRow
                    label="Timeout"
                    value={Math.round(tauriConfig.screen_saver_timeout_secs / 60)}
                    min={1}
                    max={30}
                    unit=" min"
                    onChange={(value) => updateConfig({ screen_saver_timeout_secs: value * 60 })}
                  />
                )}
              </div>
            ) : (
              <div className="rounded-3xl bg-white/5 p-4 text-sm text-foreground/60">Desktop-Einstellungen werden geladen...</div>
            )}
          </SettingsSection>

          <SettingsSection icon={Info} title="Systemübersicht" description="Live-Status und Rechnerdaten">
            {deviceMetrics ? (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center gap-2 text-sm text-foreground/70 mb-3">
                    <Cpu size={16} /> CPU
                  </div>
                  <p className="text-2xl font-semibold text-foreground">{deviceMetrics.cpu_usage.toFixed(1)}%</p>
                  <p className="text-xs text-foreground/50 mt-1">Auslastung</p>
                </div>
                <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center gap-2 text-sm text-foreground/70 mb-3">
                    <HardDrives size={16} /> RAM
                  </div>
                  <p className="text-2xl font-semibold text-foreground">{deviceMetrics.memory_used_gb.toFixed(1)} / {deviceMetrics.memory_total_gb.toFixed(1)} GB</p>
                  <p className="text-xs text-foreground/50 mt-1">Speicher</p>
                </div>
                <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center gap-2 text-sm text-foreground/70 mb-3">
                    <Database size={16} /> Speicher
                  </div>
                  <p className="text-2xl font-semibold text-foreground">{deviceMetrics.disk_used_gb.toFixed(0)} / {deviceMetrics.disk_total_gb.toFixed(0)} GB</p>
                  <p className="text-xs text-foreground/50 mt-1">Festplatte</p>
                </div>
                <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center gap-2 text-sm text-foreground/70 mb-3">
                    <BatteryHigh size={16} /> Akku
                  </div>
                  <p className="text-2xl font-semibold text-foreground">{deviceMetrics.battery_percent != null ? `${deviceMetrics.battery_percent.toFixed(0)}%` : 'n/a'}</p>
                  <p className="text-xs text-foreground/50 mt-1">{deviceMetrics.battery_state ?? 'Unbekannt'}</p>
                </div>
              </div>
            ) : (
              <div className="rounded-3xl bg-white/5 p-4 text-sm text-foreground/60">Systeminformationen werden geladen...</div>
            )}
          </SettingsSection>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={saveDesktopConfig}
              disabled={saving || loadingConfig || !tauriConfig}
              className="rounded-3xl bg-accent px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-accent/20 transition hover:bg-accent/95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Speichern…' : 'Änderungen speichern'}
            </button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
