"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Clock } from "lucide-react";
import {
  articleAreas,
  categoryCovers,
  getCategoryLabel,
  groupByArea,
  supportArticles,
  type ArticleArea,
  type SupportArticle,
} from "@/lib/support-articles";
import { cn } from "@/lib/utils";

type Lang = "de" | "en";

/** Shared language preference (same key as legal pages & article pages). */
function useArticleLang(): Lang {
  const [lang, setLang] = useState<Lang>("en");
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const saved = window.localStorage.getItem("rumahl-legal-lang");
      if (saved === "de" || saved === "en") setLang(saved);
    });
    return () => cancelAnimationFrame(raf);
  }, []);
  return lang;
}

const areaFilters: { key: ArticleArea | "all"; de: string; en: string }[] = [
  { key: "all", de: "Alle", en: "All" },
  { key: "support", de: "Support", en: "Support" },
  { key: "howto", de: "How-To's", en: "How-To's" },
  { key: "docs", de: "Dokumentation", en: "Documentation" },
  { key: "dev", de: "App-Entwicklung", en: "App Development" },
];

export function FeaturedArticles({
  articles = supportArticles,
  featuredSlugs = [
    "installing-rumahl-os",
    "app-permissions",
    "setting-up-ora",
    "backing-up-your-system",
    "remote-access",
    "device-unreachable",
    "architecture-overview",
    "building-your-first-app",
  ],
}: {
  articles?: SupportArticle[];
  /** Which slugs to feature — override for a docs-focused selection. */
  featuredSlugs?: string[];
}) {
  const lang = useArticleLang();
  // 6–8 prominent cards with cover, title and short description

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {featuredSlugs.map((slug, i) => {
        const article = articles.find((a) => a.slug === slug);
        if (!article) return null;
        return (
          <Link
            key={slug}
            href={`${article.basePath ?? "/support/guides"}/${slug}`}
            className="group surface-card-interactive overflow-hidden flex flex-col"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            {/* Cover */}
            <div
              className={cn(
                "relative h-28 bg-gradient-to-br overflow-hidden",
                categoryCovers[article.categoryId]
              )}
            >
              <div
                className="absolute inset-0 opacity-30"
                style={{
                  backgroundImage:
                    "radial-gradient(hsl(var(--primary) / 0.5) 1px, transparent 1px)",
                  backgroundSize: "18px 18px",
                }}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/30 group-hover:scale-110 group-hover:shadow-primary/50 transition-all duration-300">
                  <ArrowRight className="h-5 w-5" strokeWidth={2.2} />
                </div>
              </div>
              <span className="absolute top-3 left-3 glass rounded-full px-2.5 py-1 text-[10px] font-semibold text-foreground/85">
                {getCategoryLabel(article.categoryId, lang)}
              </span>
            </div>

            {/* Body */}
            <div className="p-5 flex flex-col flex-1">
              <h3 className="text-[15px] font-bold text-foreground leading-snug mb-2 group-hover:text-primary transition-colors">
                {article.title[lang]}
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed mb-4 line-clamp-3 flex-1">
                {article.excerpt[lang]}
              </p>
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/70">
                  <Clock className="h-3 w-3" />
                  {article.readTime}
                </span>
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary">
                  {lang === "de" ? "Lesen" : "Read"}
                  <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-1 transition-transform" />
                </span>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

export function BrowseArticles({
  articles = supportArticles,
}: {
  articles?: SupportArticle[];
}) {
  const lang = useArticleLang();
  const [filter, setFilter] = useState<ArticleArea | "all">("all");
  const byArea = groupByArea(articles);

  const visible = byArea.filter(
    (g) => filter === "all" || g.area === filter
  );

  return (
    <div>
      {/* Area filter chips */}
      <div className="flex flex-wrap items-center justify-center gap-2 mb-10">
        {areaFilters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              "rounded-full border px-4 py-1.5 text-xs font-semibold transition-colors",
              filter === f.key
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-border/60 bg-card/50 text-muted-foreground hover:text-foreground"
            )}
          >
            {lang === "de" ? f.de : f.en}
          </button>
        ))}
      </div>

      <div className="space-y-10">
        {visible.map(({ area, categories }) => (
          <section key={area}>
            <div className="flex items-baseline gap-3 mb-1">
              <h3 className="text-lg font-bold tracking-tight text-foreground">
                {articleAreas[area].label[lang]}
              </h3>
              <span className="text-xs text-muted-foreground">
                {articleAreas[area].description[lang]}
              </span>
            </div>

            <div className="mt-4 grid md:grid-cols-2 gap-x-6 gap-y-7">
              {categories.map(({ category, articles }) => (
                <div key={category.id}>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-2.5">
                    {category.label[lang]}
                  </p>
                  <ul className="space-y-1.5">
                    {articles.map((article) => (
                      <li key={article.slug}>
                        <Link
                          href={`${article.basePath ?? "/support/guides"}/${article.slug}`}
                          className="group flex items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 transition-all hover:border-border/60 hover:bg-card/70"
                        >
                          <span
                            className={cn(
                              "h-8 w-1.5 shrink-0 rounded-full bg-gradient-to-b",
                              categoryCovers[article.categoryId]
                            )}
                          />
                          <span className="flex-1 min-w-0">
                            <span className="block text-[13.5px] font-semibold text-foreground group-hover:text-primary transition-colors leading-snug">
                              {article.title[lang]}
                            </span>
                            <span className="block text-xs text-muted-foreground line-clamp-1">
                              {article.excerpt[lang]}
                            </span>
                          </span>
                          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/60 shrink-0">
                            {article.readTime}
                            <ArrowRight className="h-3.5 w-3.5 text-primary opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
