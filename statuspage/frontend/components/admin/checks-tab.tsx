"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { CheckCircle2, Eraser, ExternalLink, Play, Trash2, TriangleAlert, XCircle } from "lucide-react";
import { adminApi } from "@/lib/api";
import type { CheckResult, Component } from "@/lib/types";
import { Button, SectionCard, Select } from "@/components/admin/ui";
import { cn } from "@/lib/utils";

export function ChecksTab() {
  const [components, setComponents] = useState<Component[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [results, setResults] = useState<CheckResult[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (componentId: string) => {
    try {
      setResults(await adminApi.checkLog(componentId || null, 40));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load checks");
    }
  }, []);

  useEffect(() => {
    adminApi
      .groups()
      .then((groups) => {
        const all = groups.flatMap((g) => g.components).filter((c) => c.kind === "auto");
        setComponents(all);
        if (all.length > 0) setSelected(all[0].id);
        return all[0]?.id ?? "";
      })
      .then((id) => {
        if (id) return load(id);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, [load]);

  const runNow = async () => {
    setRunning(true);
    setError(null);
    try {
      await adminApi.runChecks();
      if (selected) await load(selected);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check run failed");
    } finally {
      setRunning(false);
    }
  };

  const removeResult = async (result: CheckResult) => {
    if (!window.confirm(`Delete this check result?\n\nUptime and status are recalculated — an open incident for this component may be resolved.`)) return;
    try {
      await adminApi.deleteChecks([result.id]);
      await load(selected);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const clearFailures = async () => {
    if (!selected) return;
    const name = components.find((c) => c.id === selected)?.name ?? selected;
    if (!window.confirm(`Delete ALL failed results of "${name}"?\n\nUptime and status are recalculated — open incidents may be resolved.`)) return;
    try {
      await adminApi.clearCheckFailures(selected);
      await load(selected);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Clear failed");
    }
  };

  return (
    <div className="space-y-6">
      <SectionCard
        title="Run checks"
        description="Runs the monitor cycle for all auto components immediately (normally triggered by cron)."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={runNow} disabled={running}>
            <Play className="h-4 w-4" />
            {running ? "Running…" : "Run checks now"}
          </Button>
          {error && <span className="text-xs text-status-major">{error}</span>}
        </div>
      </SectionCard>

      <SectionCard title="Check log">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Select
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              load(e.target.value);
            }}
            className="max-w-sm"
          >
            {components.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          {selected && (
            <Button type="button" variant="ghost" onClick={clearFailures} title="Delete all failed results of this component">
              <Eraser className="h-4 w-4" />
              Clear failures
            </Button>
          )}
          <span className="text-[11px] text-muted-foreground/70">
            Deleting results recalculates uptime and status — useful for false positives
            (e.g. the status page itself was down).
          </span>
        </div>

        {results.length === 0 ? (
          <p className="text-sm text-muted-foreground/70">
            No checks recorded yet — the cron runs the monitor, or use “Run checks now”.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border/25">
            <table className="w-full text-left text-[12.5px]">
              <thead>
                <tr className="border-b border-border/30 bg-muted/20 text-[10.5px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2 font-bold">Result</th>
                  <th className="px-3 py-2 font-bold">Component</th>
                  <th className="px-3 py-2 font-bold">Type</th>
                  <th className="px-3 py-2 font-bold">Server</th>
                  <th className="px-3 py-2 font-bold">Network</th>
                  <th className="px-3 py-2 font-bold">Total</th>
                  <th className="px-3 py-2 font-bold">Code</th>
                  <th className="px-3 py-2 font-bold">Error</th>
                  <th className="px-3 py-2 font-bold">Checked at</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/15">
                {results.map((r) => {
                  const softfail = !r.ok && r.softfail;
                  return (
                    <Fragment key={r.id}>
                    <tr>
                      <td className="px-3 py-2">
                        {r.ok ? (
                          <span className="inline-flex items-center gap-1 font-semibold text-status-operational">
                            <CheckCircle2 className="h-3.5 w-3.5" /> OK
                          </span>
                        ) : softfail ? (
                          <span className="inline-flex items-center gap-1 font-semibold text-status-degraded">
                            <TriangleAlert className="h-3.5 w-3.5" /> SOFTFAIL
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 font-semibold text-status-major">
                            <XCircle className="h-3.5 w-3.5" /> FAIL
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{r.component_name}</td>
                      <td className="px-3 py-2">
                        <span className="rounded-full border border-border/40 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
                          {r.check_type}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={cn(
                            "tabular-nums font-semibold",
                            r.latency_ms !== null && r.latency_ms > 3000 && "text-status-degraded"
                          )}
                          title={
                            r.server_ms !== null
                              ? "Server time (TTFB minus DNS/TCP/TLS) — network phases are not counted"
                              : "Total time (no server timing available for this check)"
                          }
                        >
                          {r.latency_ms !== null ? `${r.latency_ms} ms` : "—"}
                        </span>
                        {r.server_ms !== null && r.total_ms !== null && r.total_ms > r.server_ms && (
                          <span className="block text-[10px] text-muted-foreground/60 tabular-nums">
                            server {r.server_ms} ms
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground tabular-nums whitespace-nowrap">
                        {r.dns_ms !== null || r.connect_ms !== null || r.tls_ms !== null ? (
                          <span title="DNS / TCP / TLS — infrastructure, not counted">
                            {[r.dns_ms, r.connect_ms, r.tls_ms]
                              .map((v) => (v !== null ? `${v} ms` : "—"))
                              .join(" + ")}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground/70">
                        {r.total_ms ?? "—"} ms
                      </td>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">
                        {r.status_code ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground max-w-[280px] truncate" title={r.error ?? ""}>
                        {r.error ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                        {new Date(r.checked_at).toLocaleString("en-GB")}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {r.screenshot_url && <a href={r.screenshot_url} target="_blank" rel="noreferrer" className="inline-flex p-1 text-primary" title="Open failure screenshot"><ExternalLink className="h-3.5 w-3.5" /></a>}
                        <button
                          onClick={() => removeResult(r)}
                          className="p-1 text-muted-foreground/40 hover:text-status-major transition-colors"
                          title="Delete this result (recalculates uptime & status)"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                    {!r.ok && r.diagnostic && <tr key={`${r.id}-diagnostic`} className="bg-muted/10">
                      <td colSpan={10} className="px-4 py-3">
                        <details>
                          <summary className="cursor-pointer text-xs font-bold text-muted-foreground">Failure diagnostics</summary>
                          <div className="mt-3 grid gap-3 lg:grid-cols-2">
                            <DiagnosticBlock title="Request" lines={[r.diagnostic.effective_url, ...r.diagnostic.request_headers]} />
                            <DiagnosticBlock title="Response headers" lines={r.diagnostic.response_headers} />
                            {r.diagnostic.body_excerpt && <DiagnosticBlock title="Response excerpt" lines={[r.diagnostic.body_excerpt]} />}
                          </div>
                        </details>
                      </td>
                    </tr>}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function DiagnosticBlock({ title, lines }: { title: string; lines: string[] }) {
  return <div className="min-w-0 rounded-xl border border-border/30 bg-background/50 p-3">
    <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{title}</p>
    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-[11px] text-foreground/80">{lines.join("\n")}</pre>
  </div>;
}
