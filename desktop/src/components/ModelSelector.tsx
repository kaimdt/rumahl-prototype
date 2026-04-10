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
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-muted-foreground">Modell</label>
      <div className="flex gap-2">
        <select
          value={selectedModel}
          onChange={(e) => onChange(e.target.value)}
          disabled={loading}
          className="flex-1 px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm disabled:opacity-50 disabled:cursor-not-allowed outline-none"
        >
          <option value="">– Modell auswählen –</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.id}
            </option>
          ))}
        </select>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="px-3.5 py-2 rounded-lg border border-border bg-card text-foreground cursor-pointer text-base hover:bg-foreground/5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "…" : "↺"}
        </button>
      </div>
      {models.length === 0 && !loading && (
        <p className="text-xs text-muted-foreground">
          Klicke ↺ um Modelle zu laden (LM Studio muss laufen)
        </p>
      )}
    </div>
  );
}
