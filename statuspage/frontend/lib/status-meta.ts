import type { ComponentStatus, IncidentStatus } from "./types";
import { getActiveTimezone } from "./timezone";

export const STATUS_META: Record<
  ComponentStatus,
  { label: string; color: string; text: string; bg: string; border: string; dot: string }
> = {
  operational: {
    label: "Operational",
    color: "hsl(var(--status-operational))",
    text: "text-status-operational",
    bg: "bg-status-operational/12",
    border: "border-status-operational/30",
    dot: "bg-status-operational",
  },
  degraded: {
    label: "Degraded Performance",
    color: "hsl(var(--status-degraded))",
    text: "text-status-degraded",
    bg: "bg-status-degraded/12",
    border: "border-status-degraded/30",
    dot: "bg-status-degraded",
  },
  partial_outage: {
    label: "Partial Outage",
    color: "hsl(var(--status-partial))",
    text: "text-status-partial",
    bg: "bg-status-partial/12",
    border: "border-status-partial/30",
    dot: "bg-status-partial",
  },
  major_outage: {
    label: "Major Outage",
    color: "hsl(var(--status-major))",
    text: "text-status-major",
    bg: "bg-status-major/12",
    border: "border-status-major/30",
    dot: "bg-status-major",
  },
  maintenance: {
    label: "Maintenance",
    color: "hsl(var(--info))",
    text: "text-info",
    bg: "bg-info/12",
    border: "border-info/30",
    dot: "bg-info",
  },
};

export const INCIDENT_STATUS_LABEL: Record<IncidentStatus, string> = {
  investigating: "Investigating",
  identified: "Identified",
  monitoring: "Monitoring",
  resolved: "Resolved",
  scheduled: "Scheduled",
  in_progress: "In Progress",
  completed: "Completed",
};

export const INCIDENT_STATUS_META: Record<IncidentStatus, string> = {
  investigating: "text-status-major bg-status-major/12 border-status-major/30",
  identified: "text-status-degraded bg-status-degraded/12 border-status-degraded/30",
  monitoring: "text-info bg-info/12 border-info/30",
  resolved: "text-status-operational bg-status-operational/12 border-status-operational/30",
  scheduled: "text-muted-foreground bg-muted/40 border-border/40",
  in_progress: "text-status-degraded bg-status-degraded/12 border-status-degraded/30",
  completed: "text-status-operational bg-status-operational/12 border-status-operational/30",
};

export const IMPACT_META: Record<string, { label: string; cls: string }> = {
  none: { label: "No impact", cls: "text-muted-foreground" },
  minor: { label: "Minor impact", cls: "text-status-degraded" },
  major: { label: "Major impact", cls: "text-status-partial" },
  critical: { label: "Critical", cls: "text-status-major" },
};

/** Date+time in the visitor's timezone (locale-independent layout). */
export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: getActiveTimezone(),
    });
  } catch {
    return iso;
  }
}

/** "Aug 21, 2026 at 7:52 PM CEST" — always in the visitor's timezone. */
export function formatDateTime(iso: string): string {
  try {
    const tz = getActiveTimezone();
    const s = new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "short",
      timeZone: tz,
    });
    // "Aug 21, 2026, 7:52 PM CEST" → "Aug 21, 2026 at 7:52 PM CEST"
    return s.replace(/,\s+(\d{1,2}:\d{2})/, " at $1");
  } catch {
    return iso;
  }
}

/** Short time "07:52" in the visitor's timezone. */
export function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: getActiveTimezone(),
    });
  } catch {
    return iso;
  }
}

export function formatUptime(pct: number | null): string {
  if (pct === null) return "—";
  return `${pct.toFixed(2)}%`;
}
