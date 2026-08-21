import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight, Check, Sparkles, LayoutGrid, Store, FolderOpen,
  Share2, MonitorPlay, TerminalSquare, ShieldCheck, Users,
  Palette, LayoutTemplate, Brain, Zap, HardDrive,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { RumahlIcon } from "@/components/rumahl-logo";

export const metadata: Metadata = {
  title: "rumahl OS",
  description:
    "rumahl OS is the home operating system — app launcher, app store, files & NAS, sharing, streaming, terminal and more. All local, all yours.",
};

const osFeatures = [
  {
    eyebrow: "Desktop experience",
    title: "An app launcher that feels like a real OS",
    text: "rumahl OS boots into a beautiful desktop with a dock, window management and a command palette. Open apps side by side, snap windows, and switch users without breaking a sweat — no browser tabs, no clutter.",
    points: ["App launcher & dock", "Window manager", "Command palette"],
    icon: LayoutGrid,
    label: "App Launcher & Window Manager",
  },
  {
    eyebrow: "One-click installs",
    title: "An app store with everything your home needs",
    text: "Browse the rumahl App Store and install apps in one click — media, files, smart home, AI, networking and more. See permissions and dependencies before you install, and update everything from one screen.",
    points: ["One-click installs", "App permissions", "One-click updates"],
    icon: Store,
    label: "App Store",
  },
  {
    eyebrow: "Storage",
    title: "Files & NAS — your home's data center",
    text: "Turn any disk into network storage. Manage drives, folders and backups from a clean interface, and access your files from every device in your home.",
    points: ["Drive & storage management", "Network folders", "Encrypted backups"],
    icon: FolderOpen,
    label: "Files & NAS",
  },
  {
    eyebrow: "File sharing",
    title: "rumahl Share — files between your devices",
    text: "Share files, photos and links between any devices on your local network — instantly, without external services. Clipboard sync and cloud connect for access from anywhere.",
    points: ["Local-network sharing", "Clipboard sync", "No external services"],
    icon: Share2,
    label: "File Sharing",
  },
  {
    eyebrow: "Streaming",
    title: "rumahl Streaming — live from your home",
    text: "Stream cameras, microphones or your screen live via WebRTC with low latency. Perfect for monitoring, presentations or sharing moments with family.",
    points: ["Camera & screen streaming", "Low-latency WebRTC", "100% local"],
    icon: MonitorPlay,
    label: "Streaming",
  },
  {
    eyebrow: "Developer tools",
    title: "Terminal & tooling built in",
    text: "A full terminal, service management and system diagnostics — for when you want to go deeper. rumahl OS is built on Rust microservices and stays fast on a Raspberry Pi.",
    points: ["Built-in terminal", "Service management", "System diagnostics"],
    icon: TerminalSquare,
    label: "Terminal & Developer Tools",
  },
  {
    eyebrow: "Security",
    title: "System, security & multi-user",
    text: "Session lock, 2FA, app permissions and per-user profiles. Monitor storage, RAM and CPU temperature, and keep your OS up to date in one click.",
    points: ["Session lock & 2FA", "Multi-user profiles", "System monitoring"],
    icon: ShieldCheck,
    label: "System & Security",
  },
  {
    eyebrow: "Make it yours",
    title: "Themes, widgets & automations",
    text: "Customize every pixel with themes and dynamic backgrounds. Design dashboards with drag-and-drop widgets, and automate your home with a visual editor — or just ask ORA.",
    points: ["Theme editor", "Drag-and-drop dashboards", "Visual automations"],
    icon: Palette,
    label: "Themes, Widgets & Automations",
  },
];

const osHighlights = [
  { t: "App Launcher", i: LayoutGrid },
  { t: "App Store", i: Store },
  { t: "Files & NAS", i: FolderOpen },
  { t: "File Sharing", i: Share2 },
  { t: "Streaming", i: MonitorPlay },
  { t: "Terminal", i: TerminalSquare },
  { t: "Storage", i: HardDrive },
  { t: "Security", i: ShieldCheck },
  { t: "Multi-User", i: Users },
  { t: "Themes", i: Palette },
  { t: "Dashboards", i: LayoutTemplate },
  { t: "Automations", i: Zap },
  { t: "ORA AI", i: Brain },
];

function ScreenshotPlaceholder({
  icon: Icon,
  label,
  className = "",
}: {
  icon: React.ElementType;
  label: string;
  className?: string;
}) {
  return (
    <div
      className={`relative aspect-[16/10] rounded-2xl border border-dashed border-border/50 bg-card/30 overflow-hidden ${className}`}
    >
      <div
        className="absolute inset-0 pointer-events-none opacity-60"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 30% 20%, hsl(var(--primary) / 0.05), transparent 60%), radial-gradient(ellipse 40% 40% at 80% 80%, hsl(var(--ai-glow-purple) / 0.04), transparent 60%)",
        }}
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Icon className="h-7 w-7" />
        </div>
        <p className="text-sm font-semibold text-foreground/85">{label}</p>
        <p className="text-[11px] text-muted-foreground font-mono">
          Screenshot coming soon
        </p>
      </div>
    </div>
  );
}

export default function OsPage() {
  return (
    <>
      {/* ═══════════ HERO ═══════════ */}
      <section className="relative overflow-hidden selection-primary">
        <RumahlIcon
          className="absolute -right-16 top-1/2 -translate-y-1/2 h-[520px] w-auto text-primary opacity-[0.05] pointer-events-none select-none hidden lg:block"
          aria-hidden="true"
        />
        <div className="absolute inset-0 pointer-events-none">
          <div className="orb orb-blue" style={{ top: '5%', left: '-5%', opacity: 0.2 }} />
          <div className="orb orb-purple" style={{ bottom: '10%', right: '-10%', opacity: 0.1 }} />
        </div>

        <div className="mx-auto max-w-6xl px-6 lg:px-10 pt-28 pb-16 lg:pt-40 lg:pb-28">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-primary/15 bg-primary/5 mb-6">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary/50 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary" />
              </span>
              <span className="text-[11px] font-medium text-primary/80">
                All-new rumahl OS
              </span>
            </div>

            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-[-0.03em] text-foreground leading-[1.04]">
              The home OS,<br />
              <span className="gradient-text">built from the ground up.</span>
            </h1>

            <p className="mt-5 text-base text-muted-foreground leading-relaxed max-w-lg">
              rumahl OS is a light, elegant operating system for your home — with
              an app launcher, app store, files &amp; NAS, sharing, streaming,
              terminal and ORA, your AI assistant. No tech degree required.
            </p>

            <div className="mt-8 flex flex-col sm:flex-row gap-3">
              <Button size="lg" className="shadow-lg shadow-primary/10" asChild>
                <Link href="/docs">
                  <Sparkles className="mr-2 h-4 w-4" />
                  Get Started
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </Link>
              </Button>
              <Button variant="glass" size="lg" asChild>
                <a href="https://store.rumahl.com" target="_blank" rel="noopener noreferrer">
                  Browse the App Store
                </a>
              </Button>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-success" /> Open Source</span>
              <span className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-success" /> Runs on Raspberry Pi</span>
              <span className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-success" /> Local-First</span>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════ HIGHLIGHTS STRIP ═══════════ */}
      <section className="border-y border-border/10">
        <div className="mx-auto max-w-6xl px-6 lg:px-10 py-8">
          <div className="flex flex-wrap items-center justify-center gap-2">
            {osHighlights.map((h) => (
              <span
                key={h.t}
                className="inline-flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-full border border-border/30 bg-card/40 text-foreground/70"
              >
                <h.i className="h-3.5 w-3.5 text-primary" />
                {h.t}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════ FEATURE SECTIONS ═══════════ */}
      <section className="py-24 lg:py-32">
        <div className="mx-auto max-w-6xl px-6 lg:px-10 space-y-24 lg:space-y-32">
          {osFeatures.map((f, i) => (
            <div
              key={f.title}
              className={`grid lg:grid-cols-2 gap-10 lg:gap-16 items-center ${
                i % 2 === 1 ? "lg:[&>*:first-child]:order-2" : ""
              }`}
            >
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-3">
                  {f.eyebrow}
                </p>
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mb-4">
                  {f.title}
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed mb-6">
                  {f.text}
                </p>
                <div className="space-y-2">
                  {f.points.map((p) => (
                    <div key={p} className="flex items-center gap-2 text-xs text-foreground/70">
                      <Check className="h-3.5 w-3.5 text-success shrink-0" /> {p}
                    </div>
                  ))}
                </div>
              </div>
              <ScreenshotPlaceholder icon={f.icon} label={f.label} />
            </div>
          ))}
        </div>
      </section>

      {/* ═══════════ ORA BANNER ═══════════ */}
      <section className="py-24 lg:py-32 border-t border-border/10 bg-card/20">
        <div className="mx-auto max-w-3xl px-6 lg:px-10 text-center">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-3">Intelligence</p>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground mb-4">
            And ORA, your <span className="gradient-text">AI assistant</span>
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed mb-8 max-w-xl mx-auto">
            Talk to your home naturally. ORA runs 100% locally on your hardware —
            no cloud, no accounts, no data leaving your home.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button size="lg" asChild>
              <Link href="/ai">
                Meet rumahl ORA
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button variant="glass" size="lg" asChild>
              <a href="https://store.rumahl.com" target="_blank" rel="noopener noreferrer">
                Browse the App Store
              </a>
            </Button>
          </div>
        </div>
      </section>

      {/* ═══════════ CTA ═══════════ */}
      <section className="py-32 lg:py-40 relative overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none" aria-hidden="true">
          <RumahlIcon className="h-[420px] w-auto text-primary opacity-[0.05]" />
        </div>
        <div className="mx-auto max-w-2xl px-6 lg:px-10 text-center relative">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground mb-4">
            Your home deserves an <span className="text-primary">OS</span>
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed mb-8 max-w-md mx-auto">
            Free. Open source. Local-first. Get rumahl OS running in about five
            minutes.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button size="lg" className="shadow-lg shadow-primary/10" asChild>
              <Link href="/docs"><Sparkles className="mr-2 h-4 w-4" />Get Started<ArrowRight className="ml-1.5 h-4 w-4" /></Link>
            </Button>
            <Button variant="glass" size="lg" asChild>
              <a href="https://github.com/rumahl" target="_blank" rel="noopener noreferrer">
                View on GitHub
              </a>
            </Button>
          </div>
          <p className="mt-4 text-[11px] text-muted-foreground">No credit card. No cloud account. Just download.</p>
        </div>
      </section>
    </>
  );
}
