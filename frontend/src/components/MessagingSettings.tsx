// Messaging Settings – SMTP Email, Telegram Bot, WhatsApp configuration for ORA AI
import { useState, useEffect } from 'react'
import { motion } from 'motion/react'
import {
  Envelope, TelegramLogo, WhatsappLogo, ToggleRight, ToggleLeft,
  FloppyDisk, PaperPlaneRight, Check, X, Key, At, Lock, Broadcast,
} from '@phosphor-icons/react'
import { getAssistUrl, getBackendUrl } from '@/lib/config'

const assistBase = () => getAssistUrl() || getBackendUrl() || ''

interface MessagingConfig {
  smtp: SmtpConfig; telegram: TelegramConfig; whatsapp: WhatsAppConfig
}
interface SmtpConfig {
  enabled: boolean; host: string; port: number; username: string; password: string
  from_address: string; from_name: string; use_tls: boolean
}
interface TelegramConfig {
  enabled: boolean; bot_token: string; bot_username: string
  webhook_url: string; allowed_chat_ids: string[]; forward_to_ora: boolean
}
interface WhatsAppConfig {
  enabled: boolean; provider: string; account_sid: string; auth_token: string
  phone_number_id: string; from_number: string; webhook_verify_token: string; allowed_numbers: string[]
}

const defaultConfig: MessagingConfig = {
  smtp: { enabled: false, host: '', port: 587, username: '', password: '', from_address: '', from_name: 'ORA AI', use_tls: true },
  telegram: { enabled: false, bot_token: '', bot_username: '', webhook_url: '', allowed_chat_ids: [], forward_to_ora: true },
  whatsapp: { enabled: false, provider: 'twilio', account_sid: '', auth_token: '', phone_number_id: '', from_number: '', webhook_verify_token: '', allowed_numbers: [] },
}

export function MessagingSettings() {
  const [config, setConfig] = useState<MessagingConfig>(defaultConfig)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<string | null>(null)

  useEffect(() => {
    fetch(`${assistBase()}/api/assist/messaging/config`)
      .then(r => r.ok ? r.json() : defaultConfig)
      .then(setConfig)
      .finally(() => setLoading(false))
  }, [])

  const save = async (cfg: MessagingConfig) => {
    setConfig(cfg)
    await fetch(`${assistBase()}/api/assist/messaging/config`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg),
    })
  }

  const testEmail = async () => {
    const r = await fetch(`${assistBase()}/api/assist/messaging/email/test`, { method: 'POST' })
    const result = await r.json()
    setTestResult(result.success ? '[OK] Test-Email gesendet!' : `[ERR] ${result.error}`)
    setTimeout(() => setTestResult(null), 4000)
  }

  const setupTelegram = async () => {
    await fetch(`${assistBase()}/api/assist/messaging/telegram/setup`, { method: 'POST' })
    setTestResult('[OK] Telegram Webhook eingerichtet!')
    setTimeout(() => setTestResult(null), 4000)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-foreground/8 shrink-0">
        <Broadcast size={18} weight="fill" className="text-accent" />
        <div>
          <h2 className="text-sm font-semibold text-foreground">Messaging</h2>
          <p className="text-[10px] text-foreground/40">Email, Telegram, WhatsApp – Chatte mit ORA überall</p>
        </div>
        <div className="flex-1" />
        {testResult && <span className="text-[10px] text-green-400">{testResult}</span>}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Email */}
        <Section icon={Envelope} title="Email (SMTP)" color="from-blue-500/20 to-cyan-500/10"
          enabled={config.smtp.enabled}
          onToggle={() => save({ ...config, smtp: { ...config.smtp, enabled: !config.smtp.enabled } })}
          expanded={expanded === 'email'} onExpand={() => setExpanded(expanded === 'email' ? null : 'email')}
        >
          <Field label="SMTP Host" value={config.smtp.host} onChange={v => save({ ...config, smtp: { ...config.smtp, host: v } })} placeholder="smtp.gmail.com" />
          <div className="grid grid-cols-2 gap-2">
            <Field label="Port" value={String(config.smtp.port)} onChange={v => save({ ...config, smtp: { ...config.smtp, port: parseInt(v) || 587 } })} placeholder="587" />
            <label className="flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer">
              <input type="checkbox" checked={config.smtp.use_tls} onChange={e => save({ ...config, smtp: { ...config.smtp, use_tls: e.target.checked } })} className="w-3.5 h-3.5 rounded accent-accent" />
              <span className="text-[10px] text-foreground/50">TLS</span>
            </label>
          </div>
          <Field label="Username" value={config.smtp.username} onChange={v => save({ ...config, smtp: { ...config.smtp, username: v } })} placeholder="user@gmail.com" />
          <Field label="Password" value={config.smtp.password} onChange={v => save({ ...config, smtp: { ...config.smtp, password: v } })} placeholder="••••" type="password" />
          <Field label="From Address" value={config.smtp.from_address} onChange={v => save({ ...config, smtp: { ...config.smtp, from_address: v } })} placeholder="ora@domain.com" />
          <Field label="From Name" value={config.smtp.from_name} onChange={v => save({ ...config, smtp: { ...config.smtp, from_name: v } })} placeholder="ORA AI" />
          <button onClick={testEmail} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-accent/10 border border-accent/20 text-accent text-[11px] hover:bg-accent/20 transition-all">
            <PaperPlaneRight size={12} /> Test-Email senden
          </button>
        </Section>

        {/* Telegram */}
        <Section icon={TelegramLogo} title="Telegram Bot" color="from-sky-500/20 to-blue-500/10"
          enabled={config.telegram.enabled}
          onToggle={() => save({ ...config, telegram: { ...config.telegram, enabled: !config.telegram.enabled } })}
          expanded={expanded === 'telegram'} onExpand={() => setExpanded(expanded === 'telegram' ? null : 'telegram')}
        >
          <Field label="Bot Token" value={config.telegram.bot_token} onChange={v => save({ ...config, telegram: { ...config.telegram, bot_token: v } })} placeholder="123:ABC..." type="password" />
          <Field label="Bot Username" value={config.telegram.bot_username} onChange={v => save({ ...config, telegram: { ...config.telegram, bot_username: v } })} placeholder="@ora_bot" />
          <Field label="Webhook URL" value={config.telegram.webhook_url} onChange={v => save({ ...config, telegram: { ...config.telegram, webhook_url: v } })} placeholder="https://iora.local/api/assist/messaging/telegram/webhook" />
          <Field label="Allowed Chat IDs (comma)" value={config.telegram.allowed_chat_ids.join(',')} onChange={v => save({ ...config, telegram: { ...config.telegram, allowed_chat_ids: v.split(',').map(s => s.trim()).filter(Boolean) } })} placeholder="123456,789012" />
          <button onClick={setupTelegram} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-400 text-[11px] hover:bg-sky-500/20 transition-all">
            <Check size={12} /> Webhook einrichten
          </button>
        </Section>

        {/* WhatsApp */}
        <Section icon={WhatsappLogo} title="WhatsApp (Twilio)" color="from-green-500/20 to-emerald-500/10"
          enabled={config.whatsapp.enabled}
          onToggle={() => save({ ...config, whatsapp: { ...config.whatsapp, enabled: !config.whatsapp.enabled } })}
          expanded={expanded === 'whatsapp'} onExpand={() => setExpanded(expanded === 'whatsapp' ? null : 'whatsapp')}
        >
          <Field label="Account SID" value={config.whatsapp.account_sid} onChange={v => save({ ...config, whatsapp: { ...config.whatsapp, account_sid: v } })} placeholder="AC..." />
          <Field label="Auth Token" value={config.whatsapp.auth_token} onChange={v => save({ ...config, whatsapp: { ...config.whatsapp, auth_token: v } })} placeholder="••••" type="password" />
          <Field label="From Number" value={config.whatsapp.from_number} onChange={v => save({ ...config, whatsapp: { ...config.whatsapp, from_number: v } })} placeholder="+49123..." />
          <Field label="Allowed Numbers (comma)" value={config.whatsapp.allowed_numbers.join(',')} onChange={v => save({ ...config, whatsapp: { ...config.whatsapp, allowed_numbers: v.split(',').map(s => s.trim()).filter(Boolean) } })} placeholder="+49123456,+49789012" />
        </Section>
      </div>
    </div>
  )
}

// Section wrapper
function Section({ icon: Icon, title, color, enabled, onToggle, expanded, onExpand, children }: any) {
  return (
    <div className={`rounded-2xl border transition-all ${enabled ? 'border-foreground/10 bg-card/60' : 'border-foreground/5 bg-foreground/[0.02] opacity-60'}`}>
      <div className="flex items-center gap-3 p-3 cursor-pointer" onClick={onExpand}>
        <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center`}>
          <Icon size={18} weight="fill" className="text-white/80" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-xs font-medium text-foreground">{title}</h3>
          <p className="text-[9px] text-foreground/30">{enabled ? 'Aktiviert' : 'Deaktiviert'}</p>
        </div>
        <button onClick={e => { e.stopPropagation(); onToggle() }} className="shrink-0">
          {enabled ? <ToggleRight size={20} weight="fill" className="text-green-400" /> : <ToggleLeft size={20} className="text-foreground/15" />}
        </button>
      </div>
      <motion.div initial={{ height: 0 }} animate={{ height: expanded ? 'auto' : 0 }} className="overflow-hidden">
        <div className="px-3 pb-3 space-y-2 border-t border-foreground/5 pt-2">{children}</div>
      </motion.div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; placeholder: string; type?: string }) {
  return (
    <div>
      <p className="text-[9px] text-foreground/30 mb-0.5">{label}</p>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full px-2.5 py-1.5 rounded-lg bg-foreground/5 border border-foreground/10 text-[11px] text-foreground placeholder-foreground/20 focus:outline-none focus:border-accent/40" />
    </div>
  )
}
