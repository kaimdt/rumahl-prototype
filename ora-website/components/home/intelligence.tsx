import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { Reveal } from "@/components/reveal";
import { OraPreview, AutomationPreview } from "@/components/preview/ora";
import { DashboardPreview } from "@/components/preview/dashboard";

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
      {children}
    </p>
  );
}

function Points({ items }: { items: string[] }) {
  return (
    <div className="mt-6 space-y-2">
      {items.map((p) => (
        <div key={p} className="flex items-center gap-2.5 text-sm text-foreground/80">
          <Check className="h-4 w-4 text-primary shrink-0" strokeWidth={2.2} />
          {p}
        </div>
      ))}
    </div>
  );
}

/* ═══════════ ORA ═══════════ */
export function OraSection() {
  return (
    <section className="py-24 lg:py-32">
      <div className="mx-auto max-w-6xl px-6 lg:px-10">
        <div className="grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
          <Reveal className="lg:col-span-5">
            <Eyebrow>Intelligence</Eyebrow>
            <h2 className="text-3xl sm:text-4xl lg:text-[2.75rem] font-bold tracking-[-0.02em] text-foreground leading-[1.05]">
              Meet <span className="text-primary">rumahl ORA</span>.
            </h2>
            <p className="mt-5 text-base text-muted-foreground leading-relaxed">
              ORA is your AI assistant, built into the operating system. It doesn&apos;t
              just chat — it finds your files, explains system status, manages apps
              and builds automations. Everything runs locally on your hardware.
            </p>
            <Points
              items={[
                "Finds files, photos and settings",
                "Creates automations from plain language",
                "100% local models — Ollama, LM Studio, llama.cpp",
              ]}
            />
            <div className="mt-8">
              <Link
                href="/ai"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:gap-2.5 transition-all"
              >
                Meet rumahl ORA
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </Reveal>
          <Reveal delay={120} className="lg:col-span-7">
            <OraPreview />
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ═══════════ Automations ═══════════ */
export function AutomationsSection() {
  return (
    <section className="py-24 lg:py-32 bg-[hsl(var(--surface))] border-y border-border/50">
      <div className="mx-auto max-w-6xl px-6 lg:px-10">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
          <Reveal className="order-2 lg:order-1">
            <AutomationPreview />
          </Reveal>
          <Reveal delay={120} className="order-1 lg:order-2">
            <Eyebrow>Automations</Eyebrow>
            <h2 className="text-3xl sm:text-4xl lg:text-[2.75rem] font-bold tracking-[-0.02em] text-foreground leading-[1.05]">
              Tell ORA what you want.
              <br />
              <span className="text-primary">rumahl builds it.</span>
            </h2>
            <p className="mt-5 text-base text-muted-foreground leading-relaxed">
              IF front door opens, AND nobody is home, THEN lights on. Describe the
              rule in plain language — the visual editor shows exactly what happens,
              and every automation runs locally.
            </p>
            <Points
              items={["Visual IF / AND / THEN editor", "Natural-language creation via ORA", "Runs offline, always"]}
            />
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ═══════════ Widgets & Dashboard ═══════════ */
export function WidgetsSection() {
  return (
    <section className="py-24 lg:py-32">
      <div className="mx-auto max-w-6xl px-6 lg:px-10">
        <div className="grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
          <Reveal className="lg:col-span-7">
            <DashboardPreview />
          </Reveal>
          <Reveal delay={120} className="lg:col-span-5">
            <Eyebrow>Dashboards & widgets</Eyebrow>
            <h2 className="text-3xl sm:text-4xl lg:text-[2.75rem] font-bold tracking-[-0.02em] text-foreground leading-[1.05]">
              Your home,
              <br />
              at a glance.
            </h2>
            <p className="mt-5 text-base text-muted-foreground leading-relaxed">
              The widgets above are the real rumahl OS components — click them.
              Build your own dashboard from devices, energy, storage, media and
              automations, arranged the way you live.
            </p>
            <Points
              items={["Drag-and-drop page designer", "Device, energy & system widgets", "One dashboard per room or person"]}
            />
          </Reveal>
        </div>
      </div>
    </section>
  );
}
