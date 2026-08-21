"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BarChart3,
  ChevronDown,
  ChevronRight,
  History,
  LineChart,
  Rows3,
} from "lucide-react";
import type {
  Component,
  ComponentGroup,
  ComponentView,
  HistoryRange,
  LatencyResponse,
  UptimeResponse,
} from "@/lib/types";
import { STATUS_META, formatUptime } from "@/lib/status-meta";
import { cn } from "@/lib/utils";
import { publicApi } from "@/lib/api";
import { UptimeChart } from "./uptime-chart";
import { LatencyChart } from "./latency-chart";

/* ── per-component view preferences (stored in localStorage) ── */

const viewKey = (id: string) => `rumahl-status:view:${id}`;
const daysKey = (id: string) => `rumahl-status:days:${id}`;

function loadPref<T extends string>(key: string, fallback: T, allowed: T[]): T {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  return raw !== null && (allowed as string[]).includes(raw) ? (raw as T) : fallback;
}

function storePref(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode — preferences simply do not persist */
  }
}

export const HISTORY_RANGES: { value: HistoryRange; label: string }[] = [
  { value: "none", label: "No history" },
  { value: "7", label: "7 days" },
  { value: "14", label: "14 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "180", label: "180 days" },
  { value: "365", label: "1 year" },
];

const VIEWS: { value: ComponentView; icon: typeof Rows3; title: string }[] = [
  { value: "compact", icon: Rows3, title: "Compact — current view" },
  { value: "bars", icon: BarChart3, title: "Uptime bars" },
  { value: "extended", icon: LineChart, title: "Uptime bars + latency graph" },
];

/* ── single component card ── */

function ComponentCard({ component }: { component: Component }) {
  const meta = STATUS_META[component.status];

  const [view, setView] = useState<ComponentView>(() =>
    loadPref<ComponentView>(viewKey(component.id), "compact", ["compact", "bars", "extended"])
  );
  const [days, setDays] = useState<HistoryRange>(() =>
    loadPref<HistoryRange>(
      daysKey(component.id),
      "90",
      ["none", "7", "14", "30", "90", "180", "365"]
    )
  );
  const [uptime, setUptime] = useState<UptimeResponse | null>(null);
  const [latency, setLatency] = useState<LatencyResponse | null>(null);

  const showCharts = component.kind === "auto" && view !== "compact" && days !== "none";
  const latencyDays = Math.min(Number(days) || 14, 31); // raw data kept 31 days

  const selectView = (v: ComponentView) => {
    setView(v);
    storePref(viewKey(component.id), v);
  };
  const selectDays = (d: HistoryRange) => {
    setDays(d);
    storePref(daysKey(component.id), d);
  };

  useEffect(() => {
    if (!showCharts) {
      setUptime(null);
      setLatency(null);
      return;
    }
    let cancelled = false;
    publicApi
      .uptime(component.id, Number(days))
      .then((u) => !cancelled && setUptime(u))
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
        <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", meta.dot)} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground truncate">{component.name}</p>
          {component.description && (
            <p className="text-xs text-muted-foreground truncate">{component.description}</p>
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
          className={cn("text-[12px] font-semibold shrink-0 tabular-nums", meta.text)}
        >
          {meta.label}
        </span>
      </div>

      {component.kind === "auto" && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-lg border border-border/30 p-0.5">
            {VIEWS.map(({ value, icon: Icon, title }) => (
              <button
                key={value}
                onClick={() => selectView(value)}
                title={title}
                className={cn(
                  "inline-flex h-6 w-7 items-center justify-center rounded-md transition-colors",
                  view === value
                    ? "bg-primary/12 text-primary"
                    : "text-muted-foreground/60 hover:text-foreground"
                )}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            ))}
          </div>
          <select
            value={days}
            onChange={(e) => selectDays(e.target.value as HistoryRange)}
            title="How much history to show"
            className="h-7 rounded-lg border border-border/30 bg-transparent px-2 text-[11.5px] font-semibold text-muted-foreground focus:outline-none focus:border-primary/40"
          >
            {HISTORY_RANGES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {showCharts && (
        <div className="mt-3 space-y-3">
          <UptimeChart
            componentId={component.id}
            uptime={uptime?.uptime ?? []}
            days={Number(days)}
            density="compact"
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
