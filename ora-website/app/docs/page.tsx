import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpen, LifeBuoy, Wrench } from "lucide-react";
import { Reveal } from "@/components/reveal";
import { Badge } from "@/components/ui/badge";
import { SupportSearch } from "@/components/support/support-search";
import { BrowseArticles, FeaturedArticles } from "@/components/support/support-browse";
import { docsArticles } from "@/lib/docs-data";
import { supportArticles } from "@/lib/support-articles";

export const metadata: Metadata = {
  title: "Documentation",
  description:
    "The rumahl documentation — installation, architecture, API reference, security model and app development. Written in Markdown, available in English and German.",
};

const docsFeaturedSlugs = [
  "installation",
  "quick-start",
  "rumahl-developers",
  "developer-api",
  "oauth-identity",
  "sdks-integration",
  "architecture",
  "api-reference",
  "security-model",
  "app-development",
];

export default function DocsPage() {
  const combinedPool = [...supportArticles, ...docsArticles];

  return (
    <>
      {/* ═══════════ HERO ═══════════ */}
      <section className="relative overflow-hidden pt-24 pb-16 lg:pt-32 lg:pb-20">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `
              radial-gradient(ellipse 60% 50% at 50% -5%, hsl(var(--ai-glow-teal) / 0.18), transparent 62%),
              radial-gradient(ellipse 45% 40% at 82% 5%, hsl(var(--primary) / 0.16), transparent 60%),
              radial-gradient(ellipse 40% 35% at 12% 28%, hsl(var(--accent) / 0.09), transparent 55%),
              radial-gradient(ellipse 55% 45% at 50% 115%, hsl(var(--ai-glow-teal) / 0.10), transparent 65%)`,
          }}
        />
        <div
          className="absolute inset-0 pointer-events-none opacity-70"
          style={{
            backgroundImage:
              "radial-gradient(hsl(var(--ai-glow-teal) / 0.30) 1px, transparent 1px)",
            backgroundSize: "26px 26px",
            maskImage:
              "radial-gradient(ellipse 75% 65% at 50% 0%, black 30%, transparent 82%)",
            WebkitMaskImage:
              "radial-gradient(ellipse 75% 65% at 50% 0%, black 30%, transparent 82%)",
          }}
        />
        <div className="absolute top-16 left-1/2 -translate-x-[340px] h-56 w-56 rounded-full bg-teal-400/15 blur-[90px] pointer-events-none" />
        <div className="absolute top-32 right-[12%] h-44 w-44 rounded-full bg-primary/10 blur-[80px] pointer-events-none" />

        <div className="mx-auto max-w-4xl px-6 lg:px-10 relative text-center">
          <Reveal>
            <Badge variant="accent" className="mb-6 border-teal-400/30 bg-teal-400/10 text-teal-300">
              <BookOpen className="h-3 w-3 mr-1.5" />
              Documentation · Dokumentation
            </Badge>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-[-0.03em] text-foreground leading-[1.05] mb-5">
              The <span className="gradient-text">rumahl</span> documentation
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed mb-10">
              Installation, architecture, API reference, security model and
              app development — written in Markdown, available in English and
              German.
            </p>

            <div className="rounded-3xl bg-gradient-to-b from-teal-400/10 via-transparent to-transparent p-1.5 sm:p-2">
              <SupportSearch pool={combinedPool} />
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
              <span className="text-xs text-muted-foreground/70 mr-1">
                Quick links:
              </span>
              {[
                { label: "Installation", slug: "installation" },
                { label: "rumahl Developers", slug: "rumahl-developers" },
                { label: "OAuth & Identity", slug: "oauth-identity" },
                { label: "Developer API", slug: "developer-api" },
                { label: "SDKs & CI/CD", slug: "sdks-integration" },
                { label: "API Reference", slug: "api-reference" },
                { label: "Architecture", slug: "architecture" },
                { label: "App Development", slug: "app-development" },
              ].map((topic) => (
                <Link
                  key={topic.slug}
                  href={`/docs/guides/${topic.slug}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-teal-400/25 bg-teal-400/8 px-3.5 py-1.5 text-xs font-medium text-foreground/85 hover:border-teal-400/50 hover:bg-teal-400/15 hover:text-teal-300 transition-colors"
                >
                  <ArrowRight className="h-3 w-3 text-teal-300" />
                  {topic.label}
                </Link>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ═══════════ FEATURED DOCS ═══════════ */}
      <section className="pb-20">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <Reveal className="text-center mb-10">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mb-3">
              Featured <span className="gradient-text">documentation</span>
            </h2>
            <p className="text-sm text-muted-foreground max-w-xl mx-auto">
              The core documentation — everything you need to run, understand
              and extend rumahl.
            </p>
          </Reveal>
          <FeaturedArticles
            articles={docsArticles}
            featuredSlugs={docsFeaturedSlugs}
          />
        </div>
      </section>

      {/* ═══════════ BROWSE ALL ═══════════ */}
      <section className="pb-20 lg:pb-24 bg-[hsl(var(--surface))] border-y border-border/50">
        <div className="mx-auto max-w-7xl px-6 lg:px-8 py-16 lg:py-20">
          <Reveal className="mb-8">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mb-2">
              All <span className="gradient-text">documentation</span>
            </h2>
            <p className="text-sm text-muted-foreground">
              Every document — sorted by area and category.
            </p>
          </Reveal>
          <BrowseArticles articles={docsArticles} />
        </div>
      </section>

      {/* ═══════════ CTA ═══════════ */}
      <section className="py-20 lg:py-24">
        <div className="mx-auto max-w-4xl px-6 lg:px-10">
          <div className="grid sm:grid-cols-2 gap-4">
            <Reveal>
              <Link
                href="/support"
                className="surface-card-interactive group h-full p-6 sm:p-8 flex flex-col"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 text-primary mb-4 group-hover:scale-110 transition-transform duration-300">
                  <LifeBuoy className="h-5 w-5" strokeWidth={1.8} />
                </div>
                <h2 className="text-lg font-bold text-foreground mb-2">
                  Looking for help?
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed mb-4 flex-1">
                  The support center has friendly guides, a FAQ and direct
                  contact — for the moments you just want a quick answer.
                </p>
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-primary">
                  Visit Support
                  <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                </span>
              </Link>
            </Reveal>
            <Reveal delay={80}>
              <Link
                href="/sdks"
                className="surface-card-interactive group h-full p-6 sm:p-8 flex flex-col"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-teal-400/15 to-teal-400/5 text-teal-300 mb-4 group-hover:scale-110 transition-transform duration-300">
                  <Wrench className="h-5 w-5" strokeWidth={1.8} />
                </div>
                <h2 className="text-lg font-bold text-foreground mb-2">
                  Building for rumahl?
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed mb-4 flex-1">
                  The SDKs page has quickstarts for all six languages — and
                  the app development docs show the full platform surface.
                </p>
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-teal-300">
                  Explore the SDKs
                  <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                </span>
              </Link>
            </Reveal>
          </div>
        </div>
      </section>
    </>
  );
}
