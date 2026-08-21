import Link from "next/link";
import { ArrowRight, Check, Github, CloudOff, EyeOff, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/reveal";
import { InstallPreview } from "@/components/preview/system";

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
      {children}
    </p>
  );
}

/* ═══════════ Privacy & Architecture ═══════════ */
export function PrivacySection() {
  const rows = [
    {
      i: CloudOff,
      t: "No cloud required",
      d: "Every service runs on your hardware. Even AI — ORA uses local models.",
    },
    {
      i: EyeOff,
      t: "Zero telemetry",
      d: "No tracking, no accounts you didn't create, no data collection.",
    },
    {
      i: Unlock,
      t: "No lock-in",
      d: "Open source. Export your data, move your setup, self-host forever.",
    },
  ];

  return (
    <section className="py-24 lg:py-32 bg-[hsl(var(--surface))] border-y border-border/50">
      <div className="mx-auto max-w-6xl px-6 lg:px-10">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-start">
          <Reveal>
            <Eyebrow>Local-first by design</Eyebrow>
            <h2 className="text-3xl sm:text-4xl lg:text-[2.75rem] font-bold tracking-[-0.02em] text-foreground leading-[1.05]">
              Your data. Your hardware.
              <br />
              <span className="text-primary">Your rules.</span>
            </h2>
            <p className="mt-5 text-base text-muted-foreground leading-relaxed max-w-md">
              A home OS shouldn&apos;t phone home. rumahl runs everything locally and
              explains how — the source is open, the architecture is documented.
            </p>
            <div className="mt-8 flex flex-wrap gap-2">
              {["Rust microservices", "SQLite local storage", "Linux · systemd", "Raspberry Pi → x86"].map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-border/70 px-3 py-1 text-[11px] font-medium text-muted-foreground"
                >
                  {t}
                </span>
              ))}
            </div>
          </Reveal>

          <div className="space-y-3">
            {rows.map((r, i) => (
              <Reveal key={r.t} delay={i * 90}>
                <div className="flex gap-4 rounded-2xl border border-border/60 bg-card p-5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <r.i className="h-5 w-5" strokeWidth={1.8} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-foreground">{r.t}</h3>
                    <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{r.d}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ═══════════ Installation ═══════════ */
export function InstallSection() {
  const platforms = ["Raspberry Pi", "Mini PC", "Old laptop", "VM", "Docker", "x86 / ARM"];

  return (
    <section className="py-24 lg:py-32">
      <div className="mx-auto max-w-6xl px-6 lg:px-10">
        <div className="grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
          <Reveal className="lg:col-span-5">
            <Eyebrow>Installation</Eyebrow>
            <h2 className="text-3xl sm:text-4xl lg:text-[2.75rem] font-bold tracking-[-0.02em] text-foreground leading-[1.05]">
              Up and running
              <br />
              in minutes.
            </h2>
            <p className="mt-5 text-base text-muted-foreground leading-relaxed">
              Flash an image, or run one command. Then open{" "}
              <span className="font-mono text-foreground/80">rumahl.local</span> in
              your browser — no display, keyboard or cloud account needed.
            </p>
            <div className="mt-7 flex flex-wrap gap-2">
              {platforms.map((p) => (
                <span
                  key={p}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border/70 px-3 py-1 text-[11px] font-medium text-foreground/70"
                >
                  <Check className="h-3 w-3 text-primary" />
                  {p}
                </span>
              ))}
            </div>
            <div className="mt-8">
              <Button size="lg" asChild>
                <Link href="/docs">
                  Installation guide
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </Reveal>
          <Reveal delay={120} className="lg:col-span-7">
            <InstallPreview />
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ═══════════ Community ═══════════ */
export function CommunitySection() {
  return (
    <section className="py-24 lg:py-32 bg-[hsl(var(--surface))] border-y border-border/50">
      <div className="mx-auto max-w-4xl px-6 lg:px-10 text-center">
        <Reveal>
          <Eyebrow>Built in the open</Eyebrow>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-[-0.02em] text-foreground leading-[1.05]">
            rumahl is open source.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-base text-muted-foreground leading-relaxed">
            The OS, the frontend, the apps and the SDKs live on GitHub. Contributions,
            issues and ideas are welcome — that&apos;s how a home OS stays honest.
          </p>
          <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button size="lg" variant="outline" asChild>
              <a href="https://github.com/rumahl" target="_blank" rel="noopener noreferrer">
                <Github className="mr-2 h-4 w-4" />
                github.com/rumahl
              </a>
            </Button>
            <Button size="lg" variant="ghost" asChild>
              <a href="https://store.rumahl.com" target="_blank" rel="noopener noreferrer">
                Explore the App Store
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </a>
            </Button>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ═══════════ Final CTA ═══════════ */
export function FinalCta() {
  return (
    <section className="py-32 lg:py-40 relative overflow-hidden">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 45% 40% at 50% 110%, hsl(var(--primary) / 0.1), transparent 70%)",
        }}
      />
      <div className="mx-auto max-w-2xl px-6 lg:px-10 text-center relative">
        <Reveal>
          <h2 className="text-4xl sm:text-5xl font-bold tracking-[-0.02em] text-foreground leading-[1.05]">
            Your home deserves
            <br />
            an <span className="text-primary">OS</span>.
          </h2>
          <p className="mx-auto mt-5 max-w-md text-base text-muted-foreground leading-relaxed">
            Free. Open source. Local-first. Get rumahl running in about five minutes.
          </p>
          <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button size="lg" className="shadow-lg shadow-primary/10" asChild>
              <Link href="/docs">
                Get Started
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <a href="https://store.rumahl.com" target="_blank" rel="noopener noreferrer">
                Explore the App Store
              </a>
            </Button>
          </div>
          <p className="mt-5 text-xs text-muted-foreground">
            No credit card. No cloud account. Just download.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
