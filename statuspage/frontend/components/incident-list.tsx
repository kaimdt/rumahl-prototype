"use client";

import Link from "next/link";
import { CalendarClock, Megaphone } from "lucide-react";
import type { Incident } from "@/lib/types";
import {
  IMPACT_META,
  INCIDENT_STATUS_LABEL,
  INCIDENT_STATUS_META,
  formatDate,
} from "@/lib/status-meta";
import { cn } from "@/lib/utils";

export function IncidentList({
  incidents,
  compact = false,
}: {
  incidents: Incident[];
  compact?: boolean;
}) {
  if (incidents.length === 0) {
    return (
      <div className="surface-card p-8 text-center text-sm text-muted-foreground">
        No incidents recorded. Everything has been running smoothly.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {incidents.map((incident) => (
        <Link
          key={incident.id}
          href={`/incidents/?id=${encodeURIComponent(incident.id)}`}
          className="surface-card-interactive group block p-5"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <span
                className={cn(
                  "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                  incident.type === "maintenance"
                    ? "bg-info/12 text-info"
                    : "bg-muted/40 text-muted-foreground"
                )}
              >
                {incident.type === "maintenance" ? (
                  <CalendarClock className="h-4 w-4" strokeWidth={2} />
                ) : (
                  <Megaphone className="h-4 w-4" strokeWidth={2} />
                )}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-bold text-foreground leading-snug group-hover:text-primary transition-colors">
                  {incident.title}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {formatDate(incident.starts_at)}
                  {incident.impact !== "none" && (
                    <span
                      className={cn(
                        "ml-2 font-semibold",
                        IMPACT_META[incident.impact].cls
                      )}
                    >
                      · {IMPACT_META[incident.impact].label}
                    </span>
                  )}
                </p>
                {!compact && incident.updates.length > 0 && (
                  <p className="text-[13px] text-foreground/70 mt-2 line-clamp-2 leading-relaxed">
                    {incident.updates[incident.updates.length - 1].message}
                  </p>
                )}
              </div>
            </div>
            <span
              className={cn(
                "shrink-0 rounded-full border px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wide",
                INCIDENT_STATUS_META[incident.status]
              )}
            >
              {INCIDENT_STATUS_LABEL[incident.status]}
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}

export function MaintenanceList({ incidents }: { incidents: Incident[] }) {
  if (incidents.length === 0) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
        Scheduled Maintenance
      </h2>
      {incidents.map((incident) => (
        <div key={incident.id} className="surface-card p-4 flex items-center gap-3">
          <CalendarClock className="h-4 w-4 text-info shrink-0" strokeWidth={2} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">{incident.title}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {formatDate(incident.starts_at)}
              {incident.resolves_at && ` → ${formatDate(incident.resolves_at)}`}
            </p>
          </div>
          <span className="shrink-0 rounded-full border border-info/30 bg-info/12 px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wide text-info">
            {INCIDENT_STATUS_LABEL[incident.status]}
          </span>
        </div>
      ))}
    </section>
  );
}
