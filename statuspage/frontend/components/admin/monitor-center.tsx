"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, BellRing, CheckCircle2, Clock3, Gauge, LoaderCircle, Play, Plus, Save, Search, XCircle } from "lucide-react";
import { adminApi } from "@/lib/api";
import { useAdminTranslation } from "@/lib/admin-i18n";

type Period = "hour" | "day" | "week" | "month";
type Monitor = Record<string, unknown>;
type Metric = { metric_key: string; value: number; unit: string | null; recorded_at: string };
type MetricSummary = { samples: number; minimum_ms: number | null; maximum_ms: number | null; average_ms: number | null; p95_ms: number | null; latest_ms: number | null; incidents: number };
type CheckResult = { id: number; ok: boolean; softfail: boolean; status: string; latency_ms: number | null; dns_ms: number | null; connect_ms: number | null; tls_ms: number | null; server_ms: number | null; status_code: number | null; error_text: string | null; diagnostic: Record<string, unknown> | null; checked_at: string };
type CurrentProblem = { error: string; started_at: string; last_seen_at: string; consecutive_failures: number; same_error_count: number; previous_same_error_at: string | null };

const bool = (value: unknown) => value === true || value === 1 || value === "1";
const json = (value: unknown) => {
  if (typeof value !== "string") return (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
};

export function MonitorCenter() {
  const t = useAdminTranslation();
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Monitor | null>(null);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [metricSummary, setMetricSummary] = useState<MetricSummary | null>(null);
  const [history, setHistory] = useState<CheckResult[]>([]);
  const [problem, setProblem] = useState<CurrentProblem | null>(null);
  const [period, setPeriod] = useState<Period>("day");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [checking, setChecking] = useState(false);

  const loadList = () => adminApi.monitoringList<Monitor>("checks").then((checks) => setMonitors(checks.items));
  useEffect(() => { void loadList(); }, []);
  useEffect(() => {
    if (!selected) return;
    if (selected.startsWith("service:")) {
      const service = monitors.find((monitor) => String(monitor.id) === selected);
      if (service) {
        setDetail({
          id: "", service_id: service.service_id, name: service.name, target: service.target ?? "",
          check_type: service.legacy_check_type ?? "http", config: {}, interval_seconds: 60, timeout_ms: 10000,
          retry_count: 1, failure_threshold: 3, recovery_threshold: 2, enabled: service.enabled,
          status: service.status ?? "unknown", is_new: true,
        });
        setMetrics([]);
        setMetricSummary(null);
      }
      return;
    }
    adminApi.monitorDetail(selected, period).then((response) => {
      setDetail({ ...response.check, config: json(response.check.config) });
      setMetrics(response.metrics.map((point) => ({ ...point, value: Number(point.value) })));
      setMetricSummary(response.summary);
      setHistory(response.history);
      setProblem(response.problem);
    });
  }, [selected, period, monitors]);

  const filtered = useMemo(() => monitors.filter((monitor) => String(monitor.name ?? "").toLowerCase().includes(query.toLowerCase())), [monitors, query]);
  const config = (detail?.config ?? {}) as Record<string, unknown>;
  const update = (key: string, value: unknown) => setDetail((current) => current ? { ...current, [key]: value } : current);
  const updateConfig = (key: string, value: unknown) => setDetail((current) => current ? { ...current, config: { ...json(current.config), [key]: value } } : current);
  const saveMonitor = async (close: boolean) => {
    if (!detail) return;
    const payload = { ...detail };
    delete payload.is_new;
    if (!payload.id) delete payload.id;
    const result = await adminApi.saveMonitor(payload);
    setNotice(t("monitoring.saved"));
    await loadList();
    if (close) {
      setSelected(null);
      setDetail(null);
    } else {
      setSelected(result.id);
    }
  };
  const checkNow = async () => {
    if (!selected || selected.startsWith("service:")) return;
    setChecking(true);
    try {
      const response = await adminApi.runMonitorNow(selected);
      setNotice(response.result.ok ? t("monitoring.checkNowSuccess") : t("monitoring.checkNowFailure"));
      const refreshed = await adminApi.monitorDetail(selected, period);
      setDetail({ ...refreshed.check, config: json(refreshed.check.config) });
      setMetrics(refreshed.metrics.map((point) => ({ ...point, value: Number(point.value) })));
      setMetricSummary(refreshed.summary);
      setHistory(refreshed.history);
      setProblem(refreshed.problem);
      await loadList();
    } finally {
      setChecking(false);
    }
  };

  if (selected && detail) return <div className="monitor-detail space-y-6">
    <button type="button" onClick={() => { setSelected(null); setDetail(null); }} className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />{t("monitoring.backToMonitors")}</button>
    <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
      <div><div className="flex items-center gap-3"><span className={`h-3 w-3 rounded-full ${monitorStatusDot(String(detail.status ?? "unknown"))}`} /><h2 className="text-2xl font-bold">{String(detail.name ?? "")}</h2></div><p className="mt-1 text-sm text-muted-foreground">{String(detail.target ?? "")} · {t("monitoring.checkedEvery")} {Math.round(Number(detail.interval_seconds ?? 60) / 60)} min</p></div>
      <div className="flex flex-wrap gap-2">{!detail.is_new && <><button type="button" disabled={checking || !bool(detail.enabled)} onClick={() => void checkNow()} className="inline-flex items-center gap-2 rounded-xl bg-indigo-500 px-3 py-2 text-sm font-bold text-white disabled:opacity-40">{checking ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}{checking ? t("monitoring.checkingNow") : t("monitoring.checkNow")}</button><button type="button" onClick={async () => { await adminApi.testMonitorAlert(selected); setNotice(t("monitoring.testAlertCreated")); }} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm font-semibold"><BellRing className="h-4 w-4" />{t("monitoring.testAlert")}</button></>}<button type="button" disabled={!detail.name || !detail.target} onClick={() => void saveMonitor(false)} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm font-bold disabled:opacity-40"><Save className="h-4 w-4" />{t("monitoring.save")}</button><button type="button" disabled={!detail.name || !detail.target} onClick={() => void saveMonitor(true)} className="inline-flex items-center gap-2 rounded-xl bg-indigo-500 px-3 py-2 text-sm font-bold text-white disabled:opacity-40"><Save className="h-4 w-4" />{t("monitoring.saveAndClose")}</button></div>
    </div>
    {notice && <p className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm">{notice}</p>}
    {problem && <section className="rounded-2xl border border-rose-400/25 bg-rose-500/[0.07] p-5">
      <div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-300" /><div className="min-w-0"><h3 className="font-bold text-rose-200">{t("monitoring.currentProblem")}</h3><p className="mt-1 break-words text-sm text-rose-100">{problem.error}</p></div></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><MiniMetric label={t("monitoring.problemSince")} value={new Date(problem.started_at).toLocaleString()} /><MiniMetric label={t("monitoring.problemDuration")} value={formatDuration(problem.started_at)} /><MiniMetric label={t("monitoring.consecutiveFailures")} value={String(problem.consecutive_failures)} /><MiniMetric label={t("monitoring.sameErrorBefore")} value={problem.previous_same_error_at ? new Date(problem.previous_same_error_at).toLocaleString() : t("monitoring.notInSelectedPeriod")} /></div>
    </section>}
    <div className="monitor-kpis grid gap-3 sm:grid-cols-3"><Kpi label={t("monitoring.lastChecked")} value={detail.last_checked_at ? new Date(String(detail.last_checked_at)).toLocaleString() : t("monitoring.neverChecked")} /><Kpi label={t("monitoring.currentStatus")} value={String(detail.status ?? "unknown").replaceAll("_", " ")} /><Kpi label={t("monitoring.frequencySeconds")} value={`${Number(detail.interval_seconds ?? 60)} s`} /></div>
    <section className="monitor-response-card rounded-2xl border border-white/[0.08] bg-[#0f1422] p-5 shadow-2xl shadow-black/10">
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-bold">{t("monitoring.responseTimes")}</h3><div className="flex rounded-lg border border-border/50 p-1">{(["hour", "day", "week", "month"] as Period[]).map((value) => <button type="button" key={value} onClick={() => setPeriod(value)} className={`rounded-md px-3 py-1 text-xs font-semibold ${period === value ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>{t(`monitoring.period.${value}`)}</button>)}</div></div>
      {metricSummary && metricSummary.samples > 0 && <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <MiniMetric label={t("monitoring.latestResponse")} value={formatMs(metricSummary.latest_ms)} />
        <MiniMetric label={t("monitoring.averageResponse")} value={formatMs(metricSummary.average_ms)} />
        <MiniMetric label={t("monitoring.p95Response")} value={formatMs(metricSummary.p95_ms)} />
        <MiniMetric label={t("monitoring.minimumResponse")} value={formatMs(metricSummary.minimum_ms)} />
        <MiniMetric label={t("monitoring.maximumResponse")} value={formatMs(metricSummary.maximum_ms)} />
        <MiniMetric label={t("monitoring.samples")} value={String(metricSummary.samples)} />
      </div>}
      <ResponseTimeChart metrics={metrics} average={metricSummary?.average_ms ?? null} emptyLabel={t("monitoring.noResponseData")} averageLabel={t("monitoring.averageResponse")} />
    </section>
    <CheckHistory results={history} title={t("monitoring.checkHistory")} emptyLabel={t("monitoring.noCheckHistory")} detailsLabel={t("monitoring.checkDetails")} />
    <section className="monitor-settings-card rounded-2xl border border-white/[0.08] bg-[#0f1422] p-5"><h3 className="text-lg font-bold">{t("monitoring.advancedSettings")}</h3><div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Field label={t("monitoring.monitorName")} value={String(detail.name ?? "")} onChange={(value) => update("name", value)} />
      <Field label={t("monitoring.target")} value={String(detail.target ?? "")} onChange={(value) => update("target", value)} />
      <SelectField label={t("monitoring.protocol")} value={String(detail.check_type ?? "http")} options={["http", "tcp", "icmp", "dns", "tls", "smtp", "custom"]} onChange={(value) => update("check_type", value)} />
      <NumberField label={t("monitoring.recoveryPeriod")} value={Number(detail.recovery_threshold ?? 2)} onChange={(value) => update("recovery_threshold", value)} />
      <NumberField label={t("monitoring.confirmationPeriod")} value={Number(detail.failure_threshold ?? 3)} onChange={(value) => update("failure_threshold", value)} />
      <NumberField label={t("monitoring.frequencySeconds")} value={Number(detail.interval_seconds ?? 60)} onChange={(value) => update("interval_seconds", value)} />
      <NumberField label={t("monitoring.timeoutMs")} value={Number(detail.timeout_ms ?? 10000)} onChange={(value) => update("timeout_ms", value)} />
      <SelectField label={t("monitoring.ipVersion")} value={String(config.ip_version ?? "both")} options={["both", "ipv4", "ipv6"]} onChange={(value) => updateConfig("ip_version", value)} />
      {detail.check_type === "http" && <><SelectField label={t("monitoring.httpMethod")} value={String(config.method ?? "GET")} options={["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]} onChange={(value) => updateConfig("method", value)} /><Toggle label={t("monitoring.tlsVerification")} checked={!Object.hasOwn(config, "tls_verify") || bool(config.tls_verify)} onChange={(value) => updateConfig("tls_verify", value)} /></>}
      <Field label={t("monitoring.sslExpiration")} value={String(config.ssl_expiration_days ?? "")} onChange={(value) => updateConfig("ssl_expiration_days", value)} />
      <Field label={t("monitoring.domainExpiration")} value={String(config.domain_expiration_days ?? "")} onChange={(value) => updateConfig("domain_expiration_days", value)} />
      <Field label={t("monitoring.basicAuthUsername")} value={String(config.basic_auth_username ?? "")} onChange={(value) => updateConfig("basic_auth_username", value)} />
      <Field label={t("monitoring.basicAuthPassword")} type="password" value={String(config.basic_auth_password ?? "")} onChange={(value) => updateConfig("basic_auth_password", value)} />
      <Field label={t("monitoring.proxyHost")} value={String(config.proxy_host ?? "")} onChange={(value) => updateConfig("proxy_host", value)} />
      <NumberField label={t("monitoring.proxyPort")} value={Number(config.proxy_port ?? 3128)} onChange={(value) => updateConfig("proxy_port", value)} />
      <Field label={t("monitoring.timezone")} value={String(config.timezone ?? "Europe/Berlin")} onChange={(value) => updateConfig("timezone", value)} />
      <Field label={t("monitoring.regions")} value={String(config.regions ?? "Europe")} onChange={(value) => updateConfig("regions", value)} />
      {detail.check_type === "http" && <><label className="md:col-span-2 xl:col-span-3 text-sm"><span className="mb-1.5 block font-semibold">{t("monitoring.requestBody")}</span><textarea rows={4} value={String(config.body ?? "")} onChange={(event) => updateConfig("body", event.target.value)} className="w-full rounded-xl border border-border/50 bg-background px-3 py-2 font-mono text-xs" /></label><label className="md:col-span-2 xl:col-span-3 text-sm"><span className="mb-1.5 block font-semibold">{t("monitoring.requestHeaders")}</span><textarea rows={5} value={String(config.headers ?? "")} onChange={(event) => updateConfig("headers", event.target.value)} placeholder={'Token: masked-value\nPragma: no-cache'} className="w-full rounded-xl border border-border/50 bg-background px-3 py-2 font-mono text-xs" /></label></>}
    </div></section>
  </div>;

  return <div className="monitor-center space-y-5"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><h2 className="text-xl font-bold">{t("monitoring.monitors")}</h2><p className="mt-1 text-sm text-slate-400">{t("monitoring.monitorsSubtitle")}</p></div><div className="flex gap-2"><button type="button" onClick={() => { setSelected("service:new"); setDetail({ id: "", service_id: null, name: "", target: "", check_type: "http", config: {}, interval_seconds: 60, timeout_ms: 10000, retry_count: 1, failure_threshold: 3, recovery_threshold: 2, enabled: true, status: "unknown", is_new: true }); }} className="inline-flex items-center gap-2 rounded-xl bg-indigo-500 px-3 py-2 text-sm font-bold text-white"><Plus className="h-4 w-4" />{t("monitoring.createMonitor")}</button><label className="flex items-center gap-2 rounded-xl border border-white/10 bg-[#0f1422] px-3 py-2 sm:w-72"><Search className="h-4 w-4 text-slate-500" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("monitoring.search")} className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></label></div></div>
    <div className="monitor-list overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0f1422]">{filtered.length === 0 ? <p className="p-8 text-center text-sm text-slate-500">{t("monitoring.noData")}</p> : filtered.map((monitor) => { const status = !bool(monitor.enabled) ? "paused" : String(monitor.status ?? "unknown"); const tone = monitorStatusTone(status); return <button type="button" key={String(monitor.id)} onClick={() => setSelected(String(monitor.id))} className={`monitor-list-item grid w-full gap-3 border-b border-white/[0.06] border-l-4 px-4 py-4 text-left transition last:border-b-0 hover:brightness-110 sm:grid-cols-[1fr_auto_auto_auto] sm:items-center ${tone.row}`}><div className="min-w-0"><p className="truncate text-sm font-bold">{String(monitor.name ?? monitor.target ?? monitor.id)}</p><p className="truncate text-xs text-slate-400">{String(monitor.target ?? "") || t("monitoring.configureMonitor")}</p></div><span className="inline-flex items-center gap-1.5 text-xs text-slate-300"><Clock3 className="h-3.5 w-3.5" />{monitor.last_checked_at ? new Date(String(monitor.last_checked_at)).toLocaleString() : t("monitoring.neverChecked")}</span><span className="inline-flex items-center gap-1.5 text-xs text-slate-300"><Gauge className="h-3.5 w-3.5" />{monitor.interval_seconds ? `${Math.round(Number(monitor.interval_seconds) / 60)} min` : "—"}</span><span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase ${tone.badge}`}>{status.replaceAll("_", " ")}</span></button>; })}</div>
  </div>;
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) { return <label className="text-sm"><span className="mb-1.5 block font-semibold">{label}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-xl border border-border/50 bg-background px-3 py-2" /></label>; }
function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) { return <label className="text-sm"><span className="mb-1.5 block font-semibold">{label}</span><input type="number" min={0} value={value} onChange={(event) => onChange(Number(event.target.value))} className="w-full rounded-xl border border-border/50 bg-background px-3 py-2" /></label>; }
function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) { return <label className="text-sm"><span className="mb-1.5 block font-semibold">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-xl border border-border/50 bg-background px-3 py-2">{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>; }
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) { return <label className="flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-background px-3 py-2 text-sm font-semibold"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /></label>; }
function Kpi({ label, value }: { label: string; value: string }) { return <div className="rounded-2xl border border-white/[0.08] bg-[#0f1422] p-4"><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p><p className="mt-2 truncate text-lg font-bold capitalize text-slate-100">{value}</p></div>; }
function MiniMetric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-white/[0.07] bg-black/10 px-3 py-2"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p><p className="mt-1 text-sm font-bold text-slate-100">{value}</p></div>; }
function formatMs(value: number | null | undefined) { return value === null || value === undefined ? "—" : `${Math.round(value)} ms`; }
function formatDuration(startedAt: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ${Math.floor((seconds % 3600) / 60)} min`;
  return `${Math.floor(seconds / 86400)} d ${Math.floor((seconds % 86400) / 3600)} h`;
}
function monitorStatusTone(status: string) {
  if (status === "operational") return { row: "border-l-emerald-400 bg-emerald-400/[0.045]", badge: "border-emerald-400/30 bg-emerald-400/15 text-emerald-300" };
  if (status === "degraded") return { row: "border-l-amber-400 bg-amber-400/[0.05]", badge: "border-amber-400/30 bg-amber-400/15 text-amber-300" };
  if (status === "partial_outage" || status === "major_outage") return { row: "border-l-rose-500 bg-rose-500/[0.06]", badge: "border-rose-400/30 bg-rose-400/15 text-rose-300" };
  if (status === "maintenance") return { row: "border-l-sky-400 bg-sky-400/[0.05]", badge: "border-sky-400/30 bg-sky-400/15 text-sky-300" };
  return { row: "border-l-slate-500 bg-slate-500/[0.035]", badge: "border-slate-400/20 bg-slate-400/10 text-slate-300" };
}
function monitorStatusDot(status: string) {
  if (status === "operational") return "bg-emerald-400 shadow-[0_0_12px_rgb(52_211_153/.65)]";
  if (status === "degraded") return "bg-amber-400 shadow-[0_0_12px_rgb(251_191_36/.65)]";
  if (status === "partial_outage" || status === "major_outage") return "bg-rose-500 shadow-[0_0_12px_rgb(244_63_94/.65)]";
  if (status === "maintenance") return "bg-sky-400 shadow-[0_0_12px_rgb(56_189_248/.65)]";
  return "bg-slate-500";
}

function ResponseTimeChart({ metrics, average, emptyLabel, averageLabel }: { metrics: Metric[]; average: number | null; emptyLabel: string; averageLabel: string }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const points = metrics.slice(-160);
  const maximum = Math.max(1, ...points.map((point) => point.value));
  if (points.length === 0) return <div className="mt-5 flex h-56 rounded-xl border border-border/30 bg-background/30 p-4"><p className="m-auto text-sm text-muted-foreground">{emptyLabel}</p></div>;
  return <div className="relative mt-5 flex h-64 items-end gap-0.5 rounded-xl border border-border/30 bg-background/30 px-4 pb-9 pt-5" onMouseLeave={() => setHovered(null)}>
    {average !== null && <div className="pointer-events-none absolute inset-x-4 border-t border-dashed border-indigo-300/35" style={{ bottom: `${36 + (average / maximum) * 190}px` }}><span className="absolute right-0 -top-5 text-[10px] text-slate-500">{averageLabel} {formatMs(average)}</span></div>}
    {points.map((point, index) => <button type="button" key={`${point.recorded_at}-${index}`} aria-label={`${formatMs(point.value)}, ${new Date(point.recorded_at).toLocaleString()}`} onMouseEnter={() => setHovered(index)} onFocus={() => setHovered(index)} onBlur={() => setHovered(null)} className="group relative z-10 min-w-[2px] flex-1 rounded-t bg-indigo-400/65 outline-none transition-colors hover:bg-indigo-300 focus:bg-indigo-300" style={{ height: `${Math.max(2, (point.value / maximum) * 100)}%` }} />)}
    {hovered !== null && points[hovered] && <div className="pointer-events-none absolute z-20 w-56 -translate-x-1/2 rounded-xl border border-white/10 bg-slate-950 p-3 text-xs shadow-2xl" style={{ left: `${Math.min(88, Math.max(12, ((hovered + 0.5) / points.length) * 100))}%`, bottom: `${48 + (points[hovered].value / maximum) * 170}px` }}>
      <p className="font-bold text-slate-100">{formatMs(points[hovered].value)}</p>
      <p className="mt-1 text-slate-400">{new Date(points[hovered].recorded_at).toLocaleString()}</p>
      <div className="mt-2 flex justify-between border-t border-white/10 pt-2 text-slate-400"><span>{points[hovered].metric_key.replaceAll("_", " ")}</span><span>{average === null ? "—" : `${points[hovered].value >= average ? "+" : ""}${Math.round(points[hovered].value - average)} ms`}</span></div>
    </div>}
    <span className="absolute bottom-3 left-4 text-[10px] text-slate-500">{new Date(points[0].recorded_at).toLocaleString()}</span><span className="absolute bottom-3 right-4 text-[10px] text-slate-500">{new Date(points[points.length - 1].recorded_at).toLocaleString()}</span>
  </div>;
}

function CheckHistory({ results, title, emptyLabel, detailsLabel }: { results: CheckResult[]; title: string; emptyLabel: string; detailsLabel: string }) {
  return <section className="rounded-2xl border border-white/[0.08] bg-[#0f1422] p-5"><h3 className="font-bold">{title}</h3>{results.length === 0 ? <p className="mt-4 text-sm text-slate-500">{emptyLabel}</p> : <div className="mt-4 overflow-hidden rounded-xl border border-white/[0.07]">{results.slice(0, 50).map((result) => <details key={result.id} className="group border-b border-white/[0.06] last:border-0"><summary className="grid cursor-pointer list-none gap-2 px-4 py-3 hover:bg-white/[0.025] sm:grid-cols-[auto_1fr_auto_auto] sm:items-center">{result.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-rose-400" />}<div><p className={`text-sm font-semibold ${result.ok ? "text-emerald-200" : "text-rose-200"}`}>{result.ok ? "OK" : result.error_text || result.status.replaceAll("_", " ")}</p><p className="text-xs text-slate-500">{new Date(result.checked_at).toLocaleString()}</p></div><span className="text-xs text-slate-400">{formatMs(result.latency_ms)}</span><span className="text-xs font-semibold text-slate-500">{result.status_code ? `HTTP ${result.status_code}` : detailsLabel}</span></summary><div className="grid gap-3 border-t border-white/[0.06] bg-black/10 px-4 py-4 sm:grid-cols-2 lg:grid-cols-5"><MiniMetric label="DNS" value={formatMs(result.dns_ms)} /><MiniMetric label="Connect" value={formatMs(result.connect_ms)} /><MiniMetric label="TLS" value={formatMs(result.tls_ms)} /><MiniMetric label="Server" value={formatMs(result.server_ms)} /><MiniMetric label="Total" value={formatMs(result.latency_ms)} />{result.error_text && <p className="break-words text-sm text-rose-200 sm:col-span-2 lg:col-span-5">{result.error_text}</p>}{result.diagnostic && <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-white/[0.06] bg-slate-950 p-3 text-[11px] text-slate-300 sm:col-span-2 lg:col-span-5">{JSON.stringify(result.diagnostic, null, 2)}</pre>}</div></details>)}</div>}</section>;
}
