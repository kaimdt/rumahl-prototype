"use client";

import Link from "next/link";
import { History } from "lucide-react";
import type { Component, ComponentGroup } from "@/lib/types";
import { STATUS_META, formatUptime } from "@/lib/status-meta";
import { cn } from "@/lib/utils";

function ComponentRow({ component }: { component: Component }) {
  const meta = STATUS_META[component.status];

  return (
    <div className="flex items-center gap-3 px-4 sm:px-5 py-3.5">
      <span
        className={cn("h-2.5 w-2.5 shrink-0 rounded-full", meta.dot)}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground truncate">
          {component.name}
        </p>
        {component.description && (
          <p className="text-xs text-muted-foreground truncate">
            {component.description}
          </p>
        )}
      </div>
      <div className="hidden sm:flex items-center gap-4 text-[12px] text-muted-foreground shrink-0">
        {component.kind === "auto" && component.last_latency_ms !== null && (
          <span className="tabular-nums">{component.last_latency_ms} ms</span>
        )}
        <Link
          href={`/history/?component=${encodeURIComponent(component.id)}`}
          className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
          title="Uptime history"
        >
          <History className="h-3.5 w-3.5" />
          {formatUptime(component.uptime_90)}
        </Link>
      </div>
      <span
        className={cn(
          "text-[12px] font-semibold shrink-0 tabular-nums",
          meta.text
        )}
      >
        {meta.label}
      </span>
    </div>
  );
}

export function ComponentList({ groups }: { groups: ComponentGroup[] }) {
  const visibleGroups = groups.filter((g) => g.components.length > 0);

  if (visibleGroups.length === 0) {
    return (
      <div className="surface-card p-8 text-center text-sm text-muted-foreground">
        No components configured yet.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {visibleGroups.map((group) => (
        <section key={group.id} className="surface-card overflow-hidden">
          <div className="border-b border-border/30 bg-muted/20 px-4 sm:px-5 py-2.5">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              {group.name}
            </h2>
          </div>
          <div className="divide-y divide-border/25">
            {group.components.map((component) => (
              <ComponentRow key={component.id} component={component} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
