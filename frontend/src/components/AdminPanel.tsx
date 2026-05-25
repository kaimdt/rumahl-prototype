import { useTranslation } from 'react-i18next'
import '@/i18n' // side-effect: initializes i18next
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { motion, AnimatePresence } from 'motion/react'
import {
  ShieldCheck, Users, Key, HardDrive, CloudArrowUp,
  Cpu, WifiHigh, Cube, Gear, ListBullets, Database,
  ArrowClockwise, Copy, Trash, Plus,
  Warning, Power, PencilSimple, LockKey, UserMinus,
  MagnifyingGlass, ToggleLeft, ToggleRight,
  FilmSlate, Archive, Globe, Play, X,
  Bluetooth, Tree, LinkSimple, AppleLogo, Pulse, Wrench,
  CloudWarning, ShieldWarning, Siren,
  WebhooksLogo, Broadcast, Lightning, Eye, PaperPlaneTilt, CheckCircle, XCircle, Clock,
  MagnifyingGlassPlus, Timer, ChartLine, BookOpen, CalendarBlank, TrendUp, Heartbeat, Dog, CaretDown, CaretUp,
  Gauge, ListChecks, Robot, Hand, Queue, CircleNotch, Bell, Code, Megaphone, Stack, Brain, ChatCircle, Microphone, MagicWand, Desktop, Monitor,
  Vault, FolderOpen, ShareNetwork, Envelope, Plug, FileArrowDown,
  Terminal, List, Sparkle,
  Palette, TrashSimple, Check, EyeSlash, UploadSimple, Swatches, File, MapPin,
  Storefront, CloudSlash, Star, DownloadSimple
} from '@phosphor-icons/react'
import { Tip } from '@/components/ui/tip'
import { toast } from 'sonner'
import { SystemInfoTab, PluginsTab, RegistrationManagementTab, SecurityMonitorTab, UpdateManagementTab, WidgetManagementTab, AppStoreTab } from './AdminPanelTabs'
import { AgentTab } from './AgentTab'
import { InfrastructureVisualization } from './InfrastructureVisualization'
import { getBackendUrl, getDevBridgeUrl } from '@/lib/config'
import { useTheme } from '@/contexts/ThemeContext'
import { authFetch } from '@/lib/authHelpers'

interface CloudSettings {
  connectorHost: string
  useTls: boolean
  privatePort: number
  publicProxyPort: number
  enableReverseProxy: boolean
  requireVpnOnly: boolean
}

interface AdminUser {
  id: string
  username: string
  display_name?: string
  avatar_url?: string
  role: string
  is_admin: boolean
  has_password: boolean
  has_pin: boolean
  created_at: string
  updated_at: string
}

interface ApiKeyEntry {
  id: string
  user_id: string
  name: string
  key_prefix: string
  permissions: string
  rate_limit: number
  last_used_at?: string
  expires_at?: string
  is_active: boolean
  created_at: string
}

interface ApiKeyWithSecret extends ApiKeyEntry {
  key: string
}

type Tab = 'services' | 'health-intelligence' | 'tasks' | 'control-mode' | 'system' | 'system-info' | 'network' | 'infrastructure' | 'users' | 'api-keys' | 'webhooks' | 'ha-config' | 'ha-connection' | 'integrations' | 'mqtt' | 'matter' | 'zigbee' | 'zwave' | 'ble' | 'homekit' | 'scenes' | 'automations' | 'backups' | 'cloud-settings' | 'logs' | 'realtime' | 'database' | 'warnings' | 'entities' | 'scheduler' | 'analytics' | 'logbook' | 'calendars' | 'system-notifications' | 'apps' | 'plugins' | 'registrations' | 'security-monitor' | 'updates' | 'widgets' | 'global-config' | 'developer-mode' | 'documentation' | 'protocols' | 'ha-tools' | 'global-alert' | 'notifications' | 'ai-agent' | 'ai-overview' | 'ai-providers' | 'ai-conversations' | 'ai-tasks' | 'ai-tools' | 'ai-voice' | 'devices' | 'secrets' | 'files' | 'gateway' | 'watchdog' | 'connector' | 'domain-validator' | 'resources' | 'api-bridge' | 'dev-bridge' | 'os-ssh' | 'os-network-config' | 'os-disks' | 'os-processes' | 'os-power' | 'themes'

// ═══ Unified Control Center Design Components ═══
// Theme-aware, consistent input/button/card primitives for the entire Control Center.

const ccInput = (base: string = '') =>
  `w-full rounded-xl border border-foreground/[0.08] bg-foreground/[0.04] px-4 py-2.5 text-sm text-foreground placeholder:text-foreground/30 outline-none transition-all duration-200 hover:border-foreground/[0.15] focus:border-accent/60 focus:ring-2 focus:ring-accent/10 focus:bg-foreground/[0.06] ${base}`

const ccSelect = (base: string = '') =>
  `${ccInput()} appearance-none cursor-pointer pr-10 ${base}`

const ccTextarea = (base: string = '') =>
  `${ccInput()} resize-y min-h-[80px] ${base}`

const ccBtnPrimary = (base: string = '') =>
  `inline-flex items-center justify-center gap-1.5 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-accent/20 transition-all duration-200 hover:bg-accent/90 hover:shadow-md hover:shadow-accent/25 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-accent ${base}`

const ccBtnSecondary = (base: string = '') =>
  `inline-flex items-center justify-center gap-1.5 rounded-xl border border-foreground/[0.08] bg-foreground/[0.04] px-5 py-2.5 text-sm font-semibold text-foreground/80 transition-all duration-200 hover:border-foreground/[0.15] hover:bg-foreground/[0.08] active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed ${base}`

const ccBtnDanger = (base: string = '') =>
  `inline-flex items-center justify-center gap-1.5 rounded-xl border border-red-500/20 bg-red-500/10 px-5 py-2.5 text-sm font-semibold text-red-400 transition-all duration-200 hover:bg-red-500/20 hover:border-red-500/30 active:scale-[0.98] disabled:opacity-40 ${base}`

const ccBtnIcon = (base: string = '') =>
  `inline-flex items-center justify-center rounded-xl p-2 text-foreground/50 hover:text-foreground hover:bg-foreground/[0.06] transition-all duration-200 active:scale-95 ${base}`

const ccCard = (base: string = '') =>
  `rounded-2xl border border-foreground/[0.06] bg-background/60 backdrop-blur-xl p-4 sm:p-5 overflow-x-auto ${base}`

const ccBadge = (color: string, base: string = '') =>
  `inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold ${color} ${base}`

const ccLabel = 'text-[10px] font-semibold uppercase tracking-[0.15em] text-foreground/50 mb-1.5 block'
const ccSectionTitle = 'text-sm font-semibold text-foreground mb-3'

// ═══ End Design Components ═══

// Static tab IDs for quick lookup (used by adminPathToTab before component mounts)
const TAB_IDS = new Set<Tab>([
  'services', 'health-intelligence', 'themes', 'developer-mode', 'documentation',
  'protocols', 'ha-tools', 'global-alert', 'notifications', 'tasks', 'control-mode',
  'system', 'system-info', 'network', 'infrastructure', 'users', 'apps', 'plugins',
  'registrations', 'security-monitor', 'updates', 'widgets', 'api-keys', 'webhooks',
  'ha-config', 'ha-connection', 'integrations', 'entities', 'mqtt', 'zigbee', 'zwave',
  'matter', 'ble', 'homekit', 'scenes', 'automations', 'scheduler', 'analytics',
  'backups', 'cloud-settings', 'logs', 'logbook', 'calendars', 'realtime', 'database',
  'warnings', 'system-notifications', 'ai-overview', 'ai-providers', 'ai-conversations',
  'ai-tasks', 'ai-tools', 'ai-voice', 'ai-agent', 'devices', 'secrets', 'files',
  'gateway', 'watchdog', 'connector', 'domain-validator', 'resources', 'api-bridge',
  'dev-bridge', 'os-ssh', 'os-network-config', 'os-disks', 'os-processes', 'os-power',
])

type TabEntry = { id: Tab; label: string; icon: typeof ShieldCheck; description: string }

/** Factory: creates the tabs array using the given translation function.
 *  Must not call i18n.t at module level — the bundler mangles it to bare t(). */
function getTabs(t: (key: string) => string): TabEntry[] {
  return [
    { id: 'services', label: t('admin.services'), icon: Gauge, description: 'Alle IORA-Dienste überwachen — Status, Erreichbarkeit und Uptime aller Microservices' },
    { id: 'health-intelligence', label: t('admin.healthIntelligence'), icon: Heartbeat, description: 'KI-gestützte Systemanalyse — Health Scores, Vorhersagen, Anomalien und Smart Suggestions' },
    { id: 'themes', label: t('admin.themes'), icon: Palette, description: t('admin.themesDesc') },
    { id: 'developer-mode', label: t('admin.developerMode'), icon: Wrench, description: 'Debug-Funktionen aktivieren — erweiterte Logs, Render-Counter, rohe JSON-Antworten, SSE/WS-Frame-Inspektor' },
    { id: 'documentation', label: t('admin.documentation'), icon: BookOpen, description: t('admin.docsDesc') },
    { id: 'protocols', label: t('admin.protocols'), icon: Stack, description: 'Kombinierte Live-Übersicht aller IoT-Protokolle (HA, MQTT, Zigbee, Z-Wave, Matter, BLE, HomeKit) auf einen Blick' },
    { id: 'ha-tools', label: t('admin.haTools'), icon: Code, description: t('admin.haToolsDesc') },
    { id: 'global-alert', label: t('admin.globalAlert'), icon: Megaphone, description: 'System-weiten Banner-Alarm setzen oder zurücknehmen — wird allen verbundenen Clients per WebSocket zugestellt' },
    { id: 'notifications', label: t('admin.notifications'), icon: Bell, description: 'Alle vom Backend erzeugten Benachrichtigungen einsehen, als gelesen markieren oder löschen' },
    { id: 'tasks', label: t('admin.tasks'), icon: ListChecks, description: 'Hintergrund-Aufgaben und Warteschlangen überwachen, Aufgaben manuell auslösen oder deaktivieren' },
    { id: 'control-mode', label: t('admin.controlMode'), icon: Robot, description: t('admin.controlModeDesc') },
    { id: 'system', label: t('admin.system'), icon: Cpu, description: t('admin.systemDesc') },
    { id: 'system-info', label: t('admin.systemInfo'), icon: Heartbeat, description: 'Detaillierte Systeminformationen von IORA OS — CPU, RAM, Festplatten und Netzwerk' },
    { id: 'network', label: 'Netzwerk', icon: Globe, description: 'Netzwerk-Informationen und IP-Konfiguration verwalten' },
    { id: 'infrastructure', label: 'Infrastruktur', icon: TrendUp, description: 'Live-Visualisierung der gesamten IORA-Infrastruktur mit Service-Status und Datenflüssen' },
    { id: 'users', label: 'Benutzer', icon: Users, description: 'Benutzerkonten verwalten, Rollen zuweisen und Zugänge kontrollieren' },
    { id: 'apps', label: t('admin.apps'), icon: Cube, description: t('admin.appsDesc') },
    { id: 'plugins', label: t('admin.plugins'), icon: Lightning, description: 'Code-Erweiterungen verwalten — Plugins on-demand in Sandbox ausführen' },
    { id: 'registrations', label: 'Registrierungen', icon: ShieldCheck, description: 'App- und Plugin-Registrierungen genehmigen, ablehnen oder widerrufen' },
    { id: 'security-monitor', label: 'Sicherheit', icon: ShieldWarning, description: 'Sicherheitswarnungen, Ressourcennutzung und Anomalie-Erkennung überwachen' },
    { id: 'updates', label: 'Updates', icon: CloudArrowUp, description: 'Verfügbare Updates prüfen, installieren oder zurückrollen' },
    { id: 'widgets', label: 'Widgets', icon: Cube, description: 'Registrierte Widgets von Apps und Plugins verwalten' },
    { id: 'api-keys', label: 'API Keys', icon: Key, description: 'API-Schlüssel erstellen und verwalten für externe Zugriffe' },
    { id: 'webhooks', label: 'Webhooks', icon: WebhooksLogo, description: 'Ausgehende Webhooks registrieren für Echtzeit-Event-Zustellung mit HMAC-Signaturen' },
    { id: 'ha-config', label: 'HA Config', icon: Gear, description: 'Home Assistant URL und Token konfigurieren' },
    { id: 'ha-connection', label: 'HA Status', icon: Pulse, description: 'Verbindungsstatus zu Home Assistant, erkannte Integrationen und Ereignis-Log' },
    { id: 'integrations', label: 'Integrationen', icon: Cube, description: 'Alle in Home Assistant installierten Integrationen anzeigen' },
    { id: 'entities', label: 'Entities', icon: MagnifyingGlassPlus, description: 'Alle Entitäten durchsuchen, filtern und Details mit Verlaufsdaten anzeigen' },
    { id: 'mqtt', label: 'MQTT', icon: WifiHigh, description: 'MQTT-Broker verbinden, Topics abonnieren und Nachrichten senden/empfangen' },
    { id: 'zigbee', label: 'Zigbee', icon: Tree, description: 'Zigbee-Netzwerk verwalten (Zigbee2MQTT / ZHA), Geräte und Signalqualität' },
    { id: 'zwave', label: 'Z-Wave', icon: LinkSimple, description: 'Z-Wave Nodes und Netzwerk-Topologie über Z-Wave JS überwachen' },
    { id: 'matter', label: 'Matter', icon: HardDrive, description: 'Matter-Bridge konfigurieren, Geräte und Fabrics verwalten' },
    { id: 'ble', label: 'Bluetooth', icon: Bluetooth, description: 'Bluetooth/BLE-Geräte, Adapter und Signalstärke überwachen' },
    { id: 'homekit', label: 'HomeKit', icon: AppleLogo, description: 'HomeKit-Bridge konfigurieren und Zubehör-Zuordnungen verwalten' },
    { id: 'scenes', label: 'Szenen', icon: FilmSlate, description: 'Home Assistant Szenen anzeigen und aktivieren' },
    { id: 'automations', label: 'Automationen', icon: Power, description: 'Alle Automationen anzeigen, Status prüfen und letzte Auslösung sehen' },
    { id: 'scheduler', label: 'Scheduler', icon: Timer, description: 'Zeitpläne und Watchdogs für automatisierte Aktionen verwalten' },
    { id: 'analytics', label: 'Analytics', icon: ChartLine, description: 'Dashboard-Statistiken, Entity-Nutzung und System-Gesundheit überwachen' },
    { id: 'backups', label: 'Backups', icon: Archive, description: 'Dashboard-Konfiguration sichern und wiederherstellen' },
    { id: 'cloud-settings', label: 'IORA Cloud', icon: CloudArrowUp, description: 'Private API-URL und Ports für den Cloud Connector konfigurieren' },
    { id: 'logs', label: 'Logs', icon: ListBullets, description: 'System- und Home Assistant Logs in Echtzeit einsehen' },
    { id: 'logbook', label: 'Logbuch', icon: BookOpen, description: 'Home Assistant Logbuch — chronologischer Verlauf aller Zustandsänderungen und Ereignisse' },
    { id: 'calendars', label: 'Kalender', icon: CalendarBlank, description: 'Home Assistant Kalender-Entitäten und anstehende Termine anzeigen' },
    { id: 'realtime', label: 'Realtime', icon: Broadcast, description: 'SSE Event-Streams und Socket.IO-Namespace-WebSocket für Echtzeit-Daten testen und überwachen' },
    { id: 'database', label: 'Datenbank', icon: Database, description: 'SQLite-Datenbank verwalten, bereinigen und Statistiken anzeigen' },
    { id: 'warnings', label: 'Warnungen', icon: ShieldWarning, description: 'Protokoll aller Wetter- und Zivilschutzwarnungen mit Zeitstempeln' },
    { id: 'system-notifications', label: 'System-Meldungen', icon: Siren, description: 'Systemmeldungen zu Sync-Status, Datenlücken und Backend-Warnungen – nur für Admins sichtbar' },
    { id: 'ai-overview', label: 'AI Übersicht', icon: Brain, description: 'IORA Assist Status, aktiver Provider, Verbrauch und Health — zentrale AI-Übersicht' },
    { id: 'ai-providers', label: 'AI Provider', icon: MagicWand, description: 'AI Provider verwalten — OpenAI, Anthropic, lokale Modelle und Desktop-Bridges konfigurieren' },
    { id: 'ai-conversations', label: 'AI Konversationen', icon: ChatCircle, description: 'Konversations-Threads, Verlauf und proaktive Benachrichtigungen verwalten' },
    { id: 'ai-tasks', label: 'AI Aufgaben', icon: Robot, description: 'Autonome AI-Aufgaben — Zeitpläne, Trigger und Status der Hintergrund-Agenten' },
    { id: 'ai-tools', label: 'AI Tools', icon: Hand, description: 'Internet-Suche, Web-Scraping und Screenshot-Tools des Assistenten testen und ausführen' },
    { id: 'ai-voice', label: 'AI Stimme', icon: Microphone, description: 'Spracheingabe (STT) und Sprachausgabe (TTS) testen — Voice-Modelle und Latenz prüfen' },
    { id: 'ai-agent', label: 'Agent', icon: Robot, description: 'Vollständiger Agent-Arbeitsbereich mit Chat, Aufgaben und Verlauf — wie GitHub Agent Tab' },
    { id: 'devices', label: 'Verbundene Geräte', icon: Desktop, description: 'Alle registrierten IORA Desktop, Browser- und Kiosk-Clients sehen — Online-Status, letzter Heartbeat, aktive WebSocket-Sitzungen' },
    { id: 'secrets', label: 'Secrets', icon: Vault, description: 'Verschlüsselter Tresor für API-Keys, Tokens und Passwörter — verwalten, rotieren und Audit-Log einsehen (iora-secrets)' },
    { id: 'files', label: 'Dateien', icon: FolderOpen, description: 'Datei-Verwaltung mit Versionierung, Freigabe-Links, Berechtigungen und Quotas (iora-files)' },
    { id: 'gateway', label: 'Gateway', icon: Envelope, description: 'Externe Gateway-Operationen — E-Mail-Versand, Web-Suche, HTTP-Proxy und Update-Verifikation (iora-gateway)' },
    { id: 'watchdog', label: 'Watchdog', icon: Dog, description: 'Service-Health-Monitoring, Heartbeats, Auto-Recovery und Event-Stream (iora-watchdog)' },
    { id: 'connector', label: 'Connector / Tunnel', icon: ShareNetwork, description: 'Cloud-Tunnel, exponierte Dienste, Pairing-Tokens und IP-Blocklist (iora-connector)' },
    { id: 'domain-validator', label: 'Domain Validator', icon: ShieldCheck, description: 'App-Zugriffsrichtlinien für externe Domains und Audit-Log (iora-domain-validator)' },
    { id: 'resources', label: 'Ressourcen', icon: HardDrive, description: 'Container-Ressourcenverwaltung, CPU-/RAM-Allokation und Reallokation (iora-resource-manager)' },
    { id: 'api-bridge', label: 'API Bridge', icon: Code, description: 'GraphQL, WebDAV, CalDAV und MQTT-Bridge — externe Schnittstellen der iora-api' },
    { id: 'dev-bridge', label: 'Dev Bridge', icon: Terminal, description: 'IORA OS Dev Bridge — Service-Logs, System-Info, Filesystem, Build & Replace und Live-Streaming aller Dienste auf Entwickler-Images' },
    { id: 'os-ssh', label: 'SSH-Zugang', icon: Terminal, description: 'SSH-Server aktivieren/deaktivieren, autorisierte Schlüssel und SSH-Benutzer verwalten — nur auf IORA OS' },
    { id: 'os-network-config', label: 'IP-Konfiguration', icon: Globe, description: 'Netzwerk-Interfaces auflisten und IP/Gateway/DNS pro Interface konfigurieren — nur auf IORA OS' },
    { id: 'os-disks', label: 'Festplatten', icon: HardDrive, description: 'Alle gemounteten Datenträger, Belegung, Dateisysteme und entfernbare Medien — nur auf IORA OS' },
    { id: 'os-processes', label: 'Prozesse', icon: Pulse, description: 'Top-Prozesse mit CPU- und RAM-Verbrauch, sortiert nach Auslastung — nur auf IORA OS' },
    { id: 'os-power', label: 'Power & Hostname', icon: Power, description: 'Hostname ändern, IORA OS neu starten oder herunterfahren — nur auf IORA OS' },
  ]
}

type TabGroup = {
  id: string
  title: string
  icon: typeof ShieldCheck
  items: Tab[]
}

const tabGroups: TabGroup[] = [
  { id: 'core', title: 'System & Kontrolle', icon: Cpu, items: ['services', 'health-intelligence', 'global-config', 'developer-mode', 'dev-bridge', 'documentation', 'tasks', 'control-mode', 'system', 'system-info', 'network', 'infrastructure', 'devices'] },
  { id: 'ai', title: 'KI & Assistent', icon: Brain, items: ['ai-agent', 'ai-overview', 'ai-providers', 'ai-conversations', 'ai-tasks', 'ai-tools', 'ai-voice'] },
  { id: 'extensions', title: 'Apps, Plugins & Themes', icon: Palette, items: ['apps', 'plugins', 'themes', 'registrations', 'security-monitor', 'updates', 'widgets'] },
  { id: 'home', title: 'Home Assistant', icon: Cube, items: ['ha-config', 'ha-connection', 'integrations', 'entities', 'ha-tools', 'scenes', 'automations', 'logbook', 'calendars'] },
  { id: 'devices', title: 'Geräte & Netzwerk', icon: WifiHigh, items: ['protocols', 'mqtt', 'zigbee', 'zwave', 'matter', 'ble', 'homekit'] },
  { id: 'services', title: 'IORA Backend-Dienste', icon: Plug, items: ['secrets', 'files', 'gateway', 'watchdog', 'connector', 'domain-validator', 'resources', 'api-bridge'] },
  { id: 'os', title: 'IORA OS', icon: Terminal, items: ['os-ssh', 'os-network-config', 'os-disks', 'os-processes', 'os-power'] },
  { id: 'tools', title: 'Tools & Infrastruktur', icon: Wrench, items: ['api-keys', 'webhooks', 'scheduler', 'analytics', 'backups', 'cloud-settings', 'logs', 'database', 'warnings', 'system-notifications', 'global-alert', 'notifications'] },
  { id: 'access', title: 'Benutzer', icon: Users, items: ['users'] },
]

const CLOUD_HOST_KEY = 'iora-cloud-connector-host'
const CLOUD_USE_TLS_KEY = 'iora-cloud-connector-use-tls'
const CLOUD_PRIVATE_PORT_KEY = 'iora-cloud-connector-private-port'
const CLOUD_PUBLIC_PORT_KEY = 'iora-cloud-connector-public-port'
const CLOUD_ENABLE_REVERSE_PROXY_KEY = 'iora-cloud-connector-enable-reverse-proxy'
const CLOUD_REQUIRE_VPN_KEY = 'iora-cloud-connector-require-vpn'

function CloudSettingsTab({ token }: { token: string }) {
  const [settings, setSettings] = useState<CloudSettings>({
    connectorHost: '',
    useTls: true,
    privatePort: 3001,
    publicProxyPort: 443,
    enableReverseProxy: true,
    requireVpnOnly: true,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testState, setTestState] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [testError, setTestError] = useState<string | null>(null)
  const [testInfo, setTestInfo] = useState<{ online: boolean; ha: boolean; entities: number } | null>(null)

  useEffect(() => {
    const persistedHost = localStorage.getItem(CLOUD_HOST_KEY)
    const persistedTls = localStorage.getItem(CLOUD_USE_TLS_KEY)
    const persistedPrivatePort = localStorage.getItem(CLOUD_PRIVATE_PORT_KEY)
    const persistedPublicPort = localStorage.getItem(CLOUD_PUBLIC_PORT_KEY)
    const persistedReverseProxy = localStorage.getItem(CLOUD_ENABLE_REVERSE_PROXY_KEY)
    const persistedVpnOnly = localStorage.getItem(CLOUD_REQUIRE_VPN_KEY)

    setSettings((current) => ({
      connectorHost: persistedHost ?? current.connectorHost,
      useTls: persistedTls === null ? current.useTls : persistedTls === 'true',
      privatePort: persistedPrivatePort ? Number(persistedPrivatePort) : current.privatePort,
      publicProxyPort: persistedPublicPort ? Number(persistedPublicPort) : current.publicProxyPort,
      enableReverseProxy: persistedReverseProxy === null ? current.enableReverseProxy : persistedReverseProxy === 'true',
      requireVpnOnly: persistedVpnOnly === null ? current.requireVpnOnly : persistedVpnOnly === 'true',
    }))
    setLoading(false)
  }, [])

  const saveSettings = useCallback(async () => {
    setSaving(true)
    setError(null)

    const payload = {
      connector_host: settings.connectorHost,
      use_tls: settings.useTls,
      private_port: settings.privatePort,
      public_proxy_port: settings.publicProxyPort,
      enable_reverse_proxy: settings.enableReverseProxy,
      require_vpn_only: settings.requireVpnOnly,
    }

    try {
      await adminFetch('/api/admin/iora-cloud/config', token, {
        method: 'PUT',
        body: JSON.stringify(payload),
      })
    } catch {
      // Fallback: save locally if backend is not available
    }

    localStorage.setItem(CLOUD_HOST_KEY, settings.connectorHost)
    localStorage.setItem(CLOUD_USE_TLS_KEY, String(settings.useTls))
    localStorage.setItem(CLOUD_PRIVATE_PORT_KEY, String(settings.privatePort))
    localStorage.setItem(CLOUD_PUBLIC_PORT_KEY, String(settings.publicProxyPort))
    localStorage.setItem(CLOUD_ENABLE_REVERSE_PROXY_KEY, String(settings.enableReverseProxy))
    localStorage.setItem(CLOUD_REQUIRE_VPN_KEY, String(settings.requireVpnOnly))

    toast.success('IORA Cloud Einstellungen gespeichert')
    setSaving(false)
  }, [settings, token])

  const testConnection = useCallback(async () => {
    if (!settings.connectorHost.trim()) {
      setTestState('error')
      setTestError('Bitte eine Host-IP oder einen Hostnamen eingeben.')
      return
    }

    setTestState('testing')
    setTestError(null)
    setTestInfo(null)

    const protocol = settings.useTls ? 'https' : 'http'
    const url = `${protocol}://${settings.connectorHost}:${settings.privatePort}/health`

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setTestInfo({
        online: true,
        ha: data.ha_connected ?? false,
        entities: data.entity_count ?? 0,
      })
      setTestState('success')
    } catch (err) {
      setTestState('error')
      setTestError(err instanceof Error ? err.message : 'Verbindung fehlgeschlagen')
    }
  }, [settings])

  const currentUrl = `${settings.useTls ? 'https' : 'http'}://${settings.connectorHost}${settings.privatePort ? `:${settings.privatePort}` : ''}`

  return (
    <div className="space-y-5">
      <div className={ccCard()}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-accent/15 flex items-center justify-center">
            <CloudArrowUp size={18} className="text-accent" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">IORA Cloud Connector</p>
            <p className="text-[11px] text-foreground/40">Konfiguriere den Connector mit IP, Ports und Verschlüsselung.</p>
          </div>
        </div>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <label className={ccLabel}>Connector Host / IP</label>
            <input type="text" value={settings.connectorHost} onChange={(e) => setSettings({ ...settings, connectorHost: e.target.value })} placeholder="10.0.0.2" className={ccInput()} />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <label className={ccLabel}>Protokoll</label>
              <select value={settings.useTls ? 'https' : 'http'} onChange={(e) => setSettings({ ...settings, useTls: e.target.value === 'https' })} className={ccSelect()}>
                <option value="https">HTTPS</option>
                <option value="http">HTTP</option>
              </select>
            </div>
            <div className="grid gap-1.5">
              <label className={ccLabel}>Privater API Port</label>
              <input type="number" min={1} max={65535} value={settings.privatePort} onChange={(e) => setSettings({ ...settings, privatePort: Number(e.target.value) || 3001 })} className={ccInput()} />
            </div>
            <div className="grid gap-1.5">
              <label className={ccLabel}>Öffentlicher Proxy-Port</label>
              <input type="number" min={1} max={65535} value={settings.publicProxyPort} onChange={(e) => setSettings({ ...settings, publicProxyPort: Number(e.target.value) || 443 })} className={ccInput()} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className={`flex items-center gap-3 rounded-xl border border-foreground/[0.06] bg-foreground/[0.03] px-4 py-3 text-sm text-foreground/80 cursor-pointer hover:border-foreground/[0.12] transition-all duration-200`}>
              <input type="checkbox" checked={settings.enableReverseProxy} onChange={(e) => setSettings({ ...settings, enableReverseProxy: e.target.checked })} className="h-4 w-4 rounded-md border-foreground/30 bg-transparent text-accent focus:ring-accent focus:ring-offset-0 cursor-pointer" />
              Öffentlichen Reverse-Proxy aktivieren
            </label>
            <label className={`flex items-center gap-3 rounded-xl border border-foreground/[0.06] bg-foreground/[0.03] px-4 py-3 text-sm text-foreground/80 cursor-pointer hover:border-foreground/[0.12] transition-all duration-200`}>
              <input type="checkbox" checked={settings.requireVpnOnly} onChange={(e) => setSettings({ ...settings, requireVpnOnly: e.target.checked })} className="h-4 w-4 rounded-md border-foreground/30 bg-transparent text-accent focus:ring-accent focus:ring-offset-0 cursor-pointer" />
              Nur VPN/Tailscale-Zugriff auf privaten Port
            </label>
          </div>

          <div className="rounded-xl border border-amber-500/15 bg-amber-500/[0.04] p-4 text-sm text-foreground/70">
            <p className="font-semibold text-foreground flex items-center gap-1"><Warning size={14} className="text-amber-400" /> Wichtig</p>
            <p className="mt-2 text-[12px]">Der Connector soll auf allen ihm zugewiesenen IP-Adressen hören. Der private API-Port ist für interne Cloud-Verbindungen vorgesehen, der öffentliche Proxy-Port nur für verschlüsselte Zugriffe.</p>
            <p className="mt-1.5 text-[12px]">Diese Seite ist die einzige Stelle zur Einrichtung und Anpassung des IORA Cloud Connectors.</p>
          </div>

          <div className="grid gap-1.5">
            <label className={ccLabel}>Berechnete Connector-URL</label>
            <div className={`${ccInput()} font-mono text-xs flex items-center justify-between gap-2`}>
              <span className="truncate">{currentUrl}</span>
              <button onClick={() => { navigator.clipboard.writeText(currentUrl); toast.success('URL kopiert') }} className={ccBtnIcon('flex-shrink-0')}><Copy size={14} /></button>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center pt-2">
            <button onClick={saveSettings} disabled={saving || loading} className={ccBtnPrimary()}>
              {saving ? 'Speichert…' : 'Einstellungen speichern'}
            </button>
            <button onClick={testConnection} disabled={!settings.connectorHost.trim() || testState === 'testing'} className={ccBtnSecondary()}>
              {testState === 'testing' ? 'Teste Verbindung…' : 'Verbindung testen'}
            </button>
          </div>

          {testState === 'success' && testInfo && (
            <div className="rounded-xl border border-green-500/20 bg-green-500/[0.06] p-4">
              <p className="text-sm font-semibold text-green-400 flex items-center gap-1.5"><CheckCircle size={14} weight="fill" /> Verbindung erfolgreich</p>
              <div className="mt-2 space-y-1 text-[12px] text-foreground/60">
                <p>Status: online</p>
                <p>Home Assistant: {testInfo.ha ? 'verbunden' : 'nicht verbunden'}</p>
                <p>Entitäten: {testInfo.entities}</p>
              </div>
            </div>
          )}

          {testState === 'error' && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/[0.06] p-4">
              <p className="text-sm font-semibold text-red-400 flex items-center gap-1.5"><XCircle size={14} weight="fill" /> Verbindung fehlgeschlagen</p>
              <p className="mt-2 text-[12px] text-red-300">{testError}</p>
            </div>
          )}

          {error && <div className="rounded-xl border border-red-500/20 bg-red-500/[0.06] p-4 text-sm text-red-300">{error}</div>}
        </div>
      </div>
    </div>
  )
}

const backendBase = () => getBackendUrl() || ''

/**
 * Returns the correct base URL for `path`. Assist calls intentionally go
 * through iora-home/nginx as relative `/api/assist/*` requests; direct
 * browser calls to local loopback break as soon as the dashboard is opened from
 * another device.
 */
function baseUrlFor(path: string): string {
  return backendBase()
}

export async function adminFetch(path: string, token: string, options?: RequestInit) {
  const url = `${baseUrlFor(path)}${path}`
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...(options?.headers || {}),
    },
  })
  // Any mutating request invalidates the in-memory GET cache so the UI does
  // not display stale data after a successful save/delete. We clear the exact
  // path plus its base (e.g. `/api/admin/users/123` -> also clear `/api/admin/users`).
  const method = (options?.method || 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') {
    try {
      dataCache.delete(path)
      const base = path.split('?')[0].replace(/\/[^/]+$/, '')
      if (base.startsWith('/api/')) dataCache.delete(base)
    } catch { /* cache map may not exist yet during init */ }
  }
  // Detect HTML responses (e.g. dev-server fallback / nginx 404 page) before
  // we try to parse them as JSON, so the user sees a friendly message instead
  // of "Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON".
  const contentType = res.headers.get('content-type') || ''
  const looksLikeHtml = contentType.includes('text/html')
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let message = `HTTP ${res.status}`
    const trimmed = text.trimStart()
    if (looksLikeHtml || trimmed.startsWith('<')) {
      message = 'Dieser Bereich ist auf diesem System (noch) nicht verfügbar.'
      if (res.status === 200) {
        message = 'Dieser Bereich ist auf diesem System (noch) nicht verfügbar. Der Endpunkt existiert nicht oder wird von einem anderen IORA-Microservice bereitgestellt.'
      }
    } else {
      try {
        const json = JSON.parse(text)
        if (json?.error) message = json.error
        else if (json?.message) message = json.message
        // If the backend returned a hint, append it
        if (json?.hint) message += ` — ${json.hint}`
      } catch {
        if (text) message = text
      }
    }
    console.error('Admin fetch failed:', { url, status: res.status, statusText: res.statusText, body: text.slice(0, 200) })
    if (res.status === 403) {
      throw new Error('Kein Admin-Zugriff. Bitte neu einloggen.')
    }
    throw new Error(`${message} (${res.status})`)
  }
  if (looksLikeHtml) {
    // 200 OK but HTML body — almost certainly the SPA fallback. Treat as
    // missing endpoint so the calling tab can show an empty/disabled state
    // instead of crashing on JSON.parse.
    throw new Error('Dieser Bereich ist auf diesem System (noch) nicht verfügbar — der Endpunkt existiert nicht oder wird von einem anderen Microservice bereitgestellt.')
  }
  return res.json()
}

/**
 * Surface action errors to the user via a toast. Action handlers in the admin
 * panel used to swallow errors silently (catch with empty body), which made
 * users believe buttons "did nothing". This helper centralises the feedback
 * so every failed mutation produces a visible message and a console trace.
 */
function notifyError(e: unknown): void {
  const message = e instanceof Error ? e.message : (typeof e === 'string' ? e : 'Unbekannter Fehler')
  console.error('[AdminPanel] action failed:', e)
  try { toast.error(message) } catch { /* toast container may not be mounted in some contexts */ }
}

// Simple cache so tab switches don't re-fetch
const dataCache = new Map<string, { data: unknown; ts: number }>()
const CACHE_TTL = 120_000 // 2 minutes – backend also caches, so this is safe

// Paths that change rarely and benefit from longer caching
const LONG_TTL_PATHS = new Set([
  '/api/admin/ha/config', '/api/admin/ha/services', '/api/admin/ha/integrations',
  '/api/admin/ha/supervisor', '/api/admin/ha/addons', '/api/admin/ha/backups',
  '/api/admin/ha/network', '/api/admin/ha/scenes', '/api/admin/ha/automations',
  '/api/admin/ha/mqtt', '/api/admin/ha/matter', '/api/admin/system/database',
])
const LONG_CACHE_TTL = 600_000 // 10 minutes for stable data (HA config/services rarely change at runtime)

async function cachedFetch(path: string, token: string): Promise<unknown> {
  const ttl = LONG_TTL_PATHS.has(path) ? LONG_CACHE_TTL : CACHE_TTL
  const cached = dataCache.get(path)
  if (cached && Date.now() - cached.ts < ttl) return cached.data
  const data = await adminFetch(path, token)
  dataCache.set(path, { data, ts: Date.now() })
  return data
}

/// Prefetch data for adjacent tabs so switching feels instant
function prefetchAdjacentTabs(activeTab: string, token: string) {
  const tabDataMap: Record<string, string[]> = {
    'system': ['/api/admin/ha/config', '/api/admin/ha/supervisor'],
    'ha-config': ['/api/system/stats', '/api/system/ha-info', '/api/admin/ha/integrations'],
    'integrations': ['/api/admin/ha/config', '/api/admin/ha/mqtt'],
    'mqtt': ['/api/admin/ha/integrations', '/api/admin/ha/matter'],
    'matter': ['/api/admin/ha/mqtt', '/api/admin/ha/scenes'],
    'scenes': ['/api/admin/ha/matter', '/api/admin/ha/automations'],
    'automations': ['/api/admin/ha/scenes', '/api/admin/ha/backups'],
    'backups': ['/api/admin/ha/automations', '/api/admin/ha/network'],
    'network': ['/api/admin/ha/backups'],
    'database': ['/api/admin/system/database'],
    'webhooks': ['/api/webhooks'],
    'realtime': [],
    'entities': ['/api/entities/count'],
    'services': ['/api/admin/control/overview'],
    'tasks': ['/api/admin/control/services'],
    'control-mode': ['/api/admin/control/tasks'],
    'scheduler': ['/api/integration/schedules', '/api/integration/watchdogs'],
    'analytics': ['/api/stats/dashboard', '/api/integration/health'],
    'logbook': ['/api/admin/ha/logbook'],
    'calendars': ['/api/admin/ha/calendars'],
  }
  const paths = tabDataMap[activeTab] || []
  for (const path of paths) {
    if (!dataCache.has(path) || Date.now() - (dataCache.get(path)?.ts ?? 0) > CACHE_TTL) {
      cachedFetch(path, token).catch(() => {}) // fire-and-forget
    }
  }
}

function adminPathToTab(path: string): Tab {
  const segments = path.split('/').filter(Boolean)
  if (segments[0] !== 'admin') return 'services'
  const sub = segments[1]
  if (!sub) return 'services'
  if (sub === 'cloud') return 'cloud-settings'
  if (TAB_IDS.has(sub as Tab)) return sub as Tab
  return 'services'
}

function tabToAdminPath(tab: Tab): string {
  if (tab === 'services') return '/admin'
  if (tab === 'cloud-settings') return '/admin/cloud'
  return `/admin/${tab}`
}

export function AdminPanel() {
  const { t } = useTranslation()
  const tabs = useMemo(() => getTabs(t), [t])
  const { token } = useAuth()
  const [activeTab, setActiveTab] = useState<Tab>(() => adminPathToTab(window.location.pathname))
  // Persist expanded group across page reloads via localStorage
  const [expandedGroup, setExpandedGroup] = useState<string>(() => {
    try {
      return localStorage.getItem('iora-admin-expanded-group') || 'core'
    } catch { return 'core' }
  })
  const [haEnabled, setHaEnabled] = useState<boolean>(true)
  // Mobile sidebar toggle
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const sidebarRef = useCallback((node: HTMLDivElement | null) => {
    // Scroll the active tab into view when sidebar mounts
    if (node) {
      const activeEl = node.querySelector('[data-tab-active="true"]') as HTMLElement | null
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }
    }
  }, [])

  // Persist expandedGroup to localStorage
  useEffect(() => {
    try { localStorage.setItem('iora-admin-expanded-group', expandedGroup) } catch {}
  }, [expandedGroup])

  // Auto-expand the group that contains the active tab
  useEffect(() => {
    const group = tabGroups.find(g => g.items.includes(activeTab))
    if (group && group.id !== expandedGroup) {
      setExpandedGroup(group.id)
    }
  }, [activeTab])

  useEffect(() => {
    fetch(`${getBackendUrl()}/api/integration/ha/configured`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (data && data.enabled !== undefined) {
          setHaEnabled(data.enabled)
        }
      })
      .catch(() => {})
  }, [])

  if (!token) return null

  // Sync admin tab state with URL
  useEffect(() => {
    const path = tabToAdminPath(activeTab)
    if (window.location.pathname !== path) {
      window.history.replaceState({}, '', path)
    }
  }, [activeTab])

  useEffect(() => {
    const handlePopState = () => {
      setActiveTab(adminPathToTab(window.location.pathname))
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  // Prefetch adjacent tab data when tab changes
  useEffect(() => {
    prefetchAdjacentTabs(activeTab, token)
  }, [activeTab, token])

  return (
    <div className="pb-28 safe-bottom-nav">
      {/* ── Mobile Hamburger Button ─────────────────────────────── */}
      <div className="lg:hidden mb-3">
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className={ccBtnSecondary('w-full justify-between')}
        >
          <span className="flex items-center gap-2">
            <List size={18} />
            <span className="text-sm font-semibold">
              {tabs.find(t => t.id === activeTab)?.label || 'Control Center'}
            </span>
          </span>
          <span className="text-[10px] text-foreground/40">
            {tabGroups.find(g => g.items.includes(activeTab))?.title || ''}
          </span>
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(14rem,16rem)_minmax(0,1fr)]">
        {/* ── Sidebar: Hidden on mobile, overlay when open ─────── */}
        <aside className={`
          ${ccCard('lg:sticky lg:top-4 lg:self-start max-h-[calc(100vh-6rem)] overflow-hidden flex flex-col')}
          sidebar-scroll
          ${sidebarOpen ? 'fixed inset-x-4 top-20 z-[60] max-h-[calc(100vh-10rem)] shadow-2xl' : 'hidden lg:flex'}
        `}>
          {/* Close button for mobile overlay */}
          <div className="lg:hidden flex items-center justify-between mb-3 flex-shrink-0">
            <p className="text-sm font-semibold text-foreground">Control Center</p>
            <button onClick={() => setSidebarOpen(false)} className="p-1.5 rounded-lg hover:bg-foreground/5">
              <X size={18} className="text-foreground/50" />
            </button>
          </div>
          <style>{`
            .sidebar-scroll .overflow-y-auto::-webkit-scrollbar { width: 4px; }
            .sidebar-scroll .overflow-y-auto::-webkit-scrollbar-track { background: transparent; }
            .sidebar-scroll .overflow-y-auto::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 2px; }
            .sidebar-scroll .overflow-y-auto::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.15); }
            /* Firefox */
            .sidebar-scroll .overflow-y-auto { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.08) transparent; }
          `}</style>
          <div className="flex items-center gap-3 mb-4 flex-shrink-0">
            <div className="w-9 h-9 rounded-xl bg-accent/15 flex items-center justify-center">
              <ShieldCheck size={20} weight="fill" className="text-accent" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Control Center</p>
              <p className="text-[10px] text-foreground/40">System & Apps verwalten</p>
            </div>
          </div>
          <div ref={sidebarRef} className="space-y-3 overflow-y-auto flex-1 pr-1 -mr-1">
            {tabGroups.map(group => {
                if (group.id === 'home' && !haEnabled) return null
              const GroupIcon = group.icon
              const isExpanded = expandedGroup === group.id
              return (
                <div key={group.id} className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setExpandedGroup(isExpanded ? '' : group.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-semibold transition-all duration-200 ${isExpanded ? 'border-accent/30 bg-accent/[0.06] text-accent shadow-sm shadow-accent/5' : 'border-foreground/[0.05] bg-foreground/[0.02] text-foreground/80 hover:border-foreground/[0.1] hover:bg-foreground/[0.05] hover:text-foreground'}`}
                  >
                    <span className="flex items-center gap-2">
                      <GroupIcon size={16} weight={isExpanded ? 'fill' : 'regular'} />
                      {group.title}
                    </span>
                    <motion.span
                      animate={{ rotate: isExpanded ? 180 : 0 }}
                      transition={{ duration: 0.2 }}
                      className="text-[10px] text-foreground/40"
                    >
                      <CaretDown size={12} />
                    </motion.span>
                  </button>
                  <motion.div
                    initial={false}
                    animate={{
                      height: isExpanded ? 'auto' : 0,
                      opacity: isExpanded ? 1 : 0,
                    }}
                    transition={{ duration: 0.25, ease: 'easeInOut' }}
                    className="space-y-1 overflow-hidden"
                  >
                    {group.items.map(tabId => {
                      const tab = tabs.find(t => t.id === tabId)
                      if (!tab) return null
                      const isActive = activeTab === tab.id
                      const Icon = tab.icon
                      return (
                        <Tip key={tab.id} content={tab.description}>
                          <button
                            type="button"
                            data-tab-active={isActive ? 'true' : 'false'}
                            onClick={() => { setActiveTab(tab.id); setSidebarOpen(false) }}
                            className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[13px] transition-all duration-200 ${
                              isActive
                                ? 'bg-accent/15 text-accent font-semibold shadow-sm shadow-accent/10'
                                : 'text-foreground/60 hover:text-foreground hover:bg-foreground/[0.04]'
                            }`}
                          >
                            <Icon size={14} weight={isActive ? 'fill' : 'regular'} />
                            {tab.label}
                          </button>
                        </Tip>
                      )
                    })}
                  </motion.div>
                </div>
              )
            })}
          </div>
        </aside>

        {/* ── Mobile Sidebar Backdrop ──────────────────────────── */}
        {sidebarOpen && (
          <div
            className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-[55]"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <div className="space-y-3 min-w-0">
          {/* ── Active Tab Header ─────────────────────────────────── */}
          <div className={ccCard()}>
            <div className="flex items-center gap-3">
              {(() => {
                const t = tabs.find(t => t.id === activeTab)
                const Icon = t?.icon ?? Cpu
                const group = tabGroups.find(g => g.items.includes(activeTab))
                return (
                  <>
                    <div className="w-10 h-10 rounded-xl bg-accent/15 flex items-center justify-center flex-shrink-0 ring-1 ring-accent/10">
                      <Icon size={20} weight="fill" className="text-accent" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-foreground truncate">{t?.label}</p>
                        {group && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-foreground/[0.04] text-foreground/40 border border-foreground/[0.06] flex-shrink-0">
                            {group.title}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-foreground/40 truncate">{t?.description}</p>
                    </div>
                  </>
                )
              })()}
            </div>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15 }}
            >
              {activeTab === 'services' && <ServicesTab token={token} />}
              {activeTab === 'health-intelligence' && <HealthIntelligenceTab token={token} />}
              {activeTab === 'global-config' && <GlobalConfigTab token={token} />}
              {activeTab === 'developer-mode' && <DeveloperModeTab token={token} />}
              {activeTab === 'documentation' && <DocumentationTab />}
              {activeTab === 'tasks' && <TasksTab token={token} />}
              {activeTab === 'control-mode' && <ControlModeTab token={token} />}
              {activeTab === 'system' && <SystemTab token={token} />}
              {activeTab === 'system-info' && <SystemInfoTab token={token} />}
              {activeTab === 'infrastructure' && <InfrastructureVisualization token={token} />}
              {activeTab === 'apps' && <AppStoreTab token={token} />}
              {activeTab === 'plugins' && <PluginsTab token={token} />}
              {activeTab === 'registrations' && <RegistrationManagementTab token={token} />}
              {activeTab === 'security-monitor' && <SecurityMonitorTab token={token} />}
              {activeTab === 'updates' && <UpdateManagementTab token={token} />}
              {activeTab === 'widgets' && <WidgetManagementTab token={token} />}
              {activeTab === 'users' && <UsersTab token={token} />}
              {activeTab === 'api-keys' && <ApiKeysTab token={token} />}
              {activeTab === 'webhooks' && <WebhooksTab token={token} />}
              {activeTab === 'ha-config' && <HaConfigTab token={token} />}
              {activeTab === 'ha-connection' && <HaConnectionTab token={token} />}
              {activeTab === 'integrations' && <IntegrationsTab token={token} />}
              {activeTab === 'entities' && <EntitiesTab token={token} />}
              {activeTab === 'mqtt' && <MqttTab token={token} />}
              {activeTab === 'zigbee' && <ZigbeeTab token={token} />}
              {activeTab === 'zwave' && <ZwaveTab token={token} />}
              {activeTab === 'matter' && <MatterTab token={token} />}
              {activeTab === 'ble' && <BleTab token={token} />}
              {activeTab === 'homekit' && <HomekitTab token={token} />}
              {activeTab === 'scenes' && <ScenesTab token={token} />}
              {activeTab === 'automations' && <AutomationsTab token={token} />}
              {activeTab === 'scheduler' && <SchedulerTab token={token} />}
              {activeTab === 'analytics' && <AnalyticsTab token={token} />}
              {activeTab === 'backups' && <BackupsTab token={token} />}
              {activeTab === 'network' && <NetworkTab token={token} />}
              {activeTab === 'cloud-settings' && <CloudSettingsTab token={token} />}
              {activeTab === 'logs' && <LogsTab token={token} />}
              {activeTab === 'logbook' && <LogbookTab token={token} />}
              {activeTab === 'calendars' && <CalendarsTab token={token} />}
              {activeTab === 'realtime' && <RealtimeTab token={token} />}
              {activeTab === 'database' && <DatabaseTab token={token} />}
              {activeTab === 'warnings' && <WarningsTab token={token} />}
              {activeTab === 'system-notifications' && <SystemNotificationsTab token={token} />}
              {activeTab === 'protocols' && <ProtocolsOverviewTab token={token} />}
              {activeTab === 'ha-tools' && <HaDeveloperToolsTab token={token} />}
              {activeTab === 'global-alert' && <GlobalAlertTab token={token} />}
              {activeTab === 'notifications' && <NotificationsTab token={token} />}
              {activeTab === 'ai-overview' && <AiOverviewTab token={token} />}
              {activeTab === 'ai-providers' && <AiProvidersTab token={token} />}
              {activeTab === 'ai-conversations' && <AiConversationsTab token={token} />}
              {activeTab === 'ai-tasks' && <AiTasksTab token={token} />}
              {activeTab === 'ai-tools' && <AiToolsTab token={token} />}
              {activeTab === 'ai-voice' && <AiVoiceTab token={token} />}
              {activeTab === 'ai-agent' && <AgentTab token={token} />}
              {activeTab === 'secrets' && <SecretsTab token={token} />}
              {activeTab === 'files' && <FilesTab token={token} />}
              {activeTab === 'gateway' && <GatewayTab token={token} />}
              {activeTab === 'watchdog' && <WatchdogTab token={token} />}
              {activeTab === 'connector' && <ConnectorTab token={token} />}
              {activeTab === 'domain-validator' && <DomainValidatorTab token={token} />}
              {activeTab === 'resources' && <ResourcesTab token={token} />}
              {activeTab === 'api-bridge' && <ApiBridgeTab token={token} />}
              {activeTab === 'os-ssh' && <OsSshTab token={token} />}
              {activeTab === 'os-network-config' && <OsNetworkConfigTab token={token} />}
              {activeTab === 'os-disks' && <OsDisksTab token={token} />}
              {activeTab === 'os-processes' && <OsProcessesTab token={token} />}
              {activeTab === 'os-power' && <OsPowerTab token={token} />}
              {activeTab === 'dev-bridge' && <DevBridgeTab token={token} />}
              {activeTab === 'devices' && <DevicesTab token={token} />}
              {activeTab === 'themes' && <ThemesTab token={token} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

// ── Services Tab (Dienste-Überwachung) ──────────────────────────────────

interface ServiceStatus {
  name: string
  url: string
  status: 'online' | 'offline' | 'degraded' | 'not_deployed'
  response_time_ms?: number
  version?: string
  uptime?: string
  details?: Record<string, unknown>
}

// ── Global Configuration Tab ───────────────────────────────────────────
//
// Surfaces every IORA OS setting registered with the backend
// `SettingsRegistry` (see backend/iora-shared/src/settings.rs). The
// schema-driven design means we get one consistent UI for what would
// otherwise be a sprawling .env file: every entry has a description,
// category, type-aware input, validation and a list of services that
// need to restart after a write.

interface SettingDefDto {
  key: string
  label: string
  description: string
  category: 'system' | 'home_assistant' | 'integrations' | 'appearance' | 'privacy' | 'developer' | 'other'
  setting_type: 'string' | 'secret' | 'bool' | 'integer' | 'float' | 'url' | 'enum' | 'json'
  default: unknown
  wizard: boolean
  required: boolean
  requires_restart: string[]
  visibility?: 'visible' | 'hidden' | 'read_only'
  options?: string[]
  min?: number
  max?: number
  tags?: string[]
}

// The backend serialises `SettingValueDto` with `#[serde(flatten)]` on
// `definition`, so the JSON body we receive is a single flat object with all
// `SettingDefDto` fields PLUS `value` + `is_set` at the top level. We model
// that by extending `SettingDefDto` here — accessing `.definition` would
// throw because no such nested key exists.
interface SettingValueDto extends SettingDefDto {
  value: unknown
  is_set: boolean
}

/** Factory: creates category labels using the given translation function.
 *  Must not call i18n.t at module level — the bundler mangles it to bare t(). */
function getCategoryLabels(t: (key: string) => string): Record<SettingDefDto['category'], string> {
  return {
    system: t('admin.system'),
    home_assistant: 'Home Assistant',
    integrations: 'Integrationen',
    appearance: 'Darstellung',
    privacy: 'Privatsphäre',
    developer: 'Entwickler',
    other: 'Sonstiges',
  }
}

const CATEGORY_DESCRIPTIONS: Record<SettingDefDto['category'], string> = {
  system: 'System-kritische Werte: Hostname, Zeitzone, Netzwerk, Sicherheit. Änderungen können einen Neustart erfordern.',
  home_assistant: 'Verbindung zur Home-Assistant-Instanz: URL, Long-Lived Token und Synchronisations-Optionen.',
  integrations: 'Smart-Home-Protokolle: MQTT, Matter, Zigbee, Z-Wave, Bluetooth, HomeKit.',
  appearance: 'Sprache, Theme, Einheiten und sonstige UI-Präferenzen.',
  privacy: 'Telemetrie, Aufzeichnungen und Datenschutzeinstellungen.',
  developer: 'Debug-Schalter, experimentelle Features und tiefe Konfiguration. Mit Vorsicht ändern.',
  other: 'Alles, was in keine andere Kategorie passt.',
}

function GlobalConfigTab({ token }: { token: string }) {
  const { t } = useTranslation()
  const categoryLabels = useMemo(() => getCategoryLabels(t), [t])
  const [items, setItems] = useState<SettingValueDto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeCategory, setActiveCategory] = useState<SettingDefDto['category']>('system')
  const [search, setSearch] = useState('')
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [pendingValues, setPendingValues] = useState<Record<string, unknown>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await adminFetch('/api/admin/settings', token) as SettingValueDto[]
      setItems(Array.isArray(data) ? data : [])
      setPendingValues({})
    } catch (e) {
      setError((e as Error).message)
    }
    setLoading(false)
  }, [token])

  useEffect(() => { load() }, [load])

  // Defensive: filter out anything that doesn't look like a definition
  // (e.g. backend returning an error envelope) so a single bad row can't
  // crash the whole page with a TypeError.
  const safe = items.filter(it => it && typeof (it as { key?: unknown }).key === 'string')
  const visible = safe.filter(it => it.visibility !== 'hidden')

  const categories = Array.from(new Set(visible.map(it => it.category))) as SettingDefDto['category'][]
  const orderedCategories: SettingDefDto['category'][] =
    (['system', 'home_assistant', 'integrations', 'appearance', 'privacy', 'developer', 'other'] as const)
      .filter(c => categories.includes(c))

  const filtered = visible.filter(it => {
    if (it.category !== activeCategory) return false
    if (!search.trim()) return true
    const q = search.trim().toLowerCase()
    return it.key.toLowerCase().includes(q)
      || it.label.toLowerCase().includes(q)
      || (it.description ?? '').toLowerCase().includes(q)
  })

  const save = async (key: string, value: unknown) => {
    setSavingKey(key)
    try {
      await adminFetch(`/api/admin/settings/${encodeURIComponent(key)}`, token, {
        method: 'PUT',
        body: JSON.stringify({ value }),
      })
      // Reload to get the canonical value (e.g. secrets get masked).
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
    setSavingKey(null)
  }

  const setLocal = (key: string, value: unknown) => {
    setPendingValues(prev => ({ ...prev, [key]: value }))
  }

  if (loading) return <LoadingSpinner />
  if (error && items.length === 0) return <ErrorMessage>{error}</ErrorMessage>

  if (orderedCategories.length === 0) {
    return (
      <div className="space-y-3">
        <AdminCard title="Globale Konfiguration" icon={Gear}>
          <p className="text-xs text-foreground/60">
            Keine Konfigurationswerte registriert. Das Settings-Registry des Backends ist leer
            oder konnte nicht geladen werden.
          </p>
        </AdminCard>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <AdminCard icon={Gear} title="Globale Konfiguration">
        <p className="text-xs text-foreground/60 leading-relaxed">
          Zentrale Konfiguration für IORA OS. Diese Seite spiegelt das klassische .env-System
          wider, ist aber schema-getrieben: jeder Eintrag hat einen Typ, eine Validierung,
          eine Beschreibung und eine Liste von Diensten, die nach einer Änderung neu starten müssen.
          Änderungen werden sofort in der Datenbank gespeichert.
        </p>
      </AdminCard>

      {/* Category tabs */}
      <div className="flex flex-wrap gap-2">
        {orderedCategories.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeCategory === cat
                ? 'bg-accent text-white'
                : 'bg-foreground/5 text-foreground/70 hover:bg-foreground/10'
            }`}
          >
            {categoryLabels[cat]}
          </button>
        ))}
      </div>

      <AdminCard>
        <div className="space-y-1.5">
          <p className="text-xs text-foreground/70 leading-relaxed">
            {CATEGORY_DESCRIPTIONS[activeCategory]}
          </p>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="In dieser Kategorie suchen…" className={`${ccInput('text-xs px-3 py-2')}`} />
        </div>
      </AdminCard>

      <div className="space-y-2">
        {filtered.length === 0 && (
          <AdminCard>
            <p className="text-xs text-foreground/60 text-center py-4">
              Keine Einträge in dieser Kategorie {search ? 'für diese Suche' : ''}.
            </p>
          </AdminCard>
        )}
        {filtered.map(item => {
          const def = item
          const stored = item.value
          const pending = pendingValues[def.key]
          const current = pending !== undefined ? pending : stored
          const dirty = pending !== undefined && JSON.stringify(pending) !== JSON.stringify(stored)
          const readOnly = def.visibility === 'read_only'

          return (
            <AdminCard key={def.key}>
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-sm font-semibold text-foreground">{def.label}</h4>
                      {def.required && (
                        <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-500/15 text-red-300">Pflicht</span>
                      )}
                      {def.wizard && (
                        <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent/15 text-accent">Wizard</span>
                      )}
                      {!item.is_set && (
                        <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-foreground/10 text-foreground/60">Standard</span>
                      )}
                      {readOnly && (
                        <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-foreground/10 text-foreground/60">Nur lesen</span>
                      )}
                    </div>
                    <code className="text-[10px] font-mono text-foreground/40">{def.key}</code>
                    {def.description && (
                      <p className="text-xs text-foreground/60 mt-1 leading-relaxed">{def.description}</p>
                    )}
                  </div>
                </div>

                <SettingInput
                  def={def}
                  value={current}
                  onChange={v => setLocal(def.key, v)}
                  disabled={readOnly}
                />

                {def.requires_restart.length > 0 && dirty && (
                  <p className="text-[10px] text-amber-400">
                    Erfordert Neustart: {def.requires_restart.join(', ')}
                  </p>
                )}

                {!readOnly && (
                  <div className="flex justify-end gap-2 pt-1">
                    {dirty && (
                      <button onClick={() => setPendingValues(prev => { const n = { ...prev }; delete n[def.key]; return n })} className="px-3 py-1.5 rounded-lg text-[11px] font-medium text-foreground/60 hover:text-foreground hover:bg-foreground/[0.04] transition-all duration-200">
                        Verwerfen
                      </button>
                    )}
                    <button disabled={!dirty || savingKey === def.key} onClick={() => save(def.key, current)} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-accent text-white hover:bg-accent/90 disabled:bg-foreground/[0.05] disabled:text-foreground/30 transition-all duration-200">
                      {savingKey === def.key ? 'Speichert…' : 'Speichern'}
                    </button>
                  </div>
                )}
              </div>
            </AdminCard>
          )
        })}
      </div>

      {error && items.length > 0 && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}
    </div>
  )
}

function SettingInput({ def, value, onChange, disabled }: {
  def: SettingDefDto
  value: unknown
  onChange: (v: unknown) => void
  disabled?: boolean
}) {
  const baseInput = `${ccInput('text-xs px-3 py-2')} disabled:opacity-40 disabled:cursor-not-allowed`
  switch (def.setting_type) {
    case 'bool':
      return (
        <label className="flex items-center gap-3 cursor-pointer group py-1">
          <input
            type="checkbox"
            checked={Boolean(value)}
            disabled={disabled}
            onChange={e => onChange(e.target.checked)}
            className="w-4 h-4 rounded-md border-foreground/30 bg-transparent text-accent focus:ring-accent focus:ring-offset-0 cursor-pointer"
          />
          <span className="text-xs text-foreground/70 group-hover:text-foreground transition-colors">{Boolean(value) ? 'Aktiviert' : 'Deaktiviert'}</span>
        </label>
      )
    case 'integer':
    case 'float':
      return (
        <input
          type="number"
          step={def.setting_type === 'float' ? 'any' : 1}
          min={def.min}
          max={def.max}
          disabled={disabled}
          value={value === null || value === undefined ? '' : String(value)}
          onChange={e => {
            const raw = e.target.value
            if (raw === '') return onChange(null)
            const num = def.setting_type === 'float' ? parseFloat(raw) : parseInt(raw, 10)
            onChange(Number.isFinite(num) ? num : null)
          }}
          className={baseInput}
        />
      )
    case 'enum':
      return (
        <select
          disabled={disabled}
          value={value === null || value === undefined ? '' : String(value)}
          onChange={e => onChange(e.target.value)}
          className={baseInput}
        >
          <option value="">— Bitte wählen —</option>
          {(def.options || []).map(o => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      )
    case 'secret':
      return (
        <input
          type="password"
          disabled={disabled}
          placeholder={value ? '••••••••' : 'Nicht gesetzt'}
          value={typeof value === 'string' ? value : ''}
          onChange={e => onChange(e.target.value)}
          className={baseInput}
        />
      )
    case 'json':
      return (
        <textarea
          disabled={disabled}
          rows={4}
          value={typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2)}
          onChange={e => {
            try {
              onChange(JSON.parse(e.target.value))
            } catch {
              onChange(e.target.value) // store raw, validation happens on save
            }
          }}
          className={`${baseInput} font-mono`}
        />
      )
    case 'url':
    case 'string':
    default:
      return (
        <input
          type={def.setting_type === 'url' ? 'url' : 'text'}
          disabled={disabled}
          value={typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value)}
          onChange={e => onChange(e.target.value)}
          className={baseInput}
        />
      )
  }
}

// ─── Developer Mode quick-toggle tab ────────────────────────────────────
//
// Reframed in 29.28: this is the "Plugin- und App-Entwicklermodus". When
// active, the IORA Developer App is unlocked, ZIP installs use a relaxed
// trust model, and the dev-bridge surfaces extra `/api/dev/*` endpoints.
// Non-developers should leave this off — it broadens the system's
// attack surface in exchange for tooling convenience.
//
// On OS-Entwickler-Images (where /etc/iora/os-dev-mode is present and
// `iora-dev-bridge.service` is shipping) the toggle is locked on and a
// banner explains the implications.
function DeveloperModeTab({ token }: { token: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [devImage, setDevImage] = useState<{
    is_os_dev: boolean
    dev_token_present: boolean
    bridge_unit_installed: boolean
    developer_app_unit_installed: boolean
    build_id: string | null
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [res, devInfo] = await Promise.all([
          adminFetch('/api/admin/settings', token),
          adminFetch('/api/admin/dev-image', token).catch(() => null),
        ])
        const list = (res?.settings ?? res ?? []) as Array<{ key: string; value: unknown }>
        const entry = list.find(e => e.key === 'developer.mode')
        if (!cancelled) {
          setEnabled(entry?.value === true)
          if (devInfo) setDevImage(devInfo as typeof devImage extends infer T ? T : never)
          if (entry?.value === true) {
            localStorage.setItem('iora-developer-mode', 'true')
          } else {
            localStorage.removeItem('iora-developer-mode')
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [token])

  const apply = async (next: boolean) => {
    setSaving(true)
    setError(null)
    try {
      await adminFetch('/api/admin/settings/developer.mode', token, {
        method: 'PUT',
        body: JSON.stringify({ value: next }),
      })
      setEnabled(next)
      if (next) {
        localStorage.setItem('iora-developer-mode', 'true')
      } else {
        localStorage.removeItem('iora-developer-mode')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const isLocked = devImage?.is_os_dev === true
  const handleToggle = (next: boolean) => {
    if (isLocked) return
    if (next) {
      setConfirmOpen(true)
    } else {
      apply(false)
    }
  }

  return (
    <div className="space-y-3">
      {isLocked && (
        <AdminCard title="OS-Entwickler-Image aktiv" icon={ShieldCheck}>
          <div className="space-y-2 text-xs text-foreground/80">
            <p>
              Dieses System wurde als <strong>IORA OS Dev (internal)</strong>{' '}
              gebaut. Der Plugin- und App-Entwicklermodus ist dauerhaft
              aktiviert und kann nicht deaktiviert werden.
            </p>
            <ul className="list-disc list-inside space-y-1 text-[11px] text-foreground/60">
              {devImage?.bridge_unit_installed && <li><span className="font-mono">iora-dev-bridge.service</span> wird automatisch gestartet.</li>}
              {devImage?.developer_app_unit_installed && <li>Die <strong>IORA Developer App</strong> ist permanent unter „Installierte Apps" verfügbar.</li>}
              {devImage?.dev_token_present && <li>Ein Dev-Token liegt unter <span className="font-mono">/etc/iora/dev-token</span> (Mode 0600).</li>}
              {devImage?.build_id && <li>Build-ID: <span className="font-mono">{devImage.build_id}</span></li>}
            </ul>
          </div>
        </AdminCard>
      )}

      <AdminCard title="Plugin- und App-Entwicklermodus" icon={Wrench}>
        {loading ? (
          <p className="text-xs text-foreground/50">Lade aktuellen Status…</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4 p-4 rounded-xl bg-foreground/5 border border-foreground/10">
              <div className="flex-1">
                <div className="text-sm font-semibold text-foreground mb-1">Entwicklermodus aktivieren</div>
                <p className="text-xs text-foreground/60 leading-relaxed">
                  Schaltet die <strong>IORA Developer App</strong> frei und erlaubt das Installieren
                  unsignierter ZIP-Pakete. Gedacht für Personen, die eigene Plugins
                  oder Apps für IORA OS bauen — nicht für den normalen Betrieb.
                </p>
                <p className="text-[11px] text-foreground/40 mt-2">
                  Setting-Schlüssel: <span className="font-mono">developer.mode</span>
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={enabled === true}
                disabled={saving || enabled === null || isLocked}
                onClick={() => handleToggle(!enabled)}
                title={isLocked ? 'Auf einem OS-Entwickler-Image gesperrt' : undefined}
                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
                  enabled ? 'bg-green-500/70' : 'bg-foreground/20'
                } ${saving ? 'opacity-60 cursor-wait' : isLocked ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                    enabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {enabled && (
              <div className="text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
                Entwicklermodus ist aktiv. Die Developer App erscheint unter
                „Installierte Apps". Ggf. Browser-Tab neu laden, damit alle
                Komponenten den Status übernehmen.
              </div>
            )}
            {error && (
              <div className="text-[11px] text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                {error}
              </div>
            )}
          </div>
        )}
      </AdminCard>

      <AdminCard title="Was ändert sich beim Einschalten?" icon={Lightning}>
        <ul className="text-xs text-foreground/70 space-y-1.5 list-disc list-inside">
          <li><strong>IORA Developer App</strong> wird automatisch installiert und gestartet.</li>
          <li>ZIP-Uploads im App-Tab werden akzeptiert (auch ohne Signatur, mit Trust-Level „untrusted").</li>
          <li>Der Dev-Bridge stellt zusätzliche <span className="font-mono">/api/dev/*</span> Endpunkte bereit.</li>
          <li>Hot-Reload und Plugin-Reloading sind möglich, ohne Dienste neu zu starten.</li>
          <li>Die Sandbox-Isolation einzelner Plugins ist gelockert.</li>
        </ul>
      </AdminCard>

      {confirmOpen && (
        <DeveloperModeConfirmModal
          onCancel={() => setConfirmOpen(false)}
          onConfirm={async () => { setConfirmOpen(false); await apply(true) }}
        />
      )}
    </div>
  )
}

function DeveloperModeConfirmModal({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void | Promise<void> }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl bg-background border border-foreground/10 shadow-2xl">
        <div className="p-5 border-b border-foreground/10">
          <h3 className="text-base font-bold text-foreground flex items-center gap-2">
            <ShieldWarning size={20} weight="fill" className="text-amber-400" />
            Entwicklermodus aktivieren?
          </h3>
        </div>
        <div className="p-5 space-y-4 text-xs text-foreground/80">
          <p>Bevor du den Plugin- und App-Entwicklermodus aktivierst, beachte die Unterschiede zum Normalbetrieb:</p>
          <div className="grid grid-cols-2 gap-3 text-[11px]">
            <div className="rounded-lg bg-foreground/5 border border-foreground/10 p-3">
              <div className="font-semibold text-foreground/90 mb-1.5">Normalmodus</div>
              <ul className="list-disc list-inside space-y-1 text-foreground/60">
                <li>Nur signierte Apps</li>
                <li>Strenge Sandbox-Isolation</li>
                <li>Developer App ausgeblendet</li>
                <li>Kleinere Angriffsfläche</li>
                <li>Empfohlen für Endgeräte</li>
              </ul>
            </div>
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3">
              <div className="font-semibold text-amber-200 mb-1.5">Entwicklermodus</div>
              <ul className="list-disc list-inside space-y-1 text-amber-200/80">
                <li>Unsignierte ZIPs erlaubt</li>
                <li>Gelockerte Plugin-Isolation</li>
                <li>Developer App + Bridge aktiv</li>
                <li>Zusätzliche <span className="font-mono">/api/dev/*</span> Endpunkte</li>
                <li>Nur für Entwicklungs-Setups</li>
              </ul>
            </div>
          </div>
          <p className="text-[11px] text-foreground/50">
            Du kannst den Modus jederzeit wieder deaktivieren — außer auf einem OS-Entwickler-Image.
          </p>
        </div>
        <div className="p-4 border-t border-foreground/10 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg bg-foreground/10 text-foreground text-xs font-semibold hover:bg-foreground/15 transition-colors"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={() => { void onConfirm() }}
            className="px-4 py-2 rounded-lg bg-amber-500 text-black text-xs font-bold hover:bg-amber-400 transition-colors"
          >
            Entwicklermodus aktivieren
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Documentation tab ──────────────────────────────────────────────────
//
// Embeds the existing /docs SPA route inside the admin panel via an
// iframe. This keeps the markdown-rendering logic in DocsPageNew as the
// single source of truth and means the admin user does not have to
// leave the panel to look something up. The iframe is constrained to the
// same origin so cookies and CSRF tokens flow naturally.
function DocumentationTab() {
  return (
    <div className="space-y-3">
      <AdminCard title="IORA OS Dokumentation" icon={BookOpen}>
        <p className="text-xs text-foreground/60 mb-3">
          Die vollständige Dokumentation ist auch unter <code className="font-mono text-accent">/docs</code> als
          eigenständige Seite erreichbar. Hier ist sie eingebettet.
        </p>
        <div className="rounded-xl overflow-hidden border border-foreground/10 bg-foreground/[0.02]">
          <iframe
            src="/docs"
            title="IORA OS Dokumentation"
            className="w-full"
            style={{ height: '70vh', minHeight: 480, border: 'none' }}
          />
        </div>
      </AdminCard>
    </div>
  )
}

function ServicesTab({ token }: { token: string }) {
  const [services, setServices] = useState<ServiceStatus[]>([])
  const [overview, setOverview] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [restarting, setRestarting] = useState<string | null>(null)
  const [restartFeedback, setRestartFeedback] = useState<{ name: string; ok: boolean; msg: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [svc, ov] = await Promise.all([
        adminFetch('/api/admin/control/services', token),
        cachedFetch('/api/admin/control/overview', token),
      ])
      setServices((svc as { services: ServiceStatus[] }).services ?? svc as ServiceStatus[])
      setOverview(ov as Record<string, unknown>)
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }, [token])

  useEffect(() => { load() }, [load])

  const restartService = async (name: string) => {
    if (!confirm(`Dienst "${name}" wirklich neu starten? Während des Neustarts ist er kurz nicht erreichbar.`)) return
    setRestarting(name)
    setRestartFeedback(null)
    try {
      await adminFetch(`/api/admin/control/services/${encodeURIComponent(name)}/restart`, token, { method: 'POST' })
      setRestartFeedback({ name, ok: true, msg: `${name} wird neu gestartet…` })
      // Re-poll a bit later so the user sees the new status.
      setTimeout(() => { dataCache.delete('/api/admin/control/services'); load() }, 2500)
    } catch (e) {
      setRestartFeedback({ name, ok: false, msg: (e as Error).message })
    } finally {
      setRestarting(null)
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const onlineCount = services.filter(s => s.status === 'online').length
  const totalCount = services.length
  const deployedCount = services.filter(s => s.status !== 'not_deployed').length

  return (
    <div className="space-y-3">
      {/* Overview Bar */}
      <AdminCard title="Übersicht" icon={Gauge}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="text-center p-3 rounded-xl bg-foreground/3">
            <div className="text-2xl font-bold text-foreground">{onlineCount}/{deployedCount}</div>
            <div className="text-[10px] text-foreground/50 mt-0.5">Dienste online ({totalCount} bekannt)</div>
          </div>
          <div className="text-center p-3 rounded-xl bg-foreground/3">
            <div className="text-2xl font-bold text-foreground">{overview?.mode as string ?? '–'}</div>
            <div className="text-[10px] text-foreground/50 mt-0.5">Betriebsmodus</div>
          </div>
          <div className="text-center p-3 rounded-xl bg-foreground/3">
            <div className="text-2xl font-bold text-foreground">{overview?.watchdog_count as number ?? 0}</div>
            <div className="text-[10px] text-foreground/50 mt-0.5">Watchdogs</div>
          </div>
          <div className="text-center p-3 rounded-xl bg-foreground/3">
            <div className="text-2xl font-bold text-foreground">{overview?.scheduled_actions as number ?? 0}</div>
            <div className="text-[10px] text-foreground/50 mt-0.5">Geplante Aktionen</div>
          </div>
        </div>
      </AdminCard>

      {/* Service Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {services.map(svc => (
          <AdminCard key={svc.name}>
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <div className={`w-2.5 h-2.5 rounded-full ${
                  svc.status === 'online' ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.5)]' :
                  svc.status === 'degraded' ? 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.5)]' :
                  svc.status === 'not_deployed' ? 'bg-foreground/30' :
                  'bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.5)]'
                }`} />
                <div>
                  <h4 className="text-sm font-semibold text-foreground">{svc.name}</h4>
                  <span className="text-[10px] text-foreground/40 font-mono">{svc.url}</span>
                </div>
              </div>
              <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-full ${
                svc.status === 'online' ? 'bg-green-500/15 text-green-300' :
                svc.status === 'degraded' ? 'bg-amber-500/15 text-amber-300' :
                svc.status === 'not_deployed' ? 'bg-foreground/10 text-foreground/50' :
                'bg-red-500/15 text-red-300'
              }`}>
                {svc.status === 'online' ? 'Online' :
                 svc.status === 'degraded' ? 'Eingeschränkt' :
                 svc.status === 'not_deployed' ? 'Nicht aktiviert' :
                 'Offline'}
              </span>
            </div>
            <div className="space-y-0">
              {svc.response_time_ms !== undefined && (
                <StatItem label="Antwortzeit" value={`${svc.response_time_ms}ms`} />
              )}
              {svc.version && <StatItem label="Version" value={svc.version} />}
              {svc.uptime && <StatItem label="Uptime" value={svc.uptime} />}
              {svc.details && Object.entries(svc.details).map(([k, v]) => (
                <StatItem key={k} label={k} value={String(v)} />
              ))}
            </div>
            <div className="mt-3 pt-2 border-t border-foreground/5 flex items-center justify-between gap-2">
              {restartFeedback?.name === svc.name ? (
                <span className={`text-[10px] truncate ${restartFeedback.ok ? 'text-green-300' : 'text-red-300'}`}>
                  {restartFeedback.msg}
                </span>
              ) : (
                <span className="text-[10px] text-foreground/30 truncate">{svc.url}</span>
              )}
              <button
                type="button"
                onClick={() => restartService(svc.name)}
                disabled={restarting === svc.name || svc.status === 'not_deployed'}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-semibold bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
                title={svc.status === 'not_deployed' ? 'Dienst nicht installiert' : `${svc.name}.service neu starten`}
              >
                <ArrowClockwise size={11} className={restarting === svc.name ? 'animate-spin' : ''} />
                {restarting === svc.name ? 'Starte…' : 'Neu starten'}
              </button>
            </div>
          </AdminCard>
        ))}
      </div>

      <div className="flex justify-end">
        <button onClick={() => { dataCache.delete('/api/admin/control/services'); dataCache.delete('/api/admin/control/overview'); load() }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-foreground/80 hover:text-accent hover:bg-accent/10 transition-all">
          <ArrowClockwise size={14} /> Aktualisieren
        </button>
      </div>
    </div>
  )
}

// ── Tasks Tab (Aufgaben-Überwachung & Warteschlange) ──────────────────────────

interface BackgroundTask {
  id: number
  name: string
  task_type: string
  enabled: boolean
  interval_seconds?: number
  last_run_at?: string
  last_success_at?: string
  last_error?: string
  run_count: number
  error_count: number
}

function TasksTab({ token }: { token: string }) {
  const [tasks, setTasks] = useState<BackgroundTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [triggerLoading, setTriggerLoading] = useState<number | null>(null)
  const [filter, setFilter] = useState<'all' | 'active' | 'errors'>('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await adminFetch('/api/admin/control/tasks', token)
      setTasks(Array.isArray(data) ? data : (data as { tasks: BackgroundTask[] }).tasks ?? [])
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }, [token])

  useEffect(() => { load() }, [load])

  const triggerTask = async (taskId: number) => {
    setTriggerLoading(taskId)
    try {
      await adminFetch(`/api/admin/control/tasks/${taskId}/trigger`, token, { method: 'POST' })
      await load()
    } catch (e) { notifyError(e) }
    setTriggerLoading(null)
  }

  const toggleTask = async (taskId: number) => {
    try {
      await adminFetch(`/api/admin/control/tasks/${taskId}/toggle`, token, { method: 'POST' })
      await load()
    } catch (e) { notifyError(e) }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const filtered = tasks.filter(t =>
    filter === 'all' ? true :
    filter === 'active' ? t.enabled :
    t.error_count > 0
  )

  const totalRuns = tasks.reduce((s, t) => s + t.run_count, 0)
  const totalErrors = tasks.reduce((s, t) => s + t.error_count, 0)
  const activeCount = tasks.filter(t => t.enabled).length

  return (
    <div className="space-y-3">
      {/* Stats */}
      <AdminCard title="Aufgaben-Statistik" icon={ListChecks}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="text-center p-3 rounded-xl bg-foreground/3">
            <div className="text-2xl font-bold text-foreground">{tasks.length}</div>
            <div className="text-[10px] text-foreground/50 mt-0.5">Gesamt</div>
          </div>
          <div className="text-center p-3 rounded-xl bg-foreground/3">
            <div className="text-2xl font-bold text-green-300">{activeCount}</div>
            <div className="text-[10px] text-foreground/50 mt-0.5">Aktiv</div>
          </div>
          <div className="text-center p-3 rounded-xl bg-foreground/3">
            <div className="text-2xl font-bold text-foreground">{totalRuns}</div>
            <div className="text-[10px] text-foreground/50 mt-0.5">Ausführungen</div>
          </div>
          <div className="text-center p-3 rounded-xl bg-foreground/3">
            <div className={`text-2xl font-bold ${totalErrors > 0 ? 'text-red-300' : 'text-foreground'}`}>{totalErrors}</div>
            <div className="text-[10px] text-foreground/50 mt-0.5">Fehler</div>
          </div>
        </div>
      </AdminCard>

      {/* Filter */}
      <div className="flex gap-1.5">
        {(['all', 'active', 'errors'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              filter === f ? 'bg-accent/20 text-accent' : 'text-foreground/60 hover:text-foreground hover:bg-foreground/8'
            }`}>
            {f === 'all' ? 'Alle' : f === 'active' ? 'Aktiv' : 'Fehler'}
          </button>
        ))}
      </div>

      {/* Task List */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="glass-card rounded-2xl p-8 text-center text-xs text-foreground/50">Keine Aufgaben gefunden.</div>
        ) : filtered.map(task => (
          <AdminCard key={task.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`w-2 h-2 rounded-full ${task.enabled ? 'bg-green-400' : 'bg-foreground/30'}`} />
                  <h4 className="text-sm font-semibold text-foreground truncate">{task.name}</h4>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-foreground/8 text-foreground/60">{task.task_type}</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 mt-2">
                  {task.interval_seconds && (
                    <div className="text-[10px] text-foreground/50">
                      <span className="text-foreground/30">Intervall:</span> {task.interval_seconds >= 3600 ? `${Math.round(task.interval_seconds/3600)}h` : task.interval_seconds >= 60 ? `${Math.round(task.interval_seconds/60)}m` : `${task.interval_seconds}s`}
                    </div>
                  )}
                  <div className="text-[10px] text-foreground/50">
                    <span className="text-foreground/30">Läufe:</span> {task.run_count}
                  </div>
                  {task.error_count > 0 && (
                    <div className="text-[10px] text-red-300">
                      <span className="text-red-300/60">Fehler:</span> {task.error_count}
                    </div>
                  )}
                  {task.last_run_at && (
                    <div className="text-[10px] text-foreground/50">
                      <span className="text-foreground/30">Letzter Lauf:</span> {new Date(task.last_run_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  )}
                </div>
                {task.last_error && (
                  <div className="mt-2 p-2 rounded-lg bg-red-500/8 border border-red-500/15 text-[10px] text-red-300 font-mono truncate">
                    {task.last_error}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Tip content={task.enabled ? 'Aufgabe deaktivieren' : 'Aufgabe aktivieren'}>
                  <button onClick={() => toggleTask(task.id)}
                    className={`p-2 rounded-lg transition-all ${task.enabled ? 'text-green-300 hover:bg-green-500/15' : 'text-foreground/40 hover:bg-foreground/8'}`}>
                    {task.enabled ? <ToggleRight size={18} weight="fill" /> : <ToggleLeft size={18} />}
                  </button>
                </Tip>
                <Tip content="Jetzt auslösen">
                  <button onClick={() => triggerTask(task.id)} disabled={triggerLoading === task.id}
                    className="p-2 rounded-lg text-foreground/60 hover:text-accent hover:bg-accent/10 transition-all disabled:opacity-40">
                    {triggerLoading === task.id ? <CircleNotch size={16} className="animate-spin" /> : <Play size={16} />}
                  </button>
                </Tip>
              </div>
            </div>
          </AdminCard>
        ))}
      </div>

      <div className="flex justify-end">
        <button onClick={load}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-foreground/80 hover:text-accent hover:bg-accent/10 transition-all">
          <ArrowClockwise size={14} /> Aktualisieren
        </button>
      </div>
    </div>
  )
}

// ── Control Mode Tab (Betriebsmodus) ──────────────────────────────────────────

const MODE_CONFIG = {
  autonomous: {
    icon: Robot,
    label: 'Autonom',
    color: 'green',
    description: 'Das System führt alle Aufgaben, Watchdogs und Automationen selbstständig aus. Eingriffe sind nicht erforderlich.',
  },
  supervised: {
    icon: Eye,
    label: 'Überwacht',
    color: 'amber',
    description: 'Automationen laufen, aber kritische Aktionen erfordern eine Bestätigung. Benachrichtigungen bei wichtigen Entscheidungen.',
  },
  manual: {
    icon: Hand,
    label: 'Manuell',
    color: 'blue',
    description: 'Alle automatischen Aktionen sind pausiert. Aufgaben müssen manuell ausgelöst werden.',
  },
} as const

type ControlMode = keyof typeof MODE_CONFIG

function ControlModeTab({ token }: { token: string }) {
  const [currentMode, setCurrentMode] = useState<ControlMode>('autonomous')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await adminFetch('/api/admin/control/mode', token) as { mode: string }
      setCurrentMode((data.mode || 'autonomous') as ControlMode)
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }, [token])

  useEffect(() => { load() }, [load])

  const setMode = async (mode: ControlMode) => {
    if (mode === currentMode) return
    setSaving(true)
    try {
      await adminFetch('/api/admin/control/mode', token, {
        method: 'PUT',
        body: JSON.stringify({ mode }),
      })
      setCurrentMode(mode)
    } catch (e) { setError((e as Error).message) }
    setSaving(false)
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const currentConfig = MODE_CONFIG[currentMode]

  return (
    <div className="space-y-3">
      {/* Current Mode Display */}
      <AdminCard>
        <div className="flex items-center gap-4 py-2">
          <div className={`p-4 rounded-2xl ${
            currentConfig.color === 'green' ? 'bg-green-500/15' :
            currentConfig.color === 'amber' ? 'bg-amber-500/15' :
            'bg-blue-500/15'
          }`}>
            <currentConfig.icon size={32} weight="fill" className={
              currentConfig.color === 'green' ? 'text-green-300' :
              currentConfig.color === 'amber' ? 'text-amber-300' :
              'text-blue-300'
            } />
          </div>
          <div className="flex-1">
            <div className="text-xs text-foreground/40 uppercase tracking-wider mb-0.5">Aktueller Betriebsmodus</div>
            <div className={`text-xl font-bold ${
              currentConfig.color === 'green' ? 'text-green-300' :
              currentConfig.color === 'amber' ? 'text-amber-300' :
              'text-blue-300'
            }`}>{currentConfig.label}</div>
            <p className="text-xs text-foreground/60 mt-1">{currentConfig.description}</p>
          </div>
        </div>
      </AdminCard>

      {/* Mode Selector */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {(Object.entries(MODE_CONFIG) as [ControlMode, typeof MODE_CONFIG[ControlMode]][]).map(([mode, config]) => {
          const isActive = mode === currentMode
          const Icon = config.icon
          const colorClasses = config.color === 'green'
            ? { bg: 'bg-green-500/8', border: 'border-green-500/30', text: 'text-green-300', activeBg: 'bg-green-500/15' }
            : config.color === 'amber'
            ? { bg: 'bg-amber-500/8', border: 'border-amber-500/30', text: 'text-amber-300', activeBg: 'bg-amber-500/15' }
            : { bg: 'bg-blue-500/8', border: 'border-blue-500/30', text: 'text-blue-300', activeBg: 'bg-blue-500/15' }

          return (
            <button
              key={mode}
              onClick={() => setMode(mode)}
              disabled={saving}
              className={`glass-card rounded-2xl p-4 text-left transition-all border-2 ${
                isActive
                  ? `${colorClasses.activeBg} ${colorClasses.border} shadow-lg`
                  : 'border-transparent hover:border-foreground/15 hover:bg-foreground/3'
              } disabled:opacity-50`}
            >
              <div className="flex items-center gap-2.5 mb-2">
                <Icon size={20} weight={isActive ? 'fill' : 'regular'} className={isActive ? colorClasses.text : 'text-foreground/50'} />
                <span className={`text-sm font-semibold ${isActive ? colorClasses.text : 'text-foreground/80'}`}>{config.label}</span>
                {isActive && <CheckCircle size={16} weight="fill" className={colorClasses.text + ' ml-auto'} />}
              </div>
              <p className="text-[10px] text-foreground/50 leading-relaxed">{config.description}</p>
            </button>
          )
        })}
      </div>

      {/* Info */}
      <AdminCard title="Hinweise" icon={Warning}>
        <div className="space-y-2 text-xs text-foreground/60">
          <p>• <strong className="text-foreground/80">Autonom:</strong> Empfohlen für den Normalbetrieb. Watchdogs, Scheduler und Automationen arbeiten selbstständig.</p>
          <p>• <strong className="text-foreground/80">Überwacht:</strong> Ideal für Tests oder sensible Phasen. Kritische Aktionen erfordern Bestätigung.</p>
          <p>• <strong className="text-foreground/80">Manuell:</strong> Für Wartungsarbeiten oder Fehlersuche. Alle automatischen Prozesse pausiert.</p>
          <p className="text-foreground/40 mt-2">Der Modus wird sofort über WebSocket an alle verbundenen Clients propagiert.</p>
        </div>
      </AdminCard>
    </div>
  )
}

// ── Card wrapper ──────────────────────────────────────────────────

export function AdminCard({ children, title, icon: Icon, className = '' }: {
  children: React.ReactNode
  title?: string
  icon?: typeof Cpu
  className?: string
}) {
  return (
    <div className={`rounded-2xl border border-foreground/[0.06] bg-background/60 backdrop-blur-xl p-5 ${className}`}>
      {title && (
        <div className="flex items-center gap-2.5 mb-4 pb-3 border-b border-foreground/[0.04]">
          {Icon && (
            <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center ring-1 ring-accent/5">
              <Icon size={16} weight="fill" className="text-accent" />
            </div>
          )}
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        </div>
      )}
      {children}
    </div>
  )
}

function StatItem({ label, value }: { label: string; value: string | number | undefined }) {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-foreground/5 last:border-0">
      <span className="text-xs text-foreground/85">{label}</span>
      <span className="text-xs font-medium text-foreground">{value ?? '–'}</span>
    </div>
  )
}

// ── System Tab ──────────────────────────────────────────────────

function SystemTab({ token }: { token: string }) {
  const [stats, setStats] = useState<Record<string, unknown> | null>(null)
  const [haInfo, setHaInfo] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [maintenanceActive, setMaintenanceActive] = useState(false)
  const [maintenanceMsg, setMaintenanceMsg] = useState('')
  const [maintenanceLoading, setMaintenanceLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [s, h, m] = await Promise.all([
        cachedFetch('/api/system/stats', token),
        cachedFetch('/api/system/ha-info', token),
        adminFetch('/api/admin/maintenance', token),
      ])
      setStats(s as Record<string, unknown>)
      setHaInfo(h as Record<string, unknown>)
      const maint = m as { active: boolean; message: string }
      setMaintenanceActive(maint.active)
      setMaintenanceMsg(maint.message || '')
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }, [token])

  useEffect(() => { load() }, [load])

  const toggleMaintenance = async () => {
    setMaintenanceLoading(true)
    try {
      const result = await adminFetch('/api/admin/maintenance', token, {
        method: 'PUT',
        body: JSON.stringify({ active: !maintenanceActive, message: maintenanceMsg }),
      })
      setMaintenanceActive(result.active)
      setMaintenanceMsg(result.message || '')
    } catch (e) { notifyError(e) }
    setMaintenanceLoading(false)
  }

  const saveMaintenanceMessage = async () => {
    setMaintenanceLoading(true)
    try {
      const result = await adminFetch('/api/admin/maintenance', token, {
        method: 'PUT',
        body: JSON.stringify({ message: maintenanceMsg }),
      })
      setMaintenanceMsg(result.message || '')
    } catch (e) { notifyError(e) }
    setMaintenanceLoading(false)
  }

  useEffect(() => { load() }, [load])

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const cpu = stats?.cpu as Record<string, unknown> | undefined
  const memory = stats?.memory as Record<string, unknown> | undefined
  const backend = stats?.backend as Record<string, unknown> | undefined

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      <AdminCard title="CPU" icon={Cpu}>
        <StatItem label="Auslastung" value={`${Math.round(cpu?.usage_percent as number ?? 0)}%`} />
        <StatItem label="Kerne" value={cpu?.cores as number} />
      </AdminCard>

      <AdminCard title="Speicher" icon={HardDrive}>
        <StatItem label="Verwendet" value={`${((memory?.used_bytes as number ?? 0) / 1048576).toFixed(0)} MB`} />
        <StatItem label="Gesamt" value={`${((memory?.total_bytes as number ?? 0) / 1048576).toFixed(0)} MB`} />
        <StatItem label="Auslastung" value={`${Math.round(memory?.usage_percent as number ?? 0)}%`} />
      </AdminCard>

      <AdminCard title="Backend" icon={Gear}>
        <StatItem label="Version" value={backend?.version as string} />
        <StatItem label="Entities" value={backend?.entity_count as number} />
        <StatItem label="Clients" value={backend?.connected_clients as number} />
        <StatItem label="Uptime" value={formatUptime(stats?.uptime_seconds as number)} />
      </AdminCard>

      <AdminCard title="Home Assistant" icon={CloudArrowUp}>
        <StatItem label="Verbunden" value={stats?.ha_connected ? '✓ Ja' : '✗ Nein'} />
        <StatItem label="WebSocket" value={stats?.ha_ws_connected ? '✓ Ja' : '✗ Nein'} />
        <StatItem label="HA Version" value={(haInfo?.ha_version as string) ?? 'Unbekannt'} />
        <StatItem label="Entities" value={haInfo?.entity_count as number} />
        <StatItem label="History (24h)" value={haInfo?.history_entries_24h as number} />
      </AdminCard>

      {Array.isArray(haInfo?.domains) && (
        <AdminCard title="Entity-Domänen" icon={ListBullets} className="md:col-span-2">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {(haInfo.domains as Array<{ domain: string; count: number }>).slice(0, 18).map(d => (
              <div key={d.domain} className="flex justify-between items-center text-xs py-1 px-2 rounded bg-foreground/3">
                <span className="text-foreground/80">{d.domain}</span>
                <span className="font-medium">{d.count}</span>
              </div>
            ))}
          </div>
        </AdminCard>
      )}

      <AdminCard title="Wartungsmodus" icon={Wrench} className="col-span-full">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <div className="text-sm font-medium text-foreground flex items-center gap-2">
                {maintenanceActive ? (
                  <span className="flex items-center gap-1.5 text-amber-400"><Warning size={14} weight="fill" /> Aktiv</span>
                ) : (
                  <span className="text-foreground/60">Inaktiv</span>
                )}
              </div>
              <p className="text-xs text-foreground/50">
                Sperrt das Dashboard für alle Geräte. Nur Administratoren und Benutzer mit der Rolle „Wartung" können weiterhin zugreifen.
              </p>
            </div>
            <button
              onClick={toggleMaintenance}
              disabled={maintenanceLoading}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium transition-all ${
                maintenanceActive
                  ? 'bg-green-500/15 text-green-300 hover:bg-green-500/25 border border-green-500/30'
                  : 'bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 border border-amber-500/30'
              }`}
            >
              {maintenanceActive ? (
                <><Power size={14} /> Deaktivieren</>
              ) : (
                <><Wrench size={14} /> Aktivieren</>
              )}
            </button>
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="text-xs text-foreground/50 mb-1 block">Wartungsnachricht</label>
              <input
                value={maintenanceMsg}
                onChange={e => setMaintenanceMsg(e.target.value)}
                placeholder="Nachricht für Benutzer..."
                className="w-full px-3 py-2 rounded-lg bg-foreground/5 border border-foreground/10 text-xs text-foreground focus:outline-none focus:border-accent"
              />
            </div>
            <button
              onClick={saveMaintenanceMessage}
              disabled={maintenanceLoading}
              className="px-3 py-2 rounded-lg text-xs text-foreground/70 hover:text-accent hover:bg-accent/10 transition-all border border-foreground/10"
            >
              Speichern
            </button>
          </div>
        </div>
      </AdminCard>

      <div className="col-span-full flex justify-end">
        <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-foreground/80 hover:text-accent hover:bg-accent/10 transition-all">
          <ArrowClockwise size={14} /> Aktualisieren
        </button>
      </div>
    </div>
  )
}

// ── Users Tab ──────────────────────────────────────────────────

function UsersTab({ token }: { token: string }) {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editingUser, setEditingUser] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ display_name: '', new_password: '', role: '' })
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await adminFetch('/api/admin/users', token)
      setUsers(data)
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }, [token])

  useEffect(() => { load() }, [load])

  const toggleAdmin = async (userId: string, isAdmin: boolean) => {
    setActionLoading(userId)
    try {
      await adminFetch(`/api/admin/users/${userId}/admin`, token, {
        method: 'PUT',
        body: JSON.stringify({ is_admin: !isAdmin }),
      })
      await load()
    } catch (e) { notifyError(e) }
    finally { setActionLoading(null) }
  }

  const handleDelete = async (userId: string) => {
    setActionLoading(userId)
    try {
      await adminFetch(`/api/admin/users/${userId}`, token, { method: 'DELETE' })
      setConfirmDelete(null)
      await load()
    } catch (e) { notifyError(e) }
    finally { setActionLoading(null) }
  }

  const handleEdit = async (userId: string) => {
    setActionLoading(userId)
    try {
      const body: Record<string, string> = {}
      if (editForm.display_name) body.display_name = editForm.display_name
      if (editForm.new_password) body.new_password = editForm.new_password
      if (editForm.role) body.role = editForm.role
      await adminFetch(`/api/admin/users/${userId}`, token, {
        method: 'PUT',
        body: JSON.stringify(body),
      })
      setEditingUser(null)
      setEditForm({ display_name: '', new_password: '', role: '' })
      await load()
    } catch (e) { notifyError(e) }
    finally { setActionLoading(null) }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const filtered = search
    ? users.filter(u => u.username.toLowerCase().includes(search.toLowerCase()) ||
        (u.display_name || '').toLowerCase().includes(search.toLowerCase()))
    : users

  return (
    <div className="space-y-3">
      {/* Header bar */}
      <AdminCard>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Users size={16} className="text-accent" />
            {users.length} Benutzer
          </div>
          <div className="flex items-center gap-2 bg-foreground/5 rounded-lg px-3 py-1.5 flex-1 max-w-xs">
            <MagnifyingGlass size={14} className="text-foreground/75" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Suchen..."
              className="bg-transparent text-xs outline-none flex-1 text-foreground placeholder:text-foreground/85"
            />
          </div>
        </div>
      </AdminCard>

      {/* User list */}
      {filtered.map(u => (
        <AdminCard key={u.id}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="w-9 h-9 rounded-full bg-accent/15 flex items-center justify-center text-accent font-bold text-sm flex-shrink-0">
                {(u.display_name || u.username).charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground truncate">{u.display_name || u.username}</div>
                <div className="text-xs text-foreground/80">@{u.username} · Erstellt: {new Date(u.created_at).toLocaleDateString('de-DE')}</div>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="flex gap-1 text-[10px]">
                {u.has_password && <span className="px-1.5 py-0.5 rounded bg-green-500/20 text-green-300 font-semibold border border-green-500/30">PW</span>}
                {u.has_pin && <span className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 font-semibold border border-blue-500/30">PIN</span>}
              </div>
              <Tip content={u.is_admin ? 'Admin entfernen' : 'Zum Admin machen'}>
                <button
                  onClick={() => toggleAdmin(u.id, u.is_admin)}
                  disabled={actionLoading === u.id}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all disabled:opacity-50 ${
                    u.is_admin
                      ? 'bg-accent text-white shadow-sm shadow-accent/25'
                      : 'bg-foreground/10 text-foreground border border-foreground/15 hover:bg-foreground/20'
                  }`}
                >
                  {actionLoading === u.id ? <InlineSpinner size={12} /> : ({ admin: 'Admin', editor: 'Editor', viewer: 'Betrachter', maintenance: 'Wartung', user: 'User' }[u.role] || (u.is_admin ? 'Admin' : 'User'))}
                </button>
              </Tip>
              <Tip content="Bearbeiten">
                <button
                  onClick={() => { setEditingUser(editingUser === u.id ? null : u.id); setEditForm({ display_name: u.display_name || '', new_password: '', role: u.role || 'user' }) }}
                  className="p-1.5 rounded-lg text-foreground/75 hover:text-accent hover:bg-accent/10 transition-all"
                >
                  <PencilSimple size={14} />
                </button>
              </Tip>
              <Tip content="Löschen">
                <button
                  onClick={() => setConfirmDelete(confirmDelete === u.id ? null : u.id)}
                  className="p-1.5 rounded-lg text-foreground/75 hover:text-red-400 hover:bg-red-500/10 transition-all"
                >
                  <UserMinus size={14} />
                </button>
              </Tip>
            </div>
          </div>

          {/* Edit form */}
          {editingUser === u.id && (
            <div className="mt-3 pt-3 border-t border-foreground/10 space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] text-foreground/80 mb-1 block">Anzeigename</label>
                  <input
                    type="text"
                    value={editForm.display_name}
                    onChange={e => setEditForm({ ...editForm, display_name: e.target.value })}
                    className="w-full bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-accent/30 text-foreground"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-foreground/80 mb-1 block">Neues Passwort</label>
                  <input
                    type="password"
                    value={editForm.new_password}
                    onChange={e => setEditForm({ ...editForm, new_password: e.target.value })}
                    placeholder="Leer = nicht ändern"
                    className="w-full bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-accent/30 text-foreground placeholder:text-foreground/85"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-foreground/80 mb-1 block">Rolle</label>
                  <select
                    value={editForm.role}
                    onChange={e => setEditForm({ ...editForm, role: e.target.value })}
                    className="w-full bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-accent/30 text-foreground"
                  >
                    <option value="viewer">Betrachter</option>
                    <option value="user">Benutzer</option>
                    <option value="editor">Editor</option>
                    <option value="admin">Administrator</option>
                    <option value="maintenance">Wartung</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setEditingUser(null)} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-foreground/10 text-foreground hover:bg-foreground/20 transition-all">Abbrechen</button>
                <button onClick={() => handleEdit(u.id)} disabled={actionLoading === u.id} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-accent text-white shadow-sm shadow-accent/25 hover:bg-accent/85 transition-all disabled:opacity-50 flex items-center gap-1.5">
                  {actionLoading === u.id && <InlineSpinner size={12} />} Speichern
                </button>
              </div>
            </div>
          )}

          {/* Confirm delete */}
          {confirmDelete === u.id && (
            <div className="mt-3 pt-3 border-t border-red-500/20 flex items-center justify-between">
              <span className="text-xs text-red-400">Benutzer wirklich löschen?</span>
              <div className="flex gap-2">
                <button onClick={() => setConfirmDelete(null)} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-foreground/10 text-foreground hover:bg-foreground/20 transition-all">Nein</button>
                <button onClick={() => handleDelete(u.id)} disabled={actionLoading === u.id} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500 text-white shadow-sm shadow-red-500/25 hover:bg-red-600 transition-all disabled:opacity-50 flex items-center gap-1.5">
                  {actionLoading === u.id && <InlineSpinner size={12} />} Ja, löschen
                </button>
              </div>
            </div>
          )}
        </AdminCard>
      ))}
    </div>
  )
}

// ── API Keys Tab ──────────────────────────────────────────────

function ApiKeysTab({ token }: { token: string }) {
  const [keys, setKeys] = useState<ApiKeyEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [newKey, setNewKey] = useState<ApiKeyWithSecret | null>(null)
  const [form, setForm] = useState({ name: '', permissions: ['read'] as string[], rate_limit: 60, expires_in_days: 0 })
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await adminFetch('/api/keys', token)
      setKeys(data)
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }, [token])

  useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    setActionLoading('create')
    try {
      const data = await adminFetch('/api/keys', token, {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          permissions: form.permissions,
          rate_limit: form.rate_limit,
          expires_in_days: form.expires_in_days > 0 ? form.expires_in_days : null,
        }),
      })
      setNewKey(data)
      setShowCreate(false)
      setForm({ name: '', permissions: ['read'], rate_limit: 60, expires_in_days: 0 })
      load()
    } catch (e) { notifyError(e) }
    finally { setActionLoading(null) }
  }

  const handleDelete = async (keyId: string) => {
    setActionLoading(keyId)
    try {
      await adminFetch(`/api/keys/${keyId}`, token, { method: 'DELETE' })
      load()
    } catch (e) { notifyError(e) }
    finally { setActionLoading(null) }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  return (
    <div className="space-y-3">
      {/* New key reveal */}
      {newKey && (
        <AdminCard className="border border-accent/30">
          <div className="flex items-start gap-2 mb-2">
            <Warning size={16} className="text-amber-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs font-semibold text-amber-400">API Key erstellt – jetzt kopieren!</p>
              <p className="text-[10px] text-foreground/75 mt-0.5">Dieser Key wird nur einmal angezeigt.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-foreground/5 rounded-lg p-2 mt-2">
            <code className="text-xs font-mono flex-1 break-all">{newKey.key}</code>
            <button onClick={() => copyToClipboard(newKey.key)} className="p-1.5 rounded hover:bg-foreground/10 transition-colors">
              <Copy size={14} />
            </button>
          </div>
          <button onClick={() => setNewKey(null)} className="mt-2 text-xs text-foreground/80 hover:text-foreground/80">
            Schließen
          </button>
        </AdminCard>
      )}

      {/* Create form */}
      <AdminCard>
        <div className="flex justify-between items-center">
          <span className="text-sm font-medium text-foreground">{keys.length} API Key{keys.length !== 1 ? 's' : ''}</span>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-accent text-white shadow-md shadow-accent/25 hover:bg-accent/85 transition-all"
          >
            <Plus size={14} weight="bold" /> Neuer Key
          </button>
        </div>
      </AdminCard>

      {showCreate && (
        <AdminCard>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-foreground/80 mb-1 block">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="z.B. Mein ESP32 Gerät"
                className="w-full bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent/30 text-foreground"
              />
            </div>
            <div>
              <label className="text-xs text-foreground/80 mb-1 block">Berechtigungen</label>
              <div className="flex gap-2">
                {['read', 'write', '*'].map(perm => (
                  <button
                    key={perm}
                    onClick={() => {
                      const perms = form.permissions.includes(perm)
                        ? form.permissions.filter(p => p !== perm)
                        : [...form.permissions, perm]
                      setForm({ ...form, permissions: perms.length ? perms : ['read'] })
                    }}
                    className={`px-2.5 py-1.5 rounded text-xs font-medium transition-all ${
                      form.permissions.includes(perm)
                        ? 'bg-accent text-white shadow-sm'
                        : 'bg-foreground/10 text-foreground border border-foreground/15'
                    }`}
                  >
                    {perm === '*' ? 'Alle' : perm === 'read' ? 'Lesen' : 'Schreiben'}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs text-foreground/80 mb-1 block">Rate Limit (pro Min.)</label>
                <input
                  type="number"
                  value={form.rate_limit}
                  onChange={e => setForm({ ...form, rate_limit: parseInt(e.target.value) || 60 })}
                  className="w-full bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent/30 text-foreground"
                />
              </div>
              <div className="flex-1">
                <label className="text-xs text-foreground/80 mb-1 block">Gültig (Tage, 0=∞)</label>
                <input
                  type="number"
                  value={form.expires_in_days}
                  onChange={e => setForm({ ...form, expires_in_days: parseInt(e.target.value) || 0 })}
                  className="w-full bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent/30 text-foreground"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowCreate(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-foreground/10 text-foreground hover:bg-foreground/20 transition-all"
              >
                Abbrechen
              </button>
              <button
                onClick={handleCreate}
                disabled={!form.name.trim() || actionLoading === 'create'}
                className="px-4 py-1.5 rounded-lg text-xs font-medium bg-accent text-white disabled:opacity-40 hover:bg-accent/80 transition-all flex items-center gap-1.5"
              >
                {actionLoading === 'create' && <InlineSpinner size={12} />}
                Erstellen
              </button>
            </div>
          </div>
        </AdminCard>
      )}

      {/* Key list */}
      {keys.map(k => {
        const permissions: string[] = (() => { try { return JSON.parse(k.permissions) } catch { return ['read'] } })()
        return (
          <AdminCard key={k.id}>
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{k.name}</span>
                  {!k.is_active && <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 text-[10px] font-semibold border border-red-500/30">Inaktiv</span>}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <code className="text-[10px] text-foreground/80 font-mono">{k.key_prefix}...</code>
                  <span className="text-[10px] text-foreground/75">·</span>
                  {permissions.map(p => (
                    <span key={p} className="text-[10px] px-1.5 py-0.5 rounded bg-foreground/5 text-foreground/75">{p}</span>
                  ))}
                  <span className="text-[10px] text-foreground/75">· {k.rate_limit}/min</span>
                </div>
                {k.last_used_at && (
                  <div className="text-[10px] text-foreground/75 mt-1">Letzt. Nutzung: {new Date(k.last_used_at).toLocaleString('de-DE')}</div>
                )}
              </div>
              <button
                onClick={() => handleDelete(k.id)}
                disabled={actionLoading === k.id}
                className="p-2 rounded-lg text-foreground/75 hover:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-40"
              >
                {actionLoading === k.id ? <InlineSpinner size={14} /> : <Trash size={14} />}
              </button>
            </div>
          </AdminCard>
        )
      })}

      {keys.length === 0 && !showCreate && (
        <AdminCard>
          <div className="text-center py-4 text-foreground/80 text-sm">
            Keine API Keys vorhanden. Erstelle einen für deine Geräte.
          </div>
        </AdminCard>
      )}
    </div>
  )
}

// ── HA Config Tab ──────────────────────────────────────────────

function HaConfigTab({ token }: { token: string }) {
  const [config, setConfig] = useState<Record<string, unknown> | null>(null)
  const [supervisor, setSupervisor] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    (async () => {
      try {
        const [c, s] = await Promise.all([
          cachedFetch('/api/admin/ha/config', token),
          cachedFetch('/api/admin/ha/supervisor', token).catch(() => null),
        ])
        setConfig(c as Record<string, unknown>)
        setSupervisor(s as Record<string, unknown> | null)
      } catch (e) { setError((e as Error).message) }
      setLoading(false)
    })()
  }, [token])

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>
  if (!config) return <ErrorMessage>HA Konfiguration konnte nicht geladen werden.</ErrorMessage>

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <AdminCard title="Home Assistant" icon={Gear}>
        <StatItem label="Version" value={config.version as string} />
        <StatItem label="Name" value={config.location_name as string} />
        <StatItem label="Zeitzone" value={config.time_zone as string} />
        <StatItem label="Höhe" value={`${config.elevation}m`} />
        <StatItem label="Einheitensystem" value={(config.unit_system as Record<string, string>)?.temperature ?? 'N/A'} />
        <StatItem label="Sprache" value={config.language as string} />
        <StatItem label="Externe URL" value={(config.external_url as string) ?? 'Nicht gesetzt'} />
        <StatItem label="Interne URL" value={(config.internal_url as string) ?? 'Nicht gesetzt'} />
      </AdminCard>

      {Array.isArray(config.components) && (
        <AdminCard title={`Komponenten (${(config.components as string[]).length})`} icon={Cube}>
          <div className="max-h-60 overflow-y-auto space-y-0.5 pr-1">
            {(config.components as string[]).sort().map(c => (
              <div key={c} className="text-xs text-foreground/80 py-0.5">{c}</div>
            ))}
          </div>
        </AdminCard>
      )}

      {supervisor && (
        <AdminCard title="Supervisor" icon={CloudArrowUp}>
          {supervisor.supervisor_available ? (
            <>
              <StatItem label="Status" value="Verfügbar" />
              {supervisor.info && Object.entries(supervisor.info as Record<string, unknown>).slice(0, 8).map(([k, v]) => (
                <StatItem key={k} label={k} value={String(v)} />
              ))}
            </>
          ) : (
            <div className="text-xs text-foreground/80">{(supervisor as Record<string, unknown>).note as string}</div>
          )}
        </AdminCard>
      )}

      <AdminCard title="Add-ons" icon={CloudArrowUp}>
        <AddonsContent token={token} />
      </AdminCard>
    </div>
  )
}

function AddonsContent({ token }: { token: string }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null)

  useEffect(() => {
    cachedFetch('/api/admin/ha/addons', token).then(d => setData(d as Record<string, unknown>)).catch(() => {})
  }, [token])

  if (!data) return <div className="text-xs text-foreground/80">Laden...</div>

  if (data.addon_entities) {
    return (
      <div className="space-y-1.5 max-h-48 overflow-y-auto">
        {(data.addon_entities as Array<Record<string, unknown>>).map((a, i) => (
          <div key={i} className="flex justify-between items-center text-xs py-1">
            <span className="text-foreground/85 truncate">{a.friendly_name as string}</span>
            <span className="text-foreground/80">{a.installed_version as string}</span>
          </div>
        ))}
      </div>
    )
  }

  return <div className="text-xs text-foreground/80">Keine Add-on-Daten verfügbar.</div>
}

// ── Integrations Tab ──────────────────────────────────────────

function IntegrationsTab({ token }: { token: string }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    cachedFetch('/api/admin/ha/integrations', token)
      .then(d => setData(d as Record<string, unknown>))
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>
  if (!data) return <ErrorMessage>Integrationen konnten nicht geladen werden.</ErrorMessage>

  const domains = data.entity_domains as Record<string, number> | undefined

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <AdminCard title={`Entity-Domänen (${data.total_entities})`} icon={Cube} className="md:col-span-2">
        {domains && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5">
            {Object.entries(domains).sort(([, a], [, b]) => b - a).map(([domain, count]) => (
              <div key={domain} className="flex justify-between items-center text-xs py-1.5 px-2.5 rounded bg-foreground/3">
                <span className="text-foreground/80">{domain}</span>
                <span className="font-medium tabular-nums">{count}</span>
              </div>
            ))}
          </div>
        )}
      </AdminCard>

      {Array.isArray(data.components) && (
        <AdminCard title={`Geladene Komponenten (${(data.components as string[]).length})`} icon={Gear} className="md:col-span-2">
          <div className="flex flex-wrap gap-1.5">
            {(data.components as string[]).sort().map(c => (
              <span key={c} className="text-[10px] px-2 py-0.5 rounded-full bg-foreground/5 text-foreground/75">{c}</span>
            ))}
          </div>
        </AdminCard>
      )}
    </div>
  )
}

// ── Protocol Config Modal ─────────────────────────────────────

function ConfigModal({ open, onClose, title, icon: Icon, children }: {
  open: boolean
  onClose: () => void
  title: string
  icon: typeof Cpu
  children: React.ReactNode
}) {
  if (!open) return null
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="glass-card rounded-2xl p-5 w-full max-w-md max-h-[80vh] overflow-y-auto"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Icon size={18} className="text-accent" />
              <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            </div>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-foreground/10 transition">
              <X size={16} className="text-foreground/60" />
            </button>
          </div>
          {children}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

// ── MQTT Tab ──────────────────────────────────────────────────

function MqttTab({ token }: { token: string }) {
  const [haData, setHaData] = useState<Record<string, unknown> | null>(null)
  const [status, setStatus] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [showConfig, setShowConfig] = useState(false)
  const [subTopic, setSubTopic] = useState('')
  const [pubTopic, setPubTopic] = useState('')
  const [pubPayload, setPubPayload] = useState('')
  const [messages, setMessages] = useState<Array<Record<string, unknown>>>([])
  const [configured, setConfigured] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // Form fields
  const [host, setHost] = useState('')
  const [port, setPort] = useState('1883')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [useTls, setUseTls] = useState(false)

  const refreshStatus = useCallback(async () => {
    try {
      const s = await adminFetch('/api/admin/mqtt/status', token) as Record<string, unknown>
      setStatus(s)
    } catch {}
  }, [token])

  const refreshMessages = useCallback(async () => {
    try {
      const m = await adminFetch('/api/admin/mqtt/messages', token) as Record<string, unknown>
      setMessages((m.recent_messages ?? []) as Array<Record<string, unknown>>)
    } catch {}
  }, [token])

  useEffect(() => {
    cachedFetch('/api/admin/ha/mqtt', token)
      .then(d => setHaData(d as Record<string, unknown>))
      .catch(() => {})
    adminFetch('/api/admin/mqtt/status', token)
      .then(d => setStatus(d as Record<string, unknown>))
      .catch(() => {})
    adminFetch('/api/admin/mqtt/config', token)
      .then(d => {
        const c = d as Record<string, unknown>
        if (c.host) { setHost(c.host as string); setConfigured(true) }
        if (c.port) setPort(String(c.port))
        if (c.username) setUsername(c.username as string)
        if (c.use_tls) setUseTls(c.use_tls as boolean)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [token])

  useEffect(() => {
    const iv = setInterval(() => { refreshStatus(); refreshMessages() }, 5000)
    return () => clearInterval(iv)
  }, [refreshStatus, refreshMessages])

  const handleConnect = async () => {
    setConnecting(true)
    try {
      const res = await adminFetch('/api/admin/mqtt/connect', token, {
        method: 'POST',
        body: JSON.stringify({ host, port: parseInt(port), username: username || undefined, password: password || undefined, use_tls: useTls }),
      }) as Record<string, unknown>
      if (res.success) {
        setConfigured(true)
        setShowConfig(false)
      } else {
        setError(res.error as string || 'Verbindung fehlgeschlagen')
      }
      setTimeout(refreshStatus, 1500)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setConnecting(false)
    }
  }

  const handleDisconnect = async () => {
    setActionLoading('disconnect')
    try {
      await adminFetch('/api/admin/mqtt/disconnect', token, { method: 'POST' })
      refreshStatus()
    } finally { setActionLoading(null) }
  }

  const handleSubscribe = async () => {
    if (!subTopic.trim()) return
    setActionLoading('subscribe')
    try {
      await adminFetch('/api/admin/mqtt/subscribe', token, {
        method: 'POST',
        body: JSON.stringify({ topic: subTopic }),
      })
      setSubTopic('')
      refreshStatus()
    } finally { setActionLoading(null) }
  }

  const handleUnsubscribe = async (topic: string) => {
    setActionLoading(`unsub-${topic}`)
    try {
      await adminFetch('/api/admin/mqtt/unsubscribe', token, {
        method: 'POST',
        body: JSON.stringify({ topic }),
      })
      refreshStatus()
    } finally { setActionLoading(null) }
  }

  const handlePublish = async () => {
    if (!pubTopic.trim()) return
    setActionLoading('publish')
    try {
      await adminFetch('/api/admin/mqtt/publish', token, {
        method: 'POST',
        body: JSON.stringify({ topic: pubTopic, payload: pubPayload }),
      })
      setPubPayload('')
    } finally { setActionLoading(null) }
  }

  if (loading) return <LoadingSpinner />
  if (error && !status) return <ErrorMessage>{error}</ErrorMessage>

  const isConnected = (status as Record<string, unknown>)?.connected === true
  const statusError = status && typeof (status as Record<string, unknown>).error !== 'undefined'
    ? (String((status as Record<string, unknown>).error) || null)
    : null

  // Show inline setup if not configured
  if (!configured && !isConnected) {
    return (
      <div className="space-y-3">
        <AdminCard title="MQTT einrichten" icon={WifiHigh}>
          <p className="text-xs text-foreground/60 mb-3">Verbinde dich mit einem bestehenden MQTT-Broker um Nachrichten zu senden und empfangen.</p>
          <MqttConfigForm host={host} setHost={setHost} port={port} setPort={setPort} username={username} setUsername={setUsername} password={password} setPassword={setPassword} useTls={useTls} setUseTls={setUseTls} onConnect={handleConnect} connecting={connecting} error={error} />
        </AdminCard>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Connection Status */}
      <AdminCard title="MQTT Verbindung" icon={WifiHigh}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'}`} />
            <span className="text-xs font-medium text-foreground/85">{isConnected ? 'Verbunden' : 'Nicht verbunden'}</span>
            {statusError && <span className="text-[10px] text-red-400 truncate ml-2">{statusError}</span>}
          </div>
          <div className="flex gap-1.5">
            <button onClick={() => setShowConfig(true)} className="flex items-center gap-1 px-2 py-1 rounded bg-foreground/5 text-xs text-foreground/70 hover:bg-foreground/10 transition">
              <Gear size={12} /> Konfigurieren
            </button>
            {isConnected ? (
              <button onClick={handleDisconnect} disabled={actionLoading === 'disconnect'}
                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-red-500/20 text-red-400 text-xs font-medium hover:bg-red-500/30 transition disabled:opacity-40">
                {actionLoading === 'disconnect' ? <InlineSpinner size={12} /> : <Power size={12} />} Trennen
              </button>
            ) : (
              <button onClick={handleConnect} disabled={connecting || !host} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-accent/20 text-accent text-xs font-medium hover:bg-accent/30 transition disabled:opacity-40">
                <Play size={12} weight="fill" /> {connecting ? 'Verbinde...' : 'Verbinden'}
              </button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-4">
          <StatItem label="Broker" value={host ? `${host}:${port}` : '–'} />
          <StatItem label="TLS" value={useTls ? 'Ja' : 'Nein'} />
          <StatItem label="Nachrichten" value={String(status?.message_count ?? 0)} />
          <StatItem label="Subscriptions" value={String((status?.subscribed_topics as string[] ?? []).length)} />
        </div>
      </AdminCard>

      {/* Subscribe & Topics */}
      {isConnected && (
        <AdminCard title="Topics & Subscriptions" icon={ListBullets}>
          <div className="space-y-2">
            <div className="flex gap-2">
              <input value={subTopic} onChange={e => setSubTopic(e.target.value)} placeholder="Topic (z.B. home/#)" className={`flex-1 ${ccInput('text-xs px-3 py-2')}`} onKeyDown={e => e.key === 'Enter' && handleSubscribe()} />
              <button onClick={handleSubscribe} disabled={actionLoading === 'subscribe'}
                className="px-3 py-1.5 rounded-lg bg-accent/20 text-accent text-xs font-medium hover:bg-accent/30 transition disabled:opacity-40">
                {actionLoading === 'subscribe' ? <InlineSpinner size={12} /> : <Plus size={12} />}
              </button>
            </div>
            {((status as Record<string, unknown>)?.subscribed_topics as string[] ?? []).length > 0 && (
              <div className="space-y-1">
                {((status as Record<string, unknown>)?.subscribed_topics as string[]).map(t => (
                  <div key={t} className="flex justify-between items-center text-xs py-1 px-2 rounded bg-foreground/5">
                    <span className="font-mono text-foreground/85">{t}</span>
                    <button onClick={() => handleUnsubscribe(t)} disabled={actionLoading === `unsub-${t}`}
                      className="text-red-400 hover:text-red-300 disabled:opacity-40">
                      {actionLoading === `unsub-${t}` ? <InlineSpinner size={12} /> : <Trash size={12} />}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </AdminCard>
      )}

      {/* Publish */}
      {isConnected && (
        <AdminCard title="Nachricht senden" icon={CloudArrowUp}>
          <div className="space-y-2">
            <input value={pubTopic} onChange={e => setPubTopic(e.target.value)} placeholder="Topic" className={`w-full ${ccInput('text-xs px-3 py-2')}`} />
            <input value={pubPayload} onChange={e => setPubPayload(e.target.value)} placeholder="Payload (JSON oder Text)" className={`w-full ${ccInput('text-xs px-3 py-2')}`} onKeyDown={e => e.key === 'Enter' && handlePublish()} />
            <button onClick={handlePublish} disabled={!pubTopic.trim() || actionLoading === 'publish'}
              className="px-3 py-1.5 rounded-lg bg-accent/20 text-accent text-xs font-medium hover:bg-accent/30 transition disabled:opacity-40 flex items-center gap-1.5">
              {actionLoading === 'publish' && <InlineSpinner size={12} />}
              Senden
            </button>
          </div>
        </AdminCard>
      )}

      {/* Recent Messages */}
      {isConnected && messages.length > 0 && (
        <AdminCard title={`Letzte Nachrichten (${messages.length})`} icon={ListBullets}>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {[...messages].reverse().slice(0, 30).map((m, i) => (
              <div key={i} className="text-[10px] py-1 px-2 rounded bg-foreground/5 border-b border-foreground/5 last:border-0">
                <div className="flex justify-between items-center">
                  <span className="font-mono text-accent/90 truncate">{m.topic as string}</span>
                  <span className="text-foreground/40 ml-2 whitespace-nowrap">{(m.received_at as string)?.split('T')[1]?.slice(0,8)}</span>
                </div>
                <div className="text-foreground/70 font-mono truncate mt-0.5">{m.payload as string}</div>
              </div>
            ))}
          </div>
        </AdminCard>
      )}

      {/* HA MQTT Entities */}
      <AdminCard title={`HA MQTT Entities (${haData?.mqtt_entity_count ?? 0})`} icon={WifiHigh}>
        {(haData?.mqtt_entities as Array<Record<string, unknown>> ?? []).length === 0 ? (
          <div className="text-xs text-foreground/50 text-center py-4">Keine MQTT-Entities in Home Assistant.</div>
        ) : (
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {(haData?.mqtt_entities as Array<Record<string, unknown>>).map((e, i) => (
              <div key={i} className="flex justify-between items-center text-xs py-1 border-b border-foreground/5 last:border-0">
                <span className="text-foreground/85 truncate mr-2">{(e.friendly_name as string) ?? e.entity_id}</span>
                <span className="text-foreground/80 font-mono text-[10px]">{e.state as string}</span>
              </div>
            ))}
          </div>
        )}
      </AdminCard>

      {/* Config Modal */}
      <ConfigModal open={showConfig} onClose={() => setShowConfig(false)} title="MQTT Konfiguration" icon={WifiHigh}>
        <p className="text-xs text-foreground/60 mb-3">Verbindungsdaten zum MQTT-Broker. Werden automatisch gespeichert und beim Neustart wiederhergestellt.</p>
        <MqttConfigForm host={host} setHost={setHost} port={port} setPort={setPort} username={username} setUsername={setUsername} password={password} setPassword={setPassword} useTls={useTls} setUseTls={setUseTls} onConnect={handleConnect} connecting={connecting} error={error} />
      </ConfigModal>
    </div>
  )
}

function MqttConfigForm({ host, setHost, port, setPort, username, setUsername, password, setPassword, useTls, setUseTls, onConnect, connecting, error }: {
  host: string; setHost: (v: string) => void
  port: string; setPort: (v: string) => void
  username: string; setUsername: (v: string) => void
  password: string; setPassword: (v: string) => void
  useTls: boolean; setUseTls: (v: boolean) => void
  onConnect: () => void; connecting: boolean; error: string
}) {
  return (
    <div className="space-y-2">
      {error && <div className="text-[10px] text-red-400 bg-red-500/10 rounded px-2 py-1">{error}</div>}
      <div className="grid grid-cols-2 gap-2">
        <input value={host} onChange={e => setHost(e.target.value)} placeholder="Host (z.B. 192.168.1.10)" className={`col-span-2 ${ccInput('text-xs px-3 py-2')}`} />
        <input value={port} onChange={e => setPort(e.target.value)} placeholder="Port" type="number" className={`${ccInput('text-xs px-3 py-2')}`} />
        <label className="flex items-center gap-2 text-xs text-foreground/85 px-2">
          <input type="checkbox" checked={useTls} onChange={e => setUseTls(e.target.checked)} className="rounded accent-[var(--accent)]" />
          TLS
        </label>
        <input value={username} onChange={e => setUsername(e.target.value)} placeholder="Benutzername (optional)" className={ccInput('text-xs px-3 py-2')} />
        <input value={password} onChange={e => setPassword(e.target.value)} placeholder="Passwort (optional)" type="password" className={ccInput('text-xs px-3 py-2')} />
      </div>
      <button onClick={onConnect} disabled={connecting || !host} className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-accent/20 text-accent text-xs font-medium hover:bg-accent/30 transition disabled:opacity-40">
        <Play size={12} weight="fill" /> {connecting ? 'Verbinde...' : 'Verbinden & Speichern'}
      </button>
    </div>
  )
}

// ── Matter Tab ────────────────────────────────────────────────

function MatterTab({ token }: { token: string }) {
  const [status, setStatus] = useState<Record<string, unknown> | null>(null)
  const [config, setConfig] = useState({ enabled: false, commission_port: 5540, discriminator: 3840, passcode: 20202021 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [showConfig, setShowConfig] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const s = await adminFetch('/api/admin/matter/status', token) as Record<string, unknown>
      setStatus(s)
      if (s.config) {
        const c = s.config as Record<string, unknown>
        setConfig({
          enabled: c.enabled as boolean ?? false,
          commission_port: c.commission_port as number ?? 5540,
          discriminator: c.discriminator as number ?? 3840,
          passcode: c.passcode as number ?? 20202021,
        })
      }
    } catch { /* endpoint optional */ }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { refresh() }, [refresh])

  const handleSaveConfig = async () => {
    setSaving(true)
    try {
      await adminFetch('/api/admin/matter/config', token, { method: 'POST', body: JSON.stringify(config) })
      setShowConfig(false)
    } catch (e) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const devices = (status?.devices ?? []) as Array<Record<string, unknown>>
  const fabrics = (status?.fabrics ?? []) as Array<Record<string, unknown>>

  return (
    <div className="space-y-3">
      {/* Status Overview */}
      <AdminCard title="Matter Status" icon={HardDrive}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${config.enabled ? 'bg-green-400' : 'bg-foreground/30'}`} />
            <span className="text-xs font-medium text-foreground/85">{config.enabled ? 'Aktiviert' : 'Deaktiviert'}</span>
          </div>
          <div className="flex gap-1.5">
            <button onClick={() => setShowConfig(true)} className="flex items-center gap-1 px-2 py-1 rounded bg-foreground/5 text-xs text-foreground/70 hover:bg-foreground/10 transition">
              <Gear size={12} /> Konfigurieren
            </button>
            <button onClick={async () => { await adminFetch('/api/admin/matter/refresh', token, { method: 'POST' }); refresh() }} className="flex items-center gap-1 px-2 py-1 rounded bg-foreground/5 text-xs text-foreground/70 hover:bg-foreground/10 transition">
              <ArrowClockwise size={12} /> Aktualisieren
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-4">
          <StatItem label="Geräte" value={String(status?.device_count ?? 0)} />
          <StatItem label="HA Entities" value={String(status?.ha_matter_entities ?? 0)} />
          <StatItem label="Commission Port" value={String(config.commission_port)} />
          <StatItem label="Fabrics" value={String(fabrics.length)} />
        </div>
      </AdminCard>

      {/* Matter Devices */}
      {devices.length > 0 && (
        <AdminCard title={`Matter Geräte (${devices.length})`} icon={HardDrive}>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {devices.map((d, i) => (
              <div key={i} className="rounded-lg bg-foreground/5 p-2.5 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground/90">{d.name as string}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${d.reachable ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                    {d.reachable ? 'Erreichbar' : 'Offline'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-3 text-[10px] text-foreground/60">
                  <span>Typ: <span className="text-foreground/80">{d.device_type as string}</span></span>
                  {typeof d.vendor === 'string' && <span>Hersteller: <span className="text-foreground/80">{d.vendor}</span></span>}
                  {typeof d.model === 'string' && <span>Modell: <span className="text-foreground/80">{d.model}</span></span>}
                </div>
              </div>
            ))}
          </div>
        </AdminCard>
      )}

      {/* Fabrics */}
      {fabrics.length > 0 && (
        <AdminCard title={`Matter Fabrics (${fabrics.length})`} icon={Globe}>
          <div className="space-y-1.5">
            {fabrics.map((f, i) => (
              <div key={i} className="flex justify-between items-center text-xs py-1 border-b border-foreground/5 last:border-0">
                <span className="text-foreground/85">{f.label as string}</span>
                <span className="text-foreground/60 text-[10px]">{String(f.node_count)} Nodes</span>
              </div>
            ))}
          </div>
        </AdminCard>
      )}

      {/* Config Modal */}
      <ConfigModal open={showConfig} onClose={() => setShowConfig(false)} title="Matter Konfiguration" icon={HardDrive}>
        <p className="text-xs text-foreground/60 mb-3">Matter Bridge Einstellungen. Verbindet sich mit der bestehenden Matter-Integration in Home Assistant.</p>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs text-foreground/85">
            <input type="checkbox" checked={config.enabled} onChange={e => setConfig(c => ({ ...c, enabled: e.target.checked }))} className="rounded accent-[var(--accent)]" />
            Matter Bridge aktiviert
          </label>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] text-foreground/50 block mb-0.5">Commission Port</label>
              <input value={config.commission_port} onChange={e => setConfig(c => ({ ...c, commission_port: parseInt(e.target.value) || 5540 }))} type="number" className="w-full px-2 py-1 rounded-lg bg-foreground/5 border border-foreground/10 text-xs text-foreground focus:outline-none focus:border-accent/50" />
            </div>
            <div>
              <label className="text-[10px] text-foreground/50 block mb-0.5">Discriminator</label>
              <input value={config.discriminator} onChange={e => setConfig(c => ({ ...c, discriminator: parseInt(e.target.value) || 3840 }))} type="number" className="w-full px-2 py-1 rounded-lg bg-foreground/5 border border-foreground/10 text-xs text-foreground focus:outline-none focus:border-accent/50" />
            </div>
            <div>
              <label className="text-[10px] text-foreground/50 block mb-0.5">Passcode</label>
              <input value={config.passcode} onChange={e => setConfig(c => ({ ...c, passcode: parseInt(e.target.value) || 20202021 }))} type="number" className="w-full px-2 py-1 rounded-lg bg-foreground/5 border border-foreground/10 text-xs text-foreground focus:outline-none focus:border-accent/50" />
            </div>
          </div>
          <button onClick={handleSaveConfig} disabled={saving} className="w-full px-3 py-2 rounded-lg bg-accent/20 text-accent text-xs font-medium hover:bg-accent/30 transition disabled:opacity-40">
            {saving ? 'Speichern...' : 'Speichern'}
          </button>
        </div>
      </ConfigModal>
    </div>
  )
}

// ── HA Connection Tab ──────────────────────────────────────────

function HaConnectionTab({ token }: { token: string }) {
  const [status, setStatus] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      const s = await adminFetch('/api/admin/ha/connection', token) as Record<string, unknown>
      setStatus(s)
    } catch { /* optional */ }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { refresh() }, [refresh])

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const integrations = (status?.integrations ?? []) as Array<Record<string, unknown>>
  const events = (status?.events ?? []) as Array<Record<string, unknown>>

  return (
    <div className="space-y-3">
      <AdminCard title="Home Assistant Verbindung" icon={Pulse}>
        <div className="space-y-1">
          <StatItem label="Status" value={status?.available ? 'Verbunden' : 'Getrennt'} />
          <StatItem label="HA URL" value={status?.ha_url as string} />
          {typeof status?.ha_version === 'string' && <StatItem label="HA Version" value={status.ha_version} />}
          <StatItem label="Fehler in Folge" value={String(status?.failure_count ?? 0)} />
        </div>
        <button onClick={refresh} className="mt-2 flex items-center gap-1 px-2 py-1 rounded bg-foreground/5 text-xs text-foreground/70 hover:bg-foreground/10 transition">
          <ArrowClockwise size={12} /> Aktualisieren
        </button>
      </AdminCard>

      <AdminCard title={`Erkannte Integrationen (${integrations.length})`} icon={Cube}>
        {integrations.length === 0 ? (
          <div className="text-xs text-foreground/50 py-2">Keine Integrationen erkannt</div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {integrations.map(integ => (
              <span key={String(integ.domain)} className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                integ.available ? 'bg-accent/10 text-accent' : 'bg-foreground/10 text-foreground/50'
              }`}>{String(integ.title || integ.domain)}</span>
            ))}
          </div>
        )}
      </AdminCard>

      {events.length > 0 && (
        <AdminCard title="Verbindungs-Ereignisse" icon={ListBullets}>
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {events.map((ev, i) => (
              <div key={i} className="flex items-center gap-2 text-[10px] py-1 border-b border-foreground/5 last:border-0">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${(ev.event_type as string)?.includes('onnected') ? 'bg-green-400' : 'bg-red-400'}`} />
                <span className="text-foreground/70">{ev.event_type as string}</span>
                <span className="text-foreground/40 ml-auto">{ev.timestamp as string}</span>
              </div>
            ))}
          </div>
        </AdminCard>
      )}
    </div>
  )
}

// ── Zigbee Tab ────────────────────────────────────────────────

function ZigbeeTab({ token }: { token: string }) {
  const [status, setStatus] = useState<Record<string, unknown> | null>(null)
  const [config, setConfig] = useState({ mode: 'auto', enabled: true, z2m_topic: 'zigbee2mqtt' })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [showConfig, setShowConfig] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const s = await adminFetch('/api/admin/zigbee/status', token) as Record<string, unknown>
      setStatus(s)
      if (s.config) {
        const c = s.config as Record<string, unknown>
        setConfig({
          mode: (c.mode as string) ?? 'auto',
          enabled: (c.enabled as boolean) ?? true,
          z2m_topic: (c.z2m_topic as string) ?? 'zigbee2mqtt',
        })
      }
    } catch { /* optional */ }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { refresh() }, [refresh])

  const handleSave = async () => {
    setSaving(true)
    try {
      await adminFetch('/api/admin/zigbee/config', token, { method: 'POST', body: JSON.stringify(config) })
      setShowConfig(false)
    } catch (e) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const devices = (status?.devices ?? []) as Array<Record<string, unknown>>
  const network = status?.network as Record<string, unknown> | null

  return (
    <div className="space-y-3">
      {/* Status */}
      <AdminCard title="Zigbee Status" icon={Tree}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${config.enabled ? 'bg-green-400' : 'bg-foreground/30'}`} />
            <span className="text-xs font-medium text-foreground/85">{status?.mode as string ?? 'Auto'}</span>
          </div>
          <div className="flex gap-1.5">
            <button onClick={() => setShowConfig(true)} className="flex items-center gap-1 px-2 py-1 rounded bg-foreground/5 text-xs text-foreground/70 hover:bg-foreground/10 transition">
              <Gear size={12} /> Konfigurieren
            </button>
            <button onClick={async () => { await adminFetch('/api/admin/zigbee/refresh', token, { method: 'POST' }); refresh() }} className="flex items-center gap-1 px-2 py-1 rounded bg-foreground/5 text-xs text-foreground/70 hover:bg-foreground/10 transition">
              <ArrowClockwise size={12} /> Aktualisieren
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-4">
          <StatItem label="Geräte" value={String(status?.device_count ?? 0)} />
          <StatItem label="Modus" value={status?.detected_mode as string ?? '–'} />
          {network && <>
            <StatItem label="Kanal" value={String(network.channel ?? '–')} />
            <StatItem label="Beitritt" value={(network.permit_join as boolean) ? 'Ja' : 'Nein'} />
          </>}
        </div>
      </AdminCard>

      {/* Devices */}
      {devices.length > 0 && (
        <AdminCard title={`Zigbee Geräte (${devices.length})`} icon={Tree}>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {devices.map((d, i) => (
              <div key={i} className="rounded-lg bg-foreground/5 p-2.5 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground/90">{d.friendly_name as string}</span>
                  {typeof d.lqi === 'number' && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${d.lqi > 100 ? 'bg-green-500/20 text-green-400' : d.lqi > 50 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400'}`}>
                      LQI: {d.lqi}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-x-3 text-[10px] text-foreground/60">
                  <span>Typ: <span className="text-foreground/80">{d.device_type as string}</span></span>
                  <span>Strom: <span className="text-foreground/80">{d.power_source as string}</span></span>
                  {typeof d.battery === 'number' && <span>Batterie: <span className="text-foreground/80">{d.battery}%</span></span>}
                </div>
                <div className="text-[9px] text-foreground/40 font-mono truncate">{d.ieee_address as string}</div>
              </div>
            ))}
          </div>
        </AdminCard>
      )}

      {/* Config Modal */}
      <ConfigModal open={showConfig} onClose={() => setShowConfig(false)} title="Zigbee Konfiguration" icon={Tree}>
        <p className="text-xs text-foreground/60 mb-3">Verbindet sich mit der bestehenden Zigbee-Integration (Zigbee2MQTT oder ZHA) in Home Assistant.</p>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs text-foreground/85">
            <input type="checkbox" checked={config.enabled} onChange={e => setConfig(c => ({ ...c, enabled: e.target.checked }))} className="rounded accent-[var(--accent)]" />
            Zigbee aktiviert
          </label>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-foreground/50 block mb-0.5">Modus</label>
              <select value={config.mode} onChange={e => setConfig(c => ({ ...c, mode: e.target.value }))} className="w-full px-2 py-1 rounded-lg bg-foreground/5 border border-foreground/10 text-xs text-foreground focus:outline-none focus:border-accent/50">
                <option value="auto">Auto-Erkennung</option>
                <option value="zigbee2mqtt">Zigbee2MQTT</option>
                <option value="zha">ZHA</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-foreground/50 block mb-0.5">Z2M Topic</label>
              <input value={config.z2m_topic} onChange={e => setConfig(c => ({ ...c, z2m_topic: e.target.value }))} className="w-full px-2 py-1 rounded-lg bg-foreground/5 border border-foreground/10 text-xs text-foreground focus:outline-none focus:border-accent/50" />
            </div>
          </div>
          <button onClick={handleSave} disabled={saving} className="w-full px-3 py-2 rounded-lg bg-accent/20 text-accent text-xs font-medium hover:bg-accent/30 transition disabled:opacity-40">
            {saving ? 'Speichern...' : 'Speichern'}
          </button>
        </div>
      </ConfigModal>
    </div>
  )
}

// ── Z-Wave Tab ────────────────────────────────────────────────

function ZwaveTab({ token }: { token: string }) {
  const [status, setStatus] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showConfig, setShowConfig] = useState(false)
  const [config, setConfig] = useState({ enabled: true, zwave_js_url: '' })
  const [saving, setSaving] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const s = await adminFetch('/api/admin/zwave/status', token) as Record<string, unknown>
      setStatus(s)
      if (s.config) {
        const c = s.config as Record<string, unknown>
        setConfig({ enabled: (c.enabled as boolean) ?? true, zwave_js_url: (c.zwave_js_url as string) ?? '' })
      }
    } catch { /* optional */ }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { refresh() }, [refresh])

  const handleSave = async () => {
    setSaving(true)
    try {
      await adminFetch('/api/admin/zwave/config', token, { method: 'POST', body: JSON.stringify(config) })
      setShowConfig(false)
    } catch (e) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const nodes = (status?.nodes ?? []) as Array<Record<string, unknown>>
  const network = status?.network as Record<string, unknown> | null

  return (
    <div className="space-y-3">
      <AdminCard title="Z-Wave Status" icon={LinkSimple}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${config.enabled ? 'bg-green-400' : 'bg-foreground/30'}`} />
            <span className="text-xs font-medium text-foreground/85">{nodes.length > 0 ? 'Aktiv' : 'Keine Nodes'}</span>
          </div>
          <div className="flex gap-1.5">
            <button onClick={() => setShowConfig(true)} className="flex items-center gap-1 px-2 py-1 rounded bg-foreground/5 text-xs text-foreground/70 hover:bg-foreground/10 transition">
              <Gear size={12} /> Konfigurieren
            </button>
            <button onClick={async () => { await adminFetch('/api/admin/zwave/refresh', token, { method: 'POST' }); refresh() }} className="flex items-center gap-1 px-2 py-1 rounded bg-foreground/5 text-xs text-foreground/70 hover:bg-foreground/10 transition">
              <ArrowClockwise size={12} /> Aktualisieren
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-4">
          <StatItem label="Nodes" value={String(status?.node_count ?? 0)} />
          <StatItem label="HA Entities" value={String(status?.ha_zwave_entities ?? 0)} />
          {network && <>
            <StatItem label="Home ID" value={network.home_id as string ?? '–'} />
            <StatItem label="Controller" value={network.controller as string ?? '–'} />
          </>}
        </div>
      </AdminCard>

      {nodes.length > 0 && (
        <AdminCard title={`Z-Wave Nodes (${nodes.length})`} icon={LinkSimple}>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {nodes.map((n, i) => (
              <div key={i} className="rounded-lg bg-foreground/5 p-2.5 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground/90">{n.name as string}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${n.status === 'alive' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                    {n.status as string}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-x-2 text-[10px] text-foreground/60">
                  <span>Node: <span className="text-foreground/80">{String(n.node_id)}</span></span>
                  <span>Typ: <span className="text-foreground/80">{String(n.device_type)}</span></span>
                  {typeof n.product === 'string' && <span>Produkt: <span className="text-foreground/80">{n.product}</span></span>}
                </div>
                <div className="flex gap-2 mt-0.5">
                  {n.is_secure === true && <span className="text-[9px] px-1 rounded bg-blue-500/10 text-blue-400">Sicher</span>}
                  {n.is_routing === true && <span className="text-[9px] px-1 rounded bg-purple-500/10 text-purple-400">Routing</span>}
                  {n.is_beaming === true && <span className="text-[9px] px-1 rounded bg-cyan-500/10 text-cyan-400">Beaming</span>}
                </div>
              </div>
            ))}
          </div>
        </AdminCard>
      )}

      {/* Config Modal */}
      <ConfigModal open={showConfig} onClose={() => setShowConfig(false)} title="Z-Wave Konfiguration" icon={LinkSimple}>
        <p className="text-xs text-foreground/60 mb-3">Verbindet sich mit der bestehenden Z-Wave JS Integration in Home Assistant.</p>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs text-foreground/85">
            <input type="checkbox" checked={config.enabled} onChange={e => setConfig(c => ({ ...c, enabled: e.target.checked }))} className="rounded accent-[var(--accent)]" />
            Z-Wave aktiviert
          </label>
          <div>
            <label className="text-[10px] text-foreground/50 block mb-0.5">Z-Wave JS WebSocket URL (optional)</label>
            <input value={config.zwave_js_url} onChange={e => setConfig(c => ({ ...c, zwave_js_url: e.target.value }))} placeholder="ws://iora.local:3000" className="w-full px-2 py-1 rounded-lg bg-foreground/5 border border-foreground/10 text-xs text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-accent/50" />
          </div>
          <button onClick={handleSave} disabled={saving} className="w-full px-3 py-2 rounded-lg bg-accent/20 text-accent text-xs font-medium hover:bg-accent/30 transition disabled:opacity-40">
            {saving ? 'Speichern...' : 'Speichern'}
          </button>
        </div>
      </ConfigModal>
    </div>
  )
}

// ── Bluetooth Tab ─────────────────────────────────────────────

function BleTab({ token }: { token: string }) {
  const [status, setStatus] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showConfig, setShowConfig] = useState(false)
  const [config, setConfig] = useState({ enabled: true })
  const [saving, setSaving] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const s = await adminFetch('/api/admin/ble/status', token) as Record<string, unknown>
      setStatus(s)
      if (s.config) {
        const c = s.config as Record<string, unknown>
        setConfig({ enabled: (c.enabled as boolean) ?? true })
      }
    } catch { /* optional */ }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { refresh() }, [refresh])

  const handleSave = async () => {
    setSaving(true)
    try {
      await adminFetch('/api/admin/ble/config', token, { method: 'POST', body: JSON.stringify(config) })
      setShowConfig(false)
    } catch (e) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const devices = (status?.devices ?? []) as Array<Record<string, unknown>>
  const adapters = (status?.adapters ?? []) as Array<Record<string, unknown>>

  return (
    <div className="space-y-3">
      <AdminCard title="Bluetooth Status" icon={Bluetooth}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${config.enabled ? 'bg-green-400' : 'bg-foreground/30'}`} />
            <span className="text-xs font-medium text-foreground/85">{config.enabled ? 'Aktiviert' : 'Deaktiviert'}</span>
          </div>
          <div className="flex gap-1.5">
            <button onClick={() => setShowConfig(true)} className="flex items-center gap-1 px-2 py-1 rounded bg-foreground/5 text-xs text-foreground/70 hover:bg-foreground/10 transition">
              <Gear size={12} /> Konfigurieren
            </button>
            <button onClick={async () => { await adminFetch('/api/admin/ble/refresh', token, { method: 'POST' }); refresh() }} className="flex items-center gap-1 px-2 py-1 rounded bg-foreground/5 text-xs text-foreground/70 hover:bg-foreground/10 transition">
              <ArrowClockwise size={12} /> Aktualisieren
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-4">
          <StatItem label="Geräte" value={String(status?.device_count ?? 0)} />
          <StatItem label="Adapter" value={String(adapters.length)} />
          <StatItem label="HA Entities" value={String(status?.ha_ble_entities ?? 0)} />
        </div>
      </AdminCard>

      {adapters.length > 0 && (
        <AdminCard title="Bluetooth Adapter" icon={Bluetooth}>
          <div className="space-y-1.5">
            {adapters.map((a, i) => (
              <div key={i} className="flex justify-between items-center text-xs py-1 border-b border-foreground/5 last:border-0">
                <span className="text-foreground/85">{a.name as string}</span>
                <span className="text-foreground/50 text-[10px]">{a.address as string}</span>
              </div>
            ))}
          </div>
        </AdminCard>
      )}

      {devices.length > 0 && (
        <AdminCard title={`BLE Geräte (${devices.length})`} icon={Bluetooth}>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {devices.map((d, i) => (
              <div key={i} className="rounded-lg bg-foreground/5 p-2.5 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground/90">{d.name as string}</span>
                  {typeof d.rssi === 'number' && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${d.rssi > -60 ? 'bg-green-500/20 text-green-400' : d.rssi > -80 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400'}`}>
                      {d.rssi} dBm
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-x-3 text-[10px] text-foreground/60">
                  <span>Typ: <span className="text-foreground/80">{d.device_type as string}</span></span>
                  {typeof d.battery === 'number' && <span>Batterie: <span className="text-foreground/80">{d.battery}%</span></span>}
                </div>
                <div className="text-[9px] text-foreground/40 font-mono truncate">{d.address as string}</div>
              </div>
            ))}
          </div>
        </AdminCard>
      )}

      {/* Config Modal */}
      <ConfigModal open={showConfig} onClose={() => setShowConfig(false)} title="Bluetooth Konfiguration" icon={Bluetooth}>
        <p className="text-xs text-foreground/60 mb-3">Nutzt die bestehende Bluetooth-Integration in Home Assistant zur Geräte-Erkennung.</p>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs text-foreground/85">
            <input type="checkbox" checked={config.enabled} onChange={e => setConfig(c => ({ ...c, enabled: e.target.checked }))} className="rounded accent-[var(--accent)]" />
            Bluetooth aktiviert
          </label>
          <button onClick={handleSave} disabled={saving} className="w-full px-3 py-2 rounded-lg bg-accent/20 text-accent text-xs font-medium hover:bg-accent/30 transition disabled:opacity-40">
            {saving ? 'Speichern...' : 'Speichern'}
          </button>
        </div>
      </ConfigModal>
    </div>
  )
}

// ── HomeKit Tab ───────────────────────────────────────────────

function HomekitTab({ token }: { token: string }) {
  const [status, setStatus] = useState<Record<string, unknown> | null>(null)
  const [config, setConfig] = useState({ enabled: false, bridge_name: 'MDT Dashboard Bridge', bridge_port: 21063 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [showConfig, setShowConfig] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const s = await adminFetch('/api/admin/homekit/status', token) as Record<string, unknown>
      setStatus(s)
      if (s.config) {
        const c = s.config as Record<string, unknown>
        const bridge_port = typeof c.bridge_port === 'number'
          ? c.bridge_port
          : typeof c.port === 'number'
            ? c.port
            : 21063
        setConfig({
          enabled: typeof c.enabled === 'boolean' ? c.enabled : false,
          bridge_name: typeof c.bridge_name === 'string' ? c.bridge_name : 'MDT Dashboard Bridge',
          bridge_port,
        })
      }
    } catch { /* optional */ }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { refresh() }, [refresh])

  const handleSave = async () => {
    setSaving(true)
    try {
      await adminFetch('/api/admin/homekit/config', token, { method: 'POST', body: JSON.stringify(config) })
      setShowConfig(false)
    } catch (e) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const accessories = (status?.accessories ?? []) as Array<Record<string, unknown>>

  return (
    <div className="space-y-3">
      <AdminCard title="HomeKit Status" icon={AppleLogo}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${config.enabled ? 'bg-green-400' : 'bg-foreground/30'}`} />
            <span className="text-xs font-medium text-foreground/85">{config.enabled ? 'Aktiviert' : 'Deaktiviert'}</span>
          </div>
          <div className="flex gap-1.5">
            <button onClick={() => setShowConfig(true)} className="flex items-center gap-1 px-2 py-1 rounded bg-foreground/5 text-xs text-foreground/70 hover:bg-foreground/10 transition">
              <Gear size={12} /> Konfigurieren
            </button>
            <button onClick={async () => { await adminFetch('/api/admin/homekit/refresh', token, { method: 'POST' }); refresh() }} className="flex items-center gap-1 px-2 py-1 rounded bg-foreground/5 text-xs text-foreground/70 hover:bg-foreground/10 transition">
              <ArrowClockwise size={12} /> Aktualisieren
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-4">
          <StatItem label="Bridge" value={status?.bridge_available ? 'Erreichbar' : 'Nicht erreichbar'} />
          <StatItem label="Zubehör" value={String(status?.accessory_count ?? 0)} />
          <StatItem label="HA Entities" value={String(status?.ha_homekit_entities ?? 0)} />
          <StatItem label="Port" value={String(config.bridge_port)} />
        </div>
      </AdminCard>

      {accessories.length > 0 && (
        <AdminCard title={`HomeKit Zubehör (${accessories.length})`} icon={AppleLogo}>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {accessories.map((a, i) => (
              <div key={i} className="rounded-lg bg-foreground/5 p-2.5 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground/90">{a.name as string}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-foreground/10 text-foreground/70">{a.accessory_type as string}</span>
                </div>
                <div className="text-[10px] text-foreground/60">
                  <span>Status: <span className="text-foreground/80">{a.state as string}</span></span>
                </div>
                <div className="text-[9px] text-foreground/40 font-mono truncate">{a.entity_id as string}</div>
              </div>
            ))}
          </div>
        </AdminCard>
      )}

      {/* Config Modal */}
      <ConfigModal open={showConfig} onClose={() => setShowConfig(false)} title="HomeKit Konfiguration" icon={AppleLogo}>
        <p className="text-xs text-foreground/60 mb-3">Nutzt die bestehende HomeKit-Integration in Home Assistant. Bridge-Einstellungen für die Zubehör-Zuordnung.</p>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs text-foreground/85">
            <input type="checkbox" checked={config.enabled} onChange={e => setConfig(c => ({ ...c, enabled: e.target.checked }))} className="rounded accent-[var(--accent)]" />
            HomeKit Bridge aktiviert
          </label>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-foreground/50 block mb-0.5">Bridge Name</label>
              <input value={config.bridge_name} onChange={e => setConfig(c => ({ ...c, bridge_name: e.target.value }))} className="w-full px-2 py-1 rounded-lg bg-foreground/5 border border-foreground/10 text-xs text-foreground focus:outline-none focus:border-accent/50" />
            </div>
            <div>
              <label className="text-[10px] text-foreground/50 block mb-0.5">Port</label>
              <input value={config.bridge_port} onChange={e => setConfig(c => ({ ...c, bridge_port: parseInt(e.target.value) || 21063 }))} type="number" className="w-full px-2 py-1 rounded-lg bg-foreground/5 border border-foreground/10 text-xs text-foreground focus:outline-none focus:border-accent/50" />
            </div>
          </div>
          <button onClick={handleSave} disabled={saving} className="w-full px-3 py-2 rounded-lg bg-accent/20 text-accent text-xs font-medium hover:bg-accent/30 transition disabled:opacity-40">
            {saving ? 'Speichern...' : 'Speichern'}
          </button>
        </div>
      </ConfigModal>
    </div>
  )
}

// ── Automations Tab ────────────────────────────────────────────

function AutomationsTab({ token }: { token: string }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    cachedFetch('/api/admin/ha/automations', token)
      .then(d => setData(d as Record<string, unknown>))
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const automations = (data?.automations ?? []) as Array<Record<string, unknown>>

  return (
    <div className="space-y-2">
      <AdminCard>
        <div className="flex items-center gap-2">
          <Power size={16} className="text-accent" />
          <span className="text-sm font-medium text-foreground">{automations.length} Automationen</span>
        </div>
      </AdminCard>
      {automations.map((a, i) => (
        <AdminCard key={i}>
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{(a.friendly_name as string) ?? a.entity_id}</div>
              <div className="text-[10px] text-foreground/80 mt-0.5">
                {a.entity_id as string}
                {typeof a.last_triggered === 'string' && ` · Letzt. Ausl.: ${new Date(a.last_triggered).toLocaleString('de-DE')}`}
              </div>
            </div>
            <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
              a.state === 'on' ? 'bg-green-500/10 text-green-400' : 'bg-foreground/5 text-foreground/80'
            }`}>
              {a.state === 'on' ? 'Aktiv' : 'Aus'}
            </span>
          </div>
        </AdminCard>
      ))}
    </div>
  )
}

// ── Scenes Tab ────────────────────────────────────────────────

function ScenesTab({ token }: { token: string }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    cachedFetch('/api/admin/ha/scenes', token)
      .then(d => setData(d as Record<string, unknown>))
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const scenes = (data?.scenes ?? []) as Array<Record<string, unknown>>

  return (
    <div className="space-y-2">
      <AdminCard>
        <div className="flex items-center gap-2">
          <FilmSlate size={16} className="text-accent" />
          <span className="text-sm font-medium text-foreground">{scenes.length} Szenen</span>
        </div>
      </AdminCard>
      {scenes.length === 0 ? (
        <AdminCard>
          <div className="text-sm text-foreground/80 text-center py-4">Keine Szenen in Home Assistant konfiguriert.</div>
        </AdminCard>
      ) : scenes.map((s, i) => (
        <AdminCard key={i}>
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{(s.friendly_name as string) ?? s.entity_id}</div>
              <div className="text-[10px] text-foreground/80 mt-0.5">
                {s.entity_id as string}
                {typeof s.last_activated === 'string' && ` · Letzt. Aktivierung: ${new Date(s.last_activated).toLocaleString('de-DE')}`}
              </div>
            </div>
            <Play size={16} className="text-accent/80 flex-shrink-0" />
          </div>
        </AdminCard>
      ))}
    </div>
  )
}

// ── Backups Tab ────────────────────────────────────────────────

function BackupsTab({ token }: { token: string }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    cachedFetch('/api/admin/ha/backups', token)
      .then(d => setData(d as Record<string, unknown>))
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const backups = (data?.backups ?? []) as Array<Record<string, unknown>>
  const available = data?.backups_available as boolean

  return (
    <div className="space-y-3">
      <AdminCard>
        <div className="flex items-center gap-2">
          <Archive size={16} className="text-accent" />
          <span className="text-sm font-medium text-foreground">
            {available ? `${backups.length} Backup${backups.length !== 1 ? 's' : ''}` : 'Backups nicht verfügbar'}
          </span>
        </div>
        {!available && <div className="text-xs text-foreground/80 mt-2">{data?.note as string}</div>}
      </AdminCard>
      {backups.map((b, i) => (
        <AdminCard key={i}>
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{(b.name as string) ?? `Backup ${i + 1}`}</div>
              <div className="text-[10px] text-foreground/80 mt-0.5">
                {b.slug as string}
                {typeof b.date === 'string' && ` · ${new Date(b.date).toLocaleString('de-DE')}`}
                {typeof b.size === 'number' && ` · ${((b.size as number) / 1024 / 1024).toFixed(1)} MB`}
              </div>
            </div>
            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
              b.type === 'full' ? 'bg-accent/20 text-accent' : 'bg-foreground/10 text-foreground'
            }`}>
              {b.type === 'full' ? 'Voll' : 'Teilweise'}
            </span>
          </div>
        </AdminCard>
      ))}
    </div>
  )
}

// ── Network Tab ────────────────────────────────────────────────

function NetworkTab({ token }: { token: string }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    cachedFetch('/api/admin/ha/network', token)
      .then(d => setData(d as Record<string, unknown>))
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const networkAvailable = data?.network_available as boolean
  const info = data?.info as Record<string, unknown> | undefined
  const connectivity = data?.connectivity as Record<string, unknown> | undefined

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <AdminCard title="Netzwerkstatus" icon={Globe}>
        {networkAvailable && info ? (
          <>
            {Object.entries(info).filter(([k]) => typeof info[k] !== 'object').slice(0, 10).map(([k, v]) => (
              <StatItem key={k} label={k} value={String(v)} />
            ))}
          </>
        ) : (
          <>
            <div className="text-xs text-foreground/80 mb-2">{data?.note as string}</div>
            {connectivity && (
              <>
                <StatItem label="HA REST API" value={connectivity.ha_rest_api ? '✓ Verbunden' : '✗ Getrennt'} />
                <StatItem label="HA WebSocket" value={connectivity.ha_websocket ? '✓ Verbunden' : '✗ Getrennt'} />
              </>
            )}
          </>
        )}
      </AdminCard>

      {networkAvailable && info && Array.isArray(info.interfaces) && (
        <AdminCard title="Netzwerk-Interfaces" icon={WifiHigh}>
          <div className="space-y-2">
            {(info.interfaces as Array<Record<string, unknown>>).map((iface, i) => (
              <div key={i} className="p-2 rounded-lg bg-foreground/5">
                <div className="text-xs font-medium text-foreground">{String(iface.interface ?? `Interface ${i}`)}</div>
                {iface.ip_address != null && <div className="text-[10px] text-foreground/80 mt-0.5">IP: {String(iface.ip_address)}</div>}
                {iface.type != null && <div className="text-[10px] text-foreground/80">Typ: {String(iface.type)}</div>}
                {typeof iface.enabled === 'boolean' && (
                  <span className={`inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                    iface.enabled ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'
                  }`}>
                    {iface.enabled ? 'Aktiv' : 'Inaktiv'}
                  </span>
                )}
              </div>
            ))}
          </div>
        </AdminCard>
      )}
    </div>
  )
}

// ── Logs Tab ──────────────────────────────────────────────────

interface IoraLogEntry {
  id: number
  timestamp: string
  level: string
  target: string
  message: string
  fields?: Record<string, unknown>
}

function LogsTab({ token }: { token: string }) {
  const [logs, setLogs] = useState<IoraLogEntry[]>([])
  const [haLogs, setHaLogs] = useState<Array<{ line: string; severity: string }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<'all' | 'error' | 'warn' | 'info' | 'debug'>('all')
  const [search, setSearch] = useState('')
  const [targetFilter, setTargetFilter] = useState('')
  const [liveMode, setLiveMode] = useState(false)
  const [activeView, setActiveView] = useState<'iora' | 'ha'>('iora')
  const [autoScroll, setAutoScroll] = useState(true)
  const logContainerRef = { current: null as HTMLDivElement | null }

  // Load initial logs
  const load = useCallback(async () => {
    setError('')
    try {
      const [ioraData, haData] = await Promise.all([
        adminFetch('/api/admin/logs?limit=500' +
          (filter !== 'all' ? `&level=${filter}` : '') +
          (targetFilter ? `&target=${encodeURIComponent(targetFilter)}` : '') +
          (search ? `&search=${encodeURIComponent(search)}` : ''), token),
        adminFetch('/api/admin/ha/logs', token).catch(() => ({ log: [] })),
      ])
      setLogs((ioraData.entries ?? []) as IoraLogEntry[])
      setHaLogs(haData.log ?? [])
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }, [token, filter, targetFilter, search])

  useEffect(() => { load() }, [load])

  // Live SSE mode
  useEffect(() => {
    if (!liveMode || activeView !== 'iora') return
    const es = new EventSource(`${backendBase()}/api/admin/logs/live${token ? `?token=${encodeURIComponent(token)}` : ''}`)
    es.addEventListener('log', (e) => {
      try {
        const entry = JSON.parse((e as MessageEvent).data) as IoraLogEntry
        setLogs(prev => {
          const next = [entry, ...prev]
          return next.length > 1000 ? next.slice(0, 1000) : next
        })
      } catch { /* skip */ }
    })
    es.addEventListener('warning', (e) => {
      try {
        const d = JSON.parse((e as MessageEvent).data)
        setError(d.message || 'Missed events')
      } catch { /* skip */ }
    })
    es.onerror = () => setLiveMode(false)
    return () => es.close()
  }, [liveMode, activeView])

  const clearLogs = async () => {
    try {
      await adminFetch('/api/admin/logs/clear', token, { method: 'POST' })
      setLogs([])
    } catch (e) { notifyError(e) }
  }

  if (loading) return <LoadingSpinner />
  if (error && logs.length === 0) return <ErrorMessage>{error}</ErrorMessage>

  // Filter displayed logs client-side for live mode
  const displayed = liveMode ? logs.filter(e => {
    if (filter !== 'all' && e.level !== filter) return false
    if (targetFilter && !e.target.includes(targetFilter)) return false
    if (search && !e.message.toLowerCase().includes(search.toLowerCase()) && !e.target.toLowerCase().includes(search.toLowerCase())) return false
    return true
  }) : logs

  const errorCount = logs.filter(e => e.level === 'error').length
  const warnCount = logs.filter(e => e.level === 'warn').length
  const infoCount = logs.filter(e => e.level === 'info').length

  // Get unique targets for quick filter
  const uniqueTargets = [...new Set(logs.map(e => e.target.split('::')[0]).filter(Boolean))].slice(0, 20)

  return (
    <div className="space-y-3">
      {/* View toggle + controls */}
      <AdminCard>
        <div className="flex justify-between items-center flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg bg-foreground/5 p-0.5">
              <button onClick={() => setActiveView('iora')} className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${activeView === 'iora' ? 'bg-accent/20 text-accent' : 'text-foreground/60 hover:text-foreground/80'}`}>
                IORA System
              </button>
              <button onClick={() => setActiveView('ha')} className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${activeView === 'ha' ? 'bg-accent/20 text-accent' : 'text-foreground/60 hover:text-foreground/80'}`}>
                Home Assistant
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {activeView === 'iora' && (
              <>
                <button onClick={() => setLiveMode(!liveMode)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    liveMode ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/10'
                  }`}>
                  <Broadcast size={12} weight={liveMode ? 'fill' : 'regular'} />
                  {liveMode ? 'Live' : 'Live'}
                </button>
                <Tip content="Log-Buffer leeren">
                  <button onClick={clearLogs} className="p-1.5 rounded-lg text-foreground/50 hover:text-red-400 hover:bg-red-500/10 transition">
                    <Trash size={14} />
                  </button>
                </Tip>
              </>
            )}
            <button onClick={load} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-foreground/70 hover:text-accent hover:bg-accent/10 transition">
              <ArrowClockwise size={12} /> Refresh
            </button>
          </div>
        </div>
      </AdminCard>

      {activeView === 'iora' && (
        <>
          {/* Stats & Filters */}
          <AdminCard>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <button onClick={() => setFilter('all')} className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition ${filter === 'all' ? 'bg-accent/20 text-accent' : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/10'}`}>
                  Alle ({logs.length})
                </button>
                <button onClick={() => setFilter('error')} className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition ${filter === 'error' ? 'bg-red-500/20 text-red-400' : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/10'}`}>
                  Error ({errorCount})
                </button>
                <button onClick={() => setFilter('warn')} className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition ${filter === 'warn' ? 'bg-amber-500/20 text-amber-400' : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/10'}`}>
                  Warn ({warnCount})
                </button>
                <button onClick={() => setFilter('info')} className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition ${filter === 'info' ? 'bg-blue-500/20 text-blue-400' : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/10'}`}>
                  Info ({infoCount})
                </button>
                <button onClick={() => setFilter('debug')} className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition ${filter === 'debug' ? 'bg-purple-500/20 text-purple-400' : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/10'}`}>
                  Debug
                </button>
                <span className="text-[10px] text-foreground/30 mx-1">|</span>
                {uniqueTargets.slice(0, 8).map(t => (
                  <button key={t} onClick={() => setTargetFilter(targetFilter === t ? '' : t)}
                    className={`px-1.5 py-0.5 rounded text-[9px] font-mono transition ${targetFilter === t ? 'bg-accent/20 text-accent' : 'bg-foreground/5 text-foreground/50 hover:bg-foreground/10'}`}>
                    {t}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <MagnifyingGlass size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-foreground/40" />
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Logs durchsuchen..."
                    className="w-full pl-7 pr-2 py-1.5 rounded-lg bg-foreground/5 border border-foreground/10 text-[11px] text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-accent/50 font-mono" />
                </div>
                {liveMode && (
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                    <span className="text-[10px] text-green-400 font-medium">Live-Stream aktiv</span>
                  </div>
                )}
              </div>
            </div>
          </AdminCard>

          {/* IORA Log Entries */}
          <AdminCard>
            <div ref={el => { logContainerRef.current = el }} className="max-h-[600px] overflow-y-auto font-mono text-[10px] leading-relaxed space-y-0.5">
              {displayed.length === 0 ? (
                <div className="text-foreground/50 text-center py-8">Keine Log-Einträge gefunden.</div>
              ) : displayed.map(entry => (
                <div key={entry.id} className={`group py-1 px-2 rounded flex items-start gap-2 hover:bg-foreground/5 transition-colors ${
                  entry.level === 'error' ? 'bg-red-500/5' :
                  entry.level === 'warn' ? 'bg-amber-500/3' : ''
                }`}>
                  <span className="text-foreground/30 shrink-0 w-[58px]">{entry.timestamp.split('T')[1]?.slice(0, 12) || ''}</span>
                  <span className={`shrink-0 w-[42px] font-semibold uppercase ${
                    entry.level === 'error' ? 'text-red-400' :
                    entry.level === 'warn' ? 'text-amber-400' :
                    entry.level === 'info' ? 'text-blue-400' :
                    entry.level === 'debug' ? 'text-purple-400' :
                    'text-foreground/40'
                  }`}>{entry.level}</span>
                  <span className="text-accent/60 shrink-0 max-w-[180px] truncate">{entry.target}</span>
                  <span className={`flex-1 ${
                    entry.level === 'error' ? 'text-red-300/90' :
                    entry.level === 'warn' ? 'text-amber-300/80' :
                    'text-foreground/70'
                  }`}>{entry.message}</span>
                  {entry.fields && (
                    <span className="text-foreground/25 truncate max-w-[200px] opacity-0 group-hover:opacity-100 transition-opacity">
                      {JSON.stringify(entry.fields)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </AdminCard>
        </>
      )}

      {activeView === 'ha' && (
        <>
          <AdminCard>
            <div className="max-h-[500px] overflow-y-auto font-mono text-[10px] leading-relaxed space-y-0.5">
              {haLogs.length === 0 ? (
                <div className="text-foreground/50 text-center py-6">Keine HA-Logs verfügbar.</div>
              ) : haLogs.map((entry, i) => (
                <div key={i} className={`py-0.5 px-1.5 rounded ${
                  entry.severity === 'error' ? 'text-red-400/90 bg-red-500/5' :
                  entry.severity === 'warning' ? 'text-amber-400/80 bg-amber-500/5' :
                  entry.severity === 'info' ? 'text-blue-400/70' :
                  'text-foreground/70'
                }`}>
                  {entry.line}
                </div>
              ))}
            </div>
          </AdminCard>
        </>
      )}
    </div>
  )
}

// ── Database Tab ──────────────────────────────────────────────

function DatabaseTab({ token }: { token: string }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tempUsers, setTempUsers] = useState<Array<{id:string;username:string;description:string;permissions:string;expires_at:string;revoked:boolean;last_used_at:string|null}>>([])
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newUser, setNewUser] = useState({ username: '', password: '', description: '', permissions: 'readonly', expires_in_days: 7 })
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [dbInfo, usersRes] = await Promise.all([
        cachedFetch('/api/admin/system/database', token),
        adminFetch('/api/admin/system/database/temp-users', token),
      ])
      setData(dbInfo as Record<string, unknown>)
      setTempUsers((usersRes as {users:typeof tempUsers}).users ?? [])
    } catch (e) {
      setError((e as Error).message)
    }
    setLoading(false)
  }, [token])

  useEffect(() => { loadData() }, [loadData])

  const handleCreateUser = async () => {
    setCreating(true)
    setCreateError('')
    try {
      await adminFetch('/api/admin/system/database/temp-users', token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newUser),
      })
      setShowCreateForm(false)
      setNewUser({ username: '', password: '', description: '', permissions: 'readonly', expires_in_days: 7 })
      loadData()
    } catch (e) {
      setCreateError((e as Error).message)
    }
    setCreating(false)
  }

  const handleRevokeUser = async (id: string) => {
    try {
      await adminFetch(`/api/admin/system/database/temp-users/${id}`, token, { method: 'DELETE' })
      loadData()
    } catch (e) { notifyError(e) }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>
  if (!data) return <ErrorMessage>Datenbankinfo nicht verfügbar.</ErrorMessage>

  const tables = data.tables as Record<string, number> | undefined
  const tableSizes = data.table_sizes as Array<{name:string;size_bytes:number;size_mb:number}> | undefined
  const formatTime = (t?: string | null) => {
    if (!t) return '–'
    try { return new Date(t).toLocaleString('de-DE') } catch { return t }
  }

  return (
    <div className="space-y-4">
      {/* Database Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <AdminCard title="Datenbank-Übersicht" icon={Database}>
          <StatItem label="Engine" value={String(data.engine ?? 'PostgreSQL')} />
          <StatItem label="Version" value={String(data.version ?? '–')} />
          <StatItem label="Datenbank" value={String(data.database_name ?? '–')} />
          <StatItem label="Host" value={String(data.host ?? '–')} />
          <StatItem label="Größe" value={`${data.size_mb} MB`} />
          <StatItem label="Betriebszeit" value={String(data.uptime ?? '–')} />
        </AdminCard>

        <AdminCard title="Verbindungen" icon={Pulse}>
          <StatItem label="Aktive Verbindungen" value={String(data.active_connections ?? 0)} />
          <StatItem label="Max. Verbindungen" value={String(data.max_connections ?? '–')} />
          <StatItem label="Temp-Benutzer aktiv" value={String(data.temp_db_users_active ?? 0)} />
        </AdminCard>

        {tables && (
          <AdminCard title="Tabellen (Zeilen)" icon={ListBullets}>
            {Object.entries(tables).map(([table, count]) => (
              <StatItem key={table} label={table} value={count.toLocaleString('de-DE')} />
            ))}
          </AdminCard>
        )}
      </div>

      {/* Table Sizes */}
      {tableSizes && tableSizes.length > 0 && (
        <AdminCard title="Tabellen-Größen" icon={HardDrive}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
            {tableSizes.map(t => (
              <StatItem key={t.name} label={t.name} value={t.size_mb >= 1 ? `${t.size_mb} MB` : `${(t.size_bytes / 1024).toFixed(1)} KB`} />
            ))}
          </div>
        </AdminCard>
      )}

      {/* Temp DB Users */}
      <AdminCard title="Temporäre Datenbank-Benutzer" icon={Key}>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-foreground/50">Temporäre Zugangsbenutzer mit Ablaufdatum (max. 1 Monat)</p>
            <button
              onClick={() => setShowCreateForm(!showCreateForm)}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-accent/20 text-accent hover:bg-accent/30 transition-colors"
            >
              <Plus size={14} /> Erstellen
            </button>
          </div>

          {showCreateForm && (
            <div className="p-3 rounded-lg bg-foreground/5 border border-foreground/10 space-y-2">
              {createError && <p className="text-xs text-red-400">{createError}</p>}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="Benutzername (a-z, 0-9, _)"
                  value={newUser.username}
                  onChange={e => setNewUser(u => ({ ...u, username: e.target.value }))}
                  className="px-2 py-1.5 text-xs rounded-lg bg-foreground/5 border border-foreground/10 text-foreground placeholder:text-foreground/30"
                />
                <input
                  type="password"
                  placeholder="Passwort (min. 8 Zeichen)"
                  value={newUser.password}
                  onChange={e => setNewUser(u => ({ ...u, password: e.target.value }))}
                  className="px-2 py-1.5 text-xs rounded-lg bg-foreground/5 border border-foreground/10 text-foreground placeholder:text-foreground/30"
                />
                <input
                  type="text"
                  placeholder="Beschreibung (optional)"
                  value={newUser.description}
                  onChange={e => setNewUser(u => ({ ...u, description: e.target.value }))}
                  className="px-2 py-1.5 text-xs rounded-lg bg-foreground/5 border border-foreground/10 text-foreground placeholder:text-foreground/30"
                />
                <select
                  value={newUser.permissions}
                  onChange={e => setNewUser(u => ({ ...u, permissions: e.target.value }))}
                  className="px-2 py-1.5 text-xs rounded-lg bg-foreground/5 border border-foreground/10 text-foreground"
                >
                  <option value="readonly">Nur Lesen</option>
                  <option value="readwrite">Lesen & Schreiben</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-foreground/60">Ablauf in Tagen:</label>
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={newUser.expires_in_days}
                  onChange={e => setNewUser(u => ({ ...u, expires_in_days: Math.min(31, Math.max(1, +e.target.value)) }))}
                  className="w-16 px-2 py-1 text-xs rounded-lg bg-foreground/5 border border-foreground/10 text-foreground"
                />
                <button
                  onClick={handleCreateUser}
                  disabled={creating || !newUser.username || !newUser.password}
                  className="ml-auto px-3 py-1.5 text-xs rounded-lg bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-50 transition-colors"
                >
                  {creating ? 'Erstelle...' : 'Erstellen'}
                </button>
                <button
                  onClick={() => setShowCreateForm(false)}
                  className="px-2 py-1.5 text-xs rounded-lg text-foreground/60 hover:text-foreground/80"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          )}

          {tempUsers.length === 0 && !showCreateForm && (
            <p className="text-xs text-foreground/40 text-center py-2">Keine temporären Benutzer vorhanden.</p>
          )}

          {tempUsers.map(u => (
            <div
              key={u.id}
              className={`flex items-center justify-between p-2 rounded-lg ${u.revoked ? 'bg-red-500/5 border border-red-500/10' : 'bg-foreground/5 border border-foreground/10'}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-foreground">{u.username}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${u.permissions === 'readwrite' ? 'bg-amber-500/10 text-amber-400' : 'bg-blue-500/10 text-blue-400'}`}>
                    {u.permissions === 'readwrite' ? 'Lesen & Schreiben' : 'Nur Lesen'}
                  </span>
                  {u.revoked && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400">Widerrufen</span>}
                </div>
                {u.description && <p className="text-[10px] text-foreground/40 mt-0.5">{u.description}</p>}
                <div className="flex gap-3 text-[10px] text-foreground/40 mt-0.5">
                  <span>Ablauf: {formatTime(u.expires_at)}</span>
                  {u.last_used_at && <span>Zuletzt: {formatTime(u.last_used_at)}</span>}
                </div>
              </div>
              {!u.revoked && (
                <button
                  onClick={() => handleRevokeUser(u.id)}
                  className="ml-2 p-1.5 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                  title="Widerrufen"
                >
                  <UserMinus size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      </AdminCard>
    </div>
  )
}

// ── System Notifications Tab ──────────────────────────────────────────

interface SystemNotification {
  id: string
  category: string
  severity: string
  title: string
  message: string
  details?: Record<string, unknown>
  source: string
  acknowledged: boolean
  acknowledged_by?: string
  acknowledged_at?: string
  resolved: boolean
  resolved_at?: string
  created_at: string
}

interface SyncEntityStatus {
  entity_id: string
  friendly_name: string
  last_sync_at?: string
  oldest_data_at?: string
  newest_data_at?: string
  total_points: number
  sync_state: string
  last_error?: string
  updated_at: string
}

function SystemNotificationsTab({ token }: { token: string }) {
  const [notifications, setNotifications] = useState<SystemNotification[]>([])
  const [syncStatus, setSyncStatus] = useState<{ entities: SyncEntityStatus[]; total_points: number; oldest_data?: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showResolved, setShowResolved] = useState(false)
  const [activeSection, setActiveSection] = useState<'notifications' | 'sync'>('notifications')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [notifs, sync] = await Promise.all([
        adminFetch(`/api/admin/system-notifications?show_resolved=${showResolved}`, token),
        adminFetch('/api/admin/location-sync/status', token),
      ])
      setNotifications(notifs as SystemNotification[])
      setSyncStatus(sync as { entities: SyncEntityStatus[]; total_points: number; oldest_data?: string })
    } catch (e) {
      setError((e as Error).message)
    }
    setLoading(false)
  }, [token, showResolved])

  useEffect(() => { load() }, [load])

  const handleAcknowledge = async (id: string) => {
    try {
      await adminFetch(`/api/admin/system-notifications/${id}/acknowledge`, token, { method: 'PUT' })
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, acknowledged: true } : n))
    } catch (e) { notifyError(e) }
  }

  const handleResolve = async (id: string) => {
    try {
      await adminFetch(`/api/admin/system-notifications/${id}/resolve`, token, { method: 'PUT' })
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, resolved: true } : n))
    } catch (e) { notifyError(e) }
  }

  const handleDelete = async (id: string) => {
    try {
      await adminFetch(`/api/admin/system-notifications/${id}`, token, { method: 'DELETE' })
      setNotifications(prev => prev.filter(n => n.id !== id))
    } catch (e) { notifyError(e) }
  }

  const handleClearResolved = async () => {
    try {
      await adminFetch('/api/admin/system-notifications/clear-resolved', token, { method: 'DELETE' })
      load()
    } catch (e) { notifyError(e) }
  }

  const handleForceSync = async (entityId: string) => {
    try {
      await adminFetch(`/api/admin/location-sync/${encodeURIComponent(entityId)}/force-sync`, token, { method: 'POST' })
      load()
    } catch (e) { notifyError(e) }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const severityColor = (s: string) => {
    switch (s) {
      case 'critical': return 'text-red-400 bg-red-500/10'
      case 'warning': return 'text-amber-400 bg-amber-500/10'
      case 'info': return 'text-blue-400 bg-blue-500/10'
      default: return 'text-foreground/60 bg-foreground/5'
    }
  }

  const syncStateColor = (s: string) => {
    switch (s) {
      case 'synced': return 'text-green-400'
      case 'syncing': return 'text-blue-400'
      case 'error': return 'text-red-400'
      case 'pending': return 'text-amber-400'
      default: return 'text-foreground/60'
    }
  }

  const formatTime = (t?: string) => {
    if (!t) return '–'
    try { return new Date(t).toLocaleString('de-DE') } catch { return t }
  }

  return (
    <div className="space-y-4">
      {/* Section Toggle */}
      <div className="flex gap-2">
        <button
          onClick={() => setActiveSection('notifications')}
          className={`px-3 py-1.5 text-xs rounded-lg transition-all ${
            activeSection === 'notifications'
              ? 'bg-accent/20 text-accent font-semibold'
              : 'text-foreground/60 hover:text-foreground/80'
          }`}
        >
          <Siren size={14} className="inline mr-1" />
          Meldungen ({notifications.length})
        </button>
        <button
          onClick={() => setActiveSection('sync')}
          className={`px-3 py-1.5 text-xs rounded-lg transition-all ${
            activeSection === 'sync'
              ? 'bg-accent/20 text-accent font-semibold'
              : 'text-foreground/60 hover:text-foreground/80'
          }`}
        >
          <ArrowClockwise size={14} className="inline mr-1" />
          Standort-Sync ({syncStatus?.entities.length ?? 0})
        </button>
      </div>

      {/* Notifications Section */}
      {activeSection === 'notifications' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowResolved(!showResolved)}
                className="flex items-center gap-1 text-xs text-foreground/60 hover:text-foreground/80"
              >
                {showResolved ? <ToggleRight size={16} className="text-accent" /> : <ToggleLeft size={16} />}
                Erledigte anzeigen
              </button>
            </div>
            <div className="flex gap-2">
              {showResolved && (
                <button
                  onClick={handleClearResolved}
                  className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300"
                >
                  <Trash size={12} />
                  Erledigte löschen
                </button>
              )}
              <button onClick={load} className="flex items-center gap-1 text-xs text-foreground/60 hover:text-foreground/80">
                <ArrowClockwise size={12} />
                Aktualisieren
              </button>
            </div>
          </div>

          {notifications.length === 0 ? (
            <AdminCard>
              <div className="text-center py-6 text-foreground/40 text-sm">
                <CheckCircle size={24} className="mx-auto mb-2 text-green-400" />
                Keine offenen Systemmeldungen
              </div>
            </AdminCard>
          ) : (
            <div className="space-y-2">
              {notifications.map(n => (
                <AdminCard key={n.id} className={n.resolved ? 'opacity-50' : ''}>
                  <div className="flex items-start gap-3">
                    <div className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${severityColor(n.severity)}`}>
                      {n.severity}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-semibold text-foreground">{n.title}</span>
                        <span className="text-[10px] text-foreground/40">{n.category}</span>
                      </div>
                      <p className="text-xs text-foreground/70 mb-2">{n.message}</p>
                      {n.details && (
                        <div className="text-[10px] text-foreground/40 bg-foreground/5 rounded px-2 py-1 mb-2 font-mono">
                          {Object.entries(n.details).map(([k, v]) => (
                            <div key={k}>{k}: {String(v)}</div>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center gap-3 text-[10px] text-foreground/40">
                        <span>{formatTime(n.created_at)}</span>
                        <span>{n.source}</span>
                        {n.acknowledged && <span className="text-blue-400">Bestätigt{n.acknowledged_by ? ` von ${n.acknowledged_by}` : ''}</span>}
                        {n.resolved && <span className="text-green-400">Erledigt</span>}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {!n.acknowledged && (
                        <button onClick={() => handleAcknowledge(n.id)} className="p-1 rounded hover:bg-foreground/10" title="Bestätigen">
                          <Eye size={14} className="text-blue-400" />
                        </button>
                      )}
                      {!n.resolved && (
                        <button onClick={() => handleResolve(n.id)} className="p-1 rounded hover:bg-foreground/10" title="Als erledigt markieren">
                          <CheckCircle size={14} className="text-green-400" />
                        </button>
                      )}
                      <button onClick={() => handleDelete(n.id)} className="p-1 rounded hover:bg-foreground/10" title="Löschen">
                        <Trash size={14} className="text-red-400" />
                      </button>
                    </div>
                  </div>
                </AdminCard>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Sync Status Section */}
      {activeSection === 'sync' && syncStatus && (
        <div className="space-y-3">
          <AdminCard title="Übersicht" icon={Database}>
            <StatItem label="Gesamt-Datenpunkte" value={syncStatus.total_points.toLocaleString('de-DE')} />
            <StatItem label="Älteste Daten" value={formatTime(syncStatus.oldest_data)} />
            <StatItem label="Sync-Intervall" value="5 Minuten" />
            <StatItem label="Getrackte Entitäten" value={syncStatus.entities.length} />
          </AdminCard>

          {syncStatus.entities.length === 0 ? (
            <AdminCard>
              <div className="text-center py-6 text-foreground/40 text-sm">
                Noch keine Standort-Entitäten synchronisiert
              </div>
            </AdminCard>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {syncStatus.entities.map(e => (
                <AdminCard key={e.entity_id}>
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <div className="text-sm font-semibold text-foreground">{e.friendly_name || e.entity_id}</div>
                      <div className="text-[10px] text-foreground/40 font-mono">{e.entity_id}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold uppercase ${syncStateColor(e.sync_state)}`}>
                        {e.sync_state}
                      </span>
                      <button
                        onClick={() => handleForceSync(e.entity_id)}
                        className="p-1 rounded hover:bg-foreground/10" title="Sync erzwingen"
                      >
                        <ArrowClockwise size={14} className="text-accent" />
                      </button>
                    </div>
                  </div>
                  <StatItem label="Datenpunkte" value={e.total_points.toLocaleString('de-DE')} />
                  <StatItem label="Letzter Sync" value={formatTime(e.last_sync_at)} />
                  <StatItem label="Älteste Daten" value={formatTime(e.oldest_data_at)} />
                  <StatItem label="Neueste Daten" value={formatTime(e.newest_data_at)} />
                  {e.last_error && (
                    <div className="mt-2 text-[10px] text-red-400 bg-red-500/10 rounded px-2 py-1">
                      {e.last_error}
                    </div>
                  )}
                </AdminCard>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Utilities ──────────────────────────────────────────────────

export function LoadingSpinner() {
  return (
    <div className="rounded-2xl border border-foreground/[0.06] bg-background/60 backdrop-blur-xl p-12 flex flex-col items-center justify-center gap-3">
      <div className="w-8 h-8 border-[3px] border-accent/20 border-t-accent rounded-full animate-spin" />
      <p className="text-xs text-foreground/40">Lade…</p>
    </div>
  )
}

export function InlineSpinner({ size = 14, className = '' }: { size?: number; className?: string }) {
  return <div style={{ width: size, height: size }} className={`border-2 border-current/30 border-t-current rounded-full animate-spin shrink-0 ${className}`} />
}

export function ErrorMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-red-500/10 bg-red-500/[0.04] backdrop-blur-xl p-4">
      <div className="flex items-start gap-3 text-sm text-red-400">
        <Warning size={18} weight="fill" className="flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </div>
  )
}

function formatUptime(seconds: number | undefined): string {
  if (!seconds) return '–'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h ${mins}m`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

// ─── Warnings Tab ──────────────────────────────────────────────────────────────

interface WarningLogEntry {
  id: number
  entity_id: string
  title: string
  message: string
  level: string
  source: string
  started_at: string
  ended_at: string | null
  attributes: Record<string, unknown> | null
  acknowledged: boolean
}

function WarningsTab({ token }: { token: string }) {
  const [warnings, setWarnings] = useState<WarningLogEntry[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeOnly, setActiveOnly] = useState(false)
  const [page, setPage] = useState(0)
  const pageSize = 20

  const fetchWarnings = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        limit: String(pageSize),
        offset: String(page * pageSize),
      })
      if (activeOnly) params.set('active', 'true')
      const data = await adminFetch(`/api/admin/warnings/log?${params}`, token)
      setWarnings(data.warnings)
      setTotal(data.total)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unbekannter Fehler')
    } finally {
      setLoading(false)
    }
  }, [token, page, activeOnly])

  useEffect(() => { fetchWarnings() }, [fetchWarnings])

  const handleClearLog = async () => {
    if (!confirm('Alle Warnungsprotokolle unwiderruflich löschen?')) return
    try {
      await adminFetch('/api/admin/warnings/log', token, { method: 'DELETE' })
      setPage(0)
      fetchWarnings()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Fehler beim Löschen')
    }
  }

  const totalPages = Math.ceil(total / pageSize)

  const levelIcon = (level: string) => {
    switch (level) {
      case 'critical':
      case 'emergency': return <Siren size={16} weight="fill" className="text-red-400" />
      case 'severe': return <ShieldWarning size={16} weight="fill" className="text-orange-400" />
      case 'warning': return <CloudWarning size={16} weight="fill" className="text-yellow-400" />
      default: return <Warning size={16} weight="fill" className="text-blue-400" />
    }
  }

  const levelLabel = (level: string) => {
    const labels: Record<string, string> = {
      emergency: 'Notfall',
      critical: 'Kritisch',
      severe: 'Schwer',
      warning: 'Warnung',
      info: 'Info',
    }
    return labels[level] || level
  }

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  const formatDuration = (startIso: string, endIso: string | null) => {
    const start = new Date(startIso).getTime()
    const end = endIso ? new Date(endIso).getTime() : Date.now()
    const diffMs = end - start
    const mins = Math.floor(diffMs / 60000)
    const hours = Math.floor(mins / 60)
    const days = Math.floor(hours / 24)
    if (days > 0) return `${days}T ${hours % 24}h`
    if (hours > 0) return `${hours}h ${mins % 60}m`
    return `${mins}m`
  }

  // ── Test Warning State ──
  const [testLevel, setTestLevel] = useState<string>('warning')
  const [testHeadline, setTestHeadline] = useState('')
  const [testDescription, setTestDescription] = useState('')
  const [testSending, setTestSending] = useState(false)

  const sendTestWarning = async () => {
    setTestSending(true)
    try {
      await adminFetch('/api/admin/nina/test-warning', token, {
        method: 'POST',
        body: JSON.stringify({
          level: testLevel,
          headline: testHeadline || 'Test-Warnung',
          description: testDescription || 'Dies ist eine Testwarnung des NINA-Warnsystems.',
        }),
      })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Fehler beim Senden')
    } finally {
      setTestSending(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Test Warning Section */}
      <AdminCard>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Siren size={22} weight="duotone" className="text-red-400" />
            <div>
              <h3 className="text-sm font-semibold text-foreground/90">Testwarnung senden</h3>
              <p className="text-xs text-foreground/50">Sendet eine Testwarnung an alle verbundenen Geräte</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Level selector */}
            <div className="space-y-1.5">
              <label className="text-xs text-foreground/60 font-medium">Warnstufe</label>
              <div className="flex gap-1.5 flex-wrap">
                {([
                  { value: 'info', label: 'Info', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
                  { value: 'warning', label: 'Warnung', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
                  { value: 'critical', label: 'Kritisch', color: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
                  { value: 'emergency', label: 'Notfall', color: 'bg-red-500/20 text-red-400 border-red-500/30' },
                ] as const).map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setTestLevel(opt.value)}
                    className={`text-[11px] px-2.5 py-1.5 rounded-lg border transition-all font-medium ${
                      testLevel === opt.value
                        ? opt.color
                        : 'bg-foreground/[0.03] text-foreground/50 border-foreground/[0.06] hover:bg-foreground/[0.06] hover:text-foreground/70'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Headline */}
            <div className="space-y-1.5">
              <label className="text-xs text-foreground/60 font-medium">Überschrift</label>
              <input
                type="text"
                value={testHeadline}
                onChange={e => setTestHeadline(e.target.value)}
                placeholder="Test-Warnung"
                className={ccInput('text-xs px-3 py-2')}
              />
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label className="text-xs text-foreground/60 font-medium">Beschreibung</label>
            <textarea
              value={testDescription}
              onChange={e => setTestDescription(e.target.value)}
              placeholder="Dies ist eine Testwarnung des NINA-Warnsystems."
              rows={2}
              className={`${ccTextarea('text-xs px-3 py-2')} min-h-[60px]`}
            />
          </div>

          {/* Send button */}
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-foreground/40">Die Testwarnung wird nach 30 Sekunden automatisch entfernt.</p>
            <button
              onClick={sendTestWarning}
              disabled={testSending}
              className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {testSending ? (
                <ArrowClockwise size={14} className="animate-spin" />
              ) : (
                <Siren size={14} weight="fill" />
              )}
              Testwarnung senden
            </button>
          </div>
        </div>
      </AdminCard>

      {/* Header */}
      <AdminCard>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <ShieldWarning size={22} weight="duotone" className="text-accent" />
            <div>
              <h3 className="text-sm font-semibold text-foreground/90">Warnungsprotokoll</h3>
              <p className="text-xs text-foreground/50">{total} Einträge gesamt</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => { setActiveOnly(!activeOnly); setPage(0) }}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors ${
                activeOnly
                  ? 'bg-accent/20 text-accent border border-accent/30'
                  : 'bg-white/5 text-foreground/60 border border-white/10 hover:bg-white/10'
              }`}
            >
              {activeOnly ? <ToggleRight size={14} weight="fill" /> : <ToggleLeft size={14} />}
              Nur aktive
            </button>
            <button
              onClick={() => fetchWarnings()}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-white/5 text-foreground/60 border border-white/10 hover:bg-white/10 transition-colors"
            >
              <ArrowClockwise size={14} />
              Aktualisieren
            </button>
            <button
              onClick={handleClearLog}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
            >
              <Trash size={14} />
              Protokoll löschen
            </button>
          </div>
        </div>
      </AdminCard>

      {/* Content */}
      {loading ? (
        <LoadingSpinner />
      ) : error ? (
        <ErrorMessage>{error}</ErrorMessage>
      ) : warnings.length === 0 ? (
        <AdminCard>
          <div className="text-center py-8 text-foreground/40 text-sm">
            Keine Warnungen {activeOnly ? 'aktiv' : 'protokolliert'}
          </div>
        </AdminCard>
      ) : (
        <div className="space-y-2">
          {warnings.map(w => (
            <AdminCard key={w.id}>
              <div className="flex items-start gap-3">
                {/* Level icon */}
                <div className="flex-shrink-0 mt-0.5 w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center">
                  {levelIcon(w.level)}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-foreground/90 truncate">{w.title || w.entity_id}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                      w.level === 'critical' || w.level === 'emergency' ? 'bg-red-500/20 text-red-400' :
                      w.level === 'severe' ? 'bg-orange-500/20 text-orange-400' :
                      w.level === 'warning' ? 'bg-yellow-500/20 text-yellow-400' :
                      'bg-blue-500/20 text-blue-400'
                    }`}>
                      {levelLabel(w.level)}
                    </span>
                    {!w.ended_at && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400 font-medium animate-pulse">
                        Aktiv
                      </span>
                    )}
                  </div>
                  {w.message && (
                    <p className="text-xs text-foreground/50 mt-1 line-clamp-2">{w.message}</p>
                  )}
                  <div className="flex items-center gap-3 mt-2 text-[11px] text-foreground/40 flex-wrap">
                    {w.source && <span>Quelle: {w.source}</span>}
                    <span>Start: {formatDate(w.started_at)}</span>
                    {w.ended_at ? (
                      <span>Ende: {formatDate(w.ended_at)}</span>
                    ) : (
                      <span className="text-green-400/70">läuft noch</span>
                    )}
                    <span>Dauer: {formatDuration(w.started_at, w.ended_at)}</span>
                  </div>
                </div>
              </div>
            </AdminCard>
          ))}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-foreground/60 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                Zurück
              </button>
              <span className="text-xs text-foreground/50">
                Seite {page + 1} von {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-foreground/60 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                Weiter
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Webhooks Tab ──────────────────────────────────────────────────────────────

interface WebhookEntry {
  id: string
  name: string
  url: string
  events: string[]
  headers: Record<string, string>
  active: boolean
  created_at: string
  updated_at: string
  last_triggered_at: string | null
  trigger_count: number
  consecutive_failures: number
}

interface WebhookDelivery {
  id: number
  event_type: string
  payload: unknown
  status_code: number | null
  response_body: string | null
  duration_ms: number | null
  attempt: number
  success: boolean
  error: string | null
  created_at: string
}

function WebhooksTab({ token }: { token: string }) {
  const [webhooks, setWebhooks] = useState<WebhookEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', url: '', secret: '', events: '*' })
  const [testing, setTesting] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ success: boolean; status_code?: number; duration_ms?: number; error?: string } | null>(null)
  const [deliveryLog, setDeliveryLog] = useState<{ webhookId: string; deliveries: WebhookDelivery[] } | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const data = await adminFetch('/api/webhooks', token) as { webhooks: WebhookEntry[] }
      setWebhooks(data.webhooks || [])
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }, [token])

  useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    setActionLoading('create')
    try {
      const events = form.events.trim() === '*' ? ['*'] : form.events.split(',').map(s => s.trim()).filter(Boolean)
      await adminFetch('/api/webhooks', token, {
        method: 'POST',
        body: JSON.stringify({ name: form.name, url: form.url, secret: form.secret || undefined, events }),
      })
      setShowCreate(false)
      setForm({ name: '', url: '', secret: '', events: '*' })
      load()
    } catch (e) { notifyError(e) }
    finally { setActionLoading(null) }
  }

  const handleDelete = async (id: string) => {
    setActionLoading(`del-${id}`)
    try {
      await adminFetch(`/api/webhooks/${id}`, token, { method: 'DELETE' })
      load()
    } catch (e) { notifyError(e) }
    finally { setActionLoading(null) }
  }

  const handleToggle = async (id: string, active: boolean) => {
    setActionLoading(`tog-${id}`)
    try {
      await adminFetch(`/api/webhooks/${id}`, token, {
        method: 'PUT',
        body: JSON.stringify({ active: !active }),
      })
      load()
    } catch (e) { notifyError(e) }
    finally { setActionLoading(null) }
  }

  const handleTest = async (id: string) => {
    setTesting(id); setTestResult(null)
    try {
      const result = await adminFetch(`/api/webhooks/${id}/test`, token, { method: 'POST' })
      setTestResult(result as typeof testResult)
    } catch (e) { setTestResult({ success: false, error: (e as Error).message }) }
    setTesting(null)
  }

  const handleShowDeliveries = async (webhookId: string) => {
    if (deliveryLog?.webhookId === webhookId) { setDeliveryLog(null); return }
    setActionLoading(`dlv-${webhookId}`)
    try {
      const data = await adminFetch(`/api/webhooks/${webhookId}/deliveries?limit=20`, token) as { deliveries: WebhookDelivery[] }
      setDeliveryLog({ webhookId, deliveries: data.deliveries || [] })
    } catch (e) { notifyError(e) }
    finally { setActionLoading(null) }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  return (
    <div className="space-y-3">
      {/* Test result */}
      {testResult && (
        <AdminCard className={`border ${testResult.success ? 'border-green-500/30' : 'border-red-500/30'}`}>
          <div className="flex items-center gap-2">
            {testResult.success
              ? <CheckCircle size={16} weight="fill" className="text-green-400" />
              : <XCircle size={16} weight="fill" className="text-red-400" />}
            <div className="flex-1">
              <p className="text-xs font-semibold">{testResult.success ? 'Webhook Test erfolgreich' : 'Webhook Test fehlgeschlagen'}</p>
              <div className="flex gap-3 mt-0.5">
                {testResult.status_code && <span className="text-[10px] text-foreground/60">Status: {testResult.status_code}</span>}
                {testResult.duration_ms != null && <span className="text-[10px] text-foreground/60">{testResult.duration_ms}ms</span>}
                {testResult.error && <span className="text-[10px] text-red-400">{testResult.error}</span>}
              </div>
            </div>
            <button onClick={() => setTestResult(null)} className="p-1 rounded hover:bg-foreground/10"><X size={12} /></button>
          </div>
        </AdminCard>
      )}

      {/* Create */}
      <AdminCard>
        <div className="flex justify-between items-center">
          <span className="text-sm font-medium text-foreground">{webhooks.length} Webhook{webhooks.length !== 1 ? 's' : ''}</span>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-accent text-white shadow-md shadow-accent/25 hover:bg-accent/85 transition-all"
          >
            <Plus size={14} weight="bold" /> Neuer Webhook
          </button>
        </div>
      </AdminCard>

      {showCreate && (
        <AdminCard>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-foreground/80 mb-1 block">Name</label>
              <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="z.B. Discord Benachrichtigung"
                className="w-full bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent/30 text-foreground" />
            </div>
            <div>
              <label className="text-xs text-foreground/80 mb-1 block">URL</label>
              <input type="url" value={form.url} onChange={e => setForm({ ...form, url: e.target.value })}
                placeholder="https://example.com/webhook"
                className="w-full bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent/30 text-foreground" />
            </div>
            <div>
              <label className="text-xs text-foreground/80 mb-1 block">Secret (optional, für HMAC-SHA256 Signatur)</label>
              <input type="text" value={form.secret} onChange={e => setForm({ ...form, secret: e.target.value })}
                placeholder="Geheimes Token..."
                className="w-full bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent/30 text-foreground font-mono" />
            </div>
            <div>
              <label className="text-xs text-foreground/80 mb-1 block">Event-Filter (kommagetrennt, * = alle)</label>
              <input type="text" value={form.events} onChange={e => setForm({ ...form, events: e.target.value })}
                placeholder="* oder state_changed, domain.light"
                className="w-full bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent/30 text-foreground font-mono" />
              <p className="text-[10px] text-foreground/50 mt-1">Filter: *, state_changed, domain.light, light.wohnzimmer, state_changed.light.wohnzimmer</p>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowCreate(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-foreground/10 text-foreground hover:bg-foreground/20 transition-all">
                Abbrechen
              </button>
              <button onClick={handleCreate} disabled={!form.name.trim() || !form.url.trim() || actionLoading === 'create'}
                className="px-4 py-1.5 rounded-lg text-xs font-medium bg-accent text-white disabled:opacity-40 hover:bg-accent/80 transition-all flex items-center gap-1.5">
                {actionLoading === 'create' && <InlineSpinner size={12} />}
                Erstellen
              </button>
            </div>
          </div>
        </AdminCard>
      )}

      {/* Webhook list */}
      {webhooks.map(wh => (
        <AdminCard key={wh.id}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium truncate">{wh.name}</span>
                {wh.active
                  ? <span className="px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 text-[10px] font-semibold border border-green-500/20">Aktiv</span>
                  : <span className="px-1.5 py-0.5 rounded bg-red-500/15 text-red-300 text-[10px] font-semibold border border-red-500/20">Inaktiv</span>}
                {wh.consecutive_failures > 0 && (
                  <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 text-[10px] font-semibold border border-amber-500/20">
                    {wh.consecutive_failures} Fehler
                  </span>
                )}
              </div>
              <div className="text-[10px] text-foreground/60 mt-1 font-mono truncate">{wh.url}</div>
              <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                <span className="text-[10px] text-foreground/50">Events: {Array.isArray(wh.events) ? wh.events.join(', ') : '*'}</span>
                <span className="text-[10px] text-foreground/50">· {wh.trigger_count}× ausgelöst</span>
                {wh.last_triggered_at && <span className="text-[10px] text-foreground/50">· Letzt.: {new Date(wh.last_triggered_at).toLocaleString('de-DE')}</span>}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Tip content="Test senden">
                <button onClick={() => handleTest(wh.id)} disabled={testing === wh.id}
                  className="p-2 rounded-lg text-foreground/60 hover:text-accent hover:bg-accent/10 transition-all disabled:opacity-40">
                  {testing === wh.id ? <ArrowClockwise size={14} className="animate-spin" /> : <PaperPlaneTilt size={14} />}
                </button>
              </Tip>
              <Tip content="Zustellungen anzeigen">
                <button onClick={() => handleShowDeliveries(wh.id)}
                  disabled={actionLoading === `dlv-${wh.id}`}
                  className={`p-2 rounded-lg transition-all disabled:opacity-40 ${deliveryLog?.webhookId === wh.id ? 'text-accent bg-accent/10' : 'text-foreground/60 hover:text-foreground hover:bg-foreground/10'}`}>
                  {actionLoading === `dlv-${wh.id}` ? <InlineSpinner size={14} /> : <Eye size={14} />}
                </button>
              </Tip>
              <Tip content={wh.active ? 'Deaktivieren' : 'Aktivieren'}>
                <button onClick={() => handleToggle(wh.id, wh.active)}
                  disabled={actionLoading === `tog-${wh.id}`}
                  className="p-2 rounded-lg text-foreground/60 hover:text-foreground hover:bg-foreground/10 transition-all disabled:opacity-40">
                  {actionLoading === `tog-${wh.id}` ? <InlineSpinner size={14} /> : (wh.active ? <ToggleRight size={14} weight="fill" className="text-green-400" /> : <ToggleLeft size={14} />)}
                </button>
              </Tip>
              <button onClick={() => handleDelete(wh.id)}
                disabled={actionLoading === `del-${wh.id}`}
                className="p-2 rounded-lg text-foreground/60 hover:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-40">
                {actionLoading === `del-${wh.id}` ? <InlineSpinner size={14} /> : <Trash size={14} />}
              </button>
            </div>
          </div>

          {/* Delivery log */}
          {deliveryLog?.webhookId === wh.id && (
            <div className="mt-3 pt-3 border-t border-foreground/8">
              <p className="text-xs font-semibold text-foreground/70 mb-2">Letzte Zustellungen</p>
              {deliveryLog.deliveries.length === 0 ? (
                <p className="text-xs text-foreground/50">Noch keine Zustellungen.</p>
              ) : (
                <div className="space-y-1.5 max-h-60 overflow-y-auto">
                  {deliveryLog.deliveries.map(d => (
                    <div key={d.id} className="flex items-center gap-2 py-1.5 px-2 rounded-lg bg-foreground/3">
                      {d.success
                        ? <CheckCircle size={12} weight="fill" className="text-green-400 shrink-0" />
                        : <XCircle size={12} weight="fill" className="text-red-400 shrink-0" />}
                      <span className="text-[10px] text-foreground/60 font-mono">{d.status_code ?? '–'}</span>
                      <span className="text-[10px] text-foreground/50 truncate flex-1">{d.event_type}</span>
                      {d.duration_ms != null && <span className="text-[10px] text-foreground/40">{d.duration_ms}ms</span>}
                      <span className="text-[10px] text-foreground/40">{new Date(d.created_at).toLocaleString('de-DE')}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </AdminCard>
      ))}

      {webhooks.length === 0 && !showCreate && (
        <AdminCard>
          <div className="text-center py-6">
            <WebhooksLogo size={32} className="text-foreground/20 mx-auto mb-2" />
            <p className="text-sm text-foreground/50">Keine Webhooks registriert.</p>
            <p className="text-xs text-foreground/35 mt-1">Webhooks senden HTTP POST-Anfragen bei Entity-Ereignissen an deine Endpunkte.</p>
          </div>
        </AdminCard>
      )}

      {/* Info card */}
      <AdminCard title="Webhook-Dokumentation" icon={Lightning}>
        <div className="space-y-2 text-xs text-foreground/60">
          <p>Webhooks senden automatisch <strong className="text-foreground/80">HTTP POST</strong> Anfragen mit JSON-Payload wenn sich Entity-Zustände ändern.</p>
          <div className="bg-foreground/5 rounded-lg p-3 font-mono text-[10px] text-foreground/50 overflow-x-auto">
            <pre>{`POST ${'{'}webhook_url{'}'}\nContent-Type: application/json\nX-Webhook-Signature: sha256=...\n\n{\n  "event": "state_changed",\n  "timestamp": "2025-01-01T12:00:00Z",\n  "data": {\n    "entity_id": "light.wohnzimmer",\n    "state": "on",\n    "attributes": {...}\n  }\n}`}</pre>
          </div>
          <p><strong className="text-foreground/80">Event-Filter:</strong> <code className="bg-foreground/10 px-1 rounded">*</code> (alle), <code className="bg-foreground/10 px-1 rounded">state_changed</code>, <code className="bg-foreground/10 px-1 rounded">domain.light</code>, <code className="bg-foreground/10 px-1 rounded">light.wohnzimmer</code></p>
          <p><strong className="text-foreground/80">Sicherheit:</strong> Bei gesetztem Secret wird ein <code className="bg-foreground/10 px-1 rounded">X-Webhook-Signature</code> Header mit HMAC-SHA256 Signatur mitgesendet.</p>
          <p><strong className="text-foreground/80">Auto-Deaktivierung:</strong> Nach 10 aufeinanderfolgenden Fehlern wird der Webhook automatisch deaktiviert.</p>
        </div>
      </AdminCard>
    </div>
  )
}

// ─── Realtime Tab ──────────────────────────────────────────────────────────────

interface MetricsSnapshot {
  timestamp: string
  uptime_seconds: number
  http: { requests_total: number; errors_total: number }
  websocket: { messages_sent: number; messages_received: number }
  entities: { state_changes: number }
  services: { calls_total: number }
  ha_websocket: { reconnects: number }
  tasks: { runs_total: number; errors_total: number }
  logs: { error_count: number; warn_count: number; info_count: number; buffer_size: number }
  sse: { active_connections: number }
  cache: { hits: number; misses: number }
  live?: { entity_count: number; connected_clients: number; ha_connected: boolean; entity_updates_total?: number }
  task_breakdown?: Array<{ id: number; name: string; runs: number; errors: number; enabled: boolean }>
}

function RealtimeTab({ token }: { token: string }) {
  const { t } = useTranslation()
  const [activeSection, setActiveSection] = useState<'metrics' | 'sse' | 'ws'>('metrics')

  // ── Metrics state ──
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null)
  const [metricsHistory, setMetricsHistory] = useState<MetricsSnapshot[]>([])
  const [metricsLive, setMetricsLive] = useState(false)
  const [metricsLoading, setMetricsLoading] = useState(true)

  // ── SSE state ──
  const [sseConnected, setSseConnected] = useState(false)
  const [sseEvents, setSseEvents] = useState<{ id: number; type: string; data: string; time: string }[]>([])
  const [wsConnected, setWsConnected] = useState(false)
  const [wsEvents, setWsEvents] = useState<{ id: number; ns: string; event: string; data: string; time: string }[]>([])
  const [sseSource, setSseSource] = useState<EventSource | null>(null)
  const [wsSocket, setWsSocket] = useState<WebSocket | null>(null)
  const [sseFilter, setSseFilter] = useState('')
  const [wsNamespace, setWsNamespace] = useState('entities')
  const [wsDomainFilter, setWsDomainFilter] = useState('')
  const [eventIdCounter, setEventIdCounter] = useState(0)

  const nextId = useCallback(() => {
    setEventIdCounter(c => c + 1)
    return eventIdCounter + 1
  }, [eventIdCounter])

  // ── Metrics: initial load ──
  useEffect(() => {
    adminFetch('/api/admin/metrics', token)
      .then((data: MetricsSnapshot) => { setMetrics(data); setMetricsLoading(false) })
      .catch(() => setMetricsLoading(false))
  }, [token])

  // ── Metrics: live SSE stream ──
  useEffect(() => {
    if (!metricsLive) return
    const es = new EventSource(`${backendBase()}/api/admin/metrics/live${token ? `?token=${encodeURIComponent(token)}` : ''}`)
    es.addEventListener('metrics', (e) => {
      try {
        const snapshot = JSON.parse((e as MessageEvent).data) as MetricsSnapshot
        setMetrics(snapshot)
        setMetricsHistory(prev => {
          const next = [...prev, snapshot]
          return next.length > 60 ? next.slice(-60) : next
        })
      } catch { /* skip */ }
    })
    es.onerror = () => setMetricsLive(false)
    return () => es.close()
  }, [metricsLive])

  // SSE connect/disconnect
  const toggleSse = useCallback(() => {
    if (sseSource) {
      sseSource.close()
      setSseSource(null)
      setSseConnected(false)
      return
    }
    const params = sseFilter.trim() ? `?domains=${encodeURIComponent(sseFilter.trim())}` : ''
    const es = new EventSource(`${backendBase()}/api/events/stream${params}`)
    es.addEventListener('connected', (e) => {
      setSseConnected(true)
      setSseEvents(prev => [{ id: nextId(), type: 'connected', data: (e as MessageEvent).data, time: new Date().toLocaleTimeString('de-DE') }, ...prev].slice(0, 100))
    })
    es.addEventListener('state_changed', (e) => {
      setSseEvents(prev => [{ id: nextId(), type: 'state_changed', data: (e as MessageEvent).data, time: new Date().toLocaleTimeString('de-DE') }, ...prev].slice(0, 100))
    })
    es.addEventListener('warning', (e) => {
      setSseEvents(prev => [{ id: nextId(), type: 'warning', data: (e as MessageEvent).data, time: new Date().toLocaleTimeString('de-DE') }, ...prev].slice(0, 100))
    })
    es.onerror = () => {
      setSseConnected(false)
      setSseEvents(prev => [{ id: nextId(), type: 'error', data: 'Verbindung verloren', time: new Date().toLocaleTimeString('de-DE') }, ...prev].slice(0, 100))
    }
    setSseSource(es)
  }, [sseSource, sseFilter, nextId])

  // WS connect/disconnect
  const toggleWs = useCallback(() => {
    if (wsSocket) {
      wsSocket.close()
      setWsSocket(null)
      setWsConnected(false)
      return
    }
    let wsHost: string
    if (backendBase()) {
      try { wsHost = new URL(backendBase()).host } catch { wsHost = window.location.host }
    } else {
      wsHost = window.location.host
    }
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${wsHost}/ws/realtime`)
    ws.onopen = () => {
      setWsConnected(true)
      // Subscribe to selected namespace
      const sub: Record<string, unknown> = { namespace: wsNamespace, event: 'subscribe', data: {} }
      if (wsNamespace === 'entities' && wsDomainFilter.trim()) {
        sub.data = { domains: wsDomainFilter.split(',').map(s => s.trim()).filter(Boolean) }
      }
      ws.send(JSON.stringify(sub))
    }
    ws.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data)
        setWsEvents(prev => [{
          id: nextId(),
          ns: parsed.namespace || '–',
          event: parsed.event || '–',
          data: JSON.stringify(parsed.data || parsed, null, 0).slice(0, 300),
          time: new Date().toLocaleTimeString('de-DE'),
        }, ...prev].slice(0, 100))
      } catch {
        setWsEvents(prev => [{ id: nextId(), ns: '–', event: 'raw', data: e.data?.slice(0, 300), time: new Date().toLocaleTimeString('de-DE') }, ...prev].slice(0, 100))
      }
    }
    ws.onerror = () => setWsConnected(false)
    ws.onclose = () => { setWsConnected(false); setWsSocket(null) }
    setWsSocket(ws)
  }, [wsSocket, wsNamespace, wsDomainFilter, nextId])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      sseSource?.close()
      wsSocket?.close()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-3">
      {/* Section Toggle */}
      <AdminCard>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setActiveSection('metrics')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-all ${activeSection === 'metrics' ? 'bg-accent/20 text-accent' : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/10'}`}>
            <Heartbeat size={14} weight={activeSection === 'metrics' ? 'fill' : 'regular'} /> Metrics Dashboard
          </button>
          <button onClick={() => setActiveSection('sse')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-all ${activeSection === 'sse' ? 'bg-accent/20 text-accent' : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/10'}`}>
            <Broadcast size={14} /> SSE Event-Stream
          </button>
          <button onClick={() => setActiveSection('ws')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-all ${activeSection === 'ws' ? 'bg-accent/20 text-accent' : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/10'}`}>
            <Lightning size={14} /> Realtime WebSocket
          </button>
        </div>
      </AdminCard>

      {/* Metrics Dashboard Section */}
      {activeSection === 'metrics' && (
        <>
          {/* Live toggle */}
          <AdminCard>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Heartbeat size={16} weight="fill" className="text-accent" />
                <span className="text-sm font-semibold text-foreground">IORA Metrics Dashboard</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setMetricsLive(!metricsLive)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    metricsLive ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/10'
                  }`}>
                  <Broadcast size={12} weight={metricsLive ? 'fill' : 'regular'} />
                  {metricsLive ? 'Live (2s)' : 'Live starten'}
                </button>
                <button onClick={() => adminFetch('/api/admin/metrics', token).then((d: MetricsSnapshot) => setMetrics(d)).catch(() => {})}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-foreground/70 hover:text-accent hover:bg-accent/10 transition">
                  <ArrowClockwise size={12} /> Refresh
                </button>
              </div>
            </div>
          </AdminCard>

          {metricsLoading ? <LoadingSpinner /> : metrics && (
            <>
              {/* Key Metrics Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="glass-card rounded-2xl p-4 theme-transition text-center">
                  <div className="text-2xl font-bold text-foreground">{metrics.http.requests_total.toLocaleString()}</div>
                  <div className="text-[10px] text-foreground/50 mt-0.5">HTTP Requests</div>
                  {metrics.http.errors_total > 0 && <div className="text-[9px] text-red-400 mt-0.5">{metrics.http.errors_total} Fehler</div>}
                </div>
                <div className="glass-card rounded-2xl p-4 theme-transition text-center">
                  <div className="text-2xl font-bold text-foreground">{metrics.entities.state_changes.toLocaleString()}</div>
                  <div className="text-[10px] text-foreground/50 mt-0.5">State Changes</div>
                </div>
                <div className="glass-card rounded-2xl p-4 theme-transition text-center">
                  <div className="text-2xl font-bold text-foreground">{metrics.services.calls_total.toLocaleString()}</div>
                  <div className="text-[10px] text-foreground/50 mt-0.5">Service Calls</div>
                </div>
                <div className="glass-card rounded-2xl p-4 theme-transition text-center">
                  <div className={`text-2xl font-bold ${metrics.live?.ha_connected ? 'text-green-400' : 'text-red-400'}`}>
                    {metrics.live?.ha_connected ? 'Online' : 'Offline'}
                  </div>
                  <div className="text-[10px] text-foreground/50 mt-0.5">HA Verbindung</div>
                </div>
              </div>

              {/* Detailed Metrics */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {/* System */}
                <AdminCard title="System" icon={Cpu}>
                  <StatItem label="Uptime" value={formatUptime(metrics.uptime_seconds)} />
                  <StatItem label="Entities" value={metrics.live?.entity_count ?? '–'} />
                  <StatItem label="WS Clients" value={metrics.live?.connected_clients ?? 0} />
                  <StatItem label="SSE Streams" value={metrics.sse.active_connections} />
                </AdminCard>

                {/* HTTP */}
                <AdminCard title="HTTP" icon={Globe}>
                  <StatItem label="Requests Total" value={metrics.http.requests_total.toLocaleString()} />
                  <StatItem label="Errors" value={metrics.http.errors_total.toLocaleString()} />
                  <StatItem label="Error Rate" value={metrics.http.requests_total > 0 ? `${((metrics.http.errors_total / metrics.http.requests_total) * 100).toFixed(2)}%` : '0%'} />
                </AdminCard>

                {/* WebSocket */}
                <AdminCard title="WebSocket" icon={Lightning}>
                  <StatItem label="Nachrichten gesendet" value={metrics.websocket.messages_sent.toLocaleString()} />
                  <StatItem label="Nachrichten empfangen" value={metrics.websocket.messages_received.toLocaleString()} />
                  <StatItem label="HA Reconnects" value={metrics.ha_websocket.reconnects} />
                </AdminCard>

                {/* Tasks */}
                <AdminCard title="Hintergrund-Aufgaben" icon={ListChecks}>
                  <StatItem label="Ausführungen Total" value={metrics.tasks.runs_total.toLocaleString()} />
                  <StatItem label="Fehler Total" value={metrics.tasks.errors_total.toLocaleString()} />
                  <StatItem label="Error Rate" value={metrics.tasks.runs_total > 0 ? `${((metrics.tasks.errors_total / metrics.tasks.runs_total) * 100).toFixed(2)}%` : '0%'} />
                </AdminCard>

                {/* Logs */}
                <AdminCard title="Log-Statistik" icon={ListBullets}>
                  <StatItem label="Error" value={metrics.logs.error_count.toLocaleString()} />
                  <StatItem label="Warn" value={metrics.logs.warn_count.toLocaleString()} />
                  <StatItem label="Info" value={metrics.logs.info_count.toLocaleString()} />
                  <StatItem label="Buffer" value={`${metrics.logs.buffer_size} / 5000`} />
                </AdminCard>

                {/* Cache */}
                <AdminCard title="Cache" icon={Database}>
                  <StatItem label="Hits" value={metrics.cache.hits.toLocaleString()} />
                  <StatItem label="Misses" value={metrics.cache.misses.toLocaleString()} />
                  <StatItem label="Hit Rate" value={(metrics.cache.hits + metrics.cache.misses) > 0 ? `${((metrics.cache.hits / (metrics.cache.hits + metrics.cache.misses)) * 100).toFixed(1)}%` : '–'} />
                </AdminCard>
              </div>

              {/* Task Breakdown */}
              {metrics.task_breakdown && metrics.task_breakdown.length > 0 && (
                <AdminCard title="Aufgaben-Breakdown" icon={ListChecks}>
                  <div className="space-y-1">
                    {metrics.task_breakdown.map(t => (
                      <div key={t.id} className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-foreground/3 hover:bg-foreground/5 transition-colors">
                        <div className="flex items-center gap-2">
                          <div className={`w-1.5 h-1.5 rounded-full ${t.enabled ? 'bg-green-400' : 'bg-foreground/30'}`} />
                          <span className="text-xs text-foreground/80">{t.name}</span>
                        </div>
                        <div className="flex items-center gap-3 text-[10px]">
                          <span className="text-foreground/50">{t.runs} runs</span>
                          {t.errors > 0 && <span className="text-red-400">{t.errors} err</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </AdminCard>
              )}

              {/* Live Activity Sparkline (simple bar chart from history) */}
              {metricsHistory.length > 1 && (
                <AdminCard title="Live-Aktivität (Request-Rate)" icon={TrendUp}>
                  <div className="flex items-end gap-0.5 h-16">
                    {metricsHistory.map((snap, i) => {
                      const prev = metricsHistory[i - 1]
                      const delta = prev ? snap.http.requests_total - prev.http.requests_total : 0
                      const maxDelta = Math.max(1, ...metricsHistory.slice(1).map((s, j) => s.http.requests_total - metricsHistory[j].http.requests_total))
                      const height = Math.max(2, (delta / maxDelta) * 100)
                      return (
                        <Tip key={i} content={`+${delta} req`}>
                          <div
                            className="flex-1 rounded-t bg-accent/40 hover:bg-accent/60 transition-colors min-w-[3px]"
                            style={{ height: `${height}%` }}
                          />
                        </Tip>
                      )
                    })}
                  </div>
                  <div className="flex justify-between text-[9px] text-foreground/30 mt-1">
                    <span>{metricsHistory.length * 2}s ago</span>
                    <span>jetzt</span>
                  </div>
                </AdminCard>
              )}
            </>
          )}
        </>
      )}

      {/* SSE Section */}
      {activeSection === 'sse' && (
        <>
          <AdminCard title="SSE Event-Stream" icon={Broadcast}>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <input type="text" value={sseFilter} onChange={e => setSseFilter(e.target.value)}
                    placeholder="Domain-Filter: light,switch,sensor (leer = alle)"
                    disabled={sseConnected}
                    className="w-full bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-accent/30 text-foreground font-mono disabled:opacity-50" />
                </div>
                <button onClick={toggleSse}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                    sseConnected
                      ? 'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30'
                      : 'bg-accent text-white shadow-md shadow-accent/25 hover:bg-accent/85'
                  }`}>
                  {sseConnected ? <><X size={14} /> Trennen</> : <><Play size={14} /> Verbinden</>}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${sseConnected ? 'bg-green-400 animate-pulse' : 'bg-foreground/20'}`} />
                <span className="text-[10px] text-foreground/60">{sseConnected ? 'Verbunden — Events werden empfangen' : 'Nicht verbunden'}</span>
                {sseEvents.length > 0 && (
                  <button onClick={() => setSseEvents([])} className="ml-auto text-[10px] text-foreground/40 hover:text-foreground/60 transition-colors">
                    Log leeren
                  </button>
                )}
              </div>
            </div>
          </AdminCard>

          {/* SSE Event Log */}
          {sseEvents.length > 0 && (
            <AdminCard>
              <div className="space-y-1 max-h-80 overflow-y-auto">
                {sseEvents.map(ev => (
                  <div key={ev.id} className="flex items-start gap-2 py-1.5 px-2 rounded-lg bg-foreground/3 hover:bg-foreground/5 transition-colors">
                    <span className={`text-[10px] font-semibold shrink-0 px-1.5 py-0.5 rounded ${
                      ev.type === 'connected' ? 'bg-green-500/15 text-green-400' :
                      ev.type === 'error' ? 'bg-red-500/15 text-red-400' :
                      ev.type === 'warning' ? 'bg-amber-500/15 text-amber-400' :
                      'bg-blue-500/15 text-blue-400'
                    }`}>{ev.type}</span>
                    <span className="text-[10px] text-foreground/40 shrink-0">{ev.time}</span>
                    <span className="text-[10px] text-foreground/60 font-mono truncate flex-1">{ev.data.slice(0, 200)}</span>
                  </div>
                ))}
              </div>
            </AdminCard>
          )}

          {/* SSE Info */}
          <AdminCard>
            <div className="text-xs text-foreground/50 space-y-1">
              <p><strong className="text-foreground/70">Endpoint:</strong> <code className="bg-foreground/10 px-1 rounded">GET /api/events/stream</code></p>
              <p><strong className="text-foreground/70">Filter:</strong> <code className="bg-foreground/10 px-1 rounded">?domains=light,switch</code> und/oder <code className="bg-foreground/10 px-1 rounded">?entity_ids=light.wohnzimmer</code></p>
              <p><strong className="text-foreground/70">Events:</strong> connected, state_changed, warning</p>
              <p><strong className="text-foreground/70">System-Stream:</strong> <code className="bg-foreground/10 px-1 rounded">GET /api/events/system</code> für Health, Watchdog, Anomalien</p>
            </div>
          </AdminCard>
        </>
      )}

      {/* WebSocket Section */}
      {activeSection === 'ws' && (
        <>
          <AdminCard title="Realtime Namespace WebSocket" icon={Lightning}>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-foreground/70 mb-1 block">Namespace</label>
                <div className="flex gap-2">
                  {['entities', 'system', 'notifications'].map(ns => (
                    <button key={ns} onClick={() => setWsNamespace(ns)} disabled={wsConnected}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        wsNamespace === ns ? 'bg-accent text-white shadow-sm' : 'bg-foreground/10 text-foreground/60 border border-foreground/10'
                      } disabled:opacity-50`}>
                      {ns === 'entities' ? 'Entities' : ns === 'system' ? t('admin.system') : 'Notifications'}
                    </button>
                  ))}
                </div>
              </div>
              {wsNamespace === 'entities' && (
                <div>
                  <label className="text-xs text-foreground/70 mb-1 block">Domain-Filter (optional)</label>
                  <input type="text" value={wsDomainFilter} onChange={e => setWsDomainFilter(e.target.value)}
                    placeholder="light,switch,sensor"
                    disabled={wsConnected}
                    className="w-full bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-accent/30 text-foreground font-mono disabled:opacity-50" />
                </div>
              )}
              <div className="flex items-center gap-2">
                <button onClick={toggleWs}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                    wsConnected
                      ? 'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30'
                      : 'bg-accent text-white shadow-md shadow-accent/25 hover:bg-accent/85'
                  }`}>
                  {wsConnected ? <><X size={14} /> Trennen</> : <><Play size={14} /> Verbinden</>}
                </button>
                <div className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-green-400 animate-pulse' : 'bg-foreground/20'}`} />
                <span className="text-[10px] text-foreground/60">{wsConnected ? `Verbunden — ${wsNamespace}` : 'Nicht verbunden'}</span>
                {wsEvents.length > 0 && (
                  <button onClick={() => setWsEvents([])} className="ml-auto text-[10px] text-foreground/40 hover:text-foreground/60 transition-colors">
                    Log leeren
                  </button>
                )}
              </div>
            </div>
          </AdminCard>

          {/* WS Event Log */}
          {wsEvents.length > 0 && (
            <AdminCard>
              <div className="space-y-1 max-h-80 overflow-y-auto">
                {wsEvents.map(ev => (
                  <div key={ev.id} className="flex items-start gap-2 py-1.5 px-2 rounded-lg bg-foreground/3 hover:bg-foreground/5 transition-colors">
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 shrink-0">{ev.ns}</span>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${
                      ev.event === 'connected' || ev.event === 'subscribed' ? 'bg-green-500/15 text-green-400' :
                      ev.event === 'error' ? 'bg-red-500/15 text-red-400' :
                      'bg-blue-500/15 text-blue-400'
                    }`}>{ev.event}</span>
                    <span className="text-[10px] text-foreground/40 shrink-0">{ev.time}</span>
                    <span className="text-[10px] text-foreground/60 font-mono truncate flex-1">{ev.data.slice(0, 200)}</span>
                  </div>
                ))}
              </div>
            </AdminCard>
          )}

          {/* WS Protocol Info */}
          <AdminCard>
            <div className="text-xs text-foreground/50 space-y-1">
              <p><strong className="text-foreground/70">Endpoint:</strong> <code className="bg-foreground/10 px-1 rounded">ws://host/ws/realtime</code></p>
              <p><strong className="text-foreground/70">Protokoll:</strong> JSON-Nachrichten mit Namespace-Multiplexing (Socket.IO-ähnlich)</p>
              <p><strong className="text-foreground/70">Namespaces:</strong> <code className="bg-foreground/10 px-1 rounded">entities</code> (State-Änderungen), <code className="bg-foreground/10 px-1 rounded">system</code> (Events/Fehler), <code className="bg-foreground/10 px-1 rounded">notifications</code> (Konfig-Änderungen)</p>
              <div className="bg-foreground/5 rounded-lg p-2 mt-2 font-mono text-[10px] text-foreground/40">
                {`// Subscribe\n{"namespace":"entities","event":"subscribe","data":{"domains":["light"]}}\n// Unsubscribe\n{"namespace":"entities","event":"unsubscribe"}\n// Ping\n{"event":"ping"} → {"event":"pong"}`}
              </div>
            </div>
          </AdminCard>
        </>
      )}
    </div>
  )
}

// ── Entity Explorer Tab ──────────────────────────────────────────────────

function EntitiesTab({ token }: { token: string }) {
  const [counts, setCounts] = useState<Record<string, number> | null>(null)
  const [entities, setEntities] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedDomain, setSelectedDomain] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Record<string, unknown>[]>([])
  const [searching, setSearching] = useState(false)
  const [historyEntity, setHistoryEntity] = useState('')
  const [history, setHistory] = useState<Record<string, unknown>[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [expandedEntity, setExpandedEntity] = useState<string | null>(null)
  const [domainLoading, setDomainLoading] = useState(false)

  const loadCounts = useCallback(async () => {
    try {
      setLoading(true)
      const raw = await cachedFetch('/api/entities/count', token) as Record<string, unknown>
      // API returns {total, domains: [{domain, count}, ...]}
      const mapped: Record<string, number> = {}
      const domains = Array.isArray(raw) ? raw : Array.isArray((raw as Record<string, unknown>)?.domains) ? (raw as Record<string, unknown>).domains as Record<string, unknown>[] : []
      for (const item of domains as Record<string, unknown>[]) {
        if (item && typeof item === 'object' && 'domain' in item && 'count' in item) {
          mapped[String(item.domain)] = Number(item.count)
        }
      }
      setCounts(mapped)
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { loadCounts() }, [loadCounts])

  const loadDomain = async (domain: string) => {
    setSelectedDomain(domain)
    setEntities([])
    setDomainLoading(true)
    try {
      const data = await adminFetch(`/api/entities/domain/${domain}`, token) as Record<string, unknown>[]
      setEntities(Array.isArray(data) ? data : [])
    } catch {}
    finally { setDomainLoading(false) }
  }

  const doSearch = async () => {
    if (!searchQuery.trim()) return
    setSearching(true)
    try {
      const data = await adminFetch(`/api/entities/search?q=${encodeURIComponent(searchQuery)}`, token) as Record<string, unknown>[]
      setSearchResults(Array.isArray(data) ? data : [])
    } catch {}
    finally { setSearching(false) }
  }

  const loadHistory = async (entityId: string) => {
    if (historyEntity === entityId) { setHistoryEntity(''); setHistory([]); return }
    setHistoryEntity(entityId)
    setHistoryLoading(true)
    try {
      const data = await adminFetch(`/api/stats/entity-history/${encodeURIComponent(entityId)}`, token) as Record<string, unknown>[]
      setHistory(Array.isArray(data) ? data : [])
    } catch { setHistory([]) }
    finally { setHistoryLoading(false) }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  return (
    <div className="space-y-3">
      {/* Search */}
      <AdminCard title="Entity-Suche" icon={MagnifyingGlass}>
        <div className="flex gap-2">
          <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doSearch()}
            placeholder="Entity-ID oder Name suchen..."
            className="flex-1 bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-accent/30 text-foreground" />
          <button onClick={doSearch} disabled={searching}
            className="px-4 py-2 bg-accent text-white rounded-lg text-xs font-semibold hover:bg-accent/85 transition-colors disabled:opacity-50">
            {searching ? '...' : 'Suchen'}
          </button>
        </div>
        {searchResults.length > 0 && (
          <div className="mt-3 space-y-1 max-h-60 overflow-y-auto">
            {searchResults.map((e, i) => (
              <div key={i} className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-foreground/3 hover:bg-foreground/5 transition-colors">
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-mono text-accent">{String(e.entity_id ?? '')}</span>
                  <span className="text-xs text-foreground/50 ml-2">{String(e.state ?? '')}</span>
                </div>
                <button onClick={() => loadHistory(String(e.entity_id ?? ''))}
                  className="text-[10px] text-foreground/40 hover:text-accent transition-colors shrink-0 ml-2">
                  <ChartLine size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </AdminCard>

      {/* Domain Counts */}
      {counts && (
        <AdminCard title="Domains" icon={Cube}>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
            {Object.entries(counts).sort(([,a],[,b]) => b - a).map(([domain, count]) => (
              <button key={domain} onClick={() => loadDomain(domain)}
                className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-all ${
                  selectedDomain === domain ? 'bg-accent/15 text-accent border border-accent/30' : 'bg-foreground/5 text-foreground/70 hover:bg-foreground/8 border border-transparent'
                }`}>
                <span className="truncate font-mono">{domain}</span>
                <span className="font-semibold ml-1.5 shrink-0">{count}</span>
              </button>
            ))}
          </div>
        </AdminCard>
      )}

      {/* Domain Entities */}
      {selectedDomain && domainLoading && (
        <AdminCard>
          <div className="flex items-center justify-center gap-2 py-4">
            <InlineSpinner size={16} className="text-accent" />
            <span className="text-xs text-foreground/50">Lade {selectedDomain}-Entities...</span>
          </div>
        </AdminCard>
      )}
      {selectedDomain && !domainLoading && entities.length > 0 && (
        <AdminCard title={`${selectedDomain} (${entities.length})`} icon={ListBullets}>
          <div className="space-y-0.5 max-h-96 overflow-y-auto">
            {entities.map((e, i) => {
              const eid = String(e.entity_id ?? '')
              const isExpanded = expandedEntity === eid
              return (
                <div key={i} className="rounded-lg bg-foreground/3 hover:bg-foreground/5 transition-colors">
                  <div className="flex items-center justify-between py-1.5 px-2 cursor-pointer" onClick={() => setExpandedEntity(isExpanded ? null : eid)}>
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="text-xs font-mono text-foreground/80 truncate">{eid}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold shrink-0 ${
                        String(e.state) === 'on' || String(e.state) === 'home' ? 'bg-green-500/15 text-green-400' :
                        String(e.state) === 'off' || String(e.state) === 'not_home' ? 'bg-foreground/10 text-foreground/40' :
                        String(e.state) === 'unavailable' ? 'bg-red-500/15 text-red-400' :
                        'bg-blue-500/15 text-blue-400'
                      }`}>{String(e.state ?? '–')}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={ev => { ev.stopPropagation(); loadHistory(eid) }}
                        className="text-foreground/30 hover:text-accent transition-colors p-0.5"><ChartLine size={14} /></button>
                      {isExpanded ? <CaretUp size={12} className="text-foreground/30" /> : <CaretDown size={12} className="text-foreground/30" />}
                    </div>
                  </div>
                  {isExpanded && e.attributes ? (
                    <div className="px-3 pb-2 border-t border-foreground/5">
                      <div className="mt-1.5 space-y-0.5">
                        {Object.entries(e.attributes as Record<string, unknown>).map(([k, v]) => (
                          <div key={k} className="flex justify-between text-[10px] py-0.5">
                            <span className="text-foreground/50">{k}</span>
                            <span className="text-foreground/70 font-mono truncate ml-2 max-w-[200px]">{JSON.stringify(v)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </AdminCard>
      )}

      {/* History */}
      {historyEntity && (
        <AdminCard title={`Verlauf: ${historyEntity}`} icon={ChartLine}>
          {historyLoading ? <LoadingSpinner /> : history.length === 0 ? (
            <p className="text-xs text-foreground/50 text-center py-4">Keine Verlaufsdaten verfügbar.</p>
          ) : (
            <div className="space-y-0.5 max-h-60 overflow-y-auto">
              {history.slice(0, 50).map((h, i) => (
                <div key={i} className="flex items-center gap-3 py-1 px-2 rounded bg-foreground/3 text-[10px]">
                  <span className="text-foreground/40 font-mono shrink-0">{String(h.timestamp ?? h.last_changed ?? '').slice(0, 19)}</span>
                  <span className="font-semibold text-foreground/70">{String(h.state ?? '–')}</span>
                </div>
              ))}
            </div>
          )}
        </AdminCard>
      )}
    </div>
  )
}

// ── Scheduler Tab ──────────────────────────────────────────────────

function SchedulerTab({ token }: { token: string }) {
  const [schedules, setSchedules] = useState<Record<string, unknown>[]>([])
  const [watchdogs, setWatchdogs] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeSection, setActiveSection] = useState<'schedules' | 'watchdogs'>('schedules')
  const [showCreateSchedule, setShowCreateSchedule] = useState(false)
  const [showCreateWatchdog, setShowCreateWatchdog] = useState(false)
  const [newSchedule, setNewSchedule] = useState({ entity_id: '', action: 'turn_on', cron: '', name: '' })
  const [newWatchdog, setNewWatchdog] = useState({ entity_id: '', expected_state: 'on', timeout_minutes: 30, action: 'notify', name: '' })
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const [s, w] = await Promise.all([
        adminFetch('/api/integration/schedules', token).catch(() => []),
        adminFetch('/api/integration/watchdogs', token).catch(() => [])
      ])
      setSchedules(Array.isArray(s) ? s : [])
      setWatchdogs(Array.isArray(w) ? w : [])
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { load() }, [load])

  const createSchedule = async () => {
    setActionLoading('create-schedule')
    try {
      await adminFetch('/api/integration/schedules', token, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSchedule)
      })
      setShowCreateSchedule(false)
      setNewSchedule({ entity_id: '', action: 'turn_on', cron: '', name: '' })
      load()
    } catch (e) { notifyError(e) }
    finally { setActionLoading(null) }
  }

  const deleteSchedule = async (id: string) => {
    setActionLoading(`del-s-${id}`)
    try {
      await adminFetch(`/api/integration/schedules/${id}`, token, { method: 'DELETE' })
      load()
    } catch (e) { notifyError(e) }
    finally { setActionLoading(null) }
  }

  const createWatchdog = async () => {
    setActionLoading('create-watchdog')
    try {
      await adminFetch('/api/integration/watchdogs', token, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newWatchdog)
      })
      setShowCreateWatchdog(false)
      setNewWatchdog({ entity_id: '', expected_state: 'on', timeout_minutes: 30, action: 'notify', name: '' })
      load()
    } catch (e) { notifyError(e) }
    finally { setActionLoading(null) }
  }

  const deleteWatchdog = async (id: string) => {
    setActionLoading(`del-w-${id}`)
    try {
      await adminFetch(`/api/integration/watchdogs/${id}`, token, { method: 'DELETE' })
      load()
    } catch (e) { notifyError(e) }
    finally { setActionLoading(null) }
  }

  const checkWatchdogs = async () => {
    setActionLoading('check-watchdogs')
    try {
      await adminFetch('/api/integration/watchdogs/check', token, { method: 'POST' })
    } catch (e) { notifyError(e) }
    finally { setActionLoading(null) }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  return (
    <div className="space-y-3">
      {/* Section Toggle */}
      <div className="flex gap-2">
        {(['schedules', 'watchdogs'] as const).map(s => (
          <button key={s} onClick={() => setActiveSection(s)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeSection === s ? 'bg-accent text-white shadow-md shadow-accent/25' : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/8'
            }`}>
            {s === 'schedules' ? <><Timer size={14} /> Zeitpläne ({schedules.length})</> : <><Dog size={14} /> Watchdogs ({watchdogs.length})</>}
          </button>
        ))}
      </div>

      {activeSection === 'schedules' && (
        <>
          <AdminCard>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-semibold text-foreground">Zeitpläne</h4>
              <button onClick={() => setShowCreateSchedule(!showCreateSchedule)}
                className="flex items-center gap-1 px-3 py-1.5 bg-accent text-white rounded-lg text-[10px] font-semibold hover:bg-accent/85 transition-colors">
                <Plus size={12} /> Neuer Zeitplan
              </button>
            </div>

            {showCreateSchedule && (
              <div className="space-y-2 p-3 rounded-lg bg-foreground/5 border border-foreground/10 mb-3">
                <input value={newSchedule.name} onChange={e => setNewSchedule(s => ({...s, name: e.target.value}))}
                  placeholder="Name (optional)" className="w-full bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-accent/30 text-foreground" />
                <input value={newSchedule.entity_id} onChange={e => setNewSchedule(s => ({...s, entity_id: e.target.value}))}
                  placeholder="Entity ID (z.B. light.wohnzimmer)" className="w-full bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-accent/30 text-foreground font-mono" />
                <div className="grid grid-cols-2 gap-2">
                  <select value={newSchedule.action} onChange={e => setNewSchedule(s => ({...s, action: e.target.value}))}
                    className="bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-accent/30 text-foreground">
                    <option value="turn_on">Einschalten</option>
                    <option value="turn_off">Ausschalten</option>
                    <option value="toggle">Umschalten</option>
                  </select>
                  <input value={newSchedule.cron} onChange={e => setNewSchedule(s => ({...s, cron: e.target.value}))}
                    placeholder="Cron (z.B. 0 8 * * *)" className="bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-accent/30 text-foreground font-mono" />
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowCreateSchedule(false)} className="px-3 py-1.5 text-xs text-foreground/50 hover:text-foreground transition-colors">Abbrechen</button>
                  <button onClick={createSchedule} disabled={!newSchedule.entity_id || !newSchedule.cron || actionLoading === 'create-schedule'}
                    className="px-4 py-1.5 bg-accent text-white rounded-lg text-xs font-semibold hover:bg-accent/85 transition-colors disabled:opacity-50 flex items-center gap-1.5">
                    {actionLoading === 'create-schedule' && <InlineSpinner size={12} />}
                    Erstellen</button>
                </div>
              </div>
            )}

            {schedules.length === 0 ? (
              <p className="text-xs text-foreground/50 text-center py-4">Keine Zeitpläne konfiguriert.</p>
            ) : (
              <div className="space-y-1.5">
                {schedules.map((s, i) => (
                  <div key={i} className="flex items-center justify-between py-2 px-3 rounded-lg bg-foreground/3 hover:bg-foreground/5 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-foreground">{String(s.name || s.entity_id || '–')}</div>
                      <div className="text-[10px] text-foreground/50 font-mono mt-0.5">
                        {String(s.entity_id ?? '')} → {String(s.action ?? '')} | <span className="text-accent/70">{String(s.cron ?? '')}</span>
                      </div>
                    </div>
                    <button onClick={() => deleteSchedule(String(s.id ?? i))}
                      disabled={actionLoading === `del-s-${String(s.id ?? i)}`}
                      className="text-foreground/30 hover:text-red-400 transition-colors p-1 disabled:opacity-40">
                      {actionLoading === `del-s-${String(s.id ?? i)}` ? <InlineSpinner size={14} /> : <Trash size={14} />}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </AdminCard>

          {/* Cron help */}
          <AdminCard title="Cron-Syntax" icon={Clock}>
            <div className="text-[10px] text-foreground/50 space-y-1 font-mono">
              <p>┌─── Minute (0-59)</p>
              <p>│ ┌─── Stunde (0-23)</p>
              <p>│ │ ┌─── Tag (1-31)</p>
              <p>│ │ │ ┌─── Monat (1-12)</p>
              <p>│ │ │ │ ┌─── Wochentag (0-7, So=0|7)</p>
              <p>* * * * *</p>
              <div className="mt-2 text-foreground/40 space-y-0.5 font-sans">
                <p><code className="bg-foreground/10 px-1 rounded">0 8 * * *</code> — Täglich um 08:00</p>
                <p><code className="bg-foreground/10 px-1 rounded">*/15 * * * *</code> — Alle 15 Minuten</p>
                <p><code className="bg-foreground/10 px-1 rounded">0 22 * * 1-5</code> — Mo-Fr um 22:00</p>
              </div>
            </div>
          </AdminCard>
        </>
      )}

      {activeSection === 'watchdogs' && (
        <>
          <AdminCard>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-semibold text-foreground">Watchdogs</h4>
              <div className="flex gap-2">
                <button onClick={checkWatchdogs}
                  disabled={actionLoading === 'check-watchdogs'}
                  className="flex items-center gap-1 px-3 py-1.5 bg-foreground/5 text-foreground/60 rounded-lg text-[10px] font-semibold hover:bg-foreground/8 transition-colors border border-foreground/10 disabled:opacity-40">
                  {actionLoading === 'check-watchdogs' ? <InlineSpinner size={12} /> : <Heartbeat size={12} />} Jetzt prüfen
                </button>
                <button onClick={() => setShowCreateWatchdog(!showCreateWatchdog)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-accent text-white rounded-lg text-[10px] font-semibold hover:bg-accent/85 transition-colors">
                  <Plus size={12} /> Neuer Watchdog
                </button>
              </div>
            </div>

            {showCreateWatchdog && (
              <div className="space-y-2 p-3 rounded-lg bg-foreground/5 border border-foreground/10 mb-3">
                <input value={newWatchdog.name} onChange={e => setNewWatchdog(w => ({...w, name: e.target.value}))}
                  placeholder="Name (optional)" className="w-full bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-accent/30 text-foreground" />
                <input value={newWatchdog.entity_id} onChange={e => setNewWatchdog(w => ({...w, entity_id: e.target.value}))}
                  placeholder="Entity ID" className="w-full bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-accent/30 text-foreground font-mono" />
                <div className="grid grid-cols-3 gap-2">
                  <input value={newWatchdog.expected_state} onChange={e => setNewWatchdog(w => ({...w, expected_state: e.target.value}))}
                    placeholder="Erwarteter Zustand" className="bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-accent/30 text-foreground" />
                  <input type="number" value={newWatchdog.timeout_minutes} onChange={e => setNewWatchdog(w => ({...w, timeout_minutes: parseInt(e.target.value) || 30}))}
                    placeholder="Timeout (Min)" className="bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-accent/30 text-foreground" />
                  <select value={newWatchdog.action} onChange={e => setNewWatchdog(w => ({...w, action: e.target.value}))}
                    className="bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-accent/30 text-foreground">
                    <option value="notify">Benachrichtigen</option>
                    <option value="restart">Neustarten</option>
                    <option value="turn_on">Einschalten</option>
                  </select>
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowCreateWatchdog(false)} className="px-3 py-1.5 text-xs text-foreground/50 hover:text-foreground transition-colors">Abbrechen</button>
                  <button onClick={createWatchdog} disabled={!newWatchdog.entity_id || actionLoading === 'create-watchdog'}
                    className="px-4 py-1.5 bg-accent text-white rounded-lg text-xs font-semibold hover:bg-accent/85 transition-colors disabled:opacity-50 flex items-center gap-1.5">
                    {actionLoading === 'create-watchdog' && <InlineSpinner size={12} />}
                    Erstellen</button>
                </div>
              </div>
            )}

            {watchdogs.length === 0 ? (
              <p className="text-xs text-foreground/50 text-center py-4">Keine Watchdogs konfiguriert.</p>
            ) : (
              <div className="space-y-1.5">
                {watchdogs.map((w, i) => (
                  <div key={i} className="flex items-center justify-between py-2 px-3 rounded-lg bg-foreground/3 hover:bg-foreground/5 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-foreground">{String(w.name || w.entity_id || '–')}</div>
                      <div className="text-[10px] text-foreground/50 mt-0.5">
                        <span className="font-mono">{String(w.entity_id ?? '')}</span> erwartet <span className="text-accent font-semibold">{String(w.expected_state ?? '')}</span>
                        {' '}— Timeout: {String(w.timeout_minutes ?? 30)} Min — Aktion: {String(w.action ?? 'notify')}
                      </div>
                    </div>
                    <button onClick={() => deleteWatchdog(String(w.id ?? i))}
                      disabled={actionLoading === `del-w-${String(w.id ?? i)}`}
                      className="text-foreground/30 hover:text-red-400 transition-colors p-1 disabled:opacity-40">
                      {actionLoading === `del-w-${String(w.id ?? i)}` ? <InlineSpinner size={14} /> : <Trash size={14} />}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </AdminCard>

          {/* Watchdog Info */}
          <AdminCard title="Watchdog-Info" icon={Dog}>
            <div className="text-xs text-foreground/50 space-y-1">
              <p>Watchdogs überwachen Entities und lösen Aktionen aus, wenn ein erwarteter Zustand nach dem Timeout nicht eintritt.</p>
              <p><strong className="text-foreground/70">Beispiel:</strong> Überwache ob <code className="bg-foreground/10 px-1 rounded">sensor.heizung</code> den Zustand <code className="bg-foreground/10 px-1 rounded">on</code> hat. Falls nach 30 Minuten nicht → Benachrichtigung.</p>
            </div>
          </AdminCard>
        </>
      )}
    </div>
  )
}

// ── Analytics Tab ──────────────────────────────────────────────────

function AnalyticsTab({ token }: { token: string }) {
  const [dashboard, setDashboard] = useState<Record<string, unknown> | null>(null)
  const [health, setHealth] = useState<Record<string, unknown> | null>(null)
  const [topEntities, setTopEntities] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const [d, h, t] = await Promise.all([
        adminFetch('/api/stats/dashboard', token).catch(() => null),
        adminFetch('/api/integration/health', token).catch(() => null),
        adminFetch('/api/integration/analytics/top', token).catch(() => [])
      ])
      setDashboard(d as Record<string, unknown> | null)
      setHealth(h as Record<string, unknown> | null)
      setTopEntities(Array.isArray(t) ? t : [])
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { load() }, [load])

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  return (
    <div className="space-y-3">
      {/* Dashboard Stats */}
      {dashboard && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {Object.entries(dashboard).filter(([, v]) => typeof v === 'number' || typeof v === 'string').slice(0, 8).map(([key, val]) => (
            <div key={key} className="glass-card rounded-xl p-3 text-center">
              <div className="text-lg font-bold text-accent">{String(val)}</div>
              <div className="text-[10px] text-foreground/50 mt-0.5">{key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</div>
            </div>
          ))}
        </div>
      )}

      {/* Health Report */}
      {health && (
        <AdminCard title="System-Gesundheit" icon={Heartbeat}>
          <div className="space-y-2">
            {Object.entries(health).map(([component, status]) => {
              const isOk = typeof status === 'string' ? status === 'ok' || status === 'healthy' || status === 'connected' : 
                typeof status === 'object' && status !== null ? (status as Record<string, unknown>).status === 'ok' || (status as Record<string, unknown>).healthy === true : false
              return (
                <div key={component} className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-foreground/3">
                  <span className="text-xs text-foreground/80">{component.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</span>
                  <div className="flex items-center gap-1.5">
                    {isOk ? <CheckCircle size={14} className="text-green-400" weight="fill" /> : <XCircle size={14} className="text-red-400" weight="fill" />}
                    <span className={`text-[10px] font-semibold ${isOk ? 'text-green-400' : 'text-red-400'}`}>
                      {typeof status === 'string' ? status : isOk ? 'OK' : 'Problem'}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </AdminCard>
      )}

      {/* Top Entities */}
      {topEntities.length > 0 && (
        <AdminCard title="Meistgenutzte Entities" icon={TrendUp}>
          <div className="space-y-1">
            {topEntities.slice(0, 15).map((e, i) => {
              const count = Number(e.count ?? e.access_count ?? e.event_count ?? 0)
              const maxCount = Number(topEntities[0]?.count ?? topEntities[0]?.access_count ?? topEntities[0]?.event_count ?? 1)
              return (
                <div key={i} className="relative py-1.5 px-2 rounded-lg overflow-hidden">
                  <div className="absolute inset-y-0 left-0 bg-accent/8 rounded-lg" style={{ width: `${Math.max(5, (count / maxCount) * 100)}%` }} />
                  <div className="relative flex items-center justify-between">
                    <span className="text-xs font-mono text-foreground/70">{String(e.entity_id ?? e.name ?? '')}</span>
                    <span className="text-[10px] font-semibold text-accent">{count}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </AdminCard>
      )}

      {/* Refresh */}
      <div className="flex justify-center">
        <button onClick={async () => { setRefreshing(true); try { await load() } finally { setRefreshing(false) } }} disabled={refreshing}
          className="flex items-center gap-1.5 px-4 py-2 bg-foreground/5 text-foreground/60 rounded-lg text-xs font-semibold hover:bg-foreground/8 transition-colors border border-foreground/10 disabled:opacity-40">
          {refreshing ? <InlineSpinner size={14} /> : <ArrowClockwise size={14} />} Aktualisieren
        </button>
      </div>
    </div>
  )
}

// ── Logbook Tab ──────────────────────────────────────────────────

function LogbookTab({ token }: { token: string }) {
  const [entries, setEntries] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [entityFilter, setEntityFilter] = useState('')
  const [expandedEntry, setExpandedEntry] = useState<number | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const data = await adminFetch('/api/admin/ha/logbook', token) as Record<string, unknown>[]
      setEntries(Array.isArray(data) ? data : [])
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { load() }, [load])

  const filtered = entityFilter
    ? entries.filter(e => String(e.entity_id ?? '').includes(entityFilter) || String(e.name ?? '').toLowerCase().includes(entityFilter.toLowerCase()))
    : entries

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  return (
    <div className="space-y-3">
      {/* Filter */}
      <AdminCard>
        <div className="flex items-center gap-2">
          <MagnifyingGlass size={14} className="text-foreground/40" />
          <input value={entityFilter} onChange={e => setEntityFilter(e.target.value)}
            placeholder="Entity oder Name filtern..."
            className="flex-1 bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-accent/30 text-foreground" />
          <button onClick={async () => { setRefreshing(true); try { await load() } finally { setRefreshing(false) } }} disabled={refreshing}
            className="text-foreground/40 hover:text-accent transition-colors p-1 disabled:opacity-40">
            {refreshing ? <InlineSpinner size={16} /> : <ArrowClockwise size={16} />}
          </button>
          <span className="text-[10px] text-foreground/40">{filtered.length} Einträge</span>
        </div>
      </AdminCard>

      {/* Entries */}
      <AdminCard title="Logbuch-Einträge" icon={BookOpen}>
        {filtered.length === 0 ? (
          <p className="text-xs text-foreground/50 text-center py-4">Keine Logbuch-Einträge gefunden.</p>
        ) : (
          <div className="space-y-0.5 max-h-[500px] overflow-y-auto">
            {filtered.slice(0, 200).map((entry, i) => {
              const timestamp = String(entry.when ?? entry.last_changed ?? entry.timestamp ?? '').slice(0, 19)
              const entityId = String(entry.entity_id ?? '')
              const name = String(entry.name ?? entityId.split('.').pop() ?? '')
              const message = String(entry.message ?? entry.state ?? '')
              const domain = entityId.split('.')[0] || 'unknown'
              const isExpanded = expandedEntry === i

              return (
                <div key={i} className="rounded-lg bg-foreground/3 hover:bg-foreground/5 transition-colors cursor-pointer"
                  onClick={() => setExpandedEntry(isExpanded ? null : i)}>
                  <div className="flex items-center gap-2 py-1.5 px-2">
                    <span className="text-[10px] text-foreground/40 font-mono shrink-0 w-32">{timestamp}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold shrink-0 ${
                      domain === 'light' ? 'bg-yellow-500/15 text-yellow-400' :
                      domain === 'switch' ? 'bg-blue-500/15 text-blue-400' :
                      domain === 'sensor' ? 'bg-green-500/15 text-green-400' :
                      domain === 'automation' ? 'bg-purple-500/15 text-purple-400' :
                      domain === 'climate' ? 'bg-orange-500/15 text-orange-400' :
                      'bg-foreground/10 text-foreground/50'
                    }`}>{domain}</span>
                    <span className="text-xs text-foreground/80 font-semibold truncate">{name}</span>
                    <span className="text-xs text-foreground/50 truncate flex-1">{message}</span>
                    {isExpanded ? <CaretUp size={12} className="text-foreground/30 shrink-0" /> : <CaretDown size={12} className="text-foreground/30 shrink-0" />}
                  </div>
                  {isExpanded && (
                    <div className="px-3 pb-2 border-t border-foreground/5">
                      <div className="mt-1.5 space-y-0.5 text-[10px]">
                        <div className="flex justify-between"><span className="text-foreground/50">Entity ID</span><span className="text-foreground/70 font-mono">{entityId}</span></div>
                        {entry.context_user_id ? <div className="flex justify-between"><span className="text-foreground/50">Benutzer</span><span className="text-foreground/70">{String(entry.context_user_id)}</span></div> : null}
                        {entry.source ? <div className="flex justify-between"><span className="text-foreground/50">Quelle</span><span className="text-foreground/70">{String(entry.source)}</span></div> : null}
                        {entry.context_event_type ? <div className="flex justify-between"><span className="text-foreground/50">Event-Typ</span><span className="text-foreground/70">{String(entry.context_event_type)}</span></div> : null}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </AdminCard>

      {/* Info */}
      <AdminCard>
        <div className="text-xs text-foreground/50 text-center">
          <p>Das Logbuch zeigt den chronologischen Verlauf aller Zustandsänderungen und Aktionen aus Home Assistant.</p>
        </div>
      </AdminCard>
    </div>
  )
}

// ── Calendars Tab ──────────────────────────────────────────────────

function CalendarsTab({ token }: { token: string }) {
  const [calendars, setCalendars] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedCalendar, setSelectedCalendar] = useState('')
  const [events, setEvents] = useState<Record<string, unknown>[]>([])
  const [eventsLoading, setEventsLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const data = await adminFetch('/api/admin/ha/calendars', token) as Record<string, unknown>[]
      setCalendars(Array.isArray(data) ? data : [])
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { load() }, [load])

  const loadEvents = async (entityId: string) => {
    if (selectedCalendar === entityId) { setSelectedCalendar(''); setEvents([]); return }
    setSelectedCalendar(entityId)
    setEventsLoading(true)
    try {
      const data = await adminFetch(`/api/admin/ha/calendars/${encodeURIComponent(entityId)}/events`, token) as Record<string, unknown>[]
      setEvents(Array.isArray(data) ? data : [])
    } catch { setEvents([]) }
    finally { setEventsLoading(false) }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  return (
    <div className="space-y-3">
      {/* Calendar List */}
      <AdminCard title={`Kalender (${calendars.length})`} icon={CalendarBlank}>
        {calendars.length === 0 ? (
          <p className="text-xs text-foreground/50 text-center py-4">Keine Kalender-Entitäten in Home Assistant gefunden.</p>
        ) : (
          <div className="space-y-1">
            {calendars.map((cal, i) => {
              const entityId = String(cal.entity_id ?? '')
              const attrs = (cal.attributes ?? {}) as Record<string, unknown>
              const name = String(cal.name ?? attrs.friendly_name ?? entityId)
              const state = String(cal.state ?? '')
              const isSelected = selectedCalendar === entityId

              return (
                <button key={i} onClick={() => loadEvents(entityId)}
                  className={`w-full flex items-center justify-between py-2 px-3 rounded-lg text-left transition-all ${
                    isSelected ? 'bg-accent/15 border border-accent/30' : 'bg-foreground/3 hover:bg-foreground/5 border border-transparent'
                  }`}>
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <CalendarBlank size={16} className={isSelected ? 'text-accent' : 'text-foreground/40'} />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-foreground truncate">{name}</div>
                      <div className="text-[10px] text-foreground/40 font-mono truncate">{entityId}</div>
                    </div>
                  </div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold shrink-0 ${
                    state === 'on' ? 'bg-green-500/15 text-green-400' : 'bg-foreground/10 text-foreground/40'
                  }`}>{state || '–'}</span>
                </button>
              )
            })}
          </div>
        )}
      </AdminCard>

      {/* Calendar Events */}
      {selectedCalendar && (
        <AdminCard title={`Termine — ${selectedCalendar}`} icon={Clock}>
          {eventsLoading ? <LoadingSpinner /> : events.length === 0 ? (
            <p className="text-xs text-foreground/50 text-center py-4">Keine anstehenden Termine.</p>
          ) : (
            <div className="space-y-1.5 max-h-96 overflow-y-auto">
              {events.map((ev, i) => {
                const summary = String(ev.summary ?? ev.title ?? '–')
                const startVal = ev.start
                const endVal = ev.end
                const start = String(typeof startVal === 'object' && startVal !== null ? (startVal as Record<string, unknown>).dateTime ?? startVal : startVal ?? '').slice(0, 16)
                const end = String(typeof endVal === 'object' && endVal !== null ? (endVal as Record<string, unknown>).dateTime ?? endVal : endVal ?? '').slice(0, 16)
                const location = String(ev.location ?? '')
                const description = String(ev.description ?? '')

                return (
                  <div key={i} className="py-2 px-3 rounded-lg bg-foreground/3 hover:bg-foreground/5 transition-colors">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-foreground">{summary}</div>
                        <div className="text-[10px] text-foreground/50 mt-0.5 flex items-center gap-2">
                          <span className="font-mono">{start}</span>
                          {end && <><span className="text-foreground/30">→</span> <span className="font-mono">{end}</span></>}
                        </div>
                        {location && <div className="text-[10px] text-foreground/40 mt-0.5 flex items-center gap-1"><MapPin size={10} /> {location}</div>}
                        {description && <div className="text-[10px] text-foreground/40 mt-0.5 truncate max-w-md">{description}</div>}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </AdminCard>
      )}

      {/* Refresh */}
      <div className="flex justify-center">
        <button onClick={async () => { setRefreshing(true); try { await load() } finally { setRefreshing(false) } }} disabled={refreshing}
          className="flex items-center gap-1.5 px-4 py-2 bg-foreground/5 text-foreground/60 rounded-lg text-xs font-semibold hover:bg-foreground/8 transition-colors border border-foreground/10 disabled:opacity-40">
          {refreshing ? <InlineSpinner size={14} /> : <ArrowClockwise size={14} />} Aktualisieren
        </button>
      </div>
    </div>
  )
}

// ─── Protocol Overview tab ──────────────────────────────────────────────
//
// Combined live snapshot of every IoT protocol the home is talking to.
// Single GET to /api/admin/protocols/overview returns counts and
// availability for HA, MQTT, Zigbee, Z-Wave, Matter, BLE and HomeKit so
// the user does not have to click through each protocol tab to see if
// something is offline.
interface ProtocolsSnapshot {
  ha?: { available: boolean; version?: string; entity_count?: number }
  mqtt?: { connected: boolean; message_count: number; subscriptions: number }
  zigbee?: { enabled: boolean; device_count: number; mode?: string }
  zwave?: { enabled: boolean; node_count: number }
  matter?: { enabled: boolean; device_count: number }
  ble?: { enabled: boolean; device_count: number }
  homekit?: { enabled: boolean; accessory_count: number; bridge_available: boolean }
  integrations?: Array<{ domain: string; available: boolean }>
}

function ProtocolsOverviewTab({ token }: { token: string }) {
  const [data, setData] = useState<ProtocolsSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await adminFetch('/api/admin/protocols/overview', token)
      setData(r as ProtocolsSnapshot)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  const protocolCard = (
    label: string,
    icon: typeof Cpu,
    enabled: boolean | undefined,
    primary: string,
    secondary?: string,
  ) => {
    const Icon = icon
    return (
      <div className="rounded-xl border border-foreground/10 bg-foreground/[0.03] p-4">
        <div className="flex items-center gap-2 mb-2">
          <Icon size={16} className={enabled ? 'text-green-400' : 'text-foreground/30'} />
          <span className="text-sm font-semibold text-foreground">{label}</span>
          <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded ${enabled ? 'bg-green-500/15 text-green-300' : 'bg-foreground/10 text-foreground/40'}`}>
            {enabled ? 'aktiv' : 'inaktiv'}
          </span>
        </div>
        <div className="text-xs font-medium text-foreground">{primary}</div>
        {secondary && <div className="text-[11px] text-foreground/50 mt-0.5">{secondary}</div>}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <AdminCard title="Protokoll-Übersicht" icon={Stack}>
        {loading && <p className="text-xs text-foreground/50">Lade Protokoll-Status…</p>}
        {error && <p className="text-xs text-red-300">{error}</p>}
        {data && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {protocolCard('Home Assistant', Pulse, data.ha?.available,
              data.ha?.available ? `v${data.ha.version ?? '?'}` : 'nicht erreichbar',
              `${data.ha?.entity_count ?? 0} Entitäten im Cache`)}
            {protocolCard('MQTT', WifiHigh, data.mqtt?.connected,
              data.mqtt?.connected ? `${data.mqtt.message_count} Nachrichten` : 'getrennt',
              `${data.mqtt?.subscriptions ?? 0} Abonnements`)}
            {protocolCard('Zigbee', Tree, data.zigbee?.enabled,
              `${data.zigbee?.device_count ?? 0} Geräte`,
              data.zigbee?.mode ? `Modus: ${data.zigbee.mode}` : undefined)}
            {protocolCard('Z-Wave', LinkSimple, data.zwave?.enabled,
              `${data.zwave?.node_count ?? 0} Nodes`)}
            {protocolCard('Matter', HardDrive, data.matter?.enabled,
              `${data.matter?.device_count ?? 0} Geräte`)}
            {protocolCard('Bluetooth', Bluetooth, data.ble?.enabled,
              `${data.ble?.device_count ?? 0} Geräte`)}
            {protocolCard('HomeKit', AppleLogo, data.homekit?.enabled,
              `${data.homekit?.accessory_count ?? 0} Accessoires`,
              data.homekit?.bridge_available ? 'Bridge online' : 'Bridge offline')}
          </div>
        )}
      </AdminCard>

      {data?.integrations && data.integrations.length > 0 && (
        <AdminCard title="HA-Integrationen" icon={Cube}>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5">
            {data.integrations.map((i) => (
              <div key={i.domain} className="flex items-center gap-1.5 px-2 py-1 rounded bg-foreground/5 text-[11px]">
                <span className={`h-1.5 w-1.5 rounded-full ${i.available ? 'bg-green-400' : 'bg-foreground/30'}`} />
                <span className="font-mono text-foreground/70 truncate">{i.domain}</span>
              </div>
            ))}
          </div>
        </AdminCard>
      )}

      <div className="flex justify-center">
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 px-4 py-2 bg-foreground/5 text-foreground/60 rounded-lg text-xs font-semibold hover:bg-foreground/8 transition-colors border border-foreground/10 disabled:opacity-40">
          <ArrowClockwise size={14} /> Aktualisieren
        </button>
      </div>
    </div>
  )
}

// ─── HA Developer Tools tab ─────────────────────────────────────────────
//
// Three power-user features that mirror Home Assistant's own Developer
// Tools page: render a Jinja2 template, fire an event into HA's bus, and
// browse the entity / device / area registries that HA reports.
function HaDeveloperToolsTab({ token }: { token: string }) {
  const [tpl, setTpl] = useState('{{ states.sensor | count }} sensor entities')
  const [tplResult, setTplResult] = useState<string | null>(null)
  const [tplBusy, setTplBusy] = useState(false)
  const [tplError, setTplError] = useState<string | null>(null)

  const [evtType, setEvtType] = useState('iora_test_event')
  const [evtData, setEvtData] = useState('{"source":"admin","value":42}')
  const [evtBusy, setEvtBusy] = useState(false)
  const [evtMsg, setEvtMsg] = useState<string | null>(null)
  const [evtError, setEvtError] = useState<string | null>(null)

  const [registry, setRegistry] = useState<'entities' | 'devices' | 'areas'>('entities')
  const [regData, setRegData] = useState<Record<string, unknown> | null>(null)
  const [regBusy, setRegBusy] = useState(false)
  const [regError, setRegError] = useState<string | null>(null)

  const renderTpl = async () => {
    setTplBusy(true); setTplError(null); setTplResult(null)
    try {
      const r = await adminFetch('/api/admin/ha/template', token, {
        method: 'POST', body: JSON.stringify({ template: tpl }),
      })
      setTplResult(typeof r?.result === 'string' ? r.result : JSON.stringify(r?.result ?? r, null, 2))
    } catch (e) {
      setTplError(e instanceof Error ? e.message : String(e))
    } finally {
      setTplBusy(false)
    }
  }

  const fireEvt = async () => {
    setEvtBusy(true); setEvtError(null); setEvtMsg(null)
    let parsed: unknown = {}
    try {
      parsed = evtData.trim() ? JSON.parse(evtData) : {}
    } catch (e) {
      setEvtError(`Ungültiges JSON: ${e instanceof Error ? e.message : String(e)}`)
      setEvtBusy(false); return
    }
    try {
      await adminFetch(`/api/admin/ha/events/${encodeURIComponent(evtType)}`, token, {
        method: 'POST', body: JSON.stringify(parsed),
      })
      setEvtMsg(`Event "${evtType}" gesendet.`)
      toast.success(`Event ${evtType} gefeuert`)
    } catch (e) {
      setEvtError(e instanceof Error ? e.message : String(e))
    } finally {
      setEvtBusy(false)
    }
  }

  const loadRegistry = useCallback(async (kind: 'entities' | 'devices' | 'areas') => {
    setRegBusy(true); setRegError(null)
    try {
      const r = await adminFetch(`/api/admin/ha/registry/${kind}`, token)
      setRegData(r as Record<string, unknown>)
    } catch (e) {
      setRegError(e instanceof Error ? e.message : String(e))
    } finally {
      setRegBusy(false)
    }
  }, [token])

  useEffect(() => { loadRegistry(registry) }, [registry, loadRegistry])

  return (
    <div className="space-y-3">
      <AdminCard title="Template rendern" icon={Code}>
        <p className="text-xs text-foreground/60 mb-2">
          Sendet die Vorlage an Home Assistant zum Rendern. Identisch mit
          dem Tab „Template" in HAs Developer Tools.
        </p>
        <textarea
          value={tpl}
          onChange={(e) => setTpl(e.target.value)}
          rows={4}
          spellCheck={false}
          className="w-full font-mono text-xs bg-foreground/5 border border-foreground/10 rounded-lg p-3 text-foreground"
        />
        <div className="mt-2 flex items-center gap-2">
          <button onClick={renderTpl} disabled={tplBusy || !tpl.trim()}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-40">
            {tplBusy ? 'Rendere…' : 'Rendern'}
          </button>
          {tplError && <span className="text-[11px] text-red-300">{tplError}</span>}
        </div>
        {tplResult !== null && (
          <pre className="mt-3 text-xs font-mono whitespace-pre-wrap break-words bg-foreground/5 border border-foreground/10 rounded-lg p-3 text-foreground/85 max-h-64 overflow-auto">{tplResult}</pre>
        )}
      </AdminCard>

      <AdminCard title="Event feuern" icon={PaperPlaneTilt}>
        <p className="text-xs text-foreground/60 mb-2">
          Sendet ein Event auf den Event-Bus von Home Assistant. Nützlich
          zum Testen von Automatisierungs-Triggern.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input
            value={evtType}
            onChange={(e) => setEvtType(e.target.value)}
            placeholder="event_type"
            className="font-mono text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground sm:col-span-1"
          />
          <textarea
            value={evtData}
            onChange={(e) => setEvtData(e.target.value)}
            rows={2}
            spellCheck={false}
            placeholder='{"key":"value"}'
            className="font-mono text-xs bg-foreground/5 border border-foreground/10 rounded-lg p-2 text-foreground sm:col-span-2"
          />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <button onClick={fireEvt} disabled={evtBusy || !evtType.trim()}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-40">
            {evtBusy ? 'Sende…' : 'Event feuern'}
          </button>
          {evtMsg && <span className="text-[11px] text-green-300">{evtMsg}</span>}
          {evtError && <span className="text-[11px] text-red-300">{evtError}</span>}
        </div>
      </AdminCard>

      <AdminCard title="HA Registry" icon={Database}>
        <div className="flex items-center gap-1 mb-3">
          {(['entities', 'devices', 'areas'] as const).map((k) => (
            <button key={k} onClick={() => setRegistry(k)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                registry === k ? 'bg-accent/20 text-accent' : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/10'
              }`}>
              {k === 'entities' ? 'Entities' : k === 'devices' ? 'Devices' : 'Areas'}
            </button>
          ))}
          <button onClick={() => loadRegistry(registry)} disabled={regBusy}
            className="ml-auto p-1.5 rounded-lg bg-foreground/5 text-foreground/60 hover:bg-foreground/10 disabled:opacity-40">
            <ArrowClockwise size={13} />
          </button>
        </div>
        {regBusy && <p className="text-xs text-foreground/50">Lade…</p>}
        {regError && <p className="text-xs text-red-300">{regError}</p>}
        {regData && !regBusy && (
          <pre className="text-[11px] font-mono whitespace-pre-wrap break-words bg-foreground/5 border border-foreground/10 rounded-lg p-3 text-foreground/85 max-h-96 overflow-auto">{JSON.stringify(regData, null, 2)}</pre>
        )}
      </AdminCard>
    </div>
  )
}

// ─── Global Alert tab ───────────────────────────────────────────────────
//
// Sets / clears the cluster-wide emergency banner that is broadcast to
// every connected dashboard via WebSocket. Backed by ACTIVE_EMERGENCY in
// iora-home and the /api/admin/alert GET/PUT/DELETE trio.
function GlobalAlertTab({ token }: { token: string }) {
  const [active, setActive] = useState<boolean>(false)
  const [current, setCurrent] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [title, setTitle] = useState('Wartungsarbeiten')
  const [message, setMessage] = useState('Das System wird in Kürze neu gestartet.')
  const [level, setLevel] = useState<'info' | 'warning' | 'critical'>('warning')

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const r = await adminFetch('/api/admin/alert', token)
      setActive(r?.active === true)
      setCurrent((r?.alert ?? null) as Record<string, unknown> | null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  const send = async () => {
    setBusy(true); setError(null)
    try {
      await adminFetch('/api/admin/alert', token, {
        method: 'PUT',
        body: JSON.stringify({ title, message, level }),
      })
      toast.success('Globaler Alarm gesetzt')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const dismiss = async () => {
    setBusy(true); setError(null)
    try {
      await adminFetch('/api/admin/alert', token, { method: 'DELETE' })
      toast.success('Alarm zurückgenommen')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const levelColor = level === 'critical' ? 'bg-red-500/20 border-red-500/40 text-red-200'
    : level === 'warning' ? 'bg-amber-500/20 border-amber-500/40 text-amber-200'
    : 'bg-blue-500/20 border-blue-500/40 text-blue-200'

  return (
    <div className="space-y-3">
      <AdminCard title="Aktiver Alarm" icon={Megaphone}>
        {loading ? (
          <p className="text-xs text-foreground/50">Lade Status…</p>
        ) : active && current ? (
          <div className="space-y-3">
            <div className={`p-3 rounded-xl border ${levelColor}`}>
              <div className="text-sm font-semibold">{String(current.title ?? '')}</div>
              <div className="text-xs mt-1 opacity-90">{String(current.message ?? '')}</div>
              <div className="text-[10px] opacity-60 mt-2">
                Level: <span className="font-mono">{String(current.level ?? '')}</span>
                {current.created_at != null && current.created_at !== '' && <> · {String(current.created_at)}</>}
              </div>
            </div>
            <button onClick={dismiss} disabled={busy}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-500/20 text-red-200 hover:bg-red-500/30 disabled:opacity-40">
              Alarm zurücknehmen
            </button>
          </div>
        ) : (
          <p className="text-xs text-foreground/60">Kein aktiver Alarm.</p>
        )}
      </AdminCard>

      <AdminCard title="Neuen Alarm setzen" icon={Siren}>
        <div className="space-y-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titel"
            className="w-full text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground" />
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} placeholder="Nachricht"
            className="w-full text-xs bg-foreground/5 border border-foreground/10 rounded-lg p-3 text-foreground" />
          <div className="flex items-center gap-1">
            {(['info', 'warning', 'critical'] as const).map((l) => (
              <button key={l} onClick={() => setLevel(l)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold capitalize transition-colors ${
                  level === l ? 'bg-accent/20 text-accent' : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/10'
                }`}>{l}</button>
            ))}
            <button onClick={send} disabled={busy || !title.trim() || !message.trim()}
              className="ml-auto px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-40">
              {busy ? 'Sende…' : 'Senden'}
            </button>
          </div>
          {error && <p className="text-[11px] text-red-300">{error}</p>}
          <p className="text-[11px] text-foreground/40">
            Der Alarm wird sofort an alle verbundenen Clients per WebSocket
            zugestellt und persistiert als Benachrichtigung in der DB.
          </p>
        </div>
      </AdminCard>
    </div>
  )
}

// ─── Notifications tab ──────────────────────────────────────────────────
//
// Generic notification feed produced by the backend. Distinct from
// system-notifications (those are sync/data-quality alerts); this view
// shows everything that lands in the notifications table — alerts,
// admin-set banners, plugin output, etc.
interface NotificationRow {
  id: string
  title: string
  message: string
  level: string
  source?: string
  icon?: string
  entity_id?: string
  created_at: string
  read: boolean
  auto_dismiss_secs?: number
}

function NotificationsTab({ token }: { token: string }) {
  const [items, setItems] = useState<NotificationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'unread' | 'critical'>('all')

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const r = await adminFetch('/api/admin/notifications', token)
      setItems(Array.isArray(r) ? r : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  const markRead = async (id: string) => {
    try {
      await adminFetch(`/api/admin/notifications/${encodeURIComponent(id)}/read`, token, { method: 'PUT' })
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const dismiss = async (id: string) => {
    try {
      await adminFetch(`/api/admin/notifications/${encodeURIComponent(id)}`, token, { method: 'DELETE' })
      setItems((prev) => prev.filter((n) => n.id !== id))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const clearAll = async () => {
    if (!confirm('Wirklich alle Benachrichtigungen löschen?')) return
    try {
      await adminFetch('/api/admin/notifications', token, { method: 'DELETE' })
      setItems([])
      toast.success('Alle Benachrichtigungen gelöscht')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const filtered = items.filter((n) => {
    if (filter === 'unread') return !n.read
    if (filter === 'critical') return n.level === 'critical' || n.level === 'error'
    return true
  })

  const levelStyle = (lvl: string) => {
    if (lvl === 'critical' || lvl === 'error') return 'border-red-500/40 bg-red-500/10'
    if (lvl === 'warning') return 'border-amber-500/40 bg-amber-500/10'
    if (lvl === 'success') return 'border-green-500/40 bg-green-500/10'
    return 'border-foreground/10 bg-foreground/5'
  }

  return (
    <div className="space-y-3">
      <AdminCard title="Benachrichtigungen" icon={Bell}>
        <div className="flex items-center gap-1 mb-3">
          {(['all', 'unread', 'critical'] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                filter === f ? 'bg-accent/20 text-accent' : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/10'
              }`}>
              {f === 'all' ? 'Alle' : f === 'unread' ? 'Ungelesen' : 'Kritisch'}
            </button>
          ))}
          <button onClick={load} disabled={loading}
            className="ml-auto p-1.5 rounded-lg bg-foreground/5 text-foreground/60 hover:bg-foreground/10 disabled:opacity-40">
            <ArrowClockwise size={13} />
          </button>
          <button onClick={clearAll} disabled={loading || items.length === 0}
            className="p-1.5 rounded-lg bg-red-500/15 text-red-300 hover:bg-red-500/25 disabled:opacity-40">
            <Trash size={13} />
          </button>
        </div>

        {loading && <p className="text-xs text-foreground/50">Lade Benachrichtigungen…</p>}
        {error && <p className="text-xs text-red-300">{error}</p>}
        {!loading && !error && filtered.length === 0 && (
          <p className="text-xs text-foreground/50">Keine Benachrichtigungen.</p>
        )}

        <div className="space-y-2">
          {filtered.map((n) => (
            <div key={n.id} className={`rounded-xl border p-3 ${levelStyle(n.level)} ${n.read ? 'opacity-60' : ''}`}>
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-foreground truncate">{n.title}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-foreground/10 text-foreground/60 font-mono uppercase">
                      {n.level}
                    </span>
                    {!n.read && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
                  </div>
                  <p className="text-xs text-foreground/70 break-words">{n.message}</p>
                  <div className="text-[10px] text-foreground/40 mt-1.5 flex items-center gap-2 flex-wrap">
                    <span>{new Date(n.created_at).toLocaleString('de-DE')}</span>
                    {n.source && <span>· {n.source}</span>}
                    {n.entity_id && <span className="font-mono">· {n.entity_id}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {!n.read && (
                    <button onClick={() => markRead(n.id)} title="Als gelesen markieren"
                      className="p-1.5 rounded-lg bg-foreground/5 text-foreground/60 hover:bg-foreground/10">
                      <Eye size={13} />
                    </button>
                  )}
                  <button onClick={() => dismiss(n.id)} title="Löschen"
                    className="p-1.5 rounded-lg bg-red-500/15 text-red-300 hover:bg-red-500/25">
                    <X size={13} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </AdminCard>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
// IORA AI MANAGEMENT TABS
// ════════════════════════════════════════════════════════════════════════
//
// The AI subsystem (iora-assist) exposes a rich `/api/assist/*` API that
// previously had no admin UI. These six tabs cover the full surface:
//
//   - AiOverviewTab       /api/assist/health, /api/assist/config/stats
//   - AiProvidersTab      /api/assist/providers, /api/assist/config/providers
//   - AiConversationsTab  /api/assist/history, /api/assist/config/threads,
//                         /api/assist/config/notifications
//   - AiTasksTab          /api/assist/config/tasks
//   - AiToolsTab          /api/assist/tools/{search,scrape,screenshot}
//   - AiVoiceTab          /api/assist/voice/{transcribe,synthesize}
//
// All requests go through the same `adminFetch` helper because the nginx
// front-door proxies `/api/assist/*` to iora-assist transparently.

// ─── AI Overview ────────────────────────────────────────────────────────
function AiOverviewTab({ token }: { token: string }) {
  const [health, setHealth] = useState<Record<string, unknown> | null>(null)
  const [stats, setStats] = useState<Record<string, unknown> | null>(null)
  const [providers, setProviders] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    const safe = async <T,>(p: Promise<T>): Promise<T | null> => {
      try { return await p } catch { return null }
    }
    const [h, s, p] = await Promise.all([
      safe(adminFetch('/api/assist/health', token)),
      safe(adminFetch('/api/assist/config/stats', token)),
      safe(adminFetch('/api/assist/providers', token)),
    ])
    setHealth(h as Record<string, unknown> | null)
    setStats(s as Record<string, unknown> | null)
    setProviders(p as Record<string, unknown> | null)
    if (!h && !s && !p) setError('iora-assist ist nicht erreichbar.')
    setLoading(false)
  }, [token])

  useEffect(() => { load() }, [load])

  const stat = (label: string, value: React.ReactNode, sub?: string) => (
    <div className="rounded-xl bg-foreground/[0.04] border border-foreground/10 p-3">
      <div className="text-[10px] uppercase tracking-wide text-foreground/40">{label}</div>
      <div className="text-base font-semibold text-foreground mt-1">{value}</div>
      {sub && <div className="text-[11px] text-foreground/50 mt-0.5">{sub}</div>}
    </div>
  )

  const aiAvailable = health?.ai_available === true
  const providerName = String(health?.ai_provider ?? '–')
  const uptime = Number(health?.uptime_seconds ?? 0)
  const caps = (health?.capabilities ?? {}) as Record<string, boolean>

  return (
    <div className="space-y-3">
      <AdminCard title="IORA Assist Status" icon={Brain}>
        {loading ? (
          <p className="text-xs text-foreground/50">Lade Status…</p>
        ) : error ? (
          <p className="text-xs text-red-300">{error}</p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {stat('Provider', providerName, aiAvailable ? 'verbunden' : 'getrennt')}
              {stat('Uptime', formatUptime(uptime))}
              {stat('Status', aiAvailable ? 'OK' : 'OFFLINE')}
              {stat('Service', String(health?.service ?? 'iora-assist'))}
            </div>

            <div className="rounded-xl bg-foreground/[0.04] border border-foreground/10 p-3">
              <div className="text-xs font-semibold text-foreground mb-2">Fähigkeiten</div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(caps).map(([k, v]) => (
                  <span key={k} className={`text-[11px] px-2 py-0.5 rounded-full ${v ? 'bg-green-500/15 text-green-300' : 'bg-foreground/10 text-foreground/40'}`}>
                    {k} {v ? '✓' : '×'}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </AdminCard>

      {stats && (
        <AdminCard title="Orchestrator Statistiken" icon={ChartLine}>
          <pre className="text-[11px] font-mono whitespace-pre-wrap break-words bg-foreground/5 border border-foreground/10 rounded-lg p-3 text-foreground/80 max-h-72 overflow-auto">{JSON.stringify(stats?.stats ?? stats, null, 2)}</pre>
        </AdminCard>
      )}

      {providers && (
        <AdminCard title="Aktive Provider" icon={MagicWand}>
          <pre className="text-[11px] font-mono whitespace-pre-wrap break-words bg-foreground/5 border border-foreground/10 rounded-lg p-3 text-foreground/80 max-h-72 overflow-auto">{JSON.stringify(providers, null, 2)}</pre>
        </AdminCard>
      )}

      <div className="flex justify-center">
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 px-4 py-2 bg-foreground/5 text-foreground/60 rounded-lg text-xs font-semibold hover:bg-foreground/10 transition-colors border border-foreground/10 disabled:opacity-40">
          <ArrowClockwise size={14} /> Aktualisieren
        </button>
      </div>
    </div>
  )
}

// ─── AI Providers ───────────────────────────────────────────────────────
interface AiProviderConfig {
  id?: string
  provider_type: string
  purpose: string
  config?: Record<string, unknown>
  priority?: number
  enabled?: boolean
  // Set by 008 migration; backend returns these via SELECT *
  model_count?: number
  last_model_fetch_at?: string | null
  last_model_fetch_error?: string | null
}

// Mirrors the response of `GET /api/assist/models`
interface GlobalModelsGroup {
  provider_id: string
  provider_type: string
  purpose: string
  is_live: boolean
  model_count: number
  models: Array<{ id: string; name: string; last_seen?: string; is_live?: boolean }>
}

function AiProvidersTab({ token }: { token: string }) {
  const [active, setActive] = useState<Record<string, unknown> | null>(null)
  const [list, setList] = useState<AiProviderConfig[]>([])
  const [globalModels, setGlobalModels] = useState<GlobalModelsGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshingId, setRefreshingId] = useState<string | null>(null)

  const [showForm, setShowForm] = useState(false)
  const [providerType, setProviderType] = useState('openai')
  const [purpose, setPurpose] = useState('chat')
  const [priority, setPriority] = useState(0)
  const [configJson, setConfigJson] = useState('{\n  "api_key": "",\n  "model": "gpt-4o-mini"\n}')
  const [saving, setSaving] = useState(false)

  const [switchTarget, setSwitchTarget] = useState('')
  const [switching, setSwitching] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [a, l, m] = await Promise.all([
        adminFetch('/api/assist/providers', token).catch(() => null),
        adminFetch('/api/assist/config/providers', token).catch(() => null),
        adminFetch('/api/assist/models', token).catch(() => null),
      ])
      setActive(a as Record<string, unknown> | null)
      const arr = (l as Record<string, unknown> | null)?.providers
      setList(Array.isArray(arr) ? (arr as AiProviderConfig[]) : [])
      const groups = (m as Record<string, unknown> | null)?.providers
      setGlobalModels(Array.isArray(groups) ? (groups as GlobalModelsGroup[]) : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  const create = async () => {
    setSaving(true); setError(null)
    let cfg: Record<string, unknown>
    try { cfg = JSON.parse(configJson) } catch (e) {
      setError(`Ungültiges JSON: ${e instanceof Error ? e.message : String(e)}`)
      setSaving(false); return
    }
    try {
      await adminFetch('/api/assist/config/providers', token, {
        method: 'POST',
        body: JSON.stringify({ provider_type: providerType, purpose, priority, config: cfg }),
      })
      toast.success('Provider gespeichert — Modelle werden im Hintergrund geladen')
      setShowForm(false)
      // Give the backend a moment to fetch models, then reload.
      setTimeout(load, 1500)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const refreshModels = async (providerId: string) => {
    setRefreshingId(providerId); setError(null)
    try {
      const res: any = await adminFetch(
        `/api/assist/config/providers/${providerId}/refresh-models`,
        token,
        { method: 'POST' },
      )
      toast.success(`${res?.model_count ?? 0} Modelle aktualisiert`)
      await load()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(`Refresh fehlgeschlagen: ${msg}`)
      toast.error(`Refresh fehlgeschlagen: ${msg}`)
    } finally {
      setRefreshingId(null)
    }
  }

  const deleteProvider = async (providerId: string) => {
    if (!confirm('Provider löschen? Verknüpfte Modelle werden ebenfalls entfernt.')) return
    try {
      await adminFetch(`/api/assist/config/providers/${providerId}`, token, { method: 'DELETE' })
      toast.success('Provider gelöscht')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const switchProvider = async () => {
    if (!switchTarget.trim()) return
    setSwitching(true); setError(null)
    try {
      await adminFetch('/api/assist/providers/switch', token, {
        method: 'POST',
        body: JSON.stringify({ provider: switchTarget }),
      })
      toast.success(`Aktiver Provider: ${switchTarget}`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSwitching(false)
    }
  }

  const totalModels = globalModels.reduce((sum, g) => sum + g.model_count, 0)

  // Pre-fill helpful config templates when the user picks a provider type.
  const configTemplate = (t: string): string => {
    switch (t) {
      case 'openai':
        return '{\n  "api_key": "sk-...",\n  "model": "gpt-4o-mini",\n  "base_url": "https://api.openai.com/v1"\n}'
      case 'anthropic':
        return '{\n  "api_key": "sk-ant-...",\n  "model": "claude-3-5-sonnet-latest",\n  "base_url": "https://api.anthropic.com"\n}'
      case 'local':
        return '{\n  "base_url": "",\n  "model": "llama3.2"\n}'
      case 'desktop':
        return '{\n  "base_url": "https://your-desktop-ai-proxy/v1",\n  "api_key": "lm-studio",\n  "model": "auto"\n}'
      case 'deepseek':
        return '{\n  "api_key": "sk-...",\n  "model": "deepseek-chat",\n  "base_url": "https://api.deepseek.com"\n}'
      case 'grok':
        return '{\n  "api_key": "xai-...",\n  "model": "grok-2-latest",\n  "base_url": "https://api.x.ai/v1"\n}'
      case 'mistral':
        return '{\n  "api_key": "...",\n  "model": "mistral-large-latest",\n  "base_url": "https://api.mistral.ai/v1"\n}'
      case 'cohere':
        return '{\n  "api_key": "...",\n  "model": "command-r-plus",\n  "base_url": "https://api.cohere.com"\n}'
      case 'together':
        return '{\n  "api_key": "...",\n  "model": "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",\n  "base_url": "https://api.together.xyz/v1"\n}'
      case 'fireworks':
        return '{\n  "api_key": "...",\n  "model": "accounts/fireworks/models/llama-v3p1-70b-instruct",\n  "base_url": "https://api.fireworks.ai/inference/v1"\n}'
      case 'perplexity':
        return '{\n  "api_key": "pplx-...",\n  "model": "llama-3.1-sonar-large-128k-online",\n  "base_url": "https://api.perplexity.ai"\n}'
      case 'compatible':
        return '{\n  "api_key": "",\n  "base_url": "https://your-host/v1",\n  "model": "your-model"\n}'
      default:
        return '{}'
    }
  }

  const formatTime = (iso?: string | null) => {
    if (!iso) return 'nie'
    try { return new Date(iso).toLocaleString() } catch { return iso }
  }

  return (
    <div className="space-y-3">
      <AdminCard title="Aktiver Provider" icon={MagicWand}>
        {loading ? (
          <p className="text-xs text-foreground/50">Lade…</p>
        ) : (
          <div className="space-y-3">
            <pre className="text-[11px] font-mono whitespace-pre-wrap bg-foreground/5 border border-foreground/10 rounded-lg p-3 text-foreground/80 max-h-48 overflow-auto">{JSON.stringify(active, null, 2)}</pre>
            <div className="flex items-center gap-2">
              <input value={switchTarget} onChange={(e) => setSwitchTarget(e.target.value)}
                placeholder="openai | anthropic | local | desktop"
                className="flex-1 text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground" />
              <button onClick={switchProvider} disabled={switching || !switchTarget.trim()}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-40">
                {switching ? 'Wechsle…' : 'Provider wechseln'}
              </button>
            </div>
          </div>
        )}
      </AdminCard>

      <AdminCard title={`Globaler Model-Katalog (${totalModels} Modelle)`} icon={Brain}>
        <p className="text-[11px] text-foreground/50 mb-2">
          Modelle werden beim Anlegen eines Providers automatisch geladen, alle 30&nbsp;Min. für Cloud-Provider
          und alle 60&nbsp;Sek. für lokale/Desktop-Provider aktualisiert. Sie stehen global für ORA AI
          und das Agent-System zur Verfügung.
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              try { await adminFetch('/api/assist/models/refresh', token, { method: 'POST' }); toast.success('Refresh angestoßen'); await load() } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
            }}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent/20 text-accent hover:bg-accent/30"
          >
            Alle Modelle jetzt aktualisieren
          </button>
        </div>
      </AdminCard>

      <AdminCard title="Konfigurierte Provider" icon={Database}>
        <div className="flex items-center gap-2 mb-3">
          <button onClick={() => setShowForm((s) => !s)}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent/20 text-accent hover:bg-accent/30">
            {showForm ? 'Abbrechen' : <span className="flex items-center gap-1"><Plus size={12} /> Neu</span>}
          </button>
          <button onClick={load} disabled={loading}
            className="ml-auto p-1.5 rounded-lg bg-foreground/5 text-foreground/60 hover:bg-foreground/10 disabled:opacity-40">
            <ArrowClockwise size={13} />
          </button>
        </div>

        {showForm && (
          <div className="rounded-xl bg-foreground/[0.04] border border-foreground/10 p-3 mb-3 space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] uppercase tracking-wide text-foreground/40">Typ</label>
                <select value={providerType}
                  onChange={(e) => { setProviderType(e.target.value); setConfigJson(configTemplate(e.target.value)) }}
                  className="w-full mt-1 text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground">
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic (Claude)</option>
                  <option value="deepseek">DeepSeek</option>
                  <option value="grok">xAI (Grok)</option>
                  <option value="mistral">Mistral</option>
                  <option value="cohere">Cohere</option>
                  <option value="together">Together AI</option>
                  <option value="fireworks">Fireworks AI</option>
                  <option value="perplexity">Perplexity</option>
                  <option value="local">Local (Ollama / llama.cpp)</option>
                  <option value="desktop">Desktop (IORA Desktop bridge / LM Studio)</option>
                  <option value="compatible">OpenAI-Compatible (custom)</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wide text-foreground/40">Verwendung</label>
                <select value={purpose} onChange={(e) => setPurpose(e.target.value)}
                  className="w-full mt-1 text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground">
                  <option value="chat">chat</option>
                  <option value="general">general</option>
                  <option value="agent">agent (Code-Aufgaben)</option>
                  <option value="voice_stt">voice_stt</option>
                  <option value="voice_tts">voice_tts</option>
                  <option value="embeddings">embeddings</option>
                  <option value="vision">vision</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wide text-foreground/40">Priorität</label>
                <input type="number" value={priority} onChange={(e) => setPriority(Number(e.target.value))}
                  className="w-full mt-1 text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground" />
              </div>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wide text-foreground/40">Konfiguration (JSON)</label>
              <textarea value={configJson} onChange={(e) => setConfigJson(e.target.value)} rows={6} spellCheck={false}
                className="w-full mt-1 font-mono text-xs bg-foreground/5 border border-foreground/10 rounded-lg p-3 text-foreground" />
              <p className="text-[10px] text-foreground/40 mt-1">
                Beim Speichern werden verfügbare Modelle automatisch beim Provider abgerufen und gespeichert.
              </p>
            </div>
            <button onClick={create} disabled={saving}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-40">
              {saving ? 'Speichere…' : 'Provider anlegen + Modelle laden'}
            </button>
          </div>
        )}

        {error && <p className="text-xs text-red-300 mb-2">{error}</p>}

        {list.length === 0 ? (
          <p className="text-xs text-foreground/50">Keine konfigurierten Provider in der Datenbank.</p>
        ) : (
          <div className="space-y-2">
            {list.map((p, i) => {
              const group = globalModels.find((g) => g.provider_id === p.id)
              return (
                <div key={p.id ?? i} className="rounded-xl bg-foreground/5 border border-foreground/10 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-semibold text-foreground">{p.provider_type}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-foreground/10 text-foreground/60 font-mono">{p.purpose}</span>
                    {group?.is_live && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono">live</span>
                    )}
                    <span className="ml-auto text-[10px] text-foreground/40">prio: {p.priority ?? 0}</span>
                    {p.id && (
                      <>
                        <button
                          onClick={() => refreshModels(p.id!)}
                          disabled={refreshingId === p.id}
                          title="Modelle für diesen Provider neu laden"
                          className="px-2 py-0.5 text-[10px] rounded bg-foreground/10 text-foreground/70 hover:bg-foreground/20 disabled:opacity-40"
                        >
                          {refreshingId === p.id ? 'Lade…' : 'Refresh'}
                        </button>
                        <button
                          onClick={() => deleteProvider(p.id!)}
                          title="Provider löschen"
                          className="px-2 py-0.5 text-[10px] rounded bg-red-500/15 text-red-300 hover:bg-red-500/30"
                        >
                          Löschen
                        </button>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-foreground/50 mb-2">
                    <span>Modelle: <span className="text-foreground/80 font-mono">{p.model_count ?? group?.model_count ?? 0}</span></span>
                    <span>Letztes Update: <span className="font-mono">{formatTime(p.last_model_fetch_at)}</span></span>
                  </div>
                  {p.last_model_fetch_error && (
                    <p className="text-[10px] text-red-300 mb-2 font-mono">⚠ {p.last_model_fetch_error}</p>
                  )}
                  {group && group.models.length > 0 && (
                    <details className="mb-2">
                      <summary className="text-[10px] text-foreground/50 cursor-pointer hover:text-foreground/80">
                        Modelle anzeigen ({group.models.length})
                      </summary>
                      <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-1">
                        {group.models.map((m) => (
                          <span key={m.id} className="text-[10px] font-mono px-2 py-1 rounded bg-foreground/5 text-foreground/70 truncate">
                            {m.name}
                          </span>
                        ))}
                      </div>
                    </details>
                  )}
                  {p.config && (
                    <details>
                      <summary className="text-[10px] text-foreground/40 cursor-pointer hover:text-foreground/70">Konfiguration</summary>
                      <pre className="mt-1 text-[10px] font-mono whitespace-pre-wrap break-words bg-foreground/5 rounded p-2 text-foreground/70 max-h-32 overflow-auto">{JSON.stringify(p.config, null, 2)}</pre>
                    </details>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </AdminCard>
    </div>
  )
}

// ─── AI Conversations ───────────────────────────────────────────────────
interface AiHistoryMsg { id: string; role: string; content: string; timestamp?: string }
interface AiThread { id?: string; user_id?: string; created_at?: string; context?: unknown; message_count?: number }
interface AiPendingNotification { id?: string; message: string; notification_type?: string; priority?: number; created_at?: string }

function AiConversationsTab({ token }: { token: string }) {
  const [history, setHistory] = useState<AiHistoryMsg[]>([])
  const [threads, setThreads] = useState<AiThread[]>([])
  const [notifications, setNotifications] = useState<AiPendingNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'history' | 'threads' | 'notifications'>('history')

  const [chatInput, setChatInput] = useState('')
  const [chatBusy, setChatBusy] = useState(false)

  const [notifMsg, setNotifMsg] = useState('')
  const [notifType, setNotifType] = useState('info')
  const [notifPrio, setNotifPrio] = useState(1)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [h, t, n] = await Promise.all([
        adminFetch('/api/assist/history', token).catch(() => null),
        adminFetch('/api/assist/config/threads', token).catch(() => null),
        adminFetch('/api/assist/config/notifications', token).catch(() => null),
      ])
      const hr = h as Record<string, unknown> | null
      const tr = t as Record<string, unknown> | null
      const nr = n as Record<string, unknown> | null
      setHistory(Array.isArray(hr?.messages) ? (hr.messages as AiHistoryMsg[]) : [])
      setThreads(Array.isArray(tr?.threads) ? (tr.threads as AiThread[]) : [])
      setNotifications(Array.isArray(nr?.notifications) ? (nr.notifications as AiPendingNotification[]) : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  const sendChat = async () => {
    if (!chatInput.trim()) return
    setChatBusy(true)
    try {
      await adminFetch('/api/assist/chat', token, {
        method: 'POST',
        body: JSON.stringify({ message: chatInput }),
      })
      setChatInput('')
      toast.success('Nachricht gesendet')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setChatBusy(false)
    }
  }

  const clearHistory = async () => {
    if (!confirm('Verlauf wirklich löschen?')) return
    try {
      await adminFetch('/api/assist/history/clear', token, { method: 'POST' })
      setHistory([])
      toast.success('Verlauf gelöscht')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const sendNotif = async () => {
    if (!notifMsg.trim()) return
    try {
      await adminFetch('/api/assist/config/notifications/send', token, {
        method: 'POST',
        body: JSON.stringify({ message: notifMsg, notification_type: notifType, priority: notifPrio }),
      })
      toast.success('Proaktive Benachrichtigung in Warteschlange')
      setNotifMsg('')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="space-y-3">
      <AdminCard title="Konversationen" icon={ChatCircle}>
        <div className="flex items-center gap-1 mb-3">
          {(['history', 'threads', 'notifications'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                view === v ? 'bg-accent/20 text-accent' : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/10'
              }`}>
              {v === 'history' ? `Verlauf (${history.length})` : v === 'threads' ? `Threads (${threads.length})` : `Benachrichtigungen (${notifications.length})`}
            </button>
          ))}
          <button onClick={load} disabled={loading}
            className="ml-auto p-1.5 rounded-lg bg-foreground/5 text-foreground/60 hover:bg-foreground/10 disabled:opacity-40">
            <ArrowClockwise size={13} />
          </button>
        </div>

        {error && <p className="text-xs text-red-300 mb-2">{error}</p>}
        {loading && <p className="text-xs text-foreground/50">Lade…</p>}

        {!loading && view === 'history' && (
          <div className="space-y-2">
            <div className="flex items-end gap-2">
              <textarea value={chatInput} onChange={(e) => setChatInput(e.target.value)} rows={2} placeholder="Test-Nachricht an den Assistenten…"
                className="flex-1 text-xs bg-foreground/5 border border-foreground/10 rounded-lg p-3 text-foreground" />
              <button onClick={sendChat} disabled={chatBusy || !chatInput.trim()}
                className="px-3 py-2 text-xs font-semibold rounded-lg bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-40">
                {chatBusy ? '…' : 'Senden'}
              </button>
            </div>
            <div className="flex justify-end">
              <button onClick={clearHistory} disabled={history.length === 0}
                className="text-[11px] text-red-300 hover:text-red-200 disabled:opacity-40 flex items-center gap-1"><Trash size={11} /> Verlauf löschen</button>
            </div>
            <div className="space-y-1.5 max-h-96 overflow-auto">
              {history.length === 0 ? (
                <p className="text-xs text-foreground/50">Kein Verlauf.</p>
              ) : history.map((m) => (
                <div key={m.id} className={`rounded-lg p-2.5 border ${m.role === 'user' ? 'bg-accent/10 border-accent/20' : 'bg-foreground/5 border-foreground/10'}`}>
                  <div className="text-[10px] font-mono text-foreground/40 uppercase">{m.role}</div>
                  <div className="text-xs text-foreground/85 whitespace-pre-wrap break-words mt-0.5">{m.content}</div>
                  {m.timestamp && <div className="text-[10px] text-foreground/30 mt-1">{m.timestamp}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        {!loading && view === 'threads' && (
          <div className="space-y-2 max-h-96 overflow-auto">
            {threads.length === 0 ? (
              <p className="text-xs text-foreground/50">Keine aktiven Threads.</p>
            ) : threads.map((t, i) => (
              <div key={t.id ?? i} className="rounded-lg bg-foreground/5 border border-foreground/10 p-3">
                <div className="text-xs font-mono text-foreground/70 break-all">{t.id ?? '–'}</div>
                <div className="text-[10px] text-foreground/40 mt-1">
                  {t.user_id && <span className="mr-2">user: {t.user_id}</span>}
                  {t.message_count !== undefined && <span className="mr-2">msgs: {t.message_count}</span>}
                  {t.created_at && <span>seit: {new Date(t.created_at).toLocaleString('de-DE')}</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && view === 'notifications' && (
          <div className="space-y-3">
            <div className="rounded-xl bg-foreground/[0.04] border border-foreground/10 p-3 space-y-2">
              <div className="text-xs font-semibold text-foreground">Proaktive Benachrichtigung senden</div>
              <textarea value={notifMsg} onChange={(e) => setNotifMsg(e.target.value)} rows={2} placeholder="Nachricht…"
                className="w-full text-xs bg-foreground/5 border border-foreground/10 rounded-lg p-2 text-foreground" />
              <div className="flex items-center gap-2">
                <select value={notifType} onChange={(e) => setNotifType(e.target.value)}
                  className="text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-2 py-1.5 text-foreground">
                  <option value="info">info</option>
                  <option value="reminder">reminder</option>
                  <option value="alert">alert</option>
                  <option value="suggestion">suggestion</option>
                </select>
                <input type="number" min={1} max={10} value={notifPrio} onChange={(e) => setNotifPrio(Number(e.target.value))}
                  className="w-20 text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-2 py-1.5 text-foreground" />
                <button onClick={sendNotif} disabled={!notifMsg.trim()}
                  className="ml-auto px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-40">
                  Senden
                </button>
              </div>
            </div>
            <div className="space-y-2 max-h-72 overflow-auto">
              {notifications.length === 0 ? (
                <p className="text-xs text-foreground/50">Keine ausstehenden Benachrichtigungen.</p>
              ) : notifications.map((n, i) => (
                <div key={n.id ?? i} className="rounded-lg bg-foreground/5 border border-foreground/10 p-3">
                  <div className="text-xs text-foreground/85 break-words">{n.message}</div>
                  <div className="text-[10px] text-foreground/40 mt-1 flex gap-2">
                    {n.notification_type && <span className="font-mono">{n.notification_type}</span>}
                    {n.priority !== undefined && <span>P{n.priority}</span>}
                    {n.created_at && <span>{new Date(n.created_at).toLocaleString('de-DE')}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </AdminCard>
    </div>
  )
}

// ─── AI Tasks ───────────────────────────────────────────────────────────
interface AiAutoTask {
  id?: string
  name?: string
  task_type?: string
  schedule?: string
  enabled?: boolean
  last_run?: string
  next_run?: string
  config?: Record<string, unknown>
}

function AiTasksTab({ token }: { token: string }) {
  const [tasks, setTasks] = useState<AiAutoTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const r = await adminFetch('/api/assist/config/tasks', token)
      const arr = (r as Record<string, unknown>)?.tasks
      setTasks(Array.isArray(arr) ? (arr as AiAutoTask[]) : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-3">
      <AdminCard title="Autonome AI-Aufgaben" icon={Robot}>
        <p className="text-xs text-foreground/60 mb-3">
          Hintergrund-Agenten, die der Conversation Manager periodisch
          ausführt — z. B. Routinen-Auswertung, Anomalie-Reports oder
          proaktive Vorschläge. Aktivierung erfolgt im AI-Provider-Tab
          oder direkt in der Datenbank.
        </p>
        {loading && <p className="text-xs text-foreground/50">Lade…</p>}
        {error && <p className="text-xs text-red-300">{error}</p>}
        {!loading && !error && tasks.length === 0 && (
          <p className="text-xs text-foreground/50">Keine autonomen Aufgaben aktiv.</p>
        )}
        <div className="space-y-2">
          {tasks.map((t, i) => (
            <div key={t.id ?? i} className="rounded-xl bg-foreground/5 border border-foreground/10 p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-semibold text-foreground">{t.name ?? t.id ?? 'Unbenannt'}</span>
                {t.task_type && <span className="text-[10px] px-1.5 py-0.5 rounded bg-foreground/10 text-foreground/60 font-mono">{t.task_type}</span>}
                <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded ${t.enabled ? 'bg-green-500/15 text-green-300' : 'bg-foreground/10 text-foreground/40'}`}>
                  {t.enabled ? 'aktiv' : 'inaktiv'}
                </span>
              </div>
              <div className="text-[10px] text-foreground/40 flex gap-3 flex-wrap">
                {t.schedule && <span>Plan: <span className="font-mono">{t.schedule}</span></span>}
                {t.last_run && <span>letzter Lauf: {new Date(t.last_run).toLocaleString('de-DE')}</span>}
                {t.next_run && <span>nächster Lauf: {new Date(t.next_run).toLocaleString('de-DE')}</span>}
              </div>
              {t.config && Object.keys(t.config).length > 0 && (
                <pre className="text-[10px] font-mono whitespace-pre-wrap break-words bg-foreground/5 rounded p-2 text-foreground/70 max-h-32 overflow-auto mt-2">{JSON.stringify(t.config, null, 2)}</pre>
              )}
            </div>
          ))}
        </div>
        <div className="flex justify-end mt-3">
          <button onClick={load} disabled={loading}
            className="p-1.5 rounded-lg bg-foreground/5 text-foreground/60 hover:bg-foreground/10 disabled:opacity-40">
            <ArrowClockwise size={13} />
          </button>
        </div>
      </AdminCard>
    </div>
  )
}

// ─── AI Tools ───────────────────────────────────────────────────────────
function AiToolsTab({ token }: { token: string }) {
  const [tab, setTab] = useState<'search' | 'scrape' | 'screenshot'>('search')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)

  const [query, setQuery] = useState('')
  const [maxResults, setMaxResults] = useState(5)
  const [url, setUrl] = useState('')

  const run = async () => {
    setBusy(true); setError(null); setResult(null)
    try {
      let endpoint = '', body: Record<string, unknown> = {}
      if (tab === 'search') { endpoint = '/api/assist/tools/search'; body = { query, max_results: maxResults } }
      else if (tab === 'scrape') { endpoint = '/api/assist/tools/scrape'; body = { url } }
      else { endpoint = '/api/assist/tools/screenshot'; body = { url } }
      const r = await adminFetch(endpoint, token, { method: 'POST', body: JSON.stringify(body) })
      setResult(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <AdminCard title="AI Tools" icon={Hand}>
        <p className="text-xs text-foreground/60 mb-3">
          Werkzeuge, die der Assistent intern für Tool-Calls nutzt. Hier
          direkt ausführbar zum Testen.
        </p>
        <div className="flex items-center gap-1 mb-3">
          {(['search', 'scrape', 'screenshot'] as const).map((t) => (
            <button key={t} onClick={() => { setTab(t); setResult(null); setError(null) }}
              className={`px-3 py-1 rounded-lg text-xs font-semibold capitalize transition-colors ${
                tab === t ? 'bg-accent/20 text-accent' : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/10'
              }`}>
              {t === 'search' ? 'Internet-Suche' : t === 'scrape' ? 'Web Scrapen' : 'Screenshot'}
            </button>
          ))}
        </div>

        {tab === 'search' ? (
          <div className="flex items-center gap-2 mb-3">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Suchbegriff…"
              className="flex-1 text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground" />
            <input type="number" min={1} max={20} value={maxResults} onChange={(e) => setMaxResults(Number(e.target.value))}
              className="w-20 text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground" />
            <button onClick={run} disabled={busy || !query.trim()}
              className="px-3 py-2 text-xs font-semibold rounded-lg bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-40">
              {busy ? '…' : 'Suchen'}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 mb-3">
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…"
              className="flex-1 text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground" />
            <button onClick={run} disabled={busy || !url.trim()}
              className="px-3 py-2 text-xs font-semibold rounded-lg bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-40">
              {busy ? '…' : (tab === 'scrape' ? 'Scrapen' : 'Aufnehmen')}
            </button>
          </div>
        )}

        {error && <p className="text-xs text-red-300 mb-2">{error}</p>}

        {result !== null && (
          <pre className="text-[11px] font-mono whitespace-pre-wrap break-words bg-foreground/5 border border-foreground/10 rounded-lg p-3 text-foreground/85 max-h-96 overflow-auto">{JSON.stringify(result, null, 2)}</pre>
        )}
      </AdminCard>
    </div>
  )
}

// ─── AI Voice ───────────────────────────────────────────────────────────
function AiVoiceTab({ token }: { token: string }) {
  const [text, setText] = useState('Hallo, dies ist ein IORA Assist Sprachtest.')
  const [voice, setVoice] = useState('default')
  const [busy, setBusy] = useState(false)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [recording, setRecording] = useState(false)
  const [transcript, setTranscript] = useState<string | null>(null)
  const [recError, setRecError] = useState<string | null>(null)
  const mediaRef = useState<{ rec?: MediaRecorder; chunks: Blob[] }>({ chunks: [] })[0]

  const synthesize = async () => {
    setBusy(true); setError(null); setAudioUrl(null)
    try {
      const r = await fetch(`${baseUrlFor('/api/assist/voice/synthesize')}/api/assist/voice/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text, voice }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const blob = await r.blob()
      setAudioUrl(URL.createObjectURL(blob))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const startRec = async () => {
    setRecError(null); setTranscript(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      mediaRef.chunks = []
      rec.ondataavailable = (e) => { if (e.data.size > 0) mediaRef.chunks.push(e.data) }
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(mediaRef.chunks, { type: 'audio/webm' })
        const fd = new FormData()
        fd.append('audio', blob, 'recording.webm')
        try {
          const r = await fetch(`${baseUrlFor('/api/assist/voice/transcribe')}/api/assist/voice/transcribe`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: fd,
          })
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          const j = await r.json()
          setTranscript(j.text ?? JSON.stringify(j))
        } catch (e) {
          setRecError(e instanceof Error ? e.message : String(e))
        }
      }
      mediaRef.rec = rec
      rec.start()
      setRecording(true)
    } catch (e) {
      setRecError(e instanceof Error ? e.message : String(e))
    }
  }

  const stopRec = () => {
    mediaRef.rec?.stop()
    setRecording(false)
  }

  return (
    <div className="space-y-3">
      <AdminCard title="Text-to-Speech" icon={PaperPlaneTilt}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3}
          className="w-full text-xs bg-foreground/5 border border-foreground/10 rounded-lg p-3 text-foreground" />
        <div className="flex items-center gap-2 mt-2">
          <input value={voice} onChange={(e) => setVoice(e.target.value)} placeholder="Stimme (default)"
            className="flex-1 text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground" />
          <button onClick={synthesize} disabled={busy || !text.trim()}
            className="px-3 py-2 text-xs font-semibold rounded-lg bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-40">
            {busy ? 'Synthetisiere…' : 'Sprechen'}
          </button>
        </div>
        {error && <p className="text-xs text-red-300 mt-2">{error}</p>}
        {audioUrl && <audio controls src={audioUrl} className="w-full mt-3" />}
      </AdminCard>

      <AdminCard title="Speech-to-Text (STT)" icon={Microphone}>
        <p className="text-xs text-foreground/60 mb-3">
          Aufnahme über das Browser-Mikrofon, Transkription via
          /api/assist/voice/transcribe.
        </p>
        <div className="flex items-center gap-2">
          {!recording ? (
            <button onClick={startRec}
              className="px-3 py-2 text-xs font-semibold rounded-lg bg-red-500/20 text-red-200 hover:bg-red-500/30 flex items-center gap-1.5">
              <Microphone size={13} /> Aufnahme starten
            </button>
          ) : (
            <button onClick={stopRec}
              className="px-3 py-2 text-xs font-semibold rounded-lg bg-red-500/30 text-red-100 animate-pulse flex items-center gap-1.5">
              <Hand size={13} /> Stoppen
            </button>
          )}
        </div>
        {recError && <p className="text-xs text-red-300 mt-2">{recError}</p>}
        {transcript && (
          <div className="mt-3 rounded-xl bg-foreground/5 border border-foreground/10 p-3">
            <div className="text-[10px] uppercase tracking-wide text-foreground/40 mb-1">Transkript</div>
            <div className="text-xs text-foreground/85 whitespace-pre-wrap">{transcript}</div>
          </div>
        )}
      </AdminCard>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
// CONNECTED DEVICES TAB
// ════════════════════════════════════════════════════════════════════════
//
// Shows every dashboard client (IORA Desktop, browser tabs, kiosks)
// that has registered with iora-home, plus a live count of currently
// connected WebSocket clients. Backed by /api/admin/devices, which
// pairs the `devices` DB table with `ws_manager.client_count()`.

interface AdminDevice {
  id: string
  device_name: string
  device_type?: string | null
  user_agent?: string | null
  is_terminal?: boolean
  terminal_name?: string | null
  assigned_profile_id?: string | null
  last_seen: string
  created_at: string
  online: boolean
  seconds_since_seen: number
}

interface AdminDevicesPayload {
  devices: AdminDevice[]
  total: number
  online: number
  connected_ws_clients: number
  online_threshold_seconds: number
}

// ═════════════════════════════════════════════════════════════════
// Dev Bridge Tab — IORA OS Dev Bridge Management
// ═════════════════════════════════════════════════════════════════
//
// Vollständige Integration der iora-dev-bridge (Port 8101) ins WebUI:
// - Service-Status und Logs (auch Live-Stream über SSE)
// - System-Info (CPU, RAM, Disk, Uptime)
// - Docker-Compose-Management
// - Dateisystem-Browser und Datei-Reader
// - Binary Build und Replace

/**
 * Ruft einen Dev-Bridge-Endpunkt auf. Authentifizierung erfolgt wahlweise
 * per Session-Token (Bearer, via /dev/auth) oder per Statischem Dev-Token.
 */
async function devBridgeFetch(path: string, devToken?: string | null, options?: RequestInit): Promise<Response> {
  const baseUrl = getDevBridgeUrl()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options?.headers as Record<string, string>) || {}),
  }
  if (devToken) {
    headers['x-iora-dev-token'] = devToken
  }
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
  })
}

function DevBridgeTab({ token: _token }: { token: string }) {
  const [bridgeStatus, setBridgeStatus] = useState<'checking' | 'online' | 'offline'>('checking')
  const [bridgeStatusText, setBridgeStatusText] = useState('')
  const [devToken, setDevToken] = useState<string | null>(null)
  const [bridgeBuild, setBridgeBuild] = useState('')
  const [activeSubTab, setActiveSubTab] = useState<'services' | 'system-info' | 'filesystem' | 'build' | 'journal' | 'compose'>('services')
  const [loginUser, setLoginUser] = useState('')
  const [loginPass, setLoginPass] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  const [loginError, setLoginError] = useState('')

  // ─── Bridge-Konnektivität prüfen ────────────────────────────
  const checkBridge = useCallback(async () => {
    setBridgeStatus('checking')
    try {
      const baseUrl = getDevBridgeUrl()
      const res = await fetch(`${baseUrl}/dev/health`, { signal: AbortSignal.timeout(5_000) })
      if (res.ok) {
        const data = await res.json()
        setBridgeStatus('online')
        setBridgeBuild(data.build || '')
        setBridgeStatusText(`Build ${data.build || '?'}, Uptime ${data.uptime_seconds || 0}s`)
      } else {
        setBridgeStatus('offline')
        setBridgeStatusText(`HTTP ${res.status}`)
      }
    } catch (e) {
      setBridgeStatus('offline')
      setBridgeStatusText(e instanceof Error ? e.message : 'Unbekannter Fehler')
    }
  }, [])

  useEffect(() => { checkBridge() }, [checkBridge])

  // ─── Auto-Login via gespeichertem Session-Token ─────────────
  useEffect(() => {
    const stored = localStorage.getItem('iora-dev-session-token') || sessionStorage.getItem('iora-dev-session-token')
    // Fallback: statischer Dev-Token
    const staticToken = localStorage.getItem('iora-dev-token')
    if (stored) {
      setDevToken(stored)
    } else if (staticToken) {
      setDevToken(staticToken)
    }
  }, [])

  // ─── Login bei der Dev Bridge ───────────────────────────────
  const handleDevBridgeLogin = async () => {
    if (!loginUser || !loginPass) return
    setLoginLoading(true)
    setLoginError('')
    try {
      const res = await fetch(`${getDevBridgeUrl()}/dev/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUser, password: loginPass }),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `HTTP ${res.status}`)
      }
      const data = await res.json()
      setDevToken(data.token)
      localStorage.setItem('iora-dev-session-token', data.token)
      toast.success('Dev Bridge Login erfolgreich')
      setLoginUser('')
      setLoginPass('')
    } catch (e) {
      setLoginError(e instanceof Error ? e.message : String(e))
    }
    setLoginLoading(false)
  }

  const handleLogout = () => {
    setDevToken(null)
    localStorage.removeItem('iora-dev-session-token')
    sessionStorage.removeItem('iora-dev-session-token')
  }

  // ─── Subtabs ─────────────────────────────────────────────────
  if (bridgeStatus === 'checking') {
    return (
      <div className="space-y-3">
        <AdminCard title="Dev Bridge" icon={Terminal}>
          <div className="flex items-center gap-3 p-4">
            <div className="w-5 h-5 rounded-full border-2 border-foreground/30 border-t-accent animate-spin" />
            <p className="text-sm text-foreground/60">Prüfe Verbindung zur Dev Bridge unter {getDevBridgeUrl()}...</p>
          </div>
        </AdminCard>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Bridge-Status-Karte mit Login */}
      <AdminCard title="Dev Bridge Status" icon={Terminal}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${
              bridgeStatus === 'online' ? 'bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.5)]' : 'bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.5)]'
            }`} />
            <div>
              <p className="text-sm font-semibold text-foreground">
                {bridgeStatus === 'online' ? 'Verbunden' : 'Nicht erreichbar'}
              </p>
              <p className="text-xs text-foreground/50 font-mono">
                {getDevBridgeUrl()} — {bridgeStatusText}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {devToken ? (
              <button onClick={handleLogout} className={ccBtnDanger('text-xs')}>
                <X size={14} /> Abmelden
              </button>
            ) : null}
            <button onClick={checkBridge} className={ccBtnSecondary('text-xs')}>
              <ArrowClockwise size={14} /> Neu prüfen
            </button>
          </div>
        </div>

        {/* Login-Formular wenn kein Token vorhanden */}
        {!devToken && bridgeStatus === 'online' && (
          <div className="mt-4 p-4 rounded-xl bg-foreground/3 border border-foreground/5">
            <p className="text-xs font-semibold text-foreground/80 mb-3">
              Anmeldung an der Dev Bridge erforderlich — verwende deine IORA-Dashboard-Zugangsdaten:
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input type="text" value={loginUser} onChange={e => setLoginUser(e.target.value)}
                placeholder="Benutzername" className={ccInput('text-xs')}
                onKeyDown={e => e.key === 'Enter' && handleDevBridgeLogin()} />
              <input type="password" value={loginPass} onChange={e => setLoginPass(e.target.value)}
                placeholder="Passwort" className={ccInput('text-xs')}
                onKeyDown={e => e.key === 'Enter' && handleDevBridgeLogin()} />
              <button onClick={handleDevBridgeLogin} disabled={loginLoading || !loginUser || !loginPass}
                className={ccBtnPrimary('text-xs whitespace-nowrap')}>
                {loginLoading ? 'Verbindet…' : 'Anmelden'}
              </button>
            </div>
            {loginError && <p className="text-xs text-red-400 mt-2">{loginError}</p>}
          </div>
        )}
      </AdminCard>

      {/* Subtabs (nur wenn authentifiziert) */}
      {devToken && (
        <>
          <div className="flex gap-1.5 flex-wrap">
            {([
              { id: 'services' as const, label: 'Dienste & Logs', icon: Gauge },
              { id: 'system-info' as const, label: 'System-Info', icon: Cpu },
              { id: 'filesystem' as const, label: 'Dateisystem', icon: FolderOpen },
              { id: 'build' as const, label: 'Build & Replace', icon: Code },
            { id: 'journal' as const, label: 'Journal', icon: ListBullets },
            { id: 'compose' as const, label: 'Docker Compose', icon: Cube },
            ]).map(sub => (
              <button key={sub.id} onClick={() => setActiveSubTab(sub.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  activeSubTab === sub.id ? 'bg-accent/20 text-accent' : 'text-foreground/60 hover:text-foreground hover:bg-foreground/8'
                }`}>
                <sub.icon size={14} className="inline mr-1.5" />
                {sub.label}
              </button>
            ))}
          </div>

          {activeSubTab === 'services' && <DevBridgeServices devToken={devToken} />}
          {activeSubTab === 'system-info' && <DevBridgeSystemInfo devToken={devToken} />}
          {activeSubTab === 'filesystem' && <DevBridgeFilesystem devToken={devToken} />}
          {activeSubTab === 'build' && <DevBridgeBuild devToken={devToken} />}
          {activeSubTab === 'journal' && <DevBridgeJournal devToken={devToken} />}
          {activeSubTab === 'compose' && <DevBridgeCompose devToken={devToken} />}
        </>
      )}
    </div>
  )
}

// ─── Dev Bridge: Dienste & Logs ─────────────────────────────────────────

function DevBridgeServices({ devToken }: { devToken: string | null }) {
  const [services, setServices] = useState<Array<{ name: string; status: string; url?: string; version?: string; response_time_ms?: number; uptime?: string }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [restarting, setRestarting] = useState<string | null>(null)
  const [streamingService, setStreamingService] = useState<string | null>(null)
  const [streamLogs, setStreamLogs] = useState<string[]>([])
  const streamRef = useRef<EventSource | null>(null)

  const loadServices = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await devBridgeFetch('/dev/services', devToken)
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `HTTP ${res.status}`)
      }
      const data = await res.json()
      const list = data.services || data || []
      setServices(Array.isArray(list) ? list : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setLoading(false)
  }, [devToken])

  useEffect(() => { if (devToken) loadServices() }, [devToken, loadServices])

  const restartService = async (name: string) => {
    setRestarting(name)
    try {
      const res = await devBridgeFetch(`/dev/service/${encodeURIComponent(name)}/restart`, devToken, { method: 'POST' })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `HTTP ${res.status}`)
      }
      toast.success(`${name} wird neu gestartet…`)
      setTimeout(() => loadServices(), 3000)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
    setRestarting(null)
  }

  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectAttemptRef = useRef(0)

  const startStream = (name: string, attempt = 0) => {
    if (streamRef.current) {
      streamRef.current.close()
    }
    if (attempt === 0) {
      setStreamLogs([])
      reconnectAttemptRef.current = 0
    }
    setStreamingService(name)

    const baseUrl = getDevBridgeUrl()
    const tokenParam = devToken ? `&token=${encodeURIComponent(devToken)}` : ''
    const es = new EventSource(`${baseUrl}/dev/service/${encodeURIComponent(name)}/logs/stream?tail=50${tokenParam}`)

    es.addEventListener('hello', (e: Event) => {
      const msgEvent = e as MessageEvent
      reconnectAttemptRef.current = 0 // Verbindung steht – Backoff zurücksetzen
      setStreamLogs(prev => [...prev, `── ${msgEvent.data}`])
    })

    es.onmessage = (e: MessageEvent) => {
      setStreamLogs(prev => {
        const next = [...prev, e.data]
        return next.length > 500 ? next.slice(-500) : next
      })
    }

    es.addEventListener('error', (e: Event) => {
      const msgEvent = e as MessageEvent
      if (msgEvent.data) {
        setStreamLogs(prev => [...prev, `⚠️ ${msgEvent.data}`])
      }
    })

    es.onerror = () => {
      es.close()
      // Auto-Reconnect mit exponentiellem Backoff (1s, 2s, 4s, max 30s)
      const retry = reconnectAttemptRef.current
      if (retry < 10) {
        const delay = Math.min(1000 * Math.pow(2, retry), 30_000)
        reconnectAttemptRef.current = retry + 1
        setStreamLogs(prev => [...prev, `⚠️ Verbindung unterbrochen – erneuter Versuch in ${delay / 1000}s…`])
        if (reconnectRef.current) clearTimeout(reconnectRef.current)
        reconnectRef.current = setTimeout(() => {
          startStream(name, retry + 1)
        }, delay)
      } else {
        setStreamLogs(prev => [...prev, '⚠️ Verbindung endgültig getrennt (max. Wiederholungen)'])
        setStreamingService(null)
      }
    }

    streamRef.current = es
  }

  // Cleanup auch den reconnect-Timeout
  const stopStream = () => {
    if (reconnectRef.current) {
      clearTimeout(reconnectRef.current)
      reconnectRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.close()
      streamRef.current = null
    }
    setStreamingService(null)
    setStreamLogs([])
    reconnectAttemptRef.current = 0
  }

  // Clean up on unmount (schließt Stream + reconnect-Timeout)
  useEffect(() => {
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
      if (streamRef.current) streamRef.current.close()
    }
  }, [])

  if (!devToken) {
    return (
      <AdminCard>
        <div className="p-4 text-center">
          <p className="text-sm text-foreground/60">Dev-Token nicht gefunden.</p>
          <p className="text-xs text-foreground/40 mt-2">
            Bitte im Developer-Mode-Tab den Dev-Bridge-Token hinterlegen oder das
            OS-Entwickler-Image verwenden.
          </p>
        </div>
      </AdminCard>
    )
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const onlineCount = services.filter(s => s.status === 'online').length

  return (
    <div className="space-y-3">
      {/* Live-Log-Stream */}
      {streamingService && (
        <AdminCard title={`Live-Log: ${streamingService}`} icon={Broadcast}>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <span className="text-xs text-green-400 font-medium">Live-Stream aktiv</span>
              </div>
              <button onClick={stopStream} className={ccBtnDanger('text-xs')}>
                <X size={14} /> Stream beenden
              </button>
            </div>
            <div className="max-h-[400px] overflow-y-auto font-mono text-[10px] leading-relaxed bg-black/20 rounded-xl p-3 space-y-0.5">
              {streamLogs.length === 0 ? (
                <p className="text-foreground/50 text-center py-4">Warte auf Log-Einträge…</p>
              ) : streamLogs.map((line, i) => (
                <div key={i} className={`${
                  line.includes('ERROR') || line.includes('error') ? 'text-red-400' :
                  line.includes('WARN') || line.includes('warn') ? 'text-amber-400' :
                  line.startsWith('⚠') ? 'text-amber-300' :
                  line.startsWith('──') ? 'text-foreground/40' :
                  'text-foreground/70'
                }`}>{line}</div>
              ))}
            </div>
          </div>
        </AdminCard>
      )}

      {/* Service-Übersicht */}
      <AdminCard title={`Dienste (${onlineCount}/${services.length} online)`} icon={Gauge}>
        <div className="space-y-2">
          {services.length === 0 ? (
            <p className="text-xs text-foreground/50 text-center py-4">Keine Dienste gefunden.</p>
          ) : services.map(svc => (
            <div key={svc.name} className="flex items-start justify-between gap-3 p-3 rounded-xl bg-foreground/3 border border-foreground/5">
              <div className="flex items-center gap-2.5 flex-1 min-w-0">
                <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                  svc.status === 'online' ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.5)]' :
                  svc.status === 'degraded' ? 'bg-amber-400' :
                  svc.status === 'not_deployed' ? 'bg-foreground/30' :
                  'bg-red-400'
                }`} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{svc.name}</p>
                  {svc.url && <p className="text-[10px] text-foreground/40 font-mono truncate">{svc.url}</p>}
                  <div className="flex gap-2 mt-0.5">
                    {svc.response_time_ms && <span className="text-[10px] text-foreground/50">{svc.response_time_ms}ms</span>}
                    {svc.version && <span className="text-[10px] text-foreground/50">v{svc.version}</span>}
                    {svc.uptime && <span className="text-[10px] text-foreground/50">{svc.uptime}</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button onClick={() => startStream(svc.name)}
                  disabled={streamingService === svc.name}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-semibold transition-colors ${
                    streamingService === svc.name
                      ? 'bg-green-500/20 text-green-300'
                      : 'bg-foreground/8 text-foreground/60 hover:text-accent hover:bg-accent/10'
                  }`}
                  title="Live-Log streamen">
                  <Broadcast size={11} className="inline mr-1" />
                  {streamingService === svc.name ? 'Streamt' : 'Live'}
                </button>
                <button onClick={() => restartService(svc.name)}
                  disabled={restarting === svc.name}
                  className="px-2.5 py-1 rounded-md text-[10px] font-semibold bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 transition-colors disabled:opacity-40"
                  title="Dienst neu starten">
                  <ArrowClockwise size={11} className={restarting === svc.name ? 'animate-spin inline mr-1' : 'inline mr-1'} />
                  {restarting === svc.name ? 'Starte…' : 'Restart'}
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-end mt-2">
          <button onClick={loadServices} className={ccBtnSecondary('text-xs')}>
            <ArrowClockwise size={14} /> Aktualisieren
          </button>
        </div>
      </AdminCard>
    </div>
  )
}

// ─── Dev Bridge: System-Info ────────────────────────────────────────────

function DevBridgeSystemInfo({ devToken }: { devToken: string | null }) {
  const [info, setInfo] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!devToken) return
    setLoading(true)
    setError('')
    try {
      const res = await devBridgeFetch('/dev/system/info', devToken)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setInfo(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setLoading(false)
  }, [devToken])

  useEffect(() => { load() }, [load])

  if (!devToken) return null
  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>
  if (!info) return null

  const [rebooting, setRebooting] = useState(false)

  const handleReboot = async () => {
    if (!confirm('⚠️  System wirklich neu starten? Die Verbindung wird getrennt.')) return
    setRebooting(true)
    try {
      const res = await devBridgeFetch('/dev/system/reboot', devToken, { method: 'POST' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      toast.success('Neustart wird ausgeführt… Die Verbindung wird in Kürze getrennt.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
      setRebooting(false)
    }
  }

  const formatBytes = (b: number) => {
    if (b >= 1_000_000_000) return `${(b / 1_000_000_000).toFixed(1)} GB`
    if (b >= 1_000_000) return `${(b / 1_000_000).toFixed(1)} MB`
    if (b >= 1_000) return `${(b / 1_000).toFixed(1)} KB`
    return `${b} B`
  }

  const formatUptime = (sec: number) => {
    const d = Math.floor(sec / 86400)
    const h = Math.floor((sec % 86400) / 3600)
    const m = Math.floor((sec % 3600) / 60)
    return `${d}d ${h}h ${m}m`
  }

  return (
    <AdminCard title="System-Informationen" icon={Cpu}>
      <div className="flex items-start justify-between mb-4">
        <div />
        <button onClick={handleReboot} disabled={rebooting}
          className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
            rebooting
              ? 'bg-red-500/20 text-red-300 cursor-wait'
              : 'bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20'
          }`}>
          <Power size={14} className={`inline mr-1.5 ${rebooting ? 'animate-pulse' : ''}`} />
          {rebooting ? 'Starte neu…' : 'System neu starten'}
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="p-3 rounded-xl bg-foreground/3 border border-foreground/5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground/50 mb-1">Hostname</div>
          <div className="text-sm font-semibold text-foreground font-mono">{String(info.hostname || '–')}</div>
        </div>
        <div className="p-3 rounded-xl bg-foreground/3 border border-foreground/5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground/50 mb-1">Build</div>
          <div className="text-sm font-semibold text-foreground font-mono">{String(info.build || '–')}</div>
        </div>
        <div className="p-3 rounded-xl bg-foreground/3 border border-foreground/5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground/50 mb-1">Uptime</div>
          <div className="text-sm font-semibold text-foreground">{formatUptime(Number(info.uptime_seconds || 0))}</div>
        </div>
        <div className="p-3 rounded-xl bg-foreground/3 border border-foreground/5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground/50 mb-1">CPU</div>
          <div className="text-sm font-semibold text-foreground">{String(info.cpu_count || '?')} Kerne</div>
          <div className="text-[10px] text-foreground/40 mt-0.5">Load: {String(info.loadavg || '–')}</div>
        </div>
        <div className="p-3 rounded-xl bg-foreground/3 border border-foreground/5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground/50 mb-1">Arbeitsspeicher</div>
          <div className="text-sm font-semibold text-foreground">{formatBytes(Number(info.mem_total_bytes || 0))}</div>
          <div className="text-[10px] text-foreground/40 mt-0.5">Frei: {formatBytes(Number(info.mem_available_bytes || 0))}</div>
        </div>
        <div className="p-3 rounded-xl bg-foreground/3 border border-foreground/5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground/50 mb-1">Festplatte (/)</div>
          <div className="text-sm font-semibold text-foreground">{formatBytes(Number(info.disk_total_bytes || 0))}</div>
          <div className="text-[10px] text-foreground/40 mt-0.5">
            Genutzt: {formatBytes(Number(info.disk_used_bytes || 0))} · Frei: {formatBytes(Number(info.disk_free_bytes || 0))}
          </div>
        </div>
      </div>
      <div className="flex justify-end mt-3">
        <button onClick={load} className={ccBtnSecondary('text-xs')}>
          <ArrowClockwise size={14} /> Aktualisieren
        </button>
      </div>
    </AdminCard>
  )
}

// ─── Dev Bridge: Dateisystem ────────────────────────────────────────────

function DevBridgeFilesystem({ devToken }: { devToken: string | null }) {
  const [currentPath, setCurrentPath] = useState('/')
  const [entries, setEntries] = useState<Array<{ name: string; path: string; kind: string; size: number }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedFile, setSelectedFile] = useState<{ path: string; content: string; bytes: number; total_bytes: number; truncated: boolean; binary_hint: boolean } | null>(null)
  const [pathHistory, setPathHistory] = useState<string[]>(['/'])

  const listDir = useCallback(async (path: string) => {
    if (!devToken) return
    setLoading(true)
    setError('')
    setSelectedFile(null)
    try {
      const res = await devBridgeFetch('/dev/fs/list', devToken, {
        method: 'POST',
        body: JSON.stringify({ path }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setEntries(data.entries || [])
      setCurrentPath(data.path || path)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setLoading(false)
  }, [devToken])

  useEffect(() => { if (devToken) listDir('/') }, [devToken, listDir])

  const navigateTo = (path: string) => {
    setPathHistory(prev => [...prev, path])
    listDir(path)
  }

  const goBack = () => {
    if (pathHistory.length <= 1) return
    const prev = pathHistory.slice(0, -1)
    setPathHistory(prev)
    listDir(prev[prev.length - 1])
  }

  const readFile = async (path: string) => {
    if (!devToken) return
    try {
      const res = await devBridgeFetch('/dev/fs/read', devToken, {
        method: 'POST',
        body: JSON.stringify({ path, max_bytes: 64 * 1024 }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setSelectedFile(data)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  if (!devToken) return null

  if (loading && entries.length === 0) return <LoadingSpinner />
  if (error && entries.length === 0) return <ErrorMessage>{error}</ErrorMessage>

  const parentPath = currentPath === '/' ? '/' : currentPath.split('/').slice(0, -1).join('/') || '/'

  return (
    <div className="space-y-3">
      <AdminCard title={`Dateisystem: ${currentPath}`} icon={FolderOpen}>
        {/* Navigation */}
        <div className="flex items-center gap-2 mb-3">
          <button onClick={goBack} disabled={pathHistory.length <= 1}
            className={`px-2 py-1 rounded-lg text-xs ${pathHistory.length <= 1 ? 'text-foreground/30' : 'text-foreground/60 hover:text-foreground hover:bg-foreground/8'}`}>
            ← Zurück
          </button>
          <span className="text-xs text-foreground/40 font-mono truncate">{currentPath}</span>
          <button onClick={() => listDir(currentPath)} className={ccBtnIcon('ml-auto')}>
            <ArrowClockwise size={14} />
          </button>
        </div>

        <div className="max-h-[400px] overflow-y-auto space-y-0.5">
          {entries.length === 0 ? (
            <p className="text-xs text-foreground/50 text-center py-8">Leeres Verzeichnis</p>
          ) : entries.map(entry => (
            <div key={entry.path}
              onClick={() => entry.kind === 'dir' ? navigateTo(entry.path) : readFile(entry.path)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-foreground/5 cursor-pointer transition-colors group">
              <span className={`text-xs ${
                entry.kind === 'dir' ? 'text-accent' :
                entry.kind === 'symlink' ? 'text-cyan-400' :
                'text-foreground/50'
              }`}>
                {entry.kind === 'dir' ? <FolderOpen size={13} /> : entry.kind === 'symlink' ? <LinkSimple size={13} /> : <File size={13} />}
              </span>
              <span className="text-xs text-foreground/80 font-mono truncate flex-1">{entry.name}</span>
              <span className="text-[10px] text-foreground/40 group-hover:text-foreground/60 transition-colors">
                {entry.kind === 'file' ? formatFileSize(entry.size) : ''}
              </span>
            </div>
          ))}
        </div>
      </AdminCard>

      {/* Datei-Ansicht */}
      {selectedFile && (
        <AdminCard title={selectedFile.path} icon={Code}>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-[10px] text-foreground/50">
              <span>{formatFileSize(selectedFile.total_bytes)}</span>
              {selectedFile.truncated && <span className="text-amber-400">(gekürzt, erste {formatFileSize(selectedFile.bytes)})</span>}
              {selectedFile.binary_hint && <span className="text-red-400">(binär)</span>}
            </div>
            <div className="max-h-[500px] overflow-y-auto font-mono text-[10px] leading-relaxed bg-black/20 rounded-xl p-3">
              {selectedFile.binary_hint ? (
                <p className="text-foreground/50 text-center py-4">Binäre Datei kann nicht als Text angezeigt werden.</p>
              ) : (
                <pre className="text-foreground/80 whitespace-pre-wrap">{selectedFile.content}</pre>
              )}
            </div>
          </div>
        </AdminCard>
      )}
    </div>
  )
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`
  return `${bytes} B`
}

// ─── Dev Bridge: Build & Replace ────────────────────────────────────────

function DevBridgeBuild({ devToken }: { devToken: string | null }) {
  const [target, setTarget] = useState('')
  const [unit, setUnit] = useState('')
  const [component, setComponent] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [building, setBuilding] = useState(false)

  // Self-Update State
  const [selfUpdateSource, setSelfUpdateSource] = useState<'http' | 'ssh' | 'ftp'>('http')
  const [suUrl, setSuUrl] = useState('')
  const [suHost, setSuHost] = useState('')
  const [suPath, setSuPath] = useState('/usr/bin/iora-dev-bridge')
  const [suUser, setSuUser] = useState('root')
  const [suPort, setSuPort] = useState('22')
  const [suKeyPath, setSuKeyPath] = useState('/root/.ssh/id_rsa')
  const [suPassword, setSuPassword] = useState('')
  const [suSha, setSuSha] = useState('')
  const [suInsecure, setSuInsecure] = useState(false)
  const [suRunning, setSuRunning] = useState(false)
  const [suResult, setSuResult] = useState<string | null>(null)

  const handleReplace = async () => {
    if (!devToken || !target) return
    setBuilding(true)
    setStatus(null)
    try {
      // Read the binary file from local machine via file input
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '*'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file) return

        const formData = new FormData()
        formData.append('target', target)
        if (unit) formData.append('unit', unit)
        formData.append('file', file)

        const res = await fetch(`${getDevBridgeUrl()}/dev/replace-binary`, {
          method: 'POST',
          headers: devToken ? { 'x-iora-dev-token': devToken } : {},
          body: formData,
        })

        const data = await res.json()
        setStatus(JSON.stringify(data, null, 2))
        if (data.restart?.ok) toast.success('Binary ersetzt und Dienst neu gestartet')
        else toast.error('Fehler beim Ersetzen')
        setBuilding(false)
      }
      input.click()
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
      setBuilding(false)
    }
  }

  // ── Self-Update Handler ──────────────────────────────────────
  const handleSelfUpdate = async () => {
    if (!devToken) return
    setSuRunning(true)
    setSuResult(null)

    const body: Record<string, unknown> = { source: selfUpdateSource }

    if (selfUpdateSource === 'http' || selfUpdateSource === 'ftp') {
      if (!suUrl) { toast.error('Bitte eine URL angeben'); setSuRunning(false); return }
      body.url = suUrl
      if (selfUpdateSource === 'ftp') {
        body.user = suUser
        if (suPassword) body.password = suPassword
      }
    } else if (selfUpdateSource === 'ssh') {
      if (!suHost) { toast.error('Bitte Host angeben'); setSuRunning(false); return }
      body.host = suHost
      body.path = suPath
      body.user = suUser
      body.port = parseInt(suPort) || 22
      body.key_path = suKeyPath
    }

    if (suSha) body.expected_sha = suSha
    if (suInsecure) body.insecure = true

    try {
      const res = await fetch(`${getDevBridgeUrl()}/dev/self-update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-iora-dev-token': devToken,
        },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      setSuResult(JSON.stringify(data, null, 2))
      if (data.ok) {
        toast.success('Self-Update gestartet! Die Dev Bridge wird neu gestartet…')
      } else {
        toast.error('Self-Update fehlgeschlagen: ' + (data.error || 'Unbekannter Fehler'))
      }
    } catch (e) {
      setSuResult(e instanceof Error ? e.message : String(e))
      toast.error('Self-Update fehlgeschlagen')
    }
    setSuRunning(false)
  }

  if (!devToken) return null

  return (
    <div className="space-y-4">
      {/* Binary Replace */}
      <AdminCard title="Binary Replace" icon={Code}>
        <div className="space-y-4">
          <p className="text-xs text-foreground/60">
            Ersetze ein Binary auf dem Gerät und starte den zugehörigen Dienst neu.
            Der Upload erfolgt per Datei-Auswahl.
          </p>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <label className={ccLabel}>Target-Pfad</label>
              <input type="text" value={target} onChange={e => setTarget(e.target.value)}
                placeholder="/usr/bin/iora-home" className={ccInput()} />
            </div>
            <div className="grid gap-1.5">
              <label className={ccLabel}>Systemd-Unit (optional)</label>
              <input type="text" value={unit} onChange={e => setUnit(e.target.value)}
                placeholder="iora-home.service" className={ccInput()} />
            </div>
            <div className="grid gap-1.5">
              <label className={ccLabel}>Component (für Build)</label>
              <input type="text" value={component} onChange={e => setComponent(e.target.value)}
                placeholder="iora-home" className={ccInput()} />
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={handleReplace} disabled={building || !target} className={ccBtnPrimary()}>
              {building ? 'Wird hochgeladen…' : 'Binary auswählen & ersetzen'}
            </button>
          </div>

          {status && (
            <div className="rounded-xl bg-black/20 border border-foreground/10 p-3">
              <pre className="text-[10px] font-mono text-foreground/70 whitespace-pre-wrap max-h-[300px] overflow-y-auto">{status}</pre>
            </div>
          )}
        </div>
      </AdminCard>

      {/* Self-Update: Dev Bridge via SSH/FTP/HTTP */}
      <AdminCard title="Dev Bridge Self-Update" icon={Terminal}>
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <Warning size={16} className="text-amber-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-semibold text-amber-200 mb-1">⚠️  Achtung</p>
              <p className="text-[10px] text-amber-200/70">
                Dies ersetzt <code className="font-mono">/usr/bin/iora-dev-bridge</code> auf dem Gerät und
                startet den Dienst neu. Die aktuelle Verbindung wird dabei getrennt.
                Der Dev Bridge muss dann von der CLI/IDE neu verbunden werden.
              </p>
            </div>
          </div>

          {/* Source selector */}
          <div className="flex gap-1.5">
            {([
              { id: 'http' as const, label: 'HTTP/HTTPS', icon: Globe },
              { id: 'ssh' as const, label: 'SSH/SCP', icon: Terminal },
              { id: 'ftp' as const, label: 'FTP', icon: CloudArrowUp },
            ]).map(src => (
              <button key={src.id} onClick={() => setSelfUpdateSource(src.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  selfUpdateSource === src.id ? 'bg-accent/20 text-accent' : 'text-foreground/60 hover:text-foreground hover:bg-foreground/8'
                }`}>
                <src.icon size={12} className="inline mr-1" />
                {src.label}
              </button>
            ))}
          </div>

          {/* HTTP source */}
          {selfUpdateSource === 'http' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5 sm:col-span-2">
                <label className={ccLabel}>Download-URL</label>
                <input type="url" value={suUrl} onChange={e => setSuUrl(e.target.value)}
                  placeholder="https://build-server.local/iora-dev-bridge-latest" className={ccInput()} />
              </div>
              <label className="flex items-center gap-2 text-xs text-foreground/70 cursor-pointer">
                <input type="checkbox" checked={suInsecure} onChange={e => setSuInsecure(e.target.checked)}
                  className="h-4 w-4 rounded border-foreground/30" />
                TLS-Verifikation deaktivieren (--insecure)
              </label>
            </div>
          )}

          {/* SSH source */}
          {selfUpdateSource === 'ssh' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <label className={ccLabel}>Host</label>
                <input type="text" value={suHost} onChange={e => setSuHost(e.target.value)}
                  placeholder="192.168.2.100" className={ccInput()} />
              </div>
              <div className="grid gap-1.5">
                <label className={ccLabel}>Remote-Pfad</label>
                <input type="text" value={suPath} onChange={e => setSuPath(e.target.value)}
                  placeholder="/usr/bin/iora-dev-bridge" className={ccInput()} />
              </div>
              <div className="grid gap-1.5">
                <label className={ccLabel}>SSH-Benutzer</label>
                <input type="text" value={suUser} onChange={e => setSuUser(e.target.value)}
                  placeholder="root" className={ccInput()} />
              </div>
              <div className="grid gap-1.5">
                <label className={ccLabel}>SSH-Port</label>
                <input type="number" value={suPort} onChange={e => setSuPort(e.target.value)}
                  placeholder="22" min={1} max={65535} className={ccInput()} />
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <label className={ccLabel}>SSH-Key-Pfad (auf dem Gerät)</label>
                <input type="text" value={suKeyPath} onChange={e => setSuKeyPath(e.target.value)}
                  placeholder="/root/.ssh/id_rsa" className={ccInput()} />
              </div>
            </div>
          )}

          {/* FTP source */}
          {selfUpdateSource === 'ftp' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5 sm:col-span-2">
                <label className={ccLabel}>FTP-URL</label>
                <input type="url" value={suUrl} onChange={e => setSuUrl(e.target.value)}
                  placeholder="ftp://build-server.local/iora-dev-bridge-latest" className={ccInput()} />
              </div>
              <div className="grid gap-1.5">
                <label className={ccLabel}>FTP-Benutzer</label>
                <input type="text" value={suUser} onChange={e => setSuUser(e.target.value)}
                  placeholder="anonymous" className={ccInput()} />
              </div>
              <div className="grid gap-1.5">
                <label className={ccLabel}>FTP-Passwort</label>
                <input type="password" value={suPassword} onChange={e => setSuPassword(e.target.value)}
                  placeholder="optional" className={ccInput()} />
              </div>
            </div>
          )}

          {/* Optional SHA */}
          <div className="grid gap-1.5">
            <label className={ccLabel}>SHA-256 Hash (optional — zur Verifikation)</label>
            <input type="text" value={suSha} onChange={e => setSuSha(e.target.value)}
              placeholder="a1b2c3d4..." className={ccInput('font-mono')} />
          </div>

          <div className="flex gap-2">
            <button onClick={handleSelfUpdate} disabled={suRunning || !devToken} className={ccBtnDanger()}>
              {suRunning ? (
                <><CircleNotch size={14} className="animate-spin mr-1" /> Lade herunter & ersetze…</>
              ) : (
                <><Terminal size={14} className="mr-1" /> Dev Bridge Self-Update starten</>
              )}
            </button>
          </div>

          {suResult && (
            <div className="rounded-xl bg-black/20 border border-foreground/10 p-3">
              <pre className="text-[10px] font-mono text-foreground/70 whitespace-pre-wrap max-h-[300px] overflow-y-auto">{suResult}</pre>
            </div>
          )}
        </div>
      </AdminCard>
    </div>
  )
}

function DevicesTab({ token }: { token: string }) {
  const [data, setData] = useState<AdminDevicesPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'online' | 'offline'>('all')

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const r = await adminFetch('/api/admin/devices', token)
      setData(r as AdminDevicesPayload)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    load()
    const id = setInterval(load, 15000)
    return () => clearInterval(id)
  }, [load])

  const remove = async (id: string) => {
    if (!confirm('Gerät wirklich aus der Registrierung entfernen?')) return
    try {
      await adminFetch(`/api/admin/devices/${encodeURIComponent(id)}`, token, { method: 'DELETE' })
      toast.success('Gerät entfernt')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const filtered = (data?.devices ?? []).filter((d) => {
    if (filter === 'online') return d.online
    if (filter === 'offline') return !d.online
    return true
  })

  const formatAgo = (s: number): string => {
    if (s < 60) return `${s}s`
    if (s < 3600) return `${Math.floor(s / 60)}m`
    if (s < 86400) return `${Math.floor(s / 3600)}h`
    return `${Math.floor(s / 86400)}d`
  }

  const deviceIcon = (t?: string | null) => {
    const tt = (t ?? '').toLowerCase()
    if (tt.includes('desktop')) return Desktop
    if (tt.includes('mobile') || tt.includes('phone')) return Broadcast
    if (tt.includes('kiosk') || tt.includes('terminal')) return Monitor
    return Cpu
  }

  return (
    <div className="space-y-3">
      <AdminCard title="Verbundene Geräte" icon={Desktop}>
        {loading && !data ? (
          <p className="text-xs text-foreground/50">Lade Geräte…</p>
        ) : error ? (
          <p className="text-xs text-red-300">{error}</p>
        ) : data ? (
          <>
            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className="rounded-xl bg-foreground/[0.04] border border-foreground/10 p-3">
                <div className="text-[10px] uppercase tracking-wide text-foreground/40">Registriert</div>
                <div className="text-base font-semibold text-foreground mt-1">{data.total}</div>
              </div>
              <div className="rounded-xl bg-green-500/10 border border-green-500/20 p-3">
                <div className="text-[10px] uppercase tracking-wide text-green-300/70">Online</div>
                <div className="text-base font-semibold text-green-300 mt-1">{data.online}</div>
                <div className="text-[10px] text-green-300/50 mt-0.5">≤ {data.online_threshold_seconds}s</div>
              </div>
              <div className="rounded-xl bg-accent/10 border border-accent/20 p-3">
                <div className="text-[10px] uppercase tracking-wide text-accent/70">WebSocket-Sitzungen</div>
                <div className="text-base font-semibold text-accent mt-1">{data.connected_ws_clients}</div>
                <div className="text-[10px] text-accent/50 mt-0.5">live</div>
              </div>
            </div>

            <div className="flex items-center gap-1 mb-3">
              {(['all', 'online', 'offline'] as const).map((f) => (
                <button key={f} onClick={() => setFilter(f)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                    filter === f ? 'bg-accent/20 text-accent' : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/10'
                  }`}>
                  {f === 'all' ? `Alle (${data.devices.length})` : f === 'online' ? `Online (${data.online})` : `Offline (${data.total - data.online})`}
                </button>
              ))}
              <button onClick={load} disabled={loading}
                className="ml-auto p-1.5 rounded-lg bg-foreground/5 text-foreground/60 hover:bg-foreground/10 disabled:opacity-40">
                <ArrowClockwise size={13} />
              </button>
            </div>

            {filtered.length === 0 ? (
              <p className="text-xs text-foreground/50">Keine Geräte in dieser Auswahl.</p>
            ) : (
              <div className="space-y-2">
                {filtered.map((d) => {
                  const Icon = deviceIcon(d.device_type)
                  return (
                    <div key={d.id} className={`rounded-xl border p-3 ${d.online ? 'border-green-500/30 bg-green-500/5' : 'border-foreground/10 bg-foreground/[0.03]'}`}>
                      <div className="flex items-start gap-3">
                        <div className={`rounded-lg p-2 ${d.online ? 'bg-green-500/15 text-green-300' : 'bg-foreground/10 text-foreground/40'}`}>
                          <Icon size={18} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-foreground truncate">{d.device_name}</span>
                            {d.device_type && <span className="text-[10px] px-1.5 py-0.5 rounded bg-foreground/10 text-foreground/60 font-mono">{d.device_type}</span>}
                            {d.is_terminal && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 font-mono">terminal</span>}
                            {d.online ? (
                              <span className="ml-auto flex items-center gap-1 text-[10px] text-green-300">
                                <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" /> online
                              </span>
                            ) : (
                              <span className="ml-auto text-[10px] text-foreground/40">offline · vor {formatAgo(d.seconds_since_seen)}</span>
                            )}
                          </div>
                          {d.terminal_name && <div className="text-[11px] text-foreground/50 mt-0.5">Terminal: {d.terminal_name}</div>}
                          {d.user_agent && <div className="text-[10px] text-foreground/40 mt-1 font-mono truncate">{d.user_agent}</div>}
                          <div className="text-[10px] text-foreground/30 mt-1 flex gap-2 flex-wrap">
                            <span className="font-mono">{d.id.slice(0, 8)}</span>
                            <span>· zuletzt: {new Date(d.last_seen).toLocaleString('de-DE')}</span>
                            <span>· seit: {new Date(d.created_at).toLocaleDateString('de-DE')}</span>
                          </div>
                        </div>
                        <button onClick={() => remove(d.id)} title="Gerät entfernen"
                          className="p-1.5 rounded-lg bg-red-500/15 text-red-300 hover:bg-red-500/25">
                          <Trash size={13} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        ) : null}
      </AdminCard>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
// IORA BACKEND-SERVICE TABS
// ════════════════════════════════════════════════════════════════════════
//
// Each of the iora-* microservices exposes its own HTTP API. These tabs
// expose the most important admin-facing surface of every service the
// control center previously had no UI for. All requests go through
// nginx (`/api/<service>/*`) so the same JWT works everywhere.

// Small helper for JSON dumps that fit nicely in a card.
function ServiceJsonBlock({ data, max = 'max-h-72' }: { data: unknown; max?: string }) {
  return (
    <pre className={`text-[11px] font-mono whitespace-pre-wrap break-words bg-foreground/5 border border-foreground/10 rounded-lg p-3 text-foreground/80 ${max} overflow-auto`}>
      {JSON.stringify(data, null, 2)}
    </pre>
  )
}

// ─── Dev Bridge: Journal (System-Logs) ────────────────────────────────

function DevBridgeJournal({ devToken }: { devToken: string | null }) {
  const [logs, setLogs] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tail, setTail] = useState(200)
  const [priority, setPriority] = useState('warning')
  const [autoRefresh, setAutoRefresh] = useState(false)
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadLogs = useCallback(async (t?: number, p?: string) => {
    if (!devToken) return
    setLoading(true)
    setError('')
    try {
      const tVal = t ?? tail
      const pVal = p ?? priority
      const res = await devBridgeFetch(`/dev/system/journal?tail=${tVal}&priority=${encodeURIComponent(pVal)}`, devToken)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const stdout = data.stdout || ''
      setLogs(stdout.split('\n').filter(Boolean))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setLoading(false)
  }, [devToken, tail, priority])

  useEffect(() => { if (devToken) loadLogs() }, [devToken, loadLogs])

  // Auto-Refresh
  useEffect(() => {
    if (autoRefresh && devToken) {
      autoRefreshRef.current = setInterval(() => loadLogs(), 10_000)
    } else if (autoRefreshRef.current) {
      clearInterval(autoRefreshRef.current)
      autoRefreshRef.current = null
    }
    return () => { if (autoRefreshRef.current) clearInterval(autoRefreshRef.current) }
  }, [autoRefresh, devToken, loadLogs])

  if (!devToken) return null

  return (
    <AdminCard title="System-Journal" icon={ListBullets}>
      <div className="space-y-3">
        {/* Filter */}
        <div className="flex items-center gap-2 flex-wrap">
          <select value={priority} onChange={e => { setPriority(e.target.value); loadLogs(tail, e.target.value) }}
            className="px-2.5 py-1.5 rounded-lg text-xs bg-foreground/5 border border-foreground/10 text-foreground">
            <option value="emerg">emerg</option>
            <option value="alert">alert</option>
            <option value="crit">crit</option>
            <option value="error">error</option>
            <option value="warning">warning</option>
            <option value="notice">notice</option>
            <option value="info">info</option>
            <option value="debug">debug</option>
          </select>
          <select value={tail} onChange={e => { setTail(Number(e.target.value)); loadLogs(Number(e.target.value), priority) }}
            className="px-2.5 py-1.5 rounded-lg text-xs bg-foreground/5 border border-foreground/10 text-foreground">
            <option value={50}>50 Zeilen</option>
            <option value={200}>200 Zeilen</option>
            <option value={500}>500 Zeilen</option>
            <option value={1000}>1000 Zeilen</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs text-foreground/60 cursor-pointer ml-2">
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-foreground/30" />
            Auto-Refresh (10s)
          </label>
          <button onClick={() => loadLogs()} disabled={loading} className={ccBtnSecondary('text-xs ml-auto')}>
            <ArrowClockwise size={12} className={loading ? 'animate-spin' : ''} /> Aktualisieren
          </button>
        </div>

        {/* Log-Ansicht */}
        {loading && logs.length === 0 ? (
          <LoadingSpinner />
        ) : error ? (
          <ErrorMessage>{error}</ErrorMessage>
        ) : logs.length === 0 ? (
          <p className="text-xs text-foreground/50 text-center py-8">Keine Log-Einträge gefunden.</p>
        ) : (
          <div className="max-h-[500px] overflow-y-auto font-mono text-[10px] leading-relaxed bg-black/20 rounded-xl p-3 space-y-0.5">
            {logs.map((line, i) => {
              const level = line.includes('EMERG') || line.includes('emerg') ? 'text-red-300' :
                line.includes('ALERT') || line.includes('alert') ? 'text-red-400' :
                line.includes('CRIT') || line.includes('crit') ? 'text-red-500' :
                line.includes('ERR') || line.includes('error') ? 'text-red-400' :
                line.includes('WARN') || line.includes('warning') ? 'text-amber-400' :
                line.includes('NOTICE') || line.includes('notice') ? 'text-blue-400' :
                line.includes('INFO') || line.includes('info') ? 'text-foreground/70' :
                line.includes('DEBUG') || line.includes('debug') ? 'text-foreground/40' :
                'text-foreground/60'
              return (
                <div key={i} className={`${level} truncate hover:text-foreground hover:bg-foreground/5 px-1 rounded transition-colors`}>
                  {line}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </AdminCard>
  )
}

// ─── Dev Bridge: Docker Compose ─────────────────────────────────────────

function DevBridgeCompose({ devToken }: { devToken: string | null }) {
  const [svcName, setSvcName] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [composeLogs, setComposeLogs] = useState<string[]>([])
  const [showLogs, setShowLogs] = useState(false)

  const handleReload = async () => {
    if (!devToken || !svcName) return
    setLoading(true)
    setStatus(null)
    try {
      const res = await devBridgeFetch(`/dev/compose/${encodeURIComponent(svcName)}/reload`, devToken, { method: 'POST' })
      const data = await res.json()
      setStatus(JSON.stringify(data, null, 2))
      if (data.ok) toast.success(`${svcName} wird neu geladen…`)
      else toast.error('Fehler beim Neuladen')
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
      toast.error('Fehler beim Neuladen')
    }
    setLoading(false)
  }

  const handleLogs = async () => {
    if (!devToken || !svcName) return
    setLoading(true)
    try {
      const res = await devBridgeFetch(`/dev/compose/${encodeURIComponent(svcName)}/logs`, devToken, {
        method: 'POST',
        body: JSON.stringify({ tail: 100 }),
      })
      const data = await res.json()
      const stdout = data.stdout || ''
      setComposeLogs(stdout.split('\n').filter(Boolean))
      setShowLogs(true)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
    setLoading(false)
  }

  if (!devToken) return null

  return (
    <AdminCard title="Docker Compose Services" icon={Cube}>
      <div className="space-y-4">
        <p className="text-xs text-foreground/60">
          Steuere Docker-Compose-Services im IORA-Compose-Verzeichnis ({' '}
          <code className="font-mono">{'/mnt/data/iora'}</code> ).
        </p>

        <div className="flex gap-2">
          <input type="text" value={svcName} onChange={e => setSvcName(e.target.value)}
            placeholder="Service-Name (z.B. iora-home)" className={ccInput('flex-1')}
            onKeyDown={e => e.key === 'Enter' && handleReload()} />
          <button onClick={handleReload} disabled={loading || !svcName} className={ccBtnSecondary()}>
            <ArrowClockwise size={14} className={loading ? 'animate-spin' : ''} />
            Reload
          </button>
          <button onClick={handleLogs} disabled={loading || !svcName} className={ccBtnPrimary()}>
            <ListBullets size={14} />
            Logs
          </button>
        </div>

        {status && (
          <div className="rounded-xl bg-black/20 border border-foreground/10 p-3">
            <pre className="text-[10px] font-mono text-foreground/70 whitespace-pre-wrap max-h-[200px] overflow-y-auto">{status}</pre>
          </div>
        )}

        {showLogs && composeLogs.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-foreground/70">Logs: {svcName}</span>
              <button onClick={() => setShowLogs(false)} className={ccBtnIcon()}>
                <X size={14} />
              </button>
            </div>
            <div className="max-h-[400px] overflow-y-auto font-mono text-[10px] leading-relaxed bg-black/20 rounded-xl p-3 space-y-0.5">
              {composeLogs.map((line, i) => (
                <div key={i} className={`${
                  line.includes('ERROR') || line.includes('error') ? 'text-red-400' :
                  line.includes('WARN') || line.includes('warn') ? 'text-amber-400' :
                  'text-foreground/70'
                } truncate`}>{line}</div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AdminCard>
  )
}


// ─── Secrets (iora-secrets) ─────────────────────────────────────────────
interface SecretRow {
  id: string
  name: string
  description?: string | null
  category?: string | null
  created_at?: string
  updated_at?: string
  rotation_due?: string | null
}

function SecretsTab({ token }: { token: string }) {
  const [list, setList] = useState<SecretRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [audit, setAudit] = useState<unknown>(null)
  const [auditFor, setAuditFor] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [category, setCategory] = useState('api-key')
  const [description, setDescription] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const r = await adminFetch('/api/secrets', token)
      const arr = (r as Record<string, unknown>)?.secrets ?? r
      setList(Array.isArray(arr) ? (arr as SecretRow[]) : [])
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { load() }, [load])

  const create = async () => {
    if (!name.trim() || !value) return
    try {
      await adminFetch('/api/secrets', token, {
        method: 'POST',
        body: JSON.stringify({ name, value, category, description: description || null }),
      })
      toast.success('Secret gespeichert')
      setName(''); setValue(''); setDescription('')
      await load()
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
  }

  const rotate = async (id: string) => {
    const v = prompt('Neuer Wert für das Secret?')
    if (!v) return
    try {
      await adminFetch(`/api/secrets/${id}/rotate`, token, {
        method: 'POST',
        body: JSON.stringify({ value: v }),
      })
      toast.success('Secret rotiert')
      await load()
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
  }

  const remove = async (id: string) => {
    if (!confirm('Secret wirklich löschen?')) return
    try {
      await adminFetch(`/api/secrets/${id}`, token, { method: 'DELETE' })
      toast.success('Secret gelöscht'); await load()
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
  }

  const showAudit = async (id: string) => {
    try {
      const r = await adminFetch(`/api/secrets/${id}/audit`, token)
      setAudit(r); setAuditFor(id)
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
  }

  return (
    <div className="space-y-3">
      <AdminCard title="Neues Secret anlegen" icon={Plus}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (z. B. OPENAI_API_KEY)"
            className="text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground" />
          <select value={category} onChange={(e) => setCategory(e.target.value)}
            className="text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground">
            <option value="api-key">api-key</option>
            <option value="password">password</option>
            <option value="token">token</option>
            <option value="certificate">certificate</option>
            <option value="other">other</option>
          </select>
          <input value={value} onChange={(e) => setValue(e.target.value)} type="password" placeholder="Wert"
            className="text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground" />
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Beschreibung (optional)"
            className="text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground" />
        </div>
        <div className="mt-2">
          <button onClick={create} disabled={!name.trim() || !value}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-40">
            Speichern
          </button>
        </div>
      </AdminCard>

      <AdminCard title={`Secrets (${list.length})`} icon={Vault}>
        <div className="flex justify-end mb-2">
          <button onClick={load} disabled={loading} className="p-1.5 rounded-lg bg-foreground/5 text-foreground/60 hover:bg-foreground/10 disabled:opacity-40">
            <ArrowClockwise size={13} />
          </button>
        </div>
        {error && <p className="text-xs text-red-300">{error}</p>}
        {loading && <p className="text-xs text-foreground/50">Lade…</p>}
        {!loading && list.length === 0 && <p className="text-xs text-foreground/50">Keine Secrets gespeichert.</p>}
        <div className="space-y-2">
          {list.map((s) => (
            <div key={s.id} className="rounded-xl bg-foreground/5 border border-foreground/10 p-3">
              <div className="flex items-center gap-2 flex-wrap">
                <LockKey size={14} className="text-foreground/50" />
                <span className="text-sm font-semibold text-foreground">{s.name}</span>
                {s.category && <span className="text-[10px] px-1.5 py-0.5 rounded bg-foreground/10 text-foreground/60 font-mono">{s.category}</span>}
                <div className="ml-auto flex items-center gap-1">
                  <button onClick={() => showAudit(s.id)} title="Audit-Log" className="p-1.5 rounded-lg bg-foreground/5 text-foreground/60 hover:bg-foreground/10"><Eye size={13} /></button>
                  <button onClick={() => rotate(s.id)} title="Rotieren" className="p-1.5 rounded-lg bg-accent/15 text-accent hover:bg-accent/25"><ArrowClockwise size={13} /></button>
                  <button onClick={() => remove(s.id)} title="Löschen" className="p-1.5 rounded-lg bg-red-500/15 text-red-300 hover:bg-red-500/25"><Trash size={13} /></button>
                </div>
              </div>
              {s.description && <div className="text-[11px] text-foreground/60 mt-1">{s.description}</div>}
              <div className="text-[10px] text-foreground/40 mt-1 flex gap-3 flex-wrap">
                <span className="font-mono">{s.id.slice(0, 12)}</span>
                {s.updated_at && <span>aktualisiert: {new Date(s.updated_at).toLocaleString('de-DE')}</span>}
                {s.rotation_due && <span className="text-amber-300">Rotation fällig: {new Date(s.rotation_due).toLocaleDateString('de-DE')}</span>}
              </div>
            </div>
          ))}
        </div>
        {auditFor && audit !== null && (
          <div className="mt-3 rounded-xl bg-foreground/[0.04] border border-foreground/10 p-3">
            <div className="flex items-center mb-2">
              <span className="text-xs font-semibold text-foreground">Audit-Log <span className="font-mono text-foreground/50">{auditFor.slice(0, 12)}</span></span>
              <button onClick={() => { setAudit(null); setAuditFor(null) }} className="ml-auto p-1 rounded bg-foreground/5 text-foreground/50 hover:bg-foreground/10"><X size={12} /></button>
            </div>
            <ServiceJsonBlock data={audit} />
          </div>
        )}
      </AdminCard>
    </div>
  )
}

// ─── Files (iora-files) ─────────────────────────────────────────────────
interface FileRow {
  id: string
  name: string
  size?: number
  mime_type?: string | null
  is_folder?: boolean
  parent_id?: string | null
  created_at?: string
  updated_at?: string
  is_deleted?: boolean
}
interface ShareRow { id: string; file_id: string; token: string; expires_at?: string | null; created_at?: string }
interface QuotaInfo { used?: number; limit?: number; file_count?: number }

function FilesTab({ token }: { token: string }) {
  const [files, setFiles] = useState<FileRow[]>([])
  const [shares, setShares] = useState<ShareRow[]>([])
  const [quota, setQuota] = useState<QuotaInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'files' | 'shares' | 'quota'>('files')
  const [folderName, setFolderName] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [f, s, q] = await Promise.all([
        adminFetch('/api/files/', token).catch(() => null),
        adminFetch('/api/files/shares', token).catch(() => null),
        adminFetch('/api/files/quota', token).catch(() => null),
      ])
      const fa = (f as Record<string, unknown> | null)?.files ?? f
      const sa = (s as Record<string, unknown> | null)?.shares ?? s
      setFiles(Array.isArray(fa) ? (fa as FileRow[]) : [])
      setShares(Array.isArray(sa) ? (sa as ShareRow[]) : [])
      setQuota(q as QuotaInfo | null)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { load() }, [load])

  const fmtSize = (n?: number) => {
    if (!n) return '0 B'
    const u = ['B', 'KB', 'MB', 'GB', 'TB']
    let i = 0; let v = n
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
    return `${v.toFixed(i ? 1 : 0)} ${u[i]}`
  }

  const createFolder = async () => {
    if (!folderName.trim()) return
    try {
      await adminFetch('/api/files/folders', token, { method: 'POST', body: JSON.stringify({ name: folderName }) })
      toast.success('Ordner erstellt'); setFolderName(''); await load()
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
  }

  const removeFile = async (id: string) => {
    if (!confirm('Datei in den Papierkorb verschieben?')) return
    try {
      await adminFetch(`/api/files/${id}`, token, { method: 'DELETE' })
      toast.success('Verschoben'); await load()
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
  }

  const revokeShare = async (id: string) => {
    if (!confirm('Freigabe widerrufen?')) return
    try {
      await adminFetch(`/api/files/shares/${id}`, token, { method: 'DELETE' })
      toast.success('Freigabe widerrufen'); await load()
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
  }

  return (
    <div className="space-y-3">
      <AdminCard title="Datei-Verwaltung" icon={FolderOpen}>
        <div className="flex items-center gap-1 mb-3">
          {(['files', 'shares', 'quota'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${view === v ? 'bg-accent/20 text-accent' : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/10'}`}>
              {v === 'files' ? `Dateien (${files.length})` : v === 'shares' ? `Freigaben (${shares.length})` : 'Quota'}
            </button>
          ))}
          <button onClick={load} disabled={loading} className="ml-auto p-1.5 rounded-lg bg-foreground/5 text-foreground/60 hover:bg-foreground/10 disabled:opacity-40"><ArrowClockwise size={13} /></button>
        </div>
        {error && <p className="text-xs text-red-300 mb-2">{error}</p>}
        {loading && <p className="text-xs text-foreground/50">Lade…</p>}

        {!loading && view === 'files' && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input value={folderName} onChange={(e) => setFolderName(e.target.value)} placeholder="Neuer Ordner-Name…"
                className="flex-1 text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground" />
              <button onClick={createFolder} disabled={!folderName.trim()}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-40">Ordner anlegen</button>
            </div>
            {files.length === 0 ? (
              <p className="text-xs text-foreground/50">Keine Dateien.</p>
            ) : (
              <div className="space-y-1.5 max-h-96 overflow-auto">
                {files.map((f) => (
                  <div key={f.id} className="rounded-lg bg-foreground/5 border border-foreground/10 p-2.5 flex items-center gap-2">
                    {f.is_folder ? <FolderOpen size={14} className="text-amber-300" /> : <FileArrowDown size={14} className="text-foreground/50" />}
                    <span className="text-xs font-medium text-foreground truncate">{f.name}</span>
                    {f.mime_type && <span className="text-[10px] font-mono text-foreground/40">{f.mime_type}</span>}
                    <span className="ml-auto text-[10px] text-foreground/50">{fmtSize(f.size)}</span>
                    <button onClick={() => removeFile(f.id)} className="p-1 rounded bg-red-500/15 text-red-300 hover:bg-red-500/25"><Trash size={11} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!loading && view === 'shares' && (
          <div className="space-y-2 max-h-96 overflow-auto">
            {shares.length === 0 ? (
              <p className="text-xs text-foreground/50">Keine aktiven Freigabe-Links.</p>
            ) : shares.map((s) => (
              <div key={s.id} className="rounded-lg bg-foreground/5 border border-foreground/10 p-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-foreground/70 truncate">{s.token}</span>
                  <button onClick={() => revokeShare(s.id)} className="ml-auto p-1.5 rounded bg-red-500/15 text-red-300 hover:bg-red-500/25"><Trash size={11} /></button>
                </div>
                <div className="text-[10px] text-foreground/40 mt-1">
                  Datei: <span className="font-mono">{s.file_id.slice(0, 8)}</span>
                  {s.expires_at && <span className="ml-2">läuft ab: {new Date(s.expires_at).toLocaleString('de-DE')}</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && view === 'quota' && quota && (
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-foreground/[0.04] border border-foreground/10 p-3">
                <div className="text-[10px] uppercase text-foreground/40">Benutzt</div>
                <div className="text-base font-semibold text-foreground mt-1">{fmtSize(quota.used)}</div>
              </div>
              <div className="rounded-xl bg-foreground/[0.04] border border-foreground/10 p-3">
                <div className="text-[10px] uppercase text-foreground/40">Limit</div>
                <div className="text-base font-semibold text-foreground mt-1">{quota.limit ? fmtSize(quota.limit) : '–'}</div>
              </div>
              <div className="rounded-xl bg-foreground/[0.04] border border-foreground/10 p-3">
                <div className="text-[10px] uppercase text-foreground/40">Dateien</div>
                <div className="text-base font-semibold text-foreground mt-1">{quota.file_count ?? 0}</div>
              </div>
            </div>
            {quota.limit && quota.used !== undefined && (
              <div className="h-2 bg-foreground/10 rounded-full overflow-hidden">
                <div className="h-full bg-accent" style={{ width: `${Math.min(100, (quota.used / quota.limit) * 100)}%` }} />
              </div>
            )}
          </div>
        )}
      </AdminCard>
    </div>
  )
}

// ─── Gateway (iora-gateway) ─────────────────────────────────────────────
function GatewayTab({ token }: { token: string }) {
  const [view, setView] = useState<'email' | 'search' | 'http' | 'log' | 'ai-log'>('email')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)

  const [emailTo, setEmailTo] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')

  const [searchQ, setSearchQ] = useState('')
  const [httpUrl, setHttpUrl] = useState('https://')

  const [requestLog, setRequestLog] = useState<unknown>(null)
  const [aiLog, setAiLog] = useState<unknown>(null)

  const sendEmail = async () => {
    if (!emailTo.trim() || !emailSubject.trim()) return
    setBusy(true); setError(null); setResult(null)
    try {
      const r = await adminFetch('/api/gateway/email', token, { method: 'POST', body: JSON.stringify({ to: emailTo, subject: emailSubject, body: emailBody }) })
      setResult(r); toast.success('E-Mail versendet')
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  const search = async () => {
    if (!searchQ.trim()) return
    setBusy(true); setError(null); setResult(null)
    try { setResult(await adminFetch('/api/gateway/search', token, { method: 'POST', body: JSON.stringify({ query: searchQ }) })) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  const httpGet = async () => {
    if (!httpUrl.trim()) return
    setBusy(true); setError(null); setResult(null)
    try { setResult(await adminFetch('/api/gateway/http/get', token, { method: 'POST', body: JSON.stringify({ url: httpUrl }) })) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  const loadLog = useCallback(async () => {
    try { setRequestLog(await adminFetch('/api/gateway/requests', token)) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }, [token])
  const loadAiLog = useCallback(async () => {
    try { setAiLog(await adminFetch('/api/gateway/ai-requests', token)) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }, [token])
  useEffect(() => { if (view === 'log') loadLog(); if (view === 'ai-log') loadAiLog() }, [view, loadLog, loadAiLog])

  return (
    <div className="space-y-3">
      <AdminCard title="External Gateway" icon={Envelope}>
        <p className="text-xs text-foreground/60 mb-3">
          Egress-Service für E-Mail, Web-Suche und externe HTTP-Aufrufe — alle ausgehenden Anfragen werden geloggt und können dem AI-Assistenten als Tool zur Verfügung gestellt werden.
        </p>
        <div className="flex flex-wrap items-center gap-1 mb-3">
          {(['email', 'search', 'http', 'log', 'ai-log'] as const).map((v) => (
            <button key={v} onClick={() => { setView(v); setResult(null); setError(null) }}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${view === v ? 'bg-accent/20 text-accent' : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/10'}`}>
              {v === 'email' ? 'E-Mail' : v === 'search' ? 'Web-Suche' : v === 'http' ? 'HTTP GET' : v === 'log' ? 'Request-Log' : 'AI-Anfragen'}
            </button>
          ))}
        </div>

        {view === 'email' && (
          <div className="space-y-2">
            <input value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="empfänger@example.com"
              className="w-full text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground" />
            <input value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} placeholder="Betreff"
              className="w-full text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground" />
            <textarea value={emailBody} onChange={(e) => setEmailBody(e.target.value)} rows={4} placeholder="Inhalt…"
              className="w-full text-xs bg-foreground/5 border border-foreground/10 rounded-lg p-3 text-foreground" />
            <button onClick={sendEmail} disabled={busy || !emailTo.trim() || !emailSubject.trim()}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-40">{busy ? '…' : 'Senden'}</button>
          </div>
        )}
        {view === 'search' && (
          <div className="flex items-center gap-2">
            <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} placeholder="Suchbegriff…"
              className="flex-1 text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground" />
            <button onClick={search} disabled={busy || !searchQ.trim()}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-40">{busy ? '…' : 'Suchen'}</button>
          </div>
        )}
        {view === 'http' && (
          <div className="flex items-center gap-2">
            <input value={httpUrl} onChange={(e) => setHttpUrl(e.target.value)}
              className="flex-1 text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground" />
            <button onClick={httpGet} disabled={busy || !httpUrl.trim()}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-40">{busy ? '…' : 'GET'}</button>
          </div>
        )}
        {view === 'log' && requestLog !== null && <ServiceJsonBlock data={requestLog} max="max-h-96" />}
        {view === 'ai-log' && aiLog !== null && <ServiceJsonBlock data={aiLog} max="max-h-96" />}

        {error && <p className="text-xs text-red-300 mt-2">{error}</p>}
        {result !== null && view !== 'log' && view !== 'ai-log' && <div className="mt-3"><ServiceJsonBlock data={result} /></div>}
      </AdminCard>
    </div>
  )
}

// ─── Watchdog (iora-watchdog) ───────────────────────────────────────────
interface WatchdogService { name?: string; status?: string; last_heartbeat?: string; failure_count?: number }
function WatchdogTab({ token }: { token: string }) {
  const [status, setStatus] = useState<unknown>(null)
  const [services, setServices] = useState<WatchdogService[]>([])
  const [metrics, setMetrics] = useState<unknown>(null)
  const [recovery, setRecovery] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [st, sv, m, r] = await Promise.all([
        adminFetch('/api/watchdog/status', token).catch(() => null),
        adminFetch('/api/watchdog/services', token).catch(() => null),
        adminFetch('/api/watchdog/metrics', token).catch(() => null),
        adminFetch('/api/watchdog/recovery', token).catch(() => null),
      ])
      setStatus(st)
      const arr = (sv as Record<string, unknown> | null)?.services ?? sv
      setServices(Array.isArray(arr) ? (arr as WatchdogService[]) : [])
      setMetrics(m); setRecovery(r)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { load(); const i = setInterval(load, 20000); return () => clearInterval(i) }, [load])

  const statusColor = (s?: string) => {
    const v = (s ?? '').toLowerCase()
    if (v.includes('healthy') || v === 'ok' || v === 'up') return 'bg-green-500/15 text-green-300'
    if (v.includes('degraded') || v.includes('warn')) return 'bg-amber-500/15 text-amber-300'
    if (v.includes('down') || v.includes('fail') || v.includes('crash')) return 'bg-red-500/15 text-red-300'
    return 'bg-foreground/10 text-foreground/50'
  }

  return (
    <div className="space-y-3">
      <AdminCard title="Watchdog Status" icon={Dog}>
        {loading ? <p className="text-xs text-foreground/50">Lade…</p> : error ? <p className="text-xs text-red-300">{error}</p> : (
          <div className="space-y-3">
            {status !== null && <ServiceJsonBlock data={status} max="max-h-40" />}
            <div>
              <div className="text-xs font-semibold text-foreground mb-2">Überwachte Dienste ({services.length})</div>
              {services.length === 0 ? <p className="text-xs text-foreground/50">Keine registrierten Dienste.</p> : (
                <div className="space-y-1.5 max-h-72 overflow-auto">
                  {services.map((s, i) => (
                    <div key={s.name ?? i} className="rounded-lg bg-foreground/5 border border-foreground/10 p-2.5 flex items-center gap-2">
                      <span className="text-xs font-medium text-foreground truncate">{s.name ?? '–'}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${statusColor(s.status)}`}>{s.status ?? '?'}</span>
                      {s.failure_count !== undefined && s.failure_count > 0 && <span className="text-[10px] text-red-300">{s.failure_count} Fehler</span>}
                      <span className="ml-auto text-[10px] text-foreground/40">{s.last_heartbeat && new Date(s.last_heartbeat).toLocaleTimeString('de-DE')}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <details className="rounded-xl bg-foreground/[0.03] border border-foreground/10">
              <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-foreground">Metriken</summary>
              <div className="p-3 pt-0">{metrics !== null && <ServiceJsonBlock data={metrics} />}</div>
            </details>
            <details className="rounded-xl bg-foreground/[0.03] border border-foreground/10">
              <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-foreground">Recovery-Verlauf</summary>
              <div className="p-3 pt-0">{recovery !== null && <ServiceJsonBlock data={recovery} />}</div>
            </details>
          </div>
        )}
      </AdminCard>
    </div>
  )
}

// ─── Connector (iora-connector) ─────────────────────────────────────────
interface TunnelRow { id?: string; name?: string; status?: string; endpoint?: string; created_at?: string; last_seen?: string }
interface ExposedSvc { id?: string; name?: string; tunnel_id?: string; local_port?: number; public_url?: string }
interface PairingTok { id?: string; token?: string; expires_at?: string; created_at?: string }

function ConnectorTab({ token }: { token: string }) {
  const [view, setView] = useState<'tunnels' | 'services' | 'tokens' | 'blocked'>('tunnels')
  const [tunnels, setTunnels] = useState<TunnelRow[]>([])
  const [services, setServices] = useState<ExposedSvc[]>([])
  const [tokens, setTokens] = useState<PairingTok[]>([])
  const [blocked, setBlocked] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [t, s, k, b] = await Promise.all([
        adminFetch('/api/connector/tunnels', token).catch(() => null),
        adminFetch('/api/connector/services', token).catch(() => null),
        adminFetch('/api/connector/pairing-tokens', token).catch(() => null),
        adminFetch('/api/connector/blocked-ips', token).catch(() => null),
      ])
      const ta = (t as Record<string, unknown> | null)?.tunnels ?? t
      const sa = (s as Record<string, unknown> | null)?.services ?? s
      const ka = (k as Record<string, unknown> | null)?.tokens ?? k
      setTunnels(Array.isArray(ta) ? (ta as TunnelRow[]) : [])
      setServices(Array.isArray(sa) ? (sa as ExposedSvc[]) : [])
      setTokens(Array.isArray(ka) ? (ka as PairingTok[]) : [])
      setBlocked(b)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { load() }, [load])

  const removeTunnel = async (id: string) => {
    if (!confirm('Tunnel entfernen?')) return
    try { await adminFetch(`/api/connector/tunnels/${id}`, token, { method: 'DELETE' }); toast.success('Entfernt'); await load() }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
  }
  const newToken = async () => {
    try {
      const r = await adminFetch('/api/connector/pairing-tokens', token, { method: 'POST', body: JSON.stringify({}) })
      const t = (r as Record<string, unknown>)?.token
      toast.success(t ? `Token: ${String(t).slice(0, 16)}…` : 'Token erstellt')
      await load()
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
  }
  const revokeToken = async (id: string) => {
    if (!confirm('Token widerrufen?')) return
    try { await adminFetch(`/api/connector/pairing-tokens/${id}`, token, { method: 'DELETE' }); toast.success('Widerrufen'); await load() }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
  }

  return (
    <div className="space-y-3">
      <AdminCard title="Cloud Connector" icon={ShareNetwork}>
        <div className="flex items-center gap-1 mb-3 flex-wrap">
          {(['tunnels', 'services', 'tokens', 'blocked'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${view === v ? 'bg-accent/20 text-accent' : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/10'}`}>
              {v === 'tunnels' ? `Tunnel (${tunnels.length})` : v === 'services' ? `Dienste (${services.length})` : v === 'tokens' ? `Pairing-Tokens (${tokens.length})` : 'Blockierte IPs'}
            </button>
          ))}
          <button onClick={load} disabled={loading} className="ml-auto p-1.5 rounded-lg bg-foreground/5 text-foreground/60 hover:bg-foreground/10 disabled:opacity-40"><ArrowClockwise size={13} /></button>
        </div>
        {error && <p className="text-xs text-red-300 mb-2">{error}</p>}
        {loading && <p className="text-xs text-foreground/50">Lade…</p>}

        {!loading && view === 'tunnels' && (
          tunnels.length === 0 ? <p className="text-xs text-foreground/50">Keine aktiven Tunnel.</p> : (
            <div className="space-y-2">
              {tunnels.map((t, i) => (
                <div key={t.id ?? i} className="rounded-xl bg-foreground/5 border border-foreground/10 p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">{t.name ?? t.id}</span>
                    {t.status && <span className="text-[10px] px-1.5 py-0.5 rounded bg-foreground/10 text-foreground/60 font-mono">{t.status}</span>}
                    <button onClick={() => t.id && removeTunnel(t.id)} className="ml-auto p-1.5 rounded bg-red-500/15 text-red-300 hover:bg-red-500/25"><Trash size={11} /></button>
                  </div>
                  {t.endpoint && <div className="text-[10px] font-mono text-foreground/50 mt-1">{t.endpoint}</div>}
                </div>
              ))}
            </div>
          )
        )}
        {!loading && view === 'services' && (
          services.length === 0 ? <p className="text-xs text-foreground/50">Keine exponierten Dienste.</p> : (
            <div className="space-y-2">
              {services.map((s, i) => (
                <div key={s.id ?? i} className="rounded-xl bg-foreground/5 border border-foreground/10 p-3">
                  <div className="text-sm font-semibold text-foreground">{s.name ?? s.id}</div>
                  <div className="text-[10px] text-foreground/40 mt-1 flex gap-2 flex-wrap">
                    {s.local_port && <span>Port: {s.local_port}</span>}
                    {s.public_url && <span className="font-mono">{s.public_url}</span>}
                  </div>
                </div>
              ))}
            </div>
          )
        )}
        {!loading && view === 'tokens' && (
          <>
            <button onClick={newToken} className="mb-3 px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent/20 text-accent hover:bg-accent/30 flex items-center gap-1"><Plus size={12} /> Pairing-Token erstellen</button>
            {tokens.length === 0 ? <p className="text-xs text-foreground/50">Keine Tokens.</p> : (
              <div className="space-y-2">
                {tokens.map((k, i) => (
                  <div key={k.id ?? i} className="rounded-xl bg-foreground/5 border border-foreground/10 p-3 flex items-center gap-2">
                    <span className="text-xs font-mono text-foreground/70 truncate flex-1">{k.token ?? k.id}</span>
                    {k.expires_at && <span className="text-[10px] text-foreground/40">läuft ab: {new Date(k.expires_at).toLocaleString('de-DE')}</span>}
                    <button onClick={() => k.id && revokeToken(k.id)} className="p-1.5 rounded bg-red-500/15 text-red-300 hover:bg-red-500/25"><Trash size={11} /></button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {!loading && view === 'blocked' && blocked !== null && <ServiceJsonBlock data={blocked} max="max-h-96" />}
      </AdminCard>
    </div>
  )
}

// ─── Domain Validator (iora-domain-validator) ───────────────────────────
function DomainValidatorTab({ token }: { token: string }) {
  const [appId, setAppId] = useState('')
  const [policy, setPolicy] = useState<unknown>(null)
  const [logs, setLogs] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [validateUrl, setValidateUrl] = useState('https://')
  const [validateApp, setValidateApp] = useState('')
  const [validation, setValidation] = useState<unknown>(null)

  const loadFor = async () => {
    if (!appId.trim()) return
    setBusy(true); setError(null); setPolicy(null); setLogs(null)
    try {
      const [p, l] = await Promise.all([
        adminFetch(`/api/domain-validator/policy/${encodeURIComponent(appId)}`, token).catch(() => null),
        adminFetch(`/api/domain-validator/logs/${encodeURIComponent(appId)}`, token).catch(() => null),
      ])
      setPolicy(p); setLogs(l)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  const validate = async () => {
    if (!validateUrl.trim() || !validateApp.trim()) return
    setBusy(true); setError(null); setValidation(null)
    try {
      const r = await adminFetch('/api/domain-validator/validate', token, {
        method: 'POST',
        body: JSON.stringify({ app_id: validateApp, url: validateUrl }),
      })
      setValidation(r)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  return (
    <div className="space-y-3">
      <AdminCard title="Zugriff prüfen" icon={ShieldCheck}>
        <p className="text-xs text-foreground/60 mb-3">
          Manueller Test: Darf eine bestimmte App auf eine externe URL zugreifen? Liefert die gleiche Entscheidung wie der Live-Validator.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input value={validateApp} onChange={(e) => setValidateApp(e.target.value)} placeholder="App-ID"
            className="text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground" />
          <input value={validateUrl} onChange={(e) => setValidateUrl(e.target.value)} placeholder="https://example.com/path"
            className="text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground" />
        </div>
        <button onClick={validate} disabled={busy || !validateUrl.trim() || !validateApp.trim()}
          className="mt-2 px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-40">{busy ? '…' : 'Validieren'}</button>
        {validation !== null && <div className="mt-3"><ServiceJsonBlock data={validation} /></div>}
      </AdminCard>

      <AdminCard title="Policy & Audit-Log pro App" icon={Eye}>
        <div className="flex items-center gap-2 mb-3">
          <input value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="App-ID eingeben…"
            className="flex-1 text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground" />
          <button onClick={loadFor} disabled={busy || !appId.trim()}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-40">{busy ? '…' : 'Laden'}</button>
        </div>
        {error && <p className="text-xs text-red-300 mb-2">{error}</p>}
        {policy !== null && (
          <div className="mb-3">
            <div className="text-xs font-semibold text-foreground mb-1">Policy</div>
            <ServiceJsonBlock data={policy} />
          </div>
        )}
        {logs !== null && (
          <div>
            <div className="text-xs font-semibold text-foreground mb-1">Audit-Log</div>
            <ServiceJsonBlock data={logs} max="max-h-96" />
          </div>
        )}
      </AdminCard>
    </div>
  )
}

// ─── Resource Manager (iora-resource-manager) ───────────────────────────
interface ContainerRow { id?: string; name?: string; status?: string; cpu?: number; memory?: number; memory_limit?: number }
function ResourcesTab({ token }: { token: string }) {
  const [containers, setContainers] = useState<ContainerRow[]>([])
  const [system, setSystem] = useState<unknown>(null)
  const [history, setHistory] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [c, s, h] = await Promise.all([
        adminFetch('/api/resources/containers', token).catch(() => null),
        adminFetch('/api/resources/system', token).catch(() => null),
        adminFetch('/api/resources/history', token).catch(() => null),
      ])
      const arr = (c as Record<string, unknown> | null)?.containers ?? c
      setContainers(Array.isArray(arr) ? (arr as ContainerRow[]) : [])
      setSystem(s); setHistory(h)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }, [token])
  useEffect(() => { load(); const i = setInterval(load, 15000); return () => clearInterval(i) }, [load])

  const reallocate = async () => {
    if (!confirm('Reallokation jetzt auslösen?')) return
    try { await adminFetch('/api/resources/reallocate', token, { method: 'POST', body: '{}' }); toast.success('Reallokation gestartet'); await load() }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
  }

  return (
    <div className="space-y-3">
      <AdminCard title="System-Ressourcen" icon={HardDrive}>
        {loading && <p className="text-xs text-foreground/50">Lade…</p>}
        {error && <p className="text-xs text-red-300">{error}</p>}
        {system !== null && <ServiceJsonBlock data={system} max="max-h-40" />}
        <div className="mt-3 flex justify-end">
          <button onClick={reallocate} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent/20 text-accent hover:bg-accent/30">Reallokation auslösen</button>
        </div>
      </AdminCard>

      <AdminCard title={`Container (${containers.length})`} icon={Cube}>
        {containers.length === 0 ? <p className="text-xs text-foreground/50">Keine Container.</p> : (
          <div className="space-y-2 max-h-96 overflow-auto">
            {containers.map((c, i) => {
              const memPct = c.memory && c.memory_limit ? Math.min(100, (c.memory / c.memory_limit) * 100) : 0
              return (
                <div key={c.id ?? i} className="rounded-xl bg-foreground/5 border border-foreground/10 p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-foreground truncate">{c.name ?? c.id}</span>
                    {c.status && <span className="text-[10px] px-1.5 py-0.5 rounded bg-foreground/10 text-foreground/60 font-mono">{c.status}</span>}
                    <span className="ml-auto text-[10px] text-foreground/50">CPU {c.cpu !== undefined ? `${c.cpu.toFixed(1)}%` : '–'}</span>
                  </div>
                  {c.memory_limit && (
                    <div className="mt-2">
                      <div className="text-[10px] text-foreground/40 mb-0.5">RAM {memPct.toFixed(0)}%</div>
                      <div className="h-1.5 bg-foreground/10 rounded-full overflow-hidden">
                        <div className={`h-full ${memPct > 80 ? 'bg-red-400' : memPct > 60 ? 'bg-amber-400' : 'bg-accent'}`} style={{ width: `${memPct}%` }} />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </AdminCard>

      <AdminCard title="Allokations-Verlauf" icon={Clock}>
        {history !== null && <ServiceJsonBlock data={history} max="max-h-72" />}
      </AdminCard>
    </div>
  )
}

// ─── API Bridge (iora-api: GraphQL / WebDAV / CalDAV / MQTT) ───────────
function ApiBridgeTab({ token }: { token: string }) {
  const [metrics, setMetrics] = useState<unknown>(null)
  const [interfaces, setInterfaces] = useState<unknown>(null)
  const [topics, setTopics] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [m, i, t] = await Promise.all([
        adminFetch('/api/metrics', token).catch(() => null),
        adminFetch('/api/interfaces', token).catch(() => null),
        adminFetch('/api/mqtt/topics', token).catch(() => null),
      ])
      setMetrics(m); setInterfaces(i); setTopics(t)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }, [token])
  useEffect(() => { load() }, [load])

  const apiBase = backendBase() || window.location.origin
  const endpoints: { label: string; path: string; description: string }[] = [
    { label: 'GraphQL', path: '/graphql', description: 'GraphQL-Playground für Entities, Services, Areas' },
    { label: 'GraphQL WS', path: '/graphql/ws', description: 'Subscriptions über WebSocket' },
    { label: 'WebDAV', path: '/webdav', description: 'Datei-Mount via WebDAV-Client' },
    { label: 'CalDAV', path: '/caldav', description: 'Kalender-Sync (Apple/Thunderbird/DAVx⁵)' },
    { label: 'CalDAV Discovery', path: '/.well-known/caldav', description: 'Auto-Discovery für CalDAV-Clients' },
    { label: 'REST v2 Entities', path: '/entities', description: 'Stable v2 Entity-API' },
    { label: 'REST v2 Services', path: '/services', description: 'Stable v2 Service-Calls' },
    { label: 'Batch', path: '/batch', description: 'Batch-Anfragen für mehrere REST-Calls in einem Request' },
  ]

  return (
    <div className="space-y-3">
      <AdminCard title="Externe API-Schnittstellen" icon={Code}>
        <p className="text-xs text-foreground/60 mb-3">
          iora-api bündelt alle stabilen externen Protokolle. Kopiere eine URL, um sie in einem Client (DAVx⁵, Thunderbird, GraphiQL, …) zu konfigurieren.
        </p>
        <div className="space-y-1.5">
          {endpoints.map((e) => {
            const url = `${apiBase}${e.path}`
            return (
              <div key={e.path} className="rounded-lg bg-foreground/5 border border-foreground/10 p-2.5 flex items-center gap-2">
                <span className="text-xs font-semibold text-foreground w-28 shrink-0">{e.label}</span>
                <span className="text-[11px] font-mono text-foreground/70 truncate flex-1">{url}</span>
                <button onClick={() => { navigator.clipboard.writeText(url); toast.success('Kopiert') }} className="p-1.5 rounded bg-foreground/5 text-foreground/60 hover:bg-foreground/10"><Copy size={11} /></button>
              </div>
            )
          })}
        </div>
      </AdminCard>

      <AdminCard title="API-Metriken" icon={ChartLine}>
        {loading && <p className="text-xs text-foreground/50">Lade…</p>}
        {error && <p className="text-xs text-red-300">{error}</p>}
        {metrics !== null && <ServiceJsonBlock data={metrics} max="max-h-72" />}
      </AdminCard>

      <AdminCard title="Verfügbare Interfaces" icon={Stack}>
        {interfaces !== null && <ServiceJsonBlock data={interfaces} />}
      </AdminCard>

      <AdminCard title="MQTT Bridge — Topics" icon={WifiHigh}>
        {topics !== null && <ServiceJsonBlock data={topics} />}
      </AdminCard>
    </div>
  )
}


// ─── IORA OS (only meaningful on actual IORA OS device) ─────────────────────────

const OS_BASE = '/api/admin/iora-control'

function OsSshTab({ token }: { token: string }) {
  const [status, setStatus] = useState<{ enabled?: boolean; running?: boolean } | null>(null)
  const [users, setUsers] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [newUser, setNewUser] = useState('')
  const [pubKey, setPubKey] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [s, u] = await Promise.all([
        adminFetch(OS_BASE + '/ssh/status', token),
        adminFetch(OS_BASE + '/ssh/users', token),
      ])
      setStatus(s as { enabled?: boolean; running?: boolean })
      setUsers(u)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  const toggle = async (enabled: boolean) => {
    setBusy(true)
    try {
      await adminFetch(OS_BASE + '/ssh/enable', token, {
        method: 'POST',
        body: JSON.stringify({ enabled }),
      })
      toast.success(enabled ? 'SSH aktiviert' : 'SSH deaktiviert')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const addUser = async () => {
    if (!newUser.trim() || !pubKey.trim()) return
    setBusy(true)
    try {
      await adminFetch(OS_BASE + '/ssh/users', token, {
        method: 'POST',
        body: JSON.stringify({ username: newUser.trim(), public_key: pubKey.trim() }),
      })
      toast.success('SSH-Benutzer hinzugefuegt')
      setNewUser('')
      setPubKey('')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const removeUser = async (username: string) => {
    if (!confirm("SSH-Benutzer '" + username + "' entfernen?")) return
    setBusy(true)
    try {
      await adminFetch(OS_BASE + '/ssh/users/' + encodeURIComponent(username), token, { method: 'DELETE' })
      toast.success('Benutzer entfernt')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <AdminCard title="SSH-Server-Status" icon={Terminal}>
        {loading && <p className="text-xs text-foreground/50">Lade...</p>}
        {error && <p className="text-xs text-red-300">{error}</p>}
        {status && (
          <div className="flex items-center gap-3">
            <span className={'px-2 py-0.5 rounded-full text-xs font-semibold ' + (status.running ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300')}>
              {status.running ? 'Aktiv' : 'Inaktiv'}
            </span>
            <span className="text-xs text-foreground/60">Aktiviert beim Boot: {status.enabled ? 'ja' : 'nein'}</span>
            <div className="ml-auto flex gap-2">
              <button onClick={() => toggle(true)} disabled={busy}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-40">SSH aktivieren</button>
              <button onClick={() => toggle(false)} disabled={busy}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-500/20 text-red-300 hover:bg-red-500/30 disabled:opacity-40">SSH deaktivieren</button>
            </div>
          </div>
        )}
        {status && <div className="mt-3"><ServiceJsonBlock data={status} /></div>}
      </AdminCard>

      <AdminCard title="SSH-Benutzer hinzufuegen" icon={Plus}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input value={newUser} onChange={(e) => setNewUser(e.target.value)} placeholder="Benutzername"
            className="text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground" />
          <input value={pubKey} onChange={(e) => setPubKey(e.target.value)} placeholder="ssh-ed25519 AAAA..."
            className="sm:col-span-2 text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground font-mono" />
        </div>
        <button onClick={addUser} disabled={busy || !newUser.trim() || !pubKey.trim()}
          className="mt-2 px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-40">Hinzufuegen</button>
      </AdminCard>

      <AdminCard title="Bestehende SSH-Benutzer" icon={Users}>
        {users !== null && <ServiceJsonBlock data={users} max="max-h-96" />}
        {Array.isArray((users as { users?: unknown[] })?.users) && ((users as { users: { username: string }[] }).users).length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {(users as { users: { username: string }[] }).users.map((u) => (
              <button key={u.username} onClick={() => removeUser(u.username)}
                className="px-2 py-1 text-xs rounded-lg bg-red-500/15 text-red-300 hover:bg-red-500/25">
                {u.username} entfernen
              </button>
            ))}
          </div>
        )}
      </AdminCard>
    </div>
  )
}

function OsNetworkConfigTab({ token }: { token: string }) {
  const [interfaces, setInterfaces] = useState<any[]>([])
  const [currentIp, setCurrentIp] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [mode, setMode] = useState<'dhcp' | 'static' | 'dhcp-v4-only' | 'dhcp-v6-only' | 'hybrid'>('dhcp')
  const [ipv4, setIpv4] = useState('')
  const [gateway4, setGateway4] = useState('')
  const [ipv6, setIpv6] = useState('')
  const [gateway6, setGateway6] = useState('')
  const [dns4Primary, setDns4Primary] = useState('')
  const [dns4Secondary, setDns4Secondary] = useState('')
  const [dns6Primary, setDns6Primary] = useState('')
  const [dns6Secondary, setDns6Secondary] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)

  // Validation
  const isValidIpv4 = (value: string) => {
    const [address, prefix] = value.split('/')
    const octets = address.split('.')
    if (octets.length !== 4) return false
    if (!octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255)) return false
    return prefix === undefined || (/^\d{1,2}$/.test(prefix) && Number(prefix) >= 0 && Number(prefix) <= 32)
  }
  const isValidIpv6 = (value: string) => {
    const [address, prefix] = value.split('/')
    if (!address.includes(':') || address.length < 3) return false
    return prefix === undefined || (/^\d{1,3}$/.test(prefix) && Number(prefix) >= 0 && Number(prefix) <= 128)
  }
  const isValidDns = (value: string) => !value || isValidIpv4(value) || isValidIpv6(value)
  const isFormValid = () => {
    if (mode === 'dhcp') return true
    if (mode === 'static' || mode === 'dhcp-v6-only') {
      if (ipv4 && !isValidIpv4(ipv4)) return false
    }
    if (mode === 'static' || mode === 'dhcp-v4-only') {
      if (ipv6 && !isValidIpv6(ipv6)) return false
    }
    if (mode === 'hybrid') {
      if (ipv4 && !isValidIpv4(ipv4)) return false
      if (ipv6 && !isValidIpv6(ipv6)) return false
    }
    if (![dns4Primary, dns4Secondary, dns6Primary, dns6Secondary].every(isValidDns)) return false
    return true
  }

  const loadStatus = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const healthRes = await fetch(getBackendUrl() + '/api/health', {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      })
      if (healthRes.ok) {
        const health = await healthRes.json()
        const v4 = (health.ipv4_addrs || [health.ipv4_addrs].filter(Boolean)) as string[]
        const v6 = (health.ipv6_addrs || [health.ipv6_addrs].filter(Boolean)) as string[]
        const all = [...(Array.isArray(health.ipv4_addrs) ? health.ipv4_addrs : [health.ipv4_addrs].filter(Boolean)),
                     ...(Array.isArray(health.ipv6_addrs) ? health.ipv6_addrs : [health.ipv6_addrs].filter(Boolean))]
        const seen = new Set<string>()
        const parsed: any[] = []
        for (const addr of all) {
          const m = String(addr).match(/^(.+?)\s+\((.+?)\)$/)
          if (m && !seen.has(m[2])) {
            seen.add(m[2])
            const iv4 = v4.find((a: string) => a.includes(`(${m[2]})`))
            const iv6 = v6.find((a: string) => a.includes(`(${m[2]})`))
            parsed.push({
              name: m[2],
              ipv4: iv4 ? String(iv4).split(' ')[0] : '-',
              ipv6: iv6 ? String(iv6).split(' ')[0] : '-',
            })
          }
        }
        setInterfaces(parsed.length > 0 ? parsed : [{ name: 'eth0', ipv4: '—', ipv6: '—' }])
        const primary = typeof health.primary_ipv4 === 'string'
          ? health.primary_ipv4
          : (parsed.find((iface) => iface.ipv4 && iface.ipv4 !== '-')?.ipv4 || '').split('/')[0]
        setCurrentIp(primary)

        // Try to load current config via iora-control
        try {
          const netRes = await adminFetch(OS_BASE + '/os/network', token)
          const content: string = netRes?.netctl?.content || netRes?.content || ''
          if (content) {
            if (content.includes('DHCP=yes')) setMode('dhcp')
            else if (content.includes('DHCP=ipv4')) setMode('dhcp-v4-only')
            else if (content.includes('DHCP=ipv6')) setMode('dhcp-v6-only')
            else if (content.includes('Address=')) setMode('static')
            const v4a = content.match(/^Address=([0-9.]+\/\d+)$/m)
            const v6a = content.match(/^Address=([0-9a-f:]+\/\d+)$/mi)
            if (v4a) setIpv4(v4a[1])
            if (v6a) setIpv6(v6a[1])
            const g4 = content.match(/^Gateway=([0-9.]+)$/m)
            const g6 = content.match(/^Gateway=([0-9a-f:]+)$/mi)
            if (g4) setGateway4(g4[1])
            if (g6) setGateway6(g6[1])
            const dnsLines = content.match(/^DNS=(.+)$/gm)
            if (dnsLines) {
              const dnsList = dnsLines.map(l => l.replace(/^DNS=/, '').trim())
              const dns4 = dnsList.filter(isValidIpv4)
              const dns6 = dnsList.filter(isValidIpv6)
              if (dns4[0]) setDns4Primary(dns4[0])
              if (dns4[1]) setDns4Secondary(dns4[1])
              if (dns6[0]) setDns6Primary(dns6[0])
              if (dns6[1]) setDns6Secondary(dns6[1])
            }
          }
        } catch {}
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setLoading(false) }
  }, [token])

  useEffect(() => { loadStatus() }, [loadStatus])

  const doApply = async () => {
    setSaving(true); setShowConfirm(false)
    try {
      const dns4 = [dns4Primary, dns4Secondary].map((value) => value.trim()).filter(Boolean)
      const dns6 = [dns6Primary, dns6Secondary].map((value) => value.trim()).filter(Boolean)
      const config: Record<string, any> = {
        mode,
        ipv4_config: {
          method: showV4 ? 'static' : 'dhcp',
          address: ipv4.trim(),
          gateway: gateway4.trim(),
          dns: dns4,
        },
        ipv6_config: {
          method: showV6 ? 'static' : 'dhcp',
          address: ipv6.trim(),
          gateway: gateway6.trim(),
          dns: dns6,
        },
      }
      if (mode === 'static' || mode === 'dhcp-v6-only' || mode === 'hybrid') {
        if (ipv4.trim()) config.ipv4 = ipv4.trim()
        if (gateway4.trim()) config.gateway4 = gateway4.trim()
      }
      if (mode === 'static' || mode === 'dhcp-v4-only' || mode === 'hybrid') {
        if (ipv6.trim()) config.ipv6 = ipv6.trim()
        if (gateway6.trim()) config.gateway6 = gateway6.trim()
      }
      const dnsList = [...dns4, ...dns6]
      if (dnsList.length > 0) config.dns = dnsList

      await adminFetch(OS_BASE + '/os/network/set', token, {
        method: 'POST', body: JSON.stringify(config),
      })
      setSaved(true)
      toast.success('Netzwerkkonfiguration wurde übernommen')
      setTimeout(() => {
        setSaved(false)
        loadStatus()
      }, 3000)
    } catch (e) {
      toast.error('Fehler: ' + (e instanceof Error ? e.message : String(e)))
    } finally { setSaving(false) }
  }

  if (loading) return <LoadingSpinner />

  const showV4 = mode === 'static' || mode === 'dhcp-v6-only' || mode === 'hybrid'
  const showV6 = mode === 'static' || mode === 'dhcp-v4-only' || mode === 'hybrid'

  return (
    <div className="space-y-6">
      {/* ── Live network status ── */}
      <AdminCard icon={WifiHigh} title="Live-Netzwerkstatus">
        <p className="text-xs text-foreground/50 mb-3">
          Alle Netzwerkschnittstellen mit aktuellen IP-Adressen (IPv4 + IPv6)
        </p>
        {currentIp && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-accent/15 bg-accent/[0.06] px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-accent/80">Aktuelle IP</span>
            <code className="text-xs font-mono text-foreground/90">{currentIp}</code>
            <button onClick={() => { navigator.clipboard.writeText(currentIp); toast.success('Aktuelle IP kopiert') }}
              className="p-1 rounded text-foreground/35 hover:text-accent transition-colors" title="Kopieren">
              <Copy size={12} />
            </button>
          </div>
        )}
        {error && <p className="text-xs text-red-400 mb-2 bg-red-500/10 p-2 rounded-lg">{error}</p>}
        <div className="space-y-2">
          {interfaces.map((iface, i) => (
            <div key={i} className="flex items-center gap-4 p-3.5 rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] hover:border-foreground/10 transition-colors">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${iface.ipv4 !== '-' ? 'bg-success/10' : 'bg-foreground/5'}`}>
                <Globe size={18} className={iface.ipv4 !== '-' ? 'text-success' : 'text-foreground/30'} weight="fill" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground capitalize">{iface.name}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 mt-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-semibold text-foreground/40 uppercase tracking-wider w-8">IPv4</span>
                    <code className={`text-[11px] font-mono ${iface.ipv4 !== '-' ? 'text-foreground/80' : 'text-foreground/30'}`}>
                      {iface.ipv4}
                    </code>
                    {iface.ipv4 !== '-' && (
                      <button onClick={() => { navigator.clipboard.writeText(iface.ipv4.split('/')[0]); toast.success('IPv4 kopiert') }}
                        className="p-0.5 rounded text-foreground/20 hover:text-foreground/50 transition-colors" title="Kopieren">
                        <Copy size={10} />
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-semibold text-foreground/40 uppercase tracking-wider w-8">IPv6</span>
                    <code className={`text-[11px] font-mono ${iface.ipv6 !== '-' ? 'text-foreground/80' : 'text-foreground/30'}`}>
                      {iface.ipv6 !== '-' ? iface.ipv6 : '—'}
                    </code>
                    {iface.ipv6 !== '-' && (
                      <button onClick={() => { navigator.clipboard.writeText(iface.ipv6.split('/')[0]); toast.success('IPv6 kopiert') }}
                        className="p-0.5 rounded text-foreground/20 hover:text-foreground/50 transition-colors" title="Kopieren">
                        <Copy size={10} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <button onClick={loadStatus} className="mt-3 px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent/15 text-accent hover:bg-accent/25 transition-colors">
          Neu laden
        </button>
      </AdminCard>

      {/* ── IP-Konfiguration ── */}
      <AdminCard icon={Gear} title="IP-Konfiguration">
        <p className="text-xs text-foreground/50 mb-5 leading-relaxed">
          Wähle aus, wie dein Gerät IP-Adressen bezieht. Bei <strong>„Statisch"</strong> oder <strong>„Hybrid"</strong>
          kannst du feste Adressen eingeben. Die Einstellungen werden sofort aktiv.
        </p>

        {/* ── Modus-Auswahl ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 mb-6">
          {[
            { id: 'dhcp' as const, label: 'DHCP (Auto)', icon: Globe, desc: 'IPv4 + IPv6 automatisch', detail: 'Der Router weist Adressen zu' },
            { id: 'dhcp-v4-only' as const, label: 'DHCPv4 + Statisches IPv6', icon: WifiHigh, desc: 'IPv4 automatisch', detail: 'IPv6 gibst du manuell ein' },
            { id: 'dhcp-v6-only' as const, label: 'Statisches IPv4 + DHCPv6', icon: ShareNetwork, desc: 'IPv6 automatisch', detail: 'IPv4 gibst du manuell ein' },
            { id: 'static' as const, label: 'Vollständig statisch', icon: MapPin, desc: 'Alles manuell', detail: 'IPv4 + IPv6 fest vergeben' },
            { id: 'hybrid' as const, label: 'Hybrid', icon: LinkSimple, desc: 'DHCP + Extra-IPs', detail: 'DHCP + zusätzliche statische IPs' },
          ].map(opt => (
            <button key={opt.id} onClick={() => setMode(opt.id)}
              className={`relative p-3.5 rounded-xl border-2 transition-all text-left group ${
                mode === opt.id
                  ? 'border-accent bg-accent/[0.08] shadow-sm shadow-accent/10'
                  : 'border-foreground/8 bg-foreground/[0.02] hover:border-foreground/20 hover:bg-foreground/[0.04]'
              }`}>
              <opt.icon size={18} className={`mb-2 ${mode === opt.id ? 'text-accent' : 'text-foreground/60'}`} weight="duotone" />
              <p className={`text-[12px] font-semibold leading-tight ${mode === opt.id ? 'text-accent' : 'text-foreground'}`}>{opt.label}</p>
              <p className="text-[10px] text-foreground/50 mt-0.5 leading-tight">{opt.detail}</p>
              {mode === opt.id && <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-accent" />}
            </button>
          ))}
        </div>

        {/* ── IPv4 Felder ── */}
        {showV4 && (
          <div className="mb-5 p-4 rounded-xl border border-blue-500/15 bg-blue-500/5">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-semibold text-blue-400 uppercase tracking-wider">IPv4</span>
              <span className="text-[9px] text-foreground/40">Nur bei statischer IPv4-Konfiguration nötig</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-medium text-foreground/50 mb-1 block">IP-Adresse</label>
                <input value={ipv4} onChange={e => setIpv4(e.target.value)}
                  placeholder="z.B. 192.168.1.100/24"
                  className={`w-full px-3 py-2.5 rounded-xl text-xs font-mono transition-colors ${
                    ipv4 && !isValidIpv4(ipv4) ? 'bg-red-500/10 border border-red-500/30 text-red-300' :
                    'bg-foreground/[0.04] border border-foreground/10 text-foreground hover:border-foreground/20'
                  } focus:border-accent/50 focus:outline-none focus:bg-accent/5 placeholder:text-foreground/20`} />
                {ipv4 && !isValidIpv4(ipv4) && <p className="text-[9px] text-red-400 mt-1">Ungültiges Format (z.B. 192.168.1.100/24)</p>}
              </div>
              <div>
                <label className="text-[10px] font-medium text-foreground/50 mb-1 block">Gateway (Standardroute)</label>
                <input value={gateway4} onChange={e => setGateway4(e.target.value)}
                  placeholder="z.B. 192.168.1.1"
                  className="w-full px-3 py-2.5 rounded-xl text-xs font-mono bg-foreground/[0.04] border border-foreground/10 text-foreground hover:border-foreground/20 focus:border-accent/50 focus:outline-none focus:bg-accent/5 placeholder:text-foreground/20 transition-colors" />
              </div>
            </div>
          </div>
        )}

        {/* ── IPv6 Felder ── */}
        {showV6 && (
          <div className="mb-5 p-4 rounded-xl border border-purple-500/15 bg-purple-500/5">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-semibold text-purple-400 uppercase tracking-wider">IPv6</span>
              <span className="text-[9px] text-foreground/40">Nur bei statischer IPv6-Konfiguration nötig</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-medium text-foreground/50 mb-1 block">IPv6-Adresse</label>
                <input value={ipv6} onChange={e => setIpv6(e.target.value)}
                  placeholder="z.B. 2001:db8::1/64"
                  className={`w-full px-3 py-2.5 rounded-xl text-xs font-mono transition-colors ${
                    ipv6 && !isValidIpv6(ipv6) ? 'bg-red-500/10 border border-red-500/30 text-red-300' :
                    'bg-foreground/[0.04] border border-foreground/10 text-foreground hover:border-foreground/20'
                  } focus:border-accent/50 focus:outline-none focus:bg-accent/5 placeholder:text-foreground/20`} />
                {ipv6 && !isValidIpv6(ipv6) && <p className="text-[9px] text-red-400 mt-1">Ungültiges Format (z.B. 2001:db8::1/64)</p>}
              </div>
              <div>
                <label className="text-[10px] font-medium text-foreground/50 mb-1 block">Gateway IPv6</label>
                <input value={gateway6} onChange={e => setGateway6(e.target.value)}
                  placeholder="z.B. 2001:db8::1"
                  className="w-full px-3 py-2.5 rounded-xl text-xs font-mono bg-foreground/[0.04] border border-foreground/10 text-foreground hover:border-foreground/20 focus:border-accent/50 focus:outline-none focus:bg-accent/5 placeholder:text-foreground/20 transition-colors" />
              </div>
            </div>
          </div>
        )}

        {/* ── DNS ── */}
        <div className="mb-5 p-4 rounded-xl border border-amber-500/15 bg-amber-500/5">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider">DNS-Server</span>
            <span className="text-[9px] text-foreground/40">IPv4 und IPv6 werden getrennt abgelegt</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-xl border border-foreground/10 bg-foreground/[0.03] p-3">
              <div className="flex items-center gap-2 mb-3 text-xs font-semibold text-foreground/70"><Globe size={14} /> IPv4 DNS</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-medium text-foreground/50 mb-1 block">Bevorzugt</label>
                  <input value={dns4Primary} onChange={e => setDns4Primary(e.target.value)}
                    placeholder="z.B. 1.1.1.1"
                    className={`w-full px-3 py-2.5 rounded-xl text-xs font-mono transition-colors ${dns4Primary && !isValidDns(dns4Primary) ? 'bg-red-500/10 border border-red-500/30 text-red-300' : 'bg-foreground/[0.04] border border-foreground/10 text-foreground hover:border-foreground/20'} focus:border-accent/50 focus:outline-none focus:bg-accent/5 placeholder:text-foreground/20`} />
                </div>
                <div>
                  <label className="text-[10px] font-medium text-foreground/50 mb-1 block">Alternativ</label>
                  <input value={dns4Secondary} onChange={e => setDns4Secondary(e.target.value)}
                    placeholder="z.B. 8.8.8.8"
                    className={`w-full px-3 py-2.5 rounded-xl text-xs font-mono transition-colors ${dns4Secondary && !isValidDns(dns4Secondary) ? 'bg-red-500/10 border border-red-500/30 text-red-300' : 'bg-foreground/[0.04] border border-foreground/10 text-foreground hover:border-foreground/20'} focus:border-accent/50 focus:outline-none focus:bg-accent/5 placeholder:text-foreground/20`} />
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-foreground/10 bg-foreground/[0.03] p-3">
              <div className="flex items-center gap-2 mb-3 text-xs font-semibold text-foreground/70"><ShareNetwork size={14} /> IPv6 DNS</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-medium text-foreground/50 mb-1 block">Bevorzugt</label>
                  <input value={dns6Primary} onChange={e => setDns6Primary(e.target.value)}
                    placeholder="z.B. 2606:4700:4700::1111"
                    className={`w-full px-3 py-2.5 rounded-xl text-xs font-mono transition-colors ${dns6Primary && !isValidDns(dns6Primary) ? 'bg-red-500/10 border border-red-500/30 text-red-300' : 'bg-foreground/[0.04] border border-foreground/10 text-foreground hover:border-foreground/20'} focus:border-accent/50 focus:outline-none focus:bg-accent/5 placeholder:text-foreground/20`} />
                </div>
                <div>
                  <label className="text-[10px] font-medium text-foreground/50 mb-1 block">Alternativ</label>
                  <input value={dns6Secondary} onChange={e => setDns6Secondary(e.target.value)}
                    placeholder="z.B. 2001:4860:4860::8888"
                    className={`w-full px-3 py-2.5 rounded-xl text-xs font-mono transition-colors ${dns6Secondary && !isValidDns(dns6Secondary) ? 'bg-red-500/10 border border-red-500/30 text-red-300' : 'bg-foreground/[0.04] border border-foreground/10 text-foreground hover:border-foreground/20'} focus:border-accent/50 focus:outline-none focus:bg-accent/5 placeholder:text-foreground/20`} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Buttons ── */}
        <div className="flex items-center gap-3">
          {showConfirm ? (
            <>
              <div className="flex-1 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-foreground/70">
                <span className="inline-flex items-center gap-1.5"><Warning size={14} className="text-amber-400" /> Die Konfiguration wird sofort übernommen. Bei Fehlern setzt iora-netctl automatisch zurück.</span>
              </div>
              <button onClick={() => setShowConfirm(false)} className="px-4 py-2.5 rounded-xl border border-foreground/10 text-xs text-foreground/50 hover:bg-foreground/5 transition-colors shrink-0">
                Abbrechen
              </button>
              <button onClick={doApply} disabled={!isFormValid()}
                className="px-5 py-2.5 rounded-xl text-xs font-semibold bg-accent text-white hover:bg-accent/90 disabled:opacity-40 transition-all shrink-0">
                Bestätigen
              </button>
            </>
          ) : saved ? (
            <div className="flex-1 flex items-center gap-2 p-3 rounded-xl bg-success/10 border border-success/20">
              <CheckCircle size={16} className="text-success shrink-0" />
              <span className="text-xs text-success">Konfiguration wurde erfolgreich übernommen</span>
            </div>
          ) : (
            <button onClick={() => setShowConfirm(true)} disabled={!isFormValid() || saving}
              className="w-full py-3 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 bg-accent text-white hover:bg-accent/90 disabled:opacity-40 shadow-sm shadow-accent/20">
              {saving ? <><div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" /> Wird angewendet…</> : 'Konfiguration übernehmen'}
            </button>
          )}
        </div>
      </AdminCard>
    </div>
  )
}

interface OsDisk { name: string; mount_point: string; file_system: string; total_bytes: number; available_bytes: number; used_bytes: number; usage_percent: number; is_removable: boolean }
function OsDisksTab({ token }: { token: string }) {
  const [data, setData] = useState<{ disks?: OsDisk[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const r = await adminFetch(OS_BASE + '/os/disks', token)
      setData(r as { disks?: OsDisk[] })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setLoading(false) }
  }, [token])

  useEffect(() => { load() }, [load])

  const fmt = (n: number) => {
    if (n < 1024) return n + ' B'
    const u = ['KB', 'MB', 'GB', 'TB']
    let v = n / 1024, i = 0
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
    return v.toFixed(1) + ' ' + u[i]
  }

  return (
    <div className="space-y-3">
      <AdminCard title="Festplatten & Dateisysteme" icon={HardDrive}>
        {loading && <p className="text-xs text-foreground/50">Lade...</p>}
        {error && <p className="text-xs text-red-300">{error}</p>}
        {data?.disks && (
          <div className="space-y-2">
            {data.disks.map((d, i) => (
              <div key={i} className="rounded-lg border border-foreground/10 p-3 bg-foreground/5">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="text-xs font-semibold text-foreground">{d.mount_point}</div>
                    <div className="text-[10px] text-foreground/50">{d.name} - {d.file_system}{d.is_removable ? ' - removable' : ''}</div>
                  </div>
                  <div className="text-xs text-foreground/70">{fmt(d.used_bytes)} / {fmt(d.total_bytes)}</div>
                </div>
                <div className="h-1.5 rounded-full bg-foreground/10 overflow-hidden">
                  <div className={'h-full ' + (d.usage_percent > 90 ? 'bg-red-500' : d.usage_percent > 75 ? 'bg-amber-500' : 'bg-emerald-500')} style={{ width: Math.min(100, d.usage_percent) + '%' }} />
                </div>
                <div className="text-[10px] text-foreground/50 mt-1">{d.usage_percent.toFixed(1)} % belegt - {fmt(d.available_bytes)} frei</div>
              </div>
            ))}
          </div>
        )}
        <button onClick={load} className="mt-2 px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent/20 text-accent hover:bg-accent/30">Aktualisieren</button>
      </AdminCard>
    </div>
  )
}

interface OsProc { pid: number; name: string; cpu_percent: number; memory_bytes: number }
function OsProcessesTab({ token }: { token: string }) {
  const [data, setData] = useState<{ processes?: OsProc[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [auto, setAuto] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const r = await adminFetch(OS_BASE + '/os/processes', token)
      setData(r as { processes?: OsProc[] })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setLoading(false) }
  }, [token])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!auto) return
    const id = setInterval(load, 3000)
    return () => clearInterval(id)
  }, [auto, load])

  const fmtMem = (n: number) => {
    const u = ['B','KB','MB','GB']; let v = n, i = 0
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
    return v.toFixed(1) + ' ' + u[i]
  }

  return (
    <div className="space-y-3">
      <AdminCard title="Top-Prozesse (CPU)" icon={Pulse}>
        <div className="flex items-center gap-3 mb-3">
          <button onClick={load} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent/20 text-accent hover:bg-accent/30">Aktualisieren</button>
          <label className="text-xs text-foreground/70 flex items-center gap-1.5">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            Auto-Refresh (3s)
          </label>
        </div>
        {loading && <p className="text-xs text-foreground/50">Lade...</p>}
        {error && <p className="text-xs text-red-300">{error}</p>}
        {data?.processes && (
          <div className="overflow-auto max-h-[32rem]">
            <table className="w-full text-xs">
              <thead className="text-foreground/60 text-[10px] uppercase tracking-wider">
                <tr><th className="text-left py-1">PID</th><th className="text-left">Name</th><th className="text-right">CPU %</th><th className="text-right">RAM</th></tr>
              </thead>
              <tbody className="font-mono">
                {data.processes.map((p) => (
                  <tr key={p.pid} className="border-t border-foreground/5">
                    <td className="py-1 pr-2">{p.pid}</td>
                    <td className="pr-2 truncate max-w-[260px]">{p.name}</td>
                    <td className="text-right pr-2">{p.cpu_percent.toFixed(1)}</td>
                    <td className="text-right">{fmtMem(p.memory_bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminCard>
    </div>
  )
}

function OsPowerTab({ token }: { token: string }) {
  const [hostname, setHostname] = useState('')
  const [current, setCurrent] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [delay, setDelay] = useState(5)

  const load = useCallback(async () => {
    try {
      const r = await adminFetch(OS_BASE + '/os/hostname', token) as { hostname?: string }
      setCurrent(r.hostname || '')
      if (!hostname) setHostname(r.hostname || '')
    } catch (e) {
      console.error(e)
    }
  }, [token, hostname])
  useEffect(() => { load() }, [load])

  const saveHostname = async () => {
    if (!hostname.trim()) return
    setBusy(true)
    try {
      await adminFetch(OS_BASE + '/os/hostname', token, {
        method: 'PUT',
        body: JSON.stringify({ hostname: hostname.trim() }),
      })
      toast.success('Hostname gesetzt')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  const power = async (action: 'reboot' | 'shutdown') => {
    const label = action === 'reboot' ? 'IORA OS jetzt neu starten' : 'IORA OS jetzt herunterfahren'
    if (!confirm(label + '? (Verzoegerung: ' + delay + 's)')) return
    setBusy(true)
    try {
      await adminFetch(OS_BASE + '/os/' + action, token, {
        method: 'POST',
        body: JSON.stringify({ delay_seconds: delay, reason: 'admin-panel' }),
      })
      toast.success(action === 'reboot' ? 'Neustart geplant' : 'Shutdown geplant')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-3">
      <AdminCard title="Hostname" icon={Gear}>
        <p className="text-xs text-foreground/60 mb-2">Aktueller Hostname: <code className="text-accent">{current || '-'}</code></p>
        <div className="flex gap-2">
          <input value={hostname} onChange={(e) => setHostname(e.target.value)} placeholder="iora-os"
            className="flex-1 text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground font-mono" />
          <button onClick={saveHostname} disabled={busy || !hostname.trim() || hostname === current}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-40">Speichern</button>
        </div>
        <p className="text-[10px] text-foreground/50 mt-2">Erfordert Root-Rechte auf dem Host (hostnamectl/hostname). Persistiert in <code>/etc/hostname</code>.</p>
      </AdminCard>

      <AdminCard title="System neu starten / herunterfahren" icon={Power}>
        <p className="text-xs text-amber-300 mb-3 flex items-center gap-1.5">
          <Warning size={14} /> Diese Aktionen beenden alle laufenden Container und Dienste auf dem IORA-OS-Host.
        </p>
        <label className="text-xs text-foreground/70 flex items-center gap-2 mb-3">
          Verzoegerung:
          <input type="number" min={0} max={3600} value={delay} onChange={(e) => setDelay(Math.max(0, parseInt(e.target.value || '0', 10)))}
            className="w-20 text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-2 py-1 text-foreground" />
          Sekunden
        </label>
        <div className="flex gap-2">
          <button onClick={() => power('reboot')} disabled={busy}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 disabled:opacity-40 flex items-center gap-1.5">
            <ArrowClockwise size={14} /> Neustart
          </button>
          <button onClick={() => power('shutdown')} disabled={busy}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-500/20 text-red-300 hover:bg-red-500/30 disabled:opacity-40 flex items-center gap-1.5">
            <Power size={14} /> Herunterfahren
          </button>
        </div>
      </AdminCard>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Health Intelligence Tab — AI-powered system analysis & self-repair insights
// ═══════════════════════════════════════════════════════════════════════════

interface IntelligenceData {
  overall_score: number
  overall_status: string
  services: HealthScoreEntry[]
  anomalies: AnomalyEntry[]
  suggestions: SuggestionEntry[]
  maintenance_tasks: MaintenanceTaskEntry[]
  metrics: SystemMetricsData
  timestamp: string
}

interface HealthScoreEntry {
  service_name: string
  score: number
  trend: 'improving' | 'stable' | 'degrading' | 'critical'
  status: string
  uptime_percent: number
  response_time_ms: number | null
  consecutive_failures: number
  predicted_failure_in: string | null
  suggestions: string[]
}

interface AnomalyEntry {
  anomaly_type: string
  service_name: string
  severity: string
  description: string
  current_value: string
  baseline_value: string
  detected_at: string
}

interface SuggestionEntry {
  priority: number
  category: string
  title: string
  description: string
  action: string
  auto_fixable: boolean
  auto_fix_command: string | null
}

interface MaintenanceTaskEntry {
  task_type: string
  last_run: string | null
  next_run: string
  status: string
  auto_enabled: boolean
}

interface SystemMetricsData {
  cpu_percent: number
  memory_used_mb: number
  memory_total_mb: number
  memory_percent: number
  disk_used_gb: number
  disk_total_gb: number
  disk_percent: number
  uptime_hours: number
  service_count: number
  healthy_count: number
}

function HealthIntelligenceTab({ token }: { token: string }) {
  const [data, setData] = useState<IntelligenceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [runningTask, setRunningTask] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await adminFetch('/api/intelligence/overview', token) as IntelligenceData
      setData(d)
    } catch { setData(null) }
    setLoading(false)
  }, [token])

  useEffect(() => { load() }, [load])

  const runTask = async (taskType: string) => {
    setRunningTask(taskType)
    try {
      await adminFetch(`/api/intelligence/maintenance/run/${taskType}`, token)
      toast.success(`${taskType} ausgeführt`)
      setTimeout(load, 1000)
    } catch { toast.error(`${taskType} fehlgeschlagen`) }
    setRunningTask(null)
  }

  const scoreColor = (s: number) => s >= 90 ? 'text-emerald-400' : s >= 75 ? 'text-green-400' : s >= 50 ? 'text-amber-400' : s >= 25 ? 'text-orange-400' : 'text-red-400'
  const scoreBg = (s: number) => s >= 90 ? 'bg-emerald-500/15' : s >= 75 ? 'bg-green-500/15' : s >= 50 ? 'bg-amber-500/15' : s >= 25 ? 'bg-orange-500/15' : 'bg-red-500/15'
  const trendIcon = (t: string) => t === 'improving' ? <TrendUp size={14} weight="fill" className="text-emerald-400" /> : t === 'degrading' ? <TrendUp size={14} weight="fill" className="text-amber-400 rotate-180" /> : t === 'critical' ? <TrendUp size={14} weight="fill" className="text-red-400 rotate-180" /> : <span className="text-foreground/30">—</span>
  const prioBorder = (p: number) => p <= 2 ? 'border-red-500/20 bg-red-500/[0.04]' : p <= 3 ? 'border-amber-500/20 bg-amber-500/[0.04]' : 'border-foreground/[0.06] bg-foreground/[0.02]'

  if (loading) return <LoadingSpinner />
  if (!data) return (
    <AdminCard title="Health Intelligence" icon={Heartbeat}>
      <div className="text-center py-8 space-y-3">
        <Heartbeat size={40} weight="duotone" className="mx-auto text-foreground/20" />
        <p className="text-sm text-foreground/50">Intelligence Engine nicht verfügbar</p>
        <p className="text-xs text-foreground/30">Starte <code className="px-1.5 py-0.5 rounded bg-foreground/[0.04] text-[11px]">iora-intelligence</code> für KI-gestützte Systemanalyse</p>
      </div>
    </AdminCard>
  )

  return (
    <div className="space-y-3">
      {/* Overall Score */}
      <AdminCard>
        <div className="flex items-center gap-4">
          <div className={`w-16 h-16 rounded-2xl ${scoreBg(data.overall_score)} flex items-center justify-center`}>
            <span className={`text-2xl font-bold ${scoreColor(data.overall_score)}`}>{data.overall_score}</span>
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">System Health Score</p>
            <p className={`text-xs font-medium ${scoreColor(data.overall_score)}`}>{data.overall_status}</p>
            <p className="text-[10px] text-foreground/30 mt-0.5">{data.metrics.healthy_count}/{data.metrics.service_count} Dienste gesund</p>
          </div>
        </div>
      </AdminCard>

      {/* Metrics Bar */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'CPU', value: `${data.metrics.cpu_percent.toFixed(0)}%`, warn: data.metrics.cpu_percent > 80 },
          { label: 'RAM', value: `${data.metrics.memory_percent.toFixed(0)}%`, warn: data.metrics.memory_percent > 85 },
          { label: 'Disk', value: `${data.metrics.disk_percent.toFixed(0)}%`, warn: data.metrics.disk_percent > 85 },
          { label: 'Uptime', value: `${data.metrics.uptime_hours.toFixed(0)}h`, warn: false },
        ].map(m => (
          <div key={m.label} className="text-center p-2 rounded-xl bg-foreground/[0.03]">
            <p className="text-[10px] text-foreground/40">{m.label}</p>
            <p className={`text-sm font-bold ${m.warn ? 'text-red-400' : 'text-foreground'}`}>{m.value}</p>
          </div>
        ))}
      </div>

      {/* Service Scores */}
      <AdminCard title={`Service Scores (${data.services.length})`} icon={Heartbeat}>
        <div className="space-y-1.5 max-h-80 overflow-y-auto">
          {data.services.map(svc => (
            <div key={svc.service_name} className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-foreground/[0.02] transition-colors">
              <div className={`w-10 h-10 rounded-xl ${scoreBg(svc.score)} flex items-center justify-center flex-shrink-0`}>
                <span className={`text-sm font-bold ${scoreColor(svc.score)}`}>{svc.score}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-medium text-foreground truncate">{svc.service_name}</p>
                  {trendIcon(svc.trend)}
                </div>
                <p className="text-[10px] text-foreground/40">
                  {svc.status} · {svc.uptime_percent.toFixed(1)}% uptime{svc.response_time_ms ? ` · ${svc.response_time_ms}ms` : ''}
                </p>
              </div>
              {svc.consecutive_failures > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-red-500/10 text-red-400 font-medium">{svc.consecutive_failures}× fail</span>
              )}
              {svc.predicted_failure_in && (
                <Tip content={`Voraussichtlicher Ausfall in ${svc.predicted_failure_in}`}>
                  <Warning size={14} className="text-amber-400 flex-shrink-0" />
                </Tip>
              )}
            </div>
          ))}
        </div>
      </AdminCard>

      {/* Anomalies */}
      {data.anomalies.length > 0 && (
        <AdminCard title={`Anomalien (${data.anomalies.length})`} icon={ShieldWarning}>
          <div className="space-y-2">
            {data.anomalies.map((a, i) => (
              <div key={i} className={`p-3 rounded-xl border ${a.severity === 'critical' ? 'border-red-500/20 bg-red-500/[0.04]' : 'border-amber-500/15 bg-amber-500/[0.03]'}`}>
                <div className="flex items-start gap-2">
                  <Warning size={14} weight="fill" className={`mt-0.5 flex-shrink-0 ${a.severity === 'critical' ? 'text-red-400' : 'text-amber-400'}`} />
                  <div>
                    <p className="text-xs font-medium text-foreground/80">{a.description}</p>
                    <p className="text-[10px] text-foreground/30 mt-0.5">{a.service_name} · {a.current_value} (normal: {a.baseline_value})</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </AdminCard>
      )}

      {/* Smart Suggestions */}
      {data.suggestions.length > 0 && (
        <AdminCard title={`Smart Suggestions (${data.suggestions.length})`} icon={Sparkle}>
          <div className="space-y-2">
            {data.suggestions.map((s, i) => (
              <div key={i} className={`p-3 rounded-xl border ${prioBorder(s.priority)}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-foreground/80">{s.title}</p>
                    <p className="text-[10px] text-foreground/50 mt-0.5">{s.description}</p>
                    <p className="text-[10px] text-foreground/30 mt-1 font-mono">{s.action}</p>
                  </div>
                  {s.auto_fixable && (
                    <button onClick={() => runTask(s.category)} className="px-3 py-1.5 rounded-lg bg-accent/10 text-accent text-[10px] font-semibold hover:bg-accent/20 transition-colors flex-shrink-0">
                      Auto-Fix
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </AdminCard>
      )}

      {/* Maintenance Tasks */}
      <AdminCard title="Wartung" icon={Wrench}>
        <div className="space-y-1.5">
          {data.maintenance_tasks.map(task => (
            <div key={task.task_type} className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-foreground/[0.02]">
              <div className={`w-2 h-2 rounded-full ${task.status === 'completed' ? 'bg-emerald-400' : task.status === 'running' ? 'bg-accent animate-pulse' : 'bg-foreground/20'}`} />
              <div className="flex-1">
                <p className="text-xs text-foreground/70 capitalize">{task.task_type.replace(/_/g, ' ')}</p>
                <p className="text-[10px] text-foreground/30">
                  {task.last_run ? `Letzte: ${new Date(task.last_run).toLocaleTimeString()}` : 'Nie'} · Nächste: {new Date(task.next_run).toLocaleTimeString()}
                </p>
              </div>
              {task.auto_enabled && <span className="text-[9px] px-1.5 py-0.5 rounded bg-foreground/[0.04] text-foreground/30">AUTO</span>}
              <button onClick={() => runTask(task.task_type)} disabled={runningTask === task.task_type}
                className="px-2 py-1 rounded text-[10px] text-foreground/30 hover:text-foreground/60 transition-colors disabled:opacity-30">
                {runningTask === task.task_type ? '…' : 'Jetzt'}
              </button>
            </div>
          ))}
        </div>
      </AdminCard>

      <div className="flex justify-end">
        <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-foreground/80 hover:text-accent hover:bg-accent/10 transition-all">
          <ArrowClockwise size={14} /> Aktualisieren
        </button>
      </div>
    </div>
  )
}

// ── Theme Marketplace (iframe embed) ──────────────────────────────────

const DEFAULT_STORE_URL = 'http://localhost:3100'

function ThemeMarketplace({ token, onInstall }: { token: string; onInstall: () => void }) {
  const [storeUrl, setStoreUrl] = useState(() => localStorage.getItem('iora-store-url') || DEFAULT_STORE_URL)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  // Listen for install messages from the store iframe
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.source !== 'iora-store') return

      if (event.data.action === 'install') {
        const { type, id, name } = event.data.payload
        if (type === 'theme') {
          installThemeFromStore(storeUrl, id, name, onInstall)
        }
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [storeUrl, onInstall])

  const installThemeFromStore = async (baseUrl: string, themeId: string, name: string, callback: () => void) => {
    try {
      toast.info(`Installiere "${name}" vom Store...`)
      const res = await fetch(`${baseUrl}/api/proxy/themes/${themeId}/download`)
      if (!res.ok) {
        // Try direct store API
        const storeApi = storeUrl.replace(/\/$/, '')
        const directRes = await fetch(`${storeApi}/api/themes/${themeId}/download`)
        if (!directRes.ok) throw new Error(`Download fehlgeschlagen`)
        const blob = await directRes.blob()
        await installFromBlob(blob, name, callback)
        return
      }
      const blob = await res.blob()
      await installFromBlob(blob, name, callback)
    } catch (e) {
      toast.error('Fehler: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  const installFromBlob = async (blob: Blob, name: string, callback: () => void) => {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binary = ''
    const chunkSize = 0x8000
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
    }
    const base64 = btoa(binary)

    const installRes = await authFetch('/api/themes/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zip_data: base64, file_name: `${name}.zip` }),
    })

    if (!installRes.ok) {
      const err = await installRes.json().catch(() => ({ message: 'Installation fehlgeschlagen' }))
      throw new Error(err.message || `HTTP ${installRes.status}`)
    }

    toast.success(`Theme "${name}" installiert!`)
    callback()
  }

  return (
    <AdminCard icon={Storefront} title="Theme-Marktplatz">
      <p className="text-xs text-foreground/50 mb-4">
        Entdecke und installiere Themes direkt aus dem IORA Store.
      </p>

      {/* Store URL config */}
      <div className="flex items-center gap-2 mb-4">
        <input
          type="text"
          value={storeUrl}
          onChange={(e) => {
            setStoreUrl(e.target.value)
            localStorage.setItem('iora-store-url', e.target.value)
          }}
          placeholder="Store URL (z.B. http://localhost:3100)"
          className="flex-1 px-3 py-1.5 rounded-lg text-xs bg-foreground/[0.04] border border-foreground/10 text-foreground focus:outline-none focus:border-accent"
        />
        <button
          onClick={() => iframeRef.current?.contentWindow?.location.reload()}
          className="px-3 py-1.5 rounded-lg text-xs bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-all"
        >
          Neu laden
        </button>
      </div>

      {/* Iframe */}
      <div className="relative rounded-xl overflow-hidden border border-foreground/10 bg-background" style={{ height: '600px' }}>
        <iframe
          ref={iframeRef}
          src={storeUrl}
          className="w-full h-full"
          style={{ border: 'none' }}
          title="IORA Store"
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        />
        {/* Fallback if iframe fails */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center bg-background/80" style={{ zIndex: -1 }}>
          <div className="text-center">
            <Storefront size={32} className="mx-auto text-foreground/20 mb-2" />
            <p className="text-xs text-foreground/40">Store wird geladen...</p>
            <p className="text-[10px] text-foreground/30 mt-1">
              Stelle sicher, dass der Store unter {storeUrl} erreichbar ist
            </p>
          </div>
        </div>
      </div>

      <p className="text-[10px] text-foreground/30 mt-3 flex items-center gap-1.5">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400" />
        Store URL: <code className="text-foreground/40">{storeUrl}</code>
      </p>
    </AdminCard>
  )
}

// ── Themes Tab ────────────────────────────────────────────────────────
function ThemesTab({ token }: { token: string }) {
  const [themes, setThemes] = useState<{ builtin: ThemeDef[]; installed: InstalledThemeDef[] } | null>(null)
  const [defaultTheme, setDefaultTheme] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const { refreshThemes } = useTheme()

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [themesRes, defaultRes] = await Promise.all([
        authFetch('/api/themes'),
        authFetch('/api/themes/default'),
      ])
      if (!themesRes.ok) throw new Error(`HTTP ${themesRes.status}`)
      setThemes(await themesRes.json())
      if (defaultRes.ok) setDefaultTheme(await defaultRes.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const uninstallTheme = async (themeId: string) => {
    try {
      const r = await authFetch(`/api/themes/${themeId}`, { method: 'DELETE' })
      if (!r.ok) {
        const err = await r.json().catch(() => ({ message: 'Fehler beim Deinstallieren' }))
        toast.error(err.message || 'Fehler beim Deinstallieren')
        return
      }
      toast.success('Theme deinstalliert')
      load()
      refreshThemes()
    } catch (e) {
      toast.error('Fehler beim Deinstallieren: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  // Export theme as ZIP
  const exportTheme = async (themeId: string) => {
    try {
      // For file-based themes: download all assets as ZIP
      const res = await authFetch(`/api/themes/assets/${themeId}`)
      if (res.ok) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${themeId}.zip`
        a.click()
        URL.revokeObjectURL(url)
        toast.success(`Theme "${themeId}" exportiert`)
        return
      }
      // Fallback: download from assets
      toast.info('Theme wird als manifest.json exportiert')
    } catch (e) {
      toast.error('Export fehlgeschlagen: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  // Clone/duplicate a theme
  const cloneTheme = async (themeId: string, themeName: string) => {
    const newName = prompt('Name für das geklonte Theme:', `${themeName} (Kopie)`)
    if (!newName) return
    const newId = prompt('ID für das geklonte Theme:', `${themeId}-clone`)
    if (!newId) return

    try {
      // Fetch current theme data and re-install with new ID
      const themesRes = await authFetch('/api/themes')
      const data = await themesRes.json()
      const installed: any[] = data.installed || []
      const theme = installed.find((t: any) => t.id === themeId)
      if (!theme) { toast.error('Theme nicht gefunden'); return }

      // Build new inline theme manifest
      let cssVars: Record<string, string> = {}
      try { cssVars = JSON.parse(theme.css_variables || '{}') } catch {}

      const manifest = {
        id: newId,
        name: newName,
        version: '1.0.0',
        developer: theme.developer || 'IORA',
        description: `Klon von ${themeName}`,
        parent_theme: themeId,
        css_variables: cssVars,
      }

      const r = await authFetch('/api/themes/install-from-manifest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(manifest),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({ message: 'Klonen fehlgeschlagen' }))
        throw new Error(err.message)
      }
      toast.success(`Theme "${newName}" erstellt`)
      load()
      refreshThemes()
    } catch (e) {
      toast.error('Klonen fehlgeschlagen: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      // Quick client-side validation by reading the ZIP's manifest.json
      if (file.name.endsWith('.zip')) {
        try {
          const { extractManifestFromZip } = await import('../lib/zip')
          const manifest = await extractManifestFromZip(file)
          const { quickValidateManifest, formatValidationIssues } = await import('@/lib/manifestValidation')
          const issues = quickValidateManifest(manifest as Record<string, unknown>)
          const errors = issues.filter(i => i.severity === 'error')
          if (errors.length > 0) {
            toast.error(formatValidationIssues(errors), { duration: 8000 })
            setUploading(false)
            e.target.value = ''
            return
          }
          const warnings = issues.filter(i => i.severity === 'warning')
          if (warnings.length > 0) {
            toast.warning(formatValidationIssues(warnings), { duration: 5000 })
          }
        } catch {
          // No manifest found or parse error – let the backend handle it
        }
      }

      const buf = await file.arrayBuffer()
      const bytes = new Uint8Array(buf)
      let binary = ''
      const chunkSize = 0x8000
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
      }
      const base64 = btoa(binary)
      const r = await authFetch('/api/themes/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zip_data: base64, file_name: file.name }),
      })
      if (!r.ok) {
        const text = await r.text().catch(() => '')
        let err: any = null
        try { err = text ? JSON.parse(text) : null } catch { err = null }
        const stage = err?.stage ? `[${err.stage}] ` : ''
        const msg = `${stage}${err?.message || err?.error || text || 'Installation fehlgeschlagen'}`
        toast.error(msg, { duration: 8000 })
        throw new Error(msg)
      }
      toast.success(`Theme „${file.name.replace(/\.zip$/i, '')}“ installiert`)
      load()
      refreshThemes()
    } catch (e) {
      if (!(e instanceof Error && e.message.includes('Manifest enthält Fehler'))) {
        toast.error('Fehler: ' + (e instanceof Error ? e.message : String(e)), { duration: 6000 })
      }
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const saveDefaultTheme = async (themeId: string) => {
    try {
      const config = { ...(defaultTheme || {}), theme_id: themeId }
      const r = await authFetch('/api/themes/default', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      if (!r.ok) throw new Error('Fehler beim Speichern')
      const data = await r.json()
      setDefaultTheme(data.config)
      toast.success('Standard-Theme aktualisiert')
    } catch (e) {
      toast.error('Fehler: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>Fehler: {error}</ErrorMessage>

  const installed = themes?.installed || []
  const builtin = themes?.builtin || []

  const allThemeOptions = [
    { id: 'auto', name: 'Automatisch (Tageszeit)', preview: 'linear-gradient(135deg, #e8eaf0 0%, #1a1d2e 100%)' },
    ...builtin.filter(t => t.id !== 'auto').map(t => ({ id: t.id, name: t.name, preview: getThemePreview(t.id) })),
    ...installed.filter(t => t.enabled).map(t => {
      let cssVars: Record<string, string> = {}
      try { cssVars = JSON.parse((t as any).css_variables || '{}') } catch {}
      const bg = cssVars['background'] || cssVars['bg'] || '#1a1d2e'
      const ac = cssVars['accent'] || cssVars['primary'] || '#6366f1'
      return { id: t.id, name: t.name, preview: `linear-gradient(135deg, ${bg} 0%, ${ac} 100%)` }
    }),
  ]

  return (
    <div className="space-y-6">

      {/* Default Theme Section */}
      <AdminCard icon={Palette} title="Standard-Theme">
        <p className="text-xs text-foreground/50 mb-4">
          Lege das Standard-Theme für alle Benutzer ohne eigene Auswahl fest.
          Benutzer können ihr Theme in den Einstellungen überschreiben.
        </p>
        <div className="flex flex-wrap gap-2">
          {allThemeOptions.map(opt => {
            const isSelected = defaultTheme?.theme_id === opt.id || (!defaultTheme && opt.id === 'auto')
            return (
              <button
                key={opt.id}
                onClick={() => saveDefaultTheme(opt.id)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border-2 transition-all text-left ${
                  isSelected
                    ? 'border-accent bg-accent/10 shadow-sm'
                    : 'border-foreground/8 bg-foreground/[0.03] hover:border-foreground/18'
                }`}
              >
                <div className="w-8 h-8 rounded-lg shrink-0 border border-foreground/10" style={{ background: opt.preview }} />
                <div>
                  <p className={`text-xs font-medium ${isSelected ? 'text-accent' : 'text-foreground'}`}>{opt.name}</p>
                  <p className="text-[9px] text-foreground/40">{isSelected ? 'Aktiv' : 'Klicken zum Setzen'}</p>
                </div>
                {isSelected && <Check size={14} className="text-accent shrink-0" weight="bold" />}
              </button>
            )
          })}
        </div>
      </AdminCard>

      {/* Theme Upload Section */}
      <AdminCard icon={UploadSimple} title="Theme hochladen">
        <p className="text-xs text-foreground/50 mb-4">
          Lade ein Theme als ZIP-Datei hoch (manifest.json + CSS/JS/Fonts/Assets).
        </p>
        <label className={`relative flex flex-col items-center justify-center gap-2 p-8 rounded-xl border-2 border-dashed transition-all cursor-pointer ${
          uploading ? 'border-accent/50 bg-accent/5' : 'border-foreground/15 hover:border-foreground/30 bg-foreground/[0.02] hover:bg-foreground/[0.04]'
        }`}>
          <input type="file" accept=".zip" className="sr-only" onChange={handleFileUpload} disabled={uploading} />
          {uploading ? (
            <>
              <div className="animate-spin w-8 h-8 border-2 border-accent border-t-transparent rounded-full" />
              <p className="text-sm text-foreground/50">Installiere Theme…</p>
            </>
          ) : (
            <>
              <UploadSimple size={32} className="text-foreground/30" weight="thin" />
              <p className="text-sm font-medium text-foreground/60">Theme-ZIP auswählen</p>
              <p className="text-[10px] text-foreground/30">manifest.json + CSS-Dateien + Assets</p>
            </>
          )}
        </label>
      </AdminCard>

      {/* Installed themes */}
      <AdminCard icon={Palette} title="Installierte Themes">
        <p className="text-xs text-foreground/50 mb-4">Verwalte installierte Themes</p>
        {installed.length === 0 ? (
          <div className="text-center py-12">
            <Palette size={48} weight="thin" className="mx-auto text-foreground/20 mb-4" />
            <p className="text-sm text-foreground/50">Keine benutzerdefinierten Themes installiert</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {installed.map((t) => {
              let cssVars: Record<string, string> = {}
              try { cssVars = JSON.parse((t as any).css_variables || '{}') } catch {}
              const bgColor = cssVars['background'] || cssVars['bg'] || '#1a1d2e'
              const accentColor = cssVars['accent'] || cssVars['primary'] || '#6366f1'
              return (
                <div key={t.id} className="flex items-center gap-4 p-4 rounded-xl border border-foreground/[0.06] bg-foreground/[0.02]">
                  <div className="w-12 h-12 rounded-xl shrink-0 border border-foreground/10" style={{ background: `linear-gradient(135deg, ${bgColor} 0%, ${accentColor} 100%)` }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-foreground">{t.name}</p>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-foreground/5 text-foreground/40">v{t.version}</span>
                      {t.system && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/10 text-accent">System</span>}
                      {defaultTheme?.theme_id === t.id && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-success/10 text-success">Standard</span>}
                    </div>
                    {t.description && <p className="text-xs text-foreground/50 mt-0.5 truncate">{t.description}</p>}
                    <p className="text-[10px] text-foreground/30 mt-0.5">Von {t.developer || 'Unbekannt'} · {t.source === 'file' ? 'Manuell' : 'App/Plugin'}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full ${t.enabled ? 'bg-success/10 text-success' : 'bg-foreground/5 text-foreground/40'}`}>
                      {t.enabled ? <Check size={10} /> : <EyeSlash size={10} />} {t.enabled ? 'Aktiv' : 'Inaktiv'}
                    </span>
                    {!t.system && (
                      <>
                        <button onClick={() => cloneTheme(t.id, t.name)} className="p-2 rounded-lg text-foreground/30 hover:text-accent hover:bg-accent/10 transition-all" title="Klonen"><Copy size={14} /></button>
                        <button onClick={() => exportTheme(t.id)} className="p-2 rounded-lg text-foreground/30 hover:text-accent hover:bg-accent/10 transition-all" title="Exportieren"><DownloadSimple size={14} /></button>
                        <button onClick={() => uninstallTheme(t.id)} className="p-2 rounded-lg text-foreground/30 hover:text-red-400 hover:bg-red-500/10 transition-all" title="Deinstallieren"><TrashSimple size={16} /></button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </AdminCard>

      {/* ─── Theme Marketplace (iframe) ─────────────────────── */}
      <AdminCard icon={Storefront} title="Theme-Marktplatz">
        <p className="text-xs text-foreground/50 mb-4">
          Durchstöbere und installiere Themes direkt aus dem IORA Store.
        </p>
        <ThemeMarketplace token={token} onInstall={() => { load(); refreshThemes() }} />
      </AdminCard>

      {/* Built-in themes */}
      <AdminCard icon={Swatches} title="Integrierte Farbschemas">
        <p className="text-xs text-foreground/50 mb-4">Die sechs Standard-Farbschemas von IORA</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {builtin.filter(t => t.id !== 'auto').sort((a: ThemeDef, b: ThemeDef) => (a.order || 50) - (b.order || 50)).map((t) => (
            <div key={t.id} className="flex flex-col items-center gap-1.5 p-3 rounded-xl border border-foreground/[0.04] bg-foreground/[0.02]">
              <div className="w-10 h-10 rounded-xl border border-foreground/10" style={{ background: getThemePreview(t.id) }} />
              <p className="text-[10px] font-medium text-foreground truncate w-full text-center">{t.name}</p>
              <p className="text-[8px] text-foreground/30">{t.id}</p>
            </div>
          ))}
        </div>
      </AdminCard>
    </div>
  )
}

// Helper for theme previews
function getThemePreview(themeId: string): string {
  const previews: Record<string, string> = {
    auto: 'linear-gradient(135deg, #e8eaf0 0%, #1a1d2e 100%)',
    light: 'linear-gradient(135deg, #f5f5f7 0%, #e8eaf0 50%, #dde0e8 100%)',
    day: 'linear-gradient(135deg, #e0e4ec 0%, #c8cdd8 50%, #b8bfcc 100%)',
    'day-classic': 'linear-gradient(135deg, #2a2d3e 0%, #1a1d2e 50%, #0f1118 100%)',
    evening: 'linear-gradient(135deg, #2d2f4a 0%, #1e2040 50%, #15172e 100%)',
    night: 'linear-gradient(135deg, #181c2e 0%, #0f1220 50%, #0a0d18 100%)',
    sleep: 'linear-gradient(135deg, #050508 0%, #000000 100%)',
  }
  return previews[themeId] || 'linear-gradient(135deg, #1a1d2e 0%, #2a2d4e 100%)'
}

interface ThemeDef {
  id: string; name: string; version: string; order?: number;
}
interface InstalledThemeDef {
  id: string; name: string; version: string; developer: string;
  description: string; system: boolean; enabled: boolean;
  source: string; icon?: string;
}
