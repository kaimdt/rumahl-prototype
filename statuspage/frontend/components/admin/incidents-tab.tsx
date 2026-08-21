"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Megaphone, Plus, Trash2 } from "lucide-react";
import { adminApi, publicApi } from "@/lib/api";
import type {
  Component,
  Incident,
  IncidentImpact,
  IncidentStatus,
  IncidentType,
} from "@/lib/types";
import {
  INCIDENT_STATUS_LABEL,
  formatDate,
} from "@/lib/status-meta";
import { Button, Field, Input, SectionCard, Select, Textarea } from "@/components/admin/ui";
import { cn } from "@/lib/utils";

const STATUSES: IncidentStatus[] = [
  "investigating",
  "identified",
  "monitoring",
  "resolved",
  "scheduled",
  "in_progress",
  "completed",
];

const EMPTY = {
  type: "incident" as IncidentType,
  title: "",
  impact: "minor" as IncidentImpact,
  status: "investigating" as IncidentStatus,
  starts_at: "",
  resolves_at: null as string | null,
  component_ids: [] as string[],
  message: "",
};

export function IncidentsTab() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [components, setComponents] = useState<Component[]>([]);
  const [form, setForm] = useState({ ...EMPTY });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [updateMessage, setUpdateMessage] = useState("");
  const [updateStatus, setUpdateStatus] = useState<IncidentStatus>("monitoring");
  // affected components of the expanded incident — editable with every update
  const [updateComponents, setUpdateComponents] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const [inc, comps] = await Promise.all([
        publicApi.incidents(1, 100),
        adminApi.groups(),
      ]);
      setIncidents(inc.incidents);
      setComponents(comps.flatMap((g) => g.components));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const set = <K extends keyof typeof EMPTY>(key: K, value: (typeof EMPTY)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const now = () => new Date().toISOString().slice(0, 16);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.saveIncident({
        type: form.type,
        title: form.title.trim(),
        impact: form.impact,
        status: form.status,
        starts_at: form.starts_at || now(),
        resolves_at: form.resolves_at,
        component_ids: form.component_ids,
        message: form.message || undefined,
      });
      setForm({ ...EMPTY });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  };

  const toggleComponent = (id: string) =>
    setForm((f) => ({
      ...f,
      component_ids: f.component_ids.includes(id)
        ? f.component_ids.filter((c) => c !== id)
        : [...f.component_ids, id],
    }));

  const addUpdate = async (incident: Incident) => {
    if (!updateMessage.trim()) return;
    try {
      await adminApi.saveIncident({
        id: incident.id,
        type: incident.type,
        title: incident.title,
        impact: incident.impact,
        status: updateStatus,
        message: updateMessage.trim(),
        component_ids: updateComponents,
      });
      setUpdateMessage("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  };

  const resolveNow = async (incident: Incident) => {
    try {
      await adminApi.saveIncident({
        id: incident.id,
        type: incident.type,
        title: incident.title,
        impact: incident.impact,
        status: "resolved",
        message: "Incident has been resolved.",
        component_ids: updateComponents,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Resolve failed");
    }
  };

  const remove = async (incident: Incident) => {
    if (!window.confirm(`Delete incident "${incident.title}"?`)) return;
    try {
      await adminApi.deleteIncident(incident.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const statusColor = (s: IncidentStatus) =>
    ({
      investigating: "text-status-major",
      identified: "text-status-degraded",
      monitoring: "text-info",
      resolved: "text-status-operational",
      scheduled: "text-muted-foreground",
      in_progress: "text-status-degraded",
      completed: "text-status-operational",
    })[s];

  return (
    <div className="space-y-6">
      <SectionCard title="New incident" description="Incidents are shown publicly; updates build the timeline.">
        <form onSubmit={submit} className="grid sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <Field label="Title *">
              <Input
                value={form.title}
                onChange={(e) => set("title", e.target.value)}
                placeholder="Database connection issues"
                required
              />
            </Field>
          </div>
          <Field label="Type">
            <Select value={form.type} onChange={(e) => set("type", e.target.value as IncidentType)}>
              <option value="incident">Incident</option>
              <option value="maintenance">Scheduled maintenance</option>
            </Select>
          </Field>
          <Field label="Impact">
            <Select value={form.impact} onChange={(e) => set("impact", e.target.value as IncidentImpact)}>
              {["none", "minor", "major", "critical"].map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={(e) => set("status", e.target.value as IncidentStatus)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {INCIDENT_STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Start (local)">
            <Input type="datetime-local" value={form.starts_at} onChange={(e) => set("starts_at", e.target.value)} />
          </Field>
          {form.type === "maintenance" && (
            <Field label="Expected end (local)">
              <Input
                type="datetime-local"
                value={form.resolves_at ?? ""}
                onChange={(e) => set("resolves_at", e.target.value || null)}
              />
            </Field>
          )}
          <div className="sm:col-span-2">
            <Field label="Affected components">
              <div className="flex flex-wrap gap-1.5">
                {components.length === 0 && (
                  <span className="text-xs text-muted-foreground/60">No components yet.</span>
                )}
                {components.map((component) => (
                  <button
                    key={component.id}
                    type="button"
                    onClick={() => toggleComponent(component.id)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors",
                      form.component_ids.includes(component.id)
                        ? "border-primary/50 bg-primary/12 text-primary"
                        : "border-border/50 text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {component.name}
                  </button>
                ))}
              </div>
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Initial message" hint="Shown as the first update on the public page">
              <Textarea
                value={form.message}
                onChange={(e) => set("message", e.target.value)}
                placeholder="We are investigating…"
              />
            </Field>
          </div>
          <div className="sm:col-span-2 flex items-center gap-3">
            <Button type="submit" disabled={busy}>
              <Plus className="h-4 w-4" />
              Create
            </Button>
            {error && <span className="text-xs text-status-major">{error}</span>}
          </div>
        </form>
      </SectionCard>

      <SectionCard title={`Incidents & maintenance (${incidents.length})`}>
        <div className="space-y-3">
          {incidents.length === 0 && (
            <p className="text-sm text-muted-foreground/70">Nothing recorded yet.</p>
          )}
          {incidents.map((incident) => (
            <div key={incident.id} className="rounded-xl border border-border/25 bg-muted/10 overflow-hidden">
              <button
                onClick={() => setExpanded(expanded === incident.id ? null : incident.id)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left"
              >
                <span className="text-muted-foreground/50">
                  {incident.type === "maintenance" ? (
                    <CalendarClock className="h-4 w-4" />
                  ) : (
                    <Megaphone className="h-4 w-4" />
                  )}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] font-semibold text-foreground truncate">
                    {incident.title}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    {formatDate(incident.starts_at)} · {incident.updates.length} updates
                  </span>
                </span>
                <span className={cn("text-[11px] font-bold uppercase", statusColor(incident.status))}>
                  {INCIDENT_STATUS_LABEL[incident.status]}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(incident);
                  }}
                  className="p-1 text-muted-foreground/50 hover:text-status-major transition-colors"
                  title="Delete incident"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </button>

              {expanded === incident.id && (
                <div className="border-t border-border/25 px-4 py-4 space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={updateStatus}
                      onChange={(e) => setUpdateStatus(e.target.value as IncidentStatus)}
                      className="w-auto"
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {INCIDENT_STATUS_LABEL[s]}
                        </option>
                      ))}
                    </Select>
                    <Input
                      value={updateMessage}
                      onChange={(e) => setUpdateMessage(e.target.value)}
                      placeholder="New update message…"
                      className="flex-1 min-w-[200px]"
                    />
                    <Button type="button" onClick={() => addUpdate(incident)}>
                      Post update
                    </Button>
                    {incident.status !== "resolved" && incident.status !== "completed" && (
                      <Button type="button" variant="ghost" onClick={() => resolveNow(incident)}>
                        Resolve
                      </Button>
                    )}
                  </div>
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                      Affected components (changed with this update)
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {components.length === 0 && (
                        <span className="text-xs text-muted-foreground/60">No components yet.</span>
                      )}
                      {components.map((component) => (
                        <button
                          key={component.id}
                          type="button"
                          onClick={() =>
                            setUpdateComponents((ids) =>
                              ids.includes(component.id)
                                ? ids.filter((c) => c !== component.id)
                                : [...ids, component.id]
                            )
                          }
                          className={cn(
                            "rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors",
                            updateComponents.includes(component.id)
                              ? "border-primary/50 bg-primary/12 text-primary"
                              : "border-border/50 text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {component.name}
                        </button>
                      ))}
                    </div>
                  </div>
                  <ul className="space-y-2">
                    {[...incident.updates].reverse().map((update) => (
                      <li key={update.id} className="text-[12.5px] text-foreground/75 leading-relaxed">
                        <span className={cn("font-bold", statusColor(update.status))}>
                          {INCIDENT_STATUS_LABEL[update.status]}
                        </span>{" "}
                        <span className="text-muted-foreground text-[11px]">
                          {formatDate(update.created_at)}
                        </span>
                        <br />
                        {update.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
