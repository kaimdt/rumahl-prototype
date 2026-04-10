import React, { useState, useEffect } from "react";
import type { AppConfig } from "../lib/tauri";
import { ModelSelector } from "./ModelSelector";
import type { Model } from "../lib/tauri";

interface Props {
  config: AppConfig;
  models: Model[];
  modelsLoading: boolean;
  onSave: (config: AppConfig) => Promise<void>;
  onLoadModels: () => void;
}

export function SettingsForm({
  config,
  models,
  modelsLoading,
  onSave,
  onLoadModels,
}: Props) {
  const [form, setForm] = useState<AppConfig>(config);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Keep form in sync when config prop changes
  useEffect(() => {
    setForm(config);
  }, [config]);

  const field =
    (key: keyof AppConfig) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setForm((prev) => ({
        ...prev,
        [key]:
          e.target.type === "checkbox"
            ? e.target.checked
            : e.target.type === "number"
            ? Number(e.target.value)
            : e.target.value,
      }));
    };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(form);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-6">
      {/* LM Studio section */}
      <section className="flex flex-col gap-3.5">
        <h2 className="text-sm font-semibold text-primary uppercase tracking-wider pb-1.5 border-b border-border">
          LM Studio
        </h2>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-muted-foreground">Server URL</label>
          <input
            type="url"
            value={form.lm_studio_url}
            onChange={field("lm_studio_url")}
            placeholder="http://localhost:1234"
            className="px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm w-full outline-none"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-muted-foreground">API Key (optional)</label>
          <input
            type="password"
            value={form.lm_studio_api_key}
            onChange={field("lm_studio_api_key")}
            placeholder="Leer lassen, wenn nicht benötigt"
            className="px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm w-full outline-none"
          />
        </div>

        <ModelSelector
          models={models}
          selectedModel={form.selected_model}
          loading={modelsLoading}
          onChange={(id) => setForm((prev) => ({ ...prev, selected_model: id }))}
          onRefresh={onLoadModels}
        />
      </section>

      {/* IORA Backend section */}
      <section className="flex flex-col gap-3.5">
        <h2 className="text-sm font-semibold text-primary uppercase tracking-wider pb-1.5 border-b border-border">
          IORA Backend
        </h2>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-muted-foreground">IORA Assist URL</label>
          <input
            type="url"
            value={form.iora_backend_url}
            onChange={field("iora_backend_url")}
            placeholder="http://localhost:8092"
            className="px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm w-full outline-none"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-muted-foreground">IORA Home URL</label>
          <input
            type="url"
            value={form.iora_home_url}
            onChange={field("iora_home_url")}
            placeholder="http://localhost:8080"
            className="px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm w-full outline-none"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-muted-foreground">Proxy Port</label>
          <input
            type="number"
            value={form.proxy_port}
            onChange={field("proxy_port")}
            min={1024}
            max={65535}
            className="px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm w-[120px] outline-none"
          />
        </div>

        <div className="flex items-center gap-2.5">
          <input
            id="auto_start"
            type="checkbox"
            checked={form.auto_start_proxy}
            onChange={field("auto_start_proxy")}
            className="w-4 h-4 accent-primary"
          />
          <label htmlFor="auto_start" className="text-sm text-foreground cursor-pointer">
            Proxy beim Start automatisch aktivieren
          </label>
        </div>
      </section>

      {/* Client section */}
      <section className="flex flex-col gap-3.5">
        <h2 className="text-sm font-semibold text-primary uppercase tracking-wider pb-1.5 border-b border-border">
          Dieser Client
        </h2>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-muted-foreground">Client-Name</label>
          <input
            type="text"
            value={form.client_name}
            onChange={field("client_name")}
            placeholder="z.B. Wohnzimmer-PC"
            className="px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm w-full outline-none"
          />
          <span className="text-[11px] text-muted-foreground">
            Anzeigename in IORA Assist (bei mehreren Clients)
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-muted-foreground">Prüfintervall (Sekunden)</label>
          <input
            type="number"
            value={form.health_poll_interval_secs}
            onChange={field("health_poll_interval_secs")}
            min={5}
            max={300}
            className="px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm w-[100px] outline-none"
          />
          <span className="text-[11px] text-muted-foreground">
            Wie oft der Hintergrundprozess die Verbindung prüft
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-muted-foreground">Client-ID</span>
          <code className="text-[11px] text-muted-foreground bg-background border border-border rounded px-2 py-1 select-all overflow-x-auto">
            {form.client_id}
          </code>
        </div>
      </section>

      {/* Home Assistant Integration section */}
      <section className="flex flex-col gap-3.5">
        <h2 className="text-sm font-semibold text-primary uppercase tracking-wider pb-1.5 border-b border-border">
          Home Assistant Integration
        </h2>

        <div className="flex items-center gap-2.5">
          <input
            id="ha_enabled"
            type="checkbox"
            checked={form.ha_enabled}
            onChange={field("ha_enabled")}
            className="w-4 h-4 accent-primary"
          />
          <label htmlFor="ha_enabled" className="text-sm text-foreground cursor-pointer">
            Home Assistant Integration aktivieren
          </label>
        </div>

        {form.ha_enabled && (
          <>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-muted-foreground">Metriken-Update-Intervall (Sekunden)</label>
              <input
                type="number"
                value={form.ha_update_interval_secs}
                onChange={field("ha_update_interval_secs")}
                min={30}
                max={300}
                className="px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm w-[120px] outline-none"
              />
              <span className="text-[11px] text-muted-foreground">
                Wie oft System-Metriken an HA gesendet werden
              </span>
            </div>
          </>
        )}
      </section>

      {/* Autostart section */}
      <section className="flex flex-col gap-3.5">
        <h2 className="text-sm font-semibold text-primary uppercase tracking-wider pb-1.5 border-b border-border">
          Autostart
        </h2>

        <div className="flex items-center gap-2.5">
          <input
            id="autostart_enabled"
            type="checkbox"
            checked={form.autostart_enabled}
            onChange={field("autostart_enabled")}
            className="w-4 h-4 accent-primary"
          />
          <label htmlFor="autostart_enabled" className="text-sm text-foreground cursor-pointer">
            Beim Systemstart automatisch starten
          </label>
        </div>

        {form.autostart_enabled && (
          <>
            <div className="flex items-center gap-2.5">
              <input
                id="autostart_minimized"
                type="checkbox"
                checked={form.autostart_minimized}
                onChange={field("autostart_minimized")}
                className="w-4 h-4 accent-primary"
              />
              <label htmlFor="autostart_minimized" className="text-sm text-foreground cursor-pointer">
                Minimiert starten
              </label>
            </div>

            <div className="flex items-center gap-2.5">
              <input
                id="autostart_hidden"
                type="checkbox"
                checked={form.autostart_hidden}
                onChange={field("autostart_hidden")}
                className="w-4 h-4 accent-primary"
              />
              <label htmlFor="autostart_hidden" className="text-sm text-foreground cursor-pointer">
                Nur im Tray starten (kein Fenster)
              </label>
            </div>
          </>
        )}
      </section>

      <button
        type="submit"
        disabled={saving}
        className="px-5 py-2.5 rounded-lg border-none bg-primary text-white text-sm font-semibold cursor-pointer hover:opacity-90 transition-opacity self-end disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {saving ? "Speichern…" : saved ? "✓ Gespeichert" : "Einstellungen speichern"}
      </button>
    </form>
  );
}
