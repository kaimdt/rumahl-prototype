import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/reveal";
import { PricingCalculator } from "@/components/pricing-calculator";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "rumahl OS is free and open source. Self-host on your own hardware — no tiers, no subscriptions, no lock-in.",
};

const included = [
  "The complete OS — no paid tiers",
  "App Store & all system apps",
  "ORA AI assistant with local models",
  "Unlimited devices & automations",
  "Updates, backups & security",
  "Commercial use allowed (MIT)",
];

export default function PricingPage() {
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
              Pricing
            </p>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-[-0.03em] text-foreground leading-[1.03]">
              rumahl OS is <span className="text-primary">free</span>.
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-base text-muted-foreground leading-relaxed">
              Open source under MIT. No tiers, no subscriptions, no artificial
              limits. The only cost is the hardware you already own.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ═══════════ CORE — what's included ═══════════ */}
      <section className="py-16 lg:py-20">
        <div className="mx-auto max-w-6xl px-6 lg:px-10">
          <div className="grid lg:grid-cols-5 gap-10 lg:gap-16 items-start">
            <Reveal className="lg:col-span-2">
              <p className="text-5xl font-bold tracking-[-0.03em] text-foreground">
                €0<span className="text-xl font-semibold text-muted-foreground"> · forever</span>
              </p>
              <p className="mt-4 text-base text-muted-foreground leading-relaxed">
                Self-hosting is the core product. Download, install on your own
                hardware, keep everything.
              </p>
              <div className="mt-8">
                <Button size="lg" asChild>
                  <Link href="/docs">
                    Get Started
                    <ArrowRight className="ml-1.5 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </Reveal>

            <Reveal delay={120} className="lg:col-span-3">
              <div className="grid sm:grid-cols-2 gap-x-10 gap-y-4">
                {included.map((f) => (
                  <div key={f} className="flex items-start gap-2.5 text-sm text-foreground/85">
                    <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" strokeWidth={2.2} />
                    {f}
                  </div>
                ))}
              </div>
              <p className="mt-6 text-xs text-muted-foreground leading-relaxed">
                Everything is included in the source. If a feature doesn&apos;t exist
                yet, it&apos;s on the roadmap — not behind a paywall.
              </p>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ═══════════ HARDWARE — visually separate ═══════════ */}
      <section className="py-16 lg:py-20 bg-[hsl(var(--surface))] border-y border-border/50">
        <div className="mx-auto max-w-6xl px-6 lg:px-10">
          <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
            <Reveal>
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
                rumahl hardware
              </p>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-[-0.02em] text-foreground leading-[1.08]">
                A reference device
                <br />
                is in the works.
              </h2>
              <p className="mt-4 text-base text-muted-foreground leading-relaxed">
                rumahl OS is built and tested against real hardware targets. A
                dedicated appliance is planned — until then, rumahl runs on the
                hardware you already have.
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                {["Raspberry Pi 4/5", "Mini PCs", "x86 / ARM", "Old laptops", "VMs"].map((p) => (
                  <span
                    key={p}
                    className="rounded-full border border-border/70 px-3 py-1 text-[11px] font-medium text-muted-foreground"
                  >
                    {p}
                  </span>
                ))}
              </div>
            </Reveal>

            <Reveal delay={120}>
              <div className="rounded-2xl border border-dashed border-border/70 bg-card p-8 text-center">
                <p className="text-sm font-semibold text-foreground">rumahl device</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Status: in planning — no specs announced yet. We won&apos;t invent them
                  here.
                </p>
                <div className="mx-auto mt-6 flex h-24 w-24 items-center justify-center rounded-2xl border border-border/60 bg-[hsl(var(--surface))]">
                  <span className="text-3xl text-muted-foreground/40">▣</span>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ═══════════ SIZING CALCULATOR ═══════════ */}
      <section className="py-16 lg:py-20">
        <div className="mx-auto max-w-6xl px-6 lg:px-10">
          <Reveal className="max-w-2xl">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
              Hardware sizing
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-[-0.02em] text-foreground leading-[1.08]">
              Which hardware fits your home?
            </h2>
            <p className="mt-4 text-base text-muted-foreground leading-relaxed">
              A rough estimate based on devices, rooms and AI usage — real
              requirements depend on your setup.
            </p>
          </Reveal>
          <Reveal delay={120}>
            <PricingCalculator />
          </Reveal>
        </div>
      </section>

      {/* ═══════════ ENTERPRISE — low priority row ═══════════ */}
      <section className="pb-24 lg:pb-32">
        <div className="mx-auto max-w-6xl px-6 lg:px-10">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-border/60 bg-[hsl(var(--surface))] px-6 py-5">
            <div>
              <p className="text-sm font-semibold text-foreground">Enterprise & managed support</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Available on request — the OS itself stays free.
              </p>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href="/docs">Contact us</Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
