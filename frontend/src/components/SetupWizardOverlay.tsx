import { useCallback, useEffect, useState } from 'react'
import { Sparkle, Wrench } from '@phosphor-icons/react'
import { getBackendUrl } from '@/lib/config'

/// ─── Setup Wizard Overlay ────────────────────────────────────────────
/// Detects first-boot setup state and shows a dedicated screen with the
/// setup wizard URL. Automatically re-checks every 15 seconds and
/// hides once setup is complete.
export function SetupWizardOverlay({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{
    checking: boolean
    setupComplete: boolean
    setupUrl: string | null
    setupReachable: boolean | null
  }>({ checking: true, setupComplete: true, setupUrl: null, setupReachable: null })
  const API_BASE = getBackendUrl()

  const checkSetup = useCallback(async () => {
    // Use the health endpoint to check setup status
    const healthUrl = API_BASE ? `${API_BASE}/health` : '/health'
    try {
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(5_000) })
      if (!res.ok) {
        // Backend/proxy not ready: don't block the app with the setup gate.
        setState(prev => ({ ...prev, checking: false, setupComplete: true }))
        return
      }
      const data = await res.json()
      if (data.setup_required === true) {
        setState({
          checking: false,
          setupComplete: false,
          setupUrl: data.setup_url || null,
          setupReachable: data.setup_reachable ?? false,
        })
      } else {
        setState({ checking: false, setupComplete: true, setupUrl: null, setupReachable: false })
      }
    } catch {
      // Fetch failed: let the normal backend-unavailable UI handle it.
      setState(prev => ({ ...prev, checking: false, setupComplete: true }))
    }
  }, [API_BASE])

  useEffect(() => {
    checkSetup()
    // Re-check every 15 seconds while setup is pending
    const interval = setInterval(checkSetup, 15_000)
    return () => clearInterval(interval)
  }, [checkSetup])

  // When setup is complete, render children normally
  if (!state.checking && state.setupComplete) {
    return <>{children}</>
  }

  // Show setup screen
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <div className="glass-card rounded-3xl p-8 border border-white/10">
          {/* Logo / Icon */}
          <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-accent/10 mx-auto mb-6">
            <Wrench size={32} className="text-accent" weight="fill" />
          </div>

          <h1 className="text-xl font-semibold text-center mb-2">rumahl OS Ersteinrichtung</h1>
          <p className="text-sm text-foreground/60 text-center mb-6">
            Das System wurde gestartet, aber die Ersteinrichtung wurde noch nicht abgeschlossen.
            Bitte öffne den Setup-Assistenten, um die Konfiguration abzuschließen.
          </p>

          {state.checking ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <div className="animate-spin w-8 h-8 border-2 border-accent border-t-transparent rounded-full" />
              <p className="text-sm text-foreground/50">Prüfe Systemstatus…</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Setup URL (reachable) */}
              {state.setupReachable && state.setupUrl ? (
                <div className="p-4 rounded-xl bg-success/10 border border-success/20 text-center">
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
                    <span className="text-sm font-medium text-success">Setup-Assistent läuft</span>
                  </div>
                  <a
                    href={state.setupUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors"
                  >
                    <Sparkle size={16} weight="fill" />
                    Setup öffnen
                  </a>
                  <p className="text-[10px] text-foreground/40 mt-2">{state.setupUrl}</p>
                </div>
              ) : state.setupUrl ? (
                // Setup URL known but not reachable yet
                <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-2 h-2 rounded-full bg-amber-400" />
                    <span className="text-sm font-medium text-amber-400">Setup wird gestartet…</span>
                  </div>
                  <p className="text-xs text-foreground/50 mb-3">
                    Der Setup-Assistent sollte unter folgender Adresse erreichbar sein:
                  </p>
                  <code className="block text-sm text-center font-mono bg-foreground/5 rounded-lg p-2">{state.setupUrl}</code>
                  <p className="text-[10px] text-foreground/40 mt-2">
                    Automatische Prüfung alle 15 Sekunden
                  </p>
                </div>
              ) : (
                // No URL found at all
                <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-2 h-2 rounded-full bg-amber-400" />
                    <span className="text-sm font-medium text-amber-400">Warte auf Setup…</span>
                  </div>
                  <p className="text-xs text-foreground/50">
                    Der Setup-Assistent konnte noch nicht gefunden werden.
                    Bitte stelle sicher, dass das System vollständig hochgefahren ist.
                    Die Prüfung erfolgt automatisch.
                  </p>
                </div>
              )}

              <button
                onClick={checkSetup}
                className="w-full py-2 rounded-xl border border-foreground/10 text-xs text-foreground/50 hover:bg-foreground/5 transition-colors"
              >
                Jetzt prüfen
              </button>
            </div>
          )}

          <p className="text-[10px] text-foreground/30 text-center mt-6">
            rumahl OS v{typeof APP_VERSION !== 'undefined' ? APP_VERSION : '?'}
          </p>
        </div>
      </div>
    </div>
  )
}
