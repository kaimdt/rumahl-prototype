"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  History,
  Minus,
  MessageSquareWarning,
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
import { useTranslation } from "react-i18next";
import "@/lib/public-i18n";

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
  const { t } = useTranslation();
  const pathname = usePathname();
  const tenantPrefix = pathname.match(/^\/s\/[a-z0-9]+(?:-[a-z0-9]+)*/)?.[0] ?? "";
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
  const [reported, setReported] = useState(false);
  const [reporting, setReporting] = useState(false);
  const reportProblem = async () => {
    if (!component.service_id || reporting || reported) return;
    setReporting(true);
    const slug = pathname.match(/^\/s\/([a-z0-9]+(?:-[a-z0-9]+)*)/)?.[1];
    const locale = navigator.language || "unknown";
    const region = locale.includes("-") ? locale.split("-")[1].toUpperCase() : Intl.DateTimeFormat().resolvedOptions().timeZone;
    try { await publicApi.reportProblem({ slug, service_id: component.service_id, region }); setReported(true); }
    finally { setReporting(false); }
  };

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
    <div className="statuspage-component px-4 sm:px-5 py-3.5" data-component-id={component.id} data-status={component.status} data-monitoring={monitoring ? "enabled" : "disabled"}>
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
              href={`${tenantPrefix}/history/?component=${encodeURIComponent(component.id)}`}
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

      {(component.active_incidents?.length ?? 0) > 0 && <div className="mt-3 rounded-xl border border-status-major/20 bg-status-major/[0.05] px-3 py-2"><p className="text-[10px] font-bold uppercase tracking-wider text-status-major">Active incident</p>{component.active_incidents?.map((incident) => <Link key={incident.incident_id} href={`${tenantPrefix}/incidents/?id=${encodeURIComponent(incident.incident_id)}`} className="mt-1 flex items-center justify-between gap-3 text-xs font-semibold text-foreground/85 hover:text-foreground"><span className="truncate">{incident.title}</span><span className="shrink-0 uppercase text-status-major">{incident.display_status.replaceAll("_", " ")}</span></Link>)}</div>}

      {component.community_report && <div className="mt-3 rounded-xl border border-amber-400/25 bg-amber-400/[0.07] px-3 py-2 text-xs font-semibold text-amber-700 dark:text-amber-300"><MessageSquareWarning className="mr-2 inline h-4 w-4" />{t("report.cluster", { count: component.community_report.reports })}</div>}
      {component.service_id && <button type="button" disabled={reporting || reported} onClick={() => void reportProblem()} className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"><MessageSquareWarning className="h-3.5 w-3.5" />{reported ? t("report.thanks") : t("report.action")}</button>}

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
    <section className="statuspage-component-group surface-card overflow-hidden" data-group-id={group.id} data-collapsed={collapsed ? "true" : "false"}>
      {/* taller group header — overall group status front AND back */}
      <div className="statuspage-component-group-header status-group-header border-b px-3 sm:px-4 py-3.5">
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
        <div className="statuspage-component-group-body divide-y divide-border/25">
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
    <div className="statuspage-components space-y-6">
      {visibleGroups.map((group) => {
        const ungrouped = group.id === "ungrouped" || group.id === "__ungrouped__";
        if (ungrouped) {
          return <div key={group.id} className="space-y-3">{group.components.map((component) => (
            <div key={component.id} className="surface-card overflow-hidden"><ComponentCard component={component} /></div>
          ))}</div>;
        }
        return <GroupSection key={group.id} group={group} />;
      })}
    </div>
  );
}
