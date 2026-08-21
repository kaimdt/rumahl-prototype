"use client";

import { useMemo, useState } from "react";
import type { DowntimeResponse, UptimeDay } from "@/lib/types";
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

function durationLabel(totalMin: number): string {
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface HoverState {
  x: number;
  y: number;
  day: string;
  pct: number | null;
  total: number;
}

/**
 * Uptime bar chart. The outage details for the whole range are loaded once
 * (downtimeDetails prop) — hovering a bar shows them instantly in a tooltip
 * that follows the cursor.
 */
export function UptimeChart({
  uptime,
  days,
  componentId,
  density = "full",
  downtimeDetails = {},
}: {
  uptime: UptimeDay[];
  days: number;
  componentId: string;
  density?: "full" | "compact";
  /** day → outage details, preloaded via /downtime?days=… */
  downtimeDetails?: Record<string, Omit<DowntimeResponse, "day">>;
}) {
  const [hover, setHover] = useState<HoverState | null>(null);

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

  const compact = density === "compact";
  const many = uptime.length > 120;
  const barW = compact ? (many ? 4 : 6) : many ? 6 : 8;

  const detail = hover ? downtimeDetails[hover.day] : undefined;
  const tooltipX = hover
    ? Math.min(hover.x + 12, (typeof window !== "undefined" ? window.innerWidth : 800) - 280)
    : 0;
  const tooltipBelow = hover ? hover.y < 220 : false;

  return (
    <div className={cn(compact ? "" : "surface-card p-5 sm:p-6")}>
      <div className="flex items-baseline justify-between gap-4 mb-4">
        <h3 className={cn("font-bold text-foreground", compact ? "text-[12.5px]" : "text-sm")}>
          Uptime · last {days} days
        </h3>
        <p className={cn("font-bold tabular-nums text-status-operational", compact ? "text-sm" : "text-lg")}>
          {pct !== null ? `${pct.toFixed(2)}%` : "—"}
        </p>
      </div>

      <div
        className={cn(
          "flex gap-[3px]",
          many ? "flex-nowrap overflow-x-auto pb-1" : "flex-wrap"
        )}
      >
        {uptime.map((u) => (
          <div
            key={u.day}
            onMouseEnter={(e) =>
              setHover({ x: e.clientX, y: e.clientY, day: u.day, pct: u.pct, total: u.total })
            }
            onMouseMove={(e) =>
              setHover((h) =>
                h && h.day === u.day ? { ...h, x: e.clientX, y: e.clientY } : h
              )
            }
            onMouseLeave={() => setHover(null)}
            className={cn(
              "rounded-[2px] transition-transform hover:scale-125",
              compact ? "h-6" : "h-8",
              barColor(u.pct)
            )}
            style={{ width: barW }}
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

      {!compact && (
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
      )}

      {hover && (
        <div
          className={cn(
            "fixed z-50 w-[260px] rounded-xl border border-border/40 bg-popover/95 backdrop-blur p-3.5 shadow-xl",
            !tooltipBelow && "-translate-y-full"
          )}
          style={{ left: tooltipX, top: tooltipBelow ? hover.y + 14 : hover.y - 12 }}
        >
          <div className="flex items-baseline justify-between gap-3 mb-1.5">
            <p className="text-[12px] font-bold text-foreground">{dayLabel(hover.day)}</p>
            <p className="text-[11px] font-semibold tabular-nums text-muted-foreground">
              {hover.total > 0 && hover.pct !== null ? `${hover.pct.toFixed(1)}%` : "no data"}
            </p>
          </div>
          {hover.total === 0 ? (
            <p className="text-[11.5px] text-muted-foreground">No checks recorded.</p>
          ) : detail && detail.total_min > 0 ? (
            <>
              <p className="text-[11.5px] font-semibold text-status-major">
                Down for {durationLabel(detail.total_min)}
                {detail.count > 0 && ` · ${detail.count} outage${detail.count > 1 ? "s" : ""}`}
              </p>
              {detail.approx ? (
                <p className="text-[11px] text-muted-foreground mt-1">
                  Detailed episodes are only kept for 31 days.
                </p>
              ) : (
                <ul className="mt-1.5 space-y-1">
                  {detail.episodes.slice(0, 4).map((ep, i) => (
                    <li
                      key={i}
                      className="flex items-center justify-between text-[11px] text-muted-foreground"
                    >
                      <span className="tabular-nums">
                        {timeLabel(ep.start)} – {timeLabel(ep.end)}
                      </span>
                      <span className="font-semibold text-foreground/80 tabular-nums">
                        {durationLabel(ep.duration_min)}
                      </span>
                    </li>
                  ))}
                  {detail.episodes.length > 4 && (
                    <li className="text-[10.5px] text-muted-foreground/70">
                      +{detail.episodes.length - 4} more
                    </li>
                  )}
                </ul>
              )}
            </>
          ) : (
            <p className="text-[11.5px] text-status-operational">No downtime.</p>
          )}
        </div>
      )}
    </div>
  );
}
