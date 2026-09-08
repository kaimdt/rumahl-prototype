"use client";

import { useEffect, useState } from "react";
import { Activity, AlertTriangle, Bell, Clock, Gauge, Server, ShieldAlert, Wrench } from "lucide-react";
import { adminApi } from "@/lib/api";
import type { MonitoringOverview } from "@/lib/types";
import { useAdminTranslation, type AdminTranslationKey } from "@/lib/admin-i18n";
import { cn } from "@/lib/utils";

const summaryCards: Array<{
  key: keyof MonitoringOverview["summary"];
  label: AdminTranslationKey;
  icon: typeof Activity;
  urgent?: boolean;
}> = [
  { key: "hosts", label: "monitoring.hosts", icon: Server },
  { key: "services", label: "monitoring.services", icon: Activity },
  { key: "failing_services", label: "monitoring.failingServices", icon: ShieldAlert, urgent: true },
  { key: "degraded_services", label: "monitoring.degradedServices", icon: Gauge, urgent: true },
  { key: "active_incidents", label: "monitoring.activeIncidents", icon: AlertTriangle, urgent: true },
  { key: "maintenances", label: "monitoring.maintenances", icon: Wrench },
  { key: "failed_checks", label: "monitoring.failedChecks", icon: Clock, urgent: true },
  { key: "offline_agents", label: "monitoring.offlineAgents", icon: Server, urgent: true },
  { key: "active_alerts", label: "monitoring.activeAlerts", icon: Bell, urgent: true },
];

export function MonitoringOverviewTab() {
  const t = useAdminTranslation();
  const [data, setData] = useState<MonitoringOverview | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    adminApi.monitoringOverview().then((next) => active && setData(next)).catch(() => active && setError(true));
    const timer = window.setInterval(() => {
      adminApi.monitoringOverview().then((next) => active && setData(next)).catch(() => undefined);
    }, 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  if (error && data === null) {
    return <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6 text-sm text-red-300">{t("monitoring.error")}</div>;
  }
  if (data === null) {
    return <div className="rounded-2xl border border-border/50 bg-card/40 p-8 text-sm text-muted-foreground">{t("monitoring.loading")}</div>;
  }

  return (
    <div className="space-y-7">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-foreground">{t("monitoring.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("monitoring.subtitle")}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {summaryCards.map(({ key, label, icon: Icon, urgent }) => {
          const value = data.summary[key];
          return (
            <div key={key} className={cn("rounded-2xl border bg-card/50 p-4", urgent && value > 0 ? "border-amber-400/30" : "border-border/45")}>
              <div className="flex items-center justify-between gap-2 text-muted-foreground">
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em]">{t(label)}</span>
                <Icon className="h-4 w-4" />
              </div>
              <p className={cn("mt-3 text-2xl font-bold tabular-nums", urgent && value > 0 ? "text-amber-300" : "text-foreground")}>{value}</p>
            </div>
          );
        })}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t("monitoring.alerts")} empty={t("monitoring.noData")} items={data.alerts.map((item) => ({
          id: item.id,
          primary: item.title,
          secondary: item.service_name ?? item.host_name ?? item.severity,
          tone: item.severity === "critical" || item.severity === "major" ? "danger" : "warning",
        }))} />
        <Panel title={t("monitoring.recentFailures")} empty={t("monitoring.noData")} items={data.recent_failures.map((item) => ({
          id: item.id + item.check_name,
          primary: item.name,
          secondary: item.check_name,
          tone: "danger",
        }))} />
        <Panel title={t("monitoring.highLatency")} empty={t("monitoring.noData")} items={data.high_latency_services.map((item) => ({
          id: item.id,
          primary: item.name,
          secondary: `${Math.round(item.avg_latency_ms)} ms`,
          tone: "warning",
        }))} />
        <Panel title={t("monitoring.highResources")} empty={t("monitoring.noData")} items={data.high_resource_hosts.map((item) => ({
          id: item.id + item.metric_key,
          primary: item.name,
          secondary: `${item.metric_key.replaceAll("_", " ")} · ${Math.round(item.value)}${item.unit ?? "%"}`,
          tone: "warning",
        }))} />
      </div>
    </div>
  );
}

function Panel({ title, empty, items }: { title: string; empty: string; items: Array<{ id: string; primary: string; secondary: string; tone: string }> }) {
  return (
    <section className="rounded-2xl border border-border/45 bg-card/40 p-5">
      <h3 className="text-sm font-bold text-foreground">{title}</h3>
      {items.length === 0 ? <p className="mt-5 text-sm text-muted-foreground">{empty}</p> : (
        <div className="mt-4 space-y-2">
          {items.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl bg-muted/25 px-3.5 py-3">
              <div className="min-w-0"><p className="truncate text-sm font-semibold text-foreground">{item.primary}</p><p className="truncate text-xs text-muted-foreground">{item.secondary}</p></div>
              <span className={cn("h-2 w-2 shrink-0 rounded-full", item.tone === "danger" ? "bg-red-400" : "bg-amber-400")} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
