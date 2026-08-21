"use client";

import { useMemo } from "react";
import type { UptimeDay } from "@/lib/types";
import { cn } from "@/lib/utils";

function barColor(pct: number | null): string {
  if (pct === null) return "bg-muted/40";
  if (pct >= 99.9) return "bg-status-operational/80";
  if (pct >= 99) return "bg-status-degraded/80";
  if (pct >= 95) return "bg-status-partial/80";
  return "bg-status-major/80";
}

function dayLabel(day: string): string {
  const d = new Date(`${day}T12:00:00`);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function UptimeChart({
  uptime,
  days,
}: {
  uptime: UptimeDay[];
  days: number;
}) {
  const pct = useMemo(() => {
    const withData = uptime.filter((u) => u.total > 0);
    if (withData.length === 0) return null;
    const sum = withData.reduce((acc, u) => acc + u.ok, 0);
    const total = withData.reduce((acc, u) => acc + u.total, 0);
    return (sum / total) * 100;
  }, [uptime]);

  // Month markers under the bar grid
  const months = useMemo(() => {
    const seen = new Set<string>();
    const out: { index: number; label: string }[] = [];
    uptime.forEach((u, i) => {
      const month = u.day.slice(0, 7);
      if (!seen.has(month)) {
        seen.add(month);
        const d = new Date(`${u.day}T12:00:00`);
        out.push({
          index: i,
          label: d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" }),
        });
      }
    });
    return out;
  }, [uptime]);

  return (
    <div className="surface-card p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-4 mb-4">
        <h3 className="text-sm font-bold text-foreground">
          Uptime · last {days} days
        </h3>
        <p className="text-lg font-bold tabular-nums text-status-operational">
          {pct !== null ? `${pct.toFixed(2)}%` : "—"}
        </p>
      </div>

      <div className="flex flex-wrap gap-[3px]">
        {uptime.map((u) => (
          <div
            key={u.day}
            title={`${dayLabel(u.day)} — ${u.total > 0 ? ((u.ok / u.total) * 100).toFixed(1) : "no data"}% (${u.ok}/${u.total} checks)`}
            className={cn(
              "h-8 w-[7px] rounded-[2px] transition-transform hover:scale-125",
              barColor(u.pct)
            )}
          />
        ))}
      </div>

      <div className="relative mt-2 h-4 text-[10px] text-muted-foreground/70">
        {months.map((m) => (
          <span
            key={m.index}
            className="absolute -translate-x-1/2"
            style={{ left: `${(m.index / Math.max(uptime.length, 1)) * 100}%` }}
          >
            {m.label}
          </span>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-4 text-[11px] text-muted-foreground border-t border-border/30 pt-3">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-status-operational/80" /> 100%
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-status-degraded/80" /> ≥ 99%
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-status-partial/80" /> ≥ 95%
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-status-major/80" /> &lt; 95%
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-muted/40" /> no data
        </span>
      </div>
    </div>
  );
}
