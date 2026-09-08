/**
 * Advanced Markdown parser — dependency-free.
 *
 * Supports:
 *  - ATX headings (# .. ####) → h2 (TOC sections) / h3 (subsections)
 *  - Paragraphs with inline formatting: **bold**, *italic*, `code`,
 *    [links](url), ![images](src)
 *  - Fenced code blocks with language tag
 *  - Unordered (-, *, +) and ordered (1.) lists → ul / steps
 *  - Pipe tables with alignment (:---, :---:, ---:)
 *  - Blockquotes (>) → tip callouts
 *  - Horizontal rules (---)
 *  - Standalone image lines
 *
 * Output blocks are compatible with ArticleBlock from lib/support-articles.
 */

import type { ArticleBlock } from "@/lib/support-articles";

export type TableAlign = "left" | "center" | "right";

/* ═══════════ Inline parsing ═══════════ */

export type InlineNode =
  | { t: "text"; v: string }
  | { t: "bold"; v: string }
  | { t: "italic"; v: string }
  | { t: "code"; v: string }
  | { t: "link"; v: string; href: string }
  | { t: "image"; alt: string; src: string };

const INLINE_RE =
  /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\))/g;

/** Parse inline markdown into an AST of text nodes. */
export function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((match = INLINE_RE.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push({ t: "text", v: text.slice(last, match.index) });
    }
    const token = match[0];
    if (token.startsWith("**")) {
      nodes.push({ t: "bold", v: token.slice(2, -2) });
    } else if (token.startsWith("`")) {
      nodes.push({ t: "code", v: token.slice(1, -1) });
    } else if (token.startsWith("![")) {
      nodes.push({ t: "image", alt: match[2] ?? "", src: match[3] ?? "" });
    } else if (token.startsWith("[")) {
      nodes.push({ t: "link", v: match[4] ?? "", href: match[5] ?? "" });
    } else if (token.startsWith("*")) {
      nodes.push({ t: "italic", v: token.slice(1, -1) });
    }
    last = match.index + token.length;
  }
  if (last < text.length) {
    nodes.push({ t: "text", v: text.slice(last) });
  }
  return nodes;
}

/* ═══════════ Block helpers ═══════════ */

function splitRow(line: string): string[] {
  let l = line.trim();
  if (l.startsWith("|")) l = l.slice(1);
  if (l.endsWith("|")) l = l.slice(0, -1);
  return l.split("|").map((c) => c.trim());
}

function parseAlign(separator: string): TableAlign[] {
  return splitRow(separator).map((cell) => {
    const c = cell.replace(/\s/g, "");
    if (c.startsWith(":") && c.endsWith(":")) return "center";
    if (c.endsWith(":")) return "right";
    return "left";
  });
}

/* ═══════════ Frontmatter ═══════════ */

export interface DocMeta {
  title?: string;
  description?: string;
  readTime?: string;
  updated?: string;
  featured?: string;
  [key: string]: string | undefined;
}

export function parseFrontmatter(raw: string): { meta: DocMeta; body: string } {
  if (!raw.startsWith("---")) return { meta: {}, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { meta: {}, body: raw };
  const head = raw.slice(3, end);
  const meta: DocMeta = {};
  for (const line of head.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    if (key) meta[key] = value;
  }
  return { meta, body: raw.slice(end + 4).trimStart() };
}

/* ═══════════ Block parsing ═══════════ */

const BLOCK_START =
  /^(#{1,4})\s|^```|^>|^[-*+]\s|^\d+[.)]\s|^(-{3,}|\*{3,})$/;

export function parseMarkdown(md: string): ArticleBlock[] {
  const lines = md.split(/\r?\n/);
  const blocks: ArticleBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // ── Fenced code block
    const fence = trimmed.match(/^```([\w+-]*)/);
    if (fence) {
      const lang = fence[1] || undefined;
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        code.push(lines[i]);
        i++;
      }
      i++; // closing fence
      blocks.push({ type: "code", text: code.join("\n"), ...(lang ? { lang } : {}) });
      continue;
    }

    // ── Headings
    const heading = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      blocks.push(
        level <= 2
          ? { type: "h2", text: heading[2] }
          : { type: "h3", text: heading[2] }
      );
      i++;
      continue;
    }

    // ── Horizontal rule
    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      i++;
      continue;
    }

    // ── Blockquote → tip
    if (trimmed.startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quote.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ type: "tip", text: quote.join(" ") });
      continue;
    }

    // ── Table (current line contains |, next line is a separator)
    if (
      trimmed.includes("|") &&
      i + 1 < lines.length &&
      /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) &&
      lines[i + 1].includes("-")
    ) {
      const headers = splitRow(trimmed);
      const align = parseAlign(lines[i + 1]);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim() && lines[i].trim().includes("|")) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push({ type: "table", headers, rows, align });
      continue;
    }

    // ── Standalone image
    const image = trimmed.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
    if (image) {
      blocks.push({ type: "image", alt: image[1] || "", src: image[2] });
      i++;
      continue;
    }

    // ── Unordered list
    const ul = trimmed.match(/^[-*+]\s+(.*)$/);
    if (ul) {
      const items: string[] = [ul[1]];
      i++;
      while (
        i < lines.length &&
        lines[i].trim() &&
        !BLOCK_START.test(lines[i].trim())
      ) {
        const m = lines[i].trim().match(/^[-*+]\s+(.*)$/);
        if (m) {
          items.push(m[1]);
          i++;
        } else {
          break;
        }
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    // ── Ordered list → steps
    const ol = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (ol) {
      const items: string[] = [ol[1]];
      i++;
      while (
        i < lines.length &&
        lines[i].trim() &&
        !BLOCK_START.test(lines[i].trim())
      ) {
        const m = lines[i].trim().match(/^\d+[.)]\s+(.*)$/);
        if (m) {
          items.push(m[1]);
          i++;
        } else {
          break;
        }
      }
      blocks.push({ type: "steps", items });
      continue;
    }

    // ── Paragraph (accumulate until blank line or new block)
    const paragraph: string[] = [trimmed];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !BLOCK_START.test(lines[i].trim())
    ) {
      paragraph.push(lines[i].trim());
      i++;
    }
    blocks.push({ type: "p", text: paragraph.join(" ") });
  }

  return blocks;
}
