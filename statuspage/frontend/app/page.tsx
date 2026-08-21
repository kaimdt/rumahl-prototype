"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, History, Loader2 } from "lucide-react";
import { publicApi } from "@/lib/api";
import type { StatusResponse } from "@/lib/types";
import { StatusBanner } from "@/components/status-banner";
import { ComponentList } from "@/components/component-list";
import { IncidentList, MaintenanceList } from "@/components/incident-list";

export default function StatusPage() {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const load = async () => {
      try {
        const status = await publicApi.status();
        if (!cancelled) {
          setData(status);
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
        <p className="text-lg font-semibold text-destructive mb-2">Status unavailable</p>
        <p className="text-sm text-muted-foreground">
          Could not reach the status API. Please try again in a moment.
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
              Active Incidents
            </h2>
            <IncidentList incidents={data.active_incidents} />
          </section>
        )}

        {pastIncidents.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                Past Incidents
              </h2>
              <Link
                href="/past/"
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
              href="/past/"
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
