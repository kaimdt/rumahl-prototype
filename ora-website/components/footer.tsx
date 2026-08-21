import Link from "next/link";
import { RumahlLogo } from "@/components/rumahl-logo";
import { Github } from "lucide-react";

const footerLinks = {
  Product: [
    { name: "OS", href: "/os" },
    { name: "Features", href: "/features" },
    { name: "ORA AI", href: "/ai" },
    { name: "App Store", href: "https://store.rumahl.com" },
    { name: "Pricing", href: "/pricing" },
    { name: "Changelog", href: "/changelog" },
    { name: "Roadmap", href: "/roadmap" },
  ],
  Developers: [
    { name: "Documentation", href: "/docs" },
    { name: "API Reference", href: "/api-reference" },
    { name: "SDKs", href: "/sdks" },
    { name: "GitHub", href: "https://github.com/rumahl" },
  ],
  Resources: [
    { name: "Community", href: "/community" },
    { name: "Blog", href: "/blog" },
    { name: "Support", href: "/support" },
    { name: "Status", href: "https://status.rumahl.com" },
  ],
  Company: [
    { name: "About the name", href: "/about" },
    { name: "Legal", href: "/legal" },
    { name: "Privacy", href: "/legal/privacy" },
    { name: "Terms", href: "/legal/tos" },
    { name: "Imprint", href: "/legal/impressum" },
    { name: "Contact", href: "/contact" },
  ],
};

export function Footer() {
  return (
    <footer className="relative overflow-hidden border-t border-border/40 bg-muted/20">
      {/* Riesiges, sehr leichtes rumahl-Logo als Wasserzeichen im Hintergrund */}
      <div
        className="absolute inset-0 flex items-center justify-center pointer-events-none select-none"
        aria-hidden="true"
      >
        <RumahlLogo className="w-[130%] max-w-none h-auto text-foreground opacity-[0.035] dark:opacity-[0.05]" />
      </div>

      <div className="relative mx-auto max-w-6xl px-6 lg:px-10 py-16">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
          {/* Brand column */}
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="inline-block mb-4">
              <RumahlLogo className="h-8 w-auto text-foreground" />
            </Link>
            <p className="text-sm text-muted-foreground leading-relaxed mb-4">
              The open, local-first home operating system. Smart home, apps, media,
              and ORA — your AI assistant — all on your hardware.
            </p>
            <a
              href="https://github.com/rumahl"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <Github className="h-4 w-4" />
              Open Source
            </a>
          </div>

          {/* Link columns */}
          {Object.entries(footerLinks).map(([category, links]) => (
            <div key={category}>
              <h3 className="text-xs font-semibold text-foreground/80 uppercase tracking-wider mb-4">
                {category}
              </h3>
              <ul className="space-y-3">
                {links.map((link) => (
                  <li key={link.name}>
                    <Link
                      href={link.href}
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {link.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 pt-8 border-t border-border/30 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} rumahl. All rights reserved.
          </p>
          <p className="text-xs text-muted-foreground">
            Open source. Local-first. AI-native.
          </p>
        </div>
      </div>
    </footer>
  );
}
