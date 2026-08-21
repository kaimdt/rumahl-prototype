"use client";

import { useMemo, useState } from "react";
import type { LatencyPoint } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Latency line chart (SVG). Each bucket is an average; buckets with
 * failing checks are marked with red dots. Hovering shows a crosshair
 * line + tooltip with the nearest bucket's details.
 */
export function LatencyChart({
  points,
  days,
  compact = false,
}: {
  points: LatencyPoint[];
  days: number;
  compact?: boolean;
}) {
  const W = 600;
  const H = compact ? 120 : 150;
  const PAD = { top: 12, right: 46, bottom: 22, left: 8 };

  const xOf = (i: number) =>
    PAD.left +
    (points.length <= 1 ? 0 : (i / (points.length - 1)) * (W - PAD.left - PAD.right));

  const { path, dots, maxMs, minMs } = useMemo(() => {
    const valid = points.filter((p) => p.avg_latency_ms !== null);
    const max = valid.length > 0 ? Math.max(50, ...valid.map((p) => p.avg_latency_ms ?? 0)) : 50;
    const min = valid.length > 0 ? Math.min(...valid.map((p) => p.avg_latency_ms ?? 0)) : 0;
    const range = max - min || 1;
    const y = (v: number) => PAD.top + (1 - (v - min) / range) * (H - PAD.top - PAD.bottom);

    let d = "";
    points.forEach((p, i) => {
      const v = p.avg_latency_ms;
      if (v === null) return;
      const px = xOf(i);
      const py = y(v);
      d += (d === "" ? "M" : " L") + px.toFixed(1) + " " + py.toFixed(1);
    });

    const failing = points
      .filter((p) => p.success_ratio !== null && p.success_ratio < 1 && p.avg_latency_ms !== null)
      .map((p) => {
        const i = points.indexOf(p);
        return { x: xOf(i), y: y(p.avg_latency_ms ?? 0) };
      });

    return { path: d, dots: failing, maxMs: max, minMs: min };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, H]);

  const [hover, setHover] = useState<{ x: number; y: number; index: number } | null>(null);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (points.length < 2) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width;
    const index = Math.max(0, Math.min(points.length - 1, Math.round(fx * (points.length - 1))));
    setHover({ x: e.clientX, y: e.clientY, index });
  };

  const hoverPoint = hover ? points[hover.index] : null;
  const hoverX = hover ? xOf(hover.index) : 0;
  const hoverBelow = hover ? hover.y < 190 : false;

  if (points.length === 0) {
    return (
      <div className="rounded-xl border border-border/25 bg-muted/10 px-4 py-6 text-center text-[12px] text-muted-foreground">
        No latency data yet — the monitor records it with every check (kept 31 days).
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4 mb-2">
        <h3 className="text-[12.5px] font-bold text-foreground">
          Latency · last {days} days
        </h3>
        <div className="flex items-center gap-3 text-[10.5px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-status-major" /> failures
          </span>
          <span className="tabular-nums">max {Math.round(maxMs)} ms</span>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto cursor-crosshair"
        role="img"
        aria-label="Latency over time"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="latency-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.28" />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* horizontal grid */}
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={PAD.left}
            x2={W - PAD.right}
            y1={PAD.top + f * (H - PAD.top - PAD.bottom)}
            y2={PAD.top + f * (H - PAD.top - PAD.bottom)}
            stroke="hsl(var(--border))"
            strokeOpacity={0.5}
            strokeWidth={1}
          />
        ))}

        {path !== "" && (
          <>
            <path d={path} fill="none" stroke="hsl(var(--primary))" strokeWidth={1.8} strokeLinejoin="round" />
            <path
              d={`${path} L ${W - PAD.right} ${H - PAD.bottom} L ${PAD.left} ${H - PAD.bottom} Z`}
              fill="url(#latency-fill)"
            />
          </>
        )}

        {dots.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={3} fill="hsl(var(--status-major))" />
        ))}

        {/* hover crosshair */}
        {hover && (
          <line
            x1={hoverX}
            x2={hoverX}
            y1={PAD.top}
            y2={H - PAD.bottom}
            stroke="hsl(var(--foreground))"
            strokeOpacity={0.35}
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}

        {/* y labels */}
        <text x={W - PAD.right + 6} y={PAD.top + 4} fontSize={10} fill="hsl(var(--muted-foreground))">
          {Math.round(maxMs)}ms
        </text>
        <text x={W - PAD.right + 6} y={H - PAD.bottom - 2} fontSize={10} fill="hsl(var(--muted-foreground))">
          {Math.round(minMs)}ms
        </text>
        <text x={PAD.left} y={H - 6} fontSize={10} fill="hsl(var(--muted-foreground))">
          {days}d ago
        </text>
        <text x={W - PAD.right} y={H - 6} fontSize={10} textAnchor="end" fill="hsl(var(--muted-foreground))">
          now
        </text>
      </svg>

      {hover && hoverPoint && (
        <div
          className={cn(
            "fixed z-50 w-[230px] rounded-xl border border-border/40 bg-popover/95 backdrop-blur p-3 shadow-xl",
            !hoverBelow && "-translate-y-full"
          )}
          style={{ left: Math.min(hover.x + 12, (typeof window !== "undefined" ? window.innerWidth : 800) - 250), top: hoverBelow ? hover.y + 14 : hover.y - 12 }}
        >
          <p className="text-[11.5px] font-bold text-foreground mb-1">
            {new Date(hoverPoint.bucket).toLocaleString("en-GB", {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
          <div className="space-y-0.5 text-[11px] text-muted-foreground">
            <p>
              <span className="font-semibold text-foreground tabular-nums">
                {hoverPoint.avg_latency_ms !== null ? `${hoverPoint.avg_latency_ms} ms` : "—"}
              </span>{" "}
              avg latency
            </p>
            <p className={cn(hoverPoint.success_ratio !== null && hoverPoint.success_ratio < 1 && "text-status-major font-semibold")}>
              {hoverPoint.success_ratio !== null ? `${(hoverPoint.success_ratio * 100).toFixed(0)}%` : "—"} ok · {hoverPoint.n} checks
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
