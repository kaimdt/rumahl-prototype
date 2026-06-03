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
  Layout,
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

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => (isOpen ? onClose() : onOpen())}
        onMouseEnter={onOpen}
        className={`flex items-center gap-1 px-2 py-1 -mx-2 rounded-md text-sm font-medium transition-all duration-200 ${
          isOpen
            ? "text-foreground bg-muted/50"
            : "text-foreground/70 hover:text-foreground hover:bg-muted/30"
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
        mounted &&
        typeof window !== "undefined" &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed left-0 right-0 top-16 z-50 border-b border-border/30 glass-strong"
          >
            <div className="mx-auto max-w-6xl px-6 lg:px-10 py-10">
              <div className="grid grid-cols-12 gap-8">
                <div className={featured ? "col-span-9" : "col-span-12"}>
                  <div className="grid grid-cols-3 gap-8">
                    {categories.map((category) => (
                      <div key={category.title}>
                        <h3 className="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wide mb-3">
                          {category.title}
                        </h3>
                        <div className="space-y-0.5">
                          {category.items.map((item) => (
                            <Link
                              key={item.name}
                              href={item.href}
                              className="flex items-start gap-3 rounded-lg px-3 py-2.5 hover:bg-muted/40 transition-all duration-200 group"
                              onClick={onClose}
                            >
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-muted/50 to-muted/30 text-foreground/60 group-hover:from-primary/20 group-hover:to-primary/10 group-hover:text-primary transition-all duration-200">
                                <item.icon className="h-4 w-4" />
                              </div>
                              <div className="flex-1 min-w-0 pt-0.5">
                                <div className="text-sm font-medium text-foreground group-hover:text-foreground transition-colors">
                                  {item.name}
                                </div>
                                <div className="text-xs text-muted-foreground/80 mt-0.5 leading-relaxed">
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
                  <div className="col-span-3">
                    <h3 className="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wide mb-3">
                      Featured
                    </h3>
                    <Link
                      href={featured.href}
                      className="block rounded-lg overflow-hidden bg-muted/30 hover:bg-muted/50 transition-all duration-200 group border border-border/30 p-5"
                      onClick={onClose}
                    >
                      <div className="text-sm font-medium text-foreground">
                        {featured.title}
                      </div>
                      <div className="text-xs text-muted-foreground/80 mt-1 leading-relaxed">
                        {featured.description}
                      </div>
                      <div className="flex items-center gap-1 text-xs font-medium text-primary mt-3 group-hover:gap-1.5 transition-all">
                        Learn more <ArrowRight className="w-3 h-3" />
                      </div>
                    </Link>
                  </div>
                )}
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
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const isDark = mounted && resolvedTheme === "dark";

  const featuresCategories: DropdownCategory[] = [
    {
      title: "Smart Home",
      items: [
        {
          name: "Device Control",
          description: "Control lights, climate, switches, and more",
          href: "/features",
          icon: Home,
        },
        {
          name: "Automations",
          description: "Create powerful automations with a visual editor",
          href: "/features",
          icon: Zap,
        },
        {
          name: "Energy Management",
          description: "Monitor and optimize your energy usage",
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
          description: "AI-powered voice and chat assistant",
          href: "/features",
          icon: MessageSquare,
        },
        {
          name: "Smart Suggestions",
          description: "AI-driven automation recommendations",
          href: "/features",
          icon: Wand2,
        },
        {
          name: "Predictive Control",
          description: "Learn your patterns and anticipate needs",
          href: "/features",
          icon: Cpu,
        },
      ],
    },
    {
      title: "Experience",
      items: [
        {
          name: "Custom Dashboards",
          description: "Drag-and-drop dashboard designer",
          href: "/features",
          icon: Layout,
        },
        {
          name: "Themes & Glass UI",
          description: "Beautiful glassmorphism design system",
          href: "/features",
          icon: Palette,
        },
        {
          name: "Mobile & Desktop",
          description: "iOS, Android, Windows, Mac, Linux",
          href: "/features",
          icon: Smartphone,
        },
      ],
    },
  ];

  const developersCategories: DropdownCategory[] = [
    {
      title: "Documentation",
      items: [
        {
          name: "Getting Started",
          description: "Quick start guide and installation",
          href: "/docs",
          icon: BookOpen,
        },
        {
          name: "API Reference",
          description: "Complete REST and WebSocket API docs",
          href: "/docs",
          icon: FileText,
        },
        {
          name: "SDKs & Libraries",
          description: "JavaScript, Python, Go, and more",
          href: "/docs",
          icon: Code2,
        },
      ],
    },
    {
      title: "Platform",
      items: [
        {
          name: "App Development",
          description: "Build apps for the ORA ecosystem",
          href: "/docs",
          icon: Terminal,
        },
        {
          name: "Plugin System",
          description: "Extend ORA with JavaScript plugins",
          href: "/docs",
          icon: Cpu,
        },
        {
          name: "Architecture",
          description: "Understand the microservice architecture",
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
          description: "Open source repositories",
          href: "https://github.com",
          icon: Github,
        },
        {
          name: "Community Forum",
          description: "Discuss and get help",
          href: "/docs",
          icon: Users,
        },
        {
          name: "Changelog",
          description: "Latest updates and releases",
          href: "/docs",
          icon: FileText,
        },
      ],
    },
  ];

  return (
    <header
      className={`sticky top-0 z-40 w-full transition-all duration-300 ${
        isScrolled
          ? "border-b border-border/40 glass"
          : "border-b border-transparent bg-transparent"
      }`}
    >
      <div className="mx-auto flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Logo */}
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center">
            <ORALogo showIcon={false} className="h-7 w-auto text-foreground" />
          </Link>

          {/* Desktop nav */}
          <nav className="hidden lg:flex lg:items-center lg:gap-x-6">
            <MegaDropdown
              label="Features"
              categories={featuresCategories}
              featured={{
                title: "ORA Assistant",
                description: "Your AI-powered smart home companion that understands natural language.",
                href: "/features",
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
                description: "Get your first ORA app running in under 5 minutes.",
                href: "/docs",
              }}
              isOpen={openDropdown === "developers"}
              onOpen={() => setOpenDropdown("developers")}
              onClose={() => setOpenDropdown(null)}
            />
            <Link
              href="/pricing"
              className="px-2 py-1 -mx-2 rounded-md text-sm font-medium text-foreground/70 hover:text-foreground hover:bg-muted/30 transition-all duration-200"
            >
              Pricing
            </Link>
            <Link
              href="/docs"
              className="px-2 py-1 -mx-2 rounded-md text-sm font-medium text-foreground/70 hover:text-foreground hover:bg-muted/30 transition-all duration-200"
            >
              Docs
            </Link>
          </nav>
        </div>

        {/* Mobile menu button */}
        <div className="flex lg:hidden">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 rounded-full hover:bg-muted text-foreground transition-colors"
          >
            <span className="sr-only">
              {mobileMenuOpen ? "Close menu" : "Open menu"}
            </span>
            {mobileMenuOpen ? (
              <X className="h-5 w-5" />
            ) : (
              <Menu className="h-5 w-5" />
            )}
          </button>
        </div>

        {/* Desktop actions */}
        <div className="hidden lg:flex lg:items-center lg:gap-x-2">
          {/* Theme toggle */}
          <button
            onClick={() => setTheme(isDark ? "light" : "dark")}
            className="p-2 hover:bg-muted rounded-full transition-colors text-muted-foreground hover:text-foreground"
            aria-label="Toggle theme"
          >
            {mounted && isDark ? (
              <Sun className="h-5 w-5" />
            ) : (
              <Moon className="h-5 w-5" />
            )}
          </button>

          <Button variant="ghost" size="sm" asChild>
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

      {/* Mobile menu - fullscreen overlay */}
      {mounted &&
        createPortal(
          <div
            className={`fixed inset-0 z-[9999] lg:hidden bg-background transition-opacity duration-300 ${
              mobileMenuOpen ? "opacity-100" : "opacity-0 pointer-events-none"
            }`}
          >
            <div className="flex h-16 items-center justify-between px-4 sm:px-6 border-b border-border/40 glass">
              <Link
                href="/"
                onClick={() => {
                  setMobileMenuOpen(false);
                  setTimeout(() => setMobileSubMenu(null), 300);
                }}
              >
                <ORALogo showIcon={false} className="h-7 w-auto text-foreground" />
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
                    className={`space-y-1 transition-all duration-300 ${
                      mobileSubMenu
                        ? "opacity-0 -translate-x-8 pointer-events-none absolute inset-0"
                        : "opacity-100 translate-x-0"
                    }`}
                  >
                    <button
                      onClick={() => setMobileSubMenu("features")}
                      className="flex items-center justify-between w-full py-3 text-2xl font-semibold text-foreground hover:text-foreground/60 transition-colors"
                    >
                      Features
                      <ChevronDown className="h-6 w-6 -rotate-90" />
                    </button>

                    <button
                      onClick={() => setMobileSubMenu("developers")}
                      className="flex items-center justify-between w-full py-3 text-2xl font-semibold text-foreground hover:text-foreground/60 transition-colors"
                    >
                      Developers
                      <ChevronDown className="h-6 w-6 -rotate-90" />
                    </button>

                    <Link
                      href="/pricing"
                      className="block py-3 text-2xl font-semibold text-foreground hover:text-foreground/60 transition-colors"
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      Pricing
                    </Link>

                    <Link
                      href="/docs"
                      className="block py-3 text-2xl font-semibold text-foreground hover:text-foreground/60 transition-colors"
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      Docs
                    </Link>

                    <div className="py-3">
                      <div className="h-px bg-border/40" />
                    </div>
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
                        className="p-2 -ml-2 rounded-full hover:bg-muted transition-all duration-200"
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
                      ).map((category, catIndex) => (
                        <div key={category.title}>
                          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                            {category.title}
                          </h3>
                          <div className="space-y-1">
                            {category.items.map((item, itemIndex) => (
                              <Link
                                key={item.name}
                                href={item.href}
                                className="flex items-start gap-3 py-2.5 hover:bg-muted/30 rounded-lg px-2 -mx-2 transition-all duration-200"
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
                <div className="pt-6 pb-8">
                  <button
                    onClick={() => setTheme(isDark ? "light" : "dark")}
                    className="flex items-center gap-3 text-sm text-foreground/80 hover:text-foreground transition-colors"
                  >
                    {mounted && isDark ? (
                      <Sun className="h-4 w-4" />
                    ) : (
                      <Moon className="h-4 w-4" />
                    )}
                    <span>{isDark ? "Light Mode" : "Dark Mode"}</span>
                  </button>
                </div>

                {/* CTAs */}
                <div className="space-y-2 pt-4">
                  <Button variant="outline" size="lg" className="w-full" asChild>
                    <Link
                      href="/docs"
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      Sign In
                    </Link>
                  </Button>
                  <Button size="lg" className="w-full" asChild>
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
