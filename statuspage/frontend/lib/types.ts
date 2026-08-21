/**
 * Shared types — mirror of the PHP backend API contract.
 * (see backend/README or schema comments for the canonical definition)
 */

export type ComponentStatus =
  | "operational"
  | "degraded"
  | "partial_outage"
  | "major_outage";

export type CheckType = "http" | "tcp" | "ping";

export type IncidentStatus =
  | "investigating"
  | "identified"
  | "monitoring"
  | "resolved"
  | "scheduled"
  | "in_progress"
  | "completed";

export type IncidentImpact = "none" | "minor" | "major" | "critical";
export type IncidentType = "incident" | "maintenance";
export type ComponentKind = "auto" | "manual";

export interface ComponentGroup {
  id: string;
  name: string;
  position: number;
  /** default collapsed state on the public page */
  collapsed: boolean;
  /** auto-expand on the public page when a component in the group has issues */
  auto_expand: boolean;
  components: Component[];
}

export interface Component {
  id: string;
  group_id: string | null;
  name: string;
  description: string;
  kind: ComponentKind;
  check_type: CheckType;
  endpoint_url: string;
  method: string;
  expected_status: number;
  timeout_ms: number;
  /** custom request headers, e.g. ["Authorization: Bearer …"] */
  headers: string[] | null;
  position: number;
  enabled: boolean;
  /** current status — derived (auto) or manually set (manual) */
  status: ComponentStatus;
  changed_at: string | null;
  /** uptime percentages (null when no data yet) */
  uptime_30: number | null;
  uptime_60: number | null;
  uptime_90: number | null;
  last_checked_at: string | null;
  last_latency_ms: number | null;
}

export interface IncidentUpdate {
  id: number;
  status: IncidentStatus;
  message: string;
  created_at: string;
}

export interface Incident {
  id: string;
  type: IncidentType;
  title: string;
  status: IncidentStatus;
  impact: IncidentImpact;
  starts_at: string;
  resolves_at: string | null;
  created_at: string;
  updated_at: string;
  /** component ids affected by this incident */
  components: string[];
  updates: IncidentUpdate[];
}

export interface StatusResponse {
  page: {
    name: string;
    url: string;
    timezone: string;
    updated_at: string;
  };
  overall: ComponentStatus;
  groups: ComponentGroup[];
  active_incidents: Incident[];
  scheduled_maintenance: Incident[];
  /** most recent resolved incidents (shown at the bottom of the overview) */
  past_incidents: Incident[];
}

export interface UptimeDay {
  day: string; // YYYY-MM-DD
  ok: number;
  total: number;
  pct: number | null; // null when no checks that day
}

export interface UptimeResponse {
  component_id: string;
  days: number;
  uptime: UptimeDay[];
}

export interface LatencyPoint {
  bucket: string; // ISO timestamp
  avg_latency_ms: number | null;
  /** 1 = all checks ok, 0 = all failed */
  success_ratio: number | null;
  n: number;
}

export interface LatencyResponse {
  component_id: string;
  days: number;
  bucket_seconds: number;
  points: LatencyPoint[];
}

export interface DowntimeEpisode {
  start: string;
  end: string;
  duration_min: number;
}

export interface DowntimeResponse {
  day: string; // YYYY-MM-DD
  episodes: DowntimeEpisode[];
  total_min: number;
  count: number;
  /** true when only the daily aggregate was available (older than retention) */
  approx: boolean;
  failed_checks?: number;
}

/** how much history a component view shows; "none" hides all charts */
export type HistoryRange = "none" | "7" | "14" | "30" | "90" | "180" | "365";

/** per-component view mode on the public page */
export type ComponentView = "compact" | "bars" | "extended";

export interface CheckResult {
  id: number;
  component_id: string;
  component_name: string;
  check_type: CheckType;
  ok: boolean;
  /** answered, but response did not match expectations (e.g. HTTP 308 vs 200) */
  softfail: boolean;
  latency_ms: number | null;
  status_code: number | null;
  error: string | null;
  checked_at: string;
}

/* ── Admin ── */

export interface AdminComponentInput {
  id?: string;
  group_id?: string | null;
  name: string;
  description?: string;
  kind: ComponentKind;
  check_type?: CheckType;
  endpoint_url?: string;
  method?: string;
  expected_status?: number;
  timeout_ms?: number;
  headers?: string[];
  position?: number;
  enabled?: boolean;
  manual_status?: ComponentStatus;
}

export interface AdminIncidentInput {
  id?: string;
  type: IncidentType;
  title: string;
  status: IncidentStatus;
  impact: IncidentImpact;
  starts_at?: string;
  resolves_at?: string | null;
  component_ids?: string[];
  message?: string; // initial update message
}

export interface Settings {
  page_name: string;
  page_url: string;
  timezone: string;
  from_email: string;
  alert_emails: string[];
  webhook_urls: string[];
  latency_threshold_ms: number;
  failure_window: number;
  auto_incidents_enabled: number;
}
