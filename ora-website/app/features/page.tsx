import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/reveal";
import { AppStorePreview } from "@/components/preview/app-store";
import { FilesPreview } from "@/components/preview/files";
import { OraPreview } from "@/components/preview/ora";
import { SystemPreview } from "@/components/preview/system";
import { DashboardPreview } from "@/components/preview/dashboard";

export const metadata: Metadata = {
  title: "Features",
  description:
    "rumahl OS — the home operating system. Devices, apps, files & storage, AI assistant, system services and personalization in one OS.",
};

interface TourGroup {
  eyebrow: string;
  title: string;
  text: string;
  points: string[];
  preview: React.ReactNode;
  reverse?: boolean;
}

const tour: TourGroup[] = [
  {
    eyebrow: "Home & devices",
    title: "Every device, one interface",
    text: "Control lights, climate, media and locks from a single dashboard. rumahl integrates with Home Assistant and its ecosystem — so your existing setup keeps working.",
    points: ["Device control & groups", "Home Assistant integration", "Room scenes & per-room views"],
    preview: <DashboardPreview />,
  },
  {
    eyebrow: "Apps",
    title: "An app store, built in",
    text: "The rumahl App Store installs self-hosted apps in one click — with permissions shown before you install, and updates from a single screen.",
    points: ["One-click installs", "Permissions & dependencies", "App launcher & dock"],
    preview: <AppStorePreview />,
    reverse: true,
  },
  {
    eyebrow: "Files & storage",
    title: "Files, NAS and backups",
    text: "Store, organize and share files across your home. Any disk becomes network storage; backups are encrypted and automatic.",
    points: ["Files & network shares", "NAS & storage management", "Encrypted backups"],
    preview: <FilesPreview />,
  },
  {
    eyebrow: "Intelligence",
    title: "ORA understands your home",
    text: "Ask in plain language: find files, check system status, manage apps, create automations. ORA runs locally on your hardware.",
    points: ["Natural-language control", "Local LLMs — zero cloud", "Automation generation"],
    preview: <OraPreview />,
    reverse: true,
  },
  {
    eyebrow: "System",
    title: "Services that just work",
    text: "Updates, security, multi-user and monitoring — built into the OS instead of bolted on. Everything stays transparent and inspectable.",
    points: ["One-click updates", "Session lock & 2FA", "Storage, memory & CPU monitoring"],
    preview: <SystemPreview />,
  },
  {
    eyebrow: "Personalization",
    title: "Make it yours",
    text: "Themes, dynamic backgrounds and a drag-and-drop dashboard designer — everyone in the house gets their perfect view.",
    points: ["Theme editor", "Drag-and-drop dashboards", "Widgets for devices, energy, media"],
    preview: <DashboardPreview />,
    reverse: true,
  },
];

const comparison: [string, string, string][] = [
  ["Primary purpose", "Home automation", "Home operating system"],
  ["Automation", "Excellent, mature", "Visual editor + ORA"],
  ["Apps", "Add-ons", "App store with one-click installs"],
  ["Files & storage", "Limited", "Files, NAS, shares, backups"],
  ["Desktop experience", "None", "Launcher, windows, dock"],
  ["AI assistant", "External tools", "ORA, built in & local"],
  ["Multi-user", "Basic", "Profiles with session lock"],
  ["Device integrations", "1000+", "Same 1000+ via integration"],
];

export default function FeaturesPage() {
  return (
    <>
      {/* ═══════════ HEADER ═══════════ */}
      <section className="relative overflow-hidden pt-24 pb-10 lg:pt-32">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 50% 40% at 50% -10%, hsl(var(--primary) / 0.07), transparent 65%)",
          }}
        />
        <div className="mx-auto max-w-3xl px-6 lg:px-10 text-center relative">
          <Reveal>
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
              Features
            </p>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-[-0.03em] text-foreground leading-[1.03]">
              Everything in <span className="text-primary">one OS</span>.
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-base text-muted-foreground leading-relaxed">
              Not a dashboard. Not an add-on. An operating system — devices, apps,
              storage, intelligence and system services in one coherent home.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ═══════════ PRODUCT TOUR ═══════════ */}
      <section className="pb-24 lg:pb-32">
        <div className="mx-auto max-w-6xl px-6 lg:px-10 space-y-24 lg:space-y-32">
          {tour.map((g, i) => (
            <div
              key={g.eyebrow}
              className={`grid lg:grid-cols-12 gap-10 lg:gap-16 items-center ${
                g.reverse ? "lg:[&>*:first-child]:order-2" : ""
              }`}
            >
              <Reveal className={`${g.reverse ? "lg:col-span-7" : "lg:col-span-7"}`}>
                {g.preview}
              </Reveal>
              <Reveal delay={120} className="lg:col-span-5">
                <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
                  {g.eyebrow}
                </p>
                <h2 className="text-3xl sm:text-4xl font-bold tracking-[-0.02em] text-foreground leading-[1.08]">
                  {g.title}
                </h2>
                <p className="mt-4 text-base text-muted-foreground leading-relaxed">{g.text}</p>
                <div className="mt-6 space-y-2">
                  {g.points.map((p) => (
                    <div key={p} className="flex items-center gap-2.5 text-sm text-foreground/80">
                      <Check className="h-4 w-4 text-primary shrink-0" strokeWidth={2.2} />
                      {p}
                    </div>
                  ))}
                </div>
              </Reveal>
            </div>
          ))}
        </div>
      </section>

      {/* ═══════════ COMPARISON — neutral ═══════════ */}
      <section className="py-24 lg:py-32 bg-[hsl(var(--surface))] border-y border-border/50">
        <div className="mx-auto max-w-5xl px-6 lg:px-10">
          <Reveal className="max-w-2xl">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
              How rumahl relates
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-[-0.02em] text-foreground leading-[1.08]">
              Home Assistant is great at automation.
              <br />
              <span className="text-primary">rumahl is the OS around it.</span>
            </h2>
            <p className="mt-4 text-base text-muted-foreground leading-relaxed">
              rumahl builds on Home Assistant&apos;s ecosystem — your devices and
              automations keep working — and adds everything an operating system
              needs beyond automation.
            </p>
          </Reveal>

          <Reveal delay={120} className="mt-12">
            <div className="overflow-x-auto rounded-2xl border border-border/60 bg-card">
              <table className="w-full text-sm min-w-[560px]">
                <thead>
                  <tr className="border-b border-border/60 bg-[hsl(var(--surface))]">
                    <th className="text-left py-3.5 px-5 font-medium text-muted-foreground text-xs uppercase tracking-wider">
                      Category
                    </th>
                    <th className="py-3.5 px-4 text-left font-medium text-foreground/60 text-xs">
                      Home Assistant
                    </th>
                    <th className="py-3.5 px-4 text-left font-semibold text-primary text-xs">
                      rumahl OS
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {comparison.map(([cat, ha, rm]) => (
                    <tr key={cat} className="hover:bg-[hsl(var(--surface))/0.6] transition-colors">
                      <td className="py-3 px-5 font-medium text-foreground/80 text-xs">{cat}</td>
                      <td className="py-3 px-4 text-muted-foreground text-xs">{ha}</td>
                      <td className="py-3 px-4 text-foreground text-xs font-medium">{rm}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              rumahl Home integrates with Home Assistant — it extends, not replaces.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ═══════════ CTA ═══════════ */}
      <section className="py-24 lg:py-32">
        <div className="mx-auto max-w-2xl px-6 lg:px-10 text-center">
          <Reveal>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-[-0.02em] text-foreground">
              See it for yourself.
            </h2>
            <p className="mx-auto mt-4 max-w-md text-base text-muted-foreground leading-relaxed">
              Install rumahl OS and explore the launcher, the store and the files —
              on your own hardware.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Button size="lg" asChild>
                <Link href="/docs">
                  Get Started
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="/os">Explore the OS</Link>
              </Button>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
