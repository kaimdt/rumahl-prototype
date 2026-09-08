"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { publicApi } from "@/lib/api";
import type { Component, DowntimeRangeResponse, UptimeResponse } from "@/lib/types";
import { UptimeChart } from "@/components/uptime-chart";
import { cn } from "@/lib/utils";

export default function HistoryPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-40 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      }
    >
      <HistoryContent />
    </Suspense>
  );
}

function HistoryContent() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const slug = pathname.match(/^\/s\/([a-z0-9]+(?:-[a-z0-9]+)*)/)?.[1];
  const tenantPrefix = slug ? `/s/${slug}` : "";
  const [components, setComponents] = useState<Component[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [days, setDays] = useState(90);
  const [uptime, setUptime] = useState<UptimeResponse | null>(null);
  const [downtime, setDowntime] = useState<DowntimeRangeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allComponents = useMemo(() => {
    return components;
  }, [components]);

  const selectedId =
    searchParams.get("component") ??
    (allComponents.length > 0 ? allComponents[0].id : null);

  const selected = allComponents.find((c) => c.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    publicApi
      .uptime(selectedId, days)
      .then((u) => !cancelled && setUptime(u))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Failed"));
    // Preload outage details for the whole range — instant tooltips on hover.
    publicApi
      .downtimeRange(selectedId, days)
      .then((d) => !cancelled && setDowntime(d))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [selectedId, days]);

  useEffect(() => {
    let cancelled = false;
    publicApi
      .statusPage(slug)
      .then((response) => {
        if (cancelled) return;
        setComponents(response.groups.flatMap((group) => group.services.map((service, position) => ({
          id: String(service.component_id ?? service.id), group_id: group.id, name: String(service.name ?? "Service"),
          description: String(service.description ?? ""), kind: "auto" as const, check_type: "http" as const,
          endpoint_url: "", method: "GET", expected_status: 200, timeout_ms: 0, headers: null,
          view_mode: "bars" as const, history_days: 90, latency_threshold_ms: 0, position, enabled: true,
          status: service.status === "unknown" ? "operational" as const : service.status as Component["status"],
          changed_at: null, uptime_30: null, uptime_60: null, uptime_90: null, last_checked_at: null, last_latency_ms: null,
        }))));
        setLoaded(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (error && !uptime) {
    return (
      <div className="mx-auto max-w-5xl px-5 lg:px-8 py-24 text-center text-sm text-muted-foreground">
        {error}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-5 lg:px-8 py-12">
      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mb-2">
        Uptime <span className="gradient-text">history</span>
      </h1>
      <p className="text-sm text-muted-foreground mb-8">
        Daily availability of each monitored component over the last 90 days.
      </p>

      {allComponents.length === 0 && !loaded ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <div className="space-y-8">
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs font-semibold text-muted-foreground">History range</p>
            <div className="flex gap-1 rounded-xl border border-border/40 bg-card/40 p-1">
              {[30, 90, 180, 365].map((range) => <button key={range} type="button" onClick={() => setDays(range)} className={cn("rounded-lg px-2.5 py-1 text-xs font-bold", days === range ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>{range}d</button>)}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {allComponents.map((c) => (
              <a
                key={c.id}
                href={`${tenantPrefix}/history/?component=${encodeURIComponent(c.id)}`}
                className={cn(
                  "rounded-full border px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors",
                  c.id === selectedId
                    ? "border-primary/50 bg-primary/12 text-primary"
                    : "border-border/50 bg-card/40 text-muted-foreground hover:text-foreground"
                )}
              >
                {c.name}
              </a>
            ))}
          </div>

          {selected ? (
            <UptimeChart
              key={selected.id}
              componentId={selected.id}
              uptime={uptime?.uptime ?? []}
              days={uptime?.days ?? 90}
              downtimeDetails={downtime?.days_data ?? {}}
            />
          ) : (
            <div className="surface-card p-8 text-center text-sm text-muted-foreground">
              Select a component to see its uptime history.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
