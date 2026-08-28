"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { Activity, History, Languages, Megaphone, Moon, Sun } from "lucide-react";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/utils";
import { useTenantPage } from "@/lib/tenant-page";

const NAV = [
  { href: "/", label: "Overview", icon: Activity },
  { href: "/history/", label: "Uptime", icon: History },
  { href: "/incidents/", label: "Incidents", icon: Megaphone },
];

export function SiteHeader() {
  const pathname = usePathname();
  const { page: brand, tenantPrefix, language, setLanguage } = useTenantPage();
  const { setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  const isDark = resolvedTheme === "dark";
  const navItems = brand?.nav_links === null || brand === null
    ? NAV.map((item) => ({ label: item.label, href: item.href, enabled: true, icon: item.icon }))
    : brand.nav_links.map((item) => ({ ...item, icon: NAV.find((candidate) => candidate.href === item.href)?.icon ?? Activity }));
  const headerConfig = brand?.header_config ?? { sticky: true, show_theme_toggle: true };
  if (pathname.startsWith("/admin")) return null;

  return (
    <header
      className={cn("statuspage-header z-50 border-b border-border/40", headerConfig.sticky !== false && "sticky top-0")}
      style={{
        background: "var(--header-bg)",
        backdropFilter: "blur(16px) saturate(1.1)",
        WebkitBackdropFilter: "blur(16px) saturate(1.1)",
        boxShadow: "var(--header-shadow)",
      }}
    >
      <div className="statuspage-header-inner mx-auto max-w-5xl px-4 sm:px-5 lg:px-8 h-16 flex items-center gap-3 sm:gap-6">
        <Logo href={tenantPrefix ? `${tenantPrefix}/` : "/"} branding={brand ? {
          title: brand.title, mode: brand.header_brand_mode, logoUrl: brand.logo_url,
          logoDarkUrl: brand.logo_dark_url, mobileLogoUrl: brand.mobile_logo_url,
          mobileLogoDarkUrl: brand.mobile_logo_dark_url,
        } : null} />

        <nav className="statuspage-navbar ml-auto flex items-center gap-1" aria-label="Main navigation">
          {navItems.filter((item) => item.enabled !== false).map(({ href, label, icon: Icon }) => {
            const routedHref = tenantPrefix ? `${tenantPrefix}${href}` : href;
            const active =
              href === "/" ? pathname === `${tenantPrefix}/` || pathname === tenantPrefix : pathname.startsWith(routedHref);
            return (
              <Link
                key={href}
                href={routedHref}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "statuspage-nav-link",
                  "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold transition-colors",
                  active
                    ? "bg-primary/12 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                )}
              >
                <Icon className="h-4 w-4" strokeWidth={2} />
                <span className="hidden sm:inline">{label}</span>
              </Link>
            );
          })}
          {headerConfig.show_language_switcher !== false && (brand?.enabled_locales.length ?? 0) > 1 && <label className="statuspage-language-switcher relative inline-flex items-center text-muted-foreground">
            <Languages className="pointer-events-none absolute left-2 h-4 w-4" />
            <select aria-label="Language" value={language} onChange={(event) => setLanguage(event.target.value)} className="max-w-24 appearance-none rounded-lg border border-border/50 bg-background py-2 pl-7 pr-2 text-xs font-semibold outline-none">
              {brand?.enabled_locales.map((locale) => <option key={locale} value={locale}>{locale.toUpperCase()}</option>)}
            </select>
          </label>}
          {headerConfig.show_theme_toggle !== false && <button
            onClick={() => setTheme(isDark ? "light" : "dark")}
            className="statuspage-theme-toggle p-2 hover:bg-muted/50 rounded-full transition-colors text-muted-foreground hover:text-foreground"
            aria-label="Toggle theme"
            title={isDark ? "Switch to light mode" : "Switch to dark mode"}
          >
            {mounted && isDark ? (
              <Sun className="h-4 w-4" strokeWidth={2} />
            ) : (
              <Moon className="h-4 w-4" strokeWidth={2} />
            )}
          </button>}
        </nav>
      </div>
    </header>
  );
}
