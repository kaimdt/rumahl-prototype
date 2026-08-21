"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarDays, FileText, Languages, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BilingualDoc, LegalLang, LegalSection } from "@/lib/legal/types";
import { company } from "@/lib/legal/company";

const LANG_META: Record<LegalLang, { label: string; full: string }> = {
  de: { label: "DE", full: "Deutsch" },
  en: { label: "EN", full: "English" },
};

function formatDate(iso: string, lang: LegalLang): string {
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

function SectionContent({ section }: { section: LegalSection }) {
  return (
    <div className="space-y-4">
      {section.blocks.map((block, i) => {
        if (block.type === "p") {
          return (
            <p key={i} className="text-[15px] leading-relaxed text-foreground/80">
              {block.text}
            </p>
          );
        }
        if (block.type === "ul") {
          return (
            <ul key={i} className="space-y-2">
              {block.items.map((item, j) => (
                <li key={j} className="flex gap-3 text-[15px] leading-relaxed text-foreground/80">
                  <span className="mt-[9px] h-1.5 w-1.5 rounded-full bg-primary/70 shrink-0" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          );
        }
        if (block.type === "note") {
          return (
            <div
              key={i}
              className="rounded-xl border border-primary/20 bg-primary/5 px-5 py-4 text-[14px] leading-relaxed text-foreground/75"
            >
              {block.text}
            </div>
          );
        }
        // table
        return (
          <div key={i} className="overflow-x-auto rounded-xl border border-border/50">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border/50 bg-muted/30">
                  {block.headers.map((h) => (
                    <th key={h} className="px-4 py-3 font-semibold text-foreground/90">
                      {h}
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
                          "px-4 py-3 text-foreground/75",
                          c === 0 && "font-medium text-foreground/90"
                        )}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

interface LegalDocumentProps {
  de: BilingualDoc["de"];
  en: BilingualDoc["en"];
  /** Language shown first / default. Store documents default to "en". */
  defaultLang?: LegalLang;
  /** Label of the parent category, e.g. "Website Policies". */
  categoryLabel?: string;
}

export function LegalDocument({
  de,
  en,
  defaultLang = "de",
  categoryLabel,
}: LegalDocumentProps) {
  const [lang, setLang] = useState<LegalLang>(defaultLang);
  const [activeId, setActiveId] = useState<string>("");

  // 1. `?lang=` query param wins, 2. saved preference, 3. document default
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
  }, [defaultLang]);

  const doc = lang === "de" ? de : en;

  const selectLang = (next: LegalLang) => {
    setLang(next);
    try {
      window.localStorage.setItem("rumahl-legal-lang", next);
    } catch {
      /* private mode — ignore */
    }
  };

  // Scrollspy for the table of contents
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        }
      },
      { rootMargin: "-96px 0px -70% 0px", threshold: 0 }
    );
    const els = document.querySelectorAll<HTMLElement>("[data-legal-section]");
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [lang]);

  const toc = useMemo(() => doc.sections, [doc]);

  return (
    <div className="mx-auto max-w-6xl px-6 lg:px-10 py-14 lg:py-20">
      {/* Back link */}
      <Link
        href="/legal"
        className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors mb-10"
      >
        <ArrowLeft className="h-4 w-4" />
        {lang === "de" ? "Alle Rechtsdokumente" : "All legal documents"}
      </Link>

      <div className="grid lg:grid-cols-12 gap-10 lg:gap-14 items-start">
        {/* ─────────── Sidebar: meta + TOC ─────────── */}
        <aside className="lg:col-span-3 lg:sticky lg:top-24 space-y-6">
          {/* Language toggle */}
          <div className="inline-flex items-center rounded-full border border-border/60 bg-card p-1">
            <Languages className="h-3.5 w-3.5 text-muted-foreground ml-2 mr-1" />
            {(Object.keys(LANG_META) as LegalLang[]).map((l) => (
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
                {LANG_META[l].label}
              </button>
            ))}
          </div>

          <div className="hidden lg:block">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              {lang === "de" ? "Inhalt" : "Contents"}
            </p>
            <nav className="space-y-1 border-l border-border/50">
              {toc.map((section, i) => (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  className={cn(
                    "block -ml-px border-l-2 pl-4 py-1.5 text-[13px] leading-snug transition-colors",
                    activeId === section.id
                      ? "border-primary text-foreground font-medium"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  <span className="mr-1.5 text-[11px] text-primary/70 tabular-nums">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {section.title}
                </a>
              ))}
            </nav>
          </div>
        </aside>

        {/* ─────────── Document body ─────────── */}
        <article className="lg:col-span-9 min-w-0">
          <header className="mb-10">
            {categoryLabel && (
              <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-3">
                {categoryLabel}
              </p>
            )}
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground mb-3">
              {doc.title}
            </h1>
            <p className="text-base text-muted-foreground leading-relaxed max-w-2xl">
              {doc.subtitle}
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5" />
                {lang === "de" ? "Inkrafttreten" : "Effective"}:{" "}
                {formatDate(doc.effective, lang)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" />
                {lang === "de" ? "Zuletzt aktualisiert" : "Last updated"}:{" "}
                {formatDate(doc.updated, lang)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5" />
                {lang === "de" ? "Version" : "Version"}: {doc.version}
              </span>
            </div>
          </header>

          {/* Mobile TOC */}
          <details className="lg:hidden mb-8 rounded-xl border border-border/50 bg-card/60 px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold text-foreground">
              {lang === "de" ? "Inhalt" : "Contents"}
            </summary>
            <nav className="mt-3 space-y-1">
              {toc.map((section, i) => (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  className="block py-1.5 text-[13px] text-muted-foreground hover:text-foreground"
                >
                  <span className="mr-1.5 text-[11px] text-primary/70 tabular-nums">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {section.title}
                </a>
              ))}
            </nav>
          </details>

          <div className="space-y-12">
            {toc.map((section, i) => (
              <section
                key={section.id}
                id={section.id}
                data-legal-section
                className="scroll-mt-28"
              >
                <h2 className="flex items-baseline gap-3 text-xl sm:text-2xl font-bold tracking-tight text-foreground mb-5">
                  <span className="text-sm font-bold text-primary tabular-nums">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {section.title}
                </h2>
                <SectionContent section={section} />
              </section>
            ))}
          </div>

          {/* Contact line */}
          <footer className="mt-14 rounded-2xl border border-border/30 bg-card/40 p-6">
            <p className="text-sm text-muted-foreground leading-relaxed">
              {lang === "de" ? (
                <>
                  Fragen zu diesen Bestimmungen? Schreib uns an{" "}
                  <a
                    href={`mailto:${company.email}`}
                    className="text-primary hover:underline"
                  >
                    {company.email}
                  </a>
                  .
                </>
              ) : (
                <>
                  Questions about these terms? Reach us at{" "}
                  <a
                    href={`mailto:${company.email}`}
                    className="text-primary hover:underline"
                  >
                    {company.email}
                  </a>
                  .
                </>
              )}
            </p>
          </footer>
        </article>
      </div>
    </div>
  );
}
