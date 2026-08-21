import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarDays, Clock, PenLine } from "lucide-react";
import { Reveal } from "@/components/reveal";
import { Badge } from "@/components/ui/badge";
import { blogPosts } from "@/lib/blog-data";

export const metadata: Metadata = {
  title: "Blog",
  description:
    "Stories, ideas and updates from the rumahl team — about home operating systems, local-first AI and the platform we're building.",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default function BlogPage() {
  const [featured, ...rest] = blogPosts;

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
              <PenLine className="h-3 w-3 mr-1.5" />
              Blog
            </Badge>
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-foreground mb-4">
              Notes from the <span className="gradient-text">home</span>
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Stories, ideas and updates from the rumahl team — about home
              operating systems, local-first AI and the platform we&apos;re
              building.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ═══════════ FEATURED ═══════════ */}
      <section className="pb-20">
        <div className="mx-auto max-w-6xl px-6 lg:px-10">
          <Reveal>
            <Link
              href={`/blog/${featured.slug}`}
              className="surface-card-interactive group block p-8 sm:p-10 relative overflow-hidden"
            >
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  background:
                    "radial-gradient(ellipse 50% 80% at 90% 0%, hsl(var(--primary) / 0.07), transparent 60%)",
                }}
              />
              <div className="relative">
                <div className="flex flex-wrap items-center gap-3 mb-4">
                  <Badge variant="accent">{featured.category}</Badge>
                  <span className="text-xs text-muted-foreground">
                    Featured · Latest
                  </span>
                </div>
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mb-3 group-hover:text-primary transition-colors">
                  {featured.title}
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl mb-6">
                  {featured.excerpt}
                </p>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground mb-6">
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarDays className="h-3.5 w-3.5" />
                    {formatDate(featured.date)}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    {featured.readTime} read
                  </span>
                </div>
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-primary">
                  Read the article
                  <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                </span>
              </div>
            </Link>
          </Reveal>
        </div>
      </section>

      {/* ═══════════ POSTS ═══════════ */}
      <section className="pb-24 lg:pb-28">
        <div className="mx-auto max-w-6xl px-6 lg:px-10">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {rest.map((post, i) => (
              <Reveal key={post.slug} delay={i * 80}>
                <Link
                  href={`/blog/${post.slug}`}
                  className="surface-card-interactive group h-full p-7 flex flex-col"
                >
                  <div className="flex items-center gap-2.5 mb-4">
                    <Badge variant="accent">{post.category}</Badge>
                    <span className="text-[11px] text-muted-foreground">
                      {formatDate(post.date)}
                    </span>
                  </div>
                  <h2 className="text-lg font-bold tracking-tight text-foreground mb-2 group-hover:text-primary transition-colors leading-snug">
                    {post.title}
                  </h2>
                  <p className="text-sm text-muted-foreground leading-relaxed mb-5 flex-1">
                    {post.excerpt}
                  </p>
                  <span className="inline-flex items-center justify-between text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5" />
                      {post.readTime} read
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 text-primary opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
                  </span>
                </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
