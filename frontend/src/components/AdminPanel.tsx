import { useTranslation } from 'react-i18next'
import '@/i18n' // side-effect: initializes i18next
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { OsPermissionEditor } from '@/components/OsPermissionEditor'

// Admin tabs are lazy-loaded per module to keep the initial AdminPanel chunk small.
const AppearanceStandardsTab = lazy(() => import('./adminTabs/AppearanceStandards').then((m) => ({ default: m.AppearanceStandardsTab })))
const AiConversationsTab = lazy(() => import('./adminTabs/ai').then((m) => ({ default: m.AiConversationsTab })))
const AiOverviewTab = lazy(() => import('./adminTabs/ai').then((m) => ({ default: m.AiOverviewTab })))
const AiProvidersTab = lazy(() => import('./adminTabs/ai').then((m) => ({ default: m.AiProvidersTab })))
const AiTasksTab = lazy(() => import('./adminTabs/ai').then((m) => ({ default: m.AiTasksTab })))
const AiToolsTab = lazy(() => import('./adminTabs/ai').then((m) => ({ default: m.AiToolsTab })))
const AiVoiceTab = lazy(() => import('./adminTabs/ai').then((m) => ({ default: m.AiVoiceTab })))
const AnalyticsTab = lazy(() => import('./adminTabs/tools').then((m) => ({ default: m.AnalyticsTab })))
const ApiBridgeTab = lazy(() => import('./adminTabs/services').then((m) => ({ default: m.ApiBridgeTab })))
const ApiKeysTab = lazy(() => import('./adminTabs/tools').then((m) => ({ default: m.ApiKeysTab })))
const AutomationsTab = lazy(() => import('./adminTabs/homeAssistant').then((m) => ({ default: m.AutomationsTab })))
const BackupsTab = lazy(() => import('./adminTabs/tools').then((m) => ({ default: m.BackupsTab })))
const BleTab = lazy(() => import('./adminTabs/iot').then((m) => ({ default: m.BleTab })))
const CalendarsTab = lazy(() => import('./adminTabs/homeAssistant').then((m) => ({ default: m.CalendarsTab })))
const CloudSettingsTab = lazy(() => import('./adminTabs/tools').then((m) => ({ default: m.CloudSettingsTab })))
const ConnectorTab = lazy(() => import('./adminTabs/services').then((m) => ({ default: m.ConnectorTab })))
const ControlModeTab = lazy(() => import('./adminTabs/core').then((m) => ({ default: m.ControlModeTab })))
const DatabaseTab = lazy(() => import('./adminTabs/tools').then((m) => ({ default: m.DatabaseTab })))
const DevBridgeTab = lazy(() => import('./adminTabs/os').then((m) => ({ default: m.DevBridgeTab })))
const DeveloperModeTab = lazy(() => import('./adminTabs/core').then((m) => ({ default: m.DeveloperModeTab })))
const DevicesTab = lazy(() => import('./adminTabs/network').then((m) => ({ default: m.DevicesTab })))
const DocumentationTab = lazy(() => import('./adminTabs/core').then((m) => ({ default: m.DocumentationTab })))
const DomainValidatorTab = lazy(() => import('./adminTabs/services').then((m) => ({ default: m.DomainValidatorTab })))
const EntitiesTab = lazy(() => import('./adminTabs/homeAssistant').then((m) => ({ default: m.EntitiesTab })))
const FilesTab = lazy(() => import('./adminTabs/services').then((m) => ({ default: m.FilesTab })))
const GatewayTab = lazy(() => import('./adminTabs/services').then((m) => ({ default: m.GatewayTab })))
const GlobalAlertTab = lazy(() => import('./adminTabs/tools').then((m) => ({ default: m.GlobalAlertTab })))
const GlobalConfigTab = lazy(() => import('./adminTabs/core').then((m) => ({ default: m.GlobalConfigTab })))
const HaConfigTab = lazy(() => import('./adminTabs/homeAssistant').then((m) => ({ default: m.HaConfigTab })))
const HaConnectionTab = lazy(() => import('./adminTabs/homeAssistant').then((m) => ({ default: m.HaConnectionTab })))
const HaDeveloperToolsTab = lazy(() => import('./adminTabs/homeAssistant').then((m) => ({ default: m.HaDeveloperToolsTab })))
const HealthIntelligenceTab = lazy(() => import('./adminTabs/core').then((m) => ({ default: m.HealthIntelligenceTab })))
const HomekitTab = lazy(() => import('./adminTabs/iot').then((m) => ({ default: m.HomekitTab })))
const IntegrationsTab = lazy(() => import('./adminTabs/homeAssistant').then((m) => ({ default: m.IntegrationsTab })))
const LogbookTab = lazy(() => import('./adminTabs/homeAssistant').then((m) => ({ default: m.LogbookTab })))
const LogsTab = lazy(() => import('./adminTabs/tools').then((m) => ({ default: m.LogsTab })))
const MatterTab = lazy(() => import('./adminTabs/iot').then((m) => ({ default: m.MatterTab })))
const MqttTab = lazy(() => import('./adminTabs/iot').then((m) => ({ default: m.MqttTab })))
const NetworkTab = lazy(() => import('./adminTabs/network').then((m) => ({ default: m.NetworkTab })))
const NotificationsTab = lazy(() => import('./adminTabs/tools').then((m) => ({ default: m.NotificationsTab })))
const OsDisksTab = lazy(() => import('./adminTabs/os').then((m) => ({ default: m.OsDisksTab })))
const OsNetworkConfigTab = lazy(() => import('./adminTabs/os').then((m) => ({ default: m.OsNetworkConfigTab })))
const OsPowerTab = lazy(() => import('./adminTabs/os').then((m) => ({ default: m.OsPowerTab })))
const OsProcessesTab = lazy(() => import('./adminTabs/os').then((m) => ({ default: m.OsProcessesTab })))
const OsSshTab = lazy(() => import('./adminTabs/os').then((m) => ({ default: m.OsSshTab })))
const PresenceTab = lazy(() => import('./adminTabs/network').then((m) => ({ default: m.PresenceTab })))
const ProtocolsOverviewTab = lazy(() => import('./adminTabs/homeAssistant').then((m) => ({ default: m.ProtocolsOverviewTab })))
const RealtimeTab = lazy(() => import('./adminTabs/tools').then((m) => ({ default: m.RealtimeTab })))
const ResourcesTab = lazy(() => import('./adminTabs/services').then((m) => ({ default: m.ResourcesTab })))
const ScenesTab = lazy(() => import('./adminTabs/homeAssistant').then((m) => ({ default: m.ScenesTab })))
const SchedulerTab = lazy(() => import('./adminTabs/tools').then((m) => ({ default: m.SchedulerTab })))
const SecretsTab = lazy(() => import('./adminTabs/services').then((m) => ({ default: m.SecretsTab })))
const ServicesTab = lazy(() => import('./adminTabs/core').then((m) => ({ default: m.ServicesTab })))
const SystemLogsTab = lazy(() => import('./adminTabs/tools').then((m) => ({ default: m.SystemLogsTab })))
const SystemNotificationsTab = lazy(() => import('./adminTabs/tools').then((m) => ({ default: m.SystemNotificationsTab })))
const SystemTab = lazy(() => import('./adminTabs/core').then((m) => ({ default: m.SystemTab })))
const TasksTab = lazy(() => import('./adminTabs/core').then((m) => ({ default: m.TasksTab })))
const ThemesTab = lazy(() => import('./adminTabs/core').then((m) => ({ default: m.ThemesTab })))
const UsersTab = lazy(() => import('./adminTabs/network').then((m) => ({ default: m.UsersTab })))
const WarningsTab = lazy(() => import('./adminTabs/tools').then((m) => ({ default: m.WarningsTab })))
const WatchdogTab = lazy(() => import('./adminTabs/services').then((m) => ({ default: m.WatchdogTab })))
const WebhooksTab = lazy(() => import('./adminTabs/tools').then((m) => ({ default: m.WebhooksTab })))
const ZigbeeTab = lazy(() => import('./adminTabs/iot').then((m) => ({ default: m.ZigbeeTab })))
const ZwaveTab = lazy(() => import('./adminTabs/iot').then((m) => ({ default: m.ZwaveTab })))

export interface CloudSettings {
  connectorHost: string
  useTls: boolean
  privatePort: number
  publicProxyPort: number
  enableReverseProxy: boolean
  requireVpnOnly: boolean
}

export interface AdminUser {
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

export interface ApiKeyEntry {
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

export interface ApiKeyWithSecret extends ApiKeyEntry {
  key: string
}

export type Tab = 'services' | 'health-intelligence' | 'tasks' | 'control-mode' | 'system' | 'system-info' | 'network' | 'infrastructure' | 'users' | 'presence' | 'api-keys' | 'webhooks' | 'ha-config' | 'ha-connection' | 'integrations' | 'mqtt' | 'matter' | 'zigbee' | 'zwave' | 'ble' | 'homekit' | 'scenes' | 'automations' | 'backups' | 'cloud-settings' | 'logs' | 'system-logs' | 'realtime' | 'database' | 'warnings' | 'entities' | 'scheduler' | 'analytics' | 'logbook' | 'calendars' | 'system-notifications' | 'apps' | 'plugins' | 'registrations' | 'security-monitor' | 'updates' | 'widgets' | 'global-config' | 'developer-mode' | 'documentation' | 'protocols' | 'ha-tools' | 'global-alert' | 'notifications' | 'ai-agent' | 'ai-overview' | 'ai-providers' | 'ai-conversations' | 'ai-tasks' | 'ai-tools' | 'ai-voice' | 'devices' | 'secrets' | 'files' | 'gateway' | 'watchdog' | 'connector' | 'domain-validator' | 'resources' | 'api-bridge' | 'dev-bridge' | 'os-ssh' | 'os-network-config' | 'os-disks' | 'os-processes' | 'os-power' | 'themes' | 'appearance-standards'

// ═══ Unified Control Center Design Components ═══
// Theme-aware, consistent input/button/card primitives for the entire Control Center.

export const ccInput = (base: string = '') =>
  `w-full rounded-xl border border-foreground/[0.08] bg-foreground/[0.04] px-4 py-2.5 text-sm text-foreground placeholder:text-foreground/30 outline-none transition-all duration-200 hover:border-foreground/[0.15] focus:border-accent/60 focus:ring-2 focus:ring-accent/10 focus:bg-foreground/[0.06] ${base}`

export const ccSelect = (base: string = '') =>
  `${ccInput()} appearance-none cursor-pointer pr-10 ${base}`

export const ccTextarea = (base: string = '') =>
  `${ccInput()} resize-y min-h-[80px] ${base}`

export const ccBtnPrimary = (base: string = '') =>
  `inline-flex items-center justify-center gap-1.5 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-accent/20 transition-all duration-200 hover:bg-accent/90 hover:shadow-md hover:shadow-accent/25 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-accent ${base}`

export const ccBtnSecondary = (base: string = '') =>
  `inline-flex items-center justify-center gap-1.5 rounded-xl border border-foreground/[0.08] bg-foreground/[0.04] px-5 py-2.5 text-sm font-semibold text-foreground/80 transition-all duration-200 hover:border-foreground/[0.15] hover:bg-foreground/[0.08] active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed ${base}`

export const ccBtnDanger = (base: string = '') =>
  `inline-flex items-center justify-center gap-1.5 rounded-xl border border-red-500/20 bg-red-500/10 px-5 py-2.5 text-sm font-semibold text-red-400 transition-all duration-200 hover:bg-red-500/20 hover:border-red-500/30 active:scale-[0.98] disabled:opacity-40 ${base}`

export const ccBtnIcon = (base: string = '') =>
  `inline-flex items-center justify-center rounded-xl p-2 text-foreground/50 hover:text-foreground hover:bg-foreground/[0.06] transition-all duration-200 active:scale-95 ${base}`

export const ccCard = (base: string = '') =>
  `rounded-2xl border border-foreground/[0.06] bg-background/60 backdrop-blur-xl p-4 sm:p-5 overflow-x-auto ${base}`

export const ccBadge = (color: string, base: string = '') =>
  `inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold ${color} ${base}`

export const ccLabel = 'text-[10px] font-semibold uppercase tracking-[0.15em] text-foreground/50 mb-1.5 block'
export const ccSectionTitle = 'text-sm font-semibold text-foreground mb-3'

// ═══ End Design Components ═══

// Static tab IDs for quick lookup (used by adminPathToTab before component mounts)
const TAB_IDS = new Set<Tab>([
  'services', 'health-intelligence', 'themes', 'developer-mode', 'documentation',
  'protocols', 'ha-tools', 'global-alert', 'notifications', 'tasks', 'control-mode',
  'system', 'system-info', 'network', 'infrastructure', 'users', 'presence', 'apps', 'plugins',
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
export function getTabs(t: (key: string) => string): TabEntry[] {
  return [
    { id: 'services', label: t('admin.services'), icon: Gauge, description: 'Alle rumahl-Dienste überwachen — Status, Erreichbarkeit und Uptime aller Microservices' },
    { id: 'health-intelligence', label: t('admin.healthIntelligence'), icon: Heartbeat, description: 'KI-gestützte Systemanalyse — Health Scores, Vorhersagen, Anomalien und Smart Suggestions' },
    { id: 'themes', label: t('admin.themes'), icon: Palette, description: t('admin.themesDesc') },
    { id: 'appearance-standards', label: t('admin.appearanceStandards'), icon: Palette, description: t('admin.appearanceStandardsDesc') },
    { id: 'developer-mode', label: t('admin.developerMode'), icon: Wrench, description: 'Debug-Funktionen aktivieren — erweiterte Logs, Render-Counter, rohe JSON-Antworten, SSE/WS-Frame-Inspektor' },
    { id: 'documentation', label: t('admin.documentation'), icon: BookOpen, description: t('admin.docsDesc') },
    { id: 'protocols', label: t('admin.protocols'), icon: Stack, description: 'Kombinierte Live-Übersicht aller IoT-Protokolle (HA, MQTT, Zigbee, Z-Wave, Matter, BLE, HomeKit) auf einen Blick' },
    { id: 'ha-tools', label: t('admin.haTools'), icon: Code, description: t('admin.haToolsDesc') },
    { id: 'global-alert', label: t('admin.globalAlert'), icon: Megaphone, description: 'System-weiten Banner-Alarm setzen oder zurücknehmen — wird allen verbundenen Clients per WebSocket zugestellt' },
    { id: 'notifications', label: t('admin.notifications'), icon: Bell, description: 'Alle vom Backend erzeugten Benachrichtigungen einsehen, als gelesen markieren oder löschen' },
    { id: 'tasks', label: t('admin.tasks'), icon: ListChecks, description: 'Hintergrund-Aufgaben und Warteschlangen überwachen, Aufgaben manuell auslösen oder deaktivieren' },
    { id: 'control-mode', label: t('admin.controlMode'), icon: Robot, description: t('admin.controlModeDesc') },
    { id: 'system', label: t('admin.system'), icon: Cpu, description: t('admin.systemDesc') },
    { id: 'system-info', label: t('admin.systemInfo'), icon: Heartbeat, description: 'Detaillierte Systeminformationen von rumahl OS — CPU, RAM, Festplatten und Netzwerk' },
    { id: 'network', label: 'Netzwerk', icon: Globe, description: 'Netzwerk-Informationen und IP-Konfiguration verwalten' },
    { id: 'infrastructure', label: 'Infrastruktur', icon: TrendUp, description: 'Live-Visualisierung der gesamten rumahl-Infrastruktur mit Service-Status und Datenflüssen' },
    { id: 'users', label: 'Benutzer', icon: Users, description: 'Benutzerkonten verwalten, Rollen zuweisen und Zugänge kontrollieren' },
    { id: 'presence', label: 'Live-Übersicht', icon: Pulse, description: 'Alle angemeldeten Nutzer und ihre Geräte in Echtzeit — wer ist online, auf welchem Browser, Desktop oder Kiosk eingeloggt' },
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
    { id: 'cloud-settings', label: 'rumahl Cloud', icon: CloudArrowUp, description: 'Private API-URL und Ports für den Cloud Connector konfigurieren' },
    { id: 'logs', label: 'Logs', icon: ListBullets, description: 'System- und Home Assistant Logs in Echtzeit einsehen' },
    { id: 'system-logs', label: 'System-Events', icon: Warning, description: 'Zentrale Fehler-, Warn- und Info-Events aus Hintergrundprozessen wie Webhook-Auslieferung, Scheduler und HA-Sync' },
    { id: 'logbook', label: 'Logbuch', icon: BookOpen, description: 'Home Assistant Logbuch — chronologischer Verlauf aller Zustandsänderungen und Ereignisse' },
    { id: 'calendars', label: 'Kalender', icon: CalendarBlank, description: 'Home Assistant Kalender-Entitäten und anstehende Termine anzeigen' },
    { id: 'realtime', label: 'Realtime', icon: Broadcast, description: 'SSE Event-Streams und Socket.IO-Namespace-WebSocket für Echtzeit-Daten testen und überwachen' },
    { id: 'database', label: 'Datenbank', icon: Database, description: 'SQLite-Datenbank verwalten, bereinigen und Statistiken anzeigen' },
    { id: 'warnings', label: 'Warnungen', icon: ShieldWarning, description: 'Protokoll aller Wetter- und Zivilschutzwarnungen mit Zeitstempeln' },
    { id: 'system-notifications', label: 'System-Meldungen', icon: Siren, description: 'Systemmeldungen zu Sync-Status, Datenlücken und Backend-Warnungen – nur für Admins sichtbar' },
    { id: 'ai-overview', label: 'AI Übersicht', icon: Brain, description: 'rumahl Assist Status, aktiver Provider, Verbrauch und Health — zentrale AI-Übersicht' },
    { id: 'ai-providers', label: 'AI Provider', icon: MagicWand, description: 'AI Provider verwalten — OpenAI, Anthropic, lokale Modelle und Desktop-Bridges konfigurieren' },
    { id: 'ai-conversations', label: 'AI Konversationen', icon: ChatCircle, description: 'Konversations-Threads, Verlauf und proaktive Benachrichtigungen verwalten' },
    { id: 'ai-tasks', label: 'AI Aufgaben', icon: Robot, description: 'Autonome AI-Aufgaben — Zeitpläne, Trigger und Status der Hintergrund-Agenten' },
    { id: 'ai-tools', label: 'AI Tools', icon: Hand, description: 'Internet-Suche, Web-Scraping und Screenshot-Tools des Assistenten testen und ausführen' },
    { id: 'ai-voice', label: 'AI Stimme', icon: Microphone, description: 'Spracheingabe (STT) und Sprachausgabe (TTS) testen — Voice-Modelle und Latenz prüfen' },
    { id: 'ai-agent', label: 'Agent', icon: Robot, description: 'Vollständiger Agent-Arbeitsbereich mit Chat, Aufgaben und Verlauf — wie GitHub Agent Tab' },
    { id: 'devices', label: 'Verbundene Geräte', icon: Desktop, description: 'Alle registrierten rumahl Desktop, Browser- und Kiosk-Clients sehen — Online-Status, letzter Heartbeat, aktive WebSocket-Sitzungen' },
    { id: 'secrets', label: 'Secrets', icon: Vault, description: 'Verschlüsselter Tresor für API-Keys, Tokens und Passwörter — verwalten, rotieren und Audit-Log einsehen (rumahl-secrets)' },
    { id: 'files', label: 'Dateien', icon: FolderOpen, description: 'Datei-Verwaltung mit Versionierung, Freigabe-Links, Berechtigungen und Quotas (rumahl-files)' },
    { id: 'gateway', label: 'Gateway', icon: Envelope, description: 'Externe Gateway-Operationen — E-Mail-Versand, Web-Suche, HTTP-Proxy und Update-Verifikation (rumahl-gateway)' },
    { id: 'watchdog', label: 'Watchdog', icon: Dog, description: 'Service-Health-Monitoring, Heartbeats, Auto-Recovery und Event-Stream (rumahl-watchdog)' },
    { id: 'connector', label: 'Connector / Tunnel', icon: ShareNetwork, description: 'Cloud-Tunnel, exponierte Dienste, Pairing-Tokens und IP-Blocklist (rumahl-connector)' },
    { id: 'domain-validator', label: 'Domain Validator', icon: ShieldCheck, description: 'App-Zugriffsrichtlinien für externe Domains und Audit-Log (rumahl-domain-validator)' },
    { id: 'resources', label: 'Ressourcen', icon: HardDrive, description: 'Container-Ressourcenverwaltung, CPU-/RAM-Allokation und Reallokation (rumahl-resource-manager)' },
    { id: 'api-bridge', label: 'API Bridge', icon: Code, description: 'GraphQL, WebDAV, CalDAV und MQTT-Bridge — externe Schnittstellen der rumahl-api' },
    { id: 'dev-bridge', label: 'Dev Bridge', icon: Terminal, description: 'rumahl OS Dev Bridge — Service-Logs, System-Info, Filesystem, Build & Replace und Live-Streaming aller Dienste auf Entwickler-Images' },
    { id: 'os-ssh', label: 'SSH-Zugang', icon: Terminal, description: 'SSH-Server aktivieren/deaktivieren, autorisierte Schlüssel und SSH-Benutzer verwalten — nur auf rumahl OS' },
    { id: 'os-network-config', label: 'IP-Konfiguration', icon: Globe, description: 'Netzwerk-Interfaces auflisten und IP/Gateway/DNS pro Interface konfigurieren — nur auf rumahl OS' },
    { id: 'os-disks', label: 'Festplatten', icon: HardDrive, description: 'Alle gemounteten Datenträger, Belegung, Dateisysteme und entfernbare Medien — nur auf rumahl OS' },
    { id: 'os-processes', label: 'Prozesse', icon: Pulse, description: 'Top-Prozesse mit CPU- und RAM-Verbrauch, sortiert nach Auslastung — nur auf rumahl OS' },
    { id: 'os-power', label: 'Power & Hostname', icon: Power, description: 'Hostname ändern, rumahl OS neu starten oder herunterfahren — nur auf rumahl OS' },
  ]
}

type TabGroup = {
  id: string
  title: string
  icon: typeof ShieldCheck
  items: Tab[]
}

export const tabGroups: TabGroup[] = [
  { id: 'core', title: 'System & Kontrolle', icon: Cpu, items: ['services', 'health-intelligence', 'global-config', 'developer-mode', 'dev-bridge', 'documentation', 'tasks', 'control-mode', 'system', 'system-info', 'network', 'infrastructure', 'devices'] },
  { id: 'ai', title: 'KI & Assistent', icon: Brain, items: ['ai-agent', 'ai-overview', 'ai-providers', 'ai-conversations', 'ai-tasks', 'ai-tools', 'ai-voice'] },
  { id: 'extensions', title: 'Apps, Plugins & Themes', icon: Palette, items: ['apps', 'plugins', 'themes', 'registrations', 'security-monitor', 'updates', 'widgets'] },
  { id: 'home', title: 'Home Assistant', icon: Cube, items: ['ha-config', 'ha-connection', 'integrations', 'entities', 'ha-tools', 'scenes', 'automations', 'logbook', 'calendars'] },
  { id: 'devices', title: 'Geräte & Netzwerk', icon: WifiHigh, items: ['protocols', 'mqtt', 'zigbee', 'zwave', 'matter', 'ble', 'homekit'] },
  { id: 'services', title: 'rumahl Backend-Dienste', icon: Plug, items: ['secrets', 'files', 'gateway', 'watchdog', 'connector', 'domain-validator', 'resources', 'api-bridge'] },
  { id: 'os', title: 'rumahl OS', icon: Terminal, items: ['os-ssh', 'os-network-config', 'os-disks', 'os-processes', 'os-power'] },
  { id: 'tools', title: 'Tools & Infrastruktur', icon: Wrench, items: ['api-keys', 'webhooks', 'scheduler', 'analytics', 'backups', 'cloud-settings', 'logs', 'system-logs', 'database', 'warnings', 'system-notifications', 'global-alert', 'notifications'] },
  { id: 'access', title: 'Benutzer', icon: Users, items: ['users', 'presence'] },
]

export const CLOUD_HOST_KEY = 'rumahl-cloud-connector-host'
export const CLOUD_USE_TLS_KEY = 'rumahl-cloud-connector-use-tls'
export const CLOUD_PRIVATE_PORT_KEY = 'rumahl-cloud-connector-private-port'
export const CLOUD_PUBLIC_PORT_KEY = 'rumahl-cloud-connector-public-port'
export const CLOUD_ENABLE_REVERSE_PROXY_KEY = 'rumahl-cloud-connector-enable-reverse-proxy'
export const CLOUD_REQUIRE_VPN_KEY = 'rumahl-cloud-connector-require-vpn'


export const backendBase = () => getBackendUrl() || ''

/**
 * Returns the correct base URL for `path`. Assist calls intentionally go
 * through rumahl-home/nginx as relative `/api/assist/*` requests; direct
 * browser calls to local loopback break as soon as the dashboard is opened from
 * another device.
 */
export function baseUrlFor(path: string): string {
  return backendBase()
}

export async function adminFetch(path: string, token: string, options?: RequestInit) {
  // Without a token any admin call would just 401 on the backend and flood
  // its logs — fail fast locally (the caller shows the friendly message).
  if (!token) {
    throw new Error('Sitzung abgelaufen. Bitte neu einloggen.')
  }
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
        message = 'Dieser Bereich ist auf diesem System (noch) nicht verfügbar. Der Endpunkt existiert nicht oder wird von einem anderen rumahl-Microservice bereitgestellt.'
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
    if (res.status === 401) {
      // Session expired — let the AuthContext log the user out cleanly.
      // Only when a token was actually sent (a boot-time call with an empty
      // token must not log out an otherwise healthy session).
      if (token) {
        window.dispatchEvent(new CustomEvent('rumahl:auth-unauthorized', { detail: { url } }))
      }
      throw new Error('Sitzung abgelaufen. Bitte neu einloggen.')
    }
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
export function notifyError(e: unknown): void {
  const message = e instanceof Error ? e.message : (typeof e === 'string' ? e : 'Unbekannter Fehler')
  console.error('[AdminPanel] action failed:', e)
  try { toast.error(message) } catch { /* toast container may not be mounted in some contexts */ }
}

// Simple cache so tab switches don't re-fetch
export const dataCache = new Map<string, { data: unknown; ts: number }>()
const CACHE_TTL = 120_000 // 2 minutes – backend also caches, so this is safe

// Paths that change rarely and benefit from longer caching
const LONG_TTL_PATHS = new Set([
  '/api/admin/ha/config', '/api/admin/ha/services', '/api/admin/ha/integrations',
  '/api/admin/ha/supervisor', '/api/admin/ha/addons', '/api/admin/ha/backups',
  '/api/admin/ha/network', '/api/admin/ha/scenes', '/api/admin/ha/automations',
  '/api/admin/ha/mqtt', '/api/admin/ha/matter', '/api/admin/system/database',
])
const LONG_CACHE_TTL = 600_000 // 10 minutes for stable data (HA config/services rarely change at runtime)

export async function cachedFetch(path: string, token: string): Promise<unknown> {
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

/// Render the content of a single admin tab (used by AdminPanel and
/// the new AdminCenter shell). The lazy tab components are module-scope.
export function renderAdminTabContent(tab: Tab, token: string): React.ReactNode {
  switch (tab) {
    case 'services': return <Suspense fallback={null}><ServicesTab token={token} /></Suspense>
    case 'health-intelligence': return <Suspense fallback={null}><HealthIntelligenceTab token={token} /></Suspense>
    case 'global-config': return <Suspense fallback={null}><GlobalConfigTab token={token} /></Suspense>
    case 'developer-mode': return <Suspense fallback={null}><DeveloperModeTab token={token} /></Suspense>
    case 'documentation': return <Suspense fallback={null}><DocumentationTab /></Suspense>
    case 'tasks': return <Suspense fallback={null}><TasksTab token={token} /></Suspense>
    case 'control-mode': return <Suspense fallback={null}><ControlModeTab token={token} /></Suspense>
    case 'system': return <Suspense fallback={null}><SystemTab token={token} /></Suspense>
    case 'system-info': return <SystemInfoTab token={token} />
    case 'appearance-standards': return <Suspense fallback={null}><AppearanceStandardsTab /></Suspense>
    case 'infrastructure': return <InfrastructureVisualization token={token} />
    case 'apps': return <AppStoreTab token={token} />
    case 'plugins': return <PluginsTab token={token} />
    case 'registrations': return <RegistrationManagementTab token={token} />
    case 'security-monitor': return <SecurityMonitorTab token={token} />
    case 'updates': return <UpdateManagementTab token={token} />
    case 'widgets': return <WidgetManagementTab token={token} />
    case 'users': return <Suspense fallback={null}><UsersTab token={token} /></Suspense>
    case 'presence': return <Suspense fallback={null}><PresenceTab token={token} /></Suspense>
    case 'system-logs': return <Suspense fallback={null}><SystemLogsTab token={token} /></Suspense>
    case 'api-keys': return <Suspense fallback={null}><ApiKeysTab token={token} /></Suspense>
    case 'webhooks': return <Suspense fallback={null}><WebhooksTab token={token} /></Suspense>
    case 'ha-config': return <Suspense fallback={null}><HaConfigTab token={token} /></Suspense>
    case 'ha-connection': return <Suspense fallback={null}><HaConnectionTab token={token} /></Suspense>
    case 'integrations': return <Suspense fallback={null}><IntegrationsTab token={token} /></Suspense>
    case 'entities': return <Suspense fallback={null}><EntitiesTab token={token} /></Suspense>
    case 'mqtt': return <Suspense fallback={null}><MqttTab token={token} /></Suspense>
    case 'zigbee': return <Suspense fallback={null}><ZigbeeTab token={token} /></Suspense>
    case 'zwave': return <Suspense fallback={null}><ZwaveTab token={token} /></Suspense>
    case 'matter': return <Suspense fallback={null}><MatterTab token={token} /></Suspense>
    case 'ble': return <Suspense fallback={null}><BleTab token={token} /></Suspense>
    case 'homekit': return <Suspense fallback={null}><HomekitTab token={token} /></Suspense>
    case 'scenes': return <Suspense fallback={null}><ScenesTab token={token} /></Suspense>
    case 'automations': return <Suspense fallback={null}><AutomationsTab token={token} /></Suspense>
    case 'scheduler': return <Suspense fallback={null}><SchedulerTab token={token} /></Suspense>
    case 'analytics': return <Suspense fallback={null}><AnalyticsTab token={token} /></Suspense>
    case 'backups': return <Suspense fallback={null}><BackupsTab token={token} /></Suspense>
    case 'network': return <Suspense fallback={null}><NetworkTab token={token} /></Suspense>
    case 'cloud-settings': return <Suspense fallback={null}><CloudSettingsTab token={token} /></Suspense>
    case 'logs': return <Suspense fallback={null}><LogsTab token={token} /></Suspense>
    case 'logbook': return <Suspense fallback={null}><LogbookTab token={token} /></Suspense>
    case 'calendars': return <Suspense fallback={null}><CalendarsTab token={token} /></Suspense>
    case 'realtime': return <Suspense fallback={null}><RealtimeTab token={token} /></Suspense>
    case 'database': return <Suspense fallback={null}><DatabaseTab token={token} /></Suspense>
    case 'warnings': return <Suspense fallback={null}><WarningsTab token={token} /></Suspense>
    case 'system-notifications': return <Suspense fallback={null}><SystemNotificationsTab token={token} /></Suspense>
    case 'protocols': return <Suspense fallback={null}><ProtocolsOverviewTab token={token} /></Suspense>
    case 'ha-tools': return <Suspense fallback={null}><HaDeveloperToolsTab token={token} /></Suspense>
    case 'global-alert': return <Suspense fallback={null}><GlobalAlertTab token={token} /></Suspense>
    case 'notifications': return <Suspense fallback={null}><NotificationsTab token={token} /></Suspense>
    case 'ai-overview': return <Suspense fallback={null}><AiOverviewTab token={token} /></Suspense>
    case 'ai-providers': return <Suspense fallback={null}><AiProvidersTab token={token} /></Suspense>
    case 'ai-conversations': return <Suspense fallback={null}><AiConversationsTab token={token} /></Suspense>
    case 'ai-tasks': return <Suspense fallback={null}><AiTasksTab token={token} /></Suspense>
    case 'ai-tools': return <Suspense fallback={null}><AiToolsTab token={token} /></Suspense>
    case 'ai-voice': return <Suspense fallback={null}><AiVoiceTab token={token} /></Suspense>
    case 'ai-agent': return <AgentTab token={token} />
    case 'secrets': return <Suspense fallback={null}><SecretsTab token={token} /></Suspense>
    case 'files': return <Suspense fallback={null}><FilesTab token={token} /></Suspense>
    case 'gateway': return <Suspense fallback={null}><GatewayTab token={token} /></Suspense>
    case 'watchdog': return <Suspense fallback={null}><WatchdogTab token={token} /></Suspense>
    case 'connector': return <Suspense fallback={null}><ConnectorTab token={token} /></Suspense>
    case 'domain-validator': return <Suspense fallback={null}><DomainValidatorTab token={token} /></Suspense>
    case 'resources': return <Suspense fallback={null}><ResourcesTab token={token} /></Suspense>
    case 'api-bridge': return <Suspense fallback={null}><ApiBridgeTab token={token} /></Suspense>
    case 'os-ssh': return <Suspense fallback={null}><OsSshTab token={token} /></Suspense>
    case 'os-network-config': return <Suspense fallback={null}><OsNetworkConfigTab token={token} /></Suspense>
    case 'os-disks': return <Suspense fallback={null}><OsDisksTab token={token} /></Suspense>
    case 'os-processes': return <Suspense fallback={null}><OsProcessesTab token={token} /></Suspense>
    case 'os-power': return <Suspense fallback={null}><OsPowerTab token={token} /></Suspense>
    case 'dev-bridge': return <Suspense fallback={null}><DevBridgeTab token={token} /></Suspense>
    case 'devices': return <Suspense fallback={null}><DevicesTab token={token} /></Suspense>
    case 'themes': return <Suspense fallback={null}><ThemesTab token={token} /></Suspense>
    default: return null
  }
}

export function AdminPanel() {
  const { t } = useTranslation()
  const tabs = useMemo(() => getTabs(t), [t])
  const { token } = useAuth()
  const [activeTab, setActiveTab] = useState<Tab>(() => adminPathToTab(window.location.pathname))
  // Persist expanded group across page reloads via localStorage
  const [expandedGroup, setExpandedGroup] = useState<string>(() => {
    try {
      return localStorage.getItem('rumahl-admin-expanded-group') || 'core'
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
    try { localStorage.setItem('rumahl-admin-expanded-group', expandedGroup) } catch {}
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

  // Deep-link support: when something dispatches `rumahl:open-admin` with
  // {tab: 'assist'} or writes 'rumahl-admin-deep-link' to sessionStorage,
  // jump to the matching admin tab (e.g. "ai-providers" for the AI banner CTA).
  useEffect(() => {
    const resolveDeepLink = (raw: string | null | undefined): Tab | null => {
      if (!raw) return null
      const map: Record<string, Tab> = {
        assist: 'ai-providers',
        'ai-providers': 'ai-providers',
        'ai-agent': 'ai-agent',
        'ai-overview': 'ai-overview',
        'ai-tools': 'ai-tools',
        'ai-voice': 'ai-voice',
      }
      return map[raw] ?? null
    }

    // 1) Consume any pending deep-link written before mount
    try {
      const pending = sessionStorage.getItem('rumahl-admin-deep-link')
      const target = resolveDeepLink(pending)
      if (target) {
        setActiveTab(target)
        sessionStorage.removeItem('rumahl-admin-deep-link')
      }
    } catch {}

    // 2) Live listener for events fired while AdminPanel is already mounted
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { tab?: string } | undefined
      const target = resolveDeepLink(detail?.tab)
      if (target) setActiveTab(target)
    }
    window.addEventListener('rumahl:open-admin', handler)
    return () => window.removeEventListener('rumahl:open-admin', handler)
  }, [])

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
            <p className="text-sm font-semibold text-foreground">{t('os.apps.admin.name')}</p>
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
              <p className="text-sm font-semibold text-foreground">{t('os.apps.admin.name')}</p>
              <p className="text-[10px] text-foreground/40">{t('os.apps.admin.description')}</p>
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
              {renderAdminTabContent(activeTab, token)}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

// ── Services Tab (Dienste-Überwachung) ──────────────────────────────────

export interface ServiceStatus {
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
// Surfaces every rumahl OS setting registered with the backend
// `SettingsRegistry` (see backend/rumahl-shared/src/settings.rs). The
// schema-driven design means we get one consistent UI for what would
// otherwise be a sprawling .env file: every entry has a description,
// category, type-aware input, validation and a list of services that
// need to restart after a write.

export interface SettingDefDto {
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
export interface SettingValueDto extends SettingDefDto {
  value: unknown
  is_set: boolean
}

/** Factory: creates category labels using the given translation function.
 *  Must not call i18n.t at module level — the bundler mangles it to bare t(). */
export function getCategoryLabels(t: (key: string) => string): Record<SettingDefDto['category'], string> {
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

export const CATEGORY_DESCRIPTIONS: Record<SettingDefDto['category'], string> = {
  system: 'System-kritische Werte: Hostname, Zeitzone, Netzwerk, Sicherheit. Änderungen können einen Neustart erfordern.',
  home_assistant: 'Verbindung zur Home-Assistant-Instanz: URL, Long-Lived Token und Synchronisations-Optionen.',
  integrations: 'Smart-Home-Protokolle: MQTT, Matter, Zigbee, Z-Wave, Bluetooth, HomeKit.',
  appearance: 'Sprache, Theme, Einheiten und sonstige UI-Präferenzen.',
  privacy: 'Telemetrie, Aufzeichnungen und Datenschutzeinstellungen.',
  developer: 'Debug-Schalter, experimentelle Features und tiefe Konfiguration. Mit Vorsicht ändern.',
  other: 'Alles, was in keine andere Kategorie passt.',
}

export function SettingInput({ def, value, onChange, disabled }: {
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
// active, the rumahl Developer App is unlocked, ZIP installs use a relaxed
// trust model, and the dev-bridge surfaces extra `/api/dev/*` endpoints.
// Non-developers should leave this off — it broadens the system's
// attack surface in exchange for tooling convenience.
//
// On OS-Entwickler-Images (where /etc/rumahl/os-dev-mode is present and
// `rumahl-dev-bridge.service` is shipping) the toggle is locked on and a
// banner explains the implications.
export function AdminCard({ children, title, description, icon: Icon, className = '' }: {
  children: React.ReactNode
  title?: string
  description?: string
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
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            {description && <p className="mt-0.5 text-xs text-foreground/45">{description}</p>}
          </div>
        </div>
      )}
      {children}
    </div>
  )
}

export function StatItem({ label, value }: { label: string; value: string | number | undefined }) {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-foreground/5 last:border-0">
      <span className="text-xs text-foreground/85">{label}</span>
      <span className="text-xs font-medium text-foreground">{value ?? '–'}</span>
    </div>
  )
}

// ── System Tab ──────────────────────────────────────────────────

export function ConfigModal({ open, onClose, title, icon: Icon, children }: {
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
          className="rumahl-card rounded-2xl p-5 w-full max-w-md max-h-[80vh] overflow-y-auto"
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

export function LoadingSpinner() {
  const { t } = useTranslation()
  return (
    <div className="rounded-2xl border border-foreground/[0.06] bg-background/60 backdrop-blur-xl p-12 flex flex-col items-center justify-center gap-3">
      <div className="w-8 h-8 border-[3px] border-accent/20 border-t-accent rounded-full animate-spin" />
      <p className="text-xs text-foreground/40">{t('common.loading')}</p>
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

export function formatUptime(seconds: number | undefined): string {
  if (!seconds) return '–'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h ${mins}m`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

// ─── Warnings Tab ──────────────────────────────────────────────────────────────

export interface WarningLogEntry {
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

export async function devBridgeFetch(path: string, devToken?: string | null, options?: RequestInit): Promise<Response> {
  const baseUrl = getDevBridgeUrl()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options?.headers as Record<string, string>) || {}),
  }
  if (devToken) {
    headers['x-rumahl-dev-token'] = devToken
  }
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
  })
}

export function ServiceJsonBlock({ data, max = 'max-h-72' }: { data: unknown; max?: string }) {
  return (
    <pre className={`text-[11px] font-mono whitespace-pre-wrap break-words bg-foreground/5 border border-foreground/10 rounded-lg p-3 text-foreground/80 ${max} overflow-auto`}>
      {JSON.stringify(data, null, 2)}
    </pre>
  )
}

// ─── Dev Bridge: Journal (System-Logs) ────────────────────────────────



export function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}min`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}
