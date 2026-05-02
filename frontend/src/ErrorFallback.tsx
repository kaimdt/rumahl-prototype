import { Button } from "./components/ui/button";
import { Wrench, ArrowClockwise, House } from "@phosphor-icons/react";

/**
 * IORA OS – Global Error Boundary Fallback
 *
 * Zeigt einen sauberen Fehlerbildschirm an, wenn eine React-Komponente
 * unerwartet crasht. Enthält Infos für den Admin und Optionen zum
 * Neuladen oder Zurücksetzen.
 */
export const ErrorFallback = ({
  error,
  resetErrorBoundary,
}: {
  error: unknown;
  resetErrorBoundary: () => void;
}) => {
  const errorMessage =
    error instanceof Error ? error.message : String(error ?? "Unbekannter Fehler");
  const errorStack =
    error instanceof Error ? error.stack : undefined;

  // Nützliche Links für den Admin
  const helpfulLinks = [
    { label: "System-Journal", href: "/admin?tab=logs" },
    { label: "Dev Bridge", href: "/admin?tab=dev-bridge" },
    { label: "Netzwerk", href: "/admin?tab=os-network-config" },
  ];

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-lg">
        <div className="glass-card rounded-3xl p-6 sm:p-8 border border-white/10">
          {/* Icon */}
          <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-red-500/10 mx-auto mb-5">
            <Wrench size={32} className="text-red-400" weight="fill" />
          </div>

          {/* Überschrift */}
          <h1 className="text-lg font-semibold text-center text-foreground mb-2">
            Ein Fehler ist aufgetreten
          </h1>
          <p className="text-sm text-foreground/60 text-center mb-6 leading-relaxed">
            Eine Komponente der Benutzeroberfläche konnte nicht geladen werden.
            Das System läuft im Hintergrund normal weiter.
          </p>

          {/* Fehlerdetails */}
          <div className="mb-5 p-3.5 rounded-xl bg-red-500/5 border border-red-500/15">
            <p className="text-[11px] font-semibold text-red-400 mb-1.5 uppercase tracking-wider">
              Fehlerdetails
            </p>
            <pre className="text-[11px] font-mono text-red-300/80 whitespace-pre-wrap break-all max-h-28 overflow-y-auto">
              {errorMessage}
            </pre>
            {errorStack && (
              <details className="mt-2">
                <summary className="text-[10px] text-foreground/40 cursor-pointer hover:text-foreground/60">
                  Stack-Trace anzeigen
                </summary>
                <pre className="text-[9px] font-mono text-foreground/30 mt-1.5 whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                  {errorStack}
                </pre>
              </details>
            )}
          </div>

          {/* Hilfreiche Links */}
          <div className="mb-5">
            <p className="text-[10px] font-medium text-foreground/40 uppercase tracking-wider mb-2">
              Hilfreiche Seiten
            </p>
            <div className="flex flex-wrap gap-2">
              {helpfulLinks.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  className="px-2.5 py-1.5 rounded-lg text-[10px] font-medium bg-foreground/5 text-foreground/60 hover:bg-foreground/10 hover:text-foreground/80 transition-colors"
                >
                  {link.label}
                </a>
              ))}
            </div>
          </div>

          {/* Buttons */}
          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              onClick={resetErrorBoundary}
              className="flex-1 py-2.5 text-xs font-semibold gap-1.5"
              variant="default"
            >
              <ArrowClockwise size={14} weight="bold" />
              Neu laden
            </Button>
            <Button
              onClick={() => {
                // Zur Startseite navigieren
                window.location.href = "/";
              }}
              className="flex-1 py-2.5 text-xs font-semibold gap-1.5"
              variant="outline"
            >
              <House size={14} />
              Zur Startseite
            </Button>
          </div>

          {/* Footer */}
          <p className="text-[10px] text-foreground/20 text-center mt-6">
            IORA OS – Falls der Fehler wiederholt auftritt, prüfe die Logs im
            Control Center
          </p>
        </div>
      </div>
    </div>
  );
};
