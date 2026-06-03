"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useTheme } from "next-themes";
import {
  Menu,
  X,
  Moon,
  Sun,
  ChevronDown,
  ArrowRight,
  Home,
  Cpu,
  Shield,
  Zap,
  Palette,
  Smartphone,
  Wand2,
  MessageSquare,
  Lock,
  Database,
  Server,
  Terminal,
  Code2,
  BookOpen,
  FileText,
  Users,
  Github,
  Monitor,
  LayoutTemplate,
  Cloud,
  Globe,
} from "lucide-react";
import { ORALogo } from "@/components/ora-logo";
import { Button } from "@/components/ui/button";

interface DropdownItem {
  name: string;
  description: string;
  href: string;
  icon: React.ElementType;
}

interface DropdownCategory {
  title: string;
  items: DropdownItem[];
}

interface MegaDropdownProps {
  label: string;
  categories: DropdownCategory[];
  featured?: {
    title: string;
    description: string;
    href: string;
    icon: React.ElementType;
  };
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
}

function MegaDropdown({
  label,
  categories,
  featured,
  isOpen,
  onOpen,
  onClose,
}: MegaDropdownProps) {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(target) &&
        buttonRef.current &&
        !buttonRef.current.contains(target)
      ) {
        onClose();
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, onClose]);

  if (!mounted) {
    return (
      <div className="relative">
        <button className="flex items-center gap-1 px-2 py-1 -mx-2 rounded-md text-sm font-medium text-foreground/70">
          {label}
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => (isOpen ? onClose() : onOpen())}
        onMouseEnter={onOpen}
        className={`flex items-center gap-1 px-2 py-1 -mx-2 rounded-md text-sm font-medium transition-all duration-200 ${
          isOpen
            ? "text-foreground"
            : "text-foreground/70 hover:text-foreground"
        }`}
      >
        {label}
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform duration-300 ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {isOpen &&
        typeof window !== "undefined" &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed left-0 right-0 z-50"
            style={{ top: "64px" }}
          >
            <div
              className="border-b border-border/20"
              style={{
                backgroundColor: "var(--header-bg)",
                backdropFilter: "blur(24px) saturate(180%)",
                WebkitBackdropFilter: "blur(24px) saturate(180%)",
                boxShadow: "var(--header-shadow)",
              }}
            >
              <div className="mx-auto max-w-6xl px-8 lg:px-10 py-10">
                <div className="grid grid-cols-12 gap-8">
                  <div className={featured ? "col-span-8" : "col-span-12"}>
                    <div className="grid grid-cols-3 gap-8">
                      {categories.map((category) => (
                        <div key={category.title}>
                          <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-4">
                            {category.title}
                          </h3>
                          <div className="space-y-0.5">
                            {category.items.map((item) => (
                              <Link
                                key={item.name}
                                href={item.href}
                                onClick={onClose}
                                className="flex items-start gap-3 rounded-lg px-3 py-2.5 -mx-3 hover:bg-muted/40 transition-all duration-200 group"
                              >
                                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/50 text-foreground/60 group-hover:bg-primary/15 group-hover:text-primary transition-all duration-200">
                                  <item.icon className="h-4 w-4" />
                                </div>
                                <div className="flex-1 min-w-0 pt-0.5">
                                  <div className="text-sm font-medium text-foreground">
                                    {item.name}
                                  </div>
                                  <div className="text-xs text-muted-foreground/80 mt-0.5 line-clamp-2 leading-relaxed">
                                    {item.description}
                                  </div>
                                </div>
                              </Link>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {featured && (
                    <div className="col-span-4">
                      <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-4">
                        Featured
                      </h3>
                      <Link
                        href={featured.href}
                        onClick={onClose}
                        className="block rounded-xl overflow-hidden bg-muted/30 hover:bg-muted/50 transition-all duration-200 group border border-border/30 p-6"
                      >
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 text-primary mb-4 group-hover:scale-110 transition-transform duration-300">
                          <featured.icon className="h-5 w-5" />
                        </div>
                        <div className="text-sm font-semibold text-foreground mb-1.5">
                          {featured.title}
                        </div>
                        <div className="text-xs text-muted-foreground/80 leading-relaxed">
                          {featured.description}
                        </div>
                        <div className="inline-flex items-center gap-1 text-xs font-medium text-primary mt-3 group-hover:gap-2 transition-all">
                          Learn more <ArrowRight className="w-3 h-3" />
                        </div>
                      </Link>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

export function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [isScrolled, setIsScrolled] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [mobileSubMenu, setMobileSubMenu] = useState<string | null>(null);
  const { theme, setTheme, resolvedTheme } = useTheme();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    handleScroll(); // initial check
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const isDark = mounted && resolvedTheme === "dark";
  const hasDropdownOpen = openDropdown !== null;

  const featuresCategories: DropdownCategory[] = [
    {
      title: "Smart Control",
      items: [
        {
          name: "Device Control",
          description: "Lights, climate, switches, covers, media & more in one interface",
          href: "/features",
          icon: Home,
        },
        {
          name: "Automations",
          description: "Visual editor + natural language for powerful automations",
          href: "/features",
          icon: Zap,
        },
        {
          name: "Energy Management",
          description: "Real-time monitoring, analytics, and smart savings",
          href: "/features",
          icon: Cpu,
        },
      ],
    },
    {
      title: "AI & Intelligence",
      items: [
        {
          name: "ORA Assistant",
          description: "Voice & chat AI that understands natural language",
          href: "/features",
          icon: MessageSquare,
        },
        {
          name: "Smart Suggestions",
          description: "AI learns your patterns, recommends automations",
          href: "/features",
          icon: Wand2,
        },
        {
          name: "Local LLM Support",
          description: "Run AI models locally — zero cloud dependency",
          href: "/features",
          icon: Shield,
        },
      ],
    },
    {
      title: "Interface",
      items: [
        {
          name: "Custom Dashboards",
          description: "Drag-and-drop designer with widget system",
          href: "/features",
          icon: LayoutTemplate,
        },
        {
          name: "Glass UI & Themes",
          description: "Beautiful glassmorphism, custom themes, night mode",
          href: "/features",
          icon: Palette,
        },
        {
          name: "All Platforms",
          description: "iOS, Android, Windows, Mac, Linux + PWA",
          href: "/features",
          icon: Smartphone,
        },
      ],
    },
  ];

  const developersCategories: DropdownCategory[] = [
    {
      title: "Get Started",
      items: [
        {
          name: "Quick Start",
          description: "Install ORA and connect your first device in minutes",
          href: "/docs",
          icon: BookOpen,
        },
        {
          name: "API Reference",
          description: "Complete REST & WebSocket API documentation",
          href: "/docs",
          icon: FileText,
        },
        {
          name: "SDKs & Tools",
          description: "Official SDKs for TypeScript, Python, Go, C++",
          href: "/docs",
          icon: Code2,
        },
      ],
    },
    {
      title: "Build",
      items: [
        {
          name: "App Development",
          description: "Create apps that run in the ORA ecosystem",
          href: "/docs",
          icon: Terminal,
        },
        {
          name: "Plugin System",
          description: "Extend ORA with sandboxed JavaScript plugins",
          href: "/docs",
          icon: Cpu,
        },
        {
          name: "Architecture",
          description: "Rust microservices, SQLite, event-driven design",
          href: "/docs",
          icon: Server,
        },
      ],
    },
    {
      title: "Community",
      items: [
        {
          name: "GitHub",
          description: "All repositories are open source",
          href: "https://github.com",
          icon: Github,
        },
        {
          name: "Discussions",
          description: "Ask questions, share ideas, get help",
          href: "/docs",
          icon: Users,
        },
        {
          name: "Changelog",
          description: "Release notes and version history",
          href: "/docs",
          icon: FileText,
        },
      ],
    },
  ];

  return (
    <header
      className="sticky top-0 z-40 w-full transition-all duration-500"
      style={{
        backgroundColor: isScrolled || hasDropdownOpen
          ? "var(--header-bg)"
          : "transparent",
        backdropFilter: isScrolled || hasDropdownOpen
          ? "blur(24px) saturate(180%)"
          : "none",
        WebkitBackdropFilter: isScrolled || hasDropdownOpen
          ? "blur(24px) saturate(180%)"
          : "none",
        borderBottom: isScrolled || hasDropdownOpen
          ? "1px solid hsl(var(--border) / 0.3)"
          : "1px solid transparent",
        boxShadow: isScrolled || hasDropdownOpen
          ? "var(--header-shadow)"
          : "none",
      }}
    >
      <div className="mx-auto flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Logo + Navigation */}
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2.5 shrink-0">
            <ORALogo className="h-8 w-auto text-foreground" />
          </Link>

          <nav className="hidden lg:flex lg:items-center lg:gap-x-5">
            <MegaDropdown
              label="Features"
              categories={featuresCategories}
              featured={{
                title: "ORA Assistant",
                description: "Your AI companion that controls your home through natural conversation — running 100% locally.",
                href: "/features",
                icon: MessageSquare,
              }}
              isOpen={openDropdown === "features"}
              onOpen={() => setOpenDropdown("features")}
              onClose={() => setOpenDropdown(null)}
            />
            <MegaDropdown
              label="Developers"
              categories={developersCategories}
              featured={{
                title: "Quick Start Guide",
                description: "Get ORA running and your first integration built in under 5 minutes.",
                href: "/docs",
                icon: Terminal,
              }}
              isOpen={openDropdown === "developers"}
              onOpen={() => setOpenDropdown("developers")}
              onClose={() => setOpenDropdown(null)}
            />
            <Link
              href="/pricing"
              className="px-2 py-1 -mx-2 rounded-md text-sm font-medium text-foreground/70 hover:text-foreground transition-colors"
            >
              Pricing
            </Link>
            <Link
              href="/docs"
              className="px-2 py-1 -mx-2 rounded-md text-sm font-medium text-foreground/70 hover:text-foreground transition-colors"
            >
              Docs
            </Link>
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
            href="https://github.com"
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
                onClick={() => {
                  setMobileMenuOpen(false);
                  setTimeout(() => setMobileSubMenu(null), 300);
                }}
              >
                <ORALogo className="h-7 w-auto text-foreground" />
              </Link>
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  setTimeout(() => setMobileSubMenu(null), 300);
                }}
                className="p-2 rounded-full hover:bg-muted text-foreground transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="h-[calc(100vh-4rem)] overflow-y-auto">
              <div className="px-4 sm:px-6 py-6">
                <div className="relative">
                  {/* Main menu */}
                  <div
                    className={`transition-all duration-300 ${
                      mobileSubMenu
                        ? "opacity-0 -translate-x-8 pointer-events-none absolute inset-0"
                        : "opacity-100 translate-x-0"
                    }`}
                  >
                    <button
                      onClick={() => setMobileSubMenu("features")}
                      className="flex items-center justify-between w-full py-3 text-2xl font-semibold text-foreground"
                    >
                      Features
                      <ChevronDown className="h-6 w-6 -rotate-90" />
                    </button>
                    <button
                      onClick={() => setMobileSubMenu("developers")}
                      className="flex items-center justify-between w-full py-3 text-2xl font-semibold text-foreground"
                    >
                      Developers
                      <ChevronDown className="h-6 w-6 -rotate-90" />
                    </button>
                    <Link
                      href="/pricing"
                      className="block py-3 text-2xl font-semibold text-foreground"
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      Pricing
                    </Link>
                    <Link
                      href="/docs"
                      className="block py-3 text-2xl font-semibold text-foreground"
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      Docs
                    </Link>
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

                  {/* Submenu */}
                  <div
                    className={`transition-all duration-300 ${
                      mobileSubMenu
                        ? "opacity-100 translate-x-0"
                        : "opacity-0 translate-x-8 pointer-events-none absolute inset-0"
                    }`}
                  >
                    <div className="flex items-center gap-3 pb-6 border-b border-border/40">
                      <button
                        onClick={() => setMobileSubMenu(null)}
                        className="p-2 -ml-2 rounded-full hover:bg-muted transition-all"
                      >
                        <ChevronDown className="h-5 w-5 rotate-90" />
                      </button>
                      <h2 className="text-2xl font-semibold text-foreground capitalize">
                        {mobileSubMenu}
                      </h2>
                    </div>
                    <div className="mt-6 space-y-6">
                      {(mobileSubMenu === "features"
                        ? featuresCategories
                        : developersCategories
                      ).map((category) => (
                        <div key={category.title}>
                          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                            {category.title}
                          </h3>
                          <div className="space-y-1">
                            {category.items.map((item) => (
                              <Link
                                key={item.name}
                                href={item.href}
                                className="flex items-start gap-3 py-2.5 hover:bg-muted/30 rounded-lg px-2 -mx-2 transition-all"
                                onClick={() => {
                                  setMobileMenuOpen(false);
                                  setTimeout(() => setMobileSubMenu(null), 300);
                                }}
                              >
                                <item.icon className="h-5 w-5 mt-0.5 text-primary shrink-0" />
                                <div>
                                  <div className="font-medium text-foreground">
                                    {item.name}
                                  </div>
                                  <div className="text-sm text-muted-foreground mt-0.5">
                                    {item.description}
                                  </div>
                                </div>
                              </Link>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Theme toggle */}
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
