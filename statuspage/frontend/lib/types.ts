/**
 * Shared types — mirror of the PHP backend API contract.
 * (see backend/README or schema comments for the canonical definition)
 */

export type ComponentStatus =
  | "operational"
  | "degraded"
  | "partial_outage"
  | "major_outage"
  | "maintenance";

export type CheckType = "http" | "tcp" | "ping" | "dns" | "ssl" | "smtp";

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
  /** display view configured by the admin */
  view_mode: ComponentView;
  /** how much history the view shows (0 = no history), configured by the admin */
  history_days: number;
  /** per-component degraded threshold; 0 = use the global setting */
  latency_threshold_ms: number;
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

export interface PublicStatusPageResponse {
  page: {
    id: string; slug: string; title: string; description: string | null;
    logo_url: string | null; logo_dark_url: string | null; logo_mode: "same" | "adaptive" | "custom";
    mobile_logo_url: string | null; mobile_logo_dark_url: string | null; header_brand_mode: "logo" | "text";
    header_config: { sticky?: boolean; show_theme_toggle?: boolean; show_language_switcher?: boolean; centered?: boolean } | null;
    nav_links: Array<{ label: string; href: string; enabled?: boolean }> | null;
    footer_config: { enabled?: boolean; text?: string; show_timezone?: boolean; centered?: boolean } | null;
    footer_links: Array<{ label: string; href: string; enabled?: boolean }> | null;
    favicon_url: string | null; custom_css_url: string | null; custom_css: string | null;
    theme: { primary?: string; background?: string; surface?: string; text?: string; muted?: string; border?: string; max_width?: string; radius?: string } | null;
    canonical_domain: string | null; path_enabled: boolean; domain_enabled: boolean; show_disabled_components: boolean;
    default_language: string; enabled_locales: string[];
    translations: Record<string, {
      title?: string; description?: string; footer_text?: string;
      nav_links?: Array<{ label: string; href: string; enabled?: boolean }>;
      footer_links?: Array<{ label: string; href: string; enabled?: boolean }>;
    }>;
  };
  overall: ComponentStatus | "unknown";
  groups: Array<{ id: string; name: string; collapsed: boolean; auto_expand: boolean; services: Array<Record<string, unknown>> }>;
  incidents: Incident[];
  updated_at: string;
}

export interface UptimeDay {
  day: string; // YYYY-MM-DD
  ok: number;
  total: number;
  pct: number | null; // null when no checks that day
  /** minutes with failed checks (stacked bar, red) — null when no data */
  outage_min: number | null;
  /** minutes covered by scheduled maintenance (stacked bar, blue) */
  maintenance_min: number | null;
  /** remaining minutes online (stacked bar, light green) */
  online_min: number | null;
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

/** GET /downtime?component=…&days=… — all days with outages in one request */
export interface DowntimeRangeResponse {
  component_id: string;
  days: number;
  days_data: Record<string, Omit<DowntimeResponse, "day">>;
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
  /** effective latency: server time (TTFB minus network), total as fallback */
  latency_ms: number | null;
  /** total wall time incl. DNS/TCP/TLS */
  total_ms: number | null;
  dns_ms: number | null;
  connect_ms: number | null;
  tls_ms: number | null;
  server_ms: number | null;
  status_code: number | null;
  error: string | null;
  diagnostic: {
    effective_url: string;
    primary_ip: string;
    primary_port: number;
    local_ip: string;
    redirect_count: number;
    content_type: string | null;
    download_bytes: number;
    request_headers: string[];
    response_headers: string[];
    body_excerpt: string | null;
    captured_at: string;
  } | null;
  screenshot_url: string | null;
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
  view_mode?: ComponentView;
  history_days?: number;
  latency_threshold_ms?: number;
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
  /** monitor the status page's own infrastructure and show it on the page */
  self_monitoring_enabled: number;
  /** app version, reported by the backend */
  version?: string;
  /** schema migration level, e.g. v3 */
  schema_version?: string;
}

export interface MonitoringOverview {
  summary: {
    hosts: number;
    services: number;
    failing_services: number;
    degraded_services: number;
    active_incidents: number;
    maintenances: number;
    failed_checks: number;
    offline_agents: number;
    active_alerts: number;
  };
  alerts: Array<{
    id: string;
    title: string;
    severity: "info" | "minor" | "major" | "critical";
    state: "active" | "acknowledged" | "resolved";
    created_at: string;
    service_name: string | null;
    host_name: string | null;
  }>;
  high_latency_services: Array<{ id: string; name: string; avg_latency_ms: number }>;
  high_resource_hosts: Array<{
    id: string;
    name: string;
    metric_key: string;
    value: number;
    unit: string | null;
    recorded_at: string;
  }>;
  recent_failures: Array<{
    id: string;
    name: string;
    check_name: string;
    last_failure_at: string;
    status: ComponentStatus | "unknown";
  }>;
  generated_at: string;
}
