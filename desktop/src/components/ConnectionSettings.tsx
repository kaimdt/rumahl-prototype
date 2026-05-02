import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { getApiBase, setApiBase } from '@/lib/apiBase'
import { tauriApi } from '@/lib/tauri'
import { Globe, CheckCircle, XCircle, ArrowClockwise, FloppyDisk, WifiHigh, WifiSlash, House } from '@phosphor-icons/react'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'

type TestState = 'idle' | 'testing' | 'success' | 'error'

const STORAGE_KEY_HOST = 'iora-connector-host'
const STORAGE_KEY_PRIVATE_PORT = 'iora-connector-private-port'
const STORAGE_KEY_PUBLIC_PROXY_PORT = 'iora-connector-public-port'
const STORAGE_KEY_USE_TLS = 'iora-connector-use-tls'

const inputClass = "w-full px-3 py-2.5 rounded-xl bg-foreground/[0.04] border border-foreground/10 text-sm text-foreground focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all"

export function ConnectionSettings() {
  const [host, setHost] = useState('')
  const [privatePort, setPrivatePort] = useState(3001)
  const [publicProxyPort, setPublicProxyPort] = useState(443)
  const [useTls, setUseTls] = useState(true)
  const [testState, setTestState] = useState<TestState>('idle')
  const [testError, setTestError] = useState<string | null>(null)
  const [testInfo, setTestInfo] = useState<{ ha: boolean; entities: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    try {
      const apiBase = getApiBase()
      if (apiBase) {
        const url = new URL(apiBase)
        setHost(url.hostname)
        setPrivatePort(Number(url.port) || (url.protocol === 'https:' ? 443 : 80))
        setUseTls(url.protocol === 'https:')
      }
    } catch {
      // ignore invalid stored URL
    }

    const storedHost = localStorage.getItem(STORAGE_KEY_HOST)
    const storedPrivatePort = localStorage.getItem(STORAGE_KEY_PRIVATE_PORT)
    const storedPublicPort = localStorage.getItem(STORAGE_KEY_PUBLIC_PROXY_PORT)
    const storedTls = localStorage.getItem(STORAGE_KEY_USE_TLS)

    if (storedHost) setHost(storedHost)
    if (storedPrivatePort) setPrivatePort(Number(storedPrivatePort) || 3001)
    if (storedPublicPort) setPublicProxyPort(Number(storedPublicPort) || 443)
    if (storedTls !== null) setUseTls(storedTls === 'true')
  }, [])

  const normalizedHost = host.trim()
  const normalizedUrl = `${useTls ? 'https' : 'http'}://${normalizedHost}${privatePort ? `:${privatePort}` : ''}`

  const testConnection = useCallback(async () => {
    if (!normalizedHost) {
      toast.error('Bitte eine IP-Adresse oder Host eingeben')
      return
    }

    setTestState('testing')
    setTestError(null)
    setTestInfo(null)

    try {
      const res = await fetch(`${normalizedUrl}/health`, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setTestInfo({
        ha: data.ha_connected ?? false,
        entities: data.entity_count ?? 0,
      })
      setTestState('success')
    } catch (err) {
      setTestError(err instanceof Error ? err.message : 'Verbindung fehlgeschlagen')
      setTestState('error')
    }
  }, [normalizedHost, normalizedUrl])

  const saveUrl = useCallback(async () => {
    if (!normalizedHost) {
      toast.error('Host muss angegeben sein')
      return
    }

    setSaving(true)
    try {
      setApiBase(normalizedUrl)
      localStorage.setItem(STORAGE_KEY_HOST, normalizedHost)
      localStorage.setItem(STORAGE_KEY_PRIVATE_PORT, String(privatePort))
      localStorage.setItem(STORAGE_KEY_PUBLIC_PROXY_PORT, String(publicProxyPort))
      localStorage.setItem(STORAGE_KEY_USE_TLS, String(useTls))

      try {
        const config = await tauriApi.getConfig()
        await tauriApi.saveConfig({ ...config, iora_home_url: normalizedUrl })
      } catch {
        // Nicht in Tauri-Kontetxt – lokale Speicherung reicht
      }

      setSaved(true)
      toast.success('IORA Cloud Connector gespeichert')
      setTimeout(() => setSaved(false), 2000)
    } catch {
      toast.error('Fehler beim Speichern der Einstellungen')
    } finally {
      setSaving(false)
    }
  }, [normalizedHost, normalizedUrl, privatePort, publicProxyPort, useTls])

  const isChanged = normalizedUrl !== getApiBase()

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-2xl bg-accent/15 flex items-center justify-center">
            <Globe size={20} weight="duotone" className="text-accent" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground/90">IORA Cloud Connector</h2>
            <p className="text-xs text-foreground/50">Trage hier die IP und Ports deines IORA Connectors ein. Das ist die zentrale Konfiguration für Cloud- und VPN-Zugriff.</p>
          </div>
        </div>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <label className="text-[11px] font-semibold text-foreground/40 uppercase tracking-[0.15em]">Connector IP / Host</label>
            <input
              type="text"
              className={inputClass}
              placeholder="10.0.0.2"
              value={host}
              onChange={(e) => { setHost(e.target.value); setTestState('idle') }}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-2">
              <label className="text-[11px] font-semibold text-foreground/40 uppercase tracking-[0.15em]">Privater API-Port</label>
              <input
                type="number"
                min={1}
                max={65535}
                className={inputClass}
                value={privatePort}
                onChange={(e) => setPrivatePort(Number(e.target.value) || 3001)}
              />
            </div>
            <div className="grid gap-2">
              <label className="text-[11px] font-semibold text-foreground/40 uppercase tracking-[0.15em]">Öffentlicher Proxy-Port</label>
              <input
                type="number"
                min={1}
                max={65535}
                className={inputClass}
                value={publicProxyPort}
                onChange={(e) => setPublicProxyPort(Number(e.target.value) || 443)}
              />
            </div>
            <div className="grid gap-2">
              <label className="text-[11px] font-semibold text-foreground/40 uppercase tracking-[0.15em]">Verschlüsselung</label>
              <label className="flex items-center gap-3 rounded-xl border border-foreground/10 bg-white/5 px-3 py-3 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={useTls}
                  onChange={(e) => setUseTls(e.target.checked)}
                  className="h-4 w-4 rounded border-white/10 bg-background text-accent focus:ring-accent"
                />
                TLS aktiviert
              </label>
            </div>
          </div>

          <div className="rounded-3xl border border-foreground/10 bg-foreground/5 p-4 text-sm text-foreground/70">
            <p className="font-semibold text-foreground">Wichtig</p>
            <p className="mt-2">Der Connector hört auf alle IP-Adressen, die ihm zugewiesen sind. Der private API-Port sollte nur über VPN/Tailscale erreichbar sein, der öffentliche Proxy-Port nur verschlüsselte Verbindungen zulassen.</p>
            <p className="mt-2">Diese Seite ist die zentrale Stelle, um den IORA Cloud Connector einzurichten und anzupassen.</p>
          </div>

          <div className="grid gap-2">
            <label className="text-[11px] font-semibold text-foreground/40 uppercase tracking-[0.15em]">Berechnete Connector-URL</label>
            <div className="rounded-3xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-foreground">{normalizedUrl}</div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-foreground/50">
              Aktuelle konfigurierte URL: <span className="font-medium text-foreground">{getApiBase() || 'Keine Verbindung konfiguriert'}</span>
            </div>
            <button
              type="button"
              onClick={saveUrl}
              disabled={!normalizedHost || saving || (!isChanged && !saved)}
              className="inline-flex items-center justify-center rounded-3xl bg-accent px-4 py-3 text-sm font-semibold text-white transition hover:bg-accent/95 disabled:opacity-50"
            >
              {saving ? 'Speichert…' : saved ? 'Gespeichert' : 'Speichern & Verbinden'}
            </button>
          </div>

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={testConnection}
            disabled={!normalizedHost || testState === 'testing'}
            className="inline-flex items-center justify-center rounded-3xl bg-white/5 px-4 py-3 text-sm font-semibold text-foreground transition hover:bg-white/10 disabled:opacity-50"
          >
            {testState === 'testing' ? (
              <ArrowClockwise size={16} className="animate-spin" />
            ) : (
              'Verbindung testen'
            )}
          </motion.button>

          <AnimatePresence mode="wait">
            {testState === 'success' && (
              <motion.div
                key="success"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="flex items-start gap-3 p-4 rounded-xl bg-green-500/10 border border-green-500/20"
              >
                <CheckCircle size={20} weight="fill" className="text-green-500 shrink-0 mt-0.5" />
                <div className="space-y-1 text-sm">
                  <p className="font-medium text-green-400">Verbindung erfolgreich</p>
                  <div className="flex items-center gap-4 text-xs text-foreground/60">
                    <span className="flex items-center gap-1.5">
                      <House size={14} />
                      Home Assistant: {testInfo?.ha ? 'Verbunden' : 'Nicht verbunden'}
                    </span>
                    <span>{testInfo?.entities ?? 0} Entitäten</span>
                  </div>
                </div>
              </motion.div>
            )}
            {testState === 'error' && (
              <motion.div
                key="error"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20"
              >
                <XCircle size={20} weight="fill" className="text-red-500 shrink-0 mt-0.5" />
                <div className="space-y-1 text-sm">
                  <p className="font-medium text-red-400">Verbindung fehlgeschlagen</p>
                  <p className="text-xs text-foreground/50">{testError}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
