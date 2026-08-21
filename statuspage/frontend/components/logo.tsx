"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { RumahlStatusLogo } from "@/components/rumahl-status-logo";

/**
 * rumahl Status logo — links to the given href.
 *
 * The wordmark is theme-aware (white in dark mode, dark in light mode;
 * "status" slightly lighter / darker respectively). On small screens the
 * wide "status" suffix is hidden so the header stays compact.
 *
 * When the final SVG logo (custom rumahl font) is ready, swap the component
 * in rumahl-status-logo.tsx — this wrapper stays unchanged.
 */
export function Logo({
  href = "/",
  compact = false,
}: {
  href?: string;
  compact?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-label="rumahl Status — home"
      className="flex items-center shrink-0 transition-opacity hover:opacity-85"
    >
      {/* mobile: rumahl mark only; sm+: full wordmark */}
      <span className={cn("sm:hidden", compact && "hidden")}>
        <RumahlStatusLogo status={false} className="h-5 w-auto" />
      </span>
      <span className="hidden sm:inline">
        <RumahlStatusLogo className={cn("h-6 w-auto", compact && "h-5")} />
      </span>
    </Link>
  );
}
