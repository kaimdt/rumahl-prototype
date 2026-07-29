"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight, Check, Home, Cpu, Shield, Zap, Palette,
  Smartphone, Wand2, MessageSquare, Github, Lock, LayoutTemplate,
  Monitor, Sparkles, ChevronDown, Star, Heart, Quote,
  Users, Building2, Brain, Terminal, Sun,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AIChatDemo } from "@/components/ai-chat-demo";
import { ProductName } from "@/components/ora-logo";
import { DemoSection } from "@/components/demo-section";
import { AnimatedWidgets } from "@/components/animated-widgets";
import { AutomationPlayground } from "@/components/automation-playground";

export default function HomePage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <>
      {/* ═══════════ HERO — Forensic Black + Immediate Value ═══════════ */}
      <section className="relative overflow-hidden selection-primary">
        <AnimatedWidgets />
        <div className="absolute inset-0 pointer-events-none">
          <div className="orb orb-blue" style={{ top: '5%', left: '-5%', opacity: 0.25 }} />
          <div className="orb orb-purple" style={{ bottom: '10%', right: '-10%', opacity: 0.12 }} />
        </div>

        <div className="mx-auto max-w-6xl px-6 lg:px-10 pt-28 pb-16 lg:pt-40 lg:pb-28">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/10 bg-primary/3 mb-6">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary/50 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary" />
                </span>
                <span className="text-[11px] font-medium text-primary/70">
                  <ProductName name="AI" logoSize={34} /> — local LLM support
                </span>
              </div>

              <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-[-0.03em] text-foreground leading-[1.04]">
                Your home,<br />
                <span className="text-primary">finally intelligent.</span>
              </h1>

              <p className="mt-5 text-base text-muted-foreground leading-relaxed max-w-md">
                AI-powered smart home platform. Natural language control, local
                LLMs, stunning glass UI — all on your hardware.
              </p>

              <div className="mt-8 flex flex-col sm:flex-row gap-3">
                <Button size="lg" className="shadow-lg shadow-primary/10" asChild>
                  <Link href="/docs">
                    <Sparkles className="mr-2 h-4 w-4" />
                    Get Started
                    <ArrowRight className="ml-1.5 h-4 w-4" />
                  </Link>
                </Button>
                <Button variant="glass" size="lg" asChild>
                  <Link href="/features">Explore Features</Link>
                </Button>
              </div>

              {/* Social proof — immediate, per 2026 trend */}
              <div className="mt-8 flex items-center gap-6 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-success" /> Open Source</span>
                <span className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-success" /> Local-First</span>
                <span className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-success" /> AI-Native</span>
              </div>
            </div>

            <div className="relative">
              <AIChatDemo />
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════ STATS — Social proof early ═══════════ */}
      <section className="border-y border-border/10">
        <div className="mx-auto max-w-6xl px-6 lg:px-10 py-10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            {[
              { v: "1000+", l: "Devices" },
              { v: "100%", l: "Open Source" },
              { v: "Local", l: "AI Processing" },
              { v: "24/7", l: "Offline" },
            ].map((s) => (
              <div key={s.l}>
                <div className="text-2xl sm:text-3xl font-bold text-foreground">{s.v}</div>
                <div className="mt-1 text-xs text-muted-foreground">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════ BENTO GRID — Features, varying cell sizes ═══════════ */}
      <section className="py-24 lg:py-32 selection-accent">
        <div className="mx-auto max-w-6xl px-6 lg:px-10">
          <div className="mb-12">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-3">Platform</p>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
              Everything your <span className="text-primary">smart home</span> needs
            </h2>
          </div>

          {/* Bento grid: 4 columns, varying spans */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 auto-rows-[140px]">
            {/* AI — large cell (2×2) */}
            <div className="md:col-span-2 md:row-span-2 glass-card p-5 flex flex-col justify-between group"
              onMouseMove={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                e.currentTarget.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`);
                e.currentTarget.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`);
              }}
              style={{ background: 'radial-gradient(circle at var(--mx, 50%) var(--my, 50%), hsl(var(--primary) / 0.04), transparent 70%), hsl(var(--card) / 0.5)' } as React.CSSProperties}
            >
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Brain className="h-4 w-4" />
                  </div>
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">AI Core</span>
                </div>
                <h3 className="text-lg font-bold text-foreground mb-1.5">ORA AI</h3>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-xs">
                  Talk to your home naturally. Local LLMs via Ollama, zero cloud.
                </p>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {["Llama 3", "Mistral", "Phi-3", "DeepSeek"].map(m => (
                  <span key={m} className="text-[10px] px-2 py-0.5 rounded-full border border-border/30 text-muted-foreground">{m}</span>
                ))}
              </div>
            </div>

            {/* Device Control — wide cell */}
            <div className="md:col-span-2 glass-card p-5 flex items-center gap-4 group">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Home className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-foreground">Universal Device Control</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Lights, climate, media, locks &mdash; one interface.</p>
              </div>
            </div>

            {/* Automation */}
            <div className="glass-card p-4 flex flex-col justify-between group">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary mb-2">
                <Zap className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-foreground">Automations</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Natural language + visual editor.</p>
              </div>
            </div>

            {/* Dashboard */}
            <div className="glass-card p-4 flex flex-col justify-between group">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary mb-2">
                <LayoutTemplate className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-foreground">Dashboards</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Drag & drop designer.</p>
              </div>
            </div>

            {/* Energy */}
            <div className="glass-card p-4 flex flex-col justify-between group">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary mb-2">
                <Monitor className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-foreground">Desktop App</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Native Tauri, all OS.</p>
              </div>
            </div>

            {/* Privacy */}
            <div className="glass-card p-4 flex flex-col justify-between group">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary mb-2">
                <Shield className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-foreground">Privacy</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Zero telemetry, all local.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════ AI SECTION — interactive demo ═══════════ */}
      <section className="py-24 lg:py-32 border-y border-border/10 bg-card/20">
        <div className="mx-auto max-w-6xl px-6 lg:px-10">
          <div className="grid lg:grid-cols-5 gap-12 items-center">
            <div className="lg:col-span-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-3">Intelligence</p>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mb-4">
                Meet <ProductName name="AI" logoSize={52} />
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed mb-6">
                Not just a voice assistant. A fully local AI that understands
                context, learns your patterns, and manages your home — zero cloud.
              </p>
              <div className="space-y-2">
                {["Natural language control", "Contextual awareness", "100% local LLMs", "Predictive automation"].map(f => (
                  <div key={f} className="flex items-center gap-2 text-xs text-foreground/70">
                    <Check className="h-3.5 w-3.5 text-success shrink-0" /> {f}
                  </div>
                ))}
              </div>
            </div>
            <div className="lg:col-span-3">
              <div className="rounded-xl border border-border/20 bg-card/60 backdrop-blur-xl overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/10 bg-muted/10">
                  <div className="flex gap-1"><span className="w-2 h-2 rounded-full bg-border/40" /><span className="w-2 h-2 rounded-full bg-border/40" /><span className="w-2 h-2 rounded-full bg-border/40" /></div>
                  <span className="text-[10px] text-muted-foreground ml-2 font-mono">ora-ai ~ local</span>
                </div>
                <div className="p-4 font-mono text-[11px] leading-relaxed space-y-2.5 text-muted-foreground">
                  <div><span className="text-primary/60">$</span> ora ask &quot;dim the living room lights to 30%&quot;</div>
                  <div className="pl-3 border-l-2 border-success/20 text-foreground/60">
                    <span className="text-success">✓</span> Living room → 30%<br />
                    <span className="text-success">✓</span> Temperature → 21°C
                  </div>
                  <div><span className="text-primary/60">$</span> ora ask &quot;energy this week vs last?&quot;</div>
                  <div className="pl-3 border-l-2 border-info/20 text-foreground/60">
                    <span className="text-info">ℹ</span> 42.3 kWh — 12% less<br />
                    <span className="text-info">ℹ</span> Solar covered 68%
                  </div>
                  <div className="text-primary/40">▊</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════ ORA HOME + HA ═══════════ */}
      <section className="py-24 lg:py-32">
        <div className="mx-auto max-w-4xl px-6 lg:px-10">
          <div className="text-center mb-10">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-3">Integration</p>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              <ProductName name="Home" logoSize={72} /> extends Home Assistant
            </h2>
          </div>

          <div className="glass-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/10">
                  <th className="text-left py-3 px-5 font-medium text-foreground/60 text-xs uppercase tracking-wider">Feature</th>
                  <th className="text-center py-3 px-4 font-medium text-foreground/40 text-xs">Home Assistant</th>
                  <th className="text-center py-3 px-4 font-medium text-primary/70 text-xs">+ ORA Home</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/10">
                {[
                  ["Device Connectivity", "1000+ integrations", "Same 1000+"],
                  ["AI Assistant", "Not built-in", "Full local AI + LLMs"],
                  ["Natural Language", "Limited", "Built-in, fully local"],
                  ["UI", "Lovelace (customizable)", "Glass UI + themes"],
                  ["Dashboard Designer", "YAML / manual", "Visual drag-and-drop"],
                  ["Desktop App", "Not available", "Native Tauri, all OS"],
                  ["Backend", "Python", "Rust microservices"],
                ].map(([f, ha, ora]) => (
                  <tr key={f} className="hover:bg-muted/5 transition-colors">
                    <td className="py-3 px-5 font-medium text-foreground/80 text-xs">{f}</td>
                    <td className="py-3 px-4 text-center text-muted-foreground text-xs">{ha}</td>
                    <td className="py-3 px-4 text-center text-foreground/80 text-xs">{ora}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-center text-[11px] text-muted-foreground mt-4">
            <ProductName name="Home" logoSize={38} /> requires Home Assistant — it extends, not replaces.
          </p>
        </div>
      </section>

      {/* ═══════════ USE CASES ═══════════ */}
      <section className="py-24 lg:py-32 border-y border-border/10">
        <div className="mx-auto max-w-6xl px-6 lg:px-10">
          <div className="mb-10">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-3">Use Cases</p>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              ORA adapts to <span className="text-primary">your life</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { t: "Smart Apartment", d: "Intelligent control without drilling holes. Plug, play, enjoy.", h: ["Smart lights & switches", "Voice climate", "Energy monitoring"], i: Home },
              { t: "Family Home", d: "Whole-house automation with scenes and per-room control.", h: ["Multi-user dashboards", "Room scenes", "Camera & security"], i: Users },
              { t: "Professional", d: "Deploy at scale with ORA OS. Pre-configured appliance images.", h: ["ORA OS appliance", "Remote management", "White-label ready"], i: Building2 },
            ].map(uc => (
              <div key={uc.t} className="glass-card p-5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary mb-4">
                  <uc.i className="h-4 w-4" />
                </div>
                <h3 className="text-sm font-bold text-foreground mb-2">{uc.t}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed mb-3">{uc.d}</p>
                <div className="space-y-1">
                  {uc.h.map(h => <div key={h} className="flex items-center gap-1.5 text-[11px] text-foreground/60"><Check className="h-3 w-3 text-success/60 shrink-0" />{h}</div>)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════ TESTIMONIALS ═══════════ */}
      <section className="py-24 lg:py-32">
        <div className="mx-auto max-w-6xl px-6 lg:px-10">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-3 text-center">Community</p>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground text-center mb-10">
            Trusted by <span className="text-primary">smart home</span> lovers
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { q: "ORA replaced three apps. The AI understands what I want — I just talk. All local is the cherry on top.", n: "Marcus L.", r: "Smart Home Enthusiast" },
              { q: "Finally a platform that respects privacy. No accounts, no cloud, no data collection. The UI is gorgeous.", n: "Sarah K.", r: "Software Developer" },
              { q: "My kids control the house by just asking. The dashboard designer means everyone has their perfect view.", n: "Thomas R.", r: "Father of three" },
            ].map(t => (
              <div key={t.n} className="glass-card p-5 flex flex-col">
                <div className="flex gap-0.5 mb-3">{[...Array(5)].map((_, i) => <Star key={i} className="h-3 w-3 fill-amber-500/60 text-amber-500/60" />)}</div>
                <Quote className="h-4 w-4 text-primary/15 mb-3 shrink-0" />
                <p className="text-xs text-foreground/65 leading-relaxed mb-5 flex-1 italic">&ldquo;{t.q}&rdquo;</p>
                <div className="flex items-center gap-2.5 pt-3 border-t border-border/10">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary text-[10px] font-bold">{t.n[0]}</div>
                  <div>
                    <p className="text-xs font-semibold text-foreground">{t.n}</p>
                    <p className="text-[10px] text-muted-foreground">{t.r}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════ FAQ ═══════════ */}
      <section className="py-24 lg:py-32 border-t border-border/10">
        <div className="mx-auto max-w-2xl px-6 lg:px-10">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-3 text-center">FAQ</p>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground text-center mb-10">
            Frequently asked <span className="text-primary">questions</span>
          </h2>

          <div className="space-y-2">
            {[
              { q: "Is ORA really free?", a: "Yes. 100% open source, MIT license. Every feature included forever — no paid tiers, no subscriptions." },
              { q: "What hardware do I need?", a: "Raspberry Pi 4 (2GB) for basic use. 4GB+ for AI features. Also runs on Intel NUCs, old laptops, NAS devices, VMs." },
              { q: "Does ORA AI work offline?", a: "Absolutely. All AI runs locally via Ollama, LM Studio, or llama.cpp. Zero internet required." },
              { q: "What devices does ORA support?", a: "ORA Home integrates with Home Assistant, giving you 1000+ integrations. Plus MQTT, Zigbee2MQTT, Z-Wave, Matter, BLE, HomeKit." },
              { q: "How does ORA Home work with HA?", a: "ORA Home uses HA for device connectivity, then layers on: AI assistant, glass UI, drag-and-drop dashboards, desktop app, plugin system." },
              { q: "Can I use my existing HA setup?", a: "Yes — just point ORA Home at your HA URL and token. All devices and automations stay intact." },
              { q: "What AI models are supported?", a: "Any model via Ollama/LM Studio/llama.cpp: Llama 3, Mistral, Phi-3, Gemma, Qwen 2.5, DeepSeek, and hundreds more." },
            ].map((faq, i) => (
              <div key={i} className="glass-card overflow-hidden">
                <button onClick={() => setOpenFaq(openFaq === i ? null : i)} className="w-full flex items-center justify-between p-4 text-left hover:bg-muted/5 transition-colors">
                  <span className="text-sm font-medium text-foreground pr-4">{faq.q}</span>
                  <ChevronDown className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200 ${openFaq === i ? "rotate-180" : ""}`} />
                </button>
                <div className={`transition-all duration-200 overflow-hidden ${openFaq === i ? "max-h-48" : "max-h-0"}`}>
                  <div className="px-4 pb-4 text-sm text-muted-foreground leading-relaxed">{faq.a}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════ INTERACTIVE DEMO ═══════════ */}
      <DemoSection />

      {/* ═══════════ AUTOMATION PLAYGROUND ═══════════ */}
      <AutomationPlayground />

      {/* ═══════════ CTA ═══════════ */}
      <section className="py-32 lg:py-40 border-t border-border/10 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="orb orb-blue" style={{ top: '-15%', left: '30%', opacity: 0.08 }} />
        </div>
        <div className="mx-auto max-w-2xl px-6 lg:px-10 text-center relative">
          <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-primary/10 text-primary mb-6">
            <Sparkles className="h-6 w-6" />
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mb-4">
            Ready for an <span className="text-primary">intelligent</span> home?
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed mb-8 max-w-md mx-auto">
            Open source. AI-native. Completely free. Your data stays on your hardware.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button size="lg" className="shadow-lg shadow-primary/10" asChild>
              <Link href="/docs"><Sparkles className="mr-2 h-4 w-4" />Get Started<ArrowRight className="ml-1.5 h-4 w-4" /></Link>
            </Button>
            <Button variant="glass" size="lg" asChild>
              <a href="https://github.com" target="_blank" rel="noopener noreferrer"><Github className="mr-2 h-4 w-4" />Star on GitHub</a>
            </Button>
          </div>
          <p className="mt-4 text-[11px] text-muted-foreground">No credit card. No cloud account. Just download.</p>
        </div>
      </section>
    </>
  );
}
