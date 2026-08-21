import Link from "next/link";
import { Activity, Home, History, Megaphone } from "lucide-react";

/**
 * Custom 404 — rendered for unknown routes (static export → 404.html).
 */
export default function NotFound() {
  return (
    <div className="relative overflow-hidden pt-16 pb-24">
      {/* dot pattern + glow, rumahl style */}
      <div
        className="absolute inset-0 pointer-events-none opacity-70"
        style={{
          backgroundImage: "radial-gradient(hsl(var(--ai-glow-teal) / 0.30) 1px, transparent 1px)",
          backgroundSize: "26px 26px",
          maskImage: "radial-gradient(ellipse 75% 65% at 50% 0%, black 30%, transparent 82%)",
          WebkitMaskImage: "radial-gradient(ellipse 75% 65% at 50% 0%, black 30%, transparent 82%)",
        }}
      />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 55% 45% at 50% -10%, hsl(var(--ai-glow-teal) / 0.14), transparent 65%)",
        }}
      />

      <div className="relative mx-auto max-w-3xl px-5 lg:px-8 text-center">
        <p className="text-[88px] sm:text-[128px] font-bold tracking-tight gradient-text leading-none select-none">
          404
        </p>
        <h1 className="mt-4 text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
          Page not found
        </h1>
        <p className="mt-3 text-[15px] text-muted-foreground leading-relaxed max-w-md mx-auto">
          The page you are looking for does not exist or has been moved.
          The status overview is always available.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary-hover transition-colors shadow-md shadow-primary/20"
          >
            <Home className="h-4 w-4" />
            Back to status
          </Link>
          <Link
            href="/history/"
            className="inline-flex items-center gap-2 rounded-full border border-border/50 px-5 py-2.5 text-sm font-semibold text-muted-foreground hover:text-foreground hover:border-border transition-colors"
          >
            <History className="h-4 w-4" />
            Uptime history
          </Link>
          <Link
            href="/incidents/"
            className="inline-flex items-center gap-2 rounded-full border border-border/50 px-5 py-2.5 text-sm font-semibold text-muted-foreground hover:text-foreground hover:border-border transition-colors"
          >
            <Megaphone className="h-4 w-4" />
            Incidents
          </Link>
        </div>

        <p className="mt-12 text-xs text-muted-foreground/60 inline-flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5" />
          All systems are monitored — check the status page for the latest.
        </p>
      </div>
    </div>
  );
}
