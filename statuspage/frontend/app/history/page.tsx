"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { publicApi } from "@/lib/api";
import type { StatusResponse, UptimeResponse } from "@/lib/types";
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
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [uptime, setUptime] = useState<UptimeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allComponents = useMemo(() => {
    const list = status?.groups.flatMap((g) => g.components) ?? [];
    // keep the ?component= selection even if it is in a group
    return list;
  }, [status]);

  const selectedId =
    searchParams.get("component") ??
    (allComponents.length > 0 ? allComponents[0].id : null);

  const selected = allComponents.find((c) => c.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    publicApi
      .uptime(selectedId, 90)
      .then((u) => !cancelled && setUptime(u))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Failed"));
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  useEffect(() => {
    let cancelled = false;
    publicApi
      .status()
      .then((s) => !cancelled && setStatus(s))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

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

      {allComponents.length === 0 && !status ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <div className="space-y-8">
          <div className="flex flex-wrap gap-2">
            {allComponents.map((c) => (
              <a
                key={c.id}
                href={`/history/?component=${encodeURIComponent(c.id)}`}
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
