"use client";

import Link from "next/link";
import { ArrowRight, Check, Home, Cpu, Shield, Zap, Palette, Smartphone, Wand2, MessageSquare, Github, Cloud, Lock, Database, LayoutTemplate } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function HomePage() {
  return (
    <>
      {/* ─── Hero Section ─── */}
      <section className="relative hero-glow overflow-hidden">
        <div className="mx-auto max-w-6xl px-6 lg:px-10 pt-24 pb-20 lg:pt-32 lg:pb-28">
          <div className="max-w-3xl mx-auto text-center">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 glass-card px-4 py-1.5 mb-8 animate-fade-in">
              <Badge variant="accent" className="rounded-full px-2 py-0.5 text-[11px]">
                New
              </Badge>
              <span className="text-sm text-muted-foreground">
                ORA 2.0 is now available
              </span>
            </div>

            {/* Headline */}
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-foreground animate-fade-in">
              Your Home,{" "}
              <span className="gradient-text">Intelligent.</span>
            </h1>

            {/* Subheadline */}
            <p className="mt-6 text-lg sm:text-xl text-muted-foreground leading-relaxed max-w-2xl mx-auto animate-fade-in">
              ORA is the open, local-first smart home platform that puts you in control.
              AI-powered automation, privacy-first design, and seamless integration with
              thousands of devices.
            </p>

            {/* CTA Buttons */}
            <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4 animate-fade-in">
              <Button size="xl" asChild>
                <Link href="/docs">
                  Get Started Free
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
              <Button variant="glass" size="xl" asChild>
                <Link href="/features">
                  Explore Features
                </Link>
              </Button>
            </div>

            {/* Trust indicators */}
            <div className="mt-8 flex items-center justify-center gap-6 text-sm text-muted-foreground animate-fade-in">
              <span className="flex items-center gap-1.5">
                <Check className="h-4 w-4 text-success" /> Open Source
              </span>
              <span className="flex items-center gap-1.5">
                <Check className="h-4 w-4 text-success" /> Local-First
              </span>
              <span className="flex items-center gap-1.5">
                <Check className="h-4 w-4 text-success" /> Privacy Focused
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Features Grid ─── */}
      <section className="py-24 lg:py-32">
        <div className="mx-auto max-w-6xl px-6 lg:px-10">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
              Everything you need for a{" "}
              <span className="gradient-text">smart home</span>
            </h2>
            <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
              From device control to AI automation, ORA gives you complete control
              over your smart home — running locally on your hardware.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, i) => (
              <div
                key={feature.title}
                className="glass-card-interactive p-6 animate-fade-in"
                style={{ animationDelay: `${i * 50}ms` }}
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 text-primary mb-4">
                  <feature.icon className="h-6 w-6" />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">
                  {feature.title}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── AI Section ─── */}
      <section className="py-24 lg:py-32 bg-muted/20 border-y border-border/30">
        <div className="mx-auto max-w-6xl px-6 lg:px-10">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <div>
              <Badge variant="accent" className="mb-4">AI-Powered</Badge>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground mb-6">
                Your personal{" "}
                <span className="gradient-text">AI assistant</span> for home
              </h2>
              <p className="text-lg text-muted-foreground leading-relaxed mb-8">
                ORA Assistant understands natural language. Just ask it to dim the lights,
                set the perfect temperature, or create complex automations — all through
                simple conversation.
              </p>
              <div className="space-y-3">
                {aiFeatures.map((f) => (
                  <div key={f} className="flex items-start gap-3">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success/15 text-success mt-0.5">
                      <Check className="h-3.5 w-3.5" />
                    </div>
                    <span className="text-sm text-foreground/80">{f}</span>
                  </div>
                ))}
              </div>
              <Button size="lg" className="mt-8" asChild>
                <Link href="/features">
                  Learn about ORA Assistant
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
            <div className="relative">
              <div className="aspect-square rounded-2xl bg-gradient-to-br from-primary/20 via-primary/5 to-accent/10 border border-border/30 flex items-center justify-center">
                <div className="w-3/4 aspect-square rounded-2xl glass-card flex flex-col items-center justify-center p-8 text-center">
                  <MessageSquare className="h-12 w-12 text-primary mb-4" />
                  <p className="text-lg font-medium text-foreground">
                    &ldquo;Hey ORA, set the mood for movie night&rdquo;
                  </p>
                  <p className="text-sm text-muted-foreground mt-2">
                    Lights dimmed, TV on, temperature set to 21&deg;C
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Stats / Trust ─── */}
      <section className="py-24 lg:py-32">
        <div className="mx-auto max-w-6xl px-6 lg:px-10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {stats.map((stat) => (
              <div key={stat.label}>
                <div className="text-3xl sm:text-4xl font-bold text-foreground gradient-text">
                  {stat.value}
                </div>
                <div className="mt-2 text-sm text-muted-foreground">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Architecture Section ─── */}
      <section className="py-24 lg:py-32 bg-muted/20 border-y border-border/30">
        <div className="mx-auto max-w-6xl px-6 lg:px-10">
          <div className="text-center mb-16">
            <Badge variant="accent" className="mb-4">Architecture</Badge>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
              Built on{" "}
              <span className="gradient-text">IORA OS</span>
            </h2>
            <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
              ORA runs on IORA OS, a powerful microservice architecture built with Rust
              for maximum performance, security, and reliability.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {architectureFeatures.map((f, i) => (
              <div
                key={f.title}
                className="glass-card p-6 text-center animate-fade-in"
                style={{ animationDelay: `${i * 75}ms` }}
              >
                <div className="flex h-12 w-12 mx-auto items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 text-primary mb-4">
                  <f.icon className="h-6 w-6" />
                </div>
                <h3 className="text-base font-semibold text-foreground mb-2">
                  {f.title}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {f.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CTA Section ─── */}
      <section className="py-24 lg:py-32">
        <div className="mx-auto max-w-3xl px-6 lg:px-10 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground mb-6">
            Ready to make your home{" "}
            <span className="gradient-text">intelligent</span>?
          </h2>
          <p className="text-lg text-muted-foreground leading-relaxed mb-10">
            Start building your smart home today. Open source, local-first, and
            completely free.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button size="xl" asChild>
              <Link href="/docs">
                Get Started Free
                <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
            <Button variant="glass" size="xl" asChild>
              <a href="https://github.com" target="_blank" rel="noopener noreferrer">
                <Github className="mr-2 h-5 w-5" />
                View on GitHub
              </a>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}

const features = [
  {
    title: "Universal Device Control",
    description: "Control lights, climate, switches, covers, media players, locks, vacuums, and more — all from one unified interface.",
    icon: Home,
  },
  {
    title: "AI-Powered Automation",
    description: "Let ORA learn your patterns and suggest automations. Create complex rules with natural language or a visual editor.",
    icon: Wand2,
  },
  {
    title: "Privacy-First Architecture",
    description: "Everything runs locally on your hardware. Your data never leaves your home. No cloud dependency, no tracking.",
    icon: Shield,
  },
  {
    title: "Beautiful Glass UI",
    description: "A stunning glassmorphism design system with customizable themes, dynamic backgrounds, and smooth animations.",
    icon: Palette,
  },
  {
    title: "Custom Dashboards",
    description: "Drag-and-drop page designer with widgets, groups, and dynamic overview. Build the perfect dashboard for every device.",
    icon: LayoutTemplate,
  },
  {
    title: "Multi-Platform",
    description: "Available on iOS, Android, Windows, Mac, and Linux. PWA support for instant installation on any device.",
    icon: Smartphone,
  },
  {
    title: "Energy Management",
    description: "Monitor and optimize your energy consumption with detailed analytics and intelligent suggestions.",
    icon: Zap,
  },
  {
    title: "Powerful Integrations",
    description: "Native Home Assistant integration, MQTT, Zigbee, Z-Wave, Matter support. Connect thousands of devices.",
    icon: Cpu,
  },
  {
    title: "Desktop App",
    description: "Native desktop experience with system tray control, glass titlebar, local proxy management, and system diagnostics.",
    icon: Lock,
  },
];

const aiFeatures = [
  "Natural language voice and chat control",
  "AI-suggested automations based on your patterns",
  "Predictive climate and lighting control",
  "Smart notifications and anomaly detection",
  "Local LLM support for complete privacy",
];

const stats = [
  { value: "1000+", label: "Supported Devices" },
  { value: "100%", label: "Open Source" },
  { value: "Local", label: "Data Processing" },
  { value: "24/7", label: "Offline Operation" },
];

const architectureFeatures = [
  {
    title: "Rust Backend",
    description: "Blazing fast, memory-safe microservices built with Rust and Axum.",
    icon: Database,
  },
  {
    title: "SQLite Storage",
    description: "Zero-config, high-performance local database with WAL mode.",
    icon: Cloud,
  },
  {
    title: "Real-time Sync",
    description: "Persistent WebSocket connections for instant state updates.",
    icon: Zap,
  },
  {
    title: "Plugin System",
    description: "Extend ORA with JavaScript/TypeScript plugins in a secure sandbox.",
    icon: Cpu,
  },
];
