import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, Home, Cpu, Shield, Zap, Palette, Smartphone, Wand2, MessageSquare, LayoutTemplate, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Features",
  description: "Explore all features of ORA - the intelligent home platform.",
};

const allFeatures = [
  {
    title: "Universal Device Control",
    description: "Control lights, climate, switches, covers, media players, locks, vacuums, humidifiers, alarms, and more from one unified interface. Support for RGB/RGBW/RGBWW color, color temperature, effects, and 2-zone sync.",
    icon: Home,
    highlights: ["Full entity control", "Real-time state sync", "Haptic feedback", "Group control"],
  },
  {
    title: "AI-Powered Automation",
    description: "ORA Assistant understands natural language. Create automations by simply describing what you want. AI learns your patterns and suggests optimizations.",
    icon: Wand2,
    highlights: ["Natural language control", "AI automation suggestions", "Pattern learning", "Predictive control"],
  },
  {
    title: "Privacy-First Architecture",
    description: "Everything runs locally on your hardware. Your data never leaves your home. No cloud dependency, no tracking, no accounts required.",
    icon: Shield,
    highlights: ["Local processing", "No cloud required", "Zero telemetry", "Self-hosted"],
  },
  {
    title: "Beautiful Glass UI",
    description: "A stunning glassmorphism design system with customizable themes, dynamic backgrounds, smooth animations, and ambient glow effects.",
    icon: Palette,
    highlights: ["Glass morphism", "Custom themes", "Dynamic backgrounds", "Night mode"],
  },
  {
    title: "Drag-and-Drop Dashboard",
    description: "Build custom dashboards with a visual page designer. Arrange widgets, create groups, and set up dynamic overviews that change based on time or triggers.",
    icon: LayoutTemplate,
    highlights: ["Visual designer", "Widget groups", "Dynamic overviews", "Layout templates"],
  },
  {
    title: "Multi-Platform Support",
    description: "Available on iOS, Android, Windows, Mac, and Linux. Install as a PWA for a native-like experience on any device.",
    icon: Smartphone,
    highlights: ["iOS & Android", "Windows, Mac, Linux", "PWA installable", "Responsive design"],
  },
  {
    title: "Energy Management",
    description: "Monitor and optimize your energy consumption with detailed analytics, historical charts, and intelligent suggestions for savings.",
    icon: Zap,
    highlights: ["Energy monitoring", "Usage analytics", "Cost tracking", "Smart suggestions"],
  },
  {
    title: "Powerful Integrations",
    description: "Native Home Assistant integration with MQTT, Zigbee, Z-Wave, Matter, BLE, and HomeKit support. Connect thousands of devices seamlessly.",
    icon: Cpu,
    highlights: ["Home Assistant", "MQTT / Zigbee", "Z-Wave / Matter", "BLE / HomeKit"],
  },
  {
    title: "Native Desktop App",
    description: "Tauri-powered desktop app with system tray control, glass titlebar, local proxy management, and comprehensive system diagnostics.",
    icon: Lock,
    highlights: ["System tray", "Glass titlebar", "Proxy management", "System diagnostics"],
  },
  {
    title: "AI Assistant",
    description: "Chat and voice interface powered by local LLMs. Control your entire home through natural conversation without sending data to the cloud.",
    icon: MessageSquare,
    highlights: ["Voice control", "Chat interface", "Local LLMs", "Context awareness"],
  },
];

export default function FeaturesPage() {
  return (
    <>
      <section className="py-24 lg:py-32">
        <div className="mx-auto max-w-6xl px-6 lg:px-10">
          <div className="text-center mb-16">
            <Badge variant="accent" className="mb-4">Features</Badge>
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-foreground mb-4">
              Everything your{" "}
              <span className="gradient-text">smart home</span> needs
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              ORA combines powerful device control, AI intelligence, and a beautiful
              interface into one open-source platform.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {allFeatures.map((feature, i) => (
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
                <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                  {feature.description}
                </p>
                <div className="space-y-1.5">
                  {feature.highlights.map((h) => (
                    <div key={h} className="flex items-center gap-2 text-xs text-foreground/70">
                      <Check className="h-3 w-3 text-success shrink-0" />
                      {h}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24 lg:py-32 bg-muted/20 border-t border-border/30">
        <div className="mx-auto max-w-3xl px-6 lg:px-10 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground mb-6">
            Ready to try <span className="gradient-text">ORA</span>?
          </h2>
          <Button size="xl" asChild>
            <Link href="/docs">
              Get Started Free
              <ArrowRight className="ml-2 h-5 w-5" />
            </Link>
          </Button>
        </div>
      </section>
    </>
  );
}
