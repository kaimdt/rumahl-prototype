"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DowntimeResponse, UptimeDay } from "@/lib/types";
import { formatTime } from "@/lib/status-meta";
import { cn } from "@/lib/utils";

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

/**
 * Stacked segments for one day — outage (red), maintenance (blue), online
 * (light green), sorted by duration DESCENDING, stacked bottom-up, so the
 * longest block sits at the bottom and the shortest at the top.
 */
function daySegments(u: UptimeDay): { min: number; cls: string; label: string }[] {
  const outage = u.total > 0 ? (u.outage_min ?? 0) : 0;
  const maintenance = u.maintenance_min ?? 0;
  // Without checks (maintenance paused them) the bar still shows the window.
  if (u.total <= 0 && maintenance <= 0) return [];
  const online =
    u.online_min ?? Math.max(0, 1440 - outage - maintenance);
  return [
    { min: outage, cls: "bg-status-major", label: "outage" },
    { min: maintenance, cls: "bg-info/70", label: "maintenance" },
    { min: online, cls: u.pct === 100 ? "bg-emerald-400 shadow-[0_0_7px_rgba(52,211,153,0.65)]" : "bg-status-operational/35", label: "online" },
  ]
    .filter((s) => s.min > 0)
    .sort((a, b) => b.min - a.min);
}

function timeLabel(iso: string): string {
  return formatTime(iso);
}

interface HoverState {
  x: number;
  y: number;
  day: string;
  pct: number | null;
  total: number;
  outageMin: number;
  maintenanceMin: number;
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
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollLeft = element.scrollWidth;
  }, [uptime, days]);

  const pct = useMemo(() => {
    const withData = uptime.filter((u) => u.total > 0);
    if (withData.length === 0) return null;
    const sum = withData.reduce((acc, u) => acc + u.ok, 0);
    const total = withData.reduce((acc, u) => acc + u.total, 0);
    return (sum / total) * 100;
  }, [uptime]);

  // Month markers under the bar grid. Sparse markers prevent overlaps and
  // every label is forced onto a single line.
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
    const stride = out.length > 8 ? 3 : out.length > 5 ? 2 : 1;
    const candidates = out.filter((_, index) => index % stride === 0 || index === out.length - 1);
    return candidates.filter((marker, index) => index === 0 || marker.index - candidates[index - 1].index >= 14);
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
    <div className={cn("statuspage-uptime-chart", compact ? "" : "surface-card p-5 sm:p-6")} data-days={uptime.length}>
      <div className="flex items-baseline justify-between gap-4 mb-4">
        <h3 className={cn("font-bold text-foreground", compact ? "text-[12.5px]" : "text-sm")}>
          Uptime · last {days} days
        </h3>
        <p className={cn("font-bold tabular-nums text-status-operational", compact ? "text-sm" : "text-lg")}>
          {pct !== null ? `${pct.toFixed(2)}%` : "—"}
        </p>
      </div>

      <div ref={scrollRef} className="overflow-x-auto pb-1">
      <div className="relative ml-auto w-full" style={{ minWidth: many ? `${Math.max(100, uptime.length * (barW + 3))}px` : "100%" }}>
      <div className="statuspage-uptime-bars flex flex-nowrap justify-end gap-[3px]">
        {uptime.map((u) => {
          const segments = daySegments(u);
          const hoverData = {
            x: 0,
            y: 0,
            day: u.day,
            pct: u.pct,
            total: u.total,
            outageMin: u.outage_min ?? 0,
            maintenanceMin: u.maintenance_min ?? 0,
          };
          const onEnter = (e: React.MouseEvent<HTMLDivElement>) =>
            setHover({ ...hoverData, x: e.clientX, y: e.clientY });
          const onMove = (e: React.MouseEvent<HTMLDivElement>) =>
            setHover((h) => (h && h.day === u.day ? { ...h, x: e.clientX, y: e.clientY } : h));
          const onLeave = () => setHover(null);
          if (segments.length === 0) {
            return (
              <div
                key={u.day}
                onMouseEnter={onEnter}
                onMouseMove={onMove}
                onMouseLeave={onLeave}
                className={cn(
                  "rounded-[2px] transition-transform hover:scale-125",
                  compact ? "h-6" : "h-8",
                  "bg-muted/40"
                )}
                style={many ? { width: barW } : { flex: "1 1 0", minWidth: 3 }}
              />
            );
          }
          const totalMin = segments.reduce((acc, s) => acc + s.min, 0) || 1;
          let bottom = 0;
          return (
            <div
              key={u.day}
              onMouseEnter={onEnter}
              onMouseMove={onMove}
              onMouseLeave={onLeave}
              className={cn(
                "relative overflow-hidden rounded-[2px] transition-transform hover:scale-125",
                compact ? "h-6" : "h-8"
              )}
              style={many ? { width: barW } : { flex: "1 1 0", minWidth: 3 }}
            >
              {segments.map((s) => {
                const height = (s.min / totalMin) * 100;
                const el = (
                  <div
                    key={s.label}
                    className={cn("absolute inset-x-0", s.cls)}
                    style={{ bottom: `${bottom}%`, height: `${height}%` }}
                  />
                );
                bottom += height;
                return el;
              })}
            </div>
          );
        })}
      </div>

      <div className="relative mt-2 h-4 whitespace-nowrap text-[10px] text-muted-foreground/70">
        {months.map((m) => (
          <span
            key={m.index}
            className={cn("absolute whitespace-nowrap", m.index === 0 ? "" : m.index >= uptime.length - 2 ? "-translate-x-full" : "-translate-x-1/2")}
            style={{ left: `${(m.index / Math.max(uptime.length, 1)) * 100}%` }}
          >
            {m.label}
          </span>
        ))}
      </div>
      </div>
      </div>

      {!compact && (
        <div className="mt-4 flex items-center gap-4 text-[11px] text-muted-foreground border-t border-border/30 pt-3">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-emerald-400" /> 100% online
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-status-operational/35" /> below 100%
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-status-major" /> outage
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-info/70" /> maintenance
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
          {hover.total > 0 && (hover.outageMin > 0 || hover.maintenanceMin > 0) && (
            <p className="text-[11.5px] font-semibold text-status-major mb-1">
              {hover.outageMin > 0 && `Down ${durationLabel(hover.outageMin)}`}
              {hover.outageMin > 0 && hover.maintenanceMin > 0 && " · "}
              {hover.maintenanceMin > 0 && `Maintenance ${durationLabel(hover.maintenanceMin)}`}
            </p>
          )}
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
