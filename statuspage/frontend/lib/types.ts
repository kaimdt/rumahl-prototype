/**
 * Shared types — mirror of the PHP backend API contract.
 * (see backend/README or schema comments for the canonical definition)
 */

export type ComponentStatus =
  | "operational"
  | "degraded"
  | "partial_outage"
  | "major_outage";

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
  components: Component[];
}

export interface Component {
  id: string;
  group_id: string | null;
  name: string;
  description: string;
  kind: ComponentKind;
  endpoint_url: string;
  method: string;
  expected_status: number;
  timeout_ms: number;
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

export interface CheckResult {
  id: number;
  component_id: string;
  ok: boolean;
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
  endpoint_url?: string;
  method?: string;
  expected_status?: number;
  timeout_ms?: number;
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
}
