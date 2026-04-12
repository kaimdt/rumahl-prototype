import React, { useState, useEffect } from "react";
import type { AppConfig } from "../lib/tauri";
import { ModelSelector } from "./ModelSelector";
import type { Model } from "../lib/tauri";
import { Switch } from "@/components/ui/switch";

interface Props {
  config: AppConfig;
  models: Model[];
  modelsLoading: boolean;
  onSave: (config: AppConfig) => Promise<void>;
  onLoadModels: () => void;
}

const inputClass = "w-full px-3 py-2.5 rounded-xl bg-foreground/[0.04] border border-foreground/10 text-sm text-foreground focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all";
const inputNarrowClass = "px-3 py-2.5 rounded-xl bg-foreground/[0.04] border border-foreground/10 text-sm text-foreground focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all";

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] font-semibold text-foreground/40 uppercase tracking-[0.15em] pb-1">
      {children}
    </h2>
  );
}

function ToggleRow({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-foreground/[0.04] border border-foreground/8 px-4 py-3">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-foreground/85">{label}</p>
        {description && <p className="text-[11px] text-foreground/50 mt-0.5">{description}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
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

  const toggle = (key: keyof AppConfig) => (v: boolean) => {
    setForm((prev) => ({ ...prev, [key]: v }));
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
      <section className="flex flex-col gap-3">
        <SectionHeader>LM Studio</SectionHeader>

        <div className="flex flex-col gap-1.5">
          <label className="text-[13px] font-medium text-foreground/60">Server URL</label>
          <input
            type="url"
            value={form.lm_studio_url}
            onChange={field("lm_studio_url")}
            placeholder="http://localhost:1234"
            className={inputClass}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[13px] font-medium text-foreground/60">API Key (optional)</label>
          <input
            type="password"
            value={form.lm_studio_api_key}
            onChange={field("lm_studio_api_key")}
            placeholder="Leer lassen, wenn nicht benötigt"
            className={inputClass}
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
      <section className="flex flex-col gap-3">
        <SectionHeader>IORA Backend</SectionHeader>

        <div className="flex flex-col gap-1.5">
          <label className="text-[13px] font-medium text-foreground/60">IORA Assist URL</label>
          <input
            type="url"
            value={form.iora_backend_url}
            onChange={field("iora_backend_url")}
            placeholder="http://localhost:8092"
            className={inputClass}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[13px] font-medium text-foreground/60">IORA Home URL</label>
          <input
            type="url"
            value={form.iora_home_url}
            onChange={field("iora_home_url")}
            placeholder="http://localhost:3001"
            className={inputClass}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[13px] font-medium text-foreground/60">Proxy Port</label>
          <input
            type="number"
            value={form.proxy_port}
            onChange={field("proxy_port")}
            min={1024}
            max={65535}
            className={`${inputNarrowClass} w-[120px]`}
          />
        </div>

        <ToggleRow
          label="Proxy beim Start automatisch aktivieren"
          checked={form.auto_start_proxy}
          onChange={toggle("auto_start_proxy")}
        />
      </section>

      {/* Client section */}
      <section className="flex flex-col gap-3">
        <SectionHeader>Dieser Client</SectionHeader>

        <div className="flex flex-col gap-1.5">
          <label className="text-[13px] font-medium text-foreground/60">Client-Name</label>
          <input
            type="text"
            value={form.client_name}
            onChange={field("client_name")}
            placeholder="z.B. Wohnzimmer-PC"
            className={inputClass}
          />
          <span className="text-[11px] text-foreground/40">
            Anzeigename in IORA Assist (bei mehreren Clients)
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[13px] font-medium text-foreground/60">Prüfintervall (Sekunden)</label>
          <input
            type="number"
            value={form.health_poll_interval_secs}
            onChange={field("health_poll_interval_secs")}
            min={5}
            max={300}
            className={`${inputNarrowClass} w-[100px]`}
          />
          <span className="text-[11px] text-foreground/40">
            Wie oft der Hintergrundprozess die Verbindung prüft
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[13px] font-medium text-foreground/60">Client-ID</span>
          <code className="text-[11px] text-foreground/50 bg-foreground/[0.04] border border-foreground/8 rounded-lg px-3 py-2 select-all overflow-x-auto">
            {form.client_id}
          </code>
        </div>
      </section>

      {/* Home Assistant Integration section */}
      <section className="flex flex-col gap-3">
        <SectionHeader>Home Assistant Integration</SectionHeader>

        <ToggleRow
          label="Home Assistant Integration aktivieren"
          checked={form.ha_enabled}
          onChange={toggle("ha_enabled")}
        />

        {form.ha_enabled && (
          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-medium text-foreground/60">Metriken-Update-Intervall (Sekunden)</label>
            <input
              type="number"
              value={form.ha_update_interval_secs}
              onChange={field("ha_update_interval_secs")}
              min={30}
              max={300}
              className={`${inputNarrowClass} w-[120px]`}
            />
            <span className="text-[11px] text-foreground/40">
              Wie oft System-Metriken an HA gesendet werden
            </span>
          </div>
        )}
      </section>

      {/* Autostart section */}
      <section className="flex flex-col gap-3">
        <SectionHeader>Autostart</SectionHeader>

        <ToggleRow
          label="Beim Systemstart automatisch starten"
          checked={form.autostart_enabled}
          onChange={toggle("autostart_enabled")}
        />

        {form.autostart_enabled && (
          <>
            <ToggleRow
              label="Minimiert starten"
              checked={form.autostart_minimized}
              onChange={toggle("autostart_minimized")}
            />
            <ToggleRow
              label="Nur im Tray starten (kein Fenster)"
              checked={form.autostart_hidden}
              onChange={toggle("autostart_hidden")}
            />
          </>
        )}
      </section>

      <button
        type="submit"
        disabled={saving}
        className="px-5 py-2.5 rounded-xl border-none bg-accent text-white text-sm font-semibold cursor-pointer hover:opacity-90 transition-opacity self-end disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {saving ? "Speichern…" : saved ? "✓ Gespeichert" : "Einstellungen speichern"}
      </button>
    </form>
  );
}
