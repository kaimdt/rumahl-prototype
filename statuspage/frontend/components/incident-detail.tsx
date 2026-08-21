"use client";

import { CalendarClock, Megaphone } from "lucide-react";
import type { Incident } from "@/lib/types";
import {
  IMPACT_META,
  INCIDENT_STATUS_LABEL,
  INCIDENT_STATUS_META,
  formatDate,
} from "@/lib/status-meta";
import { cn } from "@/lib/utils";

export function IncidentDetail({ incident }: { incident: Incident }) {
  const latest = incident.updates[incident.updates.length - 1];

  return (
    <article className="surface-card overflow-hidden">
      <div className="border-b border-border/30 bg-muted/20 px-5 sm:px-6 py-5">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span
            className={cn(
              "rounded-full border px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wide",
              INCIDENT_STATUS_META[incident.status]
            )}
          >
            {INCIDENT_STATUS_LABEL[incident.status]}
          </span>
          {incident.impact !== "none" && (
            <span
              className={cn(
                "rounded-full border border-border/40 bg-muted/40 px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wide",
                IMPACT_META[incident.impact].cls
              )}
            >
              {IMPACT_META[incident.impact].label}
            </span>
          )}
          <span className="text-[11px] text-muted-foreground uppercase tracking-wide inline-flex items-center gap-1">
            {incident.type === "maintenance" ? (
              <CalendarClock className="h-3.5 w-3.5" />
            ) : (
              <Megaphone className="h-3.5 w-3.5" />
            )}
            {incident.type}
          </span>
        </div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
          {incident.title}
        </h1>
        <p className="text-xs text-muted-foreground mt-2">
          Started {formatDate(incident.starts_at)}
          {incident.resolves_at && ` · Resolved ${formatDate(incident.resolves_at)}`}
        </p>
        {latest && (
          <p className="text-sm text-foreground/80 mt-3 leading-relaxed">
            {latest.message}
          </p>
        )}
      </div>

      {incident.updates.length > 0 && (
        <div className="px-5 sm:px-6 py-5">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground mb-4">
            Updates
          </h2>
          <ol className="relative space-y-6 before:absolute before:left-[5px] before:top-2 before:bottom-2 before:w-px before:bg-border/60">
            {[...incident.updates].reverse().map((update) => (
              <li key={update.id} className="relative pl-6">
                <span
                  className={cn(
                    "absolute left-0 top-1.5 h-[11px] w-[11px] rounded-full border-2 border-background",
                    "bg-status-operational",
                    update.status !== "resolved" && update.status !== "completed" && "bg-status-degraded"
                  )}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12px] font-bold text-foreground">
                    {INCIDENT_STATUS_LABEL[update.status]}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {formatDate(update.created_at)}
                  </span>
                </div>
                <p className="text-sm text-foreground/80 mt-1 leading-relaxed">
                  {update.message}
                </p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </article>
  );
}
