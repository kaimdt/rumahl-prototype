import type {
  AdminComponentInput,
  AdminIncidentInput,
  CheckResult,
  ComponentGroup,
  DowntimeRangeResponse,
  DowntimeResponse,
  Incident,
  LatencyResponse,
  MonitoringOverview,
  Settings,
  StatusResponse,
  UptimeResponse,
} from "./types";

const API_BASE: string = process.env.NEXT_PUBLIC_API_BASE ?? "/api";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const TOKEN_KEY = "rumahl-status-admin-token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(
  path: string,
  opts: { method?: string; body?: unknown; token?: string | null } = {}
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const token = opts.token === undefined ? getToken() : opts.token;
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
    // Apache strips Authorization for PHP-FPM/CGI on some hosts (Plesk) —
    // the custom header passes through everywhere and is accepted by the
    // backend as a fallback.
    headers["X-Auth-Token"] = token;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON response */
  }

  if (!res.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : `Request failed (${res.status})`;
    throw new ApiError(res.status, message);
  }
  return data as T;
}

/* ── Public API ── */

export const publicApi = {
  statusPage: (slug?: string) =>
    request<import("./types").PublicStatusPageResponse>(
      slug ? `/public/status/${encodeURIComponent(slug)}` : "/public/status"
    ),
  status: () => request<StatusResponse>("/status"),
  incidents: (page = 1, perPage = 25) =>
    request<{ incidents: Incident[]; total: number; page: number; pages: number }>(
      `/incidents?page=${page}&per_page=${perPage}`
    ),
  incident: (id: string) => request<Incident>(`/incidents?id=${encodeURIComponent(id)}`),
  incidentMonths: () =>
    request<{ months: { month: string; count: number }[] }>("/incidents?months=1"),
  incidentsByMonth: (month: string) =>
    request<{
      month: string;
      incidents: Incident[];
      days: Record<string, { count: number; maintenance: boolean }>;
    }>(`/incidents?month=${encodeURIComponent(month)}`),
  uptime: (componentId: string, days = 90) =>
    request<UptimeResponse>(
      `/uptime?component=${encodeURIComponent(componentId)}&days=${days}`
    ),
  latency: (componentId: string, days = 14) =>
    request<LatencyResponse>(
      `/latency?component=${encodeURIComponent(componentId)}&days=${days}`
    ),
  downtime: (componentId: string, day: string) =>
    request<DowntimeResponse>(
      `/downtime?component=${encodeURIComponent(componentId)}&day=${encodeURIComponent(day)}`
    ),
  downtimeRange: (componentId: string, days: number) =>
    request<DowntimeRangeResponse>(
      `/downtime?component=${encodeURIComponent(componentId)}&days=${days}`
    ),
};

/* ── Admin API ── */

export const adminApi = {
  verify: (token?: string | null) =>
    request<{ ok: boolean; identity?: { subject: string; roles: string[]; provider: string } }>(
      "/admin/auth/verify",
      { method: "POST", body: token ? { token } : {}, token: token ?? null }
    ),

  settings: () => request<Settings>("/admin/settings"),
  saveSettings: (settings: Settings) =>
    request<{ ok: boolean }>("/admin/settings", { method: "POST", body: { settings } }),

  groups: () => request<ComponentGroup[]>("/admin/components"),
  saveComponent: (input: AdminComponentInput) =>
    request<{ ok: boolean }>("/admin/components", { method: "POST", body: { component: input } }),
  deleteComponent: (id: string) =>
    request<{ ok: boolean }>("/admin/components", {
      method: "POST",
      body: { action: "delete", id },
    }),
  saveGroup: (input: {
    id?: string;
    name: string;
    position?: number;
    collapsed?: boolean;
    auto_expand?: boolean;
  }) => request<{ ok: boolean }>("/admin/groups", { method: "POST", body: { group: input } }),
  moveGroup: (id: string, direction: "up" | "down") =>
    request<{ ok: boolean }>("/admin/groups", {
      method: "POST",
      body: { action: "move", id, direction },
    }),
  moveComponent: (id: string, direction: "up" | "down") =>
    request<{ ok: boolean }>("/admin/components", {
      method: "POST",
      body: { action: "move", id, direction },
    }),
  deleteGroup: (id: string) =>
    request<{ ok: boolean }>("/admin/groups", { method: "POST", body: { action: "delete", id } }),

  saveIncident: (input: AdminIncidentInput) =>
    request<{ ok: boolean }>("/admin/incidents", { method: "POST", body: { incident: input } }),
  deleteIncident: (id: string) =>
    request<{ ok: boolean }>("/admin/incidents", {
      method: "POST",
      body: { action: "delete", id },
    }),

  runChecks: () =>
    request<{ ok: boolean; results: { component_id: string; ok: boolean }[] }>(
      "/admin/checks/run",
      { method: "POST" }
    ),
  checkLog: (componentId: string | null, limit = 40) =>
    request<CheckResult[]>(
      `/admin/checks?limit=${limit}${
        componentId ? `&component=${encodeURIComponent(componentId)}` : ""
      }`
    ),
  deleteChecks: (ids: number[]) =>
    request<{ ok: boolean; deleted: number }>("/admin/checks", {
      method: "POST",
      body: { action: "delete", ids },
    }),
  clearCheckFailures: (componentId: string) =>
    request<{ ok: boolean; deleted: number }>("/admin/checks", {
      method: "POST",
      body: { action: "clear", component_id: componentId },
    }),
  monitoringOverview: () => request<MonitoringOverview>("/admin/monitoring/overview"),
  monitoringList: <T>(entity: "hosts" | "services" | "checks" | "alerts" | "agents" | "status-pages") =>
    request<{ items: T[]; total: number; page: number; pages: number }>(
      `/admin/monitoring/${entity}`
    ),
  saveStatusPage: (statusPage: Record<string, unknown>) =>
    request<{ ok: boolean; id: string; verification: { type: string; name: string; value: string } | null }>("/admin/monitoring/status-pages", {
      method: "POST",
      body: { status_page: statusPage },
    }),
  monitorDetail: (id: string, period: "hour" | "day" | "week" | "month") =>
    request<{ check: Record<string, unknown>; metrics: Array<{ metric_key: string; value: number; unit: string | null; recorded_at: string }>; history: Array<{ id: number; ok: boolean; softfail: boolean; status: string; latency_ms: number | null; dns_ms: number | null; connect_ms: number | null; tls_ms: number | null; server_ms: number | null; status_code: number | null; error_text: string | null; diagnostic: Record<string, unknown> | null; checked_at: string }>; problem: { error: string; started_at: string; last_seen_at: string; consecutive_failures: number; same_error_count: number; previous_same_error_at: string | null; latest: Record<string, unknown> } | null; period: string; summary: { total: number; incidents: number; samples: number; minimum_ms: number | null; maximum_ms: number | null; average_ms: number | null; p95_ms: number | null; latest_ms: number | null } }>(`/admin/monitoring/checks/${encodeURIComponent(id)}?period=${period}`),
  saveMonitor: (check: Record<string, unknown>) =>
    request<{ ok: boolean; id: string }>("/admin/monitoring/checks", { method: "POST", body: { check } }),
  testMonitorAlert: (id: string) =>
    request<{ ok: boolean; alert_id: string }>(`/admin/monitoring/checks/${encodeURIComponent(id)}/test-alert`, { method: "POST" }),
  runMonitorNow: (id: string) =>
    request<{ ok: boolean; result: Record<string, unknown> }>(`/admin/monitoring/checks/${encodeURIComponent(id)}/run`, { method: "POST" }),
  uploadBranding: async (file: File, kind: "logo" | "logo_dark" | "mobile_logo" | "mobile_logo_dark" | "favicon", colorMode: "same" | "adaptive" | "custom") => {
    const body = new FormData();
    body.set("file", file);
    body.set("kind", kind);
    body.set("color_mode", colorMode);
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) { headers.Authorization = `Bearer ${token}`; headers["X-Auth-Token"] = token; }
    const response = await fetch(`${API_BASE}/admin/monitoring/branding/upload`, { method: "POST", headers, body });
    const data = await response.json();
    if (!response.ok) throw new ApiError(response.status, String(data.error ?? "Upload failed"));
    return data as { url: string; dark_url: string | null; color_mode: "same" | "adaptive" | "custom" };
  },
  updateAlertState: (id: string, state: "active" | "acknowledged" | "resolved") =>
    request<{ ok: boolean }>("/admin/monitoring/alerts/state", {
      method: "POST",
      body: { id, state },
    }),
};
