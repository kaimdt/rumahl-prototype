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
  branding,
}: {
  href?: string;
  compact?: boolean;
  branding?: {
    title: string; mode: "logo" | "text"; logoUrl?: string | null; logoDarkUrl?: string | null;
    mobileLogoUrl?: string | null; mobileLogoDarkUrl?: string | null;
  } | null;
}) {
  return (
    <Link
      href={href}
      aria-label={`${branding?.title ?? "rumahl Status"} — home`}
      className="flex items-center shrink-0 transition-opacity hover:opacity-85"
    >
      {branding?.mode === "text" ? <span className="max-w-[180px] truncate text-base font-extrabold tracking-tight text-foreground sm:max-w-[280px] sm:text-lg">{branding.title}</span> : <>
        <span className={cn("sm:hidden", compact && "hidden")}>
          {branding?.mobileLogoUrl || branding?.logoUrl ? <>
            <img src={branding.mobileLogoUrl || branding.logoUrl || ""} alt="" className="h-8 max-w-[150px] object-contain dark:hidden" />
            <img src={branding.mobileLogoDarkUrl || branding.logoDarkUrl || branding.mobileLogoUrl || branding.logoUrl || ""} alt="" className="hidden h-8 max-w-[150px] object-contain dark:block" />
          </> : <RumahlStatusLogo mobile className="h-7 w-auto" />}
        </span>
        <span className="hidden sm:inline">
          {branding?.logoUrl ? <>
            <img src={branding.logoUrl} alt="" className={cn("h-7 max-w-[240px] object-contain dark:hidden", compact && "h-5")} />
            <img src={branding.logoDarkUrl || branding.logoUrl} alt="" className={cn("hidden h-7 max-w-[240px] object-contain dark:block", compact && "h-5")} />
          </> : <RumahlStatusLogo className={cn("h-6 w-auto", compact && "h-5")} />}
        </span>
      </>}
    </Link>
  );
}
