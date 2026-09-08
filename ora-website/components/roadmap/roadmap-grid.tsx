"use client";

import { useState } from "react";
import { CheckCircle2, CircleDashed, Flag, GitBranch, Timer } from "lucide-react";
import { roadmapPackages, type RoadmapStatus } from "@/lib/roadmap-data";
import { cn } from "@/lib/utils";

const statusMeta: Record<
  RoadmapStatus,
  { label: string; badge: string; dot: string; icon: typeof Flag }
> = {
  complete: {
    label: "Complete",
    badge: "border-success/30 bg-success/10 text-success",
    dot: "bg-success",
    icon: CheckCircle2,
  },
  "in-progress": {
    label: "In progress",
    badge: "border-primary/30 bg-primary/10 text-primary",
    dot: "bg-primary",
    icon: Timer,
  },
  planned: {
    label: "Planned",
    badge: "border-border/60 bg-muted/40 text-muted-foreground",
    dot: "bg-muted-foreground",
    icon: CircleDashed,
  },
};

const filters: { key: RoadmapStatus | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "complete", label: "Complete" },
  { key: "in-progress", label: "In progress" },
  { key: "planned", label: "Planned" },
];

export function RoadmapGrid() {
  const [filter, setFilter] = useState<RoadmapStatus | "all">("all");

  const visible =
    filter === "all"
      ? roadmapPackages
      : roadmapPackages.filter((p) => p.status === filter);

  const counts = {
    complete: roadmapPackages.filter((p) => p.status === "complete").length,
    "in-progress": roadmapPackages.filter((p) => p.status === "in-progress")
      .length,
    planned: roadmapPackages.filter((p) => p.status === "planned").length,
  };

  return (
    <div>
      {/* Filter */}
      <div className="flex flex-wrap items-center justify-center gap-2 mb-12">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              "rounded-full border px-4 py-1.5 text-xs font-semibold transition-colors",
              filter === f.key
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-border/60 bg-card/50 text-muted-foreground hover:text-foreground"
            )}
          >
            {f.label}
            {f.key !== "all" && (
              <span className="ml-1.5 text-[10px] opacity-70">
                {counts[f.key as RoadmapStatus]}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="space-y-6">
        {visible.map((pkg, i) => {
          const meta = statusMeta[pkg.status];
          const Icon = meta.icon;
          return (
            <div
              key={pkg.number}
              className={cn(
                "rounded-2xl border p-6 sm:p-8 transition-colors",
                pkg.status === "complete"
                  ? "border-success/15 bg-card/40"
                  : pkg.status === "in-progress"
                    ? "border-primary/15 bg-card/50"
                    : "border-border/40 bg-card/30"
              )}
              style={{
                animationDelay: `${i * 40}ms`,
              }}
            >
              <div className="flex flex-col lg:flex-row lg:items-start gap-6">
                {/* Package number */}
                <div className="flex items-center gap-4 lg:flex-col lg:items-start lg:w-40 shrink-0">
                  <div
                    className={cn(
                      "flex h-12 w-12 items-center justify-center rounded-xl border font-mono text-lg font-bold",
                      pkg.status === "complete"
                        ? "border-success/30 bg-success/10 text-success"
                        : pkg.status === "in-progress"
                          ? "border-primary/30 bg-primary/10 text-primary"
                          : "border-border/60 bg-muted/30 text-muted-foreground"
                    )}
                  >
                    {pkg.number}
                  </div>
                  <div>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
                        meta.badge
                      )}
                    >
                      <Icon className="h-3 w-3" />
                      {meta.label}
                    </span>
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <h3 className="text-xl font-bold tracking-tight text-foreground mb-1">
                    Package {pkg.number} — {pkg.title}
                  </h3>
                  <p className="text-sm text-muted-foreground mb-3">{pkg.tagline}</p>

                  {/* Progress */}
                  {pkg.status !== "complete" && (
                    <div className="mb-4 max-w-md">
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-primary to-primary-accent transition-all duration-700"
                          style={{ width: `${pkg.progress}%` }}
                        />
                      </div>
                      <p className="mt-1.5 text-[11px] text-muted-foreground/70">
                        {pkg.progress}% · {pkg.statusNote}
                      </p>
                    </div>
                  )}
                  {pkg.status === "complete" && (
                    <p className="mb-4 text-xs text-muted-foreground/80">
                      {pkg.statusNote}
                    </p>
                  )}

                  <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
                    {pkg.features.map((feature) => (
                      <li
                        key={feature}
                        className="flex gap-2.5 text-[13px] text-foreground/80 leading-relaxed"
                      >
                        <span className="mt-[7px] h-1.5 w-1.5 rounded-full bg-primary/60 shrink-0" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
