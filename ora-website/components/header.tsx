"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import {
  Menu,
  X,
  Moon,
  Sun,
  Contrast,
  ArrowRight,
  Github,
} from "lucide-react";
import { RumahlLogo } from "@/components/rumahl-logo";
import { Button } from "@/components/ui/button";

const navLinks = [
  { name: "OS", href: "/os" },
  { name: "Features", href: "/features" },
  { name: "AI", href: "/ai" },
  { name: "App Store", href: "https://store.rumahl.com", external: true },
  { name: "Pricing", href: "/pricing" },
  { name: "Docs", href: "/docs" },
];

export function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [highContrast, setHighContrast] = useState(false);
  const { setTheme, resolvedTheme } = useTheme();
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  useEffect(() => {
    const isHighContrast = window.localStorage.getItem("rumahl-high-contrast") === "1";
    document.documentElement.setAttribute("data-contrast", isHighContrast ? "high" : "normal");
    const raf = requestAnimationFrame(() => {
      setHighContrast(isHighContrast);
      setMounted(true);
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    document.documentElement.setAttribute("data-contrast", highContrast ? "high" : "normal");
    window.localStorage.setItem("rumahl-high-contrast", highContrast ? "1" : "0");
  }, [highContrast, mounted]);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    handleScroll(); // initial check
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const isDark = mounted && resolvedTheme === "dark";
  const toggleContrast = () => setHighContrast((prev) => !prev);

  return (
    <header
      className="sticky top-0 z-40 w-full transition-all duration-500"
      style={{
        backgroundColor: isScrolled ? "var(--header-bg)" : "transparent",
        backdropFilter: isScrolled ? "blur(24px) saturate(180%)" : "none",
        WebkitBackdropFilter: isScrolled ? "blur(24px) saturate(180%)" : "none",
        borderBottom: isScrolled
          ? "1px solid hsl(var(--border) / 0.3)"
          : "1px solid transparent",
        boxShadow: isScrolled ? "var(--header-shadow)" : "none",
      }}
    >
      <div className="mx-auto flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Logo + Navigation */}
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2.5 shrink-0">
            <RumahlLogo className="h-7 w-auto text-foreground" />
          </Link>

          <nav className="hidden lg:flex lg:items-center lg:gap-x-5">
            {navLinks.map((link) => {
              const active = !link.external && isActive(link.href);
              const cls = `px-2 py-1 -mx-2 rounded-md text-sm font-medium transition-colors ${
                active
                  ? "text-primary"
                  : "text-foreground/70 hover:text-foreground"
              }`;
              return link.external ? (
                <a
                  key={link.name}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cls}
                >
                  {link.name}
                </a>
              ) : (
                <Link key={link.name} href={link.href} className={cls}>
                  {link.name}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Mobile hamburger */}
        <div className="flex lg:hidden">
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 -mr-2 rounded-full hover:bg-muted/50 text-foreground transition-colors"
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
          >
            {mobileMenuOpen ? (
              <X className="h-5 w-5" />
            ) : (
              <Menu className="h-5 w-5" />
            )}
          </button>
        </div>

        {/* Desktop actions */}
        <div className="hidden lg:flex lg:items-center lg:gap-x-1.5">
          <button
            onClick={toggleContrast}
            className={`p-2 rounded-full transition-colors ${
              highContrast
                ? "bg-[hsl(var(--state-selected)/0.22)] text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--state-hover)/0.16)]"
            }`}
            aria-label="Toggle high contrast interaction colors"
            aria-pressed={highContrast}
          >
            <Contrast className="h-[18px] w-[18px]" />
          </button>

          <button
            onClick={() => setTheme(isDark ? "light" : "dark")}
            className="p-2 hover:bg-muted/50 rounded-full transition-colors text-muted-foreground hover:text-foreground"
            aria-label="Toggle theme"
          >
            {mounted && isDark ? (
              <Sun className="h-[18px] w-[18px]" />
            ) : (
              <Moon className="h-[18px] w-[18px]" />
            )}
          </button>

          <a
            href="https://github.com/rumahl"
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 hover:bg-muted/50 rounded-full transition-colors text-muted-foreground hover:text-foreground"
            aria-label="GitHub"
          >
            <Github className="h-[18px] w-[18px]" />
          </a>

          <Button variant="ghost" size="sm" asChild className="ml-1">
            <Link href="/docs">Sign In</Link>
          </Button>
          <Button size="sm" asChild>
            <Link href="/docs">
              Get Started
              <ArrowRight className="ml-1.5 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>

      {/* ─── Mobile Menu ─── */}
      {mounted &&
        createPortal(
          <div
            className={`fixed inset-0 z-[9999] lg:hidden bg-background transition-opacity duration-300 ${
              mobileMenuOpen ? "opacity-100" : "opacity-0 pointer-events-none"
            }`}
          >
            <div
              className="flex h-16 items-center justify-between px-4 sm:px-6 border-b border-border/30"
              style={{
                backgroundColor: "var(--header-bg)",
                backdropFilter: "blur(24px) saturate(180%)",
                WebkitBackdropFilter: "blur(24px) saturate(180%)",
              }}
            >
              <Link
                href="/"
                onClick={() => setMobileMenuOpen(false)}
              >
                <RumahlLogo className="h-7 w-auto text-foreground" />
              </Link>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="p-2 rounded-full hover:bg-muted text-foreground transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="h-[calc(100vh-4rem)] overflow-y-auto">
              <div className="px-4 sm:px-6 py-6">
                <div className="space-y-1">
                  {navLinks.map((link) =>
                    link.external ? (
                      <a
                        key={link.name}
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block py-3 text-2xl font-semibold text-foreground"
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        {link.name}
                      </a>
                    ) : (
                      <Link
                        key={link.name}
                        href={link.href}
                        className="block py-3 text-2xl font-semibold text-foreground"
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        {link.name}
                      </Link>
                    )
                  )}
                  <div className="py-3">
                    <div className="h-px bg-border/40" />
                  </div>
                  <Link
                    href="/docs"
                    className="block py-3 text-2xl font-semibold text-foreground"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    Sign In
                  </Link>
                </div>

                {/* Theme + contrast toggles */}
                <div className="pt-6 pb-8 flex items-center gap-4">
                  <button
                    onClick={() => setTheme(isDark ? "light" : "dark")}
                    className="flex items-center gap-3 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {mounted && isDark ? (
                      <Sun className="h-4 w-4" />
                    ) : (
                      <Moon className="h-4 w-4" />
                    )}
                    <span>{isDark ? "Light" : "Dark"} Mode</span>
                  </button>

                  <button
                    onClick={toggleContrast}
                    className={`flex items-center gap-3 text-sm transition-colors ${
                      highContrast
                        ? "text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    aria-pressed={highContrast}
                  >
                    <Contrast className="h-4 w-4" />
                    <span>{highContrast ? "High Contrast On" : "High Contrast Off"}</span>
                  </button>
                </div>

                <div className="space-y-2 pt-4">
                  <Button size="lg" className="w-full rounded-full" asChild>
                    <Link
                      href="/docs"
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      Get Started
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </header>
  );
}
