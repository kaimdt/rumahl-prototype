import Link from "next/link";
import { ORALogo } from "@/components/ora-logo";
import { Github } from "lucide-react";

const footerLinks = {
  Product: [
    { name: "Features", href: "/features" },
    { name: "Pricing", href: "/pricing" },
    { name: "Changelog", href: "/docs" },
    { name: "Roadmap", href: "/docs" },
  ],
  Developers: [
    { name: "Documentation", href: "/docs" },
    { name: "API Reference", href: "/docs" },
    { name: "SDKs", href: "/docs" },
    { name: "GitHub", href: "https://github.com" },
  ],
  Resources: [
    { name: "Community", href: "/docs" },
    { name: "Blog", href: "/docs" },
    { name: "Support", href: "/docs" },
    { name: "Status", href: "/docs" },
  ],
  Company: [
    { name: "About", href: "/docs" },
    { name: "Privacy", href: "/docs" },
    { name: "Terms", href: "/docs" },
    { name: "Contact", href: "/docs" },
  ],
};

export function Footer() {
  return (
    <footer className="border-t border-border/40 bg-muted/20">
      <div className="mx-auto max-w-6xl px-6 lg:px-10 py-16">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
          {/* Brand column */}
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="inline-block mb-4">
              <ORALogo showIcon={false} className="h-7 w-auto text-foreground" />
            </Link>
            <p className="text-sm text-muted-foreground leading-relaxed mb-4">
              The open, local-first smart home platform. AI-powered, privacy-first, and fully yours.
            </p>
            <a
              href="https://github.com"
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
            &copy; {new Date().getFullYear()} ORA. All rights reserved.
          </p>
          <p className="text-xs text-muted-foreground">
            Powered by{" "}
            <span className="font-medium gradient-text">IORA OS</span>
          </p>
        </div>
      </div>
    </footer>
  );
}
