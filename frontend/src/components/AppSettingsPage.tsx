import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  Gear, Database, HardDrives, Clock, LinkSimple,
  Broadcast, TrashSimple, Plus, Check,
  ArrowSquareOut, Cube, Warning, CaretDown, Info,
  UploadSimple, File, DownloadSimple, Code,
} from '@phosphor-icons/react'
import { toast } from 'sonner'
import { getBackendUrl } from '@/lib/config'
import { adminFetch, InlineSpinner, LoadingSpinner, AdminCard } from './AdminPanel'

// ── Types ──────────────────────────────────────────────────────────────

interface AppInfo {
  id: string
  name: string
  version: string
  developer: string
  description: string
  icon?: string
  trust_level: string
  permissions: string[]
  status: string
  enabled: boolean
  installed_at: string
  system?: boolean
  ports?: Array<{ internal: number; external: number; protocol: string }>
}

interface KvEntry {
  key: string
  value: string
}

interface StorageFile {
  id: string
  name: string
  size: number
  mime_type: string
  created_at: string
}

interface Schedule {
  id: string
  name: string
  cron: string
  enabled: boolean
  command?: string
  description?: string
}

interface WebhookDef {
  id: string
  name: string
  url: string
  event: string
  enabled: boolean
  secret?: string
}

interface MessageChannel {
  name: string
  pattern: string
  description?: string
}

interface AppConfigField {
  key: string
  label?: string
  type?: string
  description?: string
  default?: unknown
  required?: boolean
  options?: string[]
  min?: number
  max?: number
}

interface AppConfigSchema {
  title?: string
  description?: string
  fields?: AppConfigField[]
}

// ── Settings Sections ─────────────────────────────────────────────────

function SettingsSection({
  icon: Icon,
  title,
  description,
  children,
  accentIcon = false,
}: {
  icon: React.ElementType
  title: string
  description?: string
  children: React.ReactNode
  accentIcon?: boolean
}) {
  const [open, setOpen] = useState(true)
  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-foreground/[0.02] transition-colors"
      >
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
          accentIcon ? 'bg-accent/15' : 'bg-foreground/8'
        }`}>
          <Icon size={18} weight="fill" className={accentIcon ? 'text-accent' : 'text-foreground/60'} />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-foreground">{title}</h4>
          {description && <p className="text-xs text-foreground/50 mt-0.5">{description}</p>}
        </div>
        <CaretDown size={16} weight="bold" className={`text-foreground/40 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 space-y-3 border-t border-foreground/[0.06] pt-4">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// Main AppSettingsPage
// ═══════════════════════════════════════════════════════════════════════

export function AppSettingsPage() {
  const API_BASE = getBackendUrl()

  // Extract appId from URL: /app-settings/:appId
  const appId = window.location.pathname.replace(/^\/app-settings\//, '')
  const token = (() => {
    try {
      const raw = localStorage.getItem('ha-auth-token')
      return raw ? JSON.parse(raw) : ''
    } catch {
      return localStorage.getItem('ha-auth-token') || ''
    }
  })()

  const [app, setApp] = useState<AppInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<'settings' | 'storage' | 'database' | 'schedules' | 'webhooks' | 'messaging' | 'environment'>('settings')

  // Load app info
  useEffect(() => {
    if (!appId || !token) { setLoading(false); setError('Keine App-ID oder nicht authentifiziert'); return }
    ;(async () => {
      setLoading(true)
      try {
        // Try supervisor detail first
        const data = await adminFetch(`/api/apps/${appId}/detail`, token) as any
        setApp(data)
      } catch {
        try {
          // Fallback: fetch from installed list
          const data = await adminFetch('/api/appstore/installed', token) as { apps: AppInfo[] }
          const found = data.apps?.find(a => a.id === appId)
          if (found) setApp(found)
          else setError('App nicht gefunden')
        } catch (e) {
          setError((e as Error).message)
        }
      }
      setLoading(false)
    })()
  }, [appId, token])

  if (!appId) {
    return (
      <div className="max-w-3xl mx-auto p-8 text-center">
        <Warning size={48} className="mx-auto mb-4 text-foreground/20" />
        <h2 className="text-lg font-bold text-foreground mb-2">Keine App-ID</h2>
        <p className="text-sm text-foreground/50">Keine App-ID in der URL gefunden.</p>
      </div>
    )
  }

  if (loading) return <div className="max-w-3xl mx-auto p-8"><LoadingSpinner /></div>
  if (error) return <div className="max-w-3xl mx-auto p-8"><AdminCard><p className="text-sm text-red-400">{error}</p></AdminCard></div>
  if (!app) return <div className="max-w-3xl mx-auto p-8"><AdminCard><p className="text-sm text-foreground/50">App nicht gefunden</p></AdminCard></div>

  const hasPermission = (perm: string) => app.permissions?.some(p => p.includes(perm)) ?? false

  return (
    <div className="max-w-3xl mx-auto space-y-4 p-4 page-transition-enter">
      {/* Header */}
      <div className="glass-card rounded-2xl border border-foreground/[0.06] p-5">
        <div className="flex items-start gap-4">
          {app.icon ? (
            <img src={app.icon} alt="" className="w-12 h-12 rounded-xl flex-shrink-0" />
          ) : (
            <div className="w-12 h-12 rounded-xl bg-accent/20 flex items-center justify-center flex-shrink-0">
              <Cube size={26} className="text-accent" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-foreground">{app.name}</h1>
            <p className="text-xs text-foreground/40">{app.version} · {app.developer}</p>
            <p className="text-xs text-foreground/50 mt-1">{app.description}</p>
          </div>
          <a
            href={`/#/admin?tab=apps`}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-foreground/[0.04] border border-foreground/[0.08] text-xs text-foreground/60 hover:text-foreground transition-colors flex-shrink-0"
          >
            <ArrowSquareOut size={12} /> Admin
          </a>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex flex-wrap gap-2 p-1 rounded-xl bg-foreground/[0.04] border border-foreground/[0.06]">
        {([
          { id: 'settings' as const, icon: Gear, label: 'Einstellungen', has: true },
          { id: 'storage' as const, icon: HardDrives, label: 'Storage', has: hasPermission('AppStorage') },
          { id: 'database' as const, icon: Database, label: 'Datenbank', has: hasPermission('AppDatabase') },
          { id: 'schedules' as const, icon: Clock, label: 'Zeitpläne', has: hasPermission('AppSchedule') },
          { id: 'webhooks' as const, icon: LinkSimple, label: 'Webhooks', has: hasPermission('Webhook') },
          { id: 'messaging' as const, icon: Broadcast, label: 'Messaging', has: hasPermission('Messaging') },
          { id: 'environment' as const, icon: Code, label: 'Umgebung', has: true },
        ]).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            disabled={!tab.has}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
              activeTab === tab.id
                ? 'bg-accent/15 text-accent'
                : tab.has
                ? 'text-foreground/50 hover:text-foreground hover:bg-foreground/[0.04]'
                : 'text-foreground/20 cursor-not-allowed'
            }`}
          >
            <tab.icon size={14} weight={activeTab === tab.id ? 'fill' : 'regular'} />
            {tab.label}
            {!tab.has && <span className="text-[9px] opacity-50">—</span>}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        <motion.div key={activeTab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
          {activeTab === 'settings' && <AppConfigSettings appId={appId} token={token} />}
          {activeTab === 'storage' && <StorageSettings appId={appId} token={token} />}
          {activeTab === 'database' && <DatabaseSettings appId={appId} token={token} />}
          {activeTab === 'schedules' && <SchedulesSettings appId={appId} token={token} />}
          {activeTab === 'webhooks' && <WebhooksSettings appId={appId} token={token} />}
          {activeTab === 'messaging' && <MessagingSettings appId={appId} token={token} />}
          {activeTab === 'environment' && <EnvironmentSettings app={app} token={token} />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

// ── App Config Settings ───────────────────────────────────────────────

function AppConfigSettings({ appId, token }: { appId: string; token: string }) {
  const [schema, setSchema] = useState<AppConfigSchema | null>(null)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [jsonDrafts, setJsonDrafts] = useState<Record<string, string>>({})
  const [jsonErrors, setJsonErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [resettingKey, setResettingKey] = useState<string | null>(null)

  const loadConfig = useCallback(async () => {
    const [schemaData, valueData] = await Promise.all([
      adminFetch(`/api/apps/${appId}/config/schema`, token) as Promise<AppConfigSchema>,
      adminFetch(`/api/apps/${appId}/config`, token) as Promise<Record<string, unknown>>,
    ])
    setSchema(schemaData)
    setValues(valueData || {})

    const drafts: Record<string, string> = {}
    for (const field of schemaData?.fields || []) {
      const fieldType = (field.type || 'string').toLowerCase()
      if (fieldType === 'json') {
        const raw = valueData?.[field.key] ?? field.default ?? {}
        drafts[field.key] = JSON.stringify(raw, null, 2)
      }
    }
    setJsonDrafts(drafts)
    setJsonErrors({})
  }, [appId, token])

  useEffect(() => {
    setLoading(true)
    loadConfig()
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false))
  }, [loadConfig])

  const setFieldValue = (key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  const updateJsonDraft = (key: string, text: string) => {
    setJsonDrafts((prev) => ({ ...prev, [key]: text }))
    try {
      const parsed = text.trim() ? JSON.parse(text) : {}
      setFieldValue(key, parsed)
      setJsonErrors((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
    } catch (e) {
      setJsonErrors((prev) => ({ ...prev, [key]: (e as Error).message }))
    }
  }

  const saveConfig = async () => {
    const parseErrors = Object.keys(jsonErrors)
    if (parseErrors.length > 0) {
      toast.error(`JSON-Fehler in ${parseErrors.length} Feld(ern). Bitte korrigieren.`)
      return
    }
    setSaving(true)
    try {
      await adminFetch(`/api/apps/${appId}/config`, token, {
        method: 'PUT',
        body: JSON.stringify(values),
      })
      toast.success('App-Einstellungen gespeichert')
      await loadConfig()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const resetKey = async (key: string) => {
    setResettingKey(key)
    try {
      await adminFetch(`/api/apps/${appId}/config/${encodeURIComponent(key)}`, token, { method: 'DELETE' })
      toast.success(`Feld '${key}' zurückgesetzt`)
      await loadConfig()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setResettingKey(null)
    }
  }

  if (loading) return <LoadingSpinner />

  const fields = schema?.fields || []
  if (fields.length === 0) {
    return (
      <div className="glass-card rounded-2xl border border-foreground/[0.06] p-4">
        <div className="flex items-center gap-2 mb-2">
          <Gear size={16} className="text-accent" />
          <span className="text-xs font-semibold text-foreground">App-Einstellungen</span>
        </div>
        <p className="text-xs text-foreground/50">Diese App hat kein settings_schema und daher keine konfigurierbaren Felder.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="glass-card rounded-2xl border border-foreground/[0.06] p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <div className="flex items-center gap-2">
              <Gear size={16} className="text-accent" />
              <span className="text-xs font-semibold text-foreground">{schema?.title || 'App-Einstellungen'}</span>
            </div>
            {schema?.description && <p className="text-[11px] text-foreground/45 mt-1">{schema.description}</p>}
          </div>
          <button
            onClick={saveConfig}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/15 text-accent text-xs font-semibold hover:bg-accent/25 transition-colors disabled:opacity-50"
          >
            {saving ? <InlineSpinner size={12} /> : <Check size={12} weight="bold" />} Speichern
          </button>
        </div>

        <div className="space-y-3">
          {fields.map((field) => {
            const fieldType = (field.type || 'string').toLowerCase()
            const fieldValue = values[field.key] ?? field.default

            return (
              <div key={field.key} className="p-3 rounded-xl bg-foreground/[0.02] border border-foreground/[0.06]">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-foreground/75">
                      {field.label || field.key}
                      {field.required && <span className="text-red-400 ml-1">*</span>}
                    </div>
                    <div className="text-[10px] text-foreground/40 font-mono">{field.key}</div>
                    {field.description && <p className="text-[11px] text-foreground/45 mt-1">{field.description}</p>}
                  </div>
                  <button
                    onClick={() => resetKey(field.key)}
                    disabled={resettingKey === field.key}
                    className="flex items-center gap-1 px-2 py-1 rounded bg-foreground/[0.04] text-foreground/50 text-[10px] hover:bg-foreground/[0.08] transition-colors disabled:opacity-50"
                  >
                    {resettingKey === field.key ? <InlineSpinner size={10} /> : <TrashSimple size={10} />} Reset
                  </button>
                </div>

                {fieldType === 'bool' || fieldType === 'boolean' ? (
                  <label className="inline-flex items-center gap-2 text-xs text-foreground/70">
                    <input
                      type="checkbox"
                      checked={Boolean(fieldValue)}
                      onChange={(e) => setFieldValue(field.key, e.target.checked)}
                    />
                    Aktiv
                  </label>
                ) : fieldType === 'enum' && Array.isArray(field.options) ? (
                  <select
                    value={String(fieldValue ?? '')}
                    onChange={(e) => setFieldValue(field.key, e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg bg-foreground/[0.03] border border-foreground/[0.08] text-xs text-foreground"
                  >
                    {field.options.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                ) : fieldType === 'integer' || fieldType === 'float' || fieldType === 'number' ? (
                  <input
                    type="number"
                    min={field.min}
                    max={field.max}
                    step={fieldType === 'integer' ? 1 : 'any'}
                    value={Number(fieldValue ?? 0)}
                    onChange={(e) => {
                      const n = e.target.value === '' ? null : Number(e.target.value)
                      setFieldValue(field.key, n)
                    }}
                    className="w-full px-2.5 py-2 rounded-lg bg-foreground/[0.03] border border-foreground/[0.08] text-xs text-foreground"
                  />
                ) : fieldType === 'json' ? (
                  <div className="space-y-1">
                    <textarea
                      value={jsonDrafts[field.key] ?? JSON.stringify(fieldValue ?? {}, null, 2)}
                      onChange={(e) => updateJsonDraft(field.key, e.target.value)}
                      rows={6}
                      className="w-full px-2.5 py-2 rounded-lg bg-foreground/[0.03] border border-foreground/[0.08] text-xs text-foreground font-mono"
                    />
                    {jsonErrors[field.key] && (
                      <p className="text-[10px] text-red-400">JSON ungültig: {jsonErrors[field.key]}</p>
                    )}
                  </div>
                ) : (
                  <input
                    type={fieldType === 'secret' ? 'password' : 'text'}
                    value={String(fieldValue ?? '')}
                    onChange={(e) => setFieldValue(field.key, e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg bg-foreground/[0.03] border border-foreground/[0.08] text-xs text-foreground"
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Storage Settings ──────────────────────────────────────────────────

function StorageSettings({ appId, token }: { appId: string; token: string }) {
  const [files, setFiles] = useState<StorageFile[]>([])
  const [kvList, setKvList] = useState<KvEntry[]>([])
  const [subTab, setSubTab] = useState<'files' | 'kv'>('files')
  const [loading, setLoading] = useState(true)

  const loadFiles = useCallback(async () => {
    try {
      const data = await adminFetch(`/api/apps/${appId}/storage/files`, token) as { files: StorageFile[] }
      setFiles(data.files || [])
    } catch { /* empty */ }
  }, [appId, token])

  const loadKv = useCallback(async () => {
    try {
      const data = await adminFetch(`/api/apps/${appId}/storage/kv`, token) as { entries: KvEntry[] }
      setKvList(data.entries || [])
    } catch { /* empty */ }
  }, [appId, token])

  useEffect(() => {
    setLoading(true)
    Promise.all([loadFiles(), loadKv()]).finally(() => setLoading(false))
  }, [loadFiles, loadKv])

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1 p-1 rounded-xl bg-foreground/[0.04]">
        <button onClick={() => setSubTab('files')} className={`flex-1 py-2 rounded-lg text-xs font-medium ${subTab === 'files' ? 'bg-accent/15 text-accent' : 'text-foreground/50'}`}>
          Dateien ({files.length})
        </button>
        <button onClick={() => setSubTab('kv')} className={`flex-1 py-2 rounded-lg text-xs font-medium ${subTab === 'kv' ? 'bg-accent/15 text-accent' : 'text-foreground/50'}`}>
          Key-Value ({kvList.length})
        </button>
      </div>

      {loading ? <LoadingSpinner /> : (
        <>
          {subTab === 'files' && (
            <div className="glass-card rounded-2xl border border-foreground/[0.06] p-4">
              {files.length === 0 ? (
                <div className="text-center py-8">
                  <File size={32} className="mx-auto mb-2 text-foreground/20" />
                  <p className="text-xs text-foreground/50">Keine Dateien gespeichert</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {files.map(f => (
                    <div key={f.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-foreground/[0.03] transition-colors">
                      <File size={16} className="text-foreground/30 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-foreground/70 truncate">{f.name}</p>
                        <p className="text-[10px] text-foreground/30">{formatSize(f.size)} · {new Date(f.created_at).toLocaleDateString('de-DE')}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {subTab === 'kv' && (
            <div className="glass-card rounded-2xl border border-foreground/[0.06] p-4">
              {kvList.length === 0 ? (
                <div className="text-center py-8">
                  <Database size={32} className="mx-auto mb-2 text-foreground/20" />
                  <p className="text-xs text-foreground/50">Keine KV-Einträge</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {kvList.map((kv, i) => (
                    <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-foreground/[0.02] border border-foreground/[0.05]">
                      <code className="text-xs font-mono text-accent flex-shrink-0">{kv.key}</code>
                      <code className="text-xs text-foreground/50 truncate flex-1">{kv.value}</code>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Database Settings ─────────────────────────────────────────────────

function DatabaseSettings({ appId, token }: { appId: string; token: string }) {
  const [tables, setTables] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      try {
        const data = await adminFetch(`/api/apps/${appId}/database/tables`, token) as { tables: string[] }
        setTables(data.tables || [])
      } catch { /* empty */ }
      setLoading(false)
    })()
  }, [appId, token])

  if (loading) return <LoadingSpinner />

  return (
    <div className="glass-card rounded-2xl border border-foreground/[0.06] p-4">
      <div className="flex items-center gap-2 mb-3">
        <Database size={16} className="text-accent" />
        <span className="text-xs font-semibold text-foreground">SQLite Datenbank</span>
      </div>
      {tables.length === 0 ? (
        <p className="text-xs text-foreground/50 text-center py-6">Keine Tabellen vorhanden</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {tables.map(table => (
            <div key={table} className="px-3 py-2 rounded-xl bg-foreground/[0.03] border border-foreground/[0.05] text-xs font-mono text-foreground/60 text-center">
              {table}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Schedules Settings ────────────────────────────────────────────────

function SchedulesSettings({ appId, token }: { appId: string; token: string }) {
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      try {
        const data = await adminFetch(`/api/apps/${appId}/schedules`, token) as { schedules: Schedule[] }
        setSchedules(data.schedules || [])
      } catch { /* empty */ }
      setLoading(false)
    })()
  }, [appId, token])

  if (loading) return <LoadingSpinner />

  return (
    <div className="glass-card rounded-2xl border border-foreground/[0.06] p-4">
      <div className="flex items-center gap-2 mb-3">
        <Clock size={16} className="text-accent" />
        <span className="text-xs font-semibold text-foreground">Geplante Aufgaben ({schedules.length})</span>
      </div>
      {schedules.length === 0 ? (
        <p className="text-xs text-foreground/50 text-center py-6">Keine Zeitpläne konfiguriert</p>
      ) : (
        <div className="space-y-2">
          {schedules.map(s => (
            <div key={s.id} className="p-3 rounded-xl bg-foreground/[0.03] border border-foreground/[0.05]">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-foreground/70">{s.name}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${s.enabled ? 'bg-green-500/15 text-green-400' : 'bg-foreground/10 text-foreground/40'}`}>
                  {s.enabled ? 'Aktiv' : 'Inaktiv'}
                </span>
              </div>
              <code className="text-[10px] font-mono text-foreground/40">{s.cron}</code>
              {s.description && <p className="text-[10px] text-foreground/40 mt-1">{s.description}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Webhooks Settings ─────────────────────────────────────────────────

function WebhooksSettings({ appId, token }: { appId: string; token: string }) {
  const [webhooks, setWebhooks] = useState<WebhookDef[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      try {
        const data = await adminFetch(`/api/apps/${appId}/webhooks`, token) as { webhooks: WebhookDef[] }
        setWebhooks(data.webhooks || [])
      } catch { /* empty */ }
      setLoading(false)
    })()
  }, [appId, token])

  if (loading) return <LoadingSpinner />

  return (
    <div className="glass-card rounded-2xl border border-foreground/[0.06] p-4">
      <div className="flex items-center gap-2 mb-3">
        <LinkSimple size={16} className="text-accent" />
        <span className="text-xs font-semibold text-foreground">Webhooks ({webhooks.length})</span>
      </div>
      {webhooks.length === 0 ? (
        <p className="text-xs text-foreground/50 text-center py-6">Keine Webhooks konfiguriert</p>
      ) : (
        <div className="space-y-2">
          {webhooks.map(w => (
            <div key={w.id} className="p-3 rounded-xl bg-foreground/[0.03] border border-foreground/[0.05]">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-foreground/70">{w.name}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${w.enabled ? 'bg-green-500/15 text-green-400' : 'bg-foreground/10 text-foreground/40'}`}>
                  {w.enabled ? 'Aktiv' : 'Inaktiv'}
                </span>
              </div>
              <code className="text-[10px] font-mono text-foreground/40 block truncate">{w.url}</code>
              <span className="text-[10px] text-foreground/30">Event: {w.event}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Messaging Settings ────────────────────────────────────────────────

function MessagingSettings({ appId, token }: { appId: string; token: string }) {
  const [channels, setChannels] = useState<MessageChannel[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      try {
        const data = await adminFetch(`/api/apps/${appId}/messaging/channels`, token) as { channels: MessageChannel[] }
        setChannels(data.channels || [])
      } catch { /* empty */ }
      setLoading(false)
    })()
  }, [appId, token])

  if (loading) return <LoadingSpinner />

  return (
    <div className="glass-card rounded-2xl border border-foreground/[0.06] p-4">
      <div className="flex items-center gap-2 mb-3">
        <Broadcast size={16} className="text-accent" />
        <span className="text-xs font-semibold text-foreground">Message Channels ({channels.length})</span>
      </div>
      {channels.length === 0 ? (
        <p className="text-xs text-foreground/50 text-center py-6">Keine Channels konfiguriert</p>
      ) : (
        <div className="space-y-2">
          {channels.map((ch, i) => (
            <div key={i} className="p-3 rounded-xl bg-foreground/[0.03] border border-foreground/[0.05]">
              <span className="text-xs font-medium text-foreground/70">{ch.name}</span>
              <code className="text-[10px] font-mono text-foreground/40 block mt-1">{ch.pattern}</code>
              {ch.description && <p className="text-[10px] text-foreground/40 mt-1">{ch.description}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Environment Settings ──────────────────────────────────────────────

function EnvironmentSettings({ app, token }: { app: AppInfo; token: string }) {
  const API_BASE = getBackendUrl()

  return (
    <div className="space-y-4">
      <div className="glass-card rounded-2xl border border-foreground/[0.06] p-4">
        <div className="flex items-center gap-2 mb-3">
          <Info size={16} className="text-accent" />
          <span className="text-xs font-semibold text-foreground">App-Informationen</span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <span className="text-foreground/40">App-ID:</span>
            <code className="ml-2 text-foreground/60 font-mono">{app.id}</code>
          </div>
          <div>
            <span className="text-foreground/40">Version:</span>
            <span className="ml-2 text-foreground/60">{app.version}</span>
          </div>
          <div>
            <span className="text-foreground/40">Entwickler:</span>
            <span className="ml-2 text-foreground/60">{app.developer}</span>
          </div>
          <div>
            <span className="text-foreground/40">Vertrauen:</span>
            <span className="ml-2 text-foreground/60">{app.trust_level}</span>
          </div>
          <div>
            <span className="text-foreground/40">Status:</span>
            <span className={`ml-2 ${app.status === 'running' ? 'text-green-400' : 'text-foreground/40'}`}>{app.status}</span>
          </div>
          <div>
            <span className="text-foreground/40">System:</span>
            <span className="ml-2 text-foreground/60">{app.system ? 'Ja' : 'Nein'}</span>
          </div>
        </div>
      </div>

      {/* Ports */}
      {(app.ports?.length ?? 0) > 0 && (
        <div className="glass-card rounded-2xl border border-foreground/[0.06] p-4">
          <div className="flex items-center gap-2 mb-3">
            <Broadcast size={16} className="text-accent" />
            <span className="text-xs font-semibold text-foreground">Ports</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {app.ports!.map((p, i) => (
              <span key={i} className="text-[10px] px-2 py-1 rounded bg-foreground/[0.04] border border-foreground/[0.08] text-foreground/60 font-mono">
                {p.internal}:{p.protocol} → {p.external}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Permissions */}
      <div className="glass-card rounded-2xl border border-foreground/[0.06] p-4">
        <div className="flex items-center gap-2 mb-3">
          <Info size={16} className="text-accent" />
          <span className="text-xs font-semibold text-foreground">Berechtigungen</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(app.permissions || []).map((perm, i) => (
            <span key={i} className="text-[10px] px-2 py-1 rounded bg-accent/10 border border-accent/20 text-accent font-mono">
              {perm}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
