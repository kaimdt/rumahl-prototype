import React from "react";
import type { Model } from "../lib/tauri";

interface Props {
  models: Model[];
  selectedModel: string;
  loading: boolean;
  onChange: (modelId: string) => void;
  onRefresh: () => void;
}

export function ModelSelector({
  models,
  selectedModel,
  loading,
  onChange,
  onRefresh,
}: Props) {
  return (
    <div style={styles.wrapper}>
      <label style={styles.label}>Modell</label>
      <div style={styles.row}>
        <select
          value={selectedModel}
          onChange={(e) => onChange(e.target.value)}
          disabled={loading}
          style={styles.select}
        >
          <option value="">– Modell auswählen –</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.id}
            </option>
          ))}
        </select>
        <button onClick={onRefresh} disabled={loading} style={styles.refreshBtn}>
          {loading ? "…" : "↺"}
        </button>
      </div>
      {models.length === 0 && !loading && (
        <p style={styles.hint}>
          Klicke ↺ um Modelle zu laden (LM Studio muss laufen)
        </p>
      )}
    </div>
  );
}

const styles = {
  wrapper: { display: "flex", flexDirection: "column", gap: "6px" } as React.CSSProperties,
  label: { fontSize: "13px", fontWeight: 500, color: "var(--color-muted)" } as React.CSSProperties,
  row: { display: "flex", gap: "8px" } as React.CSSProperties,
  select: {
    flex: 1,
    padding: "8px 12px",
    borderRadius: "var(--radius)",
    border: "1px solid var(--color-border)",
    background: "var(--color-surface)",
    color: "var(--color-text)",
    fontSize: "14px",
  } as React.CSSProperties,
  refreshBtn: {
    padding: "8px 14px",
    borderRadius: "var(--radius)",
    border: "1px solid var(--color-border)",
    background: "var(--color-surface)",
    color: "var(--color-text)",
    cursor: "pointer",
    fontSize: "16px",
  } as React.CSSProperties,
  hint: { fontSize: "12px", color: "var(--color-muted)" } as React.CSSProperties,
};
