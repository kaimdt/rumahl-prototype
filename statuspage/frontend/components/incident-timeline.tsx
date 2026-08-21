"use client";

import { Clock3 } from "lucide-react";
import type { Incident, IncidentStatus } from "@/lib/types";
import { INCIDENT_STATUS_LABEL, formatDateTime } from "@/lib/status-meta";
import { cn } from "@/lib/utils";

/** Timeline dot color per incident/update status. */
const POINT_COLOR: Record<IncidentStatus, string> = {
  investigating: "bg-status-major",
  identified: "bg-status-partial",
  monitoring: "bg-status-degraded",
  resolved: "bg-status-operational",
  scheduled: "bg-info",
  in_progress: "bg-info",
  completed: "bg-status-operational",
};

/**
 * Full incident timeline (detail page): when it STARTED, every update that
 * happened in between and when it came back ONLINE — statuspage/BetterStack
 * style vertical timeline.
 */
export function IncidentTimeline({ incident }: { incident: Incident }) {
  const isResolved =
    incident.status === "resolved" || incident.status === "completed";
  const updates = incident.updates;
  const endTime =
    incident.resolves_at ??
    (updates.length > 0 ? updates[updates.length - 1].created_at : null);

  return (
    <div className="surface-card p-5 sm:p-6">
      <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground mb-5 flex items-center gap-2">
        <Clock3 className="h-3.5 w-3.5" />
        Timeline
      </h2>
      <ol className="relative space-y-6 before:absolute before:left-[5px] before:top-2 before:bottom-2 before:w-px before:bg-border/60">
        {/* Start */}
        <li className="relative pl-6">
          <span className="absolute left-0 top-1.5 h-[11px] w-[11px] rounded-full border-2 border-background bg-status-major" />
          <p className="text-[13px]">
            <span className="font-bold text-foreground">Started</span>{" "}
            <span className="text-muted-foreground">
              {formatDateTime(incident.starts_at)}
            </span>
          </p>
        </li>

        {/* Updates in between */}
        {updates.map((update) => (
          <li key={update.id} className="relative pl-6">
            <span
              className={cn(
                "absolute left-0 top-1.5 h-[11px] w-[11px] rounded-full border-2 border-background",
                POINT_COLOR[update.status]
              )}
            />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12.5px] font-bold text-foreground">
                {INCIDENT_STATUS_LABEL[update.status]}
              </span>
              <span className="text-[11.5px] text-muted-foreground">
                {formatDateTime(update.created_at)}
              </span>
            </div>
            {update.message !== "" && (
              <p className="text-[13px] text-foreground/80 mt-1 leading-relaxed">
                {update.message}
              </p>
            )}
          </li>
        ))}

        {/* Back online */}
        {isResolved && endTime && (
          <li className="relative pl-6">
            <span className="absolute left-0 top-1.5 h-[11px] w-[11px] rounded-full border-2 border-background bg-status-operational" />
            <p className="text-[13px]">
              <span className="font-bold text-status-operational">Resolved</span>{" "}
              <span className="text-muted-foreground">{formatDateTime(endTime)}</span>
            </p>
          </li>
        )}
      </ol>
    </div>
  );
}
