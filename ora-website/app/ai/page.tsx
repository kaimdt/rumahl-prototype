import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight, Check, MessageSquare, Mic, Cpu, Brain, Zap, TrendingUp,
  Sparkles, ShieldCheck, Github,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { AIChatDemo } from "@/components/ai-chat-demo";
import { ORAIntro } from "@/components/ai/ora-intro";
import { ORAIcon, ORALogo } from "@/components/ora-logo";
import { RumahlIcon } from "@/components/rumahl-logo";

export const metadata: Metadata = {
  title: "ORA AI",
  description:
    "Meet rumahl ORA — the AI assistant built into rumahl OS. Natural language, voice and context awareness, 100% local, zero cloud.",
};

const oraCapabilities = [
  {
    t: "Natural Language",
    d: "Just talk or type. ORA understands what you mean — no command syntax, no apps to open.",
    i: MessageSquare,
  },
  {
    t: "Voice Control",
    d: "Speak to your home from any room. ORA answers, acts and confirms — hands-free.",
    i: Mic,
  },
  {
    t: "Local LLMs",
    d: "Runs on Ollama, LM Studio or llama.cpp. No cloud API, no subscription, no data leaving your home.",
    i: Cpu,
  },
  {
    t: "Context Awareness",
    d: "ORA knows who is home, what room you're in, and what's happening — and acts accordingly.",
    i: Brain,
  },
  {
    t: "Automations",
    d: "Describe what you want: \u201Cwhen I get home, warm up the living room\u201D — ORA builds the automation.",
    i: Zap,
  },
  {
    t: "Predictive",
    d: "Learns your patterns and suggests routines before you even ask.",
    i: TrendingUp,
  },
];

const supportedModels = [
  "Llama 3", "Mistral", "Phi-3", "Gemma", "Qwen 2.5", "DeepSeek", "Mixtral",
];

export default function AIPage() {
  return (
    <>
      <ORAIntro />
      {/* ═══════════ HERO — rumahl ORA ═══════════ */}
      <section className="relative overflow-hidden selection-primary">
        {/* Das ORA-Logo als großes Deko-Element */}
        <ORAIcon
          className="absolute -right-24 top-1/2 -translate-y-1/2 h-[560px] w-auto text-primary opacity-[0.05] pointer-events-none select-none hidden lg:block"
          aria-hidden="true"
        />
        <div className="absolute inset-0 pointer-events-none">
          <div className="orb orb-blue" style={{ top: '5%', left: '-5%', opacity: 0.2 }} />
          <div className="orb orb-purple" style={{ bottom: '10%', right: '-10%', opacity: 0.1 }} />
        </div>

        <div className="mx-auto max-w-6xl px-6 lg:px-10 pt-28 pb-16 lg:pt-40 lg:pb-28">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <div>
              <div className="inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-full border border-primary/15 bg-primary/5 mb-6">
                <ORAIcon className="h-5 w-5 text-primary" />
                <span className="text-[11px] font-medium text-primary/80">
                  rumahl ORA — the AI assistant in rumahl OS
                </span>
              </div>

              <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-[-0.03em] text-foreground leading-[1.04]">
                Your home,<br />
                <span className="gradient-text">finally listening.</span>
              </h1>

              <p className="mt-5 text-base text-muted-foreground leading-relaxed max-w-md">
                ORA is the AI assistant built into rumahl OS. Natural language,
                voice and context — 100% local, zero cloud. Your conversations
                never leave your home.
              </p>

              <div className="mt-8 flex flex-col sm:flex-row gap-3">
                <Button size="lg" className="shadow-lg shadow-primary/10" asChild>
                  <a href="#ora-demo">
                    <Sparkles className="mr-2 h-4 w-4" />
                    Try the demo
                    <ArrowRight className="ml-1.5 h-4 w-4" />
                  </a>
                </Button>
                <Button variant="glass" size="lg" asChild>
                  <Link href="/docs">Get Started</Link>
                </Button>
              </div>

              <div className="mt-8 flex items-center gap-6 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-success" /> Local LLMs</span>
                <span className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-success" /> Zero Cloud</span>
                <span className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-success" /> Open Source</span>
              </div>
            </div>

            <div className="relative scroll-mt-24" id="ora-demo">
              {/* Das alte ORA-Logo als Wortmarke */}
              <div className="flex justify-center mb-6">
                <ORALogo className="h-12 w-auto text-foreground" />
              </div>
              <AIChatDemo />
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════ WHAT CAN ORA DO ═══════════ */}
      <section className="py-24 lg:py-32 border-t border-border/10">
        <div className="mx-auto max-w-6xl px-6 lg:px-10">
          <div className="mb-14 max-w-2xl">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-3">Capabilities</p>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
              What can <span className="gradient-text">ORA</span> do?
            </h2>
            <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
              ORA turns rumahl OS into a home that listens — and acts. From
              everyday questions to full home automation, everything happens
              locally on your hardware.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {oraCapabilities.map((c) => (
              <div key={c.t} className="rounded-2xl border border-border/40 bg-card/40 p-6 hover:border-primary/30 hover:bg-card/60 transition-all duration-300 group">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary mb-4 group-hover:scale-110 transition-transform duration-300">
                  <c.i className="h-5 w-5" />
                </div>
                <h3 className="text-base font-bold text-foreground mb-1.5">{c.t}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{c.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════ TERMINAL ═══════════ */}
      <section className="py-24 lg:py-32 border-y border-border/10 bg-card/20 relative overflow-hidden">
        <div className="mx-auto max-w-4xl px-6 lg:px-10">
          <div className="text-center mb-10">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-3">Under the hood</p>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              One assistant. <span className="text-primary">Every interface.</span>
            </h2>
            <p className="text-sm text-muted-foreground mt-3 max-w-xl mx-auto">
              The same ORA powers chat, voice and the CLI — with one consistent
              understanding of your home.
            </p>
          </div>

          <div className="rounded-2xl border border-border/20 bg-card/60 backdrop-blur-xl overflow-hidden shadow-xl shadow-black/20">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/10 bg-muted/10">
              <div className="flex gap-1"><span className="w-2 h-2 rounded-full bg-border/40" /><span className="w-2 h-2 rounded-full bg-border/40" /><span className="w-2 h-2 rounded-full bg-border/40" /></div>
              <span className="text-[10px] text-muted-foreground ml-2 font-mono">ora-ai ~ local</span>
            </div>
            <div className="p-4 font-mono text-[11px] leading-relaxed space-y-2.5 text-muted-foreground">
              <div><span className="text-primary/60">$</span> ora ask &quot;good night&quot;</div>
              <div className="pl-3 border-l-2 border-success/20 text-foreground/60">
                <span className="text-success">✓</span> Doors locked<br />
                <span className="text-success">✓</span> Lights off (except hallway)<br />
                <span className="text-success">✓</span> Heating → 18°C<br />
                <span className="text-success">✓</span> Alarm armed
              </div>
              <div><span className="text-primary/60">$</span> ora ask &quot;why is the living room cold?&quot;</div>
              <div className="pl-3 border-l-2 border-info/20 text-foreground/60">
                <span className="text-info">ℹ</span> Window open in bedroom — heat is escaping<br />
                <span className="text-info">ℹ</span> Suggested: automation to alert when windows open
              </div>
              <div><span className="text-primary/60">$</span> ora ask &quot;summarize my energy use this month&quot;</div>
              <div className="pl-3 border-l-2 border-info/20 text-foreground/60">
                <span className="text-info">ℹ</span> 412 kWh — 9% below average<br />
                <span className="text-info">ℹ</span> Solar covered 71% of daytime usage
              </div>
              <div className="text-primary/40">▊</div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════ MODELS ═══════════ */}
      <section className="py-24 lg:py-32">
        <div className="mx-auto max-w-6xl px-6 lg:px-10">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-3">Bring your own model</p>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mb-4">
                Runs any model <span className="text-primary">you choose</span>
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed mb-6">
                ORA works with every major local LLM runtime — Ollama, LM Studio,
                llama.cpp. Pick a model that fits your hardware, from a Raspberry Pi
                to a dedicated GPU server. No vendor lock-in, no API bills.
              </p>
              <div className="flex flex-wrap gap-2">
                {["Ollama", "LM Studio", "llama.cpp"].map(p => (
                  <span key={p} className="text-xs px-3 py-1.5 rounded-full border border-primary/20 bg-primary/5 text-primary/80 font-medium">{p}</span>
                ))}
              </div>
            </div>
            <div>
              <div className="rounded-2xl border border-border/40 bg-card/40 p-6">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-4">Supported models</p>
                <div className="flex flex-wrap gap-2">
                  {supportedModels.map(m => (
                    <span key={m} className="text-xs px-3 py-1.5 rounded-full border border-border/30 bg-muted/20 text-foreground/80">{m}</span>
                  ))}
                  <span className="text-xs px-3 py-1.5 rounded-full border border-border/30 text-muted-foreground">…and hundreds more</span>
                </div>
                <div className="mt-6 pt-6 border-t border-border/10 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    <span className="text-foreground font-medium">Private by design.</span> Prompts,
                    answers and context stay on your hardware — always.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════ CTA ═══════════ */}
      <section className="py-32 lg:py-40 border-t border-border/10 relative overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none" aria-hidden="true">
          <ORAIcon className="h-[380px] w-auto text-primary opacity-[0.05]" />
        </div>
        <div className="mx-auto max-w-2xl px-6 lg:px-10 text-center relative">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-primary/10 text-primary mb-6">
            <ORAIcon className="h-8 w-8 text-primary" />
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground mb-4">
            ORA is part of <span className="gradient-text">rumahl OS</span>
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed mb-8 max-w-md mx-auto">
            One operating system for your home — with ORA as your assistant.
            Open source, local-first, free.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button size="lg" className="shadow-lg shadow-primary/10" asChild>
              <Link href="/docs"><Sparkles className="mr-2 h-4 w-4" />Get Started<ArrowRight className="ml-1.5 h-4 w-4" /></Link>
            </Button>
            <Button variant="glass" size="lg" asChild>
              <Link href="/"><RumahlIcon className="mr-2 h-4 w-auto" />Back to rumahl OS</Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
