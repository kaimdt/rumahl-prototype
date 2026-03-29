import { useEffect, useMemo, useState } from 'react'

interface DynamicTextWidgetProps {
  template?: string
  userName?: string
}

function renderTemplate(template: string, userName: string): string {
  const now = new Date()
  const map: Record<string, string> = {
    '{user}': userName,
    '{time}': now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
    '{seconds}': now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    '{date}': now.toLocaleDateString('de-DE'),
    '{weekday}': now.toLocaleDateString('de-DE', { weekday: 'long' }),
    '{datetime}': now.toLocaleString('de-DE'),
  }

  return Object.entries(map).reduce((acc, [token, value]) => acc.replaceAll(token, value), template)
}

export function DynamicTextWidget({ template, userName = 'Benutzer' }: DynamicTextWidgetProps) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const effectiveTemplate = template?.trim() || 'Hallo {user} - {weekday}, {date} - {time}'
  const rendered = useMemo(() => {
    void now
    return renderTemplate(effectiveTemplate, userName)
  }, [effectiveTemplate, userName, now])

  return (
    <div className="glass-card rounded-2xl theme-transition p-4 sm:p-5 min-h-[120px] flex items-center">
      <div className="space-y-2 w-full">
        <p className="text-[11px] uppercase tracking-[0.12em] text-foreground/45">Dynamischer Text</p>
        <p className="text-base sm:text-lg font-medium text-foreground leading-snug break-words">{rendered}</p>
      </div>
    </div>
  )
}
