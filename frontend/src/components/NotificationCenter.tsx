import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'motion/react'
import { Bell, X, Check, Trash, Warning, Siren, CloudWarning, Info, ShieldWarning, Megaphone, CaretDown, CaretUp, Clock, IdentificationBadge } from '@phosphor-icons/react'
import { useNotifications, type Notification, type EmergencyAlert } from '@/contexts/NotificationContext'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useEntityStore } from '@/hooks/useEntityStore'
import { wsOnMessage } from '@/lib/wsConnection'
import type { EntityState } from '@/lib/types'
import { Tip } from '@/components/ui/tip'

// ── Notification Bell (for NavigationMenu) ──────────────────────────

export function NotificationBell() {
  const { notifications, unreadCount, emergencyAlert } = useNotifications()
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const bellRef = useRef<HTMLButtonElement>(null)

  // Close panel on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node) &&
          bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const hasEmergency = !!emergencyAlert
  const bellColor = hasEmergency
    ? 'text-red-400'
    : unreadCount > 0
      ? 'text-accent'
      : 'text-foreground/40 hover:text-foreground/70'

  // Calculate position for the fixed notification panel — centered above the bell
  const [panelPos, setPanelPos] = useState<{ bottom: number; left: number } | null>(null)

  const updatePanelPos = useCallback(() => {
    if (!bellRef.current) return
    const rect = bellRef.current.getBoundingClientRect()
    const bellCenterX = rect.left + rect.width / 2
    const panelWidth = window.innerWidth < 640 ? 340 : 380
    let left = bellCenterX - panelWidth / 2
    // Keep panel within viewport bounds
    left = Math.max(8, Math.min(left, window.innerWidth - panelWidth - 8))
    setPanelPos({
      bottom: window.innerHeight - rect.top + 12,
      left,
    })
  }, [])

  useEffect(() => {
    if (!open) return
    updatePanelPos()
    window.addEventListener('resize', updatePanelPos)
    return () => window.removeEventListener('resize', updatePanelPos)
  }, [open, updatePanelPos])

  return (
    <div className="relative">
      <Tip content={`${unreadCount} ungelesene Benachrichtigungen`}>
        <motion.button
          ref={bellRef}
          onClick={() => setOpen(!open)}
          className={`min-w-[44px] min-h-[44px] px-3 py-2.5 sm:py-2 rounded-full transition-all duration-300 focus-ring flex items-center justify-center ${bellColor}`}
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.92 }}
          transition={{ type: 'spring', stiffness: 500, damping: 25 }}
        >
        <div className="relative">
          {hasEmergency ? (
            <motion.div
              animate={{ rotate: [-8, 8, -8] }}
              transition={{ duration: 0.4, repeat: Infinity, ease: 'easeInOut' }}
            >
              <Bell size={19} weight="fill" />
            </motion.div>
          ) : (
            <Bell size={19} weight={unreadCount > 0 ? 'fill' : 'regular'} />
          )}
          {unreadCount > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-[9px] font-bold text-white flex items-center justify-center leading-none"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </motion.span>
          )}
        </div>
      </motion.button>
      </Tip>

      {/* Portal to document.body so backdrop-filter works (not nested under navbar's backdrop-filter) */}
      {createPortal(
        <AnimatePresence>
          {open && panelPos && (
            <motion.div
              ref={panelRef}
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 400, damping: 28 }}
              className="fixed w-[340px] sm:w-[380px] max-h-[70vh] rounded-2xl border border-white/15 overflow-hidden z-[80]"
              style={{
                bottom: panelPos.bottom,
                left: panelPos.left,
                backdropFilter: 'blur(40px) saturate(1.5)',
                WebkitBackdropFilter: 'blur(40px) saturate(1.5)',
                background: 'oklch(from var(--card) l c h / 0.65)',
                boxShadow: '0 16px 50px oklch(0 0 0 / 0.3), 0 0 0 1px oklch(from var(--foreground) l c h / 0.08)',
              }}
            >
              <NotificationPanel
                notifications={notifications}
                onClose={() => setOpen(false)}
              />
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  )
}

// ── Notification Panel (dropdown content) ───────────────────────────

function NotificationPanel({
  notifications,
  onClose,
}: {
  notifications: Notification[]
  onClose: () => void
}) {
  const { markAsRead, dismissNotification, clearAll } = useNotifications()

  const sorted = [...notifications].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )

  const unread = sorted.filter(n => !n.read)

  return (
    <div className="flex flex-col max-h-[70vh]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-foreground/8">
        <div className="flex items-center gap-2">
          <Bell size={16} weight="fill" className="text-accent" />
          <span className="text-sm font-medium text-foreground">Benachrichtigungen</span>
          {unread.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-accent/15 text-accent text-[10px] font-bold">
              {unread.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {sorted.length > 0 && (
            <Tip content="Alle löschen">
              <button
                onClick={clearAll}
                className="p-1.5 rounded-lg text-foreground/40 hover:text-foreground/70 hover:bg-foreground/5 transition-colors"
              >
                <Trash size={14} />
              </button>
            </Tip>
          )}
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-foreground/40 hover:text-foreground/70 hover:bg-foreground/5 transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Notification list */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        {sorted.length === 0 ? (
          <div className="py-12 text-center">
            <Bell size={32} className="mx-auto text-foreground/15 mb-3" />
            <p className="text-xs text-foreground/40">Keine Benachrichtigungen</p>
          </div>
        ) : (
          <div className="py-1">
            {sorted.map(notif => (
              <NotificationItem
                key={notif.id}
                notification={notif}
                onRead={() => markAsRead(notif.id)}
                onDismiss={() => dismissNotification(notif.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Single Notification Item ────────────────────────────────────────

const levelConfig = {
  info: { color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20', icon: Info },
  warning: { color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20', icon: Warning },
  critical: { color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20', icon: ShieldWarning },
  emergency: { color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20', icon: Siren },
}

function NotificationItem({
  notification,
  onRead,
  onDismiss,
}: {
  notification: Notification
  onRead: () => void
  onDismiss: () => void
}) {
  const config = levelConfig[notification.level] || levelConfig.info
  const IconComp = config.icon
  const timeAgo = getTimeAgo(notification.created_at)

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 10 }}
      className={`group relative mx-2 my-1 px-3 py-2.5 rounded-xl border transition-colors ${
        notification.read
          ? 'border-transparent bg-foreground/2'
          : `${config.border} ${config.bg}`
      }`}
    >
      <div className="flex gap-2.5">
        <div className={`mt-0.5 flex-shrink-0 ${config.color}`}>
          <IconComp size={16} weight="fill" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className={`text-xs font-medium leading-tight ${notification.read ? 'text-foreground/60' : 'text-foreground'}`}>
              {notification.title}
            </p>
            <span className="text-[10px] text-foreground/30 flex-shrink-0 mt-0.5">{timeAgo}</span>
          </div>
          {notification.message && (
            <p className="text-[11px] text-foreground/50 mt-0.5 leading-snug line-clamp-2">
              {notification.message}
            </p>
          )}
          {notification.source && notification.source !== 'system' && (
            <span className="inline-block mt-1 text-[9px] px-1.5 py-0.5 rounded bg-foreground/5 text-foreground/40">
              {notification.source}
            </span>
          )}
        </div>
      </div>

      {/* Quick actions on hover */}
      <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5">
        {!notification.read && (
          <Tip content="Als gelesen markieren">
            <button
              onClick={onRead}
              className="p-1 rounded bg-foreground/5 hover:bg-foreground/10 text-foreground/50 hover:text-accent transition-colors"
            >
              <Check size={12} />
            </button>
          </Tip>
        )}
        <Tip content="Entfernen">
          <button
            onClick={onDismiss}
            className="p-1 rounded bg-foreground/5 hover:bg-foreground/10 text-foreground/50 hover:text-red-400 transition-colors"
          >
            <X size={12} />
          </button>
        </Tip>
      </div>
    </motion.div>
  )
}

// ── Emergency Navbar Bar ─────────────────────────────────────────────

export function EmergencyNavbarBar() {
  const { emergencyAlert, dismissEmergencyAlert } = useNotifications()
  const [showDetail, setShowDetail] = useState(false)

  if (!emergencyAlert) return null

  const isCritical = emergencyAlert.level === 'critical' || emergencyAlert.level === 'emergency'

  const barColors = {
    warning: 'from-amber-600/95 to-amber-700/95 border-amber-400/40',
    critical: 'from-orange-600/95 to-red-700/95 border-orange-400/40',
    emergency: 'from-red-700/95 to-red-900/95 border-red-400/50',
  }
  const barColor = barColors[emergencyAlert.level] || barColors.warning

  return (
    <>
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 28 }}
      className={`fixed top-0 left-0 right-0 z-[70] bg-gradient-to-r ${barColor} border-b backdrop-blur-xl`}
    >
      <div className="max-w-[1500px] mx-auto px-3 sm:px-4 md:px-6 lg:px-8 py-2 flex items-center gap-3">
        {isCritical ? (
          <motion.div
            animate={{ scale: [1, 1.2, 1] }}
            transition={{ duration: 1, repeat: Infinity }}
          >
            <Siren size={20} weight="fill" className="text-white flex-shrink-0" />
          </motion.div>
        ) : (
          <Warning size={20} weight="fill" className="text-white flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white truncate">{emergencyAlert.title}</p>
          {emergencyAlert.message && (
            <p className="text-xs text-white/70 truncate">{emergencyAlert.message}</p>
          )}
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <Tip content="Details">
            <button
              onClick={() => setShowDetail(true)}
              className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            >
              <Info size={16} />
            </button>
          </Tip>
          <Tip content="Schließen">
            <button
              onClick={dismissEmergencyAlert}
              className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X size={16} />
            </button>
          </Tip>
        </div>
      </div>
    </motion.div>
    <WarningDetailModal
      open={showDetail}
      onClose={() => setShowDetail(false)}
      warning={emergencyAlert ? {
        title: emergencyAlert.title,
        message: emergencyAlert.message,
        level: emergencyAlert.level,
        source: emergencyAlert.source,
        timestamp: emergencyAlert.created_at,
      } : null}
    />
    </>
  )
}

// ── Full-Screen Emergency Overlay ───────────────────────────────────

export function EmergencyOverlay() {
  const { emergencyAlert, dismissEmergencyAlert } = useNotifications()

  // Only show full-screen overlay for actual emergencies
  if (!emergencyAlert || emergencyAlert.level !== 'emergency') return null

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="fixed inset-0 z-[300] flex items-center justify-center"
    >
      {/* Pulsing red background */}
      <motion.div
        className="absolute inset-0 bg-red-950/90 backdrop-blur-2xl"
        animate={{ opacity: [0.85, 0.95, 0.85] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Content */}
      <div className="relative z-10 text-center max-w-lg px-6 space-y-8">
        {/* Animated siren */}
        <motion.div
          animate={{
            scale: [1, 1.15, 1],
            rotate: [-5, 5, -5],
          }}
          transition={{ duration: 0.8, repeat: Infinity, ease: 'easeInOut' }}
          className="mx-auto w-24 h-24 rounded-full bg-red-500/25 flex items-center justify-center border-2 border-red-400/40"
        >
          <Siren size={52} weight="fill" className="text-red-300" />
        </motion.div>

        {/* Alert text */}
        <div className="space-y-3">
          <motion.h1
            animate={{ opacity: [0.8, 1, 0.8] }}
            transition={{ duration: 1.5, repeat: Infinity }}
            className="text-2xl sm:text-3xl font-bold text-white tracking-wide"
          >
            {emergencyAlert.title}
          </motion.h1>
          {emergencyAlert.message && (
            <p className="text-base text-red-200/80 leading-relaxed">
              {emergencyAlert.message}
            </p>
          )}
        </div>

        {/* Source & time */}
        <div className="text-xs text-red-300/40 space-y-1">
          {emergencyAlert.source && (
            <p>Quelle: {emergencyAlert.source}</p>
          )}
          <p>{new Date(emergencyAlert.created_at).toLocaleString('de-DE')}</p>
        </div>

        {/* Dismiss button */}
        <button
          onClick={dismissEmergencyAlert}
          className="px-6 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white/80 hover:text-white text-sm font-medium transition-all border border-white/10"
        >
          Meldung schließen
        </button>
      </div>
    </motion.div>
  )
}

// ── Warning Entity Detection ─────────────────────────────────────────

/**
 * Patterns that identify warning entities from popular HA integrations.
 * Specifically targets weather/civil-protection warning systems.
 * Does NOT match generic safety sensors (smoke, CO, door sensors).
 */
const WARNING_ENTITY_PATTERNS = [
  'binary_sensor.dwd_weather_warnings_',
  'sensor.dwd_weather_warnings_',
  'binary_sensor.dwd_',
  'sensor.dwd_',
  'binary_sensor.nina_',
  'sensor.nina_',
  'binary_sensor.meteoalarm',
  'sensor.meteoalarm',
  'binary_sensor.nws_alerts',
  'sensor.nws_alerts',
  'binary_sensor.met_office_weather_warnings',
  'binary_sensor.env_canada_',
]

/** Specific weather/civil-protection keywords (not generic "alarm") */
const WARNING_KEYWORDS = [
  'weather_warning', 'unwetterwarnung', 'sturmwarnung',
  'hochwasser_warnung', 'severe_weather', 'weather_alert',
  'civil_protection', 'katastrophen', 'warnung_', '_warnung',
]

function isWarningEntity(entityId: string, attributes?: Record<string, unknown>): boolean {
  const eid = entityId.toLowerCase()

  // Known integration prefixes
  for (const pat of WARNING_ENTITY_PATTERNS) {
    if (eid.startsWith(pat)) return true
  }

  // Specific weather/civil protection keywords
  for (const kw of WARNING_KEYWORDS) {
    if (eid.includes(kw)) return true
  }

  // NINA can be identified by sender attribute
  if (attributes) {
    const sender = (attributes.sender as string || '').toLowerCase()
    if (sender.includes('dwd') || sender.includes('bbk') || sender.includes('lhp') || sender.includes('mowas')) {
      return true
    }
  }

  return false
}

function isWarningActive(entity: EntityState): boolean {
  if (entity.state === 'on' || entity.state === 'On') return true
  const num = Number(entity.state)
  return !isNaN(num) && num > 0
}

export interface ActiveWarning {
  entity_id: string
  level: 'info' | 'warning' | 'critical' | 'emergency'
  title: string
  message: string
  source: string
  lastChanged: string
}

function extractWarning(entity: EntityState): ActiveWarning {
  const attrs = entity.attributes as Record<string, unknown>
  const friendlyName = (attrs.friendly_name as string) || entity.entity_id

  const headline = (attrs.headline as string)
    || (attrs.warning_1_headline as string)
    || (attrs.warning_1_name as string)
    || (attrs.title as string)
    || (attrs.event as string)
    || ''

  const description = (attrs.description as string)
    || (attrs.warning_1_description as string)
    || (attrs.instruction as string)
    || (attrs.message as string)
    || ''

  const severityStr = (
    (attrs.severity as string)
    || (attrs.warning_1_level as string)
    || (attrs.warning_level as string)
    || (attrs.level as string)
    || (attrs.urgency as string)
    || ''
  ).toLowerCase()

  const severityNum = typeof attrs.warning_1_level === 'number'
    ? attrs.warning_1_level
    : typeof attrs.warning_level === 'number'
      ? attrs.warning_level
      : typeof attrs.severity === 'number'
        ? attrs.severity
        : null

  let level: ActiveWarning['level'] = 'warning' // Default for active warnings
  if (severityStr.includes('extreme') || severityStr.includes('extraordinary') || severityNum === 4) {
    level = 'emergency'
  } else if (severityStr.includes('severe') || severityStr.includes('stark') || severityNum === 3) {
    level = 'critical'
  } else if (severityStr.includes('moderate') || severityStr.includes('markant') || severityNum === 2) {
    level = 'warning'
  } else if (severityStr.includes('minor') || severityStr.includes('gering') || severityNum === 1) {
    level = 'info'
  }

  const warningCount = typeof attrs.warning_count === 'number' ? attrs.warning_count : null
  const sender = (attrs.sender as string) || ''

  const title = headline
    || (warningCount != null ? `${friendlyName} – ${warningCount} Warnung(en)` : friendlyName)

  let message = description.length > 400 ? description.slice(0, 400) + '…' : description
  if (sender && !message.includes(sender)) {
    message = message ? `${message} (${sender})` : `Quelle: ${sender}`
  }

  return {
    entity_id: entity.entity_id,
    level,
    title,
    message,
    source: sender,
    lastChanged: entity.last_changed,
  }
}

const levelPriority: Record<string, number> = { emergency: 4, critical: 3, warning: 2, info: 1 }

/** Hook for components that need active warnings (e.g., Screensaver) */
export function useActiveWarnings(): ActiveWarning[] {
  const { entities } = useEntityStore()
  return useMemo(() => {
    const warnings: ActiveWarning[] = []
    for (const entity of entities) {
      const attrs = entity.attributes as Record<string, unknown>
      if (isWarningEntity(entity.entity_id, attrs) && isWarningActive(entity)) {
        warnings.push(extractWarning(entity))
      }
    }
    warnings.sort((a, b) => (levelPriority[b.level] || 0) - (levelPriority[a.level] || 0))
    return warnings
  }, [entities])
}

// ── Persistent Warning Bar ───────────────────────────────────────────

const DISMISSED_KEY = 'ha-dismissed-warnings'

function loadDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY)
    if (raw) return new Set(JSON.parse(raw) as string[])
  } catch { /* ignore */ }
  return new Set()
}

function saveDismissed(set: Set<string>) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...set]))
  } catch { /* ignore */ }
}

/** NINA warnings received via WebSocket (not in entity store) */
interface NinaWsWarning {
  entity_id: string
  level: 'info' | 'warning' | 'critical' | 'emergency'
  title: string
  message: string
  source: string
  timestamp: string
  isTest?: boolean
}

const warningBarStyles = {
  info: {
    bg: 'bg-gradient-to-r from-sky-600/95 via-blue-600/95 to-sky-700/95',
    border: 'border-sky-400/30',
    glow: 'shadow-[0_2px_20px_rgba(56,189,248,0.15)]',
    icon: CloudWarning,
    iconColor: 'text-sky-100',
    badge: 'bg-sky-400/20 text-sky-100',
  },
  warning: {
    bg: 'bg-gradient-to-r from-amber-500/95 via-orange-500/95 to-amber-600/95',
    border: 'border-amber-300/40',
    glow: 'shadow-[0_2px_24px_rgba(245,158,11,0.25)]',
    icon: Warning,
    iconColor: 'text-amber-50',
    badge: 'bg-amber-400/20 text-amber-100',
  },
  critical: {
    bg: 'bg-gradient-to-r from-orange-600/95 via-red-600/95 to-rose-700/95',
    border: 'border-red-400/40',
    glow: 'shadow-[0_4px_30px_rgba(239,68,68,0.3)]',
    icon: ShieldWarning,
    iconColor: 'text-red-50',
    badge: 'bg-red-400/20 text-red-100',
  },
  emergency: {
    bg: 'bg-gradient-to-r from-red-700/95 via-red-800/95 to-rose-900/95',
    border: 'border-red-400/50',
    glow: 'shadow-[0_4px_40px_rgba(220,38,38,0.4)]',
    icon: Siren,
    iconColor: 'text-red-50',
    badge: 'bg-red-500/30 text-red-100',
  },
}

export function WarningBar() {
  const { entities } = useEntityStore()
  const [dismissed, setDismissed] = useState<Set<string>>(loadDismissed)
  const [expanded, setExpanded] = useState(false)
  const [ninaWarnings, setNinaWarnings] = useState<NinaWsWarning[]>([])
  const [emergencyDismissed, setEmergencyDismissed] = useState(false)
  const [detailWarning, setDetailWarning] = useState<ActiveWarning | null>(null)
  // Listen for NINA warning_entity_update WebSocket events
  useEffect(() => {
    const unsub = wsOnMessage((data: unknown) => {
      const msg = data as Record<string, unknown>
      if (msg.type !== 'warning_entity_update') return
      const entityId = msg.entity_id as string
      const active = msg.active as boolean

      if (active) {
        const w: NinaWsWarning = {
          entity_id: entityId,
          level: (msg.level || 'warning') as NinaWsWarning['level'],
          title: (msg.title as string) || 'Warnung',
          message: (msg.message as string) || '',
          source: (msg.source as string) || 'NINA',
          timestamp: (msg.timestamp as string) || new Date().toISOString(),
          isTest: (msg.source as string) === 'NINA-TEST',
        }
        if (w.level === 'emergency') setEmergencyDismissed(false)
        setNinaWarnings(prev => {
          const idx = prev.findIndex(x => x.entity_id === entityId)
          if (idx >= 0) {
            const copy = [...prev]
            copy[idx] = w
            return copy
          }
          return [...prev, w]
        })
      } else {
        // Warning cleared — remove from NINA list AND from dismissed set
        setNinaWarnings(prev => prev.filter(x => x.entity_id !== entityId))
        setDismissed(prev => {
          if (!prev.has(entityId)) return prev
          const next = new Set(prev)
          next.delete(entityId)
          saveDismissed(next)
          return next
        })
      }
    })
    return unsub
  }, [])

  // Build ALL active warnings (regardless of dismissed state)
  const allActiveWarnings = useMemo(() => {
    const warnings: ActiveWarning[] = []
    // HA entity warnings
    for (const entity of entities) {
      const attrs = entity.attributes as Record<string, unknown>
      if (isWarningEntity(entity.entity_id, attrs) && isWarningActive(entity)) {
        warnings.push(extractWarning(entity))
      }
    }
    // NINA WebSocket warnings (avoid duplicates with HA entities)
    const haIds = new Set(warnings.map(w => w.entity_id))
    for (const nw of ninaWarnings) {
      if (!haIds.has(nw.entity_id)) {
        warnings.push({
          entity_id: nw.entity_id,
          level: nw.level,
          title: nw.isTest ? `⚠ TESTWARNUNG: ${nw.title}` : nw.title,
          message: nw.message,
          source: nw.source,
          lastChanged: nw.timestamp,
        })
      }
    }
    warnings.sort((a, b) => (levelPriority[b.level] || 0) - (levelPriority[a.level] || 0))
    return warnings
  }, [entities, ninaWarnings])

  // Split into visible (not dismissed) and dismissed-but-active
  const visibleWarnings = useMemo(
    () => allActiveWarnings.filter(w => !dismissed.has(w.entity_id)),
    [allActiveWarnings, dismissed]
  )
  const dismissedActiveCount = allActiveWarnings.length - visibleWarnings.length

  const dismissWarning = useCallback((entityId: string) => {
    setDismissed(prev => {
      const next = new Set(prev).add(entityId)
      saveDismissed(next)
      return next
    })
  }, [])

  const restoreAll = useCallback(() => {
    setDismissed(new Set())
    saveDismissed(new Set())
  }, [])

  // Cleanup dismissed entries for warnings that are no longer active
  useEffect(() => {
    const activeIds = new Set(allActiveWarnings.map(w => w.entity_id))
    setDismissed(prev => {
      let changed = false
      const next = new Set<string>()
      for (const id of prev) {
        if (activeIds.has(id)) {
          next.add(id)
        } else {
          changed = true
        }
      }
      if (changed) {
        saveDismissed(next)
        return next
      }
      return prev
    })
  }, [allActiveWarnings])

  if (allActiveWarnings.length === 0) return null

  const topWarning = visibleWarnings[0]
  const hasMultiple = visibleWarnings.length > 1
  const allDismissed = visibleWarnings.length === 0

  // When all dismissed, show a small restore indicator
  if (allDismissed) {
    const highestDismissed = allActiveWarnings[0]
    const restoreStyle = warningBarStyles[highestDismissed.level] || warningBarStyles.warning
    const RestoreIcon = restoreStyle.icon

    return (
      <Tip content={`${dismissedActiveCount} aktive Warnung(en) — klicken zum Anzeigen`}>
        <motion.button
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          onClick={restoreAll}
          className={`fixed top-3 right-3 z-[65] w-10 h-10 rounded-full bg-gradient-to-br ${restoreStyle.bg} ${restoreStyle.border} border shadow-lg flex items-center justify-center cursor-pointer`}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
        >
        <RestoreIcon size={18} weight="fill" className={restoreStyle.iconColor} />
        {dismissedActiveCount > 1 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-white/20 text-[9px] font-bold text-white flex items-center justify-center">
            {dismissedActiveCount}
          </span>
        )}
      </motion.button>
      </Tip>
    )
  }

  const style = warningBarStyles[topWarning.level] || warningBarStyles.warning
  const TopIcon = style.icon
  const isSevere = topWarning.level === 'critical' || topWarning.level === 'emergency'

  return (
    <div className="fixed top-0 left-0 right-0 z-[65]">
      {/* Main warning bar */}
      <motion.div
        initial={{ y: -60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: -60, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 350, damping: 30 }}
        className={`${style.bg} border-b ${style.border} backdrop-blur-xl ${style.glow}`}
      >
        {/* Animated danger stripe for critical/emergency */}
        {isSevere && (
          <motion.div
            className="absolute inset-0 pointer-events-none overflow-hidden"
            style={{ opacity: 0.06 }}
          >
            <motion.div
              className="absolute inset-0"
              style={{
                backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 10px, white 10px, white 12px)',
                backgroundSize: '200% 100%',
              }}
              animate={{ backgroundPosition: ['0% 0%', '100% 0%'] }}
              transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
            />
          </motion.div>
        )}

        <div className="relative max-w-[1500px] mx-auto px-4 sm:px-5 md:px-6 lg:px-8 py-2.5 flex items-center gap-3">
          {/* Icon with animation for severe warnings */}
          <div className="flex-shrink-0">
            {isSevere ? (
              <motion.div
                animate={{
                  scale: [1, 1.15, 1],
                  rotate: topWarning.level === 'emergency' ? [-5, 5, -5] : [0, 0, 0],
                }}
                transition={{ duration: topWarning.level === 'emergency' ? 0.6 : 1.2, repeat: Infinity, ease: 'easeInOut' }}
                className={`w-9 h-9 rounded-xl ${style.badge} flex items-center justify-center`}
              >
                <TopIcon size={20} weight="fill" className={style.iconColor} />
              </motion.div>
            ) : (
              <div className={`w-9 h-9 rounded-xl ${style.badge} flex items-center justify-center`}>
                <TopIcon size={20} weight="fill" className={style.iconColor} />
              </div>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-white truncate">{topWarning.title}</p>
              {hasMultiple && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${style.badge} flex-shrink-0`}>
                  +{visibleWarnings.length - 1}
                </span>
              )}
            </div>
            {topWarning.message && !expanded && (
              <p className="text-xs text-white/70 truncate mt-0.5">{topWarning.message}</p>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {hasMultiple && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-all text-xs font-medium"
              >
                Alle anzeigen
                {expanded ? <CaretUp size={12} weight="bold" /> : <CaretDown size={12} weight="bold" />}
              </button>
            )}
            <Tip content="Details">
              <button
                onClick={() => setDetailWarning(topWarning)}
                className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-all"
              >
                <Info size={16} />
              </button>
            </Tip>
            <Tip content="Ausblenden">
              <button
                onClick={() => dismissWarning(topWarning.entity_id)}
                className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-all"
              >
                <X size={16} />
              </button>
            </Tip>
          </div>
        </div>
      </motion.div>

      {/* Expanded warning list */}
      <AnimatePresence>
        {expanded && hasMultiple && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 350, damping: 30 }}
            className="bg-black/80 backdrop-blur-2xl border-b border-foreground/10 overflow-hidden"
          >
            <div className="max-w-[1500px] mx-auto px-4 sm:px-5 md:px-6 lg:px-8 py-2">
              {visibleWarnings.slice(1).map(w => {
                const wStyle = warningBarStyles[w.level] || warningBarStyles.warning
                const WIcon = wStyle.icon
                return (
                  <motion.div
                    key={w.entity_id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-center gap-3 py-2.5 border-b border-white/5 last:border-b-0"
                  >
                    <div className={`w-7 h-7 rounded-lg ${wStyle.badge} flex items-center justify-center flex-shrink-0`}>
                      <WIcon size={14} weight="fill" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-white truncate">{w.title}</p>
                      {w.message && (
                        <p className="text-[11px] text-white/50 truncate mt-0.5">{w.message}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-0.5 flex-shrink-0">
                      <button
                        onClick={() => setDetailWarning(w)}
                        className="p-1 rounded-lg text-white/30 hover:text-white/60 hover:bg-white/5 transition-all"
                        title="Details"
                      >
                        <Info size={14} />
                      </button>
                      <button
                        onClick={() => dismissWarning(w.entity_id)}
                        className="p-1 rounded-lg text-white/30 hover:text-white/60 hover:bg-white/5 transition-all"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </motion.div>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Full-screen emergency banner for highest severity */}
      <AnimatePresence>
        {topWarning.level === 'emergency' && !emergencyDismissed && (
          <NinaEmergencyBanner warning={topWarning} onDismiss={() => {
            setEmergencyDismissed(true)
          }} />
        )}
      </AnimatePresence>

      {/* Warning Detail Modal */}
      <WarningDetailModal
        open={!!detailWarning}
        onClose={() => setDetailWarning(null)}
        warning={detailWarning ? {
          title: detailWarning.title,
          message: detailWarning.message,
          level: detailWarning.level,
          source: detailWarning.source,
          entity_id: detailWarning.entity_id,
          timestamp: detailWarning.lastChanged,
        } : null}
      />
    </div>
  )
}

// ── NINA Emergency Full-Screen Banner ────────────────────────────────

function NinaEmergencyBanner({ warning, onDismiss }: { warning: ActiveWarning; onDismiss: () => void }) {
  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="fixed inset-0 z-[300] flex items-center justify-center"
    >
      {/* Pulsing dark red background */}
      <motion.div
        className="absolute inset-0 bg-red-950/95 backdrop-blur-2xl"
        animate={{ opacity: [0.9, 1, 0.9] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Animated danger stripes */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ opacity: 0.04 }}>
        <motion.div
          className="absolute inset-0"
          style={{
            backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 20px, white 20px, white 22px)',
            backgroundSize: '200% 100%',
          }}
          animate={{ backgroundPosition: ['0% 0%', '100% 0%'] }}
          transition={{ duration: 15, repeat: Infinity, ease: 'linear' }}
        />
      </div>

      {/* Content */}
      <div className="relative z-10 text-center max-w-lg px-6 space-y-8">
        {/* Animated siren */}
        <motion.div
          animate={{ scale: [1, 1.15, 1], rotate: [-5, 5, -5] }}
          transition={{ duration: 0.8, repeat: Infinity, ease: 'easeInOut' }}
          className="mx-auto w-24 h-24 rounded-full bg-red-500/25 flex items-center justify-center border-2 border-red-400/40"
        >
          <Siren size={52} weight="fill" className="text-red-300" />
        </motion.div>

        {/* Alert label */}
        {warning.source === 'NINA-TEST' && (
          <motion.div
            animate={{ opacity: [0.7, 1, 0.7] }}
            transition={{ duration: 1, repeat: Infinity }}
            className="inline-block px-4 py-1.5 rounded-full bg-yellow-500/20 border border-yellow-400/30"
          >
            <p className="text-sm font-bold text-yellow-300 tracking-wider">⚠ TESTWARNUNG</p>
          </motion.div>
        )}

        {/* Alert text */}
        <div className="space-y-3">
          <motion.h1
            animate={{ opacity: [0.8, 1, 0.8] }}
            transition={{ duration: 1.5, repeat: Infinity }}
            className="text-2xl sm:text-3xl font-bold text-white tracking-wide"
          >
            {warning.title.replace(/^⚠ TESTWARNUNG: /, '')}
          </motion.h1>
          {warning.message && (
            <p className="text-base text-red-200/80 leading-relaxed">{warning.message}</p>
          )}
        </div>

        {/* Source & time */}
        <div className="text-xs text-red-300/40 space-y-1">
          {warning.source && <p>Quelle: {warning.source}</p>}
          <p>{new Date(warning.lastChanged).toLocaleString('de-DE')}</p>
        </div>

        {/* Dismiss */}
        <button
          onClick={onDismiss}
          className="px-6 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white/80 hover:text-white text-sm font-medium transition-all border border-white/10"
        >
          Meldung schließen
        </button>
      </div>
    </motion.div>,
    document.body
  )
}

// ── Shared Warning Level Hook (for header coloring) ──────────────────

/** Returns the highest active warning level across all sources (HA + NINA) */
export function useWarningLevel(): ActiveWarning['level'] | null {
  const { entities } = useEntityStore()
  const [ninaWarningLevels, setNinaWarningLevels] = useState<Map<string, ActiveWarning['level']>>(new Map())

  useEffect(() => {
    const unsub = wsOnMessage((data: unknown) => {
      const msg = data as Record<string, unknown>
      if (msg.type !== 'warning_entity_update') return
      const entityId = msg.entity_id as string
      if (msg.active) {
        const level = (msg.level || 'warning') as ActiveWarning['level']
        setNinaWarningLevels(prev => {
          const next = new Map(prev)
          next.set(entityId, level)
          return next
        })
      } else {
        setNinaWarningLevels(prev => {
          if (!prev.has(entityId)) return prev
          const next = new Map(prev)
          next.delete(entityId)
          return next
        })
      }
    })
    return unsub
  }, [])

  return useMemo(() => {
    // Compute highest NINA level from all tracked active warnings
    let ninaHighest: ActiveWarning['level'] | null = null
    for (const level of ninaWarningLevels.values()) {
      if (!ninaHighest || (levelPriority[level] || 0) > (levelPriority[ninaHighest] || 0)) {
        ninaHighest = level
      }
    }

    let highest: ActiveWarning['level'] | null = ninaHighest
    for (const entity of entities) {
      const attrs = entity.attributes as Record<string, unknown>
      if (isWarningEntity(entity.entity_id, attrs) && isWarningActive(entity)) {
        const w = extractWarning(entity)
        if (!highest || (levelPriority[w.level] || 0) > (levelPriority[highest] || 0)) {
          highest = w.level
        }
      }
    }
    return highest
  }, [entities, ninaWarningLevels])
}

// ── Warning Detail Modal ────────────────────────────────────────────

/** Shared props for warning details – works with both Notification and ActiveWarning */
export interface WarningDetail {
  title: string
  message: string
  level: 'info' | 'warning' | 'critical' | 'emergency'
  source: string
  entity_id?: string
  timestamp: string
}

const detailLevelConfig: Record<string, { color: string; bg: string; border: string; icon: typeof Warning; label: string }> = {
  info: { color: 'text-sky-400', bg: 'bg-sky-500/10', border: 'border-sky-500/20', icon: CloudWarning, label: 'Info' },
  warning: { color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20', icon: Warning, label: 'Warnung' },
  critical: { color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20', icon: ShieldWarning, label: 'Kritisch' },
  emergency: { color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20', icon: Siren, label: 'Notfall' },
}

export function WarningDetailModal({
  open,
  onClose,
  warning,
}: {
  open: boolean
  onClose: () => void
  warning: WarningDetail | null
}) {
  if (!warning) return null

  const config = detailLevelConfig[warning.level] || detailLevelConfig.info
  const LIcon = config.icon

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-lg ${config.bg} ${config.border} border flex items-center justify-center`}>
              <LIcon size={16} weight="fill" className={config.color} />
            </div>
            <DialogTitle className="text-base">Warnungsdetails</DialogTitle>
          </div>
          <DialogDescription>
            Detaillierte Informationen zur Warnung
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Level badge */}
          <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${config.bg} ${config.color} ${config.border} border`}>
            <LIcon size={12} weight="fill" />
            {config.label}
          </div>

          {/* Title */}
          <div>
            <p className="text-xs text-foreground/40 uppercase tracking-wider mb-1">Titel</p>
            <p className="text-sm font-semibold text-foreground">{warning.title}</p>
          </div>

          {/* Message */}
          {warning.message && (
            <div>
              <p className="text-xs text-foreground/40 uppercase tracking-wider mb-1">Beschreibung</p>
              <div className="max-h-[200px] overflow-y-auto">
                <p className="text-sm text-foreground/70 leading-relaxed whitespace-pre-wrap">{warning.message}</p>
              </div>
            </div>
          )}

          {/* Source */}
          {warning.source && (
            <div className="flex items-center gap-2 text-xs text-foreground/50">
              <IdentificationBadge size={14} />
              <span>Quelle: {warning.source}</span>
              {warning.entity_id && (
                <>
                  <span className="text-foreground/20">•</span>
                  <span className="font-mono text-[11px] text-foreground/30">{warning.entity_id}</span>
                </>
              )}
            </div>
          )}

          {/* Timestamp */}
          <div className="flex items-center gap-2 text-xs text-foreground/40">
            <Clock size={14} />
            <span>{new Date(warning.timestamp).toLocaleString('de-DE', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Utils ────────────────────────────────────────────────────────────

function getTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return 'Jetzt'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}
