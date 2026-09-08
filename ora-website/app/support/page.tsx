import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Github,
  LifeBuoy,
  Mail,
  MessagesSquare,
  Sparkles,
} from "lucide-react";
import { Reveal } from "@/components/reveal";
import { Badge } from "@/components/ui/badge";
import { SupportSearch } from "@/components/support/support-search";
import { BrowseArticles, FeaturedArticles } from "@/components/support/support-browse";
import { faqItems } from "@/lib/support-faq";
import { supportArticles } from "@/lib/support-articles";
import { docsArticles } from "@/lib/docs-data";
import { company } from "@/lib/legal/company";

export const metadata: Metadata = {
  title: "Support",
  description:
    "Get help with rumahl OS — guides, documentation, how-to's and app development, available in English and German.",
};

export default function SupportPage() {
  const combinedPool = [...supportArticles, ...docsArticles];

  return (
    <>
      {/* ═══════════ HERO ═══════════ */}
      <section className="relative overflow-hidden pt-24 pb-16 lg:pt-32 lg:pb-20">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `
              radial-gradient(ellipse 60% 50% at 50% -5%, hsl(var(--primary) / 0.22), transparent 62%),
              radial-gradient(ellipse 45% 40% at 82% 5%, hsl(var(--ai-glow-teal) / 0.14), transparent 60%),
              radial-gradient(ellipse 40% 35% at 12% 28%, hsl(var(--accent) / 0.10), transparent 55%),
              radial-gradient(ellipse 55% 45% at 50% 115%, hsl(var(--primary) / 0.12), transparent 65%),
              radial-gradient(ellipse 30% 25% at 90% 90%, hsl(var(--ai-glow-purple) / 0.08), transparent 60%)`,
          }}
        />
        <div
          className="absolute inset-0 pointer-events-none opacity-70"
          style={{
            backgroundImage:
              "radial-gradient(hsl(var(--primary) / 0.26) 1px, transparent 1px)",
            backgroundSize: "26px 26px",
            maskImage:
              "radial-gradient(ellipse 75% 65% at 50% 0%, black 30%, transparent 82%)",
            WebkitMaskImage:
              "radial-gradient(ellipse 75% 65% at 50% 0%, black 30%, transparent 82%)",
          }}
        />
        <div className="absolute top-16 left-1/2 -translate-x-[340px] h-56 w-56 rounded-full bg-primary/15 blur-[90px] pointer-events-none" />
        <div className="absolute top-32 right-[12%] h-44 w-44 rounded-full bg-teal-400/10 blur-[80px] pointer-events-none" />

        <div className="mx-auto max-w-4xl px-6 lg:px-10 relative text-center">
          <Reveal>
            <Badge
              variant="accent"
              className="mb-6 border-primary/30 bg-primary/10 text-primary"
            >
              <LifeBuoy className="h-3 w-3 mr-1.5" />
              Support · Hilfe
            </Badge>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-[-0.03em] text-foreground leading-[1.05] mb-5">
              How can we <span className="gradient-text">help</span> you?
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed mb-10">
              Support, documentation, how-to&apos;s and app development — every
              article available in English and German.
            </p>

            <div className="rounded-3xl bg-gradient-to-b from-primary/10 via-transparent to-transparent p-1.5 sm:p-2">
              <SupportSearch pool={combinedPool} />
            </div>

            {/* Schnellzugriff */}
            <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
              <span className="text-xs text-muted-foreground/70 mr-1">
                Popular:
              </span>
              {[
                { label: "Installation", slug: "installing-rumahl-os" },
                { label: "ORA AI", slug: "setting-up-ora" },
                { label: "Backups", slug: "backing-up-your-system" },
                { label: "Remote access", slug: "remote-access" },
                { label: "First app", slug: "building-your-first-app" },
              ].map((topic) => (
                <Link
                  key={topic.label}
                  href={`/support/guides/${topic.slug}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/8 px-3.5 py-1.5 text-xs font-medium text-foreground/85 hover:border-primary/50 hover:bg-primary/15 hover:text-primary transition-colors"
                >
                  <ArrowRight className="h-3 w-3 text-primary" />
                  {topic.label}
                </Link>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ═══════════ FEATURED ═══════════ */}
      <section className="pb-20">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <Reveal className="text-center mb-10">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mb-3">
              Featured <span className="gradient-text">guides</span>
            </h2>
            <p className="text-sm text-muted-foreground max-w-xl mx-auto">
              The most helpful articles — picked by our team, updated with
              every release.
            </p>
          </Reveal>
          <FeaturedArticles />
        </div>
      </section>

      {/* ═══════════ BROWSE ALL ═══════════ */}
      <section className="pb-20 lg:pb-24 bg-[hsl(var(--surface))] border-y border-border/50">
        <div className="mx-auto max-w-7xl px-6 lg:px-8 py-16 lg:py-20">
          <div className="flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4 mb-8">
            <Reveal>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mb-2">
                Browse all <span className="gradient-text">articles</span>
              </h2>
              <p className="text-sm text-muted-foreground">
                Everything we&apos;ve written — sorted by area and category, so
                you find what you need fast.
              </p>
            </Reveal>
            <Reveal delay={100}>
              <Link
                href="/docs"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:gap-2.5 transition-all"
              >
                <BookOpen className="h-4 w-4" />
                Full documentation
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Reveal>
          </div>
          <BrowseArticles />
        </div>
      </section>

      {/* ═══════════ FAQ ═══════════ */}
      <section className="py-20 lg:py-24">
        <div className="mx-auto max-w-3xl px-6 lg:px-10">
          <Reveal className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mb-3">
              Frequently asked <span className="gradient-text">questions</span>
            </h2>
            <p className="text-sm text-muted-foreground">
              The things everyone asks — answered honestly.
            </p>
          </Reveal>

          <div className="space-y-3">
            {faqItems.map((item, i) => (
              <Reveal key={item.question} delay={i * 40}>
                <details className="group rounded-2xl border border-border/30 bg-card/30 open:border-primary/25 open:bg-card/50 transition-colors">
                  <summary className="flex items-center justify-between gap-4 cursor-pointer list-none px-5 sm:px-6 py-4 select-none">
                    <span className="text-[15px] font-semibold text-foreground">
                      {item.question}
                    </span>
                    <span className="relative h-5 w-5 shrink-0">
                      <span className="absolute inset-0 flex items-center justify-center text-primary transition-transform duration-300 group-open:rotate-45">
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 16 16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                        >
                          <path d="M8 2v12M2 8h12" />
                        </svg>
                      </span>
                    </span>
                  </summary>
                  <div className="px-5 sm:px-6 pb-5">
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {item.answer}
                    </p>
                  </div>
                </details>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════ CONTACT ═══════════ */}
      <section className="pb-24 lg:pb-32">
        <div className="mx-auto max-w-6xl px-6 lg:px-10">
          <Reveal>
            <div className="relative overflow-hidden rounded-3xl border border-border/30 bg-card/50 p-8 sm:p-12 text-center">
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  background:
                    "radial-gradient(ellipse 60% 60% at 50% 0%, hsl(var(--primary) / 0.08), transparent 70%)",
                }}
              />
              <div className="relative">
                <Sparkles className="mx-auto h-8 w-8 text-primary mb-4" strokeWidth={1.8} />
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mb-3">
                  Still stuck?
                </h2>
                <p className="text-sm text-muted-foreground max-w-xl mx-auto mb-10 leading-relaxed">
                  Our community and team are happy to help. Choose whatever
                  channel fits you best.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl mx-auto">
                  {[
                    {
                      icon: Github,
                      title: "GitHub Discussions",
                      text: "Ask the community, share ideas, report bugs.",
                      href: "https://github.com/rumahl",
                      action: "Open GitHub",
                    },
                    {
                      icon: MessagesSquare,
                      title: "Community",
                      text: "Guides, tips and answers from other rumahl users.",
                      href: "/community",
                      action: "Visit Community",
                    },
                    {
                      icon: Mail,
                      title: "Email us",
                      text: "For anything personal — we reply to every message.",
                      href: `mailto:${company.supportEmail}`,
                      action: company.supportEmail,
                    },
                  ].map((channel, i) => (
                    <Reveal key={channel.title} delay={i * 80}>
                      <a
                        href={channel.href}
                        target={channel.href.startsWith("http") ? "_blank" : undefined}
                        rel={channel.href.startsWith("http") ? "noopener noreferrer" : undefined}
                        className="surface-card-interactive group h-full p-6 flex flex-col items-start text-left"
                      >
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 text-primary mb-4 group-hover:scale-110 transition-transform duration-300">
                          <channel.icon className="h-5 w-5" strokeWidth={1.8} />
                        </div>
                        <h3 className="text-sm font-semibold text-foreground mb-1.5">
                          {channel.title}
                        </h3>
                        <p className="text-xs text-muted-foreground leading-relaxed mb-4 flex-1">
                          {channel.text}
                        </p>
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                          {channel.action}
                          <ArrowRight className="h-3 w-3 group-hover:translate-x-0.5 transition-transform" />
                        </span>
                      </a>
                    </Reveal>
                  ))}
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
