import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Compass,
  Home,
  LifeBuoy,
  Store,
} from "lucide-react";
import { RumahlIcon } from "@/components/rumahl-logo";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/reveal";

const quickLinks = [
  {
    href: "/",
    label: "Home",
    hint: "Back to the homepage",
    icon: Home,
  },
  {
    href: "/os",
    label: "rumahl OS",
    hint: "What the OS can do",
    icon: Compass,
  },
  {
    href: "https://status.rumahl.com",
    label: "Support",
    hint: "Guides, FAQ and help",
    icon: LifeBuoy,
  },
  {
    href: "/docs",
    label: "Documentation",
    hint: "Installation and developer docs",
    icon: BookOpen,
  },
];

export default function NotFound() {
  return (
    <section className="relative overflow-hidden flex flex-col items-center justify-center pt-28 pb-24 lg:pt-36 lg:pb-32">
      {/* Hintergrund-Glow */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 55% 45% at 50% -10%, hsl(var(--primary) / 0.09), transparent 65%), radial-gradient(ellipse 40% 35% at 85% 110%, hsl(var(--accent) / 0.06), transparent 60%)",
        }}
      />

      <div className="mx-auto max-w-2xl px-6 lg:px-10 relative text-center">
        <Reveal>
          {/* 404 im Gradient — mit dezentem "Fenster"-Rahmen als Hommage ans OS */}
          <div className="mx-auto mb-10 w-fit">
            <div className="relative rounded-2xl border border-border/60 bg-card/70 px-8 py-6 sm:px-12 sm:py-8 shadow-2xl shadow-black/20">
              <div className="absolute top-0 left-0 right-0 h-8 rounded-t-2xl border-b border-border/40 bg-muted/30 flex items-center gap-1.5 px-4">
                <span className="h-2.5 w-2.5 rounded-full bg-destructive/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-warning/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-success/70" />
              </div>
              <div className="pt-6">
                <p className="text-6xl sm:text-7xl font-bold tracking-tight gradient-text font-mono">
                  404
                </p>
              </div>
            </div>
          </div>

          <RumahlIcon className="mx-auto h-8 w-auto text-primary mb-5" />
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground mb-4">
            This window <span className="gradient-text">doesn&apos;t exist</span>
          </h1>
          <p className="text-base text-muted-foreground leading-relaxed max-w-lg mx-auto mb-3">
            The page you&apos;re looking for was moved, renamed, or never
            installed. Let&apos;s get you back to somewhere familiar.
          </p>
          <p className="text-xs text-muted-foreground/60 mb-10 font-mono">
            Error 404 · Not Found · Kein Fenster mit diesem Titel
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-12">
            <Button size="lg" asChild>
              <Link href="/">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back Home
              </Link>
            </Button>
            <Button size="lg" variant="glass" asChild>
              <Link href="/support">
                Get Help
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>

          {/* Quick links */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg mx-auto text-left">
            {quickLinks.map((link, i) => (
              <Reveal key={link.href} delay={i * 80}>
                <Link
                  href={link.href}
                  className="surface-card-interactive group flex items-center gap-4 p-4"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 text-primary">
                    <link.icon className="h-5 w-5" strokeWidth={1.8} />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                      {link.label}
                    </p>
                    <p className="text-xs text-muted-foreground">{link.hint}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                </Link>
              </Reveal>
            ))}
          </div>

          <p className="mt-12 text-xs text-muted-foreground/60">
            If you believe this is a broken link, please{" "}
            <Link
              href="/contact"
              className="text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground hover:decoration-primary transition-colors"
            >
              let us know
            </Link>
            .
          </p>
        </Reveal>
      </div>
    </section>
  );
}
