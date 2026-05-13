/**
 * Network Profiles Settings – manage per-network IORA Home URLs.
 *
 * Allows users to define different connection endpoints for
 * Ethernet (LAN), WiFi (WLAN), Mobile, and VPN networks.
 * Supports auto-switch detection and manual override.
 */
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { tauriApi } from '@/lib/tauri'
import { setApiBase } from '@/lib/apiBase'
import type { NetworkProfile, NetworkStatus, NetworkType, NetworkInfo } from '@/lib/tauri'
import {
  WifiHigh,
  WifiSlash,
  Globe,
  Lightning,
  DeviceMobile,
  ShieldCheck,
  Plus,
  Trash,
  ArrowClockwise,
  FloppyDisk,
  CheckCircle,
  XCircle,
  ArrowsClockwise,
  Question,
  PlugsConnected,
} from '@phosphor-icons/react'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'

// ─── Helpers ─────────────────────────────────────────────────────────────

const NETWORK_TYPE_OPTIONS: { value: NetworkType; label: string; icon: typeof WifiHigh }[] = [
  { value: 'ethernet', label: 'LAN (Ethernet)', icon: PlugsConnected },
  { value: 'wifi', label: 'WLAN (WiFi)', icon: WifiHigh },
  { value: 'mobile', label: 'Mobilfunk', icon: DeviceMobile },
  { value: 'vpn', label: 'VPN', icon: ShieldCheck },
  { value: 'unknown', label: 'Unbekannt', icon: Question },
]

const DETECTED_TYPE_ICON: Record<NetworkType, typeof WifiHigh> = {
  ethernet: PlugsConnected,
  wifi: WifiHigh,
  mobile: DeviceMobile,
  vpn: ShieldCheck,
  unknown: Question,
}

const inputClass =
  'w-full px-3 py-2.5 rounded-xl bg-foreground/[0.04] border border-foreground/10 text-sm text-foreground focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all'

const selectClass =
  'w-full px-3 py-2.5 rounded-xl bg-foreground/[0.04] border border-foreground/10 text-sm text-foreground focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all appearance-none'

// ─── Component ───────────────────────────────────────────────────────────

export function NetworkSettings() {
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus | null>(null)
  const [profiles, setProfiles] = useState<NetworkProfile[]>([])
  const [autoSwitch, setAutoSwitch] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  // ── Load state ──────────────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    try {
      setLoading(true)
      const [status, config, profilesList] = await Promise.all([
        tauriApi.getNetworkStatus().catch(() => null),
        tauriApi.getConfig().catch(() => null),
        tauriApi.getNetworkProfiles().catch(() => []),
      ])
      if (status) setNetworkStatus(status)
      if (config) {
        setAutoSwitch(config.network_auto_switch ?? false)
        setProfiles(profilesList.length > 0 ? profilesList : config.network_profiles ?? [])
      }
    } catch {
      // Not in Tauri context – show empty state
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // Listen for network profile changes from the backend auto-switch monitor
  useEffect(() => {
    const handler = () => {
      // Refresh network status when backend triggers a switch
      tauriApi.getNetworkStatus().then(setNetworkStatus).catch(() => {})
    }
    // We use a polling approach since Tauri events require window setup
    const interval = setInterval(handler, 15000)
    return () => clearInterval(interval)
  }, [])

  // ── Profile management ──────────────────────────────────────────────

  const [editingProfiles, setEditingProfiles] = useState<NetworkProfile[]>([])

  useEffect(() => {
    if (profiles.length > 0) {
      setEditingProfiles(profiles.map((p) => ({ ...p })))
    }
  }, [profiles])

  const addProfile = () => {
    setEditingProfiles((prev) => [
      ...prev,
      {
        name: '',
        network_type: 'wifi' as NetworkType,
        iora_home_url: '',
        iora_backend_url: undefined,
        priority: prev.length,
      },
    ])
  }

  const removeProfile = (index: number) => {
    setEditingProfiles((prev) => prev.filter((_, i) => i !== index))
  }

  const updateProfile = (index: number, patch: Partial<NetworkProfile>) => {
    setEditingProfiles((prev) =>
      prev.map((p, i) => (i === index ? { ...p, ...patch } : p))
    )
  }

  const saveProfiles = async () => {
    setSaving(true)
    try {
      const valid = editingProfiles.filter(
        (p) => p.name.trim() && p.iora_home_url.trim()
      )
      await tauriApi.saveNetworkProfiles(valid)
      setProfiles(valid)
      setSaved(true)
      toast.success('Netzwerk-Profile gespeichert')
      setTimeout(() => setSaved(false), 2000)
    } catch {
      toast.error('Fehler beim Speichern der Profile')
    } finally {
      setSaving(false)
    }
  }

  const toggleAutoSwitch = async (enabled: boolean) => {
    setAutoSwitch(enabled)
    try {
      await tauriApi.setNetworkAutoSwitch(enabled)
      toast.success(enabled ? 'Automatische Umschaltung aktiviert' : 'Automatische Umschaltung deaktiviert')
    } catch {
      toast.error('Fehler beim Ändern der Einstellung')
      setAutoSwitch(!enabled) // Revert
    }
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      const status = await tauriApi.getNetworkStatus()
      setNetworkStatus(status)
    } catch {
      toast.error('Netzwerk-Status konnte nicht aktualisiert werden')
    } finally {
      setRefreshing(false)
    }
  }

  const handleManualSwitch = async (profileIndex: number) => {
    try {
      await tauriApi.switchToProfile(profileIndex)
      // Update apiBase with the new URL
      const profile = profiles[profileIndex]
      if (profile) {
        setApiBase(profile.iora_home_url)
      }
      toast.success(`Zu Profil "${profiles[profileIndex]?.name}" gewechselt`)
      // Refresh status
      const status = await tauriApi.getNetworkStatus()
      setNetworkStatus(status)
    } catch {
      toast.error('Profil-Wechsel fehlgeschlagen')
    }
  }

  // ── Render ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-center text-sm text-foreground/50">
        Netzwerk-Informationen werden geladen…
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* ── Current Network Status ── */}
      <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            {networkStatus ? (
              (() => {
                const Icon = DETECTED_TYPE_ICON[networkStatus.active.network_type] ?? Question
                return <Icon size={20} weight="duotone" className="text-accent" />
              })()
            ) : (
              <Question size={20} className="text-foreground/40" />
            )}
            <div>
              <h3 className="text-sm font-semibold text-foreground">Aktuelles Netzwerk</h3>
              <p className="text-xs text-foreground/50">
                {networkStatus
                  ? `${networkStatus.active.interface_name} – ${networkTypeLabel(networkStatus.active.network_type)}`
                  : 'Keine Daten'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="rounded-2xl border border-white/10 bg-white/5 p-2 text-foreground/60 transition hover:bg-white/10 hover:text-foreground disabled:opacity-50"
          >
            <ArrowClockwise size={16} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>

        {networkStatus && (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <p className="text-[10px] uppercase tracking-wider text-foreground/40 mb-1">Lokale IP</p>
              <p className="text-sm font-mono text-foreground/80">
                {networkStatus.active.local_ip ?? '—'}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <p className="text-[10px] uppercase tracking-wider text-foreground/40 mb-1">Aktive URL</p>
              <p className="text-sm font-mono text-foreground/80 truncate">
                {networkStatus.current_home_url || '—'}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 md:col-span-2">
              <p className="text-[10px] uppercase tracking-wider text-foreground/40 mb-1">Erkannte Schnittstellen</p>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {networkStatus.interfaces.map((iface, i) => (
                  <span
                    key={i}
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${
                      iface.is_active
                        ? 'bg-accent/15 text-accent border border-accent/20'
                        : 'bg-foreground/[0.04] text-foreground/50 border border-foreground/10'
                    }`}
                  >
                    {iface.is_active && <CheckCircle size={10} weight="fill" />}
                    {iface.interface_name}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Auto-Switch Toggle ── */}
      <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Automatische Umschaltung</h3>
            <p className="text-xs text-foreground/50 mt-1">
              Wechselt automatisch die IORA Home URL, wenn sich das Netzwerk ändert
            </p>
          </div>
          <Switch checked={autoSwitch} onCheckedChange={toggleAutoSwitch} />
        </div>
      </div>

      {/* ── Network Profiles ── */}
      <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Netzwerk-Profile</h3>
            <p className="text-xs text-foreground/50 mt-1">
              Unterschiedliche Verbindungen für LAN, WLAN, Mobilfunk & VPN
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <AnimatePresence>
            {editingProfiles.map((profile, index) => {
              const Icon = NETWORK_TYPE_OPTIONS.find(
                (o) => o.value === profile.network_type
              )?.icon ?? Question
              const isMatched =
                networkStatus?.matched_profile !== null &&
                networkStatus?.matched_profile !== undefined &&
                networkStatus.matched_profile.name === profile.name

              return (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className={`rounded-2xl border p-4 transition ${
                    isMatched
                      ? 'border-accent/30 bg-accent/[0.05]'
                      : 'border-white/10 bg-white/[0.02]'
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                        isMatched ? 'bg-accent/15' : 'bg-foreground/[0.06]'
                      }`}>
                        <Icon size={16} weight="duotone" className={isMatched ? 'text-accent' : 'text-foreground/50'} />
                      </div>
                      <input
                        type="text"
                        value={profile.name}
                        onChange={(e) => updateProfile(index, { name: e.target.value })}
                        placeholder="Profil-Name (z.B. Heimnetz)"
                        className="bg-transparent border-none text-sm font-medium text-foreground placeholder:text-foreground/30 focus:outline-none w-40"
                      />
                      {isMatched && (
                        <span className="text-[10px] bg-accent/15 text-accent rounded-full px-2 py-0.5">
                          Aktiv
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {!isMatched && (
                        <button
                          type="button"
                          onClick={() => handleManualSwitch(index)}
                          className="rounded-xl p-1.5 text-foreground/40 hover:text-accent hover:bg-accent/10 transition"
                          title="Zu diesem Profil wechseln"
                        >
                          <ArrowsClockwise size={14} />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => removeProfile(index)}
                        className="rounded-xl p-1.5 text-foreground/40 hover:text-red-400 hover:bg-red-500/10 transition"
                        title="Profil entfernen"
                      >
                        <Trash size={14} />
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <label className="text-[10px] uppercase tracking-wider text-foreground/40 mb-1 block">
                        Netzwerk-Typ
                      </label>
                      <select
                        value={profile.network_type}
                        onChange={(e) =>
                          updateProfile(index, { network_type: e.target.value as NetworkType })
                        }
                        className={selectClass}
                      >
                        {NETWORK_TYPE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] uppercase tracking-wider text-foreground/40 mb-1 block">
                        Priorität
                      </label>
                      <input
                        type="number"
                        value={profile.priority}
                        onChange={(e) =>
                          updateProfile(index, { priority: Number(e.target.value) || 0 })
                        }
                        min={0}
                        max={99}
                        className={`${inputClass} w-24`}
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="text-[10px] uppercase tracking-wider text-foreground/40 mb-1 block">
                        IORA Home URL
                      </label>
                      <input
                        type="url"
                        value={profile.iora_home_url}
                        onChange={(e) =>
                          updateProfile(index, { iora_home_url: e.target.value })
                        }
                        placeholder="https://192.168.1.100:3001"
                        className={inputClass}
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="text-[10px] uppercase tracking-wider text-foreground/40 mb-1 block">
                        IORA Assist URL (optional)
                      </label>
                      <input
                        type="url"
                        value={profile.iora_backend_url ?? ''}
                        onChange={(e) =>
                          updateProfile(index, {
                            iora_backend_url: e.target.value || undefined,
                          })
                        }
                        placeholder="https://192.168.1.100:8092"
                        className={inputClass}
                      />
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>

          <button
            type="button"
            onClick={addProfile}
            className="inline-flex items-center gap-2 rounded-2xl border border-dashed border-foreground/20 bg-transparent px-4 py-3 text-sm text-foreground/50 transition hover:border-accent/40 hover:text-accent hover:bg-accent/[0.03]"
          >
            <Plus size={16} />
            Profil hinzufügen
          </button>

          {editingProfiles.length > 0 && (
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={saveProfiles}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-2xl bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-accent/20 transition hover:bg-accent/95 disabled:opacity-50"
              >
                {saving ? (
                  'Speichert…'
                ) : saved ? (
                  <>
                    <CheckCircle size={16} weight="fill" /> Gespeichert
                  </>
                ) : (
                  <>
                    <FloppyDisk size={16} /> Profile speichern
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Info Box ── */}
      <div className="rounded-3xl border border-foreground/10 bg-foreground/[0.02] p-4">
        <p className="text-xs text-foreground/50 leading-relaxed">
          <strong className="text-foreground/70">So funktioniert&apos;s:</strong> Die Desktop-App
          erkennt automatisch, ob du per LAN, WLAN oder Mobilfunk verbunden bist. Für jeden
          Netzwerk-Typ kannst du eine eigene IORA Home URL hinterlegen. Bei aktiver automatischer
          Umschaltung wechselt die App nahtlos zwischen z.B. deiner lokalen Heimnetz-IP und
          einer externen Domain für unterwegs.
        </p>
      </div>
    </div>
  )
}

// ─── Helper ─────────────────────────────────────────────────────────────

function networkTypeLabel(type: NetworkType): string {
  const opt = NETWORK_TYPE_OPTIONS.find((o) => o.value === type)
  return opt?.label ?? 'Unbekannt'
}
