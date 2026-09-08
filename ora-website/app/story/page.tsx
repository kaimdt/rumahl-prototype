import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/reveal";
import { RumahlLogo, RumahlIcon } from "@/components/rumahl-logo";

export const metadata: Metadata = {
  title: "The origin story",
  description:
    "How a Home Assistant dashboard became a platform, then an operating system — and finally a home for everything at home.",
};

interface Chapter {
  n: string;
  title: string;
  subtitle?: string;
  text: string;
  /** Der Wendepunkt der Geschichte — visuell hervorgehoben */
  turn?: boolean;
  /** Hervorgehobenes Wort (z. B. die Namensherkunft) */
  word?: { term: string; meaning: string };
}

const chapters: Chapter[] = [
  {
    n: "01",
    title: "A smaller idea",
    text: "rumahl started with a much smaller idea. I wanted Home Assistant to feel more dynamic. Instead of static dashboards that always looked the same, I wanted an interface that could adapt — to the room, the situation, the person using it, and what was actually happening in the home.",
  },
  {
    n: "02",
    title: "The dashboard outgrew itself",
    text: "That idea became a dashboard. Then the dashboard started growing. It needed more structure, more control, more services, more ways to run apps, more ways to connect everything together. At some point it was no longer just a Home Assistant interface. It was becoming a platform.",
  },
  {
    n: "03",
    title: "The moment it became an OS",
    turn: true,
    text: "And once it became a platform, the obvious next question was: why should it depend on another operating system at all? So I started building one. Using Buildroot, the project turned into a real operating system — with its own boot process, installer, services, app platform, lifecycle management and a browser-based desktop.",
  },
  {
    n: "04",
    title: "IORA",
    subtitle: "Interface for Optimized Residential Autonomy.",
    text: "The project became IORA — short for Interface for Optimized Residential Autonomy. The name fit the technology. But over time, the system itself became less about an interface and more about the entire digital home behind it.",
  },
  {
    n: "05",
    title: "ORA",
    subtitle: "The name became simpler. The project grew larger.",
    text: "IORA became ORA. Shorter. Cleaner. More personal. But ORA still carried the name of the whole operating system, even though the project had grown far beyond that identity. It was no longer just an interface. It was where apps lived. Where files lived. Where services ran. Where the home was controlled. Where everything came together.",
  },
  {
    n: "06",
    title: "rumahl",
    subtitle: "One small change. The same idea.",
    text: "It had become a home for the digital parts of a home — and that is where rumahl came from. The name is derived from “rumah”, the Indonesian and Malay word for house or home. One small change turned the word into our own name, while keeping the idea behind it intact.",
    word: { term: "rumah", meaning: "house · home" },
  },
  {
    n: "07",
    title: "The assistant finds its home",
    text: "And ORA did not disappear. Instead, ORA finally found the role that fits the name better than ever before: the assistant inside rumahl. rumahl is the home. The apps and services are its residents. And ORA is part of that home — always there when you need her, and probably the loudest resident of them all.",
  },
];

export default function StoryPage() {
  return (
    <>
      {/* ═══════════ HERO ═══════════ */}
      <section className="relative overflow-hidden pt-24 pb-16 lg:pt-36 lg:pb-24">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 55% 45% at 50% -10%, hsl(var(--primary) / 0.08), transparent 65%)",
          }}
        />
        <div className="mx-auto max-w-3xl px-6 lg:px-10 text-center relative">
          <Reveal>
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-6">
              The origin story
            </p>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-[-0.03em] text-foreground leading-[1.05]">
              From a dashboard
              <br />
              to a <span className="text-primary">home</span>.
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-base text-muted-foreground leading-relaxed">
              What started as an attempt to build a better Home Assistant dashboard
              became a platform, then an operating system — and finally something
              much closer to the original idea than expected.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ═══════════ NAMENS-EVOLUTION — visueller Anker ═══════════ */}
      <section className="pb-8">
        <div className="mx-auto max-w-4xl px-6 lg:px-10">
          <Reveal>
            <div className="flex flex-col items-center gap-4 rounded-2xl border border-border/60 bg-[hsl(var(--surface))] px-6 py-8">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                One name became the next
              </p>
              <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-3 sm:gap-x-8">
                <span className="text-2xl sm:text-3xl font-bold tracking-tight text-muted-foreground/50 line-through decoration-border decoration-2">
                  IORA
                </span>
                <span className="text-lg sm:text-xl text-muted-foreground/50">→</span>
                <span className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground/80">
                  ORA
                </span>
                <span className="text-lg sm:text-xl text-muted-foreground/50">→</span>
                <span className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
                  rumah<span className="text-primary">l</span>
                </span>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ═══════════ KAPITEL — Timeline ═══════════ */}
      <section className="py-16 lg:py-24">
        <div className="mx-auto max-w-2xl px-6 lg:px-10">
          <div className="relative space-y-14 lg:space-y-16">
            {/* Vertikale Linie */}
            <div className="absolute left-[19px] top-2 bottom-2 w-px bg-border/70 lg:left-1/2" aria-hidden="true" />

            {chapters.map((c, i) => (
              <Reveal key={c.n} delay={i * 40}>
                <div className="relative pl-14 lg:pl-0">
                  {/* Punkt */}
                  <span
                    className={`absolute left-0 top-1 flex h-10 w-10 items-center justify-center rounded-full border font-mono text-[11px] font-bold lg:left-1/2 lg:-translate-x-1/2 ${
                      c.turn
                        ? "border-primary/50 bg-primary/10 text-primary"
                        : "border-border/70 bg-card text-primary"
                    }`}
                    aria-hidden="true"
                  >
                    {c.n}
                  </span>

                  <div className="lg:max-w-[calc(50%-2.5rem)] lg:ml-auto">
                    {c.turn ? (
                      /* ── Der Wendepunkt: prominenter ── */
                      <div className="rounded-2xl border border-primary/25 bg-primary/5 p-6">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary mb-2">
                          The turning point
                        </p>
                        <h2 className="text-2xl font-bold tracking-[-0.02em] text-foreground">
                          {c.title}
                        </h2>
                        <p className="mt-4 text-2xl font-semibold tracking-[-0.01em] text-foreground leading-snug">
                          “Why should it depend on another
                          <br className="hidden sm:block" /> operating system at all?”
                        </p>
                        <p className="mt-4 text-[15px] text-muted-foreground leading-relaxed">
                          {c.text}
                        </p>
                      </div>
                    ) : (
                      <>
                        <h2 className="text-xl sm:text-2xl font-bold tracking-[-0.02em] text-foreground">
                          {c.title}
                        </h2>
                        {c.subtitle && (
                          <p className="mt-1.5 text-sm font-medium text-primary">{c.subtitle}</p>
                        )}
                        <p className="mt-3 text-[15px] text-muted-foreground leading-relaxed">
                          {c.text}
                        </p>
                        {c.word && (
                          /* ── Namensherkunft: der emotionale Punkt ── */
                          <div className="mt-5 flex items-baseline gap-3 rounded-xl border border-border/60 bg-card px-4 py-3">
                            <span className="text-2xl font-bold tracking-tight text-foreground">
                              {c.word.term}
                            </span>
                            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                              {c.word.meaning}
                            </span>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════ FAZIT — die Markenmetapher ═══════════ */}
      <section className="py-20 lg:py-28 bg-[hsl(var(--surface))] border-y border-border/50">
        <div className="mx-auto max-w-3xl px-6 lg:px-10 text-center">
          <Reveal>
            <RumahlLogo className="mx-auto h-12 w-auto text-foreground" />
            <div className="mt-10 space-y-4">
              <p className="text-2xl sm:text-3xl font-bold tracking-[-0.02em] text-foreground leading-snug">
                The apps are <span className="text-primary">the residents</span>.
              </p>
              <p className="text-2xl sm:text-3xl font-bold tracking-[-0.02em] text-foreground leading-snug">
                ORA is <span className="text-primary">the assistant</span>.
              </p>
              <p className="text-2xl sm:text-3xl font-bold tracking-[-0.02em] text-foreground leading-snug">
                And the OS itself is <span className="text-primary">the house</span>.
              </p>
            </div>
            <p className="mx-auto mt-8 max-w-lg text-base text-muted-foreground leading-relaxed">
              A home for everything at home — built from a much smaller idea.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Button size="lg" asChild>
                <Link href="/docs">
                  <Sparkles className="mr-2 h-4 w-4" />
                  Get Started
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="/about">
                  <RumahlIcon className="mr-2 h-4 w-auto" />
                  Back to the name
                </Link>
              </Button>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
