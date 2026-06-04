"use client";

import { LightWidget } from "@/components/light-widget";
import { ClimateWidget } from "@/components/climate-widget";

export function DemoSection() {
  return (
    <section className="py-24 lg:py-32 border-t border-border/10 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="orb orb-teal" style={{ top: '30%', right: '-10%', opacity: 0.04 }} />
      </div>

      <div className="mx-auto max-w-6xl px-6 lg:px-10">
        <div className="text-center mb-12">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-3">Try it yourself</p>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            Real <span className="text-primary">ORA</span> widgets
          </h2>
          <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
            These are the actual IORA dashboard widgets — fully interactive.
            Click to toggle, the fill tracks brightness.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl mx-auto">
          <LightWidget />
          <ClimateWidget />
        </div>
      </div>
    </section>
  );
}
