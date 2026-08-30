// ─── Appr — generic mockup-style settings building blocks ──────────────────
// Reusable primitives that mirror the reference Appearance mockup panel
// schema (appr-panel / appr-setting-row / appr-divider / appr-switch / ...).
// They are used by EVERY settings tab so the whole page reads uniformly,
// while each control stays bound to the same real state as before.
import * as React from 'react'
import { Switch } from '@/components/ui/switch'

// ─── Panel: glass card with a bold title (mockup .panel) ────────────────────
export function ApprPanel({ title, children, className = '', pad = true }: {
  title: React.ReactNode
  children: React.ReactNode
  className?: string
  pad?: boolean
}) {
  return (
    <section className={`appr-panel ${pad ? 'appr-pad' : ''} ${className}`.trim()}>
      <h2>{title}</h2>
      {children}
    </section>
  )
}

// ─── Row: label+description on the left, control on the right ────────────────
export function ApprRow({ label, description, children, hint }: {
  label: React.ReactNode
  description?: React.ReactNode
  children?: React.ReactNode
  hint?: React.ReactNode
}) {
  return (
    <div className="appr-setting-row" style={{ marginTop: 16 }}>
      <div>
        <h3>{label}</h3>
        {description && <p>{description}</p>}
      </div>
      {children && <div className="shrink-0">{children}</div>}
      {hint && !children && <p className="appr-hint" style={{ marginTop: 0 }}>{hint}</p>}
    </div>
  )
}

// ─── Divider ─────────────────────────────────────────────────────────────────
export function ApprDivider() {
  return <div className="appr-divider" />
}

// ─── Toggle (switch) row ─────────────────────────────────────────────────────
export function ApprToggle({ label, description, checked, onCheckedChange, disabled }: {
  label: React.ReactNode
  description?: React.ReactNode
  checked: boolean
  onCheckedChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <ApprRow label={label} description={description}>
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} className="shrink-0" />
    </ApprRow>
  )
}

// ─── Select (mockup .select-btn) ────────────────────────────────────────────
export function ApprSelect({ value, onChange, options, ariaLabel }: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  ariaLabel?: string
}) {
  return (
    <label className="inline-flex items-center">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
        className="appr-select-btn min-w-[200px]"
        style={{ background: 'transparent', border: '0', fontSize: 'inherit', color: 'inherit', height: '45px' }}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}

// ─── Soft button (mockup .soft-btn) ─────────────────────────────────────────
export function ApprButton({ children, onClick, disabled, type = 'button' }: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  type?: 'button' | 'submit'
}) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} className="appr-soft-btn">
      {children}
    </button>
  )
}
