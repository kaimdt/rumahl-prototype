"use client";

import { CalendarClock } from "lucide-react";
import type { Incident } from "@/lib/types";
import {
  INCIDENT_STATUS_LABEL,
  formatDateTime,
} from "@/lib/status-meta";
import { IncidentCard } from "./incident-card";

export function IncidentList({
  incidents,
  compact = false,
}: {
  incidents: Incident[];
  compact?: boolean;
}) {
  void compact;
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
        <IncidentCard key={incident.id} incident={incident} />
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
              {formatDateTime(incident.starts_at)}
              {incident.resolves_at && ` → ${formatDateTime(incident.resolves_at)}`}
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
