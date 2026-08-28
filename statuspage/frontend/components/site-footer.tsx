"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity } from "lucide-react";
import { TimezonePicker } from "./timezone-picker";
import { useTenantPage } from "@/lib/tenant-page";

const DEFAULT_LINKS = [
  { label: "rumahl.com", href: "https://rumahl.com", enabled: true },
  { label: "App Store", href: "https://store.rumahl.com", enabled: true },
  { label: "Previous incidents", href: "/past/", enabled: true },
  { label: "Uptime history", href: "/history/", enabled: true },
  { label: "RSS", href: "/rss", enabled: true },
];

export function SiteFooter() {
  const pathname = usePathname();
  const { page, tenantPrefix } = useTenantPage();
  const config = page?.footer_config ?? { enabled: true, text: "status.rumahl.com — real-time monitoring of the rumahl platform.", show_timezone: true };
  const links = page?.footer_links === null || page === null ? DEFAULT_LINKS : page.footer_links;
  if (config.enabled === false || pathname.startsWith("/admin")) return null;
  return <footer className="statuspage-footer mt-20 border-t border-border/40">
    <div className="statuspage-footer-inner mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 px-5 py-8 lg:px-8 sm:flex-row">
      <div className="statuspage-footer-links flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[13px] sm:justify-start">
        <Activity className="h-4 w-4 text-primary" strokeWidth={2} />
        {links.filter((link) => link.enabled !== false && link.label && link.href).map((link) => {
          const href = link.href.startsWith("/") && tenantPrefix ? `${tenantPrefix}${link.href}` : link.href;
          return <Link key={`${link.label}-${link.href}`} href={href} className="statuspage-footer-link text-muted-foreground transition-colors hover:text-foreground">{link.label}</Link>;
        })}
      </div>
      {config.show_timezone !== false && <TimezonePicker />}
    </div>
    {config.text && <div className="border-t border-border/30"><p className="mx-auto max-w-5xl px-5 py-4 text-center text-xs text-muted-foreground/60 lg:px-8 sm:text-left">{config.text}</p></div>}
  </footer>;
}
