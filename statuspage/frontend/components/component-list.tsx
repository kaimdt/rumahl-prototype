"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, History } from "lucide-react";
import type {
  Component,
  ComponentGroup,
  DowntimeRangeResponse,
  LatencyResponse,
  UptimeResponse,
} from "@/lib/types";
import { STATUS_META, formatUptime } from "@/lib/status-meta";
import { cn } from "@/lib/utils";
import { publicApi } from "@/lib/api";
import { UptimeChart } from "./uptime-chart";
import { LatencyChart } from "./latency-chart";

/* ── single component card ── */

function ComponentCard({ component }: { component: Component }) {
  const meta = STATUS_META[component.status];
  // View mode and history range are configured by the ADMIN per component
  // (backend fields) — visitors cannot change them.
  const monitoring = component.kind === "auto" && component.enabled;
  const view = monitoring ? component.view_mode : "compact";
  const days = monitoring ? component.history_days : 90;
  const showCharts = monitoring && view !== "compact" && days > 0;
  const latencyDays = Math.min(days || 14, 31); // raw data kept 31 days

  const [uptime, setUptime] = useState<UptimeResponse | null>(null);
  const [latency, setLatency] = useState<LatencyResponse | null>(null);
  const [downtime, setDowntime] = useState<DowntimeRangeResponse | null>(null);

  useEffect(() => {
    if (!showCharts) {
      setUptime(null);
      setLatency(null);
      setDowntime(null);
      return;
    }
    let cancelled = false;
    publicApi
      .uptime(component.id, days)
      .then((u) => !cancelled && setUptime(u))
      .catch(() => undefined);
    // Outage details for the whole range in ONE request — instant tooltips.
    publicApi
      .downtimeRange(component.id, days)
      .then((d) => !cancelled && setDowntime(d))
      .catch(() => undefined);
    if (view === "extended") {
      publicApi
        .latency(component.id, latencyDays)
        .then((l) => !cancelled && setLatency(l))
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [component.id, showCharts, days, view, latencyDays]);

  return (
    <div className="px-4 sm:px-5 py-3.5">
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "h-2.5 w-2.5 shrink-0 rounded-full",
            monitoring ? meta.dot : "bg-muted-foreground/30"
          )}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground truncate">{component.name}</p>
          {component.description && (
            <p className="text-xs text-muted-foreground truncate">{component.description}</p>
          )}
        </div>
        <div className="hidden sm:flex items-center gap-4 text-[12px] text-muted-foreground shrink-0">
          {monitoring && component.last_latency_ms !== null && (
            <span className="tabular-nums">{component.last_latency_ms} ms</span>
          )}
          {monitoring && (
            <Link
              href={`/history/?component=${encodeURIComponent(component.id)}`}
              className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
              title="Uptime history"
            >
              <History className="h-3.5 w-3.5" />
              {formatUptime(component.uptime_90)}
            </Link>
          )}
        </div>
        <span
          className={cn(
            "text-[12px] font-semibold shrink-0 tabular-nums",
            monitoring ? meta.text : "text-muted-foreground/60"
          )}
        >
          {monitoring ? meta.label : "No monitoring"}
        </span>
      </div>

      {showCharts && (
        <div className="mt-3 space-y-3">
          <UptimeChart
            componentId={component.id}
            uptime={uptime?.uptime ?? []}
            days={days}
            density="compact"
            downtimeDetails={downtime?.days_data ?? {}}
          />
          {view === "extended" && (
            <LatencyChart points={latency?.points ?? []} days={latencyDays} compact />
          )}
        </div>
      )}
    </div>
  );
}

/* ── group with collapse support ── */

function worstStatus(components: Component[]): Component["status"] {
  const rank: Record<Component["status"], number> = {
    operational: 0,
    degraded: 1,
    partial_outage: 2,
    major_outage: 3,
  };
  let worst: Component["status"] = "operational";
  for (const c of components) {
    if (c.enabled && rank[c.status] > rank[worst]) worst = c.status;
  }
  return worst;
}

function GroupSection({ group }: { group: ComponentGroup }) {
  const hasIssues = group.components.some((c) => c.enabled && c.status !== "operational");
  const [collapsed, setCollapsed] = useState(
    () => group.collapsed && !(group.auto_expand && hasIssues)
  );

  // Auto-expand whenever a component in the group has issues.
  useEffect(() => {
    if (group.auto_expand && hasIssues) setCollapsed(false);
  }, [group.auto_expand, hasIssues]);

  const worst = worstStatus(group.components);
  const dot = STATUS_META[worst].dot;
  const count = group.components.filter((c) => c.enabled).length;

  return (
    <section className="surface-card overflow-hidden">
      <div className="border-b border-border/30 bg-muted/20 px-3 sm:px-4 py-2">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex w-full items-center gap-2 text-left group"
          aria-expanded={!collapsed}
        >
          <span className="text-muted-foreground/50 transition-colors group-hover:text-foreground">
            {collapsed ? (
              <ChevronRight className="h-4 w-4" strokeWidth={2.2} />
            ) : (
              <ChevronDown className="h-4 w-4" strokeWidth={2.2} />
            )}
          </span>
          <span className={cn("h-2 w-2 rounded-full", hasIssues ? dot : "bg-status-operational/70")} />
          <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            {group.name}
          </span>
          <span className="ml-auto text-[10.5px] text-muted-foreground/50 tabular-nums">
            {count} {count === 1 ? "component" : "components"}
          </span>
        </button>
      </div>
      {!collapsed && (
        <div className="divide-y divide-border/25">
          {group.components.map((component) => (
            <ComponentCard key={component.id} component={component} />
          ))}
        </div>
      )}
    </section>
  );
}

export function ComponentList({ groups }: { groups: ComponentGroup[] }) {
  const visibleGroups = useMemo(
    () => groups.filter((g) => g.components.length > 0),
    [groups]
  );

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
        <GroupSection key={group.id} group={group} />
      ))}
    </div>
  );
}
