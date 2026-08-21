"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Search, X } from "lucide-react";
import {
  articleAreas,
  getCategory,
  getCategoryLabel,
  supportArticles,
  type SupportArticle,
} from "@/lib/support-articles";
import { cn } from "@/lib/utils";

type Lang = "de" | "en";

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function ArticleRow({
  article,
  active,
  lang,
}: {
  article: SupportArticle;
  active: boolean;
  lang: Lang;
}) {
  return (
    <Link
      href={`${article.basePath ?? "/support/guides"}/${article.slug}`}
      className={cn(
        "flex items-start gap-3 rounded-xl px-3 py-3 transition-colors",
        active ? "bg-muted/50" : "hover:bg-muted/30"
      )}
    >
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Search className="h-4 w-4" strokeWidth={1.8} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">{article.title[lang]}</p>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
          {article.excerpt[lang]}
        </p>
      </div>
      <span className="text-[11px] text-muted-foreground/60 shrink-0 mt-1 hidden sm:inline">
        {getCategoryLabel(article.categoryId, lang)}
      </span>
    </Link>
  );
}

export function SupportSearch({ pool = supportArticles }: { pool?: SupportArticle[] }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });
  const [lang, setLang] = useState<Lang>("en");
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Read the shared language preference (same key as legal pages)
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const saved = window.localStorage.getItem("rumahl-legal-lang");
      if (saved === "de" || saved === "en") setLang(saved);
      // Support Google Sitelinks Search Box (?q=...) — pre-fill and open
      // the results so the search action lands on a working search.
      const param = new URLSearchParams(window.location.search).get("q");
      if (param) {
        setQuery(param);
        setOpen(true);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const results = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return pool;
    return pool.filter((a) => {
      const category = getCategory(a.categoryId);
      const area = category ? articleAreas[category.area] : undefined;
      const haystack = normalize(
        [
          a.title.de,
          a.title.en,
          a.excerpt.de,
          a.excerpt.en,
          getCategoryLabel(a.categoryId, "de"),
          getCategoryLabel(a.categoryId, "en"),
          area?.label.de ?? "",
          area?.label.en ?? "",
        ].join(" ")
      );
      return haystack.includes(q);
    });
  }, [query, pool]);

  // Reset highlight when results change
  useEffect(() => {
    const raf = requestAnimationFrame(() => setHighlighted(0));
    return () => cancelAnimationFrame(raf);
  }, [query]);

  // Measure the input so the portal dropdown is positioned exactly below it
  const measure = () => {
    if (!wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    setPosition({ top: rect.bottom + 8, left: rect.left, width: rect.width });
  };

  useEffect(() => {
    if (!open || !query.trim()) return;
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [open, query]);

  // Cmd+K focus, Escape closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === "Escape") {
        setOpen(false);
        inputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const visible = open && query.trim().length > 0;

  return (
    <div ref={wrapRef} className="relative mx-auto max-w-2xl">
      <div
        className={cn(
          "relative flex items-center gap-3 rounded-2xl glass px-5 py-4 shadow-xl shadow-black/20 transition-all",
          visible
            ? "!border-primary/35 shadow-lg shadow-primary/10"
            : "hover:border-primary/30"
        )}
      >
        <Search className="h-5 w-5 text-primary shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlighted((h) => Math.min(h + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlighted((h) => Math.max(h - 1, 0));
            } else if (e.key === "Enter" && results[highlighted]) {
              const a = results[highlighted];
              window.location.href = `${a.basePath ?? "/support/guides"}/${a.slug}`;
            }
          }}
          placeholder="Search for help — e.g. “backup”, “install”, “ORA”…"
          className="flex-1 bg-transparent text-[15px] text-foreground placeholder:text-muted-foreground/60 outline-none"
          aria-label="Search support articles"
          autoComplete="off"
        />
        {query ? (
          <button
            onClick={() => setQuery("")}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        ) : (
          <kbd className="hidden sm:inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            Ctrl K
          </kbd>
        )}
      </div>

      {/* Dropdown — portal to body so nothing clips it */}
      {visible &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed z-50 overflow-hidden rounded-2xl bg-card/95 backdrop-blur-2xl border border-border/40 shadow-2xl shadow-black/40"
            style={{
              top: position.top,
              left: position.left,
              width: position.width,
            }}
            onMouseDown={(e) => e.preventDefault()}
            role="listbox"
            aria-label="Search results"
          >
            <div className="max-h-[340px] overflow-y-auto p-2">
              {results.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                  No results for “{query}” — try a different term or browse the
                  categories below.
                </p>
              ) : (
                results.map((article, i) => (
                  <div key={article.slug} onMouseEnter={() => setHighlighted(i)}>
                    <ArticleRow article={article} active={highlighted === i} lang={lang} />
                  </div>
                ))
              )}
            </div>
            <div className="border-t border-border/40 bg-muted/20 px-4 py-2 text-[11px] text-muted-foreground/60 flex items-center justify-between">
              <span>
                {results.length} {results.length === 1 ? "result" : "results"}
              </span>
              <span className="hidden sm:inline">
                <kbd className="mx-0.5">↑</kbd>
                <kbd className="mx-0.5">↓</kbd> navigate ·{" "}
                <kbd className="mx-0.5">↵</kbd> open ·{" "}
                <kbd className="mx-0.5">Esc</kbd> close
              </span>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
