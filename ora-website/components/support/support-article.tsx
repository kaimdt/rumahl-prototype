"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock,
  Languages,
  Lightbulb,
  ListTree,
  Play,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  articleAreas,
  getCategory,
  getCategoryLabel,
  getCombinedByArea,
  supportArticles,
  type ArticleBlock,
  type SupportArticle,
} from "@/lib/support-articles";
import { InlineText } from "@/lib/markdown/inline-text";
import { CodeBlock } from "@/components/markdown/code-block";

const LANG_META = { de: "DE", en: "EN" } as const;
type Lang = keyof typeof LANG_META;

function formatDate(iso: string, lang: Lang): string {
  try {
    return new Date(iso).toLocaleDateString(lang === "de" ? "de-DE" : "en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

/* ─────────── Block renderer ─────────── */

function Block({ block, lang }: { block: ArticleBlock; lang: Lang }) {
  if (block.type === "h2") {
    return null; // rendered as section headings with anchors
  }
  if (block.type === "h3") {
    return (
      <h3 className="pt-2 text-lg font-bold tracking-tight text-foreground">
        <InlineText text={block.text} />
      </h3>
    );
  }
  if (block.type === "p") {
    return (
      <p className="text-[15px] leading-[1.8] text-foreground/80">
        <InlineText text={block.text} />
      </p>
    );
  }
  if (block.type === "ul") {
    return (
      <ul className="space-y-2.5">
        {block.items.map((item, i) => (
          <li key={i} className="flex gap-3 text-[15px] leading-[1.8] text-foreground/80">
            <span className="mt-[10px] h-1.5 w-1.5 rounded-full bg-primary/70 shrink-0" />
            <span>
              <InlineText text={item} />
            </span>
          </li>
        ))}
      </ul>
    );
  }
  if (block.type === "steps") {
    return (
      <ol className="space-y-4">
        {block.items.map((item, i) => (
          <li key={i} className="flex gap-4 text-[15px] leading-[1.8] text-foreground/80">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 font-mono text-xs font-bold text-primary">
              {i + 1}
            </span>
            <span className="pt-1">
              <InlineText text={item} />
            </span>
          </li>
        ))}
      </ol>
    );
  }
  if (block.type === "tip") {
    return (
      <div className="flex gap-3 rounded-2xl border border-accent/25 bg-accent/8 px-5 py-4">
        <Lightbulb className="h-5 w-5 text-accent shrink-0 mt-0.5" strokeWidth={1.8} />
        <p className="text-[14px] leading-relaxed text-foreground/75">
          <InlineText text={block.text} />
        </p>
      </div>
    );
  }
  if (block.type === "code") {
    return <CodeBlock code={block.text} lang={block.lang} uiLang={lang} />;
  }
  if (block.type === "table") {
    return (
      <div className="overflow-x-auto rounded-2xl border border-border/50">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border/50 bg-muted/30">
              {block.headers.map((header, i) => (
                <th
                  key={i}
                  className={cn(
                    "px-4 py-3 font-semibold text-foreground/90",
                    block.align?.[i] === "center" && "text-center",
                    block.align?.[i] === "right" && "text-right"
                  )}
                >
                  <InlineText text={header} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, r) => (
              <tr key={r} className="border-b border-border/30 last:border-0">
                {row.map((cell, c) => (
                  <td
                    key={c}
                    className={cn(
                      "px-4 py-3 text-foreground/75 align-top",
                      c === 0 && "font-medium text-foreground/90",
                      block.align?.[c] === "center" && "text-center",
                      block.align?.[c] === "right" && "text-right"
                    )}
                  >
                    <InlineText text={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (block.type === "image") {
    return (
      <figure className="rounded-2xl border border-border/50 bg-card/50 p-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={block.src}
          alt={block.alt}
          className="w-full rounded-xl object-cover"
          loading="lazy"
        />
        {block.caption && (
          <figcaption className="px-3 py-2.5 text-center text-xs text-muted-foreground">
            {block.caption}
          </figcaption>
        )}
      </figure>
    );
  }
  // video
  return (
    <figure className="rounded-2xl border border-border/50 bg-card/50">
      <div className="flex aspect-video items-center justify-center rounded-t-2xl bg-muted/30">
        <Play className="h-8 w-8 text-muted-foreground/40" />
      </div>
      {block.caption && (
        <figcaption className="px-4 py-3 text-center text-xs text-muted-foreground">
          {block.caption}
        </figcaption>
      )}
    </figure>
  );
}

/* ─────────── Section id helper ─────────── */

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/* ─────────── Sidebar tree (collapsible) ─────────── */

function TreeNav({
  currentSlug,
  lang,
  articles,
}: {
  currentSlug: string;
  lang: Lang;
  articles: SupportArticle[];
}) {
  const byArea = useMemo(() => getCombinedByArea(articles), [articles]);
  // The current article comes from the pool actually shown in the tree
  // (docs pages pass docs articles, support pages pass support guides).
  const currentArticle = useMemo(
    () => articles.find((a) => a.slug === currentSlug),
    [articles, currentSlug]
  );
  const currentCategoryId = currentArticle?.categoryId;
  const currentArea = useMemo(
    () => getCategory(currentCategoryId ?? "")?.area,
    [currentCategoryId]
  );

  // Default: only the current article's area and category are open.
  const [openAreas, setOpenAreas] = useState<Set<string>>(
    () => new Set(currentArea ? [currentArea] : [])
  );
  const [openCategories, setOpenCategories] = useState<Set<string>>(
    () => new Set(currentCategoryId ? [currentCategoryId] : [])
  );

  // Keep the current area/category open when navigating between articles.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      if (currentArea) {
        setOpenAreas((prev) => {
          if (prev.has(currentArea)) return prev;
          const next = new Set(prev);
          next.add(currentArea);
          return next;
        });
      }
      if (currentCategoryId) {
        setOpenCategories((prev) => {
          if (prev.has(currentCategoryId)) return prev;
          const next = new Set(prev);
          next.add(currentCategoryId);
          return next;
        });
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [currentArea, currentCategoryId]);

  const toggleArea = (area: string) => {
    setOpenAreas((prev) => {
      const next = new Set(prev);
      if (next.has(area)) next.delete(area);
      else next.add(area);
      return next;
    });
  };

  const toggleCategory = (id: string) => {
    setOpenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <nav aria-label="Support navigation" className="space-y-1.5">
      {byArea.map(({ area, categories }) => {
        const areaOpen = openAreas.has(area);
        const areaActive = area === currentArea;
        const total = categories.reduce((n, c) => n + c.articles.length, 0);

        return (
          <div key={area}>
            {/* Area header — collapsible */}
            <button
              onClick={() => toggleArea(area)}
              aria-expanded={areaOpen}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] font-bold uppercase tracking-wider transition-colors",
                areaActive
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <ChevronRight
                className={cn(
                  "h-3.5 w-3.5 shrink-0 transition-transform duration-200",
                  areaOpen && "rotate-90",
                  areaActive && "text-primary"
                )}
              />
              <span className="flex-1 truncate">{articleAreas[area].label[lang]}</span>
              <span className="rounded-full bg-muted/50 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
                {total}
              </span>
            </button>

            {/* Categories of this area */}
            {areaOpen && (
              <div className="mt-0.5 space-y-0.5 border-l border-border/40 ml-[15px] pl-2.5">
                {categories.map(({ category, articles }) => {
                  const catOpen = openCategories.has(category.id);
                  const catActive = category.id === currentCategoryId;
                  return (
                    <div key={category.id}>
                      <button
                        onClick={() => toggleCategory(category.id)}
                        aria-expanded={catOpen}
                        className={cn(
                          "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[12px] font-semibold transition-colors",
                          catActive
                            ? "bg-gradient-to-r from-primary/20 to-primary/5 text-primary font-bold"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                        )}
                      >
                        <ChevronRight
                          className={cn(
                            "h-3 w-3 shrink-0 transition-transform duration-200",
                            catOpen && "rotate-90",
                            catActive && "text-primary"
                          )}
                        />
                        <span className="flex-1 truncate">{category.label[lang]}</span>
                        <span className="text-[10px] font-medium tabular-nums text-muted-foreground/60">
                          {articles.length}
                        </span>
                      </button>

                      {/* Articles of this category */}
                      {catOpen && (
                        <ul className="mt-0.5 space-y-0.5 border-l border-border/40 ml-[13px] pl-2">
                          {articles.map((article) => {
                            const active = article.slug === currentSlug;
                            const href = `${article.basePath ?? "/support/guides"}/${article.slug}`;
                            return (
                              <li key={href}>
                                <Link
                                  href={href}
                                  className={cn(
                                    "flex items-center gap-2 rounded-lg py-1.5 pl-2 pr-2 text-[12.5px] leading-snug transition-all",
                                    active
                                      ? "bg-gradient-to-r from-primary/30 via-primary/15 to-primary/5 text-primary font-bold shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.3)]"
                                      : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                                  )}
                                  aria-current={active ? "page" : undefined}
                                >
                                  <span
                                    className={cn(
                                      "h-1.5 w-1.5 shrink-0 rounded-full transition-colors",
                                      active ? "bg-primary" : "bg-transparent"
                                    )}
                                  />
                                  <span className="truncate">{article.title[lang]}</span>
                                </Link>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

/* ─────────── On this page (TOC) ─────────── */

function OnThisPage({
  sections,
  activeId,
  lang,
}: {
  sections: { id: string; title: string }[];
  activeId: string;
  lang: Lang;
}) {
  if (sections.length === 0) return null;
  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/80 mb-3">
        {lang === "de" ? "Auf dieser Seite" : "On this page"}
      </p>
      <nav aria-label="On this page">
        <ul className="space-y-1">
          {sections.map((section) => {
            const active = activeId === section.id;
            return (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-[12.5px] leading-snug transition-all",
                    active
                      ? "bg-primary text-primary-foreground font-bold shadow-md shadow-primary/30"
                      : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                  )}
                  aria-current={active ? "location" : undefined}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full transition-colors",
                      active ? "bg-white" : "bg-muted-foreground/40"
                    )}
                  />
                  {section.title}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

/* ─────────── Main component ─────────── */

export function SupportArticleView({
  article,
  prev,
  next,
  tree = supportArticles,
}: {
  article: SupportArticle;
  prev?: SupportArticle;
  next?: SupportArticle;
  /** Articles shown in the left tree — pass the combined pool for docs. */
  tree?: SupportArticle[];
}) {
  const [lang, setLang] = useState<Lang>("en");
  const [activeId, setActiveId] = useState("");

  // 1. `?lang=` query param wins, 2. saved preference (shared with legal pages)
  useEffect(() => {
    const applyLang = () => {
      const param = new URLSearchParams(window.location.search).get("lang");
      if (param === "de" || param === "en") {
        setLang(param);
        return;
      }
      const saved = window.localStorage.getItem("rumahl-legal-lang");
      if (saved === "de" || saved === "en") {
        setLang(saved);
        return;
      }
    };
    const raf = requestAnimationFrame(applyLang);
    return () => cancelAnimationFrame(raf);
  }, []);

  const selectLang = (nextLang: Lang) => {
    setLang(nextLang);
    try {
      window.localStorage.setItem("rumahl-legal-lang", nextLang);
    } catch {
      /* private mode — ignore */
    }
  };

  const content = article.content[lang];
  const categoryLabel = getCategoryLabel(article.categoryId, lang);
  const isDocs = article.basePath?.startsWith("/docs") === true;

  // Section headings → "On This Page" entries
  const sections = useMemo(() => {
    const seen = new Map<string, number>();
    return content
      .filter((b): b is { type: "h2"; text: string } => b.type === "h2")
      .map((b) => {
        const base = slugify(b.text) || "section";
        const count = seen.get(base) ?? 0;
        seen.set(base, count + 1);
        return { id: count === 0 ? base : `${base}-${count + 1}`, title: b.text };
      });
  }, [content]);

  // Scrollspy for "On This Page"
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveId(entry.target.id);
        }
      },
      { rootMargin: "-96px 0px -70% 0px", threshold: 0 }
    );
    const els = document.querySelectorAll<HTMLElement>("[data-article-section]");
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [lang, sections]);

  return (
    <div className="mx-auto max-w-[88rem] px-4 sm:px-6 lg:px-8 py-10 lg:py-14">
      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
        <Link
          href={isDocs ? "/docs" : "/support"}
          className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {lang === "de"
            ? isDocs
              ? "Zurück zur Docs-Übersicht"
              : "Zurück zum Support"
            : isDocs
              ? "Back to Docs Overview"
              : "Back to Support"}
        </Link>
        <div className="inline-flex items-center rounded-full border border-border/60 bg-card p-1">
          <Languages className="h-3.5 w-3.5 text-muted-foreground ml-2 mr-1" />
          {(Object.keys(LANG_META) as Lang[]).map((l) => (
            <button
              key={l}
              onClick={() => selectLang(l)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                lang === l
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
              aria-pressed={lang === l}
            >
              {LANG_META[l]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid lg:grid-cols-12 gap-10 items-start">
        {/* ── Left: tree navigation ── */}
        <aside className="hidden lg:block lg:col-span-3 lg:sticky lg:top-24 max-h-[calc(100vh-8rem)] overflow-y-auto pr-2">
          <TreeNav currentSlug={article.slug} lang={lang} articles={tree} />
        </aside>

        {/* ── Center: article ── */}
        <article className="lg:col-span-9 xl:col-span-7 min-w-0">
          {/* Mobile tree */}
          <details className="xl:hidden mb-8 rounded-2xl border border-border/30 bg-card/40 px-4 py-3">
            <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-foreground select-none">
              <ListTree className="h-4 w-4 text-primary" />
              {lang === "de" ? "Alle Artikel" : "All articles"}
              <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground group-open:rotate-90 transition-transform" />
            </summary>
            <div className="mt-4 max-h-72 overflow-y-auto">
              <TreeNav currentSlug={article.slug} lang={lang} articles={tree} />
            </div>
          </details>

          {/* Header with dot pattern (experimental try-out) */}
          <div className="relative -mx-2 sm:-mx-4 lg:-mx-6 px-2 sm:px-4 lg:px-6 pt-6 pb-2 overflow-hidden rounded-3xl">
            <div
              className="absolute inset-0 pointer-events-none opacity-70"
              style={{
                backgroundImage:
                  "radial-gradient(hsl(var(--ai-glow-teal) / 0.30) 1px, transparent 1px)",
                backgroundSize: "26px 26px",
                maskImage:
                  "radial-gradient(ellipse 90% 85% at 50% 0%, black 30%, transparent 82%)",
                WebkitMaskImage:
                  "radial-gradient(ellipse 90% 85% at 50% 0%, black 30%, transparent 82%)",
              }}
            />
            <div className="absolute -top-20 left-1/2 -translate-x-1/2 h-40 w-[30rem] max-w-full rounded-full bg-primary/8 blur-[90px] pointer-events-none" />
            <header className="relative mb-10">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-3">
              {categoryLabel}
            </p>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground mb-4 leading-[1.1]">
              {article.title[lang]}
            </h1>
            <p className="text-base text-muted-foreground leading-relaxed max-w-2xl mb-5">
              {article.excerpt[lang]}
            </p>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                {article.readTime} {lang === "de" ? "Lesezeit" : "read"}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5" />
                {lang === "de" ? "Aktualisiert" : "Updated"}:{" "}
                {formatDate(article.updated, lang)}
              </span>
            </div>
            </header>
          </div>

          {/* Content with section headings */}
          <div className="space-y-6">
            {content.map((block, i) => {
              if (block.type === "h2") {
                const sectionIndex = sections.findIndex((s) => s.title === block.text);
                const id = sections[sectionIndex]?.id ?? `section-${i}`;
                return (
                  <h2
                    key={i}
                    id={id}
                    data-article-section
                    className="scroll-mt-28 pt-4 text-xl sm:text-2xl font-bold tracking-tight text-foreground"
                  >
                    {block.text}
                  </h2>
                );
              }
              return <Block key={i} block={block} lang={lang} />;
            })}
          </div>

          {/* Mobile "On This Page" */}
          {sections.length > 0 && (
            <details className="xl:hidden mt-10 rounded-2xl border border-border/30 bg-card/40 px-4 py-3">
              <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-foreground select-none">
                {lang === "de" ? "Auf dieser Seite" : "On this page"}
              </summary>
              <div className="mt-3">
                <OnThisPage sections={sections} activeId={activeId} lang={lang} />
              </div>
            </details>
          )}

          {/* Prev / Next */}
          {(prev || next) && (
            <nav
              aria-label={lang === "de" ? "Artikel-Navigation" : "Article navigation"}
              className="mt-14 grid sm:grid-cols-2 gap-3 border-t border-border/40 pt-8"
            >
              {prev ? (
                <Link
                  href={`${prev.basePath ?? "/support/guides"}/${prev.slug}`}
                  className="surface-card-interactive group p-5"
                >
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
                    ← {lang === "de" ? "Vorheriges Thema" : "Previous topic"}
                  </p>
                  <p className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors leading-snug">
                    {prev.title[lang]}
                  </p>
                </Link>
              ) : (
                <span />
              )}
              {next ? (
                <Link
                  href={`${next.basePath ?? "/support/guides"}/${next.slug}`}
                  className="surface-card-interactive group p-5 text-right"
                >
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
                    {lang === "de" ? "Nächstes Thema" : "Next topic"} →
                  </p>
                  <p className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors leading-snug">
                    {next.title[lang]}
                  </p>
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}

          {/* Feedback */}
          <div className="mt-10 rounded-2xl border border-border/50 bg-card/50 p-6 text-center">
            <CheckCircle2 className="mx-auto h-6 w-6 text-success mb-2" strokeWidth={1.8} />
            <p className="text-sm text-muted-foreground">
              {lang === "de" ? (
                <>
                  Konnte der Artikel dein Problem nicht lösen?{" "}
                  <Link href="/contact" className="text-primary hover:underline">
                    Schreib uns
                  </Link>{" "}
                  — wir helfen gerne.
                </>
              ) : (
                <>
                  Didn&apos;t solve your problem?{" "}
                  <Link href="/contact" className="text-primary hover:underline">
                    Contact us
                  </Link>{" "}
                  — we&apos;re happy to help.
                </>
              )}
            </p>
          </div>
        </article>

        {/* ── Right: On this page ── */}
        <aside className="hidden xl:block xl:col-span-2 xl:sticky xl:top-24">
          <OnThisPage sections={sections} activeId={activeId} lang={lang} />
          <div className="mt-8 rounded-2xl border border-border/30 bg-card/30 p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70 mb-2">
              {lang === "de" ? "Noch Fragen?" : "Still have questions?"}
            </p>
            <Link
              href="/support"
              className="text-[13px] font-medium text-primary hover:underline"
            >
              {lang === "de" ? "Alle Support-Themen" : "All support topics"} →
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
