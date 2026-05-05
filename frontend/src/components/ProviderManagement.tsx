// AI Provider Management – Visual interface for managing AI providers, API keys, models, and costs
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Robot, Key, Plus, Trash, Check, X, Eye, EyeSlash, Wrench, Circle,
  Database, Cpu, Wallet, ArrowUp, ArrowDown, Sparkle, Shield, Warning,
  ToggleRight, ToggleLeft, FloppyDisk, Gear, ChartLine, Info,
} from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { getAssistUrl, getBackendUrl } from '@/lib/config'

const assistBase = () => getAssistUrl() || getBackendUrl() || ''

// ─── Types ─────────────────────────────────────────────────────────────────

interface ProviderConfig {
  id: string; provider_type: string; display_name: string
  api_keys: ApiKeyEntry[]; base_url: string; models: ModelEntry[]
  enabled: boolean; usage_categories: string[]
  total_tokens_used: number; total_cost: number
  is_available: boolean; last_checked: string
}

interface ApiKeyEntry {
  id: string; label: string; key_preview: string // "sk-...xyz"
  is_active: boolean; created_at: string
}

interface ModelEntry {
  id: string; name: string; enabled: boolean
  max_tokens: number; cost_per_1k_input: number; cost_per_1k_output: number
  categories: string[] // ["chat", "code", "research"]
  tokens_used: number; cost_incurred: number
}

// ─── Icons & Colors ────────────────────────────────────────────────────────

const PROVIDER_ICONS: Record<string, string> = {
  openai: 'OAI', anthropic: 'ANT', local: 'LOC', desktop: 'DSK',
  pidev: 'PID', deepseek: 'DSK', grok: 'GRK', mistral: 'MIS',
  cohere: 'COH', together: 'TOG', fireworks: 'FWK', perplexity: 'PRP',
}

const CATEGORIES = ['chat', 'code', 'review', 'research', 'planning', 'testing', 'docs', 'admin']

const CATEGORY_LABELS: Record<string, string> = {
  chat: 'Chat', code: 'Code', review: 'Review', research: 'Research',
  planning: 'Planung', testing: 'Tests', docs: 'Docs', admin: 'Admin',
}

// ─── Component ─────────────────────────────────────────────────────────────

export function ProviderManagement() {
  const [providers, setProviders] = useState<ProviderConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null)
  const [showAddKey, setShowAddKey] = useState<string | null>(null)
  const [newKeyValue, setNewKeyValue] = useState('')
  const [newKeyLabel, setNewKeyLabel] = useState('')
  const [connectionStatus, setConnectionStatus] = useState<'checking' | 'connected' | 'unreachable'>('checking')
  const [error, setError] = useState<string | null>(null)

  // ─── Load providers ──────────────────────────────────────────────────
  useEffect(() => {
    loadProviders()
    // Non-blocking health check
    fetch(`${assistBase()}/api/assist/health`).then(r => {
      setConnectionStatus(r.ok ? 'connected' : 'unreachable')
    }).catch(() => setConnectionStatus('unreachable'))
  }, [])

  const loadProviders = async () => {
    setLoading(true)
    try {
      const r = await fetch(`${assistBase()}/api/assist/config/providers`)
      if (r.ok) {
        const data = await r.json()
        // Enrich with mock data if backend doesn't return full structure
        setProviders(data.map((p: any) => enrichProvider(p)))
      }
    } catch (e) {
      // Load demo data when backend is unreachable
      setProviders(getDemoProviders())
      if (connectionStatus === 'unreachable') {
        setError('iora-assist ist nicht erreichbar. Starte den Service mit: cargo run -p iora-assist')
      }
    }
    setLoading(false)
  }

  const enrichProvider = (p: any): ProviderConfig => ({
    id: p.id || p.provider_type || crypto.randomUUID(),
    provider_type: p.provider_type || 'unknown',
    display_name: p.display_name || p.provider_type || 'Unknown',
    api_keys: p.api_keys || [],
    base_url: p.base_url || '',
    models: (p.models || []).map((m: any) => enrichModel(m)),
    enabled: p.enabled !== false,
    usage_categories: p.usage_categories || ['chat'],
    total_tokens_used: p.total_tokens_used || 0,
    total_cost: p.total_cost || 0,
    is_available: p.is_available || false,
    last_checked: p.last_checked || new Date().toISOString(),
  })

  const enrichModel = (m: any): ModelEntry => ({
    id: m.id || m.name,
    name: m.name || m.id,
    enabled: m.enabled !== false,
    max_tokens: m.max_tokens || 4096,
    cost_per_1k_input: m.cost_per_1k_input || 0,
    cost_per_1k_output: m.cost_per_1k_output || 0,
    categories: m.categories || ['chat'],
    tokens_used: m.tokens_used || 0,
    cost_incurred: m.cost_incurred || 0,
  })

  // ─── Actions ─────────────────────────────────────────────────────────
  const toggleProvider = (id: string) => {
    setProviders(prev => prev.map(p => p.id === id ? { ...p, enabled: !p.enabled } : p))
  }

  const toggleModel = (providerId: string, modelId: string) => {
    setProviders(prev => prev.map(p => p.id === providerId ? {
      ...p, models: p.models.map(m => m.id === modelId ? { ...m, enabled: !m.enabled } : m)
    } : p))
  }

  const toggleCategory = (providerId: string, category: string) => {
    setProviders(prev => prev.map(p => p.id === providerId ? {
      ...p, usage_categories: p.usage_categories.includes(category)
        ? p.usage_categories.filter(c => c !== category)
        : [...p.usage_categories, category]
    } : p))
  }

  const toggleModelCategory = (providerId: string, modelId: string, category: string) => {
    setProviders(prev => prev.map(p => p.id === providerId ? {
      ...p, models: p.models.map(m => m.id === modelId ? {
        ...m, categories: m.categories.includes(category)
          ? m.categories.filter(c => c !== category)
          : [...m.categories, category]
      } : m)
    } : p))
  }

  const addApiKey = (providerId: string) => {
    if (!newKeyValue.trim()) return
    setProviders(prev => prev.map(p => p.id === providerId ? {
      ...p, api_keys: [...p.api_keys, {
        id: crypto.randomUUID(),
        label: newKeyLabel || `Key ${p.api_keys.length + 1}`,
        key_preview: newKeyValue.slice(0, 6) + '...' + newKeyValue.slice(-4),
        is_active: p.api_keys.length === 0,
        created_at: new Date().toISOString(),
      }]
    } : p))
    setNewKeyValue('')
    setNewKeyLabel('')
    setShowAddKey(null)
  }

  const removeApiKey = (providerId: string, keyId: string) => {
    setProviders(prev => prev.map(p => p.id === providerId ? {
      ...p, api_keys: p.api_keys.filter(k => k.id !== keyId)
    } : p))
  }

  const setActiveKey = (providerId: string, keyId: string) => {
    setProviders(prev => prev.map(p => p.id === providerId ? {
      ...p, api_keys: p.api_keys.map(k => ({ ...k, is_active: k.id === keyId }))
    } : p))
  }

  const saveConfig = async () => {
    try {
      await fetch(`${assistBase()}/api/assist/config/providers`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(providers),
      })
    } catch (e) { setError('Speichern fehlgeschlagen') }
  }

  const totalCost = providers.reduce((s, p) => s + p.total_cost, 0)
  const totalTokens = providers.reduce((s, p) => s + p.total_tokens_used, 0)

  // ─── Connection warning ──────────────────────────────────────────────
  if (connectionStatus === 'unreachable' && providers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mb-4">
          <Warning size={32} weight="fill" className="text-red-400" />
        </div>
        <h2 className="text-sm font-semibold text-foreground mb-2">iora-assist ist nicht erreichbar</h2>
        <p className="text-xs text-foreground/40 mb-4 max-w-md">
          Der AI-Service läuft nicht. Starte ihn mit:
        </p>
        <code className="px-4 py-2 rounded-xl bg-foreground/5 border border-foreground/10 text-xs text-foreground/60 font-mono mb-4">
          cd iora-os/backend && cargo run -p iora-assist
        </code>
        <button onClick={loadProviders} className="px-4 py-2 rounded-xl bg-accent/20 text-accent text-xs hover:bg-accent/30 transition-all">
          Erneut versuchen
        </button>
      </div>
    )
  }

  // ─── Render ──────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-foreground/8 shrink-0">
        <Robot size={18} weight="fill" className="text-accent" />
        <div>
          <h2 className="text-sm font-semibold text-foreground">AI Provider</h2>
          <p className="text-[10px] text-foreground/40">
            {providers.length} Provider · {providers.filter(p => p.enabled).length} aktiv · {providers.reduce((s, p) => s + p.models.filter(m => m.enabled).length, 0)} Modelle
          </p>
        </div>
        <div className="flex-1" />
        {connectionStatus === 'unreachable' && (
          <span className="text-[10px] text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full">Offline</span>
        )}
        {connectionStatus === 'connected' && (
          <span className="text-[10px] text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full">Verbunden</span>
        )}
      </div>

      {/* Cost overview bar */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-foreground/5 bg-foreground/[0.02] text-[10px] shrink-0">
        <span className="flex items-center gap-1 text-foreground/40"><Wallet size={12} /> Kosten</span>
        <span className="text-foreground/70 font-mono">${totalCost.toFixed(4)}</span>
        <span className="text-foreground/20">·</span>
        <span className="text-foreground/40">{totalTokens.toLocaleString()} Tokens</span>
        <div className="flex-1" />
        <button onClick={saveConfig} className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-accent/10 border border-accent/20 text-accent text-[10px] hover:bg-accent/20 transition-all">
          <FloppyDisk size={10} /> Speichern
        </button>
      </div>

      {/* Provider list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {/* Add Provider quick-actions */}
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-[9px] text-foreground/30 uppercase tracking-wider mr-1">Schnell hinzufügen:</span>
          {['OpenAI', 'Anthropic', 'DeepSeek', 'Mistral', 'Cohere', 'Perplexity', 'Groq'].map(name => {
            const exists = providers.some(p => p.provider_type === name.toLowerCase())
            return (
              <button key={name}
                onClick={() => {
                  if (exists) return
                  setProviders(prev => [...prev, {
                    id: name.toLowerCase(), provider_type: name.toLowerCase(), display_name: name,
                    enabled: false, api_keys: [], base_url: '', usage_categories: ['chat'],
                    total_tokens_used: 0, total_cost: 0, is_available: false,
                    last_checked: new Date().toISOString(),
                    models: [{ id: 'default', name: 'Default', enabled: true, max_tokens: 4096,
                      cost_per_1k_input: 0, cost_per_1k_output: 0, categories: ['chat'],
                      tokens_used: 0, cost_incurred: 0 }],
                  }])
                }}
                className={`px-2 py-0.5 rounded-full text-[9px] font-medium border transition-all ${
                  exists ? 'border-green-500/20 bg-green-500/5 text-green-400/60 cursor-default' :
                  'border-foreground/8 bg-foreground/[0.02] text-foreground/30 hover:border-accent/30 hover:text-accent hover:bg-accent/5'
                }`}
              >
                {exists ? `${name} (+)` : `+ ${name}`}
              </button>
            )
          })}
        </div>

        <AnimatePresence mode="popLayout">
          {providers.map(provider => {
            const isExpanded = expandedProvider === provider.id
            const icon = PROVIDER_ICONS[provider.provider_type] || provider.provider_type.slice(0, 3).toUpperCase()
            const activeKey = provider.api_keys.find(k => k.is_active)

            return (
              <motion.div key={provider.id} layout
                initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                className={`rounded-2xl border transition-all ${
                  provider.enabled
                    ? 'border-foreground/10 bg-card/60'
                    : 'border-foreground/5 bg-foreground/[0.02] opacity-60'
                }`}
              >
                {/* Provider header */}
                <div className="flex items-center gap-3 p-4 cursor-pointer" onClick={() => setExpandedProvider(isExpanded ? null : provider.id)}>
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-foreground/[0.08] to-foreground/[0.04] flex items-center justify-center text-lg">
                    {icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-medium text-foreground">{provider.display_name}</h3>
                      {provider.is_available && <div className="w-1.5 h-1.5 rounded-full bg-green-400" title="Verfügbar" />}
                    </div>
                    <p className="text-[10px] text-foreground/30">
                      {provider.models.filter(m => m.enabled).length}/{provider.models.length} Modelle · {provider.api_keys.length} Keys · ${provider.total_cost.toFixed(4)}
                    </p>
                  </div>
                  <button onClick={e => { e.stopPropagation(); toggleProvider(provider.id) }} className="shrink-0">
                    {provider.enabled ? <ToggleRight size={22} weight="fill" className="text-green-400" /> : <ToggleLeft size={22} className="text-foreground/15" />}
                  </button>
                </div>

                {/* Expanded content */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                      <div className="px-4 pb-4 space-y-4 border-t border-foreground/5 pt-3">

                        {/* API Keys */}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-[10px] font-medium text-foreground/40 uppercase tracking-wider flex items-center gap-1"><Key size={10} /> API Keys</p>
                            <button onClick={() => setShowAddKey(showAddKey === provider.id ? null : provider.id)}
                              className="text-[10px] text-accent hover:text-accent/80 flex items-center gap-0.5"
                            ><Plus size={10} /> Key</button>
                          </div>

                          <AnimatePresence>
                            {showAddKey === provider.id && (
                              <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mb-2 p-2 rounded-xl bg-accent/[0.04] border border-accent/20 space-y-1.5">
                                <input type="text" placeholder="Key Label (z.B. Production)"
                                  value={newKeyLabel} onChange={e => setNewKeyLabel(e.target.value)}
                                  className="w-full px-2.5 py-1.5 rounded-lg bg-foreground/5 border border-foreground/10 text-[11px] text-foreground placeholder-foreground/25 focus:outline-none focus:border-accent/40"
                                />
                                <div className="flex gap-1.5">
                                  <input type="password" placeholder="sk-..."
                                    value={newKeyValue} onChange={e => setNewKeyValue(e.target.value)}
                                    className="flex-1 px-2.5 py-1.5 rounded-lg bg-foreground/5 border border-foreground/10 text-[11px] text-foreground placeholder-foreground/25 focus:outline-none focus:border-accent/40"
                                  />
                                  <button onClick={() => addApiKey(provider.id)} disabled={!newKeyValue.trim()}
                                    className="px-3 py-1.5 rounded-lg bg-accent/20 text-accent text-[10px] hover:bg-accent/30 disabled:opacity-30"
                                  >Hinzufügen</button>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>

                          <div className="space-y-1">
                            {provider.api_keys.length === 0 ? (
                              <p className="text-[10px] text-foreground/20 italic">Keine API Keys konfiguriert</p>
                            ) : (
                              provider.api_keys.map(key => (
                                <div key={key.id} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border transition-all ${
                                  key.is_active ? 'border-accent/30 bg-accent/[0.06]' : 'border-foreground/5 bg-foreground/[0.02]'
                                }`}>
                                  <button onClick={() => setActiveKey(provider.id, key.id)} className="shrink-0">
                                    {key.is_active ? <Check size={14} weight="bold" className="text-accent" /> : <Circle size={14} className="text-foreground/15" />}
                                  </button>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[11px] text-foreground/70 truncate">{key.label}</p>
                                    <p className="text-[9px] text-foreground/30 font-mono">{key.key_preview}</p>
                                  </div>
                                  <button onClick={() => removeApiKey(provider.id, key.id)} className="text-foreground/15 hover:text-red-400">
                                    <Trash size={12} />
                                  </button>
                                </div>
                              ))
                            )}
                          </div>
                        </div>

                        {/* Usage Categories */}
                        <div>
                          <p className="text-[10px] font-medium text-foreground/40 uppercase tracking-wider mb-2">Verwendung für</p>
                          <div className="flex flex-wrap gap-1.5">
                            {CATEGORIES.map(cat => {
                              const active = provider.usage_categories.includes(cat)
                              return (
                                <button key={cat} onClick={() => toggleCategory(provider.id, cat)}
                                  className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all ${
                                    active ? 'bg-accent/20 text-accent border border-accent/30' : 'bg-foreground/[0.03] text-foreground/30 border border-foreground/5 hover:border-foreground/15'
                                  }`}
                                >{CATEGORY_LABELS[cat] || cat}</button>
                              )
                            })}
                          </div>
                        </div>

                        {/* Models */}
                        <div>
                          <p className="text-[10px] font-medium text-foreground/40 uppercase tracking-wider mb-2 flex items-center gap-1">
                            <Cpu size={10} /> Modelle ({provider.models.filter(m => m.enabled).length}/{provider.models.length} aktiv)
                          </p>
                          <div className="space-y-1.5">
                            {provider.models.map(model => (
                              <div key={model.id} className={`rounded-xl border transition-all ${
                                model.enabled ? 'border-foreground/8 bg-foreground/[0.02]' : 'border-foreground/5 bg-transparent opacity-50'
                              }`}>
                                <div className="flex items-center gap-2.5 px-3 py-2">
                                  <button onClick={() => toggleModel(provider.id, model.id)} className="shrink-0">
                                    {model.enabled ? <ToggleRight size={18} weight="fill" className="text-green-400" /> : <ToggleLeft size={18} className="text-foreground/15" />}
                                  </button>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[11px] font-medium text-foreground/80">{model.name}</p>
                                    <p className="text-[9px] text-foreground/30">
                                      {model.max_tokens.toLocaleString()} tokens · ${model.cost_per_1k_input.toFixed(4)}/${model.cost_per_1k_output.toFixed(4)} per 1K
                                    </p>
                                  </div>
                                  <div className="text-right text-[10px] text-foreground/25">
                                    <p>{model.tokens_used.toLocaleString()} tok</p>
                                    <p className="text-foreground/15">${model.cost_incurred.toFixed(4)}</p>
                                  </div>
                                </div>
                                {/* Model categories */}
                                {model.enabled && (
                                  <div className="flex flex-wrap gap-1 px-3 pb-2">
                                    {CATEGORIES.map(cat => {
                                      const active = model.categories.includes(cat)
                                      return (
                                        <button key={cat} onClick={() => toggleModelCategory(provider.id, model.id, cat)}
                                          className={`px-2 py-0.5 rounded text-[9px] transition-all ${
                                            active ? 'bg-accent/15 text-accent' : 'bg-foreground/[0.03] text-foreground/20 hover:text-foreground/40'
                                          }`}
                                        >{CATEGORY_LABELS[cat] || cat}</button>
                                      )
                                    })}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </div>
  )
}

// ─── Demo data for when backend is unreachable ─────────────────────────────

function getDemoProviders(): ProviderConfig[] {
  return [
    {
      id: 'pidev', provider_type: 'pidev', display_name: 'Pi.dev Agent', enabled: true,
      api_keys: [], base_url: 'http://localhost:3000', usage_categories: ['code', 'review', 'testing', 'planning'],
      total_tokens_used: 0, total_cost: 0, is_available: false, last_checked: new Date().toISOString(),
      models: [
        { id: 'pi-dev', name: 'pi-dev', enabled: true, max_tokens: 8192, cost_per_1k_input: 0, cost_per_1k_output: 0, categories: ['code', 'review', 'planning'], tokens_used: 0, cost_incurred: 0 },
      ],
    },
    {
      id: 'openai', provider_type: 'openai', display_name: 'OpenAI', enabled: false,
      api_keys: [], base_url: '', usage_categories: ['chat'],
      total_tokens_used: 0, total_cost: 0, is_available: false, last_checked: new Date().toISOString(),
      models: [
        { id: 'gpt-4o', name: 'GPT-4o', enabled: true, max_tokens: 128000, cost_per_1k_input: 0.0025, cost_per_1k_output: 0.01, categories: ['chat', 'code'], tokens_used: 0, cost_incurred: 0 },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini', enabled: true, max_tokens: 128000, cost_per_1k_input: 0.00015, cost_per_1k_output: 0.0006, categories: ['chat'], tokens_used: 0, cost_incurred: 0 },
      ],
    },
    {
      id: 'anthropic', provider_type: 'anthropic', display_name: 'Anthropic Claude', enabled: false,
      api_keys: [], base_url: '', usage_categories: ['planning', 'chat'],
      total_tokens_used: 0, total_cost: 0, is_available: false, last_checked: new Date().toISOString(),
      models: [
        { id: 'claude-sonnet', name: 'Claude Sonnet 4', enabled: true, max_tokens: 200000, cost_per_1k_input: 0.003, cost_per_1k_output: 0.015, categories: ['planning', 'code', 'chat'], tokens_used: 0, cost_incurred: 0 },
        { id: 'claude-opus', name: 'Claude Opus 4', enabled: false, max_tokens: 200000, cost_per_1k_input: 0.015, cost_per_1k_output: 0.075, categories: ['planning'], tokens_used: 0, cost_incurred: 0 },
      ],
    },
    {
      id: 'local', provider_type: 'local', display_name: 'Local AI', enabled: true,
      api_keys: [], base_url: 'http://localhost:11434', usage_categories: ['chat', 'docs'],
      total_tokens_used: 0, total_cost: 0, is_available: false, last_checked: new Date().toISOString(),
      models: [
        { id: 'llama3', name: 'Llama 3', enabled: true, max_tokens: 8192, cost_per_1k_input: 0, cost_per_1k_output: 0, categories: ['chat', 'docs'], tokens_used: 0, cost_incurred: 0 },
      ],
    },
  ]
}
