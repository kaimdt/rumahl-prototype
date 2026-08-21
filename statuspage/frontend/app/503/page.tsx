import Link from "next/link";
import { CalendarClock, Clock } from "lucide-react";

/**
 * Maintenance page (HTTP 503 Service Unavailable).
 *
 * Served by the web server while the status page is in maintenance — the
 * page itself is static (out/503/index.html). Wire it up on the server:
 *
 *   Apache:   ErrorDocument 503 /503/
 *   nginx:    error_page 503 /503/index.html;
 */
export default function MaintenancePage() {
  return (
    <div className="relative overflow-hidden pt-16 pb-24">
      {/* dot pattern + glow */}
      <div
        className="absolute inset-0 pointer-events-none opacity-70"
        style={{
          backgroundImage: "radial-gradient(hsl(var(--ai-glow-blue) / 0.30) 1px, transparent 1px)",
          backgroundSize: "26px 26px",
          maskImage: "radial-gradient(ellipse 75% 65% at 50% 0%, black 30%, transparent 82%)",
          WebkitMaskImage: "radial-gradient(ellipse 75% 65% at 50% 0%, black 30%, transparent 82%)",
        }}
      />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 55% 45% at 50% -10%, hsl(var(--ai-glow-blue) / 0.14), transparent 65%)",
        }}
      />

      <div className="relative mx-auto max-w-3xl px-5 lg:px-8 text-center">
        <div className="mx-auto mb-8 flex h-16 w-16 items-center justify-center rounded-2xl border border-info/30 bg-info/10 text-info">
          <CalendarClock className="h-7 w-7" strokeWidth={1.8} />
        </div>

        <p className="text-[88px] sm:text-[128px] font-bold tracking-tight leading-none select-none gradient-text">
          503
        </p>
        <h1 className="mt-4 text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
          Under maintenance
        </h1>
        <p className="mt-3 text-[15px] text-muted-foreground leading-relaxed max-w-md mx-auto">
          The status page is temporarily unavailable while we perform
          scheduled maintenance. We will be back shortly.
        </p>

        <div className="mt-8 inline-flex items-center gap-2 rounded-full border border-info/30 bg-info/10 px-4 py-2 text-[13px] font-semibold text-info">
          <Clock className="h-4 w-4" />
          Maintenance in progress
        </div>

        <p className="mt-12 text-xs text-muted-foreground/60">
          Scheduled maintenance was announced in advance on this page and in
          the incident feed —{" "}
          <Link href="/incidents/" className="text-primary hover:underline">
            view past maintenance
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
