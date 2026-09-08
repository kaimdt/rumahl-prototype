"use client";

import { cn } from "@/lib/utils";

/**
 * Colored HTTP method badges for endpoint listings (GET / POST / PUT /
 * PATCH / DELETE / WS …). Colors are chosen to work on both the dark
 * and the light theme (mid-tone 500 shades).
 */
const METHOD_STYLES: Record<string, string> = {
  GET: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  POST: "bg-sky-500/12 text-sky-600 dark:text-sky-400 border-sky-500/30",
  PUT: "bg-amber-500/12 text-amber-600 dark:text-amber-400 border-amber-500/30",
  PATCH: "bg-purple-500/12 text-purple-600 dark:text-purple-400 border-purple-500/30",
  DELETE: "bg-red-500/12 text-red-600 dark:text-red-400 border-red-500/30",
  WS: "bg-teal-500/12 text-teal-600 dark:text-teal-400 border-teal-500/30",
  HEAD: "bg-zinc-500/12 text-zinc-600 dark:text-zinc-400 border-zinc-500/30",
  OPTIONS: "bg-zinc-500/12 text-zinc-600 dark:text-zinc-400 border-zinc-500/30",
};

export const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "WS",
  "HEAD",
  "OPTIONS",
] as const;

const METHOD_RE = new RegExp(
  `^(${HTTP_METHODS.join("|")})(/(${HTTP_METHODS.join("|")}))*\\s*`
);

/**
 * Split an endpoint string like "GET/POST /api/os/control/*" into its
 * colored method(s) and the remaining path. Returns null for text that
 * does not start with an HTTP method.
 */
export function parseEndpoint(
  text: string
): { methods: string[]; rest: string } | null {
  const match = text.match(METHOD_RE);
  if (!match) return null;
  return {
    methods: match[0].trim().split("/"),
    rest: text.slice(match[0].length),
  };
}

export function HttpMethodChip({
  method,
  className,
}: {
  method: string;
  className?: string;
}) {
  const style = METHOD_STYLES[method] ?? METHOD_STYLES.HEAD;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-px font-mono text-[10px] font-bold leading-4 tracking-wide",
        style,
        className
      )}
    >
      {method}
    </span>
  );
}

/** Render an endpoint string with colored method chip(s) + path. */
export function EndpointText({
  endpoint,
  className,
}: {
  endpoint: string;
  className?: string;
}) {
  const parsed = parseEndpoint(endpoint);
  if (!parsed) {
    return (
      <code
        className={cn(
          "font-mono text-[12px] text-primary/90 bg-primary/5 rounded px-1.5 py-0.5",
          className
        )}
      >
        {endpoint}
      </code>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-mono text-[12px] flex-wrap",
        className
      )}
    >
      {parsed.methods.map((m) => (
        <HttpMethodChip key={m} method={m} />
      ))}
      {parsed.rest && (
        <code className="rounded px-1 py-0.5 text-foreground/80 bg-muted/40 border border-border/40">
          {parsed.rest}
        </code>
      )}
    </span>
  );
}
