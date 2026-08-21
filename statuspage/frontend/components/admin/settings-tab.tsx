"use client";

import { useCallback, useEffect, useState } from "react";
import { FlaskConical, Save } from "lucide-react";
import { adminApi } from "@/lib/api";
import type { Settings } from "@/lib/types";
import { Button, Field, Input, SectionCard } from "@/components/admin/ui";

export function SettingsTab() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setSettings(await adminApi.settings());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load settings");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSaved(false);
    setSettings((s) => (s ? { ...s, [key]: value } : s));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.saveSettings(settings);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  if (!settings) {
    return <div className="text-sm text-muted-foreground">Loading settings…</div>;
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <SectionCard title="Public page">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Page name">
            <Input value={settings.page_name} onChange={(e) => set("page_name", e.target.value)} />
          </Field>
          <Field label="Page URL" hint="Used in the status.json output">
            <Input value={settings.page_url} onChange={(e) => set("page_url", e.target.value)} />
          </Field>
          <Field label="Timezone" hint="PHP timezone name, e.g. Europe/Berlin">
            <Input value={settings.timezone} onChange={(e) => set("timezone", e.target.value)} />
          </Field>
        </div>
      </SectionCard>

      <SectionCard
        title="Monitoring"
        description="A component flips to degraded / partial outage / major outage based on recent failures."
      >
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Latency threshold (ms)" hint="Average latency above this marks the component degraded.">
            <Input
              type="number"
              value={settings.latency_threshold_ms}
              onChange={(e) => set("latency_threshold_ms", Number(e.target.value) || 3000)}
            />
          </Field>
          <Field label="Failure window (checks)" hint="Status is derived from the last N check results.">
            <Input
              type="number"
              value={settings.failure_window}
              onChange={(e) => set("failure_window", Number(e.target.value) || 5)}
            />
          </Field>
          <div className="sm:col-span-2">
            <label className="flex items-center gap-3 rounded-xl border border-border/30 bg-muted/10 px-4 py-3 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.auto_incidents_enabled === 1}
                onChange={(e) => set("auto_incidents_enabled", e.target.checked ? 1 : 0)}
                className="h-4 w-4 accent-[hsl(var(--primary))]"
              />
              <span>
                <span className="block text-[13px] font-semibold text-foreground">
                  Create incidents automatically on outages
                </span>
                <span className="block text-[11.5px] text-muted-foreground mt-0.5">
                  When a component drops to partial or major outage, an incident is created
                  automatically and resolved once the component recovers.
                </span>
              </span>
            </label>
          </div>
          <div className="sm:col-span-2">
            <label className="flex items-center gap-3 rounded-xl border border-border/30 bg-muted/10 px-4 py-3 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.self_monitoring_enabled === 1}
                onChange={(e) => set("self_monitoring_enabled", e.target.checked ? 1 : 0)}
                className="h-4 w-4 accent-[hsl(var(--primary))]"
              />
              <span>
                <span className="block text-[13px] font-semibold text-foreground">
                  Monitor this status page itself
                </span>
                <span className="block text-[11.5px] text-muted-foreground mt-0.5">
                  Shows the page's own infrastructure (web, database, monitor heartbeat) as a
                  group on the public page and includes it in the overall status. The monitor
                  heartbeat is checked on every request — if the check loop stops, the
                  infrastructure status flips to degraded / major outage automatically.
                </span>
              </span>
            </label>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Notifications"
        description="Sent on component status changes and when incidents are created, updated or resolved."
      >
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="From email" hint="Used as sender for status emails">
            <Input value={settings.from_email} onChange={(e) => set("from_email", e.target.value)} />
          </Field>
          <Field label="Alert recipients (comma separated)">
            <Input
              value={settings.alert_emails.join(", ")}
              onChange={(e) =>
                set(
                  "alert_emails",
                  e.target.value.split(",").map((v) => v.trim()).filter(Boolean)
                )
              }
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Webhook URLs (comma separated)" hint="POST JSON payloads to Discord, Slack or a generic endpoint">
              <Input
                value={settings.webhook_urls.join(", ")}
                onChange={(e) =>
                  set(
                    "webhook_urls",
                    e.target.value.split(",").map((v) => v.trim()).filter(Boolean)
                  )
                }
              />
            </Field>
          </div>
        </div>
      </SectionCard>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy}>
          <Save className="h-4 w-4" />
          Save settings
        </Button>
        {saved && <span className="text-xs text-status-operational">Saved.</span>}
        {error && <span className="text-xs text-status-major">{error}</span>}
      </div>

      <p className="text-[11px] text-muted-foreground/60 tabular-nums">
        rumahl Status v{settings.version ?? "?"} · schema {settings.schema_version ?? "?"}
      </p>
    </form>
  );
}
