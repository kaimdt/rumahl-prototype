"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { Activity, History, Megaphone, Moon, Settings, Sun } from "lucide-react";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Overview", icon: Activity },
  { href: "/history/", label: "Uptime", icon: History },
  { href: "/incidents/", label: "Incidents", icon: Megaphone },
];

export function SiteHeader() {
  const pathname = usePathname();
  const { setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === "dark";

  return (
    <header
      className="sticky top-0 z-50 border-b border-border/40"
      style={{
        background: "var(--header-bg)",
        backdropFilter: "blur(16px) saturate(1.1)",
        WebkitBackdropFilter: "blur(16px) saturate(1.1)",
        boxShadow: "var(--header-shadow)",
      }}
    >
      <div className="mx-auto max-w-5xl px-4 sm:px-5 lg:px-8 h-16 flex items-center gap-3 sm:gap-6">
        <Logo />

        <nav className="ml-auto flex items-center gap-1" aria-label="Main navigation">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active =
              href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
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
          <button
            onClick={() => setTheme(isDark ? "light" : "dark")}
            className="p-2 hover:bg-muted/50 rounded-full transition-colors text-muted-foreground hover:text-foreground"
            aria-label="Toggle theme"
            title={isDark ? "Switch to light mode" : "Switch to dark mode"}
          >
            {mounted && isDark ? (
              <Sun className="h-4 w-4" strokeWidth={2} />
            ) : (
              <Moon className="h-4 w-4" strokeWidth={2} />
            )}
          </button>
          <Link
            href="/admin/"
            aria-label="Admin"
            title="Admin"
            className={cn(
              "inline-flex items-center rounded-lg p-2 transition-colors",
              pathname.startsWith("/admin")
                ? "bg-primary/12 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
            )}
          >
            <Settings className="h-4 w-4" strokeWidth={2} />
          </Link>
        </nav>
      </div>
    </header>
  );
}
