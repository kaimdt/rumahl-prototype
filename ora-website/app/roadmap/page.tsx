import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, GitBranch, Github, Map, Sparkles } from "lucide-react";
import { Reveal } from "@/components/reveal";
import { Badge } from "@/components/ui/badge";
import { RoadmapGrid } from "@/components/roadmap/roadmap-grid";
import { roadmapBacklog, roadmapPrinciples } from "@/lib/roadmap-data";

export const metadata: Metadata = {
  title: "Roadmap",
  description:
    "Where rumahl OS is going — from OS Foundation to user profiles, the App SDK, NAS storage and AI system operations. A live document, updated as packages ship.",
};

export default function RoadmapPage() {
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
              <Map className="h-3 w-3 mr-1.5" />
              Roadmap · Fahrplan
            </Badge>
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-foreground mb-4">
              From dashboard to <span className="gradient-text">home OS</span>
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Every package ships standalone value while building the
              foundation for the next. This is a live document — updated as
              packages ship.
            </p>

            {/* Summary chips */}
            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              {[
                { n: 10, label: "Packages" },
                { n: 4, label: "Complete" },
                { n: 6, label: "In progress" },
              ].map((s) => (
                <div
                  key={s.label}
                  className="rounded-2xl border border-border/60 bg-card/60 px-6 py-3"
                >
                  <p className="text-2xl font-bold text-foreground font-mono">
                    {s.n}
                  </p>
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wider">
                    {s.label}
                  </p>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ═══════════ PACKAGES ═══════════ */}
      <section className="pb-20">
        <div className="mx-auto max-w-6xl px-6 lg:px-10">
          <RoadmapGrid />
        </div>
      </section>

      {/* ═══════════ BACKLOG + PRINCIPLES ═══════════ */}
      <section className="pb-24 lg:pb-28 bg-[hsl(var(--surface))] border-y border-border/50">
        <div className="mx-auto max-w-6xl px-6 lg:px-10 py-16 lg:py-20 grid lg:grid-cols-2 gap-10">
          <Reveal>
            <h2 className="text-2xl font-bold tracking-tight text-foreground mb-6">
              Deferred <span className="gradient-text">backlog</span>
            </h2>
            <ul className="space-y-3">
              {roadmapBacklog.map((item) => (
                <li
                  key={item}
                  className="flex gap-3 rounded-xl border border-border/40 bg-card/40 px-4 py-3 text-sm text-foreground/80 leading-relaxed"
                >
                  <span className="mt-[7px] h-1.5 w-1.5 rounded-full bg-muted-foreground/50 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </Reveal>

          <Reveal delay={120}>
            <h2 className="text-2xl font-bold tracking-tight text-foreground mb-6">
              Guiding <span className="gradient-text">principles</span>
            </h2>
            <ul className="space-y-3">
              {roadmapPrinciples.map((item) => (
                <li
                  key={item}
                  className="flex gap-3 rounded-xl border border-border/40 bg-card/40 px-4 py-3 text-sm text-foreground/80 leading-relaxed"
                >
                  <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  {item}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </section>

      {/* ═══════════ CONTRIBUTE CTA ═══════════ */}
      <section className="py-20 lg:py-24">
        <div className="mx-auto max-w-2xl px-6 lg:px-10 text-center">
          <Reveal>
            <GitBranch className="mx-auto h-8 w-8 text-primary mb-4" strokeWidth={1.8} />
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mb-3">
              Want to help <span className="gradient-text">build it?</span>
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-lg mx-auto mb-8">
              Every package gets its own branch and its own docs page once it
              ships. Contributions, feedback and ideas are tracked openly on
              GitHub.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                href="https://github.com/rumahl"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary-hover transition-colors"
              >
                <Github className="h-4 w-4" />
                View on GitHub
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
