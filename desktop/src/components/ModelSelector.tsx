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
      <label className="text-[13px] font-medium text-foreground/60">Modell</label>
      <div className="flex gap-2">
        <select
          value={selectedModel}
          onChange={(e) => onChange(e.target.value)}
          disabled={loading}
          className="flex-1 px-3 py-2.5 rounded-xl bg-foreground/[0.04] border border-foreground/10 text-foreground text-sm disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all"
        >
          <option value="">– Modell auswählen –</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.id}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="px-3.5 py-2.5 rounded-xl bg-foreground/[0.04] border border-foreground/10 text-foreground cursor-pointer text-base hover:bg-foreground/[0.08] hover:border-foreground/18 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {loading ? "…" : "↺"}
        </button>
      </div>
      {models.length === 0 && !loading && (
        <p className="text-[11px] text-foreground/40">
          Klicke ↺ um Modelle zu laden (LM Studio muss laufen)
        </p>
      )}
    </div>
  );
}
