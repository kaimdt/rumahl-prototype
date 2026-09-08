import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Blocks,
  GitCommitHorizontal,
  LayoutDashboard,
  Rocket,
  Sparkles,
  Wrench,
} from "lucide-react";
import { Reveal } from "@/components/reveal";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Changelog",
  description:
    "Every release of rumahl OS — from the first Home Assistant dashboard to the Home OS platform.",
};

interface ReleaseSection {
  title: string;
  icon: typeof Rocket;
  items: string[];
}

interface Release {
  version: string;
  date: string;
  title: string;
  tag?: string;
  summary: string;
  sections: ReleaseSection[];
}

const releases: Release[] = [
  {
    version: "2.0.0",
    date: "August 2026",
    title: "Home OS",
    tag: "Latest",
    summary:
      "The release that makes rumahl a true home operating system — a platform, not a container list. Desktop-grade shell, app SDK, permissions as the trust boundary, and a full set of native system apps.",
    sections: [
      {
        title: "OS Foundation",
        icon: Sparkles,
        items: [
          "Global Spotlight search (Ctrl+Space) across apps, files, devices, settings and containers",
          "System-wide Job Manager — downloads, backups and updates as visible, resumable jobs",
          "Clipboard manager with history, pinning and search",
          "Session restore — windows and tabs survive logout and reboot",
          "Snap layouts with drag-to-edge live preview",
          "Default apps, MIME types, deep links and cross-app drag & drop",
          "Global keyboard shortcut registry with per-user overrides",
        ],
      },
      {
        title: "Apps & SDK",
        icon: Blocks,
        items: [
          "ora.* SDK: notifications, files, storage, clipboard, windows, permissions, jobs, secrets, users, devices, home, system events",
          "Runtime permission dialogs — allow/deny, like Android and iOS",
          "App-scoped secret vault for credentials",
          "System-event hooks so apps react to OS events",
          "Visual Automation Engine with flow editor (trigger → condition → action)",
        ],
      },
      {
        title: "Devices & Media",
        icon: LayoutDashboard,
        items: [
          "Devices app — registry with Wake-on-LAN and TCP/HTTP reachability agents",
          "Per-user Downloads, Documents, Photos and Videos folders",
          "Universal download manager that survives tab closes",
          "Media Hub with Jellyfin & Plex continue-watching and proxied thumbnails",
          "External share links — 72 h links with token-based access",
        ],
      },
      {
        title: "System & Security",
        icon: Wrench,
        items: [
          "Admin Center redesigned in a Windows-11-style settings shell",
          "Integrated, permissioned Terminal with full ANSI rendering",
          "Seven native system apps: System Monitor, Storage, Containers, Network, Backup, Logs, Services",
          "Child profiles, guest mode, route guard and family shares",
          "Security monitor with alerts, resource usage and anomaly detection",
          "Modern boot UI with graphical first-boot wizard, QR setup and headless install",
        ],
      },
    ],
  },
  {
    version: "1.4",
    date: "2026",
    title: "App & Plugin Platform",
    summary:
      "The platform layer: apps and plugins became first-class citizens with registration, permissions, updates and AI integration.",
    sections: [
      {
        title: "App & Plugin System",
        icon: Blocks,
        items: [
          "Registration management — approve, suspend and revoke app access with API tokens",
          "Security monitor — alerts, resource usage and provider-specific monitoring",
          "Update management with stable/beta/alpha/dev channels and rollback",
          "Widget registry — installable widgets with permissions and instance tracking",
        ],
      },
      {
        title: "Plugin AI Integration",
        icon: Sparkles,
        items: [
          "PluginAIClient — chat, streaming, tool registration and image analysis",
          "Internet search and conversation history for plugins",
          "Reference plugin: energy optimizer with AI tools",
          "Live infrastructure visualization of all rumahl services",
        ],
      },
    ],
  },
  {
    version: "1.0",
    date: "March 2026",
    title: "Home Dashboard",
    summary:
      "Where it started: a modern, fully customizable dashboard for Home Assistant — designed for touchscreens and mice alike.",
    sections: [
      {
        title: "Dashboard",
        icon: LayoutDashboard,
        items: [
          "Complete Home Assistant compatibility — devices, entities and controls",
          "Innovative light & climate controls: tap to toggle, hold for detail, drag to dim",
          "Dynamic day/night theming — bright days, dark evenings, full-black sleep mode",
          "Every page fully customizable with all Home Assistant components",
        ],
      },
    ],
  },
];

export default function ChangelogPage() {
  return (
    <>
      {/* ═══════════ HERO ═══════════ */}
      <section className="relative overflow-hidden pt-24 pb-16 lg:pt-32 lg:pb-20">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 55% 45% at 50% -10%, hsl(var(--primary) / 0.09), transparent 65%)",
          }}
        />
        <div className="mx-auto max-w-4xl px-6 lg:px-10 relative text-center">
          <Reveal>
            <Badge variant="accent" className="mb-6">
              <GitCommitHorizontal className="h-3 w-3 mr-1.5" />
              Changelog · Versionshinweise
            </Badge>
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-foreground mb-4">
              What&apos;s <span className="gradient-text">new</span>
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Every release of rumahl OS — from the first dashboard to the Home
              OS platform. The latest version is always one update away.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ═══════════ TIMELINE ═══════════ */}
      <section className="pb-24 lg:pb-28">
        <div className="mx-auto max-w-4xl px-6 lg:px-10">
          <div className="relative">
            {/* Vertikale Linie */}
            <div className="absolute left-[19px] top-2 bottom-2 w-px bg-border/60" />

            <div className="space-y-10">
              {releases.map((release, i) => (
                <Reveal key={release.version} delay={i * 60}>
                  <div className="relative pl-14">
                    {/* Versionspunkt */}
                    <div
                      className={cn(
                        "absolute left-0 top-1 flex h-10 w-10 items-center justify-center rounded-full border font-mono text-[11px] font-bold",
                        release.tag
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-border/60 bg-card text-muted-foreground"
                      )}
                    >
                      {release.version.split(".")[0]}.
                      {release.version.split(".")[1]}
                    </div>

                    <div className="rounded-2xl border border-border/50 bg-card/50 p-6 sm:p-8">
                      <div className="flex flex-wrap items-center gap-3 mb-2">
                        <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
                          v{release.version} — {release.title}
                        </h2>
                        {release.tag && (
                          <Badge variant="accent">{release.tag}</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground font-medium mb-3">
                        {release.date}
                      </p>
                      <p className="text-sm text-muted-foreground leading-relaxed mb-6">
                        {release.summary}
                      </p>

                      <div className="grid sm:grid-cols-2 gap-x-8 gap-y-6">
                        {release.sections.map((section) => (
                          <div key={section.title}>
                            <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                              <section.icon className="h-3.5 w-3.5 text-primary" />
                              {section.title}
                            </h3>
                            <ul className="space-y-2">
                              {section.items.map((item) => (
                                <li
                                  key={item}
                                  className="flex gap-2.5 text-[13px] text-foreground/80 leading-relaxed"
                                >
                                  <span className="mt-[8px] h-1 w-1 rounded-full bg-primary/60 shrink-0" />
                                  {item}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>

          {/* Up next */}
          <Reveal className="mt-14">
            <div className="rounded-2xl border border-primary/20 bg-primary/5 p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Rocket className="h-5 w-5" strokeWidth={1.8} />
              </div>
              <div className="flex-1">
                <h2 className="text-base font-bold text-foreground mb-1">
                  What&apos;s next
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  User profiles, NAS storage with RAID, the full Control
                  Center and AI system operations are on the roadmap — see
                  what&apos;s being built right now.
                </p>
              </div>
              <Link
                href="/roadmap"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:gap-2.5 transition-all shrink-0"
              >
                View the roadmap
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
