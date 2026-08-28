"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, History, Loader2 } from "lucide-react";
import { publicApi } from "@/lib/api";
import type { PublicStatusPageResponse, StatusResponse } from "@/lib/types";
import { StatusBanner } from "@/components/status-banner";
import { ComponentList } from "@/components/component-list";
import { IncidentList, MaintenanceList } from "@/components/incident-list";
import { useTranslation } from "react-i18next";
import "@/lib/public-i18n";

export default function StatusPage() {
  const { t } = useTranslation();
  const pathname = usePathname();
  const [data, setData] = useState<StatusResponse | null>(null);
  const [branding, setBranding] = useState<PublicStatusPageResponse["page"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tenantPrefix = pathname.match(/^\/s\/[a-z0-9]+(?:-[a-z0-9]+)*/)?.[0] ?? "";

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const load = async () => {
      try {
        const slug = window.location.pathname.match(/^\/s\/([a-z0-9]+(?:-[a-z0-9]+)*)/)?.[1];
        const tenant = await publicApi.statusPage(slug);
        const status = normalizeTenantStatus(tenant);
        if (!cancelled) {
          setData(status);
          setBranding(tenant.page);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load status");
        }
      }
      // auto-refresh every 60s like a real status page
      timer = setTimeout(load, 60_000);
    };

    load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  if (error && !data) {
    return (
      <div className="mx-auto max-w-5xl px-5 lg:px-8 py-24 text-center">
        <p className="text-lg font-semibold text-destructive mb-2">{t("page.unavailable")}</p>
        <p className="text-sm text-muted-foreground">
          {t("page.unavailableHint")}
        </p>
        <p className="text-xs text-muted-foreground/60 mt-2 font-mono">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center py-40 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const pastIncidents = data.past_incidents ?? [];

  return (
    <>
      {branding?.header_brand_mode === "logo" && branding.logo_url && <div className="mx-auto max-w-5xl px-5 pt-7 lg:px-8">
        <img src={branding.logo_url} alt={`${branding.title} logo`} className="max-h-12 max-w-[240px] object-contain dark:hidden" />
        <img src={branding.logo_dark_url || branding.logo_url} alt={`${branding.title} logo`} className="hidden max-h-12 max-w-[240px] object-contain dark:block" />
      </div>}
      <StatusBanner
        status={data.overall}
        pageName={data.page.name}
        updatedAt={data.page.updated_at}
      />

      <div className="mx-auto max-w-5xl px-5 lg:px-8 pb-10 space-y-8">
        <MaintenanceList incidents={data.scheduled_maintenance} />

        <ComponentList groups={data.groups} />

        {data.active_incidents.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              {t("page.activeIncidents")}
            </h2>
            <IncidentList incidents={data.active_incidents} />
          </section>
        )}

        {pastIncidents.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                {t("page.pastIncidents")}
              </h2>
              <Link
                href={`${tenantPrefix}/past/`}
                className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-primary hover:underline"
              >
                Previous incidents <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            <IncidentList incidents={pastIncidents.slice(0, 5)} compact />
          </section>
        )}

        {data.active_incidents.length === 0 && pastIncidents.length === 0 && (
          <div className="surface-card p-8 text-center space-y-4">
            <p className="text-sm text-muted-foreground">
              No active incidents — all systems running normally.
            </p>
            <Link
              href={`${tenantPrefix}/past/`}
              className="inline-flex items-center gap-2 rounded-lg border border-border/50 px-4 py-2 text-[12.5px] font-semibold text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
            >
              <History className="h-3.5 w-3.5" />
              Previous incidents
            </Link>
          </div>
        )}
      </div>
    </>
  );
}

function normalizeTenantStatus(tenant: PublicStatusPageResponse): StatusResponse {
  return {
    page: {
      name: tenant.page.title,
      url: tenant.page.canonical_domain ? `https://${tenant.page.canonical_domain}` : window.location.href,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      updated_at: tenant.updated_at,
    },
    overall: tenant.overall === "unknown" ? "operational" : tenant.overall,
    groups: tenant.groups.map((group, groupIndex) => ({
      id: group.id,
      name: group.name,
      position: groupIndex,
      collapsed: group.collapsed,
      auto_expand: group.auto_expand,
      components: group.services.map((service, position) => ({
        id: String(service.component_id ?? service.id),
        group_id: group.id,
        name: String(service.name ?? "Service"),
        description: String(service.description ?? ""),
        kind: "auto" as const,
        check_type: "http" as const,
        endpoint_url: "",
        method: "GET",
        expected_status: 200,
        timeout_ms: 0,
        headers: null,
        view_mode: service.show_performance ? "extended" as const : service.show_uptime ? "bars" as const : "compact" as const,
        history_days: service.show_uptime ? Number(service.history_days ?? 90) : 0,
        latency_threshold_ms: 0,
        position,
        enabled: service.monitoring_enabled !== false,
        status: service.status === "unknown" ? "operational" : service.status as StatusResponse["overall"],
        changed_at: null,
        uptime_30: null,
        uptime_60: null,
        uptime_90: null,
        last_checked_at: null,
        last_latency_ms: null,
      })),
    })),
    active_incidents: tenant.incidents.filter((incident) => incident.type !== "maintenance"),
    scheduled_maintenance: tenant.incidents.filter((incident) => incident.type === "maintenance"),
    past_incidents: [],
  };
}
