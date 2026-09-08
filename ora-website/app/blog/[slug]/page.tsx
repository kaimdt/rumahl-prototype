import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, CalendarDays, Clock, PenLine } from "lucide-react";
import { Reveal } from "@/components/reveal";
import { Badge } from "@/components/ui/badge";
import { blogPosts } from "@/lib/blog-data";

export const dynamicParams = false;

export function generateStaticParams() {
  return blogPosts.map((post) => ({ slug: post.slug }));
}

export function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  return params.then(({ slug }) => {
    const post = blogPosts.find((p) => p.slug === slug);
    if (!post) return { title: "Post not found" };
    return {
      title: post.title,
      description: post.excerpt,
    };
  });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = blogPosts.find((p) => p.slug === slug);
  if (!post) notFound();

  const index = blogPosts.findIndex((p) => p.slug === post.slug);
  const next = blogPosts[(index + 1) % blogPosts.length];

  return (
    <article className="py-14 lg:py-20">
      <div className="mx-auto max-w-3xl px-6 lg:px-10">
        <Reveal>
          <Link
            href="/blog"
            className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors mb-10"
          >
            <ArrowLeft className="h-4 w-4" />
            All articles
          </Link>

          <header className="mb-10">
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <Badge variant="accent">{post.category}</Badge>
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5" />
                {formatDate(post.date)}
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                {post.readTime} read
              </span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground leading-[1.1] mb-4">
              {post.title}
            </h1>
            <p className="text-base text-muted-foreground flex items-center gap-2">
              <PenLine className="h-4 w-4 text-primary" />
              {post.author}
            </p>
          </header>

          <div className="space-y-6">
            {post.content.map((paragraph, i) => (
              <p
                key={i}
                className="text-[16px] leading-[1.8] text-foreground/80"
              >
                {paragraph}
              </p>
            ))}
          </div>

          {/* Next article */}
          <div className="mt-14 border-t border-border/40 pt-10">
            <Link
              href={`/blog/${next.slug}`}
              className="surface-card-interactive group block p-6"
            >
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Next article
              </p>
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-lg font-bold text-foreground group-hover:text-primary transition-colors">
                  {next.title}
                </h2>
                <ArrowRight className="h-5 w-5 text-primary shrink-0 group-hover:translate-x-1 transition-transform" />
              </div>
            </Link>
          </div>
        </Reveal>
      </div>
    </article>
  );
}
