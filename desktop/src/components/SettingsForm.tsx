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
    <form onSubmit={handleSave} style={styles.form}>
      {/* LM Studio section */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>LM Studio</h2>

        <div style={styles.field}>
          <label style={styles.label}>Server URL</label>
          <input
            type="url"
            value={form.lm_studio_url}
            onChange={field("lm_studio_url")}
            placeholder="http://localhost:1234"
            style={styles.input}
          />
        </div>

        <div style={styles.field}>
          <label style={styles.label}>API Key (optional)</label>
          <input
            type="password"
            value={form.lm_studio_api_key}
            onChange={field("lm_studio_api_key")}
            placeholder="Leer lassen, wenn nicht benötigt"
            style={styles.input}
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
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>IORA Backend</h2>

        <div style={styles.field}>
          <label style={styles.label}>IORA Assist URL</label>
          <input
            type="url"
            value={form.iora_backend_url}
            onChange={field("iora_backend_url")}
            placeholder="http://localhost:8092"
            style={styles.input}
          />
        </div>

        <div style={styles.field}>
          <label style={styles.label}>IORA Home URL</label>
          <input
            type="url"
            value={form.iora_home_url}
            onChange={field("iora_home_url")}
            placeholder="http://localhost:8080"
            style={styles.input}
          />
        </div>

        <div style={styles.field}>
          <label style={styles.label}>Proxy Port</label>
          <input
            type="number"
            value={form.proxy_port}
            onChange={field("proxy_port")}
            min={1024}
            max={65535}
            style={{ ...styles.input, width: "120px" }}
          />
        </div>

        <div style={styles.checkboxField}>
          <input
            id="auto_start"
            type="checkbox"
            checked={form.auto_start_proxy}
            onChange={field("auto_start_proxy")}
            style={styles.checkbox}
          />
          <label htmlFor="auto_start" style={styles.checkboxLabel}>
            Proxy beim Start automatisch aktivieren
          </label>
        </div>
      </section>

      {/* Client section */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Dieser Client</h2>

        <div style={styles.field}>
          <label style={styles.label}>Client-Name</label>
          <input
            type="text"
            value={form.client_name}
            onChange={field("client_name")}
            placeholder="z.B. Wohnzimmer-PC"
            style={styles.input}
          />
          <span style={styles.hint}>
            Anzeigename in IORA Assist (bei mehreren Clients)
          </span>
        </div>

        <div style={styles.field}>
          <label style={styles.label}>Prüfintervall (Sekunden)</label>
          <input
            type="number"
            value={form.health_poll_interval_secs}
            onChange={field("health_poll_interval_secs")}
            min={5}
            max={300}
            style={{ ...styles.input, width: "100px" }}
          />
          <span style={styles.hint}>
            Wie oft der Hintergrundprozess die Verbindung prüft
          </span>
        </div>

        <div style={styles.readonlyField}>
          <span style={styles.label}>Client-ID</span>
          <code style={styles.clientId}>{form.client_id}</code>
        </div>
      </section>

      <button type="submit" disabled={saving} style={styles.saveBtn}>
        {saving ? "Speichern…" : saved ? "✓ Gespeichert" : "Einstellungen speichern"}
      </button>
    </form>
  );
}

const styles = {
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "24px",
  } as React.CSSProperties,
  section: {
    display: "flex",
    flexDirection: "column",
    gap: "14px",
  } as React.CSSProperties,
  sectionTitle: {
    fontSize: "14px",
    fontWeight: 600,
    color: "var(--color-primary)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    paddingBottom: "6px",
    borderBottom: "1px solid var(--color-border)",
  } as React.CSSProperties,
  field: { display: "flex", flexDirection: "column", gap: "5px" } as React.CSSProperties,
  label: {
    fontSize: "13px",
    fontWeight: 500,
    color: "var(--color-muted)",
  } as React.CSSProperties,
  input: {
    padding: "8px 12px",
    borderRadius: "var(--radius)",
    border: "1px solid var(--color-border)",
    background: "var(--color-surface)",
    color: "var(--color-text)",
    fontSize: "14px",
    width: "100%",
    outline: "none",
  } as React.CSSProperties,
  hint: {
    fontSize: "11px",
    color: "var(--color-muted)",
  } as React.CSSProperties,
  checkboxField: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
  } as React.CSSProperties,
  checkbox: {
    width: "16px",
    height: "16px",
    accentColor: "var(--color-primary)",
  } as React.CSSProperties,
  checkboxLabel: {
    fontSize: "14px",
    color: "var(--color-text)",
    cursor: "pointer",
  } as React.CSSProperties,
  readonlyField: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  } as React.CSSProperties,
  clientId: {
    fontSize: "11px",
    color: "var(--color-muted)",
    background: "var(--color-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: "4px",
    padding: "4px 8px",
    userSelect: "all" as const,
    overflowX: "auto" as const,
  } as React.CSSProperties,
  saveBtn: {
    padding: "10px 20px",
    borderRadius: "var(--radius)",
    border: "none",
    background: "var(--color-primary)",
    color: "white",
    fontSize: "14px",
    fontWeight: 600,
    cursor: "pointer",
    transition: "background 0.2s",
    alignSelf: "flex-end",
  } as React.CSSProperties,
};
