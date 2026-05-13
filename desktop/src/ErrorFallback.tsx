/**
 * IORA Desktop – Custom Error Page (500)
 *
 * Branded fallback shown when a runtime error occurs.
 * Replaces the default "This spark has encountered a runtime error" screen.
 */
import { Warning, ArrowCounterClockwise, House } from '@phosphor-icons/react'

export const ErrorFallback = ({
  error,
  resetErrorBoundary,
}: {
  error: unknown
  resetErrorBoundary: () => void
}) => {
  return (
    <div className="min-h-screen flex items-center justify-center p-8 bg-background">
      <div className="w-full max-w-lg text-center space-y-6">
        {/* Icon */}
        <div className="mx-auto w-16 h-16 rounded-2xl bg-destructive/10 flex items-center justify-center">
          <Warning size={32} weight="duotone" className="text-destructive" />
        </div>

        {/* Heading */}
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-foreground">
            IORA Desktop – Fehler
          </h1>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto leading-relaxed">
            Ein unerwarteter Fehler ist aufgetreten. Die Anwendung konnte nicht
            fortgesetzt werden. Versuche es erneut oder starte IORA Desktop neu.
          </p>
        </div>

        {/* Error details */}
        <div className="rounded-2xl border border-border bg-card/50 p-4 mx-auto max-w-md">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Fehlerdetails
          </p>
          <pre className="text-xs text-destructive/80 bg-destructive/5 rounded-xl p-3 overflow-auto max-h-28 text-left font-mono whitespace-pre-wrap break-all">
            {error instanceof Error ? error.message : String(error)}
          </pre>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={resetErrorBoundary}
            className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-accent/20 transition hover:bg-accent/95"
          >
            <ArrowCounterClockwise size={16} weight="bold" />
            Erneut versuchen
          </button>
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-2.5 text-sm font-medium text-foreground transition hover:bg-accent/5"
          >
            <House size={16} weight="bold" />
            Neu starten
          </button>
        </div>
      </div>
    </div>
  )
}
