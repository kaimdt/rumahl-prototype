"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  History,
  Minus,
  TriangleAlert,
  Wrench,
  XCircle,
} from "lucide-react";
import type {
  Component,
  ComponentGroup,
  ComponentStatus,
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

/** Round status badge icon — instant visual check at the end of each row. */
const STATUS_BADGE_ICON: Record<ComponentStatus, typeof CheckCircle2> = {
  operational: CheckCircle2,
  degraded: TriangleAlert,
  partial_outage: CircleAlert,
  major_outage: XCircle,
  maintenance: Wrench,
};

function ComponentCard({ component }: { component: Component }) {
  const meta = STATUS_META[component.status];
  // View mode and history range are configured by the ADMIN per component
  // (backend fields) — visitors cannot change them.
  const monitoring = component.kind === "auto" && component.enabled;
  // Self-monitoring components have no check history — hide the history link.
  const isSelf = component.id.startsWith("__self");
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
          {monitoring && !isSelf && component.last_latency_ms !== null && (
            <span className="tabular-nums">{component.last_latency_ms} ms</span>
          )}
          {monitoring && !isSelf && (
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
        {monitoring ? (
          (() => {
            const BadgeIcon = STATUS_BADGE_ICON[component.status];
            return (
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                  meta.bg,
                  meta.text
                )}
                title={meta.label}
              >
                <BadgeIcon className="h-3.5 w-3.5" strokeWidth={2.2} />
              </span>
            );
          })()
        ) : (
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted/40 text-muted-foreground/50"
            title="No monitoring"
          >
            <Minus className="h-3.5 w-3.5" strokeWidth={2.2} />
          </span>
        )}
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
    maintenance: 1,
    degraded: 2,
    partial_outage: 3,
    major_outage: 4,
  };
  let worst: Component["status"] = "operational";
  for (const c of components) {
    if (c.enabled && rank[c.status] > rank[worst]) worst = c.status;
  }
  return worst;
}

/** Shared group/component status badge (round, colored). */
function StatusBadge({ status, size = "md" }: { status: ComponentStatus | "disabled"; size?: "md" | "lg" }) {
  if (status === "disabled") {
    return (
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full bg-muted/40 text-muted-foreground/50",
          size === "lg" ? "h-7 w-7" : "h-6 w-6"
        )}
        title="No monitoring"
      >
        <Minus className={size === "lg" ? "h-4 w-4" : "h-3.5 w-3.5"} strokeWidth={2.2} />
      </span>
    );
  }
  const meta = STATUS_META[status];
  const Icon = STATUS_BADGE_ICON[status];
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full",
        meta.bg,
        meta.text,
        size === "lg" ? "h-7 w-7" : "h-6 w-6"
      )}
      title={meta.label}
    >
      <Icon className={size === "lg" ? "h-4 w-4" : "h-3.5 w-3.5"} strokeWidth={2.2} />
    </span>
  );
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

  const enabled = group.components.filter((c) => c.enabled);
  const disabled = enabled.length === 0;
  const worst: ComponentStatus | "disabled" = disabled ? "disabled" : worstStatus(group.components);
  const label =
    worst === "disabled"
      ? "No monitoring"
      : worst === "maintenance"
        ? "Maintenance"
        : STATUS_META[worst].label;
  const count = group.components.filter((c) => c.enabled).length;

  return (
    <section className="surface-card overflow-hidden">
      {/* taller group header — overall group status front AND back */}
      <div className="border-b border-border/30 bg-muted/20 px-3 sm:px-4 py-3.5">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex w-full items-center gap-3 text-left group"
          aria-expanded={!collapsed}
        >
          <span className="text-muted-foreground/50 transition-colors group-hover:text-foreground">
            {collapsed ? (
              <ChevronRight className="h-4 w-4" strokeWidth={2.2} />
            ) : (
              <ChevronDown className="h-4 w-4" strokeWidth={2.2} />
            )}
          </span>
          <StatusBadge status={worst} size="lg" />
          <span
            className={cn(
              "text-[11px] font-bold uppercase tracking-[0.18em]",
              worst === "disabled" ? "text-muted-foreground/50" : "text-muted-foreground"
            )}
          >
            {group.name}
          </span>
          <span className="ml-auto hidden sm:inline-flex items-center gap-2">
            <span
              className={cn(
                "text-[11px] font-bold uppercase tracking-wide",
                worst === "disabled"
                  ? "text-muted-foreground/50"
                  : worst === "maintenance"
                    ? "text-info"
                    : STATUS_META[worst].text
              )}
            >
              {label}
            </span>
            <StatusBadge status={worst} />
          </span>
          <span className="sm:hidden text-[10.5px] text-muted-foreground/50 tabular-nums">
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
