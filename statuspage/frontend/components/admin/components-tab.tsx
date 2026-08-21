"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, GripVertical, Plus, Radar, Trash2 } from "lucide-react";
import { adminApi } from "@/lib/api";
import type {
  AdminComponentInput,
  CheckType,
  Component,
  ComponentGroup,
  ComponentKind,
  ComponentStatus,
} from "@/lib/types";
import { Button, Field, Input, SectionCard, Select, Textarea } from "@/components/admin/ui";
import { cn } from "@/lib/utils";

interface GroupFull extends ComponentGroup {
  components: Component[];
}

const EMPTY_FORM: AdminComponentInput & { manual_status: ComponentStatus } = {
  id: undefined,
  group_id: null,
  name: "",
  description: "",
  kind: "manual",
  check_type: "http",
  endpoint_url: "",
  method: "GET",
  expected_status: 200,
  timeout_ms: 10000,
  headers: [],
  manual_status: "operational",
};

const ENDPOINT_HINT: Record<CheckType, string> = {
  http: "e.g. https://rumahl.com/health or https://status.rumahl.com/api/status",
  tcp: "e.g. db.internal:3306 or https://example.com (connects to 443)",
  ping: "Hostname or IPv4 address, e.g. rumahl.com or 8.8.8.8 (ICMP)",
};

const CHECK_TYPE_LABEL: Record<CheckType, string> = {
  http: "HTTP(S) request",
  tcp: "TCP port reachable",
  ping: "ICMP ping",
};

export function ComponentsTab() {
  const [groups, setGroups] = useState<GroupFull[]>([]);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setGroups(await adminApi.groups());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load components");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const set = <K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.saveComponent(form);
      setForm({ ...EMPTY_FORM, group_id: form.group_id });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (component: Component) => {
    try {
      await adminApi.saveComponent({
        id: component.id,
        name: component.name,
        kind: component.kind,
        enabled: !component.enabled,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Toggle failed");
    }
  };

  const remove = async (component: Component) => {
    if (!window.confirm(`Delete component "${component.name}"?`)) return;
    try {
      await adminApi.deleteComponent(component.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const addGroup = async () => {
    const name = window.prompt("New group name:");
    if (!name?.trim()) return;
    try {
      await adminApi.saveGroup({ name: name.trim() });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    }
  };

  const renameGroup = async (group: ComponentGroup) => {
    const name = window.prompt("Group name:", group.name);
    if (!name?.trim() || name.trim() === group.name) return;
    try {
      await adminApi.saveGroup({ id: group.id, name: name.trim(), position: group.position });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rename failed");
    }
  };

  const removeGroup = async (group: ComponentGroup) => {
    if (!window.confirm(`Delete group "${group.name}"? Its components become ungrouped.`)) return;
    try {
      await adminApi.deleteGroup(group.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const toggleCollapsed = async (group: ComponentGroup) => {
    try {
      await adminApi.saveGroup({
        id: group.id,
        name: group.name,
        position: group.position,
        collapsed: !group.collapsed,
        auto_expand: group.auto_expand,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  };

  const toggleAutoExpand = async (group: ComponentGroup) => {
    try {
      await adminApi.saveGroup({
        id: group.id,
        name: group.name,
        position: group.position,
        collapsed: group.collapsed,
        auto_expand: !group.auto_expand,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  };


  return (

    <div className="space-y-6">
      {/* Editor */}
      <SectionCard
        title={form.id ? "Edit component" : "New component"}
        description="Auto components are checked against their endpoint; manual components keep the status you set here."
      >
        <form onSubmit={submit} className="grid sm:grid-cols-2 gap-4">
          <Field label="Name *">
            <Input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="rumahl Home (API)"
              required
            />
          </Field>
          <Field label="Group">
            <Select value={form.group_id ?? ""} onChange={(e) => set("group_id", e.target.value || null)}>
              <option value="">— ungrouped —</option>
              {groups
                .filter((g) => g.id !== "__ungrouped__")
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Description">
              <Input
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="Shown on the public page"
              />
            </Field>
          </div>
          <Field label="Type">
            <Select
              value={form.kind}
              onChange={(e) => set("kind", e.target.value as ComponentKind)}
            >
              <option value="auto">Auto (monitored)</option>
              <option value="manual">Manual (status set by admin)</option>
            </Select>
          </Field>
          {form.kind === "auto" && (
            <Field label="Check type">
              <Select
                value={form.check_type}
                onChange={(e) => set("check_type", e.target.value as CheckType)}
              >
                {(Object.keys(CHECK_TYPE_LABEL) as CheckType[]).map((t) => (
                  <option key={t} value={t}>
                    {CHECK_TYPE_LABEL[t]}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Manual status" hint="Used when type is manual">
            <Select
              value={form.manual_status}
              onChange={(e) => set("manual_status", e.target.value as ComponentStatus)}
              disabled={form.kind !== "manual"}
            >
              <option value="operational">Operational</option>
              <option value="degraded">Degraded</option>
              <option value="partial_outage">Partial outage</option>
              <option value="major_outage">Major outage</option>
            </Select>
          </Field>
          {form.kind === "auto" && (
            <>
              <div className="sm:col-span-2">
                <Field label="Endpoint *" hint={ENDPOINT_HINT[form.check_type ?? "http"]}>
                  <Input
                    value={form.endpoint_url}
                    onChange={(e) => set("endpoint_url", e.target.value)}
                    placeholder={form.check_type === "ping" ? "example.com" : "https://…"}
                  />
                </Field>
              </div>
              {form.check_type === "http" && (
                <>
                  <Field label="Method">
                    <Select value={form.method} onChange={(e) => set("method", e.target.value)}>
                      {["GET", "HEAD", "POST", "OPTIONS"].map((m) => (
                        <option key={m}>{m}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Expected status">
                    <Input
                      type="number"
                      value={form.expected_status}
                      onChange={(e) => set("expected_status", Number(e.target.value) || 200)}
                    />
                  </Field>
                </>
              )}
              <Field label="Timeout (ms)">
                <Input
                  type="number"
                  value={form.timeout_ms}
                  onChange={(e) => set("timeout_ms", Number(e.target.value) || 10000)}
                />
              </Field>
              {form.check_type === "http" && (
                <div className="sm:col-span-2">
                  <Field
                    label="Custom headers"
                    hint='One "Name: value" per line — sent with every request'
                  >
                    <Textarea
                      value={(form.headers ?? []).join("\n")}
                      onChange={(e) =>
                        set(
                          "headers",
                          e.target.value.split(/\r?\n/).map((v) => v.trim()).filter(Boolean)
                        )
                      }
                      placeholder={'Authorization: Bearer token\nX-API-Key: secret'}
                      rows={3}
                    />
                  </Field>
                </div>
              )}
            </>
          )}
          <div className="sm:col-span-2 flex items-center gap-3">
            <Button type="submit" disabled={busy}>
              <Plus className="h-4 w-4" />
              {form.id ? "Save changes" : "Add component"}
            </Button>
            {form.id && (
              <Button type="button" variant="ghost" onClick={() => setForm({ ...EMPTY_FORM, group_id: form.group_id })}>
                Cancel
              </Button>
            )}
            {error && <span className="text-xs text-status-major">{error}</span>}
          </div>
        </form>
      </SectionCard>

      {/* Groups & components */}
      <SectionCard title="Components" description="Order and status of all monitored components.">
        <div className="flex justify-end mb-3">
          <Button type="button" variant="ghost" onClick={addGroup}>
            <Plus className="h-4 w-4" /> Add group
          </Button>
        </div>

        <div className="space-y-5">
          {groups.map((group) => (
            <div key={group.id} className="rounded-xl border border-border/30 bg-muted/10 overflow-hidden">
              <div className="flex items-center gap-2 border-b border-border/25 bg-muted/20 px-4 py-2">
                <GripVertical className="h-4 w-4 text-muted-foreground/40" strokeWidth={2} />
                <button
                  onClick={() => renameGroup(group)}
                  className="text-[12px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
                  title="Rename group"
                >
                  {group.id === "__ungrouped__" ? "Ungrouped" : group.name}
                </button>
                {group.id !== "__ungrouped__" && (
                  <>
                    <button
                      onClick={() => toggleCollapsed(group)}
                      className={cn(
                        "p-1 transition-colors",
                        group.collapsed
                          ? "text-primary"
                          : "text-muted-foreground/50 hover:text-foreground"
                      )}
                      title={
                        group.collapsed
                          ? "Default: collapsed — click to default to expanded"
                          : "Default: expanded — click to default to collapsed"
                      }
                    >
                      {group.collapsed ? (
                        <ChevronRight className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <button
                      onClick={() => toggleAutoExpand(group)}
                      className={cn(
                        "p-1 transition-colors",
                        group.auto_expand
                          ? "text-primary"
                          : "text-muted-foreground/50 hover:text-foreground"
                      )}
                      title={
                        group.auto_expand
                          ? "Auto-expands on issues — click to disable"
                          : "Auto-expand disabled — click to enable"
                      }
                    >
                      <Radar className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => removeGroup(group)}
                      className="ml-auto p-1 text-muted-foreground/50 hover:text-status-major transition-colors"
                      title="Delete group"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
                {group.id === "__ungrouped__" && (
                  <span className="ml-auto text-[10px] text-muted-foreground/60 tabular-nums">
                    {group.components.length}
                  </span>
                )}
                {group.id !== "__ungrouped__" && (
                  <span className="text-[10px] text-muted-foreground/60 tabular-nums">
                    {group.components.length}
                  </span>
                )}
              </div>

              {group.components.length === 0 ? (
                <p className="px-4 py-3 text-xs text-muted-foreground/60">No components</p>
              ) : (
                <ul className="divide-y divide-border/20">
                  {group.components.map((component) => (
                    <li key={component.id} className="flex items-center gap-3 px-4 py-2.5">
                      <span
                        className={cn(
                          "h-2 w-2 rounded-full shrink-0",
                          component.enabled
                            ? {
                                operational: "bg-status-operational",
                                degraded: "bg-status-degraded",
                                partial_outage: "bg-status-partial",
                                major_outage: "bg-status-major",
                              }[component.status]
                            : "bg-muted-foreground/30"
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold text-foreground truncate">
                          {component.name}
                          {!component.enabled && (
                            <span className="ml-2 text-[10px] font-bold uppercase text-muted-foreground/50">disabled</span>
                          )}
                        </p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {component.kind === "auto"
                            ? `${component.method} ${component.endpoint_url || "—"}`
                            : `manual · ${component.status.replace("_", " ")}`}
                        </p>
                      </div>
                      <button
                        onClick={() =>
                          setForm({
                            ...EMPTY_FORM,
                            id: component.id,
                            group_id: component.group_id,
                            name: component.name,
                            description: component.description,
                            kind: component.kind,
                            check_type: component.check_type,
                            endpoint_url: component.endpoint_url,
                            method: component.method,
                            expected_status: component.expected_status,
                            timeout_ms: component.timeout_ms,
                            headers: component.headers ?? [],
                            manual_status: component.status,
                          })
                        }
                        className="text-[12px] font-semibold text-primary hover:underline shrink-0"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => toggle(component)}
                        className="text-[12px] font-semibold text-muted-foreground hover:text-foreground shrink-0"
                      >
                        {component.enabled ? "Disable" : "Enable"}
                      </button>
                      <button
                        onClick={() => remove(component)}
                        className="p-1 text-muted-foreground/50 hover:text-status-major transition-colors shrink-0"
                        title="Delete component"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
