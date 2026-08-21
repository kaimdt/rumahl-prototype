import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  Boxes,
  CheckCircle2,
  CircleDot,
  CloudDownload,
  Globe,
  Store,
} from "lucide-react";
import { Reveal } from "@/components/reveal";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Status",
  description:
    "Live status of rumahl services — website, rumahl Store, update servers and community infrastructure.",
};

const components = [
  {
    icon: Globe,
    name: "rumahl Website",
    status: "Operational",
    detail: "Normal response times",
  },
  {
    icon: Store,
    name: "rumahl Store",
    status: "Operational",
    detail: "App listings, installs and updates working",
  },
  {
    icon: CloudDownload,
    name: "Update Servers",
    status: "Operational",
    detail: "OS updates and security patches available",
  },
  {
    icon: Boxes,
    name: "App Repository",
    status: "Operational",
    detail: "App store manifests and metadata",
  },
  {
    icon: Activity,
    name: "Community Services",
    status: "Operational",
    detail: "GitHub, forum and documentation",
  },
];

const uptimeStats = [
  { label: "90 day uptime", value: "99.98%" },
  { label: "Incidents (90 days)", value: "0" },
  { label: "Avg. response time", value: "128 ms" },
];

export default function StatusPage() {
  return (
    <>
      {/* ═══════════ HERO ═══════════ */}
      <section className="relative overflow-hidden pt-24 pb-16 lg:pt-32 lg:pb-20">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 55% 45% at 50% -10%, hsl(var(--success) / 0.08), transparent 65%)",
          }}
        />
        <div className="mx-auto max-w-4xl px-6 lg:px-10 relative text-center">
          <Reveal>
            <Badge
              variant="default"
              className="mb-6 border-success/30 bg-success/10 text-success"
            >
              <span className="relative flex h-2 w-2 mr-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
              </span>
              All systems operational
            </Badge>
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-foreground mb-4">
              System <span className="gradient-text">status</span>
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              The status of rumahl&apos;s cloud-touching services. Your rumahl
              OS itself runs entirely on your hardware — it doesn&apos;t need
              our servers to work.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ═══════════ STATS ═══════════ */}
      <section className="pb-16">
        <div className="mx-auto max-w-6xl px-6 lg:px-10">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {uptimeStats.map((stat, i) => (
              <Reveal key={stat.label} delay={i * 70}>
                <div className="surface-card p-6 text-center">
                  <p className="text-3xl font-bold text-foreground font-mono">
                    {stat.value}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground uppercase tracking-wider">
                    {stat.label}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════ COMPONENTS ═══════════ */}
      <section className="pb-20">
        <div className="mx-auto max-w-3xl px-6 lg:px-10">
          <Reveal className="mb-6">
            <h2 className="text-xl font-bold tracking-tight text-foreground">
              Components
            </h2>
          </Reveal>

          <div className="rounded-2xl border border-border/50 bg-card/50 overflow-hidden">
            {components.map((component, i) => (
              <Reveal key={component.name} delay={i * 40}>
                <div
                  className={`flex items-center gap-4 px-5 sm:px-6 py-4 ${
                    i > 0 ? "border-t border-border/40" : ""
                  }`}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/40 text-muted-foreground">
                    <component.icon className="h-4 w-4" strokeWidth={1.8} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">
                      {component.name}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {component.detail}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2.5 py-0.5 text-[11px] font-semibold text-success shrink-0">
                    <CheckCircle2 className="h-3 w-3" />
                    {component.status}
                  </span>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════ INCIDENTS ═══════════ */}
      <section className="pb-24 lg:pb-28">
        <div className="mx-auto max-w-3xl px-6 lg:px-10">
          <Reveal className="mb-6">
            <h2 className="text-xl font-bold tracking-tight text-foreground">
              Incident history
            </h2>
          </Reveal>

          <div className="rounded-2xl border border-border/50 bg-card/50 p-8 text-center">
            <CircleDot className="mx-auto h-7 w-7 text-success mb-3" strokeWidth={1.8} />
            <p className="text-sm font-semibold text-foreground mb-1">
              No incidents in the last 90 days
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed max-w-sm mx-auto">
              When something does go wrong, we document it here with full
              transparency — including root cause and what we changed.
            </p>
          </div>

          <Reveal className="mt-8">
            <p className="text-center text-xs text-muted-foreground">
              Spotted a problem that isn&apos;t listed?{" "}
              <Link
                href="/support"
                className="text-primary hover:underline"
              >
                Contact support
              </Link>
            </p>
          </Reveal>
        </div>
      </section>
    </>
  );
}
