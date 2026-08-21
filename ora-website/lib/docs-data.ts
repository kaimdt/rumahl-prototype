/**
 * Markdown documentation loader — SERVER-ONLY (uses node fs at build time).
 *
 * Scans content/docs/<categoryId>/<slug>.{de,en}.md and builds SupportArticle
 * objects so docs render in the exact same design as support articles.
 *
 * ⚠️ Do NOT import this module from client components ("use client").
 *    Client components receive the data as props instead.
 *
 * To add a new doc: drop a markdown file into content/docs/<category>/.
 *   content/docs/getting-started/installation.en.md
 *   content/docs/getting-started/installation.de.md   (optional)
 *
 * Frontmatter (top of file):
 *   ---
 *   title: Installation
 *   description: Install rumahl on any platform.
 *   readTime: 8 min        (optional)
 *   updated: 2026-08-20    (optional)
 *   featured: true         (optional)
 *   ---
 */

import fs from "node:fs";
import path from "node:path";
import { parseFrontmatter, parseMarkdown } from "@/lib/markdown/parser";
import type { SupportArticle } from "@/lib/support-articles";

const DOCS_ROOT = path.join(process.cwd(), "content", "docs");

export function loadDocsArticles(): SupportArticle[] {
  if (!fs.existsSync(DOCS_ROOT)) return [];

  const articles: SupportArticle[] = [];

  for (const folder of fs.readdirSync(DOCS_ROOT)) {
    const dir = path.join(DOCS_ROOT, folder);
    if (!fs.statSync(dir).isDirectory()) continue;

    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
    const slugs = [...new Set(files.map((f) => f.replace(/\.(de|en)\.md$/, "")))];

    for (const slug of slugs) {
      const enFile = files.find((f) => f === `${slug}.en.md`);
      const deFile = files.find((f) => f === `${slug}.de.md`);
      if (!enFile && !deFile) continue;

      const read = (file?: string) =>
        file
          ? parseFrontmatter(fs.readFileSync(path.join(dir, file), "utf8"))
          : null;

      const en = read(enFile);
      const de = read(deFile);
      if (!en && !de) continue;

      const fallback = (en ?? de)!;
      // Category from frontmatter ("category: setup"), falling back to the
      // folder name.
      const categoryId = (en?.meta.category ?? de?.meta.category) || folder;
      const body = (doc: typeof fallback) => parseMarkdown(doc.body);
      const meta = (doc: typeof fallback) => doc.meta;

      const words = Math.max(
        meta(en ?? de!).description?.split(/\s+/).length ?? 0,
        body(en ?? de!).length
      );
      const readTime = meta(en ?? de!).readTime ?? `${Math.max(1, Math.round(words / 160))} min`;

      articles.push({
        slug,
        categoryId,
        readTime,
        updated: meta(en ?? de!).updated ?? "2026-08-20",
        featured: (meta(en ?? de!).featured ?? "") === "true",
        basePath: "/docs/guides",
        title: {
          de: de?.meta.title ?? en?.meta.title ?? slug,
          en: en?.meta.title ?? de?.meta.title ?? slug,
        },
        excerpt: {
          de: de?.meta.description ?? en?.meta.description ?? "",
          en: en?.meta.description ?? de?.meta.description ?? "",
        },
        content: {
          de: de ? body(de) : body(fallback),
          en: en ? body(en) : body(fallback),
        },
      });
    }
  }

  return articles;
}

export const docsArticles: SupportArticle[] = loadDocsArticles();

export function getDoc(slug: string): SupportArticle | undefined {
  return docsArticles.find((a) => a.slug === slug);
}

export function getDocPrevNext(
  slug: string
): { prev?: SupportArticle; next?: SupportArticle } {
  const index = docsArticles.findIndex((a) => a.slug === slug);
  if (index === -1) return {};
  return {
    prev: index > 0 ? docsArticles[index - 1] : undefined,
    next: index < docsArticles.length - 1 ? docsArticles[index + 1] : undefined,
  };
}
