"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarClock, ChevronDown, Megaphone } from "lucide-react";
import type { Incident } from "@/lib/types";
import {
  INCIDENT_STATUS_LABEL,
  INCIDENT_STATUS_META,
  formatDateTime,
} from "@/lib/status-meta";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import "@/lib/public-i18n";

/**
 * BetterStack-style incident card — the whole card links to the detail page
 * (/incidents/?id=…), where the full timeline (start → updates → resolved)
 * is shown. The "previous updates" toggle expands inline when not expanded.
 */
export function IncidentCard({
  incident,
  expanded = false,
}: {
  incident: Incident;
  /** detail view — no link, no inline previous-updates list (timeline below) */
  expanded?: boolean;
}) {
  const { t } = useTranslation();
  const [showPrevious, setShowPrevious] = useState(false);
  const updates = incident.updates;
  const latest = updates.length > 0 ? updates[updates.length - 1] : null;
  const previous = updates.slice(0, -1);
  const isResolved =
    incident.status === "resolved" || incident.status === "completed";

  const latestTime =
    latest?.created_at ?? incident.resolves_at ?? incident.updated_at;
  const severityLabel = incident.type === "maintenance" ? "Maintenance" : incident.impact === "critical" ? "Critical incident" : incident.impact === "major" ? "Major incident" : "Minor incident";

  const content = (
    <>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <span
            className={cn(
              "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
              incident.type === "maintenance"
                ? "bg-info/12 text-info"
                : isResolved
                  ? "bg-status-operational/12 text-status-operational"
                  : "bg-status-major/12 text-status-major"
            )}
          >
            {incident.type === "maintenance" ? (
              <CalendarClock className="h-4 w-4" strokeWidth={2} />
            ) : (
              <Megaphone className="h-4 w-4" strokeWidth={2} />
            )}
          </span>
          <div className="min-w-0">
            <h3 className="text-[15px] font-bold text-foreground leading-snug">
              {incident.title}
            </h3>
            <p className="text-[12.5px] text-muted-foreground mt-0.5">
              {severityLabel} · {INCIDENT_STATUS_LABEL[incident.status]}
            </p>
          </div>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-wide",
            INCIDENT_STATUS_META[incident.status]
          )}
        >
          {INCIDENT_STATUS_LABEL[incident.status]}
        </span>
      </div>

      {latest && (
        <div className="mt-4 border-t border-border/25 pt-4"><p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{INCIDENT_STATUS_LABEL[latest.status]}</p><p className="mt-1 text-[13.5px] leading-relaxed text-foreground/80">{latest.message}</p><p className="mt-2 text-[11.5px] text-muted-foreground">{t("incident.updated", { date: formatDateTime(latestTime) })}</p></div>
      )}
      {(incident.affected_components?.length ?? 0) > 0 && <div className="mt-4"><p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{t("incident.affected")}</p><div className="mt-2 flex flex-wrap gap-2">{incident.affected_components.map((component) => <span key={component.service_id} className="rounded-full border border-border/40 bg-muted/20 px-2.5 py-1 text-[11.5px] font-semibold text-foreground/80">{component.name} · {component.status.replaceAll("_", " ")}</span>)}</div></div>}
    </>
  );

  return (
    <article className="surface-card overflow-hidden">
      {expanded ? (
        <div className="p-5 sm:p-6">{content}</div>
      ) : (
        <Link
          href={`/incidents/?id=${encodeURIComponent(incident.id)}`}
          className="block p-5 sm:p-6 transition-colors hover:bg-muted/15"
          title={t("incident.viewTimeline")}
        >
          {content}
        </Link>
      )}

      {!expanded && previous.length > 0 && (
        <div className="border-t border-border/25 px-5 sm:px-6 py-2.5">
          <button
            onClick={() => setShowPrevious((s) => !s)}
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronDown
              className={cn("h-3.5 w-3.5 transition-transform", showPrevious && "rotate-180")}
            />
            {t("incident.previousUpdate", { count: previous.length })}
          </button>
          {showPrevious && (
            <ul className="mt-2.5 space-y-3">
              {[...previous].reverse().map((update) => (
                <li key={update.id} className="text-[12.5px]">
                  <span className="font-bold text-foreground/90">
                    {INCIDENT_STATUS_LABEL[update.status]}
                  </span>{" "}
                  <span className="text-muted-foreground">
                    {formatDateTime(update.created_at)}
                  </span>
                  <p className="text-foreground/70 mt-0.5 leading-relaxed">
                    {update.message}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </article>
  );
}
