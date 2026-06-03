"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  Home,
  Cpu,
  Shield,
  Zap,
  Palette,
  Smartphone,
  Wand2,
  MessageSquare,
  Github,
  Lock,
  Database,
  LayoutTemplate,
  Cloud,
  Monitor,
  Sparkles,
  ChevronDown,
  Star,
  Heart,
  Quote,
  TrendingUp,
  Server,
  Terminal,
  Wrench,
  RefreshCw,
  Users,
  Building2,
  Brain,
  Bot,
  Globe,
  Sun,
  Moon,
  Microscope,
  Binary,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AIChatDemo } from "@/components/ai-chat-demo";

export default function HomePage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <>
      {/* ═══════════════════════════════════════════════════════════
          HERO — AI-FORWARD WITH ORBS + CHAT DEMO
          ═══════════════════════════════════════════════════════════ */}
      <section className="relative ai-hero-bg overflow-hidden min-h-[90vh] flex items-center">
        {/* Floating orbs */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="orb orb-blue" style={{ top: '10%', left: '-10%' }} />
          <div className="orb orb-teal" style={{ top: '50%', right: '-15%' }} />
          <div className="orb orb-purple" style={{ bottom: '-10%', left: '40%' }} />
          {/* Sparkle dots */}
          <div className="sparkle-dot" style={{ top: '15%', left: '25%', animationDelay: '0s' }} />
          <div className="sparkle-dot" style={{ top: '30%', right: '30%', animationDelay: '1.2s', background: 'hsl(var(--ai-glow-teal))' }} />
          <div className="sparkle-dot" style={{ top: '65%', left: '15%', animationDelay: '0.7s', background: 'hsl(var(--ai-glow-purple))' }} />
          <div className="sparkle-dot" style={{ top: '20%', right: '20%', animationDelay: '1.8s' }} />
          <div className="sparkle-dot" style={{ bottom: '25%', right: '35%', animationDelay: '0.4s', background: 'hsl(var(--ai-glow-amber))' }} />
        </div>

        <div className="mx-auto max-w-6xl px-6 lg:px-10 pt-24 pb-16 lg:pt-32 lg:pb-24 w-full">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
            {/* Left: Headline + CTA */}
            <div>
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/15 bg-primary/5 mb-8 animate-fade-in">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary/60 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                </span>
                <span className="text-xs font-medium text-primary/80">
                  ORA AI — now with local LLM support
                </span>
              </div>

              <h1 className="text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-bold tracking-tight text-foreground leading-[1.05] animate-fade-in">
                Your home,<br />
                <span className="gradient-text-ai">
                  finally intelligent.
                </span>
              </h1>

              <p className="mt-6 text-base sm:text-lg text-muted-foreground leading-relaxed max-w-lg animate-fade-in stagger-1">
                ORA is the AI-powered smart home platform. Natural language
                control, local LLMs, stunning glass UI — all running on your
                hardware. No cloud, no subscriptions, no compromises.
              </p>

              <div className="mt-10 flex flex-col sm:flex-row items-start sm:items-center gap-4 animate-fade-in stagger-2">
                <Button size="xl" className="shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/25 transition-shadow" asChild>
                  <Link href="/docs">
                    <Sparkles className="mr-2 h-5 w-5" />
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

              <div className="mt-8 flex flex-wrap items-center gap-5 text-sm text-muted-foreground animate-fade-in stagger-3">
                <span className="flex items-center gap-1.5">
                  <Check className="h-4 w-4 text-success" /> Open Source
                </span>
                <span className="flex items-center gap-1.5">
                  <Check className="h-4 w-4 text-success" /> Local-First
                </span>
                <span className="flex items-center gap-1.5">
                  <Check className="h-4 w-4 text-success" /> AI-Native
                </span>
              </div>
            </div>

            {/* Right: Animated AI Chat Demo */}
            <div className="animate-fade-in stagger-2 relative">
              <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-primary/10 via-primary/3 to-accent/5 blur-3xl -m-8" />
              <div className="relative">
                <AIChatDemo />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════
          STATS BAR
          ═══════════════════════════════════════════════════════════ */}
      <section className="border-y border-border/20 bg-muted/5">
        <div className="mx-auto max-w-6xl px-6 lg:px-10 py-12">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {[
              { value: "1000+", label: "Devices Supported" },
              { value: "100%", label: "Open Source" },
              { value: "Local", label: "AI Processing" },
              { value: "24/7", label: "Offline Operation" },
            ].map((s, i) => (
              <div key={s.label} className="animate-fade-in" style={{ animationDelay: `${i * 100}ms` }}>
                <div className="text-3xl sm:text-4xl font-bold gradient-text-ai">{s.value}</div>
                <div className="mt-1.5 text-sm text-muted-foreground">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════
          AI FEATURE — THE HEART OF ORA
          ═══════════════════════════════════════════════════════════ */}
      <section className="py-24 lg:py-36 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="orb orb-purple" style={{ top: '20%', right: '-15%', width: '400px', height: '400px', opacity: 0.15 }} />
          <div className="orb orb-blue" style={{ bottom: '10%', left: '-10%', width: '350px', height: '350px', opacity: 0.1 }} />
        </div>

        <div className="mx-auto max-w-6xl px-6 lg:px-10 relative">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/15 bg-primary/5 mb-6">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-medium text-primary/80">Powered by ORA AI</span>
            </div>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-foreground mb-4">
              Meet{" "}
              <span className="gradient-text-ai">ORA AI</span> —
              <br />
              <span className="text-foreground/70">your home&apos;s brain.</span>
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto mt-4">
              ORA AI is not just a voice assistant. It&apos;s a fully local AI that
              understands context, learns your patterns, and proactively manages
              your home — all without sending a single byte to the cloud.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
            {aiPillars.map((p, i) => (
              <div
                key={p.title}
                className="ai-card p-6 group"
                style={{ animationDelay: `${i * 100}ms` }}
                onMouseMove={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = ((e.clientX - rect.left) / rect.width) * 100;
                  const y = ((e.clientY - rect.top) / rect.height) * 100;
                  e.currentTarget.style.setProperty('--mouse-x', `${x}%`);
                  e.currentTarget.style.setProperty('--mouse-y', `${y}%`);
                }}
              >
                <div className="relative z-10">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 text-primary mb-5 group-hover:scale-110 transition-transform duration-400 shadow-lg shadow-primary/5">
                    <p.icon className="h-7 w-7" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground mb-2.5">{p.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{p.description}</p>
                </div>
              </div>
            ))}
          </div>

          {/* AI Demo Section with code-style blocks */}
          <div className="grid lg:grid-cols-5 gap-8 items-center">
            <div className="lg:col-span-2">
              <h3 className="text-xl font-bold text-foreground mb-4">
                Local LLMs.<br />
                <span className="gradient-text">Zero cloud.</span>
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed mb-6">
                ORA AI runs on your hardware using Ollama, LM Studio, or llama.cpp.
                Choose from hundreds of models — from tiny 1B models for Raspberry Pi
                to powerful 70B models on a home server.
              </p>
              <div className="flex flex-wrap gap-2">
                {["Llama 3", "Mistral", "Phi-3", "Gemma", "Qwen", "DeepSeek"].map(m => (
                  <Badge key={m} variant="glass" className="text-xs">{m}</Badge>
                ))}
              </div>
            </div>
            <div className="lg:col-span-3">
              <div className="rounded-2xl border border-border/30 bg-card/60 backdrop-blur-xl overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-3 border-b border-border/20 bg-muted/20">
                  <div className="flex gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-red-400/60" />
                    <div className="w-2.5 h-2.5 rounded-full bg-amber-400/60" />
                    <div className="w-2.5 h-2.5 rounded-full bg-green-400/60" />
                  </div>
                  <span className="text-[11px] text-muted-foreground ml-2 font-mono">ora-ai ~ local</span>
                </div>
                <div className="p-5 font-mono text-xs leading-relaxed space-y-3 text-muted-foreground">
                  <div>
                    <span className="text-primary/70">$</span>{" "}
                    <span>ora ask "dim the living room lights to 30% and play relaxing music"</span>
                  </div>
                  <div className="pl-4 border-l-2 border-success/30 text-foreground/70">
                    <span className="text-success">✓</span>{" "}
                    Living room lights → 30% brightness<br />
                    <span className="text-success">✓</span>{" "}
                    Media player → Relaxing playlist<br />
                    <span className="text-success">✓</span>{" "}
                    Temperature → 21°C (optimal for evening)
                  </div>
                  <div>
                    <span className="text-primary/70">$</span>{" "}
                    <span>ora ask "what's my energy usage this week compared to last?"</span>
                  </div>
                  <div className="pl-4 border-l-2 border-info/30 text-foreground/70">
                    <span className="text-info">ℹ</span>{" "}
                    This week: 42.3 kWh — 12% less than last week.<br />
                    <span className="text-info">ℹ</span>{" "}
                    Your solar panels covered 68% of consumption.<br />
                    <span className="text-info">ℹ</span>{" "}
                    Suggestion: Shift washing machine to daytime for +8% solar use.
                  </div>
                  <div>
                    <span className="animate-typing-cursor">▊</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════
          FEATURES — SMART HOME PLATFORM
          ═══════════════════════════════════════════════════════════ */}
      <section className="py-24 lg:py-32 border-t border-border/20">
        <div className="mx-auto max-w-6xl px-6 lg:px-10">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-border/30 bg-muted/20 mb-6">
              <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">Platform</span>
            </div>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-foreground mb-4">
              Everything your{" "}
              <span className="gradient-text">smart home</span> needs
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              From device control to dashboards — one platform, beautifully integrated.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {features.map((f, i) => (
              <div
                key={f.title}
                className="glass-card-interactive p-5 group"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 text-primary group-hover:scale-110 transition-transform duration-300">
                    <f.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground mb-1">{f.title}</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">{f.description}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════
          USE CASES
          ═══════════════════════════════════════════════════════════ */}
      <section className="py-24 lg:py-32 bg-muted/5 border-y border-border/20">
        <div className="mx-auto max-w-6xl px-6 lg:px-10">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-border/30 bg-muted/20 mb-6">
              <Users className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">Use Cases</span>
            </div>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-foreground mb-4">
              ORA adapts to{" "}
              <span className="gradient-text">your life</span>
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              From apartments to enterprises — one platform, infinite possibilities.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {useCases.map((uc, i) => (
              <div key={uc.title} className="ai-card p-6 group">
                <div className="relative z-10">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 text-primary mb-5 group-hover:scale-110 transition-transform duration-300">
                    <uc.icon className="h-6 w-6" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground mb-3">{uc.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed mb-4">{uc.description}</p>
                  <ul className="space-y-2">
                    {uc.highlights.map((h) => (
                      <li key={h} className="flex items-center gap-2 text-xs text-foreground/70">
                        <Check className="h-3 w-3 text-success shrink-0" /> {h}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════
          TESTIMONIALS
          ═══════════════════════════════════════════════════════════ */}
      <section className="py-24 lg:py-32">
        <div className="mx-auto max-w-6xl px-6 lg:px-10">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-border/30 bg-muted/20 mb-6">
              <Heart className="h-3.5 w-3.5 text-accent" />
              <span className="text-xs font-medium text-muted-foreground">Community</span>
            </div>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-foreground mb-4">
              Trusted by{" "}
              <span className="gradient-text">smart home</span> lovers
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {testimonials.map((t, i) => (
              <div key={t.name} className="glass-card p-6 flex flex-col">
                <div className="flex gap-0.5 mb-4">
                  {[...Array(5)].map((_, j) => (
                    <Star key={j} className="h-3.5 w-3.5 fill-accent/80 text-accent/80" />
                  ))}
                </div>
                <Quote className="h-5 w-5 text-primary/20 mb-3 shrink-0" />
                <p className="text-sm text-foreground/75 leading-relaxed mb-6 flex-1 italic">
                  &ldquo;{t.quote}&rdquo;
                </p>
                <div className="flex items-center gap-3 pt-4 border-t border-border/20">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-primary/5 text-primary text-xs font-bold shrink-0">
                    {t.name[0]}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{t.name}</p>
                    <p className="text-xs text-muted-foreground">{t.role}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════
          ORA HOME + HOME ASSISTANT
          ═══════════════════════════════════════════════════════════ */}
      <section className="py-24 lg:py-32 bg-muted/5 border-y border-border/20">
        <div className="mx-auto max-w-4xl px-6 lg:px-10">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/15 bg-primary/5 mb-6">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-medium text-primary/80">ORA Home + Home Assistant</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground mb-4">
              <span className="gradient-text">ORA Home</span> extends Home Assistant
            </h2>
            <p className="text-lg text-muted-foreground max-w-xl mx-auto">
              ORA Home integrates with your existing Home Assistant setup — keeping all your devices and automations, while adding a modern AI-powered experience on top.
            </p>
          </div>

          <div className="glass-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/20">
                    <th className="text-left py-4 px-6 font-semibold text-foreground">Feature</th>
                    <th className="text-center py-4 px-4 font-semibold text-xs text-muted-foreground">Home Assistant</th>
                    <th className="text-center py-4 px-4 font-semibold gradient-text-ai">+ ORA</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/15">
                  {addonRows.map((row) => (
                    <tr key={row.feature} className="hover:bg-muted/10 transition-colors">
                      <td className="py-3.5 px-6 font-medium text-foreground/85">{row.feature}</td>
                      <td className="py-3.5 px-4 text-center text-muted-foreground/60 text-xs">
                        {row.ha}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <span className="text-xs text-foreground/80 font-medium">{row.ora}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-center text-xs text-muted-foreground mt-6">
            ORA Home requires a running Home Assistant instance — it extends HA, it doesn&apos;t replace it.
          </p>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════
          FAQ
          ═══════════════════════════════════════════════════════════ */}
      <section className="py-24 lg:py-32">
        <div className="mx-auto max-w-3xl px-6 lg:px-10">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-foreground mb-4">
              Frequently asked{" "}
              <span className="gradient-text">questions</span>
            </h2>
          </div>

          <div className="space-y-3">
            {faqs.map((faq, i) => (
              <div key={i} className="glass-card overflow-hidden">
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full flex items-center justify-between p-5 text-left hover:bg-muted/10 transition-colors"
                >
                  <span className="text-sm font-medium text-foreground pr-4">{faq.question}</span>
                  <ChevronDown className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-300 ${openFaq === i ? "rotate-180" : ""}`} />
                </button>
                <div className={`transition-all duration-300 overflow-hidden ${openFaq === i ? "max-h-96" : "max-h-0"}`}>
                  <div className="px-5 pb-5 text-sm text-muted-foreground leading-relaxed">{faq.answer}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════
          BOTTOM CTA
          ═══════════════════════════════════════════════════════════ */}
      <section className="py-32 lg:py-40 border-t border-border/20 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="orb orb-blue" style={{ top: '-20%', left: '30%', opacity: 0.1 }} />
          <div className="orb orb-purple" style={{ bottom: '-10%', right: '20%', opacity: 0.08 }} />
        </div>
        <div className="mx-auto max-w-3xl px-6 lg:px-10 text-center relative">
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-gradient-to-br from-primary to-primary-accent shadow-xl shadow-primary/25 mb-8 mx-auto">
            <Sparkles className="h-8 w-8 text-white" />
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-foreground mb-6">
            Ready for an{" "}
            <span className="gradient-text-ai">intelligent</span> home?
          </h2>
          <p className="text-lg text-muted-foreground leading-relaxed mb-12 max-w-xl mx-auto">
            Open source. AI-native. Completely free. Your data stays on your
            hardware — where it belongs.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button size="xl" className="shadow-lg shadow-primary/20" asChild>
              <Link href="/docs">
                <Sparkles className="mr-2 h-5 w-5" />
                Get Started Free
                <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
            <Button variant="glass" size="xl" asChild>
              <a href="https://github.com" target="_blank" rel="noopener noreferrer">
                <Github className="mr-2 h-5 w-5" />
                Star on GitHub
              </a>
            </Button>
          </div>
          <p className="mt-6 text-xs text-muted-foreground">
            No credit card. No cloud account. Just download and run.
          </p>
        </div>
      </section>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════
   DATA
   ═══════════════════════════════════════════════════════════ */

const aiPillars = [
  {
    title: "Natural Language",
    description: "Talk to ORA like you'd talk to a person. No commands to memorize, no syntax to learn. Just say what you want.",
    icon: MessageSquare,
  },
  {
    title: "Contextual Intelligence",
    description: "ORA understands your home's state. 'Dim the lights' knows which room you're in. 'I'm cold' adjusts the right thermostat.",
    icon: Brain,
  },
  {
    title: "100% Local",
    description: "All AI processing happens on your hardware. Supports Ollama, LM Studio, llama.cpp. Your conversations are yours alone.",
    icon: Shield,
  },
];

const features = [
  { title: "Universal Device Control", description: "Lights, climate, switches, covers, media, locks — all in one unified interface.", icon: Home },
  { title: "AI Automation Engine", description: "Create automations by describing what you want. No YAML, no code — just natural language.", icon: Wand2 },
  { title: "Custom Dashboards", description: "Drag-and-drop designer with widgets, groups, and dynamic overviews that adapt to your needs.", icon: LayoutTemplate },
  { title: "Glass UI & Themes", description: "Stunning glassmorphism design with custom themes, night mode, and dynamic backgrounds.", icon: Palette },
  { title: "Energy Intelligence", description: "Real-time monitoring, cost analysis, solar optimization, and smart suggestions to save money.", icon: Zap },
  { title: "All Platforms", description: "iOS, Android, Windows, Mac, Linux. PWA for instant install on any device with a browser.", icon: Smartphone },
  { title: "Native Desktop App", description: "Tauri-powered with system tray, glass titlebar, proxy management, and system diagnostics.", icon: Monitor },
  { title: "Privacy Architecture", description: "Zero cloud dependency. Zero telemetry. Your data processes locally and stays local.", icon: Lock },
  { title: "Plugin System", description: "Extend ORA with JavaScript/TypeScript plugins in a secure sandboxed runtime.", icon: Cpu },
];

const useCases = [
  {
    title: "Smart Apartment",
    description: "Perfect for renters — intelligent control without drilling holes or running wires. Just plug and play.",
    icon: Home,
    highlights: ["Smart lights & switches", "Voice-controlled climate", "Energy monitoring", "PWA on any device"],
  },
  {
    title: "Family Home",
    description: "Whole-house automation with scenes, schedules, and per-room control for the entire family.",
    icon: Users,
    highlights: ["Multi-user dashboards", "Room-based scenes", "Camera & security", "Child-safe modes"],
  },
  {
    title: "Professional",
    description: "Deploy ORA at scale with ORA OS. Pre-configured images for Raspberry Pi, Intel NUC, and servers.",
    icon: Building2,
    highlights: ["ORA OS appliance", "Remote management", "Backup & restore", "White-label ready"],
  },
];

const testimonials = [
  {
    quote: "ORA replaced three different apps I was using. The AI actually understands what I want — I just talk and it happens. The fact that it all runs locally is the cherry on top.",
    name: "Marcus L.",
    role: "Smart Home Enthusiast",
  },
  {
    quote: "Finally a platform that respects my privacy. Everything runs locally — no accounts, no cloud, no data collection. And the glass UI is genuinely beautiful.",
    name: "Sarah K.",
    role: "Software Developer",
  },
  {
    quote: "The AI assistant is a game changer. My kids can control the house by just asking — no apps, no training. The dashboard designer means everyone has their own perfect view.",
    name: "Thomas R.",
    role: "Father of three",
  },
];

const addonRows = [
  { feature: "Device Connectivity", ha: "1000+ integrations", ora: "Uses HA — same 1000+" },
  { feature: "AI Assistant", ha: "Not built-in", ora: "Full local AI with LLMs" },
  { feature: "Natural Language Control", ha: "Limited (voice assistants)", ora: "Built-in, fully local" },
  { feature: "Modern UI", ha: "Lovelace (customizable)", ora: "Glass UI with themes & animations" },
  { feature: "Dashboard Designer", ha: "YAML / manual", ora: "Visual drag-and-drop" },
  { feature: "Desktop App", ha: "Not available", ora: "Native Tauri app, all OS" },
  { feature: "Mobile Experience", ha: "Companion app", ora: "PWA + responsive design" },
  { feature: "Automation Editor", ha: "YAML / visual", ora: "Natural language + visual" },
  { feature: "Plugin System", ha: "HACS / custom components", ora: "Sandboxed JS/TS runtime" },
  { feature: "Backend", ha: "Python", ora: "Rust microservices (fast)" },
  { feature: "Multi-User", ha: "Supported", ora: "Enhanced with per-user dashboards" },
  { feature: "Privacy", ha: "Local processing", ora: "Local + zero telemetry by design" },
];

const faqs = [
  {
    question: "Is ORA really completely free?",
    answer: "Yes. ORA is 100% open source under the MIT license. Every feature — including AI — is included for everyone, forever. No paid tiers, no premium locks, no subscriptions. The ORA OS appliance image is also free.",
  },
  {
    question: "What hardware do I need to run ORA?",
    answer: "A Raspberry Pi 4 with 2GB RAM is sufficient for basic operation. For AI features, we recommend 4GB+ RAM for small models (1-3B parameters) or 8GB+ for larger models. ORA also runs on Intel NUCs, old laptops, NAS devices, and virtual machines.",
  },
  {
    question: "Does ORA AI work without internet?",
    answer: "Absolutely. ORA AI uses local LLMs via Ollama, LM Studio, or llama.cpp. All processing happens on your device. Voice control, chat, automation suggestions — everything works completely offline.",
  },
  {
    question: "What devices does ORA support?",
    answer: "ORA Home integrates directly with Home Assistant, giving you access to 1000+ device integrations. It also supports MQTT, Zigbee2MQTT, Z-Wave JS, Matter, BLE, and HomeKit. If a device works with Home Assistant, it works with ORA Home.",
  },
  {
    question: "How does ORA Home work with Home Assistant?",
    answer: "ORA Home integrates deeply with Home Assistant — it's not a replacement, it's an upgrade. ORA Home uses Home Assistant for device connectivity and state management, then layers on top: a modern glass UI, built-in AI assistant with local LLMs, drag-and-drop dashboard designer, native desktop apps, and a JavaScript plugin system. You keep your existing HA setup — ORA Home makes it more powerful, more beautiful, and more intelligent.",
  },
  {
    question: "Can I use ORA with my existing Home Assistant setup?",
    answer: "Absolutely — that's exactly how ORA is designed to work. Just point ORA at your Home Assistant URL and token. All your devices, automations, and configurations remain intact. ORA reads your existing setup and instantly gives you the AI assistant, modern dashboards, and all other features on top.",
  },
  {
    question: "What AI models does ORA support?",
    answer: "ORA supports any model compatible with Ollama, LM Studio, or llama.cpp. This includes Llama 3, Mistral, Phi-3, Gemma, Qwen 2.5, DeepSeek, and hundreds more. Choose the model that fits your hardware and needs.",
  },
];
