"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Play, TriangleAlert, XCircle } from "lucide-react";
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
        <div className="mb-4">
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
                  <th className="px-3 py-2 font-bold">Latency</th>
                  <th className="px-3 py-2 font-bold">Code</th>
                  <th className="px-3 py-2 font-bold">Error</th>
                  <th className="px-3 py-2 font-bold">Checked at</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/15">
                {results.map((r) => {
                  const softfail = !r.ok && r.softfail;
                  return (
                    <tr key={r.id}>
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
                      <td className={cn("px-3 py-2 tabular-nums", r.latency_ms !== null && r.latency_ms > 3000 && "text-status-degraded font-semibold")}>
                        {r.latency_ms !== null ? `${r.latency_ms} ms` : "—"}
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
                    </tr>
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
