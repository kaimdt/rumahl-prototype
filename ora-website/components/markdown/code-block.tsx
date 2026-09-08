"use client";

import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  highlightCode,
  type HighlightToken,
  type TokenType,
} from "@/lib/markdown/highlight";

/**
 * Theme-aware token colors — mapped to the existing CSS variable
 * palette so code adapts to light/dark/high-contrast automatically.
 */
const TOKEN_COLOR: Partial<Record<TokenType, string>> = {
  comment: "hsl(var(--muted-foreground) / 0.72)",
  string: "hsl(var(--success))",
  keyword: "hsl(var(--primary))",
  number: "hsl(var(--warning))",
  variable: "hsl(var(--accent))",
  flag: "hsl(var(--info))",
  function: "hsl(var(--primary-accent))",
  property: "hsl(var(--primary-accent))",
  boolean: "hsl(var(--chart-5))",
  punctuation: "hsl(var(--muted-foreground) / 0.55)",
};

const TOKEN_STYLE: Partial<Record<TokenType, string>> = {
  comment: "italic",
};

function TokenSpan({ token }: { token: HighlightToken }) {
  const color = TOKEN_COLOR[token.type];
  return (
    <span style={color ? { color } : undefined} className={TOKEN_STYLE[token.type]}>
      {token.value}
    </span>
  );
}

function CopyButton({
  code,
  lang,
}: {
  code: string;
  lang: "de" | "en";
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // Fallback for non-secure contexts / older browsers
      const ta = document.createElement("textarea");
      ta.value = code;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* ignore */
      }
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={copy}
      aria-label={lang === "de" ? "Code kopieren" : "Copy code"}
      title={lang === "de" ? "Code kopieren" : "Copy code"}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[10.5px] font-semibold transition-colors",
        copied
          ? "border-success/40 bg-success/10 text-success"
          : "border-border/50 bg-muted/30 text-muted-foreground hover:text-foreground hover:border-border"
      )}
    >
      {copied ? (
        <Check className="h-3 w-3" strokeWidth={2.5} />
      ) : (
        <Copy className="h-3 w-3" strokeWidth={2} />
      )}
      {copied ? (lang === "de" ? "Kopiert" : "Copied") : lang === "de" ? "Kopieren" : "Copy"}
    </button>
  );
}

export function CodeBlock({
  code,
  lang,
  uiLang = "en",
  showLang = true,
  className,
  preClassName,
}: {
  code: string;
  lang?: string;
  /** UI language for the copy button label (defaults to English). */
  uiLang?: "de" | "en";
  showLang?: boolean;
  className?: string;
  preClassName?: string;
}) {
  const tokens = useMemo(() => highlightCode(code, lang), [code, lang]);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-border/50 bg-muted/30",
        className
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border/40 bg-muted/20 px-4 py-1.5">
        {showLang ? (
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70 truncate">
            {lang || "code"}
          </span>
        ) : (
          <span />
        )}
        <CopyButton code={code} lang={uiLang} />
      </div>
      <pre
        className={cn(
          "overflow-x-auto p-5 text-[13px] leading-relaxed font-mono text-foreground/85",
          preClassName
        )}
      >
        {tokens.length > 0
          ? tokens.map((token, i) => <TokenSpan key={i} token={token} />)
          : code}
      </pre>
    </div>
  );
}
